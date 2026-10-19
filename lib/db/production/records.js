// lib/db/production/records.js — user_records (v53): the four kinds of record
// Live Launch V.2 kept on the device alone, now persisted per identity.
//
//   save        a person / place / event / article the reader kept
//               (pieces still land on the moodboard; posts on the wire)
//   location    the base city and its visibility — ONE row, record_id 'base',
//               private: served only to its owner (ADR-006)
//   correction  a queued correction to an overview or a place
//   draft       a studio draft (event / shop / promotion)
//   anchor      an identity anchor from the Passport's onboarding (14.3,
//               14.11; slice 10c): the passenger's own answer and the tags it
//               carries — designated and removed only by the passenger
//
// The payload is the client's record exactly as it writes it to localStorage,
// capped at 8 KiB and treated as DATA — nothing here reads instructions out
// of it. mem and Postgres behave identically (docs/engineering/architecture.md: the two backends
// must agree); adoption, erasure and export are registered in
// corrections.js / privacy.js beside every other per-person table.

import { getPool } from "../core/pool.js";
import { mem, boundedLimit } from "./store.js";

// "media" (v67, slice 9): the media preferences — captions, their size and
// opacity, quality, autoplay — one record per person, so 3.10's "the
// preference syncs across devices" rides adoption and erasure for free.
export const RECORD_KINDS = Object.freeze(["save", "location", "correction", "draft", "media", "anchor", "attendance"]);
export const RECORD_CAPS = Object.freeze({ save: 400, location: 1, correction: 50, draft: 50, media: 1, anchor: 50, attendance: 200 });
export const MEDIA_RECORD_ID = "preferences";
export const RECORD_PAYLOAD_MAX_BYTES = 8 * 1024;
export const LOCATION_RECORD_ID = "base";

const key = (userId, kind, recordId) => `${userId}|${kind}|${recordId}`;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

function recordRow(r) {
  return {
    id: r.id, userId: r.user_id, kind: r.kind, recordId: r.record_id,
    payload: r.payload || {},
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    persistent: true,
  };
}

export function validateRecordInput({ kind, recordId, payload }) {
  if (!RECORD_KINDS.includes(kind)) return { ok: false, error: "unknown record kind", code: "record_kind" };
  const id = String(recordId ?? "");
  if (!id || id.length > 160 || CONTROL_CHARS.test(id)) return { ok: false, error: "recordId required (1–160 chars)", code: "record_id" };
  if (kind === "location" && id !== LOCATION_RECORD_ID) return { ok: false, error: "a location record is 'base'", code: "record_id" };
  if (kind === "media" && id !== MEDIA_RECORD_ID) return { ok: false, error: "a media record is 'preferences'", code: "record_id" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "payload must be an object", code: "record_payload" };
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > RECORD_PAYLOAD_MAX_BYTES) return { ok: false, error: `payload over ${RECORD_PAYLOAD_MAX_BYTES} bytes`, code: "record_too_large" };
  return { ok: true, kind, recordId: id, payload };
}

export async function listUserRecords(userId, { kind = null, limit = 500 } = {}) {
  if (!userId) return [];
  const cap = boundedLimit(limit, 500, 1000);
  const p = await getPool();
  if (!p) {
    return [...mem.records.values()]
      .filter((r) => r.userId === userId && (!kind || r.kind === kind))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
      .slice(0, cap)
      .map((r) => ({ ...r, payload: { ...r.payload } }));
  }
  const { rows } = kind
    ? await p.query(`SELECT * FROM user_records WHERE user_id=$1 AND kind=$2 ORDER BY updated_at DESC, id DESC LIMIT $3`, [userId, kind, cap])
    : await p.query(`SELECT * FROM user_records WHERE user_id=$1 ORDER BY updated_at DESC, id DESC LIMIT $2`, [userId, cap]);
  return rows.map(recordRow);
}

export async function countUserRecords(userId, kind) {
  const p = await getPool();
  if (!p) return [...mem.records.values()].filter((r) => r.userId === userId && r.kind === kind).length;
  const { rows } = await p.query("SELECT count(*)::int AS n FROM user_records WHERE user_id=$1 AND kind=$2", [userId, kind]);
  return rows[0]?.n || 0;
}

/**
 * Upsert. `{ record, created }` — or `{ capped: true, cap }` when the kind's
 * cap would be exceeded by a NEW record (an update of an existing one is
 * never refused by the cap).
 */
export async function putUserRecord(userId, { kind, recordId, payload }) {
  if (!userId) throw new TypeError("userId required");
  const v = validateRecordInput({ kind, recordId, payload });
  if (!v.ok) { const e = new Error(v.error); e.code = v.code; throw e; }
  const p = await getPool();
  const now = Date.now();
  if (!p) {
    const k = key(userId, v.kind, v.recordId);
    const existing = mem.records.get(k);
    if (!existing && (await countUserRecords(userId, v.kind)) >= RECORD_CAPS[v.kind]) {
      return { capped: true, cap: RECORD_CAPS[v.kind] };
    }
    const row = existing
      ? { ...existing, payload: { ...v.payload }, updatedAt: now }
      : { id: mem.seq++, userId, kind: v.kind, recordId: v.recordId, payload: { ...v.payload }, createdAt: now, updatedAt: now, persistent: false };
    mem.records.set(k, row);
    return { record: { ...row, payload: { ...row.payload } }, created: !existing };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["user-lock:" + userId]);
    const existing = await client.query(
      "SELECT id FROM user_records WHERE user_id=$1 AND kind=$2 AND record_id=$3", [userId, v.kind, v.recordId]);
    if (!existing.rows[0]) {
      const n = await client.query("SELECT count(*)::int AS n FROM user_records WHERE user_id=$1 AND kind=$2", [userId, v.kind]);
      if ((n.rows[0]?.n || 0) >= RECORD_CAPS[v.kind]) { await client.query("ROLLBACK"); return { capped: true, cap: RECORD_CAPS[v.kind] }; }
    }
    const { rows } = await client.query(
      `INSERT INTO user_records (user_id, kind, record_id, payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (user_id, kind, record_id)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
       RETURNING *, (xmax = 0) AS inserted`,
      [userId, v.kind, v.recordId, JSON.stringify(v.payload)]);
    await client.query("COMMIT");
    return { record: recordRow(rows[0]), created: rows[0].inserted === true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** `{ deleted: boolean }` — deleting what is not there is not an error. */
export async function deleteUserRecord(userId, kind, recordId) {
  if (!userId) throw new TypeError("userId required");
  if (!RECORD_KINDS.includes(kind)) return { deleted: false };
  const p = await getPool();
  if (!p) return { deleted: mem.records.delete(key(userId, kind, String(recordId))) };
  const r = await p.query("DELETE FROM user_records WHERE user_id=$1 AND kind=$2 AND record_id=$3", [userId, kind, String(recordId)]);
  return { deleted: r.rowCount > 0 };
}
