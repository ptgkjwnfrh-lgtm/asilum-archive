---
name: asilum-ui
description: Load before ANY user-interface change — the V.2 shell law (fixtures, deck, popups, sessions, the Disc), token discipline, and the checks a UI diff must pass.
---

# ASILUM UI rules — V.2 (owner's blueprint, 17 October 2026)

FACTS live in knowledge/ui/ (design-language, typography, motion,
interaction). The V.2 Blueprint supersedes the 1 October brief and the
July–September header law wherever they differ; `docs/v2/
BLUEPRINT-GAP-2026-10-17.md` is the build matrix and each `docs/v2/
slice-*.md` says what landed. Non-negotiables when touching UI:

1. THREE FIXTURES AND NO HEADER. Info Dock top left (LIKES · BAG ·
   NOTICES, `lib/dock.js` UTILITIES), Passport Button top right (the
   globe), the Central Control Deck at the bottom (FEED · SEARCH · POST
   disc · MESSAGES · ACCOUNT, `lib/dock.js` DECK). Destinations resolve
   through `lib/nav.js`; a business account swaps ACCOUNT for ANALYTICS
   and loses the Passport Button. Nothing else floats; no wordmark bar,
   no marquee, no destination row (`tests/v2-shell.test.js` pins this).
2. ONE POPUP, ONE HUB. Every secondary surface is a popup over the root
   (`app/components/SheetHost.jsx`), opened at ~60% height, from a view in
   its VIEWS table — never a page of its own, never a second modal. The
   popup is DERIVED from the universal session hub (`lib/sessions.js`,
   `lib/dockstate.js`): `openSheet` extends the active session,
   `pushSheet` adds a step, Back / swipe right restores, swipe down from
   the header or Escape dismisses, a tap outside dismisses only a
   lightweight view (never `heavy`: checkout, an edit in progress).
   Dismissing keeps the session; ten sessions, most-recent first, the
   manager at the eleventh, close with Undo. The deck's POST disc is the
   session indicator (`01/10`) while a popup is up; a long hold opens the
   compact menu. Posting is unavailable inside a popup.
3. THE DISC is one component (`app/components/Disc.jsx`, physics in
   `lib/disc.js`): Post Selection, the session dial, later Wardrobe and
   Followers. Drag, flick, momentum, magnetic snap, tick while slow, tap
   the centre or dwell one second, keyboard arrows, a per-interface Off
   that swaps in a slim slider. Never a second rotary.
4. Haptics go through `lib/haptics.js` (`haptic("tick"|"press"|"confirm"|
   "error"|"toggle")`), behind the one On/Off key; never a dependency.
5. Red (`--red`: a true red in light per the owner's 18 Oct reference, the
   phosphor green in dark) is the only accent: activity, alert, selection,
   ASTERISK. `--sig` paints links.
   Colors ONLY through tokens; a literal hex in a component is a defect.
   Theme follows the device unless pinned; no CRT, no grid, no scanline.
   The DARK palette glows (A6 third addendum): a word glows in its own
   colour through --glow / --glow-r; body text never; light never. The
   device language (`app/components/Chevrons.jsx`: ChevronText, Lamp,
   blinkLamp, MrzLine) is used sparingly, never as decoration everywhere.
6. Michroma for labels and headings (`--mich`), Share Tech Mono (`--mono`)
   for decks, tabs, meta and the search field — the description face of the
   owner's 18 Oct reference — Inter for reading (`--helv`). Compact buttons
   depress 4% on press. No lines: no scanlines, hairline fields or grids.
7. Suffix grammar: → in-app, ↗ external/publish, ✓ confirm. Coming-soon
   controls use class `soon` and say what they wait for — never a dead or
   fake-success button, never a request that pretends.
8. Dismissal contract: Escape + click-away (components/dismiss.js) — use
   it, don't reinvent it. prefers-reduced-motion is mandatory for any
   animation; the Disc drops momentum under it.
9. Every shell-visible change is checked at 375px AND desktop, light AND
   dark, with a popup up and down.
10. DESIGN CONSOLE (knowledge/ui/design-console.md): owner-editable sizes
    route through `var(--ed-*, shipped)` with a registry entry in
    `lib/uilab.js`; never route color. Checks pass with no overrides set.
11. THE ONE FEED: no Wire, no second stream. Every card is one of the
    eight types in `lib/feed/types.js`; the packer decides the span, the
    components only draw. A piece opens the LISTING popup, media the
    "media" popup, an echo the "echo" popup — never a page-local modal.
12. Delete what a slice supersedes. Retired chrome leaves no CSS, no
    component and no test behind; `tests/v2-shell.test.js` lists the
    selectors that must stay gone.
