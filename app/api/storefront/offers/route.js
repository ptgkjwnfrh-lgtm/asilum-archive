// app/api/storefront/offers/route.js — OFFERS, the buyer's side (V.2
// Blueprint 7.19–7.30, 8.7–8.11; slice 6). The seller answers through
// /api/storefront { action: "offer_respond" }.
//
// GET  ?user=        → the caller's offers, newest first, each with its live state
// POST { listingId, variantId?, amountCents }        → make an offer (24-hour window)
// POST { offerId, action: "accept" | "decline" | "counter", amountCents? }
//                     → answer a seller's counter (the buyer is the receiving party)
//
// A signed-in ACCOUNT is required: an offer is a commitment that cannot be
// withdrawn once sent (8.9), and a device identity cannot carry one.

import { NextResponse } from "next/server";
import { accountIdFromIdentity, resolveRequestUser } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { makeOffer, respondOffer, listOffersForBuyer, CommerceRefused } from "../../../../lib/db/production/commerce.js";
import { OFFER_WINDOW_MS, ACCEPTED_WINDOW_MS } from "../../../../lib/storefront/commerce.js";

export const dynamic = "force-dynamic";

function refused(error) {
  if (error instanceof CommerceRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error && error.name === "StorefrontRefused") return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[offers] failed", error?.message || error);
  return NextResponse.json({ error: "offers unavailable", code: "OFFERS_UNAVAILABLE" }, { status: 503 });
}

async function identity(req, claimed) {
  const user = await resolveRequestUser(req, String(claimed || ""));
  return { user, account: accountIdFromIdentity(user) };
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const who = await identity(req, searchParams.get("user"));
  if (!who.user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!who.account) return NextResponse.json({ error: "a signed-in account is required", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "offers-read", subject: who.user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    return NextResponse.json({ offers: await listOffersForBuyer(who.user), windows: { offerMs: OFFER_WINDOW_MS, acceptedMs: ACCEPTED_WINDOW_MS } });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const who = await identity(req, body.user);
  if (!who.user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!who.account) return NextResponse.json({ error: "a signed-in account is required to make an offer", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "offers-write", subject: who.user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    if (body.offerId) {
      const action = ["accept", "decline", "counter"].includes(body.action) ? body.action : null;
      if (!action) return NextResponse.json({ error: "action must be accept, decline or counter", code: "INVALID_ACTION" }, { status: 400 });
      const r = await respondOffer({ offerId: String(body.offerId), by: "buyer", actorId: who.user, action, amountCents: body.amountCents == null ? null : Number(body.amountCents) });
      return NextResponse.json(r);
    }
    const r = await makeOffer({ buyerId: who.user, listingId: String(body.listingId || ""), variantId: body.variantId ? String(body.variantId) : null, amountCents: Number(body.amountCents) });
    return NextResponse.json(r, { status: 201 });
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
