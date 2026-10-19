// lib/connectors/oauth.js — THE MUSIC SEAMS (V.2 chapter 4; CONSTITUTION A6 (3),
// owner 18 Oct 2026: "apply to get Spotify and Apple Music ... save that for
// last"; the last slice). PURE where it can be; node:crypto only.
//
//   SPOTIFY        Authorization Code with PKCE (the flow Spotify requires of a
//                  web app): ASILUM sends the passenger to accounts.spotify.com
//                  with a code challenge and a signed state, Spotify sends them
//                  back with a code, the route exchanges it for tokens. The
//                  scopes are the approved capability's and nothing more.
//   APPLE MUSIC    no OAuth. MusicKit needs a DEVELOPER TOKEN — a JWT ASILUM
//                  signs with its Apple Developer key (ES256) — and a USER
//                  TOKEN the passenger grants in MusicKit JS on the client.
//                  ASILUM mints the developer token here when the key is set.
//   WITHOUT KEYS   every helper says so (`configured: false`) and the route
//                  answers 503 requires-approval with the prepared application
//                  (docs/v2/applications/). Nothing redirects, nothing pretends.
//   NEVER          listening history into ASTERISK (RIGHTS-REGISTER), tokens in
//                  a URL, a secret in the client bundle.

import { createHash, createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";

export const SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
export const APPLE_MUSIC_API = "https://api.music.apple.com/v1";
export const STATE_TTL_MS = 10 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Which music seams are keyed here (server only). */
export function musicConfig(env = process.env) {
  return {
    spotify: { configured: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET), clientId: env.SPOTIFY_CLIENT_ID || null, clientSecret: env.SPOTIFY_CLIENT_SECRET || null },
    "apple-music": { configured: !!(env.APPLE_MUSIC_TEAM_ID && env.APPLE_MUSIC_KEY_ID && env.APPLE_MUSIC_PRIVATE_KEY), teamId: env.APPLE_MUSIC_TEAM_ID || null, keyId: env.APPLE_MUSIC_KEY_ID || null, privateKey: env.APPLE_MUSIC_PRIVATE_KEY ? String(env.APPLE_MUSIC_PRIVATE_KEY).replace(/\\n/g, "\n") : null },
    secret: env.DEVICE_COOKIE_SECRET && String(env.DEVICE_COOKIE_SECRET).length >= 32 ? String(env.DEVICE_COOKIE_SECRET) : null,
  };
}

/** PKCE: a verifier and its S256 challenge. */
export function pkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** A signed state: `<user>.<issued>.<nonce>.<hmac>` — bound to the passenger and ten minutes. */
export function signState({ userId, secret, now = Date.now() } = {}) {
  if (!secret) throw new TypeError("a signing secret is required");
  const body = `${userId}.${now}.${b64url(randomBytes(9))}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("hex").slice(0, 32)}`;
}
export function verifyState(state, { userId, secret, now = Date.now() } = {}) {
  if (!secret || typeof state !== "string") return { ok: false, reason: "no state" };
  const i = state.lastIndexOf(".");
  if (i < 0) return { ok: false, reason: "malformed" };
  const body = state.slice(0, i), mac = state.slice(i + 1);
  const want = createHmac("sha256", secret).update(body).digest("hex").slice(0, 32);
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return { ok: false, reason: "bad signature" };
  const [user, issued] = body.split(".");
  if (user !== userId) return { ok: false, reason: "another passenger's state" };
  if (!(now - Number(issued) <= STATE_TTL_MS) || now < Number(issued)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** The Spotify authorize URL for one capability's scopes. */
export function spotifyAuthorizeUrl({ clientId, redirectUri, scopes = [], state, challenge } = {}) {
  if (!clientId || !redirectUri || !state || !challenge) throw new TypeError("clientId, redirectUri, state and challenge are required");
  const u = new URL(SPOTIFY_AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", challenge);
  if (scopes.length) u.searchParams.set("scope", scopes.join(" "));
  return u.toString();
}

/** The token exchange body (PKCE): sent as application/x-www-form-urlencoded with HTTP Basic client auth. */
export function spotifyTokenRequest({ code, redirectUri, verifier, clientId, clientSecret } = {}) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId });
  return { url: SPOTIFY_TOKEN, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") }, body: body.toString() };
}
export function spotifyRefreshRequest({ refreshToken, clientId, clientSecret } = {}) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
  return { url: SPOTIFY_TOKEN, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") }, body: body.toString() };
}

// ES256 JOSE signature: DER (r,s sequence) → raw r||s, 32 bytes each.
function derToJose(der) {
  let i = 2; // SEQUENCE, length
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const take = () => { if (der[i++] !== 0x02) throw new Error("bad DER"); let len = der[i++]; let v = der.subarray(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.subarray(1); return Buffer.concat([Buffer.alloc(32 - v.length), v]); };
  const r = take(), s = take();
  return Buffer.concat([r, s]);
}

/** Apple Music developer token: ES256 JWT, iss = team id, kid = key id, six months at most (Apple's cap). */
export function appleDeveloperToken({ teamId, keyId, privateKey, now = Date.now(), ttlSeconds = 180 * 86_400 } = {}) {
  if (!teamId || !keyId || !privateKey) throw new TypeError("teamId, keyId and privateKey are required");
  const ttl = Math.min(ttlSeconds, 15_777_000); // Apple: a developer token lives at most six months
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: teamId, iat, exp: iat + ttl }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = derToJose(signer.sign({ key: privateKey, dsaEncoding: "der" }));
  return { token: `${header}.${payload}.${b64url(sig)}`, expiresAt: new Date((iat + ttl) * 1000).toISOString() };
}

/** Decode a JWT's payload without verifying (for the token's own expiry, which we minted). */
export function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; }
}
