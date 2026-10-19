// lib/posts/compose.js — THE ONE COMPOSER's law (V.2 brief §6, owner, 1 Oct
// 2026). Pure and isomorphic: the composer validates with it as the author
// types, the editorial route validates with it again before a row is
// written, and the tests read the same rules.
//
// A COMPOSITION is text + attachments. Its top-level KIND is DERIVED, never
// chosen in a menu of seven upload screens:
//   transmission — text only, at most TRANSMISSION_MAX grapheme clusters;
//   video        — a MOTION: an upload the media worker ADMITTED (slice 9,
//                  lib/media/index.js) — caption, tagged pieces, a poster the
//                  author captured, creator captions; never a link, never a
//                  file the worker has not read;
//   post         — images, a carousel, a wardrobe fragment, an exposé, or an
//                  event publication; those are LAYOUTS of a post, and
//                  "transmission" is not also a duplicate post subtype.
// Attaching an image turns a transmission into a post and keeps the text as
// its caption; detaching every image exposes the transmission again — and
// if the text is then over the limit the author is ASKED to shorten it,
// never truncated. Switching layout never publishes.
//
// Limits the brief leaves unspecified carry its candidate defaults, named
// here and reported in the launch note: 10 images per carousel, 10 pieces
// per wardrobe fragment, 1 event per event publication, 3 text layers per
// exposé with a bounded palette.

import { validateVideoAttachment } from "../media/index.js";

export const TRANSMISSION_MAX = 500;        // grapheme clusters
export const CAPTION_MAX = 5000;            // the post body (the Aug 13 law)
export const TITLE_MAX = 200;
export const MAX_IMAGES = 10;
export const MAX_PIECES = 10;
export const MAX_EVENT_ATTACHMENTS = 1;
export const MAX_LAYERS = 3;
export const LAYER_TEXT_MAX = 120;
export const ALT_MAX = 300;
export const LAYOUTS = Object.freeze(["single", "carousel", "fragment", "expose", "event"]);
// BRDCST attachments are unlimited by the blueprint (5.10); the row is bounded
// so a footer stays a footer — twenty per post, five visible at a time.
export const MAX_BRDCSTS = 20;
/** Every event on a composition: the list, or the single legacy slot. */
export function eventsOf(c) {
  if (!c) return [];
  const list = Array.isArray(c.events) ? c.events.filter(Boolean) : [];
  if (c.event && !list.some((e) => e && String(e.id) === String(c.event.id))) list.unshift(c.event);
  return list;
}
export const KINDS = Object.freeze(["transmission", "post", "video"]);
// ECHO (V.2 Blueprint, 17 Oct 2026): a temporary story. `echo: true` on a
// composition marks it; the row stores `attachments.echo.expiresAt`, 24
// hours after publication unless a shorter life is asked for (never a
// longer one in this slice — pinning after expiry is an open owner
// decision). Expired echoes are never served live (Terms 5.4).
export const ECHO_TTL_MS = 24 * 60 * 60 * 1000;
export const ECHO_MIN_MS = 60 * 60 * 1000;
export const LAYER_ALIGNS = Object.freeze(["left", "center", "right"]);
export const LAYER_POSITIONS = Object.freeze(["top", "middle", "bottom"]);
// the exposé palette: ink tokens, never arbitrary colour
export const LAYER_COLORS = Object.freeze(["paper", "ink", "red", "sig"]);
export const LAYER_FONTS = Object.freeze(["display", "mono"]);

/** Grapheme clusters, the way a person counts letters (an emoji with skin
 *  tone is one). Falls back to code points where Intl.Segmenter is absent. */
export function graphemeCount(text) {
  const s = String(text || "");
  if (!s) return 0;
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      let n = 0;
      for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) n++;
      return n;
    }
  } catch { /* fall through */ }
  return Array.from(s).length;
}

/** An empty composition. */
export function emptyComposition() {
  return { text: "", title: "", media: [], video: null, pieces: [], link: null, event: null, events: [], layout: null, layers: [], alt: "", echo: false, echoMs: null };
}

/** The derived kind. */
export function kindOf(c) {
  if (c && c.video) return "video";
  // a chosen fragment layout is a post even before its first piece, so the
  // validator can say "needs at least one piece" instead of calling it text
  if (c && ((c.media && c.media.length) || eventsOf(c).length || c.layout === "fragment" || c.link)) return "post";
  return "transmission";
}

/** The layout a post takes when the author has not chosen one. */
export function defaultLayout(c) {
  if (eventsOf(c).length) return "event";
  if (c.layout === "fragment" && c.pieces && c.pieces.length) return "fragment";
  if (c.media && c.media.length > 1) return "carousel";
  if (c.media && c.media.length === 1) return "single";
  if (c.link) return "single";
  return null;
}

/**
 * Validate. Returns { ok, kind, layout, errors: [{ code, message }] }.
 * Every message is a sentence the composer can show; the route answers 400
 * with the same words so the author never sees two vocabularies.
 */
export function validateComposition(input) {
  const c = { ...emptyComposition(), ...(input || {}) };
  const errors = [];
  const kind = kindOf(c);
  const text = String(c.text || "");
  const title = String(c.title || "");
  if (title.length > TITLE_MAX) errors.push({ code: "title-long", message: `the caption header is ${title.length} characters; ${TITLE_MAX} is the most` });
  if (kind === "transmission") {
    const n = graphemeCount(text);
    if (!text.trim()) errors.push({ code: "empty", message: "a transmission needs words" });
    else if (n > TRANSMISSION_MAX) errors.push({ code: "transmission-long", message: `a transmission is at most ${TRANSMISSION_MAX} characters — this one is ${n}. shorten it, or attach an image and it becomes a post` });
  } else {
    if (text.length > CAPTION_MAX) errors.push({ code: "caption-long", message: `the caption is ${text.length} characters; ${CAPTION_MAX} is the most` });
  }
  const media = Array.isArray(c.media) ? c.media : [];
  if (media.length > MAX_IMAGES) errors.push({ code: "too-many-images", message: `${media.length} images; a carousel holds ${MAX_IMAGES}` });
  media.forEach((m, i) => {
    if (!m || typeof m.path !== "string" || !/^[A-Za-z0-9_\-\/.]{3,200}$/.test(m.path)) errors.push({ code: "bad-media", message: `image ${i + 1} has no stored path` });
    if (m && m.alt && String(m.alt).length > ALT_MAX) errors.push({ code: "alt-long", message: `image ${i + 1}'s description is over ${ALT_MAX} characters` });
  });
  const pieces = Array.isArray(c.pieces) ? c.pieces : [];
  if (pieces.length > MAX_PIECES) errors.push({ code: "too-many-pieces", message: `${pieces.length} pieces; a fragment holds ${MAX_PIECES}` });
  pieces.forEach((p, i) => {
    const id = typeof p === "string" ? p : p && p.id;
    if (!id || !/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(String(id))) errors.push({ code: "unresolved-piece", message: `piece ${i + 1} is not a resolved listing — tag a piece by choosing it, not by naming it` });
  });
  const events = eventsOf(c);
  if (events.length > MAX_BRDCSTS) errors.push({ code: "too-many-events", message: `${events.length} events; a footer holds ${MAX_BRDCSTS}` });
  if (events.some((e) => typeof e !== "object" || !e.id || !/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(String(e.id)))) errors.push({ code: "unresolved-event", message: "the event must be one the map knows" });
  if (c.link) {
    let ok = false;
    try { const u = new URL(String(c.link.url || c.link)); ok = u.protocol === "https:"; } catch { ok = false; }
    if (!ok) errors.push({ code: "bad-link", message: "a link must be an https address" });
  }
  if (c.video) {
    // an admitted asset only: the id the worker issued and the facts it read (slice 9)
    const vv = validateVideoAttachment(c.video);
    if (!vv.ok) errors.push({ code: vv.code, message: vv.message });
    if (media.length) errors.push({ code: "video-and-images", message: "a MOTION carries one video; the images would need a second post" });
  }
  const layout = kind === "post" ? (LAYOUTS.includes(c.layout) ? c.layout : defaultLayout(c)) : null;
  if (kind === "post" && layout === "fragment" && !pieces.length) errors.push({ code: "fragment-empty", message: "a wardrobe fragment needs at least one piece" });
  if (kind === "post" && layout === "event" && !events.length) errors.push({ code: "event-missing", message: "an event publication needs an event" });
  if (kind === "post" && layout === "expose" && !media.length) errors.push({ code: "expose-no-image", message: "an exposé is text over an image — add one" });
  const layers = Array.isArray(c.layers) ? c.layers : [];
  if (layers.length > MAX_LAYERS) errors.push({ code: "too-many-layers", message: `${layers.length} text layers; ${MAX_LAYERS} is the most` });
  layers.forEach((l, i) => {
    if (!l || typeof l.text !== "string" || !l.text.trim() || l.text.length > LAYER_TEXT_MAX) errors.push({ code: "layer-text", message: `layer ${i + 1} needs text of at most ${LAYER_TEXT_MAX} characters` });
    if (l && l.align && !LAYER_ALIGNS.includes(l.align)) errors.push({ code: "layer-align", message: `layer ${i + 1}: alignment must be ${LAYER_ALIGNS.join(", ")}` });
    if (l && l.position && !LAYER_POSITIONS.includes(l.position)) errors.push({ code: "layer-position", message: `layer ${i + 1}: position must be ${LAYER_POSITIONS.join(", ")}` });
    if (l && l.color && !LAYER_COLORS.includes(l.color)) errors.push({ code: "layer-color", message: `layer ${i + 1}: colour must be one of the palette` });
    if (l && l.font && !LAYER_FONTS.includes(l.font)) errors.push({ code: "layer-font", message: `layer ${i + 1}: font must be display or mono` });
    const x = Number(l && l.x), y = Number(l && l.y);
    if (l && (l.x != null || l.y != null) && !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) errors.push({ code: "layer-pos", message: `layer ${i + 1}: positions are normalised 0–1` });
  });
  if (kind === "post" && !text.trim() && !media.length && !events.length && !pieces.length && !c.link) errors.push({ code: "empty", message: "a post needs words or something attached" });
  if (c.echo) {
    if (c.video) errors.push({ code: "echo-video", message: "an echo is words or an image — the echo viewer does not play video yet" });
    if (c.echoMs != null && !(Number(c.echoMs) >= ECHO_MIN_MS && Number(c.echoMs) <= ECHO_TTL_MS)) errors.push({ code: "echo-life", message: "an echo lives between one hour and twenty-four hours" });
  }
  return { ok: errors.length === 0, kind, layout, errors, echo: !!c.echo };
}

/** Attachments as stored on the row: structured, bounded, no HTML. */
export function attachmentsFor(c, { pieceSnapshots = null, eventSnapshot = null, eventSnapshots = null, linkSnapshot = null, videoSnapshot = null, now = Date.now() } = {}) {
  const v = validateComposition(c);
  if (!v.ok) throw new Error(v.errors.map((e) => e.message).join("; "));
  const out = {};
  if (c.media && c.media.length) out.media = c.media.slice(0, MAX_IMAGES).map((m) => ({ path: m.path, alt: String(m.alt || "").slice(0, ALT_MAX), w: Number(m.w) || null, h: Number(m.h) || null }));
  if (pieceSnapshots && pieceSnapshots.length) out.pieces = pieceSnapshots.slice(0, MAX_PIECES);
  // the first event keeps the legacy slot (every reader of `event` still works); the list carries them all
  const evs = (eventSnapshots && eventSnapshots.length ? eventSnapshots : eventSnapshot ? [eventSnapshot] : []).slice(0, MAX_BRDCSTS);
  if (evs.length) { out.event = evs[0]; if (evs.length > 1) out.events = evs; }
  if (linkSnapshot) out.link = linkSnapshot;
  if (v.layout === "expose" && c.layers && c.layers.length) {
    out.layers = c.layers.slice(0, MAX_LAYERS).map((l) => ({
      text: String(l.text).slice(0, LAYER_TEXT_MAX), align: LAYER_ALIGNS.includes(l.align) ? l.align : "left",
      position: LAYER_POSITIONS.includes(l.position) ? l.position : "bottom", color: LAYER_COLORS.includes(l.color) ? l.color : "paper",
      font: LAYER_FONTS.includes(l.font) ? l.font : "display", x: Number(l.x) >= 0 && Number(l.x) <= 1 ? Number(l.x) : 0.08, y: Number(l.y) >= 0 && Number(l.y) <= 1 ? Number(l.y) : 0.86,
    }));
  }
  if (c.alt) out.alt = String(c.alt).slice(0, ALT_MAX);
  // the MOTION as the worker admitted it (the route resolves the row and its URLs)
  if (c.video) out.video = videoSnapshot || { id: String(c.video.id) };
  if (c.echo) {
    const life = c.echoMs != null ? Number(c.echoMs) : ECHO_TTL_MS;
    out.echo = { expiresAt: now + life };
  }
  return out;
}
