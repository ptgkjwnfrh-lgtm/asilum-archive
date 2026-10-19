// app/api/records/route.js — the reader's own records (v53, V.2).
//
// GET    ?kind=save|location|correction|draft|media → { outcome, records }
// PUT    { kind, recordId, payload }             → { outcome, record, created }
// DELETE { kind, recordId }                      → { outcome, deleted }
//
// Identity resolves the way every other personal route does; a device
// cookie is enough (the record follows the device into the account on
// sign-in). Everything is private: `location` carries coordinates and is
// never served to anyone but its owner. Payloads are data, never read as
// instructions, capped at 8 KiB; per-kind caps are refused with 409 and the
// cap named, not silently trimmed.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { consumeRateLimit, consumeGlobalBudget, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { envelope, failure } from "../../../lib/api/outcome.js";
import {
  listUserRecords, putUserRecord, deleteUserRecord, RECORD_KINDS,
} from "../../../lib/db/production.js";

export const dynamic = "force-dynamic";

function unauthorized() {
  const f = failure("unauthorized", "authentication_required", "authentication required");
  return NextResponse.json(f.body, { status: f.status });
}
function invalid(code, message, status) {
  const f = failure("invalid", code, message, status ? { status } : {});
  return NextResponse.json(f.body, { status: f.status });
}
function unavailable(requestId, error) {
  console.error("[records] failed", requestId, error?.message || error);
  const f = failure("unavailable", "records_unavailable", "your records could not be reached — retry", { requestId });
  return NextResponse.json(f.body, { status: f.status });
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!user) return unauthorized();
  const quota = await consumeRateLimit({ scope: "records-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const kind = searchParams.get("kind") || null;
  if (kind && !RECORD_KINDS.includes(kind)) return invalid("record_kind", "unknown record kind");
  const env = envelope({ count: 0 });
  try {
    const records = await listUserRecords(user, { kind });
    return NextResponse.json({ ...env, outcome: records.length ? "ok" : "empty", records });
  } catch (error) {
    return unavailable(env.requestId, error);
  }
}

async function handlePUT(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 12 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return unauthorized();
  const quota = await consumeRateLimit({ scope: "records-write", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const globalQuota = await consumeGlobalBudget("records");
  if (!globalQuota.allowed) return NextResponse.json(rateLimitResponse(globalQuota), { status: 429 });
  const env = envelope({ count: 1 });
  try {
    const r = await putUserRecord(user, { kind: body.kind, recordId: body.recordId, payload: body.payload });
    if (r.capped) {
      const f = failure("invalid", "record_cap", `at most ${r.cap} ${body.kind} records — remove one first`, { status: 409, requestId: env.requestId });
      return NextResponse.json({ ...f.body, cap: r.cap }, { status: f.status });
    }
    return NextResponse.json({ ...env, record: r.record, created: r.created });
  } catch (error) {
    if (error?.code === "record_too_large") return invalid(error.code, error.message, 413);
    if (String(error?.code || "").startsWith("record_")) return invalid(error.code, error.message);
    return unavailable(env.requestId, error);
  }
}

async function handleDELETE(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return unauthorized();
  const quota = await consumeRateLimit({ scope: "records-write", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  if (!RECORD_KINDS.includes(body.kind)) return invalid("record_kind", "unknown record kind");
  const env = envelope({ count: 1 });
  try {
    const r = await deleteUserRecord(user, body.kind, body.recordId);
    return NextResponse.json({ ...env, deleted: r.deleted });
  } catch (error) {
    return unavailable(env.requestId, error);
  }
}

// Personal data: never shared-cacheable (see withPrivateCache).
export const GET = withPrivateCache(handleGET);
export const PUT = withPrivateCache(handlePUT);
export const DELETE = withPrivateCache(handleDELETE);
