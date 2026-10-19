// tests/a11y-modal-focus.test.js — aria-modal is a promise, and it must be kept.
//
// `aria-modal="true"` tells assistive technology that everything behind the
// dialog is inert. The attribute does not MAKE that true — it only asserts it.
//
// The item detail declared it while: focus stayed on the trigger BEHIND the
// layer when the dialog opened, 200 focusable elements behind remained
// tabbable, and nothing was inert. A keyboard user opening a piece kept focus
// in the catalog and could tab through a page they could no longer see, while a
// screen-reader user was told the opposite. Verified with real clicks and real
// Tab presses, not simulated events.
//
// `useFocusTrap` (app/components/dismiss.js) is what keeps the promise: focus
// moves in on open, Tab cycles inside, and focus is RESTORED to whatever opened
// the dialog on close. Escape still closes it (useEscape), so this is not a
// trap the user cannot leave — that would be WCAG 2.1.2.
//
// Focus behaviour cannot be asserted from source. What CAN be asserted, and is
// the thing that actually regressed, is the PAIRING: nothing may claim
// aria-modal without being wired to the trap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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

test("every aria-modal dialog is wired to the focus trap", () => {
  const claimants = [];
  for (const file of sourceFiles(ROOT + "app")) {
    const src = readFileSync(file, "utf8");
    if (!/aria-modal\s*=\s*["{]?\s*["']?true/.test(src)) continue;
    claimants.push(file.slice(ROOT.length));
    assert.match(src, /useFocusTrap\s*\(/,
      `${file.slice(ROOT.length)} claims aria-modal but never calls useFocusTrap — ` +
      "the attribute asserts the page behind is inert; something has to make it so");
  }
  // Not vacuous: there really is a dialog making this claim.
  assert.ok(claimants.length >= 1, "at least one dialog declares aria-modal");
});

test("the trap moves focus in, cycles Tab, and gives focus back", () => {
  const src = readFileSync(ROOT + "app/components/dismiss.js", "utf8");
  assert.match(src, /export function useFocusTrap/);
  // Moves focus in on open.
  assert.match(src, /\(inside\(\)\[0\] \|\| surface\)\.focus\(\)/, "focus is moved into the surface");
  // Cycles at both ends.
  assert.match(src, /event\.shiftKey && document\.activeElement === first/, "shift-tab wraps backwards");
  assert.match(src, /!event\.shiftKey && document\.activeElement === last/, "tab wraps forwards");
  // Restores on close — the half that is usually forgotten.
  assert.match(src, /origin && origin\.isConnected[\s\S]{0,60}origin\.focus\(\)/,
    "focus is restored to whatever opened the dialog");
});

test("the trap never becomes one the user cannot leave", () => {
  // WCAG 2.1.2: a modal may contain Tab, but Escape must still get out.
  // (V.2 slice 3) the item detail is the LISTING popup in SheetHost
  const page = readFileSync(ROOT + "app/components/SheetHost.jsx", "utf8");
  assert.match(page, /useEscape\(\(\) => \(hasBack \? backSheet\(\) : dismiss\(\)\), open\)/,
    "the popup still closes on Escape");
  const dismiss = readFileSync(ROOT + "app/components/dismiss.js", "utf8");
  assert.match(dismiss, /if \(event\.key === "Escape"\) onClose\(\)/);
});
