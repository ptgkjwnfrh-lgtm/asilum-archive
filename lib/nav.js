// lib/nav.js
// THE DESTINATIONS, as DATA (V.2 Blueprint, owner, 17 Oct 2026 —
// Foundations, "Central Control Deck" and "Screen map"). Extracted from the
// shell so what a passenger can reach is tested without mounting React.
//
// The blueprint supersedes the 1 October brief's four tabs. Three
// destinations remain, in two kinds of fixture:
//
//   deck     THE FEED and ACCOUNT are keys on the Central Control Deck,
//            beside SEARCH (a mode), POST (the center disc) and MESSAGES
//            (the mail desk) — those three live in lib/dock.js, since they
//            are actions and sheets, not routes.
//   fixture  PASSPORT is the globe at the top right (the Passport Button).
//            It is a destination with a route, but it is not a deck key.
//
// FRONT COVER is no longer a tab: the cover is a page under THE FEED (the
// Hot List and the placements), reached from the Feed and the ticker. MAP is
// no longer a root of its own: it is the Passport's map. Likes, Bag and
// Notices are the Info Dock's utilities (lib/dock.js), never tabs.
//
// Driven by lib/accounts.js, which the server-side route guard also reads.
// One table, two readers, no way for them to disagree.

import { can } from "./accounts.js";

const NAV = [
  { href: "/", icon: "feed", label: "FEED", meta: "THE ONE FEED", deck: true,
    match: (p) => p === "/" || p.startsWith("/hotlist") || p.startsWith("/cover") || p.startsWith("/u/") || p.startsWith("/piece") || p.startsWith("/discover") || p.startsWith("/stylist") },
  { href: "/board", icon: "globe", label: "PASSPORT", meta: "STAMPS · MAP · TASTE", fixture: "passport",
    match: (p) => p.startsWith("/board") || p.startsWith("/map") || p.startsWith("/stats") || p.startsWith("/upload") || p.startsWith("/asterisk") },
  { href: "/profile", icon: "account", label: "ACCOUNT", meta: "WARDROBE · STOREFRONT · SETTINGS", deck: true,
    match: (p) => p.startsWith("/profile") || p.startsWith("/store") || p.startsWith("/orders") || p.startsWith("/settings") || p.startsWith("/analytics") || p.startsWith("/watchtower") },
];

// The account's rooms — the same for every kind. PROFILE is the public
// record, ORDERS the ledger, SETTINGS the rack. None of these are keys; they
// are rooms inside ACCOUNT.
export const ACCOUNT_MENU = [
  { href: "/profile", label: "PROFILE", meta: "PUBLIC RECORD" },
  { href: "/orders", label: "ORDERS", meta: "TICKETS + RECEIPTS" },
  { href: "/settings", label: "SETTINGS", meta: "CONTROL PANEL" },
];

// A business trades one key for another. It is a SWAP, not a subtraction:
// the deck keeps its five keys in the same order, so the shape of the OS is
// the same building whichever door you came through — the fifth key simply
// says something else.
//
// ACCOUNT → ANALYTICS (what happened at this storefront), with WATCH TOWER
// (what the catalog's readers want) as its sub-link.
const BUSINESS_NAV = {
  "/profile": {
    href: "/analytics", icon: "ledger", label: "ANALYTICS", meta: "THE LEDGER · WATCH TOWER", deck: true,
    match: (p) => p.startsWith("/analytics") || p.startsWith("/watchtower") || p.startsWith("/profile") || p.startsWith("/store") || p.startsWith("/orders") || p.startsWith("/settings"),
    sub: [{ href: "/watchtower", label: "WATCH TOWER" }],
  },
};

/**
 * The destinations for this kind. Driven by the same capability table the
 * route guard reads, so the nav cannot offer a door the guard closes — a
 * hidden link over a live URL is an unguarded feature, not a hidden one.
 */
export function navFor(kind) {
  return NAV.filter((entry) => {
    // the passport fixture is a door the guard closes to a business: a kind
    // that cannot reach /board is not offered it anywhere
    if (entry.fixture === "passport") return can(kind, "passport");
    return true;
  }).map((entry) => {
    const swap = BUSINESS_NAV[entry.href];
    if (!swap) return entry;
    // Swap when the kind cannot reach the original and CAN reach the
    // replacement. Both halves are checked so a capability table edit that
    // opens neither leaves the reader with the passport default rather than a
    // dead key.
    if (!can(kind, "passport") && can(kind, "analytics")) return swap;
    return entry;
  });
}

/** The destinations that are deck keys, in deck order: FEED first, ACCOUNT
 *  (or ANALYTICS) last. The deck itself (lib/dock.js DECK) places SEARCH,
 *  POST and MESSAGES between them. */
export function deckFor(kind) {
  return navFor(kind).filter((n) => n.deck);
}

/** The destination behind a fixture (today only "passport", the globe), or
 *  null when this kind cannot reach it — a business has no passport, so it
 *  has no globe. */
export function fixtureFor(kind, fixture) {
  return navFor(kind).find((n) => n.fixture === fixture) || null;
}

/** The destination that owns a path, or null. Used by the deck's lamp; a
 *  path no destination claims (the fine print, /checkout, /admin) lights
 *  nothing. */
export function currentDestination(kind, pathname) {
  return navFor(kind).find((n) => n.match(pathname || "/")) || null;
}
