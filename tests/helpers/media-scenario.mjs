// tests/helpers/media-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 9).
// DATABASE_URL empty runs the memory store, set runs Postgres; one JSON line
// both runs must agree on. The Postgres run writes run-unique rows (motion
// assets) and leaves them in their final states. No storage is touched: the
// store is fed the probe's facts the way the worker feeds it.
import { randomUUID } from "node:crypto";
import * as M from "../../lib/db/production/media.js";

const owner = "sb-" + randomUUID();
const other = "sb-" + randomUUID();
const T0 = Date.parse("2026-10-18T00:00:00Z");
const out = {};
const code = (p) => p.then(() => "allowed").catch((e) => e.code);
try {
  const a = await M.createMotionAsset({ ownerId: owner, path: `${owner}/${randomUUID()}.mp4`, container: "mp4", mime: "video/mp4", declaredBytes: 26879, now: T0 });
  out.created = { state: a.state, container: a.container, bytes: a.bytes, declared: a.declaredBytes, captions: a.captions.length };
  out.captionsBeforeAdmit = await code(M.setMotionCaptions({ id: a.id, ownerId: owner, tracks: [{ lang: "en", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nx" }] }));
  const ready = await M.admitMotionAsset({ id: a.id, ownerId: owner, facts: { container: "mp4", codec: "avc1", durationMs: 6000, width: 320, height: 180, rotation: 0, audio: false, fastStart: true, bytes: 26879 }, now: T0 + 1000 });
  out.ready = { state: ready.state, codec: ready.codec, durationMs: ready.durationMs, width: ready.width, height: ready.height, bytes: ready.bytes, audio: ready.audio, fastStart: ready.fastStart, verifiedAt: ready.verifiedAt };
  out.admitTwice = await code(M.admitMotionAsset({ id: a.id, ownerId: owner, facts: { durationMs: 1, width: 1, height: 1, codec: "x" } }));
  out.foreignCaptions = await code(M.setMotionCaptions({ id: a.id, ownerId: other, tracks: [] }));
  out.badCaptions = await code(M.setMotionCaptions({ id: a.id, ownerId: owner, tracks: [{ lang: "en", vtt: "not vtt" }] }));
  const cap = await M.setMotionCaptions({ id: a.id, ownerId: owner, tracks: [{ lang: "en", label: "English", default: true, vtt: "WEBVTT\n\n00:00.000 --> 00:02.000\nhello\n\n00:02.000 --> 00:04.000\nworld" }, { lang: "pt-BR", vtt: "WEBVTT\n\n00:00.000 --> 00:02.000\nolá" }], now: T0 + 2000 });
  out.captions = cap.captions.map((t) => ({ lang: t.lang, label: t.label, default: t.default, cues: t.cues }));
  out.poster = (await M.setMotionPoster({ id: a.id, ownerId: owner, posterPath: `${owner}/${randomUUID()}.jpg` })).poster ? "set" : "unset";
  out.public = M.motionForPost(await M.getMotionAsset(a.id), { url: "https://x/v.mp4", posterUrl: null });
  delete out.public.id; delete out.public.path; delete out.public.posterPath;
  const b = await M.createMotionAsset({ ownerId: owner, path: `${owner}/${randomUUID()}.webm`, container: "webm", mime: "video/webm", declaredBytes: 10, now: T0 + 3000 });
  const refused = await M.refuseMotionAsset({ id: b.id, ownerId: owner, code: "codec", note: "HEVC needs a transcoder", now: T0 + 4000 });
  out.refused = { state: refused.state, code: refused.refusalCode, note: refused.refusalNote };
  out.refuseTwice = await code(M.refuseMotionAsset({ id: b.id, ownerId: owner, code: "x" }));
  out.publicRefused = M.motionForPost(refused);
  out.badContainer = await code(M.createMotionAsset({ ownerId: owner, path: "x", container: "mov", mime: "video/quicktime", declaredBytes: 1 }));
  out.notFound = await code(M.getMotionAsset(randomUUID()).then((x) => { if (!x) { const e = new Error("none"); e.code = "NOT_FOUND"; throw e; } }));
  const removed = await M.removeMotionAsset({ id: a.id, ownerId: owner, now: T0 + 5000 });
  out.removed = { state: removed.state, captionsKept: removed.captions.length };
  out.mine = (await M.listMotionAssets({ ownerId: owner })).map((x) => x.state).sort();
  out.mineReady = (await M.listMotionAssets({ ownerId: owner, states: ["ready"] })).length;
  out.others = (await M.listMotionAssets({ ownerId: other })).length;
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
