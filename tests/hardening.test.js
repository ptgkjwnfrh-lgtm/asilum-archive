// tests/hardening.test.js — Input hardening: bag activity is intent not a
// purchase, product snapshots drop executable URLs and unknown tags, and
// source ids are namespaced safely.

import test from "node:test";
import assert from "node:assert/strict";

import { eventFromInteraction, EVENTS } from "../lib/events/index.js";
import { productSnapshot } from "../lib/products.js";
import { normalizeSourceProduct } from "../lib/ingest/adapters/normalize.js";
import { buildOutfitCombinations } from "../lib/ai/stylistReasoningEngine.js";
import { CATALOG } from "../lib/ingest/catalog.js";

test("bag activity is intent, never a completed-purchase event", () => {
  const event = eventFromInteraction("u-test", "bag", { id: "item-1", brand: "Test" });
  assert.equal(event.type, EVENTS.USER_ADDED_TO_BAG);
  assert.notEqual(event.type, EVENTS.USER_COMPLETED_PURCHASE);
});

test("product snapshots discard executable URLs and unknown taste tags", () => {
  const item = productSnapshot({
    id: "known-1", title: "Coat", brand: "House", price: "125",
    tags: { MINIMAL: 0.8, MADE_UP: 1, GORP: 7 },
    url: "javascript:alert(1)", img: "data:text/html,unsafe",
  });
  assert.equal(item.url, null);
  assert.equal(item.img, null);
  assert.deepEqual(item.tags, { MINIMAL: 0.8, GORP: 1 });
  assert.equal(item.price, 125);
});

test("source normalization namespaces ids and preserves safe adapter metadata", () => {
  const item = normalizeSourceProduct({
    id: "123", title: "Layered mesh top", brand: "Studio", price: "90",
    url: "https://shop.example/item/123", image: "https://shop.example/item.jpg",
    availability_status: "available",
  }, "official-api");
  assert.equal(item.id, "official-api-123");
  assert.equal(item.source_product_id, "123");
  assert.equal(item.source_product_url, "https://shop.example/item/123");
  assert.equal(item.availability_status, "available");
});

test("local stylist builds a diverse slate instead of repeating one look", () => {
  const profile = {
    dominantAesthetics: [
      { tag: "minimal", weight: 0.8 },
      { tag: "tailored", weight: 0.6 },
      { tag: "archival", weight: 0.4 },
    ],
    preferredBrands: [], avoidedTags: [],
  };
  const outfits = buildOutfitCombinations(CATALOG, profile, {}, 3);
  const signatures = new Set(outfits.map((look) => look.items.map((item) => item.id).sort().join("|")));
  assert.ok(outfits.length >= 2);
  assert.equal(signatures.size, outfits.length);
});
