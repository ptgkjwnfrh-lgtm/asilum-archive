// lib/music/player.js — THE ONE AUDIO SOURCE (V.2 Blueprint 3.14–3.24;
// slice 9). CLIENT-ONLY. A single hidden media element (MusicHost.jsx owns
// it) carries whatever audio keeps playing while the passenger browses:
// today a MOTION's own soundtrack after "KEEP THE AUDIO" in the housing
// (3.14); a song joins as a second source kind when a catalog or a provider
// exists. The law (lib/music/index.js) decides what the circle shows; this
// is the state and the element.
//
// Single active audio source (3.15): taking a source here pauses the
// housing's own playback — the housing listens to `asilum:audio-claimed`.

import { useSyncExternalStore } from "react";
import { circleFor, blendMs } from "./index.js";

const subs = new Set();
let state = { source: null, state: "ended", position: 0, duration: 0, color: null, previousColor: null, changedAt: 0 };
let element = null;
const emit = () => { for (const fn of subs) fn(); };
export function getPlayer() { return state; }
export function subscribePlayer(fn) { subs.add(fn); return () => subs.delete(fn); }
const server = () => state;
export function usePlayer() { return useSyncExternalStore(subscribePlayer, getPlayer, server); }

/** MusicHost hands over its element once. */
export function attachElement(el) {
  element = el;
  if (!el) return;
  const sync = () => {
    if (!state.source) return;
    const s = el.ended ? "ended" : el.paused ? "paused" : el.readyState < 3 && !el.paused ? "loading" : "playing";
    if (s !== state.state || Math.abs(el.currentTime - state.position) > 0.25) { state = { ...state, state: s, position: el.currentTime, duration: el.duration || 0 }; emit(); }
  };
  for (const ev of ["play", "playing", "pause", "waiting", "ended", "timeupdate", "loadedmetadata"]) el.addEventListener(ev, sync);
}

/** Keep a MOTION's audio playing while the visuals stop (3.14): the housing
 *  calls this with the media's URL and the exact second. */
export async function takeAudio({ kind = "motion", postId, sample = false, src, at = 0, title = "", by = "", color = null }) {
  if (!element || !src) return false;
  const next = { kind, postId, sample, src, title, by, color, identified: false };
  const prevColor = state.color;
  state = { ...state, source: next, state: "loading", previousColor: prevColor, color, changedAt: Date.now(), position: at };
  emit();
  try {
    if (element.src !== src) element.src = src;
    element.currentTime = at;
    element.muted = false;
    await element.play();
    window.dispatchEvent(new CustomEvent("asilum:audio-claimed", { detail: { postId, kind } }));
    return true;
  } catch {
    state = { ...state, source: null, state: "ended" }; emit();
    return false;
  }
}
export function playAudio() { if (element && state.source) element.play().catch(() => {}); }
export function pauseAudio() { if (element) element.pause(); }
export function toggleAudio() { if (!element || !state.source) return; if (element.paused) playAudio(); else pauseAudio(); }
/** Ending a session (3.23): the source leaves; the circle fades over the blend. */
export function stopAudio() {
  if (element) { element.pause(); try { element.removeAttribute("src"); element.load(); } catch {} }
  state = { ...state, source: null, state: "ended", changedAt: Date.now() }; emit();
}
/** The frame's colour, interpolated by CSS over the blend (3.22). */
export function setSourceColor(color) {
  if (!state.source || !color || color === state.color) return;
  state = { ...state, previousColor: state.color, color, source: { ...state.source, color }, changedAt: Date.now() }; emit();
}
export function currentPosition() { return element ? element.currentTime : state.position; }
export function circle() { return circleFor(state); }
export const BLEND = blendMs();
