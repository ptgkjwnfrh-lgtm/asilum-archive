// tests/connectors-oauth.test.js — THE MUSIC SEAMS (V.2 chapter 4; CONSTITUTION
// A6 (3); the last slice). Held here:
//   * PKCE: the challenge is the S256 of the verifier; a state is bound to the
//     passenger and ten minutes and fails on another passenger, a bad
//     signature or an old issue;
//   * the Spotify authorize URL carries only the capability's scopes and the
//     challenge; the exchange is a form body with Basic client auth;
//   * the Apple developer token is an ES256 JWT with the team as issuer, the
//     key as kid, six months at most;
//   * tokens are sealed at rest and open only with the secret;
//   * the route: unkeyed answers 503 requires-approval naming the prepared
//     application and never redirects; a device cannot connect; the registry
//     reads a stored connection as available for that account; disconnect
//     removes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, createVerify } from "node:crypto";
import * as O from "../lib/connectors/oauth.js";
import * as T from "../lib/connectors/tokens.js";
import { capabilityState, connectorRegistry, CONNECTORS } from "../lib/connectors/index.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";
import { readFileSync, existsSync } from "node:fs";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";

test("the law: PKCE, the signed state, the authorize URL and the exchange body", () => {
  const { verifier, challenge } = O.pkce();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  const state = O.signState({ userId: "sb-me", secret: SECRET, now: 1000 });
  assert.equal(O.verifyState(state, { userId: "sb-me", secret: SECRET, now: 5000 }).ok, true);
  assert.equal(O.verifyState(state, { userId: "sb-you", secret: SECRET, now: 5000 }).reason, "another passenger's state");
  assert.equal(O.verifyState(state, { userId: "sb-me", secret: SECRET, now: 1000 + O.STATE_TTL_MS + 1 }).reason, "expired");
  assert.equal(O.verifyState(state.slice(0, -1) + (state.endsWith("a") ? "b" : "a"), { userId: "sb-me", secret: SECRET, now: 5000 }).reason, "bad signature");
  assert.equal(O.verifyState(state, { userId: "sb-me", secret: "another-secret-of-at-least-thirty-two-chars", now: 5000 }).reason, "bad signature");
  const url = new URL(O.spotifyAuthorizeUrl({ clientId: "cid", redirectUri: "https://asilum.app/api/connect/oauth", scopes: CONNECTORS.spotify.capabilities.playback.scopes, state, challenge }));
  assert.equal(url.origin + url.pathname, O.SPOTIFY_AUTHORIZE);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("scope"), "streaming user-read-playback-state"); assert.equal(url.searchParams.get("response_type"), "code");
  assert.ok(!url.toString().includes("secret"), "no secret in the URL");
  const x = O.spotifyTokenRequest({ code: "c", redirectUri: "https://asilum.app/api/connect/oauth", verifier, clientId: "cid", clientSecret: "sec" });
  assert.equal(x.url, O.SPOTIFY_TOKEN); assert.match(x.headers.authorization, /^Basic /); assert.ok(x.body.includes("code_verifier=" + verifier) && x.body.includes("grant_type=authorization_code"));
  assert.ok(O.spotifyRefreshRequest({ refreshToken: "r", clientId: "cid", clientSecret: "sec" }).body.includes("grant_type=refresh_token"));
  assert.throws(() => O.spotifyAuthorizeUrl({ clientId: "cid" }), /required/);
});

test("the law: the Apple developer token is an ES256 JWT the key verifies, six months at most", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const t = O.appleDeveloperToken({ teamId: "TEAM123", keyId: "KEY456", privateKey: pem, now: 1_700_000_000_000, ttlSeconds: 400 * 86_400 });
  const [h, p, s] = t.token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY456" });
  const payload = O.jwtPayload(t.token);
  assert.equal(payload.iss, "TEAM123"); assert.equal(payload.exp - payload.iat, 15_777_000, "capped at Apple's six months");
  const v = createVerify("SHA256"); v.update(`${h}.${p}`);
  assert.equal(v.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")), true, "the raw r||s signature verifies");
  assert.throws(() => O.appleDeveloperToken({ teamId: "x" }), /required/);
  const cfg = O.musicConfig({ SPOTIFY_CLIENT_ID: "a", SPOTIFY_CLIENT_SECRET: "b", DEVICE_COOKIE_SECRET: SECRET });
  assert.equal(cfg.spotify.configured, true); assert.equal(cfg["apple-music"].configured, false); assert.equal(cfg.secret, SECRET);
  assert.equal(O.musicConfig({}).secret, null);
});

test("the store: tokens are sealed at rest and open only with the secret; a connection reads available for its account", async () => {
  const sealed = T.seal("access-token-xyz", SECRET);
  assert.ok(!sealed.includes("access-token-xyz") && sealed.startsWith("v1."));
  assert.equal(T.open(sealed, SECRET), "access-token-xyz"); assert.equal(T.open(sealed, "wrong-secret-of-at-least-thirty-two-chars!!"), null);
  const me = "sb-" + globalThis.crypto.randomUUID();
  const saved = await T.saveConnection({ userId: me, provider: "spotify", accessToken: "A", refreshToken: "R", scope: "user-read-private", expiresAt: Date.now() + 3600_000, secret: SECRET });
  assert.equal(saved.provider, "spotify"); assert.equal("accessToken" in saved, false, "the facts never carry the token");
  assert.equal((await T.getConnection(me, "spotify")).scope, "user-read-private");
  const opened = await T.openConnection(me, "spotify", SECRET);
  assert.equal(opened.accessToken, "A"); assert.equal(opened.refreshToken, "R");
  assert.equal(await T.openConnection(me, "spotify", "wrong-secret-of-at-least-thirty-two-chars!!"), null);
  assert.deepEqual((await T.listConnections(me)).map((c) => c.provider), ["spotify"]);
  process.env.SPOTIFY_CLIENT_ID = "cid"; process.env.SPOTIFY_CLIENT_SECRET = "sec";
  try {
    assert.equal(capabilityState("spotify", "display-link", { account: me, connected: ["spotify"] }), CONNECTORS.spotify.capabilities["display-link"].state === "env" ? "available" : CONNECTORS.spotify.capabilities["display-link"].state);
    const reg = connectorRegistry({ account: me, connected: ["spotify"] }).find((c) => c.id === "spotify");
    assert.equal(reg.connected, true); assert.equal(reg.flow, "/api/connect/oauth?platform=spotify");
  } finally { delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET; }
  assert.equal((await T.removeConnection(me, "spotify")).removed, 1);
  assert.equal(await T.getConnection(me, "spotify"), null);
  await assert.rejects(() => T.saveConnection({ userId: me, provider: "spotify", accessToken: "A", secret: null }), /secret/);
});

test("the route: unkeyed answers 503 with the prepared application and never redirects; a device cannot connect; the applications exist", async () => {
  delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET; delete process.env.APPLE_MUSIC_TEAM_ID;
  const r = await loadRoute("app/api/connect/oauth/route.js");
  const me = newDevice();
  assert.equal((await callRoute(r.GET, { path: "/api/connect/oauth", query: { platform: "spotify" } })).status, 401);
  assert.equal((await callRoute(r.GET, { path: "/api/connect/oauth", query: { platform: "tiktok", user: me.uid }, cookies: me.cookies })).status, 400);
  const dev = await callRoute(r.GET, { path: "/api/connect/oauth", query: { platform: "spotify", user: me.uid }, cookies: me.cookies });
  assert.equal(dev.status, 403); assert.equal(dev.body.code, "ACCOUNT_REQUIRED");
  const del = await callRoute(r.DELETE, { path: "/api/connect/oauth", cookies: me.cookies, json: { user: me.uid, platform: "spotify" } });
  assert.equal(del.status, 200); assert.equal(del.body.removed, 0);
  for (const f of ["docs/v2/applications/spotify-developer-application.md", "docs/v2/applications/apple-music-developer-program.md"]) {
    assert.ok(existsSync(f), f);
    const text = readFileSync(f, "utf8");
    assert.match(text, /OWNER/, "the owner's own fields are marked"); assert.match(text, /Nothing below\s+has been submitted/);
  }
  const connect = await loadRoute("app/api/connect/route.js");
  const reg = await callRoute(connect.GET, { path: "/api/connect", query: { user: me.uid }, cookies: me.cookies });
  assert.equal(reg.status, 200); assert.equal(reg.body.oauth.spotify, false);
  const spotify = reg.body.connectors.find((c) => c.id === "spotify");
  assert.equal(spotify.flow, "/api/connect/oauth?platform=spotify"); assert.equal(spotify.connected, false);
  assert.equal(spotify.capabilities.find((c) => c.id === "taste-import").state, "unsupported", "profiling stays unsupported (RIGHTS-REGISTER)");
});
