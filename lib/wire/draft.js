// lib/wire/draft.js — THE DRAFT (V.2 brief §6): one composition in
// progress, autosaved on the device with a version, and an ATTACHMENT
// HISTORY: a detached image is not thrown away — it waits in `detached`
// until the author discards it, so switching from a post back to a
// transmission and forward again loses nothing. Client-only storage
// (localStorage); the server never sees a draft. Everything here is a
// convenience: with no storage the composer still works from memory.

import { emptyComposition, kindOf, validateComposition } from "./compose.js";

export const DRAFT_KEY = "asilum-wire-draft";
const MAX_DETACHED = 20;

function store() { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } }

export function newDraft() {
  return { version: 0, updatedAt: null, composition: emptyComposition(), detached: [] };
}

export function readDraft() {
  const s = store();
  if (!s) return newDraft();
  try {
    const d = JSON.parse(s.getItem(DRAFT_KEY) || "null");
    if (!d || typeof d !== "object" || !d.composition) return newDraft();
    return { version: Number(d.version) || 0, updatedAt: d.updatedAt || null, composition: { ...emptyComposition(), ...d.composition }, detached: Array.isArray(d.detached) ? d.detached : [] };
  } catch { return newDraft(); }
}

export function writeDraft(d) {
  const next = { ...d, version: (Number(d.version) || 0) + 1, updatedAt: new Date().toISOString() };
  const s = store();
  if (s) { try { s.setItem(DRAFT_KEY, JSON.stringify(next)); } catch {} }
  return next;
}

export function clearDraft() {
  const s = store();
  if (s) { try { s.removeItem(DRAFT_KEY); } catch {} }
  return newDraft();
}

// ---- pure transitions (each returns a new draft; the caller writes it) ----

/** Attach an image: the transmission becomes a post, its text stays as the caption. */
export function attachMedia(d, media) {
  const c = d.composition;
  return { ...d, composition: { ...c, media: [...(c.media || []), media].slice(0, 10) } };
}

/** Detach one image: it goes to the history, never to the bin, until discarded. */
export function detachMedia(d, path) {
  const c = d.composition;
  const gone = (c.media || []).find((m) => m.path === path);
  const media = (c.media || []).filter((m) => m.path !== path);
  const detached = gone ? [{ ...gone, detachedAt: new Date().toISOString() }, ...(d.detached || [])].slice(0, MAX_DETACHED) : d.detached;
  // with no image left the layout that needed one is gone too
  const layout = media.length ? c.layout : (c.layout === "single" || c.layout === "carousel" || c.layout === "expose" ? null : c.layout);
  return { ...d, composition: { ...c, media, layout, layers: media.length ? c.layers : [] }, detached };
}

/** Bring a detached image back. */
export function restoreMedia(d, path) {
  const back = (d.detached || []).find((m) => m.path === path);
  if (!back) return d;
  const { detachedAt, ...media } = back;
  return attachMedia({ ...d, detached: d.detached.filter((m) => m.path !== path) }, media);
}

/** Discard a detached image for good (the caller deletes the object). */
export function discardMedia(d, path) {
  return { ...d, detached: (d.detached || []).filter((m) => m.path !== path) };
}

/** The MOTION the worker admitted (slice 9): one per post; images leave. */
export function setVideo(d, video) { return { ...d, composition: { ...d.composition, video: video || null, media: video ? [] : d.composition.media, layout: video ? null : d.composition.layout } }; }
export function setText(d, text) { return { ...d, composition: { ...d.composition, text: String(text || "") } }; }
export function setTitle(d, title) { return { ...d, composition: { ...d.composition, title: String(title || "").slice(0, 200) } }; }
export function setLayout(d, layout) { return { ...d, composition: { ...d.composition, layout: layout || null } }; }
export function setLink(d, link) { return { ...d, composition: { ...d.composition, link: link || null } }; }
export function setEvent(d, event) { return { ...d, composition: { ...d.composition, event: event || null, events: event ? [event] : [], layout: event ? "event" : (d.composition.layout === "event" ? null : d.composition.layout) } }; }
/** Attach one more BRDCST (5.9–5.10): unlimited by law, bounded by the row; the first stays in the legacy slot. */
export function addEvent(d, event) {
  if (!event || !event.id) return d;
  const cur = (d.composition.events && d.composition.events.length ? d.composition.events : d.composition.event ? [d.composition.event] : []);
  if (cur.some((e) => String(e.id) === String(event.id))) return d;
  const events = [...cur, event].slice(0, 20);
  return { ...d, composition: { ...d.composition, event: events[0], events, layout: "event" } };
}
export function removeEvent(d, id) {
  const cur = (d.composition.events && d.composition.events.length ? d.composition.events : d.composition.event ? [d.composition.event] : []).filter((e) => String(e.id) !== String(id));
  return { ...d, composition: { ...d.composition, event: cur[0] || null, events: cur, layout: cur.length ? "event" : (d.composition.layout === "event" ? null : d.composition.layout) } };
}
export function setPieces(d, pieces) { return { ...d, composition: { ...d.composition, pieces: (pieces || []).slice(0, 10) } }; }
export function setLayers(d, layers) { return { ...d, composition: { ...d.composition, layers: (layers || []).slice(0, 3) } }; }

/** What the author sees: the kind now, the validation, and the counts. */
export function describe(d) {
  const v = validateComposition(d.composition);
  return { kind: kindOf(d.composition), ...v };
}
