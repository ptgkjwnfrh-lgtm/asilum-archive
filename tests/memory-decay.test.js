// tests/memory-decay.test.js — Taste memory decay: one half-life halves every
// weight, two quarter it, and decay never flips a weight's sign.

import test from "node:test";
import assert from "node:assert/strict";

import { applyTimeDecay, noteActivity } from "../lib/brain/memory.js";
import { learn, migrateProfile, coldStart } from "../lib/brain/index.js";

// audit #11: applyTimeDecay (runs on every serve and interaction) and the core
// learn() dynamics shipped with ZERO tests, and the replay harness cannot
// cover them by construction (it bans wall clocks). These use the injectable
// `now` to pin the exact arithmetic — each assertion is tight enough that a
// flipped sign or a wrong constant fails it. audit #4: coldStart must not
// emit zero-valued tags.

const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 6; // 6 idle days (memory.js)
// These tests pin the SINGLE-half-life arm. Since 19 Sep decay is by evidence
// class by default (tests/taste-classes.test.js); BRAIN_DECAY_BY_CLASS=0 is
// the kill switch that restores this arm, and it is set for this file.
process.env.BRAIN_DECAY_BY_CLASS = "0";
const FORGET_FLOOR = 0.04;

function profileAt(long, session, lastActive) {
  return { long: { ...long }, session: { ...(session || {}) }, _meta: { lastActive } };
}

// ---- exact half-life -------------------------------------------------------

test("#11 one half-life idle halves every weight (long and session alike)", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({ MINIMAL: 0.8 }, { GORP: 0.6 }, t0);
  const { profile } = applyTimeDecay(p, t0 + HALF_LIFE_MS);
  assert.ok(Math.abs(profile.long.MINIMAL - 0.4) < 1e-9, `long halved: ${profile.long.MINIMAL}`);
  assert.ok(Math.abs(profile.session.GORP - 0.3) < 1e-9, `session halved same rate: ${profile.session.GORP}`);
});

test("#11 two half-lives quarter the weight (decay is exponential, not linear)", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({ MINIMAL: 0.8 }, {}, t0);
  const { profile } = applyTimeDecay(p, t0 + 2 * HALF_LIFE_MS);
  assert.ok(Math.abs(profile.long.MINIMAL - 0.2) < 1e-9, `two half-lives → 0.2, got ${profile.long.MINIMAL}`);
});

test("#11 decay never flips sign — a negative weight stays negative (mutant guard)", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({ AVOID: -0.8 }, {}, t0);
  const { profile } = applyTimeDecay(p, t0 + HALF_LIFE_MS);
  assert.ok(Math.abs(profile.long.AVOID - -0.4) < 1e-9, `stays negative, halved: ${profile.long.AVOID}`);
  // A sign-flipped factor (2^(dt/HL)) would give -1.6 (clamped nowhere here) — this fails it.
});

// ---- forget floor ----------------------------------------------------------

test("#11 a long tag crossing below the forget floor is deleted AND logged", () => {
  const t0 = 1_000_000_000_000;
  // 0.05 is above the 0.04 floor; after one half-life it is 0.025 < floor.
  const p = profileAt({ FADING: 0.05 }, {}, t0);
  const { profile, forgotten } = applyTimeDecay(p, t0 + HALF_LIFE_MS);
  assert.ok(!("FADING" in profile.long), "sub-floor tag removed");
  assert.equal(forgotten.length, 1);
  assert.equal(forgotten[0].tag, "FADING");
  assert.equal(profile._meta.forgotten[0].tag, "FADING", "logged to _meta.forgotten for the viz");
});

test("#11 session tags cross the floor silently (forget log is long-only)", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({}, { FADING: 0.05 }, t0);
  const { profile, forgotten } = applyTimeDecay(p, t0 + HALF_LIFE_MS);
  assert.ok(!("FADING" in profile.session), "sub-floor session tag removed");
  assert.equal(forgotten.length, 0, "session forgets are not logged as events");
});

test("#11 a tag already below the floor is not re-logged as a fresh forget", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({ ALREADY: 0.03 }, {}, t0); // below floor before decay
  const { forgotten } = applyTimeDecay(p, t0 + HALF_LIFE_MS);
  assert.equal(forgotten.length, 0, "only a fresh crossing (before>=floor) logs a forget");
});

// ---- the 60s idle guard ----------------------------------------------------

test("#11 dt under 60s applies no decay (avoids churning on rapid serves)", () => {
  const t0 = 1_000_000_000_000;
  const p = profileAt({ MINIMAL: 0.8 }, {}, t0);
  const { profile } = applyTimeDecay(p, t0 + 30_000);
  assert.equal(profile.long.MINIMAL, 0.8, "no decay within the guard window");
  assert.equal(profile._meta.lastActive, t0 + 30_000, "but lastActive still advances");
});

// ---- noteActivity ----------------------------------------------------------

test("#11 noteActivity rings the dominant tag and advances the clock", () => {
  const t0 = 1_000_000_000_000;
  const p = noteActivity(profileAt({}, {}, t0 - 1000), { tags: { GORP: 0.3, MINIMAL: 0.9 } }, "save", t0);
  assert.equal(p._meta.activity[0].tag, "MINIMAL", "dominant tag ringed");
  assert.equal(p._meta.activity[0].kind, "save");
  assert.equal(p._meta.lastActive, t0);
});

// ---- learn() arithmetic ----------------------------------------------------

test("#11 a bag on a single-tag item folds exactly ACTION_WEIGHT into long", () => {
  // fresh profile: LONG_DECAY on 0 is 0; fold = tags.MINIMAL(1) * w(0.7) = 0.7.
  const p = learn(migrateProfile({}), { id: "x", tags: { MINIMAL: 1 } }, "bag");
  assert.ok(Math.abs(p.long.MINIMAL - 0.7) < 1e-9, `bag folds 0.7, got ${p.long.MINIMAL}`);
});

test("#11 repeated strong positives clamp long into [-1, 1]", () => {
  let p = migrateProfile({});
  for (let i = 0; i < 20; i++) p = learn(p, { id: "x" + i, tags: { MINIMAL: 1 } }, "bag");
  assert.ok(p.long.MINIMAL <= 1 + 1e-9, "clamped at 1");
  assert.ok(p.long.MINIMAL > 0.8, "but saturated high");
});

test("#11 session learns SESSION_RATE faster than long on the same interaction", () => {
  const p = learn(migrateProfile({}), { id: "x", tags: { GORP: 1 } }, "save");
  // long fold = 1 * 0.5; session fold = 1 * 0.5 * 2.5 = 1.25 → clamped to 1.
  assert.ok(Math.abs(p.long.GORP - 0.5) < 1e-9, `long ${p.long.GORP}`);
  assert.equal(p.session.GORP, 1, "session folds faster and clamps at 1");
});

// ---- #4 coldStart emits no zero-valued tags --------------------------------

test("#4 coldStart on a readable prompt yields only non-zero tags", () => {
  const { profile } = coldStart("minimal tailored");
  const vals = Object.values(profile);
  assert.ok(vals.length > 0, "a readable prompt produces a profile");
  assert.ok(vals.every((v) => v !== 0), "no zero-valued keys persist");
});

test("#4 coldStart on gibberish yields an EMPTY profile (not a zero-key vector)", () => {
  const { profile } = coldStart("zzxq wqph vvmm");
  assert.equal(Object.keys(profile).length, 0, "unreadable prompt → empty profile, so hasProfile stays false");
});
