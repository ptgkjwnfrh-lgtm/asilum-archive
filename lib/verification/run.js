// lib/verification/run.js — RUN THE CHECKS on one listing and append the
// row (V.2 brief §12; slice 5 governance). SERVER-ONLY. The route and the
// script both call this; a Next route file may export only handlers, so it
// lives here.
//
// Under governance (lib/asterisk/governor.js) since slice 5: a paused
// authentication function appends nothing and queues the listing; every
// pass is a logged decision with its evidence, confidence and reasoning;
// a replica signal from the admins' library forces Unverified and a fraud
// flag that reaches the queue with an alert; a native listing whose
// checklist cannot be completed gets an evidence request instead of a
// guess. A reviewer's word is the admin's — it rides the row as before.
import { recordVerification, latestVerifications } from "../db/production/verification.js";
import { listReplicaPatterns } from "../db/production/asterisk.js";
import { aiCheckFromComparison, buildRecord, sourceCheck, evidenceRequestFor, badgeFor } from "./ledger.js";
import { replicaSignals, replicaCheck } from "./replicas.js";
import { compareItem } from "./desk.js";
import { govern } from "../asterisk/governor.js";

/** Source + AI (local rules, model off) checks; an optional reviewer's word rides along. */
export async function runChecks(item, { human = null, reviewer = null, now = Date.now() } = {}) {
  const patterns = await listReplicaPatterns({ house: item.brand }).catch(() => []);
  const signals = replicaSignals(item, patterns);
  const governed = await govern("authentication", {
    kind: human ? "review" : "pass", subject: item.id, value: item.price ?? null, category: item.category || null,
    payload: { title: item.title || null, brand: item.brand || null },
  }, {
    initial: async () => {
      const source = sourceCheck(item);
      const ai = replicaCheck(signals) || aiCheckFromComparison(compareItem(item));
      const evidence = [`source: ${source.detail || source.status}`, `ai: ${ai.detail || ai.status}`, ...(human ? [`reviewer ${reviewer || "admin"}: ${human}`] : [])];
      // the pass's own confidence: the AI check's, or the reviewer's word
      const confidence = human === "pass" ? 1 : human === "fail" ? 1 : ai.status === "fail" ? 1 : (ai.confidence ?? 0);
      return { answer: human || ai.status, confidence, evidence, reasoning: `source ${source.status}; ai ${ai.status}${signals.length ? "; replica signal" : ""}`, fraud: signals.length > 0, source, ai };
    },
  }, { now: () => now });
  if (governed.queued) return { queued: true, reason: governed.reason, record: null };
  const { source, ai } = governed.initial;
  const evidenceRequest = human ? null : evidenceRequestFor(item, ai);
  const rec = buildRecord(item, {
    source, ai, now, evidenceRequest, fraud: signals.length > 0,
    human: human ? { status: human, reviewer, at: new Date(now).toISOString() } : null,
  });
  // 12.8 (slice 10b): a Verified native listing that goes down tells its seller why
  const before = (await latestVerifications([item.id]).catch(() => new Map())).get(String(item.id)) || null;
  const row = await recordVerification(rec);
  try {
    const was = before ? badgeFor(before, item, now).word : null;
    const is = badgeFor(row, item, now).word;
    if (was === "verified" && is !== "verified") {
      const { noticeDowngrade } = await import("../db/production/identity.js");
      await noticeDowngrade({ itemId: item.id, from: was, to: is, explanation: rec.ai?.detail || rec.source?.detail || "new evidence undermined the earlier reading (12.7)" });
    }
  } catch (e) { console.error("[verification] downgrade notice failed", e?.message || e); }
  return { ...row, governance: { outcome: governed.decision.outcome, confidence: governed.decision.confidence, actionId: governed.action ? governed.action.id : null, queued: governed.case ? governed.case.id : null }, badgeState: badgeFor(row, item, now).state };
}
