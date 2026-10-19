// lib/db/production/media.js — MOTION ASSETS (V.2 Blueprint chapter 3,
// 17.2; slice 9; schema v67). SERVER-ONLY; memory mode mirrors Postgres.
// The law is lib/media/index.js; the worker (lib/media/worker.js) reads the
// bytes; this keeps:
//
//   assets    one uploaded video per row: pending when the signed upload is
//             issued, ready once the worker has admitted the server's copy,
//             refused by name (the object is deleted), removed by the owner.
//             The facts on a ready row are what the probe READ — never what
//             the client declared (declared_bytes is kept beside them so a
//             mismatch is visible).
//   captions  the creator's WebVTT tracks, validated by the law, inline.
//
// Nothing here touches storage; the worker and the route do, and they call
// in with the result.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { MOTION, validateCaptionTracks, publicVideo } from "../../media/index.js";

export class MotionRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "MotionRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "motion_assets") : true);
const needs = () => { throw new MotionRefused("SCHEMA_V67_REQUIRED", "MOTION uploads need schema v67 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();
const num = (v) => (v == null ? null : Number(v));

const out = (r) => ({
  id: String(r.id), ownerId: r.owner_id, path: r.path, container: r.container, mime: r.mime, declaredBytes: Number(r.declared_bytes), bytes: num(r.bytes),
  durationMs: num(r.duration_ms), width: num(r.width), height: num(r.height), rotation: Number(r.rotation || 0), codec: r.codec || null, audio: !!r.audio, fastStart: r.fast_start == null ? null : !!r.fast_start,
  poster: r.poster_path || null, captions: json(r.captions) || [], state: r.state, refusalCode: r.refusal_code || null, refusalNote: r.refusal_note || null,
  createdAt: iso(r.created_at), verifiedAt: iso(r.verified_at), updatedAt: iso(r.updated_at),
});

/** A pending row for a signed upload. The path is the storage object's. */
export async function createMotionAsset({ ownerId, path, container, mime, declaredBytes, now = Date.now() }) {
  if (!ownerId) throw new MotionRefused("NO_OWNER", "an upload needs an owner", 401);
  if (!MOTION.containers.includes(container)) throw new MotionRefused("CONTAINER", "an MP4 or a WebM", 400);
  const r = { id: newId(), owner_id: ownerId, path: String(path), container, mime: String(mime || ""), declared_bytes: Math.max(0, Math.trunc(Number(declaredBytes) || 0)), bytes: null, duration_ms: null, width: null, height: null, rotation: 0, codec: null, audio: false, fast_start: null, poster_path: null, captions: [], state: "pending", refusal_code: null, refusal_note: null, created_at: new Date(now).toISOString(), verified_at: null, updated_at: new Date(now).toISOString() };
  const p = await getPool();
  if (!p) { mem.motionAssets.set(r.id, r); return out(r); }
  if (!(await applied(p))) needs();
  await p.query(
    `INSERT INTO motion_assets (id, owner_id, path, container, mime, declared_bytes, captions, state, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'pending',$7,$7)`,
    [r.id, r.owner_id, r.path, r.container, r.mime, r.declared_bytes, r.created_at]);
  return out(r);
}

export async function getMotionAsset(id) {
  const p = await getPool();
  if (!p) { const r = mem.motionAssets.get(String(id)); return r ? out(r) : null; }
  if (!(await applied(p))) return null;
  const { rows } = await p.query("SELECT * FROM motion_assets WHERE id=$1", [String(id)]);
  return rows[0] ? out(rows[0]) : null;
}

export async function listMotionAssets({ ownerId, states = null, limit = 50 } = {}) {
  const p = await getPool();
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));
  if (!p) return [...mem.motionAssets.values()].filter((r) => r.owner_id === ownerId && (!states || states.includes(r.state))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, cap).map(out);
  if (!(await applied(p))) return [];
  const { rows } = await p.query("SELECT * FROM motion_assets WHERE owner_id=$1 AND ($2::text[] IS NULL OR state = ANY($2)) ORDER BY created_at DESC LIMIT $3", [ownerId, states, cap]);
  return rows.map(out);
}

async function owned(id, ownerId) {
  const a = await getMotionAsset(id);
  if (!a) throw new MotionRefused("NOT_FOUND", "no such upload", 404);
  if (ownerId && a.ownerId !== ownerId) throw new MotionRefused("NOT_YOURS", "not your upload", 403);
  return a;
}

async function update(id, patch, now) {
  const stamp = new Date(now).toISOString();
  const p = await getPool();
  if (!p) { const r = mem.motionAssets.get(String(id)); Object.assign(r, patch, { updated_at: stamp }); return out(r); }
  const cols = Object.keys(patch);
  const { rows } = await p.query(
    `UPDATE motion_assets SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(", ")}, updated_at=$${cols.length + 2} WHERE id=$1 RETURNING *`,
    [String(id), ...cols.map((c) => (c === "captions" ? JSON.stringify(patch[c]) : patch[c])), stamp]);
  return out(rows[0]);
}

/** The worker admitted the server's copy: the facts it read become the row. */
export async function admitMotionAsset({ id, ownerId = null, facts, now = Date.now() }) {
  const a = await owned(id, ownerId);
  if (a.state !== "pending") throw new MotionRefused("NOT_PENDING", `the upload is ${a.state}`);
  if (!facts || !(facts.durationMs > 0)) throw new MotionRefused("NO_FACTS", "admission needs the probe's facts", 400);
  return update(id, { bytes: facts.bytes == null ? null : Math.trunc(facts.bytes), duration_ms: Math.trunc(facts.durationMs), width: Math.trunc(facts.width), height: Math.trunc(facts.height), rotation: Math.trunc(facts.rotation || 0), codec: String(facts.codec), audio: !!facts.audio, fast_start: facts.fastStart !== false, state: "ready", verified_at: new Date(now).toISOString() }, now);
}

/** The worker refused: by name; the route deletes the object. */
export async function refuseMotionAsset({ id, ownerId = null, code, note, now = Date.now() }) {
  const a = await owned(id, ownerId);
  if (a.state !== "pending") throw new MotionRefused("NOT_PENDING", `the upload is ${a.state}`);
  return update(id, { state: "refused", refusal_code: String(code || "refused").slice(0, 40), refusal_note: String(note || "").slice(0, 300), verified_at: new Date(now).toISOString() }, now);
}

/** The creator's caption tracks (3.8), validated by the law; replaces the set. */
export async function setMotionCaptions({ id, ownerId, tracks, now = Date.now() }) {
  const a = await owned(id, ownerId);
  if (a.state !== "ready") throw new MotionRefused("NOT_READY", "captions ride on an admitted video");
  const v = validateCaptionTracks(tracks);
  if (!v.ok) throw new MotionRefused("CAPTIONS", v.errors[0], 400);
  return update(id, { captions: v.tracks }, now);
}

/** A poster the author captured on the device and uploaded as a Wire image. */
export async function setMotionPoster({ id, ownerId, posterPath, now = Date.now() }) {
  const a = await owned(id, ownerId);
  if (a.state !== "ready") throw new MotionRefused("NOT_READY", "a poster rides on an admitted video");
  return update(id, { poster_path: posterPath ? String(posterPath).slice(0, 200) : null }, now);
}

export async function removeMotionAsset({ id, ownerId, now = Date.now() }) {
  const a = await owned(id, ownerId);
  if (a.state === "removed") return a;
  return update(id, { state: "removed" }, now);
}

/** What a post stores and a reader sees (never the owner, never the raw row). */
export function motionForPost(a, { url = null, posterUrl = null } = {}) {
  if (!a || a.state !== "ready") return null;
  return { ...publicVideo({ ...a, url, poster: posterUrl }), path: a.path, posterPath: a.poster || null };
}

export function resetMemoryMotion() { mem.motionAssets.clear(); }
