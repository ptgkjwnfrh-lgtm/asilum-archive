// tests/uilab.test.js — the design console writes CSS, so its input is a boundary.
//
// `lib/uilab.js` backs the DESIGN CONSOLE. Every knob maps to one CSS custom
// property, and an override lands in `localStorage` and is then applied with
// `document.documentElement.style.setProperty(key, value)` — inline on `<html>`
// before first paint. Two things follow, and neither was covered:
//
//   1. `setProperty(key, value)` will set ANY property name it is handed. The
//      `ALLOWED_KEYS` allow-list is the only thing stopping a stored blob from
//      writing custom properties the console never offered.
//   2. `value` is interpolated into CSS. `SAFE_VALUE` is an ALLOW-list grammar —
//      "none", or a number with an optional px/em/s/% unit — and the tests below
//      push the obvious CSS-injection shapes at it rather than assuming a
//      blocklist mindset that would let one through.
//
// The registry itself is also pinned. Fifty-three controls are maintained by
// hand and copy-paste; a duplicated key silently shadows another control (the
// allow-list is a Set), and a control with no `selectors` is invisible to
// INSPECT mode without erroring anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_CONTROLS, GROUPS, PRESETS_KEY, UILAB_KEY,
  applyOverrides, formatValue, loadOverrides, loadPresets, parseValue,
  sanitizeImport, validValue,
} from "../lib/uilab.js";

// Minimal browser stand-ins. `lib/uilab.js` is client-safe code, so the storage
// and style surfaces are the only globals it touches.
function withBrowser(storage, fn) {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const applied = new Map();
  const removed = [];
  globalThis.window = {
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
  };
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (k, v) => applied.set(k, v),
        removeProperty: (k) => removed.push(k),
      },
    },
  };
  try {
    return fn({ applied, removed });
  } finally {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
}

// ------------------------------------------------------------ the registry

test("the control registry is internally consistent", () => {
  assert.equal(GROUPS.length, 5);
  // 53 -> 54 on 17 Aug: --ed-fs-wordmark-mobile. 54 -> 56 on 9 Sep: the
  // upload station's masthead (--ed-fs-gxmast) and the purchase globe's size
  // (--ed-gx-globe); 56 -> 57 the same day: the plus field's opacity
  // (--ed-plus-op). 57 -> 38 on 17 Oct (V.2): the header, ticker, status
  // bar, scanline, grid, haze, glow and nav-item controls retired with the
  // chrome they tuned. This count is pinned on purpose — a control added
  // without a decision changes this line first.
  assert.equal(ALL_CONTROLS.length, 38);

  const keys = ALL_CONTROLS.map((c) => c.key);
  // A duplicated key is the copy-paste failure this file invites: ALLOWED_KEYS
  // is a Set, so the second one silently shadows the first and one console
  // control stops doing anything, with no error anywhere.
  assert.equal(new Set(keys).size, keys.length, "every control key is unique");

  for (const control of ALL_CONTROLS) {
    assert.match(control.key, /^--[a-z0-9-]+$/, `${control.key} is a custom property`);
    assert.ok(control.label, `${control.key} has a label`);
    // INSPECT mode matches clicks against these; an empty list makes the
    // control unreachable by clicking without failing anywhere.
    assert.ok(Array.isArray(control.selectors) && control.selectors.length,
      `${control.key} carries selectors`);

    if (control.kind === "toggle") continue;
    assert.ok(control.min < control.max, `${control.key} has a usable range`);
    assert.equal(typeof control.fallback, "number", `${control.key} has a numeric fallback`);
    assert.ok(control.fallback >= control.min && control.fallback <= control.max,
      `${control.key} fallback ${control.fallback} sits inside ${control.min}..${control.max}`);
  }
});

test("every toggle is shaped as a toggle, not a broken slider", () => {
  // (V.2, 17 Oct) the one toggle, text glow, retired with the glow itself;
  // there are none today. The shape rule still holds for the next one.
  const toggles = ALL_CONTROLS.filter((c) => c.kind === "toggle");
  assert.deepEqual(toggles.map((c) => c.key), []);
  for (const t of toggles) {
    assert.equal(t.off, "none", "its off state is a value the grammar accepts");
    assert.equal(validValue(t.off), true);
  }
});

// ------------------------------------------------- the value grammar (security)

test("validValue accepts the documented grammar and nothing else", () => {
  for (const good of ["none", "12px", "1.5em", "0.45", "-0.06em", "24s", "50%", "999", "0"]) {
    assert.equal(validValue(good), true, `${good} is a legal value`);
  }
});

test("validValue refuses every shape that would inject CSS", () => {
  // This is an ALLOW-list, so these are illustrations rather than the defence
  // itself — but they are the shapes that matter, and each one would be live
  // CSS on <html> if the grammar ever loosened.
  const attacks = {
    "extra declaration": "12px;color:red",
    "closing the rule": "12px} body{display:none",
    "a url": "url(https://example.com/x.png)",
    "a data url": "url(data:image/svg+xml,<svg/>)",
    "legacy expression": "expression(alert(1))",
    "an import": "@import 'x'",
    "important": "12px !important",
    "a nested var": "var(--ed-fs-btn)",
    "calc": "calc(1px + 2px)",
    "a bare colour": "red",
    "a newline": "12px\n",
    "a comment": "12px/*x*/",
    "space before unit": "12 px",
    "uppercase unit": "12PX",
    "exponent": "1e3px",
    "an unlisted unit": "12rem",
    "empty": "",
  };
  for (const [why, value] of Object.entries(attacks)) {
    assert.equal(validValue(value), false, `${why}: ${JSON.stringify(value)}`);
  }
});

test("a value must be a string, and a short one", () => {
  for (const notAString of [12, null, undefined, {}, [], true]) {
    assert.equal(validValue(notAString), false, JSON.stringify(notAString));
  }
  // 24 characters is the cap, and it is a boundary.
  assert.equal(validValue("1".repeat(21) + "px"), true, "23 characters is fine");
  assert.equal(validValue("1".repeat(22) + "px"), true, "24 characters is the limit");
  assert.equal(validValue("1".repeat(23) + "px"), false, "25 is refused");
});

// ------------------------------------------------------------ importing

test("an import keeps only known keys and reports what it dropped", () => {
  const result = sanitizeImport(JSON.stringify({
    "--ed-fs-btn": "13px",          // known key, legal value
    "--ed-fs-deck": "url(evil)",    // known key, illegal value
    "--not-a-control": "12px",      // unknown key, legal value
    "--glow-ink": "none",           // the retired glow toggle (V.2): unknown now
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.overrides, { "--ed-fs-btn": "13px" });
  assert.equal(result.dropped, 3, "the caller is told, rather than silently losing them");
});

test("an unknown key cannot smuggle a CSS property through an import", () => {
  // `setProperty` would happily set any of these. The allow-list is what stops
  // an exported-and-edited file from writing properties the console never had.
  const smuggled = sanitizeImport(JSON.stringify({
    "--ed-evil": "1px", "color": "red", "background": "12px", "--tw-anything": "0",
  }));
  assert.deepEqual(smuggled.overrides, {}, "nothing unknown survives");
  assert.equal(smuggled.dropped, 4);
});

test("an import accepts a bare map or a wrapped one", () => {
  const bare = sanitizeImport('{"--ed-fs-btn":"13px"}');
  const wrapped = sanitizeImport('{"overrides":{"--ed-fs-btn":"13px"}}');
  assert.deepEqual(bare.overrides, wrapped.overrides);
  assert.equal(bare.dropped, 0);
  assert.equal(wrapped.dropped, 0);
});

test("an unusable import is refused with a reason, not a crash", () => {
  assert.deepEqual(sanitizeImport("not json at all"), { ok: false, error: "not valid JSON" });
  assert.deepEqual(sanitizeImport(""), { ok: false, error: "not valid JSON" });
  assert.deepEqual(sanitizeImport("null"), { ok: false, error: "no overrides object" });
  assert.deepEqual(sanitizeImport('"a string"'), { ok: false, error: "no overrides object" });
  assert.deepEqual(sanitizeImport("42"), { ok: false, error: "no overrides object" });

  // An array is technically an object, so it is walked rather than refused —
  // and yields nothing, because its keys are "0", "1", ... Harmless, and
  // recorded here so the asymmetry with `null` is not read as a bug.
  const asArray = sanitizeImport("[1,2]");
  assert.equal(asArray.ok, true);
  assert.deepEqual(asArray.overrides, {});
  assert.equal(asArray.dropped, 2);
});

// ---------------------------------------------------------------- storage

test("stored overrides are re-filtered on load, not trusted", () => {
  // localStorage is user-writable, so what was valid when it was saved proves
  // nothing about what is there now.
  const storage = {
    [UILAB_KEY]: JSON.stringify({
      "--ed-fs-btn": "13px",
      "--ed-fs-nav": "12px;color:red",
      "--handwritten": "1px",
    }),
  };
  withBrowser(storage, () => {
    assert.deepEqual(loadOverrides(), { "--ed-fs-btn": "13px" });
  });
});

test("corrupt or absent storage loads as empty rather than throwing", () => {
  withBrowser({ [UILAB_KEY]: "{not json" }, () => assert.deepEqual(loadOverrides(), {}));
  withBrowser({ [UILAB_KEY]: "null" }, () => assert.deepEqual(loadOverrides(), {}));
  withBrowser({}, () => assert.deepEqual(loadOverrides(), {}));
  withBrowser({ [PRESETS_KEY]: "{not json" }, () => assert.deepEqual(loadPresets(), {}));

  // Positive counterpart, so the four above are not vacuous.
  withBrowser({ [UILAB_KEY]: '{"--ed-fs-btn":"13px"}' }, () => {
    assert.deepEqual(loadOverrides(), { "--ed-fs-btn": "13px" });
  });
});

// ------------------------------------------------------------- applying

test("applying an override writes it and clears every control it does not name", () => {
  // The second half is how RESET works. If `removeProperty` were ever dropped,
  // a cleared knob would keep its old inline value on <html> forever — the
  // console would look reset while the page stayed changed.
  const { applied, removed } = withBrowser({}, (spy) => {
    applyOverrides({ "--ed-fs-btn": "13px", "--ed-rad-btn": "0px" });
    return spy;
  });

  assert.equal(applied.get("--ed-fs-btn"), "13px");
  assert.equal(applied.get("--ed-rad-btn"), "0px");
  assert.equal(applied.size, 2, "only the named controls are written");
  assert.equal(removed.length, ALL_CONTROLS.length - 2, "every other control is cleared");
  assert.ok(removed.includes("--ed-fs-deck"), "including ones never mentioned");
  assert.equal(removed.includes("--ed-fs-btn"), false, "and not the ones just set");
});

test("applying an empty map clears everything — that is the reset", () => {
  const { applied, removed } = withBrowser({}, (spy) => {
    applyOverrides({});
    return spy;
  });
  assert.equal(applied.size, 0, "nothing is written");
  assert.equal(removed.length, ALL_CONTROLS.length, "and every control is cleared");
});

test("applyOverrides only touches keys in the registry", () => {
  // It iterates ALL_CONTROLS rather than the caller's map, so a key that
  // slipped past validation cannot reach setProperty here either.
  const { applied } = withBrowser({}, (spy) => {
    applyOverrides({ "--ed-fs-btn": "13px", "color": "red", "--not-a-control": "1px" });
    return spy;
  });
  assert.deepEqual([...applied.keys()], ["--ed-fs-btn"]);
});

// -------------------------------------------------------------- formatting

test("formatValue rounds to three places and carries the control's unit", () => {
  const px = ALL_CONTROLS.find((c) => c.key === "--ed-fs-btn");
  const em = ALL_CONTROLS.find((c) => c.key === "--ed-ls-btn");
  const unitless = ALL_CONTROLS.find((c) => c.key === "--ed-grid-cols");

  assert.equal(formatValue(px, 13), "13px");
  assert.equal(formatValue(px, 13.00049), "13px", "rounded, not printed at full float width");
  assert.equal(formatValue(px, 13.5), "13.5px");
  assert.equal(formatValue(em, 0.14), "0.14em");
  assert.equal(formatValue(unitless, 4), "4");

  // Whatever it produces must be storable — the two halves have to agree.
  for (const control of ALL_CONTROLS) {
    if (control.kind === "toggle") continue;
    assert.equal(validValue(formatValue(control, control.fallback)), true,
      `${control.key} formats its own fallback into a legal value`);
  }
});

test("parseValue falls back to the shipped value rather than NaN", () => {
  const control = ALL_CONTROLS.find((c) => c.key === "--ed-fs-btn");
  assert.equal(parseValue(control, "17px"), 17);
  assert.equal(parseValue(control, "17"), 17);
  assert.equal(parseValue(control, "-2.5em"), -2.5);
  for (const junk of ["garbage", "", "px", null, undefined, {}]) {
    assert.equal(parseValue(control, junk), control.fallback, JSON.stringify(junk));
  }
});
