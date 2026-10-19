// lib/storefront/flags.js — rollout and money kill switches.
// UI/draft work is useful keyless. Every operation that can move money is
// opt-in, durable-only, mode-checked, and live mode additionally requires the
// named test-validation artifact. Turning checkout off does not affect reads,
// webhooks, refunds or reconciliation of existing attempts.

export const STOREFRONT_PAYMENT_VALIDATION_VERSION = "stripe-connect-direct-v1-2026-10-03";

function onByDefault(value) { return value !== "0" && value !== "false"; }
function explicitlyOn(value) { return value === "1" || value === "true"; }

export function stripeSecretMode(secret = "") {
  if (!secret) return "unconfigured";
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return "invalid";
}

export function storefrontRuntimeFlags(env = process.env) {
  const surfaceEnabled = onByDefault(env.STOREFRONT_ENABLED);
  const listingWritesEnabled = surfaceEnabled && onByDefault(env.NATIVE_LISTINGS_ENABLED);
  const mode = stripeSecretMode(env.STRIPE_SECRET_KEY || "");
  const durable = Boolean(env.DATABASE_URL);
  const requested = explicitlyOn(env.NATIVE_CHECKOUT_ENABLED);
  const validationCurrent = env.STOREFRONT_PAYMENT_VALIDATION_VERSION === STOREFRONT_PAYMENT_VALIDATION_VERSION;
  const liveAuthorized = mode === "live"
    && explicitlyOn(env.STRIPE_CONNECT_LIVE_ENABLED)
    && validationCurrent;
  const testAuthorized = mode === "test";
  const checkoutEnabled = surfaceEnabled && requested && durable && (testAuthorized || liveAuthorized);
  const feeCollectionEnabled = checkoutEnabled
    && explicitlyOn(env.STOREFRONT_FEE_COLLECTION_ENABLED)
    && validationCurrent;
  const reasons = [];
  if (!surfaceEnabled) reasons.push({ code: "surface_off", message: "Storefront is off by configuration." });
  if (surfaceEnabled && !listingWritesEnabled) reasons.push({ code: "writes_off", message: "Storefront drafts are read-only right now." });
  if (!requested) reasons.push({ code: "checkout_off", message: "Native checkout is off until payment validation is complete." });
  else if (!durable) reasons.push({ code: "durable_store_required", message: "Native checkout requires the durable order and inventory store." });
  else if (mode === "unconfigured") reasons.push({ code: "stripe_unconfigured", message: "Payment processing is not configured." });
  else if (mode === "invalid") reasons.push({ code: "stripe_key_invalid", message: "Payment processing key mode is not recognized." });
  else if (mode === "live" && !liveAuthorized) reasons.push({ code: "live_not_authorized", message: "Live Storefront money is locked pending explicit authorization and current test validation." });
  if (!feeCollectionEnabled) reasons.push({ code: "fee_collection_off", message: "The one-time storefront fee is not being collected; its balance carries forward." });
  return Object.freeze({
    surfaceEnabled,
    listingWritesEnabled,
    checkoutEnabled,
    checkoutMode: checkoutEnabled ? mode : "off",
    feeCollectionEnabled,
    durable,
    validationCurrent,
    reasons,
  });
}
