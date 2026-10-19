// tests/seo.test.js — what the site tells a crawler must match what it tells a reader.
//
// The catalog is a demo: every piece is a synthetic sample record, not real
// inventory (owner ruling, #212), and the page says so in a red-bordered banner.
// Search metadata is the same promise made to a machine, so it is held to the
// same standard. See docs/seo-notes.md for the reasoning; these tests are that
// document made executable.
//
// The sharpest rule here is a NEGATIVE one: no Product JSON-LD. Structured
// product data is what puts a price and an availability into a search result and
// into Google Shopping. Every product on this site is fabricated, so emitting it
// would push invented prices into a shopping index — and unlike a labelled page,
// a rich result carries no banner explaining itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITE_ORIGIN, siteUrl } from "../lib/site.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// Routes whose pages render per-identity state. These must be noindex AND
// disallowed — the two mechanisms do different jobs (see the notes).
const PERSONAL = ["board", "profile", "settings", "orders", "asterisk", "upload", "stats", "admin"];
// Public destinations that carry a social card.
const PUBLIC = ["cover", "discover", "hotlist", "stylist"];

test("the root layout can resolve a canonical at all", () => {
  const layout = read("app/layout.js");
  // Without metadataBase every relative canonical and og:url resolves relative,
  // which is worthless to a crawler.
  //
  // This asserted the literal `new URL("https://www.asilummagazine.com")` until
  // 17 August, when the origin moved into lib/site.js (ruling 7's code half) —
  // and it went red, which is how a load-bearing test behaves. It now checks the
  // wiring here and the RESOLVED value there, which is strictly stronger: the
  // old form would have passed a lib/site.js whose default was the wrong host.
  assert.match(layout, /metadataBase:\s*new URL\(SITE_ORIGIN\)/);
  assert.match(layout, /from "\.\.\/lib\/site\.js"/);
  assert.equal(SITE_ORIGIN, "https://www.asilummagazine.com");
  // A title template, so routes stop sharing one title.
  // "magazine" is part of the name and is never dropped (owner directive,
  // 17 Aug). This assertion went red when that rule landed, which is what a
  // load-bearing test does. tests/brand-name.test.js is the rule itself.
  assert.match(layout, /template:\s*"%s · \*ASILUM"/);
  assert.match(layout, /alternates:\s*\{\s*canonical:\s*"\/"/);
});

test("every personal surface is noindex and self-canonical", () => {
  for (const route of PERSONAL) {
    const p = `app/${route}/layout.js`;
    assert.ok(existsSync(ROOT + p), `${route} has a segment layout carrying metadata`);
    const src = read(p);
    assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, `${route} is noindex`);
    // Self-referential: inheriting the root's "/" would tell a crawler the
    // content really lives at the homepage while also saying do not index it.
    assert.match(src, new RegExp(`canonical:\\s*"/${route}"`), `${route} canonicalises to itself`);
  }
});

test("robots.txt and the noindex set do not disagree", () => {
  // These drifted once already: /upload was noindex in metadata but missing
  // from the disallow list, so a crawler was free to fetch it.
  const robots = read("app/robots.js");
  for (const route of PERSONAL) {
    assert.match(robots, new RegExp(`"/${route}"`),
      `/${route} is noindex in metadata, so robots.txt must disallow it too`);
  }
});

test("every public destination carries a canonical and a social card", () => {
  for (const route of PUBLIC) {
    const src = read(`app/${route}/layout.js`);
    assert.match(src, new RegExp(`canonical:\\s*"/${route}"`), `${route} has a canonical`);
    assert.match(src, /openGraph:\s*\{/, `${route} has an OpenGraph block`);
    // Absolute, and absolute through the ONE origin — see lib/site.js. The
    // resolved value is asserted too, so this cannot pass on a wrong default.
    assert.match(src, new RegExp(`url:\\s*siteUrl\\("/${route}"\\)`),
      `${route} og:url resolves through lib/site.js`);
    assert.equal(siteUrl(`/${route}`), `https://www.asilummagazine.com/${route}`);
    assert.match(src, /siteName:\s*"\*ASILUM"/);
  }
});

test("the sitemap lists the public destinations and no personal one", () => {
  const sitemap = read("app/sitemap.js");
  for (const route of PUBLIC) {
    assert.match(sitemap, new RegExp(`"/${route}"`), `/${route} is in the sitemap`);
  }
  for (const route of PERSONAL) {
    assert.doesNotMatch(sitemap, new RegExp(`BASE \\+ "/${route}"`),
      `/${route} is personal and must not be advertised`);
  }
});

// ------------------------------------------------- the rule that matters most

test("no Product JSON-LD anywhere while the catalog is synthetic", () => {
  const files = [];
  (function walk(d) {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const p = d + "/" + entry;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(entry)) files.push(p);
    }
  })(ROOT + "app");

  for (const file of files) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (!/application\/ld\+json/.test(src)) continue;
    // Any structured data at all is fine — Organization and WebSite are honest.
    // Product, Offer and AggregateRating are not, because the products are not real.
    for (const forbidden of ['"@type": "Product"', '"@type":"Product"', '"@type": "Offer"', '"@type":"Offer"', "AggregateRating"]) {
      assert.equal(src.includes(forbidden), false,
        `${file.slice(ROOT.length)} emits ${forbidden} — the catalog is synthetic sample data`);
    }
  }
});

test("no metadata promises an image the repo cannot serve", () => {
  // A card that declares an image it cannot serve renders as broken, and
  // inventing a placeholder to satisfy a checklist is the same failure smaller.
  // The rule is a PAIRING, and since 17 August it is pinned in BOTH directions:
  // a large card requires a source, and a source requires a large card.
  //
  // Rewritten from a version whose only real branch asserted `card: "summary"`.
  // It also used `openGraph:[\s\S]*?images:` — an unbounded reach of exactly the
  // shape already recorded as a trap in this repo (a guard that matched an
  // unrelated token fifteen lines away and stayed green under revert).
  const layout = read("app/layout.js");

  // Three ways an image can legitimately exist. The generated metadata route is
  // the one in use; the static files stay valid answers.
  const hasSource =
    existsSync(ROOT + "app/opengraph-image.js") ||
    existsSync(ROOT + "public/og.png") ||
    existsSync(ROOT + "public/og.jpg");

  const large = /card:\s*"summary_large_image"/.test(layout);
  const small = /card:\s*"summary"/.test(layout);
  assert.ok(large || small, "the layout must declare a twitter card of some size");

  if (large) {
    assert.ok(hasSource,
      "summary_large_image with no image source renders a broken preview");
  } else {
    assert.ok(!hasSource,
      "an image source exists — the card should be summary_large_image, not summary");
  }
});

test("public descriptions distinguish native inventory from synthetic samples", () => {
  // The dynamic page banner is more specific; static metadata must name both.
  for (const path of ["app/layout.js", "app/discover/layout.js", "app/stylist/layout.js"]) {
    const source = read(path);
    assert.match(source, /native Storefront/i);
    assert.match(source, /synthetic sample/i);
  }
});

test("search verification tags are env-gated, never hardcoded", () => {
  // Ownership proofs for Search Console / Bing Webmaster render ONLY when the
  // owner sets the env var (seo-notes § getting indexed). A hardcoded token
  // would claim ownership on every fork and preview of this repo.
  const layout = read("app/layout.js");
  assert.match(layout, /GOOGLE_SITE_VERIFICATION\s*\?/,
    "the google tag renders only when the env var is set");
  assert.match(layout, /BING_SITE_VERIFICATION\s*\?/,
    "the bing tag renders only when the env var is set");
  assert.match(layout, /msvalidate\.01/,
    "bing's meta name is the one its tools verify");
});

test("the GSC ownership file stays served — Google warns it must never be removed", () => {
  // public/google51f90316d9e929c9.html proves ownership of the
  // https://www.asilummagazine.com property to the owner's Search Console
  // account (asilum@…, verified 21 Aug 2026). Deleting it silently
  // un-verifies the property and takes the sitemap + index reports with it.
  const f = readFileSync(new URL("../public/google51f90316d9e929c9.html", import.meta.url), "utf8");
  assert.equal(f, "google-site-verification: google51f90316d9e929c9.html");
});
