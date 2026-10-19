// tests/product-resolution.test.js — audit finding #10, verified in
// docs/history/audit-verified-2026-08-14.md.
//
// resolveProducts awaited resolveProduct once per id, so a 60-id
// /api/interaction request became 60 primary-key queries — against the shipped
// max:5 pool that is 12 sequential round-trip waves, each holding every
// connection while it waited — plus a fallback pool probe for every id that
// missed. It is now one `id = ANY(...)` scan and at most one probe.
//
// The COUNT is asserted in tests/postgres-integration.test.js, deliberately:
// in mem, resolution is an O(1) Map hit per id either way, so a mem assertion
// could not tell the two implementations apart. What mem CAN prove is that
// batching did not change any answer, and that is what these tests are for.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveProduct, resolveProducts } from "../lib/products.js";
import { upsertItems } from "../lib/db/index.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const known = CATALOG.slice(0, 5).map((item) => item.id);

test("R1 a batch resolves every id it was given, keyed by that id", async () => {
  const resolved = await resolveProducts(known);
  assert.equal(resolved.size, known.length);
  for (const id of known) {
    assert.equal(resolved.get(id).id, id);
    assert.ok(resolved.get(id).title, "a real snapshot, not a stub");
  }
});

test("R2 the batch and the single path give the same answer", async () => {
  // resolveProduct now delegates to resolveProducts so the two cannot come to
  // disagree about what 'resolvable' means — the shape of bug that put ticket
  // `consented` on Postgres only.
  for (const id of known) {
    assert.deepEqual(await resolveProduct(id), (await resolveProducts([id])).get(id));
  }
  assert.equal(await resolveProduct("no-such-item-at-all"), null);
  assert.equal(await resolveProduct(""), null);
  assert.equal(await resolveProduct(null), null);
});

test("R3 duplicate ids collapse and order of request does not matter", async () => {
  const doubled = await resolveProducts([...known, ...known]);
  assert.equal(doubled.size, known.length, "a Map keyed by id, deduped once");
  const reversed = await resolveProducts([...known].reverse());
  assert.deepEqual([...reversed.keys()].sort(), [...doubled.keys()].sort());
});

test("R4 an unknown id is absent rather than null-valued or thrown", async () => {
  const mixed = await resolveProducts([known[0], "ghost-id-999", known[1]]);
  assert.equal(mixed.size, 2, "callers check size against their input — a null entry would inflate it");
  assert.equal(mixed.has("ghost-id-999"), false);
});

test("R5 an empty or junk-only request does no work and returns an empty Map", async () => {
  for (const input of [[], [null, undefined, ""], undefined]) {
    const resolved = await resolveProducts(input);
    assert.equal(resolved.size, 0);
    assert.ok(resolved instanceof Map);
  }
});

test("R6 ids are clamped to 80 chars exactly as before", async () => {
  const long = "x".repeat(200);
  assert.equal((await resolveProducts([long])).size, 0);
  assert.equal(await resolveProduct(long), null);
});

test("R7 a sold or hidden item resolves to nothing and does NOT fall through", async () => {
  // The fallback exists for a keyless/empty catalog. A row that EXISTS but is
  // not offerable must not be answered from synthetic inventory instead —
  // that would resurrect a sold piece into a mutation path.
  const sold = { ...CATALOG[0], id: "res-sold-item", availability_status: "sold" };
  const hidden = { ...CATALOG[1], id: "res-hidden-item", moderation_status: "hidden" };
  const gone = { ...CATALOG[2], id: "res-unavailable-item", is_available: false };
  await upsertItems([sold, hidden, gone]);

  const resolved = await resolveProducts([sold.id, hidden.id, gone.id, known[0]]);
  assert.deepEqual([...resolved.keys()], [known[0]],
    "only the offerable piece resolves");
  assert.equal(await resolveProduct(sold.id), null);
});

test("R8 a 60-id batch — the /api/interaction worst case — resolves whole", async () => {
  const many = CATALOG.slice(0, 60).map((item) => item.id);
  const resolved = await resolveProducts(many);
  assert.equal(resolved.size, many.length,
    "the request size that motivated the fix must still answer completely");
});
