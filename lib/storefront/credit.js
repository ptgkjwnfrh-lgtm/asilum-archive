// lib/storefront/credit.js — ASILUM CREDIT (V.2 Blueprint, owner, 17 Oct
// 2026, 5.26–5.32, 6.1, Terms 10; slice 7). PURE and client-safe.
//
//   Site-wide money inside ASILUM, from REFUNDS and GIFTS only — it cannot
//   be purchased (5.31, 10.1). Not cash, no interest, no expiry while the
//   account is in good standing (5.28, 10.2–10.3). At checkout the passenger
//   chooses exactly how much to apply; the remainder goes to another method;
//   credit is never drained automatically (5.32, 10.5). Credit spent on a
//   BRDCST earns a proportional advertising bonus rounded down to whole days
//   or miles; on items nothing extra (5.29–5.30, 10.6). A refund offers
//   credit first — with the BRDCST bonus of two days or 45 miles — and the
//   original method only after the passenger declines (5.26). Gifting runs
//   through Direct Messages with two-factor and device authentication;
//   gifts are final once accepted (5.29, 10.4). Credit obtained by fraud or
//   error may be voided (10.7).

export const CREDIT_SOURCES = Object.freeze(["refund", "gift", "incentive"]);
export const LEDGER_KINDS = Object.freeze(["refund", "gift_in", "gift_out", "incentive", "spend", "release", "void", "bonus"]);
export const BRDCST_REFUND_BONUS = Object.freeze({ days: 2, miles: 45 });
export const GIFT_REQUIREMENTS = Object.freeze(["twoFactor", "deviceVerified"]);

const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN);

/** The balance of a ledger: credits in, spends and voids out; never below zero by construction. */
export function balanceOf(entries = []) {
  let b = 0;
  for (const e of entries) {
    const a = int(e.amountCents);
    if (!(a >= 0)) continue;
    if (["refund", "gift_in", "incentive", "release"].includes(e.kind)) b += a;
    else if (["spend", "gift_out", "void"].includes(e.kind)) b -= a;
  }
  return Math.max(0, b);
}

/** May credit enter the ledger this way? Refunds and gifts only (and the $1 return incentive, 6.1). */
export function canEnter(kind) {
  return CREDIT_SOURCES.includes(kind);
}

/**
 * Applying credit at checkout: the passenger's exact amount, never more than
 * the balance, never more than the total, never automatic.
 */
export function applyCredit({ balanceCents = 0, requestedCents = null, totalCents = 0 } = {}) {
  const balance = Math.max(0, int(balanceCents) || 0);
  const total = int(totalCents);
  if (requestedCents == null) return { creditCents: 0, remainderCents: total, note: "credit is never applied automatically (10.5)" };
  const want = int(requestedCents);
  if (!(want >= 0)) return { ok: false, reason: "an amount of credit is a whole number of cents" };
  if (want > balance) return { ok: false, reason: `only ${balance} cents of credit are available` };
  if (want > total) return { ok: false, reason: "credit cannot exceed the total" };
  return { ok: true, creditCents: want, remainderCents: total - want };
}

/** The BRDCST bonus for the share paid with credit, rounded down (5.29–5.30). */
export function brdcstBonus({ creditCents = 0, totalCents = 0, days = 0, miles = 0 } = {}) {
  const c = Math.max(0, int(creditCents) || 0), t = int(totalCents);
  if (!(t > 0) || c <= 0) return { days: 0, miles: 0, share: 0 };
  const share = Math.min(1, c / t);
  return { days: Math.floor(share * (Number(days) || 0)), miles: Math.floor(share * (Number(miles) || 0)), share: Math.round(share * 1000) / 1000 };
}

/** A refund's offer: credit first, with the BRDCST bonus when it was a BRDCST; the original method only after declining (5.26). */
export function refundOffer({ amountCents, brdcst = false } = {}) {
  const a = int(amountCents);
  if (!(a > 0)) return { ok: false, reason: "a refund is a positive whole number of cents" };
  return {
    ok: true, first: "credit",
    credit: { amountCents: a, bonus: brdcst ? { ...BRDCST_REFUND_BONUS, either: true } : null },
    original: { amountCents: a, offeredAfterDecline: true },
  };
}

/** The gift's requirements (5.29, 10.4): both proofs, a positive amount, within the balance, not to oneself. */
export function giftCheck({ fromId, toId, amountCents, balanceCents = 0, twoFactor = false, deviceVerified = false } = {}) {
  const missing = [];
  if (twoFactor !== true) missing.push("twoFactor");
  if (deviceVerified !== true) missing.push("deviceVerified");
  if (missing.length) return { ok: false, reason: `a gift needs ${missing.join(" and ")} (10.4)`, missing };
  const a = int(amountCents);
  if (!(a > 0)) return { ok: false, reason: "a gift is a positive whole number of cents" };
  if (!fromId || !toId || fromId === toId) return { ok: false, reason: "a gift goes to another passenger" };
  if (a > Math.max(0, int(balanceCents) || 0)) return { ok: false, reason: "a gift cannot exceed the balance" };
  return { ok: true, amountCents: a };
}

/** Credit does not expire (5.28, 10.3). */
export function expiresAt() { return null; }
