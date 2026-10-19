// tests/asterisk-explain.test.js — ASTERISK's explanations: seed products
// explain without a database, corrections must name a product, and saved
// corrections surface in later explanations.

import test from "node:test";
import assert from "node:assert/strict";

import { explainProduct, recordCorrection } from "../lib/asterisk/explain.js";
import { applyCorrectionSignalsToBrainProfile } from "../lib/asterisk/correctionSignals.js";
import { getCandidateProductsForStylist } from "../lib/ai/stylistReasoningEngine.js";
import {
  adoptUserCorrections,
  getUserCorrectionSignalSummary,
  getUserCorrectionState,
  getUserRecommendationExclusions,
  listUserCorrections,
  listModerationTasks,
} from "../lib/db/production.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const item = CATALOG[0];

test("explains seed-catalog products without a database", async () => {
  const result = await explainProduct("test-explain-user", item.id);
  assert.equal(result.ok, true);
  assert.equal(result.explanation.productId, item.id);
  assert.equal(typeof result.explanation.summary, "string");
});

test("rejects corrections that are not tied to a product", async () => {
  const result = await recordCorrection("test-invalid-user", {
    code: "not-my-style",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("persists correction state and surfaces it in explanations", async () => {
  const userId = "test-correction-user";
  const recorded = await recordCorrection(userId, {
    productId: item.id,
    code: "already-own",
  });
  assert.equal(recorded.ok, true);

  const state = await getUserCorrectionState(userId, {
    productId: item.id,
    brand: item.brand,
  });
  assert.equal(state.alreadyOwn, true);

  const explanation = await explainProduct(userId, item.id);
  assert.equal(explanation.ok, true);
  assert.ok(explanation.explanation.warnings.includes("you marked this piece as already owned"));
});

test("queues data reports once and treats exact repeats as idempotent", async () => {
  const userId = "test-report-user";
  const result = await recordCorrection(userId, {
    productId: item.id,
    code: "wrong-color",
    note: "The listing image is blue.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.moderationTask?.kind, "user-report");

  const duplicate = await recordCorrection(userId, {
    productId: item.id,
    code: "wrong-color",
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.moderationTask, null);

  const tasks = await listModerationTasks({ status: "open" });
  assert.equal(tasks.filter((task) =>
    task.payload?.reportedBy === userId && task.subjectId === item.id).length, 1);
});

test("standing brand exclusions do not depend on history limits", async () => {
  const userId = "test-brand-user";
  const result = await recordCorrection(userId, {
    productId: item.id,
    code: "dont-recommend-brand",
  });
  assert.equal(result.ok, true);

  const brand = item.brand.trim().toLowerCase();
  assert.ok((await getUserRecommendationExclusions(userId)).brands.includes(brand));

  const candidates = await getCandidateProductsForStylist({}, userId);
  assert.ok(candidates.every((candidate) =>
    String(candidate.brand || "").trim().toLowerCase() !== brand));
});

test("aggregated corrections adjust the homepage brain without mutating its base", async () => {
  const userId = "test-feed-user";
  const result = await recordCorrection(userId, {
    productId: item.id,
    code: "not-my-style",
  });
  assert.equal(result.ok, true);

  const summary = await getUserCorrectionSignalSummary(userId);
  const base = {};
  const adjusted = applyCorrectionSignalsToBrainProfile(base, summary);
  const dominantTag = Object.entries(item.tags).sort((a, b) => b[1] - a[1])[0][0];
  assert.ok(adjusted.long[dominantTag] < 0);
  assert.deepEqual(base, {});
});

test("account adoption moves corrections to the authenticated identity", async () => {
  const fromUserId = "test-device-user";
  const toUserId = "test-account-user";
  const product = CATALOG[1];
  assert.equal((await recordCorrection(fromUserId, {
    productId: product.id,
    code: "more-like-this",
  })).ok, true);

  assert.equal(await adoptUserCorrections(fromUserId, toUserId), 1);
  assert.equal((await listUserCorrections(fromUserId)).length, 0);
  assert.equal((await listUserCorrections(toUserId)).length, 1);
  assert.equal((await getUserCorrectionSignalSummary(toUserId)).count, 1);
});

test("rate limits new corrections without blocking idempotent retries", async () => {
  const userId = "test-rate-limit-user";
  for (const product of CATALOG.slice(0, 20)) {
    assert.equal((await recordCorrection(userId, {
      productId: product.id,
      code: "wrong-era",
    })).ok, true);
  }
  const limited = await recordCorrection(userId, {
    productId: CATALOG[20].id,
    code: "wrong-era",
  });
  assert.equal(limited.ok, false);
  assert.equal(limited.status, 429);

  const retry = await recordCorrection(userId, {
    productId: CATALOG[0].id,
    code: "wrong-era",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
});
