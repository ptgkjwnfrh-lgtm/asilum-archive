// tests/search-feed-ordering.test.js — Search result ordering: compositional
// and cultural reads rank above literal ones, a high-score literal cannot jump
// a composed read, and similarity only breaks true ties.

import test from "node:test";
import assert from "node:assert/strict";

import { tierAwareComparator, searchTierOf, getProductPool } from "../lib/search/index.js";
import { listItems } from "../lib/db/index.js";

// audit #7: the semantic rerank/tiebreak re-sorted the whole rack by raw
// _score, interleaving the compositional/cultural tier (different score scale)
// with weak literal matches so a conf-0.07 partial-title hit could outrank a
// composed read. The tier-aware comparator confines reordering to within a
// tier. audit #28: the cold-user feed's listItems ordered only by created_at,
// so bulk-seeded created_at ties were plan-dependent — now id breaks them.

const composed = (id, score) => ({ id, _score: score, matchReason: "compositional read" });
const cultural = (id, score) => ({ id, _score: score, matchReason: "cultural read" });
const literal = (id, score, reason = "partial title match") => ({ id, _score: score, matchReason: reason });

// ---- #7 tier guard ---------------------------------------------------------

test("#7 tiers: compositional and cultural reads are tier 0, literal is tier 1", () => {
  assert.equal(searchTierOf(composed("a", 0.3)), 0);
  assert.equal(searchTierOf(cultural("b", 0.3)), 0);
  assert.equal(searchTierOf(literal("c", 9)), 1);
  assert.equal(searchTierOf({ matchReason: "garment match" }), 1);
});

test("#7 a high-score literal can NOT hoist above a low-score composed read", () => {
  // The exact failure: a composed read at 0.3 vs a junk partial-title at 9.
  const rack = [literal("junk", 9), composed("read1", 0.3), composed("read2", 0.25), literal("weak", 0.07)];
  const simById = new Map([["junk", 0.9], ["read1", 0.1], ["read2", 0.1], ["weak", 0.8]]);
  rack.sort(tierAwareComparator(simById, true));
  const ids = rack.map((r) => r.id);
  assert.deepEqual(ids.slice(0, 2), ["read1", "read2"], "composed reads hold the top, junk cannot climb over the tier");
  assert.ok(ids.indexOf("junk") > ids.indexOf("read2"), "the high-score literal stays below both composed reads");
});

test("#7 within a tier, higher _score still wins; sim only breaks true ties", () => {
  const rack = [literal("lo", 1), literal("hi", 5), literal("tieA", 3), literal("tieB", 3)];
  const simById = new Map([["tieA", 0.2], ["tieB", 0.9]]);
  rack.sort(tierAwareComparator(simById, true));
  assert.deepEqual(rack.map((r) => r.id), ["hi", "tieB", "tieA", "lo"],
    "score orders the tier; equal scores break on sim (tieB > tieA)");
});

test("#7 rerank-only mode (no tiebreak) still respects the tier boundary", () => {
  const rack = [literal("junk", 9), composed("read", 0.3)];
  rack.sort(tierAwareComparator(new Map(), false));
  assert.deepEqual(rack.map((r) => r.id), ["read", "junk"], "tier guard applies with tiebreak off too");
});

test("#7 comparator is a total order (stable, no intransitivity crashes)", () => {
  const rack = [composed("c1", 0.3), literal("l1", 5), cultural("k1", 0.4), literal("l2", 5), composed("c2", 0.3)];
  const simById = new Map();
  // sort twice — must be idempotent (deterministic)
  const once = [...rack].sort(tierAwareComparator(simById, true)).map((r) => r.id);
  const twice = [...rack].sort(tierAwareComparator(simById, true)).map((r) => r.id);
  assert.deepEqual(once, twice);
  // all tier-0 ids precede all tier-1 ids
  const firstLiteral = once.findIndex((id) => id.startsWith("l"));
  const lastTier0 = Math.max(once.indexOf("c1"), once.indexOf("c2"), once.indexOf("k1"));
  assert.ok(lastTier0 < firstLiteral, "every tier-0 read precedes every literal");
});

// ---- #28 feed determinism --------------------------------------------------

test("#28 mem-mode listItems returns a stable order across repeated reads", async () => {
  const a = (await listItems(200)).map((it) => it.id);
  const b = (await listItems(200)).map((it) => it.id);
  assert.deepEqual(a, b, "identical reads return identical order");
});

test("#28 the cold pool is deterministic across repeated getProductPool calls", async () => {
  const a = (await getProductPool(500)).map((it) => it.id);
  const b = (await getProductPool(500)).map((it) => it.id);
  assert.deepEqual(a, b);
});
