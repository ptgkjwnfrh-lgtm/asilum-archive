# Live Launch V.2 — the implementation note, 17 September 2026

**Branch:** `ui/live-launch-v2` (a worktree on `origin/main` at `b29810f`).
**Status:** a reviewable model in the production source. Not merged, not
deployed — the brief asks for a branch and a preview, and merge is the
owner's word.

The brief (`ASILUM_Live_Launch_V2_Claude_Handoff.md`, 17 Sep) supersedes
the older seven-destination order where they disagree; every other law —
no faking, branch + PR, build and suite green, the copy law, ADR-002
identity, ADR-006 privacy, the rights register — is untouched and was
pinned by the suite throughout (1482 tests · 1406 pass · 0 fail · 76
skipped at the last run; `next build` green).

## 1. What each V.2 surface maps to

| V.2 surface | Route / module | Reused | New |
| --- | --- | --- | --- |
| Four destinations | `lib/nav.js`, `app/shell.js` | the nav table, the capability swap (`lib/accounts.js`), the glass header | `ACCOUNT_MENU`, the account circle with drawers, the thumb bar under 760px |
| Front Cover | `app/cover/page.js` | the feed pick, film strip, hotlist preview, looks, wire, reading room, index, ledger | an editorial lead (sample, credited), NEAR YOU from the places register, one-line masthead |
| Discover · PIECES | `app/page.js` (the ranked grid) | everything — chunked feed, modes, craving, filters, the item detail | `DiscoverTabs`, the demo line, SAVE in the detail, no first-visit sheet |
| Discover · SEARCH | `app/discover/page.js`, `/api/discover` | the inert parser, constraint chips + release, suggestions, rails, readings | the sourced overview on a matching search, the binding-constraint count on an empty rack with RELEASE IT |
| Discover · AROUND YOU / PEOPLE | `app/discover/page.js?tab=` | — | `PlacesPanel`, `PersonOverview` |
| The Wire | `app/hotlist/page.js`, `/api/editorial`, `/api/feed` | the composer, the floor, LIKE/SAVE counters, the hotlist rail | CREATE/CURATE/INTERPRET + category as hashtags, lanes, sample editorial when thin, pieces braided in every third entry |
| Passport · COLLECTION | `app/board/page.js`, `/api/boards`, `lib/save.js` | the document, moodboards, the training station | one save across kinds, filters, the ledger and stamps, the example benefit |
| Passport · FULL READ | `app/components/TasteNetwork.jsx`, `/api/taste`, `lib/taste/network.js` | `vizState`, `TAG_AFFINITY`, `mutateProfile`, boards | the graph, evidence kinds, keep/reduce/remove/explore, one-step undo |
| Passport · PLACES | `lib/places/registry.js`, `/api/places`, `lib/location.js`, `FashionMap.jsx` | the curated-table pattern (`houses.js`) | the register, the schematic map, the three location controls |
| Passport · STUDIO | `app/components/Studio.jsx`, `/api/verification`, `lib/verification/desk.js` | the booth application (`/api/business`), the products.json import behind THE DESK, the taxonomy scan | the Shopify MODEL walkthrough, event/shop/promotion drafts on the device, the desk |
| Sample media | `public/model/`, `lib/model/media.js` | — | eight licensed files (7 Unsplash, 1 CC BY 4.0), credited in `public/model/credits.json` and on screen |

## 2. Decisions made under the design freedom

1. **CATALOG folded into DISCOVER.** The ranked grid at `/` is discovery; it
   became the PIECES door. `/discover` is SEARCH. Both carry the same row.
2. **PROFILE, ORDERS, SETTINGS left the destination row** for the account
   circle at the top right. SETTINGS stays reachable signed out (the theme).
3. **Full Read is a Passport tab.** `/stats` still exists for the staff-only
   house numbers and says so; the taste network is the reader's own view.
4. **The masthead is compact everywhere.** The word and its faint second line
   sit on one row (24–34px); the cover's is one line. Useful media sits in
   the first screen on a 936px desktop and at 390px.
5. **Readable controls.** Nav words 13.5px, body 14px, buttons 14px, chips
   13px, metadata 9–11px — by tokens, so the design console still tunes them.
6. **One save.** `lib/save.js` is the verb; pieces still land on the
   moodboard (it teaches the brain), posts still count on the transmission
   for accounts; people, places, events and articles are device-local and
   say so. The first save on a signed-out device offers an account, once.
7. **The map is a drawing.** No tile service, no map library (none exists in
   the repo; the rights register keeps editorial imagery blocked). A radar
   for local, a graticule for world. This is also exactly what a public
   Passport may draw when the city is hidden.
8. **Paris only for Paris.** The passport's road hologram draws only when the
   base city is Paris or unset. Another city gets no street map — the repo
   holds no other city's roads, and a hidden city must never show one.
9. **Categories and intents are hashtags.** `#create #style` ride on the
   transmission text the wire already parses into refs. No schema moved.
10. **The research column of the desk is local rules, and says so** on every
    case. Cited research arrives with `AI_RESEARCH_ENABLED` and a key.

## 3. The ten journeys, as they run on the branch

1. Cover → the sample lead or tonight's piece → SAVE → PASSPORT · COLLECTION
   lists it; on a signed-out device the first save shows the account
   moment (SavePrompt) and nothing before it.
2. Wire → lanes → a post to save, a tag to follow into DISCOVER, a piece to
   open or save; progress is the collection, never the scroll.
3. Search "oliver rousteing" → the sourced overview (Puig primary, AP for
   Balmain; role and dates current; last updated; correction path queued
   on the device). "rick owens" shows no overview — he has no row.
4. Search "black cropped leather jacket" → constraint chips stay; on an
   empty rack the page counts each constraint alone and offers RELEASE IT
   for the one that binds, never widening on its own.
5. Passport · FULL READ → ten nodes with MANUAL / INFERRED / CURATED
   evidence → keep / reduce / remove / explore → UNDO. Guidance-off is
   shown, not hidden.
6. Passport · PLACES → confirm Bowie, Maryland → the local radar with the
   sourced PG County Fashion Week row and labelled fixtures → WORLD →
   public "Based in" detail and audience → map switch (off by default).
7. Passport · STUDIO → the Shopify MODEL walkthrough (real path: apply for a
   verified booth) → add an event or shop as a draft → the drafts list.
8. Studio → request a promoted placement on a draft → SPONSORED label; the
   copy says what it cannot buy.
9. Studio → the desk: material conflicts in the ARCHIVALIST QUEUE, the rest
   flagged / pending / agreed; absent evidence stays pending.
10. Passport · COLLECTION → the member-benefit card: 1% founders fee on $600
    = $6, a funded $5 credit would make it $1 — labelled EXAMPLE, tied to
    the real fee law (`lib/orders.js`), no crossed-out price anywhere.

## 4. What is honest-but-simulated, and what is device-only

| Thing | State | Label on screen |
| --- | --- | --- |
| Shopify connection | walkthrough; real OAuth needs a partner app (register: BLOCKED) | CONNECTION REQUIRED · MODEL |
| Events, shops, promotions | drafts in `localStorage["asilum-studio-drafts"]` | ON THIS DEVICE |
| Saves of people/places/events | `localStorage["asilum-saves"]` | ON THIS DEVICE |
| Location (three concepts + map switch) | `localStorage["asilum-location"]`, current area in `sessionStorage` | ON THIS DEVICE |
| Corrections (overview, place) | `localStorage["asilum-corrections"]` | QUEUED ON THIS DEVICE |
| The desk's research column | local taxonomy rules | LOCAL RULES — MODEL OFF |
| Sample editorial posts | fixtures with credited licensed photographs | SAMPLE EDITORIAL |
| Places other than the two sourced rows | fixtures | SAMPLE FIXTURE |
| The member benefit | an example | EXAMPLE — NOT A LIVE OFFER |

## 5. Production gaps (in the order they block)

1. **A saves table for non-piece kinds** and adoption of the device record on
   sign-in (`adoptAccountData` + `purgePersonalizationData`, per AGENTS.md).
2. **Location columns** (base city, public detail, audience, map switch) with
   the visibility rule enforced server-side; a coarse creator-pin layer that
   reads only consented rows. IP suggestion at setup, never stored.
3. **A places/events directory table** with the provenance fields the
   register already shapes, a submission queue, and a review desk that
   sets `lastChecked`; a tile or vector basemap under a licence.
4. **Shopify partner app + OAuth** with read-products scope only; the
   import already exists behind THE DESK.
5. **Promotion requests** as rows with the SPONSORED disclosure carried
   through the feed contract (ADR-005) — never touching ranking truth.
6. **The desk's research column** through `lib/asterisk/research.js` and the
   `learned_facts` ladder once `AI_RESEARCH_ENABLED` and a key exist;
   archivalist resolution as an append-only ledger with a named reviewer.
7. **Per-tag provenance in the profile** (today `_meta.manual` and one undo
   snapshot; adoption should carry both).
8. **The media pipeline** for posts (storage, moderation, video) — the wire's
   IMAGES and VIDEO modes still say "coming soon".
9. **A creator-qualification snapshot** (250k views/post × 5 months) with the
   open rules decided: platform scope, post types, month boundaries, sample
   size, fraud, renewal, appeals.
10. Safari: unverified on this branch (the glass and bend paths are
    unchanged; the new SVG surfaces use no filters).

## 6. Privacy and security notes

- No new server writes carry location, drafts or corrections; nothing here
  leaves the device except the taste ops (explicit acts, consent-gated,
  rate-limited 60/h) and the existing board and engagement writes.
- `/api/places` and `/api/verification` are public reference reads with
  nothing personal in them; `/api/taste` resolves identity the same way
  every other route does (`resolveRequestUser`).
- A public Passport never draws a recognizable city when the city is hidden;
  a creator pin is coarse and off by default.
- The sample photographs are the only imagery added; their licences permit
  it and each is credited where shown and in `public/model/credits.json`.

## 7. External approvals and variable-cost triggers

- Shopify partner app review (distribution to many merchants).
- A basemap licence (or OSM tile policy compliance) before any live map.
- Model keys for the research column (per-piece cost; cache and dedupe first,
  never per view).
- Push notifications for local events (consent-aware; not built).
- Human labour for the desk, support, trust and safety: **TBD**, deliberately
  not priced here (docs/OPERATING-COSTS.md).
