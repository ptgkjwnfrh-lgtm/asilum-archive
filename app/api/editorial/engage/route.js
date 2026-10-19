// app/api/editorial/engage/route.js
// LIKES + SAVES on transmissions (owner directive, 14 Aug 2026
// backlog 2). Person-deduped counters in the popularity style: the
// ledger's primary key is (post_id, identity_hash, kind), so pressing
// LIKE in a loop — or from ten tabs — moves the counter exactly once.
// Only another human moves it again. Nothing here is ever fabricated:
// every number returned is a count of rows that exist.
//
// GET  ?ids=1,2,3        → counts for a page + this viewer's own state
// POST { user, id, kind, on } → toggle one person's like/save

import { NextResponse } from "next/server";
import { engagementFor, setTransmissionEngagement } from "../../../../lib/db/production.js";
import { resolveRequestUser } from "../../../../lib/identity.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../../lib/security/json.js";
import { requestSubject } from "../../../../lib/security/request.js";

export const dynamic = "force-dynamic";

const KINDS = ["like", "save"];
const MAX_IDS = 120;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const ids = String(searchParams.get("ids") || "")
    .split(",").map((v) => v.trim()).filter(Boolean).slice(0, MAX_IDS);
  if (ids.some((id) => !/^\d{1,18}$/.test(id))) {
    return NextResponse.json({ error: "bad post id" }, { status: 400 });
  }
  const quota = await consumeRateLimit({
    scope: "engage-read", subject: requestSubject(req), limit: 120, windowMs: 60_000,
  });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  // Identity is OPTIONAL here: a signed-out reader still sees real counts,
  // just without their own state. Failing the read would hide true numbers
  // from anonymous visitors for no gain.
  const user = await resolveRequestUser(req, String(searchParams.get("user") || "")).catch(() => null);
  try {
    return NextResponse.json({ engagement: await engagementFor(ids, user) });
  } catch {
    // Honest degradation: no counts rather than invented ones. Callers
    // render nothing on an empty map, never a zero they cannot stand behind.
    return NextResponse.json({ engagement: {} });
  }
}

export async function POST(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const rawId = String(body.id ?? "");
  if (!/^\d{1,18}$/.test(rawId)) return NextResponse.json({ error: "bad post id" }, { status: 400 });
  const kind = String(body.kind || "");
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "unknown engagement kind" }, { status: 400 });
  const on = body.on !== false;
  // Generous but finite: a reader working down the wire engages often, a
  // script does not get to write unbounded rows.
  const quota = await consumeRateLimit({ scope: "engage", subject: user, limit: 300, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const counts = await setTransmissionEngagement({ postId: rawId, userId: user, kind, on });
    // null = the transmission is not on the wire (deleted, held, or never
    // published). Same 404 the lifecycle verbs answer — engagement never
    // reveals whether a hidden transmission exists.
    if (!counts) return NextResponse.json({ error: "transmission not found" }, { status: 404 });
    return NextResponse.json({ id: rawId, ...counts });
  } catch {
    return NextResponse.json({ error: "engagement failed" }, { status: 500 });
  }
}
