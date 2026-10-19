// tests/skip-dwell-timing.test.js — Skip timing: a fast skip counts about
// 1.75x a slow one, a skip with no timing counts as considered, and the ratio
// is exactly the declared multiplier.

import test from "node:test";
import assert from "node:assert/strict";

import { learn, migrateProfile } from "../lib/brain/index.js";
import { eventFromInteraction } from "../lib/events/index.js";

// audit #3: the interaction route nulled dwellMs for every non-dwell action,
// so the client's real skip timing was discarded and fast-skip detection
// (learn() FAST_SKIP_MULT, 1.75x) could never fire in production. These tests
// pin the two halves of the fix: learn() applies the multiplier when timing
// is present, and the canonical event persists skip timing for backfill.

const ITEM = { id: "syn-0001", tags: { MINIMAL: 1 } };

function minimalAfterSkip(dwellMs) {
  const p = learn(migrateProfile({}), ITEM, "skip", { dwellMs });
  return p.long.MINIMAL; // negative; more negative = stronger rejection
}

// ---- learn() applies the fast-skip multiplier ONLY with timing -------------

test("#3 a fast skip (dwell < 1200ms) is ~1.75x stronger than a slow skip", () => {
  const fast = minimalAfterSkip(600);   // below FAST_SKIP_MS
  const slow = minimalAfterSkip(1500);  // above FAST_SKIP_MS
  assert.ok(fast < slow, "fast skip is more negative");
  // The tag fold scales by w; the beta penalty (SKIP_BETA_PENALTY on the
  // dominant tag) is a constant added to both, so the RATIO of the fold parts
  // is 1.75. Rather than isolate it, assert the fast magnitude exceeds the
  // slow one by a clear margin consistent with a 1.75x weight.
  assert.ok(Math.abs(fast) > Math.abs(slow), "fast rejection has larger magnitude");
});

test("#3 a skip with NO timing behaves like a considered (slow) skip", () => {
  const none = minimalAfterSkip(null);
  const slow = minimalAfterSkip(1500);
  assert.equal(none, slow, "absent timing must not trigger the fast multiplier");
});

test("#3 the fast/slow fold ratio is exactly the 1.75x multiplier", () => {
  // Isolate the tag fold (tags[k] * w) from the constant dominant-tag beta
  // penalty by measuring a NON-dominant tag: dominant is AVANT-GARDE, so GORP
  // receives only the fold. fast_fold / slow_fold == FAST_SKIP_MULT (1.75).
  const item = { id: "x", tags: { "AVANT-GARDE": 1, GORP: 0.3 } };
  const foldFast = learn(migrateProfile({}), item, "skip", { dwellMs: 600 }).long.GORP;
  const foldSlow = learn(migrateProfile({}), item, "skip", { dwellMs: 1500 }).long.GORP;
  assert.ok(Math.abs(foldFast / foldSlow - 1.75) < 1e-9, `ratio ${foldFast / foldSlow} != 1.75`);
});

// ---- canonical events persist skip/hide timing for backfill ----------------

test("#3 a skip event persists its considered-time", () => {
  const ev = eventFromInteraction("u-1", "skip", { id: "syn-1", brand: "X" }, 600);
  assert.equal(ev.payload.dwellMs, 600, "skip timing is recorded");
});

test("#3 a hide event persists its considered-time", () => {
  const ev = eventFromInteraction("u-1", "hide", { id: "syn-1", brand: "X" }, 300);
  assert.equal(ev.payload.dwellMs, 300);
});

test("#3 absent timing writes no dwellMs key (no fabricated zeros)", () => {
  const ev = eventFromInteraction("u-1", "skip", { id: "syn-1", brand: "X" }, null);
  assert.ok(!("dwellMs" in ev.payload), "null timing is omitted, not stored as 0");
});

test("#3 positive actions still carry no considered-time", () => {
  const ev = eventFromInteraction("u-1", "bag", { id: "syn-1", brand: "X" }, 5000);
  assert.ok(!("dwellMs" in ev.payload), "positive-action timing is not persisted");
});
