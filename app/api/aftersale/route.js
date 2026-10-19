// app/api/aftersale/route.js — AFTER THE SALE, the passenger's side (V.2
// Blueprint chapter 6 and 10; slice 7). The admin decides through
// /api/admin (aftersale.decide, aftersale.refund, aftersale.deliver).
//
// GET  ?user=&order=     → the order's after-sale facts: delivery, windows,
//                          protection election, returns, payout state, what
//                          the caller may do now
// GET  ?protection=1&itemValueCents= → the |A| Protection offer (never
//                          preselected; without a provider, unavailable with
//                          its reason)
// POST { order, action: "deliver", tracking? }       (the seller's manual tracking, 10.7)
// POST { order, action: "return", kind, reason, evidence? }  (the buyer)
// POST { order, action: "label", pays: true|false }  (the seller answers a seller-fault return's label, 6.7)
// POST { order, action: "dispatch", event: "label" | "handoff" }  (the seller)
// POST { order, action: "elect", elected: true|false }  (the buyer, before payment)

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import {
  orderFacts, recordDelivery, openReturn, sellerLabelAnswer, returnsFor, markDispatch, getDispatch, protectionOfferFor, recordElection, AftersaleRefused,
} from "../../../lib/db/production/aftersale.js";
import { canReview } from "../../../lib/storefront/score.js";
import { dispatchLate } from "../../../lib/storefront/protection.js";

export const dynamic = "force-dynamic";

function refused(error) {
  if (error instanceof AftersaleRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[aftersale] failed", error?.message || error);
  return NextResponse.json({ error: "after-sale records unavailable", code: "AFTERSALE_UNAVAILABLE" }, { status: 503 });
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("protection") === "1") {
    const offer = await protectionOfferFor({ itemValueCents: Number(searchParams.get("itemValueCents") || 0), shippingCents: Number(searchParams.get("shippingCents") || 0), destination: searchParams.get("destination") || null });
    return NextResponse.json({ offer });
  }
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "aftersale-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const orderId = String(searchParams.get("order") || "");
  try {
    const facts = await orderFacts(orderId);
    if (!facts) return NextResponse.json({ error: "order not found", code: "ORDER_NOT_FOUND" }, { status: 404 });
    const seller = facts.sellerAccountId ? "sb-" + facts.sellerAccountId : null;
    const role = facts.buyerId === user ? "buyer" : seller === user ? "seller" : null;
    if (!role) return NextResponse.json({ error: "not your order", code: "NOT_A_PARTY" }, { status: 403 });
    const dispatch = await getDispatch(orderId);
    const now = Date.now();
    const review = canReview({ deliveredAt: facts.law.deliveredAt, now });
    const { order, ...rest } = facts;
    return NextResponse.json({
      role, orderId, status: order.status, native: facts.native,
      delivery: rest.delivery, windows: rest.windows, election: rest.election, returns: rest.returns, payout: role === "seller" ? rest.payout : null,
      dispatch, late: dispatch ? dispatchLate({ mode: dispatch.mode, paidAt: order.updated_at || order.created_at, labelPrintedAt: dispatch.labelPrintedAt, handedAt: dispatch.handedAt, extensions: dispatch.extensions, now }) : null,
      can: {
        review: review.ok, reviewReason: review.reason || null,
        return: role === "buyer" && order.status === "paid" && !rest.returns.some((r) => r.state === "open" || r.state === "approved"),
        deliver: role === "seller" && order.status === "paid" && !rest.delivery,
        dispatch: role === "seller" && order.status === "paid",
      },
      law: { creditApplied: facts.law.creditAppliedCents > 0, protected: facts.law.protected, sellerReturnsEnabled: facts.law.sellerReturnsEnabled },
    });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "aftersale-write", subject: user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const orderId = String(body.order || "");
  try {
    switch (body.action) {
      case "deliver":
        return NextResponse.json(await recordDelivery({ orderId, by: user, source: "seller", tracking: body.tracking || null }), { status: 201 });
      case "return":
        return NextResponse.json(await openReturn({ orderId, buyerId: user, kind: body.kind, reason: body.reason, evidence: body.evidence }), { status: 201 });
      case "label": {
        const open = (await returnsFor(orderId)).find((r) => r.state === "open" || r.state === "approved");
        if (!open) return NextResponse.json({ error: "no open return", code: "NO_RETURN" }, { status: 404 });
        return NextResponse.json({ return: await sellerLabelAnswer({ returnId: open.id, sellerId: user, pays: body.pays === true }) });
      }
      case "dispatch":
        return NextResponse.json(await markDispatch({ orderId, by: user, event: body.event, mode: body.mode || "sell" }));
      case "elect": {
        const facts = await orderFacts(orderId);
        if (!facts || facts.buyerId !== user) return NextResponse.json({ error: "not your order", code: "NOT_A_PARTY" }, { status: 403 });
        const offer = await protectionOfferFor({ itemValueCents: Number(facts.order.amount_cents || facts.order.merchandise_cents || 0) });
        return NextResponse.json({ election: await recordElection({ orderId, elected: body.elected === true, offer }) });
      }
      default:
        return NextResponse.json({ error: "deliver, return, label, dispatch or elect", code: "UNKNOWN_ACTION" }, { status: 400 });
    }
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
