// lib/media/preferences.js — THE MEDIA PREFERENCES, on the device and
// mirrored (V.2 Blueprint 3.3, 3.6, 3.9–3.10; slice 9). CLIENT-ONLY.
//
// The device copy (localStorage) is the fast path every player reads; the
// server copy — user_records kind "media" (v67) — is what makes 3.10's
// "the preference syncs across devices" true for an account: adoption
// carries it to the account, erasure removes it. The mirror is best-effort
// and fire-and-forget, the same shape as lib/location.js.

import { useSyncExternalStore } from "react";
import { MEDIA_PREFERENCES, normalizeMediaPreferences } from "./index.js";

export const MEDIA_PREFS_KEY = "asilum-media";
const subs = new Set();
let snapshot = { ...MEDIA_PREFERENCES };
let loaded = false;

function read() {
  if (typeof window === "undefined") return snapshot;
  if (!loaded) {
    loaded = true;
    try { const raw = window.localStorage.getItem(MEDIA_PREFS_KEY); if (raw) snapshot = normalizeMediaPreferences(JSON.parse(raw)); } catch {}
  }
  return snapshot;
}
export function getMediaPreferences() { return read(); }
export function subscribeMediaPreferences(fn) { subs.add(fn); return () => subs.delete(fn); }
const server = () => MEDIA_PREFERENCES;
export function useMediaPreferences() { return useSyncExternalStore(subscribeMediaPreferences, getMediaPreferences, server); }

/** Set some of the preferences; the rest keep. Mirrors to the record. */
export function setMediaPreferences(patch) {
  snapshot = normalizeMediaPreferences({ ...read(), ...(patch || {}) });
  loaded = true;
  try { window.localStorage.setItem(MEDIA_PREFS_KEY, JSON.stringify(snapshot)); } catch {}
  for (const fn of subs) fn();
  mirror(snapshot);
  return snapshot;
}

/** The account's copy, when there is one, wins a fresh device (3.10). An
 *  account only: a device has no second device to sync with, and asking
 *  before the identity exists would be a 401 for nothing. */
export async function hydrateMediaPreferences() {
  if (typeof window === "undefined") return snapshot;
  try {
    const { getUid } = await import("../client.js");
    if (!String(getUid() || "").startsWith("sb-")) return snapshot;
    const m = await import("../records/client.js");
    const r = await m.listRecords("media");
    const rec = (r.records || []).find((x) => x.recordId === "preferences");
    if (rec && rec.payload && rec.updatedAt) {
      const localAt = Number(window.localStorage.getItem(MEDIA_PREFS_KEY + "-at") || 0);
      if (rec.updatedAt > localAt) {
        snapshot = normalizeMediaPreferences(rec.payload); loaded = true;
        try { window.localStorage.setItem(MEDIA_PREFS_KEY, JSON.stringify(snapshot)); window.localStorage.setItem(MEDIA_PREFS_KEY + "-at", String(rec.updatedAt)); } catch {}
        for (const fn of subs) fn();
      }
    }
  } catch {}
  return snapshot;
}

function mirror(next) {
  if (typeof window === "undefined") return;
  import("../client.js").then((c) => { if (!String(c.getUid() || "").startsWith("sb-")) return;
  try { window.localStorage.setItem(MEDIA_PREFS_KEY + "-at", String(Date.now())); } catch {}
  import("../records/client.js").then((m) => m.putRecord("media", "preferences", next)).catch(() => {}); }).catch(() => {});
}

/** The platform's limits on autoplay, read honestly: reduced motion and the
 *  Save-Data hint exist on the web; Low Power Mode does not (null). */
export function platformLimits() {
  if (typeof window === "undefined") return { reducedMotion: false, saveData: false, lowPower: null };
  let reducedMotion = false, saveData = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  try { saveData = !!(navigator.connection && navigator.connection.saveData); } catch {}
  return { reducedMotion, saveData, lowPower: null };
}
