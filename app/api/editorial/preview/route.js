// app/api/editorial/preview/route.js — the safe link preview for the
// composer (V.2 brief §6). GET ?url= → the plain-text snapshot
// lib/posts/preview.js produces, or { refused } with the reason. A signed-in
// account, rate-limited: this service fetches pages on a reader's behalf
// and must never become an open proxy.
import { NextResponse } from "next/server";
import { accountIdFromIdentity, resolveRequestUser } from "../../../../lib/identity.js";
import { fetchPreview, previewAllowed } from "../../../../lib/posts/preview.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (!accountIdFromIdentity(user)) return NextResponse.json({ error: "link previews ride on a signed-in account" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "wire-preview", subject: user, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const url = String(searchParams.get("url") || "").slice(0, 2048);
  const allowed = previewAllowed(url);
  if (!allowed.ok) return NextResponse.json({ refused: allowed.why }, { status: 400 });
  const snap = await fetchPreview(url);
  return NextResponse.json(snap);
}
