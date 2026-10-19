// app/api/checkout/route.js
// POST { user?, itemId }  → open a Stripe-hosted checkout for a REAL item
//                           (demo archive records refuse with 409 — the same
//                           honesty gate as the ticket flow).
// GET  ?order=<id>        → the caller's own order, reconciled against Stripe
//                           on read when it is still awaiting payment.
// GET  ?session=<cs_…>    → the same, looked up by checkout session (the
//                           success URL carries the session id).
// GET  ?mine=1            → the caller's orders, newest first, titles joined,
//                           awaiting ones reconciled (bounded).
//
// Card data never touches this server: the session URL points at
// checkout.stripe.com. Unkeyed deploys answer 503, honestly idle.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { gate } from "../../../lib/identity/gate.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { startCheckout, reconcileOrder, getOrder } from "../../../lib/orders.js";
import { getOrderBySession, listOrdersForUser } from "../../../lib/db/orders.js";
import { getItems } from "../../../lib/db/index.js";

export const dynamic = "force-dynamic";

function publicOrder(order) {
  const native = order.commerce_rail === "native_storefront";
  const out = {
    id: order.id,
    kind: order.kind || "sale",
    ...(native ? { commerce_rail: "native_storefront" } : {}),
    item_id: order.item_id,
    status: order.status,
    amount_cents: order.amount_cents,
    fee_cents: order.fee_cents || 0,
    // What the buyer actually paid ASILUM: a sale charges piece + fee; a
    // ticket fee charges the fee ALONE (the piece is paid at the source).
    total_cents: native
      ? Number(order.buyer_total_cents || 0)
      : (order.kind === "ticket_fee")
      ? (order.fee_cents || 0)
      : (order.amount_cents || 0) + (order.fee_cents || 0),
    currency: order.currency,
    created_at: order.created_at,
  };
  if (native) {
    out.merchandise_cents = Number(order.merchandise_cents || 0);
    out.passenger_fee_cents = Number(order.passenger_fee_cents || 0);
    out.storefront_fee_cents = 0;
  }
  // Present only while the session is still open at Stripe (reconcile read
  // it seconds ago) — the reader finishes paying instead of re-buying.
  if (order._resumeUrl) out.resume_url = order._resumeUrl;
  return out;
}

export async function POST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  { const g = await gate(req, String(body.user || ""), { needs: ["age"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); } // Terms 2.2: 18+ buys
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const itemId = String(body.itemId || "").slice(0, 80);
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const variantId = body.variantId == null || body.variantId === ""
    ? null : String(body.variantId).slice(0, 64);
  const quantity = body.quantity == null ? 1 : Number(body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) {
    return NextResponse.json({ error: "quantity must be an integer from 1 to 25" }, { status: 400 });
  }
  const requestKey = body.idempotencyKey == null || body.idempotencyKey === ""
    ? null : String(body.idempotencyKey).slice(0, 64);
  const quota = await consumeRateLimit({ scope: "checkout", subject: user, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });

  const result = await startCheckout({
    user,
    itemId,
    variantId,
    quantity,
    requestKey,
  });
  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    order: result.orderId,
    url: result.url,
    ...(result.commerceRail ? {
      commerceRail: result.commerceRail,
      quantity: result.quantity,
      quote: result.quote,
    } : {}),
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  // ?mine=1 — the caller's own orders, newest first. Orders still awaiting
  // payment are reconciled on read (bounded: the newest five) so the page
  // never shows "awaiting" for a session Stripe already settled.
  if (searchParams.get("mine") === "1") {
    const orders = await listOrdersForUser(user, 20);
    let reconciled = 0;
    for (let i = 0; i < orders.length; i++) {
      if (orders[i].status === "awaiting_payment" && reconciled < 5) {
        reconciled += 1;
        orders[i] = (await reconcileOrder(orders[i])) || orders[i];
      }
    }
    const titles = await titlesFor(orders.map((o) => o.item_id));
    return NextResponse.json({
      orders: orders.map((o) => ({ ...publicOrder(o), title: titles.get(o.item_id) || null })),
    });
  }

  // ?session=cs_… — the checkout-return lookup (the success URL carries the
  // session id, never an order id). Ownership-checked like ?order=.
  const sessionId = String(searchParams.get("session") || "").slice(0, 120);
  const orderId = String(searchParams.get("order") || "").slice(0, 80);
  if (!orderId && !sessionId) return NextResponse.json({ error: "order or session required" }, { status: 400 });
  const order = orderId ? await getOrder(orderId) : await getOrderBySession(sessionId);
  // Wrong-owner reads 404, not 403: order ids should not be probeable.
  if (!order || order.user_id !== user) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  const fresh = await reconcileOrder(order);
  const titles = await titlesFor([order.item_id]);
  return NextResponse.json({
    order: { ...publicOrder(fresh || order), title: titles.get(order.item_id) || null },
  });
}

async function titlesFor(itemIds) {
  const titles = new Map();
  try {
    // getItems returns a Map keyed by id — iterate values, not entries.
    const items = await getItems([...new Set(itemIds.filter(Boolean))]);
    for (const item of items.values()) titles.set(item.id, item.title || null);
  } catch { /* titles are decoration — the order stands without them */ }
  return titles;
}
