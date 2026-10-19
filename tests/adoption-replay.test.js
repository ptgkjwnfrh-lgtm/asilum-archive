// tests/adoption-replay.test.js — Operation replay across sign-in: a replayed
// operation is refused rather than applied twice, rekeying is collision-safe,
// and identities match exactly, never as substrings.

import test from "node:test";
import assert from "node:assert/strict";

import {
  commitInteractionBatch, getProfile, saveProfile, getPopularity,
} from "../lib/db/index.js";
import { adoptAccountData, purgePersonalizationData } from "../lib/db/production.js";

// Round A. adoptAccountData's two backends disagreed about the one thing
// processed_operations exists for: whether a REPLAYED interaction batch is
// safe across sign-in.
//
//   Postgres : INSERT ... SELECT rekeys the device's operation ids to the
//              account, THEN deletes the originals -> a replay is refused.
//   mem      : deleted them outright -> a replay was ACCEPTED and applied
//              a second time.
//
// MEASURED before the fix: eng/imp reached 2 for a single replayed batch, plus
// a duplicate interaction row and a duplicate event. `engagers` stayed correct
// only because the v22/v23 ledgers dedupe downstream — a different mechanism
// masking part of the damage, which is why this was invisible.
//
// Adoption is exactly when a client is most likely to retry: shell.js re-issues
// writes around the sign-in identity swap. mem mode is what preview deploys,
// local dev, and nearly every test run on — so the broken half was the half
// actually being exercised. The Postgres counterpart of this test lives in
// tests/postgres-integration.test.js so the two backends are pinned to the
// SAME answer rather than each to its own.

const OP = "replayed-op-000000001";

const mkEvent = (uid, itemId) => ({
  itemId, action: "favorite", dwellMs: null,
  canonicalEvent: { userId: uid, type: "USER_FAVORITED_ITEM", payload: { itemId } },
});

const reduceFor = (itemId) => () => ({
  profile: { long: { TAILORED: 1 }, session: {}, _meta: {} },
  edgePairs: [],
  popularity: [{ id: itemId, eng: 1, imp: 1 }],
});

async function fresh(...uids) {
  for (const uid of uids) await purgePersonalizationData(uid).catch(() => {});
}

test("R1 a replayed operation is refused after sign-in, not applied twice", async () => {
  const device = "u-dev-r1", account = "sb-acct-r1", item = "r1-item";
  await fresh(device, account);

  const first = await commitInteractionBatch({
    userId: device, operationId: OP, events: [mkEvent(device, item)], reduce: reduceFor(item),
  });
  assert.equal(first.duplicate, false, "the first commit applies");

  // Baseline: the guard already works WITHIN one identity.
  const sameIdentity = await commitInteractionBatch({
    userId: device, operationId: OP, events: [mkEvent(device, item)], reduce: reduceFor(item),
  });
  assert.equal(sameIdentity.duplicate, true, "replay under the same identity is refused");

  await saveProfile(device, await getProfile(device));
  await adoptAccountData(device, account);

  // The client retries the SAME operation id, now under the account identity.
  const afterAdoption = await commitInteractionBatch({
    userId: account, operationId: OP, events: [mkEvent(account, item)], reduce: reduceFor(item),
  });
  assert.equal(afterAdoption.duplicate, true,
    "replay after sign-in must be refused — the operation id moved with the identity");

  const pop = (await getPopularity(5000))[item];
  assert.equal(pop.eng, 1, "raw engagement counter must not double (was 2)");
  assert.equal(pop.imp, 1, "raw impression counter must not double (was 2)");

  await fresh(device, account);
});

// The rekey must not clobber an operation the ACCOUNT had already recorded
// under the same id, and must not resurrect the device's key.
test("R2 rekeying operations collides safely and strands nothing", async () => {
  const device = "u-dev-r2", account = "sb-acct-r2", item = "r2-item";
  await fresh(device, account);

  // Both identities independently used the same operation id.
  await commitInteractionBatch({
    userId: device, operationId: OP, events: [mkEvent(device, item)], reduce: reduceFor(item),
  });
  await commitInteractionBatch({
    userId: account, operationId: OP, events: [mkEvent(account, item)], reduce: reduceFor(item),
  });

  await saveProfile(device, await getProfile(device));
  await adoptAccountData(device, account);

  // The account's own record survives, so its replay is still refused.
  const accountReplay = await commitInteractionBatch({
    userId: account, operationId: OP, events: [mkEvent(account, item)], reduce: reduceFor(item),
  });
  assert.equal(accountReplay.duplicate, true, "the account's existing key is not clobbered");

  // And nothing is left addressable under the device identity.
  const deviceReplay = await commitInteractionBatch({
    userId: device, operationId: OP, events: [mkEvent(device, item)], reduce: reduceFor(item),
  });
  assert.equal(deviceReplay.duplicate, false,
    "the device key was moved away, so the emptied device starts clean");

  await fresh(device, account);
});

// The rekey has to match the uid SEGMENT of scope:userId:opId. This one is a
// GUARD, not a regression test, and it passes against the old code too: with
// no key part able to contain a colon, the old `.includes(':' + id + ':')`
// could not actually mismatch. Kept because the rekey now rebuilds the key
// from its parts, which is where an off-by-one segment would bite.
test("R3 rekeying matches the identity exactly, not as a substring", async () => {
  const shortId = "u-dev-r3", longId = "u-dev-r3-extra", account = "sb-acct-r3";
  const item = "r3-item";
  await fresh(shortId, longId, account);

  await commitInteractionBatch({
    userId: longId, operationId: OP, events: [mkEvent(longId, item)], reduce: reduceFor(item),
  });

  // Adopting the SHORT id must leave the LONG id's operation untouched.
  await saveProfile(shortId, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(shortId, account);

  const longReplay = await commitInteractionBatch({
    userId: longId, operationId: OP, events: [mkEvent(longId, item)], reduce: reduceFor(item),
  });
  assert.equal(longReplay.duplicate, true,
    "an unrelated identity's operation key must survive someone else's adoption");

  await fresh(shortId, longId, account);
});
