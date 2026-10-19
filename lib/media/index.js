// lib/media/index.js — MOTION: THE MEDIA LAW (V.2 Blueprint, owner, 17 Oct
// 2026, chapter 3 "Video playback and persistent music controls" 3.1–3.12,
// chapter 4 where it touches a post's own audio, chapter 17.2 captions;
// slice 9). PURE and client-safe: the composer checks a file with it before
// an upload, the worker admits or refuses with it on the server's own copy
// of the bytes, the housing and the Feed play by it, the tests read it.
//
// WHAT THE MEDIA WORKER HONESTLY IS ON THIS STACK. There is no transcoder
// (no ffmpeg in the dependencies, no encoding service, a serverless body
// limit well under one video), so the worker is NOT a pipeline that turns
// any recording into a ladder of renditions. It is three real things:
//
//   1. a PROBE of the container's own header — ISOBMFF (MP4) boxes or EBML
//      (WebM) elements, read from the server's copy, never from what the
//      client says — giving the codec, the duration, the dimensions, the
//      rotation, whether the index sits before the data (fast start) and
//      whether an audio track exists;
//   2. ADMISSION against declared limits: a container browsers play natively
//      (H.264 in MP4, VP8/VP9 in WebM), a duration between MIN and MAX, an
//      edge no longer than MAX_EDGE, a size under MAX_BYTES. What is refused
//      is refused BY NAME — an HEVC recording (a phone's default) is told to
//      export as H.264, a WebM with no declared length is told to re-export —
//      never converted, never a player over a file that will not play;
//   3. STORAGE through the Wire's own public bucket (lib/posts/media.js), by a
//      signed direct upload because the function body limit forbids proxying
//      a video, then the probe over Range reads of the stored object.
//
// One rendition, then: what the author uploaded is what plays. The quality
// choice (3.6) is therefore stored as a preference and is honest about the
// single rendition; a ladder arrives with a transcoder, and this module says
// so in `QUALITY_NOTE` rather than drawing a menu over nothing.
//
// THE LIMITS are declared here and nowhere else (#271 copied-constants law).
// The figures are the owner's to ratify (docs/v2/slice-9).

import { notImplemented } from "../ai/contract.js";

export const MOTION = Object.freeze({
  maxBytes: 100 * 1024 * 1024,   // the bucket's file_size_limit for video
  maxMs: 180_000,                // three minutes — a fashion film, not a feature
  minMs: 1_000,
  maxEdge: 3840,                 // 4K UHD on the long edge
  minEdge: 16,
  containers: Object.freeze(["mp4", "webm"]),
  mimes: Object.freeze({ "video/mp4": "mp4", "video/webm": "webm" }),
  // what every current browser decodes natively — no transcoder, so nothing else
  codecs: Object.freeze({ mp4: Object.freeze(["avc1", "avc3"]), webm: Object.freeze(["V_VP8", "V_VP9"]) }),
});
export const SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);                       // 3.7
export const QUALITIES = Object.freeze(["adaptive", "highest", "lowest"]);              // 3.6
export const QUALITY_NOTE = "one rendition — the author's own encoding plays; a quality ladder arrives with a transcoder";
export const CONTROLS_HIDE_MS = 2500;                                                   // 3.2 auto-hide after inactivity
export const SEEK_STEP_S = 10;                                                          // 3.2 double-tap the sides
export const FEED_PLAY_RATIO = 0.5;                                                     // 3.3 "the most visible video plays"
export const INK_SAMPLE_MS = 2000;                                                      // the caption's ink re-reads the frame
export const CAPTION_SIZE = Object.freeze({ min: 0.8, max: 1.6, step: 0.1 });            // 3.9
export const CAPTION_OPACITY = Object.freeze({ min: 0, max: 1 });
export const VTT_MAX_BYTES = 200 * 1024;
export const VTT_MAX_CUES = 5000;
export const MAX_CAPTION_TRACKS = 5;
export const CAPTION_MODES = Object.freeze(["auto", "on", "off"]);                      // 3.10
export const AUTOPLAY_MODES = Object.freeze(["adaptive", "off"]);                       // 3.3

// ---- bytes ----------------------------------------------------------------

const u8 = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v && v.buffer ? v.buffer : v || []));
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const fixed16 = (b, o) => u32(b, o) / 65536;

/** Walk the boxes of one ISOBMFF range. A box that runs past the range is
 *  reported `truncated` so a reader of a head slice can say "the index is
 *  not here" instead of guessing. */
function* boxes(b, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let head = 8;
    if (size === 1) { if (o + 16 > end) return; size = u64(b, o + 8); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head) return;
    yield { type, start: o, bodyStart: o + head, end: Math.min(end, o + size), truncated: o + size > end };
    o += size;
  }
}
function findBox(b, start, end, type) { for (const x of boxes(b, start, end)) if (x.type === type) return x; return null; }

const MP4_VIDEO_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "vp08", "mp4v", "s263", "apcn", "apch"]);

/** Read one moov box into facts. */
function readMoov(b, moov) {
  const out = { durationMs: null, width: null, height: null, codec: null, audio: false, rotation: 0, tracks: 0 };
  const mvhd = findBox(b, moov.bodyStart, moov.end, "mvhd");
  if (mvhd) {
    const v = b[mvhd.bodyStart];
    const ts = v === 1 ? u32(b, mvhd.bodyStart + 20) : u32(b, mvhd.bodyStart + 12);
    const dur = v === 1 ? u64(b, mvhd.bodyStart + 24) : u32(b, mvhd.bodyStart + 16);
    if (ts > 0 && Number.isFinite(dur)) out.durationMs = Math.round((dur / ts) * 1000);
  }
  for (const trak of boxes(b, moov.bodyStart, moov.end)) {
    if (trak.type !== "trak") continue;
    out.tracks++;
    const mdia = findBox(b, trak.bodyStart, trak.end, "mdia");
    const hdlr = mdia && findBox(b, mdia.bodyStart, mdia.end, "hdlr");
    const handler = hdlr ? fourcc(b, hdlr.bodyStart + 8) : "";
    if (handler === "soun") { out.audio = true; continue; }
    if (handler !== "vide" || out.codec) continue;
    const tkhd = findBox(b, trak.bodyStart, trak.end, "tkhd");
    if (tkhd) {
      const v = b[tkhd.bodyStart];
      const m = tkhd.bodyStart + (v === 1 ? 52 : 40);           // the 3×3 matrix, 16.16
      const a = fixed16(b, m), bb = fixed16(b, m + 4), c = fixed16(b, m + 12), d = fixed16(b, m + 16);
      const w = fixed16(b, tkhd.bodyStart + (v === 1 ? 88 : 76)), h = fixed16(b, tkhd.bodyStart + (v === 1 ? 92 : 80));
      // a phone's portrait recording is a landscape track with a 90° matrix
      if (Math.round(a) === 0 && Math.round(d) === 0 && Math.round(bb) !== 0 && Math.round(c) !== 0) { out.rotation = bb > 0 ? 90 : 270; out.width = Math.round(h); out.height = Math.round(w); }
      else { out.rotation = a < 0 && d < 0 ? 180 : 0; out.width = Math.round(w); out.height = Math.round(h); }
    }
    const minf = mdia && findBox(b, mdia.bodyStart, mdia.end, "minf");
    const stbl = minf && findBox(b, minf.bodyStart, minf.end, "stbl");
    const stsd = stbl && findBox(b, stbl.bodyStart, stbl.end, "stsd");
    if (stsd && stsd.end - stsd.bodyStart >= 16) {
      const entry = stsd.bodyStart + 8;
      const type = fourcc(b, entry + 4);
      if (MP4_VIDEO_ENTRIES.has(type) || /^[a-z0-9]{4}$/i.test(type)) out.codec = type;
      if ((!out.width || !out.height) && entry + 36 <= stsd.end) { out.width = u16(b, entry + 32); out.height = u16(b, entry + 34); }
    }
    if (!out.codec) out.codec = "unknown";
  }
  return out;
}

/** Probe an MP4 from its head (and, when the index sits at the end, a tail
 *  slice). `{ ok:false, code:"moov-missing", needTail:true }` asks the
 *  worker for the tail. */
export function probeMp4(head, { tail = null } = {}) {
  const b = u8(head);
  if (b.length < 12 || fourcc(b, 4) !== "ftyp") return { ok: false, code: "not-mp4", message: "that file is not an MP4" };
  const brands = [fourcc(b, 8)];
  const ftyp = findBox(b, 0, b.length, "ftyp");
  for (let o = ftyp.bodyStart + 8; o + 4 <= ftyp.end; o += 4) brands.push(fourcc(b, o));
  let moovAt = null, mdatAt = null, moovBox = null, moovBytes = b;
  for (const x of boxes(b, 0, b.length)) {
    if (x.type === "moov" && !x.truncated) { moovAt = x.start; moovBox = x; }
    if (x.type === "moov" && x.truncated) return { ok: false, code: "moov-truncated", message: "the index is larger than the head slice", needTail: false, needBytes: x.end - x.start };
    if (x.type === "mdat" && mdatAt == null) mdatAt = x.start;
    if (moovBox) break;
  }
  if (!moovBox && tail) {
    const t = u8(tail);
    for (let i = 4; i + 4 <= t.length; i++) {
      if (t[i] !== 0x6d || fourcc(t, i) !== "moov") continue;
      const size = u32(t, i - 4);
      if (size >= 8 && i - 4 + size <= t.length) { moovBox = { type: "moov", start: i - 4, bodyStart: i + 4, end: i - 4 + size }; moovBytes = t; break; }
    }
    if (moovBox) { moovAt = Infinity; mdatAt = mdatAt == null ? 0 : mdatAt; }
  }
  if (!moovBox) return { ok: false, code: "moov-missing", message: "the index (moov) is not in the head of the file", needTail: !tail };
  const facts = readMoov(moovBytes, moovBox);
  return { ok: true, container: "mp4", brands, fastStart: mdatAt == null || moovAt < mdatAt, ...facts };
}

// ---- EBML / WebM ------------------------------------------------------------

function vint(b, o, keepMarker) {
  if (o >= b.length) return null;
  const first = b[o];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || o + len > b.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + b[o + i]; if (b[o + i] !== 0xff) allOnes = false; }
  return { value, len, unknown: !keepMarker && allOnes };
}
function* ebml(b, start, end) {
  let o = start;
  while (o < end) {
    const id = vint(b, o, true); if (!id) return;
    const size = vint(b, o + id.len, false); if (!size) return;
    const bodyStart = o + id.len + size.len;
    const bodyEnd = size.unknown ? end : Math.min(end, bodyStart + size.value);
    yield { id: id.value, bodyStart, end: bodyEnd, unknown: size.unknown };
    if (size.unknown) return;   // an unknown-size element runs to the end; its children are walked by the caller
    o = bodyEnd;
  }
}
const eUint = (b, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]; return v; };
const eFloat = (b, s, e) => { const dv = new DataView(b.buffer, b.byteOffset + s, e - s); return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : NaN; };
const eStr = (b, s, e) => String.fromCharCode(...b.subarray(s, e)).replace(/\0+$/, "");
const E = { EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackType: 0x83, CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Cluster: 0x1f43b675 };

/** Probe a WebM from its head. Info and Tracks precede the clusters, so the
 *  head is enough; a file with no declared Duration (a live recording) is
 *  reported so, and admission refuses it by name. */
export function probeWebm(head) {
  const b = u8(head);
  if (b.length < 4 || u32(b, 0) !== E.EBML) return { ok: false, code: "not-webm", message: "that file is not a WebM" };
  const out = { ok: true, container: "webm", docType: null, durationMs: null, width: null, height: null, codec: null, audio: false, rotation: 0, tracks: 0, fastStart: true };
  let scale = 1_000_000, duration = null;
  for (const top of ebml(b, 0, b.length)) {
    if (top.id === E.EBML) { for (const x of ebml(b, top.bodyStart, top.end)) if (x.id === E.DocType) out.docType = eStr(b, x.bodyStart, x.end); }
    if (top.id !== E.Segment) continue;
    for (const seg of ebml(b, top.bodyStart, top.end)) {
      if (seg.id === E.Cluster) break;
      if (seg.id === E.Info) for (const x of ebml(b, seg.bodyStart, seg.end)) {
        if (x.id === E.TimecodeScale) scale = eUint(b, x.bodyStart, x.end);
        if (x.id === E.Duration) duration = eFloat(b, x.bodyStart, x.end);
      }
      if (seg.id === E.Tracks) for (const te of ebml(b, seg.bodyStart, seg.end)) {
        if (te.id !== E.TrackEntry) continue;
        out.tracks++;
        let type = 0, codec = "", w = null, h = null;
        for (const x of ebml(b, te.bodyStart, te.end)) {
          if (x.id === E.TrackType) type = eUint(b, x.bodyStart, x.end);
          if (x.id === E.CodecID) codec = eStr(b, x.bodyStart, x.end);
          if (x.id === E.Video) for (const v of ebml(b, x.bodyStart, x.end)) { if (v.id === E.PixelWidth) w = eUint(b, v.bodyStart, v.end); if (v.id === E.PixelHeight) h = eUint(b, v.bodyStart, v.end); }
        }
        if (type === 2) out.audio = true;
        if (type === 1 && !out.codec) { out.codec = codec || "unknown"; out.width = w; out.height = h; }
      }
    }
  }
  if (out.docType && out.docType !== "webm") return { ok: false, code: "not-webm", message: `an EBML ${out.docType} file is not a WebM` };
  if (Number.isFinite(duration) && duration > 0) out.durationMs = Math.round((duration * scale) / 1e6);
  return out;
}

/** The one probe: sniff the container, then read it. */
export function probeVideo(head, { tail = null } = {}) {
  const b = u8(head);
  if (!b.length) return { ok: false, code: "empty", message: "nothing was uploaded" };
  if (b.length >= 12 && fourcc(b, 4) === "ftyp") return probeMp4(b, { tail });
  if (b.length >= 4 && u32(b, 0) === E.EBML) return probeWebm(b);
  return { ok: false, code: "unreadable", message: "that file is not an MP4 or a WebM this worker can read" };
}

/** Admit or refuse by name. `bytes` is the stored object's real size. */
export function admitMotion(probe, { bytes = null, limits = MOTION } = {}) {
  const refuse = (code, message) => ({ ok: false, code, message });
  if (!probe || !probe.ok) return refuse(probe && probe.code || "unreadable", probe && probe.message || "that file could not be read");
  if (!limits.containers.includes(probe.container)) return refuse("container", `a ${probe.container} is not a container this worker admits`);
  const allowed = limits.codecs[probe.container] || [];
  if (!probe.codec || probe.codec === "unknown") return refuse("codec-unknown", "the video track declares no codec this worker knows");
  if (!allowed.includes(probe.codec)) {
    const hevc = /^(hvc1|hev1)$/.test(probe.codec);
    return refuse("codec", hevc
      ? "HEVC (a phone's default) needs a transcoder that does not exist here — export as H.264 (\"Most Compatible\") and upload that"
      : `${probe.codec} is not a codec browsers play natively; without a transcoder only ${allowed.join(" / ")} in ${probe.container} is admitted`);
  }
  if (probe.durationMs == null) return refuse("duration-unknown", "the container declares no length (a live recording) — re-export it so the player can seek");
  if (probe.durationMs < limits.minMs) return refuse("too-short", `a MOTION is at least ${limits.minMs / 1000} second`);
  if (probe.durationMs > limits.maxMs) return refuse("too-long", `a MOTION is at most ${Math.round(limits.maxMs / 60000)} minutes`);
  if (!(probe.width >= limits.minEdge && probe.height >= limits.minEdge)) return refuse("dimensions", "the video track declares no usable dimensions");
  if (Math.max(probe.width, probe.height) > limits.maxEdge) return refuse("too-large-edge", `an edge is at most ${limits.maxEdge} pixels`);
  if (bytes != null && bytes > limits.maxBytes) return refuse("too-large", `a MOTION is at most ${Math.round(limits.maxBytes / 1024 / 1024)} MB`);
  return {
    ok: true, code: "ready",
    facts: { container: probe.container, codec: probe.codec, durationMs: probe.durationMs, width: probe.width, height: probe.height, rotation: probe.rotation || 0, audio: !!probe.audio, fastStart: probe.fastStart !== false, bytes },
    note: probe.fastStart === false ? "the index sits after the data: playback waits for the whole file (no muxer here to move it)" : null,
  };
}

/** What a file declares before any upload: the mime and the size, checked
 *  against the same limits. The duration the browser reads is checked
 *  client-side too, so an over-long file never leaves the device. */
export function preflightMotion({ mime, bytes, durationMs = null }, limits = MOTION) {
  const container = limits.mimes[String(mime || "").split(";")[0].trim().toLowerCase()] || null;
  if (!container) return { ok: false, code: "mime", message: "an MP4 (H.264) or a WebM (VP8/VP9) — nothing else plays natively, and there is no transcoder" };
  if (!(Number(bytes) > 0)) return { ok: false, code: "empty", message: "nothing was chosen" };
  if (Number(bytes) > limits.maxBytes) return { ok: false, code: "too-large", message: `a MOTION is at most ${Math.round(limits.maxBytes / 1024 / 1024)} MB` };
  if (durationMs != null && durationMs > limits.maxMs) return { ok: false, code: "too-long", message: `a MOTION is at most ${Math.round(limits.maxMs / 60000)} minutes` };
  if (durationMs != null && durationMs < limits.minMs) return { ok: false, code: "too-short", message: `a MOTION is at least ${limits.minMs / 1000} second` };
  return { ok: true, container };
}

// ---- playback laws ----------------------------------------------------------

export const MEDIA_PREFERENCES = Object.freeze({
  captions: "auto",        // 3.10 automatic during muted autoplay; the passenger overrides
  captionSize: 1,          // 3.9
  captionOpacity: 0.6,     // 3.9
  quality: "adaptive",     // 3.6 (one rendition today — QUALITY_NOTE)
  autoplay: "adaptive",    // 3.3
  feedAudio: false,        // 3.3 "audio follows the passenger's preference"
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** The preferences, validated: an unknown value falls to the default, never throws. */
export function normalizeMediaPreferences(p) {
  const o = p && typeof p === "object" ? p : {};
  return {
    captions: CAPTION_MODES.includes(o.captions) ? o.captions : MEDIA_PREFERENCES.captions,
    captionSize: Math.round(clamp(o.captionSize, CAPTION_SIZE.min, CAPTION_SIZE.max, MEDIA_PREFERENCES.captionSize) * 100) / 100,
    captionOpacity: Math.round(clamp(o.captionOpacity, CAPTION_OPACITY.min, CAPTION_OPACITY.max, MEDIA_PREFERENCES.captionOpacity) * 100) / 100,
    quality: QUALITIES.includes(o.quality) ? o.quality : MEDIA_PREFERENCES.quality,
    autoplay: AUTOPLAY_MODES.includes(o.autoplay) ? o.autoplay : MEDIA_PREFERENCES.autoplay,
    feedAudio: o.feedAudio === true,
  };
}

/** Adaptive autoplay in the Feed (3.3): the most visible video plays, muted
 *  unless the passenger wants audio; reduced motion, data saving and Low
 *  Power Mode limit it. `lowPower` is null where the platform does not say
 *  (the web does not), and null never counts as a limit. Captions appear
 *  automatically during muted autoplay (3.10). */
export function autoplayPolicy({ prefs = MEDIA_PREFERENCES, reducedMotion = false, saveData = false, lowPower = null } = {}) {
  const p = normalizeMediaPreferences(prefs);
  const muted = !p.feedAudio;
  const captions = p.captions === "on" || (p.captions === "auto" && muted);
  if (reducedMotion) return { autoplay: false, muted, captions, reason: "reduced motion" };
  if (p.autoplay === "off") return { autoplay: false, muted, captions, reason: "autoplay off in Settings" };
  if (saveData) return { autoplay: false, muted, captions, reason: "data saver" };
  if (lowPower === true) return { autoplay: false, muted, captions, reason: "low power mode" };
  return { autoplay: true, muted, captions, reason: null };
}

/** The one card that plays (3.3): the largest visible ratio at or above the
 *  floor; a tie goes to the earlier entry; none → null. */
export function mostVisible(entries, floor = FEED_PLAY_RATIO) {
  let best = null;
  for (const e of entries || []) {
    const r = Number(e && e.ratio);
    if (!(r >= floor)) continue;
    if (!best || r > best.ratio) best = { id: e.id, ratio: r };
  }
  return best ? best.id : null;
}

/** Captions in the housing (3.10): the passenger's override, else automatic
 *  only while muted. */
export function captionsShown({ prefs = MEDIA_PREFERENCES, muted = false } = {}) {
  const p = normalizeMediaPreferences(prefs);
  if (p.captions === "on") return true;
  if (p.captions === "off") return false;
  return !!muted;
}

/** Which track (3.11): the preferred languages in order, exact then by
 *  primary subtag; then the track marked default; then the first. */
export function pickCaptionTrack(tracks, preferred = []) {
  const list = (tracks || []).filter((t) => t && t.lang);
  if (!list.length) return null;
  const norm = (l) => String(l || "").toLowerCase();
  for (const want of preferred.map(norm)) {
    const exact = list.find((t) => norm(t.lang) === want);
    if (exact) return exact;
    const primary = want.split("-")[0];
    const loose = list.find((t) => norm(t.lang).split("-")[0] === primary);
    if (loose) return loose;
  }
  return list.find((t) => t.default) || list[0];
}

/** Caption appearance (3.9): size and background opacity, clamped. */
export function captionAppearance(prefs) {
  const p = normalizeMediaPreferences(prefs);
  return { fontScale: p.captionSize, background: `rgba(0, 0, 0, ${p.captionOpacity})` };
}

/** Single active audio source (3.15–3.16): claiming audio for `next` pauses
 *  the previous source; releasing leaves the field empty. Pure over a state. */
export function claimAudio(state, next) {
  const prev = state && state.active ? state.active : null;
  if (!next) return { active: null, paused: prev };
  if (prev && prev.id === next.id) return { active: next, paused: null };
  return { active: next, paused: prev };
}

const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
function vttTime(s) {
  const m = TIME.exec(String(s || "").trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0, mi = Number(m[2]), se = Number(m[3]), ms = Number((m[4] + "00").slice(0, 3));
  if (mi > 59 || se > 59) return null;
  return h * 3600 + mi * 60 + se + ms / 1000;
}

/** Creator-provided WebVTT (3.8): parsed into cues, bounded. Automatic
 *  transcription and translation are NOT this — see `transcription()`. */
export function parseVtt(text) {
  const src = String(text || "");
  if (new TextEncoder().encode(src).length > VTT_MAX_BYTES) return { ok: false, cues: [], errors: [`a caption file is at most ${VTT_MAX_BYTES / 1024} KB`] };
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  if (!/^﻿?WEBVTT(\s|$)/.test(lines[0] || "")) return { ok: false, cues: [], errors: ["a caption file starts with WEBVTT"] };
  const cues = [], errors = [];
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^(NOTE|STYLE|REGION)\b/.test(line)) { i++; if (/^(NOTE|STYLE|REGION)\b/.test(line)) while (i < lines.length && lines[i].trim()) i++; continue; }
    let timing = line;
    if (!line.includes("-->")) { timing = lines[i + 1] || ""; i++; }
    const m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(timing);
    const start = m && vttTime(m[1]), end = m && vttTime(m[2]);
    if (start == null || end == null || !(end > start)) { errors.push(`cue ${cues.length + 1}: a timing reads 00:00.000 --> 00:01.000`); while (i < lines.length && lines[i].trim()) i++; continue; }
    i++;
    const body = [];
    while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
    cues.push({ start, end, text: body.join("\n").slice(0, 2000) });
    if (cues.length > VTT_MAX_CUES) { errors.push(`at most ${VTT_MAX_CUES} cues`); break; }
  }
  if (!cues.length && !errors.length) errors.push("no cues");
  return { ok: errors.length === 0, cues, errors };
}

const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** The tracks an author attaches (3.8, 3.11): a language each, a label, the
 *  VTT text; at most MAX_CAPTION_TRACKS; one may be the default. */
export function validateCaptionTracks(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  const errors = [];
  if (list.length > MAX_CAPTION_TRACKS) errors.push(`at most ${MAX_CAPTION_TRACKS} caption tracks`);
  const out = [];
  const seen = new Set();
  list.slice(0, MAX_CAPTION_TRACKS).forEach((t, i) => {
    const lang = String(t && t.lang || "").trim();
    if (!LANG.test(lang)) { errors.push(`track ${i + 1}: a language tag like en or pt-BR`); return; }
    if (seen.has(lang.toLowerCase())) { errors.push(`track ${i + 1}: ${lang} twice`); return; }
    const parsed = parseVtt(t.vtt);
    if (!parsed.ok) { errors.push(`track ${i + 1} (${lang}): ${parsed.errors[0]}`); return; }
    seen.add(lang.toLowerCase());
    out.push({ lang, label: String(t.label || lang).slice(0, 60), default: !!t.default && !out.some((x) => x.default), vtt: String(t.vtt), cues: parsed.cues.length });
  });
  return { ok: errors.length === 0, tracks: out, errors };
}

/** The video attachment a composition may carry (lib/posts/compose.js reads
 *  this): an ADMITTED asset — an id, the facts the worker read, nothing the
 *  author typed. */
export function validateVideoAttachment(v, limits = MOTION) {
  if (!v || typeof v !== "object") return { ok: false, code: "video-shape", message: "a video is an admitted upload, not a link" };
  if (!/^[0-9a-f-]{36}$/.test(String(v.id || ""))) return { ok: false, code: "video-unadmitted", message: "the video has not been admitted by the media worker yet" };
  if (v.state && v.state !== "ready") return { ok: false, code: "video-not-ready", message: v.state === "refused" ? `the video was refused: ${v.refusalNote || v.refusalCode || "see the worker's reason"}` : "the video is still being checked" };
  const d = Number(v.durationMs);
  if (!(d >= limits.minMs && d <= limits.maxMs)) return { ok: false, code: "video-duration", message: `a MOTION runs ${limits.minMs / 1000} s to ${Math.round(limits.maxMs / 60000)} minutes` };
  return { ok: true };
}

/** The facts a reader gets about a MOTION — never the owner, never the path's secret half. */
export function publicVideo(a) {
  if (!a) return null;
  return { id: a.id, url: a.url || null, poster: a.poster || null, durationMs: a.durationMs, width: a.width, height: a.height, rotation: a.rotation || 0, codec: a.codec, container: a.container, audio: !!a.audio, captions: (a.captions || []).map((t) => ({ lang: t.lang, label: t.label, default: !!t.default })) };
}

// ---- the honest AI seams (3.8, 3.11, 3.12) ----------------------------------
// No paid AI runs on this stack (constitution: no fake AI). Each returns the
// contract's notImplemented so a surface can say so, and never a guess.

/** Automatic transcription (3.8, 3.12). */
export function transcription() { return notImplemented("media:transcription", "a speech-to-text provider under the rights register; creator-provided captions are the real path"); }
/** Caption translation (3.8, 3.11). */
export function translation() { return notImplemented("media:translation", "a translation provider; the passenger's language is matched among the creator's tracks instead"); }
/** Music identification (3.12–3.13): "never invent lyrics, artists or titles". */
export function musicIdentification() { return notImplemented("media:music-id", "an audio fingerprint provider with a confidence floor; until then no track label is drawn"); }
