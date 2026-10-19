// tests/ai-contract.test.js — the honesty contract, made executable.
//
// `lib/ai/contract.js` is 25 lines and the whole AI seam is argued from it:
// every placeholder in `lib/*` returns through `notImplemented`, `mockMarked`
// or `real`, which is what the constitution's "no fake AI" rule rests on. The
// coverage audit called it the guarantee that makes "fake AI structurally
// impossible" — and noted that none of its three functions was ever named in a
// test. 10 importers, 44 call sites, zero coverage.
//
// A guarantee nobody checks is a comment. These tests turn it into a rule:
//
//   1. the three envelopes are mutually exclusive and self-classifying;
//   2. a mock can never present as real — not even when the payload it wraps
//      claims to be real, which is the case that would actually matter if a
//      provider ever echoed attacker-shaped data back;
//   3. `real` always carries provenance and `notImplemented` always names the
//      capability, checked at EVERY call site in the repo, not just here.
//
// The repo-wide scan strips comments first. Two separate scans during this work
// matched `notImplemented()` inside a sentence describing it — the same trap
// that made the first draft of the palette source guard read prose instead of
// code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mockMarked, notImplemented, real } from "../lib/ai/contract.js";

// The repo root. `fileURLToPath`, never `url.pathname` — this repo's directory
// name contains spaces, and `.pathname` hands back a percent-encoded string.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// How a consumer is meant to read an envelope: `ok` first, then `mock`.
const classify = (env) => {
  if (!env.ok) return "unimplemented";
  return env.mock ? "mock" : "real";
};

// ------------------------------------------------------- the three envelopes

test("the three envelopes are mutually exclusive and classify themselves", () => {
  assert.equal(classify(notImplemented("analyzeImage")), "unimplemented");
  assert.equal(classify(mockMarked({ tags: [] }, "curated seed table")), "mock");
  assert.equal(classify(real({ tags: [] }, "v0 math")), "real");

  // The flags, stated individually so a change to any one of them fails here.
  const ni = notImplemented("analyzeImage");
  assert.equal(ni.ok, false);
  assert.equal(ni.implemented, false);

  const mk = mockMarked({ tags: [] }, "curated seed table");
  assert.equal(mk.ok, true);
  assert.equal(mk.mock, true);

  const rl = real({ tags: [] }, "v0 math");
  assert.equal(rl.ok, true);
  assert.equal(rl.mock, false);
});

test("each envelope carries exactly the keys consumers are promised", () => {
  // Pinned as sets: a new key appearing silently is how an envelope starts
  // meaning something different to two different readers.
  assert.deepEqual(
    Object.keys(notImplemented("f", "h")).sort(),
    ["feature", "hint", "implemented", "ok"],
  );
  assert.deepEqual(
    Object.keys(mockMarked({ a: 1 }, "n")).sort(),
    ["data", "mock", "note", "ok"],
  );
  assert.deepEqual(
    Object.keys(real({ a: 1 }, "v")).sort(),
    ["data", "mock", "ok", "via"],
  );
});

// ------------------------------------------- the guarantee that has to hold

test("a mock cannot present as real, even when its payload claims to be", () => {
  // The case that matters: a payload that itself looks like a `real` envelope.
  // If `mockMarked` spread its argument instead of nesting it, these keys would
  // overwrite the honesty flags and the mock would read as live intelligence.
  const hostile = { ok: false, mock: false, via: "GPT-5 vision", implemented: true };
  const wrapped = mockMarked(hostile, "curated seed table");

  assert.equal(wrapped.ok, true, "the envelope's own ok wins");
  assert.equal(wrapped.mock, true, "and it is still a mock");
  assert.equal(wrapped.via, undefined, "a mock never acquires provenance");
  assert.equal(wrapped.implemented, undefined, "nor an implemented flag");
  assert.equal(classify(wrapped), "mock");

  // The payload is preserved untouched, one level down, where it cannot be
  // mistaken for the envelope's own claims.
  assert.deepEqual(wrapped.data, hostile);
  assert.equal(wrapped.data.mock, false, "the payload keeps its own fields");
});

test("real results carry provenance and are never marked mock", () => {
  const rl = real([1, 2, 3], "Alpha Learning Bridge relatedItems");
  assert.equal(rl.mock, false);
  assert.equal(rl.via, "Alpha Learning Bridge relatedItems");
  assert.deepEqual(rl.data, [1, 2, 3]);
  // `real` never claims to be a mock, whatever it is handed.
  assert.equal(real({ mock: true }, "v0 math").mock, false);
});

test("an unimplemented capability names itself and says what would fix it", () => {
  const named = notImplemented("productsFromSimilarUsers", "needs lib/taste-graph");
  assert.equal(named.feature, "productsFromSimilarUsers");
  assert.equal(named.hint, "needs lib/taste-graph");

  // Omitting the hint still yields an actionable one rather than an empty
  // string — the point is that a placeholder is never silent about being one.
  const bare = notImplemented("rankByVisualSimilarity");
  assert.equal(bare.feature, "rankByVisualSimilarity");
  assert.equal(bare.hint, "placeholder — wire a real provider/service here");
  assert.ok(bare.hint.length > 0);
});

test("`ok` is the discriminator — testing `.mock` alone misreads a placeholder", () => {
  // The sharp edge in this module. `notImplemented` carries no `mock` key at
  // all, so `.mock` is undefined and therefore falsy — identical to `real`'s
  // `false` under a truthiness test. A consumer writing `if (!env.mock)` would
  // treat an unimplemented capability as live data.
  const ni = notImplemented("analyzeImage");
  assert.equal("mock" in ni, false, "no mock key at all");
  assert.equal(ni.mock, undefined);
  assert.equal(!ni.mock, !real({}, "v0").mock, "the naive check cannot tell them apart");

  // Checking `ok` first does tell them apart, which is why every call site does.
  assert.notEqual(classify(ni), classify(real({}, "v0")));
});

// --------------------------------------------- the contract at every call site

// Source with comments removed. Scanning raw source finds `notImplemented()`
// inside sentences *about* it; two scans during this work did exactly that.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")
  .replace(/([^:])\/\/.*$/gm, "$1");

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const p = dir + "/" + entry;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(entry)) out.push(p);
    }
  })(ROOT + "lib");
  return out;
}

// Top-level arguments of every `name(...)` call, split on balanced parens.
function callArgs(src, name) {
  const calls = [];
  const re = new RegExp("\\b" + name + "\\s*\\(", "g");
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, cur = "";
    const args = [];
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) { args.push(cur); break; }
      }
      if (depth === 1 && c === ",") { args.push(cur); cur = ""; i++; continue; }
      cur += c;
      i++;
    }
    calls.push(args.map((a) => a.trim()).filter((a) => a !== ""));
  }
  return calls;
}

function callSites(name) {
  const found = [];
  for (const file of sourceFiles()) {
    if (file.endsWith("lib/ai/contract.js")) continue;
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("ai/contract")) continue;
    for (const args of callArgs(codeOnly(raw), name)) {
      found.push({ file: file.slice(ROOT.length), args });
    }
  }
  return found;
}

test("every real() in lib/ states where the result came from", () => {
  const sites = callSites("real");
  // Not vacuous: if the scanner ever stops finding call sites, this fails
  // rather than passing with an empty list. (The floor was 10 while the
  // unbuilt facades in lib/recommendations and lib/visual-personalization
  // existed; with them deleted, 8 real sites remain, so the floor is 6.)
  assert.ok(sites.length >= 6, `found ${sites.length} real() call sites`);

  const anonymous = sites.filter((s) => s.args.length < 2);
  assert.deepEqual(anonymous, [],
    "a real() result without a `via` claims live intelligence with no provenance");
});

test("every notImplemented() in lib/ names the capability it is standing in for", () => {
  const sites = callSites("notImplemented");
  // The floor proves the scanner works (it was 25 while the unbuilt job,
  // feed, vision and recommendation facades existed; 18 remain, floor 15).
  assert.ok(sites.length >= 15, `found ${sites.length} notImplemented() call sites`);

  const unnamed = sites.filter((s) => s.args.length < 1);
  assert.deepEqual(unnamed, [], "an unnamed placeholder cannot be acted on");

  // A hint is what makes the placeholder actionable; the default only covers
  // the generic case, so call sites are expected to supply their own.
  const hintless = sites.filter((s) => s.args.length < 2);
  assert.deepEqual(hintless, [], "every placeholder says what would fix it");
});

test("every mockMarked() in lib/ passes the data it is marking", () => {
  const sites = callSites("mockMarked");
  assert.ok(sites.length >= 3, `found ${sites.length} mockMarked() call sites`);
  assert.deepEqual(sites.filter((s) => s.args.length < 1), []);
});

test("the comment stripper removes prose without eating code", () => {
  // Guards the guard. Both halves matter: the first is the failure that
  // actually happened twice, the second is the over-correction that would make
  // every scan above pass vacuously.
  const sample = [
    "// those functions return an honest notImplemented() until then.",
    "/* block: real(x) mentioned in prose */",
    'const url = "https://example.com/a";',
    'return real(value, "v0 math");',
  ].join("\n");
  const stripped = codeOnly(sample);

  assert.equal(callArgs(stripped, "notImplemented").length, 0, "prose call is gone");
  assert.equal(callArgs(stripped, "real").length, 1, "the genuine call survives");
  assert.deepEqual(callArgs(stripped, "real")[0], ["value", '"v0 math"']);
});
