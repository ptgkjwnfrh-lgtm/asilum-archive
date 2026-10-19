// lib/social.js
// Client-safe social + marketplace scaffolding: source labels, mock users and
// editorial stories, the community post store (local state until a posts
// backend exists), follow state, profile info, and the
// on-device observation toggle. Pure JS — safe to import from server routes
// (window access is always guarded).

import { hashStr, postJSON, sendJSON, authorizedFetch, getUid } from "./client.js";
import { isNativeStorefrontItem } from "./storefront/catalog.js";

// Dual-write follows to the server list (user_follows, v14) so the Asterisk
// memory surface sees them. localStorage stays the instant read model; a
// failed sync never blocks the UI.
function syncFollow(kind, target, on) {
  if (typeof window === "undefined") return;
  // a follow is a set: safe to queue offline and replay (lib/outbox.js)
  postJSON("/api/follow", { user: getUid(), kind, target, follow: on }, { outbox: true }).then(() => { friendsCache = null; window.dispatchEvent(new Event("asilum:friends")); }).catch(() => {});
}

// ---- THE FRIEND ASTERISK (V.2 Foundations; A6 (2), slice 10d) ------------------
// A mutual follow makes two passengers friends; a friend's name is written
// with a plain typographic asterisk at the start, relative to the viewer.
// It is Michroma at the name's weight and never the boxed |A|. Handles cannot
// begin with an asterisk (lib/profile/handles.js HANDLE_RE), so it cannot be
// faked. Friends are read once per page from /api/follow?friends=1 and
// refreshed when a follow changes.
let friendsCache = null; // { handle, friends: Set } | null
let friendsPromise = null;
export async function fetchFriends() {
  if (friendsCache) return friendsCache;
  if (friendsPromise) return friendsPromise;
  const uid = getUid();
  if (!uid) return { handle: null, friends: new Set() };
  friendsPromise = authorizedFetch("/api/follow?friends=1&user=" + encodeURIComponent(uid))
    .then((r) => (r.ok ? r.json() : { handle: null, friends: [] }))
    .then((d) => { friendsCache = { handle: d.handle || null, friends: new Set((d.friends || []).map((h) => String(h).toLowerCase())) }; friendsPromise = null; return friendsCache; })
    .catch(() => { friendsPromise = null; return { handle: null, friends: new Set() }; });
  return friendsPromise;
}
export function isFriend(handle, friends) {
  return !!(handle && friends && friends.has && friends.has(String(handle).toLowerCase()));
}

// ---- Marketplace sources -----------------------------------------------------
// Demo catalog items are labeled "ASILUM Vault" — they must never be dressed
// up as real partner inventory (see CONSTITUTION.md data rules). Real
// ingested items (eBay Browse, /api/ingest) keep their true source.

const DEMO_SOURCES = new Set(["Asilum synthetic seed", "seed", "", null, undefined]);

/**
 * The source label to SHOW for a piece — "eBay", a merchant name, or the
 * fallback "ASILUM Vault".
 *
 * Never invents a retailer. Anything in DEMO_SOURCES collapses to the vault
 * label rather than being presented as a real shop, which is the constitution's
 * no-faking rule at the display edge.
 */
export function sourceFor(item) {
  if (!item || !item.id) return "ASILUM Vault";
  if (isNativeStorefrontItem(item)) {
    // Native projections already carry the Storefront's server-owned name in
    // `brand`; prefer it to exposing a URL slug when no duplicate display-name
    // field was projected. This is attribution, not invented retailer data.
    return item.storefront_name || item.brand || item.storefront_slug || "ASILUM Storefront";
  }
  if (item.id.startsWith("ebay-") || item.source === "eBay Browse API") return "eBay";
  if (item.src && !DEMO_SOURCES.has(item.src)) return item.src;
  if (!DEMO_SOURCES.has(item.source)) return item.source;
  if (!DEMO_SOURCES.has(item.source_name)) {
    return item.source_name === "ebay" ? "eBay" : item.source_name;
  }
  return "ASILUM Vault";
}

// DEMO MODE (owner ruling, Aug 16, answering the launch-readiness audit's
// remaining P0). The catalog is 915 synthetic seed records with generated
// placeholder art and no live listings. They were shown with prices, sizes,
// seasons, availability and "just in" — indistinguishable from real inventory
// — and the Buy control was offered on every one, so a visitor discovered the
// dead end only by clicking it.
//
// THE ONE PREDICATE. Every label and every disabled control reads from this, so
// "is this real?" is answered in exactly one place and cannot drift between
// surfaces. It MIRRORS THE SERVER'S RULE in app/api/tickets/route.js: no usable
// source URL, or a seed source name. If that rule ever changes, change it here
// in the same commit — a UI that offers Buy the server will refuse is the bug
// this exists to prevent.
//
// Deliberately conservative: anything we cannot prove is live is treated as
// demo. An unproven listing labelled demo is a small embarrassment; a demo
// record labelled live is the trust failure.
export function isDemoItem(item) {
  if (!item) return true;
  if (isNativeStorefrontItem(item)) return false;
  const url = item.source_product_url || item.url || "";
  const hasLiveUrl = typeof url === "string" && /^https:\/\//i.test(url.trim());
  if (!hasLiveUrl) return true;
  const name = String(item.source_name ?? item.source ?? "");
  return DEMO_SOURCES.has(name) || name.toLowerCase().includes("seed");
}

// What a demo record may say about where it came from. Never a source, never
// availability — it has neither.
export const DEMO_LABEL = "DEMO";
export const DEMO_NOTE =
  "demo record — synthetic sample data, not a real listing. nothing here can be bought.";

// Load-test fixtures are opt-in and never ship as production social proof.
// NEXT_PUBLIC_ENABLE_DEMO_SOCIAL exists for local/staging load exercises only.
export const DEMO_SOCIAL_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_DEMO_SOCIAL === "1";

// ---- Mock users (local load-test data only) -----------------------------------

const MOCK_USER_FIXTURES = [
  { name: "Vex Archive", handle: "@vex.archive", tags: ["ARCHIVAL", "AVANT-GARDE"] },
  { name: "Grey Market", handle: "@grey.market", tags: ["MINIMAL", "TAILORED"] },
  { name: "Tabi Lord", handle: "@tabi.lord", tags: ["AVANT-GARDE", "INDEPENDENT"] },
  { name: "Hemline", handle: "@hem.line", tags: ["SEDUCTIVE", "STATEMENT"] },
  { name: "Spine Press", handle: "@spine.press", tags: ["ARCHIVAL", "MINIMAL"] },
  { name: "Ridgeline", handle: "@ridge.line", tags: ["GORP", "UTILITARIAN"] },
  { name: "Corner Store", handle: "@corner.store", tags: ["STREETWEAR", "INDEPENDENT"] },
  { name: "Atelier Zero", handle: "@atelier.zero", tags: ["TAILORED", "MINIMAL"] },
  { name: "Opium Den", handle: "@opium.den", tags: ["AVANT-GARDE", "STREETWEAR"] },
  { name: "Silk Route", handle: "@silk.route", tags: ["SEDUCTIVE", "TAILORED"] },
];
export const MOCK_USERS = DEMO_SOCIAL_ENABLED ? MOCK_USER_FIXTURES : [];

/** Substring search over the DEMO user fixtures by name, handle or tag.
 *  Returns [] when demo social is disabled, because MOCK_USERS is empty then —
 *  this never searches real accounts. */
export function searchUsers(q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  return MOCK_USERS.filter(
    (u) => u.name.toLowerCase().includes(s) || u.handle.toLowerCase().includes(s) ||
           u.tags.some((t) => t.toLowerCase().includes(s))
  );
}

// ---- The reading room ---------------------------------------------------------
// WHAT THIS USED TO BE, AND WHY IT CHANGED (launch-readiness audit, Aug 16).
// This was `STORIES`: nine INVENTED HEADLINES attributed to named real
// publications — "The Archive Is the New Atelier · VOGUE ↗" — rendered under a
// heading that read EXTERNAL DISPATCHES and a note saying "the stories live
// with the publications". Every link went to the publication's front page,
// because no such article existed.
//
// The original intent was copyright safety: nothing was copied, and the
// summaries were written here. But not-copying was never the risk. Putting a
// headline ASILUM wrote under Vogue's masthead ATTRIBUTES FABRICATED EDITORIAL
// TO A REAL PUBLICATION, which is worse than quoting one, and no reader could
// tell the difference. The honesty contract does not have an exception for
// furniture.
//
// What it is now: a reading list. Each row is a publication ASILUM reads and a
// factual line about what that publication actually covers — ASILUM's own
// words, describing a masthead, not a story. The link goes to their front page
// because that is the honest destination. NOTHING HERE MAY EVER CLAIM A
// SPECIFIC ARTICLE unless it is fetched, verified, deep-linked, and permitted.
export const READING_ROOM = [
  { pub: "Vogue", url: "https://www.vogue.com",
    beat: "the industry's paper of record — runway, houses, and the business under them." },
  { pub: "Dazed", url: "https://www.dazeddigital.com",
    beat: "youth culture and the fringes, several years before the centre notices." },
  { pub: "i-D", url: "https://i-d.co",
    beat: "portraiture and street-level style, on the same beat since 1980." },
  { pub: "Highsnobiety", url: "https://www.highsnobiety.com",
    beat: "streetwear, sneakers, and the resale economy that now prices them." },
  { pub: "AnOther", url: "https://www.anothermag.com",
    beat: "long-form fashion criticism and archive photography." },
  { pub: "GQ", url: "https://www.gq.com",
    beat: "menswear and tailoring, read widely enough to move the middle." },
  { pub: "CR Fashion Book", url: "https://crfashionbook.com",
    beat: "Carine Roitfeld's editorial provocations, staged as image-first spreads." },
  { pub: "Hypebeast", url: "https://hypebeast.com",
    beat: "drops, collaborations, and the release calendar as news." },
  { pub: "Harper's Bazaar", url: "https://www.harpersbazaar.com",
    beat: "American fashion journalism, continuously, since 1867." },
];

// ---- Community posts (local state until a posts backend exists) ---------------

const POSTS_KEY = "asilum-posts";

const SEED_POSTS = [
  { id: "seed-1", name: "Vex Archive", handle: "@vex.archive", at: Date.now() - 1000 * 60 * 60 * 5,
    text: "wearing the whole 1999 silhouette today. the trousers argue with gravity and win." },
  { id: "seed-2", name: "Ridgeline", handle: "@ridge.line", at: Date.now() - 1000 * 60 * 60 * 9,
    text: "goretex over tailoring. the office didn't understand. the weather did." },
  { id: "seed-3", name: "Hemline", handle: "@hem.line", at: Date.now() - 1000 * 60 * 60 * 26,
    text: "found the corset from the runway photo. hands were shaking at checkout." },
  { id: "seed-4", name: "Corner Store", handle: "@corner.store", at: Date.now() - 1000 * 60 * 60 * 31,
    text: "varsity jacket, split hem, no logo. the quiet flex is the loudest one." },
];

/** This device's own posts, newest first, plus the seed posts when demo
 *  social is enabled. Local state only — fetchPosts is the real read. */
export function listPosts() {
  let mine = [];
  if (typeof window !== "undefined") {
    try { mine = JSON.parse(window.localStorage.getItem(POSTS_KEY)) || []; } catch {}
  }
  return [...mine, ...(DEMO_SOCIAL_ENABLED ? SEED_POSTS : [])].sort((a, b) => b.at - a.at);
}

// The wire, read for real (Aug 12): everyone's visible posts from
// GET /api/editorial (server-moderated, bylines are server truth). For
// kind="user" the result also merges this device's own instant-render
// copies — a duplicate is a post with the SAME sanitizer-normalized text
// within ten minutes (tight enough that a stranger's identical text is
// not claimed as yours, loose enough that the server's sanitizer rewrite
// still matches); the server record wins but keeps the "you" chip, and a
// local post missing from the server (just posted, or held for review)
// still shows. Returns { posts, live } — live:false means the server
// could not be reached, so callers must NOT claim the wire is empty.
// client-side approximation of the server's sanitizeStatement
const normPostText = (t) => String(t || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
// A local copy matches a server record when the normalized text agrees
// within ten minutes (tight enough that a stranger's identical text is
// not claimed as yours, loose enough that the sanitizer rewrite matches).
export function matchesLocalPost(local, srv) {
  return normPostText(local.text) === normPostText(srv.text) &&
    Math.abs((local.at || 0) - (srv.at || 0)) < 10 * 60 * 1000;
}
/** A server post record in the shape the wire UI renders. Ids are prefixed
 *  "srv-" so a server post and a local instant-render copy can coexist in one
 *  list without colliding; `serverId` keeps the real id for writes. */
export function mapServerPost(p) {
  return {
    id: "srv-" + p.id,
    serverId: p.id,
    name: p.authorHandle || "reader",
    handle: p.authorHandle || "reader",
    at: p.createdAt || 0,
    text: (p.body || p.title || "").trim(),
    title: p.title || "",
    excerpt: p.excerpt || "",
    externalUrl: p.externalUrl || "",
    editedAt: p.editedAt || null,
    imageUrl: p.imageUrl || "",
    postKind: p.postKind || (p.imageUrl ? "post" : "transmission"),
    layout: p.layout || null,
    attachments: p.attachments && typeof p.attachments === "object" ? p.attachments : {},
    tags: Array.isArray(p.tags) ? p.tags : [],
    mine: false,
  };
}

/**
 * Read the wire for real, merging this device's instant-render copies.
 *
 * RETURNS `{ posts, live }` AND THE CALLER MUST CHECK `live`. False means the
 * server could not be reached — so an empty list is "we do not know", not
 * "there is nothing here", and the UI must not claim the wire is empty.
 */
export async function fetchPosts(kind = "user", limit = 60) {
  const mine = kind === "user" ? listPosts().filter((p) => p.mine) : [];
  try {
    // the viewer and their area (two decimals, the places' own precision)
    // decide which BRDCST footers ride along (V.2 5.13–5.15; slice 8)
    const qs = new URLSearchParams({ kind, limit: String(limit) });
    const uid = getUid();
    if (uid) qs.set("user", uid);
    try {
      const { discoveryCenter } = await import("./location.js");
      const c = discoveryCenter();
      if (c) { qs.set("lat", String(c.lat)); qs.set("lng", String(c.lng)); }
    } catch {}
    const d = await fetch("/api/editorial?" + qs.toString()).then((r) => r.json());
    const server = (d.posts || []).map(mapServerPost).filter((p) => p.text);
    if (kind !== "user") return { posts: server, live: true };
    for (const s of server) if (mine.some((m) => matchesLocalPost(m, s))) s.mine = true;
    const posts = [
      ...server,
      ...mine.filter((m) => !server.some((s) => matchesLocalPost(m, s))),
    ].sort((a, b) => b.at - a.at);
    return { posts, live: true };
  } catch {
    return { posts: mine, live: false };
  }
}

// A poster's visible transmissions (owner order, Aug 13: the identity
// chain). Server truth only — another reader's posts never live on this
// device. Returns { posts, live } like fetchPosts.
export async function fetchPostsByHandle(handle, limit = 60) {
  try {
    const d = await fetch("/api/editorial?kind=user&handle=" + encodeURIComponent(handle) + "&limit=" + limit)
      .then((r) => r.json());
    return { posts: (d.posts || []).map(mapServerPost).filter((p) => p.text), live: true };
  } catch {
    return { posts: [], live: false };
  }
}

// One transmission by server id — the permalink read. null = not on the
// wire (never published, held for review, or gone); callers say so
// honestly rather than guessing which.
export async function fetchPost(id) {
  try {
    const d = await fetch("/api/editorial?id=" + encodeURIComponent(id)).then((r) => r.json());
    const p = (d.posts || []).map(mapServerPost).filter((x) => x.text)[0];
    return p || null;
  } catch {
    return null;
  }
}

/**
 * Publish a post: write it locally for instant render, then send it.
 *
 * The local copy is a PLACEHOLDER, not the record. The server sanitizes,
 * moderates and assigns the byline, so its version wins on the next fetchPosts
 * — matchesLocalPost is what reconciles the two without showing a duplicate.
 */
export function addPost(text, profileInfo, title, composition = null) {
  // The wire's transmission law (owner order, Aug 13): 5000-char text,
  // and the caption acts as the transmission's header (≤200, mirroring
  // the server's cap).
  const post = {
    id: "p-" + Date.now().toString(36),
    name: (profileInfo && profileInfo.name) || "You",
    handle: (profileInfo && profileInfo.handle) || "@you",
    at: Date.now(),
    text: String(text || "").slice(0, 5000),
    title: String(title || "").slice(0, 200),
    mine: true,
    ...(composition ? { postKind: composition.postKind || "transmission", layout: composition.layout || null, attachments: composition.attachments || {}, imageUrl: composition.imageUrl || "" } : {}),
  };
  try {
    const mine = JSON.parse(window.localStorage.getItem(POSTS_KEY)) || [];
    window.localStorage.setItem(POSTS_KEY, JSON.stringify([post, ...mine].slice(0, 100)));
  } catch {}
  return post;
}

// ---- Transmission lifecycle (owner directive, 14 Aug 2026) ----------
// Author-side edit + delete. The server's verdict is the truth; these also
// keep this device's instant-render copy in step, so a deleted transmission
// cannot haunt the wire as a "device copy" and an edited one cannot
// resurface wearing its old text.

// Rewrite (next = {text, title}) or drop (next = null) the device copies
// that match a server transmission — the same normalized-text +
// ten-minute rule the wire merge uses.
function syncLocalCopies(serverPost, next) {
  if (typeof window === "undefined") return;
  try {
    const mine = JSON.parse(window.localStorage.getItem(POSTS_KEY)) || [];
    const kept = [];
    for (const m of mine) {
      if (!m.mine || !matchesLocalPost(m, serverPost)) { kept.push(m); continue; }
      if (next) {
        kept.push({
          ...m,
          text: String(next.text || "").slice(0, 5000),
          title: String(next.title || "").slice(0, 200),
        });
      }
    }
    window.localStorage.setItem(POSTS_KEY, JSON.stringify(kept));
  } catch {}
}

/** Edit a published post. The server re-sanitizes and re-moderates, so the
 *  returned record — not the submitted text — is what should be rendered. */
export async function editPost(serverPost, text, title) {
  const res = await sendJSON("PATCH", "/api/editorial", {
    user: getUid(), id: serverPost.serverId, text, title: title || undefined,
  });
  const d = await res.json().catch(() => null);
  if (res.ok) syncLocalCopies(serverPost, { text, title: title || "" });
  return {
    ok: res.ok,
    held: !!(d && d.held),
    note: (d && d.note) || "",
    error: res.ok ? "" : ((d && d.error) || "edit failed"),
  };
}

// ---- Wire engagement: likes + saves (owner directive, Aug 14) --------------
// Real counters or nothing. fetchEngagement returns {} when the server
// cannot be reached — callers render no counts at all rather than a zero
// they cannot stand behind (a fabricated zero is still a fabricated
// number). toggleEngagement returns the server's fresh counts.

export async function fetchEngagement(serverIds) {
  const ids = (serverIds || []).filter((v) => v != null);
  if (!ids.length) return {};
  try {
    const r = await authorizedFetch(
      "/api/editorial/engage?ids=" + encodeURIComponent(ids.join(",")) +
      "&user=" + encodeURIComponent(getUid() || "")
    );
    if (!r.ok) return {};
    const d = await r.json();
    return d.engagement || {};
  } catch {
    return {};
  }
}

/** Turn one engagement (like, save) on or off for a post. Idempotent by
 *  design: sending the state you want, not a flip, so a retry cannot invert it. */
export async function toggleEngagement(serverId, kind, on) {
  try {
    const r = await postJSON("/api/editorial/engage", { user: getUid(), id: serverId, kind, on });
    const d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: (d && d.error) || "engagement failed" };
    return {
      ok: true,
      counts: { likes: d.likes, saves: d.saves, youLike: d.youLike, youSave: d.youSave },
    };
  } catch {
    return { ok: false, error: "the wire could not be reached" };
  }
}

/** Delete a post server-side and drop the local copy, so it cannot reappear
 *  from this device's instant-render list after the server has forgotten it. */
export async function deletePost(serverPost) {
  const res = await authorizedFetch(
    "/api/editorial?id=" + encodeURIComponent(serverPost.serverId) +
    "&user=" + encodeURIComponent(getUid() || ""),
    { method: "DELETE" }
  );
  if (res.ok) syncLocalCopies(serverPost, null);
  const d = await res.json().catch(() => null);
  return { ok: res.ok, error: res.ok ? "" : ((d && d.error) || "delete failed") };
}

// Deterministic engagement counts so the community feels lived-in.
export function postStats(post) {
  if (!DEMO_SOCIAL_ENABLED) return { comments: 0, reposts: 0, likes: 0 };
  const h = hashStr(post.id + post.handle);
  return { comments: h % 14, reposts: (h >> 3) % 22, likes: 4 + ((h >> 6) % 90) };
}

/** A short relative time ("4h", "2d") for post bylines. Display only. */
export function timeAgo(t) {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + "m";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h";
  return Math.round(h / 24) + "d";
}

// ---- Follow state (users + brands; board follows live on the server profile) --

const FOLLOW_KEY = "asilum-follow-users";
const BRAND_KEY = "asilum-follow-brands";

/** Handles this device follows. The instant read model; the server list
 *  (user_follows) is authoritative and is dual-written by setFollowUser. */
export function followedUsers() {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(FOLLOW_KEY)) || []; } catch { return []; }
}
/** Follow or unfollow a person. Writes locally FIRST so the UI responds at
 *  once, then syncs; a failed sync never blocks the interaction. */
export function setFollowUser(handle, on) {
  const cur = new Set(followedUsers());
  on ? cur.add(handle) : cur.delete(handle);
  try { window.localStorage.setItem(FOLLOW_KEY, JSON.stringify([...cur])); } catch {}
  syncFollow("user", handle, !!on);
  window.dispatchEvent(new Event("asilum:follow"));
  return [...cur];
}

/** Brands this device follows. Same dual-write model as followedUsers. */
export function followedBrands() {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(BRAND_KEY)) || []; } catch { return []; }
}
/** Follow or unfollow a house. Local write first, then server sync. */
export function setFollowBrand(brand, on) {
  const cur = new Set(followedBrands());
  on ? cur.add(brand) : cur.delete(brand);
  try { window.localStorage.setItem(BRAND_KEY, JSON.stringify([...cur])); } catch {}
  syncFollow("brand", brand, !!on);
  window.dispatchEvent(new Event("asilum:follow"));
  return [...cur];
}

// ---- Profile info --------------------------------------------------------------

const PROFILE_KEY = "asilum-profile";

/** The display name and handle this device posts under. Local only — the
 *  server sets the byline on a published post from the authenticated account,
 *  so this cannot be used to post as somebody else. */
export function getProfileInfo() {
  const base = { name: "Unnamed Reader", handle: "@reader", bio: "taste under construction." };
  if (typeof window === "undefined") return base;
  try { return { ...base, ...(JSON.parse(window.localStorage.getItem(PROFILE_KEY)) || {}) }; } catch { return base; }
}
/** Store the local display name and handle. See getProfileInfo on why this
 *  is a preference and not an identity. */
export function saveProfileInfo(info) {
  try { window.localStorage.setItem(PROFILE_KEY, JSON.stringify(info)); } catch {}
}

// ---- On-device observation toggle ----------------------------------------------

const OBSERVE_KEY = "asilum-observe";

/** Is on-device observation enabled? Defaults to ON when unreadable, matching
 *  the consent state the reader last agreed to rather than failing silent. */
export function observationOn() {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(OBSERVE_KEY) !== "0"; } catch { return true; }
}
/** Flip on-device observation and announce it, so open surfaces stop or
 *  resume reporting immediately rather than at the next navigation. */
export function setObservation(on) {
  try { window.localStorage.setItem(OBSERVE_KEY, on ? "1" : "0"); } catch {}
}
