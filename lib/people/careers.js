// lib/people/careers.js — THE CAREER REGISTRY: sourced, dated designer–house
// relationships, independent of what the catalog happens to stock (V.2,
// the V.2 search plan: the designer/house model).
//
// WHY A REGISTRY. `creditFootprint` (lib/search/designers.js) derives a
// person's houses from item credits and sorts them by inventory count. That
// answers "where does this catalog credit Kim Jones" and nothing more: it
// cannot say Tom Ford ran Gucci, because no Gucci piece here credits him, and
// it cannot order Gucci's designers by when they held the job. A designer's
// verified house stays listed at zero inventory; a house's designers sort by
// dated relationships, not by what is in stock.
//
// LAWS.
//   * A founder and the house that carries their name are two entities
//     (tom-ford / tom-ford-house). A shared name is not an identity.
//   * A career edge is a role at a house with a start, an end and a stated
//     precision. Unknown stays null. Overlapping roles are both listed —
//     Tom Ford held Gucci and YSL Rive Gauche at once — never forced into
//     one false succession.
//   * Every claim names its sources; the whole file carries provenance and
//     the Vogue gap is written down rather than papered over.
//   * The registry never attributes a garment. `matchingItemCount` is a
//     count of pieces the catalog CREDITS to the designer at that house's
//     brands; a tenure date alone proves nothing about a piece.

import DATA from "./careers.data.json" with { type: "json" };
import { houseOrigin } from "../asterisk/houses.js";

export const CAREER_PROVENANCE = Object.freeze({ ...DATA.provenance });

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

const SOURCES = new Map(DATA.sources.map((s) => [s.id, Object.freeze({ ...s })]));
const ENTITIES = new Map(DATA.entities.map((e) => [e.id, e]));
const BY_NAME = new Map();
for (const e of DATA.entities) {
  for (const name of [e.name, ...(e.aliases || [])]) {
    const key = fold(name);
    if (!key) continue;
    const list = BY_NAME.get(key) || [];
    list.push(e);
    BY_NAME.set(key, list);
  }
}
const BRAND_TO_HOUSE = new Map();
for (const e of DATA.entities) {
  if (e.kind !== "house") continue;
  for (const b of e.catalogBrands || [e.name]) BRAND_TO_HOUSE.set(fold(b), e.id);
}
const EDGES = DATA.edges.map((edge, i) => Object.freeze({
  id: `${edge.designerId}~${edge.houseId}~${i}`,
  ...edge,
}));

/** ISO-ish "YYYY" | "YYYY-MM" | "YYYY-MM-DD" → a sortable number; unknown → null. */
export function dateKey(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2] || 1) * 100 + Number(m[3] || 1);
}

/** Known start first, ascending; unknown starts last; deterministic after that. */
export function compareEdges(a, b) {
  const ka = dateKey(a.start), kb = dateKey(b.start);
  if (ka == null && kb == null) return a.id.localeCompare(b.id);
  if (ka == null) return 1;
  if (kb == null) return -1;
  if (ka !== kb) return ka - kb;
  return a.id.localeCompare(b.id);
}

export function getCareerEntity(id) {
  return ENTITIES.get(id) || null;
}

/**
 * The entity a name or alias denotes, exactly (folded), or null. `kind`
 * narrows to designer | house; without it a name that is BOTH (Tom Ford)
 * returns the designer, because a person is asked for by name more often
 * than a company is — the house is still reachable with kind: "house".
 */
export function findCareerEntity(text, kind = null) {
  const list = BY_NAME.get(fold(text)) || [];
  const wanted = kind ? list.filter((e) => e.kind === kind) : list;
  if (!wanted.length) return null;
  return wanted.find((e) => e.kind === "designer") || wanted[0];
}

/**
 * The entity whose name or alias BEGINS with the text (three letters or more),
 * for the search popup that shows Tom Ford on "Tom" (owner reference, 18 Oct
 * 2026; V.2 16.3 "a recognized person gets an overview first"). Designers
 * before houses, then alphabetical, so the answer is the same every time;
 * null when nothing begins that way — never a guess.
 */
export function findCareerEntityByPrefix(text, kind = null) {
  const q = fold(text);
  if (q.length < 3) return null;
  const hits = [];
  for (const e of ENTITIES.values()) {
    if (kind && e.kind !== kind) continue;
    if ([e.name, ...(e.aliases || [])].some((n) => fold(n).startsWith(q))) hits.push(e);
  }
  hits.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "designer" ? -1 : 1));
  return hits[0] || null;
}

/** The registry house a catalog brand string belongs to, or null. */
export function houseIdForBrand(brand) {
  return BRAND_TO_HOUSE.get(fold(brand)) || null;
}

/** Catalog brand strings a registry house answers to (exact catalog spelling). */
export function catalogBrandsOf(houseId) {
  const e = ENTITIES.get(houseId);
  if (!e || e.kind !== "house") return [];
  return [...(e.catalogBrands || [e.name])];
}

export function careerOf(designerId) {
  return EDGES.filter((e) => e.designerId === designerId).sort(compareEdges);
}

export function designersOf(houseId) {
  return EDGES.filter((e) => e.houseId === houseId).sort(compareEdges);
}

/** Every tenure of one designer at one house (there can be more than one). */
export function careerEdges(designerId, houseId) {
  return EDGES.filter((e) => e.designerId === designerId && e.houseId === houseId).sort(compareEdges);
}

export function sourceDto(id) {
  const s = SOURCES.get(id);
  if (!s) return null;
  return { id: s.id, url: s.url, publisher: s.publisher, retrievedAt: DATA.provenance.compiledOn,
           publishedAt: s.publishedAt || null, fetched: !!s.fetched };
}

/** The contract Entity DTO (docs/v2/CONTRACTS.md). Reference-only houses carry a null overview. */
export function entityDto(id) {
  const e = ENTITIES.get(id);
  if (!e) return null;
  const sourceIds = new Set();
  for (const s of e.summary?.sourceIds || []) sourceIds.add(s);
  for (const f of e.facts || []) for (const s of f.claim?.sourceIds || []) sourceIds.add(s);
  const vogueSourceIds = [...sourceIds].filter((s) => /vogue\./i.test(SOURCES.get(s)?.url || ""));
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    aliases: [...(e.aliases || [])],
    overview: e.summary
      ? { summary: { text: e.summary.text, sourceIds: [...e.summary.sourceIds] }, paragraphs: [], updatedAt: DATA.provenance.compiledOn }
      : null,
    image: null,
    sources: [...sourceIds].map(sourceDto).filter(Boolean),
    vogueSourceIds,
    facts: (e.facts || []).map((f) => ({ key: f.key, claim: { text: f.claim.text, sourceIds: [...f.claim.sourceIds] } })),
    // ONE ANSWER ABOUT WHERE A HOUSE IS FROM: the origin table the search
    // engine reads for "japanese coat" (lib/asterisk/houses.js) rides on the
    // house entity, so an overview and a search never disagree about a
    // country. Null when the table has no row — never guessed from a fact.
    origin: e.kind === "house" ? originOf(e) : null,
    reference: !!e.reference,
  };
}

function originOf(e) {
  for (const brand of [...(e.catalogBrands || []), e.name]) {
    const row = houseOrigin(brand);
    if (row) return { country: row.country, city: row.city || null, foundedIn: row.foundedIn || null, basis: row.basis, source: "lib/asterisk/houses.js" };
  }
  return null;
}

/** "TOM FORD: GUCCI" — the search text that reaches this exact intersection. */
export function queryTextFor(designerId, houseId) {
  const d = ENTITIES.get(designerId), h = ENTITIES.get(houseId);
  if (!d || !h) return null;
  return `${d.name.toUpperCase()}: ${h.name.toUpperCase()}`;
}

/**
 * The contract CareerEdge DTO. `matchingItemCount` is supplied by the caller
 * who can see a catalog; null means "not counted", never "none".
 */
export function edgeDto(edge, { matchingItemCount = null } = {}) {
  const d = ENTITIES.get(edge.designerId), h = ENTITIES.get(edge.houseId);
  return {
    id: edge.id,
    designerId: edge.designerId,
    houseId: edge.houseId,
    designer: d?.name || edge.designerId,
    house: h?.name || edge.houseId,
    role: edge.role,
    start: edge.start || null,
    end: edge.end || null,
    current: !edge.end,
    datePrecision: edge.datePrecision || "unknown",
    note: edge.note || null,
    sourceIds: [...(edge.sourceIds || [])],
    sourceCatalog: (edge.sourceIds || []).map(sourceDto).filter(Boolean),
    queryText: queryTextFor(edge.designerId, edge.houseId),
    matchingItemCount,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1994" | "Oct 2024" | "21 Jan 2018" — exactly as precise as the record. */
export function formatCareerDate(value) {
  const m = String(value || "").match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : null;
  if (m[3] && month) return `${Number(m[3])} ${month} ${m[1]}`;
  if (month) return `${month} ${m[1]}`;
  return m[1];
}

/** A human line for one tenure: "creative director, 1994–2004"; "creative director, since Sep 2024". */
export function tenurePhrase(edge) {
  const start = formatCareerDate(edge.start), end = formatCareerDate(edge.end);
  const span = start && end ? `${start}–${end}`
    : start ? `since ${start}` : end ? `until ${end}` : "dates unknown";
  return `${edge.role}, ${span}`;
}

export function registryCoverage() {
  const designers = DATA.entities.filter((e) => e.kind === "designer").length;
  const houses = DATA.entities.filter((e) => e.kind === "house" && !e.reference).length;
  const referenceHouses = DATA.entities.filter((e) => e.kind === "house" && e.reference).length;
  const fetched = DATA.sources.filter((s) => s.fetched).length;
  return { designers, houses, referenceHouses, edges: EDGES.length, sources: DATA.sources.length,
           fetchedSources: fetched, vogueSources: DATA.sources.filter((s) => /vogue\./i.test(s.url)).length,
           unsourced: DATA.unsourced.length };
}

export const CAREER_UNSOURCED = Object.freeze(DATA.unsourced.map((u) => ({ ...u })));
