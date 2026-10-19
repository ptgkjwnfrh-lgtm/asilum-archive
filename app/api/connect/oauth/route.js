// app/api/connect/oauth/route.js — THE MUSIC CONNECTIONS (V.2 chapter 4;
// CONSTITUTION A6 (3); the last slice). Real flows or honest refusals:
//
//   GET  ?platform=spotify&user=&capability=   start: 302 to Spotify with PKCE
//                                              and a signed state; 503
//                                              requires-approval when unkeyed,
//                                              naming the prepared application
//   GET  ?platform=spotify&code=&state=        callback: exchange, seal, store,
//                                              then /settings?connected=spotify
//   GET  ?platform=apple-music&user=           the MusicKit developer token for
//                                              the client (503 when unkeyed)
//   POST { user, platform: "apple-music", userToken }   store the user token
//                                              MusicKit JS handed back
//   DELETE { user, platform }                  disconnect (the tokens are
//                                              deleted; Spotify's own revoke is
//                                              the passenger's in their account)
// Tokens never appear in a URL ASILUM builds or in a response body.

import { NextResponse } from "next/server";
import { resolveRequestUser, accountIdFromIdentity } from "../../../../lib/identity.js";
import { readJsonRequest } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { CONNECTORS } from "../../../../lib/connectors/index.js";
import { musicConfig, pkce, signState, verifyState, spotifyAuthorizeUrl, spotifyTokenRequest, appleDeveloperToken } from "../../../../lib/connectors/oauth.js";
import { saveConnection, removeConnection, getConnection } from "../../../../lib/connectors/tokens.js";

export const dynamic = "force-dynamic";

const APPLICATIONS = { spotify: "docs/v2/applications/spotify-developer-application.md", "apple-music": "docs/v2/applications/apple-music-developer-program.md" };
const VERIFIER_COOKIE = "asilum-oauth-verifier";

function origin(req) {
  const site = process.env.SITE_ORIGIN;
  if (site) return site.replace(/\/$/, "");
  const u = new URL(req.url);
  return u.origin;
}
const redirectUri = (req) => origin(req) + "/api/connect/oauth";

function unkeyed(platform) {
  return NextResponse.json({ connected: false, platform, state: "requires-approval", message: `${CONNECTORS[platform].label} is not keyed on this deployment — the application is prepared for the owner to submit`, application: APPLICATIONS[platform] }, { status: 503 });
}

async function handleStartSpotify(req, user, capability) {
  const cfg = musicConfig();
  if (!cfg.spotify.configured) return unkeyed("spotify");
  if (!cfg.secret) return NextResponse.json({ error: "DEVICE_COOKIE_SECRET is not set — a connection cannot be signed or stored", code: "NO_SECRET" }, { status: 503 });
  const cap = CONNECTORS.spotify.capabilities[capability];
  if (!cap) return NextResponse.json({ error: "unknown capability" }, { status: 400 });
  if (cap.state === "unsupported") return NextResponse.json({ error: `${capability} is unsupported — ${cap.basis}`, code: "UNSUPPORTED" }, { status: 409 });
  const { verifier, challenge } = pkce();
  const state = signState({ userId: user, secret: cfg.secret });
  const url = spotifyAuthorizeUrl({ clientId: cfg.spotify.clientId, redirectUri: redirectUri(req), scopes: cap.scopes, state, challenge });
  const res = NextResponse.redirect(url, 302);
  res.cookies.set(VERIFIER_COOKIE, `${verifier}.${capability}`, { httpOnly: true, sameSite: "lax", secure: origin(req).startsWith("https"), path: "/api/connect/oauth", maxAge: 600 });
  return res;
}

async function handleCallbackSpotify(req, user, code, state) {
  const cfg = musicConfig();
  if (!cfg.spotify.configured || !cfg.secret) return unkeyed("spotify");
  const v = verifyState(state, { userId: user, secret: cfg.secret });
  if (!v.ok) return NextResponse.json({ error: `the sign-in did not come back as it left (${v.reason})`, code: "BAD_STATE" }, { status: 400 });
  const raw = req.cookies.get(VERIFIER_COOKIE)?.value || "";
  const [verifier, capability] = raw.split(".");
  if (!verifier) return NextResponse.json({ error: "the sign-in's verifier is gone — start again", code: "NO_VERIFIER" }, { status: 400 });
  const r = spotifyTokenRequest({ code, redirectUri: redirectUri(req), verifier, clientId: cfg.spotify.clientId, clientSecret: cfg.spotify.clientSecret });
  let tok;
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
    tok = await resp.json().catch(() => null);
    if (!resp.ok || !tok || !tok.access_token) return NextResponse.json({ error: "Spotify refused the exchange", code: "EXCHANGE_FAILED", detail: tok && tok.error ? String(tok.error).slice(0, 80) : null }, { status: 502 });
  } catch (err) { return NextResponse.json({ error: "Spotify could not be reached", code: "EXCHANGE_FAILED" }, { status: 502 }); }
  await saveConnection({ userId: user, provider: "spotify", accessToken: tok.access_token, refreshToken: tok.refresh_token || null, scope: tok.scope || (capability ? CONNECTORS.spotify.capabilities[capability]?.scopes.join(" ") : null), expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null, secret: cfg.secret });
  const res = NextResponse.redirect(origin(req) + "/settings?connected=spotify", 302);
  res.cookies.set(VERIFIER_COOKIE, "", { httpOnly: true, path: "/api/connect/oauth", maxAge: 0 });
  return res;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const platform = String(searchParams.get("platform") || "").toLowerCase();
  if (!CONNECTORS[platform] || CONNECTORS[platform].kind !== "music") return NextResponse.json({ error: "spotify or apple-music" }, { status: 400 });
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!accountIdFromIdentity(user)) return NextResponse.json({ error: "a music connection belongs to an account, not a device — sign in first", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "connect-oauth", subject: user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  if (platform === "spotify") {
    if (searchParams.get("code") && searchParams.get("state")) return handleCallbackSpotify(req, user, String(searchParams.get("code")), String(searchParams.get("state")));
    if (searchParams.get("error")) return NextResponse.json({ connected: false, platform, error: `Spotify declined: ${String(searchParams.get("error")).slice(0, 80)}` }, { status: 400 });
    return handleStartSpotify(req, user, String(searchParams.get("capability") || "display-link"));
  }
  const cfg = musicConfig();
  if (!cfg["apple-music"].configured) return unkeyed("apple-music");
  try {
    const t = appleDeveloperToken({ teamId: cfg["apple-music"].teamId, keyId: cfg["apple-music"].keyId, privateKey: cfg["apple-music"].privateKey });
    const conn = await getConnection(user, "apple-music");
    return NextResponse.json({ platform, developerToken: t.token, expiresAt: t.expiresAt, connected: !!conn, connectedAt: conn ? conn.connectedAt : null }, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    console.error("[connect oauth] apple developer token failed", err?.message || err);
    return NextResponse.json({ error: "the developer token could not be signed — check the key", code: "TOKEN_FAILED" }, { status: 503 });
  }
}

export async function POST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!accountIdFromIdentity(user)) return NextResponse.json({ error: "a music connection belongs to an account", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  if (String(body.platform) !== "apple-music") return NextResponse.json({ error: "POST stores an Apple Music user token; Spotify connects through the redirect" }, { status: 400 });
  const cfg = musicConfig();
  if (!cfg["apple-music"].configured) return unkeyed("apple-music");
  if (!cfg.secret) return NextResponse.json({ error: "DEVICE_COOKIE_SECRET is not set", code: "NO_SECRET" }, { status: 503 });
  const userToken = String(body.userToken || "");
  if (!userToken || userToken.length > 2048) return NextResponse.json({ error: "userToken required" }, { status: 400 });
  const saved = await saveConnection({ userId: user, provider: "apple-music", accessToken: userToken, scope: "music-user-token", secret: cfg.secret });
  return NextResponse.json({ connected: true, platform: "apple-music", connectedAt: saved.connectedAt });
}

export async function DELETE(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 2 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const platform = String(body.platform || "");
  if (!["spotify", "apple-music"].includes(platform)) return NextResponse.json({ error: "spotify or apple-music" }, { status: 400 });
  const r = await removeConnection(user, platform);
  return NextResponse.json({ connected: false, platform, removed: r.removed });
}
