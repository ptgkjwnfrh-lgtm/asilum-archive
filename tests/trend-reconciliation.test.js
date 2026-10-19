// tests/trend-reconciliation.test.js — Trend reconciliation: culture records
// carry no trend data of their own, every aesthetic trend names a real culture
// entity, and aesthetic records stay structurally honest.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AESTHETIC_TRENDS, AESTHETIC_TREND_META, AESTHETIC_PHASES, aestheticTrend,
  FASHION_TREND_SNAPSHOT, FASHION_TREND_SNAPSHOT_META,
} from "../lib/asterisk/trends.js";
import { CULTURE, lookupCulture } from "../lib/asterisk/culture.js";
import { interpretQuery } from "../lib/asterisk/queryRouter.js";

test("culture records carry no trend data of their own", () => {
  assert.equal(CULTURE.filter((rec) => rec.trend !== undefined).length, 0);
});

test("every aesthetic trend call names a real culture entity", () => {
  for (const name of Object.keys(AESTHETIC_TRENDS)) {
    const entity = lookupCulture(name);
    assert.ok(entity, `${name}: no culture entity`);
    assert.equal(entity.name, name, `${name}: key must be the canonical entity name`);
  }
});

test("aesthetic records are structurally honest", () => {
  const garmentIds = new Set(FASHION_TREND_SNAPSHOT.map((t) => t.id));
  for (const [name, rec] of Object.entries(AESTHETIC_TRENDS)) {
    assert.ok(AESTHETIC_PHASES.includes(rec.phase), `${name}: phase`);
    assert.ok(String(rec.note).trim().length > 0, `${name}: note`);
    assert.match(rec.lastReviewed, /^\d{4}-\d{2}$/, `${name}: lastReviewed`);
    for (const id of rec.garmentTrends || []) {
      assert.ok(garmentIds.has(id), `${name}: garment link ${id}`);
    }
  }
});

test("both trend layers share one review clock", () => {
  assert.equal(AESTHETIC_TREND_META.reviewBy, FASHION_TREND_SNAPSHOT_META.reviewBy);
});

test("interpret still surfaces the lifecycle call, resolved from trends.js", async () => {
  const result = await interpretQuery("office siren");
  assert.equal(result.entity.trend.phase, "declining");
  assert.ok(result.entity.trend.note.includes("2026"));
  const aliasResult = await interpretQuery("corp-core");
  assert.equal(aliasResult.entity.name, "office siren");
  assert.equal(aliasResult.entity.trend.phase, "declining");
});

test("entities without a lifecycle call read as an honest null", async () => {
  assert.equal(aestheticTrend("fight club"), null);
  const result = await interpretQuery("fight club");
  assert.equal(result.entity.trend, null);
  assert.ok(result.interpretations.length >= 4);
});
