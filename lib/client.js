// lib/client.js
// Browser-side helpers: per-device identity, JSON POST, and deterministic
// SVG placeholder thumbnails so the moodboard is visual even for items whose
// sources don't permit image hotlinking.

import { EMPTY_MEASUREMENTS, measurementProfileForBrain } from "./brain/measurements.js";

/**
 * This browser's device id, minted and remembered on first call.
 *
 * A CONVENIENCE, NOT AN AUTHORITY. localStorage is writable by anyone with the
 * console open, so the server never trusts this value — it proves identity from
 * the signed HttpOnly cookie instead (lib/identity.js). Sending it is what lets
 * a route know which id the client THINKS it is; the route may disagree.
 *
 * Returns "guest" when storage is unavailable (private mode, blocked cookies)
 * rather than throwing, so a hostile browser degrades instead of breaking.
 */
export function getUid() {
  if (typeof window === "undefined") return null;
  try {
    let u = window.localStorage.getItem("asilum-uid");
    if (!u) {
      u = "u-" + (window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
      window.localStorage.setItem("asilum-uid", u);
    }
    return u;
  } catch {
    return "guest";
  }
}

/**
 * Record the device id the SERVER issued, and tell the app it changed.
 *
 * The `asilum:identity` event is the mechanism every mounted surface uses to
 * re-read its data after a sign-in or sign-out; it fires only on an actual
 * change, so re-setting the same id is silent. Returns false rather than
 * throwing when storage is unavailable.
 */
export function setUid(uid) {
  if (typeof window === "undefined" || typeof uid !== "string" || !uid) return false;
  try {
    const previous = window.localStorage.getItem("asilum-uid");
    window.localStorage.setItem("asilum-uid", uid);
    if (previous !== uid) {
      window.dispatchEvent(new CustomEvent("asilum:identity", { detail: { uid } }));
    }
    return true;
  } catch { return false; }
}

// The last headers the auth chain produced, for a request that cannot wait
// for it (a beacon on pagehide: the document is going, and the chain crosses
// a task boundary when a session needs refreshing).
let lastAuthHeaders = {};
let authWatched = false;
async function authorizationHeaders() {
  try {
    const { getSupabase } = await import("./supabase.js");
    const client = await getSupabase();
    if (!client) return {};
    // Keep the cached header current across token refreshes, so a beacon
    // from a tab that idled past the token's life still carries a live one.
    if (!authWatched && client.auth && typeof client.auth.onAuthStateChange === "function") {
      authWatched = true;
      try {
        client.auth.onAuthStateChange((_event, session) => {
          lastAuthHeaders = session?.access_token ? { Authorization: "Bearer " + session.access_token } : {};
        });
      } catch {}
    }
    const { data } = await client.auth.getSession();
    lastAuthHeaders = data?.session?.access_token
      ? { Authorization: "Bearer " + data.session.access_token }
      : {};
    return lastAuthHeaders;
  } catch { return {}; }
}

/** POST a small JSON body synchronously with keepalive and the last known
 *  auth headers — for the moment the page is leaving. Returns the fetch
 *  promise; the request is issued before this function returns. */
export function beaconJSON(url, payload) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { operationId: newOperationId(), ...payload }
    : payload;
  try {
    return fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...lastAuthHeaders },
      body: JSON.stringify(body),
    });
  } catch (e) { return Promise.reject(e); }
}

let deviceReady = null;
// Identity is a PREFERENCE, not a precondition. This used to throw when
// /api/auth was unavailable, and because every client surface goes through
// authorizedFetch, a single 429 on issuance blanked the whole product —
// including the endpoints the server is perfectly happy to serve anonymously
// (/api/discover, /api/search, /api/related, /api/suggest, /api/editorial).
// Resolving to null instead lets the request proceed without an identity and
// the experience degrade to un-personalized.
async function ensureDeviceCookie() {
  if (!deviceReady) {
    deviceReady = fetch("/api/auth", { cache: "no-store" }).then(async (res) => {
      // WHAT WAS WRONG (Aug 8, codebase audit). This returned null WITHOUT
      // clearing deviceReady, so an HTTP failure resolved the cached promise
      // and every later call reused it — for the lifetime of the page. The
      // "retry on the next call rather than caching the failure forever"
      // comment below is in the .catch, which only covers a THROWN error
      // (offline, DNS). The !res.ok path is the one that actually happens:
      // /api/auth answers 429 when GLOBAL_BUDGET_IDENTITY_ISSUE is exhausted
      // and 503 when DEVICE_COOKIE_SECRET is unset. A single 429 during a
      // burst left that visitor with no device cookie until they reloaded —
      // long after the limit cleared seconds later — so nothing personalized,
      // and every identity-bearing write 401'd. It also cascades: /api/stats
      // then returns 401 "identity required".
      if (!res.ok) { deviceReady = null; return null; }
      const data = await res.json().catch(() => null);
      if (!data?.uid) { deviceReady = null; return null; }
      return data.uid;
    }).catch(() => {
      // Retry on the next call rather than caching the failure forever.
      deviceReady = null;
      return null;
    });
  }
  return deviceReady;
}

/**
 * `fetch`, plus whatever proof of identity this browser can offer.
 *
 * USE THIS INSTEAD OF `fetch` FOR EVERY CALL TO OUR OWN API. It attaches the
 * Supabase bearer token when signed in and ensures the device cookie exists
 * otherwise; a bare `fetch` reaches the route as an anonymous stranger and
 * gets an empty personalized response rather than an error, which is a
 * confusing way to find the mistake.
 */
export async function authorizedFetch(url, options = {}) {
  const [deviceUid, auth] = await Promise.all([ensureDeviceCookie(), authorizationHeaders()]);
  if (!auth.Authorization && deviceUid) setUid(deviceUid);
  return fetch(url, { ...options, headers: { ...(options.headers || {}), ...auth } });
}

/**
 * POST JSON to our API, with an idempotency key attached.
 *
 * The generated `operationId` is what makes a retried write safe: the server
 * records it in `processed_operations` and a repeat is a no-op rather than a
 * second interaction. Use this for every MUTATION — `sendJSON` does not add
 * one. An explicit `operationId` in the payload wins, for a deliberate retry
 * of the same logical operation.
 */
export function postJSON(url, payload, init = {}) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { operationId: newOperationId(), ...payload }
    : payload;
  const { outbox = false, ...rest } = init;
  const send = () => authorizedFetch(url, {
    ...rest,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(rest.headers || {}) },
    body: JSON.stringify(body),
  });
  // OFFLINE-FIRST (V.2 chapter 1; slice 10d): a write that opts in is queued
  // when the device is offline or the network fails, and replayed in order
  // when it returns; the caller is told it was queued, never that it landed.
  if (outbox && typeof window !== "undefined") {
    return import("./outbox.js").then(async (ob) => {
      if (ob.isOffline()) return ob.queuedResponse(ob.enqueue({ url, payload: body }));
      try { return await send(); }
      catch (err) { if (err && err.name === "TypeError") return ob.queuedResponse(ob.enqueue({ url, payload: body })); throw err; }
    });
  }
  return send();
}

/** Send the offline queue now (Settings' SEND NOW). Resolves { sent, dropped, kept }. */
export function flushOfflineQueue() {
  if (typeof window === "undefined") return Promise.resolve({ sent: 0, dropped: 0, kept: 0 });
  return import("./outbox.js").then((ob) => ob.flushOutbox((entry) => authorizedFetch(entry.url, { method: entry.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.payload) })));
}

/** Replay the offline queue through the same authorized path. Wired once by the shell. */
export function watchOfflineQueue() {
  if (typeof window === "undefined") return;
  import("./outbox.js").then((ob) => ob.watchOutbox((entry) => authorizedFetch(entry.url, { method: entry.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.payload) }))).catch(() => {});
}

/** A fresh idempotency key. Falls back to time+random where crypto.randomUUID
 *  is unavailable — weaker, but these only need to be unique per client. */
export function newOperationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export { safeExternalUrl } from "./url.js";

/**
 * Like postJSON but for PUT/PATCH/DELETE — and WITHOUT an idempotency key.
 *
 * Fine for a replacing or deleting write, where repeating the call reaches the
 * same end state anyway. If the operation ACCUMULATES, use postJSON.
 */
export function sendJSON(method, url, payload) {
  return authorizedFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Small deterministic hash — masonry aspect ratios, post-tile picks, etc.
/** FNV-1a, 32-bit. For deterministic layout choices only — NOT a checksum and
 *  never for anything security-related. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Masonry tile aspect, deterministic per item id — the ONE aspect table for
// every grid (owner order, Aug 12: feed images vary in size; a wide band,
// from tall 3/5 crops to just-past-square). Shared here so home and
// discover can never drift apart again.
export const ASPECTS = ["3 / 4", "1 / 1", "2 / 3", "4 / 5", "5 / 8", "7 / 8", "3 / 5", "21 / 20"];
/** The masonry tile aspect for an item — stable across renders and pages, so
 *  a piece does not change shape when it appears in a different grid. */
export function aspectFor(id) {
  return ASPECTS[hashStr(String(id)) % ASPECTS.length];
}

// ---- Bag (client-side cart; adds are also a purchase-intent signal) ---------

const BAG_KEY = "asilum-bag";

/** The bag's contents, or [] on any failure. Never throws — a bag that cannot
 *  be read must not stop a page rendering. */
export function bagList() {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(BAG_KEY)) || [];
    return Array.isArray(rows) ? rows.map(normalizeBagLine).filter(Boolean) : [];
  } catch { return []; }
}
function bagSave(list) {
  try { window.localStorage.setItem(BAG_KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new Event("asilum:bag"));
}
/**
 * Add a piece to the bag, ignoring duplicates, and return the new list.
 *
 * Stores only the display fields listed here rather than the whole item, so a
 * bag saved today still renders after the catalog record changes shape. Adding
 * is also a purchase-intent signal — the caller reports that separately; this
 * function only keeps the list.
 */
export function bagLineKey(item) {
  if (item?.commerce_rail === "native_storefront") {
    const listing = item.native_listing_id || item.listingId || item.id;
    const variant = item.default_variant_id || item.variantId || "default";
    return `native:${listing}:${variant}`;
  }
  return String(item?.id || "");
}

function normalizeBagLine(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const quantity = Math.max(1, Math.min(99, Math.trunc(Number(item.quantity)) || 1));
  // NULL IS NOT ZERO (slice 6 review finding): the API sends price_cents: null
  // for every external record, and Number(null) is 0 — a safe integer — so an
  // eBay piece landed in the bag at 0 cents and vanished from the subtotal.
  // (a line stored at 0 by the earlier bug heals on read: 0 is no price either)
  const priceCents = item.price_cents != null && Number.isSafeInteger(Number(item.price_cents)) && Number(item.price_cents) > 0
    ? Number(item.price_cents)
    : (Number.isFinite(Number(item.price)) && Number(item.price) > 0 ? Math.round(Number(item.price) * 100) : null);
  const line = { ...item, quantity, price_cents: priceCents };
  line.bag_key = item.bag_key || bagLineKey(line);
  return line;
}

export function bagAdd(item) {
  const list = bagList();
  const key = bagLineKey(item);
  if (!list.some((x) => x.bag_key === key)) {
    const {
      id, title, brand, price, price_cents, currency, img, tags, commerce_rail,
      storefront_slug, storefront_name, native_listing_id, default_variant_id,
      fulfillment, listing_version, native_checkout_ready, originEvidence,
    } = item;
    list.push(normalizeBagLine({
      id, title, brand, price, price_cents, currency, img, tags, commerce_rail,
      storefront_slug, storefront_name, native_listing_id, default_variant_id,
      fulfillment, listing_version, native_checkout_ready, originEvidence, quantity: 1, bag_key: key,
      source_name: item.source_name, source: item.source,
      source_product_url: item.source_product_url, url: item.url,
    }));
    bagSave(list);
  }
  return list;
}
/** Drop a piece from the bag. Fires `asilum:bag`, which is how the header
 *  count updates without a re-render being threaded through. */
export function bagRemove(keyOrId) {
  bagSave(bagList().filter((x) => x.bag_key !== keyOrId && x.id !== keyOrId));
}

/** Change units on one shared bag line. Checkout still re-resolves stock. */
export function bagSetQuantity(keyOrId, quantity) {
  const next = Math.max(1, Math.min(99, Math.trunc(Number(quantity)) || 1));
  const list = bagList();
  const line = list.find((x) => x.bag_key === keyOrId || x.id === keyOrId);
  if (line && line.quantity !== next) {
    line.quantity = next;
    bagSave(list);
  }
  return list;
}

// ---- Fit profile ------------------------------------------------------------
// Cached on-device for instant cards and persisted through the authenticated
// first-party measurements API. Values are never placed in a URL or forwarded
// to a merchant/external model.

const FIT_KEY = "asilum-fit-profile";
export const EMPTY_FIT = EMPTY_MEASUREMENTS;

/** The on-device fit profile, merged over EMPTY_FIT so every field exists.
 *  A CACHE for instant rendering — the server copy is authoritative. */
export function loadFitProfile() {
  if (typeof window === "undefined") return { ...EMPTY_FIT };
  try {
    const raw = window.localStorage.getItem(FIT_KEY);
    return raw ? { ...EMPTY_FIT, ...JSON.parse(raw) } : { ...EMPTY_FIT };
  } catch { return { ...EMPTY_FIT }; }
}
/** Write the fit profile to the device and announce it via `asilum:fit`.
 *  Local only: pair with saveServerFitProfile to persist it for real. */
export function saveFitProfile(p) {
  const profile = { ...EMPTY_FIT, ...(p || {}) };
  try { window.localStorage.setItem(FIT_KEY, JSON.stringify(profile)); } catch {}
  window.dispatchEvent(new CustomEvent("asilum:fit", { detail: profile }));
  return profile;
}
/** Blank the on-device fit profile. Does NOT clear the server copy. */
export function clearFitProfile() {
  return saveFitProfile(EMPTY_FIT);
}
/** Convert a DISPLAY fit profile into the shape lib/brain/sizing.js expects.
 *  Re-exported here so client surfaces need not reach into lib/brain. */
export function fitProfileForBrain(f) {
  return measurementProfileForBrain(f);
}

/** Fetch the authoritative fit profile from the first-party measurements API.
 *  THROWS when unavailable, so a caller shows the cached copy deliberately
 *  rather than mistaking an empty result for "no measurements given". */
export async function loadServerFitProfile(user = getUid()) {
  const response = await authorizedFetch("/api/measurements?user=" + encodeURIComponent(user || ""));
  if (!response.ok) throw new Error("measurements unavailable");
  const data = await response.json();
  return { ...EMPTY_FIT, ...(data.profile || {}) };
}

/** Persist the fit profile through the first-party API. Measurements are
 *  FIRST-PARTY ONLY — never a URL parameter, never sent to a merchant or an
 *  external model. */
export async function saveServerFitProfile(profile, user = getUid()) {
  const response = await sendJSON("PUT", "/api/measurements", { user, profile });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "measurements could not be saved");
  const saved = { ...EMPTY_FIT, ...(data.profile || {}) };
  saveFitProfile(saved);
  return saved;
}

// ---- Placeholder thumbnails -------------------------------------------------
// Deterministic per item: gradient from the item's dominant aesthetic tags plus
// a brand monogram, so cards are recognizable and the grid reads as a moodboard.

const TAG_BASE = {
  "AVANT-GARDE": "#232326", SEDUCTIVE: "#3d1220", STATEMENT: "#4a2a06",
  TAILORED: "#1d2430", ARCHIVAL: "#2e2a20", MINIMAL: "#26262b",
  UTILITARIAN: "#26301f", STREETWEAR: "#12303a", GORP: "#1d3327",
  INDEPENDENT: "#33202e",
};
const TAG_ACCENT = {
  "AVANT-GARDE": "#8a8a95", SEDUCTIVE: "#c25a72", STATEMENT: "#d99a3d",
  TAILORED: "#7d93b5", ARCHIVAL: "#b5a878", MINIMAL: "#9fa3ad",
  UTILITARIAN: "#8fae6b", STREETWEAR: "#5db4c9", GORP: "#6dbb8a",
  INDEPENDENT: "#b07fae",
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A deterministic inline SVG placeholder for a piece with no usable image.
 *
 * Returned as a data: URI, so it needs no network and cannot fail to load. The
 * same id always yields the same placeholder, which keeps a grid stable across
 * renders. Exists because many sources do not permit image hotlinking, and a
 * moodboard of grey boxes is worse than one of deliberate ones.
 */
export function thumbFor(item) {
  const ranked = Object.entries(item.tags || {}).sort((a, b) => b[1] - a[1]);
  const t1 = ranked[0] ? ranked[0][0] : null;
  const t2 = ranked[1] ? ranked[1][0] : t1;
  const bg = TAG_BASE[t1] || "#1c1c22";
  const ac = TAG_ACCENT[t2] || "#3a3a44";
  const initials = esc(
    (item.brand || "?")
      .split(/\s+/)
      .map((w) => (/[a-z0-9]/i.test(w[0] || "") ? w[0] : ""))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
  const label = esc((t1 || "").toLowerCase());
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${bg}"/>` +
    `<stop offset="1" stop-color="${ac}" stop-opacity="0.5"/>` +
    `</linearGradient></defs>` +
    `<rect width="360" height="480" fill="url(#g)"/>` +
    `<circle cx="305" cy="66" r="95" fill="${ac}" opacity="0.16"/>` +
    `<text x="28" y="424" font-family="Georgia,serif" font-size="92" fill="${ac}" opacity="0.92">${initials}</text>` +
    `<text x="30" y="452" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="3" fill="#ffffff" opacity="0.45">${label}</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ---- Asterisk guidance mirror ----------------------------------------------
// The durable, cross-device preference lives in Asterisk memory. This small
// local mirror lets every open surface react immediately while the server
// remains authoritative for search, feed, Discover, and Stylist behavior.
/**
 * Is ASTERISK guidance on for this device?
 *
 * A MIRROR, not the truth: the durable cross-device preference lives in
 * Asterisk memory and the server decides what search, feed, Discover and
 * Stylist actually do. This exists so an open surface can react instantly
 * instead of waiting for a round-trip. Defaults to ON when unreadable.
 */
export function brainEnabled() {
  try { return window.localStorage.getItem("asilum-brain-off") !== "1"; } catch { return true; }
}
/** Flip the local guidance mirror and fire `asilum:brain`. Persist the real
 *  preference through the Asterisk memory API as well. */
export function setBrainEnabled(on) {
  try {
    if (on) window.localStorage.removeItem("asilum-brain-off");
    else window.localStorage.setItem("asilum-brain-off", "1");
    window.dispatchEvent(new Event("asilum:brain"));
  } catch {}
  return on;
}

// ---- Stale-response guards ---------------------------------------------------
// Surfaces that re-query on toggle, filter, or search changes must never let a
// slower older response overwrite a newer one — most importantly, a pending
// Asterisk-ON response must not land after guidance was paused. A surface owns
// one ref; claimRequest marks a new request generation (invalidating every
// slower in-flight response), watchRequest observes the current generation
// without invalidating it (pagination appends). Both return an isCurrent()
// the caller must check before applying a response.
/**
 * Start a new request generation, invalidating every slower one in flight.
 *
 * Use for a query that REPLACES what is on screen — a toggle, a filter, a new
 * search. Returns `isCurrent()`, which the caller MUST check before applying
 * the response:
 *
 *     const isCurrent = claimRequest(ref);
 *     const data = await fetchIt();
 *     if (!isCurrent()) return;
 *
 * Without it a slow earlier response lands after a newer one and overwrites
 * it — most visibly, a pending guidance-ON response arriving after the reader
 * paused guidance.
 */
export function claimRequest(ref) {
  const generation = (ref.current = (Number(ref.current) || 0) + 1);
  return () => ref.current === generation;
}

/**
 * Observe the current request generation WITHOUT invalidating it.
 *
 * The pagination counterpart of claimRequest: a "load more" appends to what is
 * already there, so it must not cancel the request that fetched it — but it
 * must still be dropped if the reader changes the query underneath it.
 */
export function watchRequest(ref) {
  const generation = Number(ref.current) || 0;
  return () => (Number(ref.current) || 0) === generation;
}

/**
 * Wipe every on-device trace of personalization, then tell each surface.
 *
 * The client half of sign-out and of the §6 privacy delete; the server half is
 * /api/privacy. Both are needed — clearing here alone leaves the account's
 * data intact, and clearing the server alone leaves a signed-out browser still
 * showing the last reader's bag and fit profile.
 *
 * The key list is exhaustive on purpose: a key added elsewhere and not added
 * here survives the wipe silently.
 */
export function clearLocalPersonalizationData() {
  if (typeof window === "undefined") return;
  const keys = [
    "asilum-posts", "asilum-follow-users", "asilum-follow-brands", "asilum-profile",
    "asilum-observe", "asilum-bag", "asilum-fit-profile", "asilum-brain-off",
    "asilum-onboarded", "asilum-ai-stylist-consent",
  ];
  try { for (const key of keys) window.localStorage.removeItem(key); } catch {}
  window.dispatchEvent(new Event("asilum:follow"));
  window.dispatchEvent(new Event("asilum:fit"));
  window.dispatchEvent(new Event("asilum:bag"));
  window.dispatchEvent(new Event("asilum:brain"));
}

// The sign-out notice, in ONE place because it was in two and they drifted.
//
// WHAT WAS WRONG (Aug 8). PR #148 corrected this string in app/shell.js after
// measuring that adoption MOVES taste — it deletes the device's profile row
// and reassigns its boards, interactions and follows to the account, leaving
// the device at {} / [] / []. The old wording, "device taste remains", told
// the user their taste was still there while the feed they got back was a
// cold start.
//
// app/profile/page.js had its own SIGN OUT handler publishing the SAME string,
// and #148 missed it: fixing one emitter and not grepping for the other. Both
// fire on sign-out (profile calls supabase signOut, which triggers shell's
// SIGNED_OUT listener), so the corrected message and the false one raced and
// whichever landed last won.
//
// A shared constant is the fix that cannot drift. Import it; do not retype it.
export const SIGN_OUT_NOTICE =
  "signed out — your taste stays with your account; this device starts fresh";
