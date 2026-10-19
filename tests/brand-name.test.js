// tests/brand-name.test.js — the name is "*ASILUM": six capitals behind the
// asterisk, nothing after it.
//
// Owner directive, 17 October 2026: "when they type it in I just want it to
// look like *ASILUM", and "no more lower case i in ASILUM". That retires the
// 17 August rule that the word magazine was never dropped — it is dropped
// everywhere now, metadata included — and the "ASiLUM" spelling the V.2
// papers used. A naming rule is enforced as one: any user-visible "*ASILUM"
// in app/ or lib/ stands alone, and the lowercase-i spelling appears
// nowhere in the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
function walk(dir, out = []) {
  for (const entry of readdirSync(ROOT + dir)) {
    const rel = `${dir}/${entry}`;
    if (statSync(ROOT + rel).isDirectory()) walk(rel, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(rel);
  }
  return out;
}
// Comment lines are exempt — a file header recording the old name is not a
// reader surface.
const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");

test("no user-visible *ASILUM is followed by magazine, in app/ or lib/", () => {
  const offenders = [];
  for (const file of [...walk("app"), ...walk("lib")]) {
    const code = codeOnly(read(file.replace(/^\//, "")));
    for (const m of code.matchAll(/\*ASILUM(.{0,12})/g)) {
      if (/^\s*(magazine|MAGAZINE)/.test(m[1])) offenders.push(`${file}: "*ASILUM${m[1]}"`);
    }
  }
  assert.deepEqual(offenders, [], "the name is *ASILUM alone");
});

test("the lowercase-i spelling is gone from the code, the tests and the knowledge", () => {
  const offenders = [];
  for (const file of [...walk("app"), ...walk("lib"), ...walk("tests"), ...walk("knowledge")]) {
    if (file.endsWith("tests/brand-name.test.js")) continue;
    if (/ASiLUM/.test(read(file.replace(/^\//, "")))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("the metadata a browser tab and a search result actually show", () => {
  const layout = read("app/layout.js");
  assert.match(layout, /default: "\*ASILUM"/, "the tab reads *ASILUM");
  assert.match(layout, /template: "%s · \*ASILUM"/);
  assert.match(layout, /siteName: "\*ASILUM"/);
  for (const seg of ["cover", "discover", "hotlist", "stylist"]) {
    const src = read(`app/${seg}/layout.js`);
    assert.match(src, /siteName: "\*ASILUM"/, `${seg} siteName`);
    assert.match(src, /title: "[A-Z' ]+ · \*ASILUM"/, `${seg} title`);
  }
  assert.match(read("app/piece/[id]/page.js"), /siteName: "\*ASILUM"/);
});

test("the wordmark is the asterisk and the six capitals, nothing under them", () => {
  const src = codeOnly(read("app/components/Wordmark.jsx"));
  assert.match(src, /<i>\*<\/i>ASILUM/);
  assert.ok(!/<em|<small|MAGAZINE|FASHION TERMINAL/.test(src), "no lockup lines");
  const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.wordmark (em|small)/.test(css), "their rules are gone too");
});

test("the social card and the order mail say the name", () => {
  const card = read("app/opengraph-image.js");
  assert.match(card, />\s*ASILUM\s*</, "the wordmark");
  assert.match(card, />\s*asilum\.com\s*</, "the sub-line names the domain the owner is taking");
  assert.match(card, /alt =\s*\n?\s*"\*ASILUM —/);
  assert.match(read("lib/notify.js"), /\*ASILUM — order paid/);
});

// THE NAME IS JUST ASILUM (owner, 18 Oct 2026: "drop the magazine from
// everything its just ASILUM"). Not only after the asterisk: no visible
// "magazine" anywhere in app/ or lib/ — a title, a label, a placeholder, a
// metadata line, an MRZ run. The one survivor is the domain the site still
// lives at (asilummagazine.com, in addresses and the legal mail), which is
// an address, not the name, until lib/site.js flips to www.asilum.com.
test("ASILUM never calls itself a magazine in any visible string; only the domain remains until it moves", () => {
  const offenders = [];
  const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  for (const file of [...walk("app"), ...walk("lib")]) {
    strip(read(file.replace(/^\//, ""))).split("\n").forEach((line, i) => {
      const rest = line.replace(/asilummagazine\.com/gi, "");
      // ASILUM calling itself a magazine — not another publication's name (W Magazine, a photo credit), which stays as attribution
      if (/asilum[\s_<*-]*magazine|\bthe magazine\b|\bour magazine\b/i.test(rest)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], "the name is ASILUM, nothing after it");
});
