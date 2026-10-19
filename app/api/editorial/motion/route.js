// app/api/editorial/motion/route.js — MOTION: the Wire's video, through the
// media worker (V.2 Blueprint chapter 3, 17.2; slice 9). What the worker
// honestly is on this stack is written at the top of lib/media/index.js.
//
// GET                       → the gate ({ available, reason }), the law, the
//                             worker's note; public — the composer reads it
// GET  ?user=               → + my uploads (pending / ready / refused)
// GET  ?captions=<id>&lang= → one creator caption track as text/vtt (public:
//                             a ready asset's captions are public with the post)
// POST { user, action: "begin",   mime, bytes, durationMs? } → 201 { asset, upload: { url, token, method, headers } }
//        a signed-in ACCOUNT, like images; the browser PUTs the file to the
//        signed URL itself (a serverless body cannot carry a video)
// POST { user, action: "verify",  id }                 → the worker reads its copy: ready | refused (by name)
// POST { user, action: "captions", id, tracks: [{ lang, label?, default?, vtt }] }
// POST { user, action: "poster",  id, path }           → a Wire image the author captured as the poster
// POST { user, action: "remove",  id }
//
// Without WIRE_VIDEO_ENABLED=1 (+ WIRE_UPLOADS_ENABLED=1 + storage) begin and
// verify answer 503 with the reason; captions on an already-admitted asset
// still work; nothing pretends.

import { NextResponse } from "next/server";
import { accountIdFromIdentity, resolveRequestUser } from "../../../../lib/identity.js";
import { readJsonRequest } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { safeWirePath } from "../../../../lib/wire/media.js";
import { MOTION, SPEEDS, QUALITIES, QUALITY_NOTE, MAX_CAPTION_TRACKS, VTT_MAX_BYTES } from "../../../../lib/media/index.js";
import { beginMotionUpload, verifyMotionUpload, motionUploadsAvailable, workerNote, motionUrls } from "../../../../lib/media/worker.js";
import { getMotionAsset, listMotionAssets, setMotionCaptions, setMotionPoster, removeMotionAsset, MotionRefused } from "../../../../lib/db/production/media.js";
import { deleteWireVideo } from "../../../../lib/wire/media.js";

export const dynamic = "force-dynamic";
const LAW = Object.freeze({ maxBytes: MOTION.maxBytes, maxMs: MOTION.maxMs, minMs: MOTION.minMs, maxEdge: MOTION.maxEdge, mimes: Object.keys(MOTION.mimes), codecs: MOTION.codecs, speeds: SPEEDS, qualities: QUALITIES, qualityNote: QUALITY_NOTE, captionTracks: MAX_CAPTION_TRACKS, vttMaxBytes: VTT_MAX_BYTES });

function refused(error) {
  if (error instanceof MotionRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[motion] failed", error?.message || error);
  return NextResponse.json({ error: "the media worker is unavailable", code: "MOTION_UNAVAILABLE" }, { status: 503 });
}
const mine = (a) => ({ ...a, ...motionUrls(a), captions: (a.captions || []).map((t) => ({ lang: t.lang, label: t.label, default: !!t.default, cues: t.cues })) });

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const captionsOf = searchParams.get("captions");
  if (captionsOf) {
    const a = await getMotionAsset(captionsOf).catch(() => null);
    if (!a || a.state !== "ready") return new NextResponse("", { status: 404 });
    const lang = String(searchParams.get("lang") || "").toLowerCase();
    const track = a.captions.find((t) => t.lang.toLowerCase() === lang) || (lang ? null : a.captions[0]);
    if (!track) return new NextResponse("", { status: 404 });
    return new NextResponse(track.vtt, { status: 200, headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  }
  const gate = motionUploadsAvailable();
  const body = { ...gate, law: LAW, worker: workerNote() };
  const user = await resolveRequestUser(req, String(searchParams.get("user") || "")).catch(() => null);
  if (user) {
    try { body.mine = (await listMotionAssets({ ownerId: user, limit: 50 })).map(mine); }
    catch (error) { return refused(error); }
  }
  return NextResponse.json(body);
}

export async function POST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 1024 * 1024 + 64 * 1024 });   // five VTT tracks at most
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  // the same rule as images and posting: a device proves a browser, not a person
  if (!accountIdFromIdentity(user)) return NextResponse.json({ error: "video rides on a signed-in account", code: "ACCOUNT_REQUIRED", note: "sign in on PROFILE — a device on its own cannot publish" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "motion-write", subject: user, limit: 40, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const id = String(body.id || "");
  try {
    switch (body.action) {
      case "begin": {
        const r = await beginMotionUpload({ ownerId: user, mime: String(body.mime || ""), bytes: Number(body.bytes), durationMs: body.durationMs == null ? null : Number(body.durationMs) });
        return NextResponse.json({ asset: mine(r.asset), upload: r.upload }, { status: 201 });
      }
      case "verify":
        return NextResponse.json({ asset: mine(await verifyMotionUpload({ id, ownerId: user })) });
      case "captions":
        return NextResponse.json({ asset: mine(await setMotionCaptions({ id, ownerId: user, tracks: Array.isArray(body.tracks) ? body.tracks : [] })) });
      case "poster": {
        let path = null;
        if (body.path) { try { path = safeWirePath(body.path); } catch { return NextResponse.json({ error: "invalid poster path", code: "POSTER" }, { status: 400 }); } if (!path.startsWith(user + "/")) return NextResponse.json({ error: "not your image", code: "POSTER" }, { status: 403 }); }
        return NextResponse.json({ asset: mine(await setMotionPoster({ id, ownerId: user, posterPath: path })) });
      }
      case "remove": {
        const a = await removeMotionAsset({ id, ownerId: user });
        if (motionUploadsAvailable().available) await deleteWireVideo(a.path).catch(() => false);
        return NextResponse.json({ asset: mine(a) });
      }
      default:
        return NextResponse.json({ error: "unknown action", code: "ACTION" }, { status: 400 });
    }
  } catch (error) { return refused(error); }
}
