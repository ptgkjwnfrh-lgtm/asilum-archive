// Native Storefront payment orchestration. The catalog dispatch is explicit;
// all money facts come from server-owned Postgres rows and connected Stripe
// objects. A success URL is never evidence of payment.

import { accountIdFromIdentity } from "../identity.js";
import {
  StripeApiError,
  createNativeCheckoutSession,
  retrieveApplicationFee,
  retrieveConnectedAccount,
  retrieveConnectedBalanceTransaction,
  retrieveConnectedCharge,
  retrieveConnectedCheckoutSession,
  retrieveConnectedPaymentIntent,
} from "../payments/stripe.js";
import { storefrontRuntimeFlags, stripeSecretMode } from "./flags.js";
import {
  StorefrontCheckoutStoreError,
  attachNativeCheckoutSession,
  claimDueNativeCheckoutAttempts,
  deferNativeCheckoutAttempt,
  getNativeCheckoutContext,
  holdNativeCheckoutAttempt,
  markNativeAttemptReconcileRequired,
  markNativeStripeEvent,
  prepareNativeCheckout,
  receiveNativeStripeEvent,
  releaseNativeCheckout,
  resolveNativeCheckoutAuthority,
  settleNativeCheckout,
} from "../db/storefrontCheckout.js";
import { acceptedOfferFor, activeDiscount, getOfferSettings, invalidateOffersOnSale, notifyQueue } from "../db/production/commerce.js";
import { percentOff } from "./commerce.js";

class NativeCheckoutVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "NativeCheckoutVerificationError";
  }
}

class NativeCheckoutRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NativeCheckoutRetryableError";
  }
}

function verify(condition, message) {
  if (!condition) throw new NativeCheckoutVerificationError(message);
}

function idOf(value) {
  return typeof value === "string" ? value : value && typeof value.id === "string" ? value.id : "";
}

function safeReason(error, fallback = "native checkout failed") {
  if (error instanceof StorefrontCheckoutStoreError) return error.message;
  if (error instanceof StripeApiError) return error.message;
  if (error instanceof NativeCheckoutRetryableError) return error.message;
  return fallback;
}

function refusal(error, fallbackStatus = 502, fallback = "native checkout failed") {
  return {
    status: Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status : fallbackStatus,
    error: safeReason(error, fallback),
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
  };
}

function checkoutQuantity(value) {
  const out = Number(value ?? 1);
  if (!Number.isSafeInteger(out) || out < 1 || out > 25) return null;
  return out;
}

function expirySeconds(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  const seconds = Math.floor(milliseconds / 1000);
  verify(Number.isSafeInteger(seconds) && seconds > 0, "checkout expiration is invalid");
  return seconds;
}

function reconciliationMode(env = process.env) {
  // Live native money remains locked even when the create-checkout flag is
  // accidentally enabled. Existing test attempts must still reconcile while
  // NATIVE_CHECKOUT_ENABLED is off, so this deliberately ignores that flag.
  return stripeSecretMode(env.STRIPE_SECRET_KEY || "") === "test" ? "test" : "off";
}

function metadataMismatch(metadata, context) {
  if (!metadata || metadata.kind !== "native_storefront") return "missing native-storefront metadata";
  const expected = {
    order_id: context.orderId,
    item_id: context.itemId,
    user: context.buyerId,
    passenger_fee_cents: String(context.passengerFeeCents),
    storefront_fee_cents: "0",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(metadata[key] ?? "") !== value) return `metadata ${key} does not match`;
  }
  return null;
}

function validateAccount(account, authority) {
  verify(account?.id === authority.stripeAccountId, "Stripe returned a different connected account");
  // Account objects do not expose `livemode`; the key-mode rollout gate and
  // every session/intent/charge/application-fee object carry that proof.
  verify(account.details_submitted === true, "connected account details are incomplete");
  verify(account.charges_enabled === true, "connected account charges are not enabled");
  verify(account.payouts_enabled === true, "connected account payouts are not enabled");
  verify(account.controller?.fees?.payer === "account",
    "connected account must pay its own processing fees for this proceeds model");
  verify(account.controller?.losses?.payments === "stripe",
    "connected account payment-loss responsibility is not approved for this proceeds model");
  const cards = account.capabilities?.card_payments;
  verify(cards == null || cards === "active", `connected account card_payments is ${cards}`);
}

function validateSession(session, context, { requirePaid = false, requireExpired = false } = {}) {
  verify(session?.id && session.id.startsWith("cs_"), "Stripe Checkout Session id is missing");
  if (context.sessionId) verify(session.id === context.sessionId, "Checkout Session id does not match the payment attempt");
  verify(Array.isArray(session.payment_method_types)
    && session.payment_method_types.length === 1
    && session.payment_method_types[0] === "card",
  "Checkout Session is not constrained to card payments");
  verify(session.mode === "payment", "Checkout Session is not a one-time payment");
  verify(session.livemode === context.livemode, "Checkout Session mode does not match");
  verify(Number(session.expires_at) === context.expiresAtSeconds,
    "Checkout Session expiration does not match the inventory reservation");
  verify(Number(session.amount_total) === context.buyerTotalCents, "Checkout Session total does not match");
  verify(String(session.currency || "").toLowerCase() === context.currency, "Checkout Session currency does not match");
  verify(metadataMismatch(session.metadata, context) === null, metadataMismatch(session.metadata, context));
  if (session.client_reference_id != null) {
    verify(session.client_reference_id === context.orderId, "Checkout Session references another order");
  }
  if (requirePaid) {
    verify(session.payment_status === "paid", "Checkout Session is not paid");
    verify(session.status === "complete", "Checkout Session is not complete");
  }
  if (requireExpired) {
    verify(session.status === "expired" && session.payment_status !== "paid", "Checkout Session is not terminal-unpaid");
  }
}

function contextFromPreparation(prepared) {
  return {
    attemptId: prepared.attemptId,
    orderId: prepared.orderId,
    buyerId: prepared.buyerId,
    itemId: prepared.itemId,
    storefrontId: prepared.storefrontId,
    listingId: prepared.listingId,
    variantId: prepared.variantId,
    quantity: prepared.quote.unitCount,
    stripeAccountId: prepared.stripeAccountId,
    livemode: prepared.expectedLivemode,
    sessionId: prepared.sessionId || null,
    buyerTotalCents: prepared.quote.buyerTotalCents,
    passengerFeeCents: prepared.quote.passengerFeeCents,
    storefrontFeeReservedCents: 0,
    applicationFeeCents: prepared.quote.passengerFeeCents,
    currency: prepared.quote.currency,
    quoteExpiresAt: prepared.quoteExpiresAt,
    expiresAtSeconds: expirySeconds(prepared.quoteExpiresAt),
  };
}

const MAX_AUTOMATIC_RECONCILE_ATTEMPTS = 8;

const productionDependencies = {
  accountIdFromIdentity,
  runtimeFlags: storefrontRuntimeFlags,
  resolveAuthority: resolveNativeCheckoutAuthority,
  prepare: prepareNativeCheckout,
  attachSession: attachNativeCheckoutSession,
  markReconcile: markNativeAttemptReconcileRequired,
  claimDue: claimDueNativeCheckoutAttempts,
  deferAttempt: deferNativeCheckoutAttempt,
  holdAttempt: holdNativeCheckoutAttempt,
  getContext: getNativeCheckoutContext,
  receiveEvent: receiveNativeStripeEvent,
  markEvent: markNativeStripeEvent,
  settle: settleNativeCheckout,
  release: releaseNativeCheckout,
  createSession: createNativeCheckoutSession,
  retrieveAccount: retrieveConnectedAccount,
  retrieveSession: retrieveConnectedCheckoutSession,
  retrieveIntent: retrieveConnectedPaymentIntent,
  retrieveCharge: retrieveConnectedCharge,
  retrieveBalance: retrieveConnectedBalanceTransaction,
  retrieveApplicationFee,
  reconciliationMode,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  // slice 6: an accepted offer's price for ITS buyer (8.7), the seller's
  // stacking rule against a running discount (7.19, 8.11)
  acceptedOffer: acceptedOfferFor,
  activeDiscount,
  offerSettings: getOfferSettings,
  // what a sale and a release tell the rest of the market (7.11, 7.13, 7.22)
  afterSale: async ({ listingId, title = null }) => {
    const offers = await invalidateOffersOnSale(listingId).catch(() => 0);
    const queue = await notifyQueue(listingId, "sold", { title }).catch(() => ({ notified: 0 }));
    return { offersInvalidated: offers, queueNotified: queue.notified };
  },
  afterRelease: async ({ listingId, title = null }) => notifyQueue(listingId, "released", { title }).catch(() => ({ notified: 0 })),
};

export function createNativeStorefrontCheckoutService(overrides = {}) {
  const deps = { ...productionDependencies, ...overrides };

  // A settlement is final before anyone is told; the fan-out never fails it.
  // A sale invalidates every open and accepted offer on the listing and
  // tells the queue it sold (7.13, 7.22); a release tells the queue the
  // unit is back — a courtesy, first come first served (7.11).
  async function settled(args, context) {
    const result = await deps.settle(args);
    if (!result?.duplicate && deps.afterSale) {
      try { await deps.afterSale({ listingId: context.listingId, orderId: context.orderId }); } catch { /* told later by the reconciler */ }
    }
    return result;
  }
  async function released(args, context) {
    const result = await deps.release(args);
    if (!result?.duplicate && deps.afterRelease) {
      try { await deps.afterRelease({ listingId: context.listingId, orderId: context.orderId }); } catch { /* a missed courtesy, not a lost unit */ }
    }
    return result;
  }

  async function paidProviderFacts(context, sessionInput = null) {
    const session = sessionInput || await deps.retrieveSession(context.sessionId, { account: context.stripeAccountId });
    validateSession(session, context, { requirePaid: true });
    const paymentIntentId = idOf(session.payment_intent);
    verify(paymentIntentId.startsWith("pi_"), "paid Checkout Session has no PaymentIntent");
    const intent = await deps.retrieveIntent(paymentIntentId, { account: context.stripeAccountId });
    verify(intent.id === paymentIntentId, "Stripe returned a different PaymentIntent");
    verify(intent.livemode === context.livemode && intent.status === "succeeded", "PaymentIntent is not a succeeded payment in the expected mode");
    verify(Number(intent.amount) === context.buyerTotalCents
      && Number(intent.amount_received) === context.buyerTotalCents, "PaymentIntent total does not match");
    verify(String(intent.currency || "").toLowerCase() === context.currency, "PaymentIntent currency does not match");
    verify(Number(intent.application_fee_amount) === context.applicationFeeCents, "PaymentIntent application fee does not match passenger fee");
    verify(metadataMismatch(intent.metadata, context) === null, metadataMismatch(intent.metadata, context));

    const chargeId = idOf(intent.latest_charge);
    verify(chargeId.startsWith("ch_"), "PaymentIntent has no charge");
    const charge = await deps.retrieveCharge(chargeId, { account: context.stripeAccountId });
    verify(charge.id === chargeId && charge.paid === true && charge.captured === true
      && charge.refunded !== true && Number(charge.amount_refunded) === 0,
    "connected charge is not a fully captured, unrefunded charge");
    verify(charge.livemode === context.livemode, "connected charge mode does not match");
    verify(Number(charge.amount) === context.buyerTotalCents
      && Number(charge.amount_captured) === context.buyerTotalCents,
    "connected charge amount does not match");
    verify(String(charge.currency || "").toLowerCase() === context.currency, "connected charge currency does not match");
    verify(idOf(charge.payment_intent) === paymentIntentId, "connected charge belongs to another PaymentIntent");
    verify(Number(charge.application_fee_amount) === context.applicationFeeCents, "connected charge application fee does not match passenger fee");

    const balanceTransactionId = idOf(charge.balance_transaction);
    const applicationFeeId = idOf(charge.application_fee);
    verify(balanceTransactionId.startsWith("txn_"), "connected charge has no balance transaction");
    verify(applicationFeeId.startsWith("fee_"), "connected charge has no passenger application fee");
    const [balance, applicationFee] = await Promise.all([
      deps.retrieveBalance(balanceTransactionId, { account: context.stripeAccountId }),
      deps.retrieveApplicationFee(applicationFeeId),
    ]);
    verify(balance.id === balanceTransactionId && idOf(balance.source) === chargeId, "connected balance transaction belongs to another charge");
    verify(Number(balance.amount) === context.buyerTotalCents, "connected balance amount does not match");
    verify(String(balance.currency || "").toLowerCase() === context.currency, "connected balance currency does not match");
    verify(Number.isSafeInteger(Number(balance.net)) && Number(balance.net) >= 0, "connected seller net would be negative");
    verify(Number(balance.amount) - Number(balance.fee) === Number(balance.net), "connected balance does not reconcile");
    const appDetails = Array.isArray(balance.fee_details)
      ? balance.fee_details.filter((detail) => detail?.type === "application_fee") : [];
    if (appDetails.length) {
      verify(appDetails.reduce((sum, detail) => sum + Number(detail.amount || 0), 0) === context.applicationFeeCents,
        "connected balance application fee does not match passenger fee");
    }
    verify(applicationFee.id === applicationFeeId, "Stripe returned a different application fee");
    verify(applicationFee.livemode === context.livemode, "application fee mode does not match");
    verify(idOf(applicationFee.account) === context.stripeAccountId, "application fee belongs to another connected account");
    verify(idOf(applicationFee.charge) === chargeId, "application fee belongs to another charge");
    verify(Number(applicationFee.amount) === context.applicationFeeCents, "application fee is not the exact passenger fee");
    verify(applicationFee.refunded !== true && Number(applicationFee.amount_refunded || 0) === 0, "application fee was already refunded");

    return {
      accountId: context.stripeAccountId,
      livemode: context.livemode,
      orderId: context.orderId,
      itemId: context.itemId,
      buyerTotalCents: context.buyerTotalCents,
      applicationFeeCents: context.applicationFeeCents,
      currency: context.currency,
      sessionId: session.id,
      paymentIntentId,
      chargeId,
      balanceTransactionId,
      applicationFeeId,
    };
  }

  async function start({ buyerId, itemId, variantId = null, quantity = 1, requestKey = null, origin }) {
    if (!deps.accountIdFromIdentity(buyerId)) {
      return { status: 403, error: "native Storefront checkout requires a signed-in account", code: "ACCOUNT_REQUIRED" };
    }
    const qty = checkoutQuantity(quantity);
    if (!qty) return { status: 400, error: "quantity must be an integer from 1 to 25", code: "INVALID_QUANTITY" };
    const flags = deps.runtimeFlags();
    if (!flags.checkoutEnabled) {
      return { status: 503, error: flags.reasons?.[0]?.message || "native checkout is not enabled", code: flags.reasons?.[0]?.code || "CHECKOUT_OFF" };
    }
    if (flags.checkoutMode === "live") {
      return {
        status: 503,
        error: "live native Storefront checkout is locked until post-processing fee and refund reconciliation are provider-verified",
        code: "NATIVE_LIVE_CHECKOUT_DISABLED",
      };
    }
    // The $30 balance is deliberately carried until a post-processing,
    // seller-proceeds collection mechanism is verified. An environment flag
    // cannot silently opt this precapture Checkout path into an unsafe fee.
    if (flags.feeCollectionEnabled === true) {
      return {
        status: 503,
        error: "storefront fee collection is disabled until post-processing seller-proceeds collection is verified",
        code: "STOREFRONT_FEE_COLLECTION_UNVERIFIED",
      };
    }
    // A browser retry after a lost response must resolve the same durable
    // order and Stripe idempotency key. Native callers therefore supply the
    // stable operation UUID; silently inventing one here would turn an
    // ambiguous retry into a second reservation and possibly a second charge.
    if (!requestKey) {
      return {
        status: 400,
        error: "native checkout requires a stable idempotency key",
        code: "IDEMPOTENCY_KEY_REQUIRED",
      };
    }
    const livemode = flags.checkoutMode === "live";
    let authority;
    try {
      authority = await deps.resolveAuthority({ itemId, variantId, quantity: qty, expectedLivemode: livemode });
      const account = await deps.retrieveAccount(authority.stripeAccountId);
      validateAccount(account, authority);
    } catch (error) {
      return refusal(error, 502, "seller payment account could not be verified");
    }

    // THE PRIVATE PRICE (8.7): an accepted offer replaces the public price
    // for the eligible buyer only, inside their checkout, for its 24 hours.
    // It reserves nothing until this moment (7.21). Whether a running
    // discount stacks on it is the seller's rule (7.19, 8.11); by default
    // the accepted price stands alone.
    let unitPriceOverrideCents = null;
    let offerId = null;
    try {
      const held = deps.acceptedOffer ? await deps.acceptedOffer({ buyerId, listingId: authority.listingId, variantId: authority.variantId }) : null;
      if (held) {
        unitPriceOverrideCents = held.priceCents;
        offerId = held.offer.id;
        const discount = deps.activeDiscount ? await deps.activeDiscount(authority.listingId) : null;
        const settings = deps.offerSettings ? await deps.offerSettings(authority.storefrontId) : {};
        if (discount && settings.discountsStack) unitPriceOverrideCents = percentOff(unitPriceOverrideCents, discount.percent);
      }
    } catch { unitPriceOverrideCents = null; offerId = null; }

    let prepared;
    try {
      prepared = await deps.prepare({
        buyerId, itemId, variantId, quantity: qty, requestKey,
        expectedLivemode: livemode,
        expectedStripeAccountId: authority.stripeAccountId,
        unitPriceOverrideCents, offerId,
      });
    } catch (error) {
      return refusal(error, 409, "native checkout could not reserve inventory");
    }
    const context = contextFromPreparation(prepared);
    let session = null;
    try {
      if (prepared.sessionId) {
        session = await deps.retrieveSession(prepared.sessionId, { account: prepared.stripeAccountId });
        validateSession(session, context);
        if (session.status !== "open" || session.payment_status === "paid" || !session.url) {
          await deps.markReconcile({
            attemptId: prepared.attemptId,
            reason: "existing connected Checkout Session is terminal or unavailable",
          });
          return { status: 409, error: "that checkout operation is already complete or unavailable", code: "CHECKOUT_TERMINAL" };
        }
      } else {
        session = await deps.createSession({
          orderId: prepared.orderId,
          itemId: prepared.itemId,
          title: qty > 1 ? `${qty} × ${prepared.title}` : prepared.title,
          merchandiseCents: prepared.quote.merchandiseCents,
          passengerFeeCents: prepared.quote.passengerFeeCents,
          storefrontFeeCents: 0,
          currency: prepared.quote.currency,
          expiresAt: context.expiresAtSeconds,
          origin,
          user: buyerId,
          account: prepared.stripeAccountId,
          idempotencyKey: prepared.idempotencyKey,
        });
        validateSession(session, { ...context, sessionId: null });
        verify(session.payment_status !== "paid", "new Checkout Session was unexpectedly already paid");
        verify(typeof session.url === "string" && /^https:\/\/checkout\.stripe\.com\//.test(session.url), "Stripe did not return a hosted checkout URL");
        await deps.attachSession({ attemptId: prepared.attemptId, sessionId: session.id });
      }
    } catch (error) {
      // A create/retrieve/attach failure is ambiguous: Stripe may have
      // accepted the idempotent create even when no response reached us.
      // Preserve inventory and retry/reconcile; never release here.
      try {
        await deps.markReconcile({
          attemptId: prepared.attemptId,
          reason: safeReason(error, "connected Checkout Session requires reconciliation"),
        });
      } catch { /* primary refusal wins */ }
      return refusal(error, 502, "payment provider refused the native checkout session");
    }
    return {
      status: 200,
      orderId: prepared.orderId,
      url: session.url,
      commerceRail: "native_storefront",
      quantity: qty,
      quote: {
        merchandiseCents: prepared.quote.merchandiseCents,
        passengerFeeCents: prepared.quote.passengerFeeCents,
        buyerTotalCents: prepared.quote.buyerTotalCents,
        storefrontFeeCents: 0,
        currency: prepared.quote.currency,
      },
    };
  }

  async function webhook(event) {
    const object = event?.data?.object;
    const metadata = object?.metadata;
    if (metadata?.kind !== "native_storefront") return { claimed: false };
    const eventId = String(event?.id || "");
    const eventType = String(event?.type || "");
    const receipt = await deps.receiveEvent({
      eventId,
      accountId: event?.account || null,
      livemode: event?.livemode,
      type: eventType,
      objectId: object?.id || null,
      payload: {
        order_id: metadata.order_id || null,
        object_id: object?.id || null,
        payment_intent: idOf(object?.payment_intent) || null,
      },
    });
    if (["processed", "ignored"].includes(receipt.status)) {
      return { claimed: true, handled: true, duplicate: true };
    }
    let context;
    try {
      context = await deps.getContext({ orderId: metadata.order_id });
      if (!context) {
        throw new NativeCheckoutRetryableError("native payment event has no durable payment attempt yet");
      }
      if (!context.sessionId) {
        throw new NativeCheckoutRetryableError("native payment attempt is not yet bound to a Checkout Session");
      }
      if (context.livemode) {
        throw new NativeCheckoutRetryableError("live native Storefront settlement is disabled pending provider validation");
      }
      verify(event.account === context.stripeAccountId, "Stripe event came from another connected account");
      verify(event.livemode === context.livemode, "Stripe event mode does not match the payment attempt");
      verify(metadataMismatch(metadata, context) === null, metadataMismatch(metadata, context));

      if (eventType === "checkout.session.completed") {
        verify(object.id === context.sessionId, "completed event names another Checkout Session");
        validateSession(object, context, { requirePaid: true });
        const provider = await paidProviderFacts(context);
        const result = await settled({ attemptId: context.attemptId, eventId, source: "webhook", provider }, context);
        return { claimed: true, handled: true, settled: true, duplicate: Boolean(result.duplicate), orderId: context.orderId };
      }
      if (eventType === "checkout.session.expired") {
        verify(object.id === context.sessionId, "expired event names another Checkout Session");
        const session = await deps.retrieveSession(context.sessionId, { account: context.stripeAccountId });
        validateSession(session, context, { requireExpired: true });
        const result = await released({
          attemptId: context.attemptId,
          eventId,
          source: "webhook",
          reason: "connected Checkout Session expired unpaid",
          orderStatus: "expired",
        }, context);
        return { claimed: true, handled: true, released: true, duplicate: Boolean(result.duplicate), orderId: context.orderId };
      }
      if (eventType === "payment_intent.payment_failed") {
        verify(object.id?.startsWith("pi_"), "failed event has no PaymentIntent id");
        verify(object.livemode === context.livemode, "failed PaymentIntent mode does not match");
        verify(Number(object.amount) === context.buyerTotalCents, "failed PaymentIntent amount does not match");
        verify(String(object.currency || "").toLowerCase() === context.currency, "failed PaymentIntent currency does not match");
        await deps.markEvent({ eventId, status: "processed", error: "provider reported a retryable payment failure" });
        return { claimed: true, handled: true, paymentFailed: true, settled: false };
      }
      await deps.markEvent({ eventId, status: "ignored", error: `native event type ${eventType} is not actionable` });
      return { claimed: true, handled: false, ignored: true };
    } catch (error) {
      if (error instanceof NativeCheckoutVerificationError) {
        await deps.markEvent({ eventId, status: "ignored", error: error.message });
        return { claimed: true, handled: true, mismatch: error.message, settled: false };
      }
      await deps.markEvent({ eventId, status: "failed", error: safeReason(error, "native event processing failed") });
      throw error;
    }
  }

  async function reconcile(order) {
    try {
      const context = await deps.getContext({ orderId: order.id });
      if (!context?.sessionId) return { changed: false };
      if (context.livemode || deps.reconciliationMode() !== "test") {
        return { changed: false, held: true };
      }
      const session = await deps.retrieveSession(context.sessionId, { account: context.stripeAccountId });
      validateSession(session, context);
      if (session.payment_status === "paid") {
        const provider = await paidProviderFacts(context, session);
        const result = await settled({ attemptId: context.attemptId, source: "reconcile", provider }, context);
        return { changed: !result.duplicate, settled: true, orderId: context.orderId };
      }
      if (session.status === "expired") {
        const result = await released({
          attemptId: context.attemptId,
          source: "reconcile",
          reason: "connected Checkout Session reconciled expired unpaid",
          orderStatus: "expired",
        }, context);
        return { changed: !result.duplicate, released: true, orderId: context.orderId };
      }
      if (session.status === "open" && session.payment_status !== "paid" && session.url) {
        return { changed: false, resumeUrl: session.url };
      }
      return { changed: false };
    } catch (error) {
      console.error(`native checkout reconciliation held for ${order?.id || "unknown"}: ${safeReason(error)}`);
      return { changed: false, held: true };
    }
  }

  async function reconcileAttempt(context, origin) {
    if (!context || context.reservationState !== "active") {
      throw new NativeCheckoutRetryableError("native payment attempt has no active inventory reservation");
    }
    if (context.livemode || deps.reconciliationMode() !== "test") {
      throw new NativeCheckoutRetryableError("native payment reconciliation is restricted to Stripe test mode");
    }
    let session;
    let activeContext = context;
    if (!context.sessionId) {
      if (activeContext.expiresAtSeconds <= deps.nowSeconds()) {
        await deps.holdAttempt({
          attemptId: context.attemptId,
          reason: "unbound Checkout Session replay window expired; manual provider lookup required",
        });
        return { state: "held", attemptId: context.attemptId, orderId: context.orderId };
      }
      const account = await deps.retrieveAccount(context.stripeAccountId);
      validateAccount(account, { stripeAccountId: context.stripeAccountId });
      session = await deps.createSession({
        orderId: context.orderId,
        itemId: context.itemId,
        title: context.quantity > 1 ? `${context.quantity} × ${context.title}` : context.title,
        merchandiseCents: context.merchandiseCents,
        passengerFeeCents: context.passengerFeeCents,
        storefrontFeeCents: 0,
        currency: context.currency,
        expiresAt: context.expiresAtSeconds || expirySeconds(context.quoteExpiresAt),
        origin,
        user: context.buyerId,
        account: context.stripeAccountId,
        idempotencyKey: context.idempotencyKey,
      });
      activeContext = {
        ...context,
        expiresAtSeconds: context.expiresAtSeconds || expirySeconds(context.quoteExpiresAt),
        sessionId: session?.id || null,
      };
      validateSession(session, { ...activeContext, sessionId: null });
      await deps.attachSession({ attemptId: context.attemptId, sessionId: session.id });
    } else {
      activeContext = {
        ...context,
        expiresAtSeconds: context.expiresAtSeconds || expirySeconds(context.quoteExpiresAt),
      };
      session = await deps.retrieveSession(context.sessionId, { account: context.stripeAccountId });
      validateSession(session, activeContext);
    }

    if (session.payment_status === "paid") {
      const provider = await paidProviderFacts(activeContext, session);
      const result = await settled({ attemptId: context.attemptId, source: "reconcile", provider }, context);
      return { state: "settled", duplicate: Boolean(result.duplicate), orderId: context.orderId };
    }
    if (session.status === "expired") {
      validateSession(session, activeContext, { requireExpired: true });
      const result = await released({
        attemptId: context.attemptId,
        source: "reconcile",
        reason: "connected Checkout Session reconciled expired unpaid",
        orderStatus: "expired",
      }, context);
      return { state: "released", duplicate: Boolean(result.duplicate), orderId: context.orderId };
    }
    verify(session.status === "open" && session.payment_status !== "paid",
      "connected Checkout Session is neither paid, open, nor verified expired");
    await deps.deferAttempt({
      attemptId: context.attemptId,
      reason: "connected Checkout Session remains open",
      delaySeconds: 300,
    });
    return { state: "open", orderId: context.orderId };
  }

  async function runDue({ limit = 10, origin } = {}) {
    if (deps.reconciliationMode() !== "test") {
      return { enabled: false, claimed: 0, processed: 0, failed: 0, results: [] };
    }
    const attempts = await deps.claimDue({ limit, leaseSeconds: 600 });
    const results = [];
    for (const context of attempts) {
      try {
        results.push(await reconcileAttempt({
          ...context,
          expiresAtSeconds: context.expiresAtSeconds || expirySeconds(context.quoteExpiresAt),
        }, origin));
      } catch (error) {
        const reason = safeReason(error, "connected payment reconciliation failed");
        if (Number(context.reconcileAttempts || 0) >= MAX_AUTOMATIC_RECONCILE_ATTEMPTS) {
          try {
            await deps.holdAttempt({
              attemptId: context.attemptId,
              reason: `automatic reconciliation exhausted: ${reason}`,
            });
          } catch { /* retain the claimed lease; the command still alerts */ }
          results.push({
            state: "held",
            attemptId: context.attemptId,
            orderId: context.orderId,
            reason,
          });
          continue;
        }
        try {
          await deps.deferAttempt({
            attemptId: context.attemptId,
            reason,
            delaySeconds: 300,
          });
        } catch { /* retain the claimed lease; next invocation retries */ }
        results.push({
          state: "failed",
          attemptId: context.attemptId,
          orderId: context.orderId,
          reason,
        });
      }
    }
    const held = results.filter((entry) => entry.state === "held").length;
    return {
      enabled: true,
      claimed: attempts.length,
      processed: results.filter((entry) => !["failed", "held"].includes(entry.state)).length,
      failed: results.filter((entry) => entry.state === "failed").length,
      held,
      results,
    };
  }

  return Object.freeze({ start, webhook, reconcile, runDue });
}

const production = createNativeStorefrontCheckoutService();

export const startNativeStorefrontCheckout = production.start;
export const applyNativeStorefrontWebhook = production.webhook;
export const reconcileNativeStorefrontOrder = production.reconcile;
export const reconcileDueNativeStorefrontAttempts = production.runDue;
