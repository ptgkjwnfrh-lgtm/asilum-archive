// app/api/discover/route.js
// GET /api/discover?q=&source=&tag=&category=&sort=new&offset=&limit=&user=&brain=
// The full site inventory — ranked through the user's Passport only when
// Asterisk guidance is requested and the saved server preference is on.
// products first; the seed catalog only backfills a keyless dev run.
// ?q= runs through the real search engine (lib/search): mappings expansion,
// product_tags layer, ranked results with matchReason.

import { NextResponse } from "next/server";
import { sourceFor } from "../../../lib/social.js";
import {
  searchProducts,
} from "../../../lib/search/index.js";
import { parseTagQuery } from "../../../lib/tagging/grammar.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { consumeRateLimit, consumeGlobalBudget, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { requestSubject } from "../../../lib/security/request.js";
import { getDiscoverablePool, publicProduct } from "../../../lib/products.js";
import { rankByInterpretationTags } from "../../../lib/discover/tagRank.js";
import { resolveSearchAssumption, applyPassportAssumption } from "../../../lib/search/passportAssumption.js";
import { createdAtOf, sortNewestFirst, stripRecencyKey } from "../../../lib/discover/recency.js";
import { getMemoryPreferences, listInterpretationFeedback } from "../../../lib/db/production.js";
import { normalizeQuery } from "../../../lib/asterisk/orchestrator.js";
import { envelope, failure, newRequestId } from "../../../lib/api/outcome.js";
import { bindingOf, snapshotOf, encodeCursor, decodeCursor } from "../../../lib/search/cursor.js";
import { resolveOverviewForQuery } from "../../../lib/people/resolve.js";
import { poolWithFitHints } from "../../../lib/brain/fitHints.js";
import { getUserRecommendationExclusions } from "../../../lib/db/production.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const requestId = newRequestId();
  try {
    return await discover(req, requestId);
  } catch (error) {
    // UNAVAILABLE IS NOT EMPTY (19 Sep 2026): an engine or pool throw is a
    // typed, retryable 503, never a bare framework 500 and never `items: []`.
    console.error("[discover] failed", requestId, error?.message || error);
    const failed = failure("unavailable", "discover_unavailable", "the racks could not be opened — retry", { requestId });
    return NextResponse.json({ ...failed.body, items: null, total: null }, { status: failed.status });
  }
}

async function discover(req, requestId) {
  const { searchParams } = new URL(req.url);
  const quota = await consumeRateLimit({ scope: "discover", subject: requestSubject(req), limit: 180, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const globalQuota = await consumeGlobalBudget("discover");
  if (!globalQuota.allowed) {
    return NextResponse.json(rateLimitResponse(globalQuota), {
      status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(globalQuota.retryAfterMs / 1000))) },
    });
  }
  const q = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 200);
  const source = (searchParams.get("source") || "").slice(0, 80);
  const tag = (searchParams.get("tag") || "").slice(0, 40).toUpperCase();
  const category = (searchParams.get("category") || "").slice(0, 80);
  const sort = searchParams.get("sort") || "";
  let offset = Math.min(10_000, Math.max(0, parseInt(searchParams.get("offset"), 10) || 0));
  const limit = Math.max(1, Math.min(96, parseInt(searchParams.get("limit"), 10) || 48));
  const cursor = (searchParams.get("cursor") || "").slice(0, 512);
  // PINNED TAGS (V.2 slice 4): `pins=silver: jewelry|gothic:` — each one a
  // tag-shaped filter on the search, parsed by the grammar, six at most.
  // (`tags=` is the older interpretation-pill re-ranking below; a pin is a
  // filter on the engine's pool, not a re-ordering of its rack.)
  const tagFilters = (searchParams.get("pins") || "").slice(0, 400).split("|").map(parseTagQuery).filter(Boolean).slice(0, 6);

  let pool = [];
  let items = [];
  let demo = false;
  let guidanceEnabled = false;
  let assumption = null;
  let reading = null;
  if (q) {
    const requestedGuidance = searchParams.get("brain") === "1";
    const userId = requestedGuidance
      ? await resolveRequestUser(req, searchParams.get("user") || "") : null;
    guidanceEnabled = !!userId &&
      (await getMemoryPreferences(userId).catch(() => ({ guidanceEnabled: false }))).guidanceEnabled !== false;
    const result = await searchProducts(q, {
      userId, brain: guidanceEnabled, limit: 2000, tagFilters,
    });
    // FORWARD THE READING (Aug 21). The engine writes a disclosure for almost
    // every query — which word it could not match, which house it read a word
    // as, what an era or a size narrowed to, what an exclusion removed — and
    // this route took `results` and dropped every one of them. Across a
    // 141-query corpus only 12 produced no note at all, so ~91% of what the
    // engine had to say was computed and thrown away one line before the
    // response. "leather jacket" on /discover was 170 outerwear items with
    // zero caveat: the exact Aug 5 defect the disclosure layer was written to
    // end, reintroduced by a route that did not carry it.
    //
    // Verbatim. A route may never synthesise or reword a note.
    // THE OVERVIEW AND ITS RELATED EDGES (V.2 SearchPage). A name earns its
    // sourced registry entity; DESIGNER: HOUSE earns both canonical ids;
    // counts are credits inside the catalog, never tenure inference.
    const resolvedEntities = resolveOverviewForQuery(q, { pool: await getDiscoverablePool() });
    reading = {
      overview: resolvedEntities.overview,
      related: resolvedEntities.related,
      entities: resolvedEntities.entities,
      query: resolvedEntities.query,
      note: result.note || null,
      unmatchedTokens: result.unmatchedTokens || [],
      interpreted: result.interpreted || null,
      cultural: result.cultural || null,
      candidatesTruncated: !!result.candidatesTruncated,
    };
    items = result.results.map((item) => ({ ...publicProduct(item), src: sourceFor(item), _createdAt: createdAtOf(item) }));
    // THE SAME FIT READING ON EVERY SURFACE (19 Sep): a personalised search
    // reads each piece's size through the reader's own fit hints, exactly as
    // the feed and the stylist do. Labels untouched; the hint rides on size.
    if (userId) {
      const hints = (await getUserRecommendationExclusions(userId).catch(() => null))?.fitHints || [];
      items = poolWithFitHints(items, hints);
    }
    demo = items.length > 0 && items.every((item) => String(item.source_name || item.source || "").includes("seed"));
  } else {
    pool = await getDiscoverablePool({ fallback: false });
    demo = pool.length === 0;
    if (demo) pool = await getDiscoverablePool();
    items = pool.map((item) => ({ ...publicProduct(item), src: sourceFor(item), _createdAt: createdAtOf(item) }));
  }
  const sources = [...new Set(items.map((item) => item.src).filter(Boolean))].sort();
  // Asterisk interpretation pills (Day 12): ?tags=a|b|c ranks the rack by an
  // interpretation's tag signals — real products only, no costume replicas.
  // Ordering is affinity-aware (lib/discover/tagRank.js); inclusion still
  // requires an exact queried-tag hit.
  const interpTags = (searchParams.get("tags") || "")
    .split("|").filter(Boolean).map((t) => t.toUpperCase()).slice(0, 8);
  if (interpTags.length) {
    items = rankByInterpretationTags(items, interpTags);
  } else if (q && guidanceEnabled) {
    // Influenced-assumption clause (r10): a broad cultural query narrows to
    // the user's taste-favored reading — visible in `assumption`, overridden
    // by any explicit pill, killed by SEARCH_PASSPORT_ASSUMPTION=0.
    const userId = await resolveRequestUser(req, searchParams.get("user") || "");
    // Honor this user's prior rejections so a reading they dismissed in the
    // pills is not silently re-applied to search (audit #6). Best-effort:
    // a feedback read failure must not fail the search.
    const feedback = await listInterpretationFeedback(userId, normalizeQuery(q)).catch(() => []);
    const resolved = await resolveSearchAssumption(q, userId, feedback);
    const applied = applyPassportAssumption(items, resolved);
    items = applied.items;
    assumption = applied.assumption;
  }
  if (source) items = items.filter((it) => it.src === source);
  const brands = (searchParams.get("brands") || "").split("|").filter(Boolean)
    .slice(0, 20).map((brand) => brand.slice(0, 160).toLowerCase());
  if (brands.length) {
    const set = new Set(brands);
    items = items.filter((it) => set.has((it.brand || "").toLowerCase()));
  }
  if (tag) items = items.filter((it) => (it.tags || {})[tag]);
  if (category) items = items.filter((it) => it.category === category);
  if (sort === "new") items = sortNewestFirst(items);
  if (sort === "price-asc") items = items.slice().sort((a, b) => (a.price || 1e9) - (b.price || 1e9));
  if (sort === "price-desc") items = items.slice().sort((a, b) => (b.price || 0) - (a.price || 0));

  // STABLE PAGES (19 Sep 2026, docs/v2/CONTRACTS.md). The cursor is bound to
  // everything that decided this order and to a snapshot of the ordered ids.
  // A cursor whose list has changed answers 409 stale_cursor so the client
  // restarts from page one; the route never re-ranks midway and hands back
  // a page that skips or repeats. `offset` stays for older clients.
  const binding = bindingOf({
    q, source, brands: searchParams.get("brands") || "", tag, category, sort,
    tags: searchParams.get("tags") || "", pins: searchParams.get("pins") || "", guidanceEnabled, demo,
    subject: guidanceEnabled ? requestSubject(req) : null,
  });
  const snapshotId = snapshotOf(items.map((item) => item.id));
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
  const page = items.slice(offset, offset + limit);
  const nextCursor = offset + limit < items.length
    ? encodeCursor({ offset: offset + limit, snapshotId, binding }) : null;

  return NextResponse.json({
    ...envelope({ count: page.length, requestId }),
    total: items.length,
    totalIsExact: true,
    candidatesTruncated: !!(reading && reading.candidatesTruncated),
    offset,
    nextCursor,
    snapshotId,
    demo,
    sources,
    guidanceEnabled,
    assumption,
    ...(reading || {}),
    items: stripRecencyKey(page),
  });
}
