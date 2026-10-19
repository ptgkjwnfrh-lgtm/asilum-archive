// Native Storefront acceptance at the existing catalog boundaries.
//
// These tests intentionally do not call the Storefront persistence service:
// that service has its own ownership/concurrency suite. Here the server-owned
// projection is treated exactly like the items table treats it and is carried
// through product/search/Feed/Wire/Passport/bag/Asterisk contracts. The rules:
// one listing id everywhere, category facts without garment guesses, no taste
// tags invented for sparse objects, Asterisk OFF stays off, and zero stock can
// never survive into a recommendation or a purchase control.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

delete process.env.DATABASE_URL;

const { upsertItems, getProfile, saveProfile } = await import("../lib/db/index.js");
const { mem: catalogMem } = await import("../lib/db/core/store.js");
const { mem: productionMem } = await import("../lib/db/production/store.js");
const { saveMemoryPreferences } = await import("../lib/db/production.js");
const {
  isDiscoverableProduct, productSnapshot, publicProduct,
} = await import("../lib/products.js");
const { searchProducts } = await import("../lib/search/index.js");
const { sourceFor, isDemoItem } = await import("../lib/social.js");
const { bagLineKey } = await import("../lib/client.js");
const { attachmentsFor } = await import("../lib/wire/compose.js");
const { creditedDesigners } = await import("../lib/asterisk/memory.js");
const { STOREFRONT_CATEGORIES } = await import("../lib/storefront/contracts.js");
const { callRoute, loadRoute, newDevice } = await import("./helpers/route.js");

const TITLES = Object.freeze({
  clothing: "Selvedge work jacket",
  jewelry: "Hammered silver torque",
  posters_prints: "Cyanotype constellation print",
  furniture: "Chrome cantilever chair",
  electronics_tech: "Cassette field receiver",
  ornaments_home: "Ceramic spiral vase",
  other: "Bound field notebook",
});

const CATEGORY_QUERIES = Object.freeze({
  clothing: "clothing",
  jewelry: "jewelry",
  posters_prints: "posters",
  furniture: "furniture",
  electronics_tech: "electronics",
  ornaments_home: "ornaments",
  // "other" is deliberately not a semantic bucket: the concrete title is
  // the honest search evidence for an otherwise uncategorised physical good.
  other: "bound field notebook",
});

function nativeItem(category, index) {
  return {
    id: `native-catalog-${category}`,
    title: TITLES[category],
    brand: "Signal Objects",
    price: 50 + index,
    price_cents: (50 + index) * 100,
    currency: "USD",
    tags: {},
    img: null,
    source: "asilum-native",
    source_name: "asilum-native",
    source_product_id: `listing-${category}`,
    source_product_url: null,
    url: null,
    designers: ["Signal Objects"],
    category,
    size: null,
    fit: null,
    commerce_rail: "native_storefront",
    storefront_slug: "signal-objects",
    native_listing_id: `listing-${category}`,
    default_variant_id: `variant-${category}`,
    inventory_available: 2,
    listing_version: 1,
    native_checkout_ready: true,
    moderation_status: "visible",
    availability_status: "available",
    is_available: true,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  };
}

const CATEGORY_IDS = STOREFRONT_CATEGORIES.map((category) => category.id);
const available = CATEGORY_IDS.map(nativeItem);
// Model the defensive seam, not only the happy projection: checkout/inventory
// says zero even if an older availability label has not caught up yet.
const sold = {
  ...nativeItem("electronics_tech", 20),
  id: "native-catalog-sold",
  title: "Obsolete glass metronome",
  native_listing_id: "listing-sold",
  default_variant_id: "variant-sold",
  inventory_available: 0,
};

catalogMem.items.clear();
catalogMem.profiles.clear();
productionMem.memoryPreferences.clear();
await upsertItems([...available, sold]);

test("cross-category native rows keep one listing/variant authority and invent no garment or taste facts", () => {
  assert.deepEqual(CATEGORY_IDS, [
    "clothing", "jewelry", "posters_prints", "furniture",
    "electronics_tech", "ornaments_home", "other",
  ]);

  for (const row of available) {
    const snapshot = productSnapshot(row);
    const product = publicProduct(row);
    assert.equal(snapshot.id, row.id);
    assert.equal(product.native_listing_id, row.native_listing_id);
    assert.equal(product.default_variant_id, row.default_variant_id);
    assert.equal(product.category, row.category);
    assert.equal(product.price_cents, row.price_cents);
    assert.equal(product.inventory_available, 2);
    assert.equal(product.size, null, `${row.category} does not acquire a garment size`);
    assert.equal(product.fit, null, `${row.category} does not acquire a garment fit`);
    assert.deepEqual(product.tags, {}, `${row.category} does not acquire guessed Asterisk tags`);
    assert.equal(product.url, null, "native stock never receives a fabricated external URL");
    assert.equal(product.purchasable, true);
    assert.equal(product.originEvidence.status, "unverified");
    assert.equal(product.originEvidence.brandIsClaim, true);
    assert.equal(isDemoItem(row), false);
    assert.equal(sourceFor(row), "Signal Objects", "the server-owned Storefront name labels the source");
    assert.equal(bagLineKey(product), `native:${row.native_listing_id}:${row.default_variant_id}`);
  }
});

test("explicit category searches find every native category without model metadata", async () => {
  for (const row of available) {
    const result = await searchProducts(CATEGORY_QUERIES[row.category], {
      log: false,
      limit: 24,
      semanticRerank: false,
      semanticTiebreak: false,
    });
    const hit = result.results.find((item) => item.id === row.id);
    assert.ok(hit, `${row.category} is reachable from its factual category/title query`);
    assert.equal(hit.category, row.category);
    assert.deepEqual(hit.tags, {}, `${row.category} stayed sparse through search`);
  }
});

test("zero native inventory is neither discoverable, searchable nor purchasable", async () => {
  assert.equal(isDiscoverableProduct(sold), false, "inventory units outrank a stale availability label");
  const payload = publicProduct(sold);
  assert.equal(payload.purchasable, false);
  assert.equal(payload.inventory_available, 0);
  const result = await searchProducts("obsolete glass metronome", {
    log: false,
    limit: 24,
    semanticRerank: false,
    semanticTiebreak: false,
  });
  assert.equal(result.results.some((item) => item.id === sold.id), false,
    "an exact title match cannot resurrect sold-out inventory");
});

test("Wire and Passport/Asterisk reuse the catalog id without promoting a shop to a designer", async () => {
  const row = available.find((item) => item.category === "furniture");
  const wire = attachmentsFor(
    { text: "objects in rotation", layout: "fragment", pieces: [row.id] },
    { pieceSnapshots: [{
      id: row.id,
      title: row.title,
      brand: row.brand,
      img: row.img,
      price: row.price,
      currency: row.currency,
      source: sourceFor(row),
    }] },
  );
  assert.equal(wire.pieces[0].id, row.id, "Wire links back to the canonical native item id");
  assert.equal(wire.pieces[0].source, "Signal Objects", "the snapshot uses the public Storefront identity");

  const designers = await creditedDesigners([{ items: [{ id: row.id }] }]);
  assert.deepEqual(designers, [], "a Storefront name in designers[] is not promoted to a sourced person");
});

test("Wire posting resolves piece references through shared discoverability", () => {
  const route = readFileSync(new URL("../app/api/editorial/route.js", import.meta.url), "utf8");
  assert.match(route, /import \{ resolveProduct \} from "\.\.\/\.\.\/\.\.\/lib\/products\.js"/);
  assert.match(route, /const it = await resolveProduct\(String\(id\)\)/);
  assert.doesNotMatch(route, /const it = await getItem\(String\(id\)\)/);
});

test("Asterisk OFF serves explicit search and the Feed catalog lane without reading or mutating Passport taste", async () => {
  const me = newDevice();
  await saveProfile(me.uid, { long: { MINIMAL: 1 }, session: { TAILORED: 0.5 }, _meta: {} });
  await saveMemoryPreferences(me.uid, { guidanceEnabled: false });
  const before = structuredClone(await getProfile(me.uid));

  const searchRoute = await loadRoute("app/api/search/route.js");
  const searched = await callRoute(searchRoute.GET, {
    path: "/api/search",
    cookies: me.cookies,
    query: { q: "furniture", brain: "1", user: me.uid, limit: "24" },
  });
  assert.equal(searched.status, 200, searched.text);
  assert.equal(searched.body.guidanceEnabled, false);
  assert.equal(searched.body.taste.reranked, false);
  const chair = searched.body.results.find((item) => item.id === "native-catalog-furniture");
  assert.ok(chair, "OFF still honours the reader's explicit factual query");
  assert.equal(chair.src, "Signal Objects");
  assert.deepEqual(chair.tags, {}, "the search route did not invent an interpretation");

  const feedRoute = await loadRoute("app/api/feed/route.js");
  const seen = new Map();
  let cursor = null;
  for (let page = 0; page < 6; page++) {
    const response = await callRoute(feedRoute.GET, {
      path: "/api/feed",
      cookies: me.cookies,
      query: { user: me.uid, limit: "12", ...(cursor ? { cursor } : {}) },
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.guidanceEnabled, false);
    assert.equal(response.body.tuning.active, false);
    for (const item of response.body.items) {
      seen.set(item.id, item);
      assert.notEqual(item.id, sold.id);
      assert.deepEqual(item.tags, {}, "Feed did not synthesize taste tags for a sparse native row");
    }
    if (response.body.chunk.catalog.exhausted) break;
    cursor = response.body.chunk.catalog.nextCursor;
    assert.ok(cursor, "a short brand-capped page continues through the shared catalog cursor");
  }

  assert.deepEqual(new Set(seen.keys()), new Set(available.map((item) => item.id)),
    "the existing brand cap pages one cross-category Storefront rather than dropping its listings");
  assert.deepEqual(await getProfile(me.uid), before,
    "OFF did not rotate, learn from, or otherwise rewrite Passport taste");
});
