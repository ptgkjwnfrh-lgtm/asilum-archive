// DESIGNER: HOUSE and the career registry (19 Sep 2026, docs/v2/CONTRACTS.md
// § Contract acceptance cases).
//
// Law 1: TOM FORD: GUCCI resolves both entities and cannot return unrelated
//        Gucci or unrelated Tom Ford stock.
// Law 2: a designer's verified house stays listed at zero inventory; a
//        house's designers sort by dated relationships, not item counts.
// Law 3: no sourced record is said as no sourced record; a miss is a miss.
// Law 4: every registry claim resolves to a source; unknown dates stay null.
import test from "node:test";
import assert from "node:assert/strict";
import { searchProducts } from "../lib/search/index.js";
import { CATALOG } from "../lib/ingest/catalog.js";
import {
  careerOf, designersOf, careerEdges, entityDto, edgeDto, findCareerEntity, registryCoverage,
  compareEdges, dateKey, formatCareerDate, tenurePhrase, CAREER_PROVENANCE, CAREER_UNSOURCED,
} from "../lib/people/careers.js";
import { parseDesignerHousePair, resolveDesignerHousePair, applyDesignerHousePair, pairNote } from "../lib/search/pair.js";
import { resolveOverviewForQuery } from "../lib/people/resolve.js";
import { callRoute, loadRoute } from "./helpers/route.js";

const brands = [...new Set(CATALOG.map((it) => it.brand).filter(Boolean))];

test("law 4: the registry is whole — every edge and claim names a source, dates parse, unknown stays null", () => {
  const cov = registryCoverage();
  assert.ok(cov.edges >= 40, `edges ${cov.edges}`);
  assert.ok(cov.sources >= 60);
  assert.ok(cov.fetchedSources >= 4, "at least the official press pages were read");
  assert.equal(cov.vogueSources, 0, "the Vogue gap is recorded, not hidden");
  assert.match(CAREER_PROVENANCE.vogueCoverage, /OPEN/);
  for (const id of ["tom-ford", "hedi-slimane", "gucci", "saint-laurent", "dior", "celine", "tom-ford-house"]) {
    const dto = entityDto(id);
    assert.ok(dto, id);
    assert.ok(dto.overview?.summary?.text.length > 20, `${id} has a summary`);
    assert.ok(dto.overview.summary.sourceIds.length >= 1);
    assert.ok(dto.sources.length >= 1);
    for (const s of dto.sources) assert.match(s.url, /^https:\/\//);
    for (const f of dto.facts) assert.ok(f.claim.sourceIds.length >= 1, `${id} fact ${f.key} sourced`);
  }
  assert.equal(entityDto("valentino").overview, null, "a reference-only house has no overview to claim");
  for (const e of careerOf("yves-saint-laurent")) {
    if (e.houseId === "dior") assert.equal(e.end, null, "an unknown end stays null");
  }
  assert.ok(CAREER_UNSOURCED.some((u) => u.designerId === "yves-saint-laurent"));
  assert.equal(dateKey("2016-04-04"), 20160404);
  assert.equal(dateKey("1994"), 19940101);
  assert.equal(dateKey(null), null);
  assert.equal(formatCareerDate("2018-01-21"), "21 Jan 2018");
  assert.equal(formatCareerDate("2024-10"), "Oct 2024");
  assert.equal(formatCareerDate("1994"), "1994");
});

test("law 4: a founder and the house that carries the name are two entities", () => {
  assert.equal(findCareerEntity("tom ford").kind, "designer");
  assert.equal(findCareerEntity("tom ford", "house").id, "tom-ford-house");
  assert.notEqual(findCareerEntity("tom ford").id, findCareerEntity("tom ford", "house").id);
  assert.equal(findCareerEntity("ysl").id, "saint-laurent");
  assert.equal(findCareerEntity("céline").id, "celine");
  assert.equal(findCareerEntity("nobody at all"), null);
});

test("law 2: a house's designers sort by dated start, not by stock; a zero-stock tenure stays listed", () => {
  const gucci = designersOf("gucci");
  const order = gucci.map((e) => e.designerId);
  assert.deepEqual([...new Set(order)], ["tom-ford", "frida-giannini", "alessandro-michele", "sabato-de-sarno", "demna"]);
  const keys = gucci.map((e) => dateKey(e.start));
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] >= keys[i - 1], "ascending start");
  const dtos = gucci.map((e) => edgeDto(e, { matchingItemCount: applyDesignerHousePair(CATALOG,
    resolveDesignerHousePair({ left: e.designerId.replace(/-/g, " "), right: "gucci" }, { brands, pool: CATALOG })).length }));
  const tomFord = dtos.find((d) => d.designerId === "tom-ford");
  assert.equal(tomFord.matchingItemCount, 0, "Tom Ford at Gucci: verified tenure, zero stock — still listed");
  assert.equal(tomFord.queryText, "TOM FORD: GUCCI");
  assert.equal(tomFord.sourceCatalog[0].publisher, "Business of Fashion");
  const deSarno = dtos.find((d) => d.designerId === "sabato-de-sarno");
  assert.equal(deSarno.matchingItemCount, 13);
  assert.ok(dtos.indexOf(tomFord) < dtos.indexOf(deSarno), "the count did not reorder the chronology");
  // unknown starts sort last, deterministically
  const sorted = [{ id: "b", start: null }, { id: "a", start: "2001" }, { id: "c", start: null }].sort(compareEdges);
  assert.deepEqual(sorted.map((e) => e.id), ["a", "b", "c"]);
});

test("law 2: a designer's career lists every verified house, overlapping roles both kept", () => {
  const ford = careerOf("tom-ford").map((e) => [e.houseId, e.start, e.end]);
  assert.deepEqual(ford, [["gucci", "1994", "2004"], ["saint-laurent", "2000-01", "2004"], ["tom-ford-house", "2005", "2023"]]);
  assert.equal(careerEdges("hedi-slimane", "saint-laurent").length, 2, "two tenures at one house are two edges");
  assert.match(tenurePhrase(careerEdges("hedi-slimane", "celine")[0]), /21 Jan 2018–Oct 2024/);
  assert.match(tenurePhrase(careerEdges("haider-ackermann", "tom-ford-house")[0]), /since 4 Sep 2024/);
});

test("law 1: the pair parses on the colon only, and resolves both sides to canonical ids", () => {
  assert.deepEqual(parseDesignerHousePair("TOM FORD : GUCCI"), { left: "tom ford", right: "gucci" });
  assert.equal(parseDesignerHousePair("tom ford gucci"), null);
  assert.equal(parseDesignerHousePair("a: b: c"), null);
  assert.equal(parseDesignerHousePair(": gucci"), null);
  const r = resolveDesignerHousePair(parseDesignerHousePair("tom ford: gucci"), { brands, pool: CATALOG });
  assert.equal(r.designer.id, "tom-ford");
  assert.equal(r.house.id, "gucci");
  assert.deepEqual(r.house.brands, ["Gucci"]);
  assert.equal(r.verified, true);
  // the intersection is empty: every Gucci piece here credits Sabato De Sarno
  assert.equal(applyDesignerHousePair(CATALOG, r).length, 0);
  assert.match(pairNote(r, 0), /Tom Ford at Gucci: creative director, 1994–2004 \(sourced\) — no piece here carries that credit/);
  // the reverse order is the same question
  const rev = resolveDesignerHousePair(parseDesignerHousePair("gucci: tom ford"), { brands, pool: CATALOG });
  assert.equal(rev.designer.id, "tom-ford");
  assert.equal(rev.house.id, "gucci");
  // a house is not a person even though the catalog writes it into designers[]
  const gg = resolveDesignerHousePair(parseDesignerHousePair("gucci: gucci"), { brands, pool: CATALOG });
  assert.equal(gg.miss, "designer");
});

test("law 1: TOM FORD: GUCCI serves NOTHING unrelated — no Gucci rack, no Tom Ford rack", async () => {
  const r = await searchProducts("tom ford: gucci", { limit: 48, log: false });
  assert.equal(r.results.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.interpreted.intent, "designer-house");
  assert.equal(r.interpreted.pair.designerId, "tom-ford");
  assert.equal(r.interpreted.pair.houseId, "gucci");
  assert.equal(r.interpreted.pair.verified, true);
  assert.match(r.note, /Tom Ford at Gucci: creative director, 1994–2004 \(sourced\)/);
  assert.doesNotMatch(r.note, /nothing here matches "tom ford: gucci"/, "the pair is not explained as a list of words");
  assert.equal(r.cultural?.engaged, false, "the cultural tier does not widen a pair");
});

test("law 1: HEDI SLIMANE: CELINE serves exactly the credited intersection, personalisation inside it", async () => {
  const r = await searchProducts("hedi slimane: celine", { limit: 48, log: false });
  assert.equal(r.total, 7);
  assert.ok(r.results.every((it) => it.brand === "Celine"), "every piece is the house");
  assert.ok(r.results.every((it) => (it.designers || []).includes("Hedi Slimane")), "every piece carries the credit");
  assert.match(r.note, /7 pieces here carry that credit/);
  const dior = await searchProducts("kim jones: dior", { limit: 48, log: false });
  assert.equal(dior.total, 20, "the registry house Dior reaches the catalog brand Dior Men");
  assert.ok(dior.results.every((it) => it.brand === "Dior Men"));
  const ysl = await searchProducts("hedi slimane: saint laurent", { limit: 48, log: false });
  assert.equal(ysl.total, 0, "a verified tenure whose stock credits someone else is an honest empty rack");
  assert.match(ysl.note, /Hedi Slimane at Saint Laurent: .*\(sourced\) — no piece here carries that credit/);
});

test("law 3: no sourced record and a miss are said as what they are, and never widen", async () => {
  const prada = await searchProducts("tom ford: prada", { limit: 48, log: false });
  assert.equal(prada.total, 0);
  assert.equal(prada.interpreted.pair.verified, false);
  assert.match(prada.note, /no sourced record of that appointment/);
  const miss = await searchProducts("nobody: gucci", { limit: 48, log: false });
  assert.equal(miss.interpreted.pair.miss, "designer");
  assert.match(miss.note, /could not read "nobody" as a designer/);
  assert.equal(miss.total, 0, "one half is not served as the whole");
  // an ordinary house query is untouched by the pair reader
  const plain = await searchProducts("gucci", { limit: 48, log: false });
  assert.equal(plain.interpreted.intent, "brand");
  assert.equal(plain.interpreted.pair, null);
  assert.ok(plain.total >= 13);
});

test("the resolver hands the client both canonical ids for a pair, and the chronology for a name", () => {
  const pair = resolveOverviewForQuery("tom ford: gucci", { pool: CATALOG });
  assert.deepEqual(pair.query, { text: "tom ford: gucci", designerId: "tom-ford", houseId: "gucci" });
  assert.equal(pair.overview.id, "tom-ford");
  assert.equal(pair.entities.house.id, "gucci");
  assert.deepEqual(pair.related.map((e) => e.houseId), ["gucci", "saint-laurent", "tom-ford-house"]);
  const house = resolveOverviewForQuery("gucci", { pool: CATALOG });
  assert.equal(house.overview.kind, "house");
  assert.equal(house.related[0].designerId, "tom-ford");
  assert.equal(house.related[0].matchingItemCount, 0);
  assert.equal(house.related.find((e) => e.designerId === "sabato-de-sarno").matchingItemCount, 13);
  const none = resolveOverviewForQuery("black leather jacket", { pool: CATALOG });
  assert.equal(none.overview, null);
  assert.deepEqual(none.related, []);
  assert.equal(resolveOverviewForQuery("gucci").related[0].matchingItemCount, null, "uncounted is null, never zero");
});

test("/api/discover carries overview, related and query ids for a pair, with an honest empty rack", async () => {
  const route = await loadRoute("app/api/discover/route.js");
  const res = await callRoute(route.GET, { path: "/api/discover", query: { q: "tom ford: gucci", limit: "12" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, "empty");
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.query.designerId, "tom-ford");
  assert.equal(res.body.query.houseId, "gucci");
  assert.equal(res.body.overview.name, "Tom Ford");
  assert.ok(res.body.related.some((e) => e.queryText === "TOM FORD: GUCCI" && e.matchingItemCount === 0));
  assert.match(res.body.note, /sourced/);
  const search = await loadRoute("app/api/search/route.js");
  const s = await callRoute(search.GET, { path: "/api/search", query: { q: "hedi slimane: celine" } });
  assert.equal(s.status, 200);
  assert.equal(s.body.outcome, "ok");
  assert.equal(s.body.total, 7);
  assert.equal(s.body.overview.id, "hedi-slimane");
  assert.equal(s.body.query.houseId, "celine");
});
