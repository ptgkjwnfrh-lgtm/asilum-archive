#!/usr/bin/env node
// Bounded native-Storefront payment reconciliation for an external cron.
// This worker intentionally ignores NATIVE_CHECKOUT_ENABLED so disabling new
// purchases never strands existing attempts. It is test-mode only until the
// complete live fee/refund/reconciliation path has provider evidence.

const limit = Number(process.env.STOREFRONT_RECONCILE_LIMIT || 10);
const key = String(process.env.STRIPE_SECRET_KEY || "");
const databaseUrl = String(process.env.DATABASE_URL || "");

function refuse(message) {
  console.error(`REFUSING: ${message}`);
  process.exitCode = 2;
}

if (!databaseUrl) refuse("DATABASE_URL is required for durable reconciliation");
else if (process.env.DATABASE_ADMIN_URL) refuse("DATABASE_ADMIN_URL must not be set; use the least-privileged app role");
else if (!key.startsWith("sk_test_")) refuse("STRIPE_SECRET_KEY must be a Stripe TEST secret key");
else if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
  refuse("STOREFRONT_RECONCILE_LIMIT must be an integer from 1 to 25");
}

if (!process.exitCode) {
  const [{ reconcileDueNativeStorefrontAttempts }, { SITE_ORIGIN }, { getPool }] = await Promise.all([
    import("../lib/storefront/checkout.js"),
    import("../lib/site.js"),
    import("../lib/db/index.js"),
  ]);
  let result;
  try {
    result = await reconcileDueNativeStorefrontAttempts({ limit, origin: SITE_ORIGIN });
    console.log(JSON.stringify({
      enabled: result.enabled,
      claimed: result.claimed,
      processed: result.processed,
      failed: result.failed,
      held: result.held || 0,
      attention: result.results
        .filter((entry) => entry.state === "held")
        .map((entry) => ({ attemptId: entry.attemptId || null, orderId: entry.orderId || null })),
      states: result.results.reduce((counts, entry) => {
        counts[entry.state] = (counts[entry.state] || 0) + 1;
        return counts;
      }, {}),
    }));
    if (!result.enabled || result.failed || result.held) process.exitCode = 1;
  } catch (error) {
    console.error(`Storefront reconciliation failed: ${error?.message || "unknown error"}`);
    process.exitCode = 1;
  } finally {
    try { await (await getPool())?.end?.(); } catch { /* exit status above is authoritative */ }
  }
}
