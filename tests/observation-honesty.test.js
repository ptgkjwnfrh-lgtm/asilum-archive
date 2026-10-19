// tests/observation-honesty.test.js — Observation honesty: no surface claims
// ASILUM watches other tabs or sites, the observation toggle really gates
// passive signals, and placeholder aesthetics are never shown as observed.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Found by the Aug 8 codebase audit. Two constitution-class defects sat in the
// LIVE OBSERVATION feature, both in the "no faking" family:
//
//   1. app/page.js told the user "observed interest in <tag> ON AN EXTERNAL
//      TAB". ASILUM has no cross-site observation capability anywhere, and
//      /privacy tells the user — correctly — "no cross-site tracking". The
//      home page claimed a surveillance power the product does not have while
//      the privacy page denied doing it. The tags actually come from
//      GET /api/profile: the user's own in-app taste vector.
//   2. The ON-DEVICE TASTE OBSERVATION switch was decorative. observationOn()
//      was read only to render the module and the toggle; nothing gated the
//      dwell and examination sends. Turning it OFF hid a panel while passive
//      attention data kept flowing, under copy promising "the brain only
//      learns from explicit actions".
//
// These are source-level guards because both defects are CLAIMS, and a claim
// regresses by someone retyping it, not by a function returning the wrong
// number. Same shape as tests/sign-out-notice.test.js.

const ROOT = process.cwd();
const SEARCH_DIRS = ["app", "lib", "components"];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(js|jsx|mjs)$/.test(entry)) out.push(p);
    }
  };
  for (const d of SEARCH_DIRS) walk(path.join(ROOT, d));
  return out;
}

test("O1 no surface claims ASILUM can observe other tabs or sites", () => {
  // The privacy page's own "no cross-site tracking" is a DENIAL and must be
  // allowed to say the words; only an affirmative claim is a violation.
  const CLAIMS = [/on an external tab/i, /observed .{0,40}on (another|an external) (tab|site)/i];
  const offenders = [];
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const re of CLAIMS) {
      if (re.test(code)) offenders.push(`${path.relative(ROOT, file)} :: ${re}`);
    }
  }
  assert.deepEqual(offenders, [],
    "ASILUM has no cross-site observation capability — claiming one is a no-faking violation, " +
    "and /privacy separately promises the opposite");
});

test("O2 the observation toggle actually gates the passive-signal senders", () => {
  const home = readFileSync(path.join(ROOT, "app", "page.js"), "utf8");
  const code = stripComments(home);

  assert.ok(code.includes("observationOn()"),
    "app/page.js must consult the observation preference");

  // The gate must sit in the same effect that posts dwell and impressions,
  // BEFORE either send — not merely somewhere in the file.
  // Anchor on the impression POST and walk back to its enclosing setInterval:
  // my first draft sliced between "dwellRef.current" and "DWELL_FLUSH_MS",
  // but the constant is declared at the top of the file, so the window came
  // out backwards and empty. The test was wrong, not the gate.
  // (7 Sep) the examination-report POST lives in a helper, flushBeacons, that
  // the interval calls after the gate and loadFeed calls under the gate.
  const impressionAt = code.indexOf('"/api/impressions"');
  assert.ok(impressionAt > 0, "the examination-report POST must be findable");
  const helperStart = code.lastIndexOf("const flushBeacons", impressionAt);
  assert.ok(helperStart > 0, "the POST must sit inside flushBeacons");
  const callAt = code.indexOf("flushBeacons(user)", helperStart + 1);
  assert.ok(callAt > 0, "the interval must call flushBeacons");
  const effectStart = code.lastIndexOf("setInterval(", callAt);
  assert.ok(effectStart > 0, "its enclosing interval must be findable");
  const flush = code.slice(effectStart, callAt + 30);
  assert.ok(flush.includes("observationOn()"),
    "the dwell/impression flush must check observationOn() — it did not, which is what " +
    "made the Settings switch decorative");

  const gateAt = flush.indexOf("observationOn()");
  const dwellPost = flush.indexOf('"/api/interaction"');
  const impressionPost = flush.indexOf("flushBeacons(user)");
  assert.ok(dwellPost === -1 || gateAt < dwellPost, "the gate must precede the dwell POST");
  assert.ok(impressionPost === -1 || gateAt < impressionPost,
    "the gate must precede the examination-report flush — examination is a passive " +
    "attention signal too, not an explicit action");
  // Every other call of the helper is guarded by the same preference.
  let from = callAt + 1;
  while ((from = code.indexOf("flushBeacons(user)", from + 1)) > 0) {
    assert.ok(code.slice(from - 40, from).includes("observationOn()"),
      "every flushBeacons call must sit behind observationOn()");
  }
});

test("O3 placeholder aesthetics are never rendered as observations", () => {
  // The LIVE OBSERVATION cube left the home page on Aug 12 (owner order:
  // the excess header modules are gone) — with no tracker anywhere, the
  // fabricated-observation surface cannot exist, which satisfies this law
  // outright. The guard still bites if a tracker ever returns, wherever
  // it lands: it used to seed useState with three real aesthetic names and
  // render them through the same line as measured data, so a cold user was
  // told they had been observed about tastes they had never expressed.
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    const start = code.indexOf("function ObservationTracker");
    if (start < 0) continue;
    const body = code.slice(start, start + 2500);
    assert.ok(!/useState\(\[\s*["'][A-Z]/.test(body),
      `${path.relative(ROOT, file)}: ObservationTracker must not seed itself with hardcoded ` +
      "aesthetic names — a placeholder rendered as a finding is a fabricated observation");
  }
});
