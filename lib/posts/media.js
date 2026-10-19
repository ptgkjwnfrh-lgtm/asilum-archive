// lib/posts/media.js — the Wire's IMAGES (V.2 brief §6 "Add media"), stored
// server-side in the Supabase Storage bucket "wire". SERVER-ONLY.
//
// Mirrors lib/wardrobe/photos.js on purpose — same REST calls, same
// service-role-only writes, same client-re-encoded JPEG ≤ 2 MB rule (the
// browser re-draws the picture to a canvas so EXIF, including GPS, never
// leaves the device; the server re-checks the magic bytes and the size) —
// with ONE difference the brief draws: a published post is public, so this
// bucket is public-read and a post image is one plain URL, not a signed
// one per read. A wardrobe photo stays private; a Wire image is the author
// publishing it. Objects are <userId>/<uuid>.jpg; `x-upsert: false`.
//
// Gate: WIRE_UPLOADS_ENABLED=1 and configured storage; otherwise the
// composer's "Add media" says so and the route answers 503 — never a
// silent fallback to a data URL or a third-party host.

import { randomUUID } from "node:crypto";
import { looksLikeJpeg, storageConfigured } from "../wardrobe/photos.js";
import { PHOTO_MAX_BYTES } from "../wardrobe/photo-contract.js";

export const WIRE_BUCKET = "wire";
export const WIRE_IMAGE_MAX_BYTES = PHOTO_MAX_BYTES;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const PATH_PATTERN = /^[A-Za-z0-9_-]{1,80}\/[0-9a-f-]{36}\.jpg$/;

function env() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && key ? { url, key } : null;
}

export function postUploadsEnabled() { return process.env.WIRE_UPLOADS_ENABLED === "1"; }

/** The one availability gate the route and the composer share. */
export function postUploadsAvailable() {
  if (!postUploadsEnabled()) return { available: false, reason: "wire images are not enabled on this deployment" };
  if (!storageConfigured()) return { available: false, reason: "object storage is not configured" };
  return { available: true };
}

async function storageFetch(path, options = {}) {
  const e = env();
  if (!e) throw new Error("storage not configured");
  return fetch(`${e.url}/storage/v1${path}`, { ...options, cache: "no-store", headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, ...(options.headers || {}) } });
}

export function postObjectPath(userId, version = randomUUID()) {
  if (!USER_ID_PATTERN.test(String(userId || ""))) throw new TypeError("invalid user id");
  return `${userId}/${version}.jpg`;
}

export function safePostPath(path) {
  const p = String(path || "");
  if (!PATH_PATTERN.test(p)) throw new TypeError("invalid wire image path");
  return p;
}

/** The public URL of a stored image, or null when storage is unconfigured. */
export function postImageUrl(path) {
  const e = env();
  if (!e) return null;
  try { return `${e.url}/storage/v1/object/public/${WIRE_BUCKET}/${safePostPath(path)}`; } catch { return null; }
}

/** Idempotent public-read bucket (scripts/setup-wire-storage.mjs). */
export async function ensurePostBucket() {
  // with video enabled the bucket's ceiling is the video's (slice 9); images are still re-checked at 2 MB by the route
  const video = postVideoEnabled();
  const settings = { public: true, file_size_limit: video ? WIRE_VIDEO_MAX_BYTES : WIRE_IMAGE_MAX_BYTES, allowed_mime_types: video ? ["image/jpeg", ...Object.keys(WIRE_VIDEO_MIMES)] : ["image/jpeg"] };
  const res = await storageFetch("/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: WIRE_BUCKET, name: WIRE_BUCKET, ...settings }) });
  let created = res.ok;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status !== 409 && !/already exists/i.test(body.message || body.error || "")) throw new Error(`bucket creation failed (${res.status})`);
    created = false;
  }
  const update = await storageFetch(`/bucket/${WIRE_BUCKET}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
  if (!update.ok) throw new Error(`bucket hardening failed (${update.status})`);
  return { created, existed: !created };
}

/** Store one image; returns its path. Re-checks bytes and size. */
export async function storePostImage(userId, bytes) {
  if (!looksLikeJpeg(bytes)) throw new TypeError("image must be a JPEG");
  if (bytes.length > WIRE_IMAGE_MAX_BYTES) throw new RangeError("image exceeds 2MB");
  const path = postObjectPath(userId);
  const res = await storageFetch(`/object/${WIRE_BUCKET}/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: bytes });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(`image store failed (${res.status}): ${(body.message || body.error || "").slice(0, 120)}`); }
  return path;
}

export async function deletePostImage(path) {
  const safe = safePostPath(path);
  const res = await storageFetch(`/object/${WIRE_BUCKET}/${safe}`, { method: "DELETE" });
  return res.ok || res.status === 404;
}

// ---- MOTION: the Wire's VIDEO, through the same bucket (slice 9) -----------
// A video rides the same public-read "wire" bucket as an image, with two
// differences the stack forces: it is uploaded DIRECTLY from the browser on a
// signed upload URL (a serverless request body cannot carry a video), and the
// server then reads the stored object's head and tail by Range to probe the
// container (lib/media/index.js). Gate: WIRE_VIDEO_ENABLED=1 on top of
// WIRE_UPLOADS_ENABLED=1 and storage; off, the composer says so and the route
// answers 503 — never a data URL, never a third-party host.

export const WIRE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;   // mirrors lib/media/index.js MOTION.maxBytes (the bucket's limit)
export const WIRE_VIDEO_MIMES = Object.freeze({ "video/mp4": "mp4", "video/webm": "webm" });
const VIDEO_PATH_PATTERN = /^[A-Za-z0-9_-]{1,80}\/[0-9a-f-]{36}\.(mp4|webm)$/;
export const PROBE_SLICE_BYTES = 2 * 1024 * 1024;        // the head and the tail the worker reads

export function postVideoEnabled() { return process.env.WIRE_VIDEO_ENABLED === "1"; }

/** The one availability gate the motion route and the composer share. */
export function postVideoAvailable() {
  const images = postUploadsAvailable();
  if (!images.available) return { available: false, reason: images.reason };
  if (!postVideoEnabled()) return { available: false, reason: "video uploads are not enabled on this deployment (WIRE_VIDEO_ENABLED)" };
  return { available: true };
}

export function postVideoObjectPath(userId, container, version = randomUUID()) {
  if (!USER_ID_PATTERN.test(String(userId || ""))) throw new TypeError("invalid user id");
  if (!["mp4", "webm"].includes(container)) throw new TypeError("invalid container");
  return `${userId}/${version}.${container}`;
}
export function safePostVideoPath(path) {
  const p = String(path || "");
  if (!VIDEO_PATH_PATTERN.test(p)) throw new TypeError("invalid wire video path");
  return p;
}
export function postVideoUrl(path) {
  const e = env();
  if (!e) return null;
  try { return `${e.url}/storage/v1/object/public/${WIRE_BUCKET}/${safePostVideoPath(path)}`; } catch { return null; }
}

/** A signed upload URL for one object: the browser PUTs the bytes there
 *  itself, `x-upsert: false`. Supabase answers { url, token }. */
export async function signPostVideoUpload(path) {
  const safe = safePostVideoPath(path);
  const res = await storageFetch(`/object/upload/sign/${WIRE_BUCKET}/${safe}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(`upload could not be signed (${res.status}): ${(body.message || body.error || "").slice(0, 120)}`); }
  const body = await res.json().catch(() => ({}));
  const e = env();
  const url = body.url ? (body.url.startsWith("http") ? body.url : `${e.url}/storage/v1${body.url.startsWith("/") ? "" : "/"}${body.url}`) : null;
  if (!url || !body.token) throw new Error("upload could not be signed: no token");
  return { url, token: body.token, method: "PUT" };
}

/** The stored object's size and its head and tail slices, for the probe.
 *  Reads the SERVER's copy: nothing the client said about the file is used. */
export async function readPostVideoForProbe(path, { slice = PROBE_SLICE_BYTES } = {}) {
  const safe = safePostVideoPath(path);
  const head = await storageFetch(`/object/authenticated/${WIRE_BUCKET}/${safe}`, { method: "GET", headers: { Range: `bytes=0-${slice - 1}` } });
  if (head.status === 404) return null;
  if (!head.ok && head.status !== 206) throw new Error(`object could not be read (${head.status})`);
  const range = head.headers.get("content-range") || "";
  const m = /\/(\d+)$/.exec(range);
  const headBytes = new Uint8Array(await head.arrayBuffer());
  let bytes = m ? Number(m[1]) : headBytes.length;
  if (!m) { const h = await storageFetch(`/object/authenticated/${WIRE_BUCKET}/${safe}`, { method: "HEAD" }); const len = Number(h.headers.get("content-length")); if (Number.isFinite(len) && len > 0) bytes = len; }
  let tailBytes = null;
  if (bytes > headBytes.length) {
    const from = Math.max(headBytes.length, bytes - slice);
    const tail = await storageFetch(`/object/authenticated/${WIRE_BUCKET}/${safe}`, { method: "GET", headers: { Range: `bytes=${from}-${bytes - 1}` } });
    if (tail.ok || tail.status === 206) tailBytes = new Uint8Array(await tail.arrayBuffer());
  }
  return { bytes, head: headBytes, tail: tailBytes };
}

export async function deletePostVideo(path) {
  const safe = safePostVideoPath(path);
  const res = await storageFetch(`/object/${WIRE_BUCKET}/${safe}`, { method: "DELETE" });
  return res.ok || res.status === 404;
}
