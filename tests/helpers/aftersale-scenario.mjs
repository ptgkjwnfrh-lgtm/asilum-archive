// tests/helpers/aftersale-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 7).
// DATABASE_URL empty runs the memory store, set runs Postgres; one JSON line
// both runs must agree on. The Postgres run writes a run-unique paid order
// and its after-sale rows and leaves them (ledgers are append-only); every
// id carries `aft-<run>`.
import { randomUUID } from "node:crypto";
import { createOrderWithEvent, applyOrderEvent, getOrder } from "../../lib/db/orders.js";
import * as A from "../../lib/db/production/aftersale.js";
import * as S from "../../lib/db/production/score.js";
import * as C from "../../lib/db/production/credit.js";
import { listNotifications } from "../../lib/db/production/listingStatus.js";

const run = process.argv[2] || randomUUID().slice(0, 8);
const buyer = "sb-" + randomUUID();
const seller = "sb-" + randomUUID();
const T0 = Date.parse("2026-10-18T00:00:00Z");
const D = 86_400_000;
const out = {};
try {
  const o = await createOrderWithEvent({ user: buyer, itemId: "syn-0003", amountCents: 18000, feeCents: 100, currency: "usd" });
  await applyOrderEvent({ orderId: o.id, type: "paid", source: "scenario", newStatus: "paid" });
  const d = await A.recordDelivery({ orderId: o.id, by: "admin", source: "admin", deliveredAt: T0, now: T0 });
  out.delivery = { source: d.delivery.source, returnBy: d.windows.returnBy };
  out.deliverTwice = await A.recordDelivery({ orderId: o.id, by: "admin", source: "admin" }).then(() => "allowed").catch((e) => e.code);
  const el = await A.recordElection({ orderId: o.id, elected: true, offer: await A.protectionOfferFor({ itemValueCents: 18000 }) });
  out.election = { elected: el.elected, priceCents: el.priceCents, refused: !!el.refused };
  out.changeOfMind = await A.openReturn({ orderId: o.id, buyerId: buyer, kind: "change_of_mind", now: T0 + D }).then(() => "allowed").catch((e) => e.code);
  const r = await A.openReturn({ orderId: o.id, buyerId: buyer, kind: "damage", reason: "cracked", evidence: "photo", now: T0 + D });
  out.returnOpened = { state: r.return.state, ground: r.return.ground };
  out.payoutHeld = (await A.orderFacts(o.id, { now: T0 + 15 * D })).payout.state;
  const dec = await A.decideReturn({ returnId: r.return.id, approve: true, fault: "seller", refundTo: "credit", refundCents: 18000, now: T0 + 2 * D });
  out.decided = { state: dec.return.state, payer: dec.shipping.payer, penalty: dec.penalty };
  const settled = await A.settleReturnRefund({ returnId: r.return.id, now: T0 + 3 * D });
  out.settled = { state: settled.state, creditKind: settled.credit.kind, balance: await C.creditBalance(buyer), orderStatus: (await getOrder(o.id)).status };
  const rv = await S.submitReview({ orderId: o.id, reviewerId: buyer, subjectId: seller, role: "buyer", stars: 4, text: "fine", order: { deliveredAt: T0, verified: true }, now: T0 + 2 * D });
  out.review1 = { state: rv.review.state, published: rv.settled.published };
  const rv2 = await S.submitReview({ orderId: o.id, reviewerId: seller, subjectId: buyer, role: "seller", stars: 5, order: { deliveredAt: T0, verified: true }, now: T0 + 3 * D });
  out.review2 = { state: rv2.review.state, published: rv2.settled.published };
  out.score = (await S.passengerScore(seller, { now: T0 + 4 * D })).public;
  const pen = await S.proposePenalty({ userId: seller, reason: "label refused", orderId: o.id, now: T0 + 5 * D });
  await S.movePenalty({ penaltyId: pen.id, action: "confirm", now: T0 + 5 * D });
  out.penalized = (await S.passengerScore(seller, { now: T0 + 5 * D })).public.score;
  await S.movePenalty({ penaltyId: pen.id, action: "appeal", by: seller, evidence: "offered", now: T0 + 6 * D });
  await S.movePenalty({ penaltyId: pen.id, action: "overturn", now: T0 + 7 * D });
  out.restored = (await S.passengerScore(seller, { now: T0 + 7 * D })).public.score;
  out.response = (await S.respond({ reviewId: rv.review.id, subjectId: seller, text: "thanks" })).response.text;
  out.responseTwice = await S.respond({ reviewId: rv.review.id, subjectId: seller, text: "again" }).then(() => "allowed").catch((e) => e.code);
  out.giftNoProof = await C.giftCredit({ fromId: buyer, toId: seller, amountCents: 500 }).then(() => "allowed").catch((e) => e.code);
  const g = await C.giftCredit({ fromId: buyer, toId: seller, amountCents: 500, twoFactor: true, deviceVerified: true });
  out.gift = { from: g.fromBalance, to: g.toBalance };
  out.ledgerKinds = (await C.creditLedger(buyer)).map((e) => e.kind).sort();
  const ex = await A.markDispatch({ orderId: o.id, by: "admin", event: "extension", extensionMs: 3 * D, approved: true, now: T0 });
  out.dispatch = { extensions: ex.dispatch.extensions.length, tooLong: await A.markDispatch({ orderId: o.id, by: "admin", event: "extension", extensionMs: 9 * D, approved: true }).then(() => "allowed").catch((e) => e.code) };
  out.notices = { buyer: (await listNotifications(buyer)).map((n) => n.kind).sort(), seller: (await listNotifications(seller)).map((n) => n.kind).sort() };
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
