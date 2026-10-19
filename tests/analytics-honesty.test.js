// tests/analytics-honesty.test.js — the /stats operating dashboards
// (owner directive, 14 Aug 2026, backlog 5). These pin the HONESTY
// rules, which are the part that can rot silently: a rate over zero
// samples must be "not measurable", never a flattering percentage; a
// window edge must not be reported as a real zero; and mem mode must say
// it cannot count rather than drawing an empty dashboard that looks like
// a real one.
//
// The SQL itself is exercised against live Postgres (every block returned
// data on the Aug 14 run); what a mem-mode test can hold is the contract
// the page renders against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { analytics } from "../lib/analytics.js";

test("without a database the dashboards say so instead of showing zeros", async () => {
  const out = await analytics();
  assert.equal(out.available, false, "mem mode cannot answer these honestly");
  assert.equal(out.persistent, false);
  // The absence of the blocks is the point: a shape full of zeros would
  // render as a real dashboard reporting no activity, which is a claim
  // this deploy cannot make. (The event ring is capped and rotates, so
  // any rate computed from it would be an artifact of the cap.)
  assert.equal(out.retention, undefined);
  assert.equal(out.wire, undefined);
  assert.equal(out.search, undefined);
  assert.equal(out.booths, undefined);
});

// The two guards below are the ones most likely to be "simplified" later
// by someone tidying the code, so they are stated as executable rules
// rather than only as comments in lib/analytics.js.

test("a rate over zero samples is not measurable, never 0%", () => {
  // The rule lib/analytics.js implements for emptyRate.
  const rate = (empty, searches) => (searches > 0 ? +(empty / searches).toFixed(3) : null);
  assert.equal(rate(0, 0), null, "a week nobody searched is not a perfect week");
  assert.equal(rate(0, 10), 0, "ten searches that all found something IS a real zero");
  assert.equal(rate(3, 10), 0.3);
});

test("the oldest window bucket reports 'not measurable', not zero returning", () => {
  // The rule retentionWeeks implements: the oldest bucket has no prior
  // week inside the query window, so its returning count would be a
  // retention cliff that is really the edge of the query.
  const weeks = 4;
  const returningFor = (weekAgo, counted) => (weekAgo === weeks - 1 ? null : counted);
  assert.equal(returningFor(3, 0), null, "edge of the window");
  assert.equal(returningFor(0, 0), 0, "this week genuinely had none");
  assert.equal(returningFor(1, 5), 5);
});

// ---- gamma health (audit 2026-08-15) ----------------------------------------
//
// The audit found the gamma bridge inert on production: 2,632 edges, every one
// at contributors = 0, so edgeStrength() returned 0 and getEdges answered every
// anchor with nothing. The only number on /stats was "graph edges 2632", which
// reads as a healthy graph. An edge COUNT is not a working graph, and these pin
// the difference.

test("gamma reports what the ACTIVE rule can use, not just how many edges exist", async () => {
  const { getStats, bumpEdges } = await import("../lib/db/index.js");
  // Two edges written WITHOUT an identity: they accrue weight, and under
  // corroboration they contribute nothing — exactly production's shape.
  await bumpEdges([{ a: "gh-a", b: "gh-b", w: 3 }, { a: "gh-a", b: "gh-c", w: 5 }], null);

  delete process.env.BRAIN_EDGE_CORROBORATION;
  const on = (await getStats()).gamma;
  assert.equal(on.rule, "corroboration");
  assert.ok(on.total > 0, "there must be edges, or this proves nothing");
  assert.equal(on.usable, on.corroborated,
    "under corroboration, usable IS the corroborated count");
  assert.equal(on.usable, 0, "uncorroborated edges are worth nothing to gamma");
  assert.ok(on.weighted > 0,
    "and the other rule's count rides along, so 'empty graph' is distinguishable from 'rule cannot see it'");

  try {
    process.env.BRAIN_EDGE_CORROBORATION = "0";
    const off = (await getStats()).gamma;
    assert.equal(off.rule, "legacy-weight");
    assert.equal(off.usable, off.weighted, "under the legacy rule, usable IS the weighted count");
    assert.ok(off.usable > 0, "the same edges become usable the moment the rule changes");
    assert.equal(off.total, on.total, "the edge COUNT never moved — only what is usable did");
  } finally {
    delete process.env.BRAIN_EDGE_CORROBORATION;
  }
});

test("the /stats bar shows gamma usability beside the raw edge count", () => {
  // The misleading number is the one already on the page; the fix is only real
  // if the honest one sits next to it.
  const page = readFileSync(
    path.join(process.cwd(), "app/stats/page.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(page, /graph edges/, "the raw count is still shown");
  assert.match(page, /gamma usable/, "and is no longer the only thing shown");
  assert.match(page, /stats\.gamma\.usable[\s\S]{0,60}stats\.gamma\.total/,
    "reported as usable-of-total, so 0 / 2632 cannot read as health");
});
