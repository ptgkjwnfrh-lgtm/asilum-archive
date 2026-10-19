# V.2 slice 1 — the shell (17 October 2026)

**Authority:** the owner's V.2 Blueprint of 17 October 2026 (Foundations:
"Screen map", "Visual constitution", "Design system"; clause 2.24 on
themes). `docs/v2/BLUEPRINT-GAP-2026-10-17.md` is the matrix this slice is
the first row of. Branch `v2/build`, forked from `main` at `495493b`.

## What this slice ships

| Blueprint | Where | Status |
| --- | --- | --- |
| Central Control Deck: FEED · SEARCH · POST (disc) · MESSAGES · ACCOUNT | `lib/dock.js` DECK (data), `lib/nav.js` deckFor, `app/components/ControlCenter.jsx` | shipped; POST opens the one composer as a sheet until slice 2 makes it Post Selection |
| Info Dock top left: LIKES, BAG, NOTICES | `lib/dock.js` UTILITIES, `app/components/InfoDock.jsx`, `BagSheet.jsx`, `NoticesSheet.jsx` | shipped; the bell reads `/api/notifications` with honest signed-out / unavailable / empty states |
| Passport Button top right: the globe | `lib/nav.js` fixtureFor, `app/components/PassportButton.jsx` | shipped as a link to `/board`; a popup in slice 2 |
| No header: no wordmark bar, marquee, big search / bag / sign-in, destination row | `app/shell.js` rewritten (1,010 → 230 lines); the wordmark lives in `app/components/Wordmark.jsx` on the Feed's masthead; the marquee's house lines run in the deck's ticker (`HOUSE_LINES`) | shipped |
| Palette: white / blue / gray / green / teal / black; dark = black / slate / subtle phosphorus green / dark green teal | `app/globals.css` token VALUES in `:root` and `[data-theme="light"]`; token NAMES kept (`--red` is now the accent, `--sig` the link blue, `--helv` Inter) so 4,300 lines of rules keep working | shipped; `tests/theme-contrast.test.js` still holds every pair at AA |
| Michroma primary, Inter secondary | `@font-face` Inter (variable, OFL) in `public/fonts/`; Share Tech Mono retired with its files | shipped |
| No CRT | scanline, grid, backlight, wash and glow tokens neutralised; `.os-crt / .os-blob / .os-plus / .os-frame / .os-status` no longer rendered and hidden by rule | shipped |
| Rainbow Liquid Glass, restrained | a conic rim masked to one pixel on `.fixture` and `.ccenter` (`--iris`); reduced-transparency drops the blur | shipped |
| Theme follows the device unless pinned | `app/layout.js` PREPAINT | shipped (supersedes the 1 Oct "always light") |
| Compact buttons feel tactile | deck keys, sheet buttons and toggles depress 4% on press | shipped (visual only; haptics are slice 2) |

## Proposed defaults (reported, not decided)

- The fixture band is 66px plus the top inset; pages pad to `--head-h`.
- Front Cover stays a page under THE FEED (`/cover`), reachable from the
  cover links the Feed already prints and from placements; it is no longer
  a deck key. MAP stays a page under PASSPORT (`/map`).
- ACCOUNT lands on `/profile`; the Passport Button lands on `/board`.
- The Info Dock's keys carry visually hidden labels and tooltips rather
  than printed words, to keep the fixture to three glyphs.

## Known gaps after this slice

- The mail desk's panel still opens from the deck; the blueprint's Direct
  Messages page (no Info Dock, music circle in the corner) is slice 3.
- The desktop landing redirect to the cover (19 Aug) is gone: every launch
  opens the Feed, on every width.
- `lib/uilab.js` (the design console) still lists the retired chrome's
  edit tokens; harmless, cleaned in the next pass.
- Pages keep their own masthead styles; the broad restyle of cards, the
  catalog, the passport and the settings rack to the new palette is the
  Feed slice's job.

## Tests actually run

`tests/v2-shell.test.js` (5, new), `tests/live-launch-v2.test.js`,
`tests/control-center.test.js`, `tests/type-stack.test.js`,
`tests/copy-law.test.js`, `tests/theme-contrast.test.js`,
`tests/brand-name.test.js`, `tests/sign-in-identity.test.js`,
`tests/sign-out-notice.test.js`, `tests/opengraph-image.test.js`, `tests/account-kinds.test.js`.

Full suite on the branch head: `npm test` 1,683 tests · 1,599 pass · 0 fail · 84 skipped. `npm run build` green (the social card now renders from a static Inter TTF; Satori cannot parse the variable file). Browser pass on the dev server at 375px and desktop, light and dark: the three fixtures, the five keys, Bag with its count, Notices signed-out, Post opening the composer.
