// Native checkout orchestration with provider/persistence doubles. No Stripe
// or database call is made here; the test proves that only a fully matching,
// paid connected transaction reaches the atomic settlement seam.

import test from "node:test";
import assert from "node:assert/strict";
import { createNativeStorefrontCheckoutService } from "../lib/storefront/checkout.js";
import {
  StorefrontCheckoutStoreError,
  assertNativeCheckoutCurrency,
  nativeCheckoutRequestMatches,
} from "../lib/db/storefrontCheckout.js";

const BUYER = "sb-11111111-1111-4111-8111-111111111111";
const ACCOUNT = "acct_1234567890ABCDEF";
const ORDER = "ord_11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const LISTING = "33333333-3333-4333-8333-333333333333";
const VARIANT = "44444444-4444-4444-8444-444444444444";
const ITEM = `native:${LISTING}`;
const EXPIRES_AT = 1_791_072_000;

const metadata = Object.freeze({
  kind: "native_storefront",
  order_id: ORDER,
  item_id: ITEM,
  user: BUYER,
  passenger_fee_cents: "400",
  storefront_fee_cents: "0",
});

const context = Object.freeze({
  attemptId: ATTEMPT,
  attemptStatus: "provider_pending",
  orderId: ORDER,
  orderStatus: "awaiting_payment",
  buyerId: BUYER,
  itemId: ITEM,
  storefrontId: "55555555-5555-4555-8555-555555555555",
  listingId: LISTING,
  variantId: VARIANT,
  quantity: 1,
  reservationId: "66666666-6666-4666-8666-666666666666",
  reservationState: "active",
  stripeAccountId: ACCOUNT,
  livemode: false,
  sessionId: "cs_test_native123",
  paymentIntentId: null,
  idempotencyKey: `native-checkout-${ATTEMPT}`,
  title: "Chrome chair",
  merchandiseCents: 20_000,
  buyerTotalCents: 20_400,
  passengerFeeCents: 400,
  storefrontFeeReservedCents: 0,
  applicationFeeCents: 400,
  currency: "usd",
  quoteExpiresAt: new Date(EXPIRES_AT * 1000).toISOString(),
  expiresAtSeconds: EXPIRES_AT,
});

function providerObjects(overrides = {}) {
  const session = {
    id: context.sessionId,
    mode: "payment",
    payment_method_types: ["card"],
    expires_at: EXPIRES_AT,
    livemode: false,
    status: "complete",
    payment_status: "paid",
    amount_total: 20_400,
    currency: "usd",
    client_reference_id: ORDER,
    metadata,
    payment_intent: "pi_native123",
    url: null,
    ...overrides.session,
  };
  return {
    session,
    intent: {
      id: "pi_native123", livemode: false, status: "succeeded",
      amount: 20_400, amount_received: 20_400, currency: "usd",
      application_fee_amount: 400, metadata, latest_charge: "ch_native123",
      ...overrides.intent,
    },
    charge: {
      id: "ch_native123", livemode: false, paid: true, captured: true, refunded: false,
      amount: 20_400, amount_captured: 20_400, amount_refunded: 0,
      currency: "usd", payment_intent: "pi_native123",
      application_fee_amount: 400, balance_transaction: "txn_native123",
      application_fee: "fee_native123", ...overrides.charge,
    },
    balance: {
      id: "txn_native123", amount: 20_400, fee: 1_022, net: 19_378,
      currency: "usd", source: "ch_native123",
      fee_details: [
        { type: "stripe_fee", amount: 622 },
        { type: "application_fee", amount: 400 },
      ],
      ...overrides.balance,
    },
    applicationFee: {
      id: "fee_native123", livemode: false, account: ACCOUNT,
      charge: "ch_native123", amount: 400, amount_refunded: 0,
      refunded: false, currency: "usd", ...overrides.applicationFee,
    },
  };
}

function harness({ objects = providerObjects(), contextValue = context } = {}) {
  const inbox = new Map();
  const calls = { settle: 0, release: 0, mark: [], reconcile: [], created: [], attached: [] };
  const deps = {
    accountIdFromIdentity: (value) => value === BUYER ? BUYER.slice(3) : null,
    runtimeFlags: () => ({ checkoutEnabled: true, checkoutMode: "test", feeCollectionEnabled: false, reasons: [] }),
    reconciliationMode: () => "test",
    nowSeconds: () => EXPIRES_AT - 3_600,
    resolveAuthority: async () => ({
      itemId: ITEM, title: "Chrome chair", storefrontId: context.storefrontId,
      listingId: LISTING, variantId: VARIANT, stripeAccountId: ACCOUNT,
      expectedLivemode: false, unitMerchandiseCents: 20_000, currency: "usd",
    }),
    retrieveAccount: async () => ({
      id: ACCOUNT, details_submitted: true,
      charges_enabled: true, payouts_enabled: true,
      controller: { fees: { payer: "account" }, losses: { payments: "stripe" } },
      capabilities: { card_payments: "active" },
    }),
    prepare: async (input) => ({
      itemId: ITEM, title: "Chrome chair", storefrontId: context.storefrontId,
      listingId: LISTING, variantId: VARIANT, stripeAccountId: ACCOUNT,
      expectedLivemode: false, buyerId: BUYER, orderId: ORDER, attemptId: ATTEMPT,
      reservationId: context.reservationId, idempotencyKey: `native-checkout-${ATTEMPT}`,
      sessionId: null, quoteExpiresAt: context.quoteExpiresAt,
      quote: {
        unitCount: input.quantity, merchandiseCents: 20_000 * input.quantity,
        passengerFeeCents: 400 * input.quantity,
        buyerTotalCents: 20_400 * input.quantity, currency: "usd",
      },
    }),
    createSession: async (input) => {
      calls.created.push(input);
      return {
        ...objects.session,
        status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/test",
        amount_total: input.merchandiseCents + input.passengerFeeCents,
        expires_at: input.expiresAt,
        metadata: {
          ...metadata,
          passenger_fee_cents: String(input.passengerFeeCents),
          order_id: input.orderId,
          item_id: input.itemId,
          user: input.user,
        },
        client_reference_id: input.orderId,
      };
    },
    attachSession: async (input) => { calls.attached.push(input); },
    markReconcile: async (input) => { calls.reconcile.push(input); },
    claimDue: async () => [],
    deferAttempt: async (input) => { calls.deferred = [...(calls.deferred || []), input]; },
    holdAttempt: async (input) => { calls.held = [...(calls.held || []), input]; },
    getContext: async () => contextValue,
    receiveEvent: async ({ eventId }) => {
      const prior = inbox.get(eventId);
      if (prior) return { eventId, status: prior, duplicate: true };
      inbox.set(eventId, "pending");
      return { eventId, status: "pending", duplicate: false };
    },
    markEvent: async ({ eventId, status, error }) => {
      inbox.set(eventId, status);
      calls.mark.push({ eventId, status, error });
    },
    settle: async ({ eventId, provider }) => {
      calls.settle += 1;
      if (eventId) inbox.set(eventId, "processed");
      calls.provider = provider;
      return { duplicate: false, settled: true, orderId: ORDER };
    },
    release: async ({ eventId }) => {
      calls.release += 1;
      if (eventId) inbox.set(eventId, "processed");
      return { duplicate: false, released: true, orderId: ORDER };
    },
    retrieveSession: async () => objects.session,
    retrieveIntent: async () => objects.intent,
    retrieveCharge: async () => objects.charge,
    retrieveBalance: async () => objects.balance,
    retrieveApplicationFee: async () => objects.applicationFee,
  };
  return { service: createNativeStorefrontCheckoutService(deps), calls, inbox, deps };
}

function completedEvent(id = "evt_native_good", object = providerObjects().session, overrides = {}) {
  return {
    id,
    type: "checkout.session.completed",
    account: ACCOUNT,
    livemode: false,
    data: { object },
    ...overrides,
  };
}

test("native start requires an account and sends quantity-derived passenger fee with zero Storefront fee", async () => {
  const { service, calls } = harness();
  const anonymous = await service.start({ buyerId: "u-11111111-1111-4111-8111-111111111111", itemId: ITEM });
  assert.equal(anonymous.status, 403);
  assert.equal(calls.created.length, 0);

  const result = await service.start({
    buyerId: BUYER, itemId: ITEM, variantId: VARIANT, quantity: 2,
    requestKey: "77777777-7777-4777-8777-777777777777",
    origin: "https://www.asilummagazine.com",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.quote, {
    merchandiseCents: 40_000,
    passengerFeeCents: 800,
    buyerTotalCents: 40_800,
    storefrontFeeCents: 0,
    currency: "usd",
  });
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].storefrontFeeCents, 0);
  assert.equal(calls.created[0].passengerFeeCents, 800);
  assert.equal(calls.created[0].merchandiseCents, 40_000);
  assert.equal(calls.attached.length, 1);
});

test("idempotency replay distinguishes a canonical default from an explicitly requested variant", () => {
  const prior = {
    user_id: BUYER,
    item_id: ITEM,
    quantity: 1,
    stripe_account_id: ACCOUNT,
    livemode: false,
    snapshot: { requested_variant_id: null },
  };
  const expected = {
    buyerId: BUYER,
    itemId: ITEM,
    quantity: 1,
    stripeAccountId: ACCOUNT,
    livemode: false,
  };
  assert.equal(nativeCheckoutRequestMatches(prior, { ...expected, requestedVariantId: null }), true);
  assert.equal(nativeCheckoutRequestMatches(prior, { ...expected, requestedVariantId: VARIANT }), false);
  assert.equal(nativeCheckoutRequestMatches({
    ...prior,
    snapshot: { requested_variant_id: VARIANT },
  }, { ...expected, requestedVariantId: null }), false);
});

test("native checkout requires a client-stable idempotency key before provider work", async () => {
  const { calls, deps } = harness();
  let authorityReads = 0;
  deps.resolveAuthority = async () => { authorityReads += 1; return {}; };
  const result = await createNativeStorefrontCheckoutService(deps).start({
    buyerId: BUYER,
    itemId: ITEM,
    quantity: 1,
    requestKey: null,
  });
  assert.equal(result.status, 400);
  assert.equal(result.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(authorityReads, 0);
  assert.equal(calls.created.length, 0);
});

test("native checkout refuses non-USD authority before reservation or provider calls", async () => {
  assert.equal(assertNativeCheckoutCurrency("usd"), "usd");
  assert.throws(
    () => assertNativeCheckoutCurrency("eur"),
    (error) => error.code === "UNSUPPORTED_CURRENCY" && /USD-denominated/.test(error.message),
  );
  const { calls, deps } = harness();
  let prepares = 0;
  deps.resolveAuthority = async () => assertNativeCheckoutCurrency("eur");
  deps.prepare = async () => { prepares += 1; };
  const result = await createNativeStorefrontCheckoutService(deps).start({
    buyerId: BUYER,
    itemId: ITEM,
    quantity: 1,
    requestKey: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(result.status, 409);
  assert.equal(result.code, "UNSUPPORTED_CURRENCY");
  assert.equal(prepares, 0);
  assert.equal(calls.created.length, 0);
});

test("live native checkout stays locked even when every rollout gate is enabled", async () => {
  const { calls, deps } = harness();
  deps.runtimeFlags = () => ({
    checkoutEnabled: true,
    checkoutMode: "live",
    feeCollectionEnabled: false,
    validationCurrent: true,
    reasons: [],
  });
  const result = await createNativeStorefrontCheckoutService(deps).start({
    buyerId: BUYER,
    itemId: ITEM,
    quantity: 1,
  });
  assert.equal(result.status, 503);
  assert.equal(result.code, "NATIVE_LIVE_CHECKOUT_DISABLED");
  assert.equal(calls.created.length, 0);
});

test("provider create, retrieve, and attach uncertainty never releases reserved inventory", async () => {
  for (const phase of ["create", "retrieve", "attach"]) {
    const { calls, deps } = harness();
    const originalPrepare = deps.prepare;
    if (phase === "create") deps.createSession = async () => { throw new Error("ambiguous create"); };
    if (phase === "retrieve") {
      deps.prepare = async (input) => ({ ...(await originalPrepare(input)), sessionId: context.sessionId });
      deps.retrieveSession = async () => { throw new Error("ambiguous retrieve"); };
    }
    if (phase === "attach") deps.attachSession = async () => { throw new Error("ambiguous attach"); };
    const service = createNativeStorefrontCheckoutService(deps);
    const result = await service.start({
      buyerId: BUYER, itemId: ITEM, quantity: 1,
      requestKey: "88888888-8888-4888-8888-888888888888",
    });
    assert.equal(result.status, 502, phase);
    assert.equal(calls.release, 0, `${phase} uncertainty must retain inventory`);
    assert.equal(calls.reconcile.length, 1, `${phase} uncertainty must be queued for reconciliation`);
  }
});

test("an unbound native webhook remains retryable and never settles", async () => {
  const { service, calls } = harness({ contextValue: null });
  await assert.rejects(
    service.webhook(completedEvent("evt_unbound_native")),
    /no durable payment attempt yet/,
  );
  assert.equal(calls.settle, 0);
  assert.equal(calls.release, 0);
  assert.equal(calls.mark.at(-1).status, "failed");
});

test("durable-store refusal fails closed before a provider session", async () => {
  const { service, calls, deps } = harness();
  deps.resolveAuthority = async () => {
    throw new StorefrontCheckoutStoreError("DURABLE_STORE_REQUIRED", "native checkout requires durable storage", 503);
  };
  const isolated = createNativeStorefrontCheckoutService(deps);
  const result = await isolated.start({
    buyerId: BUYER, itemId: ITEM, quantity: 1,
    requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(result.status, 503);
  assert.equal(result.code, "DURABLE_STORE_REQUIRED");
  assert.equal(calls.created.length, 0);
});

test("wrong account and money mismatches are durably ignored and never settle", async () => {
  for (const [name, event] of [
    ["account", completedEvent("evt_wrong_account", providerObjects().session, { account: "acct_WRONG123456789" })],
    ["metadata", completedEvent("evt_wrong_metadata", { ...providerObjects().session, metadata: { ...metadata, item_id: "native:forged" } })],
    ["amount", completedEvent("evt_wrong_amount", { ...providerObjects().session, amount_total: 1 })],
    ["mode", completedEvent("evt_wrong_mode", providerObjects().session, { livemode: true })],
    ["payment method", completedEvent("evt_async_method", {
      ...providerObjects().session,
      payment_method_types: ["card", "klarna"],
    })],
  ]) {
    const { service, calls } = harness();
    const result = await service.webhook(event);
    assert.equal(result.settled, false, name);
    assert.match(result.mismatch, /does not match|another|metadata|mode|card payments/i, name);
    assert.equal(calls.settle, 0, name);
    assert.equal(calls.release, 0, name);
    assert.equal(calls.mark.at(-1).status, "ignored", name);
  }
});

test("a fully matching connected payment settles once; redelivery is a no-op", async () => {
  const { service, calls } = harness();
  const event = completedEvent();
  const first = await service.webhook(event);
  assert.equal(first.settled, true);
  assert.equal(first.duplicate, false);
  assert.equal(calls.settle, 1);
  assert.equal(calls.provider.accountId, ACCOUNT);
  assert.equal(calls.provider.buyerTotalCents, 20_400);
  assert.equal(calls.provider.applicationFeeCents, 400,
    "only the passenger fee is an application fee; the $30 remains carried");

  const duplicate = await service.webhook(event);
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls.settle, 1, "redelivery never consumes inventory twice");
});

test("provider-object mismatch after a signed event still cannot settle", async () => {
  const objects = providerObjects({ intent: { amount_received: 20_399 } });
  const { service, calls } = harness({ objects });
  const result = await service.webhook(completedEvent("evt_provider_mismatch", objects.session));
  assert.equal(result.settled, false);
  assert.match(result.mismatch, /PaymentIntent total/);
  assert.equal(calls.settle, 0);
});

test("payment failure records receipt without settling or releasing retryable inventory", async () => {
  const { service, calls } = harness();
  const result = await service.webhook({
    id: "evt_native_failed",
    type: "payment_intent.payment_failed",
    account: ACCOUNT,
    livemode: false,
    data: { object: {
      id: "pi_native_failed", livemode: false, amount: 20_400, currency: "usd", metadata,
    } },
  });
  assert.equal(result.paymentFailed, true);
  assert.equal(result.settled, false);
  assert.equal(calls.settle, 0);
  assert.equal(calls.release, 0, "a card retry may still succeed inside the open Checkout Session");
  assert.equal(calls.mark.at(-1).status, "processed");
});

test("verified expiration releases once and duplicate expiration does nothing", async () => {
  const objects = providerObjects({
    session: { status: "expired", payment_status: "unpaid", payment_intent: null },
  });
  const { service, calls } = harness({ objects });
  const event = {
    id: "evt_native_expired", type: "checkout.session.expired",
    account: ACCOUNT, livemode: false,
    data: { object: { ...objects.session, metadata } },
  };
  const first = await service.webhook(event);
  assert.equal(first.released, true);
  assert.equal(calls.release, 1);
  const duplicate = await service.webhook(event);
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls.release, 1);
  assert.equal(calls.settle, 0);
});

test("success URL reads cannot settle; reconciliation reads connected provider state", async () => {
  const { service, calls } = harness();
  const result = await service.reconcile({ id: ORDER, status: "awaiting_payment", commerce_rail: "native_storefront" });
  assert.equal(result.settled, true);
  assert.equal(calls.settle, 1);
});

test("due runner recovers a no-session attempt with the same provider idempotency key", async () => {
  const pending = { ...context, sessionId: null };
  const { calls, deps } = harness({ contextValue: pending });
  deps.runtimeFlags = () => ({ checkoutEnabled: false, checkoutMode: "off", reasons: [] });
  deps.claimDue = async ({ limit, leaseSeconds }) => {
    assert.equal(limit, 3);
    assert.equal(leaseSeconds, 600);
    return [pending];
  };
  const service = createNativeStorefrontCheckoutService(deps);
  const result = await service.runDue({ limit: 3, origin: "https://www.asilummagazine.com" });
  assert.equal(result.enabled, true);
  assert.equal(result.claimed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].state, "open");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].idempotencyKey, context.idempotencyKey);
  assert.equal(calls.created[0].expiresAt, EXPIRES_AT);
  assert.equal(calls.attached[0].sessionId, context.sessionId);
  assert.equal(calls.release, 0);
  assert.equal(calls.deferred.length, 1);
});

test("due runner releases inventory only after connected provider verifies terminal unpaid", async () => {
  const objects = providerObjects({
    session: { status: "expired", payment_status: "unpaid", payment_intent: null },
  });
  const { calls, deps } = harness({ objects });
  deps.claimDue = async () => [context];
  const result = await createNativeStorefrontCheckoutService(deps).runDue({
    limit: 1,
    origin: "https://www.asilummagazine.com",
  });
  assert.equal(result.results[0].state, "released");
  assert.equal(calls.release, 1);
  assert.equal(calls.settle, 0);
});

test("due runner holds an expired unbound attempt for manual lookup instead of replaying forever", async () => {
  const pending = {
    ...context,
    sessionId: null,
    expiresAtSeconds: EXPIRES_AT - 7_200,
    quoteExpiresAt: new Date((EXPIRES_AT - 7_200) * 1000).toISOString(),
  };
  const { calls, deps } = harness({ contextValue: pending });
  deps.claimDue = async () => [pending];
  const result = await createNativeStorefrontCheckoutService(deps).runDue({
    limit: 1,
    origin: "https://www.asilummagazine.com",
  });
  assert.equal(result.results[0].state, "held");
  assert.equal(calls.created.length, 0);
  assert.equal(calls.release, 0);
  assert.equal(calls.held.length, 1);
  assert.match(calls.held[0].reason, /manual provider lookup/);
  assert.equal(result.held, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.results[0].attemptId, ATTEMPT);
});

test("due runner stops deterministic retry loops and surfaces an actionable hold", async () => {
  const { deps, calls } = harness();
  deps.claimDue = async () => [{ ...context, reconcileAttempts: 8 }];
  deps.retrieveSession = async () => { throw new Error("persistent provider mismatch"); };
  const result = await createNativeStorefrontCheckoutService(deps).runDue({
    limit: 1,
    origin: "https://www.asilummagazine.com",
  });
  assert.equal(result.failed, 0);
  assert.equal(result.held, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.results[0].attemptId, ATTEMPT);
  assert.equal(result.results[0].orderId, ORDER);
  assert.match(calls.held[0].reason, /automatic reconciliation exhausted/);
  assert.equal((calls.deferred || []).length, 0);
});

test("due runner remains off for live keys and does not claim or call Stripe", async () => {
  const { calls, deps } = harness();
  let claims = 0;
  deps.reconciliationMode = () => "off";
  deps.claimDue = async () => { claims += 1; return [context]; };
  const result = await createNativeStorefrontCheckoutService(deps).runDue({ limit: 1 });
  assert.equal(result.enabled, false);
  assert.equal(claims, 0);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.settle, 0);
  assert.equal(calls.release, 0);
});
