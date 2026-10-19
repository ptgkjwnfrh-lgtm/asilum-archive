// lib/db/production/score.js — THE PASSENGER SCORE'S ROWS (V.2 Blueprint
// chapter 6; slice 7; schema v65). SERVER-ONLY; memory mode mirrors Postgres.
// Reviews are double blind and revisable with a private history; penalties
// are confirmed before they count and appealable; the score is computed from
// the rows by lib/storefront/score.js, never stored.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { enqueueNotification } from "./listingStatus.js";
import { createModerationTask } from "./moderation.js";
import { getOrder } from "../orders.js";
import { screenStatement } from "../../profile/rooms.js";

// 6.17 / 6.23: a review is screened like a room statement (contact details, link-heavy) and,
// because a review is public evidence about a sale, for off-platform solicitation — a named
// messenger or payment app, or an ask to pay outside. Deterministic; a flag holds the review
// for a human, it never judges the words.
const OFF_PLATFORM_RE = /\b(telegram|whatsapp|signal me|paypal|venmo|cash ?app|zelle|revolut|wire (me|transfer)|send (me )?money|pay (me )?(outside|off)|dm me on|text me on)\b/i;
export function screenReview(text) {
  const flags = screenStatement(text);
  if (OFF_PLATFORM_RE.test(text)) flags.push("off-platform");
  return flags;
}
import { computeScore, canReview, reviewVisibility, newReview, reviseReview, respondToReview, deleteResponse, newPenalty, penaltyTransition } from "../../storefront/score.js";

export class ScoreRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "ScoreRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "passenger_reviews") : true);
const needs = () => { throw new ScoreRefused("SCHEMA_V65_REQUIRED", "the Passenger Score needs schema v65 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();
const reviewOut = (r) => ({
  id: String(r.id), orderId: r.order_id, reviewerId: r.reviewer_id, subjectId: r.subject_id, role: r.role, stars: Number(r.stars), text: r.text || "",
  verified: !!r.verified, state: r.state, excluded: !!r.excluded, refunded: !!r.refunded, submittedAt: iso(r.submitted_at), revisedAt: iso(r.revised_at), publishedAt: iso(r.published_at),
  history: json(r.history) || [], response: json(r.response), responseDeletedAt: iso(r.response_deleted_at), responseAudit: json(r.response_audit) || [],
});
const reviewRow = (o) => ({
  id: o.id, order_id: o.orderId, reviewer_id: o.reviewerId, subject_id: o.subjectId, role: o.role, stars: o.stars, text: o.text, verified: o.verified, state: o.state, excluded: o.excluded, refunded: o.refunded,
  submitted_at: o.submittedAt, revised_at: o.revisedAt, published_at: o.publishedAt || null, history: o.history || [], response: o.response || null, response_deleted_at: o.responseDeletedAt || null, response_audit: o.responseAudit || [],
});
const penaltyOut = (r) => ({ id: String(r.id), userId: r.user_id, reason: r.reason, orderId: r.order_id || null, halfStars: Number(r.half_stars), state: r.state, createdAt: iso(r.created_at), confirmedAt: iso(r.confirmed_at), appealedAt: iso(r.appealed_at), appeal: r.appeal || null, decidedAt: iso(r.decided_at) });
const penaltyRow = (o) => ({ id: o.id, user_id: o.userId, reason: o.reason, order_id: o.orderId, half_stars: o.halfStars, state: o.state, created_at: o.createdAt, confirmed_at: o.confirmedAt, appealed_at: o.appealedAt, appeal: o.appeal, decided_at: o.decidedAt });

async function saveReview(o) {
  const p = await getPool();
  const row = reviewRow(o);
  if (!p) { mem.passengerReviews.set(row.id, row); return reviewOut(row); }
  await p.query(
    `INSERT INTO passenger_reviews (id, order_id, reviewer_id, subject_id, role, stars, text, verified, state, excluded, refunded, submitted_at, revised_at, published_at, history, response, response_deleted_at, response_audit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET stars=EXCLUDED.stars, text=EXCLUDED.text, state=EXCLUDED.state, excluded=EXCLUDED.excluded, refunded=EXCLUDED.refunded, revised_at=EXCLUDED.revised_at, published_at=EXCLUDED.published_at, history=EXCLUDED.history, response=EXCLUDED.response, response_deleted_at=EXCLUDED.response_deleted_at, response_audit=EXCLUDED.response_audit`,
    [row.id, row.order_id, row.reviewer_id, row.subject_id, row.role, row.stars, row.text, row.verified, row.state, row.excluded, row.refunded, row.submitted_at, row.revised_at, row.published_at, JSON.stringify(row.history), row.response ? JSON.stringify(row.response) : null, row.response_deleted_at, JSON.stringify(row.response_audit)]);
  return reviewOut(row);
}

async function reviewsForOrder(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return [...mem.passengerReviews.values()].filter((r) => r.order_id === orderId).map(reviewOut);
  const { rows } = await p.query("SELECT * FROM passenger_reviews WHERE order_id=$1", [orderId]);
  return rows.map(reviewOut);
}

export async function getReview(id) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.passengerReviews.get(String(id)); return r ? reviewOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM passenger_reviews WHERE id=$1", [String(id)]);
  return rows[0] ? reviewOut(rows[0]) : null;
}

/** Publish what the double-blind rule allows for one order's pair. */
async function settlePair(orderId, { deliveredAt, now = Date.now(), disputeOpen = false, extensionMs = 0 }) {
  const pair = await reviewsForOrder(orderId);
  const buyer = pair.find((r) => r.role === "buyer") || null, seller = pair.find((r) => r.role === "seller") || null;
  const v = reviewVisibility({ mine: buyer, theirs: seller, deliveredAt, now, disputeOpen, extensionMs });
  if (!v.publish) return { published: 0, reason: v.reason };
  let n = 0;
  const told = [];
  for (const r of pair) if (r.state === "submitted" || r.state === "held") { await saveReview({ ...r, state: "published", publishedAt: new Date(now).toISOString() }); n++; told.push(r); }
  // each published review tells the passenger it is about (6.26)
  for (const r of told) await enqueueNotification({ userId: r.subjectId, kind: "review-published", subjectId: `${orderId}:${r.role}`, payload: { orderId, role: r.role } }).catch(() => null);
  return { published: n, reason: v.reason };
}

/**
 * Submit a review for an order. `order` facts come from the caller (the
 * after-sale store): deliveredAt, verified (a paid order both parties were in),
 * disputeOpen, extensionMs. The reviewer is told nothing of the other side.
 */
export async function submitReview({ orderId, reviewerId, subjectId, role, stars, text = "", order = {}, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  // A review belongs to an order (passenger_reviews.order_id REFERENCES orders). Postgres
  // refused an unknown order with a raw 23503 while memory stored the orphan, so the two
  // backends disagreed on the same call; both now ask first and refuse it the same way.
  if (!orderId || !(await getOrder(orderId))) throw new ScoreRefused("ORDER_NOT_FOUND", "order not found", 404);
  const existing = (await reviewsForOrder(orderId)).find((r) => r.reviewerId === reviewerId);
  const gate = canReview({ deliveredAt: order.deliveredAt, now, extensionMs: order.extensionMs || 0, alreadySubmitted: !!existing });
  if (!gate.ok) throw new ScoreRefused("REVIEW_CLOSED", gate.reason, 409);
  const made = newReview({ orderId, reviewerId, subjectId, role, stars, text, verified: order.verified !== false, now });
  if (!made.ok) throw new ScoreRefused("INVALID_REVIEW", made.reason, 400);
  // 6.17 / 6.23 (slice 11): the same deterministic screen the rooms and the wire use holds a
  // flagged review out of the score and files it for a human; an admin's score.mark decides
  let flagged = [];
  try { flagged = text ? screenReview(String(text)) : []; } catch { flagged = []; }
  const id = newId();
  const saved = await saveReview({ ...made.review, id, state: order.disputeOpen || flagged.length ? "held" : "submitted" });
  if (flagged.length) await createModerationTask({ kind: "review-screen", subjectType: "review", subjectId: id, payload: { orderId, reviewerId, flags: flagged, excerpt: String(text).slice(0, 200) }, priority: 2 }).catch(() => null);
  const settled = await settlePair(orderId, { deliveredAt: order.deliveredAt, now, disputeOpen: !!order.disputeOpen, extensionMs: order.extensionMs || 0 });
  return { review: (await getReview(saved.id)), settled };
}

export async function reviseExisting({ reviewId, reviewerId, stars, text = "", now = Date.now() } = {}) {
  const r = await getReview(reviewId);
  if (!r || r.reviewerId !== reviewerId) throw new ScoreRefused("REVIEW_NOT_FOUND", "review not found", 404);
  const out = reviseReview(r, { stars, text, now });
  if (!out.ok) throw new ScoreRefused("INVALID_REVIEW", out.reason, 400);
  return saveReview(out.review);
}

export async function respond({ reviewId, subjectId, text, now = Date.now() } = {}) {
  const r = await getReview(reviewId);
  if (!r || r.subjectId !== subjectId) throw new ScoreRefused("REVIEW_NOT_FOUND", "review not found", 404);
  if (r.state !== "published") throw new ScoreRefused("NOT_PUBLISHED", "a response waits for publication", 409);
  const out = respondToReview(r, { text, now });
  if (!out.ok) throw new ScoreRefused("RESPONSE_REFUSED", out.reason, 409);
  return saveReview(out.review);
}

export async function removeResponse({ reviewId, subjectId, now = Date.now() } = {}) {
  const r = await getReview(reviewId);
  if (!r || r.subjectId !== subjectId) throw new ScoreRefused("REVIEW_NOT_FOUND", "review not found", 404);
  const out = deleteResponse(r, { now });
  if (!out.ok) throw new ScoreRefused("NOTHING_TO_DELETE", out.reason, 409);
  return saveReview(out.review);
}

/** An admin marks a review excluded (fraud, retaliation) or a transaction refunded (6.24). */
export async function markReview({ reviewId, excluded = null, refunded = null, actor = "admin" } = {}) {
  const r = await getReview(reviewId);
  if (!r) throw new ScoreRefused("REVIEW_NOT_FOUND", "review not found", 404);
  const next = { ...r, excluded: excluded == null ? r.excluded : !!excluded, refunded: refunded == null ? r.refunded : !!refunded };
  if (next.excluded) next.state = "excluded";
  void actor;
  return saveReview(next);
}

/** The reviews about a passenger (published), with a role filter for the popup. */
export async function reviewsAbout(subjectId, { role = null, includeHidden = false } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.passengerReviews.values()].filter((r) => r.subject_id === subjectId).map(reviewOut);
  else rows = (await p.query("SELECT * FROM passenger_reviews WHERE subject_id=$1 ORDER BY submitted_at DESC", [subjectId])).rows.map(reviewOut);
  return rows.filter((r) => (includeHidden || r.state === "published") && (!role || r.role === role));
}

// ---- penalties ------------------------------------------------------------------------

async function savePenalty(o) {
  const p = await getPool();
  const row = penaltyRow(o);
  if (!p) { mem.conductPenalties.set(row.id, row); return penaltyOut(row); }
  await p.query(
    `INSERT INTO conduct_penalties (id, user_id, reason, order_id, half_stars, state, created_at, confirmed_at, appealed_at, appeal, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, confirmed_at=EXCLUDED.confirmed_at, appealed_at=EXCLUDED.appealed_at, appeal=EXCLUDED.appeal, decided_at=EXCLUDED.decided_at`,
    [row.id, row.user_id, row.reason, row.order_id, row.half_stars, row.state, row.created_at, row.confirmed_at, row.appealed_at, row.appeal, row.decided_at]);
  return penaltyOut(row);
}

export async function getPenalty(id) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.conductPenalties.get(String(id)); return r ? penaltyOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM conduct_penalties WHERE id=$1", [String(id)]);
  return rows[0] ? penaltyOut(rows[0]) : null;
}

export async function penaltiesFor(userId) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return [...mem.conductPenalties.values()].filter((r) => r.user_id === userId).map(penaltyOut);
  const { rows } = await p.query("SELECT * FROM conduct_penalties WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
  return rows.map(penaltyOut);
}

/** A penalty is proposed, then confirmed; the passenger is told and may appeal (6.8). */
export async function proposePenalty({ userId, reason, orderId = null, halfStars = 1, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const made = newPenalty({ userId, reason, orderId, halfStars, now });
  if (!made.ok) throw new ScoreRefused("INVALID_PENALTY", made.reason, 400);
  return savePenalty({ ...made.penalty, id: newId() });
}

export async function movePenalty({ penaltyId, action, by = "admin", evidence = null, now = Date.now() } = {}) {
  const pen = await getPenalty(penaltyId);
  if (!pen) throw new ScoreRefused("PENALTY_NOT_FOUND", "penalty not found", 404);
  const out = penaltyTransition(pen, { action, by, evidence, now });
  if (!out.ok) throw new ScoreRefused("INVALID_TRANSITION", out.reason, 409);
  const saved = await savePenalty(out.penalty);
  if (action === "confirm") await enqueueNotification({ userId: pen.userId, kind: "penalty", subjectId: pen.id, payload: { penaltyId: pen.id, reason: pen.reason, halfStars: pen.halfStars, appeal: "you may appeal with evidence" } }).catch(() => null);
  if (action === "overturn") await enqueueNotification({ userId: pen.userId, kind: "penalty", subjectId: pen.id + ":overturned", payload: { penaltyId: pen.id, overturned: true } }).catch(() => null);
  return saved;
}

/** The score, as the popup shows it (6.18), from the rows. */
export async function passengerScore(userId, { role = null, now = Date.now() } = {}) {
  const [reviews, penalties] = await Promise.all([reviewsAbout(userId), penaltiesFor(userId)]);
  const score = computeScore({ reviews, penalties, now, role });
  const { belowFloor, escalation, ...pub } = score;
  return { public: pub, private: { belowFloor, escalation, penalties: penalties.length } };
}

export function resetMemoryScore() { mem.passengerReviews.clear(); mem.conductPenalties.clear(); }
