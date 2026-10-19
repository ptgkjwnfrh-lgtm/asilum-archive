// tests/asterisk-governance.test.js — ASTERISK GOVERNANCE (V.2 Blueprint,
// owner, 17 Oct 2026, Part I; slice 5). The policy is pure
// (lib/asterisk/governance.js); the rows run on the memory store
// (lib/db/production/asterisk.js); the governor glues them
// (lib/asterisk/governor.js). Laws held here:
//   * the 90% cap: ASTERISK never reports more; only an admin makes 1.0;
//   * the 65% split: one to five blind agents, each with a share of the
//     budget, reconciled only after all have answered;
//   * collective confidence is agreement and evidence, never an average:
//     five at one answer from five pieces of evidence is strong; five
//     answers is a fail; done at 75%;
//   * under 75% the safe outcome applies — it does not escalate;
//   * a paused function does no work; its task waits in the queue;
//   * every action is logged with evidence, confidence and reasoning; an
//     admin override is a new row, ground truth, and stands;
//   * what reaches an admin, what alerts, and the queue's order;
//   * calibration per band; audits grade; two poor grades hand the
//     function to the queue; an unmeasured audit is not a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../lib/asterisk/governance.js";
import * as rows from "../lib/db/production/asterisk.js";
import { govern } from "../lib/asterisk/governor.js";

test.beforeEach(() => rows.resetMemoryAsterisk());

test("the numbers are the blueprint's, and the seven functions each carry a safe outcome", () => {
  assert.equal(G.CONFIDENCE_CAP, 0.9); assert.equal(G.SPLIT_UNDER, 0.65); assert.equal(G.COLLECTIVE_BAR, 0.75);
  assert.equal(G.MAX_AGENTS, 5); assert.equal(G.TASK_BUDGET_MS, 300_000);
  assert.deepEqual(G.FUNCTION_IDS, ["tagging", "authentication", "valuation", "sizing", "search", "exploration", "moderation"]);
  for (const fn of G.FUNCTION_IDS) { assert.ok(G.FUNCTIONS[fn].safe.length > 20, fn); assert.ok(G.FUNCTIONS[fn].prevents, fn); }
  assert.equal(G.isFunction("constructor"), false, "a prototype name is not a function");
});

test("the 90% cap: ASTERISK never reports more; only an admin confirmation is certain", () => {
  assert.equal(G.cap(0.97), 0.9); assert.equal(G.cap(1), 0.9); assert.equal(G.cap(0.42), 0.42); assert.equal(G.cap(-1), 0); assert.equal(G.cap("x"), 0);
  assert.equal(G.cap(0.3, { adminConfirmed: true }), 1);
});

test("the 65% split: none at or above, one to five below, more the further short; the budget shares sum to the budget", () => {
  assert.equal(G.agentsFor(0.65), 0); assert.equal(G.agentsFor(0.9), 0);
  assert.equal(G.agentsFor(0.64), 1); assert.equal(G.agentsFor(0.3), 3); assert.equal(G.agentsFor(0), 5);
  for (let c = 0; c < 0.65; c += 0.05) { const n = G.agentsFor(c); assert.ok(n >= 1 && n <= 5, String(c)); }
  assert.deepEqual(G.budgetShares(20000, 3), [6668, 6666, 6666]);
  assert.deepEqual(G.budgetShares(10, 0), []);
  assert.equal(G.budgetShares(999, 5).reduce((a, b) => a + b, 0), 999);
});

test("collective confidence is agreement and evidence, not averaging", () => {
  const five = (answer, ev) => Array.from({ length: 5 }, (_, i) => ({ answer, confidence: 0.7, evidence: ev ? [ev(i)] : [] }));
  const strong = G.reconcile(five("gucci", (i) => "evidence-" + i));
  assert.equal(strong.collective, 0.9, "five agents, one answer, five pieces of evidence: strong, and capped");
  assert.equal(strong.pass, true); assert.equal(strong.distinctEvidence, 5); assert.equal(strong.agreement, 1);
  const split = G.reconcile(Array.from({ length: 5 }, (_, i) => ({ answer: "house-" + i, confidence: 0.7 })));
  assert.ok(split.collective < 0.2, "five answers at 70% each is a fail, not a 70%");
  assert.equal(split.pass, false);
  const sameEvidence = G.reconcile(five("gucci", () => "the one label"));
  assert.equal(sameEvidence.collective, 0.7, "five agents reading one piece of evidence is one piece of evidence");
  assert.equal(sameEvidence.pass, false);
  const blind = G.reconcile(five("gucci", null));
  assert.equal(blind.distinctEvidence, 5, "a blind agent with no evidence named is its own attempt");
  assert.equal(G.reconcile([]).pass, false);
  assert.equal(G.reconcile([{ answer: { a: 1 }, confidence: 0.8 }, { answer: { a: 1 }, confidence: 0.8 }]).answer.a, 1, "answers may be objects");
});

test("decide: under 75% the safe outcome applies and does not escalate; the split is recorded even when no agent can run; over budget is said", () => {
  const d = G.decide({ fn: "authentication", initial: { answer: "pass", confidence: 0.5, evidence: ["label"], reasoning: "label read" }, agentsAvailable: false, startedAt: 0, now: 1000 });
  assert.equal(d.outcome, "safe"); assert.equal(d.safeOutcome, G.FUNCTIONS.authentication.safe);
  assert.deepEqual(d.split, { agents: 2, shares: [10000, 10000], ran: false, available: false, reconciled: null });
  assert.match(d.reasoning, /no agent is available \(no model keyed\)/);
  assert.equal(d.withinBudget, true);
  const strong = G.decide({ fn: "tagging", initial: { answer: "house", confidence: 0.3 }, agentAnswers: Array.from({ length: 3 }, (_, i) => ({ answer: "house", confidence: 0.7, evidence: ["e" + i] })), startedAt: 0, now: 400_000 });
  assert.equal(strong.outcome, "resolved"); assert.equal(strong.confidence, 0.9); assert.equal(strong.split.ran, true);
  assert.equal(strong.withinBudget, false); assert.match(strong.reasoning, /over the 5-minute task budget/);
  const certain = G.decide({ fn: "tagging", initial: { answer: "x", confidence: 0.2 }, adminConfirmed: true });
  assert.equal(certain.confidence, 1); assert.equal(certain.outcome, "resolved");
  assert.equal(G.decide({ fn: "valuation", initial: { confidence: 0.99 } }).confidence, 0.9, "the initial pass is capped too");
  assert.throws(() => G.decide({ fn: "oracle", initial: {} }), /no such ASTERISK function/);
});

test("what reaches an admin: fraud, a high-value threshold the admins set, a dispute, a conflict, a sample; only fraud and high value alert", () => {
  assert.deepEqual(G.needsAdmin({}), { admin: false, alert: false, reasons: [] });
  assert.deepEqual(G.needsAdmin({ fraudFlag: true }), { admin: true, alert: true, reasons: ["fraud flag"] });
  const hv = G.needsAdmin({ value: 2000, category: "outerwear", thresholds: { outerwear: 1500 } });
  assert.equal(hv.alert, true); assert.match(hv.reasons[0], /high value/);
  assert.equal(G.needsAdmin({ value: 2000, category: "tops", thresholds: { outerwear: 1500 } }).admin, false, "no threshold for the category, no gate");
  const quiet = G.needsAdmin({ dispute: true, conflict: true, sample: true });
  assert.equal(quiet.admin, true); assert.equal(quiet.alert, false); assert.equal(quiet.reasons.length, 3);
  const sorted = G.orderQueue([{ id: "a", value: 10, at: "2026-10-17T00:00:00Z" }, { id: "b", fraud: true, value: 1, at: "2026-10-17T05:00:00Z" }, { id: "c", value: 500, at: "2026-10-17T03:00:00Z" }, { id: "d", value: 500, at: "2026-10-16T03:00:00Z" }]);
  assert.deepEqual(sorted.map((r) => r.id), ["b", "d", "c", "a"], "fraud, then value, then the older first");
  const drawn = Array.from({ length: 5000 }, (_, i) => G.drawSample("case-" + i)).filter(Boolean).length;
  assert.ok(drawn > 50 && drawn < 150, `≈2% of 5000 drawn, got ${drawn}`);
  assert.equal(G.drawSample("x"), G.drawSample("x"), "deterministic");
});

test("calibration: a band means what it says only over enough cases; thin bands are unmeasured, never assumed right", () => {
  const right = Array.from({ length: 40 }, (_, i) => ({ confidence: 0.8, correct: i % 5 !== 0 }));
  const c = G.calibrate(right);
  const band = c.bands.find((b) => b.band === "75-90");
  assert.equal(band.n, 40); assert.equal(band.stated, 0.8); assert.equal(band.observed, 0.8); assert.equal(band.meansWhatItSays, true);
  const wrong = G.calibrate(Array.from({ length: 40 }, () => ({ confidence: 0.85, correct: false })));
  assert.equal(wrong.bands.find((b) => b.band === "75-90").meansWhatItSays, false);
  assert.ok(wrong.ece > 0.8);
  const thin = G.calibrate(Array.from({ length: 5 }, () => ({ confidence: 0.6, correct: true })));
  assert.equal(thin.bands.find((b) => b.band === "50-65").measured, false);
  assert.equal(thin.bands.find((b) => b.band === "50-65").meansWhatItSays, null);
  assert.equal(thin.ece, null); assert.equal(thin.measured, false);
});

test("audits grade a function; two poor grades in a row hand it to the queue; a pass lifts it; unmeasured changes nothing", () => {
  const decisions = (n, overridden, over = 0) => Array.from({ length: n }, (_, i) => ({ overridden: i < overridden, withinBudget: i >= over, cost: { tokensUsed: 120 } }));
  assert.equal(G.auditFunction("tagging", { decisions: decisions(100, 1) }).grade, "A");
  assert.equal(G.auditFunction("tagging", { decisions: decisions(100, 4) }).grade, "B");
  assert.equal(G.auditFunction("tagging", { decisions: decisions(100, 15) }).grade, "D");
  assert.equal(G.auditFunction("tagging", { decisions: decisions(100, 30) }).grade, "F");
  assert.equal(G.auditFunction("tagging", { decisions: decisions(100, 0, 30) }).grade, "F", "productivity counts: over budget on 30%");
  const thin = G.auditFunction("tagging", { decisions: decisions(5, 0) });
  assert.equal(thin.grade, "U"); assert.equal(thin.unmeasured, true); assert.equal(thin.poor, false);
  const a = G.auditFunction("tagging", { decisions: decisions(50, 2), backlog: 3 });
  assert.equal(a.productivity.costPerTask, 120); assert.equal(a.productivity.backlog, 3); assert.equal(a.accuracy.overrideRate, 0.04);
  assert.equal(a.complexSearch, null, "not invented for a function that is not search");
  assert.deepEqual(G.auditFunction("search", { decisions: decisions(20, 0), search: { relevanceOrder: 0.9, constraintRespect: 1, instrument: "honesty" } }).complexSearch, { relevanceOrder: 0.9, constraintRespect: 1, instrument: "honesty" });
  const one = G.standingAfter({}, "D");
  assert.deepEqual(one, { grade: "D", consecutivePoor: 1, handed: false, changed: true });
  const two = G.standingAfter(one, "F");
  assert.equal(two.handed, true); assert.equal(two.consecutivePoor, 2);
  const lifted = G.standingAfter(two, "B");
  assert.deepEqual(lifted, { grade: "B", consecutivePoor: 0, handed: false, changed: true });
  assert.deepEqual(G.standingAfter(two, "U"), { grade: "F", consecutivePoor: 2, handed: true, changed: false });
});

test("the rows: pause and resume; the ledger with overrides as ground truth; the queue decided once; the replica library empty until an admin confirms", async () => {
  const s0 = await rows.getFunctionState("tagging");
  assert.equal(s0.paused, false); assert.equal(s0.grade, "U");
  const paused = await rows.setFunctionPaused("tagging", true, { actor: "op", note: "drift" });
  assert.equal(paused.paused, true); assert.equal(paused.pausedBy, "op"); assert.equal(await rows.isFunctionPaused("tagging"), true);
  assert.equal((await rows.setFunctionPaused("tagging", false)).paused, false);
  await assert.rejects(() => rows.setFunctionPaused("oracle", true), /no such ASTERISK function/);
  const d = G.decide({ fn: "tagging", initial: { answer: "house", confidence: 0.5, evidence: ["title"], reasoning: "r" }, subject: "p1", kind: "tag-audit" });
  const a = await rows.recordAsteriskAction(d);
  assert.equal(a.actor, "asterisk"); assert.equal(a.outcome, "safe"); assert.equal(a.subjectId, "p1"); assert.deepEqual(a.decision.evidence, ["title"]);
  const o = await rows.overrideAsteriskAction(a.id, { outcome: { answer: "maker" }, note: "label seen", actor: "op" });
  assert.equal(o.ok, true); assert.equal(o.action.actor, "admin"); assert.equal(o.action.groundTruth, true); assert.equal(o.action.overrides, a.id); assert.equal(o.action.confidence, 1);
  assert.equal((await rows.getAsteriskAction(a.id)).overridden, true);
  assert.equal((await rows.overrideAsteriskAction(a.id, { outcome: { answer: "x" } })).ok, false, "an override of an override names the override");
  assert.equal((await rows.overrideAsteriskAction("999", { outcome: {} })).ok, false);
  const list = await rows.listAsteriskActions({ fn: "tagging" });
  assert.equal(list.length, 2); assert.equal(list[0].actor, "admin", "newest first"); assert.equal(list[1].overridden, true);
  const c = await rows.enqueueAdminCase({ fn: "authentication", subjectId: "i1", reason: "fraud flag", reasons: ["fraud flag"], alert: true, fraud: true, value: 900 });
  await rows.enqueueAdminCase({ fn: "authentication", subjectId: "i2", reason: "audit sample", value: 5000 });
  const open = await rows.listAdminQueue();
  assert.deepEqual(open.map((x) => x.subjectId), ["i1", "i2"], "fraud before value");
  assert.deepEqual(await rows.countOpenQueue(), { tagging: 0, authentication: 2, valuation: 0, sizing: 0, search: 0, exploration: 0, moderation: 0 });
  assert.equal((await rows.decideAdminCase(c.id, { decision: { word: "confirmed replica" }, actor: "op" })).ok, true);
  assert.equal((await rows.decideAdminCase(c.id, { decision: { word: "again" } })).ok, false, "decided once");
  assert.equal((await rows.listAdminQueue()).length, 1);
  assert.deepEqual(await rows.listReplicaPatterns(), [], "the library ships empty");
  const r = await rows.confirmReplicaPattern({ house: "Schott", pattern: "wrong stitch", actor: "op" });
  assert.equal(r.ok, true); assert.equal(r.existed, false);
  assert.equal((await rows.confirmReplicaPattern({ house: "schott", pattern: "wrong stitch" })).existed, true);
  assert.equal((await rows.confirmReplicaPattern({ house: "", pattern: "x" })).ok, false);
  assert.equal((await rows.listReplicaPatterns({ house: "SCHOTT" })).length, 1);
  const st = await rows.setFunctionStanding("tagging", { grade: "D", consecutivePoor: 1, handed: false, audit: { grade: "D" } });
  assert.equal(st.grade, "D"); assert.ok(st.auditedAt);
  const set = await rows.setFunctionSettings("authentication", { highValue: { outerwear: 1500 } });
  assert.deepEqual(set.settings.highValue, { outerwear: 1500 });
});

test("the governor: a paused function does no work and queues the task; a decision is logged before the caller acts; fraud and high value reach the queue with an alert", async () => {
  let ran = 0;
  await rows.setFunctionPaused("authentication", true, { actor: "op" });
  const q = await govern("authentication", { kind: "pass", subject: "i1", value: 100 }, { initial: async () => { ran++; return { answer: "pass", confidence: 0.8 }; } });
  assert.equal(q.queued, true); assert.equal(ran, 0, "the pass did not run"); assert.equal(q.case.reason, "function paused");
  assert.equal((await rows.listAsteriskActions())[0].outcome, "queued", "the refusal is on the ledger");
  await rows.setFunctionPaused("authentication", false);
  await rows.setFunctionSettings("authentication", { highValue: { outerwear: 1500 } });
  const g = await govern("authentication", { kind: "pass", subject: "i2", value: 2000, category: "outerwear" }, { initial: async () => ({ answer: "pass", confidence: 0.95, evidence: ["label", "serial"], reasoning: "checklist", tokens: 300 }) });
  assert.equal(g.queued, false); assert.equal(g.decision.confidence, 0.9, "capped"); assert.equal(g.decision.outcome, "resolved");
  assert.ok(g.action && g.action.id); assert.equal(g.gate.alert, true); assert.match(g.gate.reasons[0], /high value/);
  assert.equal(g.case.alert, true); assert.equal(g.case.payload.actionId, g.action.id);
  assert.deepEqual(g.initial.evidence, ["label", "serial"], "the pass rides back whole");
  // the split runs blind agents with their shares and reconciles after all answered
  const asked = [];
  const s = await govern("tagging", { kind: "tag-audit", subject: "p1", tokenBudget: 3000 }, {
    initial: async () => ({ answer: "house", confidence: 0.2, evidence: ["title"] }),
    agents: async (i, share) => { asked.push(share); return { answer: "house", confidence: 0.7, evidence: ["agent-" + i], tokens: 10 }; },
  });
  assert.equal(asked.length, 4); assert.equal(asked.reduce((a, b) => a + b, 0), 3000);
  assert.equal(s.decision.split.ran, true); assert.equal(s.decision.outcome, "resolved"); assert.equal(s.decision.cost.tokensUsed, 40);
  // handed after two poor audits: the same as paused
  await rows.setFunctionStanding("tagging", { grade: "F", consecutivePoor: 2, handed: true });
  const h = await govern("tagging", { kind: "tag-audit", subject: "p2" }, { initial: async () => ({ answer: "x", confidence: 0.9 }) });
  assert.equal(h.queued, true); assert.match(h.reason, /handed/);
  // a conflict the pass itself reports reaches the queue without an alert
  await rows.setFunctionStanding("tagging", { grade: "B", consecutivePoor: 0, handed: false });
  const c = await govern("tagging", { kind: "tag-audit", subject: "p3" }, { initial: async () => ({ answer: "review", confidence: 0.6, conflict: true }) });
  assert.equal(c.gate.admin, true); assert.equal(c.gate.alert, false); assert.deepEqual(c.gate.reasons, ["conflict ASTERISK cannot resolve safely"]);
});
