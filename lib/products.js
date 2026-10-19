// Canonical product resolution. Mutation routes accept only an item id and
// rebuild the snapshot from server-owned inventory before learning or saving.

import { TAGS } from "./brain/tags.js";
import { measuredProvenance, ESTIMATED_SOURCE } from "./brain/sizing.js";
import { getItems, getPool, getPopularity, hasColumns, listItems } from "./db/index.js";
import { CATALOG, getCatalogItem } from "./ingest/catalog.js";
import { safeExternalUrl, safeImageUrl } from "./url.js";
import { refusalReason } from "./purchasable.js";
import { originEvidence } from "./provenance.js";
import { isNativeStorefrontItem } from "./storefront/catalog.js";

const KNOWN_TAGS = new Set(TAGS);
export const KNOWN_COLORS = new Set([
  "black", "white", "grey", "cream", "beige", "tan", "brown", "navy",
  "blue", "green", "olive", "burgundy", "red", "pink", "yellow",
  "orange", "purple", "silver", "gold",
]);
const text = (value, max) => value == null ? null : String(value).trim().slice(0, max) || null;

function safeEra(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const year = Number(value.year);
  const out = {
    ...(Number.isInteger(year) && year >= 1800 && year <= 2100 ? { year } : {}),
  };
  for (const [key, max] of Object.entries({ season: 40, decade: 20, raw: 80 })) {
    const cleaned = text(value[key], max);
    if (cleaned) out[key] = cleaned;
  }
  return Object.keys(out).length ? out : null;
}

function safeSize(value) {
  if (typeof value === "string") return text(value, 40);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, max] of Object.entries({ label: 40, system: 20, gender: 20, fitsLikeUS: 20, measurementSource: 30, category: 80 })) {
    const cleaned = text(value[key], max);
    if (cleaned) out[key] = cleaned;
  }
  const bias = Number(value.runsBias);
  if (Number.isFinite(bias)) out.runsBias = Math.max(-5, Math.min(5, bias));
  if (value.measurements && typeof value.measurements === "object" && !Array.isArray(value.measurements)) {
    const measurements = {};
    for (const key of ["chest", "waist", "hips", "shoulder", "length", "inseam", "rise"]) {
      const number = Number(value.measurements[key] ?? (key === "hips" ? value.measurements.hip : undefined));
      if (Number.isFinite(number) && number >= 0 && number <= 200) measurements[key] = number;
    }
    if (Object.keys(measurements).length) out.measurements = measurements;
  }
  if (out.measurementSource || out.measurements) {
    // Provenance is earned by numbers (lib/brain/sizing.js measuredProvenance):
    // a source word without measurements is dropped, an unknown word is demoted.
    const settled = measuredProvenance(out.measurementSource, out.measurements);
    if (settled === ESTIMATED_SOURCE) delete out.measurementSource; else out.measurementSource = settled;
  }
  return Object.keys(out).length ? out : null;
}

function safeColorEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const colors = (key, max) => Array.isArray(value[key])
    ? [...new Set(value[key].map(String).filter((color) => KNOWN_COLORS.has(color)))].slice(0, max) : [];
  const merchantColors = colors("merchantColors", 4);
  const observedColors = colors("observedColors", 6);
  const verifiedColors = colors("verifiedColors", 4)
    .filter((color) => merchantColors.includes(color) && observedColors.includes(color));
  const imagesAnalyzed = Math.max(0, Math.min(3, Math.trunc(Number(value.imagesAnalyzed)) || 0));
  const imagesRequired = Math.max(1, Math.min(2, Math.trunc(Number(value.imagesRequired)) || 1));
  if (value.status !== "verified" || !verifiedColors.length || imagesAnalyzed < imagesRequired) return null;
  return {
    status: "verified", verifiedColors,
    merchantColors, observedColors, imagesAnalyzed, imagesRequired,
    confidence: Math.max(0, Math.min(0.95, Number(value.confidence) || 0)),
    method: "merchant-statement+multi-image-palette-v1",
  };
}

/**
 * May this piece be SHOWN? The single predicate for that question.
 *
 * Hidden, sold, removed and unavailable rows all fail. Anything that surfaces
 * products — feed, search, discover, rails, counts — must agree with this, and
 * the SQL that counts inventory mirrors it deliberately; a count that includes
 * what the shelf excludes reports confidence the catalog cannot honour.
 */
export function isDiscoverableProduct(item) {
  if (!item || item.is_available === false) return false;
  if ((item.moderation_status || "visible") !== "visible") return false;
  if (["sold", "removed", "unavailable"].includes(item.availability_status)) return false;
  // Native inventory is authoritative in integer units. Keep this check even
  // though the Storefront projection also moves a zero-stock row to `sold`:
  // it closes the stale/inconsistent-row seam before Feed, search, rails or
  // Asterisk can recommend something checkout would immediately refuse.
  if (isNativeStorefrontItem(item)) {
    const available = Number(item.inventory_available);
    if (!Number.isSafeInteger(available) || available <= 0) return false;
  }
  return true;
}

// A correction is a promise, not a hint (Day 11). Brands the user corrected
// away ("dont-recommend-brand") and pieces they marked already-own /
// not-my-style must not reappear on ANY recommendation surface.
//
// This predicate lived in two places with a third surface missing it entirely
// (audit #8): /api/feed filtered, the AI-edit group filtered, and the
// stylist's own 25 base looks did not — so a corrected brand vanished from the
// feed and returned in the stylist, in the same response as its own
// suppression. One copy, so the next surface cannot diverge silently.
//
// `exclusions` is the shape returned by getUserRecommendationExclusions:
// { brands: string[] (already lowercased by both backends), productIds: string[] }.
export function applyRecommendationExclusions(pool = [], exclusions = null) {
  const brands = new Set(exclusions?.brands || []);
  const productIds = new Set(exclusions?.productIds || []);
  // THE PRICE LANE (V.2): "too expensive" at $900 means nothing at or above
  // $900 is pushed at this reader until they take it back. Items with no
  // price are not judged by it — unknown is not a quiet yes or a quiet no.
  const ceiling = Number(exclusions?.priceCeilingCents);
  const priced = Number.isFinite(ceiling) && ceiling > 0;
  // Most users have corrected nothing; don't copy the whole pool to say so.
  if (!brands.size && !productIds.size && !priced) return pool;
  return pool.filter((item) =>
    !productIds.has(item.id) &&
    !(item.brand && brands.has(item.brand.trim().toLowerCase())) &&
    !(priced && Number.isFinite(Number(item.price)) && Math.round(Number(item.price) * 100) >= ceiling));
}

/** A frozen, minimal copy of a piece for storing alongside a record that must
 *  survive the catalog changing — an order line, a ticket. Returns null for
 *  anything without an id rather than a half-built object. */
export function productSnapshot(item) {
  if (!item || typeof item !== "object") return null;
  const id = text(item.id, 80);
  if (!id) return null;
  const tags = {};
  for (const [tag, raw] of Object.entries(item.tags || {})) {
    const key = String(tag).toUpperCase();
    const weight = Number(raw);
    if (KNOWN_TAGS.has(key) && Number.isFinite(weight) && weight > 0) {
      tags[key] = Math.min(1, weight);
    }
  }
  const price = Number(item.price);
  const sourceUrl = safeExternalUrl(item.source_product_url || item.url);
  const colorEvidence = safeColorEvidence(item.color_evidence || item.colorEvidence);
  return {
    id,
    title: text(item.title, 300) || "Untitled item",
    brand: text(item.brand, 160) || "Unknown",
    price: Number.isFinite(price) && price >= 0 ? price : null,
    currency: /^[A-Z]{3}$/.test(String(item.currency || "").toUpperCase())
      ? String(item.currency).toUpperCase() : "USD",
    tags,
    img: safeImageUrl(item.img),
    alt: text(item.alt, 300),
    source: text(item.source || item.source_name, 80),
    source_name: text(item.source_name || item.source, 80),
    source_product_id: text(item.source_product_id, 160),
    source_product_url: sourceUrl,
    url: sourceUrl,
    designers: Array.isArray(item.designers)
      ? item.designers.slice(0, 4).map((v) => text(v, 160)).filter(Boolean) : [],
    category: text(item.category, 80),
    subcategory: text(item.subcategory, 80),
    color: colorEvidence?.verifiedColors[0] || null,
    colors: colorEvidence?.verifiedColors || [],
    colorEvidence,
    material: text(item.material, 120),
    fit: text(item.fit, 80),
    silhouette: text(item.silhouette, 100),
    condition: text(item.condition, 100),
    decade: text(item.decade, 40),
    era: safeEra(item.era),
    size: safeSize(item.size),
    is_available: item.is_available !== false,
    availability_status: text(item.availability_status, 40) || "unknown",
    moderation_status: text(item.moderation_status, 40) || "visible",
    // Native Storefront projection. Integer cents and listing/version ids are
    // additive to the historical major-unit display price; checkout must use
    // these server-owned fields and re-resolve them, never the bag snapshot.
    commerce_rail: item.commerce_rail === "native_storefront" ? "native_storefront" : null,
    storefront_slug: text(item.storefront_slug, 80),
    storefront_name: text(item.storefront_name, 80),
    native_listing_id: text(item.native_listing_id, 80),
    default_variant_id: text(item.default_variant_id, 80),
    price_cents: Number.isSafeInteger(Number(item.price_cents)) && Number(item.price_cents) >= 0
      ? Number(item.price_cents) : null,
    inventory_available: Number.isSafeInteger(Number(item.inventory_available))
      && Number(item.inventory_available) >= 0
      ? Number(item.inventory_available) : null,
    native_checkout_ready: item.native_checkout_ready === true,
    listing_version: Number.isSafeInteger(Number(item.listing_version))
      ? Number(item.listing_version) : null,
    // Sponsorship rides the INTERNAL snapshot so server paths (the ad firewall
    // in /api/interaction, audit #19) can see it; publicProduct strips both
    // fields, so inactive campaign metadata never crosses the API boundary —
    // the disclosed-active path in publicProduct stays the only public
    // exposure.
    sponsored: item.sponsored === true,
    sponsorship_status: text(item.sponsorship_status, 40) || null,
  };
}

// A placement the organic-ranking firewall must fence off: genuinely active
// sponsored content. Engagement on it must not write edges, popularity, or
// cross-user events (audit #19) — otherwise a campaign could buy organic reach
// through the co-engagement graph the day a real item is flagged.
export function isSponsoredContent(item) {
  return item?.sponsored === true && item?.sponsorship_status === "active";
}

const PUBLIC_ZONES = new Set(["core", "discovery", "reach", "catalog", "ad"]);
// (r14) attribution taxonomy — the only strings a feed item may carry as its
// sourcing bridge, and the only ones the interaction API will accept back.
export const PUBLIC_BRIDGES = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "ad",
  "discovery-adjacent", "discovery-crossuser", "reach", "catalog",
]);
const PUBLIC_RANK_PARTS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "theta", "zeta", "ad",
]);

function finiteNumber(value, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

// Attribution rides BACK from the client: `_bridge` says which bridge served
// the slot being answered, and the server cannot re-derive it without slot
// logging. Every product FIELD still comes from server inventory — this only
// re-attaches the reported provenance to a copy, and PUBLIC_BRIDGES decides
// what is even nameable. A client can mislabel which of the nine real bridges
// served it; it cannot invent one, and per-user r16 tuning is the only reader.
// Kept here (not inline in the route) so the sequence is unit-testable.
export function withReportedBridge(snapshot, reportedBridge) {
  if (!snapshot) return snapshot;
  if (!PUBLIC_BRIDGES.has(reportedBridge)) return { ...snapshot };
  return { ...snapshot, _bridge: reportedBridge };
}

// User-facing APIs should never serialize SELECT * rows. Keep the stable card
// contract and a small allowlist of explainable ranking metadata; generated
// tsvectors, moderation flags, timestamps, and internal source ids stay server-side.
export function publicProduct(item) {
  const snapshot = productSnapshot(item);
  if (!snapshot) return null;
  const {
    moderation_status: _moderationStatus,
    source_product_id: _sourceProductId,
    sponsored: _sponsored,
    sponsorship_status: _sponsorshipStatus,
    ...safe
  } = snapshot;

  if (PUBLIC_ZONES.has(item._zone)) safe._zone = item._zone;
  if (PUBLIC_BRIDGES.has(item._bridge)) safe._bridge = item._bridge;
  if (["graph", "tags"].includes(item._via)) safe._via = item._via;
  const score = finiteNumber(item._score);
  if (score != null) safe._score = score;
  const contextMatch = finiteNumber(item._contextMatch, -1, 1);
  if (contextMatch != null) safe._contextMatch = contextMatch;
  if (item._parts && typeof item._parts === "object" && !Array.isArray(item._parts)) {
    safe._parts = Object.fromEntries(Object.entries(item._parts)
      .filter(([key, value]) => PUBLIC_RANK_PARTS.has(key) && Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)]));
  }

  const confidence = finiteNumber(item.confidenceScore, 0, 1);
  if (confidence != null) safe.confidenceScore = confidence;
  if (typeof item.matchReason === "string") safe.matchReason = item.matchReason.slice(0, 80);
  if (Array.isArray(item.matchedTags)) {
    safe.matchedTags = item.matchedTags.slice(0, 12).map((tag) => text(tag, 40)).filter(Boolean);
  }

  // Sponsorship is returned only when it is an active, disclosed placement.
  // Inactive campaign metadata has no reason to cross the API boundary.
  const disclosure = text(item.sponsor_disclosure, 200);
  if (item.sponsored === true && item.sponsorship_status === "active" && disclosure) {
    safe.sponsored = true;
    safe.sponsor_disclosure = disclosure;
  }
  // The checkout gate's verdict, stamped server-side so no client ever
  // re-derives (and drifts from) the one rule. Demo records are false;
  // a Buy control may render ONLY where this is true.
  safe.purchasable = refusalReason(item) === null;

  // WHAT BACKS THIS PIECE, stamped server-side beside the checkout verdict and
  // for the same reason: one rule, computed once, so two surfaces cannot
  // disagree about whether a brand is established or merely claimed.
  //
  // Owner ruling, 27 Aug 2026 — marketplace inventory is INGESTED AND LABELLED,
  // never hidden. This travels on every public payload, so a piece cannot
  // appear anywhere in the app without its provenance beside it.
  safe.originEvidence = originEvidence(item);
  return safe;
}

let poolCache = null;
let poolCacheAt = 0;
let poolPromise = null;
const PRODUCT_POOL_TTL_MS = 15_000;

// Expensive discovery surfaces share one short-lived inventory snapshot per
// server instance instead of each scanning 5,000 rows independently.
export async function getDiscoverablePool({ limit = 5000, fallback = true } = {}) {
  const safeLimit = Math.max(1, Math.min(5000, Math.trunc(Number(limit)) || 5000));
  const now = Date.now();
  if (poolCache && now - poolCacheAt < PRODUCT_POOL_TTL_MS) {
    return (poolCache.length ? poolCache : fallback ? CATALOG : []).slice(0, safeLimit);
  }
  if (!poolPromise) {
    poolPromise = (async () => {
      // An empty successful read may use the explicit demo fallback. A failed
      // database read must propagate: treating an outage as an empty catalog
      // would make synthetic inventory look legitimate during recovery.
      const rows = await listItems(5000);
      poolCache = rows.filter(isDiscoverableProduct);
      poolCacheAt = Date.now();
      return poolCache;
    })().finally(() => { poolPromise = null; });
  }
  const rows = await poolPromise;
  return (rows.length ? rows : fallback ? CATALOG : []).slice(0, safeLimit);
}

// Inventory-representation support: count discoverable items carrying any of
// the given brain tags. In Postgres this is a predicate COUNT that mirrors
// isDiscoverableProduct exactly — hidden, sold, removed, or unavailable rows
// can never inflate an inventory-confidence claim — and no row set crosses
// into application memory. The mem fallback filters the shared pool; the demo
// catalog never counts toward confidence (fallback: false).
export async function countDiscoverableProductsByTags(tagKeys = []) {
  const keys = [...new Set(tagKeys.map((tag) => String(tag || "").trim().toUpperCase()).filter(Boolean))].slice(0, 24);
  if (!keys.length) return 0;
  const p = await getPool();
  if (p) {
    // Code may deploy before v62. Keep the historical count usable until the
    // additive native columns exist; once present, mirror the integer-stock
    // predicate exactly.
    const hasNativeInventory = await hasColumns(p, "items", ["commerce_rail", "inventory_available"]);
    const nativeInventoryPredicate = hasNativeInventory
      ? `AND (commerce_rail IS DISTINCT FROM 'native_storefront'
              OR (inventory_available IS NOT NULL AND inventory_available > 0))`
      : "";
    const { rows } = await p.query(
      `SELECT count(*)::int AS matched FROM items
       WHERE COALESCE(moderation_status, 'visible') = 'visible'
         AND is_available IS DISTINCT FROM false
         AND COALESCE(availability_status, 'unknown') NOT IN ('sold', 'removed', 'unavailable')
         ${nativeInventoryPredicate}
         AND tags ?| $1::text[]`,
      [keys]
    );
    return rows[0]?.matched || 0;
  }
  const pool = await getDiscoverablePool({ fallback: false });
  return pool.filter((item) => keys.some((tag) => (item.tags || {})[tag])).length;
}

// One database round trip for the whole set, not one per id (audit #10): the
// old shape awaited resolveProduct per id, so a 60-id /api/interaction request
// became 60 primary-key queries — 12 sequential waves against the shipped max:5
// pool — plus a fallback pool probe for every id that missed.
export async function resolveProducts(ids = []) {
  const unique = [...new Set(ids.map((id) => text(id, 80)).filter(Boolean))];
  if (!unique.length) return new Map();
  const found = await getItems(unique);

  const out = new Map();
  const missing = [];
  for (const id of unique) {
    const item = found.get(id);
    if (!item) { missing.push(id); continue; }
    // A hidden, sold or unavailable row resolves to nothing and does NOT fall
    // through to the synthetic catalog — it exists, it is just not offerable.
    if (isDiscoverableProduct(item)) out.set(id, productSnapshot(item));
  }

  // Synthetic inventory is a keyless/empty-catalog fallback. Once any live
  // inventory exists, guessed syn-* ids must not re-enter mutation paths. The
  // pool is probed ONCE for the batch rather than once per missing id.
  if (missing.length) {
    const livePool = await getDiscoverablePool({ fallback: false });
    if (!livePool.length) {
      for (const id of missing) {
        const snapshot = productSnapshot(getCatalogItem(id));
        if (snapshot) out.set(id, snapshot);
      }
    }
  }
  return out;
}

// Single-id resolution, delegated so the two paths cannot come to disagree
// about what "resolvable" means — the divergence that put `consented` on
// Postgres only was the same shape of bug.
export async function resolveProduct(id) {
  const key = text(id, 80);
  if (!key) return null;
  return (await resolveProducts([key])).get(key) || null;
}

// Popularity counters change slowly relative to feed traffic, but the raw
// read is a full ORDER BY eng sort of the table on every request. Same
// deal as the product pool: one short-lived per-instance snapshot.
let popularityCache = null;
let popularityCacheAt = 0;
let popularityPromise = null;
const POPULARITY_TTL_MS = 15_000;

/**
 * Popularity counters, cached for 15 seconds and SHARED between concurrent
 * callers.
 *
 * The in-flight promise is the important half: without it a burst of feed
 * requests on a cold cache each start their own read. One request pays, the
 * rest await the same promise.
 */
export async function getPopularitySnapshot() {
  const now = Date.now();
  if (popularityCache && now - popularityCacheAt < POPULARITY_TTL_MS) return popularityCache;
  if (!popularityPromise) {
    popularityPromise = (async () => {
      popularityCache = await getPopularity();
      popularityCacheAt = Date.now();
      return popularityCache;
    })().finally(() => { popularityPromise = null; });
  }
  return popularityPromise;
}
