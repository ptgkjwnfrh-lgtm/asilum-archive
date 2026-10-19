// tests/v2-shell.test.js — THE V.2 SHELL (owner's blueprint, 17 Oct 2026,
// Foundations): three fixtures, five deck keys, the palette, the faces, and
// no CRT. Pure data where it can be; source reads where the markup is the
// law. The blueprint supersedes the 1 October brief where they differ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DECK, UTILITIES } from "../lib/dock.js";
import { navFor, deckFor, fixtureFor } from "../lib/nav.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
// the glyph names, read from the component's own table (a .jsx cannot be
// imported under node's test runner)
const ICON_NAMES = [...read("app/components/Icons.jsx").matchAll(/^  ([a-z]+): <g /gm)].map((m) => m[1]);
const css = read("app/globals.css");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("every deck key and every utility has a glyph", () => {
  for (const k of DECK) assert.ok(ICON_NAMES.includes(k.icon), `icon ${k.icon} for ${k.id}`);
  for (const u of UTILITIES) assert.ok(ICON_NAMES.includes(u.icon), `icon ${u.icon} for ${u.id}`);
  for (const n of navFor("passport")) assert.ok(ICON_NAMES.includes(n.icon), `icon ${n.icon} for ${n.label}`);
  assert.ok(ICON_NAMES.includes("globe") && ICON_NAMES.includes("bell") && ICON_NAMES.includes("post") && ICON_NAMES.includes("disc"));
});

test("the deck has exactly five keys and the Info Dock exactly three utilities, none a route of its own", () => {
  assert.equal(DECK.length, 5);
  assert.equal(UTILITIES.length, 3);
  for (const k of DECK) assert.ok(!("href" in k), k.id + " resolves its route through lib/nav.js, never carries one");
  assert.equal(deckFor("passport").length, 2);
  assert.ok(fixtureFor("passport", "passport"));
});

test("no CRT: scanlines, the grid, the glow and the wash are gone from the tokens and nothing renders the chrome", () => {
  for (const block of [":root {", '[data-theme="light"] {']) {
    const i = css.indexOf(block);
    const body = css.slice(i, css.indexOf("\n}", i));
    assert.match(body, /--scan:\s*transparent;/, block + " --scan");
    assert.match(body, /--grid-ln:\s*transparent;/, block + " --grid-ln");
    // (18 Oct, A6 third addendum) the phosphor glow is back in DARK only, in each word's own colour
    if (block === ":root {") assert.match(body, /--glow:\s*0 0 1px currentColor,/, block + " --glow glows in the word's own colour");
    else assert.match(body, /--glow:\s*none;/, block + " --glow");
    assert.match(body, /--glow-ink:\s*none;/, block + " --glow-ink");
    assert.match(body, /--backlight:\s*none;/, block + " --backlight");
    assert.match(body, /--wash:\s*none;/, block + " --wash");
  }
  // (second pass, 17 Oct) the chrome's rules are DELETED, not hidden — and so
  // are the header's, the old thumb bar's and the ORB HUB second interface's
  for (const sel of [".os-crt", ".os-blob", ".os-plus", ".os-frame", ".os-status", ".tophead", ".thbar", ".marquee", ".snav", ".acctpanel", ".bagpanel", ".searchpanel", "[data-model", "--tabbar-h"]) {
    assert.ok(!rules.includes(sel), sel + " must be gone from globals.css");
  }
  // code, not comments: the shell's header explains what left and names it
  const shell = read("app/shell.js").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const cls of ["os-crt", "os-blob", "os-plus", "os-frame", "OsStatus", "tophead", "marquee"]) {
    assert.ok(!shell.includes(cls), "the shell must not render " + cls);
  }
  assert.ok(!/text-shadow:\s*var\(--glow-ink\)/.test(rules.split("html, body {")[1].split("}")[0]), "body text carries no glow");
});

test("the palette: the owner's reference in light (18 Oct 2026) — an icy ground, slate ink, blue links, a true red accent; the blueprint's black ground, slate, phosphorus green in dark", () => {
  const block = (name) => { const i = css.indexOf(name); return css.slice(i, css.indexOf("\n}", i)); };
  const light = block('[data-theme="light"] {');
  const dark = block(":root {");
  assert.match(light, /--bg:\s*#f4f8fb;/, "the icy ground of the reference");
  assert.match(light, /--paper:\s*#ffffff;/);
  assert.match(light, /--sig:\s*#1d5fd6;/, "links and chosen things are blue");
  assert.match(light, /--red:\s*#c9372a;/, "the accent is the reference's red (the asterisk, the active tab)");
  assert.match(light, /--ink:\s*#253749;/, "slate ink, as the reference reads");
  assert.match(dark, /--bg:\s*#070b0c;/);
  assert.match(dark, /--red:\s*#8cf0a6;/, "the dark accent is a subtle phosphorus green");
  assert.match(dark, /--sig:\s*#6e9cff;/);
});

test("the fixtures are glass pills with the restrained rainbow rim, and the post disc is round", () => {
  assert.match(rules, /\.fixture \{[^}]*position: fixed;[^}]*border-radius: 999px;/s);
  // (18 Oct) the rim is drawn once for the fixtures, the deck AND every popup, and it follows the hand
  assert.match(rules, /\.fixture::after, \.ccenter::after, \.sheet::after \{[^}]*conic-gradient\(from var\(--iris-a, 200deg\) at var\(--iris-x, 30%\) var\(--iris-y, 0%\)/s, "the rainbow is a rim that follows the hand, drawn once for the fixtures, the deck and the popup");
  assert.match(rules, /\.ccdisc \{[^}]*border-radius: 50%;/s);
  assert.match(rules, /prefers-reduced-transparency: reduce/, "reduced transparency drops the blur");
});

// THE WIRE DOES NOT EXIST (owner, 18 Oct 2026: "THE WIRE DOESN'T EXIST
// ANYMORE"). It is the Feed. No visible word may say otherwise: every page,
// layout and component under app/ (the API's own messages included) and the
// deck's data, read with the comments stripped. Identifiers (PostCard,
// fetchPosts, WIRE_UPLOADS_ENABLED, the "wire" data keys) are code, not copy,
// and the word boundaries leave them alone.
test("the Wire does not exist: no visible WIRE / Wire / the wire / wire post anywhere in the app", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const files = [];
  const walk = (d) => { for (const f of readdirSync(new URL("../" + d, import.meta.url))) { const p = d + "/" + f; if (statSync(new URL("../" + p, import.meta.url)).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(f)) files.push(p); } };
  walk("app");
  files.push("lib/dock.js", "lib/nav.js");
  const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const hits = [];
  for (const f of files) {
    strip(read(f)).split("\n").forEach((line, i) => { if (/\bWIRE\b|\bWire\b|\bthe wire\b|\bwire posts?\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, [], "the Wire is the Feed now");
  assert.ok(files.length > 100, "the sweep read the app (" + files.length + " files)");
});

// PAGE GRADIENTS (owner, 18 Oct 2026: "I want page gradients too"): --bg
// stays the base; --bg-grad is defined in both palettes and is what the page
// wears; each destination tints its own light through --page-tint, which the
// shell names on <html>. Cards keep their own ground on top of it.
test("page gradients: a --bg-grad in both palettes, worn by the page, tinted per destination", () => {
  const block = (name) => { const i = css.indexOf(name); return css.slice(i, css.indexOf("\n}", i)); };
  for (const b of [":root {", '[data-theme="light"] {']) {
    assert.match(block(b), /--bg-grad:\s*radial-gradient\([^;]*var\(--page-tint\)[^;]*linear-gradient\(/s, b + " defines the page gradient from the page's tint");
    assert.match(block(b), /--bg:\s*#[0-9a-f]{6};/, b + " keeps --bg as the base");
  }
  assert.match(rules, /\nhtml \{ background-color: var\(--bg\); background-image: var\(--bg-grad\);/, "the page wears it");
  assert.match(rules, /\nbody \{ background: transparent; \}/, "body is clear above it");
  // the shared html, body block must not reset the page's background with a shorthand (it did, in the first cut)
  assert.ok(!/html, body \{[^}]*background\s*:/s.test(rules), "nothing after the page rule resets <html>'s background");
  assert.match(rules, /\[data-page="passport"\] \{ --page-tint: var\(--red\); \}/);
  assert.match(read("app/shell.js"), /document\.documentElement\.dataset\.page = page;/, "the shell names the page");
  for (const f of ["app/components/PostCard.jsx", "app/components/PlaceCard.jsx", "app/components/MapSheet.jsx", "app/components/ListingSheet.jsx"]) {
    assert.deepEqual(read(f).match(/#[0-9a-fA-F]{3,8}\b/g) || [], [], f + " carries no literal colour");
  }
});

// THE DARK POPUP BACKDROP (owner, 18 Oct 2026: "on dark mode if there is a
// popup the background should be darker, not a cloudy white"). The scrim was
// --ink at 42% — near-white in the dark palette. It is --scrim now: a deep
// translucent black in dark (on :root, under the device's dark and under the
// pinned dark alike), the reference's slate wash in light (unchanged, so the
// search popup of 6.jpg does not move). Shadows mix from --shade, black in dark.
test("dark popup backdrop: the scrim deepens the page in dark on both dark paths; light keeps the slate wash; no shadow glows white", () => {
  const block = (name) => { const i = css.indexOf(name); return css.slice(i, css.indexOf("\n}", i)); };
  const darkScrim = /--scrim:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0?\.\d+)\);/;
  const m = block(":root {").match(darkScrim);
  assert.ok(m, ":root (dark) defines --scrim as an rgba");
  assert.ok(Math.max(+m[1], +m[2], +m[3]) <= 16, "the dark scrim is near-black, not a wash of the light ink");
  assert.ok(+m[4] >= 0.6, "and deep enough to lower the page");
  assert.match(block('[data-theme="light"] {'), /--scrim:\s*color-mix\(in srgb, #253749 42%, transparent\);/, "light keeps the 42% slate wash of the reference");
  assert.match(rules, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ --shade: #000000; --scrim: rgba\(1, 3, 4, 0\.74\); \} \}/, "the device's dark");
  assert.match(rules, /\n\[data-theme="dark"\] \{ --shade: #000000; --scrim: rgba\(1, 3, 4, 0\.74\); \}/, "the pinned dark");
  assert.match(rules, /\.sheetscrim \{[^}]*background: var\(--scrim\);/s, "the popup's scrim is the token");
  const shadows = rules.match(/box-shadow:[^;}]*/g) || [];
  assert.deepEqual(shadows.filter((d) => /color-mix\(in srgb, var\(--ink\)/.test(d)), [], "no shadow is mixed from the light ink");
});

// THE OG REACTIVE RAINBOW LIQUID GLASS (owner, 18 Oct 2026: "the liquid glass
// isn't liquid enough — I want the OG reactive rainbow liquid glass you made
// for ASILUM"). The 8 Sep glass (LiquidGlass.jsx: the displacement map, the
// pointer's shine) is back on the fixtures, the deck and every popup; one
// listener set drives the rim from the pointer, the tilt and the scroll,
// writing only to the glass elements and never reading layout per frame;
// reduced motion stops it; the popup's scrim is no backdrop root.
test("the OG reactive rainbow liquid glass: on the fixtures, the deck and every popup; reactive to pointer, tilt and scroll; still under reduced motion", () => {
  const lg = read("app/components/LiquidGlass.jsx");
  assert.match(lg, /export function useGlassReactive\(\)/);
  const hook = lg.slice(lg.indexOf("export function useGlassReactive"));
  assert.match(hook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return undefined;/, "reduced motion: nothing listens");
  for (const ev of ["pointermove", "scroll", "deviceorientation"]) assert.match(hook, new RegExp('addEventListener\\("' + ev + '"'), ev);
  const tick = hook.slice(hook.indexOf("const tick"), hook.indexOf("const wake"));
  assert.ok(!/getBoundingClientRect|offsetWidth|offsetHeight|getComputedStyle/.test(tick), "the frame writes; it never reads layout");
  assert.match(tick, /document\.querySelectorAll\(GLASS_REACTIVE\)/, "it writes to the glass elements, not to <html>");
  assert.ok(!/documentElement\.style\.setProperty/.test(hook), "never on the root");
  assert.match(read("app/shell.js"), /useGlassReactive\(\);/, "the shell runs it once");
  for (const [f, id] of [["app/components/InfoDock.jsx", "lg-infodock"], ["app/components/PassportButton.jsx", "lg-passportbtn"], ["app/components/ControlCenter.jsx", "lg-deck"], ["app/components/SheetHost.jsx", "lg-popup"]]) {
    const src = read(f);
    assert.match(src, new RegExp('useLiquidGlass\\(\\w+, \\{ id: "' + id + '"'), f + " is a pane of the OG glass");
    assert.match(src, /lgrx/, f + " answers the reactive rim");
  }
  assert.match(read("app/components/SheetHost.jsx"), /bend: "\.card"/, "where WebKit cannot bend a backdrop, the cards under the popup's edges bend");
  assert.match(rules, /\.sheetscrim \{ -webkit-backdrop-filter: none; backdrop-filter: none; \}/, "the scrim is no backdrop root, so the popup has a page to bend");
  assert.match(rules, /\[data-popup\] \.main \{ filter: blur\(5px\);/, "the page softens under its own filter");
  assert.match(rules, /\.sheet\[data-refract="1"\] \{[^}]*var\(--lg-filter\)/s);
  assert.match(rules, /\.fixture\[data-refract="1"\], \.ccenter\[data-refract="1"\] \{[^}]*var\(--lg-filter\)/s);
  assert.match(rules, /prefers-reduced-transparency: reduce\) \{[^}]*\.sheet\[data-refract="1"\][^}]*backdrop-filter: none/s, "reduced transparency drops the glass");
  // the popup's glass would trap a fixed child: the overlays it opens render on <body>
  const listing = read("app/components/ListingSheet.jsx");
  assert.match(listing, /createPortal\(<FloatView[^]*document\.body\)/);
  assert.match(listing, /createPortal\(<TicketFlow[^]*document\.body\)/);
  assert.match(read("app/components/dismiss.js"), /if \(above && above !== surface\) return;/, "a stacked modal keeps its focus");
  assert.match(read("app/components/TicketFlow.jsx"), /role="dialog" aria-modal="true" aria-label="purchase request"/);
});

// ROUNDED EVERYWHERE (owner, 18 Oct 2026: "everything should be rounded
// out"). Three radius tokens on :root; a floor that rounds every button and
// field unless a rule of its own rounds it otherwise; the shell-visible
// surfaces on the tokens; no underline-only (hairline) field left squared.
test("rounded everywhere: three radius tokens, a floor for every key and field, the shell's surfaces on them, no square hairline field", () => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
  for (const t of ["--radius-card", "--radius-field", "--radius-key"]) assert.match(root, new RegExp(t + ":\\s*\\d+px;"), t);
  assert.match(rules, /\nbutton, \.btn, a\.btn \{ border-radius: var\(--radius-key\); \}/, "every button is rounded unless rounded otherwise");
  assert.match(rules, /\ninput:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\), select, textarea \{ border-radius: var\(--radius-field\); \}/, "every field");
  assert.match(rules, /\.card, [^{]*\{ border-radius: var\(--radius-card\); \}/, "every card");
  assert.match(rules, /--sheet-radius: calc\(var\(--radius-card\) \+ 4px\);/, "the popup and the deck in the same family");
  assert.match(rules, /\.imgwrap \{ position: relative; border-radius: var\(--ed-img-rad, var\(--radius-card\)\);/, "a card's photograph is rounded by default");
  // no field is a hairline with square corners any more
  const squareFields = (rules.match(/\{[^}]*border-bottom:\s*\d+px solid var\(--line\);[^}]*border-radius:\s*0[;\s]/g) || []);
  assert.deepEqual(squareFields, [], "no underline-only field with square corners");
  assert.ok(!/border: none; border-bottom: [12]px solid var\(--line\); border-radius: 0;/.test(rules));
});
