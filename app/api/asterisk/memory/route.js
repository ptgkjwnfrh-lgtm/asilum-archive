// app/api/asterisk/memory/route.js
// GET  ?user=<uid> → the versioned Asterisk memory contract (ADR-001 v2):
//      what you told us / what we inferred / what Asterisk learned /
//      uncertainty + controls. Identity-gated; aggregates existing stores.
//      ?view=preferences returns only the cheap cross-surface control state.
// POST { hiddenSections?: [...], guidanceEnabled?: boolean } → display and
//      cross-surface guidance preferences. Taste itself remains in its
//      existing stores and is never deleted by pausing guidance.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../../lib/identity.js";
import { asteriskMemory, MEMORY_SECTIONS } from "../../../../lib/asterisk/memory.js";
import { getMemoryPreferences, saveMemoryPreferences } from "../../../../lib/db/production.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../../lib/security/json.js";
import { withPrivateCache } from "../../../../lib/security/json.js";

export const dynamic = "force-dynamic";

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "asterisk-memory-read", subject: user, limit: 60, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  if (searchParams.get("view") === "preferences") {
    return NextResponse.json({ preferences: await getMemoryPreferences(user) });
  }
  const r = await asteriskMemory(user);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ memory: r.memory });
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const user = await resolveRequestUser(req, String(parsed.body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "asterisk-memory-write", subject: user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const hidden = parsed.body.hiddenSections;
  const guidanceEnabled = parsed.body.guidanceEnabled;
  const explorationOff = parsed.body.explorationOff; // V.2 14.9: the |A| in the Info Dock
  if (hidden !== undefined &&
      (!Array.isArray(hidden) || hidden.length > MEMORY_SECTIONS.length ||
       !hidden.every((s) => MEMORY_SECTIONS.includes(s)) ||
       new Set(hidden).size !== hidden.length)) {
    return NextResponse.json(
      { error: `hiddenSections must be unique values from: ${MEMORY_SECTIONS.join(", ")}` },
      { status: 400 });
  }
  if (guidanceEnabled !== undefined && typeof guidanceEnabled !== "boolean") {
    return NextResponse.json({ error: "guidanceEnabled must be boolean" }, { status: 400 });
  }
  if (explorationOff !== undefined && typeof explorationOff !== "boolean") {
    return NextResponse.json({ error: "explorationOff must be boolean" }, { status: 400 });
  }
  if (hidden === undefined && guidanceEnabled === undefined && explorationOff === undefined) {
    return NextResponse.json(
      { error: "hiddenSections, guidanceEnabled or explorationOff required" }, { status: 400 });
  }
  const preferences = await saveMemoryPreferences(user, {
    ...(hidden !== undefined ? { hiddenSections: hidden } : {}),
    ...(guidanceEnabled !== undefined ? { guidanceEnabled } : {}),
    ...(explorationOff !== undefined ? { explorationOff } : {}),
  });
  return NextResponse.json({ preferences });
}

// Personal data: never shared-cacheable (see withPrivateCache).
export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
