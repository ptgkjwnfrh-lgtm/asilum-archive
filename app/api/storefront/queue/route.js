// app/api/storefront/queue/route.js — THE AVAILABILITY QUEUE (V.2 Blueprint
// 7.10–7.13; slice 6). A reserved listing can be viewed but not bought;
// passengers join a first-come waiting queue. A release notifies everyone
// and stays first come, first served — the queue grants a notification
// courtesy, nothing more. A sale notifies everyone and closes it.
//
// GET  ?listingId=&user=     → { waiting, position }
// POST { listingId, join: true | false }
//
// Any identity may wait (a device cookie included): the alert links to the
// listing; buying still needs an account at checkout.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { joinQueue, leaveQueue, queuePosition, CommerceRefused } from "../../../../lib/db/production/commerce.js";

export const dynamic = "force-dynamic";

function refused(error) {
  if (error instanceof CommerceRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("[queue] failed", error?.message || error);
  return NextResponse.json({ error: "the queue is unavailable", code: "QUEUE_UNAVAILABLE" }, { status: 503 });
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "queue-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try { return NextResponse.json(await queuePosition({ userId: user, listingId: String(searchParams.get("listingId") || "") })); } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 2 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "queue-write", subject: user, limit: 60, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const listingId = String(body.listingId || "");
    if (body.join === false) return NextResponse.json({ ...(await leaveQueue({ userId: user, listingId })), ...(await queuePosition({ userId: user, listingId })) });
    const r = await joinQueue({ userId: user, listingId });
    return NextResponse.json({ ...r, ...(await queuePosition({ userId: user, listingId })) }, { status: r.joined ? 201 : 200 });
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
