// Public Storefront read: a strict projection with no owner, provider or fee
// identifiers. Draft, paused and rejected stores are indistinguishable from
// missing ones.

import { NextResponse } from "next/server";

import { getPublicStorefrontBySlug, StorefrontRefused } from "../../../../lib/db/production.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { requestSubject } from "../../../../lib/security/request.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const quota = await consumeRateLimit({
    scope: "storefront-public-read", subject: requestSubject(req), limit: 120, windowMs: 60_000,
  });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const slug = new URL(req.url).searchParams.get("slug") || "";
  try {
    const storefront = await getPublicStorefrontBySlug(slug);
    if (!storefront) {
      return NextResponse.json({ error: "storefront not found", code: "STORE_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(storefront, {
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
  } catch (error) {
    if (error instanceof StorefrontRefused) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[storefront-public] read failed", error?.message || error);
    return NextResponse.json({ error: "storefront unavailable", code: "STOREFRONT_UNAVAILABLE" }, { status: 503 });
  }
}

