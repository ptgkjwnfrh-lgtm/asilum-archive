// lib/asterisk/tagAudit.js
// Asterisk AI — the secondary audit of every tagged product.
// Dual tagging: Base Tags (items fields + product_tags: retailer/seller/admin)
// stay untouched; Asterisk writes its OWN interpretation to product_ai_tags,
// then a reconciliation record measures agreement, lists conflicts and gaps,
// and routes high-impact conflicts to moderation_tasks. Conflicts are NEVER
// silently resolved in either direction.
//
// Analysis path: real model via runModel() when AI_TAG_AUDIT_ENABLED (+
// provider + key), otherwise honest local rules (taxonomy word matching +
// the product's live brain tag vector). Provenance recorded either way.

import { randomUUID } from "node:crypto";
import { getItem } from "../db/index.js";
import {
  getProductTags, saveProductAiTags, createTagReconciliation,
  createModerationTask,
} from "../db/production.js";
import { runModel } from "../ai/adapter.js";
import { PROMPT_VERSION_TAG_AUDIT_V1 } from "../ai/promptVersions.js";
import { validateTagAuditOutput } from "../ai/validate.js";
import { resolveTag } from "./ontology.js";
import { MATERIALS, SILHOUETTES, COLORS, MOODS } from "../fashion-taxonomy/index.js";
import { govern } from "./governor.js";

const HIGH_IMPACT_FIELDS = new Set(["brand", "category", "material"]);
const CONF = (v) => +Math.min(0.6, Math.max(0, v)).toFixed(3); // local rules cap 0.6

// items.era is JSONB ({raw, year, decade, season}) on synced rows, a plain
// string on older ones — always reduce to a comparable string.
const eraText = (era) => {
  if (!era) return "";
  if (typeof era === "string") return era;
  return String(era.decade || era.raw || "");
};

// ---- Local-rules interpretation (no model, no pretending) ------------------
function localInterpret(item) {
  const text = `${item.title || ""} ${item.alt || ""} ${item.category || ""}`.toLowerCase();
  const fields = [];
  const scan = (list, field) => {
    for (const w of list) {
      if (text.includes(w)) {
        fields.push({ field, value: w, confidence: CONF(0.5), status: "estimated",
          evidence: `word "${w}" in listing text` });
      }
    }
  };
  scan(COLORS, "color");
  scan(MATERIALS, "material");
  scan(SILHOUETTES, "silhouette");
  scan(MOODS, "mood");
  if (item.category) {
    fields.push({ field: "category", value: String(item.category).toLowerCase(),
      confidence: CONF(0.6), status: "seller_supplied", evidence: "listing category field" });
  }
  const era = eraText(item.era);
  if (era) {
    fields.push({ field: "era", value: era.toLowerCase(),
      confidence: CONF(0.5), status: "seller_supplied", evidence: "listing era field" });
  }
  // Brain aesthetic vector (weights 0..1) — read, never rewritten.
  const vec = item.tags && typeof item.tags === "object" ? item.tags : {};
  for (const [tag, w] of Object.entries(vec)) {
    if (typeof w === "number" && w >= 0.35) {
      fields.push({ field: "aesthetic", value: tag.toLowerCase(),
        confidence: CONF(w), status: "estimated", evidence: "brain tag vector weight " + w.toFixed(2) });
    }
  }
  return fields;
}

// ---- Base layer snapshot ----------------------------------------------------
async function baseLayer(item) {
  const rows = await getProductTags(item.id); // {tag, tagType, confidence, source}
  const base = {};
  const put = (field, value, source) => {
    if (!value) return;
    (base[field] ||= []).push({ value: String(value).toLowerCase(), source });
  };
  put("brand", item.brand, "listing");
  put("category", item.category, "listing");
  put("era", eraText(item.era), "listing");
  for (const r of rows) put(r.tagType, r.tag, r.source);
  return base;
}

// ---- Reconciliation ---------------------------------------------------------
function reconcile(base, aiFields) {
  const canonical = (field, v) => resolveTag(v, field === "aesthetic" ? null : null)?.id
    || String(v).toLowerCase().trim();
  const byField = {};
  for (const f of aiFields) (byField[f.field] ||= []).push(f);

  let comparisons = 0, agreements = 0;
  const conflicts = [];
  const missingBaseFields = [];
  for (const [field, fs] of Object.entries(byField)) {
    const baseVals = (base[field] || []).map((b) => canonical(field, b.value));
    if (!baseVals.length) { missingBaseFields.push(field); continue; }
    for (const f of fs) {
      comparisons++;
      if (baseVals.includes(canonical(field, f.value))) { agreements++; continue; }
      conflicts.push({ field, base: base[field].map((b) => b.value), ai: f.value,
        aiConfidence: f.confidence, aiStatus: f.status });
    }
  }
  const agreementScore = comparisons ? +(agreements / comparisons).toFixed(3) : 1;
  const reviewRequired = conflicts.some(
    (c) => HIGH_IMPACT_FIELDS.has(c.field) && c.aiConfidence >= 0.5);
  return { agreementScore, conflicts, missingBaseFields, reviewRequired };
}

/**
 * Audit one product. Never throws; never mutates base tags.
 * @returns {ok, auditId, analysisSource, fields, reconciliation} | {ok:false,error}
 */
export async function auditProductTags(productId) {
  const item = await getItem(productId);
  if (!item) return { ok: false, error: "product not found" };

  const base = await baseLayer(item);
  let fields = null;
  let analysisSource = "local-rules";
  let modelMeta = {};

  // GOVERNED (slice 5, lib/asterisk/governor.js): a paused tagging function
  // writes nothing and queues the product; every audit is a logged decision.
  // The pass itself is below; the governor only decides whether it may run
  // and records what it concluded.
  const governed = await govern("tagging", { kind: "tag-audit", subject: productId, value: item.price ?? null, category: item.category || null, payload: { title: item.title || null } }, {
    initial: async () => {
      const r = await runAudit();
      const conf = r.fields.length ? Math.max(...r.fields.map((f) => Number(f.confidence) || 0)) : 0;
      return { answer: r.reconciliation.reviewRequired ? "review" : "agree", confidence: conf, evidence: r.fields.slice(0, 20).map((f) => `${f.field}=${f.value} (${f.evidence})`), reasoning: `${r.analysisSource}: agreement ${r.reconciliation.agreementScore}, ${r.reconciliation.conflicts.length} conflict(s)`, conflict: r.reconciliation.reviewRequired, result: r };
    },
  });
  if (governed.queued) return { ok: false, queued: true, error: governed.reason };
  return { ...governed.initial.result, governance: { outcome: governed.decision.outcome, confidence: governed.decision.confidence, actionId: governed.action ? governed.action.id : null } };

  async function runAudit() {
  const res = await runModel({
    feature: "tag-audit",
    promptVersionId: PROMPT_VERSION_TAG_AUDIT_V1.id,
    context: {
      title: item.title || "", brand: item.brand || "", category: item.category || "",
      era: item.era || "", altText: item.alt || "", baseTags: base,
    },
    validate: validateTagAuditOutput,
  });
  if (res.ok) {
    fields = res.data.fields;
    analysisSource = "model";
    modelMeta = { modelProvider: res.provider, modelName: res.modelName, promptVersion: res.promptVersion };
  } else {
    fields = localInterpret(item);
  }

  // Canonicalize through the ontology (unresolved values kept, not invented).
  for (const f of fields) f.canonicalTag = resolveTag(f.value)?.id || null;

  const auditId = "aud-" + randomUUID();
  const reconciliation = reconcile(base, fields);

  await saveProductAiTags(productId, auditId, fields, modelMeta);
  await createTagReconciliation({
    id: auditId, productId,
    agreementScore: reconciliation.agreementScore,
    conflicts: reconciliation.conflicts,
    missingBaseFields: reconciliation.missingBaseFields,
    reviewRequired: reconciliation.reviewRequired,
    analysisSource,
  });
  if (reconciliation.reviewRequired) {
    await createModerationTask({
      kind: "tag-conflict", subjectType: "product", subjectId: productId,
      priority: "high",
      payload: { auditId, conflicts: reconciliation.conflicts },
    }).catch(() => {});
  }
  return { ok: true, auditId, analysisSource, fields, reconciliation };
  }
}
