// tests/tag-search.test.js — TAGS ARE QUERIES in the engine and on the
// route (V.2 Blueprint, Tag grammar "Behavior"; slice 4). Laws:
//   * SILVER: JEWELRY returns exactly the pieces that carry the tag;
//   * SILVER: alone returns everything with SILVER on a left side;
//   * DESIGNER: HOUSE keeps its own reading (tests/designer-house.test.js);
//     a one-sided pair miss stays a pair miss; a tag nobody carries and
//     nobody can read as a pair is read as words, with the miss said first;
//   * a pinned tag is a filter, never a score, and each pin is said;
//   * the route carries the pins and the reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchProducts } from "../lib/search/index.js";
import { tagsFor, itemHasTag, parseTagQuery, formatTag } from "../lib/tagging/grammar.js";
import { callRoute, loadRoute } from "./helpers/route.js";

const run = (q, o = {}) => searchProducts(q, { limit: 96, log: false, ...o });

test("SUPREME: BOMBER JACKET returns exactly the pieces that carry the tag, and the reading says the count", async () => {
  const r = await run("supreme: bomber jacket");
  assert.ok(r.total >= 1);
  for (const it of r.results) assert.ok(itemHasTag(it, parseTagQuery("supreme: bomber jacket")), it.title);
  assert.equal(r.interpreted.intent, "tag");
  assert.deepEqual(r.interpreted.tag, { text: "SUPREME: BOMBER JACKET", left: "SUPREME", right: "BOMBER JACKET", count: r.total, served: true });
  assert.equal(r.interpreted.pair, null, "a tag is not a pair");
  assert.match(r.note, /SUPREME: BOMBER JACKET — \d+ piece/);
  assert.ok(r.results.every((it) => tagsFor(it).some((t) => formatTag(t) === "SUPREME: BOMBER JACKET")));
});

test("SUPREME: alone returns everything Supreme and nothing else; the spelling note stays quiet", async () => {
  const r = await run("supreme:");
  const plain = await run("supreme");
  assert.equal(r.total, plain.total, "the left side alone is the house's whole rack");
  assert.ok(r.results.every((it) => /^supreme$/i.test(it.brand)));
  assert.equal(r.interpreted.tag.right, null);
  assert.ok(!/reading "supreme:"/.test(r.note), r.note);
});

test("the full set is searched, visible or not: an aesthetic behind the product still answers its tag", async () => {
  const r = await run("streetwear: bomber jacket");
  assert.ok(r.total >= 1);
  for (const it of r.results) assert.ok(tagsFor(it).some((t) => formatTag(t) === "STREETWEAR: BOMBER JACKET"), it.title);
});

test("a tag whose left side exists but whose right does not is an honest miss with the left count; a pair miss stays a pair miss", async () => {
  const miss = await run("supreme: cassette");
  assert.equal(miss.total, 0);
  assert.match(miss.note, /nothing here is tagged SUPREME: CASSETTE — \d+ pieces carry SUPREME:/);
  assert.equal(miss.interpreted.tag.served, false);
  const pair = await run("nobody: gucci");
  assert.equal(pair.interpreted.pair.miss, "designer");
  assert.equal(pair.interpreted.tag, null);
  assert.equal(pair.total, 0);
});

test("a tag nobody carries and nobody can read as a pair is read as words, the miss said first", async () => {
  const r = await run("silver: jewelry");
  assert.match(r.note, /^nothing here is tagged SILVER: JEWELRY — reading the words instead/);
  assert.equal(r.interpreted.tag.readAsWords, true);
  assert.equal(r.interpreted.pair, null);
  assert.notEqual(r.interpreted.intent, "designer-house");
  const era = await run("fw15: varsity jacket");
  assert.ok(era.total >= 1, "the words still read: an era and a garment");
  assert.ok(era.results.every((it) => it.era && it.era.year === 2015));
});

test("DESIGNER: HOUSE keeps its own reading when both sides resolve", async () => {
  const r = await run("hedi slimane: celine");
  assert.equal(r.interpreted.pair.served, true);
  assert.equal(r.interpreted.tag, null);
  assert.ok(r.total >= 1);
});

test("a pinned tag is a filter, never a score; each pin is said; an empty pin is said as empty", async () => {
  const base = await run("jacket");
  const pinned = await run("jacket", { tagFilters: [parseTagQuery("supreme:")] });
  assert.ok(pinned.total > 0 && pinned.total < base.total);
  assert.ok(pinned.results.every((it) => /^supreme$/i.test(it.brand)));
  assert.match(pinned.note, /pinned SUPREME: — \d+ of \d+ pieces carry it/);
  assert.deepEqual(pinned.interpreted.pins, [{ text: "SUPREME:", count: pinned.interpreted.pins[0].count }]);
  const none = await run("jacket", { tagFilters: [parseTagQuery("supreme: cassette")] });
  assert.equal(none.total, 0);
  assert.match(none.note, /pinned SUPREME: CASSETTE — nothing here carries it/);
  const two = await run("derby", { tagFilters: [parseTagQuery("leather:"), parseTagQuery("salomon:")] });
  assert.ok(two.total >= 1, "Salomon's leather derby");
  assert.ok(two.results.every((it) => /^salomon$/i.test(it.brand) && /leather/i.test(it.title)));
  assert.equal(two.interpreted.pins.length, 2);
});

test("/api/discover carries the tag reading and the pins", async () => {
  const route = await loadRoute("app/api/discover/route.js");
  const tagged = await callRoute(route.GET, { path: "/api/discover", query: { q: "supreme: bomber jacket", limit: "12" } });
  assert.equal(tagged.status, 200);
  assert.ok(tagged.body.items.length >= 1);
  assert.equal(tagged.body.interpreted.tag.text, "SUPREME: BOMBER JACKET");
  assert.match(tagged.body.note, /SUPREME: BOMBER JACKET — \d+ piece/);
  const pinned = await callRoute(route.GET, { path: "/api/discover", query: { q: "jacket", pins: "supreme:|streetwear:", limit: "12" } });
  assert.equal(pinned.status, 200);
  assert.deepEqual(pinned.body.interpreted.pins.map((p) => p.text), ["SUPREME:", "STREETWEAR:"]);
  assert.ok(pinned.body.items.length >= 1 && pinned.body.items.every((it) => /^supreme$/i.test(it.brand)));
  const junk = await callRoute(route.GET, { path: "/api/discover", query: { q: "jacket", pins: "a:b:c|:", limit: "12" } });
  assert.equal(junk.status, 200);
  assert.deepEqual(junk.body.interpreted.pins, [], "a malformed pin is dropped, not applied");
});
