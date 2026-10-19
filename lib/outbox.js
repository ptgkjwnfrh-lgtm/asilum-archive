// lib/outbox.js — OFFLINE-FIRST WRITES (V.2 Blueprint, owner, 17 Oct 2026,
// chapter 1 "offline-first, queued actions, conflict merge"; slice 10d).
// Client-only. A write that cannot reach the server — the device is offline,
// or the network fails — is queued here with the operation id it already
// carries, and replayed in order when the device is back. The server's
// operation ledger (processed_operations) makes a replay safe: the same id
// twice is one write. What is queued is honest about it: the caller gets a
// response marked `queued`, never a pretend success from the server.
//
// Conflict merge: writes are idempotent by operation id and by their own
// semantics (a follow is a set, an interaction is an event); the LAST write
// for the same subject wins on replay because the queue keeps its order. A
// write the server refuses with a 4xx (other than 429) is dropped and
// counted — it was wrong, and waiting will not make it right.

export const OUTBOX_KEY = "asilum-outbox";
export const OUTBOX_MAX = 200;
export const OUTBOX_EVENT = "asilum:outbox";

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

export function readOutbox() {
  if (!canStore()) return [];
  try { const v = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

function writeOutbox(list) {
  if (!canStore()) return;
  try { window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX))); } catch {}
  try { window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { count: list.length } })); } catch {}
}

/** Queue a write. Returns the entry. */
export function enqueue({ url, payload, method = "POST" }) {
  const entry = { id: payload && payload.operationId ? String(payload.operationId) : `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, url, method, payload, at: new Date().toISOString(), tries: 0 };
  const list = readOutbox();
  const at = list.findIndex((e) => e.id === entry.id);
  // the same operation id is one write: the newer payload keeps the older place in line
  if (at >= 0) list[at] = { ...entry, at: list[at].at }; else list.push(entry);
  writeOutbox(list);
  return entry;
}

export function outboxCount() { return readOutbox().length; }

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A synthetic Response for a queued write: ok, and honest about being queued. */
export function queuedResponse(entry) {
  const body = JSON.stringify({ queued: true, operationId: entry.id, note: "offline — queued on this device and sent when the connection returns" });
  return new Response(body, { status: 202, headers: { "content-type": "application/json", "x-asilum-queued": "1" } });
}

let flushing = false;
/**
 * Replay the queue in order through `send(entry)` → Response. Stops at the
 * first network failure (still offline); drops a 4xx other than 429; keeps a
 * 5xx/429 for the next pass. Returns { sent, dropped, kept }.
 */
export async function flushOutbox(send) {
  if (flushing || isOffline()) return { sent: 0, dropped: 0, kept: readOutbox().length };
  flushing = true;
  const out = { sent: 0, dropped: 0, kept: 0 };
  try {
    let list = readOutbox();
    while (list.length) {
      const entry = list[0];
      let res;
      try { res = await send(entry); } catch { break; } // the network is still not there: keep everything
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        if (res.ok) out.sent++; else out.dropped++;
        list = list.slice(1); writeOutbox(list);
      } else { entry.tries = (entry.tries || 0) + 1; writeOutbox(list); break; }
    }
    out.kept = readOutbox().length;
  } finally { flushing = false; }
  return out;
}

/** Wire the replay to the browser's own signals once per page. */
let wired = false;
export function watchOutbox(send) {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const go = () => { flushOutbox(send).catch(() => {}); };
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") go(); });
  setTimeout(go, 1500);
}
