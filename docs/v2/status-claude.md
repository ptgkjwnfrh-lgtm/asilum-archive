# Claude status — V.2 engines

## The V.2 build (17–18 October 2026) — PR #484, `v2/build`

Fourteen vertical slices under the owner's 17 October blueprint and the 18
October ruling (CONSTITUTION A6; OWNER-DECISIONS §12). Each has a write-up in
`docs/v2/slice-*.md`; the matrix is `docs/v2/BLUEPRINT-GAP-2026-10-17.md`.

| Slice | Commit(s) | What is real now |
|---|---|---|
| 1–7 shell, sessions, the one Feed, tags, governance, native commerce, protection | earlier on the branch | see their write-ups |
| 8 BRDCST | `6133121` | outreach, billing, Credit, the ticker, the desk |
| 9 media | `0771266` | the MOTION housing over the media worker |
| 10 rulings, identity, the Passport, friends, offline | `a8b8a22` `ec5ba64` `da3ad27` `23a83e1` `bbf0379` | the passenger fee ($1 + 1.5%), DROP-only activation, the \|A\|; 18+ gates, home town and ethnicity with consent, 2FA, appeals; the onboarding questions and identity anchors, Exploration Active, Behind the Upload; the friend asterisk; the offline queue |
| the look | `0cefc10` `c0c17e3` | no lines, no scanlines; the search popup to the owner's reference |
| 11 money in motion | `2ac0858` | payouts, top-ups, Credit at the fee, Wardrobe private sales, the hourly sweeps, the review screen |
| 12 map, attendance, valuation | this commit | the map popup above a post, substantiated attendance, the valuation hierarchy, the overview's BRDCST line, the score on the Passport |
| 13 the music seams | this commit | Spotify PKCE and the MusicKit developer token behind honest 503s; sealed tokens; **two prepared applications the owner submits** (`docs/v2/applications/`) |
| 14 the Feed and the look, to the 18 Oct references | `ef89b1c` `8751674` `0477e80` `461527e` `6a5fd8d` + the rounding commit | the post card, the BRDCST footer, place cards and the map popup's head, the piece card and the listing popup as drawn; the Wire gone from every visible word; page gradients; dark popups deepen the page; the OG reactive rainbow liquid glass on the fixtures, the deck and every popup; rounded everywhere (`docs/v2/slice-14-feed-look-2026-10-18.md`) |

Schema: v61 applied; v62–v72 STAGED on this branch (`scripts/apply-schema.mjs`
applies them in order; CI applies all to a fresh Postgres for the
differentials). Gates at the branch head: `npm test`, `npm run build`,
`npm run v2:check` — recorded in the final report.

**For the owner, in order:** (1) submit the two developer applications;
(2) ratify the BRDCST price list (`lib/brdcst/index.js PRICE`); (3) apply
v62–v72 when the branch merges; (4) key Stripe for the native and Wardrobe
rails and the payouts; (5) read RIGHTS-REGISTER before `library-sync`.


19 September 2026. Branch `claude/v2-engines`, from `ui/live-launch-v2` at `67a016f`. Coordination issue: #472. Codex's UI slice: PR #471.

Owner instruction recorded 19 Sep: **external provider connections (eBay / Shopify / Stripe / Pinterest / OAuth wiring, any live third-party API call) are Codex's.** This branch touches no provider. Where an engine needs one, it exposes the seam and the typed `unavailable` state.

## Delivered on this branch

| Slice | What is real now | Files | Proof |
|---|---|---|---|
| Fit evidence | A stored NULL displays as absent, not `0`, in both units; provenance is earned by supplied numbers (`measuredProvenance`); every assessment carries `evidence: unknown/estimated/measured`, `missingDimensions`, `confidenceBand`; `exact` follows evidence | `lib/brain/measurements.js`, `lib/brain/sizing.js`, both adapter sanitisers | `tests/fit-evidence.test.js` |
| Typed outcomes | `/api/search`, `/api/discover`, `/api/tickets`, `/api/records`, `/api/orders?hub=1` return `contractVersion`, `requestId`, `outcome`; failures are `{ error: { code, message, retryable } }` with the real status. `/api/search` no longer answers an engine throw with an empty 200; `/api/tickets` no longer answers a database failure with `[]` | `lib/api/outcome.js`, the routes | `tests/api-outcomes.test.js` |
| Stable cursors | `/api/discover` pages by a signed cursor bound to query + filters + eligibility + a snapshot of the ordered ids; `409 stale_cursor` restarts; no duplicate, no skip; `offset` kept for older clients | `lib/search/cursor.js` | `tests/api-outcomes.test.js` (walks the whole rack once) |
| DESIGNER: HOUSE | The career registry (48 dated edges, 18 designers, 6 houses + 18 reference houses, 68 sources); the pair parsed before generic interpretation; the rack is the credited intersection; empty stays empty with the sourced tenure in the note; a miss is a miss; `overview`, `related` (chronological, `matchingItemCount`), `entities`, `query.designerId/houseId` on both routes | `lib/people/careers.js`, `careers.data.json`, `resolve.js`, `lib/search/pair.js`, `lib/search/index.js` | `tests/designer-house.test.js` |
| The device records become real | `user_records` (v53) for saves of people/places/events/articles, the base city, corrections, drafts; adopted (no-clobber), erased, exported; `/api/records` GET/PUT/DELETE; `lib/save.js` and `lib/location.js` mirror best-effort; `lib/records/client.js` for the writers Codex owns | `supabase/schema-v53-user-records.sql`, `lib/db/production/records.js`, `app/api/records/route.js` | `tests/user-records.test.js`, `tests/postgres-integration.test.js` (CI) |
| A reason changes only its lane | `too-expensive` (price ceiling), `too-small` / `too-large` (fit hint), `dislike-finish` (finish tags only), `not-interested` (the piece), `wrong-attribution` (a desk task); `scope` item/session/ongoing; undo stamps `undone_at` and removes every effect; re-record revives | `lib/asterisk/correctionSignals.js`, `explain.js`, `lib/db/production/corrections.js`, `lib/products.js`, `app/api/why/route.js` | `tests/reason-learning.test.js` |
| The purchase hub | One read facade over payment orders and source tickets with separate payment / fee / merchant / outcome / fulfilment lanes, `verifiedPurchase` only for a paid sale, linked fee-order ↔ ticket, `allowedActions` from server state | `lib/orders/hub.js`, `app/api/orders/route.js` | `tests/purchase-hub.test.js` |

Gates on the branch head: `npm test` 1,525 total · 1,448 pass · 76 skip · 0 fail; `npm run build` green. Fixtures: `docs/v2/fixtures/*.json`, regenerated by `node scripts/v2-fixtures.mjs` — every fixture is a real route response in mem mode or a real pure-module call.

## The synergy round (19 Sep, later) — PR #474, draft

Owner's word: four hours under my own judgment. See docs/synergy-round-2026-09-19.md. One taste (search reads tasteVector), decay by evidence class, a reduce recorded, lanes + policyVersion on the memory / taste network / feed / search, /api/search cursors, one overview path, house origin on the entity, the registry extended to every designer the catalog credits (105 entities, 89 edges, 143 sources — a gate), `npm run v2:gates` / `search:latency` / `v2:check`, a fixture drift guard, three steward checks (15/15 ok against production), the flag register and AGENTS.md corrected.

## Open, with an owner and a next action

1. **Vogue-sourced overview prose — OPEN.** vogue.com refused both the research crawler and the built-in browser (domain-level policy in this session). The registry's overview prose is sourced from official house/parent press pages (Estée Lauder, Kering, LVMH), Britannica and dated trade press; each entity carries `vogueSourceIds: []` and `CAREER_PROVENANCE.vogueCoverage` says so. **Owner:** allow vogue.com for a browser session (or supply article URLs); the registry then takes them as additional `sources` without a schema change.
2. **v53 migration — APPLIED to production 19 Sep (owner's word).** Ledger: 53 user-records over 52 cutouts / 51 asterisk-stream (both applied earlier from other branches — this file was renumbered from 52 to 53 after that collision surfaced in the ledger). `user_records` exists with the asilum_app grants and policy; `user_corrections.scope` / `undone_at` exist.
3. **Fit hints reach the ladder (19 Sep, later).** `too-small` / `too-large` for a house read that house's pieces one size smaller / larger for the reader in the feed's ladder filter and served size, the stylist's fit score and sentence, and `fitAssessment` / `fitPhrase` when the profile carries `fitHints` (`GET /api/measurements` now returns them for the client fit profile). Label untouched; hint reported on the record. `lib/brain/fitHints.js`, `tests/fit-hints.test.js`.
4. **DM two-account proof.** The operations, retry id (`clientOperationId`), cursor tie-breaker and block laws already exist and are covered by 60 Postgres integration tests that run in CI only; no local Postgres in this session. **Next:** read the CI run on this PR; if the owner wants a live two-account demonstration on the authorized database, it needs `MESSAGING_ENABLED=1` and two accounts — Codex's client, my routes.
5. **Ticket / search failure copy.** `TicketFlow.jsx` renders `d.error` as a string; on the (rare) typed 500 it now receives an object. **Codex:** `d.error?.message || d.error`. Same for any client reading `error` on `/api/search`.
6. Shopify / eBay / Stripe / Pinterest connections — **Codex's** per the owner; nothing on this branch pretends to be connected.

## What I did not touch

Components, CSS, pages, brand language, map controls, provider adapters, payment policy (the 1% founders fee with the 50-cent floor stands), `main`, deployment.
