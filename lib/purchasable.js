// lib/purchasable.js — THE checkout honesty gate, extracted to a pure,
// dependency-light module so lib/products.js can stamp the public
// `purchasable` flag without a products↔orders import cycle. One rule,
// every door: operator intake, Shopify import, checkout itself, and the
// public payload all call THIS function. Client-safe (pure + lib/url).
//
// null = purchasable; otherwise the honest reason the reader is told.

import { safeExternalUrl } from "./url.js";
import { isNativeStorefrontItem } from "./storefront/catalog.js";

/**
 * WHY this piece cannot be bought, or null when it can.
 *
 * The single checkout honesty gate — operator intake, Shopify import, checkout
 * itself and the public payload all call THIS, so a piece cannot look buyable
 * on one surface and be refused by another.
 *
 * Returns a SENTENCE FOR THE READER, not a code: a demo archive record says it
 * is one, rather than failing at the payment step as though something broke.
 */
export function refusalReason(item) {
  if (!item) return "product not found";
  if (isNativeStorefrontItem(item)) {
    const available = Number(item.inventory_available);
    if ((item.availability_status || "unknown") !== "available") {
      return `availability is "${item.availability_status || "unknown"}", not "available"`;
    }
    if (!Number.isSafeInteger(available) || available <= 0) {
      return "native availability has no units remaining";
    }
    if (item.native_checkout_ready !== true) {
      return "native checkout is not enabled for this seller";
    }
    const priceCents = Number(item.price_cents);
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return "no authoritative price on record";
    return null;
  }
  const sourceName = item.source_name || item.source || "seed";
  const sourceUrl = safeExternalUrl(item.source_product_url || item.url);
  if (!sourceUrl || sourceName.includes("seed") || sourceName === "Asilum synthetic seed") {
    return "demo archive record — real checkout opens with the designer program";
  }
  if ((item.availability_status || "unknown") !== "available") {
    return `availability is "${item.availability_status || "unknown"}", not "available"`;
  }
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return "no real price on record";
  return null;
}
