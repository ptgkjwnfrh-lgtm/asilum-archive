// lib/connectors/tokens.js — CONNECTED-ACCOUNT TOKENS (the music seams; the
// last slice). One row per passenger and provider, the tokens encrypted at
// rest with a key derived from DEVICE_COOKIE_SECRET (AES-256-GCM), on either
// backend; without the secret nothing is stored and the connection cannot be
// made. Erased with the passenger's data (privacy.js names the table).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPool, hasRelation } from "../db/core/pool.js";
import { mem } from "../db/production/store.js";

if (!mem.connectorTokens) mem.connectorTokens = new Map();
const key = (userId, provider) => `${userId}|${provider}`;
const derive = (secret) => createHash("sha256").update("asilum-connector-tokens:" + secret).digest();

export function seal(plain, secret) {
  if (!secret) throw new TypeError("a secret is required to store a token");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(secret), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}
export function open(sealed, secret) {
  if (!secret || typeof sealed !== "string") return null;
  const [v, iv, enc, tag] = sealed.split(".");
  if (v !== "v1") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", derive(secret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}

const out = (r) => (r ? { userId: r.user_id, provider: r.provider, scope: r.scope || null, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, connectedAt: r.connected_at ? new Date(r.connected_at).toISOString() : null, providerUserId: r.provider_user_id || null } : null);

export async function saveConnection({ userId, provider, accessToken, refreshToken = null, scope = null, expiresAt = null, providerUserId = null, secret, now = Date.now() } = {}) {
  if (!userId || !provider || !accessToken) throw new TypeError("userId, provider and accessToken are required");
  const row = { user_id: userId, provider, access_sealed: seal(accessToken, secret), refresh_sealed: refreshToken ? seal(refreshToken, secret) : null, scope, expires_at: expiresAt ? new Date(expiresAt).toISOString() : null, provider_user_id: providerUserId, connected_at: new Date(now).toISOString() };
  const p = await getPool();
  if (!p || !(await hasRelation(p, "connector_tokens"))) { mem.connectorTokens.set(key(userId, provider), row); return out(row); }
  await p.query(`INSERT INTO connector_tokens (user_id, provider, access_sealed, refresh_sealed, scope, expires_at, provider_user_id, connected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (user_id, provider) DO UPDATE SET access_sealed=EXCLUDED.access_sealed, refresh_sealed=EXCLUDED.refresh_sealed, scope=EXCLUDED.scope, expires_at=EXCLUDED.expires_at, provider_user_id=EXCLUDED.provider_user_id, connected_at=EXCLUDED.connected_at`,
    [row.user_id, row.provider, row.access_sealed, row.refresh_sealed, row.scope, row.expires_at, row.provider_user_id, row.connected_at]);
  return out(row);
}

/** The connection's facts — never the tokens. */
export async function getConnection(userId, provider) {
  const p = await getPool();
  if (!p || !(await hasRelation(p, "connector_tokens"))) return out(mem.connectorTokens.get(key(userId, provider)) || null);
  const { rows } = await p.query("SELECT * FROM connector_tokens WHERE user_id=$1 AND provider=$2", [userId, provider]);
  return out(rows[0] || null);
}

/** The tokens, opened, for a server-side call. Null when absent or unsealable. */
export async function openConnection(userId, provider, secret) {
  const p = await getPool();
  let r;
  if (!p || !(await hasRelation(p, "connector_tokens"))) r = mem.connectorTokens.get(key(userId, provider)) || null;
  else r = (await p.query("SELECT * FROM connector_tokens WHERE user_id=$1 AND provider=$2", [userId, provider])).rows[0] || null;
  if (!r) return null;
  const accessToken = open(r.access_sealed, secret);
  if (!accessToken) return null;
  return { ...out(r), accessToken, refreshToken: r.refresh_sealed ? open(r.refresh_sealed, secret) : null };
}

export async function listConnections(userId) {
  const p = await getPool();
  if (!p || !(await hasRelation(p, "connector_tokens"))) return [...mem.connectorTokens.values()].filter((r) => r.user_id === userId).map(out);
  return (await p.query("SELECT * FROM connector_tokens WHERE user_id=$1", [userId])).rows.map(out);
}

export async function removeConnection(userId, provider = null) {
  const p = await getPool();
  if (!p || !(await hasRelation(p, "connector_tokens"))) {
    let n = 0;
    for (const [k, r] of mem.connectorTokens) if (r.user_id === userId && (!provider || r.provider === provider)) { mem.connectorTokens.delete(k); n += 1; }
    return { removed: n };
  }
  const r = provider ? await p.query("DELETE FROM connector_tokens WHERE user_id=$1 AND provider=$2", [userId, provider]) : await p.query("DELETE FROM connector_tokens WHERE user_id=$1", [userId]);
  return { removed: r.rowCount || 0 };
}
