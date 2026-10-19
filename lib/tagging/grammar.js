// lib/tagging/grammar.js — THE TAG GRAMMAR: `LEFT: RIGHT` (V.2 Blueprint,
// owner, 17 Oct 2026, Part I "Tag grammar"; slice 4 of the build order in
// docs/v2/BLUEPRINT-GAP-2026-10-17.md).
//
// Every tag has one shape: LEFT: RIGHT. Uppercase, one colon, nothing else.
// Three families:
//   IDENTITY  DEFINING ATTRIBUTE: OBJECT   SAINT LAURENT: BOMBER JACKET
//   LINEAGE   MAKER: HOUSE · HOUSE: SEASON  HEDI SLIMANE: SAINT LAURENT
//   STATE     KEY: VALUE                   PRODUCT: SOLD · SIZE: XL (L)
//
// THE LEFT SIDE IS A HIERARCHY, NOT A BAG. MAKER → HOUSE → SCENE → AESTHETIC
// → MATERIAL → ERA → PLACE, each one needing its own evidence; the matrix
// maps it onto the facets lib/tagging/vocabulary.js already registers
// (designer / brand / subculture / aesthetic / material / decade+season /
// origin). This module READS a record and says which tags it earns — it
// never writes a facet, and it never invents a side: a left that nothing on
// the record corroborates is not produced, and UNKNOWN never appears.
//
// ONLY ASTERISK ASSIGNS. Nothing here takes a tag from a seller or a
// passenger; the inputs are the record's own fields (the normaliser's
// output), the typed product_tags rows ASTERISK's tagger and the admins
// write, and the unit's state (sold, verified, measured). Admin rows carry
// their own confidence and ride in as any other typed row; the governance
// that lets an admin REWRITE a tag outright is slice 5.
//
// VISIBLE MEANS CERTAIN. Three visible, all at or above VISIBLE_MIN (75%);
// everything shakier lives behind the product; under WRITE_MIN (50%) a tag
// is not written at all. A state tag that matters now (PRODUCT: SOLD,
// OFFER: ACCEPTED) takes the third visible slot and pushes a lineage tag
// behind. The Feed card and the listing show the same first three, because
// both read this function over the same record.
//
// THE CONSISTENCY CHECK is structural and evidence-bound, and honest about
// what it can know: an identity tag's right side must be the record's own
// object (EAMES: CASSETTE fails on a chair), a lineage tag's sides must be
// the record's credited maker and its house (FW16: EAMES fails: an era is
// not a maker and a maker is not a noun), a state tag's key must be one of
// the state keys, and no side may equal the other. What it cannot know —
// whether a maker ever made cassettes — it does not pretend to.
//
// CLIENT-SAFE: no db, no brain/index.js. The Feed card runs it in the
// browser over the record it already holds.

import { TAGS } from "../brain/tags.js";
import { MATERIALS, titleTokens } from "./dense.js";
import { houseOrigin } from "../asterisk/houses.js";
import { GARMENT_CATEGORY, GENERIC_GARMENT_NOUNS } from "../search/vocabulary.js";
import { ONTOLOGY_GARMENT_NOUNS } from "../search/ontology.js";
import { cap } from "../asterisk/governance.js";

export const FAMILIES = Object.freeze(["identity", "lineage", "state"]);
/** The left-side hierarchy, strongest first, with the facet each maps onto. */
export const LEFT_ORDER = Object.freeze(["maker", "house", "scene", "aesthetic", "material", "era", "place"]);
export const LEFT_FACET = Object.freeze({
  maker: "designer", house: "brand", scene: "subculture", aesthetic: "aesthetic",
  material: "material", era: "decade", place: "origin",
});
export const VISIBLE = 3;
export const VISIBLE_MIN = 0.75;
export const WRITE_MIN = 0.5;
/** State keys the grammar knows; a state tag with another key fails the check. */
export const STATE_KEYS = Object.freeze(["PRODUCT", "OFFER", "STATUS", "STOCK", "SIZE", "OWNED"]);
/** A state that matters now takes the third visible slot. */
export const URGENT_STATE = Object.freeze(new Set(["PRODUCT", "OFFER"]));
const STATE_ORDER = Object.fromEntries(STATE_KEYS.map((k, i) => [k, i]));
const LEFT_RANK = Object.fromEntries(LEFT_ORDER.map((k, i) => [k, i]));

// THE OBJECT NOUNS. The search vocabularies first — one register, never a
// second spelling of a garment — then the nouns the search ontology leaves
// out for ITS reasons (a "boot" is a subtype the category bonus must not
// reward; "tie" and "sunglasses" never needed a category there) and the
// grammar needs for its own: the right side is the plainest noun of the
// thing, and a tie is a TIE before it is a TOP. Measured on the live feed,
// 17 Oct: DIOR: TOP for a silk tie, JEAN PAUL GAULTIER: BOTTOMS for
// sunglasses the normaliser had filed under bottoms.
const OBJECT_NOUNS = ["tie", "sunglasses", "sneaker", "boot", "loafer", "sandal", "sandals", "mule", "mules", "clog", "clogs",
  "bracelet", "ring", "earring", "earrings", "brooch", "pendant", "chain", "backpack", "tote", "pouch", "clutch", "briefcase",
  "cap", "visor", "bandana", "balaclava", "poncho", "overshirt", "chinos", "overalls", "dungarees", "bodysuit", "corset",
  "turtleneck", "crewneck", "pullover", "jersey", "trouser", "pant", "short", "boxers", "briefs", "swimsuit", "bikini", "robe",
  "cufflinks", "keychain", "lighter", "perfume", "candle", "poster", "print", "book", "record", "vinyl", "cassette", "cd"];
const GARMENT_NOUNS = new Set([
  ...Object.keys(GARMENT_CATEGORY), ...Object.keys(GENERIC_GARMENT_NOUNS), ...Object.keys(ONTOLOGY_GARMENT_NOUNS), ...OBJECT_NOUNS,
]);
/** The department as its plainest noun, when the title offers none. */
const CATEGORY_NOUN = Object.freeze({
  tops: "TOP", dresses: "DRESS", accessories: "ACCESSORY", knitwear: "KNIT",
  bottoms: "BOTTOMS", outerwear: "OUTERWEAR", footwear: "FOOTWEAR", tailoring: "TAILORING",
});

const up = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
// A SUPPLIER'S PLACEHOLDER IS NOT A FACT. eBay writes "Not Available" into
// a brand field and a size label; "Unbranded", "N/A", "None" and "Unknown"
// arrive the same way. None of them is a house, a maker or a size, and the
// blueprint's rule — UNKNOWN never appears on a tag — covers every spelling
// of not knowing. Measured on the live feed, 17 Oct: NOT AVAILABLE: SHIRT.
export const PLACEHOLDER = /^(unknown|not available|unavailable|n\/?a|none|null|undefined|unbranded|no brand|generic|other|-+|\?+)$/i;
const placeholder = (s) => !String(s ?? "").trim() || PLACEHOLDER.test(String(s).trim());
/** One comparable key for a side: accents folded, case gone, one space. */
export const foldSide = (s) => up(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const round2 = (n) => Math.round(n * 100) / 100;

// ---- the record's facts -----------------------------------------------------

/** The object noun of a record — the right side of every identity tag — or
 *  null when nothing on the record names one. Title first (the catalog's
 *  "House — descriptor garment" shape, or the last garment noun of a free
 *  title), the department's noun as the fallback. Two words at most, never
 *  three; a non-final material word belongs to MATERIAL, not to the noun. */
export function objectOf(item = {}) {
  const raw = String(item.title ?? "");
  const dash = raw.indexOf("—");
  const tokens = titleTokens(raw);
  if (dash >= 0 && tokens.length) {
    const kept = tokens.filter((t, i) => i === tokens.length - 1 || !MATERIALS.has(t));
    return up(kept.slice(-2).join(" "));
  }
  if (dash < 0) {
    const nouns = tokens.filter((t) => GARMENT_NOUNS.has(t));
    if (nouns.length) return up(nouns[nouns.length - 1]);
  }
  const cat = String(item.category ?? "").trim().toLowerCase();
  if (!cat) return null;
  return CATEGORY_NOUN[cat] || up(cat);
}

/** The house, or null — "Unknown" is not a house and never stands on a tag. */
export function houseOf(item = {}) {
  const b = String(item.brand ?? "").trim();
  if (placeholder(b)) return null;
  return up(b);
}

/** The credited makers: people in designers[] who are not the house itself. */
export function makersOf(item = {}) {
  const house = foldSide(item.brand);
  return [...new Set((Array.isArray(item.designers) ? item.designers : [])
    .filter((d) => !placeholder(d)).map((d) => up(d)).filter((d) => d && foldSide(d) !== house))];
}

/** Seasons are the only abbreviations: FW16, SS19. Years stay four digits. */
export function seasonCode(era = {}) {
  if (!era || typeof era !== "object") return null;
  const season = String(era.season ?? "").trim().toLowerCase();
  const year = Number(era.year);
  const yy = Number.isFinite(year) ? String(year).slice(-2) : null;
  if (season && yy) {
    if (/^fall\/winter$|^autumn\/winter$|^fw$|^aw$/.test(season)) return "FW" + yy;
    if (/^spring\/summer$|^ss$/.test(season)) return "SS" + yy;
    return up(season) + " " + year;
  }
  if (Number.isFinite(year)) return String(year);
  if (era.decade) return up(era.decade);
  return null;
}

/** Non-final material words of the title, the literal evidence a MATERIAL
 *  tag needs (the same rule lib/tagging/dense.js writes the facet by). */
export function materialsOf(item = {}) {
  const tokens = titleTokens(item.title);
  return [...new Set(tokens.filter((t, i) => i < tokens.length - 1 && MATERIALS.has(t)).map(up))];
}

/** The size as the blueprint prints it: SIZE: XL (L) is tag XL, measured L. */
export function sizeValue(size) {
  if (!size || typeof size !== "object") return null;
  if (placeholder(size.label)) return null;
  const label = up(size.label);
  const measured = placeholder(size.fitsLikeUS) ? "" : up(size.fitsLikeUS);
  return measured && measured !== label ? `${label} (${measured})` : label;
}

// ---- building tags -------------------------------------------------------------

// THE 90% CAP (slice 5, lib/asterisk/governance.js): a tag ASTERISK assigns
// never carries more than 0.9; only an admin's row (`adminConfirmed`) is 1.
function tag(family, left, right, confidence, extra = {}) {
  const L = extra.keepCase ? String(left).trim() : up(left);
  const R = extra.keepCase ? String(right).trim() : up(right);
  return Object.freeze({
    family, left: L, right: R, confidence: round2(cap(confidence, { adminConfirmed: !!extra.adminConfirmed })),
    leftKind: extra.leftKind || null, rightKind: extra.rightKind || null,
    key: family + ":" + foldSide(L) + ":" + foldSide(R),
  });
}

/** The text of a tag: "LEFT: RIGHT" — one colon, one space. OWNED keeps the
 *  username's own case and wears the friend asterisk when the owner is one. */
export function formatTag(t) {
  return `${t.left}: ${t.right}`;
}

/** The queries a tag opens: the left runs the attribute, the right the
 *  category, the whole runs the tag itself (`SILVER: JEWELRY`). */
export function tagQueries(t) {
  return { left: t.left.toLowerCase(), right: t.right.toLowerCase(), whole: formatTag(t).toLowerCase() };
}

/**
 * The facts the consistency check reads: the object, the house, the makers,
 * the time codes, the materials, the scenes and the place a record offers.
 */
export function contextOf(item = {}, { typed = [] } = {}) {
  const house = houseOf(item);
  const origin = houseOrigin(item.brand);
  const rows = Array.isArray(typed) ? typed : [];
  const byFacet = (facet) => rows.filter((r) => r && r.tagType === facet && Number(r.confidence) >= WRITE_MIN)
    .map((r) => ({ value: up(String(r.tag).replace(/-/g, " ")), confidence: Number(r.confidence), admin: String(r.source || "") === "admin" }));
  return {
    object: objectOf(item),
    house,
    makers: makersOf(item),
    season: seasonCode(item.era),
    materials: [...new Set([...materialsOf(item), ...byFacet("material").map((m) => m.value)])],
    scenes: byFacet("subculture"),
    aesthetics: Object.entries(item.tags && typeof item.tags === "object" ? item.tags : {})
      .filter(([t, w]) => TAGS.includes(t) && typeof w === "number" && w > 0)
      .map(([t, w]) => ({ value: up(t), confidence: w })),
    place: origin ? up(origin.city || origin.country) : null,
    placesTyped: byFacet("origin"),
  };
}

/**
 * Does one tag hold against the record? `{ ok, reason }`. Structural
 * first (shape, no self-reference, no UNKNOWN, two words at most on an
 * identity's right), then evidence-bound per family.
 */
export function checkTag(t, ctx) {
  if (!t || !t.left || !t.right) return { ok: false, reason: "a tag has two sides" };
  if (/:/.test(t.left) || /:/.test(t.right)) return { ok: false, reason: "one colon, nothing else" };
  if (foldSide(t.left) === foldSide(t.right)) return { ok: false, reason: "a side cannot name itself" };
  if (placeholder(t.left) || placeholder(t.right)) return { ok: false, reason: "UNKNOWN never appears on a tag" };
  const c = ctx || {};
  if (t.family === "identity") {
    if (t.right.split(" ").length > 2) return { ok: false, reason: "the object is one noun, two words at most" };
    if (!c.object || foldSide(t.right) !== foldSide(c.object)) return { ok: false, reason: `the record's object is ${c.object || "not named"}` };
    const L = foldSide(t.left);
    const known = (c.makers || []).some((m) => foldSide(m) === L) || (c.house && foldSide(c.house) === L)
      || (c.scenes || []).some((s) => foldSide(s.value) === L) || (c.aesthetics || []).some((a) => foldSide(a.value) === L)
      || (c.materials || []).some((m) => foldSide(m) === L) || (c.season && foldSide(c.season) === L)
      || (c.place && foldSide(c.place) === L) || (c.placesTyped || []).some((p) => foldSide(p.value) === L);
    return known ? { ok: true } : { ok: false, reason: "nothing on the record corroborates that attribute" };
  }
  if (t.family === "lineage") {
    const L = foldSide(t.left), R = foldSide(t.right);
    const house = c.house ? foldSide(c.house) : null;
    if (house && R === house && (c.makers || []).some((m) => foldSide(m) === L)) return { ok: true };
    if (house && L === house && c.season && R === foldSide(c.season)) return { ok: true };
    return { ok: false, reason: "lineage is the credited maker at the house, or the house's season" };
  }
  if (t.family === "state") {
    return STATE_KEYS.includes(up(t.left)) ? { ok: true } : { ok: false, reason: "not a state key" };
  }
  return { ok: false, reason: "no such family" };
}

/**
 * Every tag a record earns, consistency-checked, ordered as the blueprint
 * orders them: identity (strongest family first, then confidence), lineage
 * (maker before house before season), state (PRODUCT · OFFER · STATUS ·
 * STOCK · SIZE · OWNED). Tags under WRITE_MIN are not written.
 *
 * @param {object} item     the record (the normaliser's shape)
 * @param {object} [opts]
 * @param {Array}  [opts.typed]  product_tags rows ({ tag, tagType, confidence, source })
 * @param {object} [opts.state]  the unit's state: { verification, offer, stock, owned: { handle, friend } }
 */
export function tagsFor(item = {}, { typed = [], state = {} } = {}) {
  const ctx = contextOf(item, { typed });
  const out = [];
  const add = (t) => { if (t.confidence >= WRITE_MIN && checkTag(t, ctx).ok && !out.some((x) => x.key === t.key)) out.push(t); };
  const object = ctx.object;

  if (object) {
    // IDENTITY. The house is the record's own field; a maker stands on the
    // identity only when there is no house to carry it (the blueprint's
    // fashion example: SAINT LAURENT: BOMBER JACKET, Hedi in the lineage).
    if (ctx.house) add(tag("identity", ctx.house, object, 1, { leftKind: "house", rightKind: "object" }));
    else for (const m of ctx.makers) add(tag("identity", m, object, 0.9, { leftKind: "maker", rightKind: "object" }));
    for (const s of ctx.scenes) add(tag("identity", s.value, object, s.confidence, { leftKind: "scene", rightKind: "object", adminConfirmed: s.admin }));
    for (const a of ctx.aesthetics) add(tag("identity", a.value, object, a.confidence, { leftKind: "aesthetic", rightKind: "object" }));
    for (const m of ctx.materials) add(tag("identity", m, object, 0.9, { leftKind: "material", rightKind: "object" }));
    // "If nothing above MATERIAL is known, the material or era stands alone."
    if (!ctx.house && !ctx.makers.length && !ctx.scenes.length && ctx.season) add(tag("identity", ctx.season, object, 0.8, { leftKind: "era", rightKind: "object" }));
    // The house's base is the house's fact, not the piece's documented
    // making: it stays behind the product (0.7 < VISIBLE_MIN) until a typed
    // origin row says otherwise.
    for (const p of ctx.placesTyped) add(tag("identity", p.value, object, p.confidence, { leftKind: "place", rightKind: "object", adminConfirmed: p.admin }));
    if (ctx.place) add(tag("identity", ctx.place, object, 0.7, { leftKind: "place", rightKind: "object" }));
  }
  // LINEAGE: who made it for whom, and when.
  if (ctx.house) {
    for (const m of ctx.makers) add(tag("lineage", m, ctx.house, 0.9, { leftKind: "maker", rightKind: "house" }));
    if (ctx.season) add(tag("lineage", ctx.house, ctx.season, /^(FW|SS)\d\d$/.test(ctx.season) || /\d{4}$/.test(ctx.season) ? 0.9 : 0.8, { leftKind: "house", rightKind: "season" }));
  }
  // STATE: a fact about this unit right now.
  const st = state || {};
  if (String(item.availability_status || "").toLowerCase() === "sold" || st.sold === true) add(tag("state", "PRODUCT", "SOLD", 1, { leftKind: "state", rightKind: "value" }));
  if (st.offer) add(tag("state", "OFFER", st.offer, 1, { leftKind: "state", rightKind: "value" }));
  const v = String(st.verification || "").toLowerCase();
  if (v === "verified" || v === "pending" || v === "unverified") add(tag("state", "STATUS", v, 1, { leftKind: "state", rightKind: "value" }));
  if (Number.isFinite(Number(st.stock)) && st.stock !== null && st.stock !== "") add(tag("state", "STOCK", String(Math.max(0, Math.floor(Number(st.stock)))), 1, { leftKind: "state", rightKind: "value" }));
  const size = sizeValue(item.size);
  if (size) add(tag("state", "SIZE", size, 1, { leftKind: "state", rightKind: "value" }));
  if (st.owned && st.owned.handle) add(tag("state", "OWNED", (st.owned.friend ? "*" : "") + String(st.owned.handle).trim(), 1, { leftKind: "state", rightKind: "value", keepCase: true }));

  return out.sort(compareTags);
}

export function compareTags(a, b) {
  const fa = FAMILIES.indexOf(a.family), fb = FAMILIES.indexOf(b.family);
  if (fa !== fb) return fa - fb;
  if (a.family === "identity") {
    const ra = LEFT_RANK[a.leftKind] ?? 99, rb = LEFT_RANK[b.leftKind] ?? 99;
    if (ra !== rb) return ra - rb;
    return b.confidence - a.confidence || a.left.localeCompare(b.left);
  }
  if (a.family === "lineage") {
    const ra = a.leftKind === "maker" ? 0 : 1, rb = b.leftKind === "maker" ? 0 : 1;
    return ra - rb || a.left.localeCompare(b.left);
  }
  return (STATE_ORDER[a.left] ?? 99) - (STATE_ORDER[b.left] ?? 99);
}

/**
 * Three visible, the rest behind the product. The three are the first
 * three at or above VISIBLE_MIN in the blueprint's order; a state tag that
 * matters now takes the third slot and the tag it displaces goes behind.
 * Behind holds every other written tag, in order.
 */
export function visibleTags(tags = [], n = VISIBLE) {
  const written = tags.filter((t) => t.confidence >= WRITE_MIN);
  const certain = written.filter((t) => t.confidence >= VISIBLE_MIN);
  let shown = certain.slice(0, n);
  const urgent = certain.find((t) => t.family === "state" && URGENT_STATE.has(t.left));
  if (urgent && !shown.includes(urgent)) shown = [...shown.slice(0, Math.max(0, n - 1)), urgent];
  const behind = written.filter((t) => !shown.includes(t));
  return { shown, behind };
}

// ---- tags as queries --------------------------------------------------------------

/**
 * `SILVER: JEWELRY` typed into Search is a tag; `SILVER:` alone is a left
 * side. `{ left, right }` with right null for a bare left; null when the
 * text is not tag-shaped (no colon, two colons, an empty left).
 */
export function parseTagQuery(query) {
  const text = String(query || "").trim();
  const parts = text.split(":");
  if (parts.length !== 2) return null;
  const left = foldSide(parts[0]), right = foldSide(parts[1]);
  if (!left || left.length > 60 || right.length > 60) return null;
  return { left, right: right || null, text: right ? `${left}: ${right}` : `${left}:` };
}

/** Does this record carry a tag with that left (and, when asked, that right)? */
export function itemHasTag(item, parsed, opts = {}) {
  if (!parsed || !parsed.left) return false;
  const tags = Array.isArray(opts.tags) ? opts.tags : tagsFor(item, opts);
  return tags.some((t) => foldSide(t.left) === parsed.left && (parsed.right == null || foldSide(t.right) === parsed.right));
}

/** The sentence for a tag query: the count, or the honest miss. */
export function tagNote(parsed, count, leftCount = 0) {
  if (!parsed) return null;
  const n = Number(count) || 0;
  if (n) return `${parsed.text} — ${n} piece${n === 1 ? "" : "s"} carr${n === 1 ? "ies" : "y"} that tag`;
  if (parsed.right && leftCount) return `nothing here is tagged ${parsed.text} — ${leftCount} piece${leftCount === 1 ? "" : "s"} carr${leftCount === 1 ? "ies" : "y"} ${parsed.left}:`;
  return `nothing here is tagged ${parsed.text}`;
}
