// tests/media.test.js — MOTION, THE MEDIA WORKER AND THE MUSIC CIRCLE (V.2
// Blueprint, owner, 17 Oct 2026, chapter 3, chapter 4, 17.2; slice 9). The
// law (lib/media/index.js, lib/music/index.js) is pure; the rows
// (lib/db/production/media.js) run on the memory store; the routes through
// the harness. Held here:
//   * the probe reads an MP4's own index (head or tail) and a WebM's own
//     header: codec, duration, dimensions, rotation, audio, fast start — and
//     reads the generated sample the repository ships;
//   * admission refuses BY NAME: HEVC, an unknown length, too long, too
//     short, too large an edge, too many bytes; admits H.264 MP4 and VP9 WebM;
//   * the Feed's autoplay: the most visible plays, reduced motion / data
//     saver / the preference stop it, captions during muted autoplay;
//   * captions: WebVTT parses and is bounded, a track needs a language, the
//     preferred language wins, the appearance clamps;
//   * one audio source: a claim pauses the previous;
//   * the music circle: present while a source exists, pulse / still /
//     loading, the blend band, the panel's dismissal never stops the music,
//     no skip over a post's own audio, nothing identified is drawn;
//   * the composition: an admitted asset is a MOTION, anything else is not;
//   * the store and the routes: the gate's honest reason, a device cannot
//     upload, captions ride on an admitted asset and serve as text/vtt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as L from "../lib/media/index.js";
import * as MU from "../lib/music/index.js";
import * as M from "../lib/db/production/media.js";
import { validateComposition, attachmentsFor, kindOf } from "../lib/posts/compose.js";
import { postType } from "../lib/feed/types.js";
import { SAMPLE_POSTS, SAMPLE_MOTION } from "../lib/model/media.js";
import { RECORD_KINDS, validateRecordInput } from "../lib/db/production/records.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const uuid = () => globalThis.crypto.randomUUID();

// ---- a tiny ISOBMFF writer: enough boxes for the probe to read -------------
const str = (s) => Buffer.from(s, "latin1");
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const fx = (n) => u32(Math.round(n * 65536));
const box = (type, ...parts) => { const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))); return Buffer.concat([u32(8 + body.length), str(type), body]); };
function mp4({ codec = "avc1", timescale = 600, duration = 3600, width = 1280, height = 720, rotate = 0, audio = false, fastStart = true, mdatBytes = 64 } = {}) {
  const ftyp = box("ftyp", str("isom"), u32(512), str("isomiso2avc1mp41"));
  const mvhd = box("mvhd", u32(0), u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), Buffer.alloc(10), fx(1), fx(0), fx(0), fx(0), fx(1), fx(0), fx(0), fx(0), fx(0x4000), Buffer.alloc(24), u32(2));
  const matrix = rotate === 90 ? [0, 1, 0, -1, 0, 0, 0, 0, 1] : rotate === 180 ? [-1, 0, 0, 0, -1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const tkhd = box("tkhd", u32(7), u32(0), u32(0), u32(1), u32(0), u32(duration), Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0), ...matrix.map((v, i) => (i === 8 ? u32(0x40000000) : fx(v))), fx(width), fx(height));
  const vtrak = (handler, entry) => box("trak", tkhd, box("mdia", box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)), box("hdlr", u32(0), u32(0), str(handler), Buffer.alloc(12), str("x\0")),
    box("minf", box("stbl", box("stsd", u32(0), u32(1), entry)))));
  const ventry = box(codec, Buffer.alloc(6), u16(1), u16(0), u16(0), Buffer.alloc(12), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), Buffer.alloc(32), u16(24), u16(0xffff));
  const aentry = box("mp4a", Buffer.alloc(6), u16(1), Buffer.alloc(8), u16(2), u16(16), u32(0), u32(44100 << 16));
  const traks = [vtrak("vide", ventry)];
  if (audio) traks.push(vtrak("soun", aentry));
  const moov = box("moov", mvhd, ...traks);
  const mdat = box("mdat", Buffer.alloc(mdatBytes));
  return fastStart ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]);
}
// ---- and an EBML one ---------------------------------------------------------
const id = (n) => { const h = n.toString(16); return Buffer.from(h.length % 2 ? "0" + h : h, "hex"); };
const vsize = (n) => { if (n < 127) return Buffer.from([0x80 | n]); if (n < 16383) return Buffer.from([0x40 | (n >> 8), n & 255]); return Buffer.from([0x20 | (n >> 16), (n >> 8) & 255, n & 255]); };
const el = (i, body) => Buffer.concat([id(i), vsize(body.length), body]);
const eu = (n) => { const b = []; do { b.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0); return Buffer.from(b); };
function webm({ codec = "V_VP9", durationMs = 6000, width = 640, height = 360, audio = false, declareDuration = true } = {}) {
  const header = el(0x1a45dfa3, Buffer.concat([el(0x4286, eu(1)), el(0x4282, Buffer.from("webm")), el(0x4287, eu(4)), el(0x4285, eu(2))]));
  const dur = Buffer.alloc(8); dur.writeDoubleBE(durationMs);
  const info = el(0x1549a966, Buffer.concat([el(0x2ad7b1, eu(1_000_000)), ...(declareDuration ? [el(0x4489, dur)] : [])]));
  const vtrack = el(0xae, Buffer.concat([el(0xd7, eu(1)), el(0x83, eu(1)), el(0x86, Buffer.from(codec)), el(0xe0, Buffer.concat([el(0xb0, eu(width)), el(0xba, eu(height))]))]));
  const atrack = el(0xae, Buffer.concat([el(0xd7, eu(2)), el(0x83, eu(2)), el(0x86, Buffer.from("A_OPUS"))]));
  const tracks = el(0x1654ae6b, Buffer.concat(audio ? [vtrack, atrack] : [vtrack]));
  const cluster = el(0x1f43b675, Buffer.alloc(32));
  const segBody = Buffer.concat([info, tracks, cluster]);
  // an unknown-size Segment, as a recorder writes it
  const segment = Buffer.concat([id(0x18538067), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), segBody]);
  return Buffer.concat([header, segment]);
}

test.beforeEach(() => { M.resetMemoryMotion(); });

test("the probe reads an MP4's own index: codec, duration, dimensions, rotation, audio, fast start; and the tail when the index is last", () => {
  const p = L.probeVideo(mp4());
  assert.equal(p.ok, true); assert.equal(p.container, "mp4"); assert.equal(p.codec, "avc1"); assert.equal(p.durationMs, 6000);
  assert.deepEqual([p.width, p.height, p.rotation, p.audio, p.fastStart], [1280, 720, 0, false, true]);
  const r = L.probeVideo(mp4({ rotate: 90, audio: true }));
  assert.deepEqual([r.width, r.height, r.rotation, r.audio], [720, 1280, 90, true], "a phone's portrait recording is a landscape track with a 90° matrix");
  const late = mp4({ fastStart: false, mdatBytes: 4096 });
  const headOnly = L.probeVideo(late.subarray(0, 1024));
  assert.equal(headOnly.ok, false); assert.equal(headOnly.code, "moov-missing"); assert.equal(headOnly.needTail, true, "the worker is asked for the tail");
  const withTail = L.probeVideo(late.subarray(0, 1024), { tail: late.subarray(late.length - 1500) });
  assert.equal(withTail.ok, true); assert.equal(withTail.fastStart, false); assert.equal(withTail.durationMs, 6000);
  assert.equal(L.probeVideo(Buffer.from("GIF89a..........")).code, "unreadable");
  assert.equal(L.probeVideo(Buffer.alloc(0)).code, "empty");
});

test("the probe reads a WebM's own header, and reports a recording that declares no length", () => {
  const p = L.probeVideo(webm());
  assert.equal(p.ok, true); assert.equal(p.container, "webm"); assert.equal(p.codec, "V_VP9"); assert.equal(p.durationMs, 6000); assert.deepEqual([p.width, p.height, p.audio], [640, 360, false]);
  assert.equal(L.probeVideo(webm({ audio: true })).audio, true);
  const live = L.probeVideo(webm({ declareDuration: false }));
  assert.equal(live.ok, true); assert.equal(live.durationMs, null);
  assert.equal(L.admitMotion(live).code, "duration-unknown", "refused by name, never guessed");
});

test("the generated sample the repository ships is what its label says: H.264 MP4, 320×180, six seconds, a test tone, fast start", () => {
  const bytes = fs.readFileSync(path.join(process.cwd(), "public", "model", "motion-test-pattern.mp4"));
  const p = L.probeVideo(bytes);
  assert.equal(p.ok, true); assert.equal(p.codec, "avc1"); assert.equal(p.durationMs, 6000); assert.deepEqual([p.width, p.height, p.audio, p.fastStart], [320, 180, true, true]);
  const v = L.admitMotion(p, { bytes: bytes.length });
  assert.equal(v.ok, true); assert.equal(v.facts.bytes, bytes.length);
  assert.deepEqual([SAMPLE_MOTION.durationMs, SAMPLE_MOTION.width, SAMPLE_MOTION.height, SAMPLE_MOTION.codec, SAMPLE_MOTION.audio, SAMPLE_MOTION.generated], [6000, 320, 180, "avc1", true, true], "the sample's declared facts are the file's");
  assert.ok(bytes.length < 60 * 1024, "a fixture, not a film");
  const vtt = fs.readFileSync(path.join(process.cwd(), "public", "model", "motion-test-pattern.vtt"), "utf8");
  assert.equal(L.parseVtt(vtt).ok, true); assert.equal(L.parseVtt(vtt).cues.length, 3);
  assert.equal(postType(SAMPLE_POSTS.find((s) => s.id === "sample-w8")), "MOTION");
});

test("admission refuses by name and admits what browsers play; the preflight stops an over-long file on the device", () => {
  assert.equal(L.admitMotion(L.probeVideo(mp4({ codec: "hvc1" }))).code, "codec");
  assert.match(L.admitMotion(L.probeVideo(mp4({ codec: "hvc1" }))).message, /HEVC .* H\.264/);
  assert.equal(L.admitMotion(L.probeVideo(mp4({ codec: "av01" }))).code, "codec");
  assert.equal(L.admitMotion(L.probeVideo(webm({ codec: "V_AV1" }))).code, "codec");
  assert.equal(L.admitMotion(L.probeVideo(webm({ codec: "V_VP8" }))).ok, true);
  assert.equal(L.admitMotion(L.probeVideo(mp4({ duration: 600 * 181 }))).code, "too-long");
  assert.equal(L.admitMotion(L.probeVideo(mp4({ duration: 300 }))).code, "too-short");
  assert.equal(L.admitMotion(L.probeVideo(mp4({ width: 7680, height: 4320 }))).code, "too-large-edge");
  assert.equal(L.admitMotion(L.probeVideo(mp4()), { bytes: L.MOTION.maxBytes + 1 }).code, "too-large");
  assert.equal(L.admitMotion({ ok: false, code: "unreadable", message: "x" }).code, "unreadable");
  const ok = L.admitMotion(L.probeVideo(mp4({ fastStart: false, mdatBytes: 16 })), { bytes: 500 });
  assert.equal(ok.ok, true); assert.match(ok.note, /index sits after the data/);
  assert.equal(L.preflightMotion({ mime: "video/quicktime", bytes: 10 }).code, "mime");
  assert.equal(L.preflightMotion({ mime: "video/mp4", bytes: 10, durationMs: 200_000 }).code, "too-long");
  assert.deepEqual(L.preflightMotion({ mime: "video/webm; codecs=vp9", bytes: 10, durationMs: 5000 }), { ok: true, container: "webm" });
});

test("adaptive autoplay (3.3): the most visible plays; reduced motion, data saver, Low Power and the preference stop it; captions follow the mute", () => {
  assert.equal(L.mostVisible([{ id: "a", ratio: 0.4 }, { id: "b", ratio: 0.9 }, { id: "c", ratio: 0.9 }]), "b", "the largest; a tie goes to the earlier");
  assert.equal(L.mostVisible([{ id: "a", ratio: 0.3 }]), null, "nothing under the floor plays");
  assert.deepEqual(L.autoplayPolicy({}), { autoplay: true, muted: true, captions: true, reason: null });
  assert.equal(L.autoplayPolicy({ reducedMotion: true }).autoplay, false);
  assert.equal(L.autoplayPolicy({ saveData: true }).reason, "data saver");
  assert.equal(L.autoplayPolicy({ lowPower: true }).reason, "low power mode");
  assert.equal(L.autoplayPolicy({ lowPower: null }).autoplay, true, "unknown is not a limit");
  assert.equal(L.autoplayPolicy({ prefs: { autoplay: "off" } }).autoplay, false);
  const loud = L.autoplayPolicy({ prefs: { feedAudio: true } });
  assert.deepEqual([loud.muted, loud.captions], [false, false], "with sound on, auto captions stay off");
  assert.equal(L.autoplayPolicy({ prefs: { feedAudio: true, captions: "on" } }).captions, true);
  assert.equal(L.captionsShown({ muted: true }), true); assert.equal(L.captionsShown({ muted: false }), false); assert.equal(L.captionsShown({ prefs: { captions: "off" }, muted: true }), false);
  const p = L.normalizeMediaPreferences({ captions: "loud", captionSize: 9, captionOpacity: -1, quality: "4k", autoplay: "always", feedAudio: "yes" });
  assert.deepEqual(p, { captions: "auto", captionSize: 1.6, captionOpacity: 0, quality: "adaptive", autoplay: "adaptive", feedAudio: false });
  assert.deepEqual(L.SPEEDS, [0.5, 0.75, 1, 1.25, 1.5, 2]); assert.deepEqual(L.QUALITIES, ["adaptive", "highest", "lowest"]); assert.match(L.QUALITY_NOTE, /one rendition/);
});

test("captions: WebVTT parses and is bounded; a track needs a language; the preferred language wins; the appearance clamps; the AI seams say so", () => {
  const v = L.parseVtt("WEBVTT\n\nNOTE a note\n\n1\n00:00.000 --> 00:02.500\nhello <b>there</b>\n\n00:01:02.000 --> 00:01:03.000\nlater");
  assert.equal(v.ok, true); assert.deepEqual(v.cues.map((c) => [c.start, c.end]), [[0, 2.5], [62, 63]]);
  assert.equal(L.parseVtt("not vtt").ok, false);
  assert.equal(L.parseVtt("WEBVTT\n\n00:02.000 --> 00:01.000\nbackwards").ok, false, "an end before its start");
  assert.equal(L.parseVtt("WEBVTT\n\n" + "x".repeat(L.VTT_MAX_BYTES)).errors[0].includes("at most"), true);
  const t = L.validateCaptionTracks([{ lang: "en", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\na", default: true }, { lang: "pt-BR", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nb", default: true }]);
  assert.equal(t.ok, true); assert.deepEqual(t.tracks.map((x) => [x.lang, x.default, x.cues]), [["en", true, 1], ["pt-BR", false, 1]], "one default");
  assert.equal(L.validateCaptionTracks([{ lang: "english", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\na" }]).ok, false);
  assert.equal(L.validateCaptionTracks([{ lang: "en", vtt: "x" }]).ok, false);
  assert.equal(L.validateCaptionTracks(Array.from({ length: 6 }, (_, i) => ({ lang: "l" + i, vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\na" }))).ok, false);
  const tracks = [{ lang: "fr" }, { lang: "en-GB", default: true }, { lang: "en" }];
  assert.equal(L.pickCaptionTrack(tracks, ["en-US"]).lang, "en-GB", "no exact match: the creator's first track of that primary subtag, before the default");
  assert.equal(L.pickCaptionTrack(tracks, ["en-GB"]).lang, "en-GB"); assert.equal(L.pickCaptionTrack(tracks, ["de"]).lang, "en-GB", "the default when nothing matches"); assert.equal(L.pickCaptionTrack([], ["en"]), null);
  assert.deepEqual(L.captionAppearance({ captionSize: 1.3, captionOpacity: 0.9 }), { fontScale: 1.3, background: "rgba(0, 0, 0, 0.9)" });
  for (const seam of [L.transcription(), L.translation(), L.musicIdentification()]) { assert.equal(seam.ok, false); assert.equal(seam.implemented, false); }
  assert.match(L.musicIdentification().hint, /no track label/);
});

test("one audio source (3.15): a claim pauses the previous; the circle's law (3.19–3.23)", () => {
  const s1 = L.claimAudio({ active: null }, { id: "v1", kind: "motion" });
  assert.deepEqual(s1, { active: { id: "v1", kind: "motion" }, paused: null });
  const s2 = L.claimAudio(s1, { id: "v2", kind: "motion" });
  assert.equal(s2.paused.id, "v1"); assert.equal(L.claimAudio(s2, null).active, null);
  assert.equal(MU.blendMs(10), 120); assert.equal(MU.blendMs(999), 250); assert.equal(MU.blendMs(), 180);
  const playing = { source: { kind: "motion", postId: 7, title: "t", color: "#aabbcc" }, state: "playing" };
  assert.deepEqual(MU.circleFor(playing), { visible: true, pulse: true, still: false, loading: false, color: "#aabbcc" });
  assert.equal(MU.circleFor({ ...playing, state: "paused" }).still, true, "pausing never removes it");
  assert.equal(MU.circleFor({ ...playing, state: "ended" }).visible, false, "ending does");
  assert.equal(MU.circleFor({ source: null, state: "playing" }).visible, false);
  for (const ev of ["outside", "navigate", "idle"]) assert.deepEqual(MU.panelAfter(ev), { open: false, stops: false }, "collapses, never stops the music");
  assert.equal(MU.panelAfter("idle", { inUse: true }).open, true);
  const panel = MU.panelFor(playing);
  assert.equal(panel.canSkip, false); assert.match(panel.skipNote, /nothing queued/); assert.match(panel.label, /no song identified/); assert.deepEqual(panel.back, { view: "media", props: { id: 7, sample: false, title: "MOTION" } });
  assert.equal(MU.lerpColor("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(MU.dominantColor(new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 240, 20, 20, 255])), "#f01414", "the saturated bar, not the dark field");
  const avail = MU.musicAvailability([{ id: "spotify", label: "Spotify", kind: "music", basis: "b", capabilities: [{ id: "playback", state: "requires-approval" }, { id: "taste-import", state: "unsupported" }] }, { id: "apple-music", label: "Apple Music", kind: "music", basis: "b", capabilities: [{ id: "playback", state: "requires-approval" }] }, { id: "ebay", kind: "marketplace", capabilities: [] }]);
  assert.deepEqual(avail.connected, []); assert.equal(avail.catalog.implemented, false); assert.equal(avail.likeSync.ok, false); assert.match(avail.sentence, /Spotify: requires approval; Apple Music: requires approval/);
});

test("the composition: an admitted asset is a MOTION; a path, a link, a refused or a pending upload is not; images do not ride along", () => {
  const ready = { id: uuid(), state: "ready", durationMs: 6000 };
  const ok = validateComposition({ text: "a film", video: ready });
  assert.equal(ok.ok, true); assert.equal(ok.kind, "video"); assert.equal(kindOf({ video: ready }), "video");
  assert.equal(validateComposition({ text: "x", video: { url: "https://x/v.mp4" } }).errors[0].code, "video-unadmitted");
  assert.equal(validateComposition({ text: "x", video: { ...ready, state: "pending" } }).errors[0].code, "video-not-ready");
  assert.equal(validateComposition({ text: "x", video: { ...ready, state: "refused", refusalNote: "HEVC" } }).errors[0].message.includes("HEVC"), true);
  assert.equal(validateComposition({ text: "x", video: { ...ready, durationMs: 999_999 } }).errors[0].code, "video-duration");
  assert.equal(validateComposition({ text: "x", video: ready, media: [{ path: "a/b.jpg" }] }).errors.some((e) => e.code === "video-and-images"), true);
  assert.equal(validateComposition({ text: "x", video: ready, echo: true }).errors[0].code, "echo-video");
  const snap = { id: ready.id, url: "https://x/v.mp4", durationMs: 6000, width: 320, height: 180, codec: "avc1", container: "mp4", captions: [] };
  assert.deepEqual(attachmentsFor({ text: "x", video: ready }, { videoSnapshot: snap }).video, snap, "the stored facts are the worker's, not the body's");
  assert.deepEqual(attachmentsFor({ text: "x", video: ready }).video, { id: ready.id });
  assert.equal(postType({ postKind: "video" }), "MOTION"); assert.equal(postType({ attachments: { video: snap } }), "MOTION");
  assert.ok(RECORD_KINDS.includes("media")); assert.equal(validateRecordInput({ kind: "media", recordId: "preferences", payload: { captions: "on" } }).ok, true); assert.equal(validateRecordInput({ kind: "media", recordId: "x", payload: {} }).ok, false);
});

test("the routes: the gate's honest reason and the law are public; a device cannot upload; captions ride on an admitted asset and serve as text/vtt", async () => {
  const route = await loadRoute("app/api/editorial/motion/route.js");
  const keys = ["WIRE_VIDEO_ENABLED", "WIRE_UPLOADS_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const was = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    const gate = await callRoute(route.GET, { path: "/api/editorial/motion" });
    assert.equal(gate.status, 200); assert.equal(gate.body.available, false); assert.match(gate.body.reason, /not enabled/);
    assert.equal(gate.body.worker.transcoder, false); assert.equal(gate.body.worker.renditions, 1); assert.deepEqual(gate.body.law.speeds, L.SPEEDS); assert.equal(gate.body.law.maxMs, L.MOTION.maxMs);
    process.env.WIRE_UPLOADS_ENABLED = "1";
    assert.match((await callRoute(route.GET, { path: "/api/editorial/motion" })).body.reason, /storage/, "images on, no storage: storage is named");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-never-used";
    assert.match((await callRoute(route.GET, { path: "/api/editorial/motion" })).body.reason, /WIRE_VIDEO_ENABLED/, "images on, storage on, video off: the flag is named");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const me = newDevice();
    const begin = await callRoute(route.POST, { path: "/api/editorial/motion", cookies: me.cookies, json: { user: me.uid, action: "begin", mime: "video/mp4", bytes: 1000 } });
    assert.equal(begin.status, 403); assert.equal(begin.body.code, "ACCOUNT_REQUIRED");
    const anon = await callRoute(route.POST, { path: "/api/editorial/motion", json: { action: "begin" } });
    assert.equal(anon.status, 401);
    // an admitted asset of a device (the store takes any owner; creation on the route needs an account)
    const a = await M.createMotionAsset({ ownerId: me.uid, path: `${me.uid}/${uuid()}.mp4`, container: "mp4", mime: "video/mp4", declaredBytes: 10 });
    await M.admitMotionAsset({ id: a.id, ownerId: me.uid, facts: { codec: "avc1", durationMs: 6000, width: 320, height: 180, bytes: 10 } });
    const owner = { uid: me.uid, cookies: me.cookies };
    const other = newDevice();
    // the route's account rule stands for captions too: a device answers 403 before the store is asked
    const devCaps = await callRoute(route.POST, { path: "/api/editorial/motion", cookies: owner.cookies, json: { user: owner.uid, action: "captions", id: a.id, tracks: [{ lang: "en", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nhi" }] } });
    assert.equal(devCaps.status, 403);
    await M.setMotionCaptions({ id: a.id, ownerId: me.uid, tracks: [{ lang: "en", label: "English", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nhi" }] });
    const vtt = await callRoute(route.GET, { path: "/api/editorial/motion", query: { captions: a.id, lang: "en" } });
    assert.equal(vtt.status, 200); assert.match(vtt.response.headers.get("content-type") || "", /text\/vtt/); assert.match(String(vtt.text || ""), /WEBVTT/);
    assert.equal((await callRoute(route.GET, { path: "/api/editorial/motion", query: { captions: a.id, lang: "de" } })).status, 404);
    assert.equal((await callRoute(route.GET, { path: "/api/editorial/motion", query: { captions: uuid() } })).status, 404);
    const mine = await callRoute(route.GET, { path: "/api/editorial/motion", cookies: owner.cookies, query: { user: owner.uid } });
    assert.equal(mine.body.mine.length, 1); assert.equal(mine.body.mine[0].captions[0].cues, 1); assert.equal("vtt" in mine.body.mine[0].captions[0], false, "the text serves on its own endpoint");
    assert.equal((await callRoute(route.GET, { path: "/api/editorial/motion", cookies: other.cookies, query: { user: other.uid } })).body.mine.length, 0);
  } finally {
    for (const k of keys) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  }
});

test("the editorial route refuses a MOTION that is not the author's admitted asset", async () => {
  const route = await loadRoute("app/api/editorial/route.js");
  const me = newDevice();
  // a device cannot post at all (403 before the composition is read) — the asset rule is exercised through the validator and the store
  const r = await callRoute(route.POST, { path: "/api/editorial", cookies: me.cookies, json: { user: me.uid, text: "x", composition: { video: { id: uuid() } } } });
  assert.equal(r.status, 403);
  const a = await M.createMotionAsset({ ownerId: "sb-someone", path: `sb-someone/${uuid()}.mp4`, container: "mp4", mime: "video/mp4", declaredBytes: 10 });
  const got = await M.getMotionAsset(a.id);
  assert.equal(got.ownerId === me.uid, false); assert.equal(got.state, "pending");
  assert.equal(M.motionForPost(got), null, "a pending asset never becomes a post's video");
});

test("the Feed's autoplay store reads the popup and visibility state at install, not only on change", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "media", "feedplay.js"), "utf8");
  const install = src.slice(src.indexOf("function ensure()"), src.indexOf("new IntersectionObserver"));
  assert.match(install, /popupUp = !!document\.documentElement\.dataset\.popup/, "a card born behind a restored popup must not play");
  assert.match(install, /hidden = document\.visibilityState !== "visible"/);
});
