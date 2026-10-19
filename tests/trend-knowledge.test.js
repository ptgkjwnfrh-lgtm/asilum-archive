// tests/trend-knowledge.test.js — Trend knowledge: active only inside its
// dated window, matching needs product-level evidence, and the model's trend
// context keeps its provenance.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FASHION_TREND_SNAPSHOT_META, getCurrentFashionTrends, scoreProductTrendRelevance,
} from "../lib/ai/trendKnowledge.js";
import { scoreProductForUser } from "../lib/ai/stylistReasoningEngine.js";

test("trend knowledge is active only inside its dated window", () => {
  assert.ok(getCurrentFashionTrends({ asOf: "2026-07-17" }).length >= 8);
  assert.equal(getCurrentFashionTrends({ asOf: "2027-01-01" }).length, 0);
});

test("trend matching requires product-level evidence", () => {
  const trends = getCurrentFashionTrends({ asOf: "2026-07-17" });
  const statementDenim = scoreProductTrendRelevance({
    title: "Studded patchwork statement denim jean",
    category: "pants",
    tags: { STATEMENT: 0.8, STREETWEAR: 0.5 },
  }, trends);
  const generic = scoreProductTrendRelevance({
    title: "Plain cotton trouser",
    category: "pants",
    tags: { STATEMENT: 0.8, STREETWEAR: 0.5 },
  }, trends);
  assert.equal(statementDenim.trend.id, "statement-denim");
  assert.ok(statementDenim.score > generic.score);
  assert.equal(generic.score, 0);
  assert.equal(generic.trend, null);
});

test("model trend context retains provenance", async () => {
  const { getFashionTrendContext } = await import("../lib/ai/trendKnowledge.js");
  const [trend] = getFashionTrendContext({ asOf: "2026-07-17", limit: 1 });
  assert.ok(trend.sources.length >= 1);
  assert.ok(trend.sources.every((source) => source.url.startsWith("https://")));
  assert.ok(trend.sources.every((source) => source.kind !== "platform-methodology"));
  assert.equal(FASHION_TREND_SNAPSHOT_META.methodology.kind, "platform-methodology");
});

test("personal taste remains stronger than trend relevance", () => {
  const trends = getCurrentFashionTrends({ asOf: "2026-07-17" });
  const profile = {
    dominantAesthetics: [{ tag: "minimal", weight: 1 }],
    preferredBrands: [], avoidedTags: [],
  };
  const tasteMatch = scoreProductForUser({ title: "Plain trouser", tags: { MINIMAL: 1 } }, profile, trends);
  const trendOnly = scoreProductForUser({ title: "Studded patchwork statement denim", tags: { STATEMENT: 1 } }, profile, trends);
  assert.ok(tasteMatch > trendOnly);
  assert.ok(trendOnly <= 0.18);
});
