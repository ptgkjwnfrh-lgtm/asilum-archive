// app/api/passport/onboarding/route.js — THE PASSPORT'S ONBOARDING (V.2
// 14.2–14.3, 14.11; A6 (7); slice 10c). Five to seven autobiographical
// questions, era-relevant suggestions from the birthday, the home town and
// the optional background; an answer becomes an identity anchor the
// passenger alone designates or removes; the anchor's tags enter the
// profile's explicit class, which never decays.
//
// GET  ?user=            → { questions: [...], progress, anchors, identity: { yearAt12, hometown, background: bool } }
// POST { user, action: "answer", questionId, text?, suggestion?: { name }, na?: true }
// POST { user, action: "skip", questionId }
// POST { user, action: "remove", questionId }      — the passenger removes an anchor (14.3)
//
// A device identity may answer too (the anchors ride on the device's records
// and move with adoption); without a birth date the bus question has no
// year and the suggestions are era-free — nothing is assumed.

import { NextResponse } from "next/server";
import { resolveRequestIdentity } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { listUserRecords, putUserRecord, deleteUserRecord } from "../../../../lib/db/production/records.js";
import { getIdentity } from "../../../../lib/db/production/identity.js";
import { mutateProfile } from "../../../../lib/db/index.js";
import { migrateProfile } from "../../../../lib/brain/index.js";
import { questionsFor, progress, anchorFromAnswer, manualFromAnchors, QUESTIONS, COHORT_PROVENANCE } from "../../../../lib/passport/onboarding.js";
import { yearAtAge } from "../../../../lib/identity/commerce.js";

export const dynamic = "force-dynamic";

async function anchorsOf(userId) {
  const rows = await listUserRecords(userId, { kind: "anchor", limit: 50 });
  const map = {};
  for (const r of rows) map[r.recordId] = { ...r.payload, questionId: r.recordId };
  return map;
}

/** The profile's explicit class carries exactly the anchors' tags (14.3): recomputed from the records, so a removal takes its tags with it unless another anchor carries them. */
async function syncManual(userId, anchors) {
  const manual = manualFromAnchors(Object.values(anchors).filter((a) => !a.skipped && !a.na));
  await mutateProfile(userId, (current) => {
    const next = migrateProfile(current);
    const meta = { ...(next._meta || {}) };
    const prev = meta.manual || {};
    // keep the tags the reader chose on the taste network (keep/explore) that are not anchors
    const kept = {};
    for (const [t, v] of Object.entries(prev)) if (!(meta.anchorTags || []).includes(t)) kept[t] = v;
    meta.manual = { ...kept, ...manual };
    meta.anchorTags = Object.keys(manual);
    meta.anchors = Object.values(anchors).filter((a) => !a.skipped).map((a) => ({ q: a.questionId, text: a.text, na: !!a.na, at: a.designatedAt }));
    for (const [t, v] of Object.entries(manual)) next.long[t] = Math.max(next.long[t] || 0, v);
    next._meta = meta;
    return next;
  });
  return manual;
}

async function context(identity) {
  const row = identity.accountId ? await getIdentity(identity.accountId).catch(() => null) : null;
  return { birthDate: identity.birthDate, hometown: row ? row.hometown : null, ethnicity: row ? row.ethnicity : null };
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const identity = await resolveRequestIdentity(req, String(searchParams.get("user") || ""));
  if (!identity) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "onboarding-read", subject: identity.userId, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const ctx = await context(identity);
  const anchors = await anchorsOf(identity.userId);
  const questions = questionsFor({ ...ctx, answers: anchors });
  return NextResponse.json({
    questions, progress: progress(questions), anchors: Object.values(anchors).filter((a) => !a.skipped),
    identity: { account: !!identity.accountId, yearAt12: yearAtAge(ctx.birthDate, 12), hometown: ctx.hometown ? ctx.hometown.name : null, background: !!ctx.ethnicity },
    law: { questions: QUESTIONS.length, anchorsNeverFade: true, onlyThePassengerDesignates: true, cohorts: COHORT_PROVENANCE },
  });
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const identity = await resolveRequestIdentity(req, String(body.user || ""));
  if (!identity) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "onboarding-write", subject: identity.userId, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const questionId = String(body.questionId || "");
  if (!QUESTIONS.some((q) => q.id === questionId)) return NextResponse.json({ error: "not one of the Passport's questions", code: "UNKNOWN_QUESTION" }, { status: 400 });
  const userId = identity.userId;
  try {
    if (body.action === "answer") {
      const made = anchorFromAnswer({ questionId, text: body.text, suggestion: body.suggestion && body.suggestion.name ? body.suggestion : null, na: body.na === true });
      if (!made.ok) return NextResponse.json({ error: made.reason, code: "ANSWER_REFUSED" }, { status: 400 });
      const put = await putUserRecord(userId, { kind: "anchor", recordId: questionId, payload: made.anchor });
      if (put && put.capped) return NextResponse.json({ error: "the Passport holds fifty anchors", code: "CAPPED" }, { status: 409 });
    } else if (body.action === "skip") {
      await putUserRecord(userId, { kind: "anchor", recordId: questionId, payload: { questionId, skipped: true, at: new Date().toISOString() } });
    } else if (body.action === "remove") {
      await deleteUserRecord(userId, "anchor", questionId);
    } else return NextResponse.json({ error: "answer, skip or remove", code: "UNKNOWN_ACTION" }, { status: 400 });
    const anchors = await anchorsOf(userId);
    const manual = await syncManual(userId, anchors);
    const questions = questionsFor({ ...(await context(identity)), answers: anchors });
    return NextResponse.json({ questions, progress: progress(questions), anchors: Object.values(anchors).filter((a) => !a.skipped), manual });
  } catch (error) {
    console.error("[onboarding] failed", error?.message || error);
    return NextResponse.json({ error: "the Passport could not record that", code: "ONBOARDING_UNAVAILABLE" }, { status: 503 });
  }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
