# Claims register — 16 August 2026

The launch audit asked for a register of every public claim ASILUM makes and
whether it is true. This is that register for the **accessibility statement**
(`app/accessibility/page.js`), the page with the most load-bearing claims and
the one the audit flagged for promising more than the product delivered.

**Why this document exists.** A published accessibility commitment the product
does not meet is a trust problem stacked on top of an access one. The failure
mode is not malice — it is drift: the statement was written on 19 July against
an intended design, and the product moved. Nothing re-checked it. Two of its
claims were plainly false when this register was compiled, and one had been
false since the day it was written.

**Method.** Every claim below was checked against the code, not against
memory or intent. "Verified" means a named file, a test, or a measurement.
Where a claim cannot be checked from the repository — a screen-reader pass, a
response-time promise — it is marked **unverified** rather than assumed true.

---

## Verdicts at a glance

| # | Claim | Verdict |
|---|---|---|
| 1 | WCAG 2.1 AA is the target standard | **true** (as a target) |
| 2 | Accessibility checks are in the release gates | **true** |
| 3 | Semantic structure: headings and landmarks | **true** |
| 4 | Skip-to-content link | **true** |
| 5 | Full keyboard operability of navigation and controls | **verified — modal focus was FALSE, fixed** |
| 6 | Visible focus | **was FALSE — fixed** |
| 7 | Text alternatives on imagery, including generated placeholders | **true** |
| 8 | High-contrast palette in both themes | **true** (one stale literal fixed) |
| 9 | Motion respects reduce-motion; marquees and tickers stop | **true** |
| 10 | Forms with real labels | **was FALSE — fixed** |
| 11 | Explicit confirmation for destructive actions | **true** |
| 12 | Works with VoiceOver, NVDA, JAWS | **VoiceOver: verified by the owner, 20 Aug 2026** (cover, discover, item modal — announcements sounded right). NVDA/JAWS remain untested (no Windows machine). The pass ALSO surfaced a real interaction bug — AT ghost-click instantly dismissed overlays — fixed same day in `useOverlayDismiss` (dismiss.js), all five modals. |
| 13 | Browser zoom to 200% | **true — measured** |
| 14 | Response within five business days | **not verifiable from code** |

---

## The two that were false

### 10. "forms with real labels"

**False from the day it was written until #233.** 43 of 62 form controls across
18 files had no accessible name at all — a screen reader announced them as
"edit text, blank". The catalog search, the discover filters, the wardrobe entry
form, the business application, the room handle, the transmission composer and
the admin token field were all silent.

A placeholder is not a label: it is not reliably exposed as the accessible name,
and it disappears once the user types, so someone tabbing back to a half-filled
field is told nothing about what it holds.

**Now true.** Guarded by `tests/a11y-form-labels.test.js`, which counts a control
as named for `aria-label`, `aria-labelledby` *or* a wrapping `<label>`.

*Correction worth keeping:* the first scan reported 59, because it did not
recognise implicit association — an `<input>` nested inside a `<label>` is
already correctly named. 16 controls were already right. The real number was 43.

### 6. "visible focus"

**False for four controls.** `.search` (top-bar search), `.controls
input[type='text']` (the passport trainer and new-board field), `.usearch input`
(people search) and `.composer2 textarea` (the transmission composer) each set
`outline: none` and defined no `:focus` style anywhere — so a keyboard user
tabbing into them saw nothing. WCAG 2.4.7, Level AA.

**Now true.** Each takes the focus convention already used elsewhere in
`globals.css`: a border shift to `--sig`, the interaction voice. Guarded by
`tests/a11y-focus-visible.test.js`, which fails on any rule that suppresses the
outline without replacing it.

**Three of the four fixes are live; one is pre-emptive.** `.composer2` appears
**only in `globals.css`** — no JSX uses that class, so its block (lines 772–784)
is dead CSS and its new focus rule guards nothing today. Left in place rather
than removed: deleting a styled-but-unmounted component is a judgement call
about whether it is coming back, not an accessibility fix. Flagged here so the
next reader knows it is unused.

**Verified live, not inferred.** With the search panel open and a real click,
`.search` matches `:focus` and its `border-bottom-color` computes to
`rgb(70, 255, 150)` — `--sig` in the phosphor theme — where it previously
computed to `--line`. An earlier probe that reported "no change" was wrong for a
harness reason worth remembering: **an automated `el.focus()` sets
`document.activeElement` but does NOT make the element match `:focus` unless the
browser window itself has focus.** Click, do not call `.focus()`, when checking
focus styles.

**A second defect found the same way:** `.skiplink:focus` hard-coded
`#e5342b` — the pre-#218 red, which measured **3.92:1 and failed AA**. #218
darkened `--red` to `#cc2219` to pass, and this literal was missed, so the skip
link's own focus ring still used the failing colour. Now `var(--red)`. This is
precisely what UI law rule 3 (colours only through tokens) exists to prevent,
and the register's token test now enforces it for every focus rule.

---

## The verified true

- **2. Release gates.** `.github/workflows/ci.yml` runs `npm test` on every PR,
  and the suite includes `a11y-structure`, `a11y-form-labels`,
  `a11y-focus-visible` and `theme-contrast`. The claim was aspirational when
  written; it is now literally true.
- **3. Semantic structure.** Every masthead route ships exactly one `<h1>`
  (pinned in `a11y-structure`), and `<header>`, `<nav>`, `<main>` and
  `<footer>` are all present.
- **4. Skip link.** `app/shell.js` — `<a className="skiplink" href="#main">`.
- **7. Text alternatives.** All 20 `<img>` carry an `alt`; 8 are deliberately
  `alt=""` (decorative, so a card announces one name rather than two), and
  generated placeholders carry `alt={item.title}`.
- **8. Contrast.** #216 and #218 brought every audited token to AA in both
  themes; `tests/theme-contrast.test.js` recomputes from the stylesheet, so a
  future palette edit fails there rather than in someone's eyes.
- **9. Reduced motion.** `prefers-reduced-motion` blocks stop `.mq` (the
  ticker), `.os-roll`, `.os-blob`, `.pulse` and `.gxplug`, plus a global
  `animation-duration: 0.01ms !important` override.
- **11. Destructive confirmation.** Erasure requires typing
  `DELETE PERSONALIZATION`; the server checks the same string.

---

## The unverified — and why they stay that way

These are **not** claimed to be false. They are claimed without evidence, which
is the same problem in a quieter form.

- **5. "Full keyboard operability."** Operability, focus order and the modal's
  focus behaviour are now all verified and guarded. See below. What remains
  unchecked is only the subjective half — whether the order *reads* sensibly to
  a person, which is part of the screen-reader pass in claim 12.
- **12. VoiceOver / NVDA / JAWS.** **VoiceOver pass run by the owner, 20 Aug
  2026** — /cover, /discover, and the item modal all announced sensibly. The
  pass did exactly what a human pass is for: it caught a bug no static test
  could — assistive-tech activation fires a DUPLICATED click at the trigger's
  screen position, and the ghost click landed on the overlay behind the
  just-opened modal, instantly dismissing it. Fixed the same day:
  `useOverlayDismiss` (components/dismiss.js) guards every overlay (target
  must be the overlay itself + a 400ms birth window), applied to all five
  modals, mechanically verified both ways. NVDA/JAWS still untested — needs
  a Windows machine; the claim's wording on /accessibility should name
  VoiceOver only until then.
- ~~**13. Zoom to 200%.**~~ **Now measured and true.** See below.
- **14. Five business days.** A process commitment, unverifiable from code.
  Left to the owner.

---

## Claim 13, measured: 200% zoom passes

**Method.** 200% browser zoom halves the CSS viewport, so a 1280px window
becomes 640 CSS px. Each route was loaded at a 640px viewport and the document
measured for horizontal overflow — `documentElement.scrollWidth` against
`clientWidth`. A horizontal scrollbar is the failure condition for WCAG 1.4.4.

| route | viewport | document scrollWidth | horizontal scrollbar |
|---|---|---|---|
| `/` | 640 | 640 | no |
| `/discover` | 640 | 640 | no |
| `/hotlist` | 640 | 640 | no |
| `/cover` | 640 | 640 | no |

**Claim 13 is true.** The elements that do extend past 640 — `.mq` (the ticker)
and `.snav` (the destination row) — are intentionally scrolling containers, and
neither extends the document.

### Open finding: `/cover` overflows at viewports below ~392px

Not part of claim 13, and **not a WCAG 1.4.4 failure** — but it is a WCAG 1.4.10
(Reflow) question, and 1.4.10 is Level AA, so it falls inside the stated
"WCAG 2.1 AA" target.

At a **320px** viewport `/cover` reports a document `scrollWidth` of **392px**;
at **375px** it still reports **392px**, a 17px overflow. Every other route
tested reflows cleanly to 320. Content is visibly clipped at the right edge.

**One cause was found and fixed.** `.cvband` used `grid-template-columns: 1fr`,
and a bare `1fr` is `minmax(auto, 1fr)` — the column cannot shrink below its
content's min-content width. That floor was 354px, so `.cvhot` rendered 354px
wide inside a 292px parent. It is now `minmax(0, 1fr)`, the pattern already used
by `.roomgrid`, scoped to the existing `@media (max-width: 980px)` block and
therefore identical at every width where the content fits. Measured after:
`.cvhot` is 292px.

**A second cause remains and is NOT attributed.** After that fix the document is
still 392px, with **zero in-flow elements exceeding their parent**. Ruled out:
`.cvband` (fixed), `.adrawer` (whose `left: 12px + width: 380px` sums to exactly
392, but which is not in the DOM on this route — the match is coincidence), and
the fixed-position `.os-frame` / `.tophead` / `.os-crt`, which are 392 *because*
their containing block is 392 and are therefore symptoms rather than causes.

This is left open deliberately rather than guessed at. **Do not record `/cover`
as passing or failing 1.4.10 until the residual 392px floor is identified** —
the measurement cannot currently separate a real defect from emulated
layout-viewport behaviour at that width.

---

## Claim 5, part done: operability verified, focus order not

**What was checked.** Every `onClick` on a non-native element across `app/` —
an exhaustive static sweep, not a spot check. A `<span onClick>` takes no focus,
fires on no key, and announces as text, so it is unusable from a keyboard.

**Six were genuine failures, and all six are fixed:**

| control | was | now |
|---|---|---|
| designer chip, item detail | `<span onClick>` → `window.location.href` | `<a href>` |
| brand line, item detail | `<div onClick>` → `window.location.href` | `<a href>` |
| brand filter chips, `/profile` (×2) | `<span onClick>` | `<button type="button">` |
| chip remove "×", `/upload` (×3) | `<i onClick>`, **no name at all** | named `<button>` |

The two that navigate became **links, not buttons** — that is what gives
keyboard, middle-click and open-in-new-tab for free.

**Four shapes are legitimate and were not "fixed":** an overlay scrim that
dismisses (there is always a real `.mclose` and Escape), a wrapper that only
calls `stopPropagation`, an `aria-hidden` element whose sibling does the work,
and a card wrapper duplicating a real link it contains. `tests/a11y-keyboard.test.js`
recognises each by what it *is*, and **asserts the last two rather than trusting
them** — the scrim must ship a close control, the card must really hold a title
link.

**Still unverified, and why the claim is not marked simply "true":** focus
*order* (WCAG 2.4.3) and keyboard *traps* (2.1.2) need a real tab-through by a
person. A static sweep proves every control can be reached; it cannot prove they
are reached in a sensible order, or that focus can always get back out.

---

## Claim 5, second half: focus order and the modal

**Focus order (WCAG 2.4.3) is sound by construction.** Tab order follows DOM
order unless something overrides it, and nothing here does: there is **no
positive `tabIndex` anywhere** in `app/` (the single `tabIndex` use is `{0}`,
which is correct), and **zero `order:` declarations** in `globals.css`, so flex
and grid never reorder content away from its source order. The two `reverse`
matches are animation directions, not flex directions.

**The modal was the real defect, and `aria-modal` was lying.** The item detail
declared `aria-modal="true"` — which tells assistive technology everything
behind it is inert — while, verified with a **real click and real Tab presses**:

- focus stayed on the trigger **behind** the layer when the dialog opened;
- **200 focusable elements behind it remained tabbable**;
- nothing was `inert`.

So a keyboard user opened a piece, kept focus in the catalog, and could tab
through a page they could no longer see — while a screen-reader user was told
the opposite. The code's own comment claimed "the page behind it was inert",
which is precisely what was untrue.

**Fixed** with `useFocusTrap` in `app/components/dismiss.js`, the module that
already owns the dismissal contract. Focus moves in on open, Tab cycles inside,
and focus is **restored to whatever opened the dialog** on close — the half
people forget, without which closing a dialog drops the user at the top of the
document. Escape still closes it, so this is not a trap the user cannot leave
(that would be WCAG 2.1.2).

**Verified end to end with real input, not simulated events:** click a card
title → focus lands on "close item detail"; **35 Tab presses → focus never
leaves the dialog**; Escape → dialog closes and focus returns to the exact card
title that opened it.

`tests/a11y-modal-focus.test.js` guards the **pairing**: nothing may declare
`aria-modal` without being wired to the trap. Focus behaviour cannot be asserted
from source, but that pairing is the thing that actually regressed.

---

## Not a defect: the sub-12px type count

169 of 302 `font-size` declarations in `globals.css` are under 12px. The audit
raised it, and it is worth the owner's attention — but **no WCAG success
criterion mandates a minimum font size.** The relevant criterion is 1.4.4
(Resize Text), which asks that text survive 200% zoom, and that is claim 13
above — untested either way. Small type is the OS design language; changing it
is a design decision, not an accessibility fix.

---

## Standing instruction

**Do not revise `app/accessibility/page.js` until claim 12 is verified or
narrowed, and claim 5's focus-order half is checked by a person.** Claim 13 is
measured and true; claim 5's operability half is verified and guarded. The page is closer to true than it was — the two false
claims are now true — but "full keyboard operability" and the named screen
readers are still asserted without evidence. Fixing the statement means either
doing the work or softening the wording; it does not mean editing the page to
match what we wish were true.


---

## Re-checked 17 August, after the day's UI round

The wordmark was rebuilt (justified sub-lines, an `aria-label`, `aria-hidden`
spans), the VT323 face was retired across 25 rules, and the passport machine zone
was resized. Three claims could plausibly have moved. **All three hold**, measured
rather than assumed:

| Claim | Result |
|---|---|
| 5 — keyboard operability | the wordmark link is reachable by Tab and activates as before |
| 6 — visible focus | **present** — `outline: auto 1px` on real keyboard focus |
| 13 — 200% zoom | ASILUM 125px → 250px, both sub-lines still flush at both ends, no sideways scroll |

**The accessible name improved.** The link used to announce its concatenated text
nodes — "\*ASILUMMAGAZINEFASHION INTELLIGENCE OS". Splitting the sub-lines into
per-glyph spans would have made that worse, so the anchor now carries an explicit
`aria-label` ("\*ASILUM magazine — back to the catalog") and the decorative spans
are `aria-hidden`. One name, in one place, whatever the lockup does visually.

**The new 7–8px type does not change §"Not a defect: the sub-12px type count".**
No WCAG criterion mandates a minimum size, the relevant one is 1.4.4 (claim 13,
verified above), and both sub-lines are `aria-hidden` — they are a visual lockup,
not text anyone has to read to use the page.

### A measurement trap worth keeping

**`element.focus()` from script does not match `:focus-visible`.** The first pass
here reported `outline: none` on the wordmark and looked like a regression of
claim 6. It was the measurement: Chrome only matches `:focus-visible` when focus
arrives by keyboard, and a scripted `.focus()` after mouse activity does not
qualify. Driving a real `Tab` keypress showed the ring was there all along.
**A focus-ring audit done with `.focus()` will report every control as unstyled.**

---

## The verification was itself verified — 17 August

*Amended in place. Everything above records what was checked; nothing recorded
whether the checks could FAIL. That is not a pedantic distinction here: this
session found three tests that could not fail and read as correct (trap 22), and
a detector whose own guard pattern matched the data it was protecting against
(trap 32). A claim defended by a test that cannot fail is an unverified claim
with extra confidence attached.*

So each claim's test was run against a deliberate breakage of the thing it
guards. **Seven mutations, seven caught:**

| claim | test | mutation introduced | |
|---|---|---|---|
| 6 visible focus | `a11y-focus-visible` | focus indicator changed to a literal colour | caught |
| 6 visible focus | `a11y-focus-visible` | new rule with `outline: none` and no focus style | caught |
| 8 contrast | `theme-contrast` | light theme `--sig` → `#f2f2f2` | caught |
| 10 form labels | `a11y-form-labels` | an `<input>` with no accessible name | caught |
| 10 form labels | `a11y-form-labels` | an `<input>` named only by its placeholder | caught |
| 5 keyboard | `a11y-keyboard` | a real `<button>` turned into a clickable `<div>` | caught |
| 5 modal focus | `a11y-modal-focus` | `useFocusTrap` unwired from the item dialog | caught |

**Claims 5, 6, 8 and 10 are defended by tests that demonstrably fail when the
property breaks.** That is a stronger statement than "the tests pass", and it is
the one this register should have been making.

### Three mutations "survived" and every one was my own error

Recorded because the failure mode is seductive — a survivor reads as a weak test
and invites a rewrite of something that was never broken:

- Removing an `outline:` declaration from a `:focus-visible` rule. The test's
  rule is *"no rule removes the focus outline without defining a focus style"*;
  deleting a declaration does not create an `outline: none`, so nothing was
  violated.
- Repointing `--ink`. `theme-contrast` reads `--sig`, `--bg` and `--paper` under
  an explicit `[data-theme]` scope; `--ink` is not one of its pairs.
- Stripping `aria-label` from a `<button>` whose text content is `×`. The button
  still had an accessible name — a poor one, but the test asserts presence.

**A survived mutation is a claim about the test AND about the mutation. Check the
second before believing the first.** Claim 12 remains unverified and still needs
a person at a screen reader; nothing here changes that.
