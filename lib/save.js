// lib/save.js — ONE SAVE (Live Launch V.2, owner brief 17 Sep 2026).
//
// Before V.2 there were seven ways to keep something and no single place that
// listed what you kept: a piece went to a moodboard (server), a transmission
// bumped a counter (server, unlistable), a favourite steered the feed
// (unlistable), the bag was intent, follows were follows. This module is the
// one verb the whole interface uses — SAVE — over ONE device-local record,
// with the durable server paths kept underneath it where they exist:
//
//   piece  → still lands on the default moodboard (POST /api/boards), because
//            that is the save that teaches the brain and builds the graph;
//   post   → still counts on the transmission (toggleEngagement "save") when
//            the reader is a signed-in account;
//   person / place / event / article → device-local only. No server table
//            holds these yet; the Passport says so where it lists them.
//
// The record is what the Passport COLLECTION reads. It is a MIRROR of the
// server saves plus the home of the device-only ones — never a second truth
// for pieces. Sign-in adoption of the local record is a production gap and is
// listed as one in docs/history/live-launch-v2-2026-09-17.md.

import { postJSON, sendJSON, getUid } from "./client.js";
import { toggleEngagement } from "./social.js";

const SAVES_KEY = "asilum-saves";
const SAVES_FIRST_KEY = "asilum-first-save";
const SAVES_MAX = 400;

// V.2 §11: the Passport's Add-stamp housing adds artists, designers and houses
export const SAVE_KINDS = Object.freeze(["piece", "post", "person", "place", "event", "article", "artist", "designer", "house"]);

function read() {
  try {
    const raw = window.localStorage.getItem(SAVES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && s.kind && s.id) : [];
  } catch { return []; }
}
function write(list) {
  try { window.localStorage.setItem(SAVES_KEY, JSON.stringify(list.slice(0, SAVES_MAX))); } catch {}
}
function emit(kind, id, on) {
  try { window.dispatchEvent(new CustomEvent("asilum:save", { detail: { kind, id, on } })); } catch {}
}

/** Everything saved on this device, newest first. */
export function listSaves(kind = null) {
  const all = read();
  return kind ? all.filter((s) => s.kind === kind) : all;
}

export function isSaved(kind, id) {
  return read().some((s) => s.kind === kind && String(s.id) === String(id));
}

/** Normalize what a surface hands us into the one record shape. */
export function saveRecord({ kind, id, title, image = "", href = "", meta = "", tags = [], item = null }) {
  if (!SAVE_KINDS.includes(kind)) throw new Error("unknown save kind: " + kind);
  if (!id || !title) throw new Error("a save needs an id and a title");
  return {
    kind, id: String(id), title: String(title).slice(0, 200),
    image: String(image || "").slice(0, 2048), href: String(href || "").slice(0, 512),
    meta: String(meta || "").slice(0, 200),
    tags: Array.isArray(tags) ? tags.slice(0, 10).map(String) : [],
    item: item && kind === "piece" ? { id: item.id, title: item.title, brand: item.brand, price: item.price, currency: item.currency, img: item.img, tags: item.tags, url: item.url, source: item.source } : null,
    at: new Date().toISOString(),
  };
}

/**
 * Save one object. Resolves `{ ok, first }` — `first` is true the very first
 * time this device saves anything, which is the moment the shell offers an
 * account (the brief: "prompt account creation after a meaningful action such
 * as the first save", never before).
 */
export async function saveObject(input) {
  const rec = saveRecord(input);
  const uid = getUid();
  let boardId = null;
  if (rec.kind === "piece" && input.item) {
    try {
      const r = await postJSON("/api/boards", { user: uid, item: input.item });
      if (r && r.ok) { const d = await r.json().catch(() => null); boardId = d && d.board ? d.board.id : null; }
    } catch {}
  }
  if (rec.kind === "post" && uid && uid.startsWith("sb-")) {
    try { await toggleEngagement(rec.id, "save", true); } catch {}
  }
  const list = read().filter((s) => !(s.kind === rec.kind && s.id === rec.id));
  list.unshift({ ...rec, boardId });
  write(list);
  emit(rec.kind, rec.id, true);
  // THE RECORD IS REAL (v53): people, places, events and articles mirror to
  // /api/records so they survive this browser and follow a sign-in. Pieces
  // already live on the moodboard and posts on the wire; the device copy
  // stays the fast path either way, so a failed mirror never blocks a save.
  if (rec.kind !== "piece" && rec.kind !== "post") {
    try { await sendJSON("PUT", "/api/records", { user: uid, kind: "save", recordId: `${rec.kind}:${rec.id}`, payload: { ...rec, boardId } }); } catch {}
  }
  let first = false;
  try {
    if (!window.localStorage.getItem(SAVES_FIRST_KEY)) {
      window.localStorage.setItem(SAVES_FIRST_KEY, rec.at);
      first = true;
      window.dispatchEvent(new CustomEvent("asilum:first-save", { detail: { kind: rec.kind } }));
    }
  } catch {}
  return { ok: true, first };
}

/** Take one object back out. A piece leaves its moodboard too when the save
 *  recorded which board it landed on. */
export async function unsave(kind, id) {
  const uid = getUid();
  const list = read();
  const rec = list.find((s) => s.kind === kind && String(s.id) === String(id));
  write(list.filter((s) => !(s.kind === kind && String(s.id) === String(id))));
  if (rec && rec.kind === "piece" && rec.boardId) {
    try { await sendJSON("DELETE", "/api/boards", { user: uid, boardId: rec.boardId, itemId: rec.id }); } catch {}
  }
  if (rec && rec.kind === "post" && uid && uid.startsWith("sb-")) {
    try { await toggleEngagement(rec.id, "save", false); } catch {}
  }
  if (rec && rec.kind !== "piece" && rec.kind !== "post") {
    try { await sendJSON("DELETE", "/api/records", { user: uid, kind: "save", recordId: `${rec.kind}:${rec.id}` }); } catch {}
  }
  emit(kind, String(id), false);
  return { ok: true };
}

/** Toggle helper for buttons. */
export async function toggleSave(input) {
  if (isSaved(input.kind, input.id)) { await unsave(input.kind, input.id); return { on: false }; }
  const r = await saveObject(input);
  return { on: true, first: r.first };
}

/** Counts per kind — the Passport's ledger line. */
export function saveCounts() {
  const out = {};
  for (const k of SAVE_KINDS) out[k] = 0;
  for (const s of read()) if (out[s.kind] !== undefined) out[s.kind]++;
  out.total = read().length;
  return out;
}

/** Wipe the device record (SETTINGS → delete personalization). */
export function clearSaves() {
  try { window.localStorage.removeItem(SAVES_KEY); window.localStorage.removeItem(SAVES_FIRST_KEY); } catch {}
  emit("*", "*", false);
}
