// lib/db/production/identity.js — IDENTITY ROWS (V.2 6.31–6.34, 12.8–12.9,
// 14.11, Terms 2.2, 10.4; A6 (7); slice 10b; schema v68). SERVER-ONLY;
// memory mode mirrors Postgres. The law is lib/identity/commerce.js — this
// keeps:
//
//   identity   the home town and the consented, erasable ethnicity, keyed on
//              the bare auth uuid (ADR-002); served only to its owner
//   devices    the HMAC of every signed device an account adopted — device
//              authentication for gifts; never the device id itself
//   appeals    a seller's structured appeal against a listing's status with
//              materially new evidence, decided by a human (12.9)
//   notices    the seller's downgrade notice with its explanation (12.8)
//   the reset  deletion resets the Passenger Score: reviews ABOUT the person
//              are excluded, reviews BY them stay anonymized (6.31, 14.6);
//              penalties remain as enforcement records (6.32)

import { createHash } from "node:crypto";
import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { enqueueNotification } from "./listingStatus.js";
import { createModerationTask } from "./moderation.js";
import { normalizeHometown, normalizeEthnicity } from "../../identity/commerce.js";

export class IdentityRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "IdentityRefused"; this.code = code; this.status = status; }
}
const ACCOUNT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanId = (v) => { const s = String(v || "").trim().toLowerCase(); return ACCOUNT_UUID.test(s) ? s : ""; };
const applied = async (p) => (p ? hasRelation(p, "account_identity") : true);
const needs = () => { throw new IdentityRefused("SCHEMA_V68_REQUIRED", "identity records need schema v68 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
if (!mem.accountIdentity) { mem.accountIdentity = new Map(); mem.accountDevices = new Map(); mem.verificationAppeals = new Map(); }

/** The HMAC-free, secret-free fingerprint of a device id: a hash, so the row never holds the id. */
export function deviceHash(deviceId) { return createHash("sha256").update("device:" + String(deviceId || "")).digest("hex"); }

// ---- identity -----------------------------------------------------------------------------

const identityOut = (r) => ({
  accountId: r.account_id,
  hometown: r.hometown ? { name: r.hometown, country: r.hometown_country || null, lat: r.hometown_lat == null ? null : Number(r.hometown_lat), lng: r.hometown_lng == null ? null : Number(r.hometown_lng) } : null,
  ethnicity: r.ethnicity || null, ethnicityConsentedAt: iso(r.ethnicity_consented_at), updatedAt: iso(r.updated_at),
});

export async function getIdentity(accountIdRaw) {
  const id = cleanId(accountIdRaw);
  if (!id) return null;
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.accountIdentity.get(id); return r ? identityOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM account_identity WHERE account_id=$1", [id]);
  return rows[0] ? identityOut(rows[0]) : null;
}

/** Record or correct the home town and the ethnicity (with consent). An undefined field is left alone; null clears it. */
export async function setIdentity(accountIdRaw, { hometown, ethnicity, ethnicityConsent = false, now = Date.now() } = {}) {
  const id = cleanId(accountIdRaw);
  if (!id) throw new IdentityRefused("ACCOUNT_REQUIRED", "identity keys on an account (ADR-002)", 401);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const cur = (await getIdentity(id)) || { hometown: null, ethnicity: null, ethnicityConsentedAt: null };
  let town = cur.hometown;
  if (hometown !== undefined) town = hometown == null ? null : normalizeHometown(hometown);
  let eth = cur.ethnicity, consentedAt = cur.ethnicityConsentedAt;
  if (ethnicity !== undefined) {
    const e = normalizeEthnicity(ethnicity, { consent: ethnicityConsent });
    if (!e.ok) throw new IdentityRefused("CONSENT_REQUIRED", e.reason, 400);
    eth = e.ethnicity; consentedAt = eth ? new Date(now).toISOString() : null;
  }
  const row = { account_id: id, hometown: town ? town.name : null, hometown_country: town ? town.country : null, hometown_lat: town ? town.lat : null, hometown_lng: town ? town.lng : null, ethnicity: eth, ethnicity_consented_at: consentedAt, updated_at: new Date(now).toISOString() };
  if (!p) mem.accountIdentity.set(id, row);
  else await p.query(
    `INSERT INTO account_identity (account_id, hometown, hometown_country, hometown_lat, hometown_lng, ethnicity, ethnicity_consented_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (account_id) DO UPDATE SET hometown=EXCLUDED.hometown, hometown_country=EXCLUDED.hometown_country, hometown_lat=EXCLUDED.hometown_lat, hometown_lng=EXCLUDED.hometown_lng, ethnicity=EXCLUDED.ethnicity, ethnicity_consented_at=EXCLUDED.ethnicity_consented_at, updated_at=EXCLUDED.updated_at`,
    [row.account_id, row.hometown, row.hometown_country, row.hometown_lat, row.hometown_lng, row.ethnicity, row.ethnicity_consented_at, row.updated_at]);
  return identityOut(row);
}

export async function eraseIdentity(accountIdRaw) {
  const id = cleanId(accountIdRaw);
  if (!id) return false;
  const p = await getPool();
  if (!(await applied(p))) return false;
  if (!p) { mem.accountIdentity.delete(id); for (const k of [...mem.accountDevices.keys()]) if (k.startsWith(id + "|")) mem.accountDevices.delete(k); return true; }
  await p.query("DELETE FROM account_identity WHERE account_id=$1", [id]);
  await p.query("DELETE FROM account_devices WHERE account_id=$1", [id]);
  return true;
}

// ---- devices --------------------------------------------------------------------------------

/** The account adopted this signed device (the adoption route calls it). */
export async function recordDevice(accountIdRaw, deviceId, { now = Date.now() } = {}) {
  const id = cleanId(accountIdRaw);
  if (!id || !deviceId) return null;
  const p = await getPool();
  if (!(await applied(p))) return null;
  const h = deviceHash(deviceId);
  const at = new Date(now).toISOString();
  if (!p) { const k = id + "|" + h; const cur = mem.accountDevices.get(k); mem.accountDevices.set(k, { account_id: id, device_hash: h, first_seen: cur ? cur.first_seen : at, last_seen: at }); return { accountId: id, deviceHash: h }; }
  await p.query("INSERT INTO account_devices (account_id, device_hash, first_seen, last_seen) VALUES ($1,$2,$3,$3) ON CONFLICT (account_id, device_hash) DO UPDATE SET last_seen=EXCLUDED.last_seen", [id, h, at]);
  return { accountId: id, deviceHash: h };
}

/** Is this signed device one the account adopted? */
export async function deviceKnown(accountIdRaw, deviceId) {
  const id = cleanId(accountIdRaw);
  if (!id || !deviceId) return false;
  const p = await getPool();
  if (!(await applied(p))) return false;
  const h = deviceHash(deviceId);
  if (!p) return mem.accountDevices.has(id + "|" + h);
  const { rows } = await p.query("SELECT 1 FROM account_devices WHERE account_id=$1 AND device_hash=$2", [id, h]);
  return rows.length > 0;
}

export async function listDevices(accountIdRaw) {
  const id = cleanId(accountIdRaw);
  if (!id) return [];
  const p = await getPool();
  if (!(await applied(p))) return [];
  const rows = !p ? [...mem.accountDevices.values()].filter((r) => r.account_id === id) : (await p.query("SELECT * FROM account_devices WHERE account_id=$1 ORDER BY last_seen DESC", [id])).rows;
  return rows.map((r) => ({ deviceHash: r.device_hash, firstSeen: iso(r.first_seen), lastSeen: iso(r.last_seen) }));
}

// ---- the seller of a native item -------------------------------------------------------------

/** The storefront owner (as "sb-<uuid>") behind a native item id, or null for anything else. */
export async function sellerOfItem(itemId) {
  const id = String(itemId || "");
  if (!id.startsWith("native-")) return null;
  const listingId = id.slice(7);
  const p = await getPool();
  if (!p) {
    const l = mem.nativeListings.get(listingId);
    const s = l && mem.storefronts.get(String(l.storefront_id));
    return s ? "sb-" + String(s.owner_account_id) : null;
  }
  if (!(await hasRelation(p, "native_listings"))) return null;
  const { rows } = await p.query("SELECT s.owner_account_id FROM native_listings l JOIN storefronts s ON s.id=l.storefront_id WHERE l.id=$1", [listingId]);
  return rows[0] ? "sb-" + String(rows[0].owner_account_id) : null;
}

// ---- downgrade notices and appeals (12.8–12.9) ---------------------------------------------------

/** Tell the seller why their listing's status went down (12.8). */
export async function noticeDowngrade({ itemId, from, to, explanation = "" } = {}) {
  const seller = await sellerOfItem(itemId);
  if (!seller) return { notified: false, reason: "not a native listing — no seller to tell" };
  await enqueueNotification({ userId: seller, kind: "verification-downgrade", subjectId: String(itemId), payload: { itemId, from, to, explanation: String(explanation || "").slice(0, 500), appeal: "a structured appeal with materially new evidence is decided by a human (12.9)" } }).catch(() => null);
  return { notified: true, seller };
}

const appealOut = (r) => ({ id: String(r.id), itemId: r.item_id, sellerId: r.seller_id, evidence: r.evidence, state: r.state, decision: r.decision || null, decidedBy: r.decided_by || null, createdAt: iso(r.created_at), decidedAt: iso(r.decided_at) });

/** A seller appeals a listing's status with materially new evidence (12.9). One open appeal per item. */
export async function openAppeal({ itemId, sellerId, evidence, now = Date.now() } = {}) {
  const seller = await sellerOfItem(itemId);
  if (!seller || seller !== sellerId) throw new IdentityRefused("NOT_THE_SELLER", "only the listing's seller appeals its status", 403);
  const text = String(evidence || "").trim();
  if (!text) throw new IdentityRefused("EVIDENCE_REQUIRED", "an appeal carries materially new evidence", 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if ((await listAppeals({ itemId })).some((a) => a.state === "open")) throw new IdentityRefused("APPEAL_OPEN", "an appeal on this listing is already with a human", 409);
  const row = { id: globalThis.crypto.randomUUID(), item_id: String(itemId), seller_id: sellerId, evidence: text.slice(0, 2000), state: "open", decision: null, decided_by: null, created_at: new Date(now).toISOString(), decided_at: null };
  if (!p) mem.verificationAppeals.set(row.id, row);
  else await p.query("INSERT INTO verification_appeals (id, item_id, seller_id, evidence, state, created_at) VALUES ($1,$2,$3,$4,'open',$5)", [row.id, row.item_id, row.seller_id, row.evidence, row.created_at]);
  await createModerationTask({ kind: "verification-appeal", subjectType: "item", subjectId: String(itemId), payload: { appealId: row.id, evidence: row.evidence.slice(0, 300) }, priority: 2 }).catch(() => null);
  return appealOut(row);
}

export async function listAppeals({ itemId = null, sellerId = null, state = null, limit = 100 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.verificationAppeals.values()].filter((r) => (!itemId || r.item_id === String(itemId)) && (!sellerId || r.seller_id === sellerId) && (!state || r.state === state)).slice(-limit).reverse();
  else rows = (await p.query("SELECT * FROM verification_appeals WHERE ($1::text IS NULL OR item_id=$1) AND ($2::text IS NULL OR seller_id=$2) AND ($3::text IS NULL OR state=$3) ORDER BY created_at DESC LIMIT $4", [itemId == null ? null : String(itemId), sellerId, state, limit])).rows;
  return rows.map(appealOut);
}

/** A human decides (12.9): upheld (the status is raised by a human's confirmation) or refused, with the reason the seller reads. */
export async function decideAppeal({ appealId, upheld, decision = "", actor = "admin", now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const r = !p ? mem.verificationAppeals.get(String(appealId)) : (await p.query("SELECT * FROM verification_appeals WHERE id=$1", [String(appealId)])).rows[0];
  if (!r) throw new IdentityRefused("NOT_FOUND", "appeal not found", 404);
  if (r.state !== "open") throw new IdentityRefused("DECIDED", "this appeal is decided", 409);
  const next = { ...r, state: upheld ? "upheld" : "refused", decision: String(decision || "").slice(0, 500), decided_by: String(actor), decided_at: new Date(now).toISOString() };
  if (!p) mem.verificationAppeals.set(next.id, next);
  else await p.query("UPDATE verification_appeals SET state=$2, decision=$3, decided_by=$4, decided_at=$5 WHERE id=$1", [next.id, next.state, next.decision, next.decided_by, next.decided_at]);
  await enqueueNotification({ userId: r.seller_id, kind: "verification-appeal", subjectId: String(r.item_id), payload: { appealId: next.id, itemId: r.item_id, outcome: next.state, decision: next.decision } }).catch(() => null);
  return appealOut(next);
}

// ---- the reset on deletion (6.31–6.32, 14.6) ----------------------------------------------------

/**
 * Deletion resets the Passenger Score: every review ABOUT the person is
 * excluded (the score reads 0.0 — "No reviews"), every review BY them stays
 * as a legitimate review under an anonymized reviewer; penalties stay as
 * enforcement records. Called by purgePersonalizationData; `queryTarget`
 * is its open transaction on Postgres.
 */
export async function resetScoreOnDeletion(userId, queryTarget = null) {
  const p = queryTarget || await getPool();
  if (!p) {
    let about = 0, by = 0;
    for (const r of mem.passengerReviews.values()) {
      if (r.subject_id === userId) { r.excluded = true; r.state = "excluded"; about++; }
      if (r.reviewer_id === userId) { r.reviewer_id = "deleted-" + createHash("sha256").update(userId + "|" + String(r.id)).digest("hex").slice(0, 12); by++; }
    }
    return { about, by };
  }
  if (!(await hasRelation(p, "passenger_reviews"))) return { about: 0, by: 0 };
  const a = await p.query("UPDATE passenger_reviews SET excluded=true, state='excluded' WHERE subject_id=$1", [userId]);
  const b = await p.query("UPDATE passenger_reviews SET reviewer_id='deleted-' || substr(encode(sha256(convert_to($1 || '|' || id::text, 'UTF8')), 'hex'), 1, 12) WHERE reviewer_id=$1", [userId]);
  return { about: a.rowCount, by: b.rowCount };
}

export function resetMemoryIdentity() { mem.accountIdentity.clear(); mem.accountDevices.clear(); mem.verificationAppeals.clear(); }
