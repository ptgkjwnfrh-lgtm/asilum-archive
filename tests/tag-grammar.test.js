// tests/tag-grammar.test.js — THE TAG GRAMMAR (V.2 Blueprint, owner, 17 Oct
// 2026, Part I "Tag grammar"; slice 4), pure. The laws:
//   * one shape, LEFT: RIGHT, uppercase, one colon, one space;
//   * three families — identity, lineage, state — in that order;
//   * the left-side hierarchy MAKER → HOUSE → SCENE → AESTHETIC → MATERIAL →
//     ERA → PLACE, each needing its own evidence; UNKNOWN never appears;
//   * three visible, all at or above 75%; under 50% not written; a state
//     that matters now takes the third slot and pushes a lineage tag behind;
//   * the consistency check: EAMES: CASSETTE fails on a chair, PUNK: CHAIR
//     fails without scene evidence, FW16: EAMES fails outright;
//   * tags are queries: SILVER: JEWELRY is a tag, SILVER: a left side;
//   * OWNED keeps the username's case and wears the friend asterisk;
//   * the Feed card and the listing show the same first three.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tagsFor, visibleTags, formatTag, checkTag, contextOf, objectOf, seasonCode, sizeValue, makersOf,
  parseTagQuery, itemHasTag, tagNote, tagQueries, VISIBLE, VISIBLE_MIN, WRITE_MIN, LEFT_ORDER, STATE_KEYS, URGENT_STATE,
} from "../lib/tagging/grammar.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const fmt = (tags) => tags.map(formatTag);
const supreme = CATALOG.find((it) => it.id === "syn-0003"); // Supreme — bomber jacket, Resort 2016, XL
const bode = CATALOG.find((it) => it.id === "syn-0002");    // Bode — varsity jacket, credited to Emily Adams Bode Aujla, L fits XL

test("the constants are the blueprint's", () => {
  assert.equal(VISIBLE, 3); assert.equal(VISIBLE_MIN, 0.75); assert.equal(WRITE_MIN, 0.5);
  assert.deepEqual(LEFT_ORDER, ["maker", "house", "scene", "aesthetic", "material", "era", "place"]);
  assert.deepEqual(STATE_KEYS, ["PRODUCT", "OFFER", "STATUS", "STOCK", "SIZE", "OWNED"]);
  assert.ok(URGENT_STATE.has("PRODUCT") && URGENT_STATE.has("OFFER") && !URGENT_STATE.has("SIZE"));
});

test("one shape: LEFT: RIGHT, uppercase, one colon followed by one space", () => {
  for (const t of tagsFor(supreme)) {
    const text = formatTag(t);
    assert.match(text, /^[^:]+: [^:]+$/, text);
    assert.equal(text, text.toUpperCase(), text);
    assert.equal(t.key, t.family + ":" + t.left + ":" + t.right);
  }
});

test("the object noun: the catalog's title shape, a free title's last garment noun, the department as the fallback; two words at most", () => {
  assert.equal(objectOf(supreme), "BOMBER JACKET");
  assert.equal(objectOf({ title: "Lemaire — pleated wool trouser" }), "PLEATED TROUSER", "a non-final material word belongs to MATERIAL");
  assert.equal(objectOf({ title: "Carhartt WIP — baggy denim" }), "BAGGY DENIM", "a final material word is the noun");
  assert.equal(objectOf({ title: "Salomon — climbing approach shoe" }), "APPROACH SHOE", "never three");
  assert.equal(objectOf({ title: "Vintage 90s Helmut Lang Leather Jacket Size M" }), "JACKET");
  assert.equal(objectOf({ title: "Dior Homme Hedi Slimane Era Silk Striped Tie Made In Italy", category: "tops" }), "TIE", "a tie is a TIE before it is a TOP");
  assert.equal(objectOf({ title: "90s Vintage Jean Paul Gaultier Sunglasses 56-6201", category: "bottoms" }), "SUNGLASSES", "the title's noun outranks a misfiled department");
  assert.equal(objectOf({ title: "", category: "knitwear" }), "KNIT");
  assert.equal(objectOf({ title: "", category: "outerwear" }), "OUTERWEAR");
  assert.equal(objectOf({}), null, "no noun is no tag, not UNKNOWN");
});

test("seasons are the only abbreviations; years stay four digits; SIZE: XL (L) is tag XL, measured L", () => {
  assert.equal(seasonCode({ season: "Fall/Winter", year: 2016 }), "FW16");
  assert.equal(seasonCode({ season: "Spring/Summer", year: 2019 }), "SS19");
  assert.equal(seasonCode({ season: "Resort", year: 2020 }), "RESORT 2020");
  assert.equal(seasonCode({ year: 1956 }), "1956");
  assert.equal(seasonCode({ decade: "1970s" }), "1970S");
  assert.equal(seasonCode(null), null);
  assert.equal(sizeValue({ label: "XL", fitsLikeUS: "L" }), "XL (L)");
  assert.equal(sizeValue({ label: "XL", fitsLikeUS: "XL" }), "XL");
  assert.equal(sizeValue({ fitsLikeUS: "L" }), null, "no printed size is no tag");
});

test("the hierarchy: a house on the identity, the credited maker in the lineage, the season after; aesthetics and the house's base behind", () => {
  const tags = tagsFor(bode);
  assert.deepEqual(makersOf(bode), ["EMILY ADAMS BODE AUJLA"], "the house is not its own maker");
  assert.ok(tags.filter((t) => t.family === "identity").length >= 2 && tags[0].leftKind === "house", "identity first, the house strongest");
  const { shown, behind } = visibleTags(tags);
  assert.deepEqual(fmt(shown), ["BODE: VARSITY JACKET", "EMILY ADAMS BODE AUJLA: BODE", "BODE: RESORT 2020"]);
  assert.ok(behind.some((t) => t.leftKind === "aesthetic" && t.confidence < VISIBLE_MIN), "an inferred aesthetic is not certain");
  assert.ok(behind.some((t) => formatTag(t) === "NEW YORK: VARSITY JACKET" && t.confidence === 0.7), "the house's base stays behind the product");
  assert.ok(behind.some((t) => formatTag(t) === "SIZE: L (XL)"), "the size is a state, after identity and lineage");
  assert.ok(!tags.some((t) => t.confidence < WRITE_MIN), "under 50% is not written");
  assert.ok(tags.every((t, i) => i === 0 || ["identity", "lineage", "state"].indexOf(t.family) >= ["identity", "lineage", "state"].indexOf(tags[i - 1].family)), "families in order");
});

test("a maker stands on the identity only when there is no house; an era stands alone only when nothing above MATERIAL is known", () => {
  const maker = tagsFor({ title: "", brand: "Unknown", category: "knitwear", designers: ["Someone"], era: { decade: "1970s" } });
  assert.deepEqual(fmt(maker), ["SOMEONE: KNIT"]);
  const era = tagsFor({ title: "", brand: "", category: "accessories", era: { season: "Fall/Winter", year: 2016 } });
  assert.deepEqual(fmt(era), ["FW16: ACCESSORY"]);
  assert.deepEqual(tagsFor({}), [], "nothing on the record, no tag");
  assert.ok(!fmt(tagsFor({ title: "", brand: "Unknown", category: "tops" })).some((t) => /UNKNOWN/.test(t)), "UNKNOWN never appears");
  // a supplier's placeholder is not a fact (measured on the live feed: NOT AVAILABLE: SHIRT)
  const ebay = tagsFor({ title: "Vintage Gianni Versace Jeans Couture Shirt Large 90s", brand: "Not Available", designers: ["Not Available"], category: "tops", era: { decade: "1990s" }, size: { label: "Not Available", fitsLikeUS: "L" } });
  assert.ok(!fmt(ebay).some((t) => /NOT AVAILABLE|UNBRANDED|N\/A/.test(t)), fmt(ebay).join(" · "));
  assert.deepEqual(fmt(ebay), ["1990S: SHIRT"], "with no house and no maker the era stands alone");
  assert.equal(sizeValue({ label: "N/A" }), null);
  assert.equal(sizeValue({ label: "29", fitsLikeUS: "Not Available" }), "29");
});

test("a material on the left needs the literal word on the record; a typed row from ASTERISK adds scene, material and origin", () => {
  const derby = tagsFor({ title: "Salomon — leather derby", brand: "Salomon", category: "footwear" });
  assert.ok(fmt(derby).includes("LEATHER: DERBY"));
  const typed = [
    { tag: "punk", tagType: "subculture", confidence: 0.8, source: "asterisk" },
    { tag: "silk", tagType: "material", confidence: 0.9, source: "admin" },
    { tag: "tokyo", tagType: "origin", confidence: 0.9, source: "asterisk" },
    { tag: "lace", tagType: "material", confidence: 0.4, source: "asterisk" },
  ];
  const t = tagsFor(supreme, { typed });
  assert.ok(fmt(t).includes("PUNK: BOMBER JACKET") && fmt(t).includes("SILK: BOMBER JACKET") && fmt(t).includes("TOKYO: BOMBER JACKET"));
  assert.ok(!fmt(t).includes("LACE: BOMBER JACKET"), "a row under 50% is not written");
  assert.equal(fmt(visibleTags(t).shown)[1], "PUNK: BOMBER JACKET", "SCENE outranks the season in the lineage");
});

test("three visible; a state that matters now takes the third slot and pushes a lineage tag behind", () => {
  const sold = tagsFor({ ...bode, availability_status: "sold" }, { state: { verification: "verified" } });
  const { shown, behind } = visibleTags(sold);
  assert.deepEqual(fmt(shown), ["BODE: VARSITY JACKET", "EMILY ADAMS BODE AUJLA: BODE", "PRODUCT: SOLD"]);
  assert.ok(fmt(behind).includes("BODE: RESORT 2020"), "the displaced lineage tag went behind");
  assert.ok(fmt(behind).includes("STATUS: VERIFIED"), "a status that is not urgent waits its turn");
  const offer = visibleTags(tagsFor(bode, { state: { offer: "accepted", stock: 3 } }));
  assert.equal(fmt(offer.shown)[2], "OFFER: ACCEPTED");
  assert.ok(fmt(offer.behind).includes("STOCK: 3"));
  assert.equal(visibleTags(tagsFor(bode), 3).shown.length, 3);
  assert.equal(visibleTags([]).shown.length, 0);
});

test("OWNED keeps the username's own case and carries the friend asterisk", () => {
  const t = tagsFor(bode, { state: { owned: { handle: "no_emos_allowed", friend: true } } });
  assert.ok(fmt(t).includes("OWNED: *no_emos_allowed"));
  const plain = tagsFor(bode, { state: { owned: { handle: "Conner_Sokool", friend: false } } });
  assert.ok(fmt(plain).includes("OWNED: Conner_Sokool"));
  assert.ok(!fmt(tagsFor(bode, { state: { owned: { friend: true } } })).some((x) => x.startsWith("OWNED")), "no handle, no tag");
});

test("the consistency check: EAMES: CASSETTE fails on a chair, PUNK: CHAIR fails without scene evidence, FW16: EAMES fails outright", () => {
  const chair = { title: "Herman Miller — lounge chair", brand: "Herman Miller", designers: ["Eames", "Herman Miller"], category: "accessories", era: { season: "Fall/Winter", year: 2016 } };
  const ctx = contextOf(chair);
  assert.equal(ctx.object, "LOUNGE CHAIR");
  assert.equal(checkTag({ family: "identity", left: "EAMES", right: "CASSETTE" }, ctx).ok, false, "the record's object is a chair");
  assert.equal(checkTag({ family: "identity", left: "PUNK", right: "LOUNGE CHAIR" }, ctx).ok, false, "no scene evidence");
  assert.equal(checkTag({ family: "identity", left: "PUNK", right: "LOUNGE CHAIR" }, contextOf(chair, { typed: [{ tag: "punk", tagType: "subculture", confidence: 0.8 }] })).ok, true);
  assert.equal(checkTag({ family: "lineage", left: "FW16", right: "EAMES" }, ctx).ok, false, "an era is not a maker");
  assert.equal(checkTag({ family: "identity", left: "FW16", right: "EAMES" }, ctx).ok, false, "a maker is not a noun");
  assert.equal(checkTag({ family: "lineage", left: "EAMES", right: "HERMAN MILLER" }, ctx).ok, true);
  assert.equal(checkTag({ family: "lineage", left: "HERMAN MILLER", right: "FW16" }, ctx).ok, true);
  assert.equal(checkTag({ family: "identity", left: "HERMAN MILLER", right: "HERMAN MILLER" }, ctx).ok, false, "a side cannot name itself");
  assert.equal(checkTag({ family: "identity", left: "UNKNOWN", right: "LOUNGE CHAIR" }, ctx).ok, false);
  assert.equal(checkTag({ family: "identity", left: "EAMES", right: "LOUNGE CHAIR SET" }, ctx).ok, false, "never three words");
  assert.equal(checkTag({ family: "state", left: "MOOD", right: "GOOD" }, ctx).ok, false, "not a state key");
  assert.equal(checkTag({ family: "state", left: "STOCK", right: "24" }, ctx).ok, true);
  // every tag the generator writes passes its own check
  for (const it of CATALOG.slice(0, 120)) {
    const c = contextOf(it);
    for (const t of tagsFor(it, { state: { verification: "pending" } })) assert.ok(checkTag(t, c).ok, formatTag(t));
  }
});

test("tags are queries: SILVER: JEWELRY is a tag, SILVER: alone a left side, two colons nothing; a side opens its own search", () => {
  assert.deepEqual(parseTagQuery("Silver: Jewelry"), { left: "SILVER", right: "JEWELRY", text: "SILVER: JEWELRY" });
  assert.deepEqual(parseTagQuery("silver:"), { left: "SILVER", right: null, text: "SILVER:" });
  assert.equal(parseTagQuery("a:b:c"), null);
  assert.equal(parseTagQuery("bomber jacket"), null);
  assert.equal(parseTagQuery(": jewelry"), null, "an empty left is not a tag");
  const q = parseTagQuery("supreme: bomber jacket");
  assert.equal(itemHasTag(supreme, q), true);
  assert.equal(itemHasTag(bode, q), false);
  assert.equal(itemHasTag(supreme, parseTagQuery("supreme:")), true);
  assert.equal(itemHasTag(supreme, parseTagQuery("streetwear:")), true, "search uses the full set, visible or not");
  assert.deepEqual(tagQueries(tagsFor(supreme)[0]), { left: "supreme", right: "bomber jacket", whole: "supreme: bomber jacket" });
  assert.equal(tagNote(q, 1), "SUPREME: BOMBER JACKET — 1 piece carries that tag");
  assert.equal(tagNote(parseTagQuery("supreme: cassette"), 0, 19), "nothing here is tagged SUPREME: CASSETTE — 19 pieces carry SUPREME:");
  assert.equal(tagNote(parseTagQuery("silver:"), 0), "nothing here is tagged SILVER:");
});

test("the Feed card and the listing show the same first three: one function over one record", () => {
  for (const it of CATALOG.slice(0, 60)) {
    const card = fmt(visibleTags(tagsFor(it)).shown);
    const listing = fmt(visibleTags(tagsFor(it, { typed: [] , state: { verification: null } })).shown);
    assert.deepEqual(card, listing, it.title);
    assert.ok(card.length >= 1 && card.length <= 3);
  }
});
