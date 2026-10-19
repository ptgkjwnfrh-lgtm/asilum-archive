// lib/storefront/contracts.js — client-safe native Storefront contracts.
// Product facts are explicit; missing facts stay missing. No category borrows
// garment-only fields and no seller claim is silently promoted to verified.

export const STOREFRONT_TERMS_VERSION = "storefront-terms-v1-2026-10-02";
export const STOREFRONT_STATES = Object.freeze(["draft", "pending_review", "active", "paused", "archived", "rejected"]);
export const LISTING_STATES = Object.freeze(["draft", "pending_review", "active", "paused", "sold_out", "archived", "rejected"]);
export const STOREFRONT_CATEGORIES = Object.freeze([
  { id: "clothing", label: "Clothing" },
  { id: "jewelry", label: "Jewelry" },
  { id: "posters_prints", label: "Posters & prints" },
  { id: "furniture", label: "Furniture" },
  { id: "electronics_tech", label: "Tech & electronics" },
  { id: "ornaments_home", label: "Ornaments & home objects" },
  { id: "other", label: "Other permitted physical goods" },
]);
export const STOREFRONT_CATEGORY_IDS = new Set(STOREFRONT_CATEGORIES.map((category) => category.id));

const ATTRIBUTE_KEYS = Object.freeze({
  clothing: new Set(["size", "fit", "silhouette", "material", "color"]),
  jewelry: new Set(["material", "dimensions", "ring_size", "stone", "color"]),
  posters_prints: new Set(["dimensions", "medium", "edition", "framed"]),
  furniture: new Set(["dimensions", "material", "weight", "assembly", "color"]),
  electronics_tech: new Set(["model", "compatibility", "specifications", "power", "condition"]),
  ornaments_home: new Set(["dimensions", "material", "weight", "color"]),
  other: new Set(["dimensions", "material", "specifications", "color"]),
});

export function plainText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function storefrontSlug(value) {
  return plainText(value, 80).toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
}

export function safePublicImageUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" ? parsed.toString().slice(0, 1000) : null;
  } catch { return null; }
}

export function normalizeCategoryAttributes(category, attributes) {
  if (!STOREFRONT_CATEGORY_IDS.has(category)) throw new TypeError("unsupported product category");
  if (attributes == null) return {};
  if (typeof attributes !== "object" || Array.isArray(attributes)) throw new TypeError("attributes must be an object");
  const allowed = ATTRIBUTE_KEYS[category];
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(attributes).slice(0, 16)) {
    const key = String(rawKey).toLowerCase();
    if (!allowed.has(key) || rawValue == null || rawValue === "") continue;
    if (!["string", "number", "boolean"].includes(typeof rawValue)) continue;
    out[key] = typeof rawValue === "string" ? plainText(rawValue, 240) : rawValue;
  }
  return out;
}

export function normalizeStorefrontInput(input = {}) {
  const name = plainText(input.name, 80);
  if (name.length < 2) throw new TypeError("store name must be at least 2 characters");
  const slug = storefrontSlug(input.slug || name);
  if (slug.length < 2) throw new TypeError("store name needs letters or numbers");
  return {
    name,
    slug,
    description: plainText(input.description, 600),
    imageUrl: safePublicImageUrl(input.imageUrl),
    bannerUrl: safePublicImageUrl(input.bannerUrl),
  };
}

export function normalizeListingInput(input = {}) {
  const title = plainText(input.title, 160);
  if (title.length < 2) throw new TypeError("product title must be at least 2 characters");
  const category = String(input.category || "").toLowerCase();
  if (!STOREFRONT_CATEGORY_IDS.has(category)) throw new TypeError("unsupported product category");
  const priceCents = Number(input.priceCents);
  const quantity = Number(input.quantity);
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new TypeError("price must be positive integer cents");
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new TypeError("quantity must be a non-negative integer");
  const currency = String(input.currency || "usd").toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new TypeError("currency must be a lowercase ISO code");
  return {
    title,
    description: plainText(input.description, 2_000),
    category,
    subcategory: plainText(input.subcategory, 80) || null,
    priceCents,
    currency,
    quantity,
    sku: plainText(input.sku, 80) || null,
    imageUrl: safePublicImageUrl(input.imageUrl),
    fulfillment: ["shipping", "pickup", "shipping_or_pickup"].includes(input.fulfillment)
      ? input.fulfillment : "shipping",
    attributes: normalizeCategoryAttributes(category, input.attributes),
  };
}

export function publicStorefront(storefront) {
  if (!storefront) return null;
  return {
    slug: storefront.slug,
    name: storefront.name,
    description: storefront.description || "",
    imageUrl: storefront.image_url || storefront.imageUrl || null,
    bannerUrl: storefront.banner_url || storefront.bannerUrl || null,
    state: storefront.state,
  };
}
