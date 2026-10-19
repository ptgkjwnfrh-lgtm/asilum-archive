// tests/recommendation-exclusions.test.js — audit finding #8, verified in
// docs/history/audit-verified-2026-08-14.md.
//
// "A correction is a promise, not a hint" (Day 11). A user who corrects a brand
// away with `dont-recommend-brand`, or marks a piece already-own / not-my-style,
// is making the system commit to something.
//
// The commitment was kept on ONE surface. /api/feed filtered. The AI-edit group
// inside the stylist filtered. The stylist's own 25 base looks did not — they
// were built straight off getDiscoverablePool() with no user argument — so the
// SAME response suppressed a brand in one group and served it in twenty-five
// others, and a brand that had vanished from the feed reappeared in the
// stylist. The exploration rail on /discover reads the user's taste vector and
// also did not filter.
//
// The predicate had been retyped at each site, which is why the sites drifted.
// It lives once now, in lib/products.js, and the structural tests at the bottom
// are the grep that would have caught this, made permanent: a new surface that
// builds a candidate pool has to declare what it does about exclusions.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyRecommendationExclusions } from "../lib/products.js";
import { recordCorrection } from "../lib/asterisk/explain.js";
import { getCandidateProductsForStylist } from "../lib/ai/stylistReasoningEngine.js";
import { discoverRails } from "../lib/discover/rails.js";
import {
  getUserRecommendationExclusions, saveMemoryPreferences,
} from "../lib/db/production.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const brandOf = (item) => String(item.brand || "").trim().toLowerCase();

// ---- the shared predicate ---------------------------------------------------

test("X1 excluded brands and product ids are both removed", () => {
  const pool = [
    { id: "a", brand: "Rick Owens" },
    { id: "b", brand: "Salomon" },
    { id: "c", brand: "Salomon" },
  ];
  const kept = applyRecommendationExclusions(pool, {
    brands: ["salomon"], productIds: ["a"],
  });
  assert.deepEqual(kept.map((i) => i.id), [], "both rules apply in one pass");

  assert.deepEqual(
    applyRecommendationExclusions(pool, { brands: ["salomon"], productIds: [] })
      .map((i) => i.id), ["a"]);
  assert.deepEqual(
    applyRecommendationExclusions(pool, { brands: [], productIds: ["b"] })
      .map((i) => i.id), ["a", "c"]);
});

test("X2 brand matching survives the casing and padding the catalog really has", () => {
  // getUserRecommendationExclusions lowercases on both backends (mem does
  // .trim().toLowerCase(), Postgres does lower(brand)), so the stored side is
  // normalized and the ITEM side is what has to be defended.
  const pool = [
    { id: "a", brand: "  Maison Margiela  " },
    { id: "b", brand: "MAISON MARGIELA" },
    { id: "c", brand: "Junya Watanabe" },
  ];
  assert.deepEqual(
    applyRecommendationExclusions(pool, { brands: ["maison margiela"], productIds: [] })
      .map((i) => i.id), ["c"]);
});

test("X3 an empty or absent exclusion set is a pass-through, not a copy", () => {
  const pool = [{ id: "a", brand: "Salomon" }];
  assert.equal(applyRecommendationExclusions(pool, { brands: [], productIds: [] }), pool,
    "the common case (nobody has corrected anything) must not clone the pool");
  assert.equal(applyRecommendationExclusions(pool, null), pool);
  assert.equal(applyRecommendationExclusions(pool), pool);
});

test("X4 an item carrying no brand is never swept up by a brand rule", () => {
  const pool = [{ id: "a" }, { id: "b", brand: "" }, { id: "c", brand: "Salomon" }];
  assert.deepEqual(
    applyRecommendationExclusions(pool, { brands: ["salomon"], productIds: [] })
      .map((i) => i.id), ["a", "b"]);
});

// ---- the surfaces, end to end ----------------------------------------------

// Exclude enough of the real catalog that an UNFILTERED surface cannot avoid
// it: the 20 heaviest brands are 43% of the inventory. 20 is not arbitrary —
// user_corrections is rate limited to CORRECTION_RATE_LIMIT (20) per window, so
// this is also the most a real user could correct away in one sitting.
//
// Both surfaces below select deterministically (a pure filter; a day-indexed
// rotation on a fixed date), so "does the fix hold" has one answer per run
// rather than a probability.
const BY_BRAND = new Map();
for (const item of CATALOG) {
  const brand = brandOf(item);
  if (!BY_BRAND.has(brand)) BY_BRAND.set(brand, []);
  BY_BRAND.get(brand).push(item);
}
const HEAVY_BRANDS = [...BY_BRAND.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 20);

async function correctAwayHeavyBrands(userId) {
  for (const [, items] of HEAVY_BRANDS) {
    const result = await recordCorrection(userId, {
      productId: items[0].id, code: "dont-recommend-brand",
    });
    assert.equal(result.ok, true, `correction must record for ${items[0].brand}`);
  }
  return new Set(HEAVY_BRANDS.map(([brand]) => brand));
}

test("X5 the fixture really does remove most of the catalog", () => {
  const excludedItems = HEAVY_BRANDS.reduce((sum, [, items]) => sum + items.length, 0);
  const share = excludedItems / CATALOG.length;
  assert.ok(share > 0.35,
    `the fixture must exclude a large share of the catalog to be non-vacuous (got ${share.toFixed(2)})`);
  assert.ok(CATALOG.length - excludedItems > 100,
    "and must leave enough inventory that a starved surface is not what we are measuring");
});

test("X6 the stylist candidate pool honours standing exclusions", async () => {
  const userId = "u-exclusions-stylist";
  const excluded = await correctAwayHeavyBrands(userId);
  assert.equal((await getUserRecommendationExclusions(userId)).brands.length, excluded.size);

  const candidates = await getCandidateProductsForStylist({}, userId);
  const leaked = candidates.filter((item) => excluded.has(brandOf(item)));
  assert.deepEqual(leaked.map((i) => `${i.brand}/${i.id}`), [],
    "a corrected brand must not be a stylist candidate");
  assert.ok(candidates.length > 100, "the pool must still be usable, not starved");
});

test("X7 already-own and not-my-style pieces leave the stylist pool too", async () => {
  const userId = "u-exclusions-products";
  const owned = CATALOG[0];
  const disliked = CATALOG[1];
  assert.equal((await recordCorrection(userId, { productId: owned.id, code: "already-own" })).ok, true);
  assert.equal((await recordCorrection(userId, { productId: disliked.id, code: "not-my-style" })).ok, true);

  const ids = new Set((await getCandidateProductsForStylist({}, userId)).map((i) => i.id));
  assert.equal(ids.has(owned.id), false, "a piece the user owns is not a recommendation");
  assert.equal(ids.has(disliked.id), false);
});

test("X8 the /discover exploration rail honours standing exclusions", async () => {
  const userId = "u-exclusions-rails";
  await saveMemoryPreferences(userId, { guidanceEnabled: true });
  const excluded = await correctAwayHeavyBrands(userId);

  const { rails } = await discoverRails(userId, new Date("2026-07-15T12:00:00Z"));
  const exploration = rails.find((rail) => rail.kind === "exploration");
  assert.ok(exploration, "the exploration rail must be present to be tested");
  assert.ok(exploration.items.length > 0, "an empty rail would pass vacuously");

  const leaked = exploration.items.filter((item) => excluded.has(brandOf(item)));
  assert.deepEqual(leaked.map((i) => `${i.brand}/${i.id}`), [],
    "the rail reads the user's taste, so it owes the user's corrections");
});

// ---- the structural guard ---------------------------------------------------

// Every file that builds a candidate pool from getDiscoverablePool() is listed
// here with what it does about exclusions. A new caller fails this test until
// somebody decides which line it belongs on — that decision being made silently
// is exactly how the stylist ended up unfiltered.
const POOL_CALLERS = {
  // Personalized recommendation surfaces: they read who you are, so they owe
  // your corrections.
  "app/api/feed/route.js": "filters",
  "app/api/outfits/route.js": "filters",
  "lib/ai/stylistReasoningEngine.js": "filters",
  "lib/discover/rails.js": "filters",
  // Not personalized recommendation: no user identity reaches the route, or the
  // user named what they wanted, or the pool is being used to resolve ids
  // rather than to suggest anything.
  "app/api/related/route.js": "no-identity",
  "app/api/discover/route.js": "browse-full-inventory",
  "app/api/orders/route.js": "id-lookup",
  // The career registry counts how many pieces CREDIT a designer at a house
  // (V.2 overview); nothing from the pool is suggested, the count is a fact.
  "app/api/search/route.js": "id-lookup",
  // Stamp recognition. The reader UPLOADED this photograph — they are pointing
  // AT the piece, not being offered it. A correction says "stop suggesting
  // this to me"; it does not say "pretend not to recognise it when I show it
  // to you", and honouring it here would read as the archive lying about what
  // it holds. Exclusions govern what we PUSH, never what a person ASKS about.
  "app/api/moodboard/route.js": "id-lookup",
  "lib/search/index.js": "explicit-query",
  "lib/products.js": "internal-resolution",
};

const SEARCH_DIRS = ["app", "lib"];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry)) out.push(full);
    }
  };
  for (const dir of SEARCH_DIRS) walk(path.join(ROOT, dir));
  return out;
}

// Comments quote the retired inline predicate on purpose — only code counts.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("X9 every candidate-pool caller has declared its exclusion policy", () => {
  const callers = sourceFiles()
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("getDiscoverablePool("))
    .map((file) => path.relative(ROOT, file))
    .sort();
  assert.deepEqual(callers, Object.keys(POOL_CALLERS).sort(),
    "a new getDiscoverablePool caller must be added to POOL_CALLERS with a verdict");
});

test("X10 every surface declared 'filters' actually applies the shared predicate", () => {
  const missing = Object.entries(POOL_CALLERS)
    .filter(([, verdict]) => verdict === "filters")
    .filter(([file]) =>
      !stripComments(readFileSync(path.join(ROOT, file), "utf8"))
        .includes("applyRecommendationExclusions("))
    .map(([file]) => file);
  assert.deepEqual(missing, [],
    "these surfaces promise to honour corrections and do not call the predicate");
});

test("X11 nobody re-implements the predicate inline any more", () => {
  // The bug was three hand-typed copies that drifted. The shape of that copy is
  // a local Set built straight from the exclusions object.
  const offenders = sourceFiles().filter((file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    return /new Set\(\s*exclusions\.(brands|productIds)/.test(code);
  }).map((file) => path.relative(ROOT, file));
  assert.deepEqual(offenders, [],
    "use applyRecommendationExclusions instead of retyping the filter");
});
