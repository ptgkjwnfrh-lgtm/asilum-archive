// tests/taste-class.test.js — Taste class: opposite convictions never share a
// class, a rejected aesthetic never names it, and positive convictions still
// classify.

import test from "node:test";
import assert from "node:assert/strict";

import { tasteClass } from "../lib/brain/taste-class.js";

// Found by the Aug 8 codebase audit. tasteClass scored
// `factor * Math.abs(weight)`, so a REJECTED aesthetic voted for its class
// exactly as hard as a loved one — the passport printed the inverse of the
// bearer's taste. It had NO test coverage at all, which is why it survived.
//
// A conviction of -0.9 is one of the strongest signals the brain holds (a fast
// skip on a dominant-tag item already costs about -0.44), so abs() made the
// most confident rejections the loudest votes for the thing being rejected.

const REJECTS_SEDUCTIVE = [["SEDUCTIVE", -0.9], ["STATEMENT", -0.7], ["MINIMAL", 0.25]];
const LOVES_SEDUCTIVE = [["SEDUCTIVE", 0.9], ["STATEMENT", 0.7], ["MINIMAL", 0.25]];

test("T1 two people with opposite convictions do not get the same class", () => {
  // Measured before the fix: BOTH returned "ROMANTIC".
  const rejector = tasteClass(REJECTS_SEDUCTIVE);
  const lover = tasteClass(LOVES_SEDUCTIVE);
  assert.notEqual(rejector, lover,
    `opposite tastes produced the same class (${rejector}) — the passport is ` +
    "reading rejection as affinity");
});

test("T2 a rejected aesthetic does not name the class", () => {
  // The rejector's only POSITIVE conviction is MINIMAL, so whatever they are,
  // they are not the romantic/seductive class they actively skip.
  assert.notEqual(tasteClass(REJECTS_SEDUCTIVE), tasteClass(LOVES_SEDUCTIVE));
  assert.equal(tasteClass(LOVES_SEDUCTIVE), "ROMANTIC",
    "loving seductive/statement should still read ROMANTIC — the fix must not " +
    "break the case that was already right");
});

test("T3 positive convictions still classify", () => {
  assert.equal(tasteClass([["MINIMAL", 0.8], ["TAILORED", 0.5]]), "PROFESSIONAL");
  assert.equal(tasteClass([["GORP", 0.8], ["UTILITARIAN", 0.6]]), "ACTIVE");
});

test("T4 no signal reads UNCLASSIFIED rather than guessing", () => {
  assert.equal(tasteClass([]), "UNCLASSIFIED");
  assert.equal(tasteClass(null), "UNCLASSIFIED");
  assert.equal(tasteClass([["MINIMAL", 0.01]]), "UNCLASSIFIED",
    "below the 0.05 floor is still no signal");
});

// Signed scoring means a person who mostly REJECTS things can drive every
// class negative. That must read UNCLASSIFIED, not "the class you hate least".
test("T5 someone who rejects almost everything is UNCLASSIFIED, not mislabelled", () => {
  const mostlyRejection = [
    ["SEDUCTIVE", -0.9], ["STATEMENT", -0.8], ["GORP", -0.7],
    ["MINIMAL", -0.6], ["ARCHIVAL", -0.5],
  ];
  assert.equal(tasteClass(mostlyRejection), "UNCLASSIFIED",
    "with no positive convictions there is no class to print");
});
