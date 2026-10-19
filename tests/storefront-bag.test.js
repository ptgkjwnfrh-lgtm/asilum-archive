// tests/storefront-bag.test.js — The bag with native items: legacy and native
// pieces share one versioned bag without id collisions, and a missing price
// stays missing, never zero.

import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  dispatchEvent() {},
};

const { bagAdd, bagLineKey, bagList, bagRemove, bagSetQuantity } = await import("../lib/client.js");

test("legacy and native items share one versioned bag without identity collision", () => {
  storage.clear();
  bagAdd({ id: "external-1", title: "External", price: 10, currency: "USD" });
  const native = {
    id: "item-native", title: "Native", price: 20, price_cents: 2_000,
    commerce_rail: "native_storefront", source_name: "asilum-native",
    native_listing_id: "listing-one", default_variant_id: "variant-blue",
    storefront_slug: "objects",
  };
  bagAdd(native);
  bagAdd(native);
  const rows = bagList();
  assert.equal(rows.length, 2, "adding the same listing+variant is idempotent");
  assert.equal(rows[0].quantity, 1, "legacy lines migrate to quantity one");
  assert.equal(rows[0].price_cents, 1_000, "legacy display price migrates to cents");
  assert.equal(rows[1].bag_key, "native:listing-one:variant-blue");
  assert.equal(rows[1].storefront_slug, "objects");

  bagSetQuantity(rows[1].bag_key, 3);
  assert.equal(bagList()[1].quantity, 3);
  bagRemove(rows[1].bag_key);
  assert.deepEqual(bagList().map((row) => row.id), ["external-1"]);
  assert.equal(bagLineKey({ id: "x" }), "x");
});

test("null is not zero: an external record arrives with price_cents null and keeps its display price in cents (slice 6 review finding)", () => {
  storage.clear();
  bagAdd({ id: "ebay-1", title: "Jeans", price: 251.33, price_cents: null, currency: "USD", source: "ebay" });
  bagAdd({ id: "ebay-2", title: "Free", price: 0, price_cents: null, currency: "USD", source: "ebay" });
  const rows = bagList();
  assert.equal(rows[0].price_cents, 25_133, "the display price, in cents — not 0");
  assert.equal(rows[1].price_cents, null, "a zero price is no price, never a free line");
  bagAdd({ id: "native-x", title: "Native", price: 20, price_cents: 2_000, commerce_rail: "native_storefront", source_name: "asilum-native", native_listing_id: "l", default_variant_id: "v" });
  assert.equal(bagList()[2].price_cents, 2_000, "a stamped integer price is kept as is");
  // a line the earlier bug stored at 0 cents heals on read
  storage.set("asilum-bag", JSON.stringify([{ id: "ebay-3", title: "Old", price: 42.5, price_cents: 0, quantity: 1, bag_key: "ebay-3" }]));
  assert.equal(bagList()[0].price_cents, 4_250);
});
