// app/api/passport/attendance/route.js — "I WAS THERE" (V.2 17.19; slice 12).
// GET    ?user=                       → my attendance records with their state
// POST   { user, eventId, area? }     → claim; evaluated against what is on
//                                       record (the area read sent with it,
//                                       my uploads, my posts) and stored as a
//                                       user record; re-posting re-evaluates
// DELETE { user, eventId }            → withdraw the claim
// A claim is CLAIMED until the evidence substantiates it; the route never
// upgrades a word to a fact.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { listUserRecords, putUserRecord, deleteUserRecord } from "../../../../lib/db/production/records.js";
import { listMoodBoardUploads, listEditorialPosts } from "../../../../lib/db/production/editorial.js";
import { listPlaces } from "../../../../lib/places/registry.js";
import { substantiate, attendanceRecord, attendanceSummary } from "../../../../lib/passport/attendance.js";

export const dynamic = "force-dynamic";

const placeById = (id) => listPlaces().find((p) => p.id === id) || null;

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "attendance-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const rows = (await listUserRecords(user, { kind: "attendance", limit: 200 })).map((r) => r.payload);
  return NextResponse.json({ records: rows, summary: attendanceSummary(rows), law: { radiusMi: 30, evidence: ["area", "upload", "post"] } });
}

async function evaluate(user, place, area) {
  const [uploads, posts] = await Promise.all([
    listMoodBoardUploads(user, 200).catch(() => []),
    listEditorialPosts({ authorId: user, limit: 100 }).catch(() => []),
  ]);
  return substantiate({ place, area, uploads, posts });
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "attendance-write", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const place = placeById(String(body.eventId || ""));
  if (!place) return NextResponse.json({ error: "no such place on record", code: "NOT_FOUND" }, { status: 404 });
  if (place.sample) return NextResponse.json({ error: "a sample fixture is not somewhere anyone was", code: "SAMPLE_EVENT" }, { status: 409 });
  if (!place.dated || !place.startsAt) return NextResponse.json({ error: "an undated place cannot substantiate attendance", code: "UNDATED" }, { status: 409 });
  const area = body.area && typeof body.area === "object" ? { lat: Number(body.area.lat), lng: Number(body.area.lng), at: body.area.at || Date.now() } : null;
  const result = await evaluate(user, place, area);
  const existing = (await listUserRecords(user, { kind: "attendance", limit: 200 })).find((r) => r.recordId === place.id);
  const payload = attendanceRecord({ place, result, claimedAt: existing && existing.payload && existing.payload.claimedAt ? Date.parse(existing.payload.claimedAt) : Date.now() });
  const saved = await putUserRecord(user, { kind: "attendance", recordId: place.id, payload });
  if (saved && saved.capped) return NextResponse.json({ error: `attendance records are capped at ${saved.cap}`, code: "CAPPED" }, { status: 409 });
  return NextResponse.json({ record: payload }, { status: existing ? 200 : 201 });
}

async function handleDELETE(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 2 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const r = await deleteUserRecord(user, "attendance", String(body.eventId || ""));
  return NextResponse.json({ deleted: !!(r && r.deleted) });
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
export const DELETE = withPrivateCache(handleDELETE);
