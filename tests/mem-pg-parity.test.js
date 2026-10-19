// tests/mem-pg-parity.test.js — the audit's law 4, made executable.
//
// "mem and Postgres are one system with two implementations, and mem is
// the one being exercised." (the 8 Aug 2026 notes.) Preview deploys, local
// dev, and 520 of 532 tests run mem, so a divergence ships green. These
// pin the two divergences confirmed by the Aug 14 verification pass, in
// the backend that would otherwise hide them.
//
// Both tests fail against the code as it stood before the fix — checked
// by reverting each fix and watching them go red (law 2).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTicket, updateTicket, transitionTicket, listTickets, getTicket,
} from "../lib/db/production.js";
import { saveProfile, listTasteVectors } from "../lib/db/index.js";
import { normalizeWardrobeAdd } from "../lib/wardrobe/index.js";

const USER = "u-parity-1111-4111-8111-111111111111";

test("mem tickets expose `consented`, exactly as ticketRow derives it on Postgres", async () => {
  const created = await createTicket({
    userId: USER, productId: "p-parity-1", sourceName: "ASILUM Vault",
    sourceProductUrl: "https://example.com/p", itemPriceAtRequest: 100,
  });
  // The key must EXIST and be false before consent — undefined would read
  // as false at the call site while meaning "this backend has no idea".
  assert.equal("consented" in created, true, "the key exists on creation");
  assert.equal(created.consented, false);

  await updateTicket(created.id, { status: "awaiting_user_consent" });
  const consented = await transitionTicket(created.id, USER, "consent", {
    disclaimerVersion: "v1-2026-07",
  });
  assert.ok(consented, "the consent transition is legal from awaiting_user_consent");
  assert.equal(consented.consented, true, "transition result reports consent");

  // /orders reads `t.consented` off the LIST, which is the path that was
  // silently blank on mem.
  const listed = (await listTickets(USER)).find((t) => t.id === created.id);
  assert.equal(listed.consented, true, "the list a reader sees says consent is on file");
  assert.equal((await getTicket(created.id)).consented, true, "and so does the single read");
});

test("mem listTasteVectors returns `long` only, matching the narrowed Postgres projection", async () => {
  // Audit #12 residual. The Postgres side narrows to the long-term vector in
  // SQL so `_meta`/`session` never cross the wire; mem must expose the SAME
  // contract or the divergence ships green in the backend 520 of these tests
  // actually run. The Postgres half of this pair lives in
  // tests/postgres-integration.test.js, which is the only place the SQL
  // COALESCE/NULLIF semantics can genuinely fail.
  const modern = `${USER}-tv-modern`;
  const legacy = `${USER}-tv-legacy`;

  await saveProfile(modern, {
    long: { minimal: 3, tailoring: 2 },
    session: { neon: 9 },
    _meta: { seen: ["item-a", "item-b"] },
  });
  await saveProfile(legacy, { archival: 5 });

  const byId = new Map((await listTasteVectors(1000)).map((r) => [r.userId, r]));

  const row = byId.get(modern);
  assert.ok(row, "the saved profile is in the scan");
  assert.deepEqual(row.long, { minimal: 3, tailoring: 2 }, "long vector preserved");
  assert.equal(row.vec, undefined, "the whole-profile field is gone from the contract");
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("_meta"), "mem must not hand back _meta either");
  assert.ok(!serialized.includes("neon"), "nor the session vector");

  assert.deepEqual(byId.get(legacy).long, { archival: 5 },
    "a legacy flat profile still resolves to itself on mem, as it does on Postgres");
});

// NOTE — where the OTHER confirmed divergence is tested, and why not here.
// A non-numeric ticketId (purchase_tickets.id is BIGSERIAL) used to raise
// Postgres 22P02 → 500 while mem answered a clean 400. A mem test cannot
// catch that: mem's Number("abc") → NaN misses either way, so the
// assertion passes with the fix AND without it — the exact anti-pattern
// law 2 names ("a test asserting the benign case passes against the
// bug"). I wrote it here first, reverted the fix, watched it stay green,
// and moved it to tests/postgres-integration.test.js, where the
// unguarded query really does raise and the guard really can fail.
