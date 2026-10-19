// lib/media/feedplay.js — ADAPTIVE AUTOPLAY IN THE FEED (V.2 Blueprint 3.3,
// 3.4, 3.5, 3.10; slice 9). CLIENT-ONLY. One IntersectionObserver over every
// MOTION card: the most visible plays (lib/media/index.js mostVisible),
// the others pause; muted unless the passenger wants audio; captions on
// during muted autoplay; everything pauses when the page hides, when the
// passenger leaves, and while a popup is up (3.4 — the housing itself
// restores the exact timestamp from `positions`).

import { mostVisible, autoplayPolicy, INK_SAMPLE_MS } from "./index.js";
import { getMediaPreferences, platformLimits, subscribeMediaPreferences } from "./preferences.js";

const cards = new Map();      // el -> { id, ratio }
let observer = null;
let popupUp = false;
let hidden = false;
let current = null;

/** Where each MOTION was left (3.4 "resumes from the exact timestamp"). */
export const positions = new Map();   // postId -> seconds

function policy() { return autoplayPolicy({ prefs: getMediaPreferences(), ...platformLimits() }); }

function decide() {
  if (typeof document === "undefined") return;
  const p = policy();
  const want = !p.autoplay || popupUp || hidden ? null : mostVisible([...cards.values()]);
  for (const [el, c] of cards) {
    const play = want != null && c.id === want;
    el.muted = p.muted;
    const tracks = el.textTracks || [];
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = play && p.captions && i === 0 ? "showing" : "hidden";
    if (play) { if (el.paused) el.play().catch(() => {}); current = el; }
    else if (!el.paused) el.pause();
  }
}

function ensure() {
  if (observer || typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
  // the state as it already is: a restored session mounts its popup BEFORE
  // the first card registers, and a card born behind a popup must not play
  // (found in the browser, 18 Oct: the composer restored on load, the sample
  // MOTION played beneath it)
  popupUp = !!document.documentElement.dataset.popup;
  hidden = document.visibilityState !== "visible";
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) { const c = cards.get(e.target); if (c) c.ratio = e.isIntersecting ? e.intersectionRatio : 0; }
    decide();
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  document.addEventListener("visibilitychange", () => { hidden = document.visibilityState !== "visible"; decide(); });
  window.addEventListener("pagehide", () => { hidden = true; decide(); });
  const sync = () => { popupUp = !!document.documentElement.dataset.popup; decide(); };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-popup"] });
  subscribeMediaPreferences(decide);
  try { window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", decide); } catch {}
}

/** Register a MOTION card's <video>; returns the unregister. */
export function registerFeedVideo(el, id) {
  if (!el) return () => {};
  ensure();
  cards.set(el, { id, ratio: 0 });
  if (observer) observer.observe(el);
  const remember = () => { if (el.currentTime > 0) positions.set(String(id), el.currentTime); };
  el.addEventListener("pause", remember);
  el.addEventListener("timeupdate", remember);
  const at = positions.get(String(id));
  if (at > 0 && Number.isFinite(at)) { try { el.currentTime = at; } catch {} }
  return () => {
    remember();
    if (observer) observer.unobserve(el);
    cards.delete(el);
    if (current === el) current = null;
  };
}

export function pauseAllFeedVideos() { for (const [el] of cards) if (!el.paused) el.pause(); }
export function feedPolicy() { return policy(); }
export { INK_SAMPLE_MS };
