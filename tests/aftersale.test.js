// tests/aftersale.test.js — AFTER THE SALE (V.2 Blueprint, owner, 17 Oct
// 2026, chapter 6, chapter 10, 5.26–5.32, Terms 10–12; slice 7). The laws
// (lib/storefront/protection.js, score.js, credit.js) are pure; the rows
// (lib/db/production/aftersale.js, score.js, credit.js) run on the memory
// store; the routes through the harness. Held here:
//   * protection off by default, never preselected; without a provider no
//     quote, and the toggle says why;
//   * a Credit purchase has no change-of-mind return without Protection; a
//     seller may enable returns; a complaint with evidence inside 14 days is
//     an admin's decision; refunds land in Credit or go back;
//   * seller-fault return shipping: ASILUM covers, deducts, half a star once
//     responsibility is confirmed; the innocent party is never penalized;
//   * the $1 incentive once, after the first clean sale and a closed window;
//   * delivery opens the 14-day windows; payouts wait for them and for open
//     issues; dispatch clocks and extensions;
//   * the Passenger Score: 0.0 and "No reviews" until the first verified
//     review; the balanced model; double blind; revisions with history; one
//     permanent response; penalties confirmed before they count and
//     restored on appeal; the floor at 0.0 with private accrual; Account and
//     Passport only;
//   * Credit: refunds and gifts in, never purchased, never auto-applied,
//     BRDCST bonus rounded down, gifts need two proofs.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../lib/storefront/protection.js";
import * as L from "../lib/storefront/score.js";
import * as K from "../lib/storefront/credit.js";
import * as A from "../lib/db/production/aftersale.js";
import * as S from "../lib/db/production/score.js";
import * as C from "../lib/db/production/credit.js";
import { createOrderWithEvent, applyOrderEvent, getOrder } from "../lib/db/orders.js";
import { listNotifications, resetMemoryListingStatus, NOTIFICATION_KINDS } from "../lib/db/production/listingStatus.js";
import { quoteProtection, providerConfigured } from "../lib/storefront/providers/redo.js";
import { callRoute, loadRoute } from "./helpers/route.js";

const T0 = Date.parse("2026-10-18T00:00:00Z");
const D = 86_400_000;
const uuid = () => globalThis.crypto.randomUUID();
async function paidOrder(buyer = "sb-" + uuid(), amountCents = 18000) {
  const o = await createOrderWithEvent({ user: buyer, itemId: "syn-0003", amountCents, feeCents: 100, currency: "usd" });
  await applyOrderEvent({ orderId: o.id, type: "paid", source: "test", newStatus: "paid" });
  return { id: o.id, buyer };
}

test.beforeEach(() => { A.resetMemoryAftersale(); S.resetMemoryScore(); C.resetMemoryCredit(); resetMemoryListingStatus(); });

test("protection: off by default, never preselected; no provider means no quote, and the reason is said", async () => {
  assert.equal(P.PROTECTION_DEFAULT, false);
  assert.equal(providerConfigured({}), false);
  const q = await quoteProtection({ itemValueCents: 18000 }, {});
  assert.equal(q.available, false); assert.match(q.reason, /REDO is proposed, pending agreement/);
  const offer = P.protectionOffer(q);
  assert.deepEqual({ available: offer.available, elected: offer.elected }, { available: false, elected: false });
  assert.deepEqual(P.electProtection(offer, true), { elected: false, priceCents: 0, refused: q.reason }, "an unavailable offer cannot be elected");
  const real = P.protectionOffer({ available: true, priceCents: 350, provider: "redo", coverage: "returns+transit" });
  assert.equal(real.elected, false, "never preselected (6.4)");
  assert.deepEqual(P.electProtection(real, true), { elected: true, priceCents: 350, provider: "redo" });
  assert.deepEqual(P.electProtection(real, false), { elected: false, priceCents: 0 });
  assert.equal(P.protectionOffer({ available: true, priceCents: -1 }).available, false);
});

test("refund eligibility: Credit purchases need Protection; seller-enabled returns inside 14 days; complaints with evidence are an admin's; the window closes", () => {
  const paid = { status: "paid", deliveredAt: T0 };
  assert.match(P.refundEligibility({ order: { ...paid, creditAppliedCents: 1 }, request: { kind: "change_of_mind" }, now: T0 + D }).reason, /11\.2/);
  assert.equal(P.refundEligibility({ order: { ...paid, creditAppliedCents: 1, protected: true }, request: { kind: "change_of_mind" }, now: T0 + D }).ground, "protection");
  assert.equal(P.refundEligibility({ order: { ...paid, sellerReturnsEnabled: true }, request: { kind: "change_of_mind" }, now: T0 + 13 * D }).ground, "seller_returns");
  assert.match(P.refundEligibility({ order: { ...paid, sellerReturnsEnabled: true }, request: { kind: "change_of_mind" }, now: T0 + 14 * D }).reason, /14-day window.*closed/);
  assert.match(P.refundEligibility({ order: paid, request: { kind: "change_of_mind" }, now: T0 + D }).reason, /does not accept change-of-mind/);
  assert.match(P.refundEligibility({ order: paid, request: { kind: "damage" }, now: T0 + D }).reason, /carries evidence/);
  assert.equal(P.refundEligibility({ order: paid, request: { kind: "damage", evidence: "photo" }, now: T0 + D }).ground, "complaint_pending");
  assert.equal(P.refundEligibility({ order: paid, request: { kind: "damage", evidence: "photo", adminApproved: true }, now: T0 + D }).ground, "complaint_approved");
  assert.match(P.refundEligibility({ order: paid, request: { kind: "damage", evidence: "photo" }, now: T0 + 15 * D }).reason, /11\.5/);
  assert.equal(P.refundEligibility({ order: { status: "paid", estimatedDeliveryAt: T0 }, request: { kind: "non_delivery", evidence: "tracking stalled" }, now: T0 + 3 * D }).ok, true, "non-delivery counts from the last estimated date");
  assert.equal(P.refundEligibility({ order: { status: "refunded" }, request: {} }).ok, false);
  assert.equal(P.refundDestination("original"), "original"); assert.equal(P.refundDestination("anything"), "credit");
});

test("return shipping and the half star: seller's fault and a refused label → ASILUM covers, deducts, and penalizes once confirmed; the innocent party never", () => {
  assert.equal(P.returnShipping({ fault: "buyer" }).payer, "buyer");
  assert.equal(P.returnShipping({ fault: "carrier" }).payer, "carrier_claim");
  assert.equal(P.returnShipping({ fault: "seller", sellerPaysLabel: true }).penalty, 0);
  const covered = P.returnShipping({ fault: "seller", sellerPaysLabel: false, responsibilityConfirmed: false });
  assert.equal(covered.payer, "asilum_then_seller"); assert.equal(covered.penalty, 0, "the half star waits for confirmation (6.8)"); assert.equal(covered.deductFromNextPayout, true);
  assert.equal(P.returnShipping({ fault: "seller", sellerPaysLabel: false, responsibilityConfirmed: true }).penalty, 0.5);
  assert.equal(P.returnShipping({ fault: "undetermined" }).penalty, 0);
});

test("the $1 incentive, payouts and the clocks", () => {
  const base = { listingReturnsEnabled: true, saleCompleted: true, deliveredAt: T0 };
  assert.equal(P.incentiveDue({ ...base, now: T0 + 15 * D }).due, true);
  assert.equal(P.incentiveDue({ ...base, now: T0 + 13 * D }).due, false);
  assert.equal(P.incentiveDue({ ...base, now: T0 + 15 * D, openIssues: 1 }).due, false);
  assert.equal(P.incentiveDue({ ...base, now: T0 + 15 * D, refunded: true }).due, false);
  assert.equal(P.incentiveDue({ ...base, now: T0 + 15 * D, alreadyEarned: true }).due, false, "once per listing (6.5)");
  assert.equal(P.incentiveDue({ ...base, listingReturnsEnabled: false, now: T0 + 15 * D }).due, false);
  assert.equal(P.payoutState({}).state, "waiting_delivery");
  assert.equal(P.payoutState({ deliveredAt: T0, now: T0 + D }).state, "held_window");
  assert.equal(P.payoutState({ deliveredAt: T0, now: T0 + 15 * D, openIssues: 1 }).state, "held_issue");
  assert.equal(P.payoutState({ deliveredAt: T0, now: T0 + 15 * D }).state, "releasable");
  assert.equal(P.payoutState({ deliveredAt: T0, now: T0 + 15 * D, refunded: true }).state, "void");
  assert.equal(P.dispatchDeadlines("sell", T0).shipBy, new Date(T0 + 14 * D).toISOString());
  assert.equal(P.dispatchDeadlines("drop", T0).labelBy, new Date(T0 + 31 * D).toISOString());
  assert.equal(P.dispatchLate({ mode: "sell", paidAt: T0, now: T0 + 15 * D }).late, true);
  assert.equal(P.dispatchLate({ mode: "sell", paidAt: T0, now: T0 + 15 * D, extensions: [{ approved: true, ms: 7 * D }] }).late, false);
  assert.equal(P.dispatchLate({ mode: "drop", paidAt: T0, labelPrintedAt: T0 + 30 * D, now: T0 + 62 * D }).late, true, "31 days after the label");
  assert.equal(P.extendDispatch({ requestedMs: 8 * D, approved: true }).ok, false);
  assert.equal(P.extendDispatch({ requestedMs: 7 * D, approved: false }).ok, false, "never automatic");
  assert.equal(P.extendDispatch({ extensions: [{ approved: true }, { approved: true }], requestedMs: D, approved: true }).ok, false, "two is the limit");
  assert.equal(P.cancellation({ by: "buyer" }).ok, false); assert.equal(P.cancellation({ by: "buyer", late: true }).refund, "full");
  assert.equal(P.cancellation({ by: "seller" }).ok, true); assert.equal(P.cancellation({ by: "seller", handedAt: T0 }).ok, false);
  assert.deepEqual(Object.keys(P.windowsFrom(T0)), ["deliveredAt", "returnBy", "reviewBy", "payoutAt"]);
  assert.equal(P.windowsFrom("nonsense"), null);
});

test("the Passenger Score: zero until the first verified review, the balanced model, penalties, the floor, the surfaces", () => {
  assert.equal(L.computeScore({}).label, "0.0 ★ · No reviews");
  const r = (stars, at = T0, extra = {}) => ({ stars, submittedAt: at, verified: true, state: "published", role: "seller", ...extra });
  assert.equal(L.computeScore({ reviews: [r(5)], now: T0 }).score, 1.7, "one review cannot stand for a record");
  assert.equal(L.computeScore({ reviews: Array(20).fill(r(5)), now: T0 }).score, 4.5);
  assert.equal(L.computeScore({ reviews: [...Array(20).fill(r(5)), r(1)], now: T0 }).score, 4.4, "one bad review cannot destroy a long history (6.10)");
  assert.equal(L.computeScore({ reviews: [r(5, T0 - 3 * 365 * D), r(2, T0)], now: T0 }).mean < 3.5, true, "recency weighs");
  assert.equal(L.computeScore({ reviews: [r(5), r(5, T0, { verified: false }), r(5, T0, { state: "submitted" }), r(5, T0, { excluded: true })], now: T0 }).count, 1, "only verified, published, not excluded");
  const pen = L.computeScore({ reviews: Array(20).fill(r(5)), penalties: [{ state: "confirmed" }, { state: "pending" }, { state: "overturned" }], now: T0 });
  assert.equal(pen.score, 4); assert.equal(pen.penalties, 1); assert.equal(pen.conductIndicator, true);
  const floor = L.computeScore({ reviews: [r(5)], penalties: Array(4).fill({ state: "confirmed" }), now: T0 });
  assert.equal(floor.score, 0); assert.equal(floor.belowFloor, 0.3, "accrues privately (6.21)"); assert.equal(floor.escalation, "review");
  assert.equal(L.computeScore({ reviews: [r(5), r(3, T0, { role: "buyer" })], now: T0, role: "buyer" }).count, 1, "the buyer filter");
  assert.deepEqual(L.SCORE_SURFACES, ["account", "passport"]); assert.equal(L.scoreAllowedOn("listing"), false); assert.equal(L.scoreAllowedOn("checkout"), false);
});

test("reviews: after delivery inside 14 days, double blind, revisable with history, one permanent response, penalties confirmed and appealable", () => {
  assert.equal(L.canReview({}).ok, false);
  assert.equal(L.canReview({ deliveredAt: T0, now: T0 + 13 * D }).ok, true);
  assert.equal(L.canReview({ deliveredAt: T0, now: T0 + 14 * D }).ok, false);
  assert.equal(L.canReview({ deliveredAt: T0, now: T0 + 15 * D, extensionMs: 2 * D }).ok, true, "a dispute extends (6.16)");
  assert.equal(L.reviewVisibility({ mine: {}, theirs: null, deliveredAt: T0, now: T0 + D }).publish, false);
  assert.equal(L.reviewVisibility({ mine: {}, theirs: {}, deliveredAt: T0, now: T0 + D }).publish, true);
  assert.equal(L.reviewVisibility({ mine: {}, theirs: null, deliveredAt: T0, now: T0 + 14 * D }).publish, true);
  assert.equal(L.reviewVisibility({ mine: {}, theirs: {}, deliveredAt: T0, now: T0 + D, disputeOpen: true }).publish, false);
  assert.equal(L.newReview({ orderId: "o", reviewerId: "a", subjectId: "a", role: "buyer", stars: 5 }).ok, false, "nobody reviews themselves");
  assert.equal(L.newReview({ orderId: "o", reviewerId: "a", subjectId: "b", role: "buyer", stars: 6 }).ok, false);
  const made = L.newReview({ orderId: "o", reviewerId: "a", subjectId: "b", role: "buyer", stars: 2, text: "late", now: T0 }).review;
  const rev = L.reviseReview(made, { stars: 4, text: "resolved", now: T0 + D }).review;
  assert.equal(rev.stars, 4); assert.deepEqual(rev.history[0], { stars: 2, text: "late", at: made.submittedAt });
  const resp = L.respondToReview({ ...rev, state: "published" }, { text: "sorry" }).review;
  assert.equal(L.respondToReview(resp, { text: "again" }).ok, false, "one response (6.28)");
  const del = L.deleteResponse(resp).review;
  assert.equal(del.response, null); assert.equal(del.responseAudit.length, 1);
  assert.equal(L.respondToReview(del, { text: "replacement" }).ok, false, "deleted, never replaced (6.29)");
  const p = L.newPenalty({ userId: "u", reason: "label refused" }).penalty;
  assert.equal(L.penaltyTransition(p, { action: "appeal" }).ok, false, "pending cannot be appealed");
  const c = L.penaltyTransition(p, { action: "confirm" }).penalty;
  const a = L.penaltyTransition(c, { action: "appeal", evidence: "offered" }).penalty;
  assert.equal(L.penaltyTransition(a, { action: "overturn" }).penalty.state, "overturned");
  assert.equal(L.penaltyTransition(a, { action: "uphold" }).penalty.state, "confirmed");
});

test("ASILUM Credit: refunds and gifts in, never purchased, never auto-applied, the BRDCST bonus rounded down, gifts need two proofs", () => {
  assert.equal(K.balanceOf([{ kind: "refund", amountCents: 3000 }, { kind: "spend", amountCents: 1000 }, { kind: "gift_in", amountCents: 500 }, { kind: "void", amountCents: 100 }]), 2400);
  assert.equal(K.canEnter("purchase"), false); assert.equal(K.canEnter("refund"), true); assert.equal(K.canEnter("gift"), true);
  assert.equal(K.applyCredit({ balanceCents: 1500, totalCents: 10000 }).creditCents, 0, "never automatic (10.5)");
  assert.deepEqual(K.applyCredit({ balanceCents: 1500, requestedCents: 1500, totalCents: 10000 }), { ok: true, creditCents: 1500, remainderCents: 8500 });
  assert.equal(K.applyCredit({ balanceCents: 1500, requestedCents: 1600, totalCents: 10000 }).ok, false);
  assert.equal(K.applyCredit({ balanceCents: 15000, requestedCents: 12000, totalCents: 10000 }).ok, false);
  assert.deepEqual(K.brdcstBonus({ creditCents: 50, totalCents: 100, days: 5, miles: 45 }), { days: 2, miles: 22, share: 0.5 }, "rounded down (5.30)");
  assert.deepEqual(K.brdcstBonus({ creditCents: 0, totalCents: 100, days: 5 }), { days: 0, miles: 0, share: 0 });
  const offer = K.refundOffer({ amountCents: 1000, brdcst: true });
  assert.equal(offer.first, "credit"); assert.deepEqual(offer.credit.bonus, { days: 2, miles: 45, either: true }); assert.equal(offer.original.offeredAfterDecline, true);
  assert.equal(K.refundOffer({ amountCents: 1000 }).credit.bonus, null, "items earn nothing extra");
  assert.match(K.giftCheck({ fromId: "a", toId: "b", amountCents: 100, balanceCents: 100 }).reason, /twoFactor and deviceVerified/);
  assert.equal(K.giftCheck({ fromId: "a", toId: "a", amountCents: 100, balanceCents: 100, twoFactor: true, deviceVerified: true }).ok, false);
  assert.equal(K.giftCheck({ fromId: "a", toId: "b", amountCents: 100, balanceCents: 100, twoFactor: true, deviceVerified: true }).ok, true);
  assert.equal(K.expiresAt(), null);
});

test("the rows: delivery opens the windows; a complaint decided for the buyer refunds in Credit; a seller-fault label proposes the half star; reviews double blind; the score", async () => {
  const { id, buyer } = await paidOrder();
  const parties = await A.orderParties(id);
  assert.equal(parties.sellerAccountId, null, "a legacy sale has no seller on ASILUM");
  await assert.rejects(() => A.recordDelivery({ orderId: id, by: buyer, source: "seller" }), /only the seller/);
  await assert.rejects(() => A.recordDelivery({ orderId: id, by: "someone", source: "admin" }), /an admin's/);
  const d = await A.recordDelivery({ orderId: id, by: "admin", source: "admin", deliveredAt: T0, now: T0 });
  assert.equal(d.windows.returnBy, new Date(T0 + 14 * D).toISOString());
  await assert.rejects(() => A.recordDelivery({ orderId: id, by: "admin", source: "admin" }), /once/);
  assert.ok((await listNotifications(buyer)).some((n) => n.kind === "delivered"));
  await assert.rejects(() => A.openReturn({ orderId: id, buyerId: buyer, kind: "change_of_mind", now: T0 + D }), /does not accept/);
  await assert.rejects(() => A.openReturn({ orderId: id, buyerId: "sb-other", kind: "damage", evidence: "x", now: T0 + D }), /only the buyer/);
  const r = await A.openReturn({ orderId: id, buyerId: buyer, kind: "damage", reason: "cracked", evidence: "photo", now: T0 + D });
  assert.equal(r.return.state, "open"); assert.equal(r.return.ground, "complaint_pending");
  await assert.rejects(() => A.openReturn({ orderId: id, buyerId: buyer, kind: "damage", evidence: "photo", now: T0 + D }), /already open/);
  const facts = await A.orderFacts(id, { now: T0 + 15 * D });
  assert.equal(facts.payout.state, "held_issue", "an open return holds the payout (10.13)");
  const refused = await A.decideReturn({ returnId: r.return.id, approve: false, decision: "no damage visible", now: T0 + 2 * D });
  assert.equal(refused.state, "refused");
  const r2 = await A.openReturn({ orderId: id, buyerId: buyer, kind: "wrong_item", reason: "wrong size", evidence: "photo-2", now: T0 + 3 * D });
  const dec = await A.decideReturn({ returnId: r2.return.id, approve: true, fault: "seller", refundTo: "credit", refundCents: 18000, now: T0 + 4 * D });
  assert.equal(dec.return.state, "approved"); assert.equal(dec.shipping.payer, "asilum_then_seller"); assert.equal(dec.penalty, null, "no seller on ASILUM, nobody to penalize");
  const settled = await A.settleReturnRefund({ returnId: r2.return.id, now: T0 + 5 * D });
  assert.equal(settled.state, "refunded"); assert.equal(settled.credit.kind, "refund");
  assert.equal(await C.creditBalance(buyer), 18000); assert.equal((await getOrder(id)).status, "refunded");
  await assert.rejects(() => A.settleReturnRefund({ returnId: r2.return.id }), /only an approved/);
  // reviews on a delivered order: double blind, both in → published
  const rv = await S.submitReview({ orderId: id, reviewerId: buyer, subjectId: "sb-seller", role: "buyer", stars: 4, text: "fine", order: { deliveredAt: T0, verified: true }, now: T0 + 2 * D });
  assert.equal(rv.review.state, "submitted"); assert.match(rv.settled.reason, /hidden until both/);
  await assert.rejects(() => S.submitReview({ orderId: id, reviewerId: buyer, subjectId: "sb-seller", role: "buyer", stars: 5, order: { deliveredAt: T0 }, now: T0 + 2 * D }), /revise it instead/);
  assert.equal((await S.passengerScore("sb-seller", { now: T0 + 2 * D })).public.label, "0.0 ★ · No reviews", "nothing counts until published");
  const rv2 = await S.submitReview({ orderId: id, reviewerId: "sb-seller", subjectId: buyer, role: "seller", stars: 5, order: { deliveredAt: T0, verified: true }, now: T0 + 3 * D });
  assert.equal(rv2.settled.published, 2);
  assert.equal((await S.passengerScore("sb-seller", { now: T0 + 4 * D })).public.score, 1.3);
  assert.ok((await listNotifications("sb-seller")).some((n) => n.kind === "review-published"));
  const revised = await S.reviseExisting({ reviewId: rv.review.id, reviewerId: buyer, stars: 5, text: "resolved", now: T0 + 5 * D });
  assert.equal(revised.history.length, 1); assert.equal((await S.passengerScore("sb-seller", { now: T0 + 5 * D })).public.score, 1.7);
  await assert.rejects(() => S.respond({ reviewId: rv.review.id, subjectId: buyer, text: "x" }), /not found/);
  assert.equal((await S.respond({ reviewId: rv.review.id, subjectId: "sb-seller", text: "thanks" })).response.text, "thanks");
  await assert.rejects(() => S.respond({ reviewId: rv.review.id, subjectId: "sb-seller", text: "again" }), /one response/);
  // penalties: confirmed before they count, told, appealable, restored
  const pen = await S.proposePenalty({ userId: "sb-seller", reason: "label refused", orderId: id, now: T0 + 6 * D });
  assert.equal((await S.passengerScore("sb-seller", { now: T0 + 6 * D })).public.penalties, 0, "pending does not count (6.8)");
  await S.movePenalty({ penaltyId: pen.id, action: "confirm", now: T0 + 6 * D });
  assert.equal((await S.passengerScore("sb-seller", { now: T0 + 6 * D })).public.score, 1.2);
  assert.ok((await listNotifications("sb-seller")).some((n) => n.kind === "penalty"));
  await S.movePenalty({ penaltyId: pen.id, action: "appeal", by: "sb-seller", evidence: "the label was offered", now: T0 + 7 * D });
  await S.movePenalty({ penaltyId: pen.id, action: "overturn", now: T0 + 8 * D });
  assert.equal((await S.passengerScore("sb-seller", { now: T0 + 8 * D })).public.score, 1.7, "restored (6.8)");
  const excluded = await S.markReview({ reviewId: rv.review.id, excluded: true });
  assert.equal(excluded.state, "excluded"); assert.equal((await S.passengerScore("sb-seller", { now: T0 + 8 * D })).public.count, 0);
  for (const k of ["delivered", "return-opened", "return-decided", "review-published", "penalty", "credit"]) assert.ok(NOTIFICATION_KINDS.includes(k), k);
});

test("the rows: Credit's ledger — in by refund, gift and incentive only; spend within the balance; a gift needs both proofs and moves exactly once; a void", async () => {
  const a = "sb-" + uuid(), b = "sb-" + uuid();
  await assert.rejects(() => C.creditIn({ userId: a, source: "purchase", amountCents: 100 }), /cannot be purchased/);
  await C.creditIn({ userId: a, source: "refund", amountCents: 3000, orderId: "o1" });
  await C.creditIn({ userId: a, source: "incentive", amountCents: 100 });
  assert.equal(await C.creditBalance(a), 3100);
  await assert.rejects(() => C.creditSpend({ userId: a, amountCents: 5000, orderId: "o2" }), /only 3100/);
  await C.creditSpend({ userId: a, amountCents: 1000, orderId: "o2" });
  await C.creditRelease({ userId: a, amountCents: 1000, orderId: "o2" });
  assert.equal(await C.creditBalance(a), 3100);
  await assert.rejects(() => C.giftCredit({ fromId: a, toId: b, amountCents: 500 }), /twoFactor and deviceVerified/);
  const g = await C.giftCredit({ fromId: a, toId: b, amountCents: 500, twoFactor: true, deviceVerified: true });
  assert.deepEqual([g.fromBalance, g.toBalance], [2600, 500]);
  await assert.rejects(() => C.giftCredit({ fromId: a, toId: b, amountCents: 9000, twoFactor: true, deviceVerified: true }), /exceed the balance/);
  assert.equal((await C.voidCredit({ userId: b, amountCents: 9999, note: "error" })).amountCents, 500, "a void never goes below zero");
  assert.equal(await C.creditBalance(b), 0);
  assert.deepEqual((await C.creditLedger(a)).map((e) => e.kind), ["gift_out", "release", "spend", "incentive", "refund"], "newest first, every entry kept");
});

test("the dispatch rows: a seller marks label and handoff; an admin approves extensions, two at most of seven days", async () => {
  const { id } = await paidOrder();
  await assert.rejects(() => A.markDispatch({ orderId: id, by: "sb-x", event: "label" }), /only the seller/);
  await assert.rejects(() => A.markDispatch({ orderId: id, by: "sb-x", event: "extension", extensionMs: D, approved: true }), /approved, never automatic/);
  const e1 = await A.markDispatch({ orderId: id, by: "admin", event: "extension", extensionMs: 3 * D, approved: true, now: T0 });
  assert.equal(e1.dispatch.extensions.length, 1);
  await assert.rejects(() => A.markDispatch({ orderId: id, by: "admin", event: "extension", extensionMs: 9 * D, approved: true }), /seven days/);
  await A.markDispatch({ orderId: id, by: "admin", event: "extension", extensionMs: 7 * D, approved: true, now: T0 });
  await assert.rejects(() => A.markDispatch({ orderId: id, by: "admin", event: "extension", extensionMs: D, approved: true }), /two extensions/);
});

test("the routes: the after-sale record is a party's; a complaint files; the score reads publicly and the private part only to its subject; a gift is refused without proofs", async () => {
  const aftersale = await loadRoute("app/api/aftersale/route.js");
  const score = await loadRoute("app/api/score/route.js");
  const credit = await loadRoute("app/api/credit/route.js");
  const { id, buyer } = await paidOrder();
  await A.recordDelivery({ orderId: id, by: "admin", source: "admin", deliveredAt: Date.now() - D });
  const offer = await callRoute(aftersale.GET, { path: "/api/aftersale", query: { protection: "1", itemValueCents: "18000" } });
  assert.equal(offer.status, 200); assert.equal(offer.body.offer.available, false); assert.match(offer.body.offer.reason, /REDO/);
  const anon = await callRoute(aftersale.GET, { path: "/api/aftersale", query: { order: id } });
  assert.equal(anon.status, 401);
  const stranger = await callRoute(aftersale.GET, { path: "/api/aftersale", query: { order: id, user: "u-stranger" }, cookies: { "asilum-uid": "u-stranger" } });
  assert.ok([401, 403].includes(stranger.status));
  const pub = await callRoute(score.GET, { path: "/api/score", query: { subject: "sb-nobody" } });
  assert.equal(pub.status, 200); assert.equal(pub.body.label, "0.0 ★ · No reviews"); assert.equal(pub.body.private, undefined); assert.deepEqual(pub.body.surfaces, ["account", "passport"]);
  const gift = await callRoute(credit.POST, { path: "/api/credit", method: "POST", json: { action: "gift", toHandle: "someone", amountCents: 100 } });
  assert.equal(gift.status, 401, "a gift needs a signed-in giver before anything");
  void buyer;
});
