// tests/discovery-attribution.test.js — Discovery attribution: the label
// follows the cross-user versus adjacent balance, never rotation, with a
// regression guard for the old comparison that mislabelled seen items.

import test from "node:test";
import assert from "node:assert/strict";

import { discoveryPathwayLabel, assembleFeed, SEEN_PENALTY } from "../lib/brain/bridges.js";
import { buildNoveltyIndex } from "../lib/brain/popularity.js";
import { CATALOG } from "../lib/ingest/catalog.js";

// audit #24: the discovery-slot pathway label compared the UN-rotted cross-user
// part against the ROT-scaled discovery total, so on a seen item (rot 0.3) the
// crossuser label won ~5.7x too easily. The label must depend only on the
// balance between the cross-user and adjacent-taste parts, not on the
// seen-penalty. Labels are instrumentation — the feed order is unaffected.

// The law's own constant, imported — a copy that "mirrors" drifts.

test("#24 the label depends on the xu-vs-adjacent balance, never on rotation", () => {
  // adjacent part 0.4 dominates the cross-user part 0.3 → 'adjacent'.
  const adjacentPart = 0.4, xuBoosted = 0.3;
  const discoveryRaw = adjacentPart + xuBoosted; // 0.7
  assert.equal(discoveryPathwayLabel(xuBoosted, discoveryRaw), "discovery-adjacent");
});

test("#24 the OLD rotted comparison would have mislabeled a seen item (regression guard)", () => {
  const adjacentPart = 0.4, xuBoosted = 0.3;
  const discoveryRaw = adjacentPart + xuBoosted; // 0.7
  const rottedDiscovery = discoveryRaw * SEEN_PENALTY; // 0.21 — the old RHS on a seen item
  // Old (buggy) rule: xuBoosted > rottedDiscovery/2  → 0.3 > 0.105 → crossuser (WRONG).
  assert.ok(xuBoosted > rottedDiscovery / 2, "old comparison would have flipped to crossuser");
  // New (correct) rule is unaffected by the seen-penalty:
  assert.equal(discoveryPathwayLabel(xuBoosted, discoveryRaw), "discovery-adjacent");
});

test("#24 cross-user genuinely dominating still labels crossuser", () => {
  const adjacentPart = 0.2, xuBoosted = 0.3;
  const discoveryRaw = adjacentPart + xuBoosted; // 0.5
  assert.equal(discoveryPathwayLabel(xuBoosted, discoveryRaw), "discovery-crossuser");
});

test("#24 no cross-user signal is always adjacent", () => {
  assert.equal(discoveryPathwayLabel(0, 0.6), "discovery-adjacent");
  assert.equal(discoveryPathwayLabel(0, 0), "discovery-adjacent");
});

test("#24 the label change leaves the feed order byte-identical (determinism)", () => {
  const taste = { MINIMAL: 0.8, TAILORED: 0.4 };
  const crossUser = Object.fromEntries(CATALOG.slice(0, 40).map((it, i) => [it.id, 0.5 - i * 0.01]));
  const seen = new Set(CATALOG.slice(0, 20).map((it) => it.id));
  const ctx = { crossUser, seen, popularity: {}, limit: 60 };
  const a = assembleFeed(CATALOG, taste, { ...ctx });
  const b = assembleFeed(CATALOG, taste, { ...ctx });
  assert.deepEqual(
    a.map((it) => [it.id, it._score]),
    b.map((it) => [it.id, it._score]),
    "feed order + scores are deterministic; the label is set after ranking and never perturbs it"
  );
  // Every discovery slot still carries a valid pathway label.
  for (const it of a) {
    if (it._zone === "discovery") {
      assert.ok(["discovery-adjacent", "discovery-crossuser"].includes(it._bridge),
        `discovery slot ${it.id} labeled "${it._bridge}"`);
    }
  }
});

// ---- the ranking population (21 Aug) ---------------------------------------
// assembleFeed declares that a percentile is a property of the POOL. The
// popularity table is not the pool: it also counts wire transmissions and any
// probe row ever written, none of which a feed can serve. This pins the
// WIRING — buildNoveltyIndex's own unit tests cannot see whether assembleFeed
// actually hands it the pool, and a mutation that dropped the argument passed
// the entire suite before this test existed.

test("assembleFeed ranks exposure over its pool, not over the counter table", () => {
  const pool = CATALOG.slice(0, 12);
  const counters = {};
  for (const it of pool) counters[it.id] = { engagers: 0, viewers: 3 };
  // One pool item is genuinely the least-seen piece in the room.
  counters[pool[0].id] = { engagers: 0, viewers: 0 };

  const clean = { popularity: counters, limit: 12 };
  assembleFeed(pool, {}, clean);
  const cleanNovelty = clean.noveltyIndex.get(0);

  // Now the same world, plus foreign counters no pool can serve.
  const polluted = { ...counters };
  for (let i = 0; i < 40; i++) polluted[`txn-item-${i}`] = { engagers: 1, viewers: 0 };
  const ctx = { popularity: polluted, limit: 12 };
  assembleFeed(pool, {}, ctx);

  assert.equal(ctx.noveltyIndex.get(0), cleanNovelty,
    "40 transmissions must not change how novel the catalog's least-seen piece is");

  // The mutation guard: those same rows DO move an unfiltered ranking, so the
  // assertion above is about the filter and not about an inert input.
  const unfiltered = buildNoveltyIndex(polluted);
  assert.notEqual(unfiltered.get(0), cleanNovelty,
    "if the foreign rows were inert, the wiring would be untestable");
});
