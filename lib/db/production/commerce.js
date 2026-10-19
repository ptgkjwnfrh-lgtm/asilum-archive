// lib/db/production/commerce.js — NATIVE COMMERCE'S ROWS (V.2 Blueprint,
// chapters 7 and 8; slice 6; schema v64 over the storefront's v62).
// SERVER-ONLY; memory mode mirrors every function so mem and Postgres
// agree (the differential is tests/helpers/commerce-scenario.mjs). The law
// is lib/storefront/commerce.js — nothing here decides a rule, it keeps
// what the law decided.
//
//   offers       make, respond (accept / decline / counter), the accepted
//                price for ITS buyer, invalidation on sale, lazy expiry
//   discounts    apply, renew, cancel, the active one, lazy expiry that
//                restores the price (7.31); every change is in the private
//                price history (8.13)
//   the queue    join, leave, members, the event fan-out (7.10–7.13)
//   relists      the confirmed relist and what it changed (7.14–7.17)
//   settings     the seller's offer settings (7.19–7.20); the listing's mode
//
// v64 may be unapplied where this runs: readers answer empty, writers
// refuse by name, exactly as the verification and governance stores do.

import { getPool, hasRelation, hasColumns } from "../core/pool.js";
import { mem, withOrderedUserLocks } from "./store.js";
import { enqueueNotification, getNotificationPrefs, usersWhoKept } from "./listingStatus.js";
import {
  MODES, reminderTimes, newOffer, respondToOffer, offerState, acceptedPriceFor, invalidateOnSale, autoAccepts, offerAllowed,
  newDiscount, discountActive, discountNotifies, queueEvent, queueOrder, relistPlan, validateMode,
} from "../../storefront/commerce.js";

export class CommerceRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "CommerceRefused"; this.code = code; this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const applied = async (p) => (p ? hasRelation(p, "listing_offers") : true);
const needs = () => { throw new CommerceRefused("SCHEMA_V64_REQUIRED", "native commerce needs schema v64 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();
const uuid = (v, name) => { const s = String(v || "").toLowerCase(); if (!UUID.test(s)) throw new CommerceRefused("INVALID_ID", `${name} is invalid`, 400); return s; };

const offerOut = (r) => ({
  id: String(r.id), listingId: String(r.listing_id), variantId: r.variant_id ? String(r.variant_id) : null, storefrontId: String(r.storefront_id),
  buyerId: r.buyer_id, sellerAccountId: String(r.seller_account_id), by: r.by_party, parentId: r.parent_id ? String(r.parent_id) : null,
  amountCents: Number(r.amount_cents), currency: r.currency, state: r.state, note: r.note || null,
  createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), acceptedUntil: iso(r.accepted_until), respondedAt: iso(r.responded_at),
  remindersSent: Array.isArray(r.reminders_sent) ? r.reminders_sent : (typeof r.reminders_sent === "string" ? JSON.parse(r.reminders_sent) : []),
});
const offerRow = (o) => ({
  id: o.id, listing_id: o.listingId, variant_id: o.variantId, storefront_id: o.storefrontId, buyer_id: o.buyerId, seller_account_id: o.sellerAccountId,
  by_party: o.by, parent_id: o.parentId, amount_cents: o.amountCents, currency: o.currency, state: o.state, note: o.note || null,
  created_at: o.createdAt, expires_at: o.expiresAt, accepted_until: o.acceptedUntil, responded_at: o.respondedAt,
  reminders_sent: o.remindersSent || [],
});
const discountOut = (r) => ({
  id: String(r.id), listingId: String(r.listing_id), storefrontId: String(r.storefront_id), percent: Number(r.percent),
  priceBeforeCents: Number(r.price_before_cents), priceCents: Number(r.price_cents), state: r.state,
  startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), endedAt: iso(r.ended_at), renewedFrom: r.renewed_from ? String(r.renewed_from) : null, createdBy: r.created_by,
});
const queueOut = (r) => ({ listingId: String(r.listing_id), userId: r.user_id, joinedAt: iso(r.joined_at), state: r.state, notifiedAt: iso(r.notified_at) });

// ---- the listing's authority (both backends) ------------------------------------------

/** The listing with its store and variants, by listing id. Null when unknown. */
async function listingAuthority(listingId) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!p) {
    const listing = mem.nativeListings.get(id);
    if (!listing) return null;
    const store = mem.storefronts.get(listing.storefront_id);
    const variants = [...mem.nativeVariants.values()].filter((v) => v.listing_id === id);
    return { listing, store, variants };
  }
  const { rows } = await p.query("SELECT * FROM native_listings WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const [store, variants] = await Promise.all([
    p.query("SELECT * FROM storefronts WHERE id=$1", [rows[0].storefront_id]),
    p.query("SELECT * FROM native_listing_variants WHERE listing_id=$1 ORDER BY is_default DESC, created_at", [id]),
  ]);
  return { listing: rows[0], store: store.rows[0] || null, variants: variants.rows };
}

const defaultVariant = (variants = []) => variants.find((v) => v.is_default) || variants[0] || null;

// ---- modes and settings -----------------------------------------------------------------

/** Set a listing's mode (SELL / DROP), checking its shape against the mode. */
export async function setListingMode(ownerAccountId, listingId, mode) {
  const auth = await listingAuthority(listingId);
  if (!auth || !auth.store || String(auth.store.owner_account_id).toLowerCase() !== String(ownerAccountId).toLowerCase()) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const check = validateMode(mode, { quantity: auth.variants.reduce((s, v) => s + Number(v.stock_on_hand || 0), 0), variants: auth.variants.map((v) => ({ stockOnHand: v.stock_on_hand, optionValues: v.option_values })) });
  if (!check.ok) throw new CommerceRefused("MODE_MISMATCH", check.reason, 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) { auth.listing.mode = mode; auth.listing.updated_at = new Date().toISOString(); return { listingId: auth.listing.id, mode }; }
  await p.query("UPDATE native_listings SET mode=$2, updated_at=now() WHERE id=$1", [auth.listing.id, mode]);
  return { listingId: String(auth.listing.id), mode };
}

export const DEFAULT_OFFER_SETTINGS = Object.freeze({ acceptOffers: true, offersDuringDiscount: true, discountsStack: false, autoAcceptCents: null });

const cleanSettings = (raw = {}) => ({
  acceptOffers: raw.acceptOffers == null ? true : !!raw.acceptOffers,
  offersDuringDiscount: raw.offersDuringDiscount == null ? true : !!raw.offersDuringDiscount,
  discountsStack: !!raw.discountsStack,
  autoAcceptCents: Number.isSafeInteger(Number(raw.autoAcceptCents)) && Number(raw.autoAcceptCents) > 0 ? Number(raw.autoAcceptCents) : null,
});

export async function getOfferSettings(storefrontId) {
  const p = await getPool();
  if (!p) return cleanSettings(mem.storefronts.get(String(storefrontId))?.offer_settings || {});
  if (!(await hasColumns(p, "storefronts", ["offer_settings"]))) return { ...DEFAULT_OFFER_SETTINGS };
  const { rows } = await p.query("SELECT offer_settings FROM storefronts WHERE id=$1", [storefrontId]);
  return cleanSettings(json(rows[0]?.offer_settings) || {});
}

export async function setOfferSettings(ownerAccountId, patch = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  let storeId;
  if (!p) storeId = mem.storefrontOwners.get(String(ownerAccountId).toLowerCase());
  else storeId = (await p.query("SELECT id FROM storefronts WHERE owner_account_id=$1", [String(ownerAccountId).toLowerCase()])).rows[0]?.id;
  if (!storeId) throw new CommerceRefused("STORE_NOT_FOUND", "no storefront for this account", 404);
  const next = cleanSettings({ ...(await getOfferSettings(storeId)), ...patch });
  if (!p) { mem.storefronts.get(storeId).offer_settings = next; return next; }
  await p.query("UPDATE storefronts SET offer_settings=$2, updated_at=now() WHERE id=$1", [storeId, JSON.stringify(next)]);
  return next;
}

// ---- the private price history ---------------------------------------------------------------

async function recordPrice({ listingId, variantId = null, priceCents, reason, actor = null, now = Date.now() }) {
  const p = await getPool();
  if (!p) { mem.priceHistory.push({ listingId, variantId, priceCents, reason, actor, at: new Date(now).toISOString() }); return; }
  await p.query("INSERT INTO listing_price_history (listing_id, variant_id, price_cents, reason, actor, at) VALUES ($1,$2,$3,$4,$5,$6)", [listingId, variantId, priceCents, reason, actor, new Date(now).toISOString()]);
}

/** PRIVATE (8.13): the owner's and the admins' read only. */
export async function priceHistory(listingId, { limit = 100 } = {}) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return mem.priceHistory.filter((r) => r.listingId === id).slice(-limit).reverse();
  const { rows } = await p.query("SELECT listing_id, variant_id, price_cents, reason, actor, at FROM listing_price_history WHERE listing_id=$1 ORDER BY at DESC, id DESC LIMIT $2", [id, limit]);
  return rows.map((r) => ({ listingId: String(r.listing_id), variantId: r.variant_id ? String(r.variant_id) : null, priceCents: Number(r.price_cents), reason: r.reason, actor: r.actor, at: iso(r.at) }));
}

async function setVariantPrice(variant, priceCents, now = Date.now()) {
  const p = await getPool();
  if (!p) { variant.price_cents = priceCents; variant.version = Number(variant.version || 1) + 1; variant.updated_at = new Date(now).toISOString(); return; }
  await p.query("UPDATE native_listing_variants SET price_cents=$2, version=version+1, updated_at=now() WHERE id=$1", [variant.id, priceCents]);
}

// the catalog projection must follow a price change; the storefront store owns it
async function reproject(listingId) {
  const { reprojectListing } = await import("./storefronts.js");
  if (typeof reprojectListing === "function") await reprojectListing(listingId).catch(() => {});
}

// ---- discounts --------------------------------------------------------------------------------

export async function activeDiscount(listingId, now = Date.now()) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!(await applied(p))) return null;
  let rows;
  if (!p) rows = [...mem.listingDiscounts.values()].filter((d) => d.listing_id === id && d.state === "active");
  else rows = (await p.query("SELECT * FROM listing_discounts WHERE listing_id=$1 AND state='active' ORDER BY ends_at DESC", [id])).rows;
  for (const r of rows) {
    const d = discountOut(r);
    if (discountActive(d, now)) return d;
    await endDiscount(r, "expired", now); // 7.31: the original price is restored automatically
  }
  return null;
}

async function endDiscount(row, state, now = Date.now(), actor = "system") {
  const p = await getPool();
  const auth = await listingAuthority(row.listing_id);
  const variant = auth ? defaultVariant(auth.variants) : null;
  if (!p) { row.state = state; row.ended_at = new Date(now).toISOString(); }
  else await p.query("UPDATE listing_discounts SET state=$2, ended_at=$3 WHERE id=$1 AND state='active'", [row.id, state, new Date(now).toISOString()]);
  if (variant && Number(variant.price_cents) === Number(row.price_cents)) {
    await setVariantPrice(variant, Number(row.price_before_cents), now);
    await recordPrice({ listingId: String(row.listing_id), variantId: String(variant.id), priceCents: Number(row.price_before_cents), reason: `discount ${state}: price restored`, actor, now });
    await reproject(String(row.listing_id));
  }
}

/** Apply (or renew) a 24-hour discount; every application and renewal notifies the likers above their threshold. */
export async function applyDiscount(ownerAccountId, listingId, { percent, now = Date.now(), renew = false } = {}) {
  const auth = await listingAuthority(listingId);
  if (!auth || !auth.store || String(auth.store.owner_account_id).toLowerCase() !== String(ownerAccountId).toLowerCase()) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const variant = defaultVariant(auth.variants);
  if (!variant) throw new CommerceRefused("NO_VARIANT", "the listing has no price to discount", 409);
  const current = await activeDiscount(auth.listing.id, now);
  const before = current ? current.priceBeforeCents : Number(variant.price_cents);
  const made = newDiscount({ listingId: String(auth.listing.id), percent, priceBeforeCents: before, now, renewedFrom: current && renew ? current.id : null });
  if (!made.ok) throw new CommerceRefused("INVALID_DISCOUNT", made.reason, 400);
  if (current) await endDiscount(p ? { ...current, id: current.id, listing_id: current.listingId, price_cents: current.priceCents, price_before_cents: current.priceBeforeCents } : [...mem.listingDiscounts.values()].find((d) => d.id === current.id), renew ? "expired" : "cancelled", now, String(ownerAccountId));
  const d = made.discount;
  const row = { id: newId(), listing_id: d.listingId, storefront_id: String(auth.store.id), percent: d.percent, price_before_cents: d.priceBeforeCents, price_cents: d.priceCents, state: "active", starts_at: d.startsAt, ends_at: d.endsAt, ended_at: null, renewed_from: d.renewedFrom, created_by: String(ownerAccountId) };
  if (!p) mem.listingDiscounts.set(row.id, row);
  else await p.query(`INSERT INTO listing_discounts (id, listing_id, storefront_id, percent, price_before_cents, price_cents, state, starts_at, ends_at, renewed_from, created_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)`,
    [row.id, row.listing_id, row.storefront_id, row.percent, row.price_before_cents, row.price_cents, row.starts_at, row.ends_at, row.renewed_from, row.created_by]);
  await setVariantPrice(variant, d.priceCents, now);
  await recordPrice({ listingId: d.listingId, variantId: String(variant.id), priceCents: d.priceCents, reason: `${renew ? "discount renewed" : "discount applied"}: ${d.percent}% off ${d.priceBeforeCents}`, actor: String(ownerAccountId), now });
  await reproject(d.listingId);
  // 7.33: every discount and every renewal notifies, even at the same percentage — above each passenger's threshold
  const itemId = `native-${d.listingId}`;
  const likers = await usersWhoKept(itemId).catch(() => []);
  let notified = 0;
  for (const userId of likers) {
    const prefs = await getNotificationPrefs(userId).catch(() => ({}));
    if (!discountNotifies(d.percent, prefs.discountMinPercent)) continue;
    const r = await enqueueNotification({ userId, kind: "discount", subjectId: `${d.listingId}:${row.id}`, payload: { listingId: d.listingId, itemId, percent: d.percent, priceCents: d.priceCents, endsAt: d.endsAt, title: auth.listing.title } }).catch(() => ({ queued: false }));
    if (r.queued) notified++;
  }
  return { discount: discountOut(row), notified, likers: likers.length };
}

export async function cancelDiscount(ownerAccountId, listingId, { now = Date.now() } = {}) {
  const auth = await listingAuthority(listingId);
  if (!auth || !auth.store || String(auth.store.owner_account_id).toLowerCase() !== String(ownerAccountId).toLowerCase()) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const current = await activeDiscount(auth.listing.id, now);
  if (!current) return { cancelled: false };
  const p = await getPool();
  const row = p ? { id: current.id, listing_id: current.listingId, price_cents: current.priceCents, price_before_cents: current.priceBeforeCents } : [...mem.listingDiscounts.values()].find((d) => d.id === current.id);
  await endDiscount(row, "cancelled", now, String(ownerAccountId));
  return { cancelled: true, discount: { ...current, state: "cancelled" } };
}

/** Lazy expiry for every active discount — the steward's sweep and the owner read call it. */
export async function expireDiscounts(now = Date.now()) {
  const p = await getPool();
  if (!(await applied(p))) return 0;
  let rows;
  if (!p) rows = [...mem.listingDiscounts.values()].filter((d) => d.state === "active");
  else rows = (await p.query("SELECT * FROM listing_discounts WHERE state='active' AND ends_at <= $1", [new Date(now).toISOString()])).rows;
  let n = 0;
  for (const r of rows) if (!discountActive(discountOut(r), now)) { await endDiscount(r, "expired", now); n++; }
  return n;
}

// ---- offers -------------------------------------------------------------------------------

async function saveOffer(o) {
  const p = await getPool();
  const row = offerRow(o);
  if (!p) { mem.listingOffers.set(row.id, row); return offerOut(row); }
  await p.query(
    `INSERT INTO listing_offers (id, listing_id, variant_id, storefront_id, buyer_id, seller_account_id, by_party, parent_id, amount_cents, currency, state, note, created_at, expires_at, accepted_until, responded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, note=EXCLUDED.note, accepted_until=EXCLUDED.accepted_until, responded_at=EXCLUDED.responded_at`,
    [row.id, row.listing_id, row.variant_id, row.storefront_id, row.buyer_id, row.seller_account_id, row.by_party, row.parent_id, row.amount_cents, row.currency, row.state, row.note, row.created_at, row.expires_at, row.accepted_until, row.responded_at]);
  return offerOut(row);
}

export async function getOffer(offerId) {
  const id = uuid(offerId, "offer id");
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.listingOffers.get(id); return r ? offerOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM listing_offers WHERE id=$1", [id]);
  return rows[0] ? offerOut(rows[0]) : null;
}

const notify = (userId, kind, offer, extra = {}) => enqueueNotification({ userId, kind, subjectId: offer.id, payload: { offerId: offer.id, listingId: offer.listingId, amountCents: offer.amountCents, currency: offer.currency, expiresAt: offer.expiresAt, acceptedUntil: offer.acceptedUntil, ...extra } }).catch(() => ({ queued: false }));

/**
 * A buyer makes an offer. Unlimited offers (7.23, 8.10); the seller's
 * settings decide whether offers are open (7.19); auto-accept at the
 * threshold (7.20). The seller is told at once (7.26).
 */
export async function makeOffer({ buyerId, listingId, variantId = null, amountCents, now = Date.now() } = {}) {
  if (!buyerId) throw new CommerceRefused("AUTH_REQUIRED", "authentication required", 401);
  const auth = await listingAuthority(listingId);
  if (!auth || !auth.store) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const settings = await getOfferSettings(auth.store.id);
  const discount = await activeDiscount(auth.listing.id, now);
  const allowed = offerAllowed({ listing: { state: auth.listing.state }, discountActive: !!discount, settings });
  if (!allowed.ok) throw new CommerceRefused("OFFERS_CLOSED", allowed.reason, 409);
  const variant = variantId ? auth.variants.find((v) => String(v.id) === String(variantId).toLowerCase()) : defaultVariant(auth.variants);
  if (!variant) throw new CommerceRefused("VARIANT_NOT_FOUND", "variant not found", 404);
  const made = newOffer({ listingId: String(auth.listing.id), variantId: String(variant.id), buyerId, sellerAccountId: String(auth.store.owner_account_id), amountCents, listPriceCents: Number(variant.price_cents), currency: variant.currency || "usd", now });
  if (!made.ok) throw new CommerceRefused("INVALID_OFFER", made.reason, 400);
  let offer = { ...made.offer, id: newId(), storefrontId: String(auth.store.id) };
  let accepted = false;
  if (autoAccepts(offer, settings)) {
    const r = respondToOffer(offer, { action: "accept", by: "seller", now });
    offer = r.offer; accepted = true;
  }
  const saved = await saveOffer(offer);
  await notify(saved.sellerAccountId, accepted ? "offer-accepted" : "offer-new", saved, { title: auth.listing.title, autoAccepted: accepted });
  if (accepted) await notify(saved.buyerId, "offer-accepted", saved, { title: auth.listing.title, autoAccepted: true });
  return { offer: saved, autoAccepted: accepted };
}

/** The receiving party answers: accept, decline, or counter (a new offer from them). */
export async function respondOffer({ offerId, by, actorId, action, amountCents = null, now = Date.now() } = {}) {
  const offer = await getOffer(offerId);
  if (!offer) throw new CommerceRefused("OFFER_NOT_FOUND", "offer not found", 404);
  const party = by === "seller" ? offer.sellerAccountId : offer.buyerId;
  if (String(party).toLowerCase() !== String(actorId || "").toLowerCase()) throw new CommerceRefused("NOT_A_PARTY", "not your offer to answer", 403);
  const r = respondToOffer(offer, { action, amountCents, by, now });
  if (!r.ok) throw new CommerceRefused("OFFER_CLOSED", r.reason, 409);
  const saved = await saveOffer(r.offer);
  let counter = null;
  if (r.counter) counter = await saveOffer({ ...r.counter, id: newId(), storefrontId: offer.storefrontId, parentId: offer.id });
  const other = by === "seller" ? offer.buyerId : offer.sellerAccountId;
  const auth = await listingAuthority(offer.listingId);
  const title = auth?.listing?.title || null;
  if (action === "accept") await notify(other, "offer-accepted", saved, { title });
  else if (action === "decline") await notify(other, "offer-declined", saved, { title });
  else if (counter) await notify(other, "offer-counter", counter, { title, counterOf: offer.id });
  return { offer: saved, counter };
}

/** The offers a buyer made or received, newest first, with the live state. */
export async function listOffersForBuyer(buyerId, { limit = 50, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => r.buyer_id === buyerId);
  else rows = (await p.query("SELECT * FROM listing_offers WHERE buyer_id=$1 ORDER BY created_at DESC LIMIT $2", [buyerId, limit])).rows;
  return rows.map(offerOut).map((o) => ({ ...o, liveState: offerState(o, now) })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

/** The offers on a seller's listings, newest first, with the live state. */
export async function listOffersForSeller(sellerAccountId, { listingId = null, limit = 100, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  const seller = String(sellerAccountId).toLowerCase();
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => String(r.seller_account_id).toLowerCase() === seller && (!listingId || r.listing_id === listingId));
  else rows = (await p.query("SELECT * FROM listing_offers WHERE seller_account_id=$1 AND ($2::uuid IS NULL OR listing_id=$2) ORDER BY created_at DESC LIMIT $3", [seller, listingId, limit])).rows;
  return rows.map(offerOut).map((o) => ({ ...o, liveState: offerState(o, now) })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

/** The accepted price a buyer holds on a listing right now, or null (8.7). */
export async function acceptedOfferFor({ buyerId, listingId, variantId = null, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  const id = uuid(listingId, "listing id");
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => r.buyer_id === buyerId && r.listing_id === id && r.state === "accepted");
  else rows = (await p.query("SELECT * FROM listing_offers WHERE buyer_id=$1 AND listing_id=$2 AND state='accepted' ORDER BY accepted_until DESC", [buyerId, id])).rows;
  for (const r of rows) {
    const o = offerOut(r);
    if (variantId && o.variantId && o.variantId !== String(variantId).toLowerCase()) continue;
    const price = acceptedPriceFor(o, buyerId, now);
    if (price != null) return { offer: o, priceCents: price };
  }
  return null;
}

/** A sale invalidates every open and accepted offer on the listing; the buyers are told why (7.22). */
export async function invalidateOffersOnSale(listingId, { now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return 0;
  const id = uuid(listingId, "listing id");
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => r.listing_id === id && (r.state === "open" || r.state === "accepted"));
  else rows = (await p.query("SELECT * FROM listing_offers WHERE listing_id=$1 AND state IN ('open','accepted')", [id])).rows;
  let n = 0;
  for (const r of rows) {
    const o = offerOut(r);
    const next = invalidateOnSale(o, now);
    if (next.state !== "invalidated") continue;
    const saved = await saveOffer(next);
    await notify(saved.buyerId, "offer-invalidated", saved, { note: next.note });
    n++;
  }
  return n;
}

/** Lazy expiry for open and accepted offers whose windows passed. */
export async function expireOffers(now = Date.now()) {
  const p = await getPool();
  if (!(await applied(p))) return 0;
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => r.state === "open" || r.state === "accepted");
  else rows = (await p.query("SELECT * FROM listing_offers WHERE (state='open' AND expires_at <= $1) OR (state='accepted' AND accepted_until <= $1)", [new Date(now).toISOString()])).rows;
  let n = 0;
  for (const r of rows) {
    const o = offerOut(r);
    if (offerState(o, now) !== "expired") continue;
    await saveOffer({ ...o, state: "expired" });
    n++;
  }
  return n;
}

/**
 * THE REMINDERS (7.20, the Policies' presets; slice 11): for every open offer,
 * each reminder moment of the seller's preset that has passed and was not sent
 * is sent now — one notification per moment, recorded on the offer so the job
 * never repeats itself. Returns how many were sent.
 */
export async function sweepOfferReminders(now = Date.now()) {
  const p = await getPool();
  if (!(await applied(p))) return 0;
  const v70 = p ? await hasColumns(p, "listing_offers", ["reminders_sent"]) : true;
  if (!v70) return 0;
  let rows;
  if (!p) rows = [...mem.listingOffers.values()].filter((r) => r.state === "open");
  else rows = (await p.query("SELECT * FROM listing_offers WHERE state='open' AND expires_at > $1", [new Date(now).toISOString()])).rows;
  let n = 0;
  for (const r of rows) {
    const o = offerOut(r);
    if (offerState(o, now) !== "open") continue;
    const settings = await getOfferSettings(o.storefrontId).catch(() => ({}));
    const moments = reminderTimes(o.expiresAt, settings && settings.reminders ? settings.reminders : undefined, 0);
    const due = moments.filter((t) => Date.parse(t) <= now && !(o.remindersSent || []).includes(t));
    if (!due.length) continue;
    const who = o.by === "buyer" ? "sb-" + o.sellerAccountId : o.buyerId;
    // one notice per moment (7.20): the ledger dedupes on (user, kind, subject), so the subject carries the moment
    for (const t of due) await enqueueNotification({ userId: who, kind: "offer-expiring", subjectId: `${o.id}@${t}`, payload: { offerId: o.id, listingId: o.listingId, expiresAt: o.expiresAt, moment: t } }).catch(() => null);
    const next = { ...o, remindersSent: [...(o.remindersSent || []), ...due] };
    if (!p) mem.listingOffers.set(o.id, offerRow(next));
    else await p.query("UPDATE listing_offers SET reminders_sent=$2 WHERE id=$1", [o.id, JSON.stringify(next.remindersSent)]);
    n += due.length;
  }
  return n;
}

// ---- the availability queue -------------------------------------------------------------

export async function joinQueue({ userId, listingId, now = Date.now() } = {}) {
  if (!userId) throw new CommerceRefused("AUTH_REQUIRED", "authentication required", 401);
  const id = uuid(listingId, "listing id");
  const auth = await listingAuthority(id);
  if (!auth) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const row = { listing_id: id, user_id: userId, joined_at: new Date(now).toISOString(), state: "waiting", notified_at: null };
  if (!p) {
    const key = `${id}|${userId}`;
    const existing = mem.availabilityQueue.get(key);
    if (existing && existing.state !== "closed") return { member: queueOut(existing), joined: false };
    mem.availabilityQueue.set(key, row);
    return { member: queueOut(row), joined: true };
  }
  const { rows } = await p.query(
    `INSERT INTO availability_queue (listing_id, user_id, joined_at, state) VALUES ($1,$2,$3,'waiting')
     ON CONFLICT (listing_id, user_id) DO UPDATE SET joined_at = CASE WHEN availability_queue.state='closed' THEN EXCLUDED.joined_at ELSE availability_queue.joined_at END,
       state = CASE WHEN availability_queue.state='closed' THEN 'waiting' ELSE availability_queue.state END
     RETURNING *, (xmax = 0) AS inserted`, [id, userId, row.joined_at]);
  return { member: queueOut(rows[0]), joined: !!rows[0].inserted || rows[0].joined_at.toISOString?.() === row.joined_at };
}

export async function leaveQueue({ userId, listingId } = {}) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!(await applied(p))) return { left: false };
  if (!p) return { left: mem.availabilityQueue.delete(`${id}|${userId}`) };
  const r = await p.query("DELETE FROM availability_queue WHERE listing_id=$1 AND user_id=$2", [id, userId]);
  return { left: r.rowCount > 0 };
}

export async function queueMembers(listingId) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.availabilityQueue.values()].filter((r) => r.listing_id === id);
  else rows = (await p.query("SELECT * FROM availability_queue WHERE listing_id=$1", [id])).rows;
  return queueOrder(rows.map(queueOut));
}

export async function queuePosition({ userId, listingId } = {}) {
  const members = (await queueMembers(listingId)).filter((m) => m.state !== "closed");
  const i = members.findIndex((m) => m.userId === userId);
  return { waiting: members.length, position: i >= 0 ? i + 1 : null };
}

/**
 * The queue reacts to a listing event: "released" (a checkout let go — a
 * courtesy, first come first served), "sold" (everyone told, queue closed),
 * "returned" (reopened, everyone told). Returns how many were notified.
 */
export async function notifyQueue(listingId, event, { now = Date.now(), title = null } = {}) {
  const id = uuid(listingId, "listing id");
  const members = await queueMembers(id);
  const plan = queueEvent(event, members);
  if (!plan.kind) return { notified: 0 };
  let notified = 0;
  for (const userId of plan.notify) {
    const r = await enqueueNotification({ userId, kind: plan.kind, subjectId: `${id}:${event}:${Math.floor(now / 60_000)}`, payload: { listingId: id, itemId: `native-${id}`, event, title } }).catch(() => ({ queued: false }));
    if (r.queued) notified++;
  }
  const p = await getPool();
  const state = plan.close ? "closed" : plan.reopen ? "waiting" : "notified";
  if (!p) { for (const m of members) { const row = mem.availabilityQueue.get(`${id}|${m.userId}`); if (row) { row.state = state; row.notified_at = new Date(now).toISOString(); } } }
  else await p.query("UPDATE availability_queue SET state=$2, notified_at=$3 WHERE listing_id=$1", [id, state, new Date(now).toISOString()]);
  return { notified, kind: plan.kind, closed: !!plan.close };
}

// ---- relisting -----------------------------------------------------------------------------

/**
 * A confirmed relist: the plan from the law, then the listing's condition,
 * photographs, price and units through the storefront store (one write
 * path), discounts cancelled (8.12), the relist recorded, the queue told
 * the item is back (7.13).
 */
export async function relistListing(ownerAccountId, listingId, input = {}, { now = Date.now() } = {}) {
  const auth = await listingAuthority(listingId);
  if (!auth || !auth.store || String(auth.store.owner_account_id).toLowerCase() !== String(ownerAccountId).toLowerCase()) throw new CommerceRefused("LISTING_NOT_FOUND", "listing not found", 404);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const variant = defaultVariant(auth.variants);
  const plan = relistPlan({
    listing: { condition: auth.listing.condition, photos: auth.listing.photos || [], priceCents: variant ? Number(variant.price_cents) : null },
    confirm: input.confirm === true, conditionConfirmed: input.conditionConfirmed === true, conditionChanged: input.conditionChanged === true,
    condition: input.condition, photos: input.photos, priceCents: input.priceCents, quantity: input.quantity ?? 1,
  });
  if (!plan.ok) throw new CommerceRefused("RELIST_INCOMPLETE", plan.reasons.join("; "), 400);
  await cancelDiscount(ownerAccountId, auth.listing.id, { now }).catch(() => {});
  const { updateStorefrontListing } = await import("./storefronts.js");
  // the storefront store owns publication: a relist restores units, price,
  // condition and photographs; whether the listing is live again is its
  // moderation and payment readiness, never asserted here
  const updated = await updateStorefrontListing(ownerAccountId, auth.listing.id, {
    version: Number(auth.listing.version), condition: plan.plan.condition, photos: plan.plan.photos,
    priceCents: plan.plan.priceCents, inventory: plan.plan.quantity,
  });
  await recordPrice({ listingId: String(auth.listing.id), variantId: variant ? String(variant.id) : null, priceCents: plan.plan.priceCents, reason: "relisted", actor: String(ownerAccountId), now });
  const record = { listing_id: String(auth.listing.id), from_version: Number(auth.listing.version), condition: plan.plan.condition, condition_changed: input.conditionChanged === true, photos: plan.plan.photos, price_cents: plan.plan.priceCents, quantity: plan.plan.quantity, confirmed_by: String(ownerAccountId), at: new Date(now).toISOString() };
  if (!p) mem.listingRelists.push(record);
  else await p.query("INSERT INTO listing_relists (listing_id, from_version, condition, condition_changed, photos, price_cents, quantity, confirmed_by, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [record.listing_id, record.from_version, record.condition, record.condition_changed, JSON.stringify(record.photos), record.price_cents, record.quantity, record.confirmed_by, record.at]);
  const queue = await notifyQueue(auth.listing.id, "returned", { now, title: auth.listing.title });
  return { relisted: true, listing: updated?.listing || updated || null, plan: plan.plan, queue };
}

export async function listRelists(listingId) {
  const id = uuid(listingId, "listing id");
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return mem.listingRelists.filter((r) => r.listing_id === id).map((r) => ({ ...r }));
  const { rows } = await p.query("SELECT * FROM listing_relists WHERE listing_id=$1 ORDER BY at DESC", [id]);
  return rows.map((r) => ({ listing_id: String(r.listing_id), from_version: Number(r.from_version), condition: r.condition, condition_changed: !!r.condition_changed, photos: json(r.photos) || [], price_cents: Number(r.price_cents), quantity: Number(r.quantity), confirmed_by: r.confirmed_by, at: iso(r.at) }));
}

/** Test seam. */
export function resetMemoryCommerce() { mem.listingOffers.clear(); mem.listingDiscounts.clear(); mem.priceHistory.length = 0; mem.availabilityQueue.clear(); mem.listingRelists.length = 0; }
void MODES; void withOrderedUserLocks;
