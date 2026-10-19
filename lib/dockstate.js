// lib/dockstate.js — the control deck's live state, shared by the deck,
// the fixtures, the sheets and the roots without a React context (the
// shell mounts them as siblings of every page, so a context would have to
// wrap the whole app for one object). A module store with
// subscribe/snapshot for useSyncExternalStore; plain functions for
// everyone else. Client-only; on the server it is inert.
//
// What it holds (V.2 Blueprint, chapters 1 and 2; the 1 Oct brief §1–2
// where the blueprint is silent): the deck MODE (base | search), the scoped
// QUERY, the three search TOGGLES, the Likes subtab, and THE HUB — the
// universal session hub of lib/sessions.js, which owns every popup and its
// history. `sheet` is DERIVED from the hub: the popup on top of the active
// session, when one is up. Nothing else here is persisted; the hub is
// (blueprint 1.9: sessions survive restarts), on this device, under
// SESSIONS_KEY. Cross-device synchronisation of the hub (1.18, 1.19) needs
// a server store and is not pretended here: the seam is `serialize` /
// `hydrate` in lib/sessions.js.

import { useSyncExternalStore } from "react";
import { toggleContent } from "./dock.js";
import * as S from "./sessions.js";

export const SESSIONS_KEY = "asilum-sessions-v2";
export const PREVIEWS_KEY = "asilum-session-previews";

const state = {
  mode: "base",
  q: "",
  toggles: { pieces: true, wire: true, asterisk: true },
  hub: S.createHub(),
  likesTab: "pieces",
  pins: [],          // tags pinned as filters on the current search (blueprint, Tag grammar: long-press)
  typing: false,     // the reader is typing — the ad strip pauses
  hydrated: false,   // the hub has been read from this device
};

function derivedSheet(hub) {
  const top = S.topView(hub);
  if (!top) return null;
  const s = S.activeSession(hub);
  return { id: top.view, sessionId: s.id, stack: s.stack, top };
}
function build() {
  return { ...state, toggles: { ...state.toggles }, pins: [...state.pins], sheet: derivedSheet(state.hub) };
}
let snapshot = build();
const subs = new Set();
let persistTimer = null;

function persist() {
  if (typeof window === "undefined" || !state.hydrated) return; // never overwrite a hub this device has not read yet
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { window.localStorage.setItem(SESSIONS_KEY, S.serialize(state.hub)); } catch {}
  }, 120);
}

function emit({ save = false } = {}) {
  snapshot = build();
  for (const fn of subs) fn();
  if (save) persist();
}

export function getDock() { return snapshot; }
export function subscribeDock(fn) { subs.add(fn); return () => subs.delete(fn); }
export function useDock() { return useSyncExternalStore(subscribeDock, getDock, getDock); }

/** Read the hub this device saved (1.9, 1.10). Called once, on the client,
 *  after mount — the server and the first paint agree on an empty hub, and
 *  the popup that was up resumes a frame later. */
export function hydrateHub() {
  if (state.hydrated || typeof window === "undefined") return;
  state.hydrated = true;
  let json = null;
  try { json = window.localStorage.getItem(SESSIONS_KEY); } catch {}
  const hub = S.hydrate(json);
  state.hub = hub;
  if (hub.open) {
    const top = S.topView(hub);
    if (top && (top.view === "likes" || top.view === "messages" || top.view === "search")) state.mode = "search";
  }
  emit();
}

/** Whether eligible sensitive previews are revealed in the carousel (1.34). */
export function previewsRevealed() {
  try { return typeof window !== "undefined" && window.localStorage.getItem(PREVIEWS_KEY) === "on"; } catch { return false; }
}

/** Which destination a popup was opened from — the session's origin icon. */
function originNow() {
  try {
    const p = typeof window !== "undefined" ? window.location.pathname : "/";
    if (p.startsWith("/board") || p.startsWith("/map")) return "passport";
    if (p.startsWith("/profile") || p.startsWith("/orders") || p.startsWith("/settings") || p.startsWith("/analytics")) return "account";
    return "feed";
  } catch { return "feed"; }
}

export function setMode(mode) { state.mode = mode === "search" ? "search" : "base"; emit(); }
export function setQuery(q) { state.q = String(q || "").slice(0, 200); emit(); }
export function setTyping(on) { state.typing = !!on; emit(); }
export function flipToggle(id) { state.toggles = toggleContent(state.toggles, id); emit(); }
/** Pin a tag as a filter chip on the current search (long-press). Six at
 *  most; a pin already there is left alone. `tag` is a grammar tag or a
 *  parsed query — anything with `left` and `right`. */
export function pinTag(tag) {
  if (!tag || !tag.left) return;
  const left = String(tag.left).toUpperCase().trim(), right = tag.right ? String(tag.right).toUpperCase().trim() : null;
  const key = left + ":" + (right || "");
  if (state.pins.some((p) => p.key === key) || state.pins.length >= 6) return;
  state.pins = [...state.pins, { key, left, right, text: right ? `${left}: ${right}` : `${left}:` }];
  emit();
}
export function unpinTag(key) { state.pins = state.pins.filter((p) => p.key !== key); emit(); }
export function clearPins() { if (state.pins.length) { state.pins = []; emit(); } }
export function setLikesTab(tab) { state.likesTab = ["pieces", "wire", "sold"].includes(tab) ? tab : "pieces"; emit(); }

/** Open a popup. It extends the active session (1.28) — the previous popup
 *  stays in history (1.1). Entering Likes, Messages or Search also enters
 *  search mode (the brief), without the keyboard. */
export function openSheet(id, props = {}) { hydrateHub();
  state.hub = S.openView(state.hub, id, props, { origin: originNow() });
  if (id === "likes" || id === "messages" || id === "search") state.mode = "search";
  emit({ save: true });
}
/** A detail inside the open popup — Back returns to what was there. */
export function pushSheet(view, props = {}) { hydrateHub();
  state.hub = S.pushView(state.hub, view, props, { origin: originNow() });
  emit({ save: true });
}
export function backSheet() { state.hub = S.back(state.hub); emit({ save: true }); }
/** Dismiss the popup; the session stays in the hub (1.3). */
export function closeSheet() { state.hub = S.dismiss(state.hub); emit({ save: true }); }
/** Leave search mode: the field clears, the popup closes, the keys return. */
export function closeSearch() {
  state.mode = "base"; state.q = ""; state.typing = false; state.pins = [];
  state.hub = S.dismiss(state.hub);
  emit({ save: true });
}

// ---- the hub ---------------------------------------------------------------
export function openHub() { hydrateHub(); state.hub = S.openHub(state.hub); emit(); }
export function closeHub() { state.hub = S.closeHub(state.hub); emit(); }
export function toggleHub() { hydrateHub(); state.hub = state.hub.hubOpen ? S.closeHub(state.hub) : S.openHub(state.hub); emit(); }
export function switchSession(id) {
  state.hub = S.switchSession(state.hub, id);
  const top = S.topView(state.hub);
  state.mode = top && (top.view === "likes" || top.view === "messages" || top.view === "search") ? "search" : "base";
  emit({ save: true });
}
/** A fresh session becomes the active one; the hub stays up (or opens) so
 *  the new blank panel is seen — the next popup belongs to it. */
export function newSession() { hydrateHub();
  const next = S.newSession(state.hub, { origin: originNow() });
  state.hub = next.manager ? next : { ...next, hubOpen: true };
  emit({ save: true });
}
export function closeSession(id) { state.hub = S.closeSession(state.hub, id); emit({ save: true }); }
export function undoClose() { state.hub = S.undoClose(state.hub); emit({ save: true }); }
export function clearUndo() { state.hub = S.clearUndo(state.hub); emit(); }
export function renameSession(id, title) { state.hub = S.renameSession(state.hub, id, title); emit({ save: true }); }
export function closeManager() { state.hub = S.closeManager(state.hub); emit(); }
