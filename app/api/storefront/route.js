// Account-owned native Storefront API. Device identities are deliberately
// refused: storefront, inventory and fee obligations belong to an account.

import { NextResponse } from "next/server";
import { gate } from "../../../lib/identity/gate.js";

import {
  archiveStorefrontListing,
  createStorefront,
  createStorefrontListing,
  getStorefrontForOwner,
  StorefrontRefused,
  updateStorefront,
  updateStorefrontListing,
  // slice 6 — native commerce (lib/db/production/commerce.js)
  CommerceRefused, setListingMode, setOfferSettings, getOfferSettings, listOffersForSeller, respondOffer,
  applyDiscount, cancelDiscount, activeDiscount, priceHistory, relistListing, listRelists, queueMembers, expireDiscounts, expireOffers,
  // slice 7 — after the sale
  setListingReturns, AftersaleRefused,
} from "../../../lib/db/production.js";
import { accountIdFromIdentity, resolveRequestUser } from "../../../lib/identity.js";
import { STOREFRONT_TERMS_VERSION } from "../../../lib/storefront/contracts.js";
import { storefrontRuntimeFlags } from "../../../lib/storefront/flags.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";

export const dynamic = "force-dynamic";

function authResponse(user) {
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  return NextResponse.json({
    error: "a signed-in account is required",
    code: "ACCOUNT_REQUIRED",
  }, { status: 403 });
}

function result(body, status = 200) {
  return NextResponse.json({ currentTermsVersion: STOREFRONT_TERMS_VERSION, ...body }, { status });
}

function refused(error) {
  if (error instanceof AftersaleRefused) {
    return NextResponse.json({ error: error.message, code: error.code, currentTermsVersion: STOREFRONT_TERMS_VERSION }, { status: error.status });
  }
  if (error instanceof CommerceRefused) {
    return NextResponse.json({ error: error.message, code: error.code, currentTermsVersion: STOREFRONT_TERMS_VERSION }, { status: error.status });
  }
  if (error instanceof StorefrontRefused) {
    return NextResponse.json({
      error: error.message,
      code: error.code,
      currentTermsVersion: STOREFRONT_TERMS_VERSION,
    }, { status: error.status });
  }
  console.error("[storefront] request failed", error?.message || error);
  return NextResponse.json({ error: "storefront unavailable", code: "STOREFRONT_UNAVAILABLE" }, { status: 503 });
}

async function ownerFrom(req, claimed) {
  const user = await resolveRequestUser(req, String(claimed || ""));
  return { user, accountId: accountIdFromIdentity(user) };
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const identity = await ownerFrom(req, searchParams.get("user"));
  if (!identity.accountId) return authResponse(identity.user);
  const quota = await consumeRateLimit({
    scope: "storefront-owner-read", subject: identity.user, limit: 120, windowMs: 60_000,
  });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    // the owner's read also sweeps the clocks: a discount past 24 hours restores
    // its price (7.31), an offer past its window reads expired
    await expireDiscounts().catch(() => 0);
    await expireOffers().catch(() => 0);
    const envelope = await getStorefrontForOwner(identity.accountId);
    const storeId = envelope.storefront ? envelope.storefront.id : null;
    const commerce = storeId ? {
      offerSettings: await getOfferSettings(storeId).catch(() => null),
      offers: await listOffersForSeller(identity.accountId, { limit: 100 }).catch(() => []),
      discounts: Object.fromEntries(await Promise.all((envelope.storefront.listings || []).map(async (l) => [l.id, await activeDiscount(l.id).catch(() => null)]))),
      queues: Object.fromEntries(await Promise.all((envelope.storefront.listings || []).map(async (l) => [l.id, (await queueMembers(l.id).catch(() => [])).filter((m) => m.state !== "closed").length]))),
    } : null;
    return result({ ...envelope, commerce });
  } catch (error) {
    return refused(error);
  }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 64 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const identity = await ownerFrom(req, body.user);
  if (!identity.accountId) return authResponse(identity.user);
  const quota = await consumeRateLimit({
    scope: "storefront-owner-write", subject: identity.user, limit: 60, windowMs: 60_000,
  });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });

  try {
    const flags = storefrontRuntimeFlags();
    if (!flags.surfaceEnabled) {
      throw new StorefrontRefused("STOREFRONT_DISABLED", "storefront writes are disabled", 503);
    }
    if (["create_listing", "update_listing", "archive_listing", "set_mode", "discount_apply", "discount_cancel", "discount_bulk", "relist_listing"].includes(body.action)
      && !flags.listingWritesEnabled) {
      throw new StorefrontRefused("LISTING_WRITES_DISABLED", "storefront listing writes are disabled", 503);
    }
    switch (body.action) {
      case "create_store": {
        const g = await gate(req, String(body.user || ""), { needs: ["sell"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); // 6.34, Terms 2.2
        return result(await createStorefront({
          accountId: identity.accountId,
          name: body.name,
          slug: body.slug,
          description: body.description,
          imageUrl: body.imageUrl,
          bannerUrl: body.bannerUrl,
          acceptedTermsVersion: body.acceptedTermsVersion,
          accepted: body.accepted,
        }), 201);
      }
      case "update_store":
        return result(await updateStorefront(identity.accountId, body));
      case "create_listing": {
        const g = await gate(req, String(body.user || ""), { needs: [body.mode === "drop" ? "drop" : "sell"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status });
        return result(await createStorefrontListing(identity.accountId, body), 201);
      }
      case "update_listing":
        return result(await updateStorefrontListing(identity.accountId, body.listingId, body));
      case "archive_listing":
        return result(await archiveStorefrontListing(identity.accountId, body.listingId, body.version));
      // ---- slice 6: native commerce --------------------------------------------
      case "set_mode": {
        if (body.mode === "drop") { const g = await gate(req, String(body.user || ""), { needs: ["drop"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); } // 6.34: enhanced checks for a DROP
        return result(await setListingMode(identity.accountId, body.listingId, body.mode));
      }
      case "offer_settings":
        return result({ offerSettings: await setOfferSettings(identity.accountId, body.settings || {}) });
      case "offer_respond": {
        const action = ["accept", "decline", "counter"].includes(body.offerAction) ? body.offerAction : null;
        if (!action) return NextResponse.json({ error: "offerAction must be accept, decline or counter", code: "INVALID_ACTION" }, { status: 400 });
        return result(await respondOffer({ offerId: String(body.offerId || ""), by: "seller", actorId: identity.accountId, action, amountCents: body.amountCents == null ? null : Number(body.amountCents) }));
      }
      case "discount_apply":
        return result(await applyDiscount(identity.accountId, body.listingId, { percent: Number(body.percent), renew: body.renew === true }));
      case "discount_cancel":
        return result(await cancelDiscount(identity.accountId, body.listingId));
      case "discount_bulk": {
        // 8.2: one action over a set of listings; each still shows its own price
        const ids = Array.isArray(body.listingIds) ? body.listingIds.map(String).slice(0, 50) : [];
        const out = [];
        for (const id of ids) {
          try { out.push({ listingId: id, ...(await applyDiscount(identity.accountId, id, { percent: Number(body.percent), renew: body.renew === true })) }); }
          catch (error) { out.push({ listingId: id, error: error.message, code: error.code || null }); }
        }
        return result({ applied: out });
      }
      case "price_history":
        return result({ history: await priceHistory(body.listingId) });
      case "relist_listing":
        return result(await relistListing(identity.accountId, body.listingId, body));
      case "relists":
        return result({ relists: await listRelists(body.listingId) });
      case "set_returns":
        // 6.1, 6.5: enabling returns earns $1 Credit once, after the first completed, non-refunded sale
        return result(await setListingReturns(identity.accountId, body.listingId, body.enabled === true));
      default:
        return NextResponse.json({ error: "unknown storefront action", code: "UNKNOWN_ACTION" }, { status: 400 });
    }
  } catch (error) {
    return refused(error);
  }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
