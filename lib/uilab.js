// lib/uilab.js — DESIGN CONSOLE registry + persistence (client-safe).
//
// Every knob the console exposes maps to one CSS custom property routed
// through globals.css as `var(--ed-*, fallback)`. Nothing here invents a
// value: the fallback in CSS is the shipped design; an override in
// localStorage `asilum-uilab` is the owner's hand edit, applied inline on
// <html> before first paint (see app/layout.js) and live by the console.
//
// `selectors` is what the INSPECT mode matches against: click an element
// on the page and the console jumps to the controls that govern it.
//
// V.2 (owner's blueprint, 17 Oct 2026): the header, the ticker marquee, the
// status bar, the scanlines, the grid, the haze and the glow are gone, and
// so are their controls (nineteen retired). The console never routes colour.

/** localStorage key for the owner's live overrides. */
export const UILAB_KEY = "asilum-uilab";
/** localStorage key for saved named presets. */
export const PRESETS_KEY = "asilum-uilab-presets";

// value grammar for stored overrides — lengths, times, ratios, "none".
const SAFE_VALUE = /^(none|-?\d+(\.\d+)?(px|em|s|%)?)$/;

/** Every knob the console exposes, grouped for the panel. Each control names
 *  the CSS custom property it drives and the `selectors` INSPECT mode matches
 *  against, so clicking an element jumps to the controls that govern it. */
export const GROUPS = [
  {
    id: "type",
    title: "TYPE — SIZES & TRACKING",
    controls: [
      { key: "--ed-fs-headline", label: "page headline", unit: "px", min: 16, max: 120, step: 1, fallback: 60, fluid: true, note: "shipped: fluid 38–84px (the cover's masthead, 9 Sep); a hand value fixes it", selectors: [".headline", ".headsub"] },
      { key: "--ed-fs-covermast", label: "cover masthead", unit: "px", min: 36, max: 150, step: 2, fallback: 72, fluid: true, note: "shipped: fluid 44–96px; a hand value fixes it", selectors: [".cvmastline", ".cvmast"] },
      { key: "--ed-fs-gxmast", label: "upload masthead", unit: "px", min: 28, max: 120, step: 2, fallback: 60, fluid: true, note: "shipped: fluid 30–60px; a hand value fixes it", selectors: [".gxmastline", ".gxmast"] },
      { key: "--ed-ls-headline", label: "headline tracking", unit: "em", min: -0.06, max: 0.4, step: 0.01, fallback: 0.02, selectors: [".headline"] },
      { key: "--ed-fs-deck", label: "deck / subline", unit: "px", min: 9, max: 24, step: 0.5, fallback: 13, selectors: [".deck"] },
      { key: "--ed-fs-statshead", label: "section head", unit: "px", min: 8, max: 24, step: 0.5, fallback: 12, selectors: [".statshead"] },
      { key: "--ed-fs-wordmark", label: "wordmark", unit: "px", min: 12, max: 34, step: 0.5, fallback: 19, selectors: [".wordmark"] },
      { key: "--ed-fs-cardttl", label: "card title", unit: "px", min: 9, max: 24, step: 0.5, fallback: 14.5, selectors: [".card .ttl", ".ttl"] },
      { key: "--ed-fs-cardprice", label: "card price", unit: "px", min: 9, max: 24, step: 0.5, fallback: 14.5, selectors: [".card .price", ".price"] },
      { key: "--ed-fs-fitline", label: "card fit line", unit: "px", min: 8, max: 18, step: 0.5, fallback: 12, selectors: [".fitline"] },
      { key: "--ed-fs-modalttl", label: "item modal title", unit: "px", min: 11, max: 30, step: 0.5, fallback: 17, selectors: [".mbody .ttl", ".mbody"] },
      { key: "--ed-fs-tab", label: "tab labels", unit: "px", min: 8, max: 18, step: 0.5, fallback: 12.5, selectors: [".tab"] },
      { key: "--ed-fs-chip", label: "chips / pills", unit: "px", min: 8, max: 18, step: 0.5, fallback: 12, selectors: [".chip"] },
      { key: "--ed-fs-setname", label: "settings row name", unit: "px", min: 10, max: 22, step: 0.5, fallback: 14.5, selectors: [".setname", ".setrow"] },
      { key: "--ed-fs-legal", label: "legal / fine print", unit: "px", min: 10, max: 20, step: 0.5, fallback: 14.5, selectors: [".legal"] },
    ],
  },
  {
    id: "buttons",
    title: "BUTTONS",
    controls: [
      { key: "--ed-fs-btn", label: "button text", unit: "px", min: 9, max: 20, step: 0.5, fallback: 13, selectors: [".btn"] },
      { key: "--ed-pad-btn-y", label: "button pad ↕", unit: "px", min: 4, max: 24, step: 1, fallback: 12, selectors: [".btn"] },
      { key: "--ed-pad-btn-x", label: "button pad ↔", unit: "px", min: 6, max: 40, step: 1, fallback: 19, selectors: [".btn"] },
      { key: "--ed-ls-btn", label: "button tracking", unit: "em", min: 0, max: 0.4, step: 0.01, fallback: 0.14, selectors: [".btn"] },
      { key: "--ed-rad-btn", label: "button corner", unit: "px", min: 0, max: 999, step: 1, fallback: 999, note: "999 = full pill, 0 = square", selectors: [".btn", ".fitbtn", ".platform", ".chip"] },
      { key: "--ed-fs-fitbtn", label: "small button text", unit: "px", min: 8, max: 16, step: 0.5, fallback: 11, selectors: [".fitbtn"] },
      { key: "--ed-pad-fitbtn-y", label: "small button pad ↕", unit: "px", min: 3, max: 16, step: 1, fallback: 7, selectors: [".fitbtn"] },
      { key: "--ed-pad-fitbtn-x", label: "small button pad ↔", unit: "px", min: 6, max: 28, step: 1, fallback: 14, selectors: [".fitbtn"] },
      { key: "--ed-fs-cardact", label: "card action row", unit: "px", min: 8, max: 16, step: 0.5, fallback: 11, selectors: [".cardacts button", ".cardacts"] },
      { key: "--ed-fs-action", label: "modal action row", unit: "px", min: 8, max: 16, step: 0.5, fallback: 11, selectors: [".actions button", ".actions"] },
      { key: "--ed-fs-followbtn", label: "follow button", unit: "px", min: 8, max: 14, step: 0.5, fallback: 10, selectors: [".followbtn"] },
      { key: "--ed-fs-txtbtn", label: "text buttons", unit: "px", min: 8, max: 14, step: 0.5, fallback: 10, selectors: [".txtbtn", ".railact", ".wact", ".modmore"] },
    ],
  },
  {
    id: "layout",
    title: "LAYOUT & SHAPE",
    controls: [
      { key: "--ed-wrap-w", label: "content max width", unit: "px", min: 900, max: 2200, step: 20, fallback: 1500, selectors: [".wrap"] },
      { key: "--ed-main-pad-x", label: "page side padding", unit: "px", min: 8, max: 80, step: 2, fallback: 30, selectors: [".main"] },
      { key: "--ed-grid-cols", label: "feed columns", unit: "", min: 2, max: 7, step: 1, fallback: 4, selectors: [".grid"] },
      { key: "--ed-grid-colw", label: "feed column min", unit: "px", min: 140, max: 420, step: 10, fallback: 240, selectors: [".grid"] },
      { key: "--ed-grid-gap", label: "feed column gap", unit: "px", min: 6, max: 48, step: 2, fallback: 20, selectors: [".grid"] },
      { key: "--ed-card-gap", label: "card stack gap", unit: "px", min: 8, max: 60, step: 2, fallback: 26, selectors: [".card"] },
      { key: "--ed-img-rad", label: "image corner", unit: "px", min: 0, max: 32, step: 1, fallback: 22, selectors: [".imgwrap"] }, // 22 = --radius-card (slice 14: rounded everywhere)
      { key: "--ed-panel-rad", label: "panel corner", unit: "px", min: 0, max: 28, step: 1, fallback: 14, selectors: [".panel"] },
      { key: "--ed-gx-globe", label: "purchase globe size", unit: "px", min: 160, max: 360, step: 10, fallback: 250, selectors: [".gxglobecv"] },
    ],
  },
  {
    id: "atmosphere",
    title: "ATMOSPHERE",
    controls: [
      { key: "--ed-img-sat", label: "image saturation", unit: "", min: 0.2, max: 1.4, step: 0.02, fallback: 0.92, selectors: ["img"] },
    ],
  },
  {
    id: "motion",
    title: "MOTION",
    controls: [
      { key: "--ed-zoom", label: "image hover zoom", unit: "", min: 1, max: 1.15, step: 0.005, fallback: 1.045, selectors: [".card img", ".imgwrap"] },
    ],
  },
];

/** GROUPS flattened — the lookup every function below iterates. */
export const ALL_CONTROLS = GROUPS.flatMap((g) => g.controls);

const ALLOWED_KEYS = new Set(
  ALL_CONTROLS.map((c) => c.key)
);

/** Is this a storable override value? Short, and matching the value grammar
 *  (lengths, times, ratios, "none"). THE ALLOWLIST IS THE GUARD — these strings
 *  are written into inline styles, so anything outside the grammar is refused
 *  rather than escaped. */
export function validValue(value) {
  return typeof value === "string" && value.length <= 24 && SAFE_VALUE.test(value);
}

/** The owner's overrides, filtered to known keys with valid values.
 *  Re-validates on every read, so a hand-edited or stale localStorage entry
 *  cannot introduce a property the registry does not define. */
export function loadOverrides() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(UILAB_KEY) || "{}");
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
      if (ALLOWED_KEYS.has(key) && validValue(value)) clean[key] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

/** Persist overrides. Silent on failure — a blocked localStorage must not
 *  break the console. */
export function saveOverrides(map) {
  try { window.localStorage.setItem(UILAB_KEY, JSON.stringify(map)); } catch {}
}

/** Write the overrides onto <html> as inline custom properties, REMOVING any
 *  the map does not set. The removal is what makes "reset" work: the CSS
 *  fallback in globals.css is the shipped design, so clearing the inline value
 *  restores it rather than needing the original to be stored anywhere. */
export function applyOverrides(map) {
  const root = document.documentElement;
  for (const control of ALL_CONTROLS) {
    if (map[control.key] !== undefined) root.style.setProperty(control.key, map[control.key]);
    else root.style.removeProperty(control.key);
  }
  // The catalog grid's column count is computed in React from these
  // variables (useColumnCount in app/page.js); say that they changed — after
  // they have.
  try { window.dispatchEvent(new CustomEvent("asilum:edition")); } catch {}
}

/** A number plus its control's unit, rounded to three decimals for display. */
export function formatValue(control, number) {
  const rounded = Math.round(number * 1000) / 1000;
  return `${rounded}${control.unit || ""}`;
}

/** A stored string back to a number, falling back to the control's shipped
 *  value. Never NaN — a slider bound to NaN renders at an arbitrary position. */
export function parseValue(control, value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : control.fallback;
}

/** Saved presets, or {} on any failure. */
export function loadPresets() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PRESETS_KEY) || "{}");
    return typeof raw === "object" && raw ? raw : {};
  } catch {
    return {};
  }
}

/** Persist presets. Silent on failure, as saveOverrides. */
export function savePresets(presets) {
  try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch {}
}

// Import: accept only known keys with valid values; report what was dropped.
export function sanitizeImport(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: "not valid JSON" }; }
  const overrides = parsed && typeof parsed === "object" ? (parsed.overrides || parsed) : null;
  if (!overrides || typeof overrides !== "object") return { ok: false, error: "no overrides object" };
  const clean = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(overrides)) {
    if (ALLOWED_KEYS.has(key) && validValue(value)) clean[key] = value;
    else dropped += 1;
  }
  return { ok: true, overrides: clean, dropped };
}
