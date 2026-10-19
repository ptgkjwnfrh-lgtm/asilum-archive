// tests/asterisk-memory.test.js — Asterisk memory facade (ADR-001 v2).
// Mem-mode: contract shape, measurements privacy (status only, never raw
// values), preferences validation, follows CRUD + cap, purge and adoption
// coverage of the two v14 domains.

import { test } from "node:test";
import assert from "node:assert/strict";

import { asteriskMemory, MEMORY_CONTRACT_VERSION, MEMORY_SECTIONS } from "../lib/asterisk/memory.js";
import {
  saveMemoryPreferences, getMemoryPreferences,
  setFollow, listFollows,
  saveUserMeasurements, purgePersonalizationData, adoptAccountData,
} from "../lib/db/production.js";

const U = "u-memory-test-1";

test("facade returns the versioned contract with all sections", async () => {
  const r = await asteriskMemory(U);
  assert.equal(r.ok, true);
  const m = r.memory;
  assert.equal(m.contractVersion, MEMORY_CONTRACT_VERSION);
  for (const key of ["explicit", "inferred", "global", "uncertainty", "controls", "preferences"]) {
    assert.ok(m[key], `missing ${key}`);
  }
  assert.equal(m.explicit.craving.persisted, false);
  assert.ok(Array.isArray(m.uncertainty.openQuestions));
  assert.ok(m.controls.forget.every((f) => f.endpoint.startsWith("/api/")));
});

test("facade requires a user", async () => {
  const r = await asteriskMemory("");
  assert.equal(r.ok, false);
});

test("measurements surface presence only — raw values never appear", async () => {
  const user = "u-memory-meas";
  await saveUserMeasurements(user, {
    usualSize: "M", preferredUnit: "in",
    inches: { chest: 39, waist: 32, hips: 38, inseam: 31, height: 70 },
  });
  const r = await asteriskMemory(user);
  assert.equal(r.memory.explicit.measurements.set, true);
  const flat = JSON.stringify(r.memory);
  for (const raw of [39, 32, 38, 31, 70]) {
    assert.ok(!new RegExp(`\\b${raw}\\b`).test(flat.replace(/"signalCount":\d+/, "")),
      `raw measurement ${raw} leaked into the memory payload`);
  }
  await purgePersonalizationData(user);
});

test("preferences roundtrip through the facade", async () => {
  await saveMemoryPreferences(U, ["global"]);
  const r = await asteriskMemory(U);
  assert.deepEqual(r.memory.preferences.hiddenSections, ["global"]);
  assert.equal(r.memory.preferences.guidanceEnabled, true);
  await saveMemoryPreferences(U, { guidanceEnabled: false });
  assert.deepEqual(await getMemoryPreferences(U), {
    hiddenSections: ["global"], guidanceEnabled: false, explorationOff: false,
  }, "a partial guidance patch preserves display preferences");
  await saveMemoryPreferences(U, { hiddenSections: [] });
  assert.deepEqual(await getMemoryPreferences(U), {
    hiddenSections: [], guidanceEnabled: false, explorationOff: false,
  }, "a partial display patch preserves guidance");
  await saveMemoryPreferences(U, { guidanceEnabled: true });
});

test("preferences reject unknown and duplicate sections below the route layer", async () => {
  await assert.rejects(() => saveMemoryPreferences(U, ["global", "global"]), TypeError);
  await assert.rejects(() => saveMemoryPreferences(U, ["private-internals"]), TypeError);
  await assert.rejects(() => saveMemoryPreferences(U, { guidanceEnabled: "false" }), TypeError);
  await assert.rejects(() => saveMemoryPreferences(U, {}), TypeError);
});

test("MEMORY_SECTIONS is the drawer's exact section list", () => {
  assert.deepEqual([...MEMORY_SECTIONS], ["explicit", "inferred", "global", "uncertainty"]);
});

test("follows: set, list newest-first, unset, kind validation, cap", async () => {
  const user = "u-memory-follows";
  await setFollow(user, "brand", "Auralee", true);
  await setFollow(user, "user", "@vex.archive", true);
  let follows = await listFollows(user);
  assert.equal(follows.length, 2);
  assert.equal(follows[0].target, "@vex.archive");
  await setFollow(user, "user", "@vex.archive", false);
  follows = await listFollows(user);
  assert.deepEqual(follows.map((f) => f.target), ["Auralee"]);
  await assert.rejects(() => setFollow(user, "board", "b-1", true), TypeError);
  await assert.rejects(() => setFollow(user, "brand", "", true), TypeError);
  for (let i = 0; i < 60; i++) await setFollow(user, "brand", `brand-${i}`, true);
  const capped = await setFollow(user, "brand", "one-too-many", true);
  assert.equal(capped.ok, false);
  assert.equal((await setFollow(user, "brand", "brand-0", true)).ok, true,
    "an existing follow stays idempotent when the cap is full");
  assert.equal((await listFollows(user)).length, 50);
  await purgePersonalizationData(user);
});

test("concurrent follows cannot race beyond the per-user cap", async () => {
  const user = "u-memory-follow-race";
  await Promise.all(Array.from({ length: 75 }, (_, index) =>
    setFollow(user, "brand", `race-brand-${index}`, true)));
  assert.equal((await listFollows(user)).length, 50);
  await purgePersonalizationData(user);
});

test("purge erases Asterisk preferences and restores guidance default", async () => {
  const user = "u-memory-purge";
  await setFollow(user, "brand", "Bode", true);
  await saveMemoryPreferences(user, { hiddenSections: ["explicit"], guidanceEnabled: false });
  await purgePersonalizationData(user);
  assert.equal((await listFollows(user)).length, 0);
  assert.deepEqual(await getMemoryPreferences(user), {
    hiddenSections: [], guidanceEnabled: true, explorationOff: false,
  });
});

test("adoption moves follows and preferences; account side wins conflicts", async () => {
  const from = "u-memory-adopt-from";
  const to = "sb-memory-adopt-to";
  await setFollow(from, "brand", "Dries Van Noten", true);
  await setFollow(to, "brand", "Dries Van Noten", true); // duplicate — must not double
  await setFollow(from, "brand", "Lemaire", true);
  await saveMemoryPreferences(from, { hiddenSections: ["global"], guidanceEnabled: false });
  await saveMemoryPreferences(to, { hiddenSections: ["inferred"], guidanceEnabled: true }); // account side wins
  await adoptAccountData(from, to);
  const follows = await listFollows(to);
  assert.deepEqual([...new Set(follows.map((f) => f.target))].sort(), ["Dries Van Noten", "Lemaire"]);
  assert.equal(follows.length, 2);
  assert.equal((await listFollows(from)).length, 0);
  assert.deepEqual((await getMemoryPreferences(to)).hiddenSections, ["inferred"]);
  assert.equal((await getMemoryPreferences(to)).guidanceEnabled, true);
  assert.deepEqual((await getMemoryPreferences(from)).hiddenSections, []);
  await purgePersonalizationData(to);
});

test("adoption carries paused guidance when the account has no preference", async () => {
  const from = "u-guidance-adopt-from";
  const to = "sb-guidance-adopt-to";
  await saveMemoryPreferences(from, { guidanceEnabled: false });
  await adoptAccountData(from, to);
  assert.equal((await getMemoryPreferences(to)).guidanceEnabled, false);
  assert.equal((await getMemoryPreferences(from)).guidanceEnabled, true);
  await purgePersonalizationData(to);
});
