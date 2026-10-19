// tests/order-notify.test.js — the operator tap on paid orders. Its one law:
// NEVER fail or delay a settlement. Unkeyed = silent no-op; a dead SendGrid,
// a 500, a thrown fetch — all become {sent:false, reason}, never a throw.

import test from "node:test";
import assert from "node:assert/strict";

delete process.env.SENDGRID_API_KEY;
delete process.env.ORDER_NOTIFY_EMAIL;

const { notifyOrderPaid, notifyConfigured } = await import("../lib/notify.js");

const ORDER = {
  id: "ord_test", item_id: "atelier-example-coat-001", amount_cents: 24000,
  currency: "usd", user_id: "u-buyer", stripe_session_id: "cs_test_x",
};

test("unkeyed is a silent no-op", async () => {
  assert.equal(notifyConfigured(), false);
  assert.deepEqual(await notifyOrderPaid(ORDER), { sent: false, reason: "unkeyed" });
});

test("keyed: sends the right shape to SendGrid and treats 202 as sent", async () => {
  process.env.SENDGRID_API_KEY = "SG.test-key";
  process.env.ORDER_NOTIFY_EMAIL = "owner@asilummagazine.com";
  let captured = null;
  const fetchImpl = async (url, init) => { captured = { url, init }; return { status: 202 }; };
  const result = await notifyOrderPaid(ORDER, { fetchImpl });
  assert.deepEqual(result, { sent: true });
  assert.equal(captured.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(captured.init.headers.Authorization, "Bearer SG.test-key");
  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.personalizations[0].to[0].email, "owner@asilummagazine.com");
  assert.equal(payload.from.email, "noreply@asilummagazine.com");
  // Brand law: the name is "*ASILUM" and magazine is never dropped.
  assert.match(payload.subject, /^\*ASILUM — order paid: ord_test$/);
  assert.match(payload.content[0].value, /240\.00 USD/);
  assert.match(payload.content[0].value, /ledger is the authority/);
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ORDER_NOTIFY_EMAIL;
});

test("a SendGrid failure or a thrown fetch never throws", async () => {
  process.env.SENDGRID_API_KEY = "SG.test-key";
  process.env.ORDER_NOTIFY_EMAIL = "owner@asilummagazine.com";
  assert.deepEqual(
    await notifyOrderPaid(ORDER, { fetchImpl: async () => ({ status: 500 }) }),
    { sent: false, reason: "sendgrid 500" }
  );
  assert.deepEqual(
    await notifyOrderPaid(ORDER, { fetchImpl: async () => { throw new Error("network down"); } }),
    { sent: false, reason: "network down" }
  );
  assert.deepEqual(await notifyOrderPaid(null, { fetchImpl: async () => ({ status: 202 }) }),
    { sent: false, reason: "no order" });
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ORDER_NOTIFY_EMAIL;
});
