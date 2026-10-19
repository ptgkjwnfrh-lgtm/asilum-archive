// tests/sign-out-notice.test.js — The sign-out notice: the retired claim
// appears nowhere, no notice is hand-typed, and every emitter imports the one
// shared constant.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { SIGN_OUT_NOTICE } from "../lib/client.js";

// PR #148 measured that adoption MOVES taste — it deletes the device's profile
// row and reassigns its boards, interactions and follows to the account,
// leaving the device at {} / [] / [] — and corrected a sign-out notice that
// claimed "device taste remains".
//
// It corrected ONE of the two emitters. app/profile/page.js has its own SIGN
// OUT handler publishing the same notice and still carried the false string,
// so both fired on sign-out and raced; whichever landed last is what the user
// read. A grep for the phrase would have caught it and was never run.
//
// These tests are that grep, made permanent. The point is not the wording — it
// is that a claim measured to be false cannot come back by being retyped
// somewhere the fix did not look.

const ROOT = path.join(process.cwd());
const SEARCH_DIRS = ["app", "lib", "components"];
const RETIRED = "device taste remains";

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
  for (const dir of SEARCH_DIRS) walk(path.join(ROOT, dir));
  return out;
}

// The explanatory comments quote the retired phrase ON PURPOSE — that is the
// record of why it is retired. Only CODE counts, so comments come out first.
// (My first draft of S1 skipped this step and flagged its own documentation.)
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("S1 the retired sign-out claim appears nowhere in shipped code", () => {
  const offenders = sourceFiles().filter((file) =>
    stripComments(readFileSync(file, "utf8")).includes(RETIRED));
  assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), [],
    `"${RETIRED}" was measured to be false — it must not appear in code anywhere`);
});

test("S2 no sign-out notice is published from a hand-typed string", () => {
  // The regression was a second emitter with its own copy of the wording.
  // Catch the SHAPE of that: a notice publisher called with a string literal
  // that looks like a sign-out message, anywhere in the tree.
  const offenders = [];
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    const calls = code.match(/(?:setAuthNotice|publishNotice)\(\s*["'`]([^"'`]*)["'`]\s*\)/g) || [];
    for (const call of calls) {
      const literal = call.replace(/^[^"'`]*["'`]/, "").replace(/["'`][^"'`]*$/, "");
      // Only a notice ASSERTING a completed sign-out makes a claim about what
      // happened to the user's data. Failure notices ("could not sign out —
      // try again") assert nothing and are fine — my first pass flagged one,
      // which is a false positive, not a finding.
      if (/^\s*signed out/i.test(literal)) offenders.push(`${path.relative(ROOT, file)}: ${call}`);
    }
  }
  assert.deepEqual(offenders, [],
    "sign-out notices must come from SIGN_OUT_NOTICE, not a retyped literal");
});

test("S2b both known emitters import the shared constant", () => {
  const importers = sourceFiles().filter((file) =>
    stripComments(readFileSync(file, "utf8")).includes("SIGN_OUT_NOTICE"));
  const names = importers.map((f) => path.relative(ROOT, f)).sort();
  assert.ok(names.includes("app/shell.js"), `shell must use the constant; importers: ${names}`);
  assert.ok(names.includes("app/profile/page.js"),
    `the profile SIGN OUT handler must use it too — this is the one #148 missed; importers: ${names}`);
});

test("S3 the notice says what actually happens to device state", () => {
  // Pin the claim, not the prose: it must not promise the device keeps taste.
  assert.ok(!/device taste remains/i.test(SIGN_OUT_NOTICE));
  assert.match(SIGN_OUT_NOTICE, /account/i, "it must say where the taste went");
  assert.match(SIGN_OUT_NOTICE, /fresh|empty|cold|start/i,
    "and that this device does not keep it");
});
