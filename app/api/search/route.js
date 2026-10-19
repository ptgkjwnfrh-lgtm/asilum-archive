// app/api/search/route.js
// GET /api/search?q=<text>&user=<id>&brain=<0|1>
// ASILUM Search Engine v1 (lib/search): database-backed, mapping-expanded,
// ranked, logged. Response keeps the original multi-search shape the shell
// consumes — { q, brands, items, aesthetics } — and adds `results` (ranked,
// with confidenceScore / matchReason / matchedTags) and `interpreted`.
// GET stays side-effect-free for derived state; the search log is an
// append-only analytics write, capped and non-blocking.

import { NextResponse } from "next/server";
import { TAGS } from "../../../lib/brain/tags.js";
import { searchProducts } from "../../../lib/search/index.js";
import { sourceFor } from "../../../lib/social.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { consumeRateLimit, consumeGlobalBudget, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { requestSubject } from "../../../lib/security/request.js";
import { getMemoryPreferences } from "../../../lib/db/production.js";
import { envelope, failure, newRequestId } from "../../../lib/api/outcome.js";
import { resolveOverviewForQuery } from "../../../lib/people/resolve.js";
import { getDiscoverablePool, publicProduct } from "../../../lib/products.js";
import { bindingOf, snapshotOf, encodeCursor, decodeCursor } from "../../../lib/search/cursor.js";
import { POLICY_VERSION } from "../../../lib/brain/policy.js";
import { sizeWithHints } from "../../../lib/brain/fitHints.js";
import { getUserRecommendationExclusions } from "../../../lib/db/production.js";
// V.2 §10 step 6: the taste reranker, only when the reader asked for guidance
import { getProfile } from "../../../lib/db/index.js";
import { applyTimeDecay } from "../../../lib/brain/memory.js";
import { RERANK_VERSION, rerankByTaste } from "../../../lib/search/reranker.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 200);
  const requestId = newRequestId();
  if (!q) return NextResponse.json({
    ...envelope({ count: 0, requestId }),
    q, brands: [], items: [], aesthetics: [], results: [], total: 0, guidanceEnabled: false,
  });
  const quota = await consumeRateLimit({ scope: "search", subject: requestSubject(req), limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const globalQuota = await consumeGlobalBudget("search");
  if (!globalQuota.allowed) {
    return NextResponse.json(rateLimitResponse(globalQuota), {
      status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(globalQuota.retryAfterMs / 1000))) },
    });
  }
  const requestedGuidance = searchParams.get("brain") === "1";
  const userId = requestedGuidance
    ? await resolveRequestUser(req, searchParams.get("user") || "") : null;
  const guidanceEnabled = !!userId &&
    (await getMemoryPreferences(userId).catch(() => ({ guidanceEnabled: false }))).guidanceEnabled !== false;

  // STABLE PAGES on search too (synergy round): the same signed cursor
  // /api/discover uses, bound to the query, the eligibility context and a
  // snapshot of the ordered ids. `limit` 1..96 (default 48); a cursor from
  // another query or a changed list answers 409 stale_cursor.
  const limit = Math.max(1, Math.min(96, parseInt(searchParams.get("limit"), 10) || 48));
  const cursor = (searchParams.get("cursor") || "").slice(0, 512);
  let out;
  try {
    out = await searchProducts(q, { userId, brain: guidanceEnabled, limit: 2000 });
  } catch (error) {
    // UNAVAILABLE IS NOT EMPTY (19 Sep 2026). This used to answer an engine
    // throw with `{ results: [], total: 0 }` and HTTP 200 — a reader could not
    // tell "nothing matches" from "the engine is down". Now it is a typed,
    // retryable 503 (docs/v2/CONTRACTS.md § Common behavior).
    console.error("[search] engine failure", requestId, error?.message || error);
    const failed = failure("unavailable", "search_engine_failed", "the search engine could not answer — retry", { requestId });
    return NextResponse.json({ ...failed.body, q, results: [], total: null }, { status: failed.status });
  }

  // THE TASTE RERANKER (V.2 §10): explicit stamps apart from inferred taste,
  // inferred already time-decayed, hidden tags against, served ids as
  // exposure. Exact-identity rows are pinned and no row is added or removed
  // — the engine's constraints stand. SEARCH_TASTE_RERANK=0 kills it.
  let reranked = false;
  if (guidanceEnabled && process.env.SEARCH_TASTE_RERANK !== "0") {
    try {
      const raw = await getProfile(userId);
      const { profile } = applyTimeDecay(raw);
      const explicit = {}, inferred = {}, negative = {};
      for (const [t, v] of Object.entries(profile._meta?.manual || {})) if (v && v !== "off") explicit[t] = 1;
      for (const [t, w] of Object.entries(profile.long || {})) { if (w > 0) inferred[t] = w; else if (w < 0) negative[t] = -w; }
      const seen = new Set((profile._meta?.seen || []).map(String));
      out.results = rerankByTaste(out.results, { taste: { explicit, inferred, negative }, seen });
      reranked = true;
    } catch (error) { console.error("[search] rerank skipped", requestId, error?.message || error); }
  }

  const resolvedEntities = resolveOverviewForQuery(q, { pool: await getDiscoverablePool().catch(() => null) });
  // the reader's fit hints, when the search is personalised (the same reading the feed serves)
  const fitHints = userId ? (await getUserRecommendationExclusions(userId).catch(() => null))?.fitHints || [] : [];
  const binding = bindingOf({ q, guidanceEnabled, subject: guidanceEnabled ? requestSubject(req) : null });
  const snapshotId = snapshotOf(out.results.map((it) => it.id));
  let offset = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor, { binding, snapshotId });
    if (!decoded.ok) {
      const stale = decoded.reason === "snapshot" || decoded.reason === "context";
      const failed = stale
        ? failure("stale_cursor", "cursor_" + decoded.reason, "this page no longer exists — restart from the first page", { requestId })
        : failure("invalid", "cursor_" + decoded.reason, "the cursor could not be read", { requestId });
      return NextResponse.json(failed.body, { status: failed.status });
    }
    offset = decoded.offset;
  }
  const page = out.results.slice(offset, offset + limit);
  const nextCursor = offset + limit < out.results.length ? encodeCursor({ offset: offset + limit, snapshotId, binding }) : null;

  // Legacy multi-search facets, now derived from the ranked results.
  const brands = [];
  const seenBrands = new Set();
  const items = [];
  for (const it of page) {
    if (it.brand && !seenBrands.has(it.brand) &&
        (it.brand.toLowerCase().includes(q) || it.matchReason === "designer match")) {
      seenBrands.add(it.brand);
      if (brands.length < 6) brands.push(it.brand);
    }
    if (items.length < 6) {
      const product = publicProduct(it);
      if (!product) continue;
      items.push({
        ...product, src: sourceFor(it),
        matchReason: it.matchReason, confidenceScore: it.confidenceScore,
        match: it.match || null,
      });
    }
  }
  const aesthetics = TAGS.filter((t) => t.toLowerCase().includes(q));

  return NextResponse.json({
    taste: { reranked, version: reranked ? RERANK_VERSION : null },
    ...envelope({ count: page.length, requestId }),
    policyVersion: POLICY_VERSION,
    q, brands, items, aesthetics,
    total: out.total,
    totalIsExact: true,
    offset,
    limit,
    nextCursor,
    snapshotId,
    candidatesTruncated: !!out.candidatesTruncated,
    // 16.3 (slice 12): the overview carries the BRDCSTs in this viewer's reach that name the entity
    overview: resolvedEntities.overview ? { ...resolvedEntities.overview, brdcst: await (async () => { try { const { brdcstsForEntity } = await import("../../../lib/db/production/brdcst.js"); const viewer = userId || await resolveRequestUser(req, searchParams.get("user") || "").catch(() => null); return await brdcstsForEntity({ viewerId: viewer, entity: resolvedEntities.overview }); } catch { return []; } })() } : resolvedEntities.overview,
    related: resolvedEntities.related,
    entities: resolvedEntities.entities,
    query: resolvedEntities.query,
    guidanceEnabled,
    interpreted: out.interpreted,
    // Honest disclosure of words the catalog could not match (Aug 5). The
    // engine used to drop them silently and return the whole garment
    // category as though it had understood.
    note: out.note || null,
    unmatchedTokens: out.unmatchedTokens || [],
    // The cultural and semantic tiers describe THEMSELVES — which entity was
    // read, which interpretation, whether the reading was personalised,
    // whether embeddings re-ranked or appended. All computed, all dropped
    // here until now.
    cultural: out.cultural || null,
    semantic: out.semantic || null,
    results: page.map((it) => {
      const product = publicProduct(it);
      if (!product) return null;
      return {
        ...product, src: sourceFor(it),
        // Preserve the route's ranked answer while publicProduct owns the
        // catalog allowlist (including native Storefront fields).
        confidenceScore: it.confidenceScore, matchReason: it.matchReason,
        matchedTags: it.matchedTags, availability: it.availability_status || "unknown",
        size: it.size && typeof it.size === "object" ? sizeWithHints(it, fitHints) : it.size ?? null,
      };
    }).filter(Boolean),
  });
}
