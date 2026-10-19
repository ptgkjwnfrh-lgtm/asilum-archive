// lib/db/production/money.js — MONEY IN MOTION (V.2 10.12–10.13 payouts, 6.7
// deductions, 5.32 / 10.5 Credit top-ups, chapter 13 Wardrobe private sales,
// 7.20 offer reminders; slice 11; schema v70). SERVER-ONLY; memory mode
// mirrors Postgres. The laws are lib/storefront/payouts.js and
// lib/wardrobe/offers.js — this keeps:
//
//   payouts     one row per paid order with a seller, recomputed from the
//               delivery and the window on read; released once, by a human
//               or the job, through the provider when it is keyed
//   top-ups     what ASILUM owes a seller for a buyer's Credit share
//   offers      DM-first Wardrobe offers, the exclusive checkout as a
//               platform order (one checkout session), ownership moved on
//               carrier-confirmed delivery exactly once
//
// Nothing here moves money without a configured provider: a release or a
// settlement without a key is recorded `pending` with that reason, never as
// done.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { createOrderWithEvent, attachOrderSession, applyOrderEvent, getOrder, listRecentOrders } from "../orders.js";
import { enqueueNotification } from "./listingStatus.js";
import { orderParties, getDelivery, returnsFor } from "./aftersale.js";
import { createCheckoutSession, createTransfer, createConnectedPayout, stripeConfigured, StripeApiError } from "../../payments/stripe.js";
import { SITE_ORIGIN } from "../../site.js";
import { passengerFeeCents } from "../../orders.js";
import { payoutFor, canRelease, topUpFor, deductLabel } from "../../storefront/payouts.js";
import { offerAllowed, newOffer, respond, offerStateAt, exclusiveFor, afterNegotiation, cancelOnDisable, sellerCancellation, transferOnDelivery, ACTIVE_STATES } from "../../wardrobe/offers.js";

export class MoneyRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "MoneyRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "seller_payouts") : true);
const needs = () => { throw new MoneyRefused("SCHEMA_V70_REQUIRED", "payouts and Wardrobe offers need schema v70 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();
if (!mem.sellerPayouts) { mem.sellerPayouts = new Map(); mem.platformTopups = []; mem.topupSeq = 1; mem.wardrobeOffers = new Map(); }

// ---- payouts ------------------------------------------------------------------------------

const payoutOut = (r) => ({ orderId: r.order_id, sellerId: r.seller_id, rail: r.rail, amountCents: Number(r.amount_cents), deductionCents: Number(r.deduction_cents || 0), deductions: json(r.deductions) || [], state: r.state, releasableAt: iso(r.releasable_at), releasedAt: iso(r.released_at), releasedBy: r.released_by || null, provider: r.provider || null, providerRef: r.provider_ref || null, netCents: Math.max(0, Number(r.amount_cents) - Number(r.deduction_cents || 0)) });

async function savePayout(o, now = Date.now()) {
  const p = await getPool();
  const row = { order_id: o.orderId, seller_id: o.sellerId, rail: o.rail, amount_cents: o.amountCents, deduction_cents: o.deductionCents || 0, deductions: o.deductions || [], state: o.state, releasable_at: o.releasableAt, released_at: o.releasedAt || null, released_by: o.releasedBy || null, provider: o.provider || null, provider_ref: o.providerRef || null, updated_at: new Date(now).toISOString() };
  if (!p) { const prev = mem.sellerPayouts.get(row.order_id); mem.sellerPayouts.set(row.order_id, { created_at: prev ? prev.created_at : row.updated_at, ...row }); return payoutOut(row); }
  await p.query(
    `INSERT INTO seller_payouts (order_id, seller_id, rail, amount_cents, deduction_cents, deductions, state, releasable_at, released_at, released_by, provider, provider_ref, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (order_id) DO UPDATE SET amount_cents=EXCLUDED.amount_cents, deduction_cents=EXCLUDED.deduction_cents, deductions=EXCLUDED.deductions, state=EXCLUDED.state, releasable_at=EXCLUDED.releasable_at, released_at=EXCLUDED.released_at, released_by=EXCLUDED.released_by, provider=EXCLUDED.provider, provider_ref=EXCLUDED.provider_ref, updated_at=EXCLUDED.updated_at`,
    [row.order_id, row.seller_id, row.rail, row.amount_cents, row.deduction_cents, JSON.stringify(row.deductions), row.state, row.releasable_at, row.released_at, row.released_by, row.provider, row.provider_ref, row.updated_at]);
  return payoutOut(row);
}

export async function getPayout(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.sellerPayouts.get(orderId); return r ? payoutOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM seller_payouts WHERE order_id=$1", [orderId]);
  return rows[0] ? payoutOut(rows[0]) : null;
}

/** Who is paid for an order: the storefront owner on the native rail; the Wardrobe owner on a private sale (the order carries `wardrobe_owner_id` in its kind payload). */
async function sellerFor(order) {
  if (!order) return null;
  if (order.commerce_rail === "native_storefront") { const parties = await orderParties(order.id); return parties && parties.sellerAccountId ? { sellerId: "sb-" + parties.sellerAccountId, rail: "native_storefront", merchandiseCents: Number(order.merchandise_cents || order.amount_cents || 0) } : null; }
  const offer = [...(await listWardrobeOffers({ orderId: order.id }))][0];
  if (offer) return { sellerId: offer.ownerId, rail: "wardrobe", merchandiseCents: offer.amountCents };
  return null;
}

/**
 * Recompute one order's payout from its facts (10.12–10.13): the delivery
 * opens the window; an open return, refund or dispute holds it; refunded
 * voids it. A released payout is a fact and is not recomputed.
 */
export async function refreshPayout(orderId, { now = Date.now() } = {}) {
  const order = await getOrder(orderId);
  if (!order || !["paid", "refunded"].includes(order.status)) return null;
  const who = await sellerFor(order);
  if (!who) return null;
  const existing = await getPayout(orderId);
  if (existing && existing.state === "released") return existing;
  const delivery = await getDelivery(orderId);
  const returns = await returnsFor(orderId);
  const openIssues = returns.filter((r) => ["open", "approved"].includes(r.state)).length;
  const law = payoutFor({ order: { merchandise_cents: who.merchandiseCents }, rail: who.rail, deliveredAt: delivery ? delivery.deliveredAt : null, openIssues, refunded: order.status === "refunded", deductions: existing ? existing.deductions : [], now });
  return savePayout({ orderId, sellerId: who.sellerId, rail: who.rail, amountCents: law.amountCents, deductionCents: law.deductionCents, deductions: law.deductions, state: law.state, releasableAt: law.releasableAt }, now);
}

export async function listPayouts({ sellerId = null, state = null, limit = 200 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.sellerPayouts.values()].filter((r) => (!sellerId || r.seller_id === sellerId) && (!state || r.state === state)).slice(-limit);
  else rows = (await p.query("SELECT * FROM seller_payouts WHERE ($1::text IS NULL OR seller_id=$1) AND ($2::text IS NULL OR state=$2) ORDER BY updated_at DESC LIMIT $3", [sellerId, state, limit])).rows;
  return rows.map(payoutOut);
}

/** Every paid order with a seller gets its payout recomputed (the job). */
export async function sweepPayouts({ now = Date.now(), limit = 200 } = {}) {
  const orders = await listRecentOrders(limit);
  let n = 0;
  for (const o of orders) if (await refreshPayout(o.id, { now }).catch(() => null)) n++;
  return n;
}

/** A covered return label is deducted from the next payout (6.7). */
export async function deductFromPayout({ orderId, returnId, amountCents, now = Date.now() } = {}) {
  const cur = (await refreshPayout(orderId, { now })) || (await getPayout(orderId));
  if (!cur) throw new MoneyRefused("NO_PAYOUT", "no payout for that order", 404);
  if (cur.state === "released") throw new MoneyRefused("RELEASED", "the payout is released — the deduction waits for the seller's next one", 409);
  const next = deductLabel(cur, { returnId, amountCents });
  return savePayout(next, now);
}

/**
 * Release a releasable payout once. Native rail: a connected payout of the
 * net on the seller's account (their funds already); Wardrobe rail: a
 * transfer from the platform. Without a key the release is recorded
 * `pending` with the reason — never done.
 */
export async function releasePayout({ orderId, by = "admin", now = Date.now() } = {}) {
  const cur = (await refreshPayout(orderId, { now })) || (await getPayout(orderId));
  if (!cur) throw new MoneyRefused("NO_PAYOUT", "no payout for that order", 404);
  const ok = canRelease(cur);
  if (!ok.ok) throw new MoneyRefused("NOT_RELEASABLE", ok.reason, 409);
  let provider = "pending", providerRef = null, note = "the payment provider is not keyed — recorded, not moved";
  if (stripeConfigured()) {
    try {
      const order = await getOrder(orderId);
      if (cur.rail === "native_storefront") {
        const parties = await orderParties(orderId);
        const acct = parties && parties.storefrontId ? await connectedAccountFor(parties.storefrontId) : null;
        if (!acct) throw new MoneyRefused("NO_ACCOUNT", "the seller has no connected account", 409);
        const r = await createConnectedPayout(acct, { amountCents: cur.netCents, metadata: { order_id: orderId }, idempotencyKey: `payout-${orderId}` });
        provider = "stripe-payout"; providerRef = r.id; note = null;
      } else {
        const acct = await connectedAccountForUser(cur.sellerId);
        if (!acct) throw new MoneyRefused("NO_ACCOUNT", "the owner has no connected account to receive a transfer — the Storefront's payment onboarding is the way", 409);
        const r = await createTransfer({ amountCents: cur.netCents, destination: acct, metadata: { order_id: orderId, rail: "wardrobe" }, idempotencyKey: `transfer-${orderId}` });
        provider = "stripe-transfer"; providerRef = r.id; note = null;
      }
      void order;
    } catch (err) {
      if (err instanceof MoneyRefused) throw err;
      throw new MoneyRefused("PROVIDER_REFUSED", err instanceof StripeApiError ? err.message : "the provider refused the release", 502);
    }
  }
  const released = await savePayout({ ...cur, state: "released", releasedAt: new Date(now).toISOString(), releasedBy: String(by), provider, providerRef }, now);
  await enqueueNotification({ userId: cur.sellerId, kind: "credit", subjectId: `payout:${orderId}`, payload: { payout: true, orderId, netCents: cur.netCents, provider, note } }).catch(() => null);
  return { payout: released, note };
}

async function connectedAccountFor(storefrontId) {
  const p = await getPool();
  if (!p) { const row = mem.storefrontPaymentAccounts.get(String(storefrontId)); return row ? row.stripe_account_id || null : null; }
  const { rows } = await p.query("SELECT stripe_account_id FROM storefront_payment_accounts WHERE storefront_id=$1", [storefrontId]);
  return rows[0] ? rows[0].stripe_account_id || null : null;
}
async function connectedAccountForUser(userId) {
  const acct = String(userId || "").startsWith("sb-") ? userId.slice(3) : null;
  if (!acct) return null;
  const p = await getPool();
  if (!p) { const sfId = mem.storefrontOwners.get(acct); return sfId ? connectedAccountFor(sfId) : null; }
  const { rows } = await p.query("SELECT pa.stripe_account_id FROM storefronts s JOIN storefront_payment_accounts pa ON pa.storefront_id=s.id WHERE s.owner_account_id=$1", [acct]);
  return rows[0] ? rows[0].stripe_account_id || null : null;
}

// ---- the platform's top-ups (5.32) ----------------------------------------------------------

const topupOut = (r) => ({ id: String(r.id), orderId: r.order_id, sellerAccountId: r.seller_account_id || null, amountCents: Number(r.amount_cents), state: r.state, providerRef: r.provider_ref || null, createdAt: iso(r.created_at), settledAt: iso(r.settled_at) });

export async function recordTopUp({ orderId, sellerAccountId = null, creditCents, merchandiseCents, now = Date.now() } = {}) {
  const t = topUpFor({ creditCents, merchandiseCents });
  if (!t) return null;
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) { const row = { id: mem.topupSeq++, order_id: orderId, seller_account_id: sellerAccountId, amount_cents: t.amountCents, state: "pending", provider_ref: null, created_at: new Date(now).toISOString(), settled_at: null }; mem.platformTopups.push(row); return topupOut(row); }
  const { rows } = await p.query("INSERT INTO platform_topups (order_id, seller_account_id, amount_cents, created_at) VALUES ($1,$2,$3,$4) RETURNING *", [orderId, sellerAccountId, t.amountCents, new Date(now).toISOString()]);
  return topupOut(rows[0]);
}

export async function listTopUps({ state = null, limit = 200 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  const rows = !p ? mem.platformTopups.filter((r) => !state || r.state === state).slice(-limit) : (await p.query("SELECT * FROM platform_topups WHERE ($1::text IS NULL OR state=$1) ORDER BY created_at DESC LIMIT $2", [state, limit])).rows;
  return rows.map(topupOut);
}

/** Settle a pending top-up through the provider (a transfer to the seller's connected account); without a key it stays pending with the reason. */
export async function settleTopUp({ id, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const row = !p ? mem.platformTopups.find((r) => String(r.id) === String(id)) : (await p.query("SELECT * FROM platform_topups WHERE id=$1", [id])).rows[0];
  if (!row) throw new MoneyRefused("NOT_FOUND", "top-up not found", 404);
  if (row.state !== "pending") throw new MoneyRefused("SETTLED", `the top-up is ${row.state}`, 409);
  if (!stripeConfigured()) return { topup: topupOut(row), note: "the payment provider is not keyed — the top-up stays pending" };
  const acct = row.seller_account_id ? await connectedAccountForUser("sb-" + row.seller_account_id) : null;
  if (!acct) throw new MoneyRefused("NO_ACCOUNT", "the seller has no connected account", 409);
  let ref;
  try { ref = (await createTransfer({ amountCents: Number(row.amount_cents), destination: acct, metadata: { order_id: row.order_id, topup: String(row.id) }, idempotencyKey: `topup-${row.id}` })).id; }
  catch (err) { throw new MoneyRefused("PROVIDER_REFUSED", err instanceof StripeApiError ? err.message : "the provider refused the transfer", 502); }
  const at = new Date(now).toISOString();
  if (!p) { row.state = "transferred"; row.provider_ref = ref; row.settled_at = at; return { topup: topupOut(row), note: null }; }
  const { rows } = await p.query("UPDATE platform_topups SET state='transferred', provider_ref=$2, settled_at=$3 WHERE id=$1 RETURNING *", [id, ref, at]);
  return { topup: topupOut(rows[0]), note: null };
}

// ---- Wardrobe private sales (chapter 13) -------------------------------------------------------

const offerOut = (r) => ({ id: String(r.id), itemId: String(r.item_id), ownerId: r.owner_id, buyerId: r.buyer_id, conversationId: r.conversation_id || null, amountCents: Number(r.amount_cents), state: r.state, expiresAt: iso(r.expires_at), acceptedUntil: iso(r.accepted_until), orderId: r.order_id || null, respondedAt: iso(r.responded_at), createdAt: iso(r.created_at) });
const offerRow = (o) => ({ id: o.id, item_id: o.itemId, owner_id: o.ownerId, buyer_id: o.buyerId, conversation_id: o.conversationId, amount_cents: o.amountCents, state: o.state, expires_at: o.expiresAt, accepted_until: o.acceptedUntil, order_id: o.orderId, responded_at: o.respondedAt, created_at: o.createdAt });

async function saveOffer(o) {
  const p = await getPool();
  const row = offerRow(o);
  if (!p) { mem.wardrobeOffers.set(row.id, row); return offerOut(row); }
  await p.query(
    `INSERT INTO wardrobe_offers (id, item_id, owner_id, buyer_id, conversation_id, amount_cents, state, expires_at, accepted_until, order_id, responded_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, accepted_until=EXCLUDED.accepted_until, order_id=EXCLUDED.order_id, responded_at=EXCLUDED.responded_at`,
    [row.id, row.item_id, row.owner_id, row.buyer_id, row.conversation_id, row.amount_cents, row.state, row.expires_at, row.accepted_until, row.order_id, row.responded_at, row.created_at]);
  return offerOut(row);
}

/** A Wardrobe piece as the law reads it: the owner, the status, the two toggles, the cooldown. */
export async function wardrobePiece(itemId) {
  const p = await getPool();
  if (!p) { const w = mem.wardrobe.find((x) => String(x.id) === String(itemId)); return w ? { id: String(w.id), ownerId: w.user_id, status: w.status, title: w.title || w.name || "a piece", acceptOffers: !!w.accept_offers, offerCooldownUntil: w.offer_cooldown_until || null, hiddenUntilPaid: !!w.hidden_until_paid } : null; }
  if (!(await applied(p))) return null;
  const { rows } = await p.query("SELECT id, user_id, status, title, accept_offers, offer_cooldown_until FROM wardrobe_items WHERE id=$1", [itemId]);
  const w = rows[0];
  return w ? { id: String(w.id), ownerId: w.user_id, status: w.status, title: w.title || "a piece", acceptOffers: !!w.accept_offers, offerCooldownUntil: iso(w.offer_cooldown_until) } : null;
}

async function setPiece(itemId, patch) {
  const p = await getPool();
  if (!p) { const w = mem.wardrobe.find((x) => String(x.id) === String(itemId)); if (!w) return; if ("acceptOffers" in patch) w.accept_offers = !!patch.acceptOffers; if ("offerCooldownUntil" in patch) w.offer_cooldown_until = patch.offerCooldownUntil; if ("hiddenUntilPaid" in patch) w.hidden_until_paid = !!patch.hiddenUntilPaid; return; }
  if ("acceptOffers" in patch) await p.query("UPDATE wardrobe_items SET accept_offers=$2, updated_at=now() WHERE id=$1", [itemId, !!patch.acceptOffers]);
  if ("offerCooldownUntil" in patch) await p.query("UPDATE wardrobe_items SET offer_cooldown_until=$2, updated_at=now() WHERE id=$1", [itemId, patch.offerCooldownUntil]);
}

export async function listWardrobeOffers({ itemId = null, buyerId = null, ownerId = null, orderId = null, limit = 100 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.wardrobeOffers.values()].filter((r) => (itemId == null || String(r.item_id) === String(itemId)) && (!buyerId || r.buyer_id === buyerId) && (!ownerId || r.owner_id === ownerId) && (!orderId || r.order_id === orderId)).slice(-limit).reverse();
  else rows = (await p.query("SELECT * FROM wardrobe_offers WHERE ($1::text IS NULL OR item_id=$1::bigint) AND ($2::text IS NULL OR buyer_id=$2) AND ($3::text IS NULL OR owner_id=$3) AND ($4::text IS NULL OR order_id=$4) ORDER BY created_at DESC LIMIT $5", [itemId == null ? null : String(itemId), buyerId, ownerId, orderId, limit])).rows;
  return rows.map(offerOut);
}

/** The owner's toggle (13.3, 13.12–13.13): off cancels every active unpaid negotiation; on does not bypass a cooldown. */
export async function setAcceptOffers({ ownerId, itemId, on, now = Date.now() } = {}) {
  const piece = await wardrobePiece(itemId);
  if (!piece || piece.ownerId !== ownerId) throw new MoneyRefused("NOT_YOURS", "not your piece", 403);
  const p = await getPool();
  if (!(await applied(p))) needs();
  await setPiece(itemId, { acceptOffers: !!on });
  let cancelled = [];
  if (!on) {
    const active = cancelOnDisable(await listWardrobeOffers({ itemId }), now);
    for (const o of active) { cancelled.push(await saveOffer(o)); await enqueueNotification({ userId: o.buyerId, kind: "offer-invalidated", subjectId: o.id, payload: { wardrobe: true, itemId, reason: "the owner turned Wardrobe offers off" } }).catch(() => null); }
    await setPiece(itemId, { hiddenUntilPaid: false });
  }
  return { piece: await wardrobePiece(itemId), cancelled };
}

/** A buyer's offer, DM first (13.4): the route verified the conversation; the store takes `viaMessage` from it alone. */
export async function openWardrobeOffer({ itemId, buyerId, amountCents, conversationId = null, viaMessage = false, now = Date.now() } = {}) {
  const piece = await wardrobePiece(itemId);
  const active = await listWardrobeOffers({ itemId });
  const ok = offerAllowed({ item: piece, buyerId, active, viaMessage, now });
  if (!ok.ok) throw new MoneyRefused(ok.private ? "RESTING" : "OFFER_REFUSED", ok.reason, 409);
  const made = newOffer({ itemId, ownerId: piece.ownerId, buyerId, amountCents, conversationId, now });
  if (!made.ok) throw new MoneyRefused("INVALID_OFFER", made.reason, 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const saved = await saveOffer({ ...made.offer, id: newId() });
  await enqueueNotification({ userId: piece.ownerId, kind: "offer-new", subjectId: saved.id, payload: { wardrobe: true, itemId, amountCents: saved.amountCents, from: buyerId } }).catch(() => null);
  return saved;
}

/** The owner answers (13.6, 13.11). */
export async function respondWardrobeOffer({ offerId, ownerId, decision, now = Date.now() } = {}) {
  const cur = (await listWardrobeOffers({ limit: 10000 })).find((o) => o.id === String(offerId));
  if (!cur) throw new MoneyRefused("NOT_FOUND", "offer not found", 404);
  if (cur.ownerId !== ownerId) throw new MoneyRefused("NOT_YOURS", "only the owner answers", 403);
  const r = respond(cur, decision, now);
  if (!r.ok) throw new MoneyRefused("OFFER_CLOSED", r.reason, 409);
  const saved = await saveOffer(r.offer);
  await setPiece(cur.itemId, { offerCooldownUntil: r.cooldownUntil, hiddenUntilPaid: r.hideFromSearch });
  await enqueueNotification({ userId: cur.buyerId, kind: decision === "accept" ? "offer-accepted" : "offer-declined", subjectId: saved.id, payload: { wardrobe: true, itemId: cur.itemId, amountCents: cur.amountCents, acceptedUntil: saved.acceptedUntil } }).catch(() => null);
  return saved;
}

/** The job: unanswered offers expire; accepted-but-unpaid lapse; both start the cooldown (13.9, 13.11). */
export async function sweepWardrobeOffers(now = Date.now()) {
  const all = await listWardrobeOffers({ limit: 10000 });
  let n = 0;
  for (const o of all) {
    const s = offerStateAt(o, now);
    if (s === o.state || !["expired", "lapsed"].includes(s)) continue;
    await saveOffer({ ...o, state: s, respondedAt: new Date(now).toISOString() });
    const after = afterNegotiation(s, now);
    await setPiece(o.itemId, { offerCooldownUntil: after.cooldownUntil, hiddenUntilPaid: after.hideFromSearch });
    n++;
  }
  return n;
}

/**
 * The exclusive checkout (13.6, 13.17): the eligible buyer, inside the 24
 * hours, pays the accepted price plus the passenger fee on the platform —
 * one order of kind `sale` on the wardrobe rail, one checkout session; the
 * owner's payout follows the delivery and the window. Unkeyed: 503, nothing
 * reserved.
 */
export async function startWardrobeCheckout({ offerId, buyerId, origin = null, now = Date.now() } = {}) {
  const offer = (await listWardrobeOffers({ buyerId, limit: 1000 })).find((o) => o.id === String(offerId));
  if (!offer) throw new MoneyRefused("NOT_FOUND", "offer not found", 404);
  if (!exclusiveFor(offer, buyerId, now)) throw new MoneyRefused("NOT_EXCLUSIVE", `the exclusive checkout is not open — the offer is ${offerStateAt(offer, now)}`, 409);
  if (offer.orderId) { const o = await getOrder(offer.orderId); if (o && o.status === "paid") throw new MoneyRefused("PAID", "this sale is paid", 409); }
  if (!stripeConfigured()) throw new MoneyRefused("PAYMENT_IDLE", "checkout is idle — no payment provider is configured", 503);
  const piece = await wardrobePiece(offer.itemId);
  const fee = passengerFeeCents(offer.amountCents);
  const order = await createOrderWithEvent({ user: buyerId, itemId: `wardrobe-${offer.itemId}`, amountCents: offer.amountCents, feeCents: fee, currency: "usd", kind: "sale" });
  let session;
  try {
    session = await createCheckoutSession({ orderId: order.id, itemId: `wardrobe-${offer.itemId}`, title: `${piece ? piece.title : "a Wardrobe piece"} · private sale`, amountCents: offer.amountCents, feeCents: fee, currency: "usd", origin: origin || SITE_ORIGIN, user: buyerId });
    await attachOrderSession(order.id, session.id);
  } catch (err) { throw new MoneyRefused("PAYMENT_FAILED", err instanceof StripeApiError ? err.message : "the payment could not be started", 502); }
  await saveOffer({ ...offer, orderId: order.id });
  return { orderId: order.id, url: session.url, amountCents: offer.amountCents, feeCents: fee, buyerTotalCents: offer.amountCents + fee };
}

/** The sale settled (the order engine's webhook or reconcile says paid): the offer is paid, the piece stays hidden until delivery. */
export async function settleWardrobeOrder(orderId, { now = Date.now() } = {}) {
  const offer = (await listWardrobeOffers({ orderId }))[0];
  if (!offer) return { settled: false, reason: "not a Wardrobe sale" };
  const order = await getOrder(orderId);
  if (!order || order.status !== "paid") return { settled: false, reason: order ? `order ${order.status}` : "no order" };
  if (offer.state === "paid") return { settled: true, duplicate: true, offer };
  const saved = await saveOffer({ ...offer, state: "paid", respondedAt: new Date(now).toISOString() });
  await setPiece(offer.itemId, { hiddenUntilPaid: true });
  await refreshPayout(orderId, { now }).catch(() => null);
  await enqueueNotification({ userId: offer.ownerId, kind: "offer-accepted", subjectId: saved.id, payload: { wardrobe: true, paid: true, itemId: offer.itemId, amountCents: offer.amountCents, orderId } }).catch(() => null);
  return { settled: true, offer: saved };
}

/** The seller cancels a paid private sale before handoff (13.14): refund, cooldown, no automatic penalty. The refund itself is the order engine's. */
export async function cancelWardrobeSale({ offerId, ownerId, handedAt = null, now = Date.now() } = {}) {
  const offer = (await listWardrobeOffers({ ownerId, limit: 1000 })).find((o) => o.id === String(offerId));
  if (!offer) throw new MoneyRefused("NOT_FOUND", "offer not found", 404);
  if (offer.state !== "paid") throw new MoneyRefused("NOT_PAID", `the sale is ${offer.state}`, 409);
  const delivery = offer.orderId ? await getDelivery(offer.orderId) : null;
  const law = sellerCancellation({ handedAt, delivered: !!delivery, now });
  if (!law.ok) throw new MoneyRefused("TOO_LATE", law.reason, 409);
  const saved = await saveOffer({ ...offer, state: "cancelled", respondedAt: new Date(now).toISOString() });
  await setPiece(offer.itemId, { offerCooldownUntil: law.cooldownUntil, hiddenUntilPaid: false });
  if (offer.orderId) { const po = await getPayout(offer.orderId); if (po && po.state !== "released") await savePayout({ ...po, state: "void" }, now); }
  await enqueueNotification({ userId: offer.buyerId, kind: "offer-invalidated", subjectId: saved.id, payload: { wardrobe: true, itemId: offer.itemId, reason: "the owner cancelled before handoff — a full refund follows (13.14)", orderId: offer.orderId } }).catch(() => null);
  return { offer: saved, refund: law.refund, penalty: law.penalty, note: law.note };
}

/** Ownership moves on carrier-confirmed delivery, exactly once (13.10): the piece joins the buyer's Wardrobe with its provenance. */
export async function transferOnWardrobeDelivery(orderId, { now = Date.now() } = {}) {
  const offer = (await listWardrobeOffers({ orderId }))[0];
  if (!offer) return { moved: false, reason: "not a Wardrobe sale" };
  const delivery = await getDelivery(orderId);
  const piece = await wardrobePiece(offer.itemId);
  const already = piece && piece.ownerId === offer.buyerId;
  const law = transferOnDelivery({ paid: offer.state === "paid", deliverySource: delivery ? delivery.source : null, alreadyMoved: already });
  if (!law.move) return { moved: false, reason: law.reason };
  const p = await getPool();
  if (!p) {
    const w = mem.wardrobe.find((x) => String(x.id) === String(offer.itemId));
    if (!w) return { moved: false, reason: "the piece is gone — prior ownership stands (13.16)" };
    w.user_id = offer.buyerId; w.provenance = "transferred"; w.transferred_from = offer.ownerId; w.hidden_until_paid = false; w.updated_at = new Date(now).toISOString();
  } else {
    const { rowCount } = await p.query("UPDATE wardrobe_items SET user_id=$2, provenance='transferred', transferred_from=$3, updated_at=now() WHERE id=$1 AND user_id=$3 AND status='active'", [offer.itemId, offer.buyerId, offer.ownerId]);
    if (!rowCount) return { moved: false, reason: "the piece is gone — prior ownership stands (13.16)" };
  }
  await refreshPayout(orderId, { now }).catch(() => null);
  return { moved: true, to: offer.buyerId, itemId: offer.itemId };
}

export function resetMemoryMoney() { mem.sellerPayouts.clear(); mem.platformTopups.length = 0; mem.topupSeq = 1; mem.wardrobeOffers.clear(); }
export { ACTIVE_STATES };
