// Dense per-piece tagging — 20-30 typed tags per item, every one derived from
// a REAL product field. Nothing here invents attributes: a material tag exists
// only if the material word is literally in the title; an adjacent aesthetic
// is the brain's own affinity matrix applied to the item's own vector, capped
// and labeled as derived. The brain's 10-tag space is untouched — this layer
// densifies product_tags (the typed search/discovery layer from schema-v2)
// and sharpens item vectors at the feed seam, never inside lib/brain.

import { TAGS, tagSim } from "../brain/tags.js";
import { facetOf } from "./vocabulary.js";
import { kbResolve } from "../brain/kb.js";

export const DENSE_TAG_SOURCE = "dense-v1";

// Materials tagged ONLY when the word appears in the item title itself.
export const MATERIALS = new Set([
  "leather", "suede", "denim", "wool", "mohair", "cashmere", "cotton", "silk",
  "satin", "velvet", "nylon", "mesh", "canvas", "corduroy", "shearling",
  "tweed", "linen", "jersey", "lace", "patent", "gore-tex", "down", "fleece",
  "ripstop", "seersucker", "poplin", "twill", "flannel", "crochet", "knit",
]);

const STOPWORDS = new Set(["the", "a", "an", "with", "and", "for", "of", "in"]);

const ADJACENT_FLOOR = 0.25;  // weakest primary-times-affinity signal worth a row
const ADJACENT_SCALE = 0.6;   // derived confidence stays below its primary

const slug = (value) => String(value ?? "").trim().toLowerCase()
  .replace(/\s+/g, "-").replace(/[^a-z0-9/-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const round2 = (n) => Math.round(n * 100) / 100;

/** The band a price falls in, so a query can ask about LEVEL without a number
 *  ("something under 150", "archive money"). Null for a missing or negative
 *  price — a piece with no price has no band, and 0 is not "cheap". */
export function priceBand(price) {
  if (typeof price !== "number" || !(price >= 0)) return null;
  if (price < 150) return "under-150";
  if (price < 400) return "150-400";
  if (price < 900) return "400-900";
  return "900-plus";
}

// WHAT WAS WRONG (Aug 8, codebase audit). This inverted the sign convention
// that lib/brain/sizing.js owns and displays. sizing.js is the producer of
// runsBias and its user-facing phrase reads:
//
//   if (sizeRec.runsBias > 0) return base + " · runs small";
//   if (sizeRec.runsBias < 0) return base + " · runs large";
//
// POSITIVE means runs SMALL. The BRAND_BIAS table agrees with the world:
// Prada / Miu Miu / Jil Sander / Undercover are +1 and genuinely run small;
// Kapital / Fear of God / ERL / Lemaire are -1 and genuinely run large.
//
// This function returned the opposite of both, so the dense `fit` tag
// contradicted the size note on the very same product: a shopper filtering
// "runs-small" was served the oversized brands, and the product card told them
// the reverse.
export function fitLabel(runsBias) {
  if (typeof runsBias !== "number") return null;
  if (runsBias > 0) return "runs-small";
  if (runsBias < 0) return "runs-large";
  return "true-to-size";
}

// Tokens from the descriptor half of "Brand — descriptor garment" titles
// (whole title when there is no dash). Case-folded, stopword-stripped.
export function titleTokens(title) {
  const raw = String(title ?? "");
  const dash = raw.indexOf("—");
  const desc = (dash >= 0 ? raw.slice(dash + 1) : raw).toLowerCase();
  const tokens = desc.split(/[^a-z0-9-]+/).map((t) => t.replace(/^-+|-+$/g, ""));
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// The full dense row set for one catalog/DB item. Deterministic: same item in,
// same rows out, ordered by (tag_type, tag).
export function denseTagsForItem(item = {}) {
  const rows = new Map(); // key `${type} ${tag}` -> row, max confidence wins
  const push = (tag, rawType, confidence) => {
    if (!tag) return;
    // THROUGH THE VOCABULARY, ALWAYS. A facet nobody defined is dropped at the
    // door rather than landing in the table to be scored at an accidental
    // weight for the rest of its life — see lib/tagging/vocabulary.js.
    const tagType = facetOf(rawType);
    if (!tagType) return;
    const key = `${tagType} ${tag}`;
    const conf = round2(Math.max(0.05, Math.min(1, confidence)));
    const prior = rows.get(key);
    if (!prior || prior.confidence < conf) rows.set(key, { tag, tagType, confidence: conf, source: DENSE_TAG_SOURCE });
  };

  // Aesthetics: the item's own brain vector, plus one-hop affinity bleed
  // explicitly typed as derived.
  const vec = item.tags && typeof item.tags === "object" ? item.tags : {};
  const primaries = Object.entries(vec).filter(([t, w]) => TAGS.includes(t) && typeof w === "number" && w > 0);
  for (const [t, w] of primaries) push(t.toLowerCase(), "aesthetic", w);
  for (const t of TAGS) {
    if (vec[t]) continue;
    let best = 0;
    for (const [p, w] of primaries) best = Math.max(best, tagSim(p, t) * w);
    if (best >= ADJACENT_FLOOR) push(t.toLowerCase(), "aesthetic-adjacent", best * ADJACENT_SCALE);
  }

  // Title tokens: literal material words become material tags, the rest of
  // the descriptor becomes garment tags.
  for (const tok of titleTokens(item.title)) {
    if (MATERIALS.has(tok)) push(tok, "material", 0.9);
    else push(tok, "garment", 0.8);
  }

  push(slug(item.brand), "brand", 1);
  for (const d of Array.isArray(item.designers) ? item.designers : []) {
    const s = slug(d);
    if (s && s !== slug(item.brand)) push(s, "designer", 0.9);
  }
  // Brand-implied aesthetics from the brain's own knowledge base, typed as
  // derived — most valuable exactly where an item's vector is thin.
  const kbBrand = kbResolve(String(item.brand ?? "").toLowerCase());
  for (const t of kbBrand?.tags || []) {
    if (TAGS.includes(t) && !vec[t]) push(t.toLowerCase(), "aesthetic-brand", 0.5);
  }
  push(slug(item.category), "category", 1);

  const era = item.era && typeof item.era === "object" ? item.era : {};
  push(slug(era.decade), "decade", 1);
  push(slug(era.season), "season", 0.9);
  if (era.year) push(String(era.year), "year", 0.8);
  // Collection tags: the archival query surface ("fw15", "fall-winter-2015").
  if (era.season && era.year) {
    const seasonSlug = slug(era.season);
    push(`${seasonSlug}-${era.year}`, "collection", 0.9);
    const short = { "fall/winter": "fw", "spring/summer": "ss" }[String(era.season).toLowerCase()];
    if (short) push(`${short}${String(era.year).slice(-2)}`, "collection", 0.9);
  }
  // Seasonal-weight class, derived from the collection season.
  const climate = { "fall/winter": "cold-weather", "pre-fall": "cold-weather",
    "spring/summer": "warm-weather", "resort": "warm-weather" }[String(era.season ?? "").toLowerCase()];
  push(climate, "climate", 0.8);

  const size = item.size && typeof item.size === "object" ? item.size : {};
  push(slug(size.gender), "gender", 1);
  push(slug(size.label), "size", 0.9);
  push(slug(size.system), "size-system", 0.8);
  push(fitLabel(size.runsBias), "fit", 0.9);
  push(priceBand(item.price), "price-band", 1);

  return [...rows.values()].sort((a, b) =>
    a.tagType === b.tagType ? (a.tag < b.tag ? -1 : 1) : (a.tagType < b.tagType ? -1 : 1));
}

// Item-side vector enrichment for the feed seam (PR #51's capped-bleed rule,
// applied to the item instead of the query): primaries are untouched, an
// absent tag gains at most half its strongest primary-times-affinity signal,
// and nothing below ADJACENT_FLOOR lands at all. Alpha similarity gets more
// resolution; no item changes aesthetic identity.
export function enrichItemVec(vec = {}) {
  const primaries = Object.entries(vec).filter(([t, w]) => TAGS.includes(t) && typeof w === "number" && w > 0);
  if (!primaries.length) return { ...vec };
  const out = { ...vec };
  for (const t of TAGS) {
    if (out[t]) continue;
    let best = 0;
    for (const [p, w] of primaries) best = Math.max(best, tagSim(p, t) * w);
    if (best >= ADJACENT_FLOOR) out[t] = round2(best * 0.5);
  }
  return out;
}
