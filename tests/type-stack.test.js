// tests/type-stack.test.js — two faces, and the digi-cam face never comes back.
//
// V.2 (owner's blueprint, 17 Oct 2026, "Visual constitution"): Michroma is
// the primary face, Inter the secondary for body text. Share Tech Mono
// (STM) retired with the CRT language; its files are gone too.
//
// Owner directive, 17 August: "get rid of the digi cam font, only the main font
// from now on." The digi-cam face was OSD (VT323), an LCD/pixel face that had
// spread to TWENTY-FIVE rules — counters, clocks, wire handles, the passport
// machine zone, breadcrumbs, the MAGAZINE line of the wordmark. It is gone, and
// everything it painted now uses the main font.
//
// What survives is deliberate and is not the same call: Michroma stays as the
// display face. It is the wordmark and every headline, and it is the face in the
// owner's own reference comp — retiring it would be a different instruction than
// the one given.
//
// This is a small file on purpose. A font that has been removed comes back one
// rule at a time, and the only reliable moment to stop that is the moment
// somebody types the name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

test("the type stack is three faces: Michroma, Inter, and the description face Share Tech Mono (owner reference, 18 Oct 2026)", () => {
  const css = read("app/globals.css");
  const faces = [...css.matchAll(/@font-face \{ font-family: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(faces.sort(), ["Inter", "Michroma", "Share Tech Mono"],
    "a third @font-face means a face was added without a decision");

  // Michroma is the display voice, Inter is everything else.
  assert.match(css, /--mich:\s*"Michroma", var\(--helv\)/);
  assert.match(css, /--helv:\s*"Inter"/);
  assert.match(css, /--serif:\s*"Inter"/);
  assert.match(css, /--mono:\s*"Share Tech Mono"/, "the description face has its token");
  assert.ok(!/"STM"/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "the old STM alias stays retired — the face is named in full");
  assert.ok(existsSync(ROOT + "public/fonts/sharetech.ttf") && existsSync(ROOT + "public/fonts/OFL-sharetechmono.txt"), "Share Tech Mono ships with its licence");
  assert.ok(existsSync(ROOT + "public/fonts/inter.woff2") && existsSync(ROOT + "public/fonts/OFL-inter.txt"), "Inter ships with its licence");
});

test("the digi-cam face is gone, by name and by file", () => {
  // Comments may name it — one explains why the passport MRZ was resized when
  // the face changed, and that history is worth more than the purity of a
  // grep. Rules may not.
  const css = read("app/globals.css")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/--osd\b/.test(css), "the --osd token must not exist");
  assert.ok(!/"OSD"/.test(css), "the OSD family must not be declared");
  assert.ok(!/vt323/i.test(css), "no rule may reference the retired face");

  for (const f of ["vt323.woff2", "vt323.ttf", "OFL-vt323.txt"]) {
    assert.ok(!existsSync(ROOT + "public/fonts/" + f), `public/fonts/${f} must be deleted`);
  }
});

test("nothing in app/ or lib/ still asks for it", () => {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(ROOT + dir)) {
      const rel = `${dir}/${entry}`;
      if (statSync(ROOT + rel).isDirectory()) walk(rel);
      else if (/\.(js|jsx|css)$/.test(entry)) files.push(rel);
    }
  })("app");
  (function walk(dir) {
    for (const entry of readdirSync(ROOT + dir)) {
      const rel = `${dir}/${entry}`;
      if (statSync(ROOT + rel).isDirectory()) walk(rel);
      else if (/\.(js|jsx|css)$/.test(entry)) files.push(rel);
    }
  })("lib");

  // Comments may still explain the retirement — that history is worth keeping.
  // BLOCK comments have to go first: a `{/* … */}` in JSX has continuation lines
  // that start with neither "//" nor "*", so the line filter alone let a comment
  // in app/opengraph-image.js read as live code and failed this test.
  const codeOnly = (src) =>
    src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

  const offenders = [];
  for (const file of files) {
    const code = codeOnly(read(file.replace(/^\//, "")));
    if (/var\(--osd\)|"VT323"|vt323/i.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "these still reference the retired face");
});

test("the font files that ship are the three faces and their licences", () => {
  const shipped = readdirSync(ROOT + "public/fonts").sort();
  assert.deepEqual(shipped, [
    "OFL-inter.txt", "OFL-michroma.txt", "OFL-sharetechmono.txt",
    "inter.ttf", "inter.woff2",
    "michroma.ttf", "michroma.woff2",
    "sharetech.ttf",
  ].sort(), "public/fonts must hold exactly the three faces and their licences");
});
