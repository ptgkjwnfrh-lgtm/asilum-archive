// app/api/connect/route.js — THE CONNECTOR REGISTRY ON THE WIRE (V.2 brief
// §11). GET → every connector's capabilities and their explicit states for
// this deployment and (when signed in) this account. POST { user, platform,
// capability? } → the state of that capability and the sentence beside it —
// NEVER a token exchange, because no OAuth adapter exists yet, and never a
// simulated import (CONSTITUTION). The registry is lib/connectors/index.js.

import { NextResponse } from "next/server";
import { readJsonRequest } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { requestSubject } from "../../../lib/security/request.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { CONNECTORS, capabilityState, connectSentence, connectorRegistry } from "../../../lib/connectors/index.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "").catch(() => null);
  const connected = user ? (await import("../../../lib/connectors/tokens.js")).listConnections(user).then((rows) => rows.map((r) => r.provider)).catch(() => []) : [];
  const { musicConfig } = await import("../../../lib/connectors/oauth.js");
  const music = musicConfig();
  return NextResponse.json({ connectors: connectorRegistry({ account: user || null, connected: await connected }), oauth: { spotify: music.spotify.configured, "apple-music": music["apple-music"].configured }, note: "the music seams connect through /api/connect/oauth when keyed; every other state is the approved capability's status here" },
    { headers: { "cache-control": "private, no-store" } });
}

export async function POST(req) {
  const quota = await consumeRateLimit({ scope: "connect", subject: requestSubject(req), limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const platform = String(body.platform || "").toLowerCase();
  const c = CONNECTORS[platform];
  if (!c) return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  const user = await resolveRequestUser(req, String(body.user || "")).catch(() => null);
  const capability = String(body.capability || Object.keys(c.capabilities)[0]);
  if (!c.capabilities[capability]) return NextResponse.json({ error: "unknown capability", capabilities: Object.keys(c.capabilities) }, { status: 400 });
  const connected = user ? await (await import("../../../lib/connectors/tokens.js")).listConnections(user).then((rows) => rows.map((r) => r.provider)).catch(() => []) : [];
  const state = capabilityState(platform, capability, { account: user || null, connected });
  const message = connectSentence(platform, capability, state);
  // 501 for anything that cannot proceed here; 200 only for a capability that
  // works WITHOUT a connection (the manual stamps) — a connection itself never
  // succeeds from this route because there is no flow to complete
  const proceeds = state === "available";
  return NextResponse.json(
    { connected: false, platform, capability, state, message, never: c.never, basis: c.basis },
    { status: proceeds ? 200 : 501 });
}
