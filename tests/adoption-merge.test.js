// tests/adoption-merge.test.js — Sign-in adoption merges bridge impressions:
// device impressions survive when the account has its own, the per-bridge cap
// holds after summing, and every engagement keeps its impressions.

import test from "node:test";
import assert from "node:assert/strict";

import { getProfile, saveProfile } from "../lib/db/index.js";
import { adoptAccountData, purgePersonalizationData } from "../lib/db/production.js";

// audit #16: on account adoption, mergeTasteProfiles let the target (account)
// win on every _meta key, so the DEVICE's accumulated bridgeStats/bridgeServed
// — the r16/r19 tuning DENOMINATOR — were discarded, while user_events (the
// NUMERATOR) transferred additively. Tuning then saw engagement without its
// matching impressions. These tests drive the REAL adoption path (proving the
// device=source / account=target arg order too), mem-mode.

async function seed(uid, profile) {
  await purgePersonalizationData(uid).catch(() => {});
  await saveProfile(uid, profile);
}

test("#16 device bridge impressions SURVIVE adoption when the account has its own", async () => {
  const device = "u-dev-16a", account = "u-acct-16a";
  // device browsed a lot pre-signin; account browsed a little post-signup.
  await seed(device, {
    long: { GORP: 0.4 }, session: {},
    _meta: { bridgeStats: { gamma: 90, alpha: 40 }, bridgeServed: { gamma: 120, alpha: 60 } },
  });
  await seed(account, {
    long: { MINIMAL: 0.2 }, session: {},
    _meta: { bridgeStats: { alpha: 10 }, bridgeServed: { alpha: 15 } },
  });

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  // Summed per bridge, not target-wins-and-discard.
  assert.equal(merged._meta.bridgeStats.gamma, 90, "device-only gamma preserved");
  assert.equal(merged._meta.bridgeStats.alpha, 50, "alpha summed (40 device + 10 account)");
  assert.equal(merged._meta.bridgeServed.gamma, 120, "served gamma preserved");
  assert.equal(merged._meta.bridgeServed.alpha, 75, "served alpha summed (60 + 15)");

  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});

test("#16 the 100k per-bridge cap holds after summing", async () => {
  const device = "u-dev-16b", account = "u-acct-16b";
  await seed(device, { long: {}, session: {}, _meta: { bridgeStats: { gamma: 80_000 } } });
  await seed(account, { long: {}, session: {}, _meta: { bridgeStats: { gamma: 80_000 } } });
  await adoptAccountData(device, account);
  const merged = await getProfile(account);
  assert.equal(merged._meta.bridgeStats.gamma, 100_000, "sum clamps to the 100k cap");
  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});

test("#16 tuning invariant: every transferred engagement retains impressions", async () => {
  // The concrete harm: engagement (numerator) present, impressions
  // (denominator) zero. After the fix, any bridge the device engaged on must
  // still carry its device impressions post-adoption.
  const device = "u-dev-16c", account = "u-acct-16c";
  await seed(device, { long: {}, session: {}, _meta: { bridgeStats: { gamma: 200, beta: 50 } } });
  await seed(account, { long: {}, session: {}, _meta: {} }); // fresh account
  await adoptAccountData(device, account);
  const merged = await getProfile(account);
  for (const bridge of ["gamma", "beta"]) {
    assert.ok((merged._meta.bridgeStats[bridge] || 0) > 0,
      `${bridge} kept its impression denominator after adoption`);
  }
  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});

test("#16 ring caps match the canonical writers (recent 20, follows 10)", async () => {
  const device = "u-dev-16d", account = "u-acct-16d";
  const many = (n, p) => Array.from({ length: n }, (_, i) => p + i);
  await seed(device, { long: {}, session: {}, _meta: { recent: many(18, "d"), follows: many(8, "bd") } });
  await seed(account, { long: {}, session: {}, _meta: { recent: many(18, "a"), follows: many(8, "ba") } });
  await adoptAccountData(device, account);
  const merged = await getProfile(account);
  // EQUALITY, not an upper bound. 18+18 recent and 8+8 follows both overflow
  // their caps, so the caps must BITE — and `<= 20` / `<= 10` also passed for
  // an adoption that dropped every ring entirely, which is the failure this
  // test exists to notice.
  assert.equal(merged._meta.recent.length, 20, "recent fills exactly to its cap");
  assert.equal(merged._meta.follows.length, 10, "follows fills exactly to its cap");
  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});

test("#16 profiles with no bridge counters adopt cleanly (no fabricated keys break reads)", async () => {
  const device = "u-dev-16e", account = "u-acct-16e";
  await seed(device, { long: { GORP: 0.5 }, session: {}, _meta: { recent: ["syn-1"] } });
  await seed(account, {});
  const res = await adoptAccountData(device, account);
  // `res.movedProfile || res.movedRecords >= 0` was a tautology: a count is
  // always >= 0, so it held for a COMPLETE no-op adoption. Assert the thing
  // the test is named for instead.
  assert.equal(res.movedProfile, true, "the device profile actually moved");
  const merged = await getProfile(account);
  // `assert.ok(merged.long)` passed on `{}`, which is exactly the outcome that
  // would mean the taste was lost. Check the taste ARRIVED...
  assert.equal(merged.long.GORP, 0.5, "the device's taste survived adoption");
  assert.deepEqual(merged._meta.recent, ["syn-1"], "and so did its recent ring");
  // ...and that adopting a profile with no bridge counters did not invent any,
  // which is what "no fabricated keys break reads" means.
  assert.deepEqual(merged._meta.bridgeStats ?? {}, {},
    "no bridgeStats keys fabricated for a profile that never had them");
  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});

// SIGNING IN MUST NOT SHRINK THE READER'S WORLD.
//
// The merge caps each ring at what its canonical writer uses, and the `seen`
// cap was a literal `200` copied from lib/brain. That copy went stale on
// 6 September when rotation memory became pool-sized: a reader who had been
// shown 900 pieces would have signed in and had 700 of them forgotten,
// putting them straight back inside the ceiling that change removed — and
// silently, since a smaller rotation ring produces a feed, just a repetitive
// one. The cap is imported now. This is the test that says so.
test("adoption keeps rotation memory beyond the old flat 200", async () => {
  const device = "u-adopt-seen";
  const account = "sb-adopt-seen";
  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});

  const deviceSeen = Array.from({ length: 700 }, (_, i) => `dev-${i}`);
  const accountSeen = Array.from({ length: 300 }, (_, i) => `acct-${i}`);
  await saveProfile(device, { long: { TAILORED: 0.4 }, session: {}, _meta: { seen: deviceSeen } });
  await saveProfile(account, { long: { TAILORED: 0.4 }, session: {}, _meta: { seen: accountSeen } });

  await adoptAccountData(device, account);

  const seen = (await getProfile(account))._meta.seen;
  assert.equal(seen.length, 1000,
    `both readers' rotation memory should survive the merge; kept ${seen.length} of 1000`);
  assert.equal(new Set(seen).size, seen.length, "and each id once");
  assert.ok(seen.includes("dev-699") && seen.includes("acct-299"),
    "from both sides, not just the account's");

  await purgePersonalizationData(device).catch(() => {});
  await purgePersonalizationData(account).catch(() => {});
});
