// The real provider script is intentionally never run by this suite. Each
// child process installs a fetch double before importing the module so the
// preflight/no-network guarantee and complete Connect money shape are proved.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const SCRIPT = "./scripts/verify-stripe-connect-storefront.mjs";
const ACCOUNT = "acct_1234567890ABCDEF";
const TEST_KEY = "sk_test_storefront_verifier_fixture";

const FORBIDDEN = [
  "DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "TEST_DATABASE_URL",
  "SENDGRID_API_KEY",
  "ORDER_NOTIFY_EMAIL",
  "STRIPE_CONNECT_LIVE_ENABLED",
];

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of FORBIDDEN) delete env[name];
  delete env.NODE_TEST_CONTEXT;
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_CONNECT_ACCOUNT_ID;
  delete env.STRIPE_CONNECT_VERIFY_RUN_ID;
  return { ...env, ...overrides };
}

function spawnImport(env, body = "") {
  const source = `
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls += 1;
      throw new Error("UNEXPECTED NETWORK CALL " + String(args[0]));
    };
    await import(${JSON.stringify(SCRIPT)});
    ${body}
    console.log("FETCH_CALLS=" + fetchCalls);
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("a live Stripe key is refused at module load before fetch", () => {
  const result = spawnImport(cleanEnv({
    STRIPE_SECRET_KEY: "sk_live_never_use_this_fixture",
    STRIPE_CONNECT_ACCOUNT_ID: ACCOUNT,
  }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REFUSING: STRIPE_SECRET_KEY is not a Stripe TEST secret key/);
  assert.match(result.stdout, /FETCH_CALLS=0/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /UNEXPECTED NETWORK CALL/);
});

test("a missing or malformed connected-account id is refused before fetch", () => {
  for (const account of [undefined, "acct_bad/path", "ca_1234567890"]) {
    const env = cleanEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    if (account !== undefined) env.STRIPE_CONNECT_ACCOUNT_ID = account;
    const result = spawnImport(env);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /STRIPE_CONNECT_ACCOUNT_ID must be a valid acct_ id/);
    assert.match(result.stdout, /FETCH_CALLS=0/);
  }
});

test("a stable run id is mandatory before fetch", () => {
  const result = spawnImport(cleanEnv({
    STRIPE_SECRET_KEY: TEST_KEY,
    STRIPE_CONNECT_ACCOUNT_ID: ACCOUNT,
  }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /STRIPE_CONNECT_VERIFY_RUN_ID is not set/);
  assert.match(result.stdout, /FETCH_CALLS=0/);
});

test("database, notification, and live-enablement variables are refused before fetch", () => {
  for (const name of FORBIDDEN) {
    const result = spawnImport(cleanEnv({
      STRIPE_SECRET_KEY: TEST_KEY,
      STRIPE_CONNECT_ACCOUNT_ID: ACCOUNT,
      [name]: name.endsWith("ENABLED") ? "0" : "fixture-never-used",
    }));
    assert.equal(result.status, 2, name);
    assert.match(result.stderr, new RegExp(`unsafe environment variable\\(s\\) are set:.*${name}`));
    assert.match(result.stdout, /FETCH_CALLS=0/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /UNEXPECTED NETWORK CALL/);
  }
});

test("the mocked full run scopes the direct charge, reconciles exact money, and reverses both refunds", () => {
  const source = `
    import assert from "node:assert/strict";
    const account = ${JSON.stringify(ACCOUNT)};
    const calls = [];
    let chargeReads = 0;
    let feeReads = 0;
    function response(body) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\\/v1/, "");
      const call = { path, method: init.method, headers: init.headers, body: init.body || "" };
      calls.push(call);
      if (path === "/accounts/" + account) {
        return response({
          id: account, details_submitted: true, charges_enabled: true, payouts_enabled: true,
          controller: { fees: { payer: "account" }, losses: { payments: "stripe" } },
          capabilities: { card_payments: "active" },
        });
      }
      if (path === "/payment_intents" && init.method === "POST") {
        return response({
          id: "pi_verify123", amount: 20400, amount_received: 20400,
          application_fee_amount: 3400, currency: "usd", livemode: false,
          status: "succeeded", latest_charge: "ch_verify123",
        });
      }
      if (path === "/charges/ch_verify123") {
        chargeReads += 1;
        return response({
          id: "ch_verify123", amount: 20400, currency: "usd", livemode: false,
          paid: true, captured: true, amount_captured: 20400,
          payment_intent: "pi_verify123", application_fee_amount: 3400,
          balance_transaction: "txn_verify123", application_fee: "fee_verify123",
          refunded: chargeReads > 1, amount_refunded: chargeReads > 1 ? 20400 : 0,
          refunds: { data: chargeReads > 1 ? [{ id: "re_verify123", amount: 20400 }] : [] },
        });
      }
      if (path === "/balance_transactions/txn_verify123") {
        return response({
          id: "txn_verify123", source: "ch_verify123", amount: 20400, currency: "usd",
          fee: 4022, net: 16378,
          fee_details: [
            { type: "stripe_fee", amount: 622, currency: "usd" },
            { type: "application_fee", amount: 3400, currency: "usd" },
          ],
        });
      }
      if (path === "/application_fees/fee_verify123") {
        feeReads += 1;
        return response({
          id: "fee_verify123", account, charge: "ch_verify123",
          amount: 3400, currency: "usd", livemode: false,
          amount_refunded: feeReads > 1 ? 3400 : 0,
          refunded: feeReads > 1,
          refunds: { data: feeReads > 1 ? [{ id: "fr_verify123", amount: 3400 }] : [] },
        });
      }
      if (path === "/refunds" && init.method === "POST") {
        return response({
          id: "re_verify123", amount: 20400, currency: "usd",
          status: "succeeded", payment_intent: "pi_verify123", charge: "ch_verify123",
        });
      }
      if (path === "/refunds/re_verify123") {
        return response({
          id: "re_verify123", amount: 20400, currency: "usd",
          status: "succeeded", payment_intent: "pi_verify123", charge: "ch_verify123",
        });
      }
      throw new Error("unexpected mocked Stripe path " + init.method + " " + path);
    };

    await import(${JSON.stringify(SCRIPT)});

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 9);
    for (const call of calls) assert.equal(call.headers["Stripe-Version"], "2026-09-30.endive");
    assert.equal(calls[0].headers["Stripe-Account"], undefined, "account lookup stays platform-scoped");
    assert.equal(calls[1].headers["Stripe-Account"], account);
    assert.equal(calls[1].headers["Idempotency-Key"], "storefront-verify-pi:fixture-run-1");
    const payment = new URLSearchParams(calls[1].body);
    assert.equal(payment.get("amount"), "20400");
    assert.equal(payment.get("application_fee_amount"), "3400");
    assert.equal(payment.get("payment_method"), "pm_card_visa");
    assert.equal(payment.get("metadata[passenger_fee_cents]"), "400");
    assert.equal(payment.get("metadata[storefront_fee_cents]"), "3000");
    const refundCall = calls.find((call) => call.path === "/refunds" && call.method === "POST");
    assert.equal(refundCall.headers["Stripe-Account"], account);
    assert.equal(refundCall.headers["Idempotency-Key"], "storefront-verify-refund:fixture-run-1");
    const refund = new URLSearchParams(refundCall.body);
    assert.equal(refund.get("payment_intent"), "pi_verify123");
    assert.equal(refund.get("amount"), "20400");
    assert.equal(refund.get("refund_application_fee"), "true");
    for (const call of calls.filter((candidate) => candidate.path.startsWith("/application_fees/"))) {
      assert.equal(call.headers["Stripe-Account"], undefined, "application-fee reads stay platform-scoped");
    }
    console.log("MOCK_CONNECT_ASSERTIONS=PASS");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: cleanEnv({
      STRIPE_SECRET_KEY: TEST_KEY,
      STRIPE_CONNECT_ACCOUNT_ID: ACCOUNT,
      STRIPE_CONNECT_VERIFY_RUN_ID: "fixture-run-1",
    }),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /MOCK_CONNECT_ASSERTIONS=PASS/);
  assert.match(result.stdout, /"processing_fee_cents": 622/);
  assert.match(result.stdout, /"seller_net_cents": 16378/);
  assert.match(result.stdout, /"customer_refunded_cents": 20400/);
  assert.match(result.stdout, /"application_fee_refunded_cents": 3400/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sk_test_/);
});

test("a post-charge verification failure still requests an idempotent full cleanup refund", () => {
  const source = `
    import assert from "node:assert/strict";
    const calls = [];
    function response(body) { return new Response(JSON.stringify(body), { status: 200 }); }
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname.replace(/^\\/v1/, "");
      calls.push({ path, init });
      if (path.startsWith("/accounts/")) return response({
        id: ${JSON.stringify(ACCOUNT)}, details_submitted: true, charges_enabled: true, payouts_enabled: true,
        controller: { fees: { payer: "account" }, losses: { payments: "stripe" } },
        capabilities: { card_payments: "active" },
      });
      if (path === "/payment_intents") return response({ id: "pi_cleanup123", amount: 20400, amount_received: 20400, application_fee_amount: 3400, currency: "usd", livemode: false, status: "succeeded", latest_charge: "missing" });
      if (path === "/refunds") return response({ id: "re_cleanup123", amount: 20400, currency: "usd", livemode: false, status: "succeeded", payment_intent: "pi_cleanup123" });
      throw new Error("unexpected path " + path);
    };
    await import(${JSON.stringify(SCRIPT)});
    const refund = calls.find((call) => call.path === "/refunds");
    assert.ok(refund, "cleanup refund call");
    assert.equal(refund.init.headers["Stripe-Account"], ${JSON.stringify(ACCOUNT)});
    assert.equal(refund.init.headers["Idempotency-Key"], "storefront-verify-refund:cleanup-run-1");
    const body = new URLSearchParams(refund.init.body);
    assert.equal(body.get("amount"), "20400");
    assert.equal(body.get("refund_application_fee"), "true");
    console.log("CLEANUP_ASSERTIONS=PASS");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: cleanEnv({
      STRIPE_SECRET_KEY: TEST_KEY,
      STRIPE_CONNECT_ACCOUNT_ID: ACCOUNT,
      STRIPE_CONNECT_VERIFY_RUN_ID: "cleanup-run-1",
    }),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CLEANUP_ASSERTIONS=PASS/);
  assert.match(result.stderr, /Cleanup refund requested: re_cleanup123/);
  assert.match(result.stderr, /PaymentIntent did not return a connected charge id/);
});
