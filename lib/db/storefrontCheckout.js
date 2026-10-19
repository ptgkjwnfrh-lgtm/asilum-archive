// Durable native-Storefront checkout records. This module is intentionally
// Postgres-only: real inventory and money may never fall back to process
// memory. Every inventory transition and its order/payment projection commit
// in one short transaction.

import crypto from "node:crypto";
import { getPool } from "./index.js";
import { quoteNativeOrder, PASSENGER_FEE_POLICY_VERSION } from "../storefront/fees.js";
import { STOREFRONT_PAYMENT_VALIDATION_VERSION } from "../storefront/flags.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_RE = /^acct_[A-Za-z0-9_]{4,250}$/;
const PROVIDER_ID_RE = /^[A-Za-z]+_[A-Za-z0-9_]+$/;

export class StorefrontCheckoutStoreError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "StorefrontCheckoutStoreError";
    this.code = code;
    this.status = status;
  }
}

function text(value, name, max = 255) {
  const out = String(value || "").trim();
  if (!out || out.length > max) throw new StorefrontCheckoutStoreError("INVALID_INPUT", `${name} is invalid`, 400);
  return out;
}

function uuid(value, name) {
  const out = text(value, name, 64);
  if (!UUID_RE.test(out)) throw new StorefrontCheckoutStoreError("INVALID_INPUT", `${name} is invalid`, 400);
  return out.toLowerCase();
}

function quantity(value) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > 25) {
    throw new StorefrontCheckoutStoreError("INVALID_QUANTITY", "quantity must be an integer from 1 to 25", 400);
  }
  return out;
}

export function nativeCheckoutRequestMatches(prior, {
  buyerId,
  itemId,
  requestedVariantId = null,
  quantity: requestedQuantity,
  stripeAccountId,
  livemode,
} = {}) {
  const snapshot = prior?.snapshot || {};
  const priorRequestedVariant = snapshot.requested_variant_id == null
    ? null : String(snapshot.requested_variant_id);
  return Boolean(prior)
    && prior.user_id === buyerId
    && prior.item_id === itemId
    && priorRequestedVariant === requestedVariantId
    && Number(prior.quantity) === requestedQuantity
    && prior.stripe_account_id === stripeAccountId
    && (prior.livemode === true) === livemode;
}

export function assertNativeCheckoutCurrency(value) {
  const currency = String(value || "");
  if (currency !== "usd") {
    throw new StorefrontCheckoutStoreError(
      "UNSUPPORTED_CURRENCY",
      "native checkout currently supports USD because the $1 passenger and $30 storefront fees are USD-denominated",
      409,
    );
  }
  return currency;
}

function providerId(value, prefix, name) {
  const out = text(value, name);
  if (!PROVIDER_ID_RE.test(out) || !out.startsWith(prefix)) {
    throw new StorefrontCheckoutStoreError("INVALID_PROVIDER_ID", `${name} is invalid`, 400);
  }
  return out;
}

async function durablePool() {
  const pool = await getPool();
  if (!pool) {
    throw new StorefrontCheckoutStoreError(
      "DURABLE_STORE_REQUIRED",
      "native checkout requires the durable inventory and order store",
      503,
    );
  }
  return pool;
}

async function transaction(fn) {
  const pool = await durablePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve first failure */ }
    throw error;
  } finally {
    client.release();
  }
}

function authorityOut(row) {
  return {
    itemId: row.item_id,
    title: row.title,
    storefrontId: String(row.storefront_id),
    listingId: String(row.listing_id),
    listingVersion: Number(row.listing_version),
    variantId: String(row.variant_id),
    variantVersion: Number(row.variant_version),
    variantLabel: row.variant_label,
    optionValues: row.option_values || {},
    unitMerchandiseCents: Number(row.price_cents),
    currency: row.currency,
    availableQuantity: Number(row.stock_on_hand) - Number(row.stock_reserved),
    stripeAccountId: row.stripe_account_id,
    expectedLivemode: row.expected_livemode === true,
  };
}

async function selectAuthority(target, { itemId, variantId = null, lock = false }) {
  const result = await target.query(
    `SELECT i.id AS item_id,i.commerce_rail,i.source_name,i.native_checkout_ready,
            l.id AS listing_id,l.title,l.version AS listing_version,l.state AS listing_state,
            s.id AS storefront_id,s.state AS storefront_state,
            v.id AS variant_id,v.label AS variant_label,v.option_values,v.version AS variant_version,
            v.price_cents,v.currency,v.stock_on_hand,v.stock_reserved,v.state AS variant_state,
            pa.stripe_account_id,pa.expected_livemode,pa.details_submitted,
            pa.charges_enabled,pa.payouts_enabled,pa.validation_version,pa.validated_at
       FROM items i
       JOIN native_listings l ON l.id=i.native_listing_id
       JOIN storefronts s ON s.id=l.storefront_id
       JOIN native_listing_variants v
         ON v.listing_id=l.id AND v.id=COALESCE($2::uuid,i.default_variant_id)
       JOIN storefront_payment_accounts pa ON pa.storefront_id=s.id
      WHERE i.id=$1
      ${lock ? "FOR UPDATE OF v,l,s,pa" : ""}`,
    [itemId, variantId],
  );
  return result.rows[0] || null;
}

function assertAuthority(row, { requestedQuantity, expectedLivemode, expectedStripeAccountId = null }) {
  if (!row) throw new StorefrontCheckoutStoreError("LISTING_NOT_FOUND", "native listing or variant not found", 404);
  if (row.commerce_rail !== "native_storefront" || row.source_name !== "asilum-native") {
    throw new StorefrontCheckoutStoreError("WRONG_RAIL", "item is not a native storefront listing", 409);
  }
  if (row.native_checkout_ready !== true || row.storefront_state !== "active"
    || row.listing_state !== "active" || row.variant_state !== "active") {
    throw new StorefrontCheckoutStoreError("LISTING_NOT_PURCHASABLE", "native listing is not ready for checkout", 409);
  }
  const price = Number(row.price_cents);
  if (!Number.isSafeInteger(price) || price <= 0 || !/^[a-z]{3}$/.test(String(row.currency || ""))) {
    throw new StorefrontCheckoutStoreError("INVALID_PRICE", "native listing has no authoritative integer price", 409);
  }
  assertNativeCheckoutCurrency(row.currency);
  const available = Number(row.stock_on_hand) - Number(row.stock_reserved);
  if (!Number.isSafeInteger(available) || available < requestedQuantity) {
    throw new StorefrontCheckoutStoreError("OUT_OF_STOCK", "not enough inventory is available", 409);
  }
  if (!ACCOUNT_RE.test(String(row.stripe_account_id || ""))
    || row.details_submitted !== true || row.charges_enabled !== true || row.payouts_enabled !== true
    || row.validation_version !== STOREFRONT_PAYMENT_VALIDATION_VERSION || !row.validated_at) {
    throw new StorefrontCheckoutStoreError("PAYMENT_ACCOUNT_NOT_READY", "seller payment account is not validated for native checkout", 409);
  }
  if ((row.expected_livemode === true) !== expectedLivemode) {
    throw new StorefrontCheckoutStoreError("PAYMENT_MODE_MISMATCH", "seller payment mode does not match this checkout", 409);
  }
  if (expectedStripeAccountId && row.stripe_account_id !== expectedStripeAccountId) {
    throw new StorefrontCheckoutStoreError("PAYMENT_ACCOUNT_CHANGED", "seller payment account changed during checkout", 409);
  }
}

export async function resolveNativeCheckoutAuthority({ itemId: rawItem, variantId: rawVariant = null, quantity: rawQuantity = 1, expectedLivemode = false } = {}) {
  const itemId = text(rawItem, "item id", 80);
  const variantId = rawVariant ? uuid(rawVariant, "variant id") : null;
  const requestedQuantity = quantity(rawQuantity);
  const pool = await durablePool();
  const row = await selectAuthority(pool, { itemId, variantId });
  assertAuthority(row, { requestedQuantity, expectedLivemode });
  return authorityOut(row);
}

async function refreshItemProjection(client, listingId) {
  await client.query(
    `WITH facts AS (
       SELECT l.id,
              (s.state='active' AND l.state='active') AS visible,
              COALESCE(sum(GREATEST(0,v.stock_on_hand-v.stock_reserved))
                FILTER (WHERE v.state='active'),0)::integer AS available
         FROM native_listings l
         JOIN storefronts s ON s.id=l.storefront_id
         LEFT JOIN native_listing_variants v ON v.listing_id=l.id
        WHERE l.id=$1 GROUP BY l.id,s.state,l.state
     )
     UPDATE items i SET inventory_available=f.available,
       is_available=(f.visible AND f.available>0),
       availability_status=CASE WHEN f.visible AND f.available>0 THEN 'available'
                                WHEN f.visible THEN 'sold' ELSE 'unknown' END,
       updated_at=now()
     FROM facts f WHERE i.native_listing_id=f.id`,
    [listingId],
  );
}

export async function prepareNativeCheckout({
  buyerId: rawBuyer,
  itemId: rawItem,
  variantId: rawVariant = null,
  quantity: rawQuantity = 1,
  requestKey: rawRequestKey = null,
  expectedLivemode = false,
  expectedStripeAccountId,
  // slice 6: the accepted offer's unit price for this buyer (8.7); null = the public price
  unitPriceOverrideCents = null,
  offerId = null,
} = {}) {
  const buyerId = text(rawBuyer, "buyer account", 80);
  const override = unitPriceOverrideCents == null ? null : Number(unitPriceOverrideCents);
  if (override != null && (!Number.isSafeInteger(override) || override <= 0)) {
    throw new StorefrontCheckoutStoreError("INVALID_INPUT", "an accepted price is a positive whole number of cents", 400);
  }
  if (!/^sb-[0-9a-f-]{36}$/i.test(buyerId)) {
    throw new StorefrontCheckoutStoreError("ACCOUNT_REQUIRED", "a signed-in account is required", 403);
  }
  const itemId = text(rawItem, "item id", 80);
  const variantId = rawVariant ? uuid(rawVariant, "variant id") : null;
  const requestedQuantity = quantity(rawQuantity);
  const requestKey = rawRequestKey ? uuid(rawRequestKey, "checkout idempotency key") : null;
  const expectedAccount = text(expectedStripeAccountId, "Stripe account id");
  const orderId = `ord_${crypto.randomUUID()}`;
  const attemptId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  // Stripe Checkout requires expires_at to be at least 30 minutes after the
  // create request. A one-hour, whole-second boundary leaves a safe retry
  // window and is copied unchanged to Stripe and the inventory reservation.
  const expirySeconds = Math.floor(Date.now() / 1000) + 60 * 60;
  const expiry = new Date(expirySeconds * 1000).toISOString();
  const idempotencyKey = requestKey
    ? `native-checkout-${buyerId.slice(3).toLowerCase()}-${requestKey}`
    : `native-checkout-${attemptId}`;

  return transaction(async (client) => {
    if (requestKey) {
      // Serialize identical client retries before checking the durable key.
      // The table uniqueness constraint remains the final integrity guard;
      // this transaction lock turns concurrent duplicates into clean replays.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [idempotencyKey]);
      const priorResult = await client.query(
        `SELECT a.id AS attempt_id,a.idempotency_key,a.stripe_session_id,a.status AS attempt_status,
                a.stripe_account_id,a.livemode,o.id AS order_id,o.user_id,o.item_id,
                o.merchandise_cents,o.passenger_fee_cents,o.buyer_total_cents,o.currency,
                o.quote_expires_at,ol.storefront_id,ol.listing_id,ol.variant_id,ol.quantity,
                ol.unit_merchandise_cents,ol.unit_passenger_fee_cents,ol.listing_version,
                ol.variant_version,ol.snapshot,r.id AS reservation_id,r.state AS reservation_state,
                l.title,v.label AS variant_label,v.option_values
           FROM payment_attempts a
           JOIN orders o ON o.id=a.order_id AND o.storefront_id=a.storefront_id
           JOIN order_lines ol
             ON ol.order_id=o.id AND ol.storefront_id=o.storefront_id AND ol.line_number=1
           JOIN inventory_reservations r
             ON r.payment_attempt_id=a.id AND r.order_id=o.id
            AND r.storefront_id=o.storefront_id AND r.variant_id=ol.variant_id
           JOIN native_listings l ON l.id=ol.listing_id AND l.storefront_id=ol.storefront_id
           JOIN native_listing_variants v ON v.id=ol.variant_id AND v.listing_id=ol.listing_id
          WHERE a.idempotency_key=$1 FOR UPDATE OF a,o,r`,
        [idempotencyKey],
      );
      const prior = priorResult.rows[0];
      if (prior) {
        const snapshot = prior.snapshot || {};
        const same = nativeCheckoutRequestMatches(prior, {
          buyerId,
          itemId,
          requestedVariantId: variantId,
          quantity: requestedQuantity,
          stripeAccountId: expectedAccount,
          livemode: expectedLivemode,
        });
        if (!same) throw new StorefrontCheckoutStoreError("IDEMPOTENCY_CONFLICT", "checkout idempotency key was already used for different inputs", 409);
        if (!["prepared", "provider_pending", "reconcile_required", "requires_action"].includes(prior.attempt_status)
          || prior.reservation_state !== "active") {
          throw new StorefrontCheckoutStoreError("CHECKOUT_TERMINAL", "that checkout operation is already terminal", 409);
        }
        return {
          itemId: prior.item_id,
          title: prior.title,
          storefrontId: String(prior.storefront_id),
          listingId: String(prior.listing_id),
          listingVersion: Number(prior.listing_version),
          variantId: String(prior.variant_id),
          variantVersion: Number(prior.variant_version),
          variantLabel: prior.variant_label,
          optionValues: prior.option_values || {},
          unitMerchandiseCents: Number(prior.unit_merchandise_cents),
          currency: prior.currency,
          stripeAccountId: prior.stripe_account_id,
          expectedLivemode,
          buyerId,
          orderId: prior.order_id,
          attemptId: String(prior.attempt_id),
          reservationId: String(prior.reservation_id),
          idempotencyKey: prior.idempotency_key,
          sessionId: prior.stripe_session_id || null,
          quoteExpiresAt: prior.quote_expires_at,
          storefrontFeeReservedCents: 0,
          duplicate: true,
          quote: {
            policyVersion: PASSENGER_FEE_POLICY_VERSION,
            currency: prior.currency,
            unitCount: Number(prior.quantity),
            allocatedUnitAmountsCents: snapshot.allocated_unit_amounts_cents || Array(Number(prior.quantity)).fill(Number(prior.unit_merchandise_cents)),
            passengerFeeUnitCents: snapshot.passenger_fee_unit_cents || Array(Number(prior.quantity)).fill(Number(prior.unit_passenger_fee_cents)),
            merchandiseCents: Number(prior.merchandise_cents),
            discountCents: 0,
            passengerFeeCents: Number(prior.passenger_fee_cents),
            shippingCents: 0,
            handlingCents: 0,
            taxCents: 0,
            buyerTotalCents: Number(prior.buyer_total_cents),
          },
        };
      }
    }
    const row = await selectAuthority(client, { itemId, variantId, lock: true });
    assertAuthority(row, { requestedQuantity, expectedLivemode, expectedStripeAccountId: expectedAccount });
    const authority = authorityOut(row);
    if (override != null) authority.unitMerchandiseCents = override;
    const quote = quoteNativeOrder({
      unitAmountsCents: Array(requestedQuantity).fill(authority.unitMerchandiseCents),
      currency: authority.currency,
    });
    // The one-time $30 collection is deliberately zero here. Exact processing
    // cost is not known before capture, so there is no safe seller-proceeds
    // amount to reserve. The fee account carries the full remainder forward.
    const storefrontFeeReservedCents = 0;

    await client.query(
      `INSERT INTO orders
         (id,user_id,item_id,status,amount_cents,fee_cents,currency,kind,commerce_rail,
          storefront_id,pricing_policy_version,quote_expires_at,merchandise_cents,
          passenger_fee_cents,shipping_cents,handling_cents,tax_cents,buyer_total_cents,
          stripe_connected_account_id,stripe_livemode,storefront_fee_reserved_cents)
       VALUES ($1,$2,$3,'created',$4,$5,$6,'sale','native_storefront',$7,$8,$9,
               $4,$5,0,0,0,$10,$11,$12,0)`,
      [orderId, buyerId, itemId, quote.merchandiseCents, quote.passengerFeeCents,
        quote.currency, authority.storefrontId, PASSENGER_FEE_POLICY_VERSION, expiry,
        quote.buyerTotalCents, authority.stripeAccountId, expectedLivemode],
    );
    await client.query(
      `INSERT INTO order_events (order_id,type,source,payload)
       VALUES ($1,'created','api',$2::jsonb)`,
      [orderId, JSON.stringify({ commerce_rail: "native_storefront", quantity: requestedQuantity })],
    );
    await client.query(
      `INSERT INTO order_lines
         (id,order_id,line_number,storefront_id,listing_id,variant_id,quantity,
          unit_merchandise_cents,unit_passenger_fee_cents,listing_version,variant_version,snapshot)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [lineId, orderId, authority.storefrontId, authority.listingId, authority.variantId,
        requestedQuantity, authority.unitMerchandiseCents, quote.passengerFeeUnitCents[0],
        authority.listingVersion, authority.variantVersion, JSON.stringify({
          title: authority.title,
          variant_label: authority.variantLabel,
          option_values: authority.optionValues,
          requested_variant_id: variantId,
          allocated_unit_amounts_cents: quote.allocatedUnitAmountsCents,
          passenger_fee_unit_cents: quote.passengerFeeUnitCents,
          accepted_offer_id: offerId,
          unit_price_override_cents: override,
        })],
    );
    await client.query(
      `INSERT INTO payment_attempts
         (id,order_id,storefront_id,idempotency_key,stripe_account_id,livemode,
          expected_buyer_total_cents,passenger_fee_cents,storefront_fee_reserved_cents,
          application_fee_cents,currency,status,next_reconcile_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9,'prepared',now()+interval '5 minutes')`,
      [attemptId, orderId, authority.storefrontId, idempotencyKey, authority.stripeAccountId,
        expectedLivemode, quote.buyerTotalCents, quote.passengerFeeCents, quote.currency],
    );
    const reserved = await client.query(
      `UPDATE native_listing_variants SET stock_reserved=stock_reserved+$2,
         version=version+1,updated_at=now()
       WHERE id=$1 AND stock_on_hand-stock_reserved >= $2 RETURNING id`,
      [authority.variantId, requestedQuantity],
    );
    if (!reserved.rows[0]) throw new StorefrontCheckoutStoreError("OUT_OF_STOCK", "inventory changed during checkout", 409);
    await client.query(
      `INSERT INTO inventory_reservations
         (id,storefront_id,listing_id,variant_id,order_id,payment_attempt_id,
          operation_key,quantity,state,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
      [reservationId, authority.storefrontId, authority.listingId, authority.variantId,
        orderId, attemptId, `native-reserve-${attemptId}`, requestedQuantity, expiry],
    );
    await refreshItemProjection(client, authority.listingId);
    return {
      ...authority,
      buyerId,
      orderId,
      attemptId,
      reservationId,
      idempotencyKey,
      quoteExpiresAt: expiry,
      storefrontFeeReservedCents,
      quote,
    };
  });
}

export async function attachNativeCheckoutSession({ attemptId: rawAttempt, sessionId: rawSession } = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  const sessionId = providerId(rawSession, "cs_", "checkout session id");
  return transaction(async (client) => {
    const attemptResult = await client.query("SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE", [attemptId]);
    const attempt = attemptResult.rows[0];
    if (!attempt) throw new StorefrontCheckoutStoreError("ATTEMPT_NOT_FOUND", "payment attempt not found", 404);
    if (attempt.stripe_session_id) {
      if (attempt.stripe_session_id !== sessionId) {
        throw new StorefrontCheckoutStoreError("PROVIDER_MISMATCH", "payment attempt is already bound to another session", 409);
      }
      return { duplicate: true, orderId: attempt.order_id, sessionId };
    }
    await client.query(
      `UPDATE payment_attempts SET stripe_session_id=$2,status='provider_pending',
         next_reconcile_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1`,
      [attemptId, sessionId],
    );
    await client.query(
      `UPDATE orders SET stripe_session_id=$2,status='awaiting_payment',updated_at=now()
       WHERE id=$1 AND status='created'`,
      [attempt.order_id, sessionId],
    );
    await client.query(
      `INSERT INTO order_events (order_id,type,source,payload)
       VALUES ($1,'checkout_opened','api',$2::jsonb)`,
      [attempt.order_id, JSON.stringify({ session: sessionId, attempt: attemptId })],
    );
    return { duplicate: false, orderId: attempt.order_id, sessionId };
  });
}

export async function markNativeAttemptReconcileRequired({ attemptId: rawAttempt, reason = "provider session needs reconciliation" } = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  const pool = await durablePool();
  await pool.query(
    `UPDATE payment_attempts SET status='reconcile_required',last_error=$2,
       next_reconcile_at=now(),updated_at=now() WHERE id=$1 AND status<>'succeeded'`,
    [attemptId, String(reason).slice(0, 500)],
  );
}

function contextOut(row) {
  if (!row) return null;
  const quoteExpiry = row.quote_expires_at instanceof Date
    ? row.quote_expires_at.toISOString() : row.quote_expires_at;
  return {
    attemptId: String(row.attempt_id),
    attemptStatus: row.attempt_status,
    orderId: row.order_id,
    orderStatus: row.order_status,
    buyerId: row.user_id,
    itemId: row.item_id,
    storefrontId: String(row.storefront_id),
    listingId: String(row.listing_id),
    variantId: String(row.variant_id),
    quantity: Number(row.quantity),
    reservationId: String(row.reservation_id),
    reservationState: row.reservation_state,
    stripeAccountId: row.stripe_account_id,
    livemode: row.livemode === true,
    sessionId: row.stripe_session_id || null,
    idempotencyKey: row.idempotency_key,
    paymentIntentId: row.stripe_payment_intent_id || null,
    title: typeof row.snapshot?.title === "string" ? row.snapshot.title : row.item_id,
    merchandiseCents: Number(row.merchandise_cents),
    buyerTotalCents: Number(row.expected_buyer_total_cents),
    passengerFeeCents: Number(row.passenger_fee_cents),
    storefrontFeeReservedCents: Number(row.storefront_fee_reserved_cents),
    applicationFeeCents: Number(row.application_fee_cents),
    currency: row.currency,
    quoteExpiresAt: quoteExpiry,
    expiresAtSeconds: Math.floor(new Date(quoteExpiry).getTime() / 1000),
    reconcileAttempts: Number(row.reconcile_attempts || 0),
  };
}

export async function getNativeCheckoutContext({ orderId = null, sessionId = null, paymentIntentId = null } = {}) {
  const pool = await durablePool();
  let clause;
  let value;
  if (orderId) { clause = "a.order_id=$1"; value = text(orderId, "order id", 80); }
  else if (sessionId) { clause = "a.stripe_session_id=$1"; value = providerId(sessionId, "cs_", "checkout session id"); }
  else if (paymentIntentId) { clause = "a.stripe_payment_intent_id=$1"; value = providerId(paymentIntentId, "pi_", "payment intent id"); }
  else throw new StorefrontCheckoutStoreError("INVALID_INPUT", "a provider or order id is required", 400);
  const result = await pool.query(
    `SELECT a.id AS attempt_id,a.status AS attempt_status,a.*,o.status AS order_status,o.user_id,o.item_id,
            o.merchandise_cents,o.quote_expires_at,ol.listing_id,ol.variant_id,ol.quantity,ol.snapshot,
            r.id AS reservation_id,r.state AS reservation_state
       FROM payment_attempts a
       JOIN orders o ON o.id=a.order_id AND o.storefront_id=a.storefront_id
       JOIN order_lines ol ON ol.order_id=o.id AND ol.storefront_id=o.storefront_id AND ol.line_number=1
       JOIN inventory_reservations r ON r.order_id=o.id AND r.payment_attempt_id=a.id
      WHERE ${clause} AND o.commerce_rail='native_storefront'
      ORDER BY a.created_at DESC LIMIT 1`,
    [value],
  );
  return contextOut(result.rows[0]);
}

export async function claimDueNativeCheckoutAttempts({ limit: rawLimit = 10, leaseSeconds: rawLease = 600 } = {}) {
  const limit = Math.trunc(Number(rawLimit));
  const leaseSeconds = Math.trunc(Number(rawLease));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new StorefrontCheckoutStoreError("INVALID_LIMIT", "reconciliation limit must be from 1 to 25", 400);
  }
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 1800) {
    throw new StorefrontCheckoutStoreError("INVALID_LEASE", "reconciliation lease must be from 60 to 1800 seconds", 400);
  }
  return transaction(async (client) => {
    const claimed = await client.query(
      `WITH due AS (
         SELECT a.id
           FROM payment_attempts a
           JOIN orders o ON o.id=a.order_id AND o.storefront_id=a.storefront_id
           JOIN inventory_reservations r
             ON r.payment_attempt_id=a.id AND r.order_id=a.order_id AND r.storefront_id=a.storefront_id
          WHERE o.commerce_rail='native_storefront'
            AND a.status IN ('prepared','provider_pending','reconcile_required','requires_action')
            AND r.state='active'
            AND a.next_reconcile_at IS NOT NULL AND a.next_reconcile_at <= now()
          ORDER BY a.next_reconcile_at,a.created_at
          LIMIT $1
          FOR UPDATE OF a SKIP LOCKED
       )
       UPDATE payment_attempts a
          SET reconcile_attempts=a.reconcile_attempts+1,
              next_reconcile_at=now()+($2::integer * interval '1 second'),updated_at=now()
         FROM due WHERE a.id=due.id RETURNING a.id`,
      [limit, leaseSeconds],
    );
    const ids = claimed.rows.map((row) => row.id);
    if (!ids.length) return [];
    const result = await client.query(
      `SELECT a.id AS attempt_id,a.status AS attempt_status,a.*,o.status AS order_status,o.user_id,o.item_id,
              o.merchandise_cents,o.quote_expires_at,ol.listing_id,ol.variant_id,ol.quantity,ol.snapshot,
              r.id AS reservation_id,r.state AS reservation_state
         FROM payment_attempts a
         JOIN orders o ON o.id=a.order_id AND o.storefront_id=a.storefront_id
         JOIN order_lines ol ON ol.order_id=o.id AND ol.storefront_id=o.storefront_id AND ol.line_number=1
         JOIN inventory_reservations r
           ON r.payment_attempt_id=a.id AND r.order_id=o.id AND r.storefront_id=o.storefront_id
        WHERE a.id=ANY($1::uuid[])
        ORDER BY a.next_reconcile_at,a.created_at`,
      [ids],
    );
    return result.rows.map(contextOut);
  });
}

export async function deferNativeCheckoutAttempt({ attemptId: rawAttempt, reason, delaySeconds: rawDelay = 300 } = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  const delaySeconds = Math.trunc(Number(rawDelay));
  if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 60 || delaySeconds > 1800) {
    throw new StorefrontCheckoutStoreError("INVALID_DELAY", "reconciliation delay must be from 60 to 1800 seconds", 400);
  }
  const pool = await durablePool();
  const result = await pool.query(
    `UPDATE payment_attempts
        SET status=CASE WHEN status='prepared' THEN 'reconcile_required' ELSE status END,
            last_error=$2,next_reconcile_at=now()+($3::integer * interval '1 second'),updated_at=now()
      WHERE id=$1 AND status IN ('prepared','provider_pending','reconcile_required','requires_action')
      RETURNING id`,
    [attemptId, String(reason || "provider reconciliation pending").slice(0, 500), delaySeconds],
  );
  return Boolean(result.rows[0]);
}

export async function holdNativeCheckoutAttempt({ attemptId: rawAttempt, reason } = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  const pool = await durablePool();
  const result = await pool.query(
    `UPDATE payment_attempts
        SET status='reconcile_required',last_error=$2,next_reconcile_at=NULL,updated_at=now()
      WHERE id=$1 AND status IN ('prepared','provider_pending','reconcile_required','requires_action')
      RETURNING id`,
    [attemptId, String(reason || "manual provider reconciliation required").slice(0, 500)],
  );
  return Boolean(result.rows[0]);
}

function inboxOut(row, inserted) {
  return row ? {
    eventId: row.stripe_event_id,
    status: row.status,
    attempts: Number(row.attempts),
    duplicate: !inserted,
  } : null;
}

export async function receiveNativeStripeEvent({ eventId, accountId = null, livemode, type, objectId = null, payload = {} } = {}) {
  const id = providerId(eventId, "evt_", "Stripe event id");
  const account = accountId == null ? null : text(accountId, "Stripe account id");
  if (account && !ACCOUNT_RE.test(account)) throw new StorefrontCheckoutStoreError("INVALID_PROVIDER_ID", "Stripe account id is invalid", 400);
  if (typeof livemode !== "boolean") throw new StorefrontCheckoutStoreError("INVALID_EVENT", "Stripe event mode is missing", 400);
  const eventType = text(type, "Stripe event type", 120);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO stripe_event_inbox
         (stripe_event_id,stripe_account_id,livemode,type,object_id,payload,status,attempts)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'pending',0)
       ON CONFLICT (stripe_event_id) DO NOTHING RETURNING *`,
      [id, account, livemode, eventType, objectId ? String(objectId).slice(0, 255) : null,
        JSON.stringify(safePayload)],
    );
    const row = inserted.rows[0] || (await client.query(
      "SELECT * FROM stripe_event_inbox WHERE stripe_event_id=$1 FOR UPDATE",
      [id],
    )).rows[0];
    if (!row) throw new StorefrontCheckoutStoreError("EVENT_INBOX_FAILED", "Stripe event could not be received", 500);
    if (!["processed", "ignored"].includes(row.status)) {
      const updated = await client.query(
        `UPDATE stripe_event_inbox SET attempts=attempts+1,status='pending',last_error=NULL,
           next_attempt_at=NULL WHERE stripe_event_id=$1 RETURNING *`,
        [id],
      );
      return inboxOut(updated.rows[0], Boolean(inserted.rows[0]));
    }
    return inboxOut(row, false);
  });
}

export async function markNativeStripeEvent({ eventId, status, error = null } = {}) {
  const id = providerId(eventId, "evt_", "Stripe event id");
  if (!["processed", "failed", "ignored"].includes(status)) {
    throw new StorefrontCheckoutStoreError("INVALID_EVENT_STATE", "invalid Stripe event inbox state", 400);
  }
  const pool = await durablePool();
  await pool.query(
    `UPDATE stripe_event_inbox SET status=$2,last_error=$3,
       next_attempt_at=CASE WHEN $2='failed' THEN now()+interval '1 minute' ELSE NULL END,
       processed_at=CASE WHEN $2 IN ('processed','ignored') THEN now() ELSE NULL END
     WHERE stripe_event_id=$1`,
    [id, status, error ? String(error).slice(0, 500) : null],
  );
}

async function lockAttemptGraph(client, attemptId) {
  const preview = await client.query(
    `SELECT r.variant_id FROM payment_attempts a
       JOIN inventory_reservations r ON r.payment_attempt_id=a.id AND r.order_id=a.order_id
      WHERE a.id=$1`,
    [attemptId],
  );
  if (!preview.rows[0]) throw new StorefrontCheckoutStoreError("ATTEMPT_NOT_FOUND", "payment attempt not found", 404);
  await client.query("SELECT id FROM native_listing_variants WHERE id=$1 FOR UPDATE", [preview.rows[0].variant_id]);
  const result = await client.query(
    `SELECT a.id AS attempt_id,a.status AS attempt_status,a.*,o.status AS order_status,o.user_id,o.item_id,
            ol.listing_id,ol.variant_id,ol.quantity,r.id AS reservation_id,r.state AS reservation_state
       FROM payment_attempts a
       JOIN orders o ON o.id=a.order_id AND o.storefront_id=a.storefront_id
       JOIN order_lines ol ON ol.order_id=o.id AND ol.storefront_id=o.storefront_id AND ol.line_number=1
       JOIN inventory_reservations r ON r.order_id=o.id AND r.payment_attempt_id=a.id
      WHERE a.id=$1 FOR UPDATE OF a,o,r`,
    [attemptId],
  );
  if (!result.rows[0]) {
    throw new StorefrontCheckoutStoreError("ATTEMPT_GRAPH_INVALID", "payment attempt persistence graph is incomplete", 500);
  }
  return result.rows[0];
}

function validateSettlement(row, facts) {
  const pairs = [
    [facts.accountId, row.stripe_account_id, "connected account"],
    [facts.currency, row.currency, "currency"],
    [facts.orderId, row.order_id, "order"],
    [facts.itemId, row.item_id, "item"],
  ];
  for (const [actual, expected, label] of pairs) {
    if (actual !== expected) throw new StorefrontCheckoutStoreError("PROVIDER_MISMATCH", `${label} does not match the prepared checkout`, 409);
  }
  if (facts.livemode !== (row.livemode === true)
    || facts.buyerTotalCents !== Number(row.expected_buyer_total_cents)
    || facts.applicationFeeCents !== Number(row.application_fee_cents)
    || Number(row.storefront_fee_reserved_cents) !== 0) {
    throw new StorefrontCheckoutStoreError("PROVIDER_MISMATCH", "provider money does not match the prepared checkout", 409);
  }
}

export async function settleNativeCheckout({ attemptId: rawAttempt, eventId = null, source = "webhook", provider } = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  if (!provider || typeof provider !== "object") throw new StorefrontCheckoutStoreError("INVALID_PROVIDER_STATE", "verified provider state is required", 400);
  const stripeEventId = eventId ? providerId(eventId, "evt_", "Stripe event id") : null;
  return transaction(async (client) => {
    const row = await lockAttemptGraph(client, attemptId);
    validateSettlement(row, provider);
    if (row.attempt_status === "succeeded" && row.order_status === "paid" && row.reservation_state === "consumed") {
      if (stripeEventId) await client.query(
        "UPDATE stripe_event_inbox SET status='processed',processed_at=now(),last_error=NULL WHERE stripe_event_id=$1",
        [stripeEventId],
      );
      return { duplicate: true, settled: true, orderId: row.order_id };
    }
    if (row.reservation_state !== "active") {
      throw new StorefrontCheckoutStoreError("INVENTORY_NOT_RESERVED", "paid checkout no longer has fulfillable reserved inventory", 409);
    }
    const inventory = await client.query(
      `UPDATE native_listing_variants SET stock_reserved=stock_reserved-$2,stock_on_hand=stock_on_hand-$2,
         version=version+1,updated_at=now()
       WHERE id=$1 AND stock_reserved >= $2 AND stock_on_hand >= $2 RETURNING id`,
      [row.variant_id, row.quantity],
    );
    if (!inventory.rows[0]) throw new StorefrontCheckoutStoreError("INVENTORY_MISMATCH", "reserved inventory cannot be consumed", 409);
    await client.query(
      `UPDATE inventory_reservations SET state='consumed',terminal_operation_key=$2,
         terminal_reason='provider-payment-verified',terminal_at=now(),updated_at=now() WHERE id=$1`,
      [row.reservation_id, `native-paid-${attemptId}`],
    );
    await client.query(
      `UPDATE payment_attempts SET status='succeeded',stripe_session_id=$2,
         stripe_payment_intent_id=$3,stripe_charge_id=$4,stripe_balance_transaction_id=$5,
         stripe_application_fee_id=$6,next_reconcile_at=NULL,last_error=NULL,updated_at=now()
       WHERE id=$1`,
      [attemptId, provider.sessionId, provider.paymentIntentId, provider.chargeId,
        provider.balanceTransactionId, provider.applicationFeeId],
    );
    await client.query(
      `UPDATE orders SET status='paid',stripe_session_id=$2,stripe_payment_intent_id=$3,
         updated_at=now() WHERE id=$1 AND status NOT IN ('paid','refunded')`,
      [row.order_id, provider.sessionId, provider.paymentIntentId],
    );
    const eventInsert = await client.query(
      `INSERT INTO order_events (order_id,type,source,stripe_event_id,payload)
       VALUES ($1,'paid',$2,$3,$4::jsonb)
       ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`,
      [row.order_id, source, stripeEventId, JSON.stringify({
        session: provider.sessionId,
        payment_intent: provider.paymentIntentId,
        charge: provider.chargeId,
        application_fee_cents: provider.applicationFeeCents,
        storefront_fee_cents: 0,
      })],
    );
    if (stripeEventId && !eventInsert.rows[0]) {
      throw new StorefrontCheckoutStoreError("EVENT_REUSED", "Stripe event was already applied to another transition", 409);
    }
    if (stripeEventId) await client.query(
      "UPDATE stripe_event_inbox SET status='processed',processed_at=now(),last_error=NULL WHERE stripe_event_id=$1",
      [stripeEventId],
    );
    await refreshItemProjection(client, row.listing_id);
    return { duplicate: false, settled: true, orderId: row.order_id };
  });
}

export async function releaseNativeCheckout({
  attemptId: rawAttempt,
  eventId = null,
  source = "webhook",
  reason = "provider-terminal-without-payment",
  orderStatus = "expired",
} = {}) {
  const attemptId = uuid(rawAttempt, "payment attempt id");
  const stripeEventId = eventId ? providerId(eventId, "evt_", "Stripe event id") : null;
  if (!['expired', 'failed'].includes(orderStatus)) {
    throw new StorefrontCheckoutStoreError("INVALID_STATUS", "invalid unpaid terminal status", 400);
  }
  return transaction(async (client) => {
    const row = await lockAttemptGraph(client, attemptId);
    if (row.reservation_state === "released") {
      if (stripeEventId) await client.query(
        "UPDATE stripe_event_inbox SET status='processed',processed_at=now(),last_error=NULL WHERE stripe_event_id=$1",
        [stripeEventId],
      );
      return { duplicate: true, released: true, orderId: row.order_id };
    }
    if (row.reservation_state === "consumed" || row.attempt_status === "succeeded" || row.order_status === "paid") {
      throw new StorefrontCheckoutStoreError("PAID_NOT_RELEASABLE", "paid inventory cannot be released", 409);
    }
    const inventory = await client.query(
      `UPDATE native_listing_variants SET stock_reserved=stock_reserved-$2,
         version=version+1,updated_at=now() WHERE id=$1 AND stock_reserved >= $2 RETURNING id`,
      [row.variant_id, row.quantity],
    );
    if (!inventory.rows[0]) throw new StorefrontCheckoutStoreError("INVENTORY_MISMATCH", "reserved inventory cannot be released", 409);
    await client.query(
      `UPDATE inventory_reservations SET state='released',terminal_operation_key=$2,
         terminal_reason=$3,terminal_at=now(),updated_at=now() WHERE id=$1`,
      [row.reservation_id, `native-unpaid-${attemptId}`, String(reason).slice(0, 240)],
    );
    await client.query(
      `UPDATE payment_attempts SET status=$2,last_error=$3,next_reconcile_at=NULL,updated_at=now()
       WHERE id=$1`,
      [attemptId, orderStatus === "expired" ? "cancelled" : "failed", String(reason).slice(0, 500)],
    );
    await client.query(
      `UPDATE orders SET status=$2,updated_at=now() WHERE id=$1 AND status NOT IN ('paid','refunded')`,
      [row.order_id, orderStatus],
    );
    const inserted = await client.query(
      `INSERT INTO order_events (order_id,type,source,stripe_event_id,payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`,
      [row.order_id, orderStatus, source, stripeEventId, JSON.stringify({ reason })],
    );
    if (stripeEventId && !inserted.rows[0]) {
      throw new StorefrontCheckoutStoreError("EVENT_REUSED", "Stripe event was already applied to another transition", 409);
    }
    if (stripeEventId) await client.query(
      "UPDATE stripe_event_inbox SET status='processed',processed_at=now(),last_error=NULL WHERE stripe_event_id=$1",
      [stripeEventId],
    );
    await refreshItemProjection(client, row.listing_id);
    return { duplicate: false, released: true, orderId: row.order_id };
  });
}

export function failNativeCheckoutPreparation({ attemptId, reason = "provider session creation failed" } = {}) {
  return releaseNativeCheckout({ attemptId, source: "api", reason, orderStatus: "failed" });
}

/** Seller-safe order projection: no buyer id, provider secret, payment method,
 * or private account state crosses the owner API boundary. Native money is
 * durable-only, so keyless previews truthfully have no paid order history. */
export async function listNativeStorefrontOrdersForOwner(ownerAccountId, limit = 50) {
  const owner = uuid(ownerAccountId, "storefront owner account id");
  const cap = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 50));
  const pool = await getPool();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT o.id,o.status,o.item_id,o.merchandise_cents,o.passenger_fee_cents,
            o.shipping_cents,o.handling_cents,o.tax_cents,o.buyer_total_cents,
            o.currency,o.created_at,o.updated_at,ol.quantity,ol.snapshot,
            a.status AS payment_status
       FROM storefronts s
       JOIN orders o ON o.storefront_id=s.id AND o.commerce_rail='native_storefront'
       JOIN order_lines ol ON ol.order_id=o.id AND ol.storefront_id=s.id AND ol.line_number=1
       LEFT JOIN payment_attempts a ON a.order_id=o.id AND a.storefront_id=s.id
      WHERE s.owner_account_id=$1
      ORDER BY o.created_at DESC LIMIT $2`,
    [owner, cap],
  );
  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    itemId: row.item_id,
    title: typeof row.snapshot?.title === "string" ? row.snapshot.title : null,
    variantLabel: typeof row.snapshot?.variant_label === "string" ? row.snapshot.variant_label : null,
    quantity: Number(row.quantity),
    merchandiseCents: Number(row.merchandise_cents || 0),
    passengerFeeCents: Number(row.passenger_fee_cents || 0),
    storefrontFeeCents: 0,
    shippingCents: Number(row.shipping_cents || 0),
    handlingCents: Number(row.handling_cents || 0),
    taxCents: Number(row.tax_cents || 0),
    buyerTotalCents: Number(row.buyer_total_cents || 0),
    currency: row.currency,
    paymentStatus: row.payment_status || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}
