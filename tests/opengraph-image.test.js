// tests/opengraph-image.test.js — the social card is drawn from the real tokens
// and says what the page says.
//
// Satori resolves no CSS variables and reads no stylesheet, so
// app/opengraph-image.js hardcodes five colours. That is a second copy of the
// design language, and this repo has already watched a palette move twice in two
// days for contrast (#216 moved --sig, #218/#219 moved --red and --p2). A copy
// nothing checks is a copy that goes stale, so these tests READ app/globals.css
// and fail if the card and the stylesheet disagree — the same discipline as
// tests/theme-contrast.test.js, which recomputes its ratios from the stylesheet
// rather than trusting a number written down next to them.
//
// The card was also verified as a real artifact, not just as source: served from
// a running server it returns `content-type: image/png`, a valid PNG signature,
// and 1200x630 read out of the IHDR chunk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

const card = () => read("app/opengraph-image.js");

// The :root block only — a token also defined under [data-theme="light"] must
// not be read from there, and this is bounded to the first block rather than
// reaching across the file.
function rootTokens() {
  const css = read("app/globals.css");
  const start = css.indexOf(":root {");
  assert.ok(start >= 0, "globals.css must have a :root block");
  const block = css.slice(start, css.indexOf("}", start));
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test("every colour on the card is the live token value", () => {
  const tokens = rootTokens();
  const src = card();
  // name in the card -> token in globals.css
  const pairs = [["BG", "bg"], ["INK", "ink"], ["RED", "red"], ["SIG", "sig"],
                 ["GREY", "grey"], ["FAINT", "faint"]];
  for (const [constant, token] of pairs) {
    const declared = src.match(new RegExp(`const ${constant} = "([^"]+)";`));
    assert.ok(declared, `the card must declare ${constant}`);
    assert.equal(declared[1].toLowerCase(), tokens[token].toLowerCase(),
      `${constant} on the card has drifted from --${token} in globals.css`);
  }
});

test("the card declares the size a large summary card needs", () => {
  const src = card();
  assert.match(src, /export const size = \{ width: 1200, height: 630 \};/);
  assert.match(src, /export const contentType = "image\/png";/);
  // alt is not decoration — it is what a screen reader announces for the card.
  assert.match(src, /export const alt =/);
});

test("the card distinguishes native inventory from the labeled demo archive", () => {
  const src = card();
  // A shared link reaches people who have not seen the page's DEMO banner, so
  // the disclosure rides on the card. The owner's comp REPLACED the longer
  // "taste engine is real" line with the DISCOVERY/COMMERCE/COMMUNITY strip but
  // kept this one — so this is the line that is load-bearing, and if it ever has
  // to go, docs/seo-notes.md changes in the same commit.
  assert.match(src, /NATIVE STOREFRONTS \+ LABELED DEMO ARCHIVE/);
  // And it must not claim inventory. `real` appears in the honest sentence, so
  // the check is for the specific promises, not for a bare word.
  for (const claim of ["shop now", "buy now", "in stock", "free shipping"]) {
    assert.ok(!src.toLowerCase().includes(claim), `the card must not promise "${claim}"`);
  }
});

test("the strip is spelled correctly, whatever the comp said", () => {
  const src = card();
  // Comments stripped: the header quotes the misspelling in order to explain
  // why it is not shipped, and a bare search would trip on that explanation.
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // The owner's reference comp reads "COMMERECE". A misspelling baked into every
  // link preview is not a design decision, so the card ships the correct word —
  // and this test is here so nobody "restores" it to match the comp later.
  assert.match(code, /DISCOVERY · COMMERCE · COMMUNITY/);
  assert.ok(!/COMMERECE/i.test(code), "the comp's typo must not ship");
});

test("the card and the twitter card size ship together", () => {
  // The pairing, from this side. tests/seo.test.js holds the other side.
  assert.ok(existsSync(ROOT + "app/opengraph-image.js"));
  assert.match(read("app/layout.js"), /card:\s*"summary_large_image"/);
});

test("the card loads the real brand faces, as files Satori can actually read", () => {
  const src = card();
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // Satori reads TTF/OTF/WOFF and NOT WOFF2. The first version of this card used
  // the generator's built-in face for exactly that reason; the TTFs now sit
  // beside the WOFF2s. A `fontFamily` here is only meaningful if the file it
  // names is passed in, so both halves are asserted together.
  for (const file of ["michroma.ttf", "inter.ttf"]) {
    assert.ok(existsSync(ROOT + "public/fonts/" + file), `public/fonts/${file} must exist`);
    assert.match(code, new RegExp(`readFileSync\\(join\\(FONT_DIR, "${file}"\\)\\)`));
  }
  assert.ok(!/\.woff2/.test(code), "Satori cannot read WOFF2 — pass the TTF");

  // Both faces reach ImageResponse, not just one.
  assert.match(code, /name: "Michroma", data: MICHROMA/);
  assert.match(code, /name: "Inter", data: INTER/);

  // Michroma ships ONE weight. Asking for 700 makes Satori synthesise a face the
  // site never shows — `.headline` is weight 400 and leans on tracking instead.
  assert.ok(!/fontWeight/.test(code), "the brand faces ship one weight each");
});

test("the fonts are real TrueType files, not renamed WOFF2", () => {
  // A copy that silently kept the .woff2 bytes under a .ttf name would fail at
  // build with an opaque Satori error. The sfnt version is four bytes.
  for (const file of ["michroma.ttf", "inter.ttf"]) {
    const head = readFileSync(ROOT + "public/fonts/" + file).subarray(0, 4);
    assert.equal(head.toString("hex"), "00010000", `${file} must be TrueType-flavoured sfnt`);
  }
  // Both are SIL OFL and redistributed here, so the licences ship with them.
  for (const lic of ["OFL-michroma.txt", "OFL-inter.txt"]) {
    const text = read("public/fonts/" + lic);
    assert.match(text, /SIL OPEN FONT LICENSE/i, `${lic} must be the OFL text`);
  }
});

test("the card's type hierarchy is the site's, read off globals.css", () => {
  const src = card();
  const css = read("app/globals.css");

  // The stylesheet's own mapping. If a token is ever repointed, these fail and
  // the card gets looked at rather than quietly diverging from the page.
  assert.match(css, /--mich:\s*"Michroma"/, "--mich is the wordmark/headline face");
  assert.match(css, /--helv:\s*"Inter"/, "--helv is the body face (V.2)");
  assert.match(css, /@font-face \{ font-family: "Michroma"/);
  assert.match(css, /@font-face \{ font-family: "Inter"/);

  // .headline is Michroma at weight 400 with tracking — the card's wordmark
  // follows it rather than inventing a treatment.
  assert.match(css, /\.headline \{ font-family: var\(--mich\)/);

  // Wordmark and kicker in Michroma; the page-body voice carries the rest
  // (the sub-line "asilum.com" is Inter, like the page body; the MAGAZINE
  // lockup line it once followed is retired — owner, 17 Oct 2026).

  const michromaUses = [...src.matchAll(/fontFamily: "Michroma"/g)].length;
  assert.equal(michromaUses, 4, "the kicker, the asterisk, the wordmark, the strip");
  assert.match(src, /fontFamily: "Inter"/, "the container sets the body voice");
});
