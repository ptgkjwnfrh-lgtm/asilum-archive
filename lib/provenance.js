// lib/provenance.js — DOES ANYBODY BACK THIS, OR DID A SELLER SAY IT?
//
// Owner ruling, 27 August 2026, on Taobao and every marketplace like it:
// **ingest it, label it, do not hide it.** This module is that ruling as one
// function, so the answer cannot differ between two surfaces.
//
// THE THING BEING LABELLED IS NOT QUALITY. A marketplace piece is not worse
// than a merchant one — it is LESS KNOWN, and that is a different claim. A
// Taobao listing that says "Balenciaga" is a seller typing a word. A piece
// from a merchant we hold an agreement with is a name somebody stands behind.
// Both may be shown. Only one may be presented as fact.
//
// THIS IS ASTERISK'S FIRST LAW AT THE CATALOG BOUNDARY. ASTERISK may only
// reason from what it can point at, so a brand it cannot back is recorded as a
// CLAIM and never as a fact — see `brandIsClaim` below, which is what stops an
// unverified word being scored as though it were verified.
//
// VERIFICATION IS EARNED, SO THE DEFAULT IS "UNVERIFIED". An unrecognised
// source is not given the benefit of the doubt; a source only counts as backed
// when it appears in AUTHORIZED_SOURCES because a real agreement exists. That
// direction matters: the failure mode of guessing "verified" is telling a
// reader something is genuine when nobody checked.
//
// Client-safe: pure, no database, no imports beyond lib/url.

import { safeExternalUrl } from "./url.js";
import { isNativeStorefrontItem } from "./storefront/catalog.js";

/** A piece nobody backs, because it is not real inventory at all. */
export const DEMO = "demo";
/** Real inventory, from a source under a real agreement. */
export const VERIFIED = "verified";
/** Real inventory whose brand is the SELLER'S CLAIM. The default. */
export const UNVERIFIED = "unverified";

/**
 * Sources under an agreement that makes the seller who they say they are.
 *
 * A merchant grants Storefront access, or approves ASILUM explicitly. That is
 * a person accepting terms, which is what "verified" means here — it is NOT a
 * claim that any individual garment has been authenticated. Nothing in ASILUM
 * authenticates a garment.
 */
const AUTHORIZED_SOURCES = new Set(["shopify", "woocommerce"]);

/**
 * Marketplaces and proxies. Anyone may list anything, so the brand on the
 * listing is a claim. Named explicitly for the reader's sake — "listed on
 * Taobao" is a more useful sentence than "unverified source".
 */
const MARKETPLACE_SOURCES = new Map([
  ["taobao", "Taobao"],
  ["yahoo-auctions", "Yahoo! JAPAN Auctions"],
  ["mercari", "Mercari Japan"],
  ["rakuma", "Rakuma"],
  ["buyee", "Buyee"],
  ["zenmarket", "ZenMarket"],
  ["ebay", "eBay"],
]);

const key = (item) =>
  String(item?.source_name ?? item?.source ?? "").trim().toLowerCase();

/** Nothing real behind it: no live link, or a source that names itself a seed. */
function looksSynthetic(item) {
  const url = safeExternalUrl(item?.source_product_url || item?.url);
  if (!url) return true;
  const name = key(item);
  return !name || name.includes("seed") || name.includes("demo") || name.includes("synthetic");
}

/**
 * What backs this piece: `{ status, sourceLabel, brandIsClaim, note }`.
 *
 * `brandIsClaim` is the field with teeth. When it is true the brand on the
 * record is a seller's word, and no surface may present it as established —
 * not the UI, and not ASTERISK's scoring.
 *
 * `note` is the sentence to SHOW. It is never null for an unlabelled state,
 * because the ruling is that this is not hidden.
 */
export function originEvidence(item) {
  if (!item) {
    return { status: DEMO, sourceLabel: null, brandIsClaim: true,
      note: "no record" };
  }
  if (isNativeStorefrontItem(item)) {
    return {
      status: UNVERIFIED,
      sourceLabel: item.storefront_name || item.storefront_slug || "ASILUM Storefront",
      brandIsClaim: true,
      note: "native ASILUM listing — product details are the seller's description, not facts ASILUM has independently verified.",
    };
  }
  if (looksSynthetic(item)) {
    return { status: DEMO, sourceLabel: null, brandIsClaim: true,
      note: "sample record — not real inventory, not for sale" };
  }
  const name = key(item);
  if (AUTHORIZED_SOURCES.has(name)) {
    return { status: VERIFIED, sourceLabel: item.source || item.source_name,
      brandIsClaim: false,
      note: "listed by a merchant under agreement with ASILUM" };
  }
  const marketplace = MARKETPLACE_SOURCES.get(name);
  return {
    status: UNVERIFIED,
    sourceLabel: marketplace || item.source || item.source_name || null,
    brandIsClaim: true,
    note: marketplace
      ? `unverified origin — listed on ${marketplace} by a seller. `
        + "The brand is their description, not a fact ASILUM has checked."
      : "unverified origin — the brand is the seller's description, "
        + "not a fact ASILUM has checked.",
  };
}

/** Shorthand: may this piece's brand be treated as established? */
export function brandIsEstablished(item) {
  return originEvidence(item).status === VERIFIED;
}

// ---- how much is riding on the claim? --------------------------------------
//
// OWNER RULING, 27 August 2026, and it is the sharper of the two:
//
//   "the avid consumer doesnt really care if its real if it looks cool at a
//    good price its being bought. if it is highly priced comparitivley to
//    construction, brand socially viewed value, matreial used, associated hype
//    then the verifcation is needed because multiple factors are at play for
//    my choice to buy it."
//
// So verification is not a constant worry — it scales with what is riding on
// it. At £20 a person is buying an OBJECT and the label is a footnote. At £900
// they are substantially buying a NAME, and the name is the part nobody
// checked. The signal should be quiet in the first case and unmissable in the
// second, and unverified stock is NEVER DEMOTED for it — the owner ruled that
// separately, and demotion is a soft form of hiding.
//
// WHAT THIS DOES NOT YET KNOW, said plainly. The ruling says "highly priced
// COMPARATIVELY TO construction, brand value, material, hype". We cannot
// compute that today — it needs the comparables model
// (ROADMAP §4.6: same brand, garment, era and condition, drawn from our own
// history, and silent below n=3). Until that exists, absolute price is the
// honest proxy: it is a real number we hold, it moves the right way, and it
// does not pretend to be the comparison the owner actually described.
//
// When comparables land, `stakeOf` gains a second input and the thresholds
// below become the fallback for pieces with too few comparables to speak.
//
// These bands are deliberately NOT lib/tagging/dense.js `priceBand`. That one
// answers a search question ("show me things under 150"). This answers a
// different one — how much of this price rests on a word nobody verified — and
// the two must be free to move apart.

const STAKE_MATERIAL_AT = 150;   // above pocket-money: the claim starts to matter
const STAKE_HIGH_AT = 600;       // the name is now most of what is being bought

/** Nothing is riding on it: the source is backed, or it is not real stock. */
export const STAKE_NONE = "none";
/** Cheap enough that the piece is bought for itself. */
export const STAKE_LOW = "low";
/** The claim is part of the reason for the price. */
export const STAKE_MATERIAL = "material";
/** The claim IS the price. */
export const STAKE_HIGH = "high";

/**
 * How loudly should this piece's provenance speak? `{ level, why }`.
 *
 * A backed piece and a sample both return STAKE_NONE — for opposite reasons,
 * and neither needs a warning: one is vouched for, the other is openly not for
 * sale.
 *
 * Price is read defensively. A missing or unreadable price returns
 * STAKE_MATERIAL rather than STAKE_LOW, because "we do not know what it costs"
 * is not a reason to reassure somebody.
 */
export function stakeOf(item) {
  const evidence = originEvidence(item);
  if (evidence.status === VERIFIED) {
    return { level: STAKE_NONE, why: "a merchant stands behind this listing" };
  }
  if (evidence.status === DEMO) {
    return { level: STAKE_NONE, why: "a sample record, not for sale" };
  }
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { level: STAKE_MATERIAL, why: "no price on record to weigh the claim against" };
  }
  if (price < STAKE_MATERIAL_AT) {
    return { level: STAKE_LOW,
      why: "at this price the piece is bought for itself, not for the name" };
  }
  if (price < STAKE_HIGH_AT) {
    return { level: STAKE_MATERIAL,
      why: "the brand is part of what this price is asking for, and it is unverified" };
  }
  return { level: STAKE_HIGH,
    why: "at this price the name is most of what is being bought — and nobody has checked it" };
}
