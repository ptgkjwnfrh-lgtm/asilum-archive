// tests/prompt-overlay.test.js — audit finding #9, verified in
// docs/history/audit-verified-2026-08-14.md.
//
// /?q=<prompt> is the search hand-off, and app/page.js tells the user exactly
// what it means: "Asterisk is routing this edit toward X without rewriting your
// Passport". Both halves of that sentence were false, in opposite directions:
//
//   a user WITH taste — q was read, clamped to 400 chars, and then never used
//                       by anything. No routing happened at all.
//   a COLD user       — q was seeded through coldStart into `profile`, which is
//                       the object /api/feed persists. The Passport rewrite the
//                       notice disclaims is the one thing it did.
//
// A prompt is now an ephemeral overlay on one serve, exactly like a craving:
// read by the ranker, stored by nothing. /api/train stays the only path that
// persists a prompt, on the user's explicit action.
//
// The route itself cannot be invoked here (next/server does not resolve outside
// the bundler), so the ranking claims are made against buildFeed with the exact
// arguments the route now passes, and the persistence claim is pinned
// structurally at the bottom.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFeed, coldStart, overlayVector, promptVector } from "../lib/brain/index.js";
import { vecSim } from "../lib/brain/bridges.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = "minimal tailored black";
const order = (result) => result.items.map((item) => item.id);

// ---- reading a prompt -------------------------------------------------------

test("P1 promptVector reads an evidenced prompt and stays empty on gibberish", () => {
  const vec = promptVector(PROMPT);
  assert.ok(Object.keys(vec).length > 0, "an evidenced prompt must produce tags");
  assert.ok(Object.values(vec).every((w) => w > 0),
    "audit #4: zero-valued keys must never survive — they read as a real profile forever");
  assert.deepEqual(promptVector("zzxq wqph vvmm"), {},
    "a prompt the lexicon cannot read is an honest empty vector");
  assert.deepEqual(promptVector(""), {});
});

test("P2 coldStart still returns exactly what promptVector reads", () => {
  // The tokenizer was lifted out of coldStart so the feed and /api/train cannot
  // come to disagree about what a prompt says. Pin that it was a lift, not a
  // rewrite — /api/train's persisted profile must be unchanged by this.
  assert.deepEqual(coldStart(PROMPT).profile, promptVector(PROMPT));
  assert.deepEqual(coldStart("zzxq wqph").profile, promptVector("zzxq wqph"));
});

// ---- combining overlays -----------------------------------------------------

test("P3 overlayVector averages two overlays and passes one through", () => {
  const a = { MINIMAL: 1, TAILORED: 0.5 };
  const b = { MINIMAL: 0.5, STREETWEAR: 1 };
  assert.equal(overlayVector(a, null), a, "a single overlay is used as-is");
  assert.equal(overlayVector(null, a), a);
  assert.deepEqual(overlayVector(a, b), {
    MINIMAL: 0.75, TAILORED: 0.25, STREETWEAR: 0.5,
  }, "a craving and a prompt are both ephemeral — neither outranks the other");
});

test("P4 no context at all is null, not an empty object", () => {
  // buildFeed reads null as "rank on stored taste alone"; an empty object would
  // take the overlay branch and blend the taste vector with nothing.
  assert.equal(overlayVector(null, null), null);
  assert.equal(overlayVector({}, null), null);
  assert.equal(overlayVector(), null);
});

// ---- the ranking claims -----------------------------------------------------

const COLD = { long: {}, session: {}, _meta: {} };
const WARM = {
  long: { STREETWEAR: 0.8, UTILITARIAN: 0.5 },
  session: { STREETWEAR: 0.4 },
  _meta: {},
};

test("P5 a cold user's prompt still routes the feed — the overlay replaces the seed", () => {
  // Removing the write must not cost the cold user their routing. Measured as
  // how well the served page matches the prompt, because the two paths are NOT
  // byte-identical and should not be: tasteVector damps a stored profile by
  // TASTE_LONG on the way out, so the old seed arrived pre-aged, while a
  // current prompt arrives at full weight. Same direction, undamped.
  const promptVec = promptVector(PROMPT);
  // (6 Sep) a chunk's catalog lane is the listing in cursor order — taste-free
  // by law (lib/brain/chunk.js), so no prompt can or should route it. The
  // routing claim is made over the slots the prompt is allowed to route.
  const routed = (result) => result.items.filter((it) => it._zone !== "catalog");
  const alignment = (result) =>
    routed(result).reduce((sum, it) => sum + vecSim(it.tags || {}, promptVec), 0) /
    routed(result).length;

  const unprompted = buildFeed({ profile: COLD }, CATALOG);        // no routing
  const seeded = buildFeed({ profile: coldStart(PROMPT).profile }, CATALOG); // old
  const overlaid = buildFeed({ profile: COLD, contextVec: promptVec }, CATALOG); // new

  assert.ok(overlaid.items.length > 0, "an empty feed would pass this vacuously");
  // The unprompted baseline used to be the listing HEAD (a cold slate tied on
  // every score and fell through to pool order — mostly outerwear, alignment
  // ~0.2), which made 2x an artefact of that order rather than a law. Ties now
  // break on an id hash (bridges.js), so the baseline is a fair sample of the
  // catalog (~0.33) and the prompt's page sits at ~0.59: routed, by half again.
  assert.ok(alignment(overlaid) > alignment(unprompted) * 1.5,
    `the prompt must dominate the page (${alignment(overlaid).toFixed(3)} vs ${alignment(unprompted).toFixed(3)} unprompted)`);
  assert.ok(alignment(overlaid) >= alignment(seeded) * 0.9,
    `and must not rank worse than the seed it replaced (${alignment(overlaid).toFixed(3)} vs ${alignment(seeded).toFixed(3)})`);

  const seededIds = new Set(order(seeded));
  const shared = order(overlaid).filter((id) => seededIds.has(id)).length;
  assert.ok(shared >= order(overlaid).length * 0.75,
    `the same page, not merely a comparable one (${shared}/${order(overlaid).length} shared)`);
});

test("P6 a user WITH taste finally gets routed — the half that did nothing", () => {
  // This is the failure the notice lied about most directly: for anyone with
  // taste signal, q reached the route and changed nothing.
  const withoutPrompt = buildFeed({ profile: WARM }, CATALOG);
  const withPrompt = buildFeed(
    { profile: WARM, contextVec: promptVector(PROMPT) }, CATALOG);

  assert.notDeepEqual(order(withPrompt), order(withoutPrompt),
    "a prompt must actually steer a user who already has taste");
});

test("P7 the overlay steers WITHOUT erasing stored taste", () => {
  // "Routing this edit" is not "becoming a different person". buildFeed keeps a
  // thread of stable taste at 0.4; a prompt that wiped the profile would be a
  // Passport rewrite by another route.
  const streetwearOnly = buildFeed({ profile: WARM }, CATALOG);
  const withPrompt = buildFeed(
    { profile: WARM, contextVec: promptVector(PROMPT) }, CATALOG);
  const pure = buildFeed({ profile: COLD, contextVec: promptVector(PROMPT) }, CATALOG);

  assert.notDeepEqual(order(withPrompt), order(pure),
    "a warm user's prompt result must differ from a cold user's — their taste still counts");
  assert.ok(order(streetwearOnly).length && order(pure).length);
});

test("P8 building a feed with a prompt overlay mutates no profile", () => {
  const profile = structuredClone(WARM);
  buildFeed({ profile, contextVec: promptVector(PROMPT) }, CATALOG);
  assert.deepEqual(profile, WARM,
    "the overlay is ephemeral — nothing about the prompt may land on the profile");
});

// ---- the persistence guard --------------------------------------------------

// coldStart's output is DURABLE: /api/train writes it to the user's profile on
// an explicit "train the brain" action. The bug was a second, silent caller.
// Any new importer has to be a deliberate decision, so it fails here first.
const COLDSTART_IMPORTERS = [
  "app/api/train/route.js",   // explicit user action — the legitimate writer
  "lib/ingest/inferTags.js",  // tags an ITEM's own text, touches no user profile
];

const SEARCH_DIRS = ["app", "lib"];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry)) out.push(full);
    }
  };
  for (const dir of SEARCH_DIRS) walk(path.join(ROOT, dir));
  return out;
}

// The comments above quote coldStart on purpose — only code counts.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("P9 only the explicit training path imports coldStart", () => {
  const importers = sourceFiles()
    .filter((file) => {
      const code = stripComments(readFileSync(file, "utf8"));
      return /\bcoldStart\b/.test(code) && !file.endsWith(path.join("brain", "index.js"));
    })
    .map((file) => path.relative(ROOT, file))
    .sort();
  assert.deepEqual(importers, [...COLDSTART_IMPORTERS].sort(),
    "coldStart's profile gets PERSISTED — a new caller must justify writing a prompt to a Passport");
});

test("P10 the feed reads a prompt as context and never as a profile", () => {
  const code = stripComments(
    readFileSync(path.join(ROOT, "app/api/feed/route.js"), "utf8"));
  assert.ok(code.includes("promptVector("),
    "the feed must read ?q= — it was clamped and dropped before");
  assert.ok(/contextVec\s*=\s*overlayVector\(/.test(code),
    "and it must arrive as ephemeral context, alongside the craving");
  assert.ok(!/profile\s*=\s*coldStart\(/.test(code),
    "the prompt must never be assigned to the profile the route persists");
});
