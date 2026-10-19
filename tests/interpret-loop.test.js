// tests/interpret-loop.test.js — The interpretation loop: readings train taste
// without touching the anchor ring, real engagements still fill the ring, and
// the recent cap is never starved by readings.

import test from "node:test";
import assert from "node:assert/strict";

import { learn, migrateProfile } from "../lib/brain/index.js";
import { orchestrateInterpretation } from "../lib/asterisk/orchestrator.js";
import { recordInterpretationFeedback, listInterpretationFeedback, purgePersonalizationData } from "../lib/db/production.js";
import { interpretationFeedbackId } from "../lib/asterisk/interpretationSchema.js";

// The interpret-loop branch closes four audit findings. These tests pin the
// mechanism of each; all run in mem-mode (no DATABASE_URL).

// ---- #13 anchor ring is protected from synthetic reading ids ----------------

test("#13 learn(anchor:false) trains taste but never touches the anchor ring", () => {
  let p = migrateProfile({});
  // A dozen applied readings, each a synthetic reading:<id> pseudo-item.
  for (let i = 0; i < 12; i++) {
    p = learn(p, { id: "reading:carti/opium" + i, tags: { "AVANT-GARDE": 0.3 } }, "save", { anchor: false });
  }
  assert.equal(p._meta.recent.length, 0, "no synthetic id entered the ring");
  assert.ok((p.long["AVANT-GARDE"] || 0) > 0, "taste still trained");
});

test("#13 real catalog engagements still populate the ring; RECENT_CAP not starved by readings", () => {
  let p = migrateProfile({});
  p = learn(p, { id: "syn-0001", tags: { MINIMAL: 0.5 } }, "save");
  p = learn(p, { id: "reading:x/y", tags: { MINIMAL: 0.3 } }, "save", { anchor: false });
  p = learn(p, { id: "syn-0002", tags: { MINIMAL: 0.5 } }, "save");
  assert.deepEqual(p._meta.recent, ["syn-0002", "syn-0001"], "only real ids anchor, newest first");
});

test("#13 default behavior (no opts) still anchors real ids — no regression", () => {
  let p = migrateProfile({});
  p = learn(p, { id: "syn-0009", tags: { GORP: 0.6 } }, "bag");
  assert.deepEqual(p._meta.recent, ["syn-0009"]);
});

// ---- #5 training idempotence on verdict transition --------------------------

test("#5 recordInterpretationFeedback reports changed only on a real transition", async () => {
  const user = "u-idem-1";
  await purgePersonalizationData(user).catch(() => {});
  const args = { userId: user, normalizedQuery: "playboi carti", interpretationId: "carti/opium", contractVersion: 1, verdict: "meant" };
  const first = await recordInterpretationFeedback(args);
  assert.equal(first.changed, true, "first record is a change");
  const again = await recordInterpretationFeedback(args);
  assert.equal(again.changed, false, "same verdict again is NOT a change");
  const flip = await recordInterpretationFeedback({ ...args, verdict: "not-meant" });
  assert.equal(flip.changed, true, "flipping the verdict is a change");
  const back = await recordInterpretationFeedback({ ...args, verdict: "meant" });
  assert.equal(back.changed, true, "flipping back is a change");
  await purgePersonalizationData(user).catch(() => {});
});

test("#5 N identical 'meant' records train exactly once (idempotent via changed-gate)", async () => {
  const user = "u-idem-2";
  await purgePersonalizationData(user).catch(() => {});
  const args = { userId: user, normalizedQuery: "kanye west", interpretationId: "ye/polo-era", contractVersion: 1, verdict: "meant" };
  // Simulate the route's gate: train only when changed.
  const tags = { STREETWEAR: 0.2 };
  let profile = migrateProfile({});
  let trainCount = 0;
  for (let i = 0; i < 6; i++) {
    const saved = await recordInterpretationFeedback(args);
    if (saved.changed) { profile = learn(profile, { id: "reading:ye/polo-era", tags }, "save", { anchor: false }); trainCount++; }
  }
  assert.equal(trainCount, 1, "six identical clicks trained once");
  await purgePersonalizationData(user).catch(() => {});
});

// ---- #6 namespace canonicalization: raw id and feedbackId both suppress ------

test("#6 suppression matches whether the client posted a raw id or a feedbackId", async () => {
  const base = await orchestrateInterpretation("kanye west", null);
  const target = base.interpretations[0]; // e.g. ye/polo-era
  assert.ok(target, "kanye west resolves to interpretations");

  // Raw-id rejection (what the shipped discover client posts).
  const rawReject = [{ verdict: "not-meant", interpretationId: target.id }];
  const afterRaw = await orchestrateInterpretation("kanye west", null, rawReject);
  assert.ok(!afterRaw.interpretations.some((i) => i.id === target.id), "raw-id rejection suppresses");

  // Versioned feedbackId rejection (what the contract tests post).
  const fbReject = [{ verdict: "not-meant", interpretationId: interpretationFeedbackId("exact", target.id) }];
  const afterFb = await orchestrateInterpretation("kanye west", null, fbReject);
  assert.ok(!afterFb.interpretations.some((i) => i.id === target.id), "feedbackId rejection suppresses too");
});

// ---- #25 all-rejected returns the list but claims no false hiding -----------

function assumptionsOf(r) { return r.assumptions || []; }

test("#25 rejecting SOME readings emits the hidden-for-you note", async () => {
  const base = await orchestrateInterpretation("kanye west", null);
  if (base.interpretations.length < 2) return; // needs a multi-reading entity
  const rejectOne = [{ verdict: "not-meant", interpretationId: base.interpretations[0].id }];
  const after = await orchestrateInterpretation("kanye west", null, rejectOne);
  assert.ok(assumptionsOf(after).some((a) => a.includes("hidden for you")), "partial rejection is disclosed");
});

test("#25 rejecting ALL readings shows the full list and claims NO hiding", async () => {
  const base = await orchestrateInterpretation("kanye west", null);
  const rejectAll = base.interpretations.map((i) => ({ verdict: "not-meant", interpretationId: i.id }));
  const after = await orchestrateInterpretation("kanye west", null, rejectAll);
  assert.equal(after.interpretations.length, base.interpretations.length, "full list restored when all rejected");
  assert.ok(!assumptionsOf(after).some((a) => a.includes("hidden for you")), "no false hidden claim when nothing was hidden");
});
