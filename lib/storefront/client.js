// lib/storefront/client.js — THE ONE WAY A SURFACE OPENS NATIVE CHECKOUT
// (V.2 slice 6, over codex/native-storefront). Client-safe.
//
// The bag popup, the LISTING popup and the Discover page used to carry
// three copies of the same forty lines: build an idempotency key per
// (item, variant, quantity), POST /api/checkout, refuse anything that is
// not a native Storefront answer, refuse any address that is not Stripe's
// hosted checkout, assign. One copy now. The server re-resolves price,
// stock, seller and policy; nothing here is payment authority.
//
// The key is stable per logical request for the life of the page: a retry
// after an interrupted response carries the same key, and a changed
// quantity is a different request.

import { postJSON, newOperationId } from "../client.js";

const keys = new Map();

export const NATIVE_RAIL = "native_storefront";
export const NOT_ENABLED = "Native Storefront checkout is not enabled for this seller yet.";

/** Is this record a native Storefront listing (the server-stamped projection)? */
export function isNativeItem(item) {
  return !!item && item.commerce_rail === NATIVE_RAIL;
}

/** The stable idempotency key for one logical checkout request. */
export function checkoutKeyFor(item, { variantId = null, quantity = 1 } = {}) {
  const operation = `${item.id}:${variantId || item.default_variant_id || "default"}:${quantity}`;
  let key = keys.get(operation);
  if (!key) { key = newOperationId(); keys.set(operation, key); }
  return key;
}

/**
 * Open native checkout for one item. Resolves `{ ok: true, url, quote }`
 * after assigning the location, or `{ ok: false, error }` with the server's
 * own words. `user` is the caller's uid (the server resolves the real
 * identity from the request; the uid is the legacy body field it expects).
 */
export async function startNativeCheckout(item, { user = null, variantId = null, quantity = 1, navigate = true } = {}) {
  if (!isNativeItem(item)) return { ok: false, error: "not a native Storefront listing" };
  if (item.native_checkout_ready !== true) return { ok: false, error: NOT_ENABLED };
  const qty = Math.max(1, Math.min(25, Math.trunc(Number(quantity)) || 1));
  const idempotencyKey = checkoutKeyFor(item, { variantId, quantity: qty });
  try {
    const response = await postJSON("/api/checkout", {
      user, itemId: item.id, variantId: variantId || item.default_variant_id || null, quantity: qty, idempotencyKey,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || "Native checkout is unavailable.", status: response.status };
    if (body.commerceRail !== NATIVE_RAIL) return { ok: false, error: "The server did not return a native Storefront checkout." };
    let target;
    try { target = new URL(String(body.url || "")); } catch { target = null; }
    if (!target || target.protocol !== "https:" || target.hostname !== "checkout.stripe.com") {
      return { ok: false, error: "The payment provider returned an unsafe checkout address." };
    }
    if (navigate && typeof window !== "undefined") window.location.assign(target.href);
    return { ok: true, url: target.href, quote: body.quote || null };
  } catch (error) {
    return { ok: false, error: error?.message || "Native checkout is unavailable." };
  }
}
