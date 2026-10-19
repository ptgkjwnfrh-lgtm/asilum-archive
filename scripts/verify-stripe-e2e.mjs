// scripts/verify-stripe-e2e.mjs
// Proves the checkout engine end to end against REAL Stripe (test mode), with
// zero UI and zero database: refuses to run if DATABASE_URL is set, seeds one
// verification article into the in-memory store, demonstrates the demo-item
// refusal, opens a live checkout session, then polls reconcile until the
// session is paid in a browser and asserts the full ledger.
//
// Run:  set -a; source .env.local; set +a
//       unset DATABASE_URL DATABASE_ADMIN_URL SENDGRID_API_KEY ORDER_NOTIFY_EMAIL
//       node scripts/verify-stripe-e2e.mjs
// Pay the printed URL with Stripe's public test card 4242 4242 4242 4242.

if (process.env.DATABASE_URL || process.env.DATABASE_ADMIN_URL) {
  console.error("REFUSING: DATABASE_URL is set — this script is memory-only on purpose.");
  console.error("unset DATABASE_URL DATABASE_ADMIN_URL and re-run.");
  process.exit(2);
}
if (process.env.SENDGRID_API_KEY || process.env.ORDER_NOTIFY_EMAIL) {
  console.error("REFUSING: SendGrid notification variables are set — this verification must not send mail.");
  console.error("unset SENDGRID_API_KEY ORDER_NOTIFY_EMAIL and re-run.");
  process.exit(2);
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("REFUSING: STRIPE_SECRET_KEY is not set. source .env.local first.");
  process.exit(2);
}
if (!process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  console.error("REFUSING: key is not a TEST key. This script never touches live money.");
  process.exit(2);
}

const { upsertItems } = await import("../lib/db/index.js");
const { startCheckout, reconcileOrder, getOrder, listOrderEvents } = await import("../lib/orders.js");

const USER = "u-stripe-e2e-verify";
const ITEM = {
  id: "e2e-verify-article",
  title: "ASILUM checkout verification article (test mode)",
  brand: "ASILUM systems check",
  price: 19,
  currency: "usd",
  source_name: "e2e-verification",
  source_product_url: "https://www.asilummagazine.com/piece/e2e-verify-article",
  availability_status: "available",
  tags: {},
};

// 1. The demo gate must refuse — seeded unconditionally, because a bare
// process starts with an EMPTY mem catalog (an earlier version read the
// catalog and silently skipped this proof when it found nothing).
const DEMO = { id: "e2e-demo-record", title: "demo record", price: 10, source_name: "seed", url: "https://example.com/x", tags: {} };
await upsertItems([DEMO]);
const refusal = await startCheckout({ user: USER, itemId: DEMO.id, origin: "http://localhost:3458" });
if (refusal.status !== 409) {
  console.error(`FAIL: demo item ${DEMO.id} was not refused (got ${refusal.status})`);
  process.exit(1);
}
console.log(`demo refusal OK — ${DEMO.id} → 409 "${refusal.error}"`);

// 2. One real-shaped verification article, then a live test-mode session.
await upsertItems([ITEM]);
const start = await startCheckout({ user: USER, itemId: ITEM.id, origin: "http://localhost:3458" });
if (start.status !== 200) {
  console.error(`FAIL: could not open session (${start.status}): ${start.error}`);
  process.exit(1);
}
console.log(`\norder ${start.orderId} awaiting payment`);
console.log(`\nPAY THIS URL WITH 4242 4242 4242 4242:\n${start.url}\n`);

// 3. Poll reconcile-on-read until the browser pays it (6 min budget).
const deadline = Date.now() + 6 * 60 * 1000;
let order = await getOrder(start.orderId);
while (Date.now() < deadline) {
  order = await reconcileOrder(order);
  if (order.status === "paid" || order.status === "expired") break;
  await new Promise((r) => setTimeout(r, 5000));
}

const events = await listOrderEvents(start.orderId);
console.log(`final status: ${order.status}`);
console.log(`ledger: ${events.map((e) => `${e.type}(${e.source})`).join(" → ")}`);

const shape = events.map((e) => e.type).join(",");
if (order.status === "paid" && shape === "created,checkout_opened,paid") {
  console.log("\nE2E PASS — created → checkout_opened → paid, settled by reconcile.");
  process.exit(0);
}
console.error("\nE2E FAIL — see ledger above.");
process.exit(1);
