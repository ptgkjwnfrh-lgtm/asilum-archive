// tests/search-dense.test.js — Dense query parsing (lib/search/denseQuery.js):
// gender words become constraints, size phrases consume both words, and
// climate words constrain while staying scoreable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDenseConstraints, applyDenseConstraints, weighTypedTagScores, TYPE_WEIGHTS,
} from "../lib/search/denseQuery.js";

test("gender words become constraints and leave the token stream", () => {
  const { tokens, constraints } = parseDenseConstraints(["womens", "mohair", "sweater"]);
  assert.deepEqual(tokens, ["mohair", "sweater"]);
  assert.equal(constraints.gender, "womens");
});

test("under <n> consumes both words; bare numbers stay tokens", () => {
  const a = parseDenseConstraints(["sweater", "under", "400"]);
  assert.equal(a.constraints.maxPrice, 400);
  assert.deepEqual(a.tokens, ["sweater"]);
  const b = parseDenseConstraints(["sweater", "400"]);
  assert.equal(b.constraints.maxPrice, null);
  assert.deepEqual(b.tokens, ["sweater", "400"]);
  const c = parseDenseConstraints(["under"]);
  assert.deepEqual(c.tokens, ["under"]);
});

test("climate words constrain AND stay scoreable tokens", () => {
  const { tokens, constraints } = parseDenseConstraints(["winter", "coat"]);
  assert.equal(constraints.climate, "cold-weather");
  assert.deepEqual(tokens, ["winter", "coat"]);
});

test("gender filter honors real fields and lets unisex/absent pass", () => {
  const items = [
    { id: "w", size: { gender: "womens" } },
    { id: "m", size: { gender: "mens" } },
    { id: "u", size: { gender: "unisex" } },
    { id: "none" },
  ];
  const out = applyDenseConstraints(items, { gender: "womens" });
  assert.deepEqual(out.map((i) => i.id), ["w", "u", "none"]);
});

test("maxPrice drops unpriced items — nothing unpriced claims a budget", () => {
  const items = [
    { id: "cheap", price: 120 },
    { id: "rich", price: 1200 },
    { id: "unknown", price: null },
  ];
  const out = applyDenseConstraints(items, { maxPrice: 400 });
  assert.deepEqual(out.map((i) => i.id), ["cheap"]);
});

test("climate filter maps seasons; absent season passes", () => {
  const items = [
    { id: "fw", era: { season: "Fall/Winter" } },
    { id: "ss", era: { season: "Spring/Summer" } },
    { id: "bare" },
  ];
  const out = applyDenseConstraints(items, { climate: "cold-weather" });
  assert.deepEqual(out.map((i) => i.id), ["fw", "bare"]);
});

test("typed weighting: a material hit outranks the same score on size-system", () => {
  const scores = weighTypedTagScores({
    a: { material: 1 },
    b: { "size-system": 1 },
  });
  assert.ok(scores.a > scores.b);
  assert.equal(scores.a, TYPE_WEIGHTS.material);
});

test("collection carries the heaviest weight and unknown types get a floor", () => {
  const top = Math.max(...Object.values(TYPE_WEIGHTS));
  assert.equal(TYPE_WEIGHTS.collection, top);
  const scores = weighTypedTagScores({ x: { "future-type": 1 } });
  assert.equal(scores.x, 0.3);
});
