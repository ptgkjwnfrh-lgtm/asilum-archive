// lib/storefront/protection.js — PROTECTION, RETURNS, THE WINDOWS AND THE
// DISPATCH CLOCKS (V.2 Blueprint, owner, 17 Oct 2026, chapter 6 "Protection,
// returns and the Passenger Score" 6.1–6.8, chapter 10 "Shipping, payouts and
// claims", Terms 11–12; slice 7). PURE and client-safe.
//
//   |A| PROTECTION (6.2–6.4)   optional purchase protection through a provider
//                              (REDO is proposed, pending agreement); a dynamic
//                              quote on item value, shipping, destination and
//                              coverage; OFF by default, never preselected or
//                              silently charged. Without a provider there is no
//                              quote and the toggle says so — nothing here
//                              invents a price.
//   REFUNDS AND RETURNS (6.1, 11.2, 11.5)  no refunds or returns on a purchase
//                              paid partly or wholly with Credit unless
//                              Protection was added; a seller may enable
//                              returns (change of mind, 14 days after delivery);
//                              an admin may override on a complaint with
//                              evidence (wrong item, damage, non-delivery) —
//                              approved, the buyer returns the item and is
//                              refunded in Credit or to the original method.
//   THE $1 INCENTIVE (6.5–6.6) earned once per returnable listing, after its
//                              first completed, non-refunded sale, when the
//                              14-day window closes with no open return,
//                              refund or dispute.
//   RETURN SHIPPING (6.7–6.8)  seller's fault and the seller refuses the label
//                              inside the window: ASILUM covers it, deducts it
//                              from the seller's next payout, and the seller
//                              loses half a star — once responsibility is
//                              confirmed, with notice and appeal; the innocent
//                              party is never penalized.
//   DELIVERY (10.21)           carrier-confirmed delivery is the event that
//                              starts the 14-day return and review windows and
//                              the payout clock. A seller-entered delivery is
//                              recorded WITH its source; it is not a carrier's.
//   PAYOUTS (10.12–10.13)      item-level, after the 14-day window; an open
//                              return, refund or dispute holds it.
//   DISPATCH (10.1–10.5, 10.17–10.19)  SELL ships within 14 days; a DROP has 31
//                              days to print a label and 31 more to hand off;
//                              at most two approved extensions of at most seven
//                              days; a missed deadline lets the buyer cancel
//                              for a full refund and is recorded against the
//                              seller; the seller may cancel before handoff
//                              with a full refund; no voluntary buyer
//                              cancellation after payment.

export const DAY = 86_400_000; // one day; lib/brdcst/index.js imports it rather than copying it
export const RETURN_WINDOW_MS = 14 * DAY;
export const REVIEW_WINDOW_MS = 14 * DAY;
export const PROTECTION_DEFAULT = false;
export const RETURN_INCENTIVE_CENTS = 100;
export const COMPLAINT_KINDS = Object.freeze(["wrong_item", "damage", "non_delivery"]);
export const RETURN_KINDS = Object.freeze(["change_of_mind", ...COMPLAINT_KINDS]);
export const FAULTS = Object.freeze(["buyer", "seller", "carrier", "undetermined"]);
export const DELIVERY_SOURCES = Object.freeze(["carrier", "seller", "admin"]);
export const SELL_SHIP_MS = 14 * DAY;
export const DROP_LABEL_MS = 31 * DAY;
export const DROP_HANDOFF_MS = 31 * DAY;
export const MAX_EXTENSIONS = 2;
export const MAX_EXTENSION_MS = 7 * DAY;

const ms = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v || "")));
const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN);

/** The windows a delivery opens. Null when nothing was delivered. */
export function windowsFrom(deliveredAt) {
  const t = ms(deliveredAt);
  if (!Number.isFinite(t)) return null;
  return { deliveredAt: new Date(t).toISOString(), returnBy: new Date(t + RETURN_WINDOW_MS).toISOString(), reviewBy: new Date(t + REVIEW_WINDOW_MS).toISOString(), payoutAt: new Date(t + RETURN_WINDOW_MS).toISOString() };
}

/** Is `now` inside the 14 days after delivery (plus any dispute extension)? */
export function withinWindow(deliveredAt, now = Date.now(), { extensionMs = 0 } = {}) {
  const t = ms(deliveredAt);
  return Number.isFinite(t) && now >= t && now < t + RETURN_WINDOW_MS + Math.max(0, extensionMs);
}

/**
 * The protection offer at checkout. A provider quote is passed in by the
 * provider adapter; without one the offer is unavailable and says why. The
 * election is always the passenger's and never preselected.
 */
export function protectionOffer(quote = null) {
  if (!quote || quote.available !== true) {
    return { available: false, elected: PROTECTION_DEFAULT, reason: (quote && quote.reason) || "no protection provider is agreed yet — nothing is quoted", provider: quote?.provider || null };
  }
  const price = int(quote.priceCents);
  if (!(price >= 0)) return { available: false, elected: false, reason: "the provider's quote is not a whole number of cents", provider: quote.provider || null };
  return { available: true, elected: PROTECTION_DEFAULT, priceCents: price, provider: quote.provider || null, coverage: quote.coverage || null, exclusions: quote.exclusions || null, claims: quote.claims || null };
}

/** The passenger's election, validated: only an available offer can be elected. */
export function electProtection(offer, elected) {
  if (elected !== true) return { elected: false, priceCents: 0 };
  if (!offer || offer.available !== true) return { elected: false, priceCents: 0, refused: offer?.reason || "protection is not available" };
  return { elected: true, priceCents: offer.priceCents, provider: offer.provider };
}

/**
 * May this order be refunded or returned, and on what ground?
 * Order facts: creditAppliedCents, protected, sellerReturnsEnabled, deliveredAt,
 * refunded; the request: kind (change_of_mind | a complaint kind), evidence,
 * adminApproved. Returns `{ ok, ground, reason }`.
 */
export function refundEligibility({ order = {}, request = {}, now = Date.now(), extensionMs = 0 } = {}) {
  if (order.refunded) return { ok: false, reason: "already refunded" };
  if (order.status && order.status !== "paid") return { ok: false, reason: `only a paid order refunds — this one is "${order.status}"` };
  const kind = request.kind || "change_of_mind";
  if (!RETURN_KINDS.includes(kind)) return { ok: false, reason: "a return is change of mind or a complaint: wrong item, damage, non-delivery" };
  const usedCredit = int(order.creditAppliedCents) > 0;
  if (kind === "change_of_mind") {
    if (usedCredit && !order.protected) return { ok: false, reason: "a purchase paid with Credit is not refundable or returnable unless |A| Protection was added at checkout (11.2)" };
    if (order.protected) {
      if (!withinWindow(order.deliveredAt, now, { extensionMs })) return { ok: false, reason: "the 14-day window after delivery has closed" };
      return { ok: true, ground: "protection", reason: "|A| Protection covers the return" };
    }
    if (!order.sellerReturnsEnabled) return { ok: false, reason: "this seller does not accept change-of-mind returns; a complaint with evidence is the other path" };
    if (!withinWindow(order.deliveredAt, now, { extensionMs })) return { ok: false, reason: "the 14-day window after delivery has closed" };
    return { ok: true, ground: "seller_returns", reason: "the seller accepts returns inside the 14-day window" };
  }
  // a complaint: wrong item, damage, non-delivery — evidence, inside the window, an admin decides
  if (!request.evidence || !String(request.evidence).trim()) return { ok: false, reason: "a complaint carries evidence" };
  const anchor = order.deliveredAt || order.estimatedDeliveryAt;
  if (anchor && !withinWindow(anchor, now, { extensionMs })) return { ok: false, reason: "a complaint is filed within 14 days of delivery or the last estimated delivery date (11.5)" };
  if (request.adminApproved !== true) return { ok: true, ground: "complaint_pending", reason: "filed — an administrator decides on the evidence" };
  return { ok: true, ground: "complaint_approved", reason: "approved on evidence — return the item; the refund is in Credit or to the original method" };
}

/** Where a complaint refund goes: the buyer's choice, Credit or the original method (6.1, 11.5). */
export function refundDestination(choice) {
  return choice === "original" ? "original" : "credit";
}

/**
 * Return shipping (6.7–6.8): the seller's fault and the seller refuses the
 * label inside the window → ASILUM covers it, deducts it from the next
 * payout, and the seller loses half a star once responsibility is confirmed.
 */
export function returnShipping({ fault = "undetermined", sellerPaysLabel = null, insideWindow = true, responsibilityConfirmed = false } = {}) {
  if (!FAULTS.includes(fault)) return { payer: "undetermined", penalty: 0, note: "fault must be buyer, seller, carrier or undetermined" };
  if (fault === "buyer") return { payer: "buyer", penalty: 0, note: "change of mind: the buyer ships it back" };
  if (fault === "carrier") return { payer: "carrier_claim", penalty: 0, note: "the carrier process decides (10.22)" };
  if (fault !== "seller") return { payer: "undetermined", penalty: 0, note: "responsibility is not confirmed yet" };
  if (sellerPaysLabel === true) return { payer: "seller", penalty: 0, note: "the seller pays the return label" };
  if (!insideWindow) return { payer: "undetermined", penalty: 0, note: "outside the window — a dispute decides" };
  return {
    payer: "asilum_then_seller", penalty: responsibilityConfirmed ? 0.5 : 0, deductFromNextPayout: true,
    note: responsibilityConfirmed ? "ASILUM covers the label, deducts it from the seller's next payout, and the seller loses half a star" : "ASILUM covers the label and deducts it from the seller's next payout; the half-star waits for responsibility to be confirmed (6.8)",
  };
}

/** The $1 Credit for enabling returns: once per listing, after the window closes clean (6.5–6.6). */
export function incentiveDue({ listingReturnsEnabled = false, saleCompleted = false, refunded = false, deliveredAt = null, now = Date.now(), openIssues = 0, alreadyEarned = false } = {}) {
  if (alreadyEarned) return { due: false, reason: "earned once already for this listing" };
  if (!listingReturnsEnabled) return { due: false, reason: "returns are not enabled on the listing" };
  if (!saleCompleted || refunded) return { due: false, reason: "the first completed, non-refunded sale has not happened" };
  const t = ms(deliveredAt);
  if (!Number.isFinite(t)) return { due: false, reason: "not delivered" };
  if (now < t + RETURN_WINDOW_MS) return { due: false, reason: "the 14-day window is open", at: new Date(t + RETURN_WINDOW_MS).toISOString() };
  if (openIssues > 0) return { due: false, reason: "a return, refund or dispute is open" };
  return { due: true, amountCents: RETURN_INCENTIVE_CENTS };
}

/** Payout for one item: after the window, unless something is open (10.12–10.13). */
export function payoutState({ deliveredAt = null, now = Date.now(), openIssues = 0, refunded = false } = {}) {
  if (refunded) return { state: "void", reason: "refunded" };
  const t = ms(deliveredAt);
  if (!Number.isFinite(t)) return { state: "waiting_delivery", reason: "no carrier-confirmed delivery yet" };
  if (now < t + RETURN_WINDOW_MS) return { state: "held_window", releasesAt: new Date(t + RETURN_WINDOW_MS).toISOString(), reason: "inside the 14-day return window" };
  if (openIssues > 0) return { state: "held_issue", reason: "an open return, refund or dispute holds it" };
  return { state: "releasable", reason: "the window closed clean" };
}

/** The dispatch clocks for one order (10.1–10.3). */
export function dispatchDeadlines(mode, paidAt) {
  const t = ms(paidAt);
  if (!Number.isFinite(t)) return null;
  if (mode === "drop") return { mode, labelBy: new Date(t + DROP_LABEL_MS).toISOString(), handoffAfterLabelMs: DROP_HANDOFF_MS };
  return { mode: "sell", shipBy: new Date(t + SELL_SHIP_MS).toISOString() };
}

/** An extension request (10.5): at most two, each at most seven days, approved — never automatic. */
export function extendDispatch({ extensions = [], requestedMs, approved = false } = {}) {
  const granted = extensions.filter((e) => e && e.approved);
  if (granted.length >= MAX_EXTENSIONS) return { ok: false, reason: "two extensions is the limit" };
  const want = Number(requestedMs);
  if (!(want > 0) || want > MAX_EXTENSION_MS) return { ok: false, reason: "an extension is at most seven days" };
  if (approved !== true) return { ok: false, reason: "an extension needs approval — nothing is automatic" };
  return { ok: true, extension: { ms: want, approved: true } };
}

/** Is the seller late (10.17)? The buyer may then cancel for a full refund; the lapse is recorded. */
export function dispatchLate({ mode = "sell", paidAt, labelPrintedAt = null, handedAt = null, extensions = [], now = Date.now() } = {}) {
  const d = dispatchDeadlines(mode, paidAt);
  if (!d) return { late: false, reason: "not paid" };
  const extra = extensions.filter((e) => e && e.approved).reduce((s, e) => s + Math.min(MAX_EXTENSION_MS, Number(e.ms) || 0), 0);
  if (mode === "drop") {
    if (!labelPrintedAt) return { late: now > ms(d.labelBy) + extra, stage: "label", deadline: new Date(ms(d.labelBy) + extra).toISOString() };
    if (!handedAt) return { late: now > ms(labelPrintedAt) + DROP_HANDOFF_MS + extra, stage: "handoff", deadline: new Date(ms(labelPrintedAt) + DROP_HANDOFF_MS + extra).toISOString() };
    return { late: false, stage: "handed" };
  }
  if (handedAt) return { late: false, stage: "handed" };
  return { late: now > ms(d.shipBy) + extra, stage: "ship", deadline: new Date(ms(d.shipBy) + extra).toISOString() };
}

/** Who may cancel, and when (10.17–10.19, 13.15). */
export function cancellation({ by, handedAt = null, late = false } = {}) {
  if (by === "buyer") return late ? { ok: true, refund: "full", reason: "the seller missed the deadline (10.17)" } : { ok: false, reason: "no voluntary buyer cancellation after payment (10.19); mandatory legal remedies remain" };
  if (by === "seller") return handedAt ? { ok: false, reason: "the parcel is with the carrier" } : { ok: true, refund: "full", reason: "the seller cancels before handoff (10.18)" };
  return { ok: false, reason: "buyer or seller" };
}
