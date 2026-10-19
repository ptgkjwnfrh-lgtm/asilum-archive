// scripts/measure-search-latency.mjs — p50 / p95 of the search engine, in
// mem mode, over a fixed corpus (the V.2 backend plan asks for
// latency as a launch gate). A gate, not a dashboard: the thresholds are
// declared here, before the run, and a red run is a red run.
//
//   npm run search:latency            → prints the table, exits 1 over threshold
//   npm run search:latency -- --json  → machine-readable
//
// Mem mode on one machine says nothing about Postgres round-trips; it pins
// the engine's own cost so a regression in the interpreter or the ranker is
// caught before it reaches a database.

import { performance } from "node:perf_hooks";
import { searchProducts } from "../lib/search/index.js";

export const LATENCY_THRESHOLDS_MS = Object.freeze({ p50: 60, p95: 250, max: 800 });

export const CORPUS = Object.freeze([
  "leather jacket", "black cropped leather jacket", "wool coat", "gucci", "tom ford: gucci",
  "hedi slimane: celine", "kim jones: dior", "rick owens", "like rick owens", "prada or gucci",
  "japanese coat", "belgian tailoring", "90s helmut lang", "cheapest jacket", "under 200 hoodie",
  "no logo hoodie", "medium jacket", "size 32 jeans", "womens blazer", "mens parka",
  "gorpcore", "minimal tailoring", "archive sportswear", "silk blouse", "plaid skirt",
  "trashed jeans", "cashmere knit", "patent boots", "olivier rousteing", "jun takahashi",
  "demna jacket", "commedesgarcons", "ysl", "blade runner", "the row", "nothing here at all zzq",
  "wool sweater", "black boots", "raf", "acne studios jeans",
]);

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

export async function measureSearchLatency({ rounds = 3, corpus = CORPUS } = {}) {
  // warm the engine once so module loading and the first pool read are not measured
  await searchProducts(corpus[0], { limit: 48, log: false });
  const samples = [];
  for (let r = 0; r < rounds; r++) {
    for (const q of corpus) {
      const t = performance.now();
      await searchProducts(q, { limit: 48, log: false });
      samples.push({ q, ms: performance.now() - t });
    }
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const slowest = samples.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((s) => ({ q: s.q, ms: +s.ms.toFixed(1) }));
  const stats = { n: sorted.length, p50: +pct(sorted, 0.5).toFixed(1), p95: +pct(sorted, 0.95).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1) };
  const verdict = stats.p50 <= LATENCY_THRESHOLDS_MS.p50 && stats.p95 <= LATENCY_THRESHOLDS_MS.p95 && stats.max <= LATENCY_THRESHOLDS_MS.max ? "PASS" : "FAIL";
  return { stats, thresholds: LATENCY_THRESHOLDS_MS, slowest, verdict };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const json = process.argv.includes("--json");
  const r = await measureSearchLatency();
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`search latency (mem, ${r.stats.n} samples): p50 ${r.stats.p50} ms · p95 ${r.stats.p95} ms · max ${r.stats.max} ms`);
    console.log(`thresholds: p50 ≤ ${r.thresholds.p50} · p95 ≤ ${r.thresholds.p95} · max ≤ ${r.thresholds.max}`);
    for (const s of r.slowest) console.log(`  slowest  ${String(s.ms).padStart(7)} ms  ${s.q}`);
    console.log(`VERDICT: ${r.verdict}`);
  }
  process.exit(r.verdict === "PASS" ? 0 : 1);
}
