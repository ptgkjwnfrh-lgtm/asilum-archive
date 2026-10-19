// app/api/verification/route.js
// GET /api/verification?limit=&status=archivalist|flagged|agreed|pending
// POST { user, action: "appeal", itemId, evidence } — the seller's structured
//      appeal with materially new evidence (12.9), decided by a human
// GET  ?appeals=1&user=  — my appeals
// The verification desk over the catalog: source claims beside a LOCAL-RULES
// reading of the listing text, field by field; a human sees only material
// conflicts. Mode is printed in the body — never a claim of AI research
// while the model is off (lib/verification/desk.js).

import { NextResponse } from "next/server";
import { buildDesk } from "../../../lib/verification/desk.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { openAppeal, listAppeals, IdentityRefused } from "../../../lib/db/production/identity.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get("appeals") === "1") {
    const user = await resolveRequestUser(req, String(url.searchParams.get("user") || ""));
    if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
    return NextResponse.json({ appeals: await listAppeals({ sellerId: user }) });
  }
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 1), 200);
  const status = url.searchParams.get("status") || null;
  const desk = buildDesk({ limit });
  const cases = status ? desk.cases.filter((c) => c.status === status) : desk.cases;
  // the human queue first, then flagged, then the rest — the desk reads top-down
  const order = { archivalist: 0, flagged: 1, pending: 2, agreed: 3 };
  cases.sort((a, b) => order[a.status] - order[b.status]);
  return NextResponse.json({ ...desk, cases: cases.slice(0, 60), shown: Math.min(cases.length, 60) });
}

export async function POST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "verification-appeal", subject: user, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  if (body.action !== "appeal") return NextResponse.json({ error: "appeal is the only action", code: "UNKNOWN_ACTION" }, { status: 400 });
  try {
    return NextResponse.json({ appeal: await openAppeal({ itemId: String(body.itemId || ""), sellerId: user, evidence: body.evidence }) }, { status: 201 });
  } catch (error) {
    if (error instanceof IdentityRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[verification] appeal failed", error?.message || error);
    return NextResponse.json({ error: "appeals are unavailable", code: "APPEALS_UNAVAILABLE" }, { status: 503 });
  }
}
