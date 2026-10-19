// A destructive-but-reversible provider check for the native Storefront money
// path. It creates one real Stripe TEST direct charge on an EXISTING connected
// account, verifies every relevant Stripe object, and immediately refunds the
// customer while reversing the application fee.
//
// This is intentionally not wired to the application, database, mailer, or
// live rollout flags. Run it with only these variables:
//
//   STRIPE_SECRET_KEY=sk_test_... \
//   STRIPE_CONNECT_ACCOUNT_ID=acct_... \
//   STRIPE_CONNECT_VERIFY_RUN_ID=verify-2026-10-03-01 \
//   node scripts/verify-stripe-connect-storefront.mjs
//
// STRIPE_CONNECT_VERIFY_RUN_ID is mandatory so a retry after an ambiguous
// network response reuses the same provider idempotency keys. Never use a live
// key or card number; pm_card_visa is Stripe's test PaymentMethod token.

const CONNECTED_ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,64}$/;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BUYER_TOTAL_CENTS = 20_400;
const APPLICATION_FEE_CENTS = 3_400;
const PASSENGER_FEE_CENTS = 400;
const STOREFRONT_FEE_CENTS = 3_000;
const STANDARD_US_PROCESSING_FIXTURE_CENTS = 622;
const CURRENCY = "usd";

function isSet(env, name) {
  return Object.prototype.hasOwnProperty.call(env, name) && String(env[name] || "").length > 0;
}

function unsafeEnvironmentNames(env) {
  const names = Object.keys(env);
  const unsafe = new Set();
  for (const name of ["DATABASE_URL", "DATABASE_ADMIN_URL", "TEST_DATABASE_URL"]) {
    if (isSet(env, name)) unsafe.add(name);
  }
  for (const name of names) {
    if (!isSet(env, name)) continue;
    if (name.startsWith("SENDGRID_") || name === "ORDER_NOTIFY_EMAIL" || name.startsWith("ORDER_NOTIFICATION_")) {
      unsafe.add(name);
    }
    if (/(?:^|_)(?:ALLOW|ENABLE|ENABLED)[A-Z0-9_]*LIVE(?:_|$)/.test(name)
      || /(?:^|_)LIVE[A-Z0-9_]*(?:ALLOW|ENABLE|ENABLED)(?:_|$)/.test(name)) {
      unsafe.add(name);
    }
  }
  return [...unsafe].sort();
}

function preflight(env = process.env) {
  const unsafe = unsafeEnvironmentNames(env);
  if (unsafe.length) {
    return {
      error: `unsafe environment variable(s) are set: ${unsafe.join(", ")}`,
      hint: "Run with only the Stripe TEST key and an existing test connected-account id; unset database, notification, and live-enablement variables.",
    };
  }
  const secret = String(env.STRIPE_SECRET_KEY || "");
  if (!secret) {
    return { error: "STRIPE_SECRET_KEY is not set", hint: "Pass an sk_test_ key explicitly; never source the whole application environment." };
  }
  if (!secret.startsWith("sk_test_") || secret.length <= "sk_test_".length) {
    return { error: "STRIPE_SECRET_KEY is not a Stripe TEST secret key", hint: "This verifier refuses every non-sk_test_ key before importing the Stripe adapter." };
  }
  const account = String(env.STRIPE_CONNECT_ACCOUNT_ID || "");
  if (!CONNECTED_ACCOUNT_RE.test(account)) {
    return { error: "STRIPE_CONNECT_ACCOUNT_ID must be a valid acct_ id", hint: "Supply an existing test-mode connected account. This script never creates or onboards one." };
  }
  const runId = String(env.STRIPE_CONNECT_VERIFY_RUN_ID || "");
  if (!runId) {
    return { error: "STRIPE_CONNECT_VERIFY_RUN_ID is not set", hint: "Choose a stable run id and reuse it if this verification is interrupted." };
  }
  if (!RUN_ID_RE.test(runId)) {
    return { error: "STRIPE_CONNECT_VERIFY_RUN_ID contains unsafe characters", hint: "Use 1-80 letters, digits, dots, underscores, or hyphens." };
  }
  return { account, runId };
}

class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationError";
  }
}

function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}

function objectId(value) {
  if (typeof value === "string") return value;
  return value && typeof value.id === "string" ? value.id : "";
}

function integer(value, label, { minimum = 0 } = {}) {
  check(Number.isSafeInteger(value) && value >= minimum, `${label} must be an integer of at least ${minimum} cents`);
  return value;
}

function sameMoneyObject(value, {
  label,
  amount,
  currency = CURRENCY,
  livemode = false,
}) {
  check(value && typeof value === "object", `${label} was not returned by Stripe`);
  // Refund and BalanceTransaction objects do not carry a livemode field. For
  // those, test-mode authority comes from the sk_test_ preflight plus their
  // verified relationship to the test Charge; callers opt out with null.
  if (livemode !== null) check(value.livemode === livemode, `${label} did not stay in Stripe test mode`);
  check(value.currency === currency, `${label} currency was ${value.currency || "missing"}, expected ${currency}`);
  check(value.amount === amount, `${label} amount was ${value.amount}, expected ${amount}`);
}

function redact(message) {
  return String(message || "unknown error")
    .replace(/sk_(?:test|live)_[A-Za-z0-9_]+/g, "[REDACTED_STRIPE_KEY]")
    .slice(0, 800);
}

function safeError(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: redact(error?.message),
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    ...(typeof error?.requestId === "string" ? { request_id: error.requestId } : {}),
  };
}

async function verify(config, stripe) {
  const {
    STRIPE_API_VERSION,
    createConnectedRefund,
    retrieveApplicationFee,
    retrieveConnectedAccount,
    retrieveConnectedBalanceTransaction,
    retrieveConnectedCharge,
    stripeRequest,
  } = stripe;
  const accountId = config.account;
  const createKey = `storefront-verify-pi:${config.runId}`;
  const refundKey = `storefront-verify-refund:${config.runId}`;
  let intent = null;
  let refund = null;
  let cleanup = null;

  try {
    const account = await retrieveConnectedAccount(accountId, { apiVersion: STRIPE_API_VERSION });
    check(account?.id === accountId, "Stripe returned a different connected account");
    // Stripe Account objects do not carry `livemode`. Test-mode authority is
    // the module-level sk_test_ preflight; all money objects below also assert
    // livemode=false.
    check(account.details_submitted === true,
      "the connected account has not submitted its TEST onboarding details");
    check(account.charges_enabled === true,
      "the connected account is not charges_enabled; finish its TEST onboarding/capability requirements before retrying");
    check(account.payouts_enabled === true,
      "the connected account is not payouts_enabled; finish its TEST onboarding requirements before retrying");
    check(account.controller?.fees?.payer === "account",
      `connected account fee payer is ${account.controller?.fees?.payer || "missing"}; this verifier requires the seller account to bear processing fees`);
    check(account.controller?.losses?.payments === "stripe",
      `connected account payment-loss responsibility is ${account.controller?.losses?.payments || "missing"}; this verifier has not approved platform loss responsibility`);
    const cardPayments = account.capabilities?.card_payments;
    check(cardPayments == null || cardPayments === "active",
      `the connected account card_payments capability is ${cardPayments}; it must be active`);

    intent = await stripeRequest("POST", "/payment_intents", {
      amount: BUYER_TOTAL_CENTS,
      currency: CURRENCY,
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      application_fee_amount: APPLICATION_FEE_CENTS,
      description: "ASILUM Storefront Connect verification (test mode)",
      metadata: {
        kind: "storefront_connect_verification",
        passenger_fee_cents: PASSENGER_FEE_CENTS,
        storefront_fee_cents: STOREFRONT_FEE_CENTS,
        run_id: config.runId,
      },
    }, {
      account: accountId,
      idempotencyKey: createKey,
      apiVersion: STRIPE_API_VERSION,
    });
    sameMoneyObject(intent, { label: "PaymentIntent", amount: BUYER_TOTAL_CENTS });
    check(intent.status === "succeeded", `PaymentIntent status was ${intent.status || "missing"}, expected succeeded`);
    check(intent.amount_received === BUYER_TOTAL_CENTS,
      `PaymentIntent received ${intent.amount_received}, expected ${BUYER_TOTAL_CENTS}`);
    check(intent.application_fee_amount === APPLICATION_FEE_CENTS,
      `PaymentIntent application fee was ${intent.application_fee_amount}, expected ${APPLICATION_FEE_CENTS}`);

    const chargeId = objectId(intent.latest_charge);
    check(/^ch_[A-Za-z0-9_]+$/.test(chargeId), "PaymentIntent did not return a connected charge id");
    const charge = await retrieveConnectedCharge(chargeId, { account: accountId, apiVersion: STRIPE_API_VERSION });
    sameMoneyObject(charge, { label: "Charge", amount: BUYER_TOTAL_CENTS });
    check(charge.id === chargeId, "Stripe returned a different charge");
    check(charge.paid === true, "connected charge is not paid");
    check(charge.captured === true && charge.amount_captured === BUYER_TOTAL_CENTS,
      "connected charge is not fully captured");
    check(charge.refunded === false && charge.amount_refunded === 0, "connected charge was already refunded");
    check(objectId(charge.payment_intent) === intent.id, "charge does not belong to the created PaymentIntent");
    check(charge.application_fee_amount === APPLICATION_FEE_CENTS,
      `charge application fee was ${charge.application_fee_amount}, expected ${APPLICATION_FEE_CENTS}`);

    const balanceTransactionId = objectId(charge.balance_transaction);
    const applicationFeeId = objectId(charge.application_fee);
    check(/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId), "charge did not return a balance transaction id");
    check(/^fee_[A-Za-z0-9_]+$/.test(applicationFeeId), "charge did not return a platform application fee id");

    const balance = await retrieveConnectedBalanceTransaction(balanceTransactionId, {
      account: accountId,
      apiVersion: STRIPE_API_VERSION,
    });
    sameMoneyObject(balance, { label: "connected balance transaction", amount: BUYER_TOTAL_CENTS, livemode: null });
    check(balance.id === balanceTransactionId, "Stripe returned a different balance transaction");
    check(objectId(balance.source) === chargeId, "balance transaction does not belong to the connected charge");
    const totalFeeCents = integer(balance.fee, "connected balance fee");
    const sellerNetCents = integer(balance.net, "connected seller net");
    check(BUYER_TOTAL_CENTS - totalFeeCents === sellerNetCents,
      "connected balance amount, fee, and seller net do not reconcile");

    const feeDetails = Array.isArray(balance.fee_details) ? balance.fee_details : [];
    check(feeDetails.length > 0, "connected balance transaction did not expose fee_details");
    const feeDetailTotal = feeDetails.reduce((sum, detail) => sum + integer(detail?.amount, "fee detail"), 0);
    check(feeDetailTotal === totalFeeCents, "Stripe fee_details do not sum to the connected balance fee");
    const applicationFeeDetailCents = feeDetails
      .filter((detail) => detail?.type === "application_fee")
      .reduce((sum, detail) => sum + detail.amount, 0);
    check(applicationFeeDetailCents === APPLICATION_FEE_CENTS,
      `connected fee_details recorded ${applicationFeeDetailCents} of application fee, expected ${APPLICATION_FEE_CENTS}`);
    const processingFeeCents = totalFeeCents - applicationFeeDetailCents;
    integer(processingFeeCents, "Stripe processing fee");
    check(sellerNetCents === BUYER_TOTAL_CENTS - APPLICATION_FEE_CENTS - processingFeeCents,
      "seller net does not equal buyer total less application and processing fees");

    const applicationFee = await retrieveApplicationFee(applicationFeeId, { apiVersion: STRIPE_API_VERSION });
    sameMoneyObject(applicationFee, { label: "platform application fee", amount: APPLICATION_FEE_CENTS });
    check(applicationFee.id === applicationFeeId, "Stripe returned a different application fee");
    check(objectId(applicationFee.account) === accountId, "application fee does not belong to the requested connected account");
    check(objectId(applicationFee.charge) === chargeId, "application fee does not belong to the connected charge");
    check(applicationFee.amount_refunded === 0 && applicationFee.refunded === false,
      "application fee was already refunded before the customer refund");

    refund = await createConnectedRefund(intent.id, {
      account: accountId,
      idempotencyKey: refundKey,
      amountCents: BUYER_TOTAL_CENTS,
      refundApplicationFee: true,
      apiVersion: STRIPE_API_VERSION,
    });
    sameMoneyObject(refund, { label: "customer refund", amount: BUYER_TOTAL_CENTS, livemode: null });
    check(refund.status === "succeeded", `customer refund status was ${refund.status || "missing"}, expected succeeded`);
    check(objectId(refund.payment_intent) === intent.id, "customer refund does not belong to the PaymentIntent");
    check(objectId(refund.charge) === chargeId, "customer refund does not belong to the connected charge");

    const confirmedRefund = await stripeRequest("GET", `/refunds/${encodeURIComponent(refund.id)}`, null, {
      account: accountId,
      apiVersion: STRIPE_API_VERSION,
    });
    sameMoneyObject(confirmedRefund, { label: "retrieved customer refund", amount: BUYER_TOTAL_CENTS, livemode: null });
    check(confirmedRefund.id === refund.id && confirmedRefund.status === "succeeded",
      "retrieved customer refund is not the succeeded refund that was created");

    const refundedCharge = await retrieveConnectedCharge(chargeId, { account: accountId, apiVersion: STRIPE_API_VERSION });
    check(refundedCharge.refunded === true && refundedCharge.amount_refunded === BUYER_TOTAL_CENTS,
      "connected charge does not show the full customer refund");
    const chargeRefunds = Array.isArray(refundedCharge.refunds?.data) ? refundedCharge.refunds.data : [];
    check(chargeRefunds.some((candidate) => candidate?.id === refund.id && candidate.amount === BUYER_TOTAL_CENTS),
      "connected charge refund ledger does not contain the full customer refund");

    const refundedApplicationFee = await retrieveApplicationFee(applicationFeeId, { apiVersion: STRIPE_API_VERSION });
    check(refundedApplicationFee.refunded === true
      && refundedApplicationFee.amount_refunded === APPLICATION_FEE_CENTS,
    "platform application fee was not fully reversed with the customer refund");
    const feeRefunds = Array.isArray(refundedApplicationFee.refunds?.data)
      ? refundedApplicationFee.refunds.data : [];
    check(feeRefunds.reduce((sum, candidate) => sum + integer(candidate?.amount, "application-fee refund"), 0)
      === APPLICATION_FEE_CENTS,
    "application-fee refund ledger does not reconcile to the $34 reversal");

    return {
      result: "PASS",
      mode: "test",
      stripe_api_version: STRIPE_API_VERSION,
      run_id: config.runId,
      connected_account_id: accountId,
      account_fee_payer: account.controller.fees.payer,
      account_payment_losses: account.controller.losses.payments,
      payment_intent_id: intent.id,
      charge_id: chargeId,
      balance_transaction_id: balanceTransactionId,
      application_fee_id: applicationFeeId,
      refund_id: refund.id,
      buyer_total_cents: BUYER_TOTAL_CENTS,
      application_fee_cents: APPLICATION_FEE_CENTS,
      passenger_fee_cents: PASSENGER_FEE_CENTS,
      storefront_fee_cents: STOREFRONT_FEE_CENTS,
      processing_fee_cents: processingFeeCents,
      standard_us_processing_fixture_cents: STANDARD_US_PROCESSING_FIXTURE_CENTS,
      standard_us_processing_fixture_matched: processingFeeCents === STANDARD_US_PROCESSING_FIXTURE_CENTS,
      seller_net_cents: sellerNetCents,
      customer_refunded_cents: confirmedRefund.amount,
      application_fee_refunded_cents: refundedApplicationFee.amount_refunded,
    };
  } catch (error) {
    // A verification assertion after a successful charge must never strand
    // even TEST funds. The same refund idempotency key is safe after an
    // ambiguous network result and explicitly reverses the application fee.
    if (intent?.id && intent.status === "succeeded" && !refund?.id) {
      try {
        cleanup = await createConnectedRefund(intent.id, {
          account: accountId,
          idempotencyKey: refundKey,
          amountCents: BUYER_TOTAL_CENTS,
          refundApplicationFee: true,
          apiVersion: STRIPE_API_VERSION,
        });
      } catch (cleanupError) {
        cleanup = { error: safeError(cleanupError) };
      }
    }
    if (cleanup?.id) {
      console.error(`Cleanup refund requested: ${cleanup.id} (${cleanup.status || "unknown status"}).`);
    } else if (cleanup?.error) {
      console.error(`Cleanup refund failed: ${JSON.stringify(cleanup.error)}. Re-run with the same run id ${config.runId}.`);
    }
    throw error;
  }
}

// This preflight executes before the Stripe adapter is imported, and thus
// before any code in this module can make a provider request.
const config = preflight();
if (config.error) {
  console.error(`REFUSING: ${config.error}.`);
  console.error(config.hint);
  process.exitCode = 2;
} else {
  console.log(`Starting Stripe Connect TEST verification ${config.runId} for ${config.account}.`);
  const stripe = await import("../lib/payments/stripe.js");
  try {
    const result = await verify(config, stripe);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`VERIFICATION FAILED: ${JSON.stringify(safeError(error))}`);
    console.error("Confirm the existing account is a test-mode Connect account with charges_enabled and active card_payments, and that this platform may collect application fees. No account was created or onboarded.");
    process.exitCode = 1;
  }
}
