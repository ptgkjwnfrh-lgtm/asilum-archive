// lib/orders/hub.js — THE PURCHASE HUB, a read facade (V.2, 19 Sep 2026;
// docs/v2/CONTRACTS.md § Purchase hub).
//
// The owner's "purchase housing" is the reader's purchase / order / ticket
// hub. It does not authorise warehousing, reservations or a new payment
// policy. Two record kinds already exist and stay authoritative:
//
//   payment_order   a row in `orders` — a direct SALE paid to ASILUM's
//                   processor (piece + passenger fee), or a TICKET FEE paid
//                   to ASILUM alone while the piece is bought at the source
//   source_ticket   a row in `purchase_tickets` — the consented hand-off to
//                   a source merchant, with the reader's self-reported outcome
//
// This module turns both into ONE shape with SEPARATE lanes, because the
// facts are separate: payment of a fee is not proof a garment was bought; a
// refund on one lane does not imply the other; a saved bag is never a
// purchase; and merchant-verified fulfilment does not exist yet (no adapter),
// so that lane is always "unknown" and says so rather than borrowing the
// user's report. Amounts stay integer minor units. Allowed actions are
// derived from server state — a UI button cannot authorise anything alone.
//
// Pure: no I/O, so the fixtures in tests/purchase-hub.test.js ARE the states.

export const HUB_CONTRACT_VERSION = 1;

// A ticket-fee order and its ticket are linked by the ticket's idempotency
// key, which lib/orders.js writes as `fee-${orderId with _ -> -}`.
export function feeOrderIdOf(ticket) {
  const key = String(ticket?.idempotencyKey || "");
  if (!key.startsWith("fee-ord-")) return null;
  return "ord_" + key.slice("fee-ord-".length);
}

const PAYMENT_LANE = Object.freeze({
  created: "awaiting", awaiting_payment: "awaiting", paid: "paid",
  failed: "failed", expired: "expired", refunded: "refunded",
});

function orderRecord(order, ticketsByFeeOrder, titles) {
  const kind = order.kind || "sale";
  const lane = PAYMENT_LANE[order.status] || "unknown";
  const linkedTicket = kind === "ticket_fee" ? ticketsByFeeOrder.get(order.id) || null : null;
  const item = titles.get(order.item_id) || null;
  const actions = [];
  if (order.resume_url && lane === "awaiting") actions.push("resume_payment");
  return {
    contractVersion: HUB_CONTRACT_VERSION,
    id: order.id,
    kind: "payment_order",
    orderKind: kind,
    merchant: kind === "sale" ? { name: "ASILUM", url: null } : { name: linkedTicket?.sourceName || null, url: linkedTicket?.sourceProductUrl || null },
    item: { id: order.item_id, title: item?.title || null, brand: item?.brand || null },
    currency: String(order.currency || "usd").toLowerCase(),
    amounts: {
      item_cents: kind === "sale" ? Number(order.amount_cents) || 0 : null,
      fee_cents: Number(order.fee_cents) || 0,
      total_cents: kind === "ticket_fee" ? Number(order.fee_cents) || 0 : (Number(order.amount_cents) || 0) + (Number(order.fee_cents) || 0),
    },
    lanes: {
      // a sale charges piece + fee in one payment; a ticket fee is the fee alone
      payment: kind === "sale" ? lane : "none",
      fee: lane,
      merchant: kind === "ticket_fee" ? (linkedTicket ? merchantLane(linkedTicket.status) : "handoff") : "none",
      outcome: linkedTicket?.userReportedOutcome || "unknown",
      fulfillment: "unknown",
    },
    outcomeSource: linkedTicket?.userReportedOutcome ? "user_report" : "unknown",
    verifiedPurchase: kind === "sale" && lane === "paid",
    purchaseEvidence: kind === "sale" && lane === "paid" ? "provider" : linkedTicket?.userReportedOutcome ? "user_report" : "none",
    status: order.status,
    timestamps: { created_at: order.created_at || null, updated_at: order.updated_at || null, outcome_reported_at: null },
    linkedTicketId: linkedTicket ? linkedTicket.id : null,
    linkedOrderId: null,
    allowedActions: actions,
  };
}

const MERCHANT_LANE = Object.freeze({
  requested: "requested", checking_availability: "checking", available: "available",
  unavailable: "unavailable", awaiting_user_consent: "awaiting_consent",
  awaiting_payment_or_checkout: "awaiting_checkout", checkout_started: "checkout_started",
  checkout_completed_on_source: "completed_on_source", canceled: "canceled",
  failed: "failed", completed: "completed",
});
const merchantLane = (status) => MERCHANT_LANE[status] || "unknown";

// The user-driven transitions lib/db/production/tickets.js allows, mirrored
// as allowed actions. Anything else is the server's or the merchant's.
const CANCELABLE = new Set(["requested", "checking_availability", "available", "awaiting_user_consent", "awaiting_payment_or_checkout"]);
const OUTCOME_REPORTABLE = new Set(["checkout_started", "checkout_completed_on_source", "completed"]);

function ticketRecord(ticket, ordersById, titles) {
  const feeOrderId = feeOrderIdOf(ticket);
  const feeOrder = feeOrderId ? ordersById.get(feeOrderId) || null : null;
  const item = titles.get(ticket.productId) || null;
  const actions = [];
  if (ticket.status === "awaiting_user_consent") actions.push("consent");
  if (CANCELABLE.has(ticket.status)) actions.push("cancel");
  if (OUTCOME_REPORTABLE.has(ticket.status) && !ticket.userReportedOutcome) actions.push("report_outcome");
  const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  return {
    contractVersion: HUB_CONTRACT_VERSION,
    id: String(ticket.id),
    kind: "source_ticket",
    orderKind: null,
    merchant: { name: ticket.sourceName || null, url: ticket.sourceProductUrl || null },
    item: { id: ticket.productId, title: item?.title || null, brand: item?.brand || null },
    currency: feeOrder ? String(feeOrder.currency || "usd").toLowerCase() : "usd",
    amounts: {
      item_cents: cents(ticket.itemPriceAtRequest),
      current_price_cents: cents(ticket.currentPriceChecked),
      fee_cents: feeOrder ? Number(feeOrder.fee_cents) || 0 : null,
      total_cents: null,
    },
    lanes: {
      payment: "none",
      fee: feeOrder ? (PAYMENT_LANE[feeOrder.status] || "unknown") : "none",
      merchant: merchantLane(ticket.status),
      outcome: ticket.userReportedOutcome || "unknown",
      fulfillment: "unknown",
    },
    outcomeSource: ticket.userReportedOutcome ? "user_report" : "unknown",
    verifiedPurchase: false,
    purchaseEvidence: ticket.userReportedOutcome ? "user_report" : "none",
    status: ticket.status,
    consented: !!ticket.consented,
    availability: ticket.availabilityStatus || null,
    timestamps: {
      created_at: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : null,
      updated_at: null,
      outcome_reported_at: ticket.outcomeReportedAt ? new Date(ticket.outcomeReportedAt).toISOString() : null,
    },
    linkedTicketId: null,
    linkedOrderId: feeOrder ? feeOrder.id : null,
    allowedActions: actions,
  };
}

/**
 * @param {{ orders?: Array, tickets?: Array, titles?: Map<string,{title,brand}> }} input
 * @returns {{ contractVersion, records: Array, counts: {payment_order, source_ticket, verifiedPurchases, userReported}, disclosures: string[] }}
 */
export function buildPurchaseHub({ orders = [], tickets = [], titles = new Map() } = {}) {
  const ticketsByFeeOrder = new Map();
  for (const t of tickets) { const id = feeOrderIdOf(t); if (id) ticketsByFeeOrder.set(id, t); }
  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const records = [
    ...orders.map((o) => orderRecord(o, ticketsByFeeOrder, titles)),
    ...tickets.map((t) => ticketRecord(t, ordersById, titles)),
  ].sort((a, b) => String(b.timestamps.created_at || "").localeCompare(String(a.timestamps.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  return {
    contractVersion: HUB_CONTRACT_VERSION,
    records,
    counts: {
      payment_order: orders.length,
      source_ticket: tickets.length,
      verifiedPurchases: records.filter((r) => r.verifiedPurchase).length,
      userReported: records.filter((r) => r.outcomeSource === "user_report").length,
    },
    disclosures: [
      "a paid passenger fee is not proof a garment was purchased",
      "a self-reported outcome is the reader's word, not the merchant's",
      "merchant-verified fulfilment has no adapter yet: that lane is always unknown",
      "a saved bag is never a purchase and is not listed here",
    ],
  };
}
