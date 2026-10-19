// tests/dense-tags.test.js — Dense per-piece tags (lib/tagging/dense.js): a
// full item yields 20+ typed tags, materials only when literally in the title,
// and the same item always yields identical rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  denseTagsForItem, enrichItemVec, titleTokens, priceBand, fitLabel, DENSE_TAG_SOURCE,
} from "../lib/tagging/dense.js";

const RICH_ITEM = {
  id: "t-1",
  title: "Khaite — distressed mohair sweater",
  brand: "Khaite",
  designers: ["Khaite"],
  price: 970,
  tags: { MINIMAL: 0.5, TAILORED: 0.35, SEDUCTIVE: 0.7 },
  category: "knitwear",
  era: { year: 2015, season: "Fall/Winter", decade: "2010s", raw: "Fall/Winter 2015" },
  size: { label: "M", system: "US", gender: "womens", runsBias: -1 },
};

test("a fully-populated item yields 20+ typed tags, all dense-v1", () => {
  const rows = denseTagsForItem(RICH_ITEM);
  assert.ok(rows.length >= 20, `expected >= 20 rows, got ${rows.length}`);
  assert.ok(rows.every((r) => r.source === DENSE_TAG_SOURCE));
  assert.ok(rows.every((r) => r.confidence > 0 && r.confidence <= 1));
});

test("materials only when literally in the title", () => {
  const rows = denseTagsForItem(RICH_ITEM);
  assert.ok(rows.some((r) => r.tagType === "material" && r.tag === "mohair"));
  const noMaterial = denseTagsForItem({ ...RICH_ITEM, title: "Bode — varsity jacket" });
  assert.equal(noMaterial.filter((r) => r.tagType === "material").length, 0);
  assert.ok(noMaterial.some((r) => r.tagType === "garment" && r.tag === "varsity"));
});

test("deterministic: same item, identical rows", () => {
  assert.deepEqual(denseTagsForItem(RICH_ITEM), denseTagsForItem(RICH_ITEM));
});

test("adjacent aesthetics are typed as derived and stay below the strongest primary", () => {
  const rows = denseTagsForItem(RICH_ITEM);
  const adj = rows.filter((r) => r.tagType === "aesthetic-adjacent");
  assert.ok(adj.length >= 1);
  const maxPrimary = Math.max(...rows.filter((r) => r.tagType === "aesthetic").map((r) => r.confidence));
  assert.ok(adj.every((r) => r.confidence < maxPrimary));
});

test("sparse item degrades honestly, no invented rows", () => {
  const rows = denseTagsForItem({ id: "t-2", title: "anorak", tags: {}, price: null });
  const types = new Set(rows.map((r) => r.tagType));
  assert.deepEqual([...types].sort(), ["garment"]);
});

test("titleTokens reads the descriptor half and folds case", () => {
  assert.deepEqual(titleTokens("Bottega Veneta — GORE-TEX shell"), ["gore-tex", "shell"]);
  assert.deepEqual(titleTokens("Y/Project — down puffer"), ["down", "puffer"]);
});

test("price bands and fit labels hit their boundaries", () => {
  assert.equal(priceBand(149), "under-150");
  assert.equal(priceBand(150), "150-400");
  assert.equal(priceBand(899), "400-900");
  assert.equal(priceBand(900), "900-plus");
  assert.equal(priceBand(null), null);
  // (Aug 8) THESE TWO ASSERTIONS WERE INVERTED AND ARE NOW FLIPPED. They
  // codified a bug rather than a contract: they asserted that fitLabel does
  // what fitLabel did, without ever crossing to lib/brain/sizing.js, which
  // OWNS runsBias. Three independent checks say positive means runs SMALL:
  //   1. the arithmetic — fitsLikeUS does fitFromIndex(bi - bias), so a Prada
  //      (+1) "M" fits like an S: the garment is smaller than its label.
  //   2. the phrase sizing.js renders — `runsBias > 0` -> "· runs small".
  //   3. the world — Prada/Miu Miu/Jil Sander are +1 and run small; Kapital/
  //      Fear of God/ERL are -1 and run large.
  // So the dense `fit` tag contradicted the size note on the same product, and
  // filtering "runs-small" returned the oversized brands.
  // tests/sizing-honesty.test.js Z4/Z5 now pin the cross-module invariant.
  assert.equal(fitLabel(-1), "runs-large");
  assert.equal(fitLabel(0), "true-to-size");
  assert.equal(fitLabel(2), "runs-small");
  assert.equal(fitLabel(undefined), null);
});

test("enrichItemVec: primaries untouched, bleed capped at half the driving signal", () => {
  const vec = { MINIMAL: 0.8 };
  const out = enrichItemVec(vec);
  assert.equal(out.MINIMAL, 0.8);
  assert.ok(out.TAILORED > 0, "TAILORED should bleed from MINIMAL");
  assert.equal(out.TAILORED, 0.28); // 0.8 * 0.7 affinity * 0.5 cap
  assert.ok(!("GORP" in out), "unrelated tags stay absent");
  assert.deepEqual(enrichItemVec({}), {});
});
