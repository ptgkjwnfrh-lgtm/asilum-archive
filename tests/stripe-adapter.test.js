// tests/stripe-adapter.test.js — no provider calls. The Stripe REST seam is
// exercised with a fetch double so account scope, idempotency and money shape
// are proved without confusing adapter proof with a real Connect transaction.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  STRIPE_API_VERSION,
  StripeApiError,
  createApplicationFeeRefund,
  createConnectedRefund,
  createNativeCheckoutSession,
  createRefund,
  retrieveApplicationFee,
  retrieveConnectedAccount,
  retrieveConnectedBalanceTransaction,
  retrieveConnectedCharge,
  retrieveConnectedCheckoutSession,
  retrieveConnectedPaymentIntent,
  stripeRequest,
} from "../lib/payments/stripe.js";

const ACCOUNT = "acct_1234567890ABCDEF";
const TEST_KEY = "sk_test_adapter_fixture_never_sent";

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockStripe(t, implementation) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = TEST_KEY;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  });
}

test("legacy calls stay platform-scoped and every request pins the API version", async (t) => {
  const calls = [];
  mockStripe(t, async (url, init) => {
    calls.push({ url, init });
    return json({ id: "pi_legacy123" });
  });

  await stripeRequest("GET", "/payment_intents/pi_legacy123");
  await createRefund("pi_legacy123");

  assert.equal(calls.length, 2);
  for (const { init } of calls) {
    assert.equal(init.headers.Authorization, `Bearer ${TEST_KEY}`);
    assert.equal(init.headers["Stripe-Version"], STRIPE_API_VERSION);
    assert.equal(init.headers["Stripe-Account"], undefined);
    assert.equal(init.headers["Idempotency-Key"], undefined);
  }
  assert.equal(STRIPE_API_VERSION, "2026-09-30.endive");
});

test("request options set connected scope, idempotency and an explicit supported version", async (t) => {
  let call;
  mockStripe(t, async (url, init) => {
    call = { url, init };
    return json({ id: "obj_123" });
  });

  await stripeRequest("POST", "/test_helpers/example", { one: 1 }, {
    account: ACCOUNT,
    idempotencyKey: "native:order:12345678",
    apiVersion: "2025-01-01.acacia",
  });

  assert.equal(call.init.headers["Stripe-Account"], ACCOUNT);
  assert.equal(call.init.headers["Idempotency-Key"], "native:order:12345678");
  assert.equal(call.init.headers["Stripe-Version"], "2025-01-01.acacia");
});

test("native Checkout shows only merchandise and the exact passenger-fee line", async (t) => {
  let call;
  mockStripe(t, async (url, init) => {
    call = { url, init };
    return json({ id: "cs_test_native123", livemode: false });
  });

  await createNativeCheckoutSession({
    orderId: "ord_native_123",
    itemId: "listing_123",
    title: "Chrome chair",
    merchandiseCents: 20_000,
    passengerFeeCents: 400,
    storefrontFeeCents: 3_000,
    currency: "usd",
    expiresAt: 1_791_072_000,
    origin: "https://www.asilummagazine.com",
    user: "sb-11111111-1111-4111-8111-111111111111",
    account: ACCOUNT,
    idempotencyKey: "native-checkout-ord-native-123",
  });

  assert.equal(call.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(call.init.headers["Stripe-Account"], ACCOUNT);
  assert.equal(call.init.headers["Idempotency-Key"], "native-checkout-ord-native-123");
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("allowed_payment_method_types[0]"), "card");
  assert.equal(body.get("expires_at"), "1791072000");
  assert.equal(body.get("line_items[0][price_data][product_data][name]"), "Chrome chair");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "20000");
  assert.equal(body.get("line_items[1][price_data][product_data][name]"), "ASILUM passenger fee");
  assert.equal(body.get("line_items[1][price_data][unit_amount]"), "400");
  assert.equal(body.get("line_items[2][price_data][unit_amount]"), null,
    "the $30 Storefront collection is never a buyer line");
  assert.equal(body.get("payment_intent_data[application_fee_amount]"), "3400");
  assert.equal(body.get("payment_intent_data[metadata][passenger_fee_cents]"), "400");
  assert.equal(body.get("payment_intent_data[metadata][storefront_fee_cents]"), "3000");
});

test("connected reads use the seller scope while account and application-fee reads stay platform-scoped", async (t) => {
  const calls = [];
  mockStripe(t, async (url, init) => {
    calls.push({ url, init });
    return json({ id: url.split("/").at(-1) });
  });

  await retrieveConnectedCheckoutSession("cs_test_123456", { account: ACCOUNT });
  await retrieveConnectedPaymentIntent("pi_123456789", { account: ACCOUNT });
  await retrieveConnectedCharge("ch_123456789", { account: ACCOUNT });
  await retrieveConnectedBalanceTransaction("txn_123456789", { account: ACCOUNT });
  await retrieveConnectedAccount(ACCOUNT);
  await retrieveApplicationFee("fee_123456789");

  assert.deepEqual(calls.slice(0, 4).map((call) => call.init.headers["Stripe-Account"]),
    [ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT]);
  assert.equal(calls[4].url.endsWith(`/accounts/${ACCOUNT}`), true);
  assert.equal(calls[4].init.headers["Stripe-Account"], undefined);
  assert.equal(calls[5].url.endsWith("/application_fees/fee_123456789"), true);
  assert.equal(calls[5].init.headers["Stripe-Account"], undefined);
});

test("connected customer refunds carry amount, application-fee reversal, scope and idempotency", async (t) => {
  const calls = [];
  mockStripe(t, async (url, init) => {
    calls.push({ url, init });
    return json({ id: calls.length === 1 ? "re_123456789" : "fr_123456789" });
  });

  await createConnectedRefund("pi_123456789", {
    account: ACCOUNT,
    idempotencyKey: "native-refund-order-12345678",
    amountCents: 515,
    refundApplicationFee: true,
  });
  await createApplicationFeeRefund("fee_123456789", {
    idempotencyKey: "native-fee-refund-order-12345678",
    amountCents: 115,
  });

  const customer = new URLSearchParams(calls[0].init.body);
  assert.equal(customer.get("payment_intent"), "pi_123456789");
  assert.equal(customer.get("amount"), "515");
  assert.equal(customer.get("refund_application_fee"), "true");
  assert.equal(calls[0].init.headers["Stripe-Account"], ACCOUNT);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "native-refund-order-12345678");

  const applicationFee = new URLSearchParams(calls[1].init.body);
  assert.equal(applicationFee.get("amount"), "115");
  assert.equal(calls[1].init.headers["Stripe-Account"], undefined,
    "application-fee refunds are platform operations");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "native-fee-refund-order-12345678");
});

test("invalid account and idempotency values fail before fetch", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    return json({});
  });

  await assert.rejects(
    () => stripeRequest("GET", "/charges/ch_123", null, { account: "acct_from-browser/other" }),
    /connected account must be an acct_ id/,
  );
  await assert.rejects(
    () => stripeRequest("POST", "/refunds", {}, { idempotencyKey: "contains a space" }),
    /idempotency key/,
  );
  await assert.rejects(
    () => stripeRequest("GET", "/charges/ch_123", null, { timeoutMs: 30_001 }),
    /timeout/,
  );
  assert.equal(calls, 0);
});

test("GET retries one network/transient response and then stops", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("socket closed");
    return json({ id: "pi_after_retry" });
  });
  assert.equal((await stripeRequest("GET", "/payment_intents/pi_after_retry")).id, "pi_after_retry");
  assert.equal(calls, 2);
});

test("GET retries one retryable provider status", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    if (calls === 1) return json({ error: { message: "temporarily unavailable" } }, { status: 503 });
    return json({ id: "pi_after_503" });
  });
  assert.equal((await stripeRequest("GET", "/payment_intents/pi_after_503")).id, "pi_after_503");
  assert.equal(calls, 2);
});

test("unsafe POST never retries a network failure", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    throw new TypeError("socket closed with secret-looking text");
  });
  await assert.rejects(
    () => stripeRequest("POST", "/payment_intents", { amount: 100 }),
    (error) => error instanceof StripeApiError
      && error.code === "network_error"
      && error.message === "Stripe network request failed",
  );
  assert.equal(calls, 1);
});

test("an idempotent POST retries one network failure with the same key", async (t) => {
  const keys = [];
  mockStripe(t, async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    if (keys.length === 1) throw new TypeError("socket closed");
    return json({ id: "pi_after_retry" });
  });
  const result = await stripeRequest("POST", "/payment_intents", { amount: 100 }, {
    idempotencyKey: "native-payment-order-12345678",
  });
  assert.equal(result.id, "pi_after_retry");
  assert.deepEqual(keys, ["native-payment-order-12345678", "native-payment-order-12345678"]);
});

test("an idempotency key does not turn provider HTTP errors into automatic write retries", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    return json({ error: { message: "provider failed", type: "api_error" } }, { status: 500 });
  });
  await assert.rejects(
    () => stripeRequest("POST", "/payment_intents", { amount: 100 }, {
      idempotencyKey: "native-payment-order-http-12345678",
    }),
    (error) => error instanceof StripeApiError && error.status === 500,
  );
  assert.equal(calls, 1);
});

test("AbortController bounds a request and returns a typed timeout without retrying an unsafe POST", async (t) => {
  let calls = 0;
  mockStripe(t, async (url, init) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(
    () => stripeRequest("POST", "/payment_intents", { amount: 100 }, { timeoutMs: 5 }),
    (error) => error instanceof StripeApiError && error.code === "timeout" && error.status === 0,
  );
  assert.equal(calls, 1);
});

test("provider errors expose only a validated Stripe request id", async (t) => {
  let calls = 0;
  mockStripe(t, async () => {
    calls += 1;
    return json({ error: { message: "card refused", code: "card_declined", type: "card_error" } }, {
      status: 402,
      headers: { "request-id": calls === 1 ? "req_adapter123" : "unsafe-request-id" },
    });
  });
  await assert.rejects(
    () => stripeRequest("POST", "/payment_intents", { amount: 100 }),
    (error) => error instanceof StripeApiError
      && error.status === 402
      && error.code === "card_declined"
      && error.requestId === "req_adapter123",
  );
  await assert.rejects(
    () => stripeRequest("POST", "/payment_intents", { amount: 100 }),
    (error) => error instanceof StripeApiError && error.requestId === null,
  );
});

test("the provider-test module refuses a live key before declaring runnable tests", () => {
  const env = {
    ...process.env,
    STRIPE_SECRET_KEY: "sk_live_fixture_do_not_use",
    STRIPE_TEST_REQUIRED: "1",
  };
  // Do not make the nested process masquerade as one of this runner's managed
  // children; it needs to report its own refusal exit status.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "tests/stripe-live.test.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5_000,
    env,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /REFUSING Stripe provider tests with a non-test key/);
});

test("a required provider run fails instead of reporting four skips when the key is absent", () => {
  const env = { ...process.env, STRIPE_TEST_REQUIRED: "1" };
  delete env.STRIPE_SECRET_KEY;
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "tests/stripe-live.test.js"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 5_000, env,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`,
    /REFUSING required Stripe provider tests without STRIPE_SECRET_KEY/);
});

test("the legacy E2E verifier refuses notification credentials before any checkout", () => {
  const env = {
    ...process.env,
    STRIPE_SECRET_KEY: TEST_KEY,
    SENDGRID_API_KEY: "SG.fixture-never-sent",
    ORDER_NOTIFY_EMAIL: "nobody@example.invalid",
  };
  delete env.DATABASE_URL;
  delete env.DATABASE_ADMIN_URL;
  const result = spawnSync(process.execPath, ["scripts/verify-stripe-e2e.mjs"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 5_000, env,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REFUSING: SendGrid notification variables are set/);
});
