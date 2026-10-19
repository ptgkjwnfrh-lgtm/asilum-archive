// tests/authenticity-evidence.test.js
// ASILUM DOES NOT AUTHENTICATE, AND MUST NOT LEARN TO.
//
// The pressure on this module will always be toward a verdict: a score, a
// badge, a percentage, a shield. Every one of those is a guess about a
// purchase, which ASTERISK's first law forbids and which costs a reader real
// money when it is wrong. So the refusals are the tests.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readEvidence, SIGNALS } from "../lib/authenticity/evidence.js";
import { STAKE_HIGH, STAKE_MATERIAL } from "../lib/provenance.js";

const SRC = readFileSync("lib/authenticity/evidence.js", "utf8");
const MODAL = readFileSync("app/components/ListingSheet.jsx", "utf8");

const piece = (price) => ({
  id: `ev-${price}`, title: "coat", brand: "Balenciaga", price,
  source_name: "taobao", source_product_url: "https://example.com/i/1",
});

test("IT NEVER RENDERS A VERDICT — no score, no percentage, no shield", () => {
  const visible = MODAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const evidenceBlock = visible.slice(visible.indexOf('className="sawline"') - 400,
                                      visible.indexOf("sawline-gap") + 300);
  for (const banned of [/authentic/i, /genuine/i, /\bfake\b/i, /replica/i,
                        /legit/i, /verdict/i, /%/, /score/i, /confidence/i]) {
    assert.doesNotMatch(evidenceBlock, banned,
      `the evidence surface must never say ${banned} — it reports, it does not judge`);
  }
});

test("no signal may return a score — only something TRUE to say", () => {
  // A `said` string is a sentence a person can check. A number is a claim
  // dressed as a measurement.
  //
  // Comments are stripped first: the header EXPLAINS why a "94% authentic"
  // score is forbidden, and testing prose instead of code would fail the file
  // for saying the right thing.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /score|percent|probability|likelihood/i,
    "signals report observations, never quantities");
  // And the shape is enforced: a signal returns `said`, never a number.
  assert.match(code, /said:/, "observations are sentences");
});

test("SILENCE BELOW THE STAKE — the feature does not exist on a cheap piece", async () => {
  assert.equal(await readEvidence(piece(40)), null,
    "a low-stake piece carries no trace of this at all");
  assert.equal(await readEvidence(null), null);
});

test("it speaks where the reader is about to pay for a claim", async () => {
  for (const price of [300, 1200]) {
    const out = await readEvidence(piece(price));
    assert.ok(out, `£${price} must be read`);
    assert.ok([STAKE_MATERIAL, STAKE_HIGH].includes(out.stake));
    assert.equal(out.total, SIGNALS.length);
  }
});

test("COVERAGE IS STATED, and it is the honest headline", async () => {
  // Invisible machinery says "no empty state" — but coverage is not an empty
  // state, it is the finding. A reader about to pay for a claim is owed the
  // fact that we could look at one thing out of five.
  const out = await readEvidence(piece(1200));
  assert.ok(out.checked >= 1, "at least one check runs today");
  assert.ok(out.checked < out.total, "and most do not — say so");
  assert.ok(out.notChecked.length > 0);
  for (const gap of out.notChecked) {
    assert.ok(gap.needs && gap.needs.length > 10,
      `${gap.id} must say what it would need, in a reader's words`);
  }
  assert.match(MODAL, /checks could run/, "the coverage line is rendered, not hidden");
});

test("an unbuilt signal is DECLARED, never faked", () => {
  // `read: null` is the extension point: honest today, and a checklist later.
  const unbuilt = SIGNALS.filter((s) => typeof s.read !== "function");
  assert.ok(unbuilt.length >= 3, "the roadmap's signals are declared");
  for (const s of unbuilt) {
    assert.equal(s.read, null, `${s.id} must be null, never a stub returning something`);
    assert.ok(s.needs, `${s.id} must state its blocker`);
  }
});

test("a failing signal counts as NOT CHECKED, never as nothing found", async () => {
  // An error is a thing we could not see. Counting it as a clean result would
  // report absence of evidence as evidence of absence.
  const exploding = { id: "boom", needs: "a working check", read() { throw new Error("nope"); } };
  SIGNALS.push(exploding);
  try {
    const out = await readEvidence(piece(1200));
    assert.ok(out.notChecked.some((n) => n.id === "boom"),
      "a thrown signal must land in notChecked");
  } finally {
    SIGNALS.pop();
  }
});

test("evidence rides an existing request — there is no control for it", () => {
  const visible = MODAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const control of [/check authenticity/i, /verify this/i, /legit check/i,
                         /authenticate/i, /run check/i]) {
    assert.doesNotMatch(visible, control, "no affordance may offer a check");
  }
  assert.match(MODAL, /setEvidence\(d\.evidence \|\| null\)/,
    "it arrives on the related fetch that already fires when a piece opens");
});
