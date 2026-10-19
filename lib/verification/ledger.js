// lib/verification/ledger.js — THE VERIFICATION LEDGER'S RULES (V.2 brief
// §12). SERVER-SIDE (node:crypto for the version hash) and pure: the same
// record and the same listing give the same badge, so a test can hold every
// rule. The badge OBJECT it returns is what the client renders
// (app/components/VerificationBadge.jsx).
//
// THE ASTERISK ON A CARD MEANS "ASILUM'S LISTING CHECKS COMPLETED". It is
// not counterfeit-proof authentication, it says nothing about stock, and the
// breakdown says both. Three checks:
//
//   source  provenance — an approved provider, a stable source id, a listing
//           URL on that provider's host.
//   ai      metadata consistency — the listing's words against its fields.
//           With the model OFF this is the desk's LOCAL RULES, and local
//           rules are never confident enough to skip a human (their
//           confidence is capped under AI_CONFIDENT_BAR on purpose).
//   human   optional review by a named reviewer.
//
// The badge rule, in the order the brief states it:
//   stale    the record's evidence version ≠ the listing's now → NO BADGE
//            (a material change to photo / title / designer / size / category
//            invalidates everything that depended on the old version)
//   missing  no record for this version → NO BADGE
//   expired  past expires_at → NO BADGE
//   failed   source fail, ai fail, or human fail → NO BADGE
//   passing  source pass AND (ai pass AND confident) → VERIFIED without a human
//            source pass AND ai flag/pass-but-unsure AND human pass → VERIFIED
//            source pass AND ai flag/unsure AND no human → PENDING
//   source missing → PENDING (nothing is proven either way), never VERIFIED
//
// SLICE 5 (V.2 Blueprint, Part I "Hard gates against authenticating
// replicas", "Authentication timing", chapter 12; 17 Oct 2026):
//   * THE 90% CAP. The AI's confidence never passes CONFIDENCE_CAP, and
//     VERIFIED without a human needs the checklist met AT the cap
//     (AI_CONFIDENT_BAR = 0.9): "the remaining certainty is a human's".
//   * UNVERIFIED is a state, not the absence of one: failed on positive
//     evidence (a source fail, a material contradiction, a reviewer's no, a
//     replica signal) → UNVERIFIED with the reason. Stale, missing and
//     expired evidence still mean NO BADGE — "absence of proof is never
//     evidence of counterfeiting" (12.6).
//   * A REPLICA SIGNAL overrides confidence: Unverified regardless of other
//     evidence, and a fraud flag (`record.fraud`).
//   * MISSING EVIDENCE IS A REQUEST, NOT A GUESS: `record.evidenceRequest`
//     names what the seller must supply; the pass clock pauses.
//   * TIMING. The pass runs AUTH_PASS_MS (five minutes); a native SELL item
//     carries `resolveBy` = listed + RESOLVE_WINDOW_MS (72 hours); past it
//     an open request resolves UNVERIFIED — not a punishment, the item
//     stays listed. External listings carry no deadline (nothing was
//     listed with us).
//   * SOLD FREEZES: a sold item keeps its recorded state; a material change
//     and expiry no longer invalidate it. Relisting is a new evidence
//     version and is evaluated fresh — the old row is evidence, not an answer.

import { createHash } from "node:crypto";
import { CONFIDENCE_CAP, cap } from "../asterisk/governance.js";

export const RULES_VERSION = "2026-10-17.5";
export const AI_CONFIDENT_BAR = CONFIDENCE_CAP;  // AI alone completes the checks only at the cap
export const VERIFICATION_TTL_DAYS = 90;
export const LOCAL_RULES_CONFIDENCE = 0.5;    // local rules can never cross the bar
export const AUTH_PASS_MS = 5 * 60_000;        // ASTERISK's authentication pass
export const RESOLVE_WINDOW_MS = 72 * 3_600_000; // a SELL item resolves within 72 hours
export const NATIVE_SOURCES = Object.freeze(["asilum"]);
export const CATEGORY_CHECKLIST = Object.freeze({
  default: ["labels", "stitching", "hardware", "serials", "materials", "provenance", "comparables"],
});
/** The evidence a seller can be asked for — the checklist's items. */
export const EVIDENCE_ASKS = Object.freeze(["care label", "serial", "hardware stamp", "receipt", "additional photographs"]);
export const MATERIAL_FIELDS = Object.freeze(["title", "brand", "designers", "size", "category", "img"]);
export const APPROVED_PROVIDERS = Object.freeze({
  ebay: { hosts: ["ebay.com", "www.ebay.com", "ebay.co.uk", "www.ebay.co.uk"], label: "eBay" },
});

/** The listing's evidence version: a hash of the material fields, 16 hex. */
export function evidenceVersionOf(item = {}) {
  const material = {};
  for (const f of MATERIAL_FIELDS) {
    const v = item[f];
    material[f] = v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v).trim();
  }
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** Does this listing's provenance check out? Pure. */
export function sourceCheck(item = {}) {
  const provider = String(item.source_name || item.source || "").toLowerCase();
  // a listing made with us has no provider to check: its provenance is our own row
  if (NATIVE_SOURCES.includes(provider)) return { status: "pass", detail: `listed on ASILUM${item.listed_at ? " at " + String(item.listed_at).slice(0, 19).replace("T", " ") : ""}` };
  const approved = APPROVED_PROVIDERS[provider];
  if (!approved) return { status: "missing", detail: provider ? `${provider} is not an approved provider` : "no provider on the listing" };
  if (!item.source_product_id) return { status: "fail", detail: `${approved.label} listing without a source id` };
  let host = null;
  try { host = new URL(String(item.url || "")).hostname.toLowerCase(); } catch { host = null; }
  if (!host) return { status: "fail", detail: `${approved.label} listing without a listing URL` };
  if (!approved.hosts.includes(host)) return { status: "fail", detail: `listing URL is on ${host}, not ${approved.label}` };
  return { status: "pass", detail: `${approved.label} listing ${item.source_product_id} at ${host}` };
}

/**
 * The AI metadata-consistency check from the desk's comparison (the LOCAL
 * RULES reading, or a keyed model's). `compared` is compareItem()'s result.
 */
export function aiCheckFromComparison(compared, { model = null, version = null, confidence = null } = {}) {
  const fields = (compared && compared.fields) || [];
  const conflicts = fields.filter((f) => f.status === "conflict");
  const agreed = fields.filter((f) => f.status === "agree");
  const local = !model;
  // THE CAP: a keyed model's self-report is ceilinged at 0.9; only an admin makes 1.0.
  const conf = local ? LOCAL_RULES_CONFIDENCE : cap(confidence);
  if (conflicts.some((f) => f.material)) return { status: "fail", confidence: conf, model: model || "local-rules", version: version || RULES_VERSION, detail: `material conflict on ${conflicts.filter((f) => f.material).map((f) => f.field).join(", ")}` };
  if (conflicts.length) return { status: "flag", confidence: conf, model: model || "local-rules", version: version || RULES_VERSION, detail: `minor conflict on ${conflicts.map((f) => f.field).join(", ")}` };
  if (!agreed.length) return { status: "missing", confidence: conf, model: model || "local-rules", version: version || RULES_VERSION, detail: "no field could be read from the listing text" };
  return { status: "pass", confidence: conf, model: model || "local-rules", version: version || RULES_VERSION, detail: `${agreed.length} field(s) agree: ${agreed.map((f) => f.field).join(", ")}` };
}

/** Is this a listing made with us (a SELL / DROP item) rather than an external source's? */
export function isNativeListing(item = {}) {
  return NATIVE_SOURCES.includes(String(item.source_name || item.source || "").toLowerCase());
}

/** When a native listing must be resolved by: listed + 72 h. Null for an external listing. */
export function resolveByFor(item = {}) {
  if (!isNativeListing(item)) return null;
  const listed = Date.parse(item.listed_at || item.created_at || "");
  return Number.isFinite(listed) ? new Date(listed + RESOLVE_WINDOW_MS).toISOString() : null;
}

/** Build one ledger record for a listing from its checks. Pure. */
export function buildRecord(item, { source, ai, human = null, now = Date.now(), ttlDays = VERIFICATION_TTL_DAYS, evidenceRequest = null, fraud = false } = {}) {
  const asks = evidenceRequest && Array.isArray(evidenceRequest.asks) ? evidenceRequest.asks.filter((a) => EVIDENCE_ASKS.includes(a)) : [];
  return {
    itemId: String(item.id), evidenceVersion: evidenceVersionOf(item),
    source: { status: source.status, detail: source.detail || null },
    ai: { status: ai.status, confidence: ai.confidence == null ? null : cap(ai.confidence), model: ai.model || null, version: ai.version || null, detail: ai.detail || null },
    human: human ? { status: human.status, reviewer: human.reviewer || null, at: human.at || new Date(now).toISOString() } : { status: "none", reviewer: null, at: null },
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlDays * 86_400_000).toISOString(),
    rulesVersion: RULES_VERSION,
    fraud: !!fraud || !!ai.fraud,
    evidenceRequest: asks.length ? { asks, requestedAt: evidenceRequest.requestedAt || new Date(now).toISOString() } : null,
    resolveBy: resolveByFor(item),
  };
}

/**
 * What the pass should ask the seller for when the checklist cannot be
 * completed from what was supplied: the first asks the checklist lacks.
 * Only a NATIVE listing has a seller to ask; an external listing's gaps
 * stay gaps.
 */
export function evidenceRequestFor(item, ai) {
  if (!isNativeListing(item)) return null;
  if (!ai || (ai.status !== "missing" && ai.status !== "flag")) return null;
  const asks = ai.status === "missing" ? ["care label", "additional photographs"] : ["additional photographs"];
  return { asks };
}

const LIMITATIONS = Object.freeze([
  "a completed check is not counterfeit-proof authentication",
  "stock and price are checked separately (the listing's status line)",
  "a community outfit tag cannot inherit this badge as proof of who wore it",
]);

/**
 * THE BADGE. `record` is the latest ledger row for the listing (or null);
 * `item` is the listing as it is now. Returns the state and a plain-language
 * breakdown the badge opens into.
 */
export function badgeFor(record, item, now = Date.now()) {
  const version = evidenceVersionOf(item);
  const out = { state: "none", reason: null, checks: null, lastCheckedAt: null, expiresAt: null, evidenceVersion: version, limitations: LIMITATIONS, meaning: "ASILUM's listing checks" };
  if (!record) return { ...out, reason: "no checks have been run on this listing" };
  out.checks = { source: record.source, ai: record.ai, human: record.human };
  out.lastCheckedAt = record.checkedAt; out.expiresAt = record.expiresAt;
  out.fraud = !!record.fraud; out.evidenceRequest = record.evidenceRequest || null; out.resolveBy = record.resolveBy || null;
  // SOLD FREEZES (blueprint; 12.10): a sold item keeps its recorded status.
  const frozen = String(item.availability_status || "").toLowerCase() === "sold";
  if (!frozen && record.evidenceVersion !== version) return { ...out, reason: "the listing changed since it was checked — the checks must run again" };
  if (!frozen && Date.parse(record.expiresAt) <= now) return { ...out, reason: "the checks expired and must run again" };
  if (record.fraud || /^replica signal/.test(String(record.ai.detail || ""))) return { ...out, state: "unverified", reason: "a replica signal: Unverified regardless of other evidence — an admin has the case" };
  if (record.source.status === "fail") return { ...out, state: "unverified", reason: "the source check failed" };
  if (record.ai.status === "fail") return { ...out, state: "unverified", reason: "the listing's words contradict its details" };
  if (record.human.status === "fail") return { ...out, state: "unverified", reason: "a reviewer did not pass it" };
  if (record.human.status === "pass") return { ...out, state: "verified", reason: frozen ? "verified before the sale; the record is frozen" : "source checked; a reviewer passed it" };
  // 72 HOURS TO RESOLVE: an open evidence request the seller never answered resolves Unverified.
  if (record.resolveBy && Date.parse(record.resolveBy) <= now) {
    return { ...out, state: "unverified", reason: record.evidenceRequest ? "the requested evidence was not supplied within 72 hours — Unverified, and still listed" : "not verified within 72 hours of listing — Unverified, and still listed" };
  }
  if (record.evidenceRequest) return { ...out, state: "pending", reason: `waiting for the seller: ${record.evidenceRequest.asks.join(", ")} — the clock is paused` };
  if (record.source.status !== "pass") return { ...out, state: "pending", reason: "the source could not be checked" };
  const aiConfidentPass = record.ai.status === "pass" && (record.ai.confidence ?? 0) >= AI_CONFIDENT_BAR;
  if (aiConfidentPass) return { ...out, state: "verified", reason: "source checked; the checklist met at the cap; no reviewer needed" };
  if (record.ai.status === "pass") return { ...out, state: "pending", reason: "source checked; the details agree but not confidently enough — waiting for a reviewer" };
  if (record.ai.status === "flag") return { ...out, state: "pending", reason: "source checked; one detail is uncertain — waiting for a reviewer" };
  return { ...out, state: "pending", reason: "source checked; the listing text could not be read — waiting for a reviewer" };
}

/** The passenger's compact status (12.1): VERIFIED, UNVERIFIED, PENDING, or null when no checks ran. */
export function statusWordFor(badge) {
  if (!badge || badge.state === "none") return null;
  return badge.state.toUpperCase();
}

/** The screen-reader label and the tooltip, from the badge state. */
export function badgeLabel(badge) {
  if (!badge || badge.state === "none") return "listing checks not completed";
  if (badge.state === "pending") return "listing checks pending review";
  if (badge.state === "unverified") return "listing checks did not pass — unverified, still listed";
  return "ASILUM listing checks completed — not an authentication guarantee";
}
