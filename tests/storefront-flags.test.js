import test from "node:test";
import assert from "node:assert/strict";
import {
  STOREFRONT_PAYMENT_VALIDATION_VERSION, storefrontRuntimeFlags,
} from "../lib/storefront/flags.js";

test("draft Storefront runs keyless while every money path defaults off", () => {
  const flags = storefrontRuntimeFlags({});
  assert.equal(flags.surfaceEnabled, true);
  assert.equal(flags.listingWritesEnabled, true);
  assert.equal(flags.checkoutEnabled, false);
  assert.equal(flags.feeCollectionEnabled, false);
  assert.equal(flags.checkoutMode, "off");
});

test("test checkout needs explicit switch and durable persistence", () => {
  const base = { NATIVE_CHECKOUT_ENABLED: "1", STRIPE_SECRET_KEY: "sk_test_redacted" };
  assert.equal(storefrontRuntimeFlags(base).checkoutEnabled, false);
  const ready = storefrontRuntimeFlags({ ...base, DATABASE_URL: "postgres://example.invalid/db" });
  assert.equal(ready.checkoutEnabled, true);
  assert.equal(ready.checkoutMode, "test");
  assert.equal(ready.feeCollectionEnabled, false, "collection is a separate gate");
});

test("live money and storefront fee collection require current validation and explicit gates", () => {
  const base = {
    NATIVE_CHECKOUT_ENABLED: "1", DATABASE_URL: "postgres://example.invalid/db",
    STRIPE_SECRET_KEY: "sk_live_redacted", STRIPE_CONNECT_LIVE_ENABLED: "1",
    STOREFRONT_FEE_COLLECTION_ENABLED: "1",
  };
  assert.equal(storefrontRuntimeFlags(base).checkoutEnabled, false);
  const ready = storefrontRuntimeFlags({
    ...base, STOREFRONT_PAYMENT_VALIDATION_VERSION,
  });
  assert.equal(ready.checkoutEnabled, true);
  assert.equal(ready.checkoutMode, "live");
  assert.equal(ready.feeCollectionEnabled, true);
});
