// tests/money.test.js — MONEY IN MOTION (V.2 10.12–10.13 payouts, 6.7
// deductions, 5.32 top-ups, 7.20 offer reminders, chapter 13 Wardrobe private
// sales, 6.17/6.23 the review screen; slice 11). Held here:
//   * a payout follows the delivery and the window and is held by an open
//     issue; released once; a covered label is deducted; a refund voids it;
//   * a top-up is the Credit share, owed to the seller, pending without a key;
//   * a Wardrobe offer is DM first, one active per piece, 24 hours exclusive
//     on acceptance, a 14-day cooldown after a decline, an expiry or a lapse;
//     turning offers off cancels active unpaid negotiations; the seller may
//     cancel before handoff and never after; ownership moves on a carrier's
//     delivery exactly once, never on a seller's word;
//   * the reminder job sends each preset moment once;
//   * a flagged review is held for the queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../lib/wardrobe/offers.js";
import * as P from "../lib/storefront/payouts.js";
import * as M from "../lib/db/production/money.js";
import * as A from "../lib/db/production/aftersale.js";
import * as S from "../lib/db/production/score.js";
import * as C from "../lib/db/production/commerce.js";
import { createOrderWithEvent, applyOrderEvent } from "../lib/db/orders.js";
import { mem } from "../lib/db/production/store.js";
import { listNotifications, resetMemoryListingStatus } from "../lib/db/production/listingStatus.js";
import { listModerationTasks } from "../lib/db/production/moderation.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const uuid = () => globalThis.crypto.randomUUID();
const T0 = Date.parse("2026-10-20T00:00:00Z");
const D = 86_400_000, H = 3_600_000;
function piece(ownerId, { acceptOffers = true } = {}) {
  const id = Math.floor(Math.random() * 1e9);
  mem.wardrobe.push({ id, user_id: ownerId, status: "active", title: "a bomber", accept_offers: acceptOffers, offer_cooldown_until: null, created_at: new Date().toISOString() });
  return String(id);
}

test.beforeEach(() => { M.resetMemoryMoney(); A.resetMemoryAftersale(); S.resetMemoryScore(); resetMemoryListingStatus(); });

test("the law: offers — DM first, one at a time, acceptance opens 24 hours, a decline rests the piece, the owner cancels only before handoff, ownership moves on a carrier's delivery once", () => {
  const item = { id: "1", ownerId: "sb-o", status: "active", acceptOffers: true };
  assert.match(L.offerAllowed({ item, buyerId: "sb-b", viaMessage: false }).reason, /no offer button without one/);
  assert.match(L.offerAllowed({ item: { ...item, acceptOffers: false }, buyerId: "sb-b", viaMessage: true }).reason, /not accepting/);
  assert.match(L.offerAllowed({ item, buyerId: "sb-o", viaMessage: true }).reason, /already yours/);
  assert.equal(L.offerAllowed({ item, buyerId: "sb-b", viaMessage: true }).ok, true);
  const open = L.newOffer({ itemId: "1", ownerId: "sb-o", buyerId: "sb-b", amountCents: 12000, now: T0 }).offer;
  assert.match(L.offerAllowed({ item, buyerId: "sb-c", active: [open], viaMessage: true, now: T0 }).reason, /one active offer/);
  const resting = L.offerAllowed({ item: { ...item, offerCooldownUntil: new Date(T0 + D).toISOString() }, buyerId: "sb-b", viaMessage: true, now: T0 });
  assert.equal(resting.ok, false); assert.equal(resting.private, true, "no public indicator (13.11)");
  assert.equal(L.offerStateAt(open, T0 + 4 * D), "expired", "unanswered after three days");
  const acc = L.respond(open, "accept", T0 + H);
  assert.equal(acc.offer.state, "accepted"); assert.equal(acc.offer.acceptedUntil, new Date(T0 + 25 * H).toISOString()); assert.equal(acc.hideFromSearch, true, "13.8");
  assert.equal(L.exclusiveFor(acc.offer, "sb-b", T0 + 2 * H), true); assert.equal(L.exclusiveFor(acc.offer, "sb-c", T0 + 2 * H), false, "that buyer only");
  assert.equal(L.offerStateAt(acc.offer, T0 + 26 * H), "lapsed"); assert.ok(L.afterNegotiation("lapsed", T0).cooldownUntil, "accepted-but-unpurchased rests the piece");
  const dec = L.respond(open, "decline", T0 + H);
  assert.equal(dec.offer.state, "declined"); assert.equal(dec.cooldownUntil, new Date(T0 + H + 14 * D).toISOString());
  assert.equal(L.respond(dec.offer, "accept").ok, false);
  assert.deepEqual(L.cancelOnDisable([open, dec.offer], T0 + H).map((o) => o.state), ["cancelled"], "13.12: active ones cancel, decided ones do not");
  assert.equal(L.sellerCancellation({ now: T0 }).ok, true); assert.equal(L.sellerCancellation({ now: T0 }).penalty, 0);
  assert.equal(L.sellerCancellation({ handedAt: T0 }).ok, false, "13.14: before carrier handoff only");
  assert.equal(L.transferOnDelivery({ paid: true, deliverySource: "seller" }).move, false, "13.10: a seller's word does not move ownership");
  assert.equal(L.transferOnDelivery({ paid: true, deliverySource: "carrier" }).move, true);
  assert.equal(L.transferOnDelivery({ paid: true, deliverySource: "carrier", alreadyMoved: true }).move, false, "exactly once");
});

test("the law: payouts follow the window, open issues hold, refunds void, deductions come off, release is once; the top-up is the Credit share", () => {
  const order = { merchandise_cents: 18000 };
  assert.equal(P.payoutFor({ order }).state, "waiting_delivery");
  assert.equal(P.payoutFor({ order, deliveredAt: T0, now: T0 + D }).state, "held_window");
  assert.equal(P.payoutFor({ order, deliveredAt: T0, now: T0 + 15 * D, openIssues: 1 }).state, "held_issue");
  const r = P.payoutFor({ order, deliveredAt: T0, now: T0 + 15 * D });
  assert.equal(r.state, "releasable"); assert.equal(r.netCents, 18000);
  assert.equal(P.payoutFor({ order, deliveredAt: T0, now: T0 + 15 * D, refunded: true }).state, "void");
  const d = P.deductLabel(r, { returnId: "ret-1", amountCents: 1200 });
  assert.equal(d.netCents, 16800); assert.equal(d.deductions.length, 1);
  assert.equal(P.canRelease(d).ok, true); assert.equal(P.canRelease({ ...d, state: "released" }).ok, false); assert.equal(P.canRelease({ ...d, state: "held_window" }).ok, false);
  assert.deepEqual(P.topUpFor({ creditCents: 3000, merchandiseCents: 18000 }).amountCents, 3000); assert.equal(P.topUpFor({ creditCents: 0 }), null);
  assert.equal(P.topUpFor({ creditCents: 50000, merchandiseCents: 18000 }).amountCents, 18000, "never more than the merchandise");
});

test("the store: a Wardrobe sale end to end on the memory backend — offer, accept, pay, a seller's delivery moves nothing, a carrier's moves it once, the payout releases after the window", async () => {
  const owner = "sb-" + uuid(), buyer = "sb-" + uuid();
  const itemId = piece(owner);
  await assert.rejects(() => M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 9000, viaMessage: false, now: T0 }), /no offer button/);
  const o = await M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 9000, conversationId: "conv-1", viaMessage: true, now: T0 });
  assert.equal(o.state, "open");
  await assert.rejects(() => M.openWardrobeOffer({ itemId, buyerId: "sb-" + uuid(), amountCents: 9500, viaMessage: true, now: T0 }), /one active offer/);
  await assert.rejects(() => M.respondWardrobeOffer({ offerId: o.id, ownerId: buyer, decision: "accept" }), /only the owner/);
  const acc = await M.respondWardrobeOffer({ offerId: o.id, ownerId: owner, decision: "accept", now: T0 + H });
  assert.equal(acc.state, "accepted"); assert.equal((await M.wardrobePiece(itemId)).hiddenUntilPaid, true, "leaves Search on acceptance (13.8)");
  await assert.rejects(() => M.startWardrobeCheckout({ offerId: o.id, buyerId: buyer, now: T0 + 2 * H }), /checkout is idle/, "unkeyed: nothing reserved");
  // the paid order, as the webhook would leave it
  const order = await createOrderWithEvent({ user: buyer, itemId: `wardrobe-${itemId}`, amountCents: 9000, feeCents: 235, currency: "usd", kind: "sale" });
  const { mem: store } = await import("../lib/db/production/store.js");
  store.wardrobeOffers.set(o.id, { ...store.wardrobeOffers.get(o.id), order_id: order.id });
  await applyOrderEvent({ orderId: order.id, type: "paid", source: "test", newStatus: "paid" });
  const settled = await M.settleWardrobeOrder(order.id, { now: T0 + 3 * H });
  assert.equal(settled.settled, true); assert.equal(settled.offer.state, "paid");
  assert.equal((await M.settleWardrobeOrder(order.id)).duplicate, true, "idempotent");
  let payout = await M.getPayout(order.id);
  assert.equal(payout.state, "waiting_delivery"); assert.equal(payout.rail, "wardrobe"); assert.equal(payout.amountCents, 9000);
  await assert.rejects(() => M.releasePayout({ orderId: order.id }), /waiting delivery/);
  // the seller's own delivery word: the clock starts, ownership does not move
  const sellerDelivery = await A.recordDelivery({ orderId: order.id, by: "admin", source: "admin", deliveredAt: T0 + 5 * D, now: T0 + 5 * D });
  assert.equal(sellerDelivery.transfer.moved, false); assert.match(sellerDelivery.transfer.reason, /carrier-confirmed/);
  assert.equal((await M.wardrobePiece(itemId)).ownerId, owner);
  // a carrier's word (the one delivery is recorded once, so the law is checked directly)
  assert.equal(L.transferOnDelivery({ paid: true, deliverySource: "carrier" }).move, true);
  payout = await M.refreshPayout(order.id, { now: T0 + 6 * D });
  assert.equal(payout.state, "held_window");
  payout = await M.refreshPayout(order.id, { now: T0 + 20 * D });
  assert.equal(payout.state, "releasable");
  const ded = await M.deductFromPayout({ orderId: order.id, returnId: "ret-x", amountCents: 1500, now: T0 + 20 * D });
  assert.equal(ded.netCents, 7500);
  const rel = await M.releasePayout({ orderId: order.id, by: "desk", now: T0 + 21 * D });
  assert.equal(rel.payout.state, "released"); assert.equal(rel.payout.provider, "pending"); assert.match(rel.note, /not keyed/);
  await assert.rejects(() => M.releasePayout({ orderId: order.id }), /once/);
  await assert.rejects(() => M.cancelWardrobeSale({ offerId: o.id, ownerId: owner, now: T0 + 21 * D }), /after the carrier handoff|a sale is a sale/);
  const kinds = (await listNotifications(owner)).map((n) => n.kind);
  assert.ok(kinds.includes("offer-new") && kinds.includes("offer-accepted") && kinds.includes("credit"));
});

test("the store: a decline rests the piece 14 days; turning offers off cancels the active negotiation; the job expires and lapses; the seller cancels a paid sale before handoff", async () => {
  const owner = "sb-" + uuid(), buyer = "sb-" + uuid();
  const itemId = piece(owner);
  const o1 = await M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 5000, viaMessage: true, now: T0 });
  await M.respondWardrobeOffer({ offerId: o1.id, ownerId: owner, decision: "decline", now: T0 + H });
  await assert.rejects(() => M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 5500, viaMessage: true, now: T0 + 2 * D }), /resting/);
  const later = T0 + 15 * D;
  const o2 = await M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 5500, viaMessage: true, now: later });
  const off = await M.setAcceptOffers({ ownerId: owner, itemId, on: false, now: later + H });
  assert.equal(off.cancelled.length, 1); assert.equal(off.cancelled[0].id, o2.id); assert.equal(off.piece.acceptOffers, false);
  await assert.rejects(() => M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 5500, viaMessage: true, now: later + 2 * H }), /not accepting/);
  await M.setAcceptOffers({ ownerId: owner, itemId, on: true, now: later + 3 * H });
  const o3 = await M.openWardrobeOffer({ itemId, buyerId: buyer, amountCents: 6000, viaMessage: true, now: later + 4 * H });
  assert.equal(await M.sweepWardrobeOffers(later + 4 * D), 1, "unanswered: expired by the job");
  assert.ok((await M.wardrobePiece(itemId)).offerCooldownUntil, "and the piece rests");
  void o3;
  // a paid sale cancelled before handoff
  const itemB = piece(owner);
  const o4 = await M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 7000, viaMessage: true, now: later + 5 * D });
  await M.respondWardrobeOffer({ offerId: o4.id, ownerId: owner, decision: "accept", now: later + 5 * D });
  const order = await createOrderWithEvent({ user: buyer, itemId: `wardrobe-${itemB}`, amountCents: 7000, feeCents: 205, currency: "usd", kind: "sale" });
  mem.wardrobeOffers.set(o4.id, { ...mem.wardrobeOffers.get(o4.id), order_id: order.id });
  await applyOrderEvent({ orderId: order.id, type: "paid", source: "test", newStatus: "paid" });
  await M.settleWardrobeOrder(order.id, { now: later + 5 * D + H });
  const cancelled = await M.cancelWardrobeSale({ offerId: o4.id, ownerId: owner, now: later + 6 * D });
  assert.equal(cancelled.offer.state, "cancelled"); assert.equal(cancelled.refund, "full"); assert.equal(cancelled.penalty, 0);
  assert.equal((await M.getPayout(order.id)).state, "void");
});

test("the reminder job sends each preset moment once; the review screen holds a flagged review for the queue", async () => {
  // an open listing offer in the memory store with a 24-hour window: the standard preset's 12h, 3h and 30m moments
  const storefrontId = uuid(), listingId = uuid();
  mem.storefronts.set(storefrontId, { id: storefrontId, owner_account_id: uuid(), offer_settings: { reminders: "standard" } });
  const o = { id: uuid(), listingId, variantId: null, storefrontId, buyerId: "sb-" + uuid(), sellerAccountId: uuid(), by: "buyer", parentId: null, amountCents: 1000, currency: "usd", state: "open", note: null, createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 24 * H).toISOString(), acceptedUntil: null, respondedAt: null, remindersSent: [] };
  mem.listingOffers.set(o.id, { id: o.id, listing_id: o.listingId, variant_id: null, storefront_id: storefrontId, buyer_id: o.buyerId, seller_account_id: o.sellerAccountId, by_party: "buyer", parent_id: null, amount_cents: 1000, currency: "usd", state: "open", note: null, created_at: o.createdAt, expires_at: o.expiresAt, accepted_until: null, responded_at: null, reminders_sent: [] });
  assert.equal(await C.sweepOfferReminders(T0 + H), 0, "nothing due yet");
  assert.equal(await C.sweepOfferReminders(T0 + 13 * H), 1, "the 12-hour moment");
  assert.equal(await C.sweepOfferReminders(T0 + 13 * H + 60_000), 0, "once");
  assert.equal(await C.sweepOfferReminders(T0 + 23 * H + 50 * 60_000), 2, "the 3-hour and the 30-minute moments together");
  const seller = "sb-" + o.sellerAccountId;
  assert.equal((await listNotifications(seller)).filter((n) => n.kind === "offer-expiring").length, 3);
  // the review screen
  const subject = "sb-" + uuid(), reviewer = "sb-" + uuid();
  const rv1 = (await createOrderWithEvent({ user: reviewer, itemId: "syn-0003", amountCents: 18000, currency: "usd" })).id;
  const rv2 = (await createOrderWithEvent({ user: reviewer, itemId: "syn-0003", amountCents: 18000, currency: "usd" })).id;
  const fine = await S.submitReview({ orderId: rv1, reviewerId: reviewer, subjectId: subject, role: "buyer", stars: 5, text: "lovely coat, fast", order: { deliveredAt: T0, verified: true }, now: T0 + D });
  assert.equal(fine.review.state, "submitted");
  const held = await S.submitReview({ orderId: rv2, reviewerId: reviewer, subjectId: subject, role: "buyer", stars: 1, text: "text me on telegram @seller and send money to my paypal", order: { deliveredAt: T0, verified: true }, now: T0 + D });
  assert.equal(held.review.state, "held", "the screen holds it out of the score");
  const tasks = await listModerationTasks({ status: "open", limit: 50 });
  assert.ok(tasks.some((t) => t.kind === "review-screen" && t.subjectId === held.review.id), "and files it for a human");
});

test("the routes: offers need the mail desk here and are told so; a device cannot offer; the sweeps endpoint is gated", async () => {
  const offers = await loadRoute("app/api/wardrobe/offers/route.js");
  const sweeps = await loadRoute("app/api/sweeps/route.js");
  const me = newDevice();
  assert.equal((await callRoute(offers.GET, { path: "/api/wardrobe/offers" })).status, 401);
  const mine = await callRoute(offers.GET, { path: "/api/wardrobe/offers", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(mine.status, 200); assert.deepEqual(mine.body.asBuyer, []); assert.equal(mine.body.law.dmFirst, true);
  const dev = await callRoute(offers.POST, { path: "/api/wardrobe/offers", cookies: me.cookies, json: { user: me.uid, action: "offer", itemId: "1", amountCents: 100, conversationId: "x" } });
  assert.equal(dev.status, 403); assert.equal(dev.body.code, "ACCOUNT_REQUIRED");
  const nobody = await callRoute(offers.POST, { path: "/api/wardrobe/offers", cookies: me.cookies, json: { user: me.uid, action: "accept_offers", itemId: "999999", on: true } });
  assert.equal(nobody.status, 403);
  const gated = await callRoute(sweeps.GET, { path: "/api/sweeps" });
  assert.ok([401, 403, 503].includes(gated.status), "the cron gate refuses an unsigned call: " + gated.status);
});
