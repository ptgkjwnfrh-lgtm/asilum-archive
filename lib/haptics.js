// lib/haptics.js — THE TACTILE VOCABULARY (V.2 Blueprint, owner, 17 Oct
// 2026, clauses 2.1, 2.20, 2.21 and Foundations "Motion and tactility").
// Client-safe; inert on the server and wherever the device has no motor.
//
// One On/Off switch (2.21): Off disables vibration without disabling
// actions or visual press feedback. Browsers vibrate only where the
// platform allows (Android Chrome; iOS Safari never), so every call is a
// courtesy, never a dependency, and the pattern is short.
//
//   tick     a disc snapping to the next item, slow or decaying only
//   press    a compact button
//   confirm  publish, purchase, send
//   error    a refusal
//   toggle   ASTERISK on or off

export const HAPTICS_KEY = "asilum-haptics";

export const PATTERNS = Object.freeze({
  tick: [6],
  press: [10],
  confirm: [12, 40, 12],
  error: [20, 30, 20],
  toggle: [8, 30, 8],
});

export function hapticsEnabled() {
  try {
    if (typeof window === "undefined") return false;
    const v = window.localStorage.getItem(HAPTICS_KEY);
    return v === null ? true : v === "on";
  } catch { return true; }
}

export function setHapticsEnabled(on) {
  try { window.localStorage.setItem(HAPTICS_KEY, on ? "on" : "off"); } catch {}
}

/** Fire a pattern if the setting and the device allow. Returns whether a
 *  vibration was requested. */
export function haptic(name) {
  const pattern = PATTERNS[name];
  if (!pattern) return false;
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    if (!hapticsEnabled()) return false;
    // browsers refuse to vibrate before the page has been touched and log
    // the refusal; a synthetic event never counts, so neither do we
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
    return !!navigator.vibrate(pattern);
  } catch { return false; }
}
