// lib/storefront/catalog.js — the explicit first-party catalog discriminator.
// A missing external URL is NEVER enough to make a row native. Only the
// server-owned projection written by the Storefront service carries all three
// markers, which keeps imported and sample records on their existing rails.

export const NATIVE_STOREFRONT_RAIL = "native_storefront";
export const NATIVE_STOREFRONT_SOURCE = "asilum-native";

export function isNativeStorefrontItem(item) {
  return !!item
    && item.commerce_rail === NATIVE_STOREFRONT_RAIL
    && item.source_name === NATIVE_STOREFRONT_SOURCE
    && typeof item.native_listing_id === "string"
    && item.native_listing_id.length > 0;
}
