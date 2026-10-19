// lib/db/production/aftersale.js — AFTER THE SALE (V.2 Blueprint chapter 6
// 6.1–6.8, chapter 10; slice 7; schema v65). SERVER-ONLY; memory mode mirrors
// Postgres. The law is lib/storefront/protection.js — this keeps:
//
//   deliveries   the delivery event per order, WITH its source (carrier,
//                seller, admin); it opens the return, review and payout clocks
//   returns      change-of-mind returns and complaints with evidence, the
//                admin's decision, the fault, who paid the label, the refund
//                destination
//   elections    |A| Protection per order: the offer shown, what was elected
//                (never preselected), what it cost
//   incentives   the $1 return credit per listing, earned once
//   dispatch     label printed, handed off, approved extensions
//
// The parties of an order: the buyer is orders.user_id; the seller is the
// storefront's owner for a native order, nobody for a legacy sale (the
// designer ships it outside ASILUM) — those take admin-entered deliveries.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { getOrder, applyOrderEvent } from "../orders.js";
import { enqueueNotification } from "./listingStatus.js";
import { creditIn } from "./credit.js";
import { proposePenalty } from "./score.js";
import {
  windowsFrom, refundEligibility, refundDestination, returnShipping, incentiveDue, payoutState, protectionOffer, electProtection,
  extendDispatch, dispatchLate, DELIVERY_SOURCES, RETURN_KINDS, FAULTS, RETURN_INCENTIVE_CENTS,
} from "../../storefront/protection.js";
import { quoteProtection } from "../../storefront/providers/redo.js";

export class AftersaleRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "AftersaleRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "order_deliveries") : true);
const needs = () => { throw new AftersaleRefused("SCHEMA_V65_REQUIRED", "after-sale records need schema v65 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();

/** Who is who on an order. */
export async function orderParties(orderId) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const native = order.commerce_rail === "native_storefront";
  let sellerAccountId = null, listingId = null, storefrontId = order.storefront_id ? String(order.storefront_id) : null;
  const p = await getPool();
  if (native && storefrontId) {
    if (!p) { const s = mem.storefronts.get(storefrontId); sellerAccountId = s ? String(s.owner_account_id) : null; }
    else { const { rows } = await p.query("SELECT owner_account_id FROM storefronts WHERE id=$1", [storefrontId]); sellerAccountId = rows[0] ? String(rows[0].owner_account_id) : null; }
    if (String(order.item_id || "").startsWith("native-")) listingId = String(order.item_id).slice(7);
  }
  return { order, buyerId: order.user_id, sellerAccountId, native, listingId, storefrontId, paid: order.status === "paid", refunded: order.status === "refunded" };
}

const sellerOf = (parties) => (parties.sellerAccountId ? "sb-" + parties.sellerAccountId : null);

// ---- deliveries ---------------------------------------------------------------------

const deliveryOut = (r) => ({ orderId: r.order_id, deliveredAt: iso(r.delivered_at), source: r.source, tracking: r.tracking || null, recordedBy: r.recorded_by, recordedAt: iso(r.recorded_at), estimatedAt: iso(r.estimated_at) });

export async function getDelivery(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.orderDeliveries.get(orderId); return r ? deliveryOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM order_deliveries WHERE order_id=$1", [orderId]);
  return rows[0] ? deliveryOut(rows[0]) : null;
}

/**
 * Record the delivery event. `source` says who: a carrier (none is
 * integrated yet), the seller (manual tracking, 10.7), or an admin. Once.
 */
export async function recordDelivery({ orderId, by, source, deliveredAt = Date.now(), tracking = null, now = Date.now() } = {}) {
  if (!DELIVERY_SOURCES.includes(source)) throw new AftersaleRefused("INVALID_SOURCE", "a delivery is the carrier's, the seller's or an admin's", 400);
  const parties = await orderParties(orderId);
  if (!parties) throw new AftersaleRefused("ORDER_NOT_FOUND", "order not found", 404);
  if (!parties.paid) throw new AftersaleRefused("NOT_PAID", "a delivery follows a paid order", 409);
  if (source === "seller" && (!sellerOf(parties) || by !== sellerOf(parties))) throw new AftersaleRefused("NOT_THE_SELLER", "only the seller enters their own tracking", 403);
  if (source === "admin" && by !== "admin") throw new AftersaleRefused("NOT_AN_ADMIN", "an admin's delivery is an admin's", 403);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (await getDelivery(orderId)) throw new AftersaleRefused("ALREADY_DELIVERED", "delivery is recorded once", 409);
  const row = { order_id: orderId, delivered_at: new Date(deliveredAt).toISOString(), source, tracking: tracking ? String(tracking).slice(0, 120) : null, recorded_by: String(by), recorded_at: new Date(now).toISOString(), estimated_at: null };
  if (!p) mem.orderDeliveries.set(orderId, row);
  else await p.query("INSERT INTO order_deliveries (order_id, delivered_at, source, tracking, recorded_by, recorded_at) VALUES ($1,$2,$3,$4,$5,$6)", [row.order_id, row.delivered_at, row.source, row.tracking, row.recorded_by, row.recorded_at]);
  await applyOrderEvent({ orderId, type: "delivered", source: "api", payload: { source, by: String(by) } }).catch(() => null);
  const w = windowsFrom(row.delivered_at);
  await enqueueNotification({ userId: parties.buyerId, kind: "delivered", subjectId: orderId, payload: { orderId, source, returnBy: w.returnBy, reviewBy: w.reviewBy } }).catch(() => null);
  // slice 11: the delivery starts the payout clock (10.12) and, on a carrier's word, moves a Wardrobe sale's ownership exactly once (13.10)
  let transfer = null;
  try { const M = await import("./money.js"); await M.refreshPayout(orderId, { now }); transfer = await M.transferOnWardrobeDelivery(orderId, { now }); } catch (e) { console.error("[aftersale] payout/transfer failed", e?.message || e); }
  return { delivery: deliveryOut(row), windows: w, transfer };
}

// ---- protection elections ---------------------------------------------------------------

const electionOut = (r) => ({ orderId: r.order_id, offer: json(r.offer), elected: !!r.elected, priceCents: Number(r.price_cents || 0), provider: r.provider || null, at: iso(r.at) });

/** The offer for an order, from the provider seam — never a preselection. */
export async function protectionOfferFor({ itemValueCents, shippingCents = 0, destination = null } = {}) {
  return protectionOffer(await quoteProtection({ itemValueCents, shippingCents, destination }));
}

export async function recordElection({ orderId, elected, offer, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const e = electProtection(offer, elected);
  const row = { order_id: orderId, offer: offer || null, elected: !!e.elected, price_cents: e.priceCents || 0, provider: e.provider || offer?.provider || null, at: new Date(now).toISOString() };
  if (!p) mem.protectionElections.set(orderId, row);
  else await p.query("INSERT INTO protection_elections (order_id, offer, elected, price_cents, provider, at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id) DO UPDATE SET offer=EXCLUDED.offer, elected=EXCLUDED.elected, price_cents=EXCLUDED.price_cents, provider=EXCLUDED.provider, at=EXCLUDED.at",
    [row.order_id, JSON.stringify(row.offer), row.elected, row.price_cents, row.provider, row.at]);
  return { ...electionOut(row), refused: e.refused || null };
}

export async function getElection(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.protectionElections.get(orderId); return r ? electionOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM protection_elections WHERE order_id=$1", [orderId]);
  return rows[0] ? electionOut(rows[0]) : null;
}

// ---- returns and complaints ------------------------------------------------------------

const returnOut = (r) => ({
  id: String(r.id), orderId: r.order_id, buyerId: r.buyer_id, kind: r.kind, reason: r.reason || "", evidence: r.evidence || null, state: r.state, ground: r.ground || null,
  fault: r.fault || "undetermined", labelPayer: r.label_payer || null, refundTo: r.refund_to || null, refundCents: r.refund_cents == null ? null : Number(r.refund_cents),
  openedAt: iso(r.opened_at), decidedAt: iso(r.decided_at), decidedBy: r.decided_by || null, decision: r.decision || null, sellerPaysLabel: r.seller_pays_label == null ? null : !!r.seller_pays_label,
});
const returnRow = (o) => ({ id: o.id, order_id: o.orderId, buyer_id: o.buyerId, kind: o.kind, reason: o.reason, evidence: o.evidence, state: o.state, ground: o.ground, fault: o.fault, label_payer: o.labelPayer, refund_to: o.refundTo, refund_cents: o.refundCents, opened_at: o.openedAt, decided_at: o.decidedAt, decided_by: o.decidedBy, decision: o.decision, seller_pays_label: o.sellerPaysLabel });

async function saveReturn(o) {
  const p = await getPool();
  const row = returnRow(o);
  if (!p) { mem.orderReturns.set(row.id, row); return returnOut(row); }
  await p.query(
    `INSERT INTO order_returns (id, order_id, buyer_id, kind, reason, evidence, state, ground, fault, label_payer, refund_to, refund_cents, opened_at, decided_at, decided_by, decision, seller_pays_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, ground=EXCLUDED.ground, fault=EXCLUDED.fault, label_payer=EXCLUDED.label_payer, refund_to=EXCLUDED.refund_to, refund_cents=EXCLUDED.refund_cents, decided_at=EXCLUDED.decided_at, decided_by=EXCLUDED.decided_by, decision=EXCLUDED.decision, seller_pays_label=EXCLUDED.seller_pays_label`,
    [row.id, row.order_id, row.buyer_id, row.kind, row.reason, row.evidence, row.state, row.ground, row.fault, row.label_payer, row.refund_to, row.refund_cents, row.opened_at, row.decided_at, row.decided_by, row.decision, row.seller_pays_label]);
  return returnOut(row);
}

export async function returnsFor(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return [...mem.orderReturns.values()].filter((r) => r.order_id === orderId).map(returnOut);
  const { rows } = await p.query("SELECT * FROM order_returns WHERE order_id=$1 ORDER BY opened_at", [orderId]);
  return rows.map(returnOut);
}

export async function openReturns({ status = "open", limit = 100 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return [...mem.orderReturns.values()].filter((r) => status === "all" || r.state === status).map(returnOut).slice(0, limit);
  const { rows } = await p.query("SELECT * FROM order_returns WHERE ($1='all' OR state=$1) ORDER BY opened_at DESC LIMIT $2", [status, limit]);
  return rows.map(returnOut);
}

const openIssues = (returns) => returns.filter((r) => r.state === "open" || r.state === "approved").length;

/** The facts the law reads for an order. */
export async function orderFacts(orderId, { now = Date.now() } = {}) {
  const parties = await orderParties(orderId);
  if (!parties) return null;
  const [delivery, election, returns] = await Promise.all([getDelivery(orderId), getElection(orderId), returnsFor(orderId)]);
  const creditApplied = Number(parties.order.credit_applied_cents || 0);
  let sellerReturnsEnabled = false;
  if (parties.listingId) {
    const p = await getPool();
    if (!p) sellerReturnsEnabled = !!(mem.nativeListings.get(parties.listingId)?.returns_enabled);
    else { const { rows } = await p.query("SELECT returns_enabled FROM native_listings WHERE id=$1", [parties.listingId]).catch(() => ({ rows: [] })); sellerReturnsEnabled = !!(rows[0] && rows[0].returns_enabled); }
  }
  const law = { status: parties.order.status, refunded: parties.refunded, creditAppliedCents: creditApplied, protected: !!(election && election.elected), sellerReturnsEnabled, deliveredAt: delivery ? delivery.deliveredAt : null };
  return {
    ...parties, delivery, election, returns, law,
    windows: delivery ? windowsFrom(delivery.deliveredAt) : null,
    payout: payoutState({ deliveredAt: law.deliveredAt, now, openIssues: openIssues(returns), refunded: law.refunded }),
    openIssues: openIssues(returns),
  };
}

/** A buyer opens a return or a complaint. */
export async function openReturn({ orderId, buyerId, kind = "change_of_mind", reason = "", evidence = null, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const facts = await orderFacts(orderId, { now });
  if (!facts) throw new AftersaleRefused("ORDER_NOT_FOUND", "order not found", 404);
  if (facts.buyerId !== buyerId) throw new AftersaleRefused("NOT_THE_BUYER", "only the buyer returns their order", 403);
  if (!RETURN_KINDS.includes(kind)) throw new AftersaleRefused("INVALID_KIND", "change of mind, wrong item, damage or non-delivery", 400);
  if (facts.returns.some((r) => r.state === "open" || r.state === "approved")) throw new AftersaleRefused("ALREADY_OPEN", "a return is already open on this order", 409);
  const el = refundEligibility({ order: facts.law, request: { kind, evidence }, now });
  if (!el.ok) throw new AftersaleRefused("NOT_ELIGIBLE", el.reason, 409);
  const row = await saveReturn({ id: newId(), orderId, buyerId, kind, reason: String(reason || "").slice(0, 1000), evidence: evidence ? String(evidence).slice(0, 2000) : null, state: "open", ground: el.ground, fault: kind === "change_of_mind" ? "buyer" : "undetermined", labelPayer: kind === "change_of_mind" ? "buyer" : null, refundTo: null, refundCents: null, openedAt: new Date(now).toISOString(), decidedAt: null, decidedBy: null, decision: null, sellerPaysLabel: null });
  const seller = sellerOf(facts);
  if (seller) await enqueueNotification({ userId: seller, kind: "return-opened", subjectId: row.id, payload: { orderId, kind, ground: el.ground } }).catch(() => null);
  return { return: row, eligibility: el };
}

/** The seller answers a seller-fault return: will they pay the label? (6.7) */
export async function sellerLabelAnswer({ returnId, sellerId, pays, now = Date.now() } = {}) {
  const r = await getReturn(returnId);
  if (!r) throw new AftersaleRefused("RETURN_NOT_FOUND", "return not found", 404);
  const facts = await orderFacts(r.orderId, { now });
  if (!facts || sellerOf(facts) !== sellerId) throw new AftersaleRefused("NOT_THE_SELLER", "not your order", 403);
  if (r.state !== "open" && r.state !== "approved") throw new AftersaleRefused("CLOSED", "the return is decided", 409);
  return saveReturn({ ...r, sellerPaysLabel: !!pays });
}

export async function getReturn(id) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.orderReturns.get(String(id)); return r ? returnOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM order_returns WHERE id=$1", [String(id)]);
  return rows[0] ? returnOut(rows[0]) : null;
}

/**
 * An admin decides a complaint (6.1, 11.5): approved → the buyer returns the
 * item and is refunded in Credit or to the original method; the fault is
 * named; a seller's fault with a refused label costs the seller the label and
 * half a star, proposed here and confirmed through the penalty's own path.
 */
export async function decideReturn({ returnId, actor = "admin", approve, fault = "undetermined", refundTo = "credit", refundCents = null, decision = "", now = Date.now() } = {}) {
  const r = await getReturn(returnId);
  if (!r) throw new AftersaleRefused("RETURN_NOT_FOUND", "return not found", 404);
  if (r.state !== "open") throw new AftersaleRefused("CLOSED", "the return is already decided", 409);
  if (!FAULTS.includes(fault)) throw new AftersaleRefused("INVALID_FAULT", "fault is buyer, seller, carrier or undetermined", 400);
  const facts = await orderFacts(r.orderId, { now });
  const amount = refundCents == null ? Number(facts.order.buyer_total_cents || facts.order.amount_cents || 0) + Number(facts.order.fee_cents || 0) * 0 : Number(refundCents);
  if (!approve) {
    return saveReturn({ ...r, state: "refused", fault, decidedAt: new Date(now).toISOString(), decidedBy: actor, decision: String(decision || "").slice(0, 500) });
  }
  const shipping = returnShipping({ fault, sellerPaysLabel: r.sellerPaysLabel, insideWindow: true, responsibilityConfirmed: fault === "seller" });
  const saved = await saveReturn({ ...r, state: "approved", fault, labelPayer: shipping.payer, refundTo: refundDestination(refundTo), refundCents: amount, decidedAt: new Date(now).toISOString(), decidedBy: actor, decision: String(decision || "").slice(0, 500) });
  let penalty = null;
  if (fault === "seller" && shipping.penalty > 0 && sellerOf(facts)) {
    penalty = await proposePenalty({ userId: sellerOf(facts), reason: "return label refused on a seller-fault return (6.7)", orderId: r.orderId, now }).catch(() => null);
  }
  await enqueueNotification({ userId: r.buyerId, kind: "return-decided", subjectId: r.id, payload: { orderId: r.orderId, approved: true, refundTo: saved.refundTo, labelPayer: shipping.payer } }).catch(() => null);
  return { return: saved, shipping, penalty };
}

/** The refund lands: in Credit (an entry) or to the original method (the order engine's refund, the caller's). */
export async function settleReturnRefund({ returnId, actor = "admin", now = Date.now() } = {}) {
  const r = await getReturn(returnId);
  if (!r || r.state !== "approved") throw new AftersaleRefused("NOT_APPROVED", "only an approved return refunds", 409);
  if (!(r.refundCents > 0)) throw new AftersaleRefused("NO_AMOUNT", "no refund amount", 409);
  if (r.refundTo === "credit") {
    const entry = await creditIn({ userId: r.buyerId, source: "refund", amountCents: r.refundCents, orderId: r.orderId, note: `return ${r.id}`, now });
    await applyOrderEvent({ orderId: r.orderId, type: "refunded", source: "api", newStatus: "refunded", payload: { via: "credit", returnId: r.id, actor } }).catch(() => null);
    return { ...(await saveReturn({ ...r, state: "refunded" })), credit: entry };
  }
  // original method: the order engine's refund path is the caller's (lib/orders.js refundOrder); this records the decision
  return saveReturn({ ...r, state: "refunded" });
}

// ---- the $1 incentive ------------------------------------------------------------------

export async function incentiveFor({ listingId, storefrontId, sellerAccountId, orderId, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return { due: false, reason: "schema v65 unapplied" };
  const facts = await orderFacts(orderId, { now });
  if (!facts) return { due: false, reason: "order not found" };
  let already;
  if (!p) already = mem.returnIncentives.some((r) => r.listing_id === listingId);
  else already = (await p.query("SELECT 1 FROM return_incentives WHERE listing_id=$1", [listingId])).rows.length > 0;
  const due = incentiveDue({ listingReturnsEnabled: facts.law.sellerReturnsEnabled, saleCompleted: facts.paid, refunded: facts.refunded, deliveredAt: facts.law.deliveredAt, now, openIssues: facts.openIssues, alreadyEarned: already });
  if (!due.due) return due;
  const row = { listing_id: listingId, storefront_id: storefrontId, order_id: orderId, amount_cents: RETURN_INCENTIVE_CENTS, earned_at: new Date(now).toISOString() };
  if (!p) mem.returnIncentives.push(row);
  else await p.query("INSERT INTO return_incentives (listing_id, storefront_id, order_id, amount_cents, earned_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (listing_id) DO NOTHING", [row.listing_id, row.storefront_id, row.order_id, row.amount_cents, row.earned_at]);
  const entry = await creditIn({ userId: "sb-" + sellerAccountId, source: "incentive", amountCents: RETURN_INCENTIVE_CENTS, orderId, note: `returns enabled on ${listingId}`, now });
  return { ...due, credit: entry };
}

// ---- dispatch -----------------------------------------------------------------------------

const dispatchOut = (r) => ({ orderId: r.order_id, mode: r.mode, labelPrintedAt: iso(r.label_printed_at), handedAt: iso(r.handed_at), extensions: json(r.extensions) || [] });

export async function getDispatch(orderId) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.orderDispatch.get(orderId); return r ? dispatchOut(r) : null; }
  const { rows } = await p.query("SELECT * FROM order_dispatch WHERE order_id=$1", [orderId]);
  return rows[0] ? dispatchOut(rows[0]) : null;
}

async function saveDispatch(row) {
  const p = await getPool();
  if (!p) { mem.orderDispatch.set(row.order_id, row); return dispatchOut(row); }
  await p.query("INSERT INTO order_dispatch (order_id, mode, label_printed_at, handed_at, extensions) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO UPDATE SET mode=EXCLUDED.mode, label_printed_at=EXCLUDED.label_printed_at, handed_at=EXCLUDED.handed_at, extensions=EXCLUDED.extensions",
    [row.order_id, row.mode, row.label_printed_at, row.handed_at, JSON.stringify(row.extensions || [])]);
  return dispatchOut(row);
}

/** The seller marks a label printed or the parcel handed off; an admin approves an extension. */
export async function markDispatch({ orderId, by, event, mode = "sell", at = Date.now(), extensionMs = null, approved = false, now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const facts = await orderParties(orderId);
  if (!facts) throw new AftersaleRefused("ORDER_NOT_FOUND", "order not found", 404);
  const cur = (await getDispatch(orderId)) || { orderId, mode, labelPrintedAt: null, handedAt: null, extensions: [] };
  const row = { order_id: orderId, mode: cur.mode || mode, label_printed_at: cur.labelPrintedAt, handed_at: cur.handedAt, extensions: cur.extensions };
  if (event === "label" || event === "handoff") {
    if (!sellerOf(facts) || by !== sellerOf(facts)) throw new AftersaleRefused("NOT_THE_SELLER", "only the seller marks their dispatch", 403);
    if (event === "label") row.label_printed_at = row.label_printed_at || new Date(at).toISOString();
    else row.handed_at = row.handed_at || new Date(at).toISOString();
  } else if (event === "extension") {
    if (by !== "admin") throw new AftersaleRefused("NOT_AN_ADMIN", "extensions are approved, never automatic (10.5)", 403);
    const ext = extendDispatch({ extensions: row.extensions, requestedMs: extensionMs, approved });
    if (!ext.ok) throw new AftersaleRefused("EXTENSION_REFUSED", ext.reason, 409);
    row.extensions = [...row.extensions, { ...ext.extension, at: new Date(now).toISOString() }];
  } else throw new AftersaleRefused("INVALID_EVENT", "label, handoff or extension", 400);
  const saved = await saveDispatch(row);
  return { dispatch: saved, late: dispatchLate({ mode: saved.mode, paidAt: facts.order.updated_at || facts.order.created_at, labelPrintedAt: saved.labelPrintedAt, handedAt: saved.handedAt, extensions: saved.extensions, now }) };
}

/** The seller's returns switch on a listing (6.1): enabling earns the $1 once, after the first clean sale. */
export async function setListingReturns(ownerAccountId, listingId, enabled) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const owner = String(ownerAccountId || "").toLowerCase();
  if (!p) {
    const l = mem.nativeListings.get(String(listingId));
    const store = l ? mem.storefronts.get(l.storefront_id) : null;
    if (!l || !store || String(store.owner_account_id).toLowerCase() !== owner) throw new AftersaleRefused("LISTING_NOT_FOUND", "listing not found", 404);
    l.returns_enabled = !!enabled;
    return { listingId: String(listingId), returnsEnabled: !!enabled };
  }
  const r = await p.query("UPDATE native_listings l SET returns_enabled=$3, updated_at=now() FROM storefronts s WHERE l.id=$1 AND s.id=l.storefront_id AND s.owner_account_id=$2 RETURNING l.id", [String(listingId), owner, !!enabled]);
  if (!r.rows[0]) throw new AftersaleRefused("LISTING_NOT_FOUND", "listing not found", 404);
  return { listingId: String(listingId), returnsEnabled: !!enabled };
}

export function resetMemoryAftersale() { mem.orderDeliveries.clear(); mem.orderReturns.clear(); mem.protectionElections.clear(); mem.returnIncentives.length = 0; mem.orderDispatch.clear(); }
