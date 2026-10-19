// tests/v2-sessions.test.js — V.2 SLICE 2: the popup grammar, the universal
// session hub and the Disc, as the markup and the dock state wire them
// (owner's blueprint, 17 Oct 2026, chapters 1 and 2). The pure laws are in
// tests/sessions.test.js and tests/disc.test.js; this file pins what the
// components must do with them. Source reads where a .jsx cannot be
// imported under node's test runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_LIMIT } from "../lib/sessions.js";
import { HAPTICS_KEY, PATTERNS } from "../lib/haptics.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const dockstate = read("lib/dockstate.js");
const host = read("app/components/SheetHost.jsx");
const deck = read("app/components/ControlCenter.jsx");
const disc = read("app/components/Disc.jsx");
const hub = read("app/components/SessionCarousel.jsx");
const postsel = read("app/components/PostSelection.jsx");
const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("the popup is derived from the hub: the dock state keeps no sheet of its own", () => {
  const body = strip(dockstate);
  assert.match(body, /sheet: derivedSheet\(state\.hub\)/, "sheet is computed from the hub on every snapshot");
  assert.ok(!/state\.sheet\s*=/.test(body), "nothing assigns a sheet directly");
  for (const fn of ["openSheet", "pushSheet", "backSheet", "closeSheet", "switchSession", "newSession", "closeSession", "undoClose", "renameSession", "openHub", "closeHub", "closeManager"]) {
    assert.match(body, new RegExp("export function " + fn + "\\("), fn + " is exported");
  }
});

test("the hub persists on this device (1.9) and is never overwritten before it has been read", () => {
  const body = strip(dockstate);
  assert.match(body, /SESSIONS_KEY = "asilum-sessions-v2"/);
  assert.match(body, /if \(typeof window === "undefined" \|\| !state\.hydrated\) return;/, "persist is guarded by hydration");
  for (const fn of ["openSheet", "pushSheet", "openHub", "toggleHub", "newSession"]) {
    assert.match(body, new RegExp("export function " + fn + "\\([^)]*\\) \\{ hydrateHub\\(\\);"), fn + " hydrates lazily");
  }
  assert.match(strip(host), /useEffect\(\(\) => \{ hydrateHub\(\); \}, \[\]\);/, "the host hydrates on mount");
});

test("the popup's gesture grammar (1.2): swipe down from the header dismisses, swipe right goes back, a tap outside never closes a heavy popup", () => {
  const body = strip(host);
  assert.match(body, /if \(s && e\.clientY - s\.y > SWIPE_DOWN\) dismiss\(\);/);
  assert.match(body, /if \(e\.clientX - s\.x > SWIPE_BACK && Math\.abs\(e\.clientY - s\.y\) < 40\) backSheet\(\);/);
  assert.match(body, /if \(e\.target === e\.currentTarget && lightweight\) dismiss\(\);/);
  assert.match(body, /checkout: \{[^}]*heavy: true/, "a payment page is heavy");
  assert.match(body, /post: \{.*heavy: true/, "an edit in progress is heavy");
  assert.match(body, /document\.documentElement\.dataset\.popup = "1";/, "the root is marked while a popup is up");
  assert.match(css, /\[data-popup\] \.fixture \{[^}]*transform: scale\(0\.92\)[^}]*opacity: 0\.55/, "the fixtures shrink and go translucent (1.12)");
});

test("the deck's Post disc has two lives (1.25, 1.26): Post Selection with no popup, the session indicator with one", () => {
  const body = strip(deck);
  assert.match(body, /if \(popupUp\) \{ haptic\("press"\); toggleHub\(\); return; \}/, "with a popup up a tap opens the hub");
  assert.match(body, /openSheet\("postselect"\);/, "with none it opens Post Selection");
  assert.match(body, /const popupUp = !!dock\.sheet \|\| !!dock\.hub\.hubOpen;/);
  assert.match(body, /<b className="cccount" aria-hidden="true">\{sessionCount\}<\/b>/, "the 01/10 counter rides on the disc");
  assert.match(body, /\{indicator \? "SESSIONS" : k\.label\}/);
  assert.match(body, /LONG_PRESS_MS/, "a long hold opens the compact menu");
  assert.match(body, /NEW SESSION/);
});

test("the FEED key twice (1.13, 1.14): the first tap dismisses the popup, the second refreshes and scrolls to the top", () => {
  const body = strip(deck);
  assert.match(body, /if \(dock\.sheet \|\| dock\.hub\.hubOpen\) \{ e\.preventDefault\(\); closeSheet\(\); return; \}/);
  assert.match(body, /new CustomEvent\("asilum:feed-refresh"\)/);
  assert.match(body, /window\.scrollTo\(\{ top: 0/);
});

test("the Disc: pointer physics from lib/disc.js, the centre confirms, the dwell ring, reduced motion drops momentum, off is a slim slider", () => {
  const body = strip(disc);
  assert.match(body, /stepMomentum\(st, n, dt\)/, "the frame loop runs the tested physics");
  assert.match(body, /e\.stopPropagation\(\);\s*pressRef\.current/, "the centre is a button, not the start of a turn");
  assert.match(body, /if \(next\.tick\) haptic\("tick"\);/, "a tick as it snaps (2.1)");
  assert.match(body, /velocity: reduced\.current \? 0 : d\.velocity/, "reduced motion: no momentum");
  assert.match(body, /strokeDashoffset=\{ring \* \(1 - progress\)\}/, "the dwell ring fills");
  assert.match(body, /type="range"/, "off: a slim slider (2.10)");
  assert.match(body, /prefKey\(name\)/, "the preference is per interface (2.7)");
  assert.match(body, /ArrowLeft|ArrowRight/, "the keyboard turns it");
  assert.match(body, /onLongPress/, "the centre's long hold");
});

test("the session carousel: MRU order, the counter, × and swipe-up close with Undo, rename, sensitive previews hidden, the manager at the limit", () => {
  const body = strip(hub);
  assert.match(body, /ordered\(hub\)/);
  assert.match(body, /counter\(hub, focused\.id\)/);
  assert.match(body, /if \(dy < -60 && Math\.abs\(dx\) < 50\) \{ close\(list\[i\]\); return; \}/, "swipe up closes (1.24)");
  assert.match(body, /className="sessx"/);
  assert.match(body, /undoClose\(\)/);
  assert.match(body, /renameSession\(s\.id, draft\)/);
  assert.match(body, /previewFor\(s, \{ revealSensitive: reveal \}\)/, "sensitive previews need the device's reveal (1.34)");
  assert.match(body, /hub\.manager \?/, "the manager explains the limit (1.6)");
  assert.match(body, /SESSION_LIMIT/);
  assert.equal(SESSION_LIMIT, 10);
  assert.match(body, /<Disc[\s\S]*name="sessions"/, "the session dial is the same Disc (2.6)");
});

test("Post Selection: the six types on the disc; LISTING and ECHO say `soon` and never pretend", () => {
  const body = strip(postsel);
  for (const t of ["TRANSM", "STILL", "MOTION", "BRDCST", "LISTING", "ECHO"]) assert.match(body, new RegExp('label: "' + t + '"'));
  assert.match(body, /className="fine soon postsoon"/);
  assert.match(body, /pushSheet\("post", \{ kind: t\.id, title: t\.label \}\)/, "a type opens the one composer");
  assert.ok(!/fetch\(/.test(body), "nothing is faked with a request");
});

test("haptics: navigator.vibrate behind one On/Off key, never a required dependency", () => {
  assert.equal(HAPTICS_KEY, "asilum-haptics");
  assert.ok(PATTERNS.tick && PATTERNS.press && PATTERNS.confirm);
  const body = strip(read("lib/haptics.js"));
  assert.match(body, /navigator\.vibrate/);
  assert.match(body, /try \{/, "a device without vibration is not an error");
});
