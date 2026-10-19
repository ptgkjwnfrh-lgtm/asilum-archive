// tests/piece-url.test.js — the stable piece URL, and the two rules it obeys.
//
// `/piece/<id>` exists to solve one problem: a shared piece link previewed as
// the generic site card, because `/?item=<id>` is a query parameter on a CLIENT
// component and a client component cannot export `generateMetadata`. Option (a)
// of the ruling in docs/seo-notes.md, chosen by the owner.
//
// Two constraints make this route unusual, and both are easy to undo by
// accident:
//
//   RULE 8 (owner decree, asilum-ui): "item depth belongs to the item modal."
//   This page carries metadata and hands off. The moment someone renders price,
//   tags, favourite/bag controls or related pieces here, the decree is broken
//   and there are two places item depth lives.
//
//   noindex WITHOUT a robots.txt disallow. Those are different jobs. noindex
//   keeps a synthetic product out of search results; leaving the path crawlable
//   is what lets a social scraper FETCH the page and read the card. Disallowing
//   it would break the exact preview this route was built to fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PAGE = "app/piece/[id]/page.js";

test("the route exists and is a server component", () => {
  assert.ok(existsSync(ROOT + PAGE), "app/piece/[id]/page.js exists");
  const src = read(PAGE);
  // The whole reason this route exists is that a client component cannot export
  // generateMetadata. Marking it "use client" would silently undo the fix.
  assert.doesNotMatch(src, /^\s*"use client"/m,
    "this page must stay a server component or it cannot emit per-piece metadata");
  assert.match(src, /export async function generateMetadata/);
});

test("the metadata is per-piece, self-canonical and noindex", () => {
  const src = read(PAGE);
  // Per-piece: the name comes from the item, not a constant.
  assert.match(src, /title: name/, "the title is the piece's own name");
  assert.match(src, /alternates: \{ canonical: `\/piece\/\$\{encodeURIComponent\(item\.id\)\}` \}/,
    "canonical points at this piece's own URL");
  assert.match(src, /robots: \{ index: false, follow: false \}/,
    "a synthetic product stays out of the index");
  assert.match(src, /openGraph:/);
  assert.match(src, /url,/, "og:url is the absolute piece URL");
});

test("the preview repeats the demo warning, because a card is a claim", () => {
  const src = read(PAGE);
  assert.match(src, /isDemoItem/, "the demo state is read, not assumed");
  assert.match(src, /synthetic sample record — not real inventory, not for sale/,
    "the preview says what the catalog banner says");
});

test("/piece is NOT robots-disallowed — that pairing is deliberate", () => {
  const robots = read("app/robots.js");
  assert.doesNotMatch(robots, /"\/piece/,
    "a disallow would stop a social scraper fetching the page, which is the only reason this route exists");
  // The reasoning is recorded where someone would otherwise 'tidy' it away.
  assert.match(robots, /noindex and disallow are different jobs/i);
});

test("the page does not render item depth — rule 8 stays intact", () => {
  const src = read(PAGE).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Depth signals. Any of these appearing means the item detail now has two
  // homes, which the owner decree forbids.
  for (const depth of ["price", "Favorite", "Bag", "related", "aspectFor", "thumbFor", "matchedTags"]) {
    assert.equal(src.includes(depth), false,
      `${depth} on the piece page would move item depth out of the modal (asilum-ui rule 8)`);
  }
  // What it SHOULD do instead: hand off.
  assert.match(src, /PieceHandoff/);
  assert.match(src, /\/\?item=\$\{encodeURIComponent\(item\.id\)\}/,
    "the hand-off target is the catalog with the modal open");
});

test("the hand-off replaces rather than pushes", () => {
  const handoff = read("app/piece/[id]/handoff.js");
  assert.match(handoff, /router\.replace\(target\)/,
    "push would leave /piece in history, so Back from the catalog would bounce forward again");
  assert.doesNotMatch(handoff, /router\.push\(/);
});

test("sharing emits the stable path, and the old query link still works", () => {
  const page = read("app/page.js");
  // (V.2 slice 3) the share lives in lib/feed/actions.js, for the LISTING popup
  assert.match(read("lib/feed/actions.js"), /"\/piece\/" \+ encodeURIComponent\(item\.id\)/,
    "a new share is the URL that previews correctly");
  // Links already shared must not rot: the query-parameter handler stays.
  assert.match(page, /const sharedItem = sp\.get\("item"\)/,
    "/?item=<id> must keep working for links already in the wild");
});
