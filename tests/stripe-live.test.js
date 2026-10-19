// tests/stripe-live.test.js — the fetch client against the REAL Stripe API,
// test mode. SKIPPED unless STRIPE_SECRET_KEY is set. A non-test key is
// refused while this module loads, before ANY test can make a provider call.
//
// HOW TO ACTUALLY RUN IT: `npm run test:live-stripe`.
//
// Until 22 August these four had never executed anywhere, and the reason is
// worth keeping. CI is unkeyed by design, and the live-pg suite was cited as
// the precedent for that — but live-pg runs in CI's own dedicated step against
// a disposable container (18 tests, 18 pass), so it is covered and this was
// not. Locally the gate reads process.env, and `npm test` does not load
// .env.local — only Next does. So the key sat in .env.local while every run,
// everywhere, reported a tidy `# SKIP`.
//
// A skip is not a pass, and four skips that can never become passes are a
// gauge wired to nothing. The npm script exists so exercising this seam is one
// command instead of a remembered incantation. It passes ONLY the Stripe key
// into the process — never the whole file, because exporting DATABASE_URL
// globally once flipped the entire suite onto live Postgres and wrote test
// rows into production.

import test from "node:test";
import assert from "node:assert/strict";

const KEY = process.env.STRIPE_SECRET_KEY || "";
const REQUIRED = process.env.STRIPE_TEST_REQUIRED === "1";
if (KEY && !KEY.startsWith("sk_test_")) {
  throw new Error("REFUSING Stripe provider tests with a non-test key");
}
if (REQUIRED && !KEY) {
  throw new Error("REFUSING required Stripe provider tests without STRIPE_SECRET_KEY");
}
const live = KEY ? test : test.skip;

live("checkout session round-trip against Stripe test mode", async () => {
  const { createCheckoutSession, retrieveCheckoutSession } = await import("../lib/payments/stripe.js");
  const session = await createCheckoutSession({
    orderId: "ord_live_test",
    itemId: "live-test-item",
    title: "ASILUM client round-trip check",
    amountCents: 100,
    feeCents: 50,
    currency: "usd",
    origin: "https://www.asilummagazine.com",
    user: "u-live-test",
  });
  assert.ok(session.id.startsWith("cs_test_"), "session id shape");
  assert.match(session.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(session.amount_total, 150, "item + the floored founders-fee line item");
  assert.equal(session.payment_status, "unpaid");
  const again = await retrieveCheckoutSession(session.id);
  assert.equal(again.id, session.id);
  assert.equal(again.metadata.order_id, "ord_live_test");
});

live("refund round-trip: a directly-confirmed test payment refunds in full", async () => {
  const { stripeRequest, createRefund } = await import("../lib/payments/stripe.js");
  // pm_card_visa confirms instantly in test mode — no browser needed.
  const intent = await stripeRequest("POST", "/payment_intents", {
    amount: 500, currency: "usd", payment_method: "pm_card_visa",
    confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  assert.equal(intent.status, "succeeded");
  const refund = await createRefund(intent.id);
  assert.ok(refund.id.startsWith("re_"));
  assert.equal(refund.status, "succeeded");
  assert.equal(refund.amount, 500);
});

live("ticket-fee intent: the 50¢ standalone floor charges, confirms, and refunds", async () => {
  const { createPaymentIntent, confirmPaymentIntent, createRefund, StripeApiError } = await import("../lib/payments/stripe.js");
  // The reason the standalone floor is 50 and not the ruled 31: Stripe's own
  // minimum. Keep the proof that 31¢ alone is refused.
  await assert.rejects(
    () => createPaymentIntent({ amountCents: 31, currency: "usd", metadata: { kind: "ticket_fee_check" } }),
    (err) => err instanceof StripeApiError && err.code === "amount_too_small"
  );
  const intent = await createPaymentIntent({ amountCents: 50, currency: "usd", metadata: { kind: "ticket_fee_check" } });
  assert.equal(intent.amount, 50);
  const confirmed = await confirmPaymentIntent(intent.id, { paymentMethod: "pm_card_visa", offSession: false });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(confirmed.amount_received, 50);
  const refund = await createRefund(confirmed.id);
  assert.equal(refund.status, "succeeded");
  assert.equal(refund.amount, 50);
});

live("a bad request surfaces Stripe's own error, typed", async () => {
  const { stripeRequest, StripeApiError } = await import("../lib/payments/stripe.js");
  await assert.rejects(
    () => stripeRequest("POST", "/checkout/sessions", { mode: "nonsense" }),
    (err) => err instanceof StripeApiError && err.status === 400
  );
});
