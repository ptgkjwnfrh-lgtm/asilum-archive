// tests/adoption-mass.test.js — Sign-in adoption weighs each device by its
// evidence: a barely used device cannot halve an account, an established one
// dominates a thin account, equal evidence averages 50/50.

import test from "node:test";
import assert from "node:assert/strict";

import { getProfile, saveProfile, recordInteraction } from "../lib/db/index.js";
import { adoptAccountData, purgePersonalizationData } from "../lib/db/production.js";

// Round A (accounts as primary identity). Promoting the account from optional
// to primary makes SECOND-DEVICE sign-in the normal case: both sides hold real
// taste. mergeTasteProfiles was written for the other case — device into an
// EMPTY account — and handled the two branches inconsistently:
//
//   tag on ONE side  -> kept at FULL strength
//   tag on BOTH sides -> AVERAGED
//
// so weak corroborating evidence was punished harder than no evidence at all.
// MEASURED on the real adoption path before the fix: an account at TAILORED 0.8
// signing in on a barely-used device holding TAILORED 0.1 came out at 0.45 —
// the account's strongest conviction nearly halved — while that same device's
// GORP 0.9, a tag the account had never expressed, arrived untouched at 0.9.
//
// The fix weights each side by evidence mass (interaction count, sqrt-damped),
// which makes ABSENCE the limit of PRESENCE rather than a separate rule. These
// tests state the criteria the merge is now declared to meet. They drive the
// REAL adoption path in mem-mode, not mergeTasteProfiles directly, so the
// mass-must-be-counted-before-the-rows-move ordering is under test too.

async function seed(uid, profile, interactions = 0) {
  await purgePersonalizationData(uid).catch(() => {});
  await saveProfile(uid, profile);
  for (let i = 0; i < interactions; i++) {
    await recordInteraction(uid, `${uid}-item-${i}`, "favorite", null);
  }
}

async function cleanup(...uids) {
  for (const uid of uids) await purgePersonalizationData(uid).catch(() => {});
}

// C1 — CORROBORATION MUST NOT DILUTE. The regression that motivated the round.
test("A1 a barely-used second device no longer halves the account's conviction", async () => {
  const device = "u-dev-a1", account = "sb-acct-a1";
  await seed(account, { long: { TAILORED: 0.8, MINIMAL: 0.4 }, session: {}, _meta: {} }, 500);
  await seed(device, { long: { TAILORED: 0.1, GORP: 0.9 }, session: {}, _meta: {} }, 5);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  // Old behaviour was a flat (0.8 + 0.1) / 2 = 0.45. Declared criterion: with
  // the account holding >=10x the device's evidence, no account conviction may
  // lose more than 10% of its value to the weaker side.
  assert.ok(
    merged.long.TAILORED >= 0.8 * 0.9,
    `account conviction diluted to ${merged.long.TAILORED} (floor 0.72, old behaviour 0.45)`
  );
  assert.ok(merged.long.TAILORED < 0.8, "the device still moved it, just not much");

  // C2 — taste the account never expressed still arrives at full strength.
  assert.equal(merged.long.GORP, 0.9, "device-only tag carries through untouched");
  assert.equal(merged.long.MINIMAL, 0.4, "account-only tag untouched");

  await cleanup(device, account);
});

// C1 in the other direction: the rule is symmetric, so an established device
// signing into a thin account must dominate rather than be averaged away.
test("A2 an established device dominates a thin account, same rule both ways", async () => {
  const device = "u-dev-a2", account = "sb-acct-a2";
  await seed(account, { long: { TAILORED: 0.1 }, session: {}, _meta: {} }, 5);
  await seed(device, { long: { TAILORED: 0.8 }, session: {}, _meta: {} }, 500);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.ok(
    merged.long.TAILORED >= 0.8 * 0.9,
    `device conviction diluted to ${merged.long.TAILORED} (floor 0.72)`
  );

  await cleanup(device, account);
});

// C3 — BACKWARD COMPATIBLE. Equal evidence must reproduce the old arithmetic
// exactly. This is what makes the change a strict generalization rather than a
// behaviour swap, and why every pre-existing adoption test still passes.
test("A3 equal evidence reproduces the old 50/50 average exactly", async () => {
  const device = "u-dev-a3", account = "sb-acct-a3";
  await seed(account, { long: { TAILORED: 0.8 }, session: {}, _meta: {} }, 40);
  await seed(device, { long: { TAILORED: 0.2 }, session: {}, _meta: {} }, 40);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.equal(merged.long.TAILORED, 0.5, "equal masses -> (0.8 + 0.2) / 2");

  await cleanup(device, account);
});

// C3, the no-interaction case: mass 0 on both sides means "no evidence either
// way", which must fall back to the neutral 50/50 rather than divide by zero.
// Every adoption test written before this round seeds profiles without
// interactions and depends on this.
test("A4 profiles with no interactions at all fall back to the neutral average", async () => {
  const device = "u-dev-a4", account = "sb-acct-a4";
  await seed(account, { long: { TAILORED: 0.6 }, session: {}, _meta: {} }, 0);
  await seed(device, { long: { TAILORED: 0.2 }, session: {}, _meta: {} }, 0);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.equal(merged.long.TAILORED, 0.4, "no evidence on either side -> plain mean");

  await cleanup(device, account);
});

// C4 — BOUNDED. Weighting must never push a value outside the profile's range,
// including when both sides are already saturated.
test("A5 the merge stays inside [-1, 1] at saturation", async () => {
  const device = "u-dev-a5", account = "sb-acct-a5";
  await seed(account, { long: { TAILORED: 1, HATED: -1 }, session: {}, _meta: {} }, 900);
  await seed(device, { long: { TAILORED: 1, HATED: -1 }, session: {}, _meta: {} }, 3);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.equal(merged.long.TAILORED, 1, "agreement at the ceiling stays at the ceiling");
  assert.equal(merged.long.HATED, -1, "agreement at the floor stays at the floor");

  await cleanup(device, account);
});

// Genuine DISAGREEMENT is not the same as weak corroboration, and must still be
// split rather than resolved to whichever side is louder. Weighting changes
// where the split lands, never that there is one.
test("A6 opposite-sign disagreement still lands between the two sides", async () => {
  const device = "u-dev-a6", account = "sb-acct-a6";
  await seed(account, { long: { TAILORED: 0.6 }, session: {}, _meta: {} }, 100);
  await seed(device, { long: { TAILORED: -0.6 }, session: {}, _meta: {} }, 100);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.equal(merged.long.TAILORED, 0, "equal and opposite cancels, it does not pick a winner");

  await cleanup(device, account);
});

// The session vector is merged by the same code path as long. A regression that
// fixed only `long` would be invisible until a signed-in user's current session
// went cold, which is exactly the kind of thing that gets found in production.
test("A7 the session vector is weighted on the same rule as long", async () => {
  const device = "u-dev-a7", account = "sb-acct-a7";
  await seed(account, { long: {}, session: { TAILORED: 0.8 }, _meta: {} }, 500);
  await seed(device, { long: {}, session: { TAILORED: 0.1 }, _meta: {} }, 5);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.ok(
    merged.session.TAILORED >= 0.8 * 0.9,
    `session diluted to ${merged.session.TAILORED} (floor 0.72, old behaviour 0.45)`
  );

  await cleanup(device, account);
});

// The ordering hazard the implementation has to get right in BOTH backends:
// adoption reassigns the device's interaction rows to the account. Counting
// mass after that point reads the account on both sides, silently collapsing
// the weighting back to 50/50 while every other test still passes. Detect it by
// asserting the result differs from the neutral average.
test("A8 evidence is counted before adoption moves the interaction rows", async () => {
  const device = "u-dev-a8", account = "sb-acct-a8";
  await seed(account, { long: { TAILORED: 0.8 }, session: {}, _meta: {} }, 400);
  await seed(device, { long: { TAILORED: 0.0 }, session: {}, _meta: {} }, 4);

  await adoptAccountData(device, account);
  const merged = await getProfile(account);

  assert.notEqual(merged.long.TAILORED, 0.4, "0.4 means both sides were counted as the account");
  assert.ok(merged.long.TAILORED > 0.7, `weighting collapsed: got ${merged.long.TAILORED}`);

  await cleanup(device, account);
});

// Sign-out honesty (Round A). Adoption MOVES taste rather than copying it, so
// the device identity is left empty and the old "device taste remains" notice
// in app/shell.js was false. Pin the behaviour the message now describes, so a
// future change to either one has to face the other.
test("A9 adoption leaves the device empty — sign-out really is a fresh start", async () => {
  const device = "u-dev-a9", account = "sb-acct-a9";
  await seed(account, { long: { MINIMAL: 0.5 }, session: {}, _meta: {} }, 10);
  await seed(device, { long: { GORP: 0.7 }, session: {}, _meta: {} }, 10);

  await adoptAccountData(device, account);

  const deviceProfile = await getProfile(device);
  assert.deepEqual(deviceProfile, {}, "device profile is emptied, not copied");
  assert.equal((await getProfile(account)).long.GORP, 0.7, "and the taste is at the account");

  await cleanup(device, account);
});
