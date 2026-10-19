// lib/search/index.js
// ASILUM Search Engine v1 — real, database-backed, tag-expanded, ranked.
// SERVER-ONLY (imports lib/db). Rule/tag-based logic decides every rack. A
// model may be asked to PARSE a hard sentence into this engine's own closed
// constraint language (lib/ai/search-adapter.js) — off by default, opt-in per
// call, and no route passes it. It is never asked about a product.
//
// Flow: query → interpretSearchQuery (intent + mappings expansion) →
// candidate scoring over the product pool + product_tags layer →
// rankSearchResults (confidenceScore / matchReason / matchedTags) →
// logSearch. Personalization (Mood Board Brain) is a small additive term,
// only when the caller says the toggle is on.

import { getProfile, listItemBrands, searchItemCandidates } from "../db/index.js";
import { listSearchMappings, productsByTags, productsByTagsTyped, logSearch as dbLogSearch, listInterpretationFeedback } from "../db/production.js";
import { parseDenseConstraints, applyDenseConstraints, weighTypedTagScores } from "./denseQuery.js";
import { CATALOG } from "../ingest/catalog.js";
import { DEFAULT_MAPPINGS } from "./mappings-seed.js";
import { getDiscoverablePool, isDiscoverableProduct } from "../products.js";
import { deduceProduct, tasteVector } from "../brain/index.js";
import { embeddingsConfigured, embedText, cosine, TEXT_SPACE } from "../embeddings/index.js";
import { getEmbeddingSnapshot } from "../db/index.js";
import { orchestrateInterpretation, normalizeQuery } from "../asterisk/orchestrator.js";
import { lookupCulture } from "../asterisk/culture.js";
import { houseForShortForm } from "../asterisk/houses.js";
import { parseDesignerHousePair, resolveDesignerHousePair, applyDesignerHousePair, pairPredicate, pairNote } from "./pair.js";
import { parseTagQuery, itemHasTag, tagNote, tagsFor } from "../tagging/grammar.js";
import { scoreByInterpretationTags } from "../discover/tagRank.js";
import { buildStemIndex, lookupToken } from "./vocab.js";
// The token rules and the intent read moved to their own modules; both are
// re-exported below so every existing import from "lib/search/index.js"
// keeps working unchanged.
import { norm, tokens } from "./tokens.js";
import {
  getSearchIntent, resolveBrandSpelling, expandQueryToTags, brandMatch,
} from "./intent.js";
export {
  getSearchIntent, resolveBrandSpelling, expandQueryToTags,
} from "./intent.js";
// The word tables moved to ./vocabulary.js; re-exported below so every
// existing import from "lib/search/index.js" keeps working unchanged.
import {
  SEARCH_STOPWORDS, GARMENT_CATEGORY, GENERIC_GARMENT_NOUNS,
  garmentCategoryOf, genericNounCategoryOf,
} from "./vocabulary.js";
export {
  SEARCH_STOPWORDS, GARMENT_CATEGORY, GENERIC_GARMENT_NOUNS,
  garmentCategoryOf, genericNounCategoryOf,
} from "./vocabulary.js";
import { buildTypoVocab, correctTokens } from "./typo.js";
import { ONTOLOGY_GARMENT_NOUNS } from "./ontology.js";
import { extractEraAnchors, anchorHitCount } from "./eraAnchors.js";
import { parseEraConstraint, applyEraConstraint, eraMissNote, itemMatchesEra } from "./era.js";
import { parseOriginConstraint, applyOriginConstraint, originMissNote, itemMatchesOrigin } from "./origin.js";
import { foldNorm, skeleton } from "./text.js";
import { parseNegations, applyExclusions, exclusionNote, exclusionMatches } from "./negation.js";
import { parseSizeConstraint, applySizeConstraint, sizeMissNote, itemMatchesSize, SIZE_LETTERS } from "./size.js";
import { parsePriceSuperlative, applyPriceSort } from "./superlative.js";
import { interpretQueryWithModel, aiSearchEnabled } from "../ai/search-adapter.js";
import { ORIGIN_WORDS } from "./origin.js";
import { TAGS } from "../brain/tags.js";
import {
  listDesigners, parseDesignerCredit, applyDesignerCredit, creditFootprint, creditNote,
  itemCreditsDesigner,
} from "./designers.js";
import { distance } from "fastest-levenshtein";
import { buildTitleWordScope, categoriesCarrying, elsewhereClause } from "./wordScope.js";
import { isOrdinaryWord } from "./ordinary.js";
import { itemMatchesGender, itemGender } from "./gender.js";


async function activeMappings() {
  let rows = [];
  try { rows = await listSearchMappings(); } catch { rows = []; }
  if (!rows.length) return DEFAULT_MAPPINGS;
  // DB rows win on phrase collisions; defaults still backfill.
  const have = new Set(rows.map((r) => r.searchPhrase));
  return [...rows, ...DEFAULT_MAPPINGS.filter((d) => !have.has(d.searchPhrase))];
}

/** The searchable catalog: DISCOVERABLE products only — hidden, sold and
 *  unavailable rows never enter, so nothing can be found that cannot be shown. */
export async function getProductPool(limit = 5000) {
  return getDiscoverablePool({ limit });
}

// ---- interpretation -----------------------------------------------------------


/**
 * READ THE SENTENCE. The front half of search: everything that happens before
 * a single product is scored.
 *
 * Resolves intent, corrects typos, expands through mappings, and lifts the
 * CONSTRAINTS — era, origin, size, negation, designer credit — out of the
 * scoring stream so they can filter the pool instead of nudging a score. A
 * constraint that only nudges is a constraint a strong enough match can
 * ignore, and "nothing here is both" would stop being answerable.
 *
 * TYPO CORRECTION RUNS FIRST, before any table or tag lookup, so every
 * downstream tier sees the corrected token. Known tokens are never touched.
 * Corrections ride out on the result rather than being applied silently.
 *
 * Returns the interpretation that rankSearchResults consumes. Pure with
 * respect to the catalog — it reads the pool but changes nothing.
 */
export async function interpretSearchQuery(query, context = {}) {
  const pool = context.pool || (await getProductPool());
  const brands = context.brands || [...new Set(pool.map((it) => it.brand).filter(Boolean))];
  const mappings = context.mappings || (await activeMappings());
  const intent = getSearchIntent(query, brands, { brandSpelling: context.brandSpelling !== false });
  // Typo bridge (r12): correct unknown tokens BEFORE any table or tag lookup
  // so every downstream tier (category evidence, title match, tag layer,
  // mapping single-word hits) sees the corrected token. Known tokens are
  // never touched; corrections ride the result as typoCorrections.
  const rawTokens = tokens(query);
  const { tokens: fixedTokens, corrections: typoCorrections } = correctTokens(
    rawTokens,
    buildTypoVocab({
      garmentKeys: [...Object.keys(GARMENT_CATEGORY), ...Object.keys(GENERIC_GARMENT_NOUNS)],
      mappings,
    }),
    (t) => garmentCategoryOf(t) !== undefined || genericNounCategoryOf(t) !== undefined
  );
  const expansion = expandQueryToTags(query, mappings, fixedTokens);
  // designer-similar: the target designer's dominant brain tags become mapped tags.
  if (intent.intent === "designer-similar") {
    const w = {};
    for (const it of pool) {
      if (it.brand !== intent.brand) continue;
      for (const [t, v] of Object.entries(it.tags || {})) w[t] = (w[t] || 0) + v;
    }
    for (const [t] of Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      expansion.mappedTags.push(norm(t));
    }
  }
  return { query: norm(query), tokens: fixedTokens, typoCorrections, ...intent, ...expansion };
}

// ---- personalization ------------------------------------------------------------

// ONE TASTE, NOT TWO (19 Sep 2026). Search added long + session 1:1 and
// unclamped while the feed, the taste network and the Asterisk memory all
// read tasteVector's 60/40 blend clamped to ±1 — so a reason-specific
// correction written into one vector landed differently on the rack than in
// the feed, and a hot session could outweigh a year of taste here alone.
// Search now reads the same vector everything else reads. The tiebreak
// weight it carries (cosineish, bounded [0, 2]) is unchanged.
// SEARCH_TASTE_BLEND=0 restores the old 1:1 sum without a deploy.
export async function getPersonalizedSearchContext(userId) {
  if (!userId) return null;
  try {
    const profile = await getProfile(userId);
    const vec = process.env.SEARCH_TASTE_BLEND === "0" ? legacySum(profile) : tasteVector(profile);
    return Object.keys(vec).length ? { vec } : null;
  } catch {
    return null;
  }
}
function legacySum(profile) {
  const vec = { ...(profile.long || {}) };
  for (const [t, v] of Object.entries(profile.session || {})) vec[t] = (vec[t] || 0) + v;
  return vec;
}

function cosineish(vec, tags) {
  // Small bounded affinity term, not a true cosine — enough to nudge, not rule.
  let s = 0;
  for (const [t, v] of Object.entries(tags || {})) s += (vec[t] || 0) * v;
  return Math.max(0, Math.min(2, s));
}

// ---- ranking --------------------------------------------------------------------

// (audit #7) Tier-aware comparator for the semantic rerank/tiebreak pass.
// Compositional and cultural reads are a deliberately-higher tier than weak
// literal matches (composeRead prepends them; the cultural tier replaces the
// rack), but their _score lives on a different scale than literal _score. A
// bare _score sort interleaves the two scales and can hoist a conf-0.07
// "partial title match" above a composed read. Sorting by TIER first confines
// the sim tiebreak (and the rerank nudge) to WITHIN a tier — it can reorder a
// cluster but never move an item across the tier boundary. Exported so the
// invariant is testable without a keyed embeddings provider.
export function searchTierOf(item) {
  return (item?.matchReason === "compositional read" || item?.matchReason === "cultural read") ? 0 : 1;
}
/**
 * The result ordering: TIER FIRST, then score, then optional vector similarity.
 *
 * Tier 0 is a compositional or cultural read — the engine understood the
 * sentence — and it outranks every tier-1 keyword match regardless of score.
 * That is deliberate: a piece found because the query was UNDERSTOOD belongs
 * above one found because a word happened to appear, and letting score cross
 * the tier boundary would let a strong keyword hit bury a real reading.
 */
export function tierAwareComparator(simById, tiebreak) {
  const sim = (id) => (simById && simById.get(id)) || 0;
  return tiebreak
    ? (a, b) => (searchTierOf(a) - searchTierOf(b)) || (b._score - a._score) || (sim(b.id) - sim(a.id))
    : (a, b) => (searchTierOf(a) - searchTierOf(b)) || (b._score - a._score);
}


/**
 * SCORE THE SHELF. The back half of search: turn an interpretation plus a pool
 * into an ordered, explained result list.
 *
 * Every item carries a `matchReason` saying WHY it is here, which is what the
 * UI shows and what makes a bad ranking diagnosable instead of mysterious.
 *
 * `personal` is optional and applies taste as a tiebreak. Search is not the
 * feed: a query is a question, and personalization must not decide the answer
 * — only the order of equally good ones.
 */
export function rankSearchResults(products, interpreted, { tagLayerScores = {}, personal = null, garmentTitleEquiv = true, genderAsk = null } = {}) {
  const wantCategories = new Set(
    interpreted.tokens.map((t) => garmentCategoryOf(t)).filter(Boolean)
  );
  const q = interpreted.query;
  const qTokens = interpreted.tokens;
  const mappedUpper = interpreted.mappedTags.map((t) => t.toUpperCase());
  const scored = [];
  const tokenEvidence = new Set();
  // token → the houses whose NAME carried it (never a piece). Published so
  // the engine can disclose the reading rather than bury it as a match.
  const brandReads = new Map();
  // A WORD THE ENGINE OWNS IS NOT A NAME (20 Sep 2026, lib/search/ordinary.js):
  // when the whole query is one colour / material / gender / garment word, no
  // brand field can turn it into a house, exact or partial.
  const ordinaryQuery = isOrdinaryWord(q);
  for (const it of products) {
    if (it.moderation_status && it.moderation_status !== "visible") continue;
    const title = norm(it.title);
    const brand = norm(it.brand);
    // THE BRAND IS NOT THE PIECE (Aug 21). Every text term below used to run
    // against the whole title, brand half included, so a house name donated
    // "content" evidence it never had. MEASURED: "green jacket" served three
    // Craig Green down puffers claiming a TITLE MATCH for a word that appears
    // nowhere in "down puffer", and — because the token looked matched — the
    // honest `no piece here matches "green"` that "red jacket" gets was
    // deleted. Bare "green" reached confidence 1.00. Titles are "Brand —
    // piece"; when there is no dash, a leading brand is still stripped, and
    // what is left is the piece.
    const dash = title.indexOf("—");
    const piece = dash >= 0
      ? title.slice(dash + 1).trim()
      : (brand && title.startsWith(brand) ? title.slice(brand.length).trim() : title);
    const brandText = dash >= 0 ? title.slice(0, dash).trim() : brand;
    let score = 0;
    const reasons = [];
    const matchedTags = [];

    // 1) exact product name / token title matches — the strongest text signal
    // (this is why "bootcut" ranks bootcut jeans above expanded flares).
    // Plural-insensitive: "tees" still hits "tee".
    const equivHit = (t) => {
      if (!garmentTitleEquiv) return false;
      const c = genericNounCategoryOf(t);
      return !!c && it.category === c;
    };
    // Token matching is WORD-BOUNDARY, singular-or-plural. Bare substring let
    // "ross" claim a title match inside "crossbody", "tens"→"ten" inside
    // "Noten", "nas"→"na" inside "anorak" (Aug 5 vibe sweep) — junk evidence
    // that also blocked the cultural tier by making a rack look literally
    // grounded.
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hitIn = (hay, x) => !!hay && new RegExp("\\b" + esc(x) + "\\b").test(hay);
    const stripIn = (hay, t) => t.endsWith("s") && t.length >= 4 && hitIn(hay, t.slice(0, -1));
    // A STOPWORD IS NOT EVIDENCE (Aug 22). MEASURED across all 607 culture
    // entities: a leading "the" scored a 1-of-2 partial title match at 1.25 —
    // exactly 0.05 above the literalWeak threshold — and that alone killed
    // the curated reading for the beatles, the clash, the smiths, the cure,
    // the matrix, the sopranos and twenty-nine more. "The Row" donated the
    // hit from its brand half; "ghost in the shell" got one from a GORE-TEX
    // shell. Grammar words never earned an item anything and must not be able
    // to vouch for one.
    const contentful = (t) => !SEARCH_STOPWORDS.has(t);
    const pieceHit = (t) => contentful(t) && (hitIn(piece, t) || stripIn(piece, t));
    // A brand whose WHOLE name is an ordinary word ("Black", a marketplace
    // brand field) is not a house name, so no token reads as it — the same
    // law lib/search/ordinary.js applies to the bare query. "Craig Green"
    // is a house; "green" still reads as it, disclosed (tests/evidence-hygiene).
    // And a BARE ordinary query ("leather") reads no house at all — not even
    // a partial one inside "Wilson's Leather". Multi-token queries keep the
    // disclosed partial reading ("green jacket" → Craig Green, said out loud).
    const ordinaryBrand = isOrdinaryWord(brand);
    const brandHit = (t) => !ordinaryBrand && !ordinaryQuery && contentful(t) && (hitIn(brandText, t) || stripIn(brandText, t));
    // ONE PIECE OF EVIDENCE, ONE PAYMENT. When section 2 has already paid 8
    // for this being the asked-for house, the same house name must not also
    // buy a text credit: bare "green" scored 8 + 4 = 12 of a possible 12,
    // i.e. confidence 1.00, entirely from one surname. The word still counts
    // as EVIDENCE below (it is really there), just not twice as score.
    const brandCredited = interpreted.intent === "brand" && it.brand === interpreted.brand;
    const brandScores = (t) => !brandCredited && brandHit(t);
    const hitsTitle = (t) => pieceHit(t) || brandScores(t) || equivHit(t);
    const tokenHits = qTokens.filter(hitsTitle).length;
    // WHICH KIND of hit earned the score decides the LABEL. The arithmetic is
    // unchanged in every branch — this round moves no item, it only stops the
    // engine naming a text match the text does not contain.
    const nPiece = qTokens.filter(pieceHit).length;
    const nBrandOnly = qTokens.filter((t) => !pieceHit(t) && brandScores(t)).length;
    const labelFor = (literal) =>
      nPiece ? literal : nBrandOnly >= 1 ? "brand match" : "garment match";
    // Full-phrase match sits on word boundaries: "deco" must not claim a
    // product-name match inside "deconstructed" (Aug 5 vibe sweep).
    if (q && hitIn(piece, q)) { score += 6; reasons.push(["product name match", 6]); }
    // A phrase that is only PART of a house name is a partial reading, and
    // section 2 below already pays for it. MEASURED: bare "green" scored 8
    // (designer match) plus 6 (the word "Green" inside "Craig Green") = 14,
    // i.e. confidence 1.00 — the maximum the system can express — for a
    // one-word capture of somebody's surname. The full name still earns both.
    else if (q && !ordinaryQuery && brandText && (brandText === q || brand === q)) { score += 6; reasons.push(["brand match", 6]); }
    else if (qTokens.length && tokenHits === qTokens.length) { score += 4; reasons.push([labelFor("title match"), 4]); }
    else if (tokenHits > 0) { score += 2.5 * (tokenHits / qTokens.length); reasons.push([labelFor("partial title match"), 2.5 * (tokenHits / qTokens.length)]); }
    if (it._textRank > 0) {
      const textRank = Math.min(2, it._textRank * 4);
      score += textRank;
      reasons.push(["indexed text match", textRank]);
    }

    // 2) brand / designer — "like X" means X's aesthetic on OTHER racks
    if (interpreted.intent === "designer-similar" && it.brand === interpreted.brand) { score -= 2.5; }
    else if (interpreted.intent === "brand" && it.brand === interpreted.brand) { score += 8; reasons.push(["designer match", 8]); }
    else if (q && !ordinaryQuery && brand && (brand === q || (q.length >= 4 && brand.includes(q)))) { score += 5; reasons.push(["brand match", 5]); }

    // 3) moderated product_tags layer
    // 2b) designer credit — a stored attribution, weighted like the house it
    // is credited at, so a credited rack is grounded and the cultural tier
    // does not fire over it.
    if (interpreted.designerCredit && itemCreditsDesigner(it, interpreted.designerCredit)) {
      score += 8; reasons.push(["designer credit", 8]);
    }

    const layer = tagLayerScores[it.id] || 0;
    if (layer > 0) { score += Math.min(4, layer * 2); reasons.push(["tag match", Math.min(4, layer * 2)]); }

    // 4) brain aesthetic vector vs mapped tags
    for (const t of mappedUpper) {
      const v = (it.tags || {})[t];
      if (v) { score += v * 3; matchedTags.push(t.toLowerCase()); }
    }
    if (matchedTags.length) reasons.push(["aesthetic match", Math.round(matchedTags.length * 10) / 10]);

    // 5) related terms hitting the text (capped)
    let rel = 0;
    for (const term of interpreted.relatedTerms) {
      if (rel >= 3) break;
      if (title.includes(term) || brand.includes(term)) { rel++; matchedTags.push(term); }
    }
    if (rel) { score += rel; reasons.push(["related term", rel]); }

    // 5b) garment-category alignment — decisive for garment-noun queries
    if (wantCategories.size) {
      if (wantCategories.has(it.category)) { score += 2.5; reasons.push(["garment match", 2.5]); }
      else if (it.category) { score -= 2; }
    }

    // 6) era / decade references
    const decade = norm(it.decade || it.era?.decade);
    if (decade && (q.includes(decade) || interpreted.relatedTerms.some((t) => t.includes(decade)))) {
      score += 1.5; reasons.push(["era match", 1.5]);
    }

    // 7) availability — sold/removed sinks hard, never silently hidden
    if (it.is_available === false || ["sold", "removed"].includes(it.availability_status)) {
      score -= 5; reasons.push(["unavailable", -5]);
    }

    // 8) Mood Board Brain (only when the toggle is on) — a nudge, not a takeover
    if (personal) {
      const a = cosineish(personal.vec, it.tags);
      if (a > 0.05) { score += a; reasons.push(["moodboard brain", Math.round(a * 100) / 100]); }
    }

    // 9) no model term. A model-assisted read reaches this loop only as
    // constraints and aesthetic tags already scored above; it never adds a
    // number of its own, and rows it alone earned are labelled and capped
    // below.

    // CUT FOR WHO WAS ASKED (20 Sep 2026, lib/search/gender.js). When the
    // query names a gender, a piece the record or the seller's title says is
    // cut for it earns a little more than a piece that says nothing — so the
    // women's pieces lead a "womens" rack and the unknowns follow, instead of
    // the two interleaving in row order. A filter, not this, keeps the
    // other gender off the rack; this only orders what passed.
    if (genderAsk && score > 0 && itemGender(it) === genderAsk) {
      score += 2;
      reasons.push([`cut for ${genderAsk === "womens" ? "womenswear" : genderAsk === "mens" ? "menswear" : genderAsk}`, 2]);
    }
    if (score <= 0) continue;
    // Per-token evidence (Aug 5): which query words actually earned this item
    // anything. A generic-noun category equivalence (r6 equivHit) is category
    // evidence, NOT a title match — counting it as one is how "leather jacket"
    // reported a title match on 170 jackets with no leather anywhere.
    for (const t of qTokens) {
      if (pieceHit(t)) tokenEvidence.add(t);
      else if (equivHit(t) || garmentCategoryOf(t)) tokenEvidence.add(t);
      else if (brandHit(t)) {
        // Evidence, but of a DIFFERENT kind. The word is real and it is in a
        // house name — not in any piece. Counting it silently is what
        // deleted the disclosure for "green jacket"; the engine records the
        // reading instead and says it out loud.
        tokenEvidence.add(t);
        let houses = brandReads.get(t);
        if (!houses) brandReads.set(t, (houses = new Set()));
        if (it.brand) houses.add(it.brand);
      } else if (mappedUpper.includes(t.toUpperCase())) tokenEvidence.add(t);
      else if (interpreted.relatedTerms.some((r) => r.includes(t))) tokenEvidence.add(t);
    }
    // Query evidence (r10): did the QUERY earn this item anything, or is it
    // on the rack only because the personal nudge liked it? This has to be
    // its own flag — matchReason CANNOT answer it. An item admitted purely
    // by the nudge has no literal reason, so `categoryOnly` below labels it
    // "category browse", exactly like an item admitted by a real garment
    // match. One label, two opposite meanings. "unavailable" is a penalty,
    // not evidence.
    const queryEvidence = reasons.some(
      ([label]) => label !== "moodboard brain" && label !== "unavailable"
    );
    const top = reasons.sort((a, b) => b[1] - a[1])[0];
    // Honest label: an item admitted ONLY by its category is a category
    // browse, not a garment "match" — the word the user typed never touched it.
    const literalReasons = reasons.filter(([label]) =>
      label !== "garment match" && label !== "moodboard brain");
    // AN ASSISTED ROW SAYS SO. When the only thing that earned this item a
    // place is an aesthetic the MODEL proposed — no word of the query touched
    // its title, brand or credits — the row is labelled for what it is and
    // capped well below a literal match. The engine computes that confidence;
    // the model is never asked to score its own work.
    const assistOnly = !!interpreted.assistTags && !literalReasons.some(
      ([label]) => label !== "aesthetic match" && label !== "related term"
    ) && matchedTags.length > 0 &&
      matchedTags.every((t) => interpreted.assistTags.has(String(t).toUpperCase()));
    const categoryOnly = !literalReasons.length ||
      (literalReasons.length === 1 && literalReasons[0][0] === "partial title match" &&
       !qTokens.some((t) => title.includes(t)));
    const ASSIST_CONFIDENCE_CEILING = 0.4;
    scored.push({
      ...it,
      confidenceScore: assistOnly
        ? Math.round(Math.min(ASSIST_CONFIDENCE_CEILING, score / 12) * 100) / 100
        : Math.round(Math.min(1, score / 12) * 100) / 100,
      matchReason: assistOnly ? "assisted read"
        : categoryOnly ? "category browse" : (top ? top[0] : "match"),
      matchedTags: [...new Set(matchedTags)].slice(0, 8),
      _score: score,
      _queryEvidence: queryEvidence,
    });
  }
  // Deterministic order: equal scores previously fell to POOL order, which is
  // DB row order in production and catalog order locally — the same query
  // returned different orders on different backends. Ties break on id.
  scored.sort((a, b) => b._score - a._score || String(a.id).localeCompare(String(b.id)));
  scored.unmatchedTokens = qTokens.filter((t) => !tokenEvidence.has(t));
  scored.brandReads = [...brandReads.entries()].map(([token, houses]) => ({
    token, houses: [...houses].sort(),
  }));
  return scored;
}

// ---- the engine entry point -------------------------------------------------------

export async function searchProducts(query, {
  userId = null, brain = false, limit = 48, offset = 0,
  // (r5) bounded semantic re-ranking of literal results. Defaults on when a
  // provider is keyed; SEARCH_SEMANTIC_RERANK=0 kills it without a deploy.
  semanticRerank = process.env.SEARCH_SEMANTIC_RERANK !== "0",
  // (r6) generic garment nouns extend their title hit to the whole category;
  // SEARCH_GARMENT_TITLE_EQUIV=0 kills it without a deploy.
  garmentTitleEquiv = process.env.SEARCH_GARMENT_TITLE_EQUIV !== "0",
  // (r7) equal literal scores order by semantic sim instead of pool order;
  // SEARCH_SEMANTIC_TIEBREAK=0 kills it without a deploy.
  semanticTiebreak = process.env.SEARCH_SEMANTIC_TIEBREAK !== "0",
  // (Aug 21) era language reads the item's real production date instead of
  // being disclosed as an unmatched word. SEARCH_ERA_READING=0 kills it
  // without a deploy.
  eraReading = process.env.SEARCH_ERA_READING !== "0",
  // (Aug 21) a demonym reads as the house's base (lib/asterisk/houses.js).
  // SEARCH_ORIGIN_READING=0 kills it without a deploy.
  originReading = process.env.SEARCH_ORIGIN_READING !== "0",
  // (Aug 21) a house name typed de-spaced or one letter off resolves against
  // the real brand list. SEARCH_BRAND_SPELLING=0 kills it without a deploy.
  brandSpelling = process.env.SEARCH_BRAND_SPELLING !== "0",
  // (Aug 21) designers[] is read as a credit. SEARCH_DESIGNER_CREDIT=0 kills
  // it without a deploy.
  designerCredit = process.env.SEARCH_DESIGNER_CREDIT !== "0",
  // (Aug 21) "no logo hoodie" stops opening on a logo hoodie.
  // SEARCH_NEGATION=0 kills it without a deploy.
  negation = process.env.SEARCH_NEGATION !== "0",
  // (Aug 21) "medium jacket" reads size.fitsLikeUS, "size 32" reads the
  // label. SEARCH_SIZE_READING=0 kills it without a deploy.
  sizeReading = process.env.SEARCH_SIZE_READING !== "0",
  // (Aug 21) MODEL-ASSISTED PARSING. Explicit per-call opt-in AND the AI
  // feature switches; both, always. See lib/ai/search-adapter.js — the model
  // is a parser working inside closed vocabularies, never an oracle, and no
  // route passes this today.
  assist = false,
  // (Aug 22) "cheapest jacket" sorts by a stored number instead of reporting
  // the word as unmatched. SEARCH_PRICE_SORT=0 kills it without a deploy.
  priceSort = process.env.SEARCH_PRICE_SORT !== "0",
  // REPLAYING A QUERY IS NOT SOMEBODY SEARCHING. lib/waiting re-runs a
  // person's past empty searches to see whether the catalog can answer them
  // yet; logging those would write rows nobody typed, inflate demand counts,
  // and corrupt the exact signal that engine reads from — a feature that
  // poisons its own evidence. Callers that are not a person at a keyboard
  // pass log:false.
  log = true,
  // (17 Oct 2026, V.2 slice 4) PINNED TAGS. A long-press on a tag chip pins
  // it as a filter on the current search: `[{ left, right|null }]` from
  // lib/tagging/grammar.js parseTagQuery, applied to the pool as filters
  // after the pair / tag reading — a pin is a requirement, never a score.
  tagFilters = [],
} = {}) {
  const q = norm(query);
  if (!q) return { query: q, results: [], total: 0, interpreted: null };
  const mappings = await activeMappings();
  let brands = [];
  try { brands = await listItemBrands(); } catch { brands = []; }
  if (!brands.length) brands = [...new Set(CATALOG.map((item) => item.brand).filter(Boolean))];

  // First interpret without a catalog scan, retrieve indexed candidates, then
  // interpret once more so "similar to <designer>" can learn that designer's
  // dominant tags from the small candidate set.
  const initial = await interpretSearchQuery(q, { pool: [], brands, mappings, brandSpelling });
  // No silent caps: candidate retrieval reports when either channel hit its
  // bound, and the flag rides through the result and the search log.
  let candidatesTruncated = false;
  let pool = [];
  try {
    const retrieved = await searchItemCandidates(initial.brand || q, initial.mappedTags);
    // The indexed retrieval path has its own SQL predicate, but memory mode
    // returns raw rows and an older/inconsistent native row can still carry a
    // matching title after stock reaches zero. Re-apply the shared catalog
    // law here so search and Feed cannot disagree about what may be offered.
    pool = retrieved.rows.filter(isDiscoverableProduct);
    candidatesTruncated = retrieved.truncated;
  } catch { pool = []; }
  if (!pool.length) pool = await getProductPool();
  const interpreted = await interpretSearchQuery(q, { pool, brands, mappings, brandSpelling });
  // DESIGNER: HOUSE (19 Sep 2026, lib/search/pair.js). Parsed from the raw
  // query before anything generic reads it, resolved to canonical ids on
  // both sides, and served as the INTERSECTION — the pieces this catalog
  // credits to that person at that house. Matching Gucci alone is not proof
  // a garment was designed by Tom Ford; an empty intersection stays empty,
  // and the note carries the sourced tenure either way.
  const pairText = designerCredit ? parseDesignerHousePair(query) : null;
  let pairReading = null;
  const priorReading = { intent: interpreted.intent, brand: interpreted.brand, pool };
  if (pairText) {
    const all = await getProductPool();
    pairReading = resolveDesignerHousePair(pairText, { brands, pool: all });
    // A miss on either side is an EMPTY rack with the miss said, never one
    // half served as the whole: "nobody: gucci" asked for a person at Gucci,
    // and a Gucci rack would answer a different question in silence.
    pool = pairReading.designer && pairReading.house ? applyDesignerHousePair(all, pairReading) : [];
    interpreted.intent = "designer-house";
    interpreted.brand = null;
  }
  // TAGS ARE QUERIES (V.2 Blueprint, Tag grammar; slice 4). `SILVER:
  // JEWELRY` typed into Search returns exactly the pieces that carry that
  // tag, with the usual ranking on top; `SILVER:` alone returns everything
  // whose tag set has SILVER on a left side. The pair reader runs first and
  // keeps every query it resolves (HEDI SLIMANE: SAINT LAURENT is a tag AND
  // a pair, served as the sourced intersection); a pair miss falls through
  // to the tag reading, and the pair's miss is kept only when the tag
  // reading finds no left side either — "nobody: gucci" stays the designer
  // miss it was, "silver: jewelry" is read as the tag it is.
  //
  // A tag nobody carries — no piece with that left side at all — is not a
  // tag this catalog knows, and not a pair either when both sides missed:
  // the words are then read as words ("silver jewelry"), with the miss said
  // first so the rack that follows is never mistaken for the tag's.
  const tagText = parseTagQuery(query);
  let tagReading = null;
  let tagMiss = null;
  if (tagText && (!pairReading || pairReading.miss)) {
    const all = await getProductPool();
    const tagged = all.map((it) => [it, tagsFor(it)]);
    const matched = tagged.filter(([it, tags]) => itemHasTag(it, tagText, { tags })).map(([it]) => it);
    const leftCount = tagText.right ? tagged.filter(([it, tags]) => itemHasTag(it, { left: tagText.left, right: null }, { tags })).length : matched.length;
    if (matched.length || leftCount) {
      tagReading = { ...tagText, count: matched.length, leftCount };
      pairReading = null;
      pool = matched;
      interpreted.intent = "tag";
      interpreted.brand = null;
      interpreted.brandSpelling = null;
    } else if (!pairReading || pairReading.miss === "both") {
      tagMiss = tagText;
      pairReading = null;
      pool = priorReading.pool.length ? priorReading.pool : all;
      interpreted.intent = priorReading.intent;
      interpreted.brand = priorReading.brand;
    }
  }
  const tagApplied = !!tagReading;
  const pairApplied = !!pairReading;
  if (!pairApplied && !tagApplied && interpreted.mappedTags.some((tag) => !initial.mappedTags.includes(tag))) {
    try {
      const expanded = await searchItemCandidates(q, interpreted.mappedTags);
      const discoverable = expanded.rows.filter(isDiscoverableProduct);
      if (discoverable.length) {
        pool = discoverable;
        candidatesTruncated = expanded.truncated;
      }
    } catch {}
  }
  // Dense layer (Day 26): constraint tokens narrow the pool against real item
  // fields; remaining tokens hit the typed tag layer with per-type weights.
  // NEGATION FIRST (Aug 21). The excluded word must leave the stream before
  // anything else reads it — until now it went into scoring like any other
  // token and DROVE the rack, so "no logo hoodie" opened on a logo hoodie.
  // The readers the engine already owns, offered whatever follows a marker
  // before it is treated as a bare name. Each returns how many tokens it
  // consumed, the predicate that recognises a piece it describes, and the
  // phrase to say out loud.
  const prefixParse = (slice, max, run) => {
    for (let k = Math.min(max, slice.length); k >= 1; k--) {
      const hit = run(slice.slice(0, k));
      if (hit) return { ...hit, consumed: k };
    }
    return null;
  };
  const NEG_READERS = !negation ? [] : [
    { kind: "origin", parse: (slice) => prefixParse(slice, 1, (part) => {
        const { origin } = parseOriginConstraint(part);
        if (!origin) return null;
        return { constraint: origin, label: `${origin.label} houses`,
                 test: (it) => itemMatchesOrigin(it, origin) };
      }) },
    { kind: "era", parse: (slice) => prefixParse(slice, 4, (part) => {
        const { tokens: left, era } = parseEraConstraint(part);
        if (!era || left.length) return null;
        return { constraint: era, label: era.label,
                 test: (it) => itemMatchesEra(it, era) };
      }) },
    { kind: "size", parse: (slice) => prefixParse(slice, 2, (part) => {
        const { tokens: left, size } = parseSizeConstraint(part.join(" "), part);
        if (!size || left.length) return null;
        return { constraint: size, label: size.label_text,
                 test: (it) => itemMatchesSize(it, size) };
      }) },
    { kind: "gender", parse: (slice) => prefixParse(slice, 1, (part) => {
        const { tokens: left, constraints } = parseDenseConstraints(part);
        if (!constraints.gender || left.length) return null;
        const g = constraints.gender;
        const label = g === "womens" ? "womenswear" : g === "mens" ? "menswear" : "unisex";
        return { constraint: { gender: g }, label,
                 test: (it) => itemMatchesGender(it, g) };
      }) },
    { kind: "budget", parse: (slice) => prefixParse(slice, 4, (part) => {
        const { tokens: left, constraints } = parseDenseConstraints(part);
        const { minPrice, maxPrice } = constraints;
        if ((minPrice == null && maxPrice == null) || left.length) return null;
        const label = minPrice != null && maxPrice != null ? `$${minPrice}–$${maxPrice}`
          : maxPrice != null ? `under $${maxPrice}` : `over $${minPrice}`;
        return { constraint: constraints, label,
                 test: (it) => typeof it.price === "number" &&
                   (minPrice == null || it.price >= minPrice) &&
                   (maxPrice == null || it.price <= maxPrice) };
      }) },
  ];
  const negParse = negation
    ? parseNegations(interpreted.tokens, {
        phrases: [...brands, ...listDesigners(CATALOG)],
        readers: NEG_READERS,
      })
    : { tokens: interpreted.tokens, exclusions: [] };
  const exclusions = negParse.exclusions;
  // THE RAW-QUERY PARSERS MUST NOT SEE A NEGATED PHRASE. Size and the price
  // superlative read the ORIGINAL string, because the tokenizer drops
  // one-character tokens ("size m") — so "not medium" applied a US-M filter
  // and then excluded every piece it had just selected, serving ZERO under
  // `every piece here is fits like US M`. The negated spans come out of the
  // string those two parsers are given.
  const escRx = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let qForRaw = q;
  for (const x of exclusions) {
    qForRaw = qForRaw.replace(
      new RegExp(`\\b${escRx(x.marker)}\\s+(?:a\\s+|an\\s+|the\\s+)?${escRx(x.word)}\\b`, "g"), " ");
  }
  qForRaw = qForRaw.replace(/\s+/g, " ").trim();
  const dense = parseDenseConstraints(negParse.tokens);
  // The pair consumed the whole query: no word of it is a garment word.
  if (pairApplied || tagApplied) dense.tokens = [];
  pool = applyDenseConstraints(pool, dense.constraints);
  // A pinned tag narrows whatever the reading produced. Each pin is said.
  const pins = (Array.isArray(tagFilters) ? tagFilters : []).filter((f) => f && f.left).slice(0, 6);
  const pinned = [];
  for (const f of pins) {
    const before = pool.length;
    pool = pool.filter((it) => itemHasTag(it, f));
    pinned.push({ text: f.text || (f.right ? `${f.left}: ${f.right}` : `${f.left}:`), before, after: pool.length });
  }
  // Era comprehension (Aug 21): "90s jacket", "fall 2015", "vintage knit".
  // Every item carries era.year; the engine used to disclose the word as
  // unmatched and serve the whole category, so "vintage knit" opened on a
  // 2025 turtleneck. Era words are lifted OUT of the scoring stream (like
  // gender and budget) and applied against the real field — a filter, not a
  // bonus: a rank nudge would leave 2025 pieces in a rack asked to be
  // historical. lib/search/era.js carries the declared vocabulary decisions.
  const eraParse = eraReading
    ? parseEraConstraint(dense.tokens)
    : { tokens: dense.tokens, era: null };
  // An era NARROWS a rack; it never replaces one with nothing. When the
  // window is empty the constraint is dropped and the query is read without
  // it (era.js FALLBACK) — the words still leave the scoring stream, because
  // "1980s" is understood-but-unavailable, not unmatched text.
  let eraConstraint = eraParse.era;
  let eraMiss = null;
  if (eraConstraint) {
    dense.tokens = eraParse.tokens;
    const narrowed = applyEraConstraint(pool, eraConstraint);
    // `!pool.length` matters: if a budget or a gender already emptied the
    // pool, the era did not fail — blaming it would print the wrong sentence.
    if (narrowed.length || !pool.length) pool = narrowed;
    else { eraMiss = eraConstraint; eraConstraint = null; }
  }
  // Price superlatives (Aug 22): a sort over a stored number, applied to the
  // rack the engine already chose — never a widening, never across a tier.
  const superParse = priceSort
    ? parsePriceSuperlative(qForRaw, dense.tokens)
    : { tokens: dense.tokens, sort: null };
  const priceSortSpec = superParse.sort;
  if (priceSortSpec) dense.tokens = superParse.tokens;

  // Size (Aug 21): "medium jacket", "size 32", "jp 3 knit". A SIZE IS HARD,
  // like a budget — showing clothes that do not fit is as useless as showing
  // a $2,000 jacket to a $400 ceiling, so an empty result stays empty and
  // names what IS here. Parsed from the RAW query because the tokenizer drops
  // one-character tokens and "size m" arrives as ["size"].
  // (20 Sep 2026) When the query names footwear, "size N" is a shoe size.
  const sizeParse = sizeReading
    ? parseSizeConstraint(qForRaw, dense.tokens, { footwear: dense.tokens.some((t) => garmentCategoryOf(t) === "footwear") })
    : { tokens: dense.tokens, size: null };
  const sizeConstraint = sizeParse.size;
  let sizeScope = null;
  if (sizeConstraint) {
    sizeScope = pool;
    dense.tokens = sizeParse.tokens;
    pool = applySizeConstraint(pool, sizeConstraint);
  }

  // TWO HOUSES, NOT NEITHER (Aug 22). MEASURED: "prada or gucci" served 831
  // items topped by Chrome Hearts and said NOTHING — the whole query resolves
  // to no single brand, so both names fell through to text scoring and the
  // two racks the reader asked for were buried. A disjunction of names is a
  // list of names.
  let houseSet = null;
  if (interpreted.intent === "text" && dense.tokens.length >= 3) {
    const parts = [];
    let current = [];
    for (const t of dense.tokens) {
      if (t === "or" || t === "and") { parts.push(current); current = []; continue; }
      current.push(t);
    }
    parts.push(current);
    if (parts.length >= 2 && parts.every((p) => p.length)) {
      const houses = parts.map((p) => {
        const phrase = p.join(" ");
        return brandMatch(phrase, brands) || houseForShortForm(phrase, brands) ||
          (brandSpelling ? resolveBrandSpelling(phrase, brands)?.brand : null);
      });
      if (houses.length >= 2 && houses.every(Boolean)) {
        const want = new Set(houses.map((h) => norm(h)));
        const narrowed = pool.filter((it) => want.has(norm(it.brand)));
        if (narrowed.length) {
          pool = narrowed;
          houseSet = [...new Set(houses)];
          dense.tokens = [];
        }
      }
    }
  }

  // Designer credits (Aug 21): "jun takahashi", "kim jones", "demna jacket".
  // A BRAND OUTRANKS A CREDIT — when the query already resolved to a house,
  // that reading stands and this never runs. A stored attribution outranks an
  // interpretation, so this DOES run ahead of the cultural tier: fourteen
  // pieces actually credited to Rei Kawakubo beat 681 in an anti-fashion vibe.
  const designerNames = designerCredit && interpreted.intent === "text"
    ? listDesigners(pool, { excludeBrands: brands }) : [];
  const creditParse = designerNames.length
    ? parseDesignerCredit(dense.tokens, designerNames) : null;
  let designerCreditName = null;
  let designerCreditMiss = null;
  if (creditParse) {
    const narrowed = applyDesignerCredit(pool, creditParse.designer);
    if (narrowed.length) {
      dense.tokens = creditParse.tokens;
      pool = narrowed;
      designerCreditName = creditParse.designer;
    } else if (pool.length) {
      designerCreditMiss = creditParse.designer;
    }
  }

  // Origin comprehension (Aug 21): "japanese coat", "belgian tailoring".
  // Same contract as the era layer, for the same reason — where a house is
  // from is a checkable property, not a mood. A house this catalog knows
  // nothing about cannot pass: unknown is not a quiet yes.
  const originParse = originReading
    ? parseOriginConstraint(dense.tokens)
    : { tokens: dense.tokens, origin: null };
  let originConstraint = originParse.origin;
  let originMiss = null;
  if (originConstraint) {
    dense.tokens = originParse.tokens;
    const narrowed = applyOriginConstraint(pool, originConstraint);
    if (narrowed.length || !pool.length) pool = narrowed;
    else { originMiss = originConstraint; originConstraint = null; }
  }
  // (r6) generic garment nouns are category evidence — 5b already scores
  // that in full. Letting them ALSO hit the typed tag layer hands
  // jacket-tagged items up to +4 over parkas/shells that ARE jackets under
  // another name. Subtype nouns (jeans, parka, bomber…) stay: they
  // discriminate within a category.
  const tagQueryTokens = garmentTitleEquiv
    ? dense.tokens.filter((t) => !(genericNounCategoryOf(t)))
    : dense.tokens;
  let tagLayerScores = {};
  try {
    const typed = await productsByTagsTyped([...interpreted.mappedTags, ...tagQueryTokens, q]);
    tagLayerScores = weighTypedTagScores(typed);
  } catch { tagLayerScores = {}; }
  // An exclusion is HARD, like a budget — see negation.js. It applies after
  // the positive constraints so the count it reports is the count a reader
  // would recognise.
  let excludedCount = 0;
  let excludeScopeLabel = null;
  if (exclusions.length) {
    // COUNT WHAT THE READER WOULD HAVE SEEN. MEASURED: "jacket without
    // leather" reported `28 pieces removed` over a rack that did not change
    // by one item — the 28 leather pieces are shoes and bags, and none of
    // them was ever going to be in a jacket rack. When the query names
    // categories, the count is scoped to them and so is the verdict.
    const negCats = new Set(
      negParse.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean)
    );
    const inScope = (it) => !negCats.size || negCats.has(it.category);
    const before = pool.filter(inScope).length;
    pool = applyExclusions(pool, exclusions, { categoryOf: (w) => genericNounCategoryOf(w) });
    excludedCount = before - pool.filter(inScope).length;
    excludeScopeLabel = negCats.size ? [...negCats].join("/") : null;
  }

  // MODEL-ASSISTED PARSING (Aug 21). Runs only when the deterministic engine
  // found NOTHING to constrain on — no era, origin, size, credit, exclusion,
  // budget, gender, mapping hit or brand intent. That is the smallest useful
  // blast radius: on every query the engine already understands, the model is
  // never called and cannot change a thing.
  //
  // What comes back is drawn from closed vocabularies and validated against
  // them (lib/ai/validate.js), so an assisted rack can only ever be a rack the
  // deterministic engine could have produced — it is the SENTENCE the model
  // understands, not the catalog.
  const assistState = { used: false, applied: [], dropped: [], reading: null,
                        provider: null, model: null, promptVersion: null };
  const deterministicFound = !!(
    eraConstraint || eraMiss || originConstraint || originMiss || sizeConstraint ||
    designerCreditName || pairApplied || tagApplied || pinned.length || exclusions.length ||
    dense.constraints.gender || dense.constraints.climate ||
    dense.constraints.minPrice != null || dense.constraints.maxPrice != null ||
    (interpreted.mappingHits || []).length || interpreted.intent !== "text"
  );
  let assistTags = null;
  if (assist && aiSearchEnabled() && !deterministicFound && pool.length) {
    const out = await interpretQueryWithModel(q, {
      garments: new Set(Object.keys(GARMENT_CATEGORY)),
      aesthetics: new Set(TAGS.map((t) => t.toLowerCase())),
      origins: new Set(ORIGIN_WORDS),
      sizes: new Set(SIZE_LETTERS),
    }, { userId });
    if (out && out.ok && out.data) {
      const d = out.data;
      assistState.used = true;
      assistState.dropped = d.dropped || [];
      assistState.reading = d.reading || null;
      assistState.provider = out.provider;
      assistState.model = out.modelName;
      assistState.promptVersion = out.promptVersion;

      if (d.exclusions.length) {
        const before = pool.length;
        pool = applyExclusions(pool, d.exclusions.map((word) => ({ word })),
          { categoryOf: (w) => genericNounCategoryOf(w) });
        if (pool.length !== before) assistState.applied.push(`excluding ${d.exclusions.join(", ")}`);
      }
      if (d.era) {
        const narrowed = applyEraConstraint(pool, d.era);
        if (narrowed.length) { pool = narrowed; assistState.applied.push(`${d.era.minYear}–${d.era.maxYear}`); }
      }
      if (d.origins.length) {
        const origin = parseOriginConstraint(d.origins).origin;
        if (origin) {
          const narrowed = applyOriginConstraint(pool, origin);
          if (narrowed.length) { pool = narrowed; assistState.applied.push(`${origin.label} houses`); }
        }
      }
      if (d.size) {
        const narrowed = applySizeConstraint(pool, { kind: "fit", fits: d.size });
        if (narrowed.length) { pool = narrowed; assistState.applied.push(`fits like US ${d.size}`); }
      }
      if (d.minPrice != null || d.maxPrice != null) {
        const narrowed = applyDenseConstraints(pool, { minPrice: d.minPrice, maxPrice: d.maxPrice });
        if (narrowed.length) {
          pool = narrowed;
          assistState.applied.push(d.maxPrice != null && d.minPrice != null
            ? `$${d.minPrice}–$${d.maxPrice}`
            : d.maxPrice != null ? `under $${d.maxPrice}` : `over $${d.minPrice}`);
        }
      }
      if (d.garments.length) {
        // A garment noun rejoins the token stream exactly as if it had been
        // typed — the ranker's own category machinery does the rest.
        dense.tokens = [...new Set([...dense.tokens, ...d.garments])];
        assistState.applied.push(d.garments.join(", "));
      }
      if (d.aesthetics.length) {
        assistTags = new Set(d.aesthetics.map((t) => t.toUpperCase()));
        interpreted.mappedTags = [...new Set([...interpreted.mappedTags, ...d.aesthetics])];
        assistState.applied.push(d.aesthetics.join(", "));
      }
    }
  }

  // One index for both disclosure blocks below (0.27ms at catalog size —
  // wordScope.js records the measurement).
  let wordScope = null;
  const titleWordScope = async () => (wordScope ||= buildTitleWordScope(await getProductPool()));
  // The piece half of a title, the same split the ranker uses.
  const pieceOfTitle = (t) => {
    const full = norm(t);
    const d = full.indexOf("\u2014");
    return d >= 0 ? full.slice(d + 1).trim() : full;
  };
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inPieceOf = (it, t) => {
    const piece = pieceOfTitle(it.title);
    const w = (x) => new RegExp("\\b" + escRe(x) + "\\b").test(piece);
    return w(t) || (t.endsWith("s") && t.length >= 4 && w(t.slice(0, -1)));
  };

  const personal = brain ? await getPersonalizedSearchContext(userId) : null;
  // Gender/budget constraints have already narrowed the pool. Do not let
  // those control words dilute title/category relevance a second time.
  const rankedInterpreted = { ...interpreted, tokens: dense.tokens, designerCredit: designerCreditName, assistTags };
  let ranked = rankSearchResults(pool, rankedInterpreted, { tagLayerScores, personal, garmentTitleEquiv, genderAsk: dense.constraints.gender || null });
  const cultureHitEarly = process.env.SEARCH_CULTURE_FALLBACK !== "0" ? lookupCulture(q) : null;

  // Keep a handle on the literal rack: the fallback tiers below may replace
  // `ranked` wholesale, and the unmatched-term disclosure describes the
  // LITERAL pass (a cultural read has its own honest label).
  const literalRanked = ranked;

  // THE NOTE IS A LIST, NOT A SLOT (Aug 22). It used to be one string, filled
  // first-come, with six disclosure blocks gated on `!note` — so whichever
  // sentence fired earliest DELETED the rest. MEASURED over 64 composed
  // probes, 52 went silent: "leather sneakers" says `nothing here is both
  // "leather" and "sneakers"`, and "90s leather sneakers" says only `reading
  // "90s" as the 1990s` while serving four pieces of which NOT ONE is a
  // sneaker. Every single-constraint instrument passed because none of them
  // composes two constraints in one query.
  //
  // Clauses carry a RANK so the reader gets the decisive fact first: why the
  // rack is empty, then what the rack is, then what was read, then what was
  // disclosed about it. Duplicates collapse and the list is capped, because a
  // sentence nobody finishes reading is its own kind of silence.
  const clauses = [];
  const RANK = { empty: 5, what: 10, read: 20, disclose: 30 };
  const MAX_CLAUSES = 4;
  const say = (rank, text) => {
    const t = String(text ?? "").trim();
    if (!t || clauses.some((c) => c.text === t)) return;
    clauses.push({ rank, text: t });
  };
  const said = () => clauses.length > 0;

  // Compositional fallback (asterisk-boost r2): when the literal engine finds
  // nothing — or only trivially weak matches — read the query the way the
  // brain reads a moodboard caption (bigrams + tokens through KB/lexicon/
  // typo-bridge) and rank the pool by tag-space affinity. Garment-category
  // alignment stays decisive: "leather jacket…" composes over outerwear, not
  // rugby shirts. Deterministic, explainable, deliberately low confidence:
  // a read, not a match. Literal matches keep their place after the read.
  // WEAK IS NOT ONLY A LOW SCORE (Aug 22). The 1.2 threshold exists to stop a
  // compositional guess hijacking a genuine literal query, and it stays. But
  // it measures the wrong thing for a known reference: "blade runner" served
  // eleven suede RUNNERS at confidence 0.10, "jean paul gaultier" served
  // jeans, and each scraped over the line on one word out of two or three.
  // The better question — the one the descriptor-miss disclosure already asks
  // — is whether ANY served item carries evidence for EVERY content word. If
  // none does, the rack is a fragment match, and a curated reading of the
  // whole phrase outranks it.
  //
  // Only ever ADDS weakness, and only when a known entity is waiting: no
  // query that engaged the cultural tier before can stop engaging.
  const contentTokens = dense.tokens.filter((t) => !SEARCH_STOPWORDS.has(t));
  const groundedFully = () => {
    if (!contentTokens.length) return true;
    // A house the query named outright is grounding on its own — "snow" is
    // Snow Peak, "dries van noten" is the house, and neither is a fragment.
    if (interpreted.intent === "brand" || interpreted.intent === "designer-similar") return true;
    if (designerCreditName || pairApplied || tagApplied) return true;
    return ranked.some((it) => contentTokens.every((t) => {
      const generic = genericNounCategoryOf(t);
      if (generic && it.category === generic) return true;
      return inPieceOf(it, t);
    }));
  };
  const literalWeak = ranked.length > 0 &&
    (ranked[0]._score < 1.2 || (cultureHitEarly && !groundedFully()));
  // AN EXCLUDED NAME IS NOT A READING REQUEST. MEASURED: "not rick owens"
  // came back as a cultural read of Rick Owens — his aesthetic, minus his own
  // pieces — because every token had been consumed by the negation and the
  // interpretation tiers fell back to reading the raw query. When the whole
  // query is an exclusion, the surviving pool is the answer.
  const exclusionOnly = exclusions.length > 0 && !dense.tokens.length;
  // A LIST OF NAMES IS NOT A REFERENCE. "rick owens or raf" resolves to two
  // houses; letting the cultural tier read the raw phrase then printed
  // `nothing here is "rick owens or raf" — showing the closest reference
  // asterisk knows, rick owens` over a rack that was already exactly right.
  const namesOnly = (!!houseSet || pairApplied || tagApplied) && !dense.tokens.length;
  // Entity precedence (Aug 5 vibe sweep): when the query IS a known cultural
  // reference, the curated reading outranks the lexicon's guess. The
  // compositional tier used to run first, deduce junk tags from proper-noun
  // fragments ("miley cyrus" → minimal/tailored), and its non-empty rack then
  // BLOCKED the cultural tier — 33 of 607 known entities got racks in the
  // wrong vibe. A known entity now routes straight to the cultural read; the
  // compositional guess remains the fallback for queries Asterisk does not
  // know, and the last resort when an entity's tags find nothing.
  const cultureHit = cultureHitEarly;
  const composeRead = () => {
    if (!dense.tokens.length || !pool.length) return;

    const readVec = deduceProduct(dense.tokens);
    const readTags = Object.entries(readVec).filter(([, v]) => v > 0.05);
    if (readTags.length) {
      const wantCats = new Set(
        dense.tokens
          .map((t) => garmentCategoryOf(t))
          .filter(Boolean)
      );
      const composed = [];
      for (const it of pool) {
        if (wantCats.size && !wantCats.has(it.category)) continue;
        let s = 0;
        const matched = [];
        for (const [t, v] of readTags) {
          const iv = (it.tags || {})[t];
          if (iv) { s += iv * v; matched.push(t.toLowerCase()); }
        }
        if (s > 0.08) {
          composed.push({
            ...it,
            confidenceScore: Math.round(Math.min(0.35, s / 3) * 100) / 100,
            matchReason: "compositional read",
            matchedTags: matched.slice(0, 8),
            _score: s,
            // A composed item is ranked by the QUERY's own tag reading, so
            // it carries query evidence by construction.
            _queryEvidence: true,
          });
        }
      }
      if (composed.length) {
        composed.sort((a, b) => b._score - a._score);
        const seenIds = new Set(composed.map((c) => c.id));
        ranked = [...composed, ...ranked.filter((r) => !seenIds.has(r.id))];
      }
    }
    };
  if ((!ranked.length || literalWeak) && !cultureHit && !exclusionOnly && !namesOnly) composeRead();

  // Cultural fallback (r10): a query the literal engine AND the compositional
  // read both come up empty on may still be a reference Asterisk knows
  // ("marilyn manson", "oasis winter outfit"). Measured 8/4: bare-name
  // cultural queries returned an EMPTY rack for every known artist — the
  // culture catalog only reached results through a manually clicked
  // interpretation pill. This tier ranks the pool by the reading's tag slate
  // (tagRank: inclusion needs an exact tag hit, bleed only orders) — the
  // guided user's taste-favored reading when guidance is on (influenced
  // understanding), the top-confidence reading otherwise (broad
  // understanding). Labeled "cultural read", conf ≤ 0.45 — a read, not a
  // match. SEARCH_CULTURE_FALLBACK=0 kills it without a deploy.
  const cultural = { engaged: false, entity: null, interpretationId: null, label: null,
                     personalized: false, method: null };
  // Query-groundedness (r10, measured 8/4): with the Mood Board Brain on, the
  // personal nudge alone admits items (reason "moodboard brain"), so an
  // unmatched query returned the user's OWN taste echoed back with the query
  // text ignored. A rack whose every reason is personal carries zero query
  // evidence — the cultural read (itself taste-ordered for guided users)
  // must outrank query-independent noise.
  //
  // WHAT WAS WRONG (audit, Aug 9): this read
  //     ranked.some((r) => r.matchReason !== "moodboard brain")
  // and was inverted in BOTH directions, so the tier it guards never ran.
  // An item admitted ONLY by the nudge has no literal reason, so it is
  // labeled "category browse" — never "moodboard brain" — and counted as
  // GROUNDED. Meanwhile the only items that DO carry that label are ones
  // with a literal reason the nudge happened to outweigh, i.e. items that
  // genuinely have query evidence, counted as UNGROUNDED. Measured: a query
  // matching nothing, brain ON, returned 2 items both labeled "category
  // browse" (brain OFF: 0 items — proving zero query evidence), and the gate
  // read the rack as grounded. Ask the per-item flag instead of guessing
  // from a display label.
  const queryGrounded = ranked.some((r) => r._queryEvidence);
  if (!exclusionOnly && !namesOnly && (!ranked.length || !queryGrounded || (cultureHit && literalWeak)) && pool.length && process.env.SEARCH_CULTURE_FALLBACK !== "0") {
    try {
      // Honor prior rejections in this last-resort cultural read too (audit
      // #6). Bounded to this rare branch and to guided requests; best-effort.
      const cfFeedback = brain && userId
        ? await listInterpretationFeedback(userId, normalizeQuery(q)).catch(() => [])
        : [];
      const interp = await orchestrateInterpretation(q, brain ? userId : null, cfFeedback);
      const top = interp?.interpretations?.[0] || null;
      const readTags = top?.tags?.length
        ? top.tags.map((t) => t.toUpperCase())
        : Object.keys(interp?.attributes?.tags || {}).map((t) => t.toUpperCase());
      if ((interp?.entity || interp?.method === "composed") && readTags.length) {
        // Era anchors (Aug 5, owner report): the slate's four abstract tags
        // tie in wide clusters and the id tie-break then serves the wrong
        // silhouette ("playboi carti" → boxy tees under a correct "vamp
        // rockstar" note). The reading's OWN garment/material words
        // ("flared leather, studs, moto boots"), matched whole-word against
        // the piece part of titles, order the era's actual look upward.
        // Ordering only — inclusion stays the r10 exact-slate-hit contract.
        // The bonus needs a real slate presence (exact ≥ 0.3) so one weak
        // borrowed tag plus a lucky word cannot outrank slate-strong items.
        // SEARCH_ERA_ANCHORS=0 disables without a deploy.
        const anchors = process.env.SEARCH_ERA_ANCHORS !== "0"
          ? extractEraAnchors((top?.summary || "") + " " + (top?.label || ""))
          : [];
        const read = [];
        for (const it of pool) {
          const { exact, score } = scoreByInterpretationTags(it.tags, readTags);
          if (exact > 0) {
            const anchorHits = exact >= 0.3 ? Math.min(2, anchorHitCount(it.title, anchors)) : 0;
            read.push({
              ...it,
              confidenceScore: Math.round(Math.min(0.45, (score + 0.8 * anchorHits) / 4) * 100) / 100,
              matchReason: "cultural read",
              matchedTags: Object.keys(it.tags || {}).filter((t) => readTags.includes(t.toUpperCase())).map((t) => t.toLowerCase()).slice(0, 8),
              _score: score + 0.8 * anchorHits,
            });
          }
        }
        if (read.length) {
          // Deterministic tie-break (measured 8/4): cultural-read scores tie
          // in wide clusters and the pool arrives in DB row order — without a
          // stable key the rack reshuffles between requests.
          read.sort((a, b) => b._score - a._score || String(a.id).localeCompare(String(b.id)));
          ranked = read;
          cultural.engaged = true;
          cultural.entity = interp.entity?.name || null;
          cultural.interpretationId = top?.id || null;
          cultural.label = top?.label || (interp.method === "composed" ? "composed reading" : null);
          cultural.personalized = !!interp.personalized;
          cultural.method = interp.method || null;
          // A FUZZY RESCUE IS NOT AN EXACT READ (Aug 22). The orchestrator
          // already distinguishes them — exact | ambiguous | composed |
          // recovered — and the engine printed all of them in the same
          // confident words. MEASURED: "cowboy bebop" said `read as western`,
          // "goblin mode" said `read as gym goblin`, "mulholland drive"
          // landed on "drive" and "metal gear solid" on "metal". Each is a
          // nearest-neighbour rescue of a phrase this catalog does not know,
          // and saying so is the difference between an answer and a guess
          // wearing an answer's clothes.
          if (interp.entity) {
            // "western — western" reads as a stutter: the interpretation label
            // is sometimes just the entity's own name.
            const label = top?.label && norm(top.label) !== norm(interp.entity.name) ? top.label : null;
            const named = `${interp.entity.name}${label ? " — " + label : ""}`;
            say(RANK.what, interp.method === "recovered"
              ? `nothing here is "${q}" — showing the closest reference asterisk knows, ${named}`
              : `read as ${named}`);
          }
        }
      }
    } catch {}
  }
  // Last resort: a known entity whose curated tags matched nothing in this
  // catalog still deserves the lexicon's best effort over an empty rack.
  if (cultureHit && !cultural.engaged && !exclusionOnly && !namesOnly && (!ranked.length || literalWeak)) composeRead();

  // CONSTRAINT-ONLY QUERY. When every word was consumed as a constraint there
  // is nothing left to score, so the ranker returns an empty rack for a query
  // the engine understood completely — the constrained pool IS the answer.
  //
  // MEASURED: with origin reading on, a bare "japanese" went from 608 items
  // (a lexicon guess, honestly disclosed) to ZERO, while 96 pieces from
  // Japanese houses sat in the pool. The same hole is older than this round
  // and swallows "womens" and "under 400", which have both returned nothing
  // since the dense layer shipped. One rule fixes all of them.
  //
  // A known cultural entity still wins: "belgian" reads as the Antwerp Six,
  // now ranked inside Belgian houses, which is better than either half alone.
  const anyConstraint = !!(
    eraConstraint || originConstraint || designerCreditName || pairApplied || tagApplied || pinned.length || sizeConstraint || houseSet ||
    dense.constraints.gender || dense.constraints.climate ||
    dense.constraints.minPrice != null || dense.constraints.maxPrice != null ||
    // An exclusion is a constraint too: "not prada" and "anything but
    // sneakers" are entirely constraint, and the surviving pool IS the answer.
    exclusions.length > 0
  );
  if (!ranked.length && !dense.tokens.length && anyConstraint && pool.length && !cultural.engaged) {
    // Deterministic order: there is no query signal to rank by, and pool
    // order is DB row order in production and catalog order locally.
    // (20 Sep 2026) When the constraint is a gender, the pieces that SAY they
    // are cut for it lead the pieces that say nothing; id order inside each.
    const askedGender = dense.constraints.gender || null;
    const saysIt = (it) => (askedGender && itemGender(it) === askedGender ? 0 : 1);
    ranked = pool
      .filter((it) => !it.moderation_status || it.moderation_status === "visible")
      .slice()
      .sort((a, b) => saysIt(a) - saysIt(b) || String(a.id).localeCompare(String(b.id)))
      .map((it) => ({
        ...it,
        // The property is verified, and it is also the ONLY evidence there
        // is — no word of the query touched this piece's title, brand or
        // tags. Capped accordingly, and labelled for what it is.
        confidenceScore: 0.5,
        matchReason: "constraint match",
        matchedTags: [],
        _score: 1,
        _queryEvidence: true,
      }));
  }

  // Dense recall (embeddings v1, asterisk-boost r4) + bounded semantic
  // re-ranking (r5): when a provider is keyed AND the catalog has been
  // backfilled (scripts/embed-catalog.mjs), the query embeds once and its
  // similarity to every stored item vector serves two bounded jobs:
  //   (a) re-rank — ONLY for garment-noun queries with ≥2 modifier tokens
  //       ("jacket that survives a storm"). The garment noun is stripped
  //       from the embedded text — measured 8/3: the noun's lexical pull
  //       ranks varsity jackets above GORE-TEX shells, while the modifiers
  //       alone rank shells first; category alignment (5b) already enforces
  //       the noun literally. Ranked items gain min(2, max(0, sim − 0.3) ×
  //       10) on _score. Order-only: confidenceScore and matchReason stay
  //       what the literal engine said, and the cap can reorder a category
  //       cluster but never beat an exact name match. Every other query
  //       class re-ranks nothing and behaves exactly as r4.
  //   (b) append — neighbors the literal engine missed join below with
  //       matchReason "semantic match", sim floor 0.45, cap 12, conf ≤ 0.5.
  // Zero effect while unkeyed — the paths above are untouched.
  const semantic = { engaged: false, reranked: 0, appended: 0, strippedQuery: null };
  if (embeddingsConfigured()) {
    try {
      const isGarment = (t) => !!(garmentCategoryOf(t));
      const garmentToks = rankedInterpreted.tokens.filter(isGarment);
      const modifierToks = rankedInterpreted.tokens.filter((t) => !isGarment(t));
      if (semanticRerank && garmentToks.length && modifierToks.length >= 2) {
        let stripped = q;
        for (const t of garmentToks) stripped = stripped.replace(new RegExp(`\\b${t}\\b`, "g"), " ");
        stripped = stripped.replace(/\s+/g, " ").trim();
        if (stripped) semantic.strippedQuery = stripped;
      }
      // The snapshot first (cached per instance, ~0 ms warm), the provider
      // second and only when there is something to compare against: a query
      // embedding is a paid call, and with no live product vector it could
      // only ever be cosined against nothing. (optimize round, 20 Sep 2026 —
      // production had 0 live vectors and paid one call per keyed search.)
      const stored = await getEmbeddingSnapshot(TEXT_SPACE, "product");
      const qe = stored.length ? await embedText(semantic.strippedQuery || q, { feature: "search.embed", userId: userId || null }) : { ok: false };
      if (qe.ok && stored.length) {
        semantic.engaged = true;
        const simById = new Map();
        for (const row of stored) simById.set(row.owner_id, cosine(qe.data.vector, row.vector));

        if (semantic.strippedQuery) {
          for (const r of ranked) {
            const sim = simById.get(r.id) || 0;
            const nudge = Math.min(2, Math.max(0, sim - 0.3) * 10);
            if (nudge > 0) { r._score += nudge; semantic.reranked++; }
          }
        }
        // (r7) semantic tie-breaking: equal literal scores order by sim to
        // the query instead of arbitrary pool order ("slip dress" ties, the
        // r6-levelled category clusters).
        //
        // (audit #7) TIER GUARD. composeRead prepends compositional reads, and
        // the cultural tier replaces `ranked`, as a deliberately-higher tier
        // above weak literal matches — but their _score is on a different
        // scale than literal _score. A bare (b._score - a._score) sort
        // interleaves the two scales and can hoist a conf-0.07 "partial title
        // match" above a composed read (the old comment here claimed a sort by
        // _score "cannot move an item across score clusters" — provably false
        // across tiers). Sort by TIER first, so the tiebreak/rerank only
        // reorders WITHIN a tier, never across it.
        if (semantic.reranked || semanticTiebreak) {
          semantic.tiebreak = !!semanticTiebreak;
          ranked.sort(tierAwareComparator(simById, semanticTiebreak));
        }

        const have = new Set(ranked.map((r) => r.id));
        const byId = new Map(pool.map((it) => [it.id, it]));
        const hits = [];
        for (const [ownerId, sim] of simById) {
          if (sim <= 0.45 || have.has(ownerId)) continue;
          const it = byId.get(ownerId);
          if (it) hits.push({ it, sim });
        }
        hits.sort((a, b) => b.sim - a.sim);
        for (const { it, sim } of hits.slice(0, 12)) {
          semantic.appended++;
          ranked.push({
            ...it,
            confidenceScore: Math.round(Math.min(0.5, sim) * 100) / 100,
            matchReason: "semantic match",
            matchedTags: [],
            _score: sim,
          });
        }
      }
    } catch {}
  }

  if (priceSortSpec && ranked.length) ranked = applyPriceSort(ranked, priceSortSpec, searchTierOf);

  // BOTH GARMENTS, NOT JUST THE LOUDER ONE (Aug 22). "jacket and boots"
  // ranked 290 items — 170 outerwear and 120 footwear — and served a page
  // that was 24 of 24 outerwear, because outerwear scored uniformly higher.
  // The reader asked for two racks and saw one, with no note saying the other
  // existed. Both categories are pieces the query already earned; this
  // round-robins them within their tier so the page shows both.
  //
  // It presents, it does not pair: this catalog holds no compatibility data
  // of any kind, and nothing here may imply the jacket and the boots go
  // together. Ranking is otherwise untouched — the comparator has already
  // run, each category keeps its internal order, and a single-category query
  // is not reordered at all.
  const wantCats = [...new Set(dense.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean))];
  let interleaved = false;
  if (houseSet && ranked.length) {
    const lanes = houseSet.map((h) => ranked.filter((it) => norm(it.brand) === norm(h)));
    if (lanes.filter((l) => l.length).length >= 2) {
      const out = [];
      for (let i = 0; ; i++) {
        const row = lanes.map((l) => l[i]).filter(Boolean);
        if (!row.length) break;
        out.push(...row);
      }
      ranked = out;
      say(RANK.read, `showing ${houseSet.join(" and ")} side by side`);
    }
  }
  if (wantCats.length >= 2 && ranked.length) {
    const byTier = new Map();
    for (const it of ranked) {
      const tier = searchTierOf(it);
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(it);
    }
    const out = [];
    for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
      const lanes = wantCats.map((c) => byTier.get(tier).filter((it) => it.category === c));
      const rest = byTier.get(tier).filter((it) => !wantCats.includes(it.category));
      if (lanes.filter((l) => l.length).length < 2) { out.push(...byTier.get(tier)); continue; }
      interleaved = true;
      for (let i = 0; ; i++) {
        const row = lanes.map((l) => l[i]).filter(Boolean);
        if (!row.length) break;
        out.push(...row);
      }
      out.push(...rest);
    }
    if (interleaved) ranked = out;
  }

  // (r24) The served page, in order — not the full ranked list. Click-through
  // against exposure needs the denominator to be what was actually SHOWN;
  // logging all 900 ranked candidates as if they were seen would understate
  // every rate by the size of the tail. Computed here because the disclosure
  // layer below asks what the READER can see, not what the ranker holds.
  const servedPage = ranked.slice(offset, offset + limit);


  // Honest empty: a budget nothing in the wanted category can meet gets said
  // out loud instead of a bare zero — a ceiling, a floor, or a range.
  const { minPrice, maxPrice } = dense.constraints;
  // AN IMPOSSIBLE BAND IS NOT A BAND. MEASURED: "under $500 over $900" printed
  // `nothing between $900 and $500 — the closest is $895`, a sentence that
  // states a range backwards and then offers a piece inside the range it just
  // denied. Nothing can be both.
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    say(RANK.empty, `nothing can be both over $${minPrice} and under $${maxPrice}`);
  } else if (dense.constraints.reversedRange) {
    // The reader typed the endpoints the other way round and the engine
    // quietly swapped them. Say so rather than serve a band nobody asked for.
    say(RANK.read, `reading that as $${minPrice}–$${maxPrice}`);
  }
  if (!ranked.length && (minPrice != null || maxPrice != null) &&
      !(minPrice != null && maxPrice != null && minPrice > maxPrice)) {
    const all = await getProductPool();
    const cats = new Set(
      dense.tokens
        .map((t) => garmentCategoryOf(t))
        .filter(Boolean)
    );
    const scope = cats.size ? all.filter((it) => cats.has(it.category)) : all;
    const prices = scope.filter((it) => typeof it.price === "number").map((it) => it.price);
    if (prices.length) {
      const where = cats.size ? " in " + [...cats].join("/") : "";
      const money = (n) => `$${n}`;
      const lowest = Math.min(...prices);
      const highest = Math.max(...prices);
      if (minPrice != null && maxPrice != null) {
        // Nearest price to the window, so the sentence points somewhere real
        // instead of restating the range the reader just typed.
        const dist = (p) => (p < minPrice ? minPrice - p : p > maxPrice ? p - maxPrice : 0);
        let nearest = prices[0];
        for (const p of prices) if (dist(p) < dist(nearest)) nearest = p;
        if (dist(nearest) > 0) {
          say(RANK.empty, `nothing${where} between ${money(minPrice)} and ${money(maxPrice)} — the closest is ${money(nearest)}`);
        }
      } else if (maxPrice != null && lowest > maxPrice) {
        say(RANK.empty, `nothing${where} under ${money(maxPrice)} — the closest starts at ${money(lowest)}`);
      } else if (minPrice != null && highest < minPrice) {
        say(RANK.empty, `nothing${where} over ${money(minPrice)} — the most expensive here is ${money(highest)}`);
      }
    }
  }

  // An era this catalog cannot serve is said out loud with the nearest year it
  // does hold — never a silent slab of the whole category, and never a bare
  // zero. A cultural read speaks for itself, so it keeps its own note.
  if (originMiss && !cultural.engaged) {
    const all = await getProductPool();
    const cats = new Set(
      dense.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean)
    );
    say(ranked.length ? RANK.read : RANK.empty,
      originMissNote(originMiss, all, cats.size ? [...cats].join("/") : null, { fellBack: ranked.length > 0 }));
  }

  if (eraMiss && !cultural.engaged) {
    const cats = new Set(
      dense.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean)
    );
    const scope = cats.size ? pool.filter((it) => cats.has(it.category)) : pool;
    say(ranked.length ? RANK.read : RANK.empty,
      eraMissNote(eraMiss, scope, cats.size ? [...cats].join("/") : null, { fellBack: ranked.length > 0 }));
  }

  for (const c of interpreted.typoCorrections || []) {
    say(RANK.read, `reading "${c.from}" as "${c.to}"`);
  }
  // Visible influence, never silent (the honesty contract): when an era
  // constraint actually narrowed the rack, say which words did it and what
  // they were read as.
  if (eraConstraint || originConstraint) {
    // Both halves when both fired: a rack narrowed twice should say so twice,
    // or the reader cannot tell which word did what.
    const reads = [];
    if (eraConstraint) reads.push(`"${eraConstraint.words.join(" ")}" as ${eraConstraint.label}`);
    if (originConstraint) reads.push(`"${originConstraint.words.join(" ")}" as the house's base`);
    const read = `reading ${reads.join(" and ")}`;
    // A constraint that WAS served but left an empty rack means the rest of
    // the query found nothing inside it — say which half worked.
    say(RANK.read, ranked.length ? read : `${read} — nothing there matched the rest of the query`);
  }

  // Honest unmatched terms (Aug 5): the engine used to drop a word it could
  // not match and return the whole garment category as if it had understood —
  // "wool sweater" and "knitted scarf" returned the identical knitwear rack,
  // every row labelled "garment match". Nothing in this catalog carries
  // material or colour data, so those words genuinely match nothing; say so
  // rather than implying a match. Ranking is untouched — this is disclosure.
  const mappingWords = new Set();
  for (const hit of interpreted.mappingHits || []) {
    for (const w of String(hit).split(/[^a-z0-9]+/)) if (w.length > 1) mappingWords.add(w);
  }
  const SIMILAR_SYNTAX = new Set(["like", "similar", "to"]);
  // Words the brand-spelling resolver consumed are not unmatched — saying
  // `reading "rickowens" as Rick Owens; no piece here matches "rickowens"`
  // in one breath is a sentence that argues with itself.
  const spelledTokens = new Set(tokens(interpreted.brandSpelling?.typed || ""));
  const unmatched = (literalRanked?.unmatchedTokens || []).filter(
    (t) => !garmentCategoryOf(t) && !genericNounCategoryOf(t) &&
      !mappingWords.has(t) && !spelledTokens.has(t) && !SEARCH_STOPWORDS.has(t) &&
      !(interpreted.intent === "designer-similar" && SIMILAR_SYNTAX.has(t))
  );
  // Subtype garment nouns are category evidence, so they never land in
  // unmatchedTokens — but a subtype with ZERO title hits ("trench coat" in a
  // catalog with no trench) was still serving a silent category slab. Say it.
  const subtypeMisses = [];
  if (ranked.length && !cultural.engaged) {
    for (const t of dense.tokens) {
      const cat = garmentCategoryOf(t);
      if (!cat || genericNounCategoryOf(t)) continue;
      const stem = t.endsWith("s") && t.length >= 4 ? t.slice(0, -1) : null;
      const hit = ranked.some((it) => {
        const ttl = norm(it.title);
        return ttl.includes(t) || (stem && new RegExp("\\b" + stem + "\\b").test(ttl));
      });
      if (!hit) subtypeMisses.push({ token: t, cat });
    }
  }
  for (const m of subtypeMisses) {
    say(RANK.disclose, `no "${m.token}" pieces here — showing ${m.cat}`);
  }
  if (unmatched.length && ranked.length && !cultural.engaged) {
    // A grammar word is never a word the rack is "showing instead" (20 Sep
    // 2026): live, "dolce and gabana" said `showing dolce and instead` and
    // "love and basket" said `showing and instead`. Grammar earns nothing
    // (contentful, above) and cannot be what is shown.
    const matchedWords = dense.tokens.filter((t) => !unmatched.includes(t) && !SEARCH_STOPWORDS.has(t));
    // Name the CATEGORY actually being shown, not the word typed: this
    // catalog has no skirts, so "showing skirt instead" would be its own
    // small lie. Fall back to the word only when it names no category.
    const shownCats = [...new Set(matchedWords
      .map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t))
      .filter(Boolean))];
    // A word the RACK lacks is not the same fact as a word the CATALOG lacks.
    // "leather coat" used to say `no piece here matches "leather"` while 28
    // pieces carried it — sixteen shoes and twelve bags (wordScope.js). Split
    // the two, and point the reader at where the word actually lives.
    const scope = await titleWordScope();
    const elsewhere = unmatched.filter((t) => categoriesCarrying(t, scope, shownCats).length);
    const nowhere = unmatched.filter((t) => !elsewhere.includes(t));
    const clausesOut = [];
    if (nowhere.length) {
      const sentence = `no piece here matches "${nowhere.join('", "')}"`;
      clausesOut.push(shownCats.length
        ? `${sentence} — showing ${shownCats.join(" / ")} instead`
        : matchedWords.length ? `${sentence} — showing ${matchedWords.join(" ")} instead` : sentence);
    }
    if (elsewhere.length) {
      const where = shownCats.length ? ` in ${shownCats.join(" / ")}` : "";
      clausesOut.push(`no "${elsewhere.join('", "')}"${where} — ` +
        elsewhereClause(elsewhere, scope, shownCats));
    }
    for (const c of clausesOut) say(RANK.disclose, c);
  }

  // A WORD READ AS A HOUSE NAME (Aug 21). "green jacket" serves Craig Green
  // down puffers; that is a real reading of real data and the rack should
  // stay — but until now the token counted as ordinary evidence, which
  // deleted the `no piece here matches "green"` sentence that "red jacket"
  // still gets. Say which word was read as whose name, in the same voice the
  // era and origin readings use. A query that names a house outright needs no
  // sentence; stopwords are never reported as a designer (their junk-evidence
  // problem belongs to the cultural-tier round, not to this one).
  if (!cultural.engaged) {
    const STOP = new Set(["the", "and", "of", "for", "with", "in", "on", "to", "a", "an"]);
    const byHouse = new Map();
    for (const { token, houses } of literalRanked?.brandReads || []) {
      if (STOP.has(token)) continue;
      for (const h of houses) {
        let toks = byHouse.get(h);
        if (!toks) byHouse.set(h, (toks = new Set()));
        toks.add(token);
      }
    }
    const houseClauses = [];
    for (const [house, toks] of byHouse) {
      const ordered = dense.tokens.filter((t) => toks.has(t));
      if (!ordered.length) continue;
      if (ordered.join(" ") === norm(house)) continue;
      // Already named by the spelling resolution — one sentence per fact.
      if (interpreted.brandSpelling?.resolved === house) continue;
      houseClauses.push(`reading "${ordered.join(" ")}" as the designer ${house}`);
    }
    if (houseClauses.length) {
      say(RANK.read, houseClauses.slice(0, 2).join("; ") +
        (houseClauses.length > 2 ? `; and ${houseClauses.length - 2} more house names` : ""));
    }
  }

  // DESCRIPTOR MISS (Aug 21). The Aug 5 lesson — "wool sweater" and "knitted
  // scarf" returning the identical rack — was fixed in the DISCLOSURE and
  // came back through the RANKING. Measured on the shipped catalog:
  //   "leather sneakers"  8 chunky trail sneakers with no leather, then a
  //                       leather DERBY at position 9. No note.
  //   "nylon trousers"    8 pleated and wide-leg trousers, no nylon. No note.
  //   "wool suit"         boxy suit jackets over a pleated wool trouser.
  // Each word had evidence somewhere, so the unmatched-token disclosure never
  // fired — and there is no leather sneaker, no nylon trouser and no wool
  // suit in this catalog. Nothing said so.
  //
  // The claim made here is the narrow true one: no piece on this page is
  // BOTH. A subtype noun ("sneakers", "trousers", "suit") needs a real title
  // hit, exactly as it does in ranking — a derby is not a sneaker just for
  // sharing a category. A generic noun ("knit", "jacket", "dress") is
  // satisfied by its category, the r6 equivalence. Ranking is untouched;
  // this is disclosure, and its unit is the SERVED PAGE (r24) — a match at
  // position 90 was not shown.
  if (servedPage.length && !cultural.engaged) {
    const scope = await titleWordScope();
    const content = dense.tokens.filter((t) => !mappingWords.has(t));
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inPiece = (it, t) => {
      const piece = norm(it.title).replace(/^[^—]+—\s*/, "");
      const w = (x) => new RegExp("\\b" + esc(x) + "\\b").test(piece);
      return w(t) || (t.endsWith("s") && t.length >= 4 && w(t.slice(0, -1)));
    };
    const satisfies = (it, t) => {
      const generic = genericNounCategoryOf(t);
      if (generic) return it.category === generic || inPiece(it, t);
      return inPiece(it, t);
    };
    const descriptors = content.filter((t) =>
      !garmentCategoryOf(t) && !genericNounCategoryOf(t) && categoriesCarrying(t, scope).length > 0);
    const nouns = content.filter((t) => garmentCategoryOf(t) || genericNounCategoryOf(t));
    if (descriptors.length && content.length >= 2 &&
        !servedPage.some((it) => content.every((t) => satisfies(it, t)))) {
      const what = descriptors.map((t) => `"${t}"`).join(" and ");
      say(RANK.disclose, nouns.length
        ? `nothing here is both ${what} and "${nouns.join(" ")}"`
        : `nothing on this page is ${what}`);
    }
  }

    // VISIBLE INFLUENCE, NEVER SILENT. A rack a model helped shape says so,
  // names every constraint that actually applied, and quotes the model's own
  // one-line reading — attributed, so nobody mistakes it for the engine's.
  if (assistState.used) {
    const bits = [];
    if (assistState.applied.length) bits.push(`applied ${assistState.applied.join("; ")}`);
    if (assistState.reading) bits.push(`the model read this as "${assistState.reading}"`);
    say(RANK.what, bits.length
      ? `model-assisted reading — ${bits.join(" · ")}`
      : "model-assisted reading — nothing it returned could be applied");
  }

  // Interleaving is named too — the page is not in relevance order any more.
  if (interleaved) {
    say(RANK.read, `showing ${wantCats.join(" and ")} side by side — asterisk holds no data on what goes with what`);
  }

  // A sort is named, so the first row is not mistaken for the most relevant.
  if (priceSortSpec && ranked.length) say(RANK.read, `sorted by ${priceSortSpec.label}`);

  // A size that this catalog cannot meet is said out loud with what it does
  // hold — never a silent slab of the whole category.
  if (sizeConstraint) {
    // A MISS NOTE IS ABOUT THE THING THAT MISSED. MEASURED: "90s japanese
    // jacket in medium" said `nothing in outerwear fits like US M — what is
    // here runs M to XL` — a sentence that denies M and then names M as the
    // bottom of what is here, while the real reason the rack is empty is that
    // this catalog holds no Japanese outerwear from the 1990s at all. The size
    // only gets to explain an empty rack when the size is what emptied it.
    // Scoped to the categories the query named, because that is the set the
    // sentence talks about — "nothing in knitwear fits like US XXXL" is a
    // claim about knitwear, and the one XXXL piece in the catalog is a coat.
    const sizeCats = new Set(
      dense.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean)
    );
    const sizeBase = sizeCats.size
      ? (sizeScope || []).filter((it) => sizeCats.has(it.category))
      : (sizeScope || []);
    const sizeEmptied = sizeBase.length > 0 && applySizeConstraint(sizeBase, sizeConstraint).length === 0;
    if (!ranked.length && sizeEmptied) {
      const cats = new Set(
        dense.tokens.map((t) => garmentCategoryOf(t) || genericNounCategoryOf(t)).filter(Boolean)
      );
      const scope = cats.size ? (sizeScope || []).filter((it) => cats.has(it.category)) : (sizeScope || []);
      say(RANK.empty, sizeMissNote(sizeConstraint, scope, cats.size ? [...cats].join("/") : null));
    } else if (ranked.length) {
      say(RANK.read, `reading "${sizeConstraint.phrase}" as ${sizeConstraint.label_text} — ${ranked.length} piece${ranked.length === 1 ? "" : "s"}`);
    }
  }

  // An exclusion always says what it removed, and on what basis — "by name",
  // because this catalog records no materials and cannot check a fabric.
  if (exclusions.length) {
    say(RANK.read, exclusionNote(exclusions, excludedCount, pool.length, { scopeLabel: excludeScopeLabel }));
  }

  // A DESIGNER: HOUSE pair is said with its sourced tenure and the count of
  // pieces credited inside the intersection; a miss on either side is said as
  // a miss. It ranks EMPTY when the rack is empty so the generic empty-rack
  // sentence does not try to explain the pair as a list of words.
  if (pairReading) {
    say(ranked.length ? RANK.read : RANK.empty, pairNote(pairReading, ranked.length));
  }
  // A tag query is said with its count, or as the honest miss — and when
  // the right side missed, how many pieces carry the left side alone.
  if (tagReading) {
    say(ranked.length ? RANK.read : RANK.empty, tagNote(tagReading, ranked.length, tagReading.leftCount));
  } else if (tagMiss) {
    say(RANK.read, `${tagNote(tagMiss, 0)} — reading the words instead`);
  }
  for (const pin of pinned) {
    say(pin.after ? RANK.read : RANK.empty, pin.after
      ? `pinned ${pin.text} — ${pin.after} of ${pin.before} piece${pin.before === 1 ? "" : "s"} carry it`
      : `pinned ${pin.text} — nothing here carries it`);
  }
  // A designer credit is said out loud, with the count and the houses — and
  // never in words that imply the piece was made during that person's tenure,
  // because the catalog stores no tenure dates.
  if (designerCreditName) {
    say(RANK.read, creditNote(designerCreditName, creditFootprint(ranked, designerCreditName)));
  } else if (designerCreditMiss) {
    say(RANK.empty, `nothing here credits ${designerCreditMiss}`);
  }

  // A resolved spelling is always said out loud — the reader typed one thing
  // and got another house's rack, and that is only honest if named.
  if (interpreted.brandSpelling && ranked.length) {
    say(RANK.read, `reading "${interpreted.brandSpelling.typed}" as ${interpreted.brandSpelling.resolved}`);
  }

  // "LIKE <DESIGNER>" DELIBERATELY SERVES OTHER HOUSES — the target brand is
  // penalised 2.5 so the rack is the aesthetic, not the label. That is a
  // strong reading and it was the one reading the engine never said out loud:
  // the words "rick owens" appear nowhere in a rack of Needles and Junya
  // Watanabe pieces, and nothing told the reader why.
  if (interpreted.intent === "designer-similar" && interpreted.brand && ranked.length) {
    const who = /s$/i.test(interpreted.brand) ? `${interpreted.brand}'` : `${interpreted.brand}'s`;
    say(RANK.read, `reading "${q}" as other houses in ${who} vein`);
  }

  // A GENERIC NOUN IS A CATEGORY, and the rack should say so when no piece is
  // actually titled with the word. "shoes" serves 120 footwear items whose
  // titles say sneaker, derby, mule, hiker — the reading is right and the
  // word is nowhere, which is exactly the shape "category browse" names.
  if (servedPage.length && !cultural.engaged) {
    const reads = [];
    for (const t of dense.tokens) {
      const cat = genericNounCategoryOf(t);
      if (!cat) continue;
      // The FIRST row is the test, not the page as a whole (r24: what the
      // reader actually sees). "jacket" opens on a varsity jacket and needs
      // no sentence; "shoes" opens on a chunky trail sneaker and does.
      if (inPieceOf(servedPage[0], t)) continue;
      reads.push(`reading "${t}" as the ${cat} category`);
    }
    for (const r of reads) say(RANK.disclose, r);
  }

  // NO BLANK PAGES (Aug 21). Every other disclosure in this file describes a
  // rack that EXISTS. When there is no rack at all the reader got a blank
  // page and, until now, usually nothing else: measured over a 29-query
  // probe set, 14 of the 16 empty results carried no note whatsoever —
  // "womens under 200", "mens knitwear", "telfar", "gym", "petite", "gift
  // for my brother". The largest single failure cluster in the engine, and
  // the one place where saying nothing is indistinguishable from being
  // broken.
  //
  // Two honest sentences. When constraints applied, name them AND count each
  // one alone, so the reader can see which half is the binding one. When
  // nothing applied, say which words matched nothing.
  if (!said() && !ranked.length) {
    // Grammar, and the keywords that introduce a constraint rather than
    // describe a piece — "size 44" already said what it needed to.
    // Grammar only. A keyword like "size" that the parser did NOT consume is
    // reportable — hiding it left "size M/L/XL" saying `nothing here is a US
    // XL fit — 112 pieces are a US XL fit`, a sentence that contradicts
    // itself because the word that actually emptied the rack was suppressed.
    const NOISE = new Set(["for", "my", "the", "a", "an", "of", "with", "in", "on", "to", "and", "or",
                           "me", "you", "your", "show", "find", "want", "need"]);
    const applied = [];
    const g = dense.constraints.gender;
    if (g) applied.push({
      label: g === "womens" ? "womenswear" : g === "mens" ? "menswear" : "unisex",
      test: (it) => itemMatchesGender(it, g),
    });
    if (dense.constraints.maxPrice != null) applied.push({
      label: `under $${dense.constraints.maxPrice}`,
      test: (it) => typeof it.price === "number" && it.price <= dense.constraints.maxPrice,
    });
    if (dense.constraints.minPrice != null) applied.push({
      label: `over $${dense.constraints.minPrice}`,
      test: (it) => typeof it.price === "number" && it.price >= dense.constraints.minPrice,
    });
    if (eraConstraint) applied.push({
      label: `from ${eraConstraint.label}`, test: (it) => itemMatchesEra(it, eraConstraint),
    });
    if (originConstraint) applied.push({
      label: `${originConstraint.label}`, test: (it) => itemMatchesOrigin(it, originConstraint),
    });
    if (sizeConstraint) applied.push({
      // A NOUN PHRASE, not a verb phrase: this sentence reads "nothing here
      // is X and Y", and "nothing here is fits like US XL" is not English.
      label: sizeConstraint.kind === "fit" ? `a US ${sizeConstraint.fits} fit`
        : sizeConstraint.kind === "waist" ? `a ${sizeConstraint.waist} waist`
        : `size ${sizeConstraint.label}`,
      test: (it) => itemMatchesSize(it, sizeConstraint),
    });
    if (designerCreditName) applied.push({
      label: `credited to ${designerCreditName}`,
      test: (it) => itemCreditsDesigner(it, designerCreditName),
    });
    const words = (literalRanked?.unmatchedTokens || [])
      .filter((t) => !NOISE.has(t) && !garmentCategoryOf(t) && !genericNounCategoryOf(t) && !spelledTokens.has(t));
    if (applied.length) {
      const all = await getProductPool();
      const counted = applied.map((c) => ({ ...c, n: all.filter(c.test).length }));
      const asked = counted.map((c) => c.label).join(" and ");
      const each = counted.map((c) => `${c.n} ${c.n === 1 ? "piece is" : "pieces are"} ${c.label}`).join(", ");
      say(RANK.empty, `nothing here is ${asked} — ${each}` +
        (words.length ? `; and no piece matches "${words.join('", "')}"` : ""));
    } else if (words.length) {
      say(RANK.empty, `no piece here matches "${words.join('", "')}"`);
    } else if (q) {
      say(RANK.empty, `nothing here matches "${q}"`);
    }
  }

  // The reader gets the decisive fact first, then at most three more.
  const note = clauses.length
    ? clauses.slice().sort((a, b) => a.rank - b.rank).slice(0, MAX_CLAUSES).map((c) => c.text).join("; ")
    : null;

  // A word the brand-spelling resolver consumed was READ, not unmatched.
  const unmatchedOut = (literalRanked?.unmatchedTokens || []).filter(
    (t) => !garmentCategoryOf(t) && !genericNounCategoryOf(t) && !spelledTokens.has(t) &&
      !SEARCH_STOPWORDS.has(t)
  );
  // THE READING GOES ON RECORD (optimize round, 20 Sep 2026). The log used to
  // keep four fields of the interpretation and none of the answer, so the
  // steward could count empty searches but never say why: "6 of 96 returned
  // nothing" blamed the cultural fallback for a prefix fragment, an unknown
  // house and a contradiction alike. What the engine says to the reader is
  // stored beside what it read, and an empty rack names its own reason.
  const constraintLabels = [];
  if (dense.constraints.gender) constraintLabels.push(dense.constraints.gender === "womens" ? "womenswear" : dense.constraints.gender === "mens" ? "menswear" : "unisex");
  if (dense.constraints.maxPrice != null) constraintLabels.push(`under $${dense.constraints.maxPrice}`);
  if (dense.constraints.minPrice != null) constraintLabels.push(`over $${dense.constraints.minPrice}`);
  if (dense.constraints.climate) constraintLabels.push(`climate:${dense.constraints.climate}`);
  if (eraConstraint || eraMiss) constraintLabels.push(`era:${(eraConstraint || eraMiss).label}`);
  if (originConstraint || originMiss) constraintLabels.push(`origin:${(originConstraint || originMiss).label}`);
  if (sizeConstraint) constraintLabels.push(`size:${sizeConstraint.label || sizeConstraint.phrase || sizeConstraint.kind}`);
  for (const x of exclusions) constraintLabels.push(`not ${x.word}`);
  if (designerCreditName) constraintLabels.push(`designer:${designerCreditName}`);
  if (pairReading) constraintLabels.push(`pair:${pairReading.text}`);
  if (tagReading) constraintLabels.push(`tag:${tagReading.text}`);
  for (const pin of pinned) constraintLabels.push(`pin:${pin.text}`);
  const readTokens = dense.tokens.filter((t) => !SEARCH_STOPWORDS.has(t));
  const emptyReason = ranked.length ? null
    : q.length < 4 ? "fragment"
    : pairReading?.miss ? "pair-miss"
    : tagReading && !tagReading.count ? "tag-miss"
    : constraintLabels.length >= 2 ? "constraint-conflict"
    : constraintLabels.length === 1 ? "constraint-miss"
    : readTokens.length && readTokens.every((t) => unmatchedOut.includes(t)) ? "unknown-words"
    : "other";
  const reading = {
    note: note ? String(note).slice(0, 240) : null,
    unmatchedTokens: unmatchedOut.slice(0, 8),
    typoCorrections: (interpreted.typoCorrections || []).slice(0, 4),
    semantic: { engaged: !!semantic.engaged, reranked: semantic.reranked | 0, appended: semantic.appended | 0 },
    cultural: !!cultural?.engaged,
    constraints: constraintLabels.slice(0, 12),
    emptyReason,
  };
  if (log) logSearch(q, ranked, userId, interpreted, { candidatesTruncated, servedIds: servedPage.map((it) => it.id), reading }); // fire-and-forget
  return {
    query: q,
    interpreted: {
      intent: interpreted.intent, brand: interpreted.brand || null,
      mappedTags: interpreted.mappedTags, relatedTerms: interpreted.relatedTerms,
      mappingHits: interpreted.mappingHits, personalized: !!personal,
      typoCorrections: interpreted.typoCorrections || [],
      brandSpelling: interpreted.brandSpelling || null,
      designerCredit: designerCreditName || null,
      pair: pairReading
        ? (pairReading.miss
          ? { text: pairReading.text, miss: pairReading.miss, served: false }
          : { text: pairReading.text, designerId: pairReading.designer.id, designer: pairReading.designer.name,
              houseId: pairReading.house.id, house: pairReading.house.name, brands: pairReading.house.brands,
              verified: pairReading.verified, tenures: pairReading.edges.map((e) => ({ role: e.role, start: e.start, end: e.end })),
              served: true })
        : null,
      tag: tagReading ? { text: tagReading.text, left: tagReading.left, right: tagReading.right, count: tagReading.count, served: tagReading.count > 0 }
        : tagMiss ? { text: tagMiss.text, left: tagMiss.left, right: tagMiss.right, count: 0, served: false, readAsWords: true } : null,
      pins: pinned.map((p) => ({ text: p.text, count: p.after })),
      assist: assistState.used
        ? { used: true, provider: assistState.provider, model: assistState.model,
            promptVersion: assistState.promptVersion, applied: assistState.applied,
            dropped: assistState.dropped, reading: assistState.reading }
        : null,
      exclusions: exclusions.map((x) => x.word),
      priceSort: priceSortSpec ? { direction: priceSortSpec.direction, phrase: priceSortSpec.phrase } : null,
      size: sizeConstraint
        ? { kind: sizeConstraint.kind, fits: sizeConstraint.fits || null,
            label: sizeConstraint.label || null, phrase: sizeConstraint.phrase }
        : null,
      origin: originConstraint
        ? { countries: originConstraint.countries, label: originConstraint.label,
            words: originConstraint.words, served: true }
        : originMiss
          ? { countries: originMiss.countries, label: originMiss.label,
              words: originMiss.words, served: false }
          : null,
      era: eraConstraint
        ? { minYear: eraConstraint.minYear, maxYear: eraConstraint.maxYear,
            season: eraConstraint.season, label: eraConstraint.label,
            words: eraConstraint.words, served: true }
        : eraMiss
          ? { minYear: eraMiss.minYear, maxYear: eraMiss.maxYear,
              season: eraMiss.season, label: eraMiss.label,
              words: eraMiss.words, served: false }
          : null,
    },
    total: ranked.length,
    candidatesTruncated,
    note,
    unmatchedTokens: unmatchedOut,
    semantic,
    cultural,
    results: ranked.slice(offset, offset + limit).map(({ _score, _textRank, _queryEvidence, ...it }) => it),
  };
}

// A served page is bounded by the route's own limit, but the log writer must
// not depend on that staying true — this is the cap the column is sized for.
export const SERVED_IDS_CAP = 100;

/**
 * Record that a search happened. FIRE-AND-FORGET — never awaited, and its
 * failure is swallowed, because logging must not be able to fail a search.
 *
 * Stores ids in served order, nothing else: the record exists to make EXPOSURE
 * countable (which pieces were shown, and where) and deliberately does not
 * duplicate scores or tags.
 */
export function logSearch(query, results, userId, interpreted, { candidatesTruncated = false, servedIds = null, reading = null } = {}) {
  dbLogSearch({
    userId: userId || null,
    query,
    interpreted: interpreted
      ? {
          intent: interpreted.intent, mappedTags: interpreted.mappedTags,
          mappingHits: interpreted.mappingHits, candidatesTruncated,
          // What the engine said and why the rack was what it was (20 Sep 2026).
          ...(reading || {}),
        }
      : {},
    resultCount: results.length,
    // Ids only, in served order, bounded. No scores, no tags — this record
    // exists to make exposure countable, not to duplicate the catalog.
    servedIds: Array.isArray(servedIds)
      ? servedIds.filter((id) => typeof id === "string" && id).slice(0, SERVED_IDS_CAP)
      : null,
  }).catch(() => {});
}
