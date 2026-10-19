// tests/stylist-size-warning.test.js — The stylist's size warning: catalog
// sizes are objects, sizes compare as strings, and a passenger is warned when
// a look does not fit them.

import test from "node:test";
import assert from "node:assert/strict";

import { sizeLabelOf } from "../lib/ai/stylistReasoningEngine.js";
import catalog from "../lib/ingest/catalog.json" with { type: "json" };

// Found by the Aug 8 codebase audit. The stylist's size warning compared
// `String(it.size)` against the user's size preferences. EVERY catalog item
// carries `size` as an OBJECT —
//   {label, system, gender, fitsLikeUS, runsBias, measurements}
// so String(it.size) was the literal "[object Object]", which is never in a
// preferences list. Every sized piece in every look was warned "size may not
// match preference", including exact matches.
//
// Not a rare path: app/api/outfits passes sizePreferences straight from the
// user's own fit profile, so anyone who set their size got a wall of false
// warnings — and the list is .slice(0,4)'d, so real availability warnings were
// pushed out by the noise.

const items = Array.isArray(catalog) ? catalog : (catalog.items || []);

test("W1 the catalog really does carry size as an object", () => {
  // If this ever stops being true the bug below changes shape, so pin the
  // premise rather than assuming it.
  const sized = items.filter((i) => i.size != null);
  assert.ok(sized.length > 0, "the catalog must have sized items");
  assert.equal(typeof sized[0].size, "object",
    "size is an object — this is why String(size) was '[object Object]'");
});

test("W2 sizeLabelOf returns a comparable string, not [object Object]", () => {
  const sized = items.filter((i) => i.size != null);
  for (const item of sized.slice(0, 50)) {
    const label = sizeLabelOf(item);
    assert.equal(typeof label, "string", "every sized item must yield a string");
    assert.notEqual(label, "[object Object]", "the exact regression");
    assert.ok(label.length > 0 && label.length < 12, `implausible size label: ${label}`);
  }
});

test("W3 a user's own size stops being warned against", () => {
  const prefs = ["XL"];
  const sized = items.filter((i) => i.size != null);

  // The old comparison, reproduced.
  const warnedBefore = sized.filter((it) => it.size && !prefs.includes(String(it.size))).length;
  const warnedAfter = sized.filter((it) => {
    const s = sizeLabelOf(it);
    return s && !prefs.includes(s);
  }).length;

  assert.equal(warnedBefore, sized.length,
    "before the fix EVERY sized item was warned — that is the bug");
  assert.ok(warnedAfter < warnedBefore,
    "after the fix, pieces that fit the user's size must not be warned");
  assert.ok(sized.length - warnedAfter > 0,
    "at least some catalog pieces must genuinely fit an XL wearer");
});

test("W4 shapes other than the catalog's are handled without throwing", () => {
  assert.equal(sizeLabelOf({ size: "M" }), "M", "a plain string still works");
  assert.equal(sizeLabelOf({ size: "  L  " }), "L");
  assert.equal(sizeLabelOf({}), null);
  assert.equal(sizeLabelOf(null), null);
  assert.equal(sizeLabelOf({ size: {} }), null, "an object with no label is not a size");
  assert.equal(sizeLabelOf({ size: 42 }), null);
});

test("W5 fitsLikeUS wins over label — that is what 'my usual size' means", () => {
  // A brand that runs small has fitsLikeUS one step below its label. Warning a
  // user against the LABEL would be the wrong way round: what matters is what
  // the garment actually fits like.
  assert.equal(sizeLabelOf({ size: { label: "M", fitsLikeUS: "S" } }), "S");
  assert.equal(sizeLabelOf({ size: { label: "M" } }), "M", "fall back to the label");
});
