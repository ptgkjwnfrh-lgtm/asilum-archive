// tests/a11y-focus-visible.test.js — nothing may remove focus without replacing it.
//
// WCAG 2.4.7 (Focus Visible, Level AA) requires a visible indication of which
// control has keyboard focus. `outline: none` removes the browser's default one.
// That is legitimate — this design replaces it with a border-colour shift to
// `--sig`, the interaction voice — but only when a replacement actually exists.
//
// The claims register found four that had none: `.search` (the top-bar search),
// `.controls input[type='text']` (the passport trainer and new-board field),
// `.usearch input` (people search) and `.composer2 textarea` (the transmission
// composer). Each set `outline: none` in its base rule and defined no `:focus`
// style anywhere, so a keyboard user tabbing through them saw nothing at all
// while the `/accessibility` page claimed "visible focus".
//
// This is a static check on `globals.css`. It cannot judge whether an indicator
// is strong enough — only that suppressing the default is always paired with
// putting something back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

// Strip comments so a selector quoted in prose cannot satisfy or trip the scan.
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

// Every top-level `selector { … }` block, as [selector, body] pairs. Good
// enough for this file, which is flat apart from @media blocks — and rules
// inside those are matched too, since the regex reads any `… { … }`.
function rules(src) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selector = m[1].trim().split("\n").pop().trim();
    if (!selector || selector.startsWith("@")) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

const ALL = rules(code);

test("no rule removes the focus outline without defining a focus style", () => {
  const suppressors = ALL.filter((r) => /outline:\s*(none|0)\b/.test(r.body));
  // Not vacuous — this file genuinely does suppress outlines in several places.
  assert.ok(suppressors.length >= 8, `found ${suppressors.length} outline-suppressing rules`);

  const focusRules = ALL.filter((r) => r.selector.includes(":focus"));
  assert.ok(focusRules.length >= 10, `found ${focusRules.length} focus rules`);

  // Compare on the selector with attribute filters removed, so
  // `.dcfoot input:focus` is correctly recognised as covering
  // `.dcfoot input[type="text"]` — it does, by CSS semantics. Matching on the
  // raw text reports that as uncovered, which is a false alarm, not a finding.
  const base = (sel) => sel.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

  const naked = [];
  for (const rule of suppressors) {
    // A rule may list several selectors; each needs its own replacement.
    for (const raw of rule.selector.split(",")) {
      const sel = raw.trim();
      if (!sel || sel.includes(":focus")) continue;
      const covered = focusRules.some((f) =>
        f.selector.split(",").some((c) => base(sel).startsWith(base(c.trim().replace(":focus", "")))));
      if (!covered) naked.push(sel);
    }
  }
  assert.deepEqual([...new Set(naked)], [],
    "outline: none with no :focus rule leaves a keyboard user with no indication of where they are");
});

test("the focus indicator is drawn with a palette token, never a literal colour", () => {
  // Rule 3 of the UI law: colours only through tokens. A hex here would also
  // dodge the contrast work done in #216/#218.
  for (const rule of ALL.filter((r) => r.selector.includes(":focus"))) {
    const literals = rule.body.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(literals, [], `${rule.selector} uses a literal colour`);
  }
});

test("the four controls the register found are covered by name", () => {
  // Named explicitly so the specific regression cannot return quietly if the
  // generic scan above is ever loosened.
  // `.composer2 textarea` left the list with V.2 slice 2: no component renders
  // .composer2 any more and its rules are deleted (the one composer is
  // PostComposer, covered by the generic scan above).
  for (const sel of [".search", ".controls input[type='text']", ".usearch input"]) {
    const has = ALL.some((r) =>
      r.selector.split(",").some((c) => c.trim().startsWith(sel) && c.includes(":focus")));
    assert.ok(has, `${sel} has a :focus style`);
  }
});
