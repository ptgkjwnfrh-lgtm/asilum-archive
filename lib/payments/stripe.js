// lib/payments/stripe.js
// Thin Stripe REST client: fetch + form encoding + node crypto, no SDK (stack
// law: no new runtime dependencies). SERVER-ONLY — never import from client
// modules. Test vs live is decided solely by which key sits in
// STRIPE_SECRET_KEY; nothing here chooses a mode.
//
// Checkout is Stripe-HOSTED: the buyer pays on checkout.stripe.com, so card
// data never touches this codebase or its servers (SAQ-A posture). The only
// Stripe artifacts we hold are session/event ids and the secret key itself.

import crypto from "node:crypto";

const API = "https://api.stripe.com/v1";
export const STRIPE_API_VERSION = "2026-09-30.endive";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const RETRYABLE_GET_STATUSES = new Set([409, 429, 500, 502, 503, 504]);
const CONNECTED_ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,64}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/;
const API_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9_-]+$/;
const REQUEST_ID_RE = /^req_[A-Za-z0-9]+$/;

/** Is a Stripe secret key present? Every payment surface answers 503 when this
 *  is false rather than failing at the API call — an unconfigured deployment
 *  says so honestly instead of looking broken. */
export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export class StripeApiError extends Error {
  constructor(status, body, { requestId = null } = {}) {
    const inner = body && body.error ? body.error : {};
    super(inner.message || `stripe request failed (${status})`);
    this.name = "StripeApiError";
    this.status = status;
    this.code = inner.code || null;
    this.type = inner.type || null;
    // Stripe's opaque request id is safe and useful for provider support. Do
    // not attach the response, request body, headers, account secret, or key.
    this.requestId = typeof requestId === "string" && REQUEST_ID_RE.test(requestId)
      ? requestId : null;
  }
}

function connectedAccountId(value) {
  const account = String(value || "");
  if (!CONNECTED_ACCOUNT_RE.test(account)) {
    throw new TypeError("Stripe connected account must be an acct_ id");
  }
  return account;
}

function stableIdempotencyKey(value) {
  const key = String(value || "");
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new TypeError("Stripe idempotency key must be 1-255 safe ASCII characters");
  }
  return key;
}

function stripeApiVersion(value) {
  const version = String(value || "");
  if (!API_VERSION_RE.test(version)) throw new TypeError("invalid Stripe API version");
  return version;
}

function stripeTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`Stripe timeout must be an integer from 1 to ${MAX_TIMEOUT_MS}ms`);
  }
  return value;
}

function minorUnits(value, name, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new TypeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} integer number of cents`);
  }
  return value;
}

function stripeObjectId(value, name) {
  const id = String(value || "");
  if (!/^[A-Za-z]+_[A-Za-z0-9_]+$/.test(id) || id.length > 255) {
    throw new TypeError(`${name} must be a Stripe object id`);
  }
  return id;
}

function responseRequestId(response) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return null;
  return response.headers.get("request-id");
}

function transportError(timedOut) {
  return new StripeApiError(0, {
    error: {
      message: timedOut ? "Stripe request timed out" : "Stripe network request failed",
      code: timedOut ? "timeout" : "network_error",
      type: "api_connection_error",
    },
  });
}

function retryPause() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

// Stripe's form encoding for nested params: {a:{b:1}, c:[{d:2}]} →
// a[b]=1&c[0][d]=2. Arrays index, objects bracket, scalars stringify.
export function stripeFormEncode(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((entry, i) => {
        if (entry && typeof entry === "object") stripeFormEncode(entry, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(entry));
      });
    } else if (typeof value === "object") {
      stripeFormEncode(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

/**
 * The one door to the Stripe API. Every call goes through here.
 *
 * Throws StripeApiError carrying the status and Stripe's own error body, so a
 * caller can distinguish a declined card from an outage from a bad key.
 * SERVER-ONLY: the secret key is read here and must never reach a response.
 */
export async function stripeRequest(method, path, params = null, {
  account = null,
  idempotencyKey = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiVersion = STRIPE_API_VERSION,
} = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeApiError(0, { error: { message: "STRIPE_SECRET_KEY is not set" } });
  const verb = String(method || "").toUpperCase();
  if (!/^(GET|POST|DELETE)$/.test(verb)) throw new TypeError("unsupported Stripe request method");
  const scopedAccount = account == null ? null : connectedAccountId(account);
  const operationKey = idempotencyKey == null ? null : stableIdempotencyKey(idempotencyKey);
  const boundedTimeout = stripeTimeout(timeoutMs);
  const pinnedVersion = stripeApiVersion(apiVersion);
  const headers = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": pinnedVersion,
  };
  if (scopedAccount) headers["Stripe-Account"] = scopedAccount;
  if (operationKey) headers["Idempotency-Key"] = operationKey;
  let url = `${API}${path}`;
  let body;
  if (params && verb === "GET") {
    const query = stripeFormEncode(params).toString();
    if (query) url += `?${query}`;
  } else if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = stripeFormEncode(params).toString();
  }

  // GETs may retry one transient provider response. A write may retry one
  // transport failure only when Stripe can deduplicate it with an idempotency
  // key. An unsafe POST is attempted exactly once.
  const maxAttempts = verb === "GET" || operationKey ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, boundedTimeout);
    let response;
    try {
      response = await fetch(url, {
        method: verb,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (attempt + 1 < maxAttempts) {
        await retryPause();
        continue;
      }
      throw transportError(timedOut);
    }
    clearTimeout(timer);

    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    if (response.ok) return parsed;
    const error = new StripeApiError(response.status, parsed, {
      requestId: responseRequestId(response),
    });
    if (verb === "GET" && RETRYABLE_GET_STATUSES.has(response.status) && attempt + 1 < maxAttempts) {
      await retryPause();
      continue;
    }
    throw error;
  }
  throw transportError(false); // defensive: the bounded loop always returns or throws
}

// One session per order. amountCents/feeCents are trusted server state (never
// client figures); the passenger fee rides as its own line item so the buyer
// sees it itemized before paying. origin is the caller's canonical origin —
// routes pass SITE_ORIGIN, local verification passes its own localhost.
export async function createCheckoutSession({ orderId, itemId, title, amountCents, feeCents = 0, currency, origin, user }) {
  const lineItems = [{
    quantity: 1,
    price_data: {
      currency,
      unit_amount: amountCents,
      product_data: { name: title },
    },
  }];
  if (feeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: feeCents,
        product_data: { name: "Passenger fee ($1 + 1.5%)" },
      },
    });
  }
  return stripeRequest("POST", "/checkout/sessions", {
    mode: "payment",
    client_reference_id: orderId,
    line_items: lineItems,
    success_url: `${origin}/orders?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/orders?checkout=cancelled`,
    metadata: { order_id: orderId, item_id: itemId, user },
  });
}

/**
 * Native Storefront direct charge. The buyer sees merchandise plus the
 * passenger fee. The one-time Storefront collection exists only inside
 * `application_fee_amount`; it is never added as a buyer line item.
 *
 * `storefrontFeeCents` must already be a safely reserved amount from the
 * server ledger. This adapter moves the instructed amount; it does not guess
 * processing cost or decide how much seller proceeds are available.
 */
export async function createNativeCheckoutSession({
  orderId,
  itemId,
  title,
  merchandiseCents,
  passengerFeeCents,
  storefrontFeeCents = 0,
  currency,
  expiresAt,
  origin,
  user,
  account,
  idempotencyKey,
}) {
  const merchandise = minorUnits(merchandiseCents, "merchandise", { allowZero: false });
  const passenger = minorUnits(passengerFeeCents, "passenger fee");
  const storefront = minorUnits(storefrontFeeCents, "storefront fee");
  const expiration = Number(expiresAt);
  if (!Number.isSafeInteger(expiration) || expiration <= 0) {
    throw new TypeError("checkout expiration must be a positive Unix timestamp");
  }
  const applicationFee = passenger + storefront;
  if (applicationFee > merchandise + passenger) {
    throw new RangeError("application fee cannot exceed the customer payment");
  }
  const metadata = {
    kind: "native_storefront",
    order_id: String(orderId),
    item_id: String(itemId),
    user: String(user),
    passenger_fee_cents: String(passenger),
    storefront_fee_cents: String(storefront),
  };
  const lineItems = [{
    quantity: 1,
    price_data: {
      currency,
      unit_amount: merchandise,
      product_data: { name: title },
    },
  }];
  if (passenger > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: passenger,
        product_data: { name: "ASILUM passenger fee" },
      },
    });
  }
  return stripeRequest("POST", "/checkout/sessions", {
    mode: "payment",
    allowed_payment_method_types: ["card"],
    expires_at: expiration,
    client_reference_id: orderId,
    line_items: lineItems,
    payment_intent_data: {
      application_fee_amount: applicationFee,
      metadata,
    },
    success_url: `${origin}/orders?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/orders?checkout=cancelled`,
    metadata,
  }, {
    account: connectedAccountId(account),
    idempotencyKey: stableIdempotencyKey(idempotencyKey),
  });
}

/** Read a Checkout Session back from Stripe. THE AUTHORITY on whether a
 *  session was paid — never trust a client's success redirect, which is just a
 *  URL anyone can visit. */
export async function retrieveCheckoutSession(sessionId) {
  return stripeRequest("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export async function retrieveConnectedCheckoutSession(sessionId, { account, timeoutMs, apiVersion } = {}) {
  return stripeRequest("GET", `/checkout/sessions/${encodeURIComponent(stripeObjectId(sessionId, "checkout session"))}`, null, {
    account: connectedAccountId(account), timeoutMs, apiVersion,
  });
}

// ---- PaymentIntents: the ticket-fee lane (§6) -----------------------------
// The housing charges the passenger fee ALONE while the real purchase
// completes on the source. Amounts are trusted server state; the client only
// ever holds a client secret whose amount it cannot change.

export async function createPaymentIntent({ amountCents, currency, customer = null, savePaymentMethod = false, metadata = {} }) {
  return stripeRequest("POST", "/payment_intents", {
    amount: amountCents,
    currency,
    customer: customer || undefined,
    setup_future_usage: savePaymentMethod && customer ? "off_session" : undefined,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata,
  });
}

/** Read a PaymentIntent back from Stripe. Same rule as above: server state
 *  decides whether money moved. */
export async function retrievePaymentIntent(id) {
  return stripeRequest("GET", `/payment_intents/${encodeURIComponent(id)}`);
}

export async function retrieveConnectedPaymentIntent(id, { account, timeoutMs, apiVersion } = {}) {
  return stripeRequest("GET", `/payment_intents/${encodeURIComponent(stripeObjectId(id, "payment intent"))}`, null, {
    account: connectedAccountId(account), timeoutMs, apiVersion,
  });
}

export async function retrieveConnectedCharge(id, { account, timeoutMs, apiVersion } = {}) {
  return stripeRequest("GET", `/charges/${encodeURIComponent(stripeObjectId(id, "charge"))}`, null, {
    account: connectedAccountId(account), timeoutMs, apiVersion,
  });
}

export async function retrieveConnectedBalanceTransaction(id, { account, timeoutMs, apiVersion } = {}) {
  return stripeRequest("GET", `/balance_transactions/${encodeURIComponent(stripeObjectId(id, "balance transaction"))}`, null, {
    account: connectedAccountId(account), timeoutMs, apiVersion,
  });
}

/** Accounts are platform resources: validate the id, but do not send a
 * Stripe-Account header while retrieving the account itself. */
export async function retrieveConnectedAccount(account, { timeoutMs, apiVersion } = {}) {
  const id = connectedAccountId(account);
  return stripeRequest("GET", `/accounts/${encodeURIComponent(id)}`, null, { timeoutMs, apiVersion });
}

// Off-session confirm with a saved payment method — the returning buyer's
// one-click path: no card form, no publishable key, nothing retyped.
export async function confirmPaymentIntent(id, { paymentMethod, offSession = true }) {
  return stripeRequest("POST", `/payment_intents/${encodeURIComponent(id)}/confirm`, {
    payment_method: paymentMethod,
    off_session: offSession || undefined,
  });
}

/** Create a Stripe customer for a reader, tagged with their ASILUM id so a
 *  Stripe-side record can be traced back. Needed before a payment method can
 *  be saved for the returning-buyer path. */
export async function createCustomer({ userId }) {
  return stripeRequest("POST", "/customers", { metadata: { asilum_user: userId } });
}

/** Read a saved payment method — brand and last four for display. Card
 *  details never reach this server; Stripe holds them and returns only what is
 *  safe to show. */
export async function retrievePaymentMethod(id) {
  return stripeRequest("GET", `/payment_methods/${encodeURIComponent(id)}`);
}

// Refund a paid session's PaymentIntent. With no options this keeps the
// historical full, platform-scoped behavior. Native direct charges can supply
// a bounded amount, connected-account scope, provider idempotency and the
// explicit application-fee reversal flag; policy still lives above this seam.
export async function createRefund(paymentIntentId, options = {}) {
  const amount = options.amountCents ?? options.amount ?? null;
  const refundApplicationFee = options.refundApplicationFee ?? options.refund_application_fee ?? false;
  if (amount != null) minorUnits(amount, "refund amount", { allowZero: false });
  if (typeof refundApplicationFee !== "boolean") {
    throw new TypeError("refund_application_fee must be boolean");
  }
  return stripeRequest("POST", "/refunds", {
    payment_intent: stripeObjectId(paymentIntentId, "payment intent"),
    amount: amount == null ? undefined : amount,
    refund_application_fee: refundApplicationFee || undefined,
  }, {
    account: options.account ?? null,
    idempotencyKey: options.idempotencyKey ?? null,
    timeoutMs: options.timeoutMs,
    apiVersion: options.apiVersion,
  });
}

export async function createConnectedRefund(paymentIntentId, {
  account,
  idempotencyKey,
  amountCents = null,
  refundApplicationFee = false,
  timeoutMs,
  apiVersion,
} = {}) {
  return createRefund(paymentIntentId, {
    amountCents,
    refundApplicationFee,
    account: connectedAccountId(account),
    idempotencyKey: stableIdempotencyKey(idempotencyKey),
    timeoutMs,
    apiVersion,
  });
}

/** Application fees belong to the platform, even though the direct charge
 * itself belongs to the connected account. These calls are intentionally not
 * scoped with Stripe-Account. */
export async function retrieveApplicationFee(applicationFeeId, { timeoutMs, apiVersion } = {}) {
  const id = stripeObjectId(applicationFeeId, "application fee");
  return stripeRequest("GET", `/application_fees/${encodeURIComponent(id)}`, null, { timeoutMs, apiVersion });
}

export async function createApplicationFeeRefund(applicationFeeId, {
  amountCents = null,
  idempotencyKey,
  timeoutMs,
  apiVersion,
} = {}) {
  const id = stripeObjectId(applicationFeeId, "application fee");
  if (amountCents != null) minorUnits(amountCents, "application fee refund amount", { allowZero: false });
  return stripeRequest("POST", `/application_fees/${encodeURIComponent(id)}/refunds`, {
    amount: amountCents == null ? undefined : amountCents,
  }, {
    idempotencyKey: stableIdempotencyKey(idempotencyKey),
    timeoutMs,
    apiVersion,
  });
}

// Stripe-Signature: t=<unix>,v1=<hex hmac>[,v1=<hex hmac>…]
// v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Any valid v1 within tolerance
// passes (Stripe sends multiples during secret rolls). Constant-time compare;
// a malformed header is a refusal, never a throw.
// ---- Transfers and connected payouts (V.2 slice 11): the platform's top-up for a Credit
// share (5.32) and the release of a Wardrobe private sale to its owner (13.10) move
// platform money to a connected account; a native sale's funds are already the
// seller's (a direct charge) and its "release" is a connected payout. Policy above.
export async function createTransfer({ amountCents, currency = "usd", destination, metadata = {}, idempotencyKey = null, timeoutMs, apiVersion } = {}) {
  minorUnits(amountCents, "transfer amount", { allowZero: false });
  return stripeRequest("POST", "/transfers", { amount: amountCents, currency, destination: connectedAccountId(destination), metadata }, { idempotencyKey, timeoutMs, apiVersion });
}
export async function createConnectedPayout(account, { amountCents, currency = "usd", metadata = {}, idempotencyKey = null, timeoutMs, apiVersion } = {}) {
  minorUnits(amountCents, "payout amount", { allowZero: false });
  return stripeRequest("POST", "/payouts", { amount: amountCents, currency, metadata }, { account: connectedAccountId(account), idempotencyKey, timeoutMs, apiVersion });
}

export function verifyStripeSignature(rawBody, sigHeader, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (typeof sigHeader !== "string" || !sigHeader) return { ok: false, reason: "missing signature header" };
  let t = null;
  const candidates = [];
  for (const part of sigHeader.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => (s || "").trim());
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) candidates.push(v);
  }
  if (t === null) return { ok: false, reason: "no timestamp in header" };
  if (!candidates.length) return { ok: false, reason: "no v1 signature in header" };
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate, "hex");
    if (candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}
