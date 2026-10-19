// lib/feed/actions.js — what a card can do to a piece, from anywhere (V.2
// slice 3: the LISTING popup lives in the session hub, outside the feed
// page, so the page's closures cannot be its handlers). Client-safe.
//
// Every action is the same /api/interaction call the feed page always made
// (bag | share | save | favorite | dwell | skip | hide | open — the route's
// own list); the page listens for `asilum:piece` to keep its list honest
// (a skipped piece leaves the stream, a favourite pulls neighbours in).

import { getUid, postJSON, bagAdd } from "../client.js";

export const PIECE_EVENT = "asilum:piece";

function announce(item, action, ok) {
  try { window.dispatchEvent(new CustomEvent(PIECE_EVENT, { detail: { id: item && item.id, action, ok: !!ok } })); } catch {}
}

/** Record an interaction. Resolves to the fetch response (or null). */
export async function interact(item, action, extra = {}) {
  if (!item || !item.id) return null;
  try {
    // an interaction is an event with its own operation id: safe to queue offline (lib/outbox.js)
    const res = await postJSON("/api/interaction", { user: getUid(), item, action, ...extra }, { outbox: true });
    announce(item, action, res && res.ok);
    return res;
  } catch {
    announce(item, action, false);
    return null;
  }
}

export function favorite(item) { return interact(item, "favorite"); }
export function pass(item) { return interact(item, "skip"); }
export function opened(item) { return interact(item, "open"); }

/** The bag is on the device first; the server counts it once it has it. */
export function bag(item) {
  bagAdd(item);
  return interact(item, "bag");
}

/** /piece/<id> carries the piece's own link preview. */
export async function share(item) {
  const url = window.location.origin + "/piece/" + encodeURIComponent(item.id);
  let shared = false;
  try {
    if (navigator.share) { await navigator.share({ url, title: [item.brand, item.title].filter(Boolean).join(" — ") }); shared = true; }
    else { await navigator.clipboard.writeText(url); shared = true; }
  } catch {}
  interact(item, "share");
  return shared;
}
