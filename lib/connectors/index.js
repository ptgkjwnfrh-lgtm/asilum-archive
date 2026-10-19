// lib/connectors/index.js — THE CONNECTOR REGISTRY (V.2 brief §11, §13).
// Client-safe for the capability table; the status reader consults the
// environment and is called on the server.
//
// RULES (constitution + the brief): opt-in and permission-based only, real
// OAuth only, env vars only, no scraping, nothing pretends to be connected.
// An account connection is NOT blanket permission to train ASTERISK or
// ingest everything: every connector lists its approved CAPABILITIES with
// a basis, and the uses it must never be put to.
//
// Each connector reports ONE of six explicit states, as the brief names them:
//   available          the capability works here, with the approved scopes
//   requires-approval  a partner/API application or written approval is open
//   unsupported        the API does not expose this (and we will not fake it)
//   disconnected       approved and configured, but this account has not
//                      connected it (OAuth never started, or revoked)
//   syncing            a sync is running for this account
//   error              the last sync or token refresh failed
// Per capability, because one provider is three different answers: eBay's
// Browse is available where the keys and the partnership are, its Order API
// requires a separate approval, and "all your historical purchases" is
// unsupported from any key. Spotify's display/link is a separate thing from
// profiling, which is BLOCKED by its Developer Policy (RIGHTS-REGISTER); the
// manual artist stamp uses ASILUM's own curated mapping and no Spotify data.
//
// No OAuth flow exists yet for any provider. The registry is therefore the
// honest front: every "connect" answers with the capability's state and the
// sentence beside it, never a token exchange that cannot happen.

const envReady = (vars) => vars.every((v) => !!process.env[v]);

export const CONNECTOR_STATES = Object.freeze(["available", "requires-approval", "unsupported", "disconnected", "syncing", "error"]);

export const CONNECTORS = Object.freeze({
  spotify: {
    id: "spotify", label: "Spotify", kind: "music",
    envVars: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
    basis: "RIGHTS-REGISTER: Developer Policy forbids analysis / profiling / ML use of content; OWNER-DECISIONS §7 default = manual-only",
    capabilities: {
      "artist-stamps": { state: "available", scopes: [], basis: "manual: you choose an artist; ASILUM's own curated artist→taste mapping (lib/music-mapping); no Spotify data is read", trains: true },
      "display-link": { state: "requires-approval", scopes: ["user-read-private"], basis: "an allowed display/link integration needs the OAuth app approved first", trains: false },
      "playback": { state: "requires-approval", scopes: ["streaming", "user-read-playback-state"], basis: "embedded playback (4.13) rides the Web Playback SDK on a Premium account through the same approved app; until then a song opens in the streaming app", trains: false },
      "catalog-search": { state: "requires-approval", scopes: [], basis: "attaching catalog music to a post (4.14) needs the approved app's client credentials; no key is set", trains: false },
      "taste-import": { state: "unsupported", scopes: [], basis: "listening history → ASTERISK profiling is forbidden by the Developer Policy without a written agreement; not offered", trains: false },
    },
    never: ["AI ingestion of Spotify content", "user profiling from listening data", "ad targeting"],
  },
  "apple-music": {
    id: "apple-music", label: "Apple Music", kind: "music",
    envVars: ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"],
    basis: "MusicKit needs a developer token signed with an Apple Developer key and a user token from the passenger; its terms are NOT YET EXAMINED by the rights register (docs/v2/BLUEPRINT-GAP §4) — nothing is offered until they are",
    capabilities: {
      "playback": { state: "requires-approval", scopes: ["music-user-token"], basis: "MusicKit JS embedded playback for subscribers; unexamined terms, no key", trains: false },
      "library-sync": { state: "requires-approval", scopes: ["music-user-token"], basis: "liking to the library (4.1) and the optional import (4.10); unexamined terms, no key", trains: false },
      "catalog-search": { state: "requires-approval", scopes: [], basis: "the catalog behind a post's music search (4.14); unexamined terms, no key", trains: false },
    },
    never: ["taste profiling from a library without an examined agreement"],
  },
  pinterest: {
    id: "pinterest", label: "Pinterest", kind: "visual",
    envVars: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
    basis: "approved boards/pins/scopes and reuse permissions only",
    capabilities: {
      "board-import": { state: "requires-approval", scopes: ["boards:read", "pins:read"], basis: "the OAuth app and the reuse permission must be approved; only boards you pick are read", trains: true },
      "browsing-history": { state: "unsupported", scopes: [], basis: "no API exposes browsing history; never promised", trains: false },
    },
    never: ["browsing history", "boards you did not pick"],
  },
  tiktok: {
    id: "tiktok", label: "TikTok", kind: "video",
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    basis: "RIGHTS-REGISTER: Research API ≠ commercial personalisation; Display API = approved public profile/videos only",
    capabilities: {
      "public-profile": { state: "requires-approval", scopes: ["user.info.basic", "video.list"], basis: "Display API, after app approval: your public profile and your own public videos", trains: false },
      "liked-history": { state: "unsupported", scopes: [], basis: "the Display API does not expose liked / For You history; portability is a separate eligibility path", trains: false },
      "dm-import": { state: "unsupported", scopes: [], basis: "third-party private messages are never imported into taste training", trains: false },
    },
    never: ["liked or For You history", "private DMs", "trend ingestion for personalisation"],
  },
  letterboxd: {
    id: "letterboxd", label: "Letterboxd", kind: "film",
    envVars: ["LETTERBOXD_CLIENT_ID", "LETTERBOXD_CLIENT_SECRET"],
    basis: "API access is by application",
    capabilities: {
      "film-stamps": { state: "available", scopes: [], basis: "manual: you name a film or a director as a stamp; no Letterboxd data is read", trains: true },
      "diary-import": { state: "requires-approval", scopes: ["diary:read"], basis: "needs Letterboxd's API approval; an authorised export you upload yourself may come first where their terms allow", trains: true },
    },
    never: ["scraping a public diary"],
  },
  ebay: {
    id: "ebay", label: "eBay", kind: "marketplace",
    envVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    basis: "Browse API under the partnership; Order / purchase history is a SEPARATE approval; the API License forbids training on eBay content",
    capabilities: {
      "browse": { state: "env", scopes: [], basis: "lib/ingest/ebay.js — live where the keys and EBAY_PARTNERSHIP_APPROVED=1 are set", trains: false },
      "purchase-history": { state: "requires-approval", scopes: ["sell.fulfillment", "buy.order"], basis: "the Order API needs its own approval; Browse access does not grant it", trains: false },
      "all-historical-purchases": { state: "unsupported", scopes: [], basis: "no key exposes every historical purchase; never implied", trains: false },
      "checkout": { state: "requires-approval", scopes: [], basis: "verified separately from Browse", trains: false },
    },
    never: ["training ASTERISK on eBay content (API License, Prohibited AI Uses)"],
  },
  shopify: {
    id: "shopify", label: "Shopify", kind: "storefront",
    envVars: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STOREFRONT_TOKEN"],
    basis: "independent designer stores → catalog ingest; the Storefront token is the store's, not a buyer's",
    capabilities: {
      "store-catalog": { state: "env", scopes: [], basis: "live where a store's Storefront token is configured", trains: false },
      "buyer-history": { state: "requires-approval", scopes: ["read_orders"], basis: "a partner app with review", trains: false },
    },
    never: [],
  },
});

/** Resolve a capability's state for THIS deployment and account. Server-side (env). */
export function capabilityState(connector, capId, { account = null, connected = [] } = {}) {
  const c = CONNECTORS[connector];
  const cap = c && c.capabilities[capId];
  if (!cap) return "unsupported";
  if (cap.state !== "env") return cap.state;
  const configured = envReady(c.envVars) && (c.id !== "ebay" || process.env.EBAY_PARTNERSHIP_APPROVED === "1");
  if (!configured) return "requires-approval";
  // configured for the deployment; an ACCOUNT connection is a separate fact —
  // the music seams (lib/connectors/oauth.js, /api/connect/oauth) can make one,
  // and a stored connection reads available for that account
  if (!account) return "available";
  return (connected || []).includes(c.id) ? "available" : "disconnected";
}

/** The registry, resolved: what every connector can do here, and what it never does. */
export function connectorRegistry({ account = null, connected = [] } = {}) {
  return Object.values(CONNECTORS).map((c) => ({
    id: c.id, label: c.label, kind: c.kind, basis: c.basis, never: c.never,
    configured: envReady(c.envVars),
    connected: (connected || []).includes(c.id),
    // the music seams have a real flow: /api/connect/oauth (Spotify PKCE; the MusicKit developer token)
    flow: c.kind === "music" ? "/api/connect/oauth?platform=" + c.id : null,
    capabilities: Object.entries(c.capabilities).map(([id, cap]) => ({
      id, state: capabilityState(c.id, id, { account, connected }), scopes: cap.scopes, basis: cap.basis, trains: cap.trains,
    })),
  }));
}

/** Honest per-connector status for the admin desk (kept for its callers). */
export function connectorStatus() {
  return Object.values(CONNECTORS).map((c) => ({
    id: c.id, kind: c.kind, configured: envReady(c.envVars), note: c.basis,
  }));
}

/** The sentence a "connect" attempt gets back, by capability state. */
export function connectSentence(connectorId, capId, state) {
  const c = CONNECTORS[connectorId];
  const cap = c && c.capabilities[capId];
  const name = c ? c.label : connectorId;
  switch (state) {
    case "available": return `${name} ${capId} is available here — ${cap.basis}.`;
    case "requires-approval": return `${name} ${capId} requires approval — ${cap.basis}.`;
    case "unsupported": return `${name} ${capId} is unsupported — ${cap.basis}.`;
    case "disconnected": return c.kind === "music" ? `${name} ${capId} is configured here; connect your account from Settings → Connections.` : `${name} ${capId} is configured here but your account is not connected; no flow exists for this provider yet.`;
    case "syncing": return `${name} ${capId} is syncing.`;
    case "error": return `${name} ${capId} hit an error on the last sync.`;
    default: return `${name}: unknown capability.`;
  }
}
