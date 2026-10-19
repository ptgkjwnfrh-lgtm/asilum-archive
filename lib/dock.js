// lib/dock.js — THE CENTRAL CONTROL DECK as DATA (V.2 Blueprint, owner,
// 17 Oct 2026, Foundations "Screen map"; the 1 Oct brief §1 where the
// blueprint is silent).
//
// The deck stays centred at the bottom above the safe area. Five keys, in
// this order: FEED · SEARCH · POST · MESSAGES · ACCOUNT. FEED and ACCOUNT
// are routes (lib/nav.js); SEARCH is a MODE of the deck — the scoped field
// takes the row and the keys shrink but their targets do not; POST is the
// center disc (the composer today; the session dial inside a popup from
// slice 2); MESSAGES is the mail desk. The ad ticker is a separate,
// stable-height part of the same dock: changing modes never resizes it or
// resets it.
//
// The Info Dock (top left) carries the utilities — LIKES, BAG, NOTICES —
// and the Passport Button (top right) carries the globe. A utility is a
// sheet, never a route.
//
// Search mode opens when Search is tapped, or on entering Map, Messages or
// Likes — and it never opens the keyboard by itself. The scope is shown
// prominently and is never widened silently: "Search all ASILUM" is an
// explicit action, and a private-message search can never reach the whole
// app on its own.
//
// Pure data and pure functions; the shell, the sheets and the tests read
// the same table.

/** The five keys of the Central Control Deck, in deck order. `kind` says
 *  what a key does: a route, the search mode, the center disc, or a sheet.
 *  The two routes resolve through lib/nav.js deckFor(kind), so a business
 *  sees ANALYTICS where a passenger sees ACCOUNT. */
export const DECK = Object.freeze([
  { id: "feed", icon: "feed", label: "FEED", kind: "route" },
  { id: "search", icon: "search", label: "SEARCH", kind: "mode" },
  { id: "post", icon: "post", label: "POST", kind: "disc" },
  { id: "messages", icon: "messages", label: "MESSAGES", kind: "sheet" },
  { id: "account", icon: "account", label: "ACCOUNT", kind: "route" },
]);

/** What the ad ticker carries when nothing eligible exists (owner order,
 *  17 Aug — the house lines; the spacing in "A S I L U M" is the owner's and
 *  is deliberate; do not close it up). They used to run in the header's
 *  marquee; the header is gone (blueprint) and the ticker under the deck
 *  carries them instead. */
export const HOUSE_LINES = Object.freeze([
  "ARE YOU SEEKING A S I L U M",
  "DISCOVERY - COMMERCE - COMMUNITY",
  "DISCOVER FROM ARCHIVES ACROSS THE WORLD",
]);

/** The Info Dock's utilities, in the order the blueprint's fixture sketch
 *  draws them (Figure 19: heart, bag, bell). Each is a sheet, never a route
 *  of its own — a utility is an action, not a tab. */
export const UTILITIES = Object.freeze([
  { id: "likes", icon: "heart", label: "LIKES" },
  { id: "bag", icon: "bag", label: "BAG" },
  { id: "notices", icon: "bell", label: "NOTICES" },
]);

/** Search scopes and the exact placeholder each shows. The brief's list,
 *  verbatim. `wide` is whether "Search all ASILUM" is offered as the way
 *  out of the scope. */
export const SEARCH_SCOPES = Object.freeze({
  global: { id: "global", placeholder: "Search ASILUM", wide: false },
  map: { id: "map", placeholder: "Search places and events", wide: true },
  messages: { id: "messages", placeholder: "Search your messages", wide: true },
  "likes-pieces": { id: "likes-pieces", placeholder: "Search liked pieces", wide: true },
  "likes-wire": { id: "likes-wire", placeholder: "Search liked posts", wide: true },
  "likes-sold": { id: "likes-sold", placeholder: "Search sold likes", wide: true },
});

/** The scope a surface opens in: entering Map, Messages or Likes selects
 *  that scope; everything else is the global search. `likesTab` is the
 *  Likes sheet's subtab when it is open. */
export function scopeFor({ pathname = "/", sheet = null, likesTab = "pieces" } = {}) {
  if (sheet === "messages") return SEARCH_SCOPES.messages;
  if (sheet === "likes") return SEARCH_SCOPES["likes-" + (["pieces", "wire", "sold"].includes(likesTab) ? likesTab : "pieces")];
  if (String(pathname || "").startsWith("/map")) return SEARCH_SCOPES.map;
  return SEARCH_SCOPES.global;
}

/** The three visible search controls (brief, decision 4): Pieces and Wire
 *  are independent content toggles with at least one on; ASTERISK is the
 *  taste rerank. "Following only" is an audience filter in the drawer, not
 *  a third content type. */
export const SEARCH_TOGGLES = Object.freeze([
  { id: "pieces", label: "PIECES" },
  { id: "wire", label: "POSTS" },
  { id: "asterisk", label: "ASTERISK" },
]);

/** Flip a content toggle, refusing to turn the last content type off. */
export function toggleContent(state, id) {
  const next = { ...state, [id]: !state[id] };
  if (id !== "asterisk" && !next.pieces && !next.wire) return state;
  return next;
}

// ---- Session law ----------------------------------------------------------
// "Every fresh app launch starts on The Feed" — even when the last session
// ended on Front Cover, Map, Wire or Account. Within a session, switching
// tabs preserves each tab's position and filters; a brief background/
// foreground transition resumes the session and never resets it. For a web
// app a URL opened from outside IS a deep link: the Feed is the base
// destination beneath it and Back leads there. What the law forbids is the
// app itself restoring a last-visited tab — it never does, so nothing here
// remembers one. (A PWA launch opens the manifest's start_url, "/".)

export const SESSION_KEY = "asilum-session";

/** Where a fresh launch goes. */
export const LAUNCH_PATH = "/";

/** The base destination beneath a deep link: the Feed, unless the link is
 *  itself the Feed. Used by sheets' Back and by the ◀ in a detail. */
export function baseFor(pathname) {
  return "/";
}

/** The view-state key for a surface (brief §2): viewer + route + subtab +
 *  normalised query + filters. Order and casing are fixed so the same view
 *  always lands on the same key. */
export function stateKey({ viewer = "anon", route = "/", subtab = "", query = "", filters = {} } = {}) {
  const q = String(query || "").trim().toLowerCase().replace(/\s+/g, " ");
  const f = Object.keys(filters || {}).sort().map((k) => `${k}=${String(filters[k])}`).join("&");
  return [String(viewer || "anon"), String(route || "/"), String(subtab || ""), q, f].join("|");
}

/** The map's three tools (brief §11): Stamp opens the personal Passport,
 *  Connect opens permitted passenger discovery, Discover opens the cultural
 *  directory. Visible labels, always — the sketch's icons alone are not
 *  enough (brief: "every symbol that is not obvious needs a readable
 *  label"). */
export const MAP_TOOLS = Object.freeze([
  { id: "stamp", icon: "stamp", label: "STAMP", hint: "your passport" },
  { id: "connect", icon: "link", label: "CONNECT", hint: "passengers" },
  { id: "discover", icon: "glasses", label: "DISCOVER", hint: "the directory" },
]);
