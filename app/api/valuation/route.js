// app/api/valuation/route.js — THE VALUATION READ (V.2 chapter 11; slice 12).
// GET ?item= → { valuation } from lib/valuation/comparables.js over the sales
// ASILUM recorded. Public: the read names its basis and confidence and never
// invents a figure. Rate-limited like any catalog read.

import { NextResponse } from "next/server";
import { resolveProduct } from "../../../lib/products.js";
import { valuationFor } from "../../../lib/db/production/valuation.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("item") || "").slice(0, 80);
  if (!id) return NextResponse.json({ error: "item required" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for") || "anon";
  const quota = await consumeRateLimit({ scope: "valuation", subject: ip, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const item = await resolveProduct(id);
  if (!item) return NextResponse.json({ error: "product not found" }, { status: 404 });
  try {
    const valuation = await valuationFor(item);
    return NextResponse.json({ item: id, valuation }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (err) {
    console.error("[valuation] failed", err?.message || err);
    return NextResponse.json({ error: "the valuation could not be read", code: "VALUATION_UNAVAILABLE" }, { status: 503 });
  }
}
