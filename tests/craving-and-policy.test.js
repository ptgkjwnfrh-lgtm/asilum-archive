// tests/craving-and-policy.test.js — Current cravings and feed policy:
// cravings normalize and drop unknown controls, safe mode lowers exploration
// without breaking ranking, and a craving steers one feed without rewriting
// taste.

import test from "node:test";
import assert from "node:assert/strict";

import { cravingVector, hasCravingContext, parseCravingContext } from "../lib/craving/index.js";
import { buildFeed } from "../lib/brain/index.js";
import { sponsorshipEligible } from "../lib/brain/bridges.js";
import { normalizeWooProduct } from "../lib/ingest/adapters/woocommerceAdapter.js";
import { isDiscoverableProduct } from "../lib/products.js";

test("cravings are normalized and unknown controls are discarded", () => {
  const context = parseCravingContext({ text: "  DARK dinner look  ", occasion: "date", mood: "invented", novelty: "wildcard" });
  assert.deepEqual(context, { text: "dark dinner look", occasion: "date", mood: "", novelty: "wildcard" });
  const vector = cravingVector(context);
  assert.ok(vector.SEDUCTIVE > 0.7);
  assert.ok(vector["AVANT-GARDE"] > 0);
  assert.equal(hasCravingContext({ novelty: "safe" }), true);
});

test("safe mode reduces exploration without removing the ranking backbone", () => {
  const profile = { long: { MINIMAL: 1 }, session: {}, _meta: {} };
  const pool = Array.from({ length: 12 }, (_, index) => ({
    id: String(index), brand: `B${index}`, tags: index < 8 ? { MINIMAL: 0.9 } : { STATEMENT: 1 },
  }));
  const result = buildFeed({ profile, novelty: "safe", limit: 12 }, pool);
  assert.equal(result.safeMode, true);
  assert.equal(result.zones.reach, 0);
  assert.equal(result.split.alpha, 45);
});

test("a current craving steers one feed without mutating the saved profile", () => {
  const profile = { long: { MINIMAL: 1 }, session: {}, _meta: {} };
  const pool = [
    { id: "minimal", brand: "A", tags: { MINIMAL: 1 } },
    { id: "night", brand: "B", tags: { STATEMENT: 1, SEDUCTIVE: 0.8 } },
  ];
  const before = structuredClone(profile);
  const result = buildFeed({ profile, contextVec: cravingVector({ occasion: "night" }), limit: 2 }, pool);
  assert.equal(result.items[0].id, "night");
  assert.deepEqual(profile, before);
  assert.ok(result.items[0]._contextMatch > 0.5);
});

test("sponsorship requires active disclosed relevant inventory", () => {
  const base = {
    sponsored: true, sponsorship_status: "active", sponsor_disclosure: "Sponsored by Studio",
    is_available: true, availability_status: "available",
  };
  assert.equal(sponsorshipEligible(base, 0.8), true);
  assert.equal(sponsorshipEligible({ ...base, sponsor_disclosure: "" }, 0.8), false);
  assert.equal(sponsorshipEligible({ ...base, availability_status: "sold" }, 0.8), false);
  assert.equal(sponsorshipEligible(base, 0.1), false);
});

test("approved WooCommerce products normalize minor-unit prices and source identity", () => {
  const item = normalizeWooProduct({
    id: 42, name: "Structured Coat", permalink: "https://store.example/product/coat/",
    prices: { price: "12900", currency_code: "USD", currency_minor_unit: 2 },
    images: [{ src: "https://store.example/coat.jpg" }],
    categories: [{ name: "Outerwear" }], is_in_stock: true,
  });
  assert.equal(item.id, "woocommerce-42");
  assert.equal(item.price, 129);
  assert.equal(item.source_name, "woocommerce");
  assert.equal(item.category, "outerwear");
  assert.equal(item.availability_status, "available");
});

test("source HTML is reduced to bounded plain text before indexing or display", () => {
  const item = normalizeWooProduct({
    id: 43, name: "Coat", permalink: "https://store.example/product/coat-2/",
    description: "<style>bad{}</style><p>Clean &amp; sharp</p><script>alert(1)</script>",
    prices: { price: "1000", currency_code: "USD", currency_minor_unit: 2 },
  });
  assert.equal(item.description, "Clean & sharp");
});

test("hidden and unavailable inventory cannot enter discovery surfaces", () => {
  assert.equal(isDiscoverableProduct({ is_available: true, moderation_status: "visible", availability_status: "available" }), true);
  assert.equal(isDiscoverableProduct({ is_available: false }), false);
  assert.equal(isDiscoverableProduct({ moderation_status: "flagged" }), false);
  assert.equal(isDiscoverableProduct({ availability_status: "sold" }), false);
});
