// tests/eval-dataset.test.js — The search evaluation dataset: structurally
// sound, every expected entity exists in the catalog, and adversarial cases
// carry an explicit must-not-claim.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { lookupCulture } from "../lib/asterisk/culture.js";

// Phase 0: the evaluation dataset is a contract. This test validates its
// SHAPE and its references against the live catalog — it does not yet score
// an interpreter (that is Phase 1's calibration gate).
const dataset = JSON.parse(readFileSync(new URL("../eval/universal-queries.json", import.meta.url)));

const BEHAVIORS = new Set(Object.keys(dataset.behaviors));
const CATEGORIES = new Set(["ordinary", "metaphorical", "ambiguous", "adversarial", "misspelled", "multilingual", "unsupported", "event", "known"]);

test("eval dataset is structurally sound", () => {
  assert.equal(dataset.version, 1);
  assert.ok(dataset.cases.length >= 30, "seed must stay non-trivial");
  const ids = new Set();
  for (const c of dataset.cases) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(CATEGORIES.has(c.category), `${c.id}: unknown category ${c.category}`);
    assert.ok(BEHAVIORS.has(c.expect), `${c.id}: unknown expectation ${c.expect}`);
    assert.ok(typeof c.query === "string" && c.query.length > 0 && c.query.length <= 200, `${c.id}: query bounds`);
  }
});

test("every expected-resolve entity exists in the live catalog", () => {
  for (const c of dataset.cases) {
    if (c.expect !== "resolve" || !c.entity) continue;
    const hit = lookupCulture(c.entity);
    assert.ok(hit && hit.name === c.entity, `${c.id}: entity "${c.entity}" not in catalog`);
  }
  for (const c of dataset.cases) {
    for (const name of c.acceptable_entities || []) {
      assert.ok(lookupCulture(name), `${c.id}: acceptable entity "${name}" not in catalog`);
    }
  }
});

test("adversarial and event cases all carry an explicit must_not_claim or honest expectation", () => {
  for (const c of dataset.cases) {
    if (c.category === "adversarial" || c.category === "event") {
      assert.ok(c.must_not_claim || ["fallthrough", "best_effort", "refuse_fact"].includes(c.expect),
        `${c.id}: adversarial/event case lacks an honesty assertion`);
    }
  }
});
