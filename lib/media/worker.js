// lib/media/worker.js — THE MEDIA WORKER (V.2 Blueprint chapter 3; slice 9).
// SERVER-ONLY. What it honestly is on this stack is written at the top of
// lib/media/index.js: a probe of the stored object's own header, admission
// against declared limits, storage through the Wire's bucket. No transcoder.
//
//   begin   the gate, the preflight, a pending row, a signed direct upload
//   verify  Range-read the head (and the tail when the index is at the end),
//           probe, admit or refuse by name — a refused object is deleted so
//           nothing unplayable sits in a public bucket
//
// Every refusal is the law's own sentence; a storage fault is a 502 with the
// provider's status, never a silent "ready".

import { probeVideo, admitMotion, preflightMotion, MOTION } from "./index.js";
import { createMotionAsset, admitMotionAsset, refuseMotionAsset, getMotionAsset, MotionRefused } from "../db/production/media.js";
import { wireVideoAvailable, wireVideoObjectPath, signWireVideoUpload, readWireVideoForProbe, deleteWireVideo, wireVideoUrl, wireImageUrl } from "../wire/media.js";

export { wireVideoAvailable as motionUploadsAvailable };

/** What the composer and the route tell a passenger about the worker. */
export function workerNote() {
  return {
    transcoder: false,
    renditions: 1,
    admits: { mp4: MOTION.codecs.mp4, webm: MOTION.codecs.webm },
    maxBytes: MOTION.maxBytes, maxMs: MOTION.maxMs, minMs: MOTION.minMs, maxEdge: MOTION.maxEdge,
    sentence: "no transcoder on this deployment: an H.264 MP4 or a VP8/VP9 WebM plays as uploaded; anything else is refused by name, never converted",
  };
}

/** Step one: a pending asset and the signed URL the browser PUTs to. */
export async function beginMotionUpload({ ownerId, mime, bytes, durationMs = null }) {
  const gate = wireVideoAvailable();
  if (!gate.available) throw new MotionRefused("MOTION_UNAVAILABLE", gate.reason, 503);
  const pre = preflightMotion({ mime, bytes, durationMs });
  if (!pre.ok) throw new MotionRefused(pre.code, pre.message, 400);
  const path = wireVideoObjectPath(ownerId, pre.container);
  const asset = await createMotionAsset({ ownerId, path, container: pre.container, mime, declaredBytes: bytes });
  let upload;
  try { upload = await signWireVideoUpload(path); }
  catch (e) { await refuseMotionAsset({ id: asset.id, code: "sign-failed", note: String(e.message || e).slice(0, 200) }).catch(() => {}); throw new MotionRefused("SIGN_FAILED", String(e.message || e).slice(0, 200), 502); }
  return { asset, upload: { ...upload, headers: { "x-upsert": "false", "Content-Type": mime } } };
}

/** Step two: the server reads its own copy and decides. */
export async function verifyMotionUpload({ id, ownerId }) {
  const gate = wireVideoAvailable();
  if (!gate.available) throw new MotionRefused("MOTION_UNAVAILABLE", gate.reason, 503);
  const asset = await getMotionAsset(id);
  if (!asset) throw new MotionRefused("NOT_FOUND", "no such upload", 404);
  if (asset.ownerId !== ownerId) throw new MotionRefused("NOT_YOURS", "not your upload", 403);
  if (asset.state !== "pending") return asset;
  const read = await readWireVideoForProbe(asset.path);
  if (!read) throw new MotionRefused("NOT_UPLOADED", "the bytes have not arrived — upload to the signed URL first", 409);
  let probe = probeVideo(read.head, { tail: read.tail });
  if (!probe.ok && probe.code === "moov-truncated" && probe.needBytes) {
    const bigger = await readWireVideoForProbe(asset.path, { slice: Math.min(read.bytes, probe.needBytes + 64) });
    if (bigger) probe = probeVideo(bigger.head, { tail: bigger.tail });
  }
  const verdict = admitMotion(probe, { bytes: read.bytes });
  if (!verdict.ok) {
    await deleteWireVideo(asset.path).catch(() => false);
    return refuseMotionAsset({ id, ownerId, code: verdict.code, note: verdict.message });
  }
  return admitMotionAsset({ id, ownerId, facts: verdict.facts });
}

/** The public URLs a stored asset plays from. */
export function motionUrls(asset) {
  return { url: asset && asset.path ? wireVideoUrl(asset.path) : null, posterUrl: asset && asset.poster ? wireImageUrl(asset.poster) : null };
}
