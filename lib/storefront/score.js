// lib/storefront/score.js — THE PASSENGER SCORE (V.2 Blueprint, owner, 17
// Oct 2026, chapter 6, 6.7–6.33; slice 7). PURE and client-safe.
//
//   One five-star score on Account and Passport, never on listings, offers,
//   checkout or messages (6.27). Everyone starts at 0.0 and the score grows
//   only through verified activity (6.9–6.11); a profile reads "0.0 ★ · No
//   reviews" until the first verified review (6.12).
//
//   THE BALANCED MODEL (6.10): verified reviews, their volume, their recency,
//   and confirmed conduct penalties. A weighted mean of the verified reviews
//   (recency half-life a year) shrunk toward zero by volume — n/(n+K) with
//   K=2 — so one review cannot stand for a record and a substantial record
//   cannot be moved far by one more; minus half a star per confirmed
//   penalty (6.7, 6.20); never displayed below 0.0 while penalties keep
//   accruing privately and escalate (6.21–6.22). Suspicious, fraudulent or
//   retaliatory reviews are excluded (6.23–6.24); refunded transactions keep
//   their legitimate reviews, marked.
//
//   DOUBLE BLIND (6.13–6.16): reviews open on confirmed delivery; each party
//   submits independently and sees nothing until both have submitted or the
//   14-day period ends; revisions are allowed with a private history; a
//   dispute holds publication and extends the deadline.
//
//   RESPONSES (6.28–6.29): one permanent public response per review; it can
//   be deleted, never replaced, with a private audit record.

import { RETURN_WINDOW_MS } from "./protection.js";

// the review window is the return window (6.14): one clock, one constant
export const REVIEW_WINDOW_MS = RETURN_WINDOW_MS;
export const RECENCY_HALF_LIFE_MS = 365 * RETURN_WINDOW_MS / 14;
export const SHRINK_K = 2;
export const PENALTY_HALF_STAR = 0.5;
export const MAX_STARS = 5;
export const ROLES = Object.freeze(["buyer", "seller"]);
export const REVIEW_STATES = Object.freeze(["submitted", "published", "held", "excluded"]);
export const PENALTY_STATES = Object.freeze(["pending", "confirmed", "appealed", "overturned"]);
export const ESCALATION = Object.freeze([
  { atOrAbove: 1, level: "notice", action: "the passenger is told and may appeal with evidence" },
  { atOrAbove: 3, level: "review", action: "an admin reviews the record; private improvement guidance" },
  { atOrAbove: 5, level: "restriction_review", action: "an admin decides restrictions from severity, verified evidence and history (6.22)" },
]);

const ms = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v || "")));
const stars = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= MAX_STARS ? Math.round(n * 2) / 2 : NaN; };

/** Is a review counted? Verified, published, not excluded. */
export function countsToward(review) {
  return !!review && review.verified === true && review.state === "published" && !review.excluded && Number.isFinite(stars(review.stars));
}

/**
 * The score from reviews and penalties. `reviews`: [{ stars, submittedAt,
 * verified, state, excluded, refunded, role }]; `penalties`: [{ state,
 * halfStars }]. Returns what the popup shows (6.18) and what stays private.
 */
export function computeScore({ reviews = [], penalties = [], now = Date.now(), role = null } = {}) {
  const counted = reviews.filter(countsToward).filter((r) => !role || r.role === role);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let weighted = 0, weights = 0;
  for (const r of counted) {
    const s = stars(r.stars);
    distribution[Math.max(1, Math.min(5, Math.round(s)))] += 1;
    const age = Math.max(0, now - (ms(r.submittedAt) || now));
    const w = Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
    weighted += w * s; weights += w;
  }
  const n = counted.length;
  const mean = weights > 0 ? weighted / weights : 0;
  const shrunk = n ? mean * (n / (n + SHRINK_K)) : 0;
  const confirmed = penalties.filter((p) => p && p.state === "confirmed");
  const penaltyStars = confirmed.reduce((s, p) => s + (Number(p.halfStars) || 1) * PENALTY_HALF_STAR, 0);
  const raw = shrunk - penaltyStars;
  const score = Math.round(Math.max(0, Math.min(MAX_STARS, raw)) * 10) / 10;
  const escalation = [...ESCALATION].reverse().find((e) => confirmed.length >= e.atOrAbove) || null;
  return {
    score, label: n ? `${score.toFixed(1)} ★` : "0.0 ★ · No reviews", count: n, distribution,
    mean: Math.round(mean * 100) / 100, penalties: confirmed.length, penaltyStars,
    belowFloor: raw < 0 ? Math.round(-raw * 10) / 10 : 0, // accrues privately (6.21)
    escalation: escalation ? escalation.level : "none",
    conductIndicator: confirmed.length > 0, // neutral, public (6.19); the details stay private
  };
}

/** May a party review this order now? After delivery, inside 14 days plus any dispute extension (6.13–6.14, 6.16). */
export function canReview({ deliveredAt = null, now = Date.now(), extensionMs = 0, alreadySubmitted = false } = {}) {
  const t = ms(deliveredAt);
  if (!Number.isFinite(t)) return { ok: false, reason: "reviews open after confirmed delivery" };
  if (alreadySubmitted) return { ok: false, reason: "submitted — revise it instead" };
  if (now < t) return { ok: false, reason: "not delivered yet" };
  if (now >= t + REVIEW_WINDOW_MS + Math.max(0, extensionMs)) return { ok: false, reason: "the 14-day review window has closed" };
  return { ok: true, closesAt: new Date(t + REVIEW_WINDOW_MS + Math.max(0, extensionMs)).toISOString() };
}

/**
 * Double blind: what each party may see. Both submitted, or the period ended
 * → both published; a dispute holds publication and score changes.
 */
export function reviewVisibility({ mine = null, theirs = null, deliveredAt = null, now = Date.now(), disputeOpen = false, extensionMs = 0 } = {}) {
  const t = ms(deliveredAt);
  const ended = Number.isFinite(t) && now >= t + REVIEW_WINDOW_MS + Math.max(0, extensionMs);
  const both = !!(mine && theirs);
  if (disputeOpen) return { publish: false, reason: "a dispute is open — publication and score changes wait (6.16)" };
  if (both || ended) return { publish: true, reason: both ? "both parties submitted" : "the period ended" };
  return { publish: false, reason: "hidden until both have submitted or the period ends (6.13)" };
}

/** A submission, validated: whole or half stars 1–5, text bounded. */
export function newReview({ orderId, reviewerId, subjectId, role, stars: s, text = "", verified = false, now = Date.now() } = {}) {
  const v = stars(s);
  if (!Number.isFinite(v)) return { ok: false, reason: "stars are 1 to 5" };
  if (!ROLES.includes(role)) return { ok: false, reason: "the reviewer is the buyer or the seller" };
  if (!orderId || !reviewerId || !subjectId) return { ok: false, reason: "an order, a reviewer and a subject" };
  if (reviewerId === subjectId) return { ok: false, reason: "nobody reviews themselves" };
  return { ok: true, review: { orderId, reviewerId, subjectId, role, stars: v, text: String(text || "").slice(0, 1000), verified: !!verified, state: "submitted", excluded: false, refunded: false, submittedAt: new Date(now).toISOString(), revisedAt: null, history: [], response: null, responseDeletedAt: null } };
}

/** A revision keeps the private history (6.15). The initial review must already have landed in the window. */
export function reviseReview(review, { stars: s, text = "", now = Date.now() } = {}) {
  const v = stars(s);
  if (!Number.isFinite(v)) return { ok: false, reason: "stars are 1 to 5" };
  if (!review || review.state === "excluded") return { ok: false, reason: "that review cannot be revised" };
  const history = [...(review.history || []), { stars: review.stars, text: review.text, at: review.revisedAt || review.submittedAt }];
  return { ok: true, review: { ...review, stars: v, text: String(text || "").slice(0, 1000), revisedAt: new Date(now).toISOString(), history } };
}

/** One permanent public response; deletable, never replaced (6.28–6.29). */
export function respondToReview(review, { text, now = Date.now() } = {}) {
  if (!review) return { ok: false, reason: "no review" };
  if (review.response || review.responseDeletedAt) return { ok: false, reason: "one response per review — it can be deleted, never replaced" };
  const body = String(text || "").trim().slice(0, 1000);
  if (!body) return { ok: false, reason: "a response says something" };
  return { ok: true, review: { ...review, response: { text: body, at: new Date(now).toISOString() } } };
}

export function deleteResponse(review, { now = Date.now() } = {}) {
  if (!review || !review.response) return { ok: false, reason: "nothing to delete" };
  return { ok: true, review: { ...review, response: null, responseDeletedAt: new Date(now).toISOString(), responseAudit: [...(review.responseAudit || []), { ...review.response, deletedAt: new Date(now).toISOString() }] } };
}

/** A conduct penalty: half a star, confirmed before it counts, appealable, restored if overturned (6.8, 6.20). */
export function newPenalty({ userId, reason, orderId = null, halfStars = 1, now = Date.now() } = {}) {
  if (!userId || !reason) return { ok: false, reason: "a passenger and a reason" };
  return { ok: true, penalty: { userId, reason: String(reason).slice(0, 300), orderId, halfStars: Math.max(1, Math.floor(Number(halfStars) || 1)), state: "pending", createdAt: new Date(now).toISOString(), confirmedAt: null, appealedAt: null, appeal: null, decidedAt: null } };
}

export function penaltyTransition(penalty, { action, by = "admin", evidence = null, now = Date.now() } = {}) {
  if (!penalty) return { ok: false, reason: "no penalty" };
  const at = new Date(now).toISOString();
  if (action === "confirm" && penalty.state === "pending") return { ok: true, penalty: { ...penalty, state: "confirmed", confirmedAt: at } };
  if (action === "appeal" && penalty.state === "confirmed") return { ok: true, penalty: { ...penalty, state: "appealed", appealedAt: at, appeal: String(evidence || "").slice(0, 1000) } };
  if (action === "overturn" && (penalty.state === "appealed" || penalty.state === "confirmed")) return { ok: true, penalty: { ...penalty, state: "overturned", decidedAt: at } };
  if (action === "uphold" && penalty.state === "appealed") return { ok: true, penalty: { ...penalty, state: "confirmed", decidedAt: at } };
  return { ok: false, reason: `cannot ${action} a ${penalty.state} penalty` };
  void by;
}

/** Where a score may appear (6.27). */
export const SCORE_SURFACES = Object.freeze(["account", "passport"]);
export const NEVER_SURFACES = Object.freeze(["listing", "offer", "checkout", "message"]);
export function scoreAllowedOn(surface) { return SCORE_SURFACES.includes(surface); }
