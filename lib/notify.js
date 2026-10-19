// lib/notify.js
// Operator notification for paid orders (risk campaign F29/F74: an order
// nobody notices is a customer failed). SERVER-ONLY.
//
// Env-gated like every integration here: SENDGRID_API_KEY (Mail Send scope
// only) + ORDER_NOTIFY_EMAIL, both required, otherwise a silent no-op —
// the ORDER LEDGER is the authority either way; this is a tap on the
// shoulder, so it must never fail or delay a settlement. No throw escapes.

const SEND_URL = "https://api.sendgrid.com/v3/mail/send";
const FROM = "noreply@asilummagazine.com"; // domain-authenticated at SendGrid

/** Are both the SendGrid key and a destination address set? Notifications are
 *  off unless BOTH are present — a key with nowhere to send is not configured. */
export function notifyConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.ORDER_NOTIFY_EMAIL);
}

/**
 * Tell the operator an order was paid. RIDES ALONGSIDE SETTLEMENT AND MUST
 * NEVER FAIL OR DELAY IT — no throw escapes this function.
 *
 * Always returns `{ sent, reason }` so a caller can log what happened without
 * a try/catch. `fetchImpl` is injectable for tests; nothing else should pass
 * it.
 */
export async function notifyOrderPaid(order, { fetchImpl = fetch } = {}) {
  if (!notifyConfigured()) return { sent: false, reason: "unkeyed" };
  if (!order || !order.id) return { sent: false, reason: "no order" };
  try {
    const res = await fetchImpl(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: process.env.ORDER_NOTIFY_EMAIL }] }],
        from: { email: FROM, name: "*ASILUM orders" },
        subject: `*ASILUM — order paid: ${order.id}`,
        content: [{
          type: "text/plain",
          value: [
            `Order ${order.id} is PAID.`,
            ``,
            `item:     ${order.item_id}`,
            `amount:   ${(((order.amount_cents || 0) + (order.fee_cents || 0)) / 100).toFixed(2)} ${String(order.currency || "").toUpperCase()} (incl. ${((order.fee_cents || 0) / 100).toFixed(2)} passenger fee)`,
            `buyer:    ${order.user_id}`,
            `session:  ${order.stripe_session_id || "-"}`,
            ``,
            `The order ledger is the authority; this mail is only a notification.`,
          ].join("\n"),
        }],
      }),
    });
    if (res.status === 202) return { sent: true };
    return { sent: false, reason: `sendgrid ${res.status}` };
  } catch (err) {
    return { sent: false, reason: err && err.message ? err.message : "send failed" };
  }
}
