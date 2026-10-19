// Reason-specific learning (V.2, 19 Sep 2026, the V.2 backend plan
// § Immediate learning work; CONTRACTS.md § Learning events).
//
// Law 1: a reason changes ONLY its lane. "Too expensive" changes price
//        handling and touches no tag; "dislike the finish" reaches the
//        finish tags and nothing else; "not interested" excludes the piece.
// Law 2: a correction has a scope (this item / this session / ongoing) and
//        an undo. An undone correction has no effect anywhere; re-recording
//        it revives the row rather than replaying a duplicate.
// Law 3: "wrong attribution" is a report for the desk, never a taste signal.
import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../lib/ingest/catalog.js";
import { recordCorrection, undoCorrection, correctionSnapshot, CORRECTION_CODES } from "../lib/asterisk/explain.js";
import {
  laneOf, REASON_LANES, priceCeilingFrom, fitHintsFrom, isCorrectionActive, applyCorrectionSignalsToBrainProfile,
} from "../lib/asterisk/correctionSignals.js";
import {
  getUserRecommendationExclusions, getUserCorrectionSignalSummary, listUserCorrections,
} from "../lib/db/production.js";
import { applyRecommendationExclusions } from "../lib/products.js";
import { asteriskMemory } from "../lib/asterisk/memory.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const priced = CATALOG.filter((it) => Number.isFinite(Number(it.price)) && Number(it.price) > 200 && it.tags && Object.keys(it.tags).length);
const piece = priced[0];
const pricier = priced.find((it) => Number(it.price) > Number(piece.price) + 50);
const cheaper = CATALOG.find((it) => Number.isFinite(Number(it.price)) && Number(it.price) > 0 && Number(it.price) < Number(piece.price) - 50);
const uid = () => "u-" + "a".repeat(8) + "-" + Math.random().toString(16).slice(2, 6) + "-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);

test("law 1: every code has a lane, and a lane snapshot carries only its lane's facts", () => {
  for (const code of CORRECTION_CODES) assert.ok(REASON_LANES[code], `${code} has a lane`);
  assert.equal(laneOf("too-expensive"), "price");
  assert.equal(laneOf("too-small"), "fit");
  assert.equal(laneOf("dislike-finish"), "finish");
  assert.equal(laneOf("not-interested"), "item");
  assert.equal(laneOf("wrong-attribution"), "data");
  const price = correctionSnapshot(piece, "too-expensive");
  assert.deepEqual(price, [`price:${Math.round(piece.price * 100)}`, `currency:${String(piece.currency || "USD").toLowerCase()}`]);
  const fit = correctionSnapshot(piece, "too-small");
  assert.ok(fit.some((t) => t.startsWith("brand:")));
  assert.ok(fit.every((t) => /^(brand|category|size):/.test(t)), "fit carries brand/category/size only");
  const finish = correctionSnapshot(piece, "dislike-finish");
  const dominant = correctionSnapshot(piece, "less-like-this");
  for (const t of finish) assert.ok(!/^(brand|category|size|price|currency):/.test(t));
  assert.ok(dominant.length >= 1, "the taste lane still snapshots dominant tags");
  assert.deepEqual(correctionSnapshot(piece, "not-interested"), []);
  assert.deepEqual(correctionSnapshot(piece, "wrong-attribution"), []);
});

test("law 1: too expensive sets a price ceiling and leaves every tag alone", async () => {
  const user = uid();
  const r = await recordCorrection(user, { productId: piece.id, code: "too-expensive" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.lane, "price");
  assert.equal(r.scope, "ongoing");
  const ex = await getUserRecommendationExclusions(user);
  assert.equal(ex.priceCeilingCents, Math.round(piece.price * 100));
  assert.deepEqual(ex.productIds, [], "ongoing scope is a ceiling, not an item exclusion");
  const summary = await getUserCorrectionSignalSummary(user);
  assert.equal(summary.count, 0, "the price lane writes no taste signal");
  assert.deepEqual(applyCorrectionSignalsToBrainProfile({ long: { MINIMAL: 0.5 }, session: {} }, summary).long, { MINIMAL: 0.5 });
  const pool = [piece, pricier, cheaper].filter(Boolean);
  const kept = applyRecommendationExclusions(pool, ex);
  assert.ok(!kept.some((it) => it.id === piece.id), "the piece itself is at the ceiling");
  if (pricier) assert.ok(!kept.some((it) => it.id === pricier.id), "nothing pricier is pushed");
  if (cheaper) assert.ok(kept.some((it) => it.id === cheaper.id), "cheaper pieces are untouched");
  const unpriced = applyRecommendationExclusions([{ id: "x", price: null }], ex);
  assert.equal(unpriced.length, 1, "an unpriced piece is not judged by a price ceiling");

  // item scope: exclude the piece, no ceiling
  const other = uid();
  await recordCorrection(other, { productId: piece.id, code: "too-expensive", scope: "item" });
  const ex2 = await getUserRecommendationExclusions(other);
  assert.equal(ex2.priceCeilingCents, null);
  assert.deepEqual(ex2.productIds, [piece.id]);
});

test("law 1: dislike the finish reaches only the finish tags; not interested excludes the piece only", async () => {
  const user = uid();
  const withMaterial = CATALOG.find((it) => /\b(leather|suede|wool|satin|patent|nylon|denim)\b/i.test(it.title || "") && it.tags && Object.keys(it.tags).length);
  assert.ok(withMaterial, "a piece whose listing names a material or finish");
  assert.ok(correctionSnapshot(withMaterial, "dislike-finish").length >= 1, "the finish lane read the listing");
  const r = await recordCorrection(user, { productId: withMaterial.id, code: "dislike-finish" });
  assert.equal(r.ok, true, r.error);
  const summary = await getUserCorrectionSignalSummary(user);
  const finishTags = new Set(correctionSnapshot(withMaterial, "dislike-finish"));
  for (const s of summary.signals) {
    assert.equal(s.code, "dislike-finish");
    assert.ok(finishTags.has(s.tag), `${s.tag} is a finish tag`);
  }
  const profile = applyCorrectionSignalsToBrainProfile({ long: { MINIMAL: 0.5 }, session: {} }, summary);
  assert.equal(profile.long.MINIMAL, 0.5, "a non-finish tag is untouched");
  for (const t of finishTags) if (profile.long[t.toUpperCase()] != null) assert.ok(profile.long[t.toUpperCase()] < 0);

  const ni = await recordCorrection(user, { productId: piece.id, code: "not-interested" });
  assert.equal(ni.lane, "item");
  const ex = await getUserRecommendationExclusions(user);
  assert.ok(ex.productIds.includes(piece.id));
  assert.equal(ex.priceCeilingCents, null);
  assert.equal((await getUserCorrectionSignalSummary(user)).signals.every((s) => s.code === "dislike-finish"), true);
});

test("law 1: too small records a fit hint for that brand and category, and nothing else", async () => {
  const user = uid();
  const r = await recordCorrection(user, { productId: piece.id, code: "too-small" });
  assert.equal(r.lane, "fit");
  const ex = await getUserRecommendationExclusions(user);
  assert.equal(ex.fitHints.length, 1);
  assert.equal(ex.fitHints[0].direction, "runs-small");
  assert.equal(ex.fitHints[0].brand, piece.brand);
  assert.equal(ex.priceCeilingCents, null);
  assert.deepEqual(ex.productIds, []);
  assert.equal((await getUserCorrectionSignalSummary(user)).count, 0);
  assert.deepEqual(fitHintsFrom(await listUserCorrections(user)).map((h) => h.direction), ["runs-small"]);
});

test("law 2: undo removes every effect, keeps the row, and a re-record revives it", async () => {
  const user = uid();
  const r = await recordCorrection(user, { productId: piece.id, code: "too-expensive" });
  assert.equal((await getUserRecommendationExclusions(user)).priceCeilingCents, Math.round(piece.price * 100));
  const undone = await undoCorrection(user, r.correction.id);
  assert.equal(undone.ok, true, undone.error);
  assert.equal(undone.lane, "price");
  assert.equal((await getUserRecommendationExclusions(user)).priceCeilingCents, null, "the ceiling is gone");
  const rows = await listUserCorrections(user);
  assert.equal(rows.length, 1, "the row stays as the record");
  assert.ok(rows[0].undoneAt, "stamped undone");
  assert.equal(isCorrectionActive(rows[0]), false);
  const again = await undoCorrection(user, r.correction.id);
  assert.equal(again.ok, false, "a second undo finds nothing active");
  assert.equal(again.status, 404);
  const stranger = await undoCorrection(uid(), r.correction.id);
  assert.equal(stranger.ok, false, "someone else's correction cannot be undone");

  const revived = await recordCorrection(user, { productId: piece.id, code: "too-expensive", scope: "session" });
  assert.equal(revived.duplicate, false);
  assert.equal(revived.revived, true);
  assert.equal(revived.correction.scope, "session");
  assert.equal((await getUserRecommendationExclusions(user)).priceCeilingCents, Math.round(piece.price * 100));
  assert.equal((await listUserCorrections(user)).length, 1, "revived, not duplicated");
  // a session correction expires
  const expired = { ...(await listUserCorrections(user))[0], createdAt: Date.now() - 25 * 60 * 60 * 1000 };
  assert.equal(isCorrectionActive(expired), false);
  assert.equal(priceCeilingFrom([expired]), null);
});

test("law 3: wrong attribution opens a desk task and never touches taste; a data report has no scope", async () => {
  const user = uid();
  const r = await recordCorrection(user, { productId: piece.id, code: "wrong-attribution" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.lane, "data");
  assert.ok(r.moderationTask, "a task for the desk");
  assert.equal(r.moderationTask.kind, "user-report");
  assert.equal((await getUserCorrectionSignalSummary(user)).count, 0);
  const ex = await getUserRecommendationExclusions(user);
  assert.deepEqual(ex.productIds, [], "the piece is not demoted for the reader who reported it");
  const scoped = await recordCorrection(user, { productId: piece.id, code: "wrong-brand", scope: "item" });
  assert.equal(scoped.ok, false);
  assert.equal(scoped.status, 400);
});

test("the memory facade names the lane, the scope and the undo; the route accepts scope and undoOf", async () => {
  const route = await loadRoute("app/api/why/route.js");
  const me = newDevice();
  const bad = await callRoute(route.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, productId: piece.id, code: "too-expensive", scope: "forever" } });
  assert.equal(bad.status, 400);
  const post = await callRoute(route.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, productId: piece.id, code: "too-expensive", scope: "session" } });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal(post.body.correction.lane, "price");
  assert.equal(post.body.correction.scope, "session");
  const memory = await asteriskMemory(me.uid);
  const entry = memory.memory.explicit.corrections.find((c) => c.code === "too-expensive");
  assert.ok(entry, "the facade lists it");
  assert.equal(entry.lane, "price");
  assert.equal(entry.scope, "session");
  assert.equal(entry.undone, false);
  const undo = await callRoute(route.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, undoOf: post.body.correction.id } });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.equal(undo.body.undone.lane, "price");
  const after = await asteriskMemory(me.uid);
  assert.equal(after.memory.explicit.corrections.find((c) => c.code === "too-expensive").undone, true);
  const missing = await callRoute(route.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, undoOf: "999999" } });
  assert.equal(missing.status, 404);
});
