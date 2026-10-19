// tests/provenance.test.js
// OWNER RULING, 27 AUGUST 2026: marketplace inventory is INGESTED, LABELLED,
// AND NOT HIDDEN. These are the assertions that fail when it starts being
// hidden again — by omission on a new surface, or by a source quietly being
// treated as backed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import {
  originEvidence, brandIsEstablished, DEMO, VERIFIED, UNVERIFIED,
} from "../lib/provenance.js";
import { publicProduct } from "../lib/products.js";

const live = (source) => ({
  id: "p1", title: "coat", brand: "Balenciaga", price: 100,
  source_name: source, source_product_url: "https://example.com/item/1",
});

test("a marketplace listing is unverified, and its brand is a CLAIM", () => {
  for (const source of ["taobao", "yahoo-auctions", "mercari", "rakuma", "buyee", "zenmarket", "ebay"]) {
    const e = originEvidence(live(source));
    assert.equal(e.status, UNVERIFIED, `${source} must not read as backed`);
    assert.equal(e.brandIsClaim, true,
      `${source}: the brand on a marketplace listing is the seller's word`);
    assert.ok(e.note && e.note.length > 20, `${source} must carry a sentence to show`);
  }
});

test("Taobao names itself, because 'unverified' alone tells a reader nothing", () => {
  const e = originEvidence(live("taobao"));
  assert.match(e.note, /Taobao/, "the reader is told WHERE it is listed");
  assert.match(e.note, /not a fact ASILUM has checked/,
    "and told plainly that nobody checked the brand");
});

test("VERIFICATION IS EARNED — an unknown source gets no benefit of the doubt", () => {
  // The direction of this default is the whole safety property. Guessing
  // "verified" tells a reader something is genuine when nobody checked.
  const e = originEvidence(live("some-source-nobody-registered"));
  assert.equal(e.status, UNVERIFIED);
  assert.equal(e.brandIsClaim, true);
  assert.equal(brandIsEstablished(live("some-source-nobody-registered")), false);
});

test("a merchant under agreement is backed — and that is about the MERCHANT", () => {
  for (const source of ["shopify", "woocommerce"]) {
    const e = originEvidence(live(source));
    assert.equal(e.status, VERIFIED);
    assert.equal(e.brandIsClaim, false);
    // It must never read as a claim about the garment itself.
    assert.doesNotMatch(e.note, /authentic|genuine|verified item/i,
      "ASILUM authenticates nothing; this is an agreement with a merchant");
  }
});

test("a record with no live link is a sample, whatever it calls itself", () => {
  assert.equal(originEvidence({ id: "x", source_name: "taobao" }).status, DEMO);
  assert.equal(originEvidence({ id: "x", source_name: "Asilum synthetic seed" }).status, DEMO);
  assert.equal(originEvidence(null).status, DEMO);
});

test("a server-marked native listing is real inventory without a fabricated source URL", () => {
  const native = {
    id: "native-one", title: "lamp", price: 100, price_cents: 10_000,
    commerce_rail: "native_storefront", source_name: "asilum-native",
    native_listing_id: "lst-one", storefront_slug: "night-objects",
    inventory_available: 1, native_checkout_ready: true, availability_status: "available",
  };
  const evidence = originEvidence(native);
  assert.equal(evidence.status, UNVERIFIED);
  assert.equal(evidence.brandIsClaim, true);
  assert.match(evidence.note, /seller's description/);
  const payload = publicProduct(native);
  assert.equal(payload.commerce_rail, "native_storefront");
  assert.equal(payload.inventory_available, 1);
  assert.equal(payload.purchasable, true);
});

test("every public payload carries its provenance", () => {
  // Stamped server-side beside `purchasable`, so no client re-derives the rule
  // and drifts from it.
  const payload = publicProduct(live("taobao"));
  assert.ok(payload.originEvidence, "publicProduct must stamp originEvidence");
  assert.equal(payload.originEvidence.status, UNVERIFIED);
  assert.equal(payload.originEvidence.brandIsClaim, true);
});

test("NOT HIDDEN: every surface that shows a piece shows what backs it", () => {
  // The ruling's teeth. A new grid that renders ColorEvidenceLine without
  // OriginLine is a surface where marketplace stock appears unlabelled — which
  // is exactly the thing the owner ruled against — so the two are pinned
  // together and this fails the moment they come apart.
  const files = execSync(
    "grep -rl 'ColorEvidenceLine' app --include=*.js --include=*.jsx || true",
    { encoding: "utf8" },
  ).trim().split("\n").filter(Boolean);

  assert.ok(files.length >= 7, "expected the known product surfaces");
  for (const file of files) {
    if (file.endsWith("ProductSignals.jsx")) continue; // where both are defined
    const src = readFileSync(file, "utf8");
    const colour = (src.match(/<ColorEvidenceLine\b/g) || []).length;
    const origin = (src.match(/<OriginLine\b/g) || []).length;
    assert.equal(origin, colour,
      `${file} renders ${colour} colour line(s) but ${origin} provenance line(s) — `
      + "a piece must not be shown without what backs it");
  }
});

test("the label is loud where it knows least, quiet only where it is backed", () => {
  const src = readFileSync("app/components/ProductSignals.jsx", "utf8");
  const component = src.slice(src.indexOf("export function OriginLine"));
  // Only the VERIFIED branch may return null, and only on a card.
  assert.match(component, /evidence\.status === "verified" && !detailed[\s\S]*?return null/,
    "silence is reserved for a merchant under agreement");
  assert.match(component, /UNVERIFIED ORIGIN/, "the unverified state says so in words");
});

// ---- the 27 August rulings, part two ---------------------------------------

import {
  stakeOf, STAKE_NONE, STAKE_LOW, STAKE_MATERIAL, STAKE_HIGH,
} from "../lib/provenance.js";
import { rankSearchResults, interpretSearchQuery } from "../lib/search/index.js";

const priced = (price, source = "taobao") => ({
  id: `p-${price}-${source}`, title: "wool coat", brand: "Balenciaga", price,
  source_name: source, source_product_url: "https://example.com/item/1",
  tags: { MINIMAL: 0.8 },
});

test("what is riding on the claim scales with the price", () => {
  // The owner's reasoning: at a low price the piece is bought for itself; at a
  // high price the NAME is most of what is bought, and the name is unchecked.
  assert.equal(stakeOf(priced(40)).level, STAKE_LOW);
  assert.equal(stakeOf(priced(300)).level, STAKE_MATERIAL);
  assert.equal(stakeOf(priced(900)).level, STAKE_HIGH);
});

test("a backed piece and a sample both carry no stake, for opposite reasons", () => {
  assert.equal(stakeOf(priced(900, "woocommerce")).level, STAKE_NONE);
  assert.equal(stakeOf({ id: "x", price: 900, source_name: "seed" }).level, STAKE_NONE);
});

test("an unreadable price does not get the benefit of the doubt", () => {
  // "We do not know what it costs" is not a reason to reassure somebody, so a
  // missing price lands on MATERIAL rather than LOW.
  for (const price of [null, undefined, 0, -5, "ask"]) {
    assert.equal(stakeOf(priced(price)).level, STAKE_MATERIAL,
      `price ${String(price)} must not read as low stake`);
  }
});

test("UNVERIFIED STOCK IS NOT DEMOTED — ranking never reads provenance", () => {
  // The owner ruled it explicitly: mark it, do not demote it. Demotion is a
  // soft form of hiding. This asserts the ranking layer cannot even see the
  // provenance fields, so a future change cannot quietly start weighting them.
  const rank = readFileSync("lib/search/index.js", "utf8");
  for (const leak of ["originEvidence", "brandIsClaim", "stakeOf", "provenance.js"]) {
    assert.doesNotMatch(rank, new RegExp(leak),
      `lib/search must not read ${leak} — unverified stock ranks the same`);
  }
  const brain = readFileSync("lib/brain/index.js", "utf8");
  for (const leak of ["originEvidence", "brandIsClaim", "provenance.js"]) {
    assert.doesNotMatch(brain, new RegExp(leak),
      `lib/brain must not read ${leak} — unverified stock ranks the same`);
  }
});

test("two identical pieces rank identically whatever backs them", async () => {
  // The property itself, not just the absence of an import.
  const verified = { ...priced(900, "woocommerce"), id: "same-a" };
  const unverified = { ...priced(900, "taobao"), id: "same-b" };
  const pool = [verified, unverified];
  const interpreted = await interpretSearchQuery("wool coat", { pool, mappings: [] });
  const ranked = rankSearchResults(pool, interpreted);
  const a = ranked.find((r) => r.id === "same-a");
  const b = ranked.find((r) => r.id === "same-b");
  assert.ok(a && b, "both pieces must survive ranking");
  assert.equal(a._score, b._score,
    "provenance must not move a score — mark it, never demote it");
});

test("the sticker sits on every true listing surface", () => {
  // "top left of the listing" — the four surfaces that render a listing card
  // over an image. The other product surfaces are compact rows and carry the
  // sentence instead.
  for (const file of ["app/page.js", "app/discover/page.js", "app/board/page.js",
                      "app/u/[handle]/page.js"]) {
    const src = readFileSync(file, "utf8");
    const wraps = (src.match(/className="imgwrap"/g) || []).length;
    const sticks = (src.match(/<OriginSticker\b/g) || []).length;
    assert.equal(sticks, wraps,
      `${file}: ${wraps} listing image(s) but ${sticks} sticker(s)`);
  }
});

test("the sticker is decorative, because the sentence already speaks", () => {
  // Two of the four imgwraps are aria-hidden. Marking the sticker consistently
  // hidden is what stops provenance being announced twice on some cards and
  // once on others — OriginLine is the accessible statement everywhere.
  const src = readFileSync("app/components/ProductSignals.jsx", "utf8");
  const component = src.slice(src.indexOf("export function OriginSticker"),
                              src.indexOf("export function OriginLine"));
  const spans = (component.match(/<span /g) || []).length;
  const hidden = (component.match(/<span aria-hidden="true"/g) || []).length;
  assert.equal(hidden, spans, "every sticker variant must be aria-hidden");
});
