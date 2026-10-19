// tests/client-render-cost.test.js — audit findings #18 and #19 from
// docs/history/audit-verified-2026-08-14.md.
//
// Both are browser-side, and both are pure performance: the pixels and the DOM
// are meant to come out the same. That leaves nothing functional for a test to
// catch, so these are structural guards, and the visual half was verified in
// the browser instead (both themes, both interface models, mobile at 375px,
// zero console errors — screenshots in the PR).
//
// Measured in the running app rather than asserted here, because a timing
// assertion in CI is the flakiest thing you can write:
//   #19  /board fetched paris-roads.json TWICE (823 kB each). Now once.
//   #18  a token read costs 0.0025ms, so three per frame at 60fps was
//        0.4ms/s per dock — small in a quiescent page, and the real hazard is
//        the forced style recalculation when the page is NOT quiescent, which
//        a microbenchmark cannot show. Reading a constant every frame is
//        wrong regardless of what it currently costs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- #18 AsteriskDock -------------------------------------------------------

test("C1 the draw loop reads no design tokens", () => {
  const code = read("app/components/AsteriskDock.jsx");
  const start = code.indexOf("const draw = () => {");
  assert.notEqual(start, -1, "draw() not found — this test is stale");
  const body = code.slice(start, code.indexOf("const frame = () => {"));
  assert.ok(body.length > 500, "the draw body looks truncated");
  assert.ok(!body.includes("css("),
    "token reads inside draw() are three forced style flushes on every frame");
  assert.ok(!body.includes("getComputedStyle"),
    "and neither is reaching for getComputedStyle directly");
  // The values still have to reach the loop from somewhere.
  assert.ok(/SIG|RED|OSD/.test(body), "draw() still uses the token values");
});

test("C2 the tokens are re-read when the theme or interface changes", () => {
  // Hoisting them is only safe if something invalidates. Theme and interface
  // model are attributes on documentElement (shell.js / settings), so the
  // observer has to watch exactly those.
  const code = read("app/components/AsteriskDock.jsx");
  assert.ok(code.includes("new MutationObserver("), "nothing would notice a theme change");
  assert.match(code, /attributeFilter:\s*\[[^\]]*"data-theme"/,
    "phosphor dark / ice light switch data-theme");
  // V.2 slice 1 retired the MODULE RAIL / ORB HUB interfaces: data-model is
  // gone from the root and must not be watched for (tests/v2-shell.test.js)
  assert.ok(!/"data-model"/.test(code), "no interface model survives");
  assert.ok(code.includes("readTokens()"), "and the observer must actually re-read");
});

test("C3 colors still come only from tokens", () => {
  // Rule 3 of the UI law: a literal hex in a component is a defect. Caching
  // the reads must not have tempted anyone into inlining a value.
  const code = read("app/components/AsteriskDock.jsx");
  const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexes, [], "no literal colors — --sig and --red are the source");
  assert.ok(code.includes('css("--sig")') && code.includes('css("--red")'));
});

test("C4 an off-screen dock stops drawing, and cleanup is complete", () => {
  const code = read("app/components/AsteriskDock.jsx");
  assert.ok(code.includes("IntersectionObserver"),
    "mounted in the shell on every route, it ran whether or not anything could see it");
  assert.ok(/paused\s*=\s*!onScreen/.test(code), "visibility must drive the pause");
  assert.ok(/if \(paused\) return;/.test(code), "and the frame must honour it");
  for (const teardown of ["observer?.disconnect()", "themeWatch.disconnect()", "cancelAnimationFrame(raf)"]) {
    assert.ok(code.includes(teardown), `unmount must release ${teardown}`);
  }
});

test("C5 reduced motion is still one static frame, not a loop", () => {
  // Rule 7 is non-negotiable, and the pause logic must not have quietly
  // started an ambient loop for users who asked for none.
  const code = read("app/components/AsteriskDock.jsx");
  assert.ok(code.includes('matchMedia("(prefers-reduced-motion: reduce)")'));
  assert.match(code, /if \(rm\) draw\(\);\s*\n\s*else frame\(\);/,
    "reduced motion draws once; everyone else gets the loop");
  assert.match(code, /if \(!rm && onScreen && !raf\)/,
    "and becoming visible must not start a loop for a reduced-motion user");
});

// ---- #19 ParisMap -----------------------------------------------------------

test("C6 the 823 kB road document is fetched once per page, not once per caller", () => {
  // /board calls useParisRoads AND renders PassportSecurity, which calls it
  // again — two independent fetches of the same immutable file. Verified in
  // the browser: /board now issues exactly one request for it.
  const code = read("app/components/ParisMap.jsx");
  assert.match(code, /^let roadsPromise = null;$/m,
    "the shared promise must live at module scope, above the hook");
  const hook = code.slice(code.indexOf("export function useParisRoads"));
  const guard = hook.indexOf("if (!roadsPromise)");
  const load = hook.indexOf('fetch("/paris-roads.json")');
  assert.notEqual(guard, -1, "the hook must reuse an in-flight or settled load");
  assert.equal((code.match(/fetch\("\/paris-roads\.json"\)/g) || []).length, 1,
    "exactly one place in the module may load the document");
  assert.ok(load > guard, "and that load must sit behind the cache check, not run per caller");
});

test("C7 a failed load does not poison the cache forever", () => {
  // Caching a rejection would leave the hologram permanently blank after one
  // flaky load, which is worse than the duplicate fetch it replaced.
  const code = read("app/components/ParisMap.jsx");
  assert.match(code, /roadsPromise = null;\s*return d;/,
    "a null result must clear the cache so a later mount can retry");
});

test("C8 ParisMap still renders from a prop and owns no fetching", () => {
  const code = read("app/components/ParisMap.jsx");
  const component = code.slice(code.indexOf("export default function ParisMap"));
  assert.ok(!component.includes("fetch("), "the view stays a pure function of `map`");
  assert.ok(component.includes("map.buildings") && component.includes("map.stars"),
    "and still draws every layer it drew before");
});
