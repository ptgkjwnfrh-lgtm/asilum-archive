// tests/adoption-ledgers.test.js — Sign-in adoption and the corroboration
// ledgers: one person never counts as two edge contributors or popularity
// engagers, and account deletion reaches what was done before sign-in.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bumpEdges, getEdges, bumpPopularity, getPopularity, saveProfile,
} from "../lib/db/index.js";
import {
  adoptAccountData, purgePersonalizationData, recordUnknownQuery,
} from "../lib/db/production.js";
import { identityHash } from "../lib/db/index.js";

// Round A. Adoption moved every table keyed by `user_id` and NO table keyed by
// `identity_hash` — and identityHash is just sha256 of that same uid. The
// corroboration ledgers are the identity_hash tables.
//
// MEASURED before the fix, on the real adoption path:
//   edge contributors for one human, after sign-in : 2   (v22 ceiling is 1)
//   popularity engagers for one human              : 2
//   pre-sign-in rows surviving account deletion    : yes
//
// getEdges returns edgeStrength(), which under corroboration IS the distinct
// contributor count — so these assertions read the exact number gamma scores.

const pairOf = async (a, b) => (await getEdges([a]))[a]?.[b] ?? 0;

async function fresh(...uids) {
  for (const uid of uids) await purgePersonalizationData(uid).catch(() => {});
}

// The headline. v22 tuned GAMMA_CONTRIB_HALF=2 so ONE contributor scores 0.333,
// below the ~0.509 r18 vector floor, meaning a solo actor can never lift an item
// above the baseline it would have had with no edge at all. Two contributors
// score 0.500. If signing in mints a second contributor, the step v22 priced at
// "recruit another human" costs a click.
test("L1 signing in does not turn one human into two edge contributors", async () => {
  const device = "u-dev-l1", account = "sb-acct-l1";
  await fresh(device, account);
  const A = "l1-alpha", B = "l1-beta";

  await bumpEdges([{ a: A, b: B, w: 1 }], device);
  await bumpEdges([{ a: A, b: B, w: 1 }], device);
  assert.equal(await pairOf(A, B), 1, "repetition within one identity buys nothing");

  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);
  assert.equal(await pairOf(A, B), 1, "adoption itself must not change the count");

  // The same human, now signed in, engages the same pair again.
  await bumpEdges([{ a: A, b: B, w: 1 }], account);
  assert.equal(await pairOf(A, B), 1, "still ONE distinct contributor (was 2)");

  await fresh(device, account);
});

// v23, same root cause, different aggregate.
test("L2 signing in does not inflate popularity engagers", async () => {
  const device = "u-dev-l2", account = "sb-acct-l2";
  await fresh(device, account);
  const item = "l2-item";

  await bumpPopularity([{ id: item, eng: 1, imp: 1 }], device);
  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);
  await bumpPopularity([{ id: item, eng: 1, imp: 1 }], account);

  const stats = (await getPopularity(5000))[item];
  assert.equal(stats.engagers, 1, "one human, one engager (was 2)");
  assert.equal(stats.viewers, 1, "one human, one viewer (was 2)");
  // eng/imp are the raw diagnostic counters and are deliberately NOT deduped.
  assert.equal(stats.eng, 2, "raw event counter still counts both events");

  await fresh(device, account);
});

// v22 states outright that account deletion erases the ledger. Before the fix
// it erased only rows under the ACCOUNT's hash, so everything corroborated
// before sign-in survived deletion permanently.
test("L3 account deletion now reaches contributions made before sign-in", async () => {
  const device = "u-dev-l3", account = "sb-acct-l3";
  await fresh(device, account);
  const A = "l3-alpha", B = "l3-beta";

  await bumpEdges([{ a: A, b: B, w: 1 }], device);
  await bumpPopularity([{ id: "l3-item", eng: 1, imp: 1 }], device);
  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);

  await purgePersonalizationData(account);

  assert.equal(await pairOf(A, B), 0, "pre-sign-in edge corroboration is gone");
  const stats = (await getPopularity(5000))["l3-item"];
  assert.equal(stats?.engagers ?? 0, 0, "pre-sign-in engager is gone");

  await fresh(device, account);
});

// The ledger holds each contributor's BEST weight so the deliberate action
// hierarchy (bag 2 > share 1.5 > save/favorite 1) survives while repetition is
// worthless. Merging two identities must take GREATEST, never a sum — summing
// would let one person's two identities out-weigh a genuine bag.
test("L4 merging keeps the better weight, it does not add them up", async () => {
  const device = "u-dev-l4", account = "sb-acct-l4";
  await fresh(device, account);
  const A = "l4-alpha", B = "l4-beta";

  await bumpEdges([{ a: A, b: B, w: 2 }], device);    // device bagged it
  await bumpEdges([{ a: A, b: B, w: 1 }], account);   // account only favorited
  assert.equal(await pairOf(A, B), 2, "two identities before adoption");

  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);

  assert.equal(await pairOf(A, B), 1, "collapsed to one contributor");

  await fresh(device, account);
});

// A device that never corroborated anything must not fabricate a row for the
// account, and adoption must stay safe when there is simply nothing to move.
test("L5 adopting a device with no ledger rows changes nothing", async () => {
  const device = "u-dev-l5", account = "sb-acct-l5";
  await fresh(device, account);
  const A = "l5-alpha", B = "l5-beta";

  await bumpEdges([{ a: A, b: B, w: 1 }], account);
  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);

  assert.equal(await pairOf(A, B), 1, "account's own corroboration untouched");

  await fresh(device, account);
});

// Decay (r25) is measured from first_seen. If adoption refreshed the stamp, a
// person could keep an item permanently fresh just by signing in — the exact
// inverse, in the time dimension, of the property the ledger exists to hold.
test("L6 merging keeps the earliest first-seen, it does not refresh it", async () => {
  const device = "u-dev-l6", account = "sb-acct-l6";
  await fresh(device, account);
  const item = "l6-item";

  await bumpPopularity([{ id: item, eng: 1, imp: 1 }], device);
  const before = (await getPopularity(5000))[item].engagersDecayed;

  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);

  const after = (await getPopularity(5000))[item].engagersDecayed;
  assert.ok(after <= before + 1e-9, `decayed weight rose on adoption: ${before} -> ${after}`);
  assert.ok(after > 0, "and the contribution still counts");

  await fresh(device, account);
});

// unknown_query_votes exists so "one identity cannot vote a query into
// research" — demand_count and distinct_identities decide promotion into the
// research pipeline. Same defeat as the edge ledger.
test("L7 signing in does not let one human vote a query into research twice", async () => {
  const device = "u-dev-l7", account = "sb-acct-l7";
  await fresh(device, account);
  const query = "l7 unknown garment phrase";

  await recordUnknownQuery(query, identityHash(device), "none");
  const one = await recordUnknownQuery(query, identityHash(device), "none");
  assert.equal(one.distinctIdentities, 1, "repeat votes by one identity do not stack");

  await saveProfile(device, { long: { GORP: 0.5 }, session: {}, _meta: {} });
  await adoptAccountData(device, account);

  const after = await recordUnknownQuery(query, identityHash(account), "none");
  assert.equal(after.distinctIdentities, 1, "still ONE identity after signing in (was 2)");
  assert.equal(after.demandCount, 1, "demand not inflated by the sign-in");

  await fresh(device, account);
});

// v22's header cites unknown_query_votes as the PRECEDENT for hashing identity
// because it "is still pseudonymous personal data, so account deletion erases
// it". Before this round the precedent did not do the thing it was cited for.
test("L8 account deletion erases research votes and takes back the demand", async () => {
  const account = "sb-acct-l8";
  await fresh(account);
  const query = "l8 unknown garment phrase";

  const voted = await recordUnknownQuery(query, identityHash(account), "none");
  assert.equal(voted.demandCount, 1, "vote recorded");

  await purgePersonalizationData(account);

  // A fresh vote from an unrelated identity must start the tally from zero,
  // which is only true if the purged vote actually left the counters.
  const other = "u-unrelated-l8";
  const reVoted = await recordUnknownQuery(query, identityHash(other), "none");
  assert.equal(reVoted.demandCount, 1, "purged vote is gone from demand_count");
  assert.equal(reVoted.distinctIdentities, 1, "and from distinct_identities");

  await fresh(account, other);
});
