// tests/v2-tags.test.js — V.2 SLICE 4: THE TAG GRAMMAR ON SCREEN, as the
// components wire the law in lib/tagging/grammar.js (owner's blueprint,
// 17 Oct 2026, Tag grammar: Typesetting and Behavior). Source reads where a
// .jsx cannot be imported under node's test runner; the pure law is
// tests/tag-grammar.test.js, the engine tests/tag-search.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const chip = strip(read("app/components/TagChip.jsx"));
const listing = strip(read("app/components/ListingSheet.jsx"));
const page = strip(read("app/page.js"));
const card = strip(read("app/components/PostCard.jsx"));
const search = strip(read("app/components/SearchSheet.jsx"));
const dock = strip(read("lib/dockstate.js"));
const related = strip(read("app/api/related/route.js"));
const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel) => { const i = css.indexOf("\n" + sel + " {"); return i >= 0 ? css.slice(i, css.indexOf("}", i)) : null; };

test("one renderer: the chip draws LEFT: RIGHT with the colon as its only punctuation, each side its own search", () => {
  assert.match(chip, /<button type="button" className="tl"[^>]*onClick=\{go\(queries\.left\)\}[^>]*>\{tag\.left\}:<\/button>/);
  assert.match(chip, /\{" "\}/, "one space after the colon");
  assert.match(chip, /<button type="button" className="tr" key=\{tag\.right\}[^>]*onClick=\{go\(queries\.right\)\}[^>]*>\{tag\.right\}<\/button>/);
  assert.match(chip, /setQuery\(q\);\s*openSheet\("search", \{ title: "SEARCH" \}\);/, "a tap runs the SEARCH popup, not a page");
  assert.ok(!/href=/.test(chip), "no link leaves the popup grammar");
});

test("long-press pins the tag as a filter chip on the current Search; the pins ride the request and clear with the search", () => {
  assert.match(chip, /import \{ LONG_PRESS_MS \} from "\.\.\/\.\.\/lib\/disc\.js"/, "one long-press clock");
  assert.match(chip, /haptic\("confirm"\); pinTag\(tag\);/);
  assert.match(chip, /if \(h && h\.fired\) \{ e\.preventDefault\(\); return; \}/, "the tap after a long-press does not also search");
  assert.match(dock, /export function pinTag\(tag\)/);
  assert.match(dock, /state\.pins\.length >= 6\) return;/, "six at most");
  assert.match(dock, /state\.typing = false; state\.pins = \[\];/, "closing the search clears the pins");
  assert.match(search, /qs\.set\("pins", pins\.map\(\(p\) => p\.text\)\.join\("\|"\)\)/);
  assert.match(search, /<TagChip tag=\{\{ \.\.\.p, family: "pin" \}\} pinned onUnpin=\{unpinTag\} \/>/);
});

test("the listing: three from the grammar over the record and the typed rows, the + beside the third opens BEHIND THE PRODUCT", () => {
  assert.match(listing, /import TagRow from "\.\/TagChip\.jsx";/);
  assert.match(listing, /setTyped\(Array\.isArray\(d\.typedTags\) \? d\.typedTags : \[\]\)/, "the typed layer rides /api/related");
  assert.match(related, /const typedTags = \(await getProductTags\(itemId\)/);
  assert.match(listing, /<TagRow tags=\{shown\} size="popup" more=\{\(\) => setBehind\(\(b\) => !b\)\} open=\{behind\} empty="no tags yet — ASTERISK assigns them" \/>/);
  assert.match(listing, /BEHIND THE PRODUCT/);
  assert.match(listing, /<TagRow tags=\{rest\} size="popup" label="every other tag" \/>/);
  assert.ok(!/VISIBLE_TAGS|className="t"|lstbehind|lsttags/.test(listing), "the plain chips and the old expander are gone");
});

test("the Feed card and a post's tagged piece show the same first three the listing shows", () => {
  assert.match(page, /<TagRow tags=\{visibleTags\(tagsFor\(it\)\)\.shown\} size="card" \/>/);
  assert.match(card, /<TagRow tags=\{visibleTags\(tagsFor\(pc\)\)\.shown\} size="card" \/>/);
});

test("typesetting: Michroma uppercase, 0.06em, 10px on cards and 12px in popups, a hanging indent so a tag wraps once after the colon; the retired chip rules are gone", () => {
  const tag = rule(".tag");
  assert.ok(tag, ".tag has a rule");
  assert.match(tag, /font: 10px\/1\.6 var\(--mich\)/);
  assert.match(tag, /letter-spacing: 0\.06em; text-transform: uppercase/);
  assert.match(tag, /text-indent: -1\.2em/, "the right side hangs under the left");
  assert.match(tag, /background: var\(--glass-pill\)/, "a Liquid Glass chip");
  assert.match(tag, /border-radius: 12px/);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(tag), "colour only through tokens");
  assert.match(css, /\.tagrow\.popup \.tag \{ font-size: 12px; \}/);
  assert.match(css, /\.tag \.tl, \.tag \.tr \{[^}]*white-space: nowrap/, "the only break is the space after the colon");
  assert.match(css, /\.tag\.state\.urgent \{ color: var\(--red\)/, "a state that matters now wears the accent");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tag\.state \.tr \{ animation: none; \}/);
  for (const sel of [".lsttags .t", ".lstbehind", ".lstbehind small"]) assert.equal(rule(sel), null, sel + " must be gone");
});
