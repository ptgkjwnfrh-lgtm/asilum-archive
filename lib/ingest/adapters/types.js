// lib/ingest/adapters/types.js
// Source adapter contract (JSDoc — this codebase is plain JS; the entity shapes
// set the precedent). Every marketplace adapter implements the same interface
// so the app never cares where a product came from.
//
// HONESTY RULE (constitution): an adapter without official API access is
// DISABLED — it reports why and returns empty results. It never scrapes,
// never fakes data, never pretends a partnership exists.

/**
 * @typedef {Object} RawSourceProduct   Anything the source API returns.
 *
 * @typedef {Object} NormalizedProduct  The ASILUM product shape (items table).
 * @property {string} id                 asilum id: `${source}-${sourceProductId}`
 * @property {string} source_name
 * @property {string} source_product_id
 * @property {string|null} source_product_url
 * @property {string} title
 * @property {string} brand
 * @property {number|null} price
 * @property {string} currency
 * @property {Object} tags               brain tag vector (inferTags)
 * @property {Array}  typedTags          [{tag, tagType, confidence, source}]
 * @property {string[]} images
 * @property {string|null} category
 * @property {string|null} subcategory
 * @property {string|null} color
 * @property {string[]} colors             merchant + image verified only
 * @property {Object|null} colorEvidence   auditable verification details
 * @property {string|null} material
 * @property {string|null} condition
 * @property {Object|null} size             normalized size, measurements, provenance
 * @property {Object|null} era
 * @property {string|null} decade
 * @property {boolean} is_available
 * @property {string} availability_status
 *
 * @typedef {Object} SourceAdapter
 * @property {() => string} getSourceName
 * @property {() => {enabled: boolean, status: string, needs: string}} enabled
 * @property {(query: string, filters?: Object) => Promise<NormalizedProduct[]>} searchProducts
 * @property {(sourceProductId: string) => Promise<NormalizedProduct|null>} fetchProductById
 * @property {(sourceProductId: string) => Promise<{availability_status: string, price?: number|null, source_response_status?: number|null}>} checkAvailability
 * @property {(raw: RawSourceProduct) => NormalizedProduct} normalizeSourceProduct
 * @property {(opts?: Object) => Promise<{sourceName: string, enabled: boolean, itemsSeen: number, itemsUpserted: number, status: string}>} syncProducts
 */

// Availability vocabulary shared by adapters + availability service.
export const AVAILABILITY = [
  "available", "sold", "removed", "price_changed", "source_unavailable", "unknown",
];

// Builds an honest disabled adapter for a source ASILUM doesn't yet have
// official access to. All methods no-op gracefully; nothing crashes.
export function disabledAdapter(sourceName, needs) {
  const state = { enabled: false, status: "awaiting_keys_or_approval", needs };
  return {
    getSourceName: () => sourceName,
    enabled: () => state,
    async searchProducts() { return []; },
    async fetchProductById() { return null; },
    async checkAvailability() { return { availability_status: "source_unavailable" }; },
    normalizeSourceProduct(raw) { return raw; }, // real mapping lands with API access
    async syncProducts() {
      return { sourceName, enabled: false, itemsSeen: 0, itemsUpserted: 0, status: "disabled" };
    },
  };
}
