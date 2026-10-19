// tests/helpers/governance-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice
// 5). Run with DATABASE_URL empty for the memory store, set for Postgres;
// prints one JSON line both runs must agree on. The Postgres run writes real
// rows under a run-unique subject and does not delete them: the ledger is
// append-only by design (the runtime role has no DELETE), and a test row
// named `gov-test-<run>` is the honest trace of a differential that ran.
import { randomUUID } from "node:crypto";
import * as rows from "../../lib/db/production/asterisk.js";
import { decide } from "../../lib/asterisk/governance.js";
import { govern } from "../../lib/asterisk/governor.js";

const run = process.argv[2] || randomUUID().slice(0, 8);
const subject = `gov-test-${run}`;
const fn = "valuation"; // a function nothing in production governs yet, so a test pause touches no live task

const out = {};
try {
  const before = await rows.getFunctionState(fn);
  out.defaultState = { paused: before.paused, grade: before.grade, handed: before.handed };
  const d = decide({ fn, initial: { answer: "range", confidence: 0.5, evidence: ["comparable:" + run], reasoning: "scenario" }, subject, kind: "scenario", startedAt: 0, now: 10 });
  const a = await rows.recordAsteriskAction(d);
  // The subject and the evidence carry this run's id, which differs between
  // the two runs by design; print them with the id written as <run> so the
  // comparison still pins exactly what each backend stored and nothing else.
  const unrun = (s) => String(s).split(run).join("<run>");
  out.recorded = { actor: a.actor, outcome: a.outcome, confidence: a.confidence, subject: unrun(a.subjectId), evidence: a.decision.evidence.map(unrun), groundTruth: a.groundTruth };
  const o = await rows.overrideAsteriskAction(a.id, { outcome: { answer: "fixed" }, note: "scenario", actor: "scenario" });
  out.override = { ok: o.ok, actor: o.action.actor, groundTruth: o.action.groundTruth, confidence: o.action.confidence, supersedesMatches: o.supersedes === a.id, outcome: o.action.outcome };
  out.overrideTwice = (await rows.overrideAsteriskAction(a.id, { outcome: { answer: "x" } })).ok;
  const got = await rows.getAsteriskAction(a.id);
  out.overridden = { overridden: got.overridden, byMatches: got.overriddenBy === o.action.id };
  const listed = (await rows.listAsteriskActions({ fn, limit: 50 })).filter((r) => r.subjectId === subject);
  out.listed = { count: listed.length, order: listed.map((r) => r.actor), newestOverridden: listed[0].overridden, oldestOverridden: listed[1].overridden };
  const q1 = await rows.enqueueAdminCase({ fn, subjectId: subject + "-a", reason: "audit sample", value: 10 });
  const q2 = await rows.enqueueAdminCase({ fn, subjectId: subject + "-b", reason: "fraud flag", reasons: ["fraud flag"], fraud: true, alert: true, value: 1 });
  const open = (await rows.listAdminQueue({ fn, status: "open", limit: 500 })).filter((c) => c.subjectId.startsWith(subject));
  out.queueOrder = open.map((c) => c.subjectId.slice(subject.length));
  out.decide = (await rows.decideAdminCase(q1.id, { decision: { word: "ok" }, actor: "scenario" })).ok;
  out.decideTwice = (await rows.decideAdminCase(q1.id, { decision: { word: "again" } })).ok;
  out.decided = (await rows.listAdminQueue({ fn, status: "decided", limit: 500 })).some((c) => c.id === q1.id);
  await rows.decideAdminCase(q2.id, { decision: { word: "ok" }, actor: "scenario" });
  const lib = await rows.confirmReplicaPattern({ house: "Scenario House " + run, pattern: "scenario stitch", actor: "scenario" });
  out.replica = { ok: lib.ok, existed: lib.existed, again: (await rows.confirmReplicaPattern({ house: "scenario house " + run, pattern: "scenario stitch" })).existed, listed: (await rows.listReplicaPatterns({ house: "Scenario House " + run })).length };
  // the governor under a pause: the task is queued, the refusal logged, the pass never runs
  await rows.setFunctionPaused(fn, true, { actor: "scenario", note: "differential" });
  let ran = 0;
  const g = await govern(fn, { kind: "scenario", subject: subject + "-paused" }, { initial: async () => { ran++; return { answer: "x", confidence: 0.9 }; } });
  out.paused = { queued: g.queued, ran, reason: g.reason, caseFn: g.case && g.case.function };
  const resumed = await rows.setFunctionPaused(fn, false);
  out.resumed = { paused: resumed.paused, pausedBy: resumed.pausedBy };
  const pausedCase = (await rows.listAdminQueue({ fn, status: "open", limit: 500 })).find((c) => c.subjectId === subject + "-paused");
  if (pausedCase) await rows.decideAdminCase(pausedCase.id, { decision: { word: "scenario cleanup" }, actor: "scenario" });
  const st = await rows.setFunctionStanding(fn, { grade: "U", consecutivePoor: 0, handed: false, audit: null });
  out.standing = { grade: st.grade, handed: st.handed };
} catch (err) {
  out.error = String(err && err.message || err);
}
process.stdout.write(JSON.stringify(out) + "\n");
