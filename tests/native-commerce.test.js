// tests/native-commerce.test.js — NATIVE COMMERCE (V.2 Blueprint, owner,
// 17 Oct 2026, chapters 7 and 8; slice 6 over codex/native-storefront).
// The law (lib/storefront/commerce.js) is pure; the rows
// (lib/db/production/commerce.js) run on the memory store; the routes are
// called through the test harness. Laws held:
//   * SELL is single-item, DROP carries quantities and variations and is
//     authenticated before release (7.4, 12.2);
//   * the Bag reserves nothing; every unit in a checkout reads "reserved";
//     others wait in a first-come queue; a release is a courtesy; a sale
//     closes it; a return reopens it (7.6, 7.9–7.13);
//   * an offer stands 24 hours and cannot be withdrawn; accept, decline or
//     counter; every counter restarts the window for the receiving party;
//     acceptance unlocks checkout at the agreed price for that buyer only
//     for 24 hours and reserves nothing; a sale invalidates it; unlimited
//     offers; auto-accept at the threshold; reminder presets (7.19–7.30,
//     8.7–8.11);
//   * a discount runs 24 hours, restores the price itself, renews by hand,
//     notifies the likers at 10% or more above their own threshold on every
//     application and renewal, shows the price with the percent off, keeps
//     a private history (7.31–7.34, 8.1–8.6, 8.13);
//   * a relist needs the seller's and the condition's confirmation, new
//     details and photographs when the condition changed, any new price,
//     no surviving discount, carried-over likes (7.14–7.18, 8.12);
//   * the seller's settings decide offers during a discount and stacking (7.19).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../lib/storefront/commerce.js";
import * as C from "../lib/db/production/commerce.js";
import { createStorefront, createStorefrontListing, updateStorefront, updateStorefrontListing, applyStorefrontModerationDecision, applyStorefrontListingModerationDecision, getStorefrontForOwner } from "../lib/db/production/storefronts.js";
import { STOREFRONT_TERMS_VERSION } from "../lib/storefront/contracts.js";
import { listNotifications, setNotificationPrefs, getNotificationPrefs, resetMemoryListingStatus, NOTIFICATION_KINDS } from "../lib/db/production/listingStatus.js";
import { getItems, upsertItems } from "../lib/db/index.js";
import { mem as production } from "../lib/db/production/store.js";
import { callRoute, loadRoute } from "./helpers/route.js";

const T0 = Date.parse("2026-10-18T00:00:00Z");
const H = 3_600_000;
let n = 0;
const uuid = () => globalThis.crypto.randomUUID();

/** An active store with one active listing, in memory. */
async function activeListing({ priceCents = 18000, quantity = 1, seller = uuid() } = {}) {
  const s = await createStorefront({ accountId: seller, name: "Store " + (++n), slug: "store-" + n + "-" + uuid().slice(0, 6), acceptedTermsVersion: STOREFRONT_TERMS_VERSION, accepted: true });
  await updateStorefront(seller, { version: s.storefront.version, status: "pending_review" });
  await applyStorefrontModerationDecision({ storefrontId: s.storefront.id, state: "active", actor: "test" });
  const l = await createStorefrontListing(seller, { title: "Lamp " + n, category: "ornaments_home", priceCents, quantity, operationKey: "op-" + uuid() });
  const lid = l.listingId;
  const lv = l.storefront.listings.find((x) => x.id === lid).version;
  await updateStorefrontListing(seller, lid, { version: lv, status: "pending_review" });
  await applyStorefrontListingModerationDecision({ listingId: lid, state: "active", actor: "test" });
  return { seller, storeId: s.storefront.id, lid, itemId: "native-" + lid };
}

test.beforeEach(() => { C.resetMemoryCommerce(); resetMemoryListingStatus(); });

test("SELL and DROP: the shape fits the mode; a DROP is authenticated before release; a SELL is live as PENDING", () => {
  assert.deepEqual(L.MODES, ["sell", "drop"]);
  assert.equal(L.validateMode("sell", { quantity: 1 }).ok, true);
  assert.equal(L.validateMode("sell", { quantity: 2 }).ok, false);
  assert.equal(L.validateMode("sell", { variants: [{ stockOnHand: 1 }, { stockOnHand: 1 }] }).ok, false, "one variant");
  assert.equal(L.validateMode("sell", { variants: [{ stockOnHand: 1, optionValues: { size: "M" } }] }).ok, false, "no variations");
  assert.equal(L.validateMode("drop", { quantity: 200, variants: [{ stockOnHand: 100, optionValues: { size: "M" } }, { stockOnHand: 100, optionValues: { size: "L" } }] }).ok, true);
  assert.equal(L.validateMode("rent", {}).ok, false);
  assert.equal(L.modeOf({ variants: [{ stockOnHand: 1 }] }), "sell");
  assert.equal(L.modeOf({ quantity: 24 }), "drop");
  assert.equal(L.modeOf({ mode: "drop", quantity: 1 }), "drop", "the column wins");
  assert.equal(L.releasable("drop", "pending").ok, false);
  assert.equal(L.releasable("drop", "verified").ok, true);
  assert.equal(L.releasable("sell", "pending").ok, true);
});

test("availability and the queue: reserved means every unit is in a checkout; the queue is first come; a release is a courtesy, a sale closes it, a return reopens it", () => {
  assert.equal(L.availabilityOf({ stockOnHand: 1, stockReserved: 0 }), "available");
  assert.equal(L.availabilityOf({ stockOnHand: 1, stockReserved: 1 }), "reserved");
  assert.equal(L.availabilityOf({ stockOnHand: 0, stockReserved: 0 }), "sold_out");
  const members = [{ userId: "b", joinedAt: T0 + 5 }, { userId: "a", joinedAt: T0 }, { userId: "c", joinedAt: T0 + 9, state: "closed" }];
  assert.deepEqual(L.queueOrder(members).map((m) => m.userId), ["a", "b", "c"]);
  assert.deepEqual(L.queueEvent("released", members), { notify: ["a", "b"], kind: "queue-available", close: false });
  assert.deepEqual(L.queueEvent("sold", members), { notify: ["a", "b"], kind: "queue-sold", close: true });
  assert.deepEqual(L.queueEvent("returned", members), { notify: ["a", "b", "c"], kind: "queue-returned", close: false, reopen: true });
  assert.deepEqual(L.queueEvent("nothing", members), { notify: [], kind: null, close: false });
});

test("offers: 24 hours, no withdrawal, accept / decline / counter by the receiving party, a counter restarts the window, acceptance unlocks a private price for 24 hours, a sale invalidates", () => {
  const made = L.newOffer({ listingId: "l", buyerId: "b", sellerAccountId: "s", amountCents: 6000, listPriceCents: 10000, now: T0 });
  assert.equal(made.ok, true);
  const o = { ...made.offer, id: "o1" };
  assert.equal(o.expiresAt, new Date(T0 + 24 * H).toISOString());
  assert.equal(L.offerState(o, T0 + 23 * H), "open"); assert.equal(L.offerState(o, T0 + 24 * H), "expired");
  assert.equal(L.newOffer({ listingId: "l", buyerId: "b", sellerAccountId: "s", amountCents: 0 }).ok, false);
  assert.equal(L.newOffer({ listingId: "l", buyerId: "b", sellerAccountId: "s", amountCents: 200000, listPriceCents: 10000 }).ok, false, "ten times the price is a typo");
  assert.equal(L.respondToOffer(o, { action: "accept", by: "buyer", now: T0 }).ok, false, "only the receiving party answers");
  assert.equal(L.respondToOffer(o, { action: "withdraw", by: "seller", now: T0 }).ok, false, "nothing is withdrawn (8.9)");
  const countered = L.respondToOffer(o, { action: "counter", amountCents: 7500, by: "seller", now: T0 + 4 * H });
  assert.equal(countered.offer.state, "countered"); assert.equal(countered.counter.by, "seller"); assert.equal(countered.counter.parentId, "o1");
  assert.equal(countered.counter.expiresAt, new Date(T0 + 28 * H).toISOString(), "the counter restarts the 24 hours for the buyer (7.25)");
  const accepted = L.respondToOffer({ ...countered.counter, id: "o2" }, { action: "accept", by: "buyer", now: T0 + 5 * H });
  assert.equal(accepted.offer.state, "accepted"); assert.equal(accepted.offer.acceptedUntil, new Date(T0 + 29 * H).toISOString());
  assert.equal(L.acceptedPriceFor(accepted.offer, "b", T0 + 6 * H), 7500);
  assert.equal(L.acceptedPriceFor(accepted.offer, "someone-else", T0 + 6 * H), null, "for that buyer only (8.7)");
  assert.equal(L.acceptedPriceFor(accepted.offer, "b", T0 + 29 * H), null, "the window closes (8.8)");
  assert.equal(L.offerState(accepted.offer, T0 + 29 * H), "expired");
  const sold = L.invalidateOnSale(accepted.offer, T0 + 7 * H);
  assert.equal(sold.state, "invalidated"); assert.match(sold.note, /never reserve inventory/);
  assert.equal(L.invalidateOnSale({ ...o, state: "declined" }).state, "declined", "a closed offer is left alone");
  assert.equal(L.respondToOffer(o, { action: "decline", by: "seller", now: T0 }).offer.state, "declined");
  assert.equal(L.respondToOffer(o, { action: "accept", by: "seller", now: T0 + 25 * H }).ok, false, "expired cannot be accepted");
  assert.equal(L.autoAccepts({ by: "buyer", amountCents: 9000 }, { autoAcceptCents: 8500 }), true);
  assert.equal(L.autoAccepts({ by: "seller", amountCents: 9000 }, { autoAcceptCents: 8500 }), false, "a counter never auto-accepts");
  assert.equal(L.autoAccepts({ by: "buyer", amountCents: 8000 }, { autoAcceptCents: 8500 }), false);
});

test("offer reminders: the presets, Standard by default, times before expiry in order and only those still ahead", () => {
  assert.deepEqual(L.REMINDER_PRESETS.minimal, [60]);
  assert.deepEqual(L.REMINDER_PRESETS.standard, [720, 180, 30]);
  assert.deepEqual(L.REMINDER_PRESETS.frequent, [720, 360, 180, 60, 30, 5]);
  assert.equal(L.DEFAULT_REMINDER_PRESET, "standard");
  const end = T0 + 24 * H;
  assert.deepEqual(L.reminderTimes(end, "standard", T0), [new Date(end - 12 * H).toISOString(), new Date(end - 3 * H).toISOString(), new Date(end - 30 * 60_000).toISOString()]);
  assert.equal(L.reminderTimes(end, "frequent", T0 + 23 * H).length, 2, "an hour out: only the 30- and 5-minute reminders remain");
  assert.equal(L.reminderTimes(end, "nonsense", T0).length, 3, "an unknown preset is Standard");
});

test("offers are allowed by the seller's rules: not on an inactive listing, not when offers are off, not during a discount when the seller says so", () => {
  assert.equal(L.offerAllowed({ listing: { state: "active" } }).ok, true);
  assert.equal(L.offerAllowed({ listing: { state: "paused" } }).ok, false);
  assert.equal(L.offerAllowed({ listing: { state: "active" }, settings: { acceptOffers: false } }).ok, false);
  assert.equal(L.offerAllowed({ listing: { state: "active" }, discountActive: true, settings: { offersDuringDiscount: false } }).ok, false);
  assert.equal(L.offerAllowed({ listing: { state: "active" }, discountActive: true, settings: { offersDuringDiscount: true } }).ok, true);
});

test("discounts: 1–90 percent for 24 hours, half-up cents, the likers told at 10% or more above their own threshold, the price shown with the percent off", () => {
  assert.equal(L.percentOff(10000, 30), 7000); assert.equal(L.percentOff(999, 33), 669, "half up");
  const d = L.newDiscount({ listingId: "l", percent: 30, priceBeforeCents: 18000, now: T0 });
  assert.equal(d.ok, true); assert.equal(d.discount.priceCents, 12600); assert.equal(d.discount.endsAt, new Date(T0 + 24 * H).toISOString());
  assert.equal(L.newDiscount({ listingId: "l", percent: 95, priceBeforeCents: 100 }).ok, false);
  assert.equal(L.newDiscount({ listingId: "l", percent: 0, priceBeforeCents: 100 }).ok, false);
  assert.equal(L.discountActive(d.discount, T0 + 23 * H), true); assert.equal(L.discountActive(d.discount, T0 + 24 * H), false);
  assert.equal(L.discountNotifies(9), false, "the platform floor is 10% (8.1)"); assert.equal(L.discountNotifies(10), true);
  assert.equal(L.discountNotifies(15, 20), false, "the passenger's own threshold (7.34)"); assert.equal(L.discountNotifies(25, 20), true);
  assert.equal(L.discountNotifies(15, 5), true, "a threshold below the floor is the floor");
  assert.deepEqual(L.displayPrice(18000, d.discount, T0 + H), { priceCents: 12600, percentOff: 30, discounted: true });
  assert.deepEqual(L.displayPrice(18000, d.discount, T0 + 25 * H), { priceCents: 18000, percentOff: 0, discounted: false });
});

test("relisting: the seller confirms, the condition is confirmed, a changed condition needs details and new photographs, any new price, discounts die, likes stay", () => {
  const listing = { condition: "good", photos: ["https://p/1.jpg"], priceCents: 18000 };
  assert.deepEqual(L.relistPlan({ listing }).reasons, ["seller confirmation is required for every relisting (7.14)", "confirm the condition (7.15)"]);
  const changed = L.relistPlan({ listing, confirm: true, conditionConfirmed: true, conditionChanged: true, condition: "stain", photos: ["https://p/1.jpg"], priceCents: 14000 });
  assert.deepEqual(changed.reasons, ["a changed condition needs new photographs (7.16)"]);
  const ok = L.relistPlan({ listing, confirm: true, conditionConfirmed: true, conditionChanged: true, condition: "stain on cuff", photos: ["https://p/2.jpg"], priceCents: 14000, quantity: 1 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.plan, { condition: "stain on cuff", photos: ["https://p/2.jpg"], priceCents: 14000, quantity: 1, cancelDiscounts: true, preserveEngagement: true, previousPricePrivate: true });
  const same = L.relistPlan({ listing, confirm: true, conditionConfirmed: true });
  assert.equal(same.plan.priceCents, 18000, "the price stays unless the seller sets one"); assert.equal(same.plan.condition, "good");
  assert.equal(L.relistPlan({ listing, confirm: true, conditionConfirmed: true, priceCents: 0 }).ok, false);
});

test("the rows: an offer round-trip with notifications, a private accepted price, a sale's invalidation, the seller's settings and auto-accept", async () => {
  const { seller, lid } = await activeListing();
  const buyer = "sb-" + uuid();
  const o = await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 12000, now: T0 });
  assert.equal(o.offer.state, "open"); assert.equal(o.autoAccepted, false);
  assert.deepEqual((await listNotifications(seller)).map((x) => x.kind), ["offer-new"]);
  const wrong = await C.respondOffer({ offerId: o.offer.id, by: "seller", actorId: uuid(), action: "accept", now: T0 }).catch((e) => e);
  assert.equal(wrong.code, "NOT_A_PARTY");
  const r = await C.respondOffer({ offerId: o.offer.id, by: "seller", actorId: seller, action: "counter", amountCents: 15000, now: T0 + H });
  assert.equal(r.offer.state, "countered"); assert.equal(r.counter.by, "seller"); assert.equal(r.counter.parentId, o.offer.id);
  assert.deepEqual((await listNotifications(buyer)).map((x) => x.kind), ["offer-counter"]);
  const a = await C.respondOffer({ offerId: r.counter.id, by: "buyer", actorId: buyer, action: "accept", now: T0 + 2 * H });
  assert.equal(a.offer.state, "accepted");
  const held = await C.acceptedOfferFor({ buyerId: buyer, listingId: lid, now: T0 + 3 * H });
  assert.equal(held.priceCents, 15000);
  assert.equal(await C.acceptedOfferFor({ buyerId: "sb-" + uuid(), listingId: lid, now: T0 + 3 * H }), null);
  assert.equal(await C.acceptedOfferFor({ buyerId: buyer, listingId: lid, now: T0 + 27 * H }), null, "expired");
  const mine = await C.listOffersForBuyer(buyer, { now: T0 + 3 * H });
  assert.deepEqual(mine.map((x) => [x.by, x.liveState]), [["seller", "accepted"], ["buyer", "countered"]]);
  assert.equal(await C.invalidateOffersOnSale(lid, { now: T0 + 4 * H }), 1);
  assert.ok((await listNotifications(buyer)).map((x) => x.kind).includes("offer-invalidated"));
  assert.equal(await C.acceptedOfferFor({ buyerId: buyer, listingId: lid, now: T0 + 5 * H }), null, "a sale invalidates the private price (7.22)");
  await C.setOfferSettings(seller, { acceptOffers: false });
  const closed = await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 100, now: T0 }).catch((e) => e);
  assert.equal(closed.code, "OFFERS_CLOSED");
  const settings = await C.setOfferSettings(seller, { acceptOffers: true, autoAcceptCents: 17000 });
  assert.deepEqual(settings, { acceptOffers: true, offersDuringDiscount: true, discountsStack: false, autoAcceptCents: 17000 });
  const auto = await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 17500, now: T0 });
  assert.equal(auto.autoAccepted, true); assert.equal(auto.offer.state, "accepted");
  assert.equal((await C.acceptedOfferFor({ buyerId: buyer, listingId: lid, now: T0 + H })).priceCents, 17500);
  assert.equal(await C.expireOffers(T0 + 30 * H), 1, "lazy expiry sweeps the accepted window");
});

test("the rows: a discount changes the projected price for 24 hours, restores itself, renews by hand, cancels, notifies likers above their threshold, keeps a private history", async () => {
  const { seller, lid, itemId } = await activeListing({ priceCents: 18000 });
  const liker = "u-" + uuid(), picky = "u-" + uuid();
  await upsertItems([{ id: itemId, title: "x", brand: "x", category: "ornaments_home", tags: {} }]);
  // likes: the interaction ledger is what usersWhoKept reads
  const { mem } = await import("../lib/db/core/store.js");
  mem.interactions.push({ userId: liker, itemId, action: "favorite" }, { userId: picky, itemId, action: "favorite" });
  await setNotificationPrefs(picky, { discountMinPercent: 40 });
  const d = await C.applyDiscount(seller, lid, { percent: 25, now: T0 });
  assert.equal(d.discount.priceCents, 13500); assert.equal(d.likers, 2); assert.equal(d.notified, 1, "the 40% threshold passenger is not told at 25%");
  assert.equal(Number((await getItems([itemId])).get(itemId).price_cents), 13500, "the catalog shows the discounted price");
  assert.equal((await C.activeDiscount(lid, T0 + 23 * H)).percent, 25);
  const renewed = await C.applyDiscount(seller, lid, { percent: 25, now: T0 + 23 * H, renew: true });
  assert.equal(renewed.discount.renewedFrom, d.discount.id); assert.equal(renewed.discount.priceBeforeCents, 18000, "a renewal discounts the original, never the discounted");
  assert.equal(renewed.notified, 1, "every renewal notifies again, even at the same percentage (7.33)");
  assert.equal(await C.activeDiscount(lid, T0 + 48 * H), null, "after 24 more hours it is over");
  assert.equal(Number((await getItems([itemId])).get(itemId).price_cents), 18000, "the original price is restored automatically (7.31)");
  const again = await C.applyDiscount(seller, lid, { percent: 10, now: T0 + 50 * H });
  assert.equal((await C.cancelDiscount(seller, lid, { now: T0 + 51 * H })).cancelled, true);
  assert.equal(Number((await getItems([itemId])).get(itemId).price_cents), 18000, "cancelling restores immediately (8.3)");
  assert.equal(await C.activeDiscount(lid, T0 + 51 * H), null);
  const history = await C.priceHistory(lid);
  assert.ok(history.length >= 5); assert.ok(history.every((h) => typeof h.reason === "string" && h.priceCents > 0));
  assert.equal((await C.applyDiscount(seller, lid, { percent: 95, now: T0 }).catch((e) => e)).code, "INVALID_DISCOUNT");
  assert.equal((await C.applyDiscount(uuid(), lid, { percent: 10 }).catch((e) => e)).code, "LISTING_NOT_FOUND", "another seller cannot discount it");
  void again;
});

test("the rows: the queue is joined once, ordered first come, told on sale and closed, told again on return; a relist records everything and tells the queue", async () => {
  const { seller, lid, itemId } = await activeListing({ priceCents: 18000 });
  const a = "u-" + uuid(), b = "u-" + uuid();
  assert.equal((await C.joinQueue({ userId: b, listingId: lid, now: T0 + 5 })).joined, true);
  assert.equal((await C.joinQueue({ userId: a, listingId: lid, now: T0 })).joined, true);
  assert.equal((await C.joinQueue({ userId: a, listingId: lid, now: T0 + 9 })).joined, false, "once");
  assert.deepEqual(await C.queuePosition({ userId: b, listingId: lid }), { waiting: 2, position: 2 });
  const sold = await C.notifyQueue(lid, "sold", { now: T0 });
  assert.deepEqual(sold, { notified: 2, kind: "queue-sold", closed: true });
  assert.deepEqual(await C.queuePosition({ userId: a, listingId: lid }), { waiting: 0, position: null });
  await C.applyDiscount(seller, lid, { percent: 20, now: T0 });
  const refused = await C.relistListing(seller, lid, { confirm: true }, { now: T0 }).catch((e) => e);
  assert.equal(refused.code, "RELIST_INCOMPLETE"); assert.match(refused.message, /confirm the condition/);
  const rel = await C.relistListing(seller, lid, { confirm: true, conditionConfirmed: true, conditionChanged: true, condition: "chip on base", photos: ["https://p/new.jpg"], priceCents: 14000, quantity: 1 }, { now: T0 + H });
  assert.equal(rel.relisted, true); assert.equal(rel.queue.kind, "queue-returned"); assert.equal(rel.queue.notified, 2, "a return tells everyone from the queue (7.13)");
  assert.equal(await C.activeDiscount(lid, T0 + H), null, "discounts do not survive a relist (8.12)");
  assert.equal(Number((await getItems([itemId])).get(itemId).price_cents), 14000);
  const env = await getStorefrontForOwner(seller);
  assert.equal(env.storefront.listings[0].condition, "chip on base"); assert.deepEqual(env.storefront.listings[0].photos, ["https://p/new.jpg"]);
  assert.equal(env.storefront.listings[0].mode, "sell");
  assert.equal((await C.listRelists(lid)).length, 1);
  assert.ok((await listNotifications(a)).map((x) => x.kind).includes("queue-returned"));
  await assert.rejects(() => C.setListingMode(seller, lid, "nonsense"), /mode must be/);
  assert.equal((await C.setListingMode(seller, lid, "drop")).mode, "drop");
});

test("the notification kinds and the commerce preferences: the threshold floor, the reminder preset, the queue switch", async () => {
  for (const k of ["offer-new", "offer-counter", "offer-accepted", "offer-declined", "offer-expiring", "offer-invalidated", "discount", "queue-available", "queue-sold", "queue-returned"]) assert.ok(NOTIFICATION_KINDS.includes(k), k);
  const u = "u-" + uuid();
  assert.deepEqual(await getNotificationPrefs(u), { soldLikes: true, discountMinPercent: 10, offerReminders: "standard", queueAlerts: true });
  assert.deepEqual(await setNotificationPrefs(u, { discountMinPercent: 3, offerReminders: "frequent", queueAlerts: false }), { soldLikes: true, discountMinPercent: 10, offerReminders: "frequent", queueAlerts: false });
  assert.equal((await setNotificationPrefs(u, { offerReminders: "loud" })).offerReminders, "standard", "an unknown preset is Standard");
});

test("the routes: offers need an account, the buyer answers a counter, the queue takes any identity, the seller's actions ride /api/storefront", async () => {
  const { seller, lid } = await activeListing();
  const offers = await loadRoute("app/api/storefront/offers/route.js");
  const queue = await loadRoute("app/api/storefront/queue/route.js");
  const store = await loadRoute("app/api/storefront/route.js");
  const device = "u-" + uuid();
  const buyerAccount = uuid();
  const buyer = "sb-" + buyerAccount;
  const anon = await callRoute(offers.POST, { path: "/api/storefront/offers", method: "POST", json: { listingId: lid, amountCents: 1000 } });
  assert.equal(anon.status, 401);
  const dev = await callRoute(offers.POST, { path: "/api/storefront/offers", method: "POST", json: { user: device, listingId: lid, amountCents: 1000 }, cookies: { "asilum-uid": device } });
  assert.ok([401, 403].includes(dev.status), "a device identity cannot carry an offer");
  const made = await callRoute(offers.POST, { path: "/api/storefront/offers", method: "POST", json: { user: buyer, listingId: lid, amountCents: 12000 }, bearer: "sb:" + buyerAccount });
  if (made.status !== 201) { assert.ok([401, 403].includes(made.status), "without a verified bearer the route refuses honestly: " + made.status); return; }
  assert.equal(made.body.offer.state, "open");
  const sellerAnswer = await callRoute(store.POST, { path: "/api/storefront", method: "POST", json: { user: "sb-" + seller, action: "offer_respond", offerId: made.body.offer.id, offerAction: "counter", amountCents: 15000 }, bearer: "sb:" + seller });
  assert.equal(sellerAnswer.status, 200);
  const q = await callRoute(queue.POST, { path: "/api/storefront/queue", method: "POST", json: { user: device, listingId: lid, join: true }, cookies: { "asilum-uid": device } });
  assert.ok([200, 201, 401].includes(q.status));
});
