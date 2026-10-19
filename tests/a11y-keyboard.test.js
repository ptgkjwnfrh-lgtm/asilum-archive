// tests/a11y-keyboard.test.js — everything you can click, you can reach.
//
// WCAG 2.1.1 (Keyboard, Level A): all functionality must be operable from a
// keyboard. A `<span onClick>` is not — it takes no focus, fires on no key, and
// is announced as text. The `/accessibility` page claims "full keyboard
// operability of navigation and controls", so this is claim 5 of the register.
//
// #214 fixed the card titles. The claims register found six more that were
// still pointer-only, and all six were controls a keyboard user simply could
// not use:
//
//   - the designer chip in the item detail (navigated on click) — now an <a>
//   - the two brand-filter chips on /profile — now <button>s
//   - the three "×" remove affordances on /upload, which were <i onClick>
//     with no name at all — now named <button>s
//
// A click handler on a non-interactive element is NOT automatically a defect.
// Four shapes are legitimate, and each is recognised here by what it IS rather
// than by being listed: an overlay scrim that dismisses (there is always a real
// close button and Escape via components/dismiss.js), a wrapper that only calls
// stopPropagation (event containment, not a control), an element marked
// aria-hidden whose job is done by a sibling control, and a card wrapper that
// merely duplicates a real link it contains. The last two are asserted rather
// than trusted: the scrim must ship an .mclose, and the card must really hold a
// title link.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Elements that are keyboard-operable by nature.
const NATIVE = new Set(["button", "a", "input", "select", "textarea", "summary", "label", "form"]);

function sourceFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const p = d + "/" + entry;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(entry)) out.push(p);
    }
  })(dir);
  return out;
}

// Brace-aware walk to the end of the opening tag: a JSX expression contains
// ">" (`onClick={() => …}`) and stopping at the first one truncates attributes.
function openingTagAttrs(src, start) {
  let i = start, depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) break;
    i++;
  }
  return src.slice(start, i);
}

function clickHandlers() {
  const found = [];
  for (const file of sourceFiles(ROOT + "app")) {
    const src = readFileSync(file, "utf8");
    const re = /<([a-z][a-zA-Z0-9]*)\b/g;   // lowercase only: React components excluded
    let m;
    while ((m = re.exec(src))) {
      const tag = m[1];
      if (NATIVE.has(tag)) continue;
      const attrs = openingTagAttrs(src, m.index + m[0].length);
      if (!/onClick\s*=/.test(attrs)) continue;

      const keyboardRetrofit = /tabIndex\s*=/.test(attrs)
        && /onKeyDown\s*=|onKeyUp\s*=|onKeyPress\s*=/.test(attrs);
      // Only stops the event travelling — it operates nothing.
      const containmentOnly = /onClick=\{\s*\(?\s*\w*\s*\)?\s*=>\s*\w+\.stopPropagation\(\)\s*\}/.test(attrs);
      const scrim = /className="overlay"/.test(attrs);
      // A card wrapper that duplicates a real link it contains: the title is an
      // <a> to the same destination, so the function IS keyboard-reachable and
      // the wrapper is a pointer convenience. Asserted for real below.
      const duplicatesInnerLink = /className="card"/.test(attrs);
      const presentational = /aria-hidden\s*=\s*\{?["']?true/.test(attrs);

      found.push({
        file: file.slice(ROOT.length),
        line: src.slice(0, m.index).split("\n").length,
        tag,
        exempt: keyboardRetrofit || containmentOnly || scrim || presentational || duplicatesInnerLink,
        why: keyboardRetrofit ? "tabIndex + key handler"
          : containmentOnly ? "stopPropagation only"
            : scrim ? "overlay scrim (real close button + Escape)"
              : presentational ? "aria-hidden, a sibling control does the work"
                : duplicatesInnerLink ? "card wrapper duplicating a real link inside it"
                  : null,
      });
    }
  }
  return found;
}

test("nothing is operable by pointer alone", () => {
  const handlers = clickHandlers();

  // Not vacuous: this app really does attach clicks to non-native elements.
  assert.ok(handlers.length >= 12, `scanned ${handlers.length} non-native click handlers`);

  const pointerOnly = handlers.filter((h) => !h.exempt)
    .map((h) => `${h.file}:${h.line} <${h.tag}>`);
  assert.deepEqual(pointerOnly, [],
    "a click handler on a non-focusable element cannot be reached by keyboard");
});

test("the exemptions are the four legitimate shapes, and nothing else", () => {
  // Guards the exemption logic itself. If a future change starts exempting
  // things for a new reason, that reason has to be added here deliberately.
  const reasons = new Set(clickHandlers().filter((h) => h.exempt).map((h) => h.why));
  for (const reason of reasons) {
    assert.ok([
      "tabIndex + key handler",
      "stopPropagation only",
      "overlay scrim (real close button + Escape)",
      "aria-hidden, a sibling control does the work",
      "card wrapper duplicating a real link inside it",
    ].includes(reason), `unexpected exemption reason: ${reason}`);
  }
  // And every overlay scrim really does ship a close button beside it.
  for (const file of sourceFiles(ROOT + "app")) {
    const src = readFileSync(file, "utf8");
    if (!src.includes('className="overlay"')) continue;
    assert.match(src, /className="mclose"/,
      `${file.slice(ROOT.length)} has a dismissable overlay but no visible close control`);
  }
  // The card-wrapper exemption is only honest if the card really does contain a
  // real link. Checked, not assumed.
  for (const file of sourceFiles(ROOT + "app")) {
    const src = readFileSync(file, "utf8");
    if (!/className="card"[\s\S]{0,120}?onClick/.test(src)) continue;
    assert.match(src, /<a\s+className="ttl"|className="ttl"\s+href=/,
      `${file.slice(ROOT.length)} has a clickable card wrapper but no real title link inside it`);
  }
});

test("the chips the register found are real controls now", () => {
  // Named so the specific regression cannot come back quietly.
  // (V.2 slice 3) the designer chips live in the LISTING popup now
  const page = readFileSync(ROOT + "app/components/ListingSheet.jsx", "utf8");
  assert.match(page, /<a\s+className="dz"/, "the designer chip navigates, so it is a link");
  assert.doesNotMatch(page, /className="dz"[\s\S]{0,200}?window\.location\.href/,
    "and no longer navigates from a click handler");

  const profile = readFileSync(ROOT + "app/profile/page.js", "utf8");
  const chipButtons = profile.match(/<button type="button" className="chip clickable/g) || [];
  assert.equal(chipButtons.length, 2, "both brand-filter chips are buttons");

  const upload = readFileSync(ROOT + "app/upload/page.js", "utf8");
  const removeButtons = upload.match(/className="gxchipx"/g) || [];
  assert.equal(removeButtons.length, 3, "all three remove affordances are buttons");
  // Each carries a name — "×" alone announces as nothing useful.
  const named = upload.match(/className="gxchipx" aria-label=/g) || [];
  assert.equal(named.length, 3, "and each one is named");
});
