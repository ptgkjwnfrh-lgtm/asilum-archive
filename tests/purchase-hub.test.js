// The purchase hub facade (V.2, 19 Sep 2026, docs/v2/CONTRACTS.md § Purchase hub).
//
// Law 1: a fee payment and a merchant garment purchase cannot share a
//        misleading "purchased" state — the lanes are separate, and only a
//        PAID SALE is a verified purchase.
// Law 2: provider confirmation, the reader's report and unknown stay
//        separate; merchant-verified fulfilment is always unknown today.
// Law 3: allowed actions are derived from server state, mirroring exactly
//        the user-driven transitions the ticket store permits.
// The fixtures below are the representative states the UI renders from.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPurchaseHub, feeOrderIdOf, HUB_CONTRACT_VERSION } from "../lib/orders/hub.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const titles = new Map([["it-1", { title: "Leather blazer", brand: "Celine" }], ["it-2", { title: "Wool coat", brand: "Gucci" }]]);
const at = (d) => `2026-09-1${d}T12:00:00.000Z`;

const FIXTURES = {
  paidSale: { id: "ord_paid", kind: "sale", item_id: "it-1", status: "paid", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(1), updated_at: at(1) },
  awaitingSale: { id: "ord_wait", kind: "sale", item_id: "it-1", status: "awaiting_payment", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(2), updated_at: at(2), resume_url: "https://checkout.stripe.com/c/pay/cs_test_x" },
  refundedSale: { id: "ord_ref", kind: "sale", item_id: "it-2", status: "refunded", amount_cents: 90000, fee_cents: 900, currency: "usd", created_at: at(3), updated_at: at(4) },
  feePaid: { id: "ord_fee1", kind: "ticket_fee", item_id: "it-2", status: "paid", amount_cents: 90000, fee_cents: 900, currency: "usd", created_at: at(5), updated_at: at(5) },
  feeAwaiting: { id: "ord_fee2", kind: "ticket_fee", item_id: "it-1", status: "awaiting_payment", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(6), updated_at: at(6) },
  ticketAwaitingConsent: { id: 11, userId: "u", productId: "it-1", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/1", status: "awaiting_user_consent", itemPriceAtRequest: 600, currentPriceChecked: 600, availabilityStatus: "available", consented: false, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(7)), idempotencyKey: "k-11" },
  ticketStartedNoReport: { id: 12, userId: "u", productId: "it-2", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/2", status: "checkout_started", itemPriceAtRequest: 900, currentPriceChecked: 900, availabilityStatus: "available", consented: true, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(5)), idempotencyKey: "fee-ord-fee1" },
  ticketReportedBought: { id: 13, userId: "u", productId: "it-1", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/3", status: "checkout_completed_on_source", itemPriceAtRequest: 600, currentPriceChecked: null, availabilityStatus: "available", consented: true, userReportedOutcome: "bought", outcomeReportedAt: Date.parse(at(8)), createdAt: Date.parse(at(6)), idempotencyKey: "fee-ord-fee2" },
  ticketUnavailable: { id: 14, userId: "u", productId: "it-2", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/4", status: "unavailable", itemPriceAtRequest: 900, currentPriceChecked: null, availabilityStatus: "sold", consented: false, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(9)), idempotencyKey: "k-14" },
};

test("law 1: only a PAID SALE is a verified purchase; a paid fee is a paid fee", () => {
  const hub = buildPurchaseHub({ orders: [FIXTURES.paidSale, FIXTURES.feePaid], tickets: [FIXTURES.ticketStartedNoReport], titles });
  assert.equal(hub.contractVersion, HUB_CONTRACT_VERSION);
  const sale = hub.records.find((r) => r.id === "ord_paid");
  assert.equal(sale.kind, "payment_order");
  assert.equal(sale.verifiedPurchase, true);
  assert.equal(sale.purchaseEvidence, "provider");
  assert.deepEqual(sale.lanes, { payment: "paid", fee: "paid", merchant: "none", outcome: "unknown", fulfillment: "unknown" });
  assert.equal(sale.amounts.total_cents, 60600);
  assert.equal(sale.merchant.name, "ASILUM");
  const fee = hub.records.find((r) => r.id === "ord_fee1");
  assert.equal(fee.verifiedPurchase, false, "a paid passenger fee is not a purchased garment");
  assert.equal(fee.purchaseEvidence, "none");
  assert.deepEqual(fee.lanes, { payment: "none", fee: "paid", merchant: "checkout_started", outcome: "unknown", fulfillment: "unknown" });
  assert.equal(fee.amounts.total_cents, 900, "the buyer paid the fee alone");
  assert.equal(fee.amounts.item_cents, null);
  assert.equal(fee.linkedTicketId, 12, "the fee order knows its ticket");
  assert.equal(fee.merchant.name, "ebay");
  const ticket = hub.records.find((r) => r.id === "12");
  assert.equal(ticket.linkedOrderId, "ord_fee1", "and the ticket knows its fee order");
  assert.equal(ticket.lanes.fee, "paid");
  assert.equal(ticket.amounts.fee_cents, 900);
  assert.equal(hub.counts.verifiedPurchases, 1);
  assert.ok(hub.disclosures.some((d) => /fee is not proof/.test(d)));
});

test("law 2: the reader's report is the reader's word; merchant fulfilment stays unknown; a refund is one lane", () => {
  const hub = buildPurchaseHub({ orders: [FIXTURES.refundedSale, FIXTURES.feeAwaiting], tickets: [FIXTURES.ticketReportedBought], titles });
  const bought = hub.records.find((r) => r.id === "13");
  assert.equal(bought.kind, "source_ticket");
  assert.equal(bought.outcomeSource, "user_report");
  assert.equal(bought.purchaseEvidence, "user_report");
  assert.equal(bought.verifiedPurchase, false, "self-reported is never verified");
  assert.equal(bought.lanes.outcome, "bought");
  assert.equal(bought.lanes.fulfillment, "unknown");
  assert.equal(bought.lanes.fee, "awaiting", "the linked fee order is still awaiting — a bought garment and an unpaid fee are two facts");
  assert.equal(bought.timestamps.outcome_reported_at, at(8));
  assert.deepEqual(bought.allowedActions, [], "an outcome already reported cannot be reported again from the hub");
  const refunded = hub.records.find((r) => r.id === "ord_ref");
  assert.equal(refunded.lanes.payment, "refunded");
  assert.equal(refunded.verifiedPurchase, false);
  assert.equal(refunded.lanes.merchant, "none", "a refund on the payment lane implies nothing about a merchant lane");
  const fee2 = hub.records.find((r) => r.id === "ord_fee2");
  assert.equal(fee2.lanes.outcome, "bought", "the fee order surfaces its ticket's report, labelled as a report");
  assert.equal(fee2.outcomeSource, "user_report");
  assert.equal(fee2.verifiedPurchase, false);
});

test("law 3: allowed actions mirror the store's user-driven transitions exactly", () => {
  const hub = buildPurchaseHub({
    orders: [FIXTURES.awaitingSale, FIXTURES.paidSale],
    tickets: [FIXTURES.ticketAwaitingConsent, FIXTURES.ticketStartedNoReport, FIXTURES.ticketUnavailable],
    titles,
  });
  const byId = new Map(hub.records.map((r) => [r.id, r]));
  assert.deepEqual(byId.get("ord_wait").allowedActions, ["resume_payment"]);
  assert.deepEqual(byId.get("ord_paid").allowedActions, [], "a refund is the operator's, never a hub button");
  assert.deepEqual(byId.get("11").allowedActions, ["consent", "cancel"]);
  assert.deepEqual(byId.get("12").allowedActions, ["report_outcome"]);
  assert.deepEqual(byId.get("14").allowedActions, [], "an unavailable ticket is terminal for the reader");
  assert.equal(byId.get("14").lanes.merchant, "unavailable");
  assert.equal(byId.get("14").availability, "sold");
  assert.equal(byId.get("11").consented, false);
  // newest first, deterministic
  assert.deepEqual(hub.records.map((r) => r.id), ["14", "11", "12", "ord_wait", "ord_paid"]);
  assert.equal(feeOrderIdOf({ idempotencyKey: "fee-ord-abc" }), "ord_abc");
  assert.equal(feeOrderIdOf({ idempotencyKey: "k-1" }), null);
});

test("/api/orders?hub=1 answers an empty hub honestly and is private", async () => {
  const route = await loadRoute("app/api/orders/route.js");
  const me = newDevice();
  const res = await callRoute(route.GET, { path: "/api/orders", cookies: me.cookies, query: { user: me.uid, hub: "1" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, "empty");
  assert.deepEqual(res.body.records, []);
  assert.equal(res.body.counts.payment_order, 0);
  assert.ok(Array.isArray(res.body.disclosures));
  assert.match(res.headers.get("Cache-Control") || "", /no-store/);
  const anon = await callRoute(route.GET, { path: "/api/orders", query: { hub: "1" } });
  assert.equal(anon.status, 401);
  const src = fs.readFileSync(new URL("../app/api/orders/route.js", import.meta.url), "utf8");
  assert.match(src, /searchParams\.get\("hub"\) === "1"/);
});
