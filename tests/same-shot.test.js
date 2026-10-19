// tests/same-shot.test.js
// REVERSE IMAGE SEARCH ON A LISTING — and the one temptation it must refuse.
//
// A dhash is a DUPLICATE DETECTOR. At hamming ≤6 it means "the same
// photograph". At 10, 14, 20 it means nothing reliable — two dark garments on
// a white background land close together whether or not they resemble each
// other. The obvious "improvement" to this module is to widen the threshold and
// call the results similar, and that would be a guess wearing a feature's
// clothes. Most of these tests exist to stop it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sameShotElsewhere, sameShotNote } from "../lib/vision/sameShot.js";
import { saveImageFingerprint } from "../lib/db/imageFingerprints.js";
import { DHASH_HAMMING_THRESHOLD } from "../lib/images/dhash.js";

const SRC = readFileSync("lib/vision/sameShot.js", "utf8");
const MODAL = readFileSync("app/components/ListingSheet.jsx", "utf8");

const SHOT = "a1b2c3d4e5f60718";
const OTHER = "ffffffffffffffff";

const item = (id, price, dhash = SHOT) => ({ id, price, currency: "USD", dhash });

async function seed(rows) {
  for (const [id, dhash] of rows) {
    await saveImageFingerprint({ itemId: id, sourceName: `s-${id}`, imageUrl: `u/${id}`, dhash });
  }
}

test("IT SPEAKS — the same photograph elsewhere is found", async () => {
  await seed([["a1", SHOT], ["a2", SHOT]]);
  const pool = { a1: item("a1", 500), a2: item("a2", 300) };
  const found = await sameShotElsewhere(pool.a1, (id) => pool[id]);
  assert.equal(found.length, 1, "the other listing is found");
  assert.equal(found[0].id, "a2");
  assert.equal(found[0].cheaper, true);
  assert.equal(found[0].saving, 200);
});

test("IT STAYS QUIET — a unique photograph says nothing", async () => {
  await seed([["b1", "0000000000000000"]]);
  const pool = { b1: item("b1", 500) };
  assert.deepEqual(await sameShotElsewhere(pool.b1, (id) => pool[id]), []);
  assert.equal(sameShotNote([]), null, "and there is no sentence for nothing");
});

test("a piece never fingerprinted is silence, not a finding", async () => {
  // "We could not look" is different from "nothing is there". The distinction
  // is REPORTED in lib/authenticity/evidence.js; here it is simply quiet.
  const pool = { never: item("never", 500) };
  assert.deepEqual(await sameShotElsewhere(pool.never, (id) => pool[id]), []);
});

test("A MISSING PRICE IS NOT A BARGAIN", async () => {
  // Treating an absent price as cheaper would invent a saving out of a gap.
  await seed([["c1", SHOT], ["c2", SHOT]]);
  const pool = { c1: item("c1", 500), c2: { id: "c2", price: null, currency: "USD" } };
  const found = await sameShotElsewhere(pool.c1, (id) => pool[id]);
  const c2 = found.find((f) => f.id === "c2");
  assert.equal(c2.cheaper, false);
  assert.equal(c2.saving, null);
  // The bug this line exists for: Number(null) is 0 and Number.isFinite(0) is
  // true, so a missing price reported as a real USD 0 and sorted first.
  assert.equal(c2.price, null, "a missing price must be null, never 0");
});

test("cheapest first, and a priceless listing never leads", async () => {
  await seed([["d1", SHOT], ["d2", SHOT], ["d3", SHOT]]);
  const pool = {
    d1: item("d1", 900),
    d2: { id: "d2", price: null, currency: "USD" },
    d3: item("d3", 200),
  };
  const found = await sameShotElsewhere(pool.d1, (id) => pool[id]);
  assert.equal(found[0].id, "d3", "the actionable one leads");
  assert.equal(found[found.length - 1].id, "d2", "the unpriced one sinks");
});

test("THE THRESHOLD IS NOT WIDENED — this is duplicates, never similarity", () => {
  // The module must not pass its own maxHamming. Widening it to return
  // "similar" pieces is the guess the first law forbids.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /maxHamming/,
    "sameShot must use the same-photograph default, never its own threshold");
  assert.equal(DHASH_HAMMING_THRESHOLD, 6);
  assert.doesNotMatch(code, /similar|lookalike|resembl/i,
    "a duplicate detector must not describe itself as a similarity engine");
});

test("visual similarity stays a DECLARED seam, not a stretched dhash", async () => {
  // The honest route to "a different photograph of a comparable garment" is
  // embeddings, and that seam is deliberately unimplemented.
  const { embedImage } = await import("../lib/embeddings/index.js");
  const out = await embedImage("anything");
  assert.equal(out.ok, false, "embedImage must not claim success");
  assert.equal(out.implemented, false,
    "it must report itself unbuilt rather than return something plausible");
  assert.ok(out.hint, "and say what it would need");
});

test("the sentence states a FACT, and leads with the actionable half", () => {
  assert.match(sameShotNote([{ id: "x", price: 300, currency: "USD", cheaper: true, saving: 200 }]),
    /the same photograph is listed at USD 300\./);
  assert.match(sameShotNote([{ id: "x", price: 900, currency: "USD", cheaper: false, saving: null }]),
    /the same photograph is on another listing\./);
  // Never an accusation, never a verdict — the reader draws the conclusion.
  for (const banned of [/fake/i, /stolen/i, /scam/i, /suspicious/i, /warning/i]) {
    assert.doesNotMatch(sameShotNote([{ id: "x", price: 1, cheaper: false }]), banned);
  }
});

test("NO CONTROL — no listing offers a reverse image search", () => {
  const visible = MODAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const control of [/reverse image/i, /search by image/i, /find this image/i,
                         /image search/i, /check image/i]) {
    assert.doesNotMatch(visible, control, "the capability is never advertised");
  }
  assert.match(MODAL, /setSameShot\(d\.sameShot \|\| null\)/,
    "it rides the fetch that already fires when a piece opens");
});

test("absent, not empty, when there is nothing to say", () => {
  const route = readFileSync("app/api/related/route.js", "utf8");
  assert.match(route, /\.\.\.\(sameShot \? \{ sameShot \} : \{\}\)/,
    "the key is omitted entirely rather than sent empty");
  assert.match(MODAL, /sameShot \? \(/, "and the block does not render");
});
