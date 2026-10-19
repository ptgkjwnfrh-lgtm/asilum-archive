// tests/helpers/money-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 11).
// DATABASE_URL empty runs the memory store, set runs Postgres (CI applies every
// staged migration, v70 included); one JSON line both runs must agree on. The
// Postgres run writes run-unique rows (two Wardrobe pieces, offers, an order,
// a payout) and leaves them — the ledgers are append-only.
import { randomUUID } from "node:crypto";
import * as M from "../../lib/db/production/money.js";
import * as A from "../../lib/db/production/aftersale.js";
import { createWardrobeItem } from "../../lib/db/production/interpretation.js";
import { createOrderWithEvent, applyOrderEvent } from "../../lib/db/orders.js";
import { listNotifications } from "../../lib/db/production/listingStatus.js";
import { mem } from "../../lib/db/production/store.js";
import { getPool } from "../../lib/db/core/pool.js";

const owner = "sb-" + randomUUID();
const buyer = "sb-" + randomUUID();
const other = "sb-" + randomUUID();
const T0 = Date.parse("2026-10-20T00:00:00Z");
const D = 86_400_000, H = 3_600_000;
const out = {};
const code = (fn) => fn().then(() => "allowed").catch((e) => e.code || String(e.message));
async function attachOrder(offerId, orderId) {
  const p = await getPool();
  if (!p) { mem.wardrobeOffers.set(offerId, { ...mem.wardrobeOffers.get(offerId), order_id: orderId }); return; }
  await p.query("UPDATE wardrobe_offers SET order_id=$2 WHERE id=$1", [offerId, orderId]);
}
try {
  const a = await createWardrobeItem({ userId: owner, source: "manual", title: "scenario bomber " + owner.slice(3, 9), colors: [], tags: {} });
  const b = await createWardrobeItem({ userId: owner, source: "manual", title: "scenario coat " + owner.slice(3, 9), colors: [], tags: {} });
  const itemA = String(a.item.id), itemB = String(b.item.id);
  out.offersOffByDefault = await code(() => M.openWardrobeOffer({ itemId: itemA, buyerId: buyer, amountCents: 9000, viaMessage: true, now: T0 }));
  const on = await M.setAcceptOffers({ ownerId: owner, itemId: itemA, on: true, now: T0 });
  await M.setAcceptOffers({ ownerId: owner, itemId: itemB, on: true, now: T0 });
  out.toggle = { on: on.piece.acceptOffers, notMine: await code(() => M.setAcceptOffers({ ownerId: buyer, itemId: itemA, on: true })) };
  out.noButton = await code(() => M.openWardrobeOffer({ itemId: itemA, buyerId: buyer, amountCents: 9000, viaMessage: false, now: T0 }));
  const o = await M.openWardrobeOffer({ itemId: itemA, buyerId: buyer, amountCents: 9000, conversationId: randomUUID(), viaMessage: true, now: T0 });
  out.opened = { state: o.state, owner: o.ownerId === owner, expiresAt: o.expiresAt };
  out.secondBuyer = await code(() => M.openWardrobeOffer({ itemId: itemA, buyerId: other, amountCents: 9500, viaMessage: true, now: T0 + H }));
  out.buyerAnswers = await code(() => M.respondWardrobeOffer({ offerId: o.id, ownerId: buyer, decision: "accept", now: T0 + H }));
  const acc = await M.respondWardrobeOffer({ offerId: o.id, ownerId: owner, decision: "accept", now: T0 + H });
  out.accepted = { state: acc.state, acceptedUntil: acc.acceptedUntil, hidden: (await M.wardrobePiece(itemA)).hiddenUntilPaid !== false };
  out.unkeyedCheckout = await code(() => M.startWardrobeCheckout({ offerId: o.id, buyerId: buyer, now: T0 + 2 * H }));
  const order = await createOrderWithEvent({ user: buyer, itemId: `wardrobe-${itemA}`, amountCents: 9000, feeCents: 235, currency: "usd", kind: "sale" });
  await attachOrder(o.id, order.id);
  await applyOrderEvent({ orderId: order.id, type: "paid", source: "scenario", newStatus: "paid" });
  const settled = await M.settleWardrobeOrder(order.id, { now: T0 + 3 * H });
  out.settled = { settled: settled.settled, state: settled.offer.state, again: (await M.settleWardrobeOrder(order.id)).duplicate === true };
  let payout = await M.getPayout(order.id);
  out.payout0 = { state: payout.state, rail: payout.rail, amount: payout.amountCents, seller: payout.sellerId === owner };
  out.releaseEarly = await code(() => M.releasePayout({ orderId: order.id, now: T0 + 4 * H }));
  const sd = await A.recordDelivery({ orderId: order.id, by: "admin", source: "admin", deliveredAt: T0 + 5 * D, now: T0 + 5 * D });
  out.sellerDelivery = { moved: sd.transfer.moved, ownerStill: (await M.wardrobePiece(itemA)).ownerId === owner };
  out.payoutWindow = (await M.refreshPayout(order.id, { now: T0 + 6 * D })).state;
  out.payoutOpen = (await M.refreshPayout(order.id, { now: T0 + 20 * D })).state;
  out.deducted = (await M.deductFromPayout({ orderId: order.id, returnId: "ret-" + owner.slice(3, 9), amountCents: 1500, now: T0 + 20 * D })).netCents;
  const rel = await M.releasePayout({ orderId: order.id, by: "desk", now: T0 + 21 * D });
  out.released = { state: rel.payout.state, provider: rel.payout.provider, net: rel.payout.netCents, twice: await code(() => M.releasePayout({ orderId: order.id })) };
  out.cancelAfter = await code(() => M.cancelWardrobeSale({ offerId: o.id, ownerId: owner, now: T0 + 21 * D }));
  out.listed = { mine: (await M.listPayouts({ sellerId: owner })).length, asOwner: (await M.listWardrobeOffers({ ownerId: owner })).length, asBuyer: (await M.listWardrobeOffers({ buyerId: buyer })).length };
  // piece B: a decline rests it, the toggle cancels, the job expires
  const o2 = await M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 5000, viaMessage: true, now: T0 });
  const dec = await M.respondWardrobeOffer({ offerId: o2.id, ownerId: owner, decision: "decline", now: T0 + H });
  out.declined = { state: dec.state, resting: await code(() => M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 5500, viaMessage: true, now: T0 + 2 * D })), cooldown: (await M.wardrobePiece(itemB)).offerCooldownUntil };
  const later = T0 + 15 * D;
  const o3 = await M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 5500, viaMessage: true, now: later });
  const off = await M.setAcceptOffers({ ownerId: owner, itemId: itemB, on: false, now: later + H });
  out.turnedOff = { cancelled: off.cancelled.map((x) => x.id === o3.id && x.state), accepts: off.piece.acceptOffers, refused: await code(() => M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 5500, viaMessage: true, now: later + 2 * H })) };
  await M.setAcceptOffers({ ownerId: owner, itemId: itemB, on: true, now: later + 3 * H });
  const o4 = await M.openWardrobeOffer({ itemId: itemB, buyerId: buyer, amountCents: 6000, viaMessage: true, now: later + 4 * H });
  const swept = await M.sweepWardrobeOffers(later + 4 * D);
  out.swept = { count: swept, state: (await M.listWardrobeOffers({ itemId: itemB })).find((x) => x.id === o4.id).state, resting: !!(await M.wardrobePiece(itemB)).offerCooldownUntil };
  out.ownerNotices = [...new Set((await listNotifications(owner)).map((n) => n.kind))].sort();
  out.buyerNotices = [...new Set((await listNotifications(buyer)).map((n) => n.kind))].sort();
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
