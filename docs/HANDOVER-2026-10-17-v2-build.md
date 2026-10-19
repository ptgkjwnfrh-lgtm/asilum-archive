# Handover — the V.2 build, 17 October 2026

Read this first in a new session. It is the whole state of the V.2 build
as of the end of 17 October; nothing here is in the owner's head only.

## Where things are

- **Worktree:** `/Users/noemosallowed/asilum-v2`, branch **`v2/build`**,
  forked from `origin/main` at `495493b`. Never `cd` to the main checkout
  (`~/Downloads/*ASILUM website prototype [july6]`); the stash stack is
  shared, so never bare `git stash`.
- **PR:** [ptgkjwnfrh-lgtm/asilum#484](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/484)
  "V.2 slices 1–3: the shell; popups and the session hub; the one Feed;
  the name is *ASILUM". Open, CI green, Auto-fix off. The `gh` token has
  no `read:org` scope: edit the PR with
  `gh api -X PATCH repos/ptgkjwnfrh-lgtm/asilum/pulls/484 -f title=… -F body=@file`,
  not `gh pr edit`.
- **Commits on the branch:** `c4aaa48` slice 1 (the shell), `caa9efb`
  slice 2 (popups, the session hub, the Disc, dead chrome deleted),
  `e983d76` slice 3 (the one Feed, the brand). Each slice has a note in
  `docs/v2/slice-N-*.md`; the matrix and the ten-slice order are in
  `docs/v2/BLUEPRINT-GAP-2026-10-17.md`.
- **The blueprint itself** (all 345 clauses, the Terms, the figures) is
  the owner's artifact: https://claude.ai/artifact/5QcKoX1yAttRP1z8k9hHWn.
  Read it with the Artifact tool's `read` + `path: "index.html"` (537 KB;
  strip the tags to text and grep) — never fetch it. It still spells
  "ASiLUM"; republishing it with the new spelling is pending.
- **Node:** this machine has no system node. Every npm/node call needs
  `export PATH=~/.local/node-v20.18.1-darwin-arm64/bin:$PATH`.
- **Dev server:** `nohup npm run dev -- -p 3480 > /tmp/asilum-v2-dev.log &`
  then http://localhost:3480 (the preview tool resolves the wrong
  launch config; use Bash). `.env.local` is in the worktree and reads the
  production database — never `npm test` in a shell that sourced it.
- **Gates:** `npm test` (1,723 tests, 1,639 pass, 84 skipped, 0 fail at
  `e983d76`), `npm run build` (green), `npm run docs:codemap` after any
  structural change. A full suite takes ~30 s; run it in the background.

## The owner's rulings this session (latest wins)

1. **The name is `*ASILUM`.** No lowercase i anywhere ("ASiLUM" is
   gone from code, tests, knowledge, memory); no "magazine" after it —
   the 17 August "magazine is never dropped" rule is retired. Tab title
   `*ASILUM`, template `%s · *ASILUM`, wordmark `<i>*</i>ASILUM` alone,
   social-card sub-line `asilum.com`, order mail `*ASILUM — order paid`.
   `tests/brand-name.test.js` enforces all of it.
2. **The domain.** The owner is buying **www.asilum.com**. Nobody buys it
   for them. Once they own it and attach it to the Vercel project, the
   switch is `SITE_ORIGIN=https://www.asilum.com` (env, or the default in
   `lib/site.js` in one commit with `tests/seo.test.js` and
   `tests/canonical-host.test.js` following); `REDIRECT_HOSTS` already
   names the asilummagazine hosts, so they redirect the moment
   `SITE_HOST` changes. Flip nothing before the DNS is live.
3. **Delete superseded code in every slice** ("actively delete the old
   code base if it's not needed"). Retired chrome leaves no CSS, no
   component, no test; `tests/v2-shell.test.js` lists selectors that must
   stay gone. `/tmp/deadcss.py <worktree>` inventories dead rules in
   `app/globals.css` (one survivor at a time; rerun after each slice).
4. **Build order:** "Open a PR for slice 1, then continue into slice 2…"
   — one PR, slices as commits, the owner says when to continue. The next
   step offered at the end of this session: **slice 4, the tag grammar**.

## What the three slices built (the shape of the code now)

- **Shell** (`app/shell.js`, `lib/nav.js`, `lib/dock.js`): three fixtures
  — Info Dock (LIKES · BAG · NOTICES), Passport Button (globe), Central
  Control Deck (FEED · SEARCH · POST disc · MESSAGES · ACCOUNT). No header.
  Michroma + Inter, the blueprint's palette under the old token names, no
  CRT, theme follows the device (`app/layout.js` PREPAINT).
- **Popups and sessions** (`lib/sessions.js` pure, `lib/dockstate.js`
  derives `sheet` from the hub, `app/components/SheetHost.jsx` renders the
  VIEWS table: likes, search, messages, overview, bag, notices, post,
  postselect, sessions, listing, media, echo, checkout). Gesture grammar:
  swipe down from the header dismisses, swipe right goes back, tap outside
  dismisses lightweight views only (`heavy`), `[data-popup]` dims the
  fixtures. Ten sessions, MRU, `01/10`, manager at the eleventh, Undo,
  rename, sensitive previews veiled; persisted under `asilum-sessions-v2`
  on the device only, never written before read. The POST disc is the
  session indicator while a popup is up (long hold → NEW SESSION /
  SESSIONS). FEED twice: dismiss, then `asilum:feed-refresh`.
- **The Disc** (`lib/disc.js` physics, `app/components/Disc.jsx`): drag,
  flick, momentum, magnetic snap ramping with deceleration, ticks while
  slow, tap the centre or dwell 1 s, long hold, arrow keys, reduced motion,
  per-interface Off → slim slider (`asilum-disc-<name>`). Haptics
  (`lib/haptics.js`) behind `asilum-haptics`, gated on user activation;
  Settings → APPEARANCE → Haptics.
- **The one Feed** (`app/page.js` ~1,200 lines, `lib/feed/types.js`):
  eight card types, Tetris weights → spans, `packFeed` → grid / full /
  strip segments, `braid` (a post after every third piece, a PLACE after
  every ninth), the ECHO rail. `ListingSheet.jsx` is the LISTING popup
  (the item modal is gone; `AsteriskWhy.jsx` moved out of the page),
  `MediaFloat.jsx` enlarges STILL/MOTION with the caption on the media
  (`lib/feed/caption.js` picks the ink), `PlaceCard.jsx` expands in place,
  `EchoRail.jsx` holds the rail and the viewer, `WireCard.jsx` wears the
  type chip and the BRDCST footer. `lib/feed/actions.js` is how a popup
  acts on a piece (the page listens for `asilum:piece`). ECHO is stored as
  `attachments.echo.expiresAt` (`lib/wire/compose.js`, 1–24 h); the
  editorial route never serves an expired one.
- **Honest `soon`s:** OFFER (slice 6), COMMENT, LISTING as a post type
  (slice 6), VIDEO (media worker), SONG cards (music catalog), cross-device
  sessions, immersive MOTION, the compact map popup for a BRDCST.

## What is next: slice 4, tags

From the gap matrix: the `LEFT: RIGHT` renderer over the existing facets
(`lib/tagging/vocabulary.js`; the left-side hierarchy MAKER → HOUSE →
SCENE → AESTHETIC → MATERIAL → ERA → PLACE maps onto brand / designer /
subculture / mood / material / era / origin), three visible per product
with a state tag (`PRODUCT: SOLD`, `OFFER: ACCEPTED`) taking the third
slot, the rest behind the product, tags as search queries, the
consistency check, only ASTERISK assigns (admins rewrite). The owner's
examples: `EAMES: CHAIR`, `SAINT LAURENT: BOMBER JACKET`, `PUNK: RECORD`,
`ROCK: CASSETTE`, `GOTHIC: JEWELRY`, `SILVER: JEWELRY`, lineage
`HEDI SLIMANE: SAINT LAURENT`, state `OWNED: <name>`. The friend asterisk
(`*name` on mutual follow) needs follower knowledge the server does not
track — an owner decision, listed in the matrix with the other five
(fresh launch, Front Cover, eBay inventory, fees, music APIs).

The seam for slice 4: `ListingSheet.jsx` shows `Object.keys(item.tags)`
with `VISIBLE_TAGS = 3` and the BEHIND THE PRODUCT expander — replace the
plain chips with the tag renderer; `WireCard.jsx` / `FragmentCard` in
`app/page.js` print the Feed card's three.

Then slices 5–10 as the matrix orders them: ASTERISK governance
(confidence cap, agent split, per-function pause, audits), native
commerce (`codex/native-storefront` once pushed), protection and the
Passenger Score, BRDCST billing, media, onboarding.

## Gotchas learned the hard way

- The Disc's centre is a button inside the drag surface: it must
  `stopPropagation` on pointerdown or the disc captures the pointer.
- HMR resets the dock's module state; the hub hydrates lazily before any
  mutation and persists only once hydrated, or a reload wipes it.
- Test regexes over JSX: `[^}]*` dies on `{...p}`; use `.*`.
- zsh: never start an `echo` argument with `=` (it is a command lookup);
  quote `--include='*.js'` globs.
- Satori (the social card) cannot read the variable Inter file; the
  static `public/fonts/inter.ttf` is for it.
- The browser pane's console keeps old errors across reloads; judge by
  the dev log and the page's behaviour.
