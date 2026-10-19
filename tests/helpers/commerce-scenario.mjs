// tests/helpers/commerce-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 6).
// DATABASE_URL empty runs the memory store, set runs Postgres; one JSON line
// both runs must agree on. The Postgres run writes a run-unique store and
// listing and leaves them (the ledgers are append-only by design); every id
// carries `cmrc-<run>` so a reader can tell a differential's trace apart.
import { randomUUID } from "node:crypto";
import { createStorefront, createStorefrontListing, updateStorefront, updateStorefrontListing, applyStorefrontModerationDecision, applyStorefrontListingModerationDecision } from "../../lib/db/production/storefronts.js";
import * as C from "../../lib/db/production/commerce.js";
import { STOREFRONT_TERMS_VERSION } from "../../lib/storefront/contracts.js";
import { listNotifications } from "../../lib/db/production/listingStatus.js";
import { getItems } from "../../lib/db/index.js";

const run = process.argv[2] || randomUUID().slice(0, 8);
const seller = randomUUID();
const buyer = "sb-" + randomUUID();
const waiter = "u-" + randomUUID();
const T0 = Date.parse("2026-10-18T00:00:00Z");
const out = {};
try {
  const s = await createStorefront({ accountId: seller, name: "Cmrc " + run, slug: "cmrc-" + run, acceptedTermsVersion: STOREFRONT_TERMS_VERSION, accepted: true });
  await updateStorefront(seller, { version: s.storefront.version, status: "pending_review" });
  await applyStorefrontModerationDecision({ storefrontId: s.storefront.id, state: "active", actor: "scenario" });
  const l = await createStorefrontListing(seller, { title: "Scenario lamp " + run, category: "ornaments_home", priceCents: 18000, quantity: 1, operationKey: "cmrc-op-" + run });
  const lid = l.listingId;
  const lv = l.storefront.listings.find((x) => x.id === lid).version;
  await updateStorefrontListing(seller, lid, { version: lv, status: "pending_review" });
  await applyStorefrontListingModerationDecision({ listingId: lid, state: "active", actor: "scenario" });
  out.mode = (await C.setListingMode(seller, lid, "sell")).mode;
  const o = await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 12000, now: T0 });
  out.offer = { state: o.offer.state, auto: o.autoAccepted, by: o.offer.by, expiresAt: o.offer.expiresAt };
  const r = await C.respondOffer({ offerId: o.offer.id, by: "seller", actorId: seller, action: "counter", amountCents: 15000, now: T0 + 1000 });
  out.counter = { parent: r.offer.state, by: r.counter.by, state: r.counter.state, amount: r.counter.amountCents, expiresAt: r.counter.expiresAt };
  const a = await C.respondOffer({ offerId: r.counter.id, by: "buyer", actorId: buyer, action: "accept", now: T0 + 2000 });
  out.accepted = { state: a.offer.state, until: a.offer.acceptedUntil, price: (await C.acceptedOfferFor({ buyerId: buyer, listingId: lid, now: T0 + 3000 }))?.priceCents ?? null, other: await C.acceptedOfferFor({ buyerId: "sb-nobody", listingId: lid, now: T0 + 3000 }) };
  try { await C.respondOffer({ offerId: o.offer.id, by: "seller", actorId: seller, action: "accept", now: T0 + 4000 }); out.respondTwice = "allowed"; } catch (e) { out.respondTwice = e.code; }
  const d = await C.applyDiscount(seller, lid, { percent: 25, now: T0 });
  const item = (await getItems(["native-" + lid])).get("native-" + lid);
  out.discount = { price: d.discount.priceCents, projected: item ? Number(item.price_cents) : null, endsAt: d.discount.endsAt, likers: d.likers };
  out.discountLater = await C.activeDiscount(lid, T0 + 25 * 3_600_000);
  out.restored = Number((await getItems(["native-" + lid])).get("native-" + lid).price_cents);
  out.history = (await C.priceHistory(lid)).map((h) => [h.priceCents, h.reason]);
  out.queue = { joined: (await C.joinQueue({ userId: waiter, listingId: lid, now: T0 })).joined, again: (await C.joinQueue({ userId: waiter, listingId: lid, now: T0 + 1 })).joined, position: await C.queuePosition({ userId: waiter, listingId: lid }) };
  out.sold = { invalidated: await C.invalidateOffersOnSale(lid, { now: T0 + 5000 }), queue: await C.notifyQueue(lid, "sold", { now: T0 }) };
  out.afterSold = (await C.listOffersForSeller(seller, { now: T0 + 6000 })).map((x) => x.liveState).sort();
  await C.setOfferSettings(seller, { acceptOffers: false });
  try { await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 100, now: T0 }); out.closed = "allowed"; } catch (e) { out.closed = e.code; }
  out.settings = await C.setOfferSettings(seller, { acceptOffers: true, autoAcceptCents: 17000 });
  out.auto = (await C.makeOffer({ buyerId: buyer, listingId: lid, amountCents: 17500, now: T0 })).autoAccepted;
  try { await C.relistListing(seller, lid, { confirm: false }, { now: T0 }); out.relistRefused = "allowed"; } catch (e) { out.relistRefused = e.code; }
  const rel = await C.relistListing(seller, lid, { confirm: true, conditionConfirmed: true, conditionChanged: true, condition: "chip on base", photos: ["https://example.test/" + run + ".jpg"], priceCents: 14000, quantity: 1 }, { now: T0 });
  out.relist = { ok: rel.relisted, price: rel.plan.priceCents, cancelDiscounts: rel.plan.cancelDiscounts, queue: rel.queue.kind, count: (await C.listRelists(lid)).length, projected: Number((await getItems(["native-" + lid])).get("native-" + lid).price_cents) };
  out.notices = { buyer: (await listNotifications(buyer)).map((n) => n.kind).sort(), waiter: (await listNotifications(waiter)).map((n) => n.kind).sort(), seller: (await listNotifications(seller)).map((n) => n.kind).sort() };
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
