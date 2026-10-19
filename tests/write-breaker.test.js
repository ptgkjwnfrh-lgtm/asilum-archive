// tests/write-breaker.test.js — Write breakers: every write scope has a real
// budget, a breaker fails closed once spent, and cost charges the budget in
// proportion to the batch.

import test from "node:test";
import assert from "node:assert/strict";

import { consumeGlobalBudget } from "../lib/security/rateLimit.js";

// audit #20: write surfaces (interaction, boards, interpret-feedback) had no
// global circuit breaker, so accumulated device identities could run up
// unbounded DB cost while reads failed closed at their budgets. The write
// scopes now carry default budgets, and consumeGlobalBudget accepts a cost so
// a batched interaction draws in proportion to its load.
//
// NOTE the limiter is process-global with a per-minute window, so each real
// scope is touched ONCE (proving its budget exists) and the mechanics are
// tested on unique private scopes that no other test shares — the same
// isolation convention as tests/release-blockers.js.

test("#20 each write scope ships with a real non-zero default budget", async () => {
  for (const scope of ["interaction", "boards", "interpret-feedback"]) {
    const r = await consumeGlobalBudget(scope); // one hit against a 1800-4000 budget
    assert.equal(r.allowed, true, `${scope} first call allowed`);
    assert.ok(r.limit > 0, `${scope} has a default budget, got limit ${r.limit}`);
  }
});

test("#20 a write breaker fails closed once its budget is spent", async () => {
  process.env.GLOBAL_BUDGET_ZZWRITE1 = "2";
  try {
    assert.equal((await consumeGlobalBudget("zzwrite1")).allowed, true, "hit 1");
    assert.equal((await consumeGlobalBudget("zzwrite1")).allowed, true, "hit 2");
    assert.equal((await consumeGlobalBudget("zzwrite1")).allowed, false, "exhausted fails closed");
  } finally {
    delete process.env.GLOBAL_BUDGET_ZZWRITE1;
  }
});

test("#20 cost charges the budget in proportion to a batch's load", async () => {
  process.env.GLOBAL_BUDGET_ZZWRITE2 = "10";
  try {
    assert.equal((await consumeGlobalBudget("zzwrite2", 6)).allowed, true, "first 6-cost batch fits");
    assert.equal((await consumeGlobalBudget("zzwrite2", 6)).allowed, false, "second 6-cost batch exceeds 10");
  } finally {
    delete process.env.GLOBAL_BUDGET_ZZWRITE2;
  }
});

test("#20 cost is clamped to at least 1 (a zero/garbage cost still charges)", async () => {
  process.env.GLOBAL_BUDGET_ZZWRITE3 = "2";
  try {
    assert.equal((await consumeGlobalBudget("zzwrite3", 0)).allowed, true, "call 1 costs >=1");
    assert.equal((await consumeGlobalBudget("zzwrite3", -5)).allowed, true, "call 2 costs >=1");
    assert.equal((await consumeGlobalBudget("zzwrite3", NaN)).allowed, false, "call 3 exhausts — each charged >=1");
  } finally {
    delete process.env.GLOBAL_BUDGET_ZZWRITE3;
  }
});

test("#20 explicit 0 disables a write breaker without a deploy", async () => {
  process.env.GLOBAL_BUDGET_ZZWRITE4 = "0";
  try {
    for (let i = 0; i < 50; i++) {
      assert.equal((await consumeGlobalBudget("zzwrite4", 20)).allowed, true, "0 = disabled, never closes");
    }
  } finally {
    delete process.env.GLOBAL_BUDGET_ZZWRITE4;
  }
});
