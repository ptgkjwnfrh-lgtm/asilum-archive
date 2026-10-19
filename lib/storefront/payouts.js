// lib/storefront/payouts.js — SELLER PAYOUTS AND THE PLATFORM'S TOP-UPS (V.2
// Blueprint, owner, 17 Oct 2026: 10.12–10.13 item-level payouts after the
// 14-day window held by open issues, 6.7 the covered return label deducted
// from the next payout, 5.32 / 10.5 the share a buyer paid with Credit;
// slice 11). PURE and client-safe.
//
//   THE PAYOUT        merchandise the seller is owed on one paid order, less
//                     deductions (a label ASILUM covered). Its state follows
//                     the delivery and the window (lib/storefront/
//                     protection.js payoutState): waiting_delivery →
//                     held_window → held_issue | releasable → released; a
//                     refunded order voids it.
//   THE TOP-UP (5.32) when a buyer applies Credit the card charge shrinks by
//                     that amount; the seller is still owed the whole
//                     merchandise, so ASILUM owes the seller the credited
//                     share from its own balance — a transfer obligation
//                     recorded at checkout and settled through the provider
//                     when it is keyed; never silently absorbed by the seller.
//   WHERE MONEY SITS  a native sale is a direct charge on the seller's
//                     connected account: the funds are theirs on settlement
//                     and the "hold" is the account's payout schedule; a
//                     Wardrobe private sale is charged on the platform and
//                     released to the owner as a transfer. The ledger says
//                     which (`rail`) and the release names the provider's
//                     reference when money moved — or `pending` when the
//                     provider is not keyed.

import { payoutState } from "./protection.js";

export const RAILS = Object.freeze(["native_storefront", "wardrobe"]);
export const PAYOUT_STATES = Object.freeze(["waiting_delivery", "held_window", "held_issue", "releasable", "released", "void"]);
const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : 0);

/** The payout for one order from its facts. */
export function payoutFor({ order = {}, rail = "native_storefront", deliveredAt = null, openIssues = 0, refunded = false, deductions = [], released = null, now = Date.now() } = {}) {
  const amount = Math.max(0, int(order.merchandise_cents ?? order.amount_cents ?? 0));
  const deductionCents = (deductions || []).reduce((s, d) => s + Math.max(0, int(d.amountCents)), 0);
  if (released && released.at) return { rail, amountCents: amount, deductionCents, netCents: Math.max(0, amount - deductionCents), state: "released", releasableAt: released.releasableAt || null, deductions };
  const ps = payoutState({ deliveredAt, now, openIssues, refunded });
  return { rail, amountCents: amount, deductionCents, netCents: Math.max(0, amount - deductionCents), state: ps.state, releasableAt: ps.releasableAt || ps.at || null, deductions, reason: ps.reason || null };
}

/** May this payout be released now? Only a releasable one, by a human or the job, once. */
export function canRelease(payout = {}) {
  if (!payout || payout.state === "released") return { ok: false, reason: "released already — once" };
  if (payout.state !== "releasable") return { ok: false, reason: `the payout is ${String(payout.state || "unknown").replace("_", " ")}` };
  if (!(payout.netCents > 0)) return { ok: false, reason: "nothing to release after deductions" };
  return { ok: true };
}

/** The platform's top-up for a Credit share (5.32): the credited cents, owed to the seller. */
export function topUpFor({ creditCents = 0, merchandiseCents = 0 } = {}) {
  const c = Math.max(0, int(creditCents)), m = Math.max(0, int(merchandiseCents));
  if (c === 0) return null;
  return { amountCents: Math.min(c, m), basis: "the share of the merchandise the buyer paid with ASILUM Credit, owed to the seller from the platform's balance" };
}

/** Deduct a covered return label (6.7) from the next payout: recorded on the payout, never charged to the buyer. */
export function deductLabel(payout = {}, { returnId, amountCents, note = "return label ASILUM covered (6.7)" } = {}) {
  const a = Math.max(0, int(amountCents));
  if (!a) return payout;
  const deductions = [...(payout.deductions || []), { returnId: String(returnId), amountCents: a, note, at: new Date().toISOString() }];
  const deductionCents = deductions.reduce((s, d) => s + d.amountCents, 0);
  return { ...payout, deductions, deductionCents, netCents: Math.max(0, (payout.amountCents || 0) - deductionCents) };
}
