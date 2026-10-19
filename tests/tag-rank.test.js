// tests/tag-rank.test.js — Discover's tag ranking: inclusion stays exact-match
// only, the pool equals the exact filter, and affinity bleed only breaks
// exact-score ties.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankByInterpretationTags, scoreByInterpretationTags } from "../lib/discover/tagRank.js";

const item = (id, tags) => ({ id, tags });

test("inclusion unchanged: no exact hit means excluded, however strong the adjacency", () => {
  const items = [
    item("exact", { TAILORED: 0.2 }),
    item("adjacent-only", { MINIMAL: 0.9 }),
  ];
  const ranked = rankByInterpretationTags(items, ["TAILORED"]);
  assert.deepEqual(ranked.map((x) => x.id), ["exact"]);
});

test("pool is identical to the exact-only filter", () => {
  const items = [
    item("a", { TAILORED: 0.5, MINIMAL: 0.3 }),
    item("b", { GORP: 0.9 }),
    item("c", { SEDUCTIVE: 0.4 }),
    item("d", {}),
    item("e", null),
  ];
  const ranked = rankByInterpretationTags(items, ["TAILORED", "SEDUCTIVE"]);
  assert.deepEqual(new Set(ranked.map((x) => x.id)), new Set(["a", "c"]));
});

test("affinity bleed breaks exact-score ties", () => {
  const items = [
    item("bare", { TAILORED: 0.5 }),
    item("with-minimal", { TAILORED: 0.5, MINIMAL: 0.6 }),
  ];
  const ranked = rankByInterpretationTags(items, ["TAILORED"]);
  assert.deepEqual(ranked.map((x) => x.id), ["with-minimal", "bare"]);
});

test("unrelated extra tags do not affect the order", () => {
  const a = scoreByInterpretationTags({ TAILORED: 0.5 }, ["TAILORED"]);
  const b = scoreByInterpretationTags({ TAILORED: 0.5, GORP: 0.9 }, ["TAILORED"]);
  assert.equal(a.score, b.score);
});

test("bleed stays subordinate: a clear exact lead survives maximal adjacency", () => {
  const items = [
    item("strong-exact", { TAILORED: 0.9 }),
    item("weak-exact-max-bleed", { TAILORED: 0.4, MINIMAL: 1, SEDUCTIVE: 1, ARCHIVAL: 1 }),
  ];
  const ranked = rankByInterpretationTags(items, ["TAILORED"]);
  assert.equal(ranked[0].id, "strong-exact");
});

test("empty query tags is a passthrough", () => {
  const items = [item("a", { GORP: 1 })];
  assert.equal(rankByInterpretationTags(items, []), items);
});
