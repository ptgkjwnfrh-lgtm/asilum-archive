// lib/music/index.js — THE MUSIC CIRCLE's law (V.2 Blueprint, owner, 17 Oct
// 2026, chapter 3 3.13–3.24 "persistent music controls", chapter 4 "Music
// integration and discovery"; slice 9). PURE and client-safe.
//
// WHAT IS REAL HERE. There is no music catalog and no connected streaming
// service: Spotify profiling is blocked by its Developer Policy and the
// owner's ruling of 2 October (OWNER-DECISIONS §7, manual-only, permanently);
// Spotify's display/link needs an approved OAuth app; Apple Music's MusicKit
// is not yet examined by the rights register. The connector registry
// (lib/connectors/index.js) states each of those as a capability state and
// the music panel repeats the sentence — never a "connect" that cannot
// happen, never a track label nobody identified (3.12).
//
// The one audio ASILUM has is a post's own: a MOTION's soundtrack. Chapter
// 3's persistent controls are therefore built over that single source —
// the audio keeps playing while the passenger browses (3.14, 3.17), the
// circle joins the Info Dock and stays on Direct Messages (3.18), its
// colour is the frame's, it pulses while playing and stills when paused
// (3.21), it fades out over 120–250 ms when playback ends (3.23). When a
// catalog or a provider arrives, a song becomes a second kind of source on
// the same player; nothing here needs rewriting for it.

import { notImplemented } from "../ai/contract.js";

export const CIRCLE_STATES = Object.freeze(["loading", "playing", "paused", "ended"]);
export const SOURCE_KINDS = Object.freeze(["motion"]);     // "song" joins with a catalog
export const BLEND_MS = Object.freeze({ min: 120, max: 250, default: 180 });   // 3.22, 3.23
export const PANEL_IDLE_MS = 8000;                                             // 3.20 inactivity collapses the panel
export const DISMISSALS = Object.freeze(["outside", "navigate", "idle"]);      // 3.20

/** A duration inside the blueprint's 120–250 ms band. */
export function blendMs(ms = BLEND_MS.default) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return BLEND_MS.default;
  return Math.min(BLEND_MS.max, Math.max(BLEND_MS.min, Math.round(n)));
}

/** What the circle shows for a player state (3.21, 3.23): present while a
 *  source exists and has not ended — pausing alone never removes it. */
export function circleFor(player) {
  const source = player && player.source ? player.source : null;
  const state = CIRCLE_STATES.includes(player && player.state) ? player.state : "ended";
  const visible = !!source && state !== "ended";
  return { visible, pulse: visible && state === "playing", still: visible && state === "paused", loading: visible && state === "loading", color: (source && source.color) || null };
}

/** The panel's adaptive dismissal (3.20): outside, navigation and idleness
 *  collapse it; active use keeps it; music never stops because it closed. */
export function panelAfter(event, { inUse = false } = {}) {
  if (!DISMISSALS.includes(event)) return { open: true, stops: false };
  if (event === "idle" && inUse) return { open: true, stops: false };
  return { open: false, stops: false };
}

/** The panel's controls for one source (3.19): track, artist, play/pause,
 *  skip, a shortcut back to the original media. With a post's own audio
 *  there is nothing to skip to, and the panel says so instead of greying a
 *  button into a promise. */
export function panelFor(player) {
  const s = player && player.source;
  if (!s) return null;
  return {
    title: s.title || "untitled", by: s.by || "", kind: s.kind,
    playing: player.state === "playing", loading: player.state === "loading",
    canSkip: false, skipNote: s.kind === "motion" ? "a post's own audio — nothing queued after it" : null,
    back: s.kind === "motion" && s.postId != null ? { view: "media", props: { id: s.postId, sample: !!s.sample, title: "MOTION" } } : null,
    label: s.kind === "motion" ? (s.identified ? null : "the post's own audio · no song identified") : null,
  };
}

/** Linear interpolation between two hex colours, for the 120–250 ms blend (3.22). */
export function lerpColor(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  if (!pa || !pb) return pb ? b : a;
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  return rgbToHex(pa.map((v, i) => Math.round(v + (pb[i] - v) * k)));
}
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) { return "#" + [r, g, b].map((v) => Math.min(255, Math.max(0, v | 0)).toString(16).padStart(2, "0")).join(""); }

/** The primary colour of a cover or a frame (3.21): over RGBA pixels, the
 *  average of the most saturated quarter, so a dark frame with one coloured
 *  bar gives the bar's colour and not mud. Pure; the component samples. */
export function dominantColor(rgba) {
  const d = rgba && rgba.length >= 4 ? rgba : null;
  if (!d) return null;
  const px = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    px.push({ r, g, b, sat: max === 0 ? 0 : (max - min) / max, lum: max });
  }
  px.sort((a, b) => b.sat * b.lum - a.sat * a.lum);
  const top = px.slice(0, Math.max(1, Math.floor(px.length / 4)));
  const avg = (k) => Math.round(top.reduce((s, p) => s + p[k], 0) / top.length);
  return rgbToHex([avg("r"), avg("g"), avg("b")]);
}

/** Music availability, from the connector registry's resolved states
 *  (lib/connectors/index.js connectorRegistry): what a passenger is told
 *  when they tap the music icon on a post (4.2). The catalog search (4.14),
 *  like-sync (4.1) and Wardrobe Music (4.11) are notImplemented until a
 *  provider or a catalog exists, and say so. */
export function musicAvailability(registry = []) {
  const providers = (registry || []).filter((c) => c.kind === "music").map((c) => {
    const cap = (id) => (c.capabilities || []).find((x) => x.id === id) || null;
    const playback = cap("playback") || cap("display-link");
    return { id: c.id, label: c.label, playback: playback ? playback.state : "unsupported", librarySync: (cap("library-sync") || cap("taste-import") || {}).state || "unsupported", basis: c.basis };
  });
  const connected = providers.filter((p) => ["available", "disconnected", "syncing"].includes(p.playback) && p.playback !== "disconnected");
  return {
    providers,
    connected: connected.map((p) => p.id),
    catalog: notImplemented("music:catalog-search", "Apple Music / Spotify catalog search needs an approved app (4.14)"),
    likeSync: notImplemented("music:like-sync", "saving to a streaming service needs a connected provider (4.1); Wardrobe Music needs a song entity"),
    wardrobeMusic: notImplemented("music:wardrobe", "a Music category in the Wardrobe carousel arrives with the first saveable song (4.11)"),
    sentence: providers.length
      ? `connect a streaming app in Settings — ${providers.map((p) => `${p.label}: ${p.playback.replace("-", " ")}`).join("; ")}`
      : "no streaming service is wired on this deployment",
  };
}
