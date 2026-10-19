// lib/search/vocabulary.js — THE WORDS THE ENGINE KNOWS.
//
// Grammar words, garment nouns, and the stem indexes that let "sweaters" reach
// "sweater". Lifted out of lib/search/index.js, where they sat as ninety lines
// of table in the middle of the engine and answered the question a newcomer
// asks most often — "where does it decide that a trouser is bottoms?" — only
// to whoever scrolled past them.
//
// EVERY TABLE A RAW TOKEN INDEXES IS NULL-PROTOTYPE, and the two exported ones
// are read through an own-property check. This is not defensive style: a query
// word is not a property name, and "constructor jacket" once walked the
// prototype chain and set a constraint to a function. The `own` helper below
// is what stops it.
//
// Imported and RE-EXPORTED by lib/search/index.js, which stays the front door
// for everything outside this directory.

import { buildStemIndex, lookupToken } from "./vocab.js";
import { ONTOLOGY_GARMENT_NOUNS } from "./ontology.js";

// Grammar words. They never earn an item anything, so they may not vouch for
// one: not as a text hit, not as query evidence, and not as a reason a known
// cultural reading gets shadowed. Deliberately small and closed — this is the
// set that appears inside entity names ("ghost IN THE shell", "guns N roses",
// "the cure"), not a general English stoplist.
export const SEARCH_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "with", "in", "on", "at", "to",
  "by", "from", "is", "it", "its", "as", "my", "me", "your",
]);

// Garment nouns → catalog categories. When a query names a garment, category
// alignment is decisive: "trashed jeans" must surface bottoms, not slip
// dresses that happen to share an aesthetic tag.
export const GARMENT_CATEGORY = {
  jeans: "bottoms", denim: "bottoms", pants: "bottoms", trousers: "bottoms",
  cargos: "bottoms", shorts: "bottoms", skirt: "bottoms",
  tee: "tops", tees: "tops", shirt: "tops", blouse: "tops", polo: "tops",
  // hoodie/fleece follow the CATALOG, not garment taxonomy: every hoodie is a
  // top and every fleece an outerwear jacket. Mapping them to knitwear made
  // the category bonus point at a category with zero of either — plain-noun
  // queries survived (product-name match +6 dwarfs the −2), but modifier
  // queries ranked the first real hoodie 47th (measured Aug 4, r8).
  hoodie: "tops", sweater: "knitwear", knit: "knitwear", cardigan: "knitwear", fleece: "outerwear",
  jacket: "outerwear", coat: "outerwear", parka: "outerwear", puffer: "outerwear",
  bomber: "outerwear", anorak: "outerwear", vest: "outerwear",
  blazer: "tailoring", suit: "tailoring",
  dress: "dresses", gown: "dresses",
  boots: "footwear", sneakers: "footwear", shoes: "footwear", loafers: "footwear", derby: "footwear",
  bag: "accessories", belt: "accessories", hat: "accessories", beanie: "accessories",
  scarf: "accessories", necklace: "accessories",
  // (r13) Fashionpedia-informed single-word garment nouns — curated
  // crosswalk in lib/search/ontology.js, evidence base vendored in
  // fashionpedia-ontology.json (CC BY 4.0, see NOTICE).
  ...ONTOLOGY_GARMENT_NOUNS,
  // (Aug 21) The catalog's own eight category names, kept in sync with
  // GENERIC_GARMENT_NOUNS below — see the note there.
  tops: "tops", bottoms: "bottoms", outerwear: "outerwear",
  knitwear: "knitwear", footwear: "footwear", accessories: "accessories",
  tailoring: "tailoring", dresses: "dresses",
  // Native Storefront extends the shared catalog beyond garments. These are
  // literal seller-supplied category facts, not taste tags or model guesses;
  // keeping them in the engine's existing category crosswalk makes an
  // explicit "furniture" or "posters" request behave like "outerwear".
  clothing: "clothing",
  jewelry: "jewelry", jewellery: "jewelry",
  poster: "posters_prints", posters: "posters_prints",
  print: "posters_prints", prints: "posters_prints",
  furniture: "furniture",
  tech: "electronics_tech", electronics: "electronics_tech",
  ornament: "ornaments_home", ornaments: "ornaments_home",
  homeware: "ornaments_home", object: "ornaments_home", objects: "ornaments_home",
};

// Generic garment nouns name the CATEGORY, not a subtype: a hardshell parka
// IS a jacket that doesn't spell the word. For these nouns (and only these),
// the title-token hit extends to every item of the category, so "jacket that
// survives a storm" starts shells level with varsity jackets and the
// semantic re-rank (r5) decides. Subtype nouns (jeans, parka, bomber,
// hoodie…) keep literal title matching — "trashed jeans" must still rank
// jeans above trousers WITHIN bottoms.
export const GENERIC_GARMENT_NOUNS = {
  jacket: "outerwear", coat: "outerwear",
  shoes: "footwear",
  dress: "dresses",
  // (r8) every knitwear item IS a knit — turtlenecks, cardigans, crewnecks,
  // mohair sweaters. "sweater" was first REJECTED by the declared beanie
  // guard (balaclava beanies, then miscategorized as knitwear, topped the
  // sweater probes); the r8 catalog cleanup moved beanies to accessories,
  // and (r9) the retest re-admitted it under the same guard. "boots" stays
  // out (subtype of footwear); "top" stays out (the tokenizer splits
  // "high-top" into [high, top] and would penalize actual high-tops on
  // their own query).
  knit: "knitwear", sweater: "knitwear",
  // (Aug 21) A CATEGORY'S OWN NAME. The engine knew "jeans" and "parka" and
  // did not know "bottoms" — so "no denim bottoms", "mens knitwear" and
  // "cheap accessories" each returned a blank page. These are the catalog's
  // own eight category names, which makes them the most literally true
  // generic nouns there are: every item in the category IS one, by
  // definition, so the beanie guard that tests/generic-noun-consistency
  // enforces cannot fail on them.
  //
  // "top" singular stays out, deliberately: the tokenizer splits "high-top"
  // into [high, top] and the singular would credit every high-top sneaker on
  // a query for tops. The plural is safe and is what people type.
  tops: "tops", bottoms: "bottoms", outerwear: "outerwear",
  knitwear: "knitwear", footwear: "footwear", accessories: "accessories",
  tailoring: "tailoring", dresses: "dresses",
};

// (r11) stem-indexed lookups replace the strip-trailing-s heuristic: exact
// key first, Porter stem second ("trouser"→trousers, "sneaker"→sneakers,
// "cargo"→cargos now resolve). Tables above stay the single source of truth.
const GARMENT_IDX = buildStemIndex(GARMENT_CATEGORY);
const GENERIC_IDX = buildStemIndex(GENERIC_GARMENT_NOUNS);
// A QUERY WORD IS NOT A PROPERTY NAME. MEASURED: "constructor jacket" returned
// ZERO under `nothing here is unisex — 0 pieces are unisex`, because
// GENDER_WORDS["constructor"] walked the prototype chain, found
// Object.prototype.constructor, and set the gender constraint to a function.
// Every table a raw token indexes is null-prototype now, and the two exported
// ones — which callers spread and must stay ordinary objects — are read
// through an own-property check.
const own = (table, t) => (typeof t === "string" && Object.hasOwn(table, t) ? table[t] : undefined);
/** A token's garment category, or undefined. Read through an own-property
 *  check — see the note above: a query word is not a property name. */
export const garmentCategoryOf = (t) => own(GARMENT_CATEGORY, t) ?? lookupToken(GARMENT_IDX, t);
/** As garmentCategoryOf, for generic garment nouns ("jacket", "shoe"). */
export const genericNounCategoryOf = (t) => own(GENERIC_GARMENT_NOUNS, t) ?? lookupToken(GENERIC_IDX, t);
