// lib/asterisk/governance.js — ASTERISK GOVERNANCE, the policy as numbers
// (V.2 Blueprint, owner, 17 Oct 2026, Part I "ASTERISK governance"; Terms
// "ASTERISK confidence" and "ASTERISK audits"; slice 5 of the build order in
// docs/v2/BLUEPRINT-GAP-2026-10-17.md).
//
// ASTERISK runs ASILUM: it tags, authenticates, values, sizes, ranks,
// moderates and explores, and it closes its own cases. Admins sit above it
// and supervise by exception and by audit. This module is PURE — the rules
// a decision has to obey, so a test can hold every one of them; the glue
// that runs a task under them is lib/asterisk/governor.js, the rows are
// lib/db/production/asterisk.js, the console is /admin.
//
// THE RULES, each one a number or a table here and nowhere else:
//
//   THE 90% CAP. ASTERISK never reports more than 90% confidence in
//   anything. The last 10% is a human's; only an admin confirmation makes
//   something certain (`cap`).
//   THE 65% SPLIT. An initial pass under 65% breaks into one to five blind
//   agents, each with its own share of the task's token budget; they are
//   reconciled only after every one has answered (`agentsFor`,
//   `budgetShares`, `reconcile`).
//   COLLECTIVE CONFIDENCE comes from agreement and evidence, not from
//   averaging: five agents at the same answer from different evidence is
//   strong; five at 70% each with different answers is a fail. Done at 75%.
//   FIVE MINUTES per task (`TASK_BUDGET_MS`); authentication has its own
//   clock in lib/verification/ledger.js.
//   SAFE OUTCOMES. Under 75% a function takes its safe outcome and moves
//   on — it does not escalate (`FUNCTIONS[fn].safe`, `decide`).
//   WHAT REACHES AN ADMIN: a fraud flag, a high-value authentication, a
//   dispute, a conflict ASTERISK cannot resolve safely, a random audit
//   sample (`needsAdmin`); the queue orders by value, fraud and age
//   (`orderQueue`); only fraud and high value alert.
//   CALIBRATED, NOT CLAIMED. Stated confidence is measured against admin
//   overrides and audit samples per band (`calibrate`).
//   AUDITS grade each function on productivity, accuracy and complex search
//   handling (`auditFunction`); a poor grade is a defect, two in a row hand
//   the function's decisions to the admin queue until it passes
//   (`standingAfter`).
//
// Nothing here fakes a model. With no agent factory a split is RECORDED as
// unavailable and the safe outcome applies — that is the honest state of a
// deployment with no keyed model, and it is the state production runs in.

export const CONFIDENCE_CAP = 0.9;
export const SPLIT_UNDER = 0.65;
export const COLLECTIVE_BAR = 0.75;
export const MAX_AGENTS = 5;
export const TASK_BUDGET_MS = 5 * 60_000;
export const DEFAULT_TOKEN_BUDGET = 20_000;
/** The audit's random sample of closed cases, drawn continuously. */
export const AUDIT_SAMPLE_RATE = 0.02;

/** The seven functions, each with the safe outcome the blueprint sets. */
export const FUNCTIONS = Object.freeze({
  tagging: {
    label: "TAGS",
    safe: "drop one family down the left-side hierarchy (MAKER → HOUSE → SCENE → AESTHETIC → MATERIAL) until a tag clears 75%; under 75% behind the product; under 50% not written",
    prevents: "tags that don't make sense",
    implementedBy: "lib/tagging/grammar.js visibleTags, checkTag; lib/asterisk/tagAudit.js",
  },
  authentication: {
    label: "AUTHENTICATION",
    safe: "Unverified; never Verified without positive evidence; missing evidence is a request to the seller and pauses the clock",
    prevents: "authenticating replicas",
    implementedBy: "lib/verification/ledger.js badgeFor; lib/verification/replicas.js",
  },
  valuation: {
    label: "VALUATION",
    safe: "widen the range, lower the stated confidence, or fall back to the verified transaction price",
    prevents: "confident wrong prices",
    implementedBy: "declared — the comparables model is roadmap §4.6 (lib/provenance.js stakeOf today)",
  },
  sizing: {
    label: "SIZING",
    safe: "show the tag size only; no ASTERISK size, no fit claim",
    prevents: "fit promises on missing measurements",
    implementedBy: "lib/brain/sizing.js — a size without measurements is the label alone",
  },
  search: {
    label: "SEARCH",
    safe: "neutral relevance ranking with |A| influence reduced for that query",
    prevents: "confidently wrong personalization",
    implementedBy: "lib/asterisk/margin.js EVIDENCE_FLOOR — abstention is a shippable answer",
  },
  exploration: {
    label: "EXPLORATION",
    safe: "hold the branch provisional; do not ramp unfamiliar content on it",
    prevents: "feeds that drift on a guess",
    implementedBy: "declared — the Exploration Active state is slice 10",
  },
  moderation: {
    label: "MODERATION",
    safe: "restrict reach rather than remove; removal needs 75% or a report",
    prevents: "deleting lawful posts",
    implementedBy: "lib/asterisk/tagAudit.js opens a moderation task; product.moderate hidden|flagged, never a delete",
  },
});
export const FUNCTION_IDS = Object.freeze(Object.keys(FUNCTIONS));
export const isFunction = (fn) => Object.prototype.hasOwnProperty.call(FUNCTIONS, String(fn || ""));

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The cap. ASTERISK's own number never passes 0.9; an admin's confirmation
 * is the only thing that makes 1.0.
 */
export function cap(confidence, { adminConfirmed = false } = {}) {
  if (adminConfirmed) return 1;
  return round3(Math.min(CONFIDENCE_CAP, clamp(confidence)));
}

/** How many blind agents an initial pass earns: none at or above 65%, one
 *  to five below it, more the further it fell short. */
export function agentsFor(initialConfidence) {
  const c = clamp(initialConfidence);
  if (c >= SPLIT_UNDER) return 0;
  const shortfall = (SPLIT_UNDER - c) / SPLIT_UNDER;
  return Math.max(1, Math.min(MAX_AGENTS, Math.ceil(shortfall * MAX_AGENTS)));
}

/** Each agent's share of the task's token budget — equal, integer, the
 *  remainder on the first; the shares always sum to the budget. */
export function budgetShares(budget, agents) {
  const n = Math.max(0, Math.floor(Number(agents) || 0));
  const total = Math.max(0, Math.floor(Number(budget) || 0));
  if (!n) return [];
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

const answerKey = (a) => (typeof a === "string" ? a.trim().toLowerCase() : JSON.stringify(a));

/**
 * Reconcile blind answers. `answers`: [{ answer, confidence, evidence: [id] }].
 * The answer with the most agents wins; its collective confidence is the
 * agreeing share × the noisy-or of its DISTINCT evidence (an agent with no
 * evidence named is its own, blind, piece), capped. Five agents, one
 * answer, five pieces of evidence at 0.7 → 0.9; five answers → a fail.
 */
export function reconcile(answers = []) {
  const list = (Array.isArray(answers) ? answers : []).filter((a) => a && a.answer != null);
  if (!list.length) return { answer: null, collective: 0, agreement: 0, agents: 0, distinctEvidence: 0, pass: false };
  const groups = new Map();
  list.forEach((a, i) => {
    const key = answerKey(a.answer);
    const g = groups.get(key) || { answer: a.answer, members: [], evidence: new Map() };
    g.members.push(i);
    const ids = Array.isArray(a.evidence) && a.evidence.length ? a.evidence.map(String) : ["agent:" + i];
    for (const id of ids) g.evidence.set(id, Math.max(g.evidence.get(id) || 0, clamp(a.confidence)));
    groups.set(key, g);
  });
  const score = (g) => {
    let miss = 1;
    for (const c of g.evidence.values()) miss *= 1 - c;
    return (g.members.length / list.length) * (1 - miss);
  };
  let best = null, bestScore = -1;
  for (const g of groups.values()) {
    const s = score(g);
    if (g.members.length > (best ? best.members.length : 0) || (best && g.members.length === best.members.length && s > bestScore)) { best = g; bestScore = s; }
  }
  const collective = cap(bestScore);
  return {
    answer: best.answer, collective, agreement: round3(best.members.length / list.length),
    agents: list.length, distinctEvidence: best.evidence.size, pass: collective >= COLLECTIVE_BAR,
  };
}

/** The safe outcome sentence for a function. */
export function safeOutcomeFor(fn) {
  return isFunction(fn) ? FUNCTIONS[fn].safe : null;
}

/**
 * One governed decision, as a record every action carries: evidence,
 * confidence and reasoning, reviewable in the console. Pure: the caller
 * supplies what the pass and the agents produced.
 *
 * @param {object} p
 * @param {string} p.fn            a FUNCTION id
 * @param {object} p.initial       { answer, confidence, evidence, reasoning }
 * @param {Array}  [p.agentAnswers] the blind agents' answers, when a split ran
 * @param {boolean} [p.agentsAvailable] false when no agent could run (no model)
 * @param {number} p.startedAt, p.now  ms
 * @param {number} [p.tokenBudget], [p.tokensUsed]
 * @param {boolean} [p.adminConfirmed]
 */
export function decide({ fn, initial = {}, agentAnswers = null, agentsAvailable = true, startedAt = Date.now(), now = Date.now(), tokenBudget = DEFAULT_TOKEN_BUDGET, tokensUsed = 0, adminConfirmed = false, subject = null, kind = null } = {}) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  const initialConfidence = cap(initial.confidence);
  const agents = agentsFor(initialConfidence);
  const shares = budgetShares(tokenBudget, agents);
  let reconciled = null;
  let confidence = initialConfidence;
  let answer = initial.answer ?? null;
  if (agents > 0 && Array.isArray(agentAnswers) && agentAnswers.length) {
    reconciled = reconcile(agentAnswers);
    confidence = reconciled.collective;
    answer = reconciled.answer;
  }
  if (adminConfirmed) confidence = 1;
  const elapsedMs = Math.max(0, now - startedAt);
  const withinBudget = elapsedMs <= TASK_BUDGET_MS;
  const resolved = confidence >= COLLECTIVE_BAR || adminConfirmed;
  const outcome = resolved ? "resolved" : "safe";
  const reasoning = [
    initial.reasoning || null,
    agents > 0
      ? (reconciled
        ? `initial pass ${pct(initialConfidence)} < ${pct(SPLIT_UNDER)}: ${reconciled.agents} blind agent(s), ${pct(reconciled.agreement)} agreed on ${reconciled.distinctEvidence} piece(s) of evidence → collective ${pct(confidence)}`
        : `initial pass ${pct(initialConfidence)} < ${pct(SPLIT_UNDER)}: a split of ${agents} was due but ${agentsAvailable ? "no agent answered" : "no agent is available (no model keyed)"} — the safe outcome applies`)
      : `initial pass ${pct(initialConfidence)} ≥ ${pct(SPLIT_UNDER)}: no split`,
    resolved ? (adminConfirmed ? "confirmed by an admin — certain" : `collective ${pct(confidence)} ≥ ${pct(COLLECTIVE_BAR)}: resolved`) : `collective ${pct(confidence)} < ${pct(COLLECTIVE_BAR)}: safe outcome — ${FUNCTIONS[fn].safe}`,
    withinBudget ? null : `over the ${TASK_BUDGET_MS / 60_000}-minute task budget (${Math.round(elapsedMs / 1000)} s)`,
  ].filter(Boolean).join("; ");
  return {
    function: fn, kind: kind || null, subject: subject == null ? null : String(subject),
    answer, initialConfidence, confidence, outcome,
    safeOutcome: resolved ? null : FUNCTIONS[fn].safe,
    split: { agents, shares, ran: !!reconciled, available: agentsAvailable, reconciled },
    evidence: Array.isArray(initial.evidence) ? initial.evidence.slice(0, 40) : [],
    reasoning,
    elapsedMs, withinBudget,
    cost: { tokenBudget, tokensUsed: Math.max(0, Math.floor(Number(tokensUsed) || 0)) },
    adminConfirmed: !!adminConfirmed,
  };
}
const pct = (c) => Math.round(clamp(c) * 100) + "%";

/**
 * What reaches an admin, and whether it alerts. Everything else ASTERISK
 * decides. `thresholds` is { [category]: amount } the admins set; a
 * category without one has no high-value gate.
 */
export function needsAdmin({ fraudFlag = false, value = null, category = null, thresholds = {}, dispute = false, conflict = false, sample = false, paused = false } = {}) {
  const reasons = [];
  if (fraudFlag) reasons.push("fraud flag");
  const threshold = category && thresholds && Number.isFinite(Number(thresholds[category])) ? Number(thresholds[category]) : null;
  const highValue = threshold != null && Number.isFinite(Number(value)) && Number(value) >= threshold;
  if (highValue) reasons.push(`high value (≥ ${threshold} in ${category})`);
  if (dispute) reasons.push("dispute");
  if (conflict) reasons.push("conflict ASTERISK cannot resolve safely");
  if (paused) reasons.push("function paused");
  if (sample) reasons.push("audit sample");
  return { admin: reasons.length > 0, alert: !!fraudFlag || highValue, reasons };
}

/** The queue's order: fraud first, then value, then age (oldest first). */
export function orderQueue(rows = [], now = Date.now()) {
  return [...rows].sort((a, b) => {
    const fa = a.fraud ? 1 : 0, fb = b.fraud ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const va = Number(a.value) || 0, vb = Number(b.value) || 0;
    if (va !== vb) return vb - va;
    const ta = Date.parse(a.at) || now, tb = Date.parse(b.at) || now;
    return ta - tb;
  });
}

/** Should this closed case be drawn for audit? Deterministic on the id. */
export function drawSample(id, rate = AUDIT_SAMPLE_RATE) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 10_000) / 10_000 < rate;
}

export const BANDS = Object.freeze([
  { id: "under-50", min: 0, max: 0.5 },
  { id: "50-65", min: 0.5, max: SPLIT_UNDER },
  { id: "65-75", min: SPLIT_UNDER, max: COLLECTIVE_BAR },
  { id: "75-90", min: COLLECTIVE_BAR, max: CONFIDENCE_CAP + 1e-9 },
]);
export const CALIBRATION_MIN_N = 20;
export const CALIBRATION_TOLERANCE = 0.1;

/**
 * Calibration: per band, what ASTERISK said against how often it was right
 * (an override is a wrong; an audit sample that stood is a right). A band
 * means what it says when the gap is within the tolerance over enough
 * cases; thin bands are UNMEASURED, never assumed right.
 */
export function calibrate(records = []) {
  const list = (Array.isArray(records) ? records : []).filter((r) => r && Number.isFinite(Number(r.confidence)));
  const bands = BANDS.map((b) => {
    const rows = list.filter((r) => { const c = clamp(r.confidence); return c >= b.min && c < b.max; });
    const n = rows.length;
    const stated = n ? rows.reduce((s, r) => s + clamp(r.confidence), 0) / n : null;
    const observed = n ? rows.filter((r) => r.correct === true).length / n : null;
    const measured = n >= CALIBRATION_MIN_N;
    return {
      band: b.id, n, stated: stated == null ? null : round3(stated), observed: observed == null ? null : round3(observed),
      measured, meansWhatItSays: measured ? Math.abs(stated - observed) <= CALIBRATION_TOLERANCE : null,
      gap: measured ? round3(observed - stated) + 0 : null,
    };
  });
  const measured = bands.filter((b) => b.measured);
  const ece = measured.length
    ? round3(measured.reduce((s, b) => s + (b.n / list.length) * Math.abs(b.observed - b.stated), 0))
    : null;
  return { total: list.length, bands, ece, measured: measured.length > 0 };
}

export const GRADES = Object.freeze(["A", "B", "C", "D", "F", "U"]);
export const POOR = new Set(["D", "F"]);
export const AUDIT_MIN_DECISIONS = 10;

function gradeFor(overrideRate, overBudgetShare) {
  const acc = overrideRate <= 0.02 ? "A" : overrideRate <= 0.05 ? "B" : overrideRate <= 0.1 ? "C" : overrideRate <= 0.2 ? "D" : "F";
  const prod = overBudgetShare <= 0.01 ? "A" : overBudgetShare <= 0.05 ? "B" : overBudgetShare <= 0.1 ? "C" : overBudgetShare <= 0.25 ? "D" : "F";
  return GRADES[Math.max(GRADES.indexOf(acc), GRADES.indexOf(prod))];
}

/**
 * The audit of one function over a window. `decisions` are the ledger's
 * ASTERISK rows for it (each with elapsedMs, withinBudget, cost.tokensUsed,
 * and `overridden` when an admin's row supersedes it); `backlog` is the
 * open queue for it; `search` is the complex-search instrument's reading
 * when the function is search (null otherwise — never invented).
 * Fewer than AUDIT_MIN_DECISIONS decisions is grade U: unmeasured, which
 * is not a pass and lifts nothing.
 */
export function auditFunction(fn, { decisions = [], backlog = 0, windowMs = 7 * 86_400_000, search = null } = {}) {
  if (!isFunction(fn)) throw new Error(`no such ASTERISK function: ${fn}`);
  const n = decisions.length;
  const overridden = decisions.filter((d) => d.overridden).length;
  const overBudget = decisions.filter((d) => d.withinBudget === false).length;
  const tokens = decisions.reduce((s, d) => s + (Number(d?.cost?.tokensUsed) || 0), 0);
  const productivity = {
    throughput: n, perDay: windowMs > 0 ? round3(n / (windowMs / 86_400_000)) : null, backlog: Math.max(0, Number(backlog) || 0),
    overBudget, costPerTask: n ? Math.round(tokens / n) : null,
  };
  const accuracy = { decided: n, overridden, overrideRate: n ? round3(overridden / n) : null };
  const complexSearch = fn === "search" && search && typeof search === "object"
    ? { relevanceOrder: search.relevanceOrder ?? null, constraintRespect: search.constraintRespect ?? null, instrument: search.instrument || null }
    : null;
  const grade = n < AUDIT_MIN_DECISIONS ? "U" : gradeFor(accuracy.overrideRate, overBudget / n);
  return { function: fn, grade, poor: POOR.has(grade), unmeasured: grade === "U", productivity, accuracy, complexSearch, windowMs };
}

/**
 * The function's standing after an audit: a poor grade counts; two in a row
 * hand its decisions to the admin queue; a pass (A–C) lifts the hand and
 * resets the count; an unmeasured audit changes nothing.
 */
export function standingAfter(prev = {}, grade) {
  const poorBefore = Math.max(0, Number(prev.consecutivePoor) || 0);
  if (grade === "U") return { grade: prev.grade || "U", consecutivePoor: poorBefore, handed: !!prev.handed, changed: false };
  if (POOR.has(grade)) {
    const consecutivePoor = poorBefore + 1;
    return { grade, consecutivePoor, handed: consecutivePoor >= 2, changed: true };
  }
  return { grade, consecutivePoor: 0, handed: false, changed: true };
}
