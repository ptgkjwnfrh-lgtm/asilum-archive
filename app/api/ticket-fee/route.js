// app/api/ticket-fee/route.js
// The §6 referral lane's money door. ASILUM charges the passenger fee ALONE;
// the real purchase — payment, tax, shipping — completes on the source. The
// fee buys the purchase ticket. Card data never touches this server: the
// housing mounts Stripe's Payment Element (their iframes), and returning
// buyers confirm with the vault's saved method entirely server-side.
//
// POST  { user?, itemId, consent, profile? } → fee order + client secret
//       (mode "element"), or saved-card summary (mode "saved"). `profile`
//       (name/address) is accepted while the vault holds none — the
//       first-purchase door; afterwards SETTINGS is the only editor.
// PATCH { user?, orderId, action: "pay-saved" } → off-session confirm.
// GET   ?order=<id> → the caller's fee order, reconciled on read, with its
//       ticket once paid — the housing's success read.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { gate } from "../../../lib/identity/gate.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import {
  startTicketFee, confirmTicketFeeWithSavedCard, reconcileOrder, getOrder, getTicketByFeeOrder,
  ticketFeeCents, refusalReason, PASSENGER_FEE_RATE, PASSENGER_FEE_FLAT_CENTS, ORDER_CURRENCY_DEFAULT,
} from "../../../lib/orders.js";
import { publicBuyerProfile, upsertBuyerIdentity, getBuyerProfile } from "../../../lib/vault.js";
import { resolveProduct, publicProduct } from "../../../lib/products.js";

export const dynamic = "force-dynamic";

function publicFeeOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    kind: order.kind,
    item_id: order.item_id,
    status: order.status,
    amount_cents: order.amount_cents,
    fee_cents: order.fee_cents || 0,
    total_today_cents: order.fee_cents || 0, // the fee is ALL ASILUM charges here
    currency: order.currency,
    created_at: order.created_at,
  };
}

function ticketOut(t) {
  if (!t) return null;
  return {
    id: t.id,
    status: t.status,
    source_url: t.sourceProductUrl || t.source_product_url || null,
  };
}

export async function POST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const itemId = String(body.itemId || "").slice(0, 80);
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const quota = await consumeRateLimit({ scope: "checkout", subject: user, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });

  // Native Storefront goods have their own connected-account rail and exact
  // passenger-fee policy. They must never create a historical referral ticket
  // or inherit its passenger fee, even if a client calls this route directly.
  const item = await resolveProduct(itemId);
  if (!item) return NextResponse.json({ error: "product not found" }, { status: 404 });
  if (item.commerce_rail === "native_storefront") {
    return NextResponse.json({ error: "native Storefront items require native checkout" }, { status: 409 });
  }

  // First-purchase identity: accepted only while the vault holds none.
  if (body.profile && typeof body.profile === "object") {
    const existing = await getBuyerProfile(user);
    if (!existing || !existing.full_name) {
      const p = body.profile;
      const missing = ["fullName", "addressLine1", "city", "postalCode", "country"]
        .filter((k) => !String(p[k] || "").trim());
      if (missing.length) {
        return NextResponse.json(
          { error: `first purchase stores your details once — still needed: ${missing.join(", ")}` },
          { status: 400 }
        );
      }
      await upsertBuyerIdentity(user, {
        fullName: p.fullName, addressLine1: p.addressLine1, addressLine2: p.addressLine2,
        city: p.city, region: p.region, postalCode: p.postalCode, country: p.country,
      });
    }
  }

  { const g = await gate(req, String(body.user || ""), { needs: ["age"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); } // Terms 2.2: 18+ buys
  const result = await startTicketFee({ user, itemId, consent: body.consent === true, creditCents: Number(body.creditCents) || 0 });
  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const pub = item ? publicProduct(item) : null;
  if (result.paidByCredit) {
    // the fee was covered by Credit: paid, the ticket open, nothing charged
    const ticket = await getTicketByFeeOrder(result.orderId).catch(() => null);
    return NextResponse.json({ order: result.orderId, mode: "credit", fee_cents: result.feeCents, credit_cents: result.creditCents, charged_cents: 0, total_today_cents: 0, currency: result.currency, ticket: ticketOut(ticket) });
  }
  return NextResponse.json({
    order: result.orderId,
    mode: result.savedCard ? "saved" : "element",
    credit_cents: result.creditCents || 0,
    // The saved path confirms server-side; the secret stays server-held.
    clientSecret: result.savedCard ? null : result.clientSecret,
    savedCard: result.savedCard,
    fee_cents: result.feeCents,
    amount_cents: result.amountCents,
    total_today_cents: result.feeCents,
    currency: result.currency,
    profile: await publicBuyerProfile(user),
    item: pub ? {
      id: pub.id, title: pub.title, brand: pub.brand || null,
      price: pub.price, currency: pub.currency, img: pub.img || null,
    } : null,
  });
}

export async function PATCH(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (body.action !== "pay-saved") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const orderId = String(body.orderId || "").slice(0, 80);
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  const result = await confirmTicketFeeWithSavedCard({ user, orderId });
  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const ticket = await getTicketByFeeOrder(orderId);
  return NextResponse.json({ order: publicFeeOrder(result.order), ticket: ticketOut(ticket) });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  // ?item= — the QUOTE read: the housing's opening state. No order is
  // created, nothing is charged; the demo gate still answers honestly.
  const itemParam = String(searchParams.get("item") || "").slice(0, 80);
  if (itemParam) {
    const item = await resolveProduct(itemParam);
    if (!item) return NextResponse.json({ error: "product not found" }, { status: 404 });
    if (item.commerce_rail === "native_storefront") {
      return NextResponse.json({ error: "native Storefront items require native checkout" }, { status: 409 });
    }
    const pub = publicProduct(item);
    const amountCents = Math.round(Number(item.price) * 100);
    const feeCents = ticketFeeCents(amountCents);
    return NextResponse.json({
      quote: {
        item: {
          id: pub.id, title: pub.title, brand: pub.brand || null,
          price: pub.price, currency: pub.currency, img: pub.img || null,
        },
        amount_cents: amountCents,
        fee_cents: feeCents,
        floored: false,
        policy: { flatCents: PASSENGER_FEE_FLAT_CENTS, rate: PASSENGER_FEE_RATE, label: "$1 + 1.5% passenger fee" },
        currency: String(item.currency || ORDER_CURRENCY_DEFAULT).toLowerCase(),
        source_name: item.source_name || null,
        refusal: refusalReason(item),
        // 5.32 / 10.5 (slice 11): Credit may pay the fee first; the balance the page may offer
        credit_cents: await import("../../../lib/db/production/credit.js").then((m) => m.creditBalance(user)).catch(() => 0),
      },
      profile: await publicBuyerProfile(user),
    });
  }

  const orderId = String(searchParams.get("order") || "").slice(0, 80);
  if (!orderId) return NextResponse.json({ error: "order required" }, { status: 400 });
  const order = await getOrder(orderId);
  // Wrong-owner reads 404, not 403: order ids should not be probeable.
  if (!order || order.user_id !== user) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  const fresh = (await reconcileOrder(order)) || order;
  const ticket = fresh.status === "paid" ? await getTicketByFeeOrder(orderId) : null;
  return NextResponse.json({ order: publicFeeOrder(fresh), ticket: ticketOut(ticket) });
}
