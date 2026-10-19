// lib/asterisk/governor.js — RUN A TASK UNDER GOVERNANCE (V.2 Blueprint,
// Part I "ASTERISK governance"; slice 5). SERVER-ONLY: the glue between the
// pure policy (governance.js) and the rows (lib/db/production/asterisk.js).
//
// `govern(fn, task, run)`:
//   1. A PAUSED FUNCTION DOES NO WORK. Its task goes to the admin queue
//      (payload intact) and the caller gets `{ queued: true }` — the
//      function falls back to its last admin-approved state by doing
//      nothing new. A function whose audit HANDED its decisions to the
//      queue is treated the same.
//   2. The initial pass runs. Under 65% the split is due: with an agent
//      factory the blind agents run, each with its share of the budget,
//      and are reconciled only after all have answered; without one the
//      split is recorded as unavailable and the safe outcome applies.
//   3. The decision is logged with its evidence, confidence and reasoning —
//      EVERY action, before the caller acts on it.
//   4. What must reach an admin (a fraud flag, a high-value authentication,
//      a dispute, a conflict, an audit sample) is queued; fraud and high
//      value alert, the rest wait.
//
// The caller receives the decision and applies it: the governor never
// writes a tag or a verification row itself.

import { decide, needsAdmin, drawSample, isFunction, SPLIT_UNDER, agentsFor, budgetShares, DEFAULT_TOKEN_BUDGET } from "./governance.js";
import { getFunctionState, recordAsteriskAction, enqueueAdminCase } from "../db/production/asterisk.js";

/**
 * @param {string} fn        a FUNCTION id
 * @param {object} task      { kind, subject, value, category, dispute, conflict, payload, tokenBudget }
 * @param {object} run       { initial: async () => ({ answer, confidence, evidence, reasoning, tokens, fraud }),
 *                             agents?: async (i, share) => ({ answer, confidence, evidence, tokens }) }
 */
export async function govern(fn, task = {}, run = {}, { now = Date.now, actor = "asterisk" } = {}) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  const startedAt = now();
  let state = null;
  try { state = await getFunctionState(fn); } catch { state = null; }
  const paused = !!(state && state.paused), handed = !!(state && state.handed);
  if (paused || handed) {
    const reason = paused ? "function paused" : "function handed to the admin queue after two poor audits";
    let queued = null;
    try {
      queued = await enqueueAdminCase({ fn, subjectId: task.subject ?? null, reason, reasons: [reason], alert: false, fraud: false, value: task.value ?? null, payload: { kind: task.kind || null, ...(task.payload || {}) }, now: startedAt });
      await recordAsteriskAction({ function: fn, kind: task.kind || null, subject: task.subject ?? null, outcome: "queued", confidence: null, evidence: [], reasoning: reason, split: null, cost: { tokenBudget: 0, tokensUsed: 0 } }, { now: startedAt });
    } catch { /* an unapplied ledger must not stop the honest refusal */ }
    return { queued: true, reason, case: queued, decision: null };
  }
  const initial = await run.initial();
  let agentAnswers = null, agentsAvailable = typeof run.agents === "function";
  const tokenBudget = Number(task.tokenBudget) || DEFAULT_TOKEN_BUDGET;
  let tokensUsed = Number(initial.tokens) || 0;
  const due = agentsFor(initial.confidence);
  if (due > 0 && agentsAvailable) {
    const shares = budgetShares(tokenBudget, due);
    // BLIND AND INDEPENDENT: every agent is asked before any answer is read.
    const settled = await Promise.allSettled(shares.map((share, i) => run.agents(i, share)));
    agentAnswers = settled.filter((s) => s.status === "fulfilled" && s.value && s.value.answer != null).map((s) => s.value);
    tokensUsed += agentAnswers.reduce((sum, a) => sum + (Number(a.tokens) || 0), 0);
    if (!agentAnswers.length) agentsAvailable = false;
  }
  const decision = decide({
    fn, initial, agentAnswers, agentsAvailable, startedAt, now: now(), tokenBudget, tokensUsed,
    subject: task.subject ?? null, kind: task.kind || null,
  });
  let action = null;
  try { action = await recordAsteriskAction(decision); } catch { action = null; }
  const gate = needsAdmin({
    fraudFlag: !!initial.fraud, value: task.value ?? null, category: task.category || null,
    thresholds: (state && state.settings && state.settings.highValue) || {},
    dispute: !!task.dispute, conflict: !!task.conflict || !!initial.conflict,
    sample: action ? drawSample(action.id) : false,
  });
  let queued = null;
  if (gate.admin) {
    try {
      queued = await enqueueAdminCase({ fn, subjectId: task.subject ?? null, reason: gate.reasons[0], reasons: gate.reasons, alert: gate.alert, fraud: !!initial.fraud, value: task.value ?? null, payload: { kind: task.kind || null, actionId: action ? action.id : null, ...(task.payload || {}) }, now: now() });
    } catch { queued = null; }
  }
  void SPLIT_UNDER; void actor;
  // `initial` rides back whole: the caller's pass may carry what it computed
  // (the checks, the audit) so nothing is run twice or smuggled through the log.
  return { queued: false, decision, action, gate, case: queued, initial };
}
