// lib/db/production/asterisk.js — ASTERISK GOVERNANCE'S ROWS (V.2 Blueprint,
// Part I "ASTERISK governance"; schema v63). SERVER-ONLY; memory mode
// mirrors every function so mem and Postgres agree (the differential is in
// tests/postgres-integration.test.js). v63 may be unapplied where this
// runs — readers answer defaults, writers refuse by name.
//
//   function state   paused / standing / settings, one row per function
//   actions          APPEND-ONLY: a governed decision, or an admin override
//                    that names the row it supersedes and is ground truth
//   queue            what reaches an admin; decided in place
//   replica library  admin-confirmed patterns per house; seeded empty

import { getPool, hasRelation } from "../core/pool.js";
import { FUNCTION_IDS, isFunction, orderQueue } from "../../asterisk/governance.js";

const mem = { states: new Map(), actions: [], queue: [], replicas: [], seq: 1 };
const applied = async (p) => (p ? hasRelation(p, "asterisk_actions") : true);
const needs = () => { throw new Error("ASTERISK governance needs schema v63 applied"); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const defaultState = (fn) => ({ function: fn, paused: false, pausedBy: null, pausedAt: null, pauseNote: null, grade: "U", consecutivePoor: 0, handed: false, auditedAt: null, audit: null, settings: {} });
const stateOut = (r) => ({
  function: r.function, paused: !!r.paused, pausedBy: r.paused_by || null, pausedAt: iso(r.paused_at), pauseNote: r.pause_note || null,
  grade: r.grade || "U", consecutivePoor: Number(r.consecutive_poor) || 0, handed: !!r.handed, auditedAt: iso(r.audited_at),
  audit: r.audit ? json(r.audit) : null, settings: r.settings ? json(r.settings) : {},
});
const actionOut = (r) => ({
  id: String(r.id), at: iso(r.at), function: r.function, kind: r.kind || null, subjectId: r.subject_id || null, actor: r.actor,
  outcome: r.outcome, confidence: r.confidence == null ? null : Number(r.confidence), decision: json(r.decision),
  overrides: r.overrides == null ? null : String(r.overrides), groundTruth: !!r.ground_truth, note: r.note || null,
});
const queueOut = (r) => ({
  id: String(r.id), at: iso(r.at), function: r.function, subjectId: r.subject_id || null, reason: r.reason, reasons: json(r.reasons) || [],
  alert: !!r.alert, fraud: !!r.fraud, value: r.value == null ? null : Number(r.value), payload: json(r.payload) || {},
  status: r.status, decidedBy: r.decided_by || null, decidedAt: iso(r.decided_at), decision: r.decision ? json(r.decision) : null,
});
const replicaOut = (r) => ({ id: String(r.id), at: iso(r.at), house: r.house, pattern: r.pattern, confirmedBy: r.confirmed_by, note: r.note || null });

// ---- function state --------------------------------------------------------------

/** Every function's state, defaults where no row exists. */
export async function getFunctionStates() {
  const p = await getPool();
  const out = new Map(FUNCTION_IDS.map((fn) => [fn, defaultState(fn)]));
  if (!(await applied(p))) return out;
  if (!p) { for (const [fn, s] of mem.states) out.set(fn, { ...s }); return out; }
  const { rows } = await p.query("SELECT * FROM asterisk_function_state");
  for (const r of rows) out.set(r.function, stateOut(r));
  return out;
}

export async function getFunctionState(fn) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  return (await getFunctionStates()).get(fn);
}

/** Is this function paused? A read every governed task makes first. */
export async function isFunctionPaused(fn) {
  try { return !!(await getFunctionState(fn)).paused; } catch { return false; }
}

async function upsertState(fn, patch) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const cur = mem.states.get(fn) || defaultState(fn);
    const next = { ...cur, ...patch };
    mem.states.set(fn, next);
    return { ...next };
  }
  const cur = (await getFunctionStates()).get(fn);
  const next = { ...cur, ...patch };
  const { rows } = await p.query(
    `INSERT INTO asterisk_function_state (function, paused, paused_by, paused_at, pause_note, grade, consecutive_poor, handed, audited_at, audit, settings, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (function) DO UPDATE SET paused=EXCLUDED.paused, paused_by=EXCLUDED.paused_by, paused_at=EXCLUDED.paused_at, pause_note=EXCLUDED.pause_note,
       grade=EXCLUDED.grade, consecutive_poor=EXCLUDED.consecutive_poor, handed=EXCLUDED.handed, audited_at=EXCLUDED.audited_at, audit=EXCLUDED.audit, settings=EXCLUDED.settings, updated_at=now()
     RETURNING *`,
    [fn, next.paused, next.pausedBy, next.pausedAt, next.pauseNote, next.grade, next.consecutivePoor, next.handed, next.auditedAt, next.audit ? JSON.stringify(next.audit) : null, JSON.stringify(next.settings || {})]);
  return stateOut(rows[0]);
}

/** Pause or resume one function. The pause takes effect on the next task. */
export async function setFunctionPaused(fn, paused, { actor = "admin", note = null, now = Date.now() } = {}) {
  return upsertState(fn, paused
    ? { paused: true, pausedBy: actor, pausedAt: new Date(now).toISOString(), pauseNote: note }
    : { paused: false, pausedBy: null, pausedAt: null, pauseNote: null });
}

/** Record an audit's result and the standing it produced. */
export async function setFunctionStanding(fn, { grade, consecutivePoor, handed, audit = null, now = Date.now() }) {
  return upsertState(fn, { grade, consecutivePoor, handed, audit, auditedAt: new Date(now).toISOString() });
}

/** The admins' settings for a function (high-value thresholds live under authentication). */
export async function setFunctionSettings(fn, settings) {
  const cur = await getFunctionState(fn);
  return upsertState(fn, { settings: { ...(cur.settings || {}), ...(settings || {}) } });
}

// ---- the action ledger ------------------------------------------------------------

/** Append a governed decision (actor asterisk). `decision` is decide()'s record. */
export async function recordAsteriskAction(decision, { now = Date.now() } = {}) {
  if (!decision || !isFunction(decision.function)) throw new Error("a decision names its function");
  const outcome = decision.outcome === "queued" ? "queued" : decision.outcome === "safe" ? "safe" : "resolved";
  return appendAction({ function: decision.function, kind: decision.kind || null, subjectId: decision.subject || null, actor: "asterisk", outcome, confidence: decision.confidence ?? null, decision, overrides: null, groundTruth: false, note: null, now });
}

async function appendAction(a) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const row = { id: mem.seq++, at: new Date(a.now).toISOString(), function: a.function, kind: a.kind, subject_id: a.subjectId, actor: a.actor, outcome: a.outcome, confidence: a.confidence, decision: a.decision, overrides: a.overrides, ground_truth: a.groundTruth, note: a.note };
    mem.actions.push(row);
    return actionOut(row);
  }
  const { rows } = await p.query(
    `INSERT INTO asterisk_actions (at, function, kind, subject_id, actor, outcome, confidence, decision, overrides, ground_truth, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [new Date(a.now).toISOString(), a.function, a.kind, a.subjectId, a.actor, a.outcome, a.confidence, JSON.stringify(a.decision), a.overrides, a.groundTruth, a.note]);
  return actionOut(rows[0]);
}

/** One action by id, with whether an override supersedes it. */
export async function getAsteriskAction(id) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  const key = String(id || "");
  if (!p) {
    const row = mem.actions.find((r) => String(r.id) === key);
    if (!row) return null;
    const over = mem.actions.find((r) => String(r.overrides) === key);
    return { ...actionOut(row), overridden: !!over, overriddenBy: over ? String(over.id) : null };
  }
  const { rows } = await p.query(
    `SELECT a.*, o.id AS overridden_by FROM asterisk_actions a LEFT JOIN asterisk_actions o ON o.overrides = a.id WHERE a.id = $1 LIMIT 1`, [Number(key) || 0]);
  if (!rows[0]) return null;
  return { ...actionOut(rows[0]), overridden: rows[0].overridden_by != null, overriddenBy: rows[0].overridden_by == null ? null : String(rows[0].overridden_by) };
}

/** The ledger, newest first, optionally one function's. Each row says whether an override supersedes it. */
export async function listAsteriskActions({ fn = null, limit = 50, since = null } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  if (!p) {
    const overridden = new Map();
    for (const r of mem.actions) if (r.overrides != null) overridden.set(String(r.overrides), String(r.id));
    return mem.actions.filter((r) => (!fn || r.function === fn) && (!since || Date.parse(r.at) >= Date.parse(since)))
      .slice().reverse().slice(0, lim).map((r) => ({ ...actionOut(r), overridden: overridden.has(String(r.id)), overriddenBy: overridden.get(String(r.id)) || null }));
  }
  const { rows } = await p.query(
    `SELECT a.*, o.id AS overridden_by FROM asterisk_actions a LEFT JOIN asterisk_actions o ON o.overrides = a.id
      WHERE ($1::text IS NULL OR a.function = $1) AND ($2::timestamptz IS NULL OR a.at >= $2)
      ORDER BY a.at DESC, a.id DESC LIMIT $3`, [fn, since ? new Date(since).toISOString() : null, lim]);
  return rows.map((r) => ({ ...actionOut(r), overridden: r.overridden_by != null, overriddenBy: r.overridden_by == null ? null : String(r.overridden_by) }));
}

/**
 * An admin override: a NEW row (actor admin, ground truth) naming the row it
 * supersedes. Refused for a row that does not exist or is already overridden
 * — an override of an override names the override.
 */
export async function overrideAsteriskAction(id, { outcome, note = null, actor = "admin", now = Date.now() } = {}) {
  const prior = await getAsteriskAction(id);
  if (!prior) return { ok: false, reason: "no such action" };
  if (prior.overridden) return { ok: false, reason: `already overridden by ${prior.overriddenBy}` };
  if (!outcome || typeof outcome !== "object") return { ok: false, reason: "an override states the outcome" };
  const decision = { ...prior.decision, answer: outcome.answer ?? prior.decision?.answer ?? null, confidence: 1, outcome: "overridden", adminConfirmed: true,
    reasoning: `admin override by ${actor}${note ? ": " + note : ""} (supersedes ${prior.id})`, overrideOf: prior.id, overrideOutcome: outcome };
  const row = await appendAction({ function: prior.function, kind: prior.kind, subjectId: prior.subjectId, actor: "admin", outcome: "overridden", confidence: 1, decision, overrides: Number(prior.id), groundTruth: true, note, now });
  return { ok: true, action: row, supersedes: prior.id };
}

// ---- the admin queue ----------------------------------------------------------------

export async function enqueueAdminCase({ fn, subjectId = null, reason, reasons = [], alert = false, fraud = false, value = null, payload = {}, now = Date.now() }) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const row = { id: mem.seq++, at: new Date(now).toISOString(), function: fn, subject_id: subjectId, reason: String(reason || reasons[0] || "review"), reasons, alert: !!alert, fraud: !!fraud, value, payload, status: "open", decided_by: null, decided_at: null, decision: null };
    mem.queue.push(row);
    return queueOut(row);
  }
  const { rows } = await p.query(
    `INSERT INTO asterisk_queue (at, function, subject_id, reason, reasons, alert, fraud, value, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [new Date(now).toISOString(), fn, subjectId, String(reason || reasons[0] || "review"), JSON.stringify(reasons || []), !!alert, !!fraud, value, JSON.stringify(payload || {})]);
  return queueOut(rows[0]);
}

/** The queue in the blueprint's order: fraud, value, age. */
export async function listAdminQueue({ status = "open", fn = null, limit = 100 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  let rows;
  if (!p) rows = mem.queue.filter((r) => (status === "all" || r.status === status) && (!fn || r.function === fn)).map(queueOut);
  else {
    const res = await p.query(
      `SELECT * FROM asterisk_queue WHERE ($1 = 'all' OR status = $1) AND ($2::text IS NULL OR function = $2) ORDER BY at DESC LIMIT $3`, [status, fn, lim * 4]);
    rows = res.rows.map(queueOut);
  }
  return (status === "open" ? orderQueue(rows) : rows).slice(0, lim);
}

export async function countOpenQueue() {
  const open = await listAdminQueue({ status: "open", limit: 500 });
  const out = Object.fromEntries(FUNCTION_IDS.map((fn) => [fn, 0]));
  for (const r of open) out[r.function] = (out[r.function] || 0) + 1;
  return out;
}

/** Decide one case in place; a decided case stays decided. */
export async function decideAdminCase(id, { decision, actor = "admin", now = Date.now() } = {}) {
  const p = await getPool();
  if (!(await applied(p))) needs();
  const key = String(id || "");
  if (!decision || typeof decision !== "object") return { ok: false, reason: "a decision is an object" };
  if (!p) {
    const row = mem.queue.find((r) => String(r.id) === key);
    if (!row) return { ok: false, reason: "no such case" };
    if (row.status !== "open") return { ok: false, reason: "already decided" };
    row.status = "decided"; row.decided_by = actor; row.decided_at = new Date(now).toISOString(); row.decision = decision;
    return { ok: true, case: queueOut(row) };
  }
  const { rows } = await p.query(
    `UPDATE asterisk_queue SET status='decided', decided_by=$2, decided_at=$3, decision=$4 WHERE id=$1 AND status='open' RETURNING *`,
    [Number(key) || 0, actor, new Date(now).toISOString(), JSON.stringify(decision)]);
  if (!rows[0]) {
    const exists = await p.query("SELECT 1 FROM asterisk_queue WHERE id=$1", [Number(key) || 0]);
    return { ok: false, reason: exists.rows[0] ? "already decided" : "no such case" };
  }
  return { ok: true, case: queueOut(rows[0]) };
}

// ---- the replica library -----------------------------------------------------------

export async function listReplicaPatterns({ house = null } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  const h = house ? String(house).trim().toLowerCase() : null;
  if (!p) return mem.replicas.filter((r) => !h || r.house.toLowerCase() === h).map(replicaOut);
  const { rows } = await p.query(`SELECT * FROM replica_patterns WHERE ($1::text IS NULL OR lower(house) = $1) ORDER BY at DESC LIMIT 500`, [h]);
  return rows.map(replicaOut);
}

/** An admin confirms a replica pattern for a house. Idempotent on (house, pattern). */
export async function confirmReplicaPattern({ house, pattern, actor = "admin", note = null, now = Date.now() }) {
  const h = String(house || "").trim(), pat = String(pattern || "").trim();
  if (!h || pat.length < 3 || pat.length > 200) return { ok: false, reason: "a house and a pattern of 3–200 characters" };
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const existing = mem.replicas.find((r) => r.house.toLowerCase() === h.toLowerCase() && r.pattern === pat);
    if (existing) {
      if (existing.note == null && note != null) existing.note = note; // as Postgres's COALESCE
      return { ok: true, pattern: replicaOut(existing), existed: true };
    }
    const row = { id: mem.seq++, at: new Date(now).toISOString(), house: h, pattern: pat, confirmed_by: actor, note };
    mem.replicas.push(row);
    return { ok: true, pattern: replicaOut(row), existed: false };
  }
  const { rows } = await p.query(
    `INSERT INTO replica_patterns (at, house, pattern, confirmed_by, note) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ((lower(house)), pattern) DO UPDATE SET note = COALESCE(replica_patterns.note, EXCLUDED.note) RETURNING *, (xmax = 0) AS inserted`,
    [new Date(now).toISOString(), h, pat, actor, note]);
  return { ok: true, pattern: replicaOut(rows[0]), existed: !rows[0].inserted };
}

/** Test seam. */
export function resetMemoryAsterisk() { mem.states.clear(); mem.actions.length = 0; mem.queue.length = 0; mem.replicas.length = 0; mem.seq = 1; }
