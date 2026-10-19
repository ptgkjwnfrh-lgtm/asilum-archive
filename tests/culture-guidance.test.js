// tests/culture-guidance.test.js — Culture guidance in search: era anchors
// fold plurals and participles, match whole words outside the brand, and
// culture summaries route to the right entities.

import test from "node:test";
import assert from "node:assert/strict";

import { anchorBaseOf, extractEraAnchors, anchorHitCount } from "../lib/search/eraAnchors.js";
import { targetEraInterpretation, orchestrateInterpretation } from "../lib/asterisk/orchestrator.js";
import { buildVocabulary, suggest } from "../lib/search/suggest.js";
import { cultureSuggestView, CULTURE } from "../lib/asterisk/culture.js";
import { DEFAULT_MAPPINGS } from "../lib/search/mappings-seed.js";
import { TAGS } from "../lib/brain/tags.js";
import { searchProducts, getProductPool } from "../lib/search/index.js";

// The owner's report, Aug 5: "playboi carti" served his old cash-carti
// silhouette under a correct opium-era note, and typing a celebrity produced
// no suggestions at all. These tests pin the mechanism that fixed both.

// ---- era anchors -------------------------------------------------------------

test("anchor folding: plurals, participles, and y-plurals reach their base", () => {
  assert.equal(anchorBaseOf("studs"), "stud");
  assert.equal(anchorBaseOf("studded"), "stud");
  assert.equal(anchorBaseOf("flared"), "flared"); // itself a silhouette anchor
  assert.equal(anchorBaseOf("crosses"), "cross");
  assert.equal(anchorBaseOf("derbies"), "derby");
  assert.equal(anchorBaseOf("menace"), null);     // editorial words never anchor
  assert.equal(anchorBaseOf("studios"), null);    // "Acne Studios" must not anchor
});

test("anchor matching is whole-word and ignores the brand part of a title", () => {
  assert.equal(anchorHitCount("Acne Studios — field jacket", ["stud"]), 0);
  assert.equal(anchorHitCount("Auralee — nylon crossbody", ["cross"]), 0);
  assert.equal(anchorHitCount("Chrome Hearts — leather derby", ["leather", "derby"]), 2);
  assert.equal(anchorHitCount("Saint Laurent — chain necklace", ["chain"]), 1);
});

test("the carti summary yields the opium wardrobe as anchors", () => {
  const carti = CULTURE.find((r) => r.name === "playboi carti").interpretations[0];
  const anchors = extractEraAnchors(carti.summary + " " + carti.label);
  for (const expected of ["leather", "stud", "cross", "chain", "moto", "boot"]) {
    assert.ok(anchors.includes(expected), `missing anchor "${expected}" in [${anchors}]`);
  }
});

// ---- era targeting -----------------------------------------------------------

const YE_INTERPS = () => CULTURE.find((r) => r.name === "kanye west").interpretations;

test("leftover era words reorder that reading first; bare names keep default order", () => {
  const targeted = targetEraInterpretation("kanye west polo era", "kanye west", YE_INTERPS());
  assert.equal(targeted.interpretations[0].id, "ye/polo-era");
  assert.ok(targeted.targeted);
  const bare = targetEraInterpretation("kanye west", "kanye west", YE_INTERPS());
  assert.equal(bare.targeted, null);
  assert.deepEqual(bare.interpretations.map((i) => i.id), YE_INTERPS().map((i) => i.id));
});

test("SEARCH_ERA_TARGETING=0 disables targeting", () => {
  process.env.SEARCH_ERA_TARGETING = "0";
  try {
    const off = targetEraInterpretation("kanye west polo era", "kanye west", YE_INTERPS());
    assert.equal(off.targeted, null);
  } finally {
    delete process.env.SEARCH_ERA_TARGETING;
  }
});

test("era-qualified references resolve through the orchestrator, beating composition", async () => {
  const bowie = await orchestrateInterpretation("david bowie berlin era", null);
  assert.equal(bowie.entity?.name, "david bowie");
  const suggested = await orchestrateInterpretation("kanye west — polo era", null);
  assert.equal(suggested.entity?.name, "kanye west");
  assert.equal(suggested.interpretations[0].id, "ye/polo-era");
});

test("every emitted era string resolves to its own entity with that reading first", async () => {
  // The battery (measure-culture-guidance) sweeps all of them; CI pins a
  // representative slice so a regression fails fast without the full sweep.
  const view = cultureSuggestView().filter((c) => c.eras.length >= 2).slice(0, 12);
  for (const c of view) {
    const e = c.eras[c.eras.length - 1];
    const r = await orchestrateInterpretation(`${c.name} — ${e.label}`, null);
    assert.equal(r.entity?.name, c.name, `"${c.name} — ${e.label}" resolved to ${r.entity?.name ?? "nothing"}`);
    assert.equal(r.interpretations?.[0]?.id, e.id, `"${c.name} — ${e.label}" led with ${r.interpretations?.[0]?.id}`);
  }
});

// ---- suggestions -------------------------------------------------------------

async function cultureVocab() {
  return buildVocabulary(await getProductPool(), DEFAULT_MAPPINGS, TAGS, cultureSuggestView());
}

test("cultural entities suggest: names, canonical aliases, era strings", async () => {
  const vocab = await cultureVocab();
  const labels = (q) => suggest(q, vocab).map((s) => s.label);
  assert.ok(labels("playboi").includes("playboi carti"));
  assert.ok(labels("king vamp").includes("playboi carti"));
  const kanye = labels("kanye");
  assert.ok(kanye.includes("kanye west"));
  assert.ok(kanye.some((l) => l.startsWith("kanye west — ")));
});

test("two typed characters never surface culture through hidden aliases", async () => {
  const vocab = await cultureVocab();
  const plain = buildVocabulary(await getProductPool(), DEFAULT_MAPPINGS, TAGS, []);
  const top3 = (v) => suggest("ho", v).slice(0, 3).map((s) => s.label).join("|");
  assert.equal(top3(vocab), top3(plain));
  // ...but an exactly-typed alias is the user asking for it.
  const hov = suggest("hov", vocab).map((s) => s.label);
  assert.ok(hov.includes("jay-z"), `expected jay-z for exact alias, got [${hov}]`);
});

test("garment and designer suggestions are unchanged by the culture vocabulary", async () => {
  const withCulture = await cultureVocab();
  const without = buildVocabulary(await getProductPool(), DEFAULT_MAPPINGS, TAGS, []);
  for (const q of ["hoodie", "rick ow", "balenciga", "leather"]) {
    const before = suggest(q, without).map((s) => s.label);
    const after = new Set(suggest(q, withCulture).map((s) => s.label));
    for (const l of before) assert.ok(after.has(l), `"${q}" lost "${l}"`);
  }
});

// ---- the rack itself ---------------------------------------------------------

test("the carti rack leads with the opium wardrobe, not the cash-carti silhouette", async () => {
  const r = await searchProducts("playboi carti", { userId: null, brain: false });
  const titles = r.results.slice(0, 8).map((i) => i.title);
  const carti = CULTURE.find((x) => x.name === "playboi carti").interpretations[0];
  const anchors = extractEraAnchors(carti.summary + " " + carti.label);
  const anchored = titles.filter((t) => anchorHitCount(t, anchors) > 0).length;
  assert.ok(anchored >= 4, `only ${anchored}/8 anchored titles: ${titles.join(" | ")}`);
  for (const t of titles.slice(0, 5)) {
    const low = t.toLowerCase();
    assert.ok(!low.includes("boxy tee") && !low.includes("oversized shirt"),
      `cash-carti silhouette in top 5: ${t}`);
  }
  // Inclusion contract (r10): every rack item still carries an exact slate tag.
  const slate = new Set(carti.tags.map((t) => t.toUpperCase()));
  for (const it of r.results.slice(0, 8)) {
    assert.ok(Object.keys(it.tags || {}).some((t) => slate.has(t.toUpperCase())),
      `rack item without a slate tag: ${it.title}`);
  }
});

test("SEARCH_ERA_ANCHORS=0 restores the pre-anchor ordering", async () => {
  process.env.SEARCH_ERA_ANCHORS = "0";
  try {
    const r = await searchProducts("playboi carti", { userId: null, brain: false });
    const carti = CULTURE.find((x) => x.name === "playboi carti").interpretations[0];
    const anchors = extractEraAnchors(carti.summary + " " + carti.label);
    const anchored = r.results.slice(0, 8).map((i) => i.title)
      .filter((t) => anchorHitCount(t, anchors) > 0).length;
    assert.ok(anchored <= 2, `kill switch inert: ${anchored}/8 titles still anchored`);
  } finally {
    delete process.env.SEARCH_ERA_ANCHORS;
  }
});
