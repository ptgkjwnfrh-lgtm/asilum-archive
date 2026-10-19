// tests/metric-definitions.test.js — a number the site prints must mean what
// its label says, and must not exist when nothing measures it.
//
// The Aug-17 audit found the same shape of bug the accessibility and SEO queues
// kept finding: a claim the code did not keep. Here the claim is a LABEL. Four
// examples, all live before this file existed:
//
//   * /cover printed "undefined INTERACTIONS · undefined READERS · undefined
//     BOARDS · undefined GRAPH EDGES" one line above its own colophon claim
//     that "EVERY VALUE ON THIS PAGE IS REAL STATE", and told every visitor
//     "STATE — MEMORY MODE" on a deployment running Postgres.
//   * /stylist printed a 75–99 ranking display with a "%" after it.
//   * /stylist printed CURATED, TASTE and MATCH as three differently-labelled
//     copies of one number for model-built looks.
//   * /profile printed "0 FOLLOWERS" for a quantity no code anywhere measures,
//     and counted bag brands under a label sitting beside FOLLOWING.
//
// The authority is docs/history/metric-definitions-2026-08-17.md. These tests are that
// document made executable.
//
// The source-reading tests here are bound (`[^)]*`, `[^<]*`, single lines) on
// purpose — an earlier structural guard in this repo used `[\s\S]*?`, matched an
// unrelated token fifteen lines away, and stayed green under revert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// fileURLToPath, never url.pathname — this repo's directory name contains
// spaces, and a percent-encoded path fails to read.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

import { systemLedger } from "../app/cover/ledger.js";
import { buildSlate } from "../lib/brain/stylist.js";

// ---------------------------------------------------------------- the folio

test("the cover ledger prints nothing when the stats read was refused", () => {
  // The exact body /api/stats returns to a visitor's device cookie since the
  // Aug-16 gating. It is truthy, which is what made the old code interpolate.
  assert.equal(systemLedger({ error: "stats are staff-only" }), "");
  assert.equal(systemLedger({ error: "stats disabled — set ADMIN_TOKEN (16+ chars)" }), "");
  assert.equal(systemLedger(null), "");
  assert.equal(systemLedger(undefined), "");
});

test("the cover ledger prints every counter it was given, in folio order", () => {
  // Positive assertion, not just the absence of "undefined": a guard that only
  // checks for absence still passes if the folio stops printing anything at all.
  const line = systemLedger({ interactions: 12, users: 3, boards: 4, edges: 2632, persistent: true });
  assert.equal(line, "12 INTERACTIONS · 3 READERS · 4 BOARDS · 2632 GRAPH EDGES");
});

test("a counter missing from the payload loses its entry, it does not print undefined", () => {
  const line = systemLedger({ interactions: 12, boards: 4 });
  assert.equal(line, "12 INTERACTIONS · 4 BOARDS");
  assert.ok(!/undefined|null|NaN/.test(line));
  // Zero is a measurement and must survive the filter — this is the one that
  // catches a lazy `if (!value)` rewrite of the finite check.
  assert.equal(systemLedger({ interactions: 0, users: 0, boards: 0, edges: 0 }),
    "0 INTERACTIONS · 0 READERS · 0 BOARDS · 0 GRAPH EDGES");
});

test("the cover checks r.ok before it believes /api/stats", () => {
  const src = read("app/cover/page.js");
  // The .then that consumes the stats response, on one line, bound to it.
  const consume = src.split("\n").find((l) => /\.then\(\(r\) =>[^\n]*r\.ok \? r\.json\(\)/.test(l));
  assert.ok(consume, "the stats read must gate r.json() on r.ok");
  // And it must not ask at all without a token. Measured on production: the
  // unconditional version earned a 401 on every single visit to the landing
  // page — handled, but a wasted round trip and a console error for a question
  // whose answer was already known.
  assert.match(src, /if \(staffToken\) \{\s*\n\s*fetch\("\/api\/stats"/,
    "the stats read must be gated on holding a staff token");
  // And it must not go back to the unguarded shape anywhere in the file.
  assert.ok(!/authorizedFetch\("\/api\/stats"\)/.test(src),
    "the stats read must not use the identity-only fetch that earns 401");
});

test("STATE marginalia is only drawn when the ledger was read", () => {
  const src = read("app/cover/page.js");
  // Bound to the conditional wrapper: `sys &&` must gate the span, and the
  // old "READING" fallback — which outlived its own request — must be gone.
  assert.ok(/\{sys && \(\s*\n\s*<span className="cvside"/.test(src),
    "the STATE span must be conditional on sys");
  assert.ok(!/STATE — \{sys \?/.test(src),
    "STATE must not fall back to a placeholder for a request that already failed");
});

// ---------------------------------------------------------------- MATCH

test("MATCH is printed without a percent sign, and with its scale", () => {
  const src = read("app/stylist/page.js");
  // Bound to the MATCH cell itself — one element, no cross-line reach.
  assert.ok(/MATCH <b className="red">\{o\.conf\}<\/b> <i className="lsscale">of 99<\/i>/.test(src),
    "MATCH must print the bare value and name its scale");
  assert.ok(!/\{o\.conf\}%/.test(src), "conf is not a percentage anywhere on the page");
});

test("CURATED and TASTE keep their percent signs — they really are percentages", () => {
  const src = read("app/stylist/page.js");
  assert.ok(/CURATED <b>\{o\.curated\}%<\/b>/.test(src));
  assert.ok(/TASTE <b>\{o\.tasteStat\}%<\/b>/.test(src));
});

test("a stat with no value is omitted, not printed as null%", () => {
  const src = read("app/stylist/page.js");
  assert.ok(/Number\.isFinite\(o\.curated\) \? <span>CURATED/.test(src));
  assert.ok(/Number\.isFinite\(o\.tasteStat\) \? <span>TASTE/.test(src));
});

test("the model path does not fabricate a coherence or a taste percentage", () => {
  const src = read("app/api/outfits/route.js");
  // The whole point: `curated: conf, tasteStat: conf` printed one number under
  // three labels. Bound to a single line so a comment quoting the old shape
  // cannot satisfy or break this.
  const fabricates = src.split("\n").some((l) =>
    /^\s*curated: conf, tasteStat: conf,\s*$/.test(l));
  assert.ok(!fabricates, "curated/tasteStat must not be copies of conf");
  assert.ok(src.split("\n").some((l) => /^\s*curated: null, tasteStat: null,\s*$/.test(l)),
    "a model look must report no decomposition rather than a duplicated one");
});

// ---------------------------------------------------------------- the engine

// A pool wide enough for buildSlate to fill every slot. Prices and tags are
// deliberately plain — this is about the arithmetic on the way out, not taste.
function pool() {
  const cats = ["outerwear", "tops", "bottoms", "footwear", "accessories"];
  const out = [];
  for (const cat of cats) {
    for (let i = 0; i < 4; i++) {
      out.push({
        id: `${cat}-${i}`, title: `${cat} ${i}`, brand: `B${i}`, category: cat,
        price: 100 + i, tags: { MINIMAL: 0.6, TAILORED: 0.4 },
      });
    }
  }
  return out;
}

test("conf, curated and tasteStat are three different quantities", () => {
  const [look] = buildSlate(pool(), { MINIMAL: 1 }, 1, {});
  assert.ok(look, "the fixture pool must produce a look");
  for (const key of ["conf", "curated", "tasteStat"]) {
    assert.ok(Number.isFinite(look[key]), `${key} must be a number`);
  }
  // curated is mean coherence and tasteStat is mean taste similarity: both are
  // 0–100 percentages of their own quantity, and neither is the 75–99 display.
  assert.ok(look.curated >= 0 && look.curated <= 100);
  assert.ok(look.tasteStat >= 0 && look.tasteStat <= 100);
  assert.notEqual(look.curated, look.conf,
    "if these are ever equal the /stylist stat row is printing one number three times");
});

test("a bad look scores BELOW the floor and is rejected (owner ruling 8, answered)", () => {
  // This test used to assert the OPPOSITE: that conf could never drop under 75,
  // because `Math.max(75, …)` clamped it there and the product's "match floor
  // 75" could not fire. The owner ruled to make the floor real, so the assertion
  // inverts. If it ever goes green in its old form again, the floor is
  // decoration once more.
  const hostile = { MINIMAL: -1, TAILORED: -1 };
  const [worst] = buildSlate(pool(), hostile, 1, {});
  assert.ok(worst, "even a hostile taste vector produces a look");
  assert.ok(worst.conf < 75,
    `a look built against the opposite of the taste vector must fall under the floor, got ${worst.conf}`);
  assert.equal(worst.tasteStat, 0, "taste similarity reports the truth: zero");

  // And a good one still clears it, so the gate is a gate and not a wall.
  const [good] = buildSlate(pool(), { MINIMAL: 1, TAILORED: 0.6 }, 1, {});
  assert.ok(good.conf >= 75, `a well-matched look must ship, got ${good.conf}`);
  assert.ok(good.conf <= 99);
});

test("conf is the composite on 0-99, with no activity bonus", () => {
  // The mapping is linear in the composite and nothing else. It used to gain up
  // to +4 from `min(events, 400) / 100`, which let a weak look buy its way past
  // the floor on how much the reader had browsed — a fact about the person, not
  // about the look.
  const taste = { MINIMAL: 1 };
  const [a] = buildSlate(pool(), taste, 1, {});
  const [b] = buildSlate(pool(), taste, 1, { events: 400 });
  assert.equal(a.conf, b.conf, "browsing history must not move the match score");

  // conf == round(composite x 99), recomputed from the parts the look reports.
  const composite = (a.curated / 100) * 0.55 + Math.max(a.tasteStat / 100, 0) * 0.45;
  assert.equal(a.conf, Math.round(Math.min(99, composite * 99)),
    "conf must be the published blend of curated and taste, scaled to 99");
});

test("the engine's own doc comment names the range it actually produces", () => {
  const src = read("lib/brain/stylist.js");
  // It said 58–99 for long enough that the floor had moved underneath it.
  // The header used to say 58–99 while the clamp produced 75–99; it now
  // describes a 0–99 composite, which is what the code actually computes.
  assert.match(src, /composite quality on a 0–99 scale/);
  assert.ok(!/relative score \(58–99/.test(src));
  assert.ok(!/Math\.max\(75,/.test(src), "no lower clamp may resurrect the inert floor");
});

// ---------------------------------------------------------------- the profile

test("FOLLOWERS is a dash, because nothing anywhere counts followers", () => {
  const src = read("app/profile/page.js");
  // Bound to the counter cell.
  assert.ok(/<b title="ASILUM does not track followers yet">—<\/b> FOLLOWERS/.test(src),
    "FOLLOWERS must print — rather than a measurement of nothing");
  assert.ok(!/\{followers\}<\/b> FOLLOWERS/.test(src));
  assert.ok(!/^\s*const followers = 0;\s*$/m.test(src),
    "the hardcoded zero must be gone, not just hidden");
});

test("BRANDS counts followed brands, which is what its label means", () => {
  const src = read("app/profile/page.js");
  assert.ok(/<b>\{brandFollows\}<\/b> BRANDS/.test(src));
  assert.ok(!/<b>\{brands\.length\}<\/b> BRANDS/.test(src),
    "bag brands are candidates to follow, not brands followed");
  // The count must track the BRANDS tab, which keeps its own local copy — a
  // render-time read went stale the moment a chip was toggled there.
  assert.ok(/addEventListener\("asilum:follow", read\)/.test(src),
    "the header count must refresh on the follow event");
});
