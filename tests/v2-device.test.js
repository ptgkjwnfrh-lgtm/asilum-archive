// tests/v2-device.test.js — THE DEVICE (owner, 18 Oct 2026, evening;
// CONSTITUTION A6 third addendum): the louder rainbow glass, the original
// gradients and the dark phosphor glow, the ">>>>>>" load-in, the warning
// lights, the piece floating over the fogged Feed, the original passport.
// Pure where it can be; source reads where the markup is the law.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chevronFrame, CHEVRON_RUN } from "../lib/feed/chevrons.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const css = read("app/globals.css");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (name) => { const i = css.indexOf(name); return css.slice(i, css.indexOf("\n}", i)); };

test("the >>>>>> frame: the text arrives behind a six-chevron run and never changes length", () => {
  assert.equal(CHEVRON_RUN, 6);
  const t = "silly little vid promoting my new song";
  for (let n = -CHEVRON_RUN; n <= t.length + 2; n++) {
    const f = chevronFrame(t, n);
    assert.equal(f.shown.length + f.chevrons.length + f.rest.length, t.length, "nothing reflows at n=" + n);
    assert.ok(/^>*$/.test(f.chevrons) && f.chevrons.length <= CHEVRON_RUN);
    assert.equal(f.shown + t.slice(f.shown.length), t, "what is shown is the start of the text");
  }
  assert.deepEqual(chevronFrame("abcdefghij", 2), { shown: "ab", chevrons: ">>>>>>", rest: "ij" });
  assert.deepEqual(chevronFrame("abc", 0), { shown: "", chevrons: ">>>", rest: "" }, "a short text: the run never passes the end");
  assert.deepEqual(chevronFrame("abc", 99), { shown: "abc", chevrons: "", rest: "" });
  assert.deepEqual(chevronFrame(null, 3), { shown: "", chevrons: "", rest: "" });
});

test("expanding a compacted description loads it in from >>>>>>: the caption, the event, the place, the overview, behind the product", () => {
  const ch = strip(read("app/components/Chevrons.jsx"));
  assert.match(ch, /prefers-reduced-motion: reduce/, "reduced motion: the text is simply there");
  assert.match(ch, /aria-label=\{t\}/, "the full text is the accessible name from the first frame");
  assert.match(strip(read("app/components/PostCard.jsx")), /<ChevronText as="span" className="wpccap full" text=\{p\.text\} play=\{more\} \/>/, "a tapped caption");
  assert.match(strip(read("app/components/PostCard.jsx")), /<ChevronText className="fine" text=\{\[String\(event\.kind/, "an opened BRDCST event");
  assert.match(strip(read("app/components/MapSheet.jsx")), /<ChevronText as="p" text=\{place\.organizer\} \/>/, "the place's description");
  assert.match(strip(read("app/components/PersonOverview.jsx")), /<ChevronText as="p" className="povsum" text=\{person\.summary\} \/>/, "Read more → the overview");
  assert.match(strip(read("app/components/ListingSheet.jsx")), /<ChevronText className="cclbl" text=\{"BEHIND THE PRODUCT"/, "behind the product");
  assert.match(strip(read("app/components/MediaFloat.jsx")), /\{up \? <ChevronText as="p" className="mftext"/, "the floating media's caption, raised");
  assert.match(rules, /\.chevtext \.chevrun \{ color: var\(--warn\);/);
  assert.match(rules, /\.chevtext \.chevrest \{ color: transparent; \}/, "the not-yet text keeps its place");
});

test("the warning lights: square, dark at rest, blinking like an eject light on a purchase, a bag or an offer, then dark; the deck's pair answers", () => {
  const listing = strip(read("app/components/ListingSheet.jsx"));
  for (const where of [/onClick=\{\(e\) => \{ blinkLamp\(e\); toBag\(\); \}\}[^\n]*<Lamp \/>/, /<button type="submit" className="buy" onClick=\{blinkLamp\}><Lamp \/>send ✓/, /onClick=\{async \(e\) => \{ blinkLamp\(e\); setBuying\(true\);/, /blinkLamp\(e\); setTimeout\(\(\) => setTicket\(true\), 420\);[^\n]*<Lamp \/>request purchase/]) {
    assert.match(listing, where);
  }
  const deck = strip(read("app/components/ControlCenter.jsx"));
  assert.match(deck, /<span className="devlights" ref=\{lightsRef\} aria-hidden="true"><Lamp \/><Lamp \/><\/span>/);
  assert.match(deck, /window\.addEventListener\("asilum:bag", on\)/, "a piece in the bag blinks the deck's lights");
  assert.match(rules, /\.lamp \{[^}]*width: 7px; height: 7px;[^}]*background: color-mix\(in srgb, var\(--warn\) 22%, transparent\)/s, "square, dark at rest");
  assert.match(rules, /\.lamp\[data-blink="eject"\] \{ animation: ejectlight 1\.8s steps\(1, end\) forwards; \}/, "it blinks and stays dark at the end");
  assert.match(rules, /@keyframes ejectlight \{[^}]*0%, 20%, 40%, 60% \{[^}]*\}\s*10%, 30%, 50%, 70%, 100% \{/s);
  assert.match(rules, /prefers-reduced-motion: reduce\) \{ \.mrzcursor \{ animation: none; \} \.lamp\[data-blink\] \{ animation: ejectonce/, "reduced motion: one soft light, no blinking");
  assert.match(block(":root {"), /--shade/);
  assert.match(rules, /:root \{ --warn: #ff4136;/, "the lights are red in dark too");
});

test("a double tap floats the piece over the fogged Feed, reactive to movement; one tap still opens the listing", () => {
  const page = strip(read("app/page.js"));
  assert.match(page, /const DOUBLE_TAP_MS = 280;/);
  assert.match(page, /if \(onFloat && now - tap\.current\.at < DOUBLE_TAP_MS\) \{\s*clearTimeout\(tap\.current\.timer\);/, "the second tap cancels the pending open");
  assert.match(page, /setTimeout\(\(\) => \{ tap\.current\.at = 0; onOpen\(\); \}, onFloat \? DOUBLE_TAP_MS : 0\)/, "one tap opens the listing a beat later");
  assert.match(page, /createPortal\(<PieceFloat item=\{floatItem\}/);
  const float = strip(read("app/components/PieceFloat.jsx"));
  assert.match(float, /useTilt\(cardRef, null, true\);/, "it turns with the phone or the cursor");
  assert.match(float, /useLiquidGlass\(cardRef, \{ id: "lg-piecefloat"/, "the card is the rainbow glass");
  assert.match(float, /className="pfloatfog"/);
  assert.match(float, /openSheet\("listing", \{ item, title: "LISTING" \}\)/, "OPEN LISTING hands over to the one hub");
  assert.match(rules, /\.pfloatfog \{[^}]*background: var\(--fog\);[^}]*backdrop-filter: blur\(9px\)/s, "the Feed behind is fogged, still there, not black");
  assert.match(rules, /\.float \{[^}]*background: var\(--fog\);/s, "the photograph float wears the same fog");
  assert.match(strip(read("app/components/FloatView.jsx")), /export function useTilt\(cardRef, haloRef = null, tilt = true\)/);
});

test("the louder rainbow: the lens splits colour, a film turns with the hand, the fixtures drift, reduced motion and transparency honoured", () => {
  const lg = strip(read("app/components/LiquidGlass.jsx"));
  assert.match(lg, /PULL\.map\(\(v, i\) => \(v \* strength \* \(1 \+ prism \* \(i - 1\) \* 0\.28\)\)/, "red, green and blue pulled apart by the prism");
  for (const f of ["app/components/InfoDock.jsx", "app/components/PassportButton.jsx", "app/components/ControlCenter.jsx", "app/components/SheetHost.jsx"]) {
    assert.match(read(f), /prism: 1/, f + " splits colour");
  }
  assert.match(rules, /@keyframes irisdrift \{ to \{ --iris-drift: 360deg; \} \}/);
  assert.match(rules, /\.fixture, \.ccenter \{ animation: irisdrift 18s linear infinite; \}/);
  assert.match(rules, /conic-gradient\(from calc\(var\(--iris-a, 200deg\) \* -1 \+ var\(--iris-drift, 0deg\)\)/, "the film turns against the rim");
  assert.match(rules, /prefers-reduced-motion: reduce\) \{ \.fixture, \.ccenter \{ animation: none; \} \}/);
});

test("the original ground and the dark phosphor glow: blue to white, green to black; dark words glow in their own colour; light never", () => {
  assert.match(block('[data-theme="light"] {'), /linear-gradient\(180deg, #d6e8f6 0%, #e7f1f9 30%, #f6fafd 64%, #ffffff 100%\)/, "blue to white");
  assert.match(block(":root {"), /linear-gradient\(180deg, #0d2219 0%, #08150f 34%, #040907 68%, #000000 100%\)/, "green to black");
  assert.match(block(":root {"), /--glow: 0 0 1px currentColor, 0 0 9px color-mix\(in srgb, currentColor 55%, transparent\)/);
  assert.match(block(":root {"), /--glow-ink: none;/, "body text never glows");
  assert.match(block('[data-theme="light"] {'), /--glow: none;/, "light never glows");
  assert.match(rules, /:root:not\(\[data-theme="light"\]\) \.headline \{ background: linear-gradient\(180deg, #f4fbf7 0%, #d4f3e1 45%, #8ee8b3 100%\);/, "the title card's chrome-to-mint letters");
});

test("the original passport (iteration 5, 7db2b89): plus registration band, the 01, the print lines, its own teal and phosphor, the machine zone at the foot", () => {
  const sec = strip(read("app/components/PassportSecurity.jsx"));
  assert.match(sec, /function Plus\(\{ x, y, s = 5, tone = "s" \}\)/);
  assert.match(sec, /<Plus key=\{i\}/);
  assert.match(sec, /<span className="ppvpage">01<\/span>/);
  const board = strip(read("app/board/page.js"));
  assert.ok(board.indexOf("<PassportSecurity") < board.indexOf('<div className="ppmrz">'), "the MRZ sits at the foot, under the hologram window");
  assert.match(board, /<div className="ppnation">ASILUM <b>\*<\/b> FASHION PASSPORT<\/div>/, "no magazine");
  assert.match(rules, /\[data-theme="light"\] \.ppdoc \{ --sig: #0b7584; \}/, "the document's own teal");
  assert.match(rules, /:root:not\(\[data-theme="light"\]\) \.ppdoc \{ --sig: #46ff96; \}/, "phosphor in dark");
  assert.match(rules, /\.pv-r \{ stroke: var\(--red\); opacity: 0\.75; \}/, "the pluses have their tones again");
  assert.match(rules, /\.ppphoto::after \{ background:[^}]*repeating-linear-gradient\(0deg, transparent 0 2px,/s, "the photo slot's print lines");
  assert.match(rules, /\.ppdoc \.ppmrz \{[^}]*border-top: 1px dashed var\(--line\);[^}]*font-family: var\(--mono\);/s);
});
