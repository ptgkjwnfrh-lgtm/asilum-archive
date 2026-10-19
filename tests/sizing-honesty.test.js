// tests/sizing-honesty.test.js — Sizing honesty: extended alpha sizes resolve
// to themselves rather than a body measurement, and numeric and regional
// labels resolve as before.

import test from "node:test";
import assert from "node:assert/strict";

import { toUSAlpha, sizeRecord } from "../lib/brain/sizing.js";
import { fitLabel } from "../lib/tagging/dense.js";

// Two sizing defects found by the Aug 8 codebase audit. Both put wrong
// information in front of a shopper, and both were invisible because no test
// crossed the boundary between the module that PRODUCES a value and the module
// that LABELS it.

// The ALPHA table always carried correct "2XL" / "3XL" / "ONE SIZE" rows. They
// were unreachable: every lookup key was built by stripping the label, so
// "2XL" became "XL" and "ONE SIZE" became "ONESIZE", and a `!numMatch` guard
// then refused the lookup for anything containing a digit. The digit fell
// through to the NUMERIC path and was read as a body measurement.
test("Z1 extended alpha sizes resolve to themselves, not to a body measurement", () => {
  // Measured before the fix: "2XL" -> "XS". The largest common size was being
  // scored as the smallest, for both genders.
  assert.equal(toUSAlpha("2XL", "womens", "tops"), "XXL");
  assert.equal(toUSAlpha("2XL", "mens", "tops"), "XXL");
  assert.equal(toUSAlpha("3XL", "mens", "tops"), "XXXL");
  assert.notEqual(toUSAlpha("2XL", "womens", "tops"), "XS",
    "the exact regression: n=2 read as a US womens 2");
});

test("Z2 'ONE SIZE' is understood, and matches its own abbreviation", () => {
  assert.equal(toUSAlpha("ONE SIZE", null, "accessories"), "M");
  assert.equal(toUSAlpha("OS", null, "accessories"), "M",
    "OS already worked; the spelled-out form must agree with it");
});

// The numeric interpretation must survive the new direct lookup — the fix
// would be worthless if it swallowed real measurements.
test("Z3 numeric and regional labels still resolve as before", () => {
  assert.equal(toUSAlpha("US 2", "womens", "tops"), "XS");
  assert.equal(toUSAlpha("IT 42", "womens", "tops"), "M");
  assert.equal(toUSAlpha("32", "mens", "bottoms"), "M");
  assert.equal(toUSAlpha("XL", "mens", "tops"), "XL");
  assert.equal(toUSAlpha("M", "mens", "tops"), "M");
});

// THE CROSS-FILE INVARIANT. sizing.js produces runsBias and renders the phrase
// a shopper reads; dense.js turns the same number into a filterable tag. They
// disagreed on the SIGN, so the dense `fit` tag contradicted the size note on
// the same product.
test("Z4 the dense fit tag agrees with the size note on the same product", () => {
  // sizing.js convention, from the phrase it renders:
  //   runsBias > 0  ->  "runs small"
  //   runsBias < 0  ->  "runs large"
  assert.equal(fitLabel(1), "runs-small",
    "positive bias means runs SMALL — this returned runs-large");
  assert.equal(fitLabel(-1), "runs-large",
    "negative bias means runs LARGE — this returned runs-small");
  assert.equal(fitLabel(0), "true-to-size");
  assert.equal(fitLabel(null), null);
});

// Ground the convention in a real brand rather than in the constant alone, so
// the invariant survives someone "fixing" it in the wrong direction.
test("Z5 a brand known to run small is tagged runs-small end to end", () => {
  // Prada is +1 in BRAND_BIAS and genuinely runs small; Kapital is -1 and
  // genuinely runs large. If both ends of the pipeline agree with the world,
  // the sign convention is right.
  // signature is sizeRecord(rawLabel, opts) — my first draft passed one object
  // and silently got bias 0, which is a test bug, not a code bug.
  const prada = sizeRecord("M", { brand: "Prada", category: "tops", gender: "womens" });
  const kapital = sizeRecord("M", { brand: "Kapital", category: "tops", gender: "mens" });

  assert.ok(prada.runsBias > 0, "Prada is recorded as running small");
  assert.ok(kapital.runsBias < 0, "Kapital is recorded as running large");
  assert.equal(fitLabel(prada.runsBias), "runs-small");
  assert.equal(fitLabel(kapital.runsBias), "runs-large");
});
