// scripts/measure-v2-gates.mjs — the V.2 launch gates, composed and declared
// (the V.2 backend plan, order of work: "Measure
// constraint violations, entity/intersection precision, duplicate/skip rate,
// catalog coverage, sourced-claim coverage, fit abstention/error rate …
// Declare thresholds against the existing baseline before tuning").
//
// A green instrument proves only what it COMPOSES (trap 58), so each gate
// here runs the real route or the real module end to end, in mem mode, and
// the thresholds are written before the run. Exit 1 on any red gate.
//
//   npm run v2:gates          → table + VERDICT
//   npm run v2:gates -- --json

import { searchProducts } from "../lib/search/index.js";
import { CATALOG } from "../lib/ingest/catalog.js";
import { registryCoverage, entityDto, careerOf, designersOf, getCareerEntity } from "../lib/people/careers.js";
import { resolveDesignerHousePair, parseDesignerHousePair } from "../lib/search/pair.js";
import { itemCreditsDesigner } from "../lib/search/designers.js";
import { fitAssessment, sizeRecord } from "../lib/brain/sizing.js";
import { measureSearchLatency, LATENCY_THRESHOLDS_MS } from "./measure-search-latency.mjs";
import { callRoute, loadRoute, newDevice } from "../tests/helpers/route.js";

export const GATES = Object.freeze({
  G1_pair_violations: { threshold: 0, means: "pieces served outside a DESIGNER: HOUSE intersection, over the pair probes" },
  G2_pair_precision: { threshold: 1, means: "share of pair probes whose rack is exactly the credited intersection (empty when nothing credits)" },
  G3_cursor_dup_skip: { threshold: 0, means: "duplicates + skips over a full cursor walk of a query and of the browse rack" },
  G4_sourced_claims: { threshold: 1, means: "share of registry summaries and facts with at least one source" },
  G5_fit_abstention: { threshold: 1, means: "share of fit probes where the engine says unknown/estimated rather than exact when nothing measured was compared" },
  G6_empty_vs_unavailable: { threshold: 1, means: "an empty desk answers outcome empty with 200, a bad cursor answers stale/invalid with its status" },
  G7_latency: { threshold: LATENCY_THRESHOLDS_MS, means: "search p50/p95/max in mem" },
});

const PAIR_PROBES = ["tom ford: gucci", "hedi slimane: celine", "kim jones: dior", "hedi slimane: saint laurent", "tom ford: prada", "nobody: gucci", "gucci: tom ford",
  "virgil abloh: louis vuitton", "miuccia prada: miu miu", "glenn martens: y/project", "grace wales bonner: adidas originals"];

async function pairGates() {
  const brands = [...new Set(CATALOG.map((it) => it.brand).filter(Boolean))];
  let violations = 0, precise = 0;
  const detail = [];
  for (const q of PAIR_PROBES) {
    const r = await searchProducts(q, { limit: 2000, log: false });
    const resolved = resolveDesignerHousePair(parseDesignerHousePair(q), { brands, pool: CATALOG });
    const expected = resolved.miss ? [] : CATALOG.filter((it) =>
      resolved.house.brands.some((b) => b.toLowerCase() === String(it.brand).toLowerCase()) && itemCreditsDesigner(it, resolved.designer.name));
    const expectedIds = new Set(expected.map((it) => it.id));
    const outside = r.results.filter((it) => !expectedIds.has(it.id)).length;
    const missing = expected.filter((it) => !r.results.some((x) => x.id === it.id)).length;
    violations += outside;
    if (!outside && !missing) precise++;
    detail.push({ q, served: r.results.length, expected: expected.length, outside, missing });
  }
  return { violations, precision: precise / PAIR_PROBES.length, detail };
}

async function cursorGate() {
  const discover = await loadRoute("app/api/discover/route.js");
  let dups = 0, skips = 0;
  for (const query of [{ q: "jacket", limit: "7" }, { limit: "50" }]) {
    const seen = new Set();
    let cursor = null, total = null, pages = 0;
    do {
      const res = await callRoute(discover.GET, { path: "/api/discover", query: cursor ? { ...query, cursor } : query });
      if (res.status !== 200) throw new Error(`discover ${res.status}: ${JSON.stringify(res.body).slice(0, 120)}`);
      total = res.body.total;
      for (const it of res.body.items) { if (seen.has(it.id)) dups++; seen.add(it.id); }
      cursor = res.body.nextCursor; pages++;
    } while (cursor && pages < 200);
    skips += Math.max(0, total - seen.size);
  }
  return { dups, skips };
}

function sourcedGate() {
  const cov = registryCoverage();
  // every entity reachable from the eight seed ids through their edges
  const ids = new Set();
  for (const id of ["tom-ford", "hedi-slimane", "gucci", "saint-laurent", "dior", "celine", "tom-ford-house", "balmain"]) {
    ids.add(id);
    const e = getCareerEntity(id);
    if (!e) continue;
    for (const edge of e.kind === "designer" ? careerOf(id) : designersOf(id)) { ids.add(edge.designerId); ids.add(edge.houseId); }
  }
  let claims = 0, sourced = 0;
  for (const dto of [...ids].map(entityDto).filter(Boolean)) {
    if (!dto.overview) continue;
    claims++; if (dto.overview.summary.sourceIds.length) sourced++;
    for (const f of dto.facts) { claims++; if (f.claim.sourceIds.length) sourced++; }
  }
  return { share: claims ? sourced / claims : 1, claims, sourced, vogueSources: cov.vogueSources, edges: cov.edges, unsourcedDates: cov.unsourced };
}

function fitGate() {
  const probes = [
    () => fitAssessment(sizeRecord("M", { category: "tops", measurementSource: "merchant" }), { usualSize: "M", measurements: { chest: 38 } }),
    () => fitAssessment(sizeRecord("M", { category: "tops" }), null),
    () => fitAssessment(sizeRecord("M", { category: "tops" }), { usualSize: "M", measurements: {} }),
    () => fitAssessment(sizeRecord("M", { category: "tops", measurementSource: "listing", measurements: { chest: 42, waist: 40 } }), { usualSize: "M", measurements: {} }),
    () => fitAssessment(null, { usualSize: "M", measurements: { chest: 38 } }),
  ];
  let ok = 0;
  const detail = [];
  for (const p of probes) {
    const a = p();
    const honest = a.exact === false && a.evidence !== "measured";
    if (honest) ok++;
    detail.push({ status: a.status, evidence: a.evidence, exact: a.exact, missing: a.missingDimensions });
  }
  return { share: ok / probes.length, detail };
}

async function outcomeGate() {
  const tickets = await loadRoute("app/api/tickets/route.js");
  const discover = await loadRoute("app/api/discover/route.js");
  const me = newDevice();
  const empty = await callRoute(tickets.GET, { path: "/api/tickets", cookies: me.cookies, query: { user: me.uid } });
  const bad = await callRoute(discover.GET, { path: "/api/discover", query: { q: "jacket", cursor: "zzz.zzz" } });
  const first = await callRoute(discover.GET, { path: "/api/discover", query: { q: "jacket", limit: "5" } });
  const stale = await callRoute(discover.GET, { path: "/api/discover", query: { q: "coat", limit: "5", cursor: first.body.nextCursor } });
  const checks = [
    empty.status === 200 && empty.body.outcome === "empty",
    bad.status === 400 && bad.body.outcome === "invalid",
    stale.status === 409 && stale.body.outcome === "stale_cursor" && stale.body.error.retryable === false,
  ];
  return { share: checks.filter(Boolean).length / checks.length, checks };
}

export async function measureV2Gates() {
  const [pairs, cursor, latency] = [await pairGates(), await cursorGate(), await measureSearchLatency({ rounds: 1 })];
  const sourced = sourcedGate();
  const fit = fitGate();
  const outcomes = await outcomeGate();
  const results = {
    G1_pair_violations: { value: pairs.violations, pass: pairs.violations <= GATES.G1_pair_violations.threshold, detail: pairs.detail },
    G2_pair_precision: { value: +pairs.precision.toFixed(3), pass: pairs.precision >= GATES.G2_pair_precision.threshold },
    G3_cursor_dup_skip: { value: cursor.dups + cursor.skips, pass: cursor.dups + cursor.skips <= 0, detail: cursor },
    G4_sourced_claims: { value: +sourced.share.toFixed(3), pass: sourced.share >= 1, detail: sourced },
    G5_fit_abstention: { value: +fit.share.toFixed(3), pass: fit.share >= 1, detail: fit.detail },
    G6_empty_vs_unavailable: { value: +outcomes.share.toFixed(3), pass: outcomes.share >= 1, detail: outcomes.checks },
    G7_latency: { value: latency.stats, pass: latency.verdict === "PASS" },
  };
  const verdict = Object.values(results).every((r) => r.pass) ? "PASS" : "FAIL";
  return { results, verdict, gates: GATES };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const r = await measureV2Gates();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const [k, v] of Object.entries(r.results)) {
      const value = typeof v.value === "object" ? JSON.stringify(v.value) : v.value;
      console.log(`${v.pass ? "✓" : "✗"} ${k.padEnd(24)} ${String(value).padEnd(48)} ${GATES[k].means}`);
    }
    console.log(`VERDICT: ${r.verdict}`);
  }
  process.exit(r.verdict === "PASS" ? 0 : 1);
}
