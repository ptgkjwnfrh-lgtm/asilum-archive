// tests/asterisk-margin.test.js — constitution A5, "the margin to assume".
//
// The owner asked for "a very small margin for it to assume things". A rule
// like that is worth nothing as a sentence in a document, so this is the file
// that makes each clause fail when it stops being true.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EVIDENCE_FLOOR, NOT_ENOUGH_YET, citableTags, hasEnoughEvidence, signalCountOf,
} from "../lib/asterisk/margin.js";
import { confidenceBand } from "../lib/asterisk/confidence.js";

test("A5.1 the evidence floor is one number in one place", async () => {
  assert.equal(typeof EVIDENCE_FLOOR, "number");
  assert.ok(EVIDENCE_FLOOR >= 1);

  // It was `signalCount < 5` in explain.js and `LOW_SIGNAL_FLOOR = 5` in
  // memory.js — the same number typed twice, in files that never referenced
  // each other, so raising it needed two edits and would silently miss one.
  const root = process.cwd();
  for (const file of ["lib/asterisk/explain.js", "lib/asterisk/memory.js"]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.match(src, /from "\.\/margin\.js"/, `${file} must read the shared floor`);
    assert.doesNotMatch(src, /signalCount < 5/, `${file} must not re-declare it`);
  }

  // and the count itself is derived one way, not per caller
  assert.equal(signalCountOf({ sources: { saves: 3, bags: 2 } }), 5);
  assert.equal(signalCountOf({ sources: {} }), 0);
  assert.equal(signalCountOf(null), 0);
  assert.equal(signalCountOf({ sources: { junk: "x" } }), 0, "a non-number is not a signal");
});

test("A5.2 below the floor, abstention is the answer", () => {
  assert.equal(hasEnoughEvidence(EVIDENCE_FLOOR), true);
  assert.equal(hasEnoughEvidence(EVIDENCE_FLOOR - 1), false);
  assert.equal(hasEnoughEvidence(0), false);
  assert.equal(hasEnoughEvidence(null), false);
  assert.equal(hasEnoughEvidence("many"), false, "a word is not a count");

  // One sentence, so the same admission reads the same way everywhere rather
  // than being re-invented per page.
  assert.match(NOT_ENOUGH_YET, /not enough/i);
  assert.match(NOT_ENOUGH_YET, /general/i, "and it says what it IS falling back to");
});

test("A5.3 no surface prints a confidence percentage", async () => {
  // confidenceBand() was written for exactly this — "a phrase, never a bare
  // percentage pretending to be objective truth" — and had never been rendered
  // anywhere, while two screens printed the percentage it exists to prevent.
  assert.equal(confidenceBand(0.95), "very strong match");
  assert.equal(confidenceBand(0.3), "uncertain — check the assumptions");
  assert.equal(confidenceBand(null), null);

  const root = process.cwd();
  // (V.2 slice 3) the feed's why panel is app/components/AsteriskWhy.jsx
  for (const file of ["app/components/AsteriskWhy.jsx", "app/discover/page.js"]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /confidence[^\n]*\* 100\)/,
      `${file} prints a confidence percentage — a number carries a precision the evidence does not have`);
    assert.doesNotMatch(src, /tasteMatch \* 100/, `${file} prints a taste-match percentage`);
    assert.match(src, /confidenceBand\(/, `${file} must say the band instead`);
  }
});

test("A5.4 an inference is not evidence — a haloed tag cannot be cited", () => {
  // `learn()` bleeds a strong positive into ADJACENT tags a person never
  // touched. That is legitimate for RANKING and must never come back as "your
  // taste", nor feed a further inference: a guess drawn from a guess is a
  // claim.
  const taste = { MINIMAL: 0.8, TAILORED: 0.35, GORP: 0.2 };
  const touched = new Set(["MINIMAL"]);

  const citable = citableTags(taste, touched);
  assert.deepEqual(citable, { MINIMAL: 0.8 }, "only what they actually did");
  assert.ok(!("TAILORED" in citable), "the halo ranks, it does not testify");

  // the ranking vector itself is untouched — this filters what may be SHOWN,
  // it does not weaken the recommender
  assert.deepEqual(taste, { MINIMAL: 0.8, TAILORED: 0.35, GORP: 0.2 });

  // arrays work as well as Sets, and nothing touched means nothing citable
  assert.deepEqual(citableTags(taste, ["GORP"]), { GORP: 0.2 });
  assert.deepEqual(citableTags(taste, []), {});
  assert.deepEqual(citableTags(null, ["MINIMAL"]), {});
});

test("A5 is written down where it binds", () => {
  // §10 exists because "a binding document that outlives its decisions is
  // worse than no document". An amendment nobody transcribed is that failure.
  const doc = readFileSync(path.join(process.cwd(), "CONSTITUTION.md"), "utf8");
  assert.match(doc, /\*\*A5 — THE MARGIN TO ASSUME/);
  assert.match(doc, /EVIDENCE_FLOOR/, "and it names the module that makes it true");
  assert.match(doc, /Bands, not percentages/);
  assert.match(doc, /An inference is not evidence/);
});
