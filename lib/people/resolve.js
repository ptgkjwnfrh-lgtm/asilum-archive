// lib/people/resolve.js — the overview and related edges a query earns
// (V.2 SearchPage: `overview`, `related`, `query.designerId/houseId`).
//
// A name earns its registry entity; a DESIGNER: HOUSE pair earns BOTH
// canonical ids so quick selections and headings cannot disagree; anything
// else earns nothing. The legacy person panel (lib/people/overviews.js) is
// untouched — the client still calls findOverview for it.

import { parseDesignerHousePair } from "../search/pair.js";
import {
  findCareerEntityByPrefix,
  findCareerEntity, entityDto, edgeDto, careerOf, designersOf, catalogBrandsOf, getCareerEntity,
} from "./careers.js";
import { itemCreditsDesigner } from "../search/designers.js";
import { findOverview, OVERVIEWS } from "./overviews.js";

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function countCredits(pool, edge) {
  if (!pool) return null;
  const designer = getCareerEntity(edge.designerId);
  const brands = new Set(catalogBrandsOf(edge.houseId).map(fold));
  if (!designer || !brands.size) return 0;
  let n = 0;
  for (const it of pool) if (brands.has(fold(it.brand)) && itemCreditsDesigner(it, designer.name)) n++;
  return n;
}

/**
 * @param {string} query
 * @param {{ pool?: Array }} opts  a catalog pool to count credits against; omit to leave counts null
 * @returns {{ overview, related, entities, query: { text, designerId, houseId } }}
 */
export function resolveOverviewForQuery(query, { pool = null } = {}) {
  const text = String(query || "").trim();
  const out = { overview: null, related: [], entities: { designer: null, house: null }, query: { text, designerId: null, houseId: null } };
  if (!text) return out;
  const pair = parseDesignerHousePair(text);
  if (pair) {
    const d = findCareerEntity(pair.left, "designer") || findCareerEntity(pair.right, "designer");
    const h = findCareerEntity(pair.right, "house") || findCareerEntity(pair.left, "house");
    if (d) { out.entities.designer = entityDto(d.id); out.query.designerId = d.id; }
    if (h) { out.entities.house = entityDto(h.id); out.query.houseId = h.id; }
    out.overview = out.entities.designer || out.entities.house;
    const edges = d ? careerOf(d.id) : h ? designersOf(h.id) : [];
    out.related = edges.map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) }));
    return out;
  }
  const entity = findCareerEntity(text);
  if (!entity) {
    // ONE PATH (synergy round): the legacy person records (lib/people/
    // overviews.js — Olivier Rousteing today) reach the same contract shape
    // the registry serves, so a client reads `overview` once. The legacy
    // client lookup keeps working; the server answer is the same person.
    const legacy = findOverview(text);
    if (legacy) {
      out.overview = legacyEntityDto(legacy);
      out.query.designerId = legacy.id;
      out.entities.designer = out.overview;
      const reg = getCareerEntity(legacy.id);
      out.related = reg ? careerOf(reg.id).map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) })) : [];
      return out;
    }
    // a name that BEGINS with the query (three letters or more): the popup
    // shows Tom Ford on "Tom" (owner reference, 18 Oct 2026); said as a prefix
    const pre = findCareerEntityByPrefix(text);
    if (!pre) return out;
    out.query.prefix = true;
    out.overview = entityDto(pre.id);
    if (pre.kind === "designer") { out.entities.designer = out.overview; out.query.designerId = pre.id; out.related = careerOf(pre.id).map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) })); }
    else { out.entities.house = out.overview; out.query.houseId = pre.id; out.related = designersOf(pre.id).map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) })); }
    return out;
  }
  out.overview = entityDto(entity.id);
  if (entity.kind === "designer") {
    out.entities.designer = out.overview; out.query.designerId = entity.id;
    out.related = careerOf(entity.id).map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) }));
  } else {
    out.entities.house = out.overview; out.query.houseId = entity.id;
    out.related = designersOf(entity.id).map((e) => edgeDto(e, { matchingItemCount: countCredits(pool, e) }));
  }
  return out;
}

/** The legacy overview row (lib/people/overviews.js) as the contract Entity. */
export function legacyEntityDto(rec) {
  if (!rec) return null;
  const sources = Object.entries(rec.sources || {}).map(([key, s]) => ({
    id: key, url: s.url, publisher: s.publisher, retrievedAt: rec.lastUpdated || null, publishedAt: null, fetched: null, type: s.type || null,
  }));
  return {
    id: rec.id,
    kind: "designer",
    name: rec.name,
    aliases: [...(rec.aliases || [])],
    role: rec.role || null,
    basis: rec.basis || null,
    overview: rec.summary
      ? { summary: { text: rec.summary, sourceIds: sources.map((s) => s.id) }, paragraphs: [], updatedAt: rec.lastUpdated || null }
      : null,
    image: rec.image ? { url: rec.image, alt: rec.imageCredit?.alt || rec.name, credit: rec.imageCredit?.credit || null, rights: rec.imageCredit?.license || null } : null,
    sources,
    vogueSourceIds: sources.filter((s) => /vogue\./i.test(s.url || "")).map((s) => s.id),
    facts: (rec.facts || []).map((f, i) => ({ key: `fact-${i + 1}`, claim: { text: f.claim, sourceIds: f.source ? [f.source] : [] } })),
    tags: [...(rec.tags || [])],
    notAffiliated: rec.notAffiliated || null,
    reference: false,
    legacy: true,
  };
}
