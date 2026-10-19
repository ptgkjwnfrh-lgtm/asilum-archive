# V.2 Blueprint → repository gap matrix (17 October 2026)

**Authority.** The owner's V.2 Blueprint of 17 October 2026 (the published
spec: 18 chapters, 345 build clauses, Terms of Service, Foundations) supersedes
the 1 October brief (the owner's V.2 brief) wherever the
two differ. The 1 October brief's Stages A–D landed on `main` on 2 October
(#478–#483). This matrix maps every blueprint chapter to what `main` already
has, so the build order below is grounded in the code rather than the spec
alone. Repository laws still bind: docs/engineering/, CONSTITUTION.md §10, the ADRs,
mem/pg parity, no faking, never commit to `main`.

Legend — **HAVE**: exists on main and matches the blueprint. **ADAPT**: exists
but the blueprint changes it. **BUILD**: does not exist. **DECIDE**: the
blueprint and the repository (or the 1 October brief) conflict and the owner
must rule.

## 0. Foundations

| Blueprint | On main | Status |
| --- | --- | --- |
| One FEED, no Wire | `/` with a Feed \| Wire selector (`/?view=wire`), THE WIRE as a hub (`lib/posts/`) | **ADAPT** — fold Wire posts into the one Feed as TRANSM/STILL/MOTION cards; retire the selector |
| Six post types TRANSM · STILL · MOTION · BRDCST · LISTING · ECHO, PLACE/SONG cards | `lib/posts/compose.js` kinds transmission/post/video with layouts; events as attachments; no ECHO, no SONG card | **ADAPT** — map kinds to the six types; **BUILD** ECHO and SONG |
| Central Control Deck: Feed · Search · Post disc · Messages · Account | `lib/nav.js` four tabs (Front Cover, Feed, Map, Account) + utilities Likes/Search/Messages; `ControlCenter.jsx` | **ADAPT** — five keys; Post becomes the center disc; Front Cover and Map leave the deck |
| Info Dock (likes, bag, bell, music circle, \|A\|) top-left; Passport Button (globe) top-right | Likes is a sheet; bag lives in the header; notifications route exists (`/api/notifications`) but no bell; no globe | **BUILD** both fixtures |
| Ad ticker under the deck | `AdStrip` in `ControlCenter.jsx`, `lib/placements.js` | **HAVE** |
| Michroma primary, Inter secondary; white/blue/gray/green/teal/black; dark = black/slate/subtle phosphorus green/dark teal; **no CRT** | `globals.css` 4,310 lines: phosphor dark with scanlines, grid and glows, ice light cyan; Share Tech Mono body; RED the only accent | **ADAPT** — new token values, remove scanline/grid/glow layers, Inter body; this is the visible "V.2 look" |
| Rainbow Liquid Glass, subtle, on fixtures and popups | `LiquidGlass.jsx` (refraction, lamps, meniscus), `GlassPane.jsx` | **HAVE** the material; **ADAPT** tint to the new palette, add the restrained iridescence |
| Tag grammar `LEFT: RIGHT`, three visible, rest behind the product, ASTERISK-only | `lib/tagging/vocabulary.js` facets; `DESIGNER: HOUSE` pair search (`lib/search/pair.js`, `lib/people/careers.js`); provenance sticker | **BUILD** the tag renderer and selector on top of the facets; the left-side hierarchy (MAKER→HOUSE→SCENE→AESTHETIC→MATERIAL→ERA→PLACE) maps onto existing facets `brand/designer/subculture/mood/material/era/origin` |
| Friend asterisk on mutual follow | `lib/social.js` follows are one-way; no followers tracked ("ASILUM does not track followers") | **DECIDE** — mutual follow needs follower knowledge server-side; the blueprint requires it |
| ASTERISK governance: admins supersede, logs, pause per function, audits, 90% cap, 65% split, 75% collective, 5 min | `lib/asterisk/` deterministic reading; `lib/verification/ledger.js` caps local rules at 0.5; `/admin`; steward with hands and a ledger | **ADAPT** — the ledger/steward are the admin console seed; the confidence cap and the agent split are new policy in `lib/asterisk/` |
| Passenger Score, ASILUM Credit, \|A\| Protection, SELL/DROP | none on main; the native-storefront branch (unpushed, 10.7k lines, schema v62) has storefronts, native listings, variants, reservations, Stripe Connect | **BUILD** on top of the storefront branch once it is pushed and reviewed |

## 1. Navigation and popup sessions (1.1–1.35)

| Blueprint | On main | Status |
| --- | --- | --- |
| Popup replaces popup, history stack, Back + swipe right, swipe down dismiss, tap outside for lightweight | `SheetHost.jsx`: one sheet, inner stack with Back, Escape/scrim/Close; `lib/dockstate.js` | **ADAPT** — the sheet becomes the popup; add gestures |
| Ten-session universal hub, counter 01/10, manager at the 11th, MRU order, previews, close with undo | none (one sheet at a time, nothing persisted) | **BUILD** `lib/sessions.js` (hub state, persistence, sync) + the session carousel |
| Session dial = Post disc, long-press menu, central + | none | **BUILD** the disc component (see chapter 2) |
| Resume exactly where left; sessions survive restarts; 10 per account synced | `lib/viewstate.js` registry (per viewer+route+subtab+query+filters); feed parking; fresh launch = Feed (1 Oct law) | **DECIDE** — blueprint 1.10 "resume exactly" vs 1 Oct "fresh launch starts on the Feed"; **BUILD** server persistence (a `user_sessions` table) |
| Tab switch restores that tab's session; two-tap active tab (restore, then refresh at top) | tabs preserve position in session; no two-tap | **ADAPT** |
| Drafts autosave with subtle notice | `lib/posts/draft.js` device-local, versioned | **HAVE** for posts; **BUILD** notice + listings/messages |
| Offline-first, queued actions, conflict merge | none (online only) | **BUILD** later stage |
| Privacy-safe session previews | none | **BUILD** with the hub |

## 2. Disc controls, motion and tactile behavior (2.1–2.30)

| Blueprint | On main | Status |
| --- | --- | --- |
| The disc: momentum, magnetic snapping, dwell, tap, haptics, disc-off toggle with slim slider, per-interface preference synced | `ConnectionsWheel.jsx` (CD wheel, list primary, keyboard) — the only rotary | **BUILD** one `Disc.jsx` component (physics, dwell, haptics via `navigator.vibrate` where available) and reuse it for Post Selection, session dial, Wardrobe, Followers |
| Glass behavior: hybrid iridescence, adaptive readability, auto scaling, Reduce Motion with override, 120–250 ms, cancel-and-reverse, tilt parallax | `LiquidGlass.jsx` + globals: refraction, lamps, reduced motion respected | **ADAPT** — timing tokens, tilt (DeviceOrientation, opt-in), performance scaling |
| Haptics: contextual patterns, one On/Off | none | **BUILD** `lib/haptics.js` |
| Light/dark with the new palettes; theme ripple from the Control Deck | `data-theme` light/dark via Settings; PREPAINT | **ADAPT** palettes; **BUILD** ripple |

## 3. Video playback and persistent music controls (3.1–3.24)

| Blueprint | On main | Status |
| --- | --- | --- |
| Full-screen video housing, autoplay, PiP, quality, speed, captions | Wire video kind is an honest "needs the media worker" state; no player | **BUILD** — needs the media pipeline first (DM media exists: `lib/dm/media.js`) |
| Music circle in Info Dock / DM corner, music panel | none | **BUILD** after chapter 4 |

## 4. Music integration and discovery (4.1–4.18)

| Blueprint | On main | Status |
| --- | --- | --- |
| Spotify / Apple Music connect, like-sync, catalog search, + import | `lib/connectors/index.js`: Spotify `taste-import` **unsupported**, `display-link` requires approval; OWNER-DECISIONS §7 Spotify manual-only; `lib/music-mapping` curated artists | **DECIDE** — the blueprint assumes Spotify/Apple Music APIs for likes and catalog search; the repository's rights register and the 27 Aug ruling block Spotify profiling. Apple Music (MusicKit) is unexamined. Build the seam with honest unavailable states; real sync needs approvals |

## 5. BRDCST distribution, billing and ASILUM Credit (5.1–5.32)

| Blueprint | On main | Status |
| --- | --- | --- |
| BRDCST footer on posts, +1–5, pagination, map popup, ticket links | event attachments on posts (`lib/posts/compose.js` event layout), placements on the cover and ticker, `/api/places?dated=1` | **ADAPT** the attachment into the footer; **BUILD** pagination and the outreach rule |
| Taste-then-distance outreach, 50 mi, paid radius and taste expansion, itemized quote, presets, scheduling, per-day billing, refunds, credit bonus | `lib/placements.js` (no money), `lib/hotlist.js` program, Stripe wrapper `lib/payments/stripe.js` | **BUILD** `lib/brdcst/` (targeting, pricing, campaigns) + migration |
| ASILUM Credit: site-wide, refunds and gifts only, 2FA + device auth gifting, chosen amount at checkout | none; `lib/vault.js` buyer vault; Stripe refunds exist | **BUILD** `lib/credit/` ledger + migration |

## 6. Protection, returns and the Passenger Score (6.1–6.35)

| Blueprint | On main | Status |
| --- | --- | --- |
| \|A\| Protection via REDO, toggle off by default, dynamic quote | none; checkout is a ticket-fee flow (`lib/orders.js`, 1% founders fee, 50¢ floor) | **BUILD** the toggle and the provider seam (unavailable until REDO agreement); **DECIDE** fee policy: blueprint says $1 + 1.5% buyer fee, seller 0%, $30 activation (also in the storefront branch) vs the live 1% founders fee |
| 14-day returns, seller $1 incentive, shipping fault rules, half-star penalty | none | **BUILD** on the storefront order model |
| Passenger Score 0–5, reviews after delivery, hidden until both, 14 days, penalties, appeals, Account/Passport only | none | **BUILD** `lib/score/` + migration |
| Verification basic + enhanced for DROP; returning-account matching | `account_kinds` passport/business, age gate, identity adoption (ADR-002) | **ADAPT** — DROP verification = the business kind's checks |

## 7. Native commerce, offers and discounts (7.1–7.34)

| Blueprint | On main | Status |
| --- | --- | --- |
| SELL single-item, DROP multi-variant, native only, no integrations | the native-storefront branch: storefronts, native_listings, variants, inventory, Stripe Connect checkout, fees (unpushed) | **ADAPT** the branch: SELL/DROP modes, drop manager; **DECIDE** eBay-sourced discovery inventory (1 Oct §15 eBay-first) vs "only sold if from ASILUM" (blueprint 7.1). Reading: eBay listings remain discovery with external purchase tickets; only native listings sell through ASILUM checkout |
| Payment-page reservation, no timer, lost on inactivity, first server request wins, queue = notification only | `inventory_reservations` in v62 | **ADAPT** to the page-based rule |
| Offers, counteroffers, 24 h restart, reminders, presets, discounts 24 h manual renew, threshold alerts | none (Wardrobe private offers are DM-first per chapter 13; no listing offers) | **BUILD** `lib/offers/` + migration |
| Relisting with confirmation, engagement preserved | listing status events v58 | **ADAPT** |

## 8–13. Discounts, blocking, shipping, valuation, authentication, Wardrobe (8.1–13.18)

| Blueprint | On main | Status |
| --- | --- | --- |
| Blocking, silent unavailable view, archived DMs, group admins | DM subsystem v40–v48, v59: blocks, mute, presence, unsend, edit, clear, search, profile cards | **HAVE** most; **BUILD** groups and the consistent unavailable view audit |
| Shipping deadlines, extensions, labels, unified checkout, payouts after 14 days, claims | storefront branch has order lines and fee reservations; no shipping | **BUILD** |
| Valuation hierarchy, era and house rank, confidence, fallback | `lib/provenance.js stakeOf`, comparables model noted as roadmap §4.6 | **BUILD** |
| Verified / Unverified, strict evidence, admin fallback, appeals, sold freeze, relist re-eval; Pending for SELL; 90% cap; 65% split | `lib/verification/ledger.js` (source + AI + human, 0.8 bar, 0.5 local cap, 90-day TTL, evidence version, `listing_verifications` v61) | **HAVE** the ledger; **ADAPT** the states (add Pending), timing (5 min / 72 h), the 90% cap and the replica library |
| Wardrobe, OWNED tag, two toggles, DM-first offers, 24 h exclusive checkout, transfer on delivery, cooldowns | `lib/wardrobe/` with gifts and atomic transfers (v60), Cover Flow/grid/list closet | **ADAPT** — private sale = gift transfer + a payment |

## 14–18. Taste graph, music discovery, Search, Passport, open items

| Blueprint | On main | Status |
| --- | --- | --- |
| Unified taste graph, three layers, collaborative discovery, Exploration Active with \|A\| indicator, 2:1 ramp | six-bridge brain (`lib/brain/`), decay by evidence class, lanes, taste reranker, `lib/taste-graph/`, epsilon bridge for exploration | **HAVE** the engine; **ADAPT** the Exploration Active state and indicator |
| Five-minute Passport onboarding | none | **BUILD** |
| Search looks ordinary, \|A\| toggle, overview first, hard constraints, strict order then Suggested Discoveries | `lib/search/` honesty instruments 15/15, entity overviews, pair parsing, reranker pins exact rows, constraints | **HAVE**; **ADAPT** the divider and the tag-query syntax (`SILVER: JEWELRY`) |
| Passport uploads, captions, Behind the Upload, STAMPS private by default, saving whole/one, follow accounts | `/board` collection, `AddStamp.jsx`, `lib/save.js`, `user_records` v53, corrections with undo | **HAVE** most; **BUILD** captions-as-evidence and Behind the Upload tag view |

## Build order (vertical slices, one PR each, in this order)

The order puts the fundable surface first: what an investor sees in the first
sixty seconds is the shell, the Feed and a listing. Each slice ships with
tests and leaves the app runnable with no database (mem mode) and no keys.

1. **The V.2 shell.** New tokens (both palettes), Inter body, no CRT layers,
   Michroma labels; the Central Control Deck with five keys and the Post disc
   in the center; the Info Dock; the Passport Button; the ad ticker kept.
   Front Cover and Map remain routes reachable from the Passport popup and
   the Feed, not deck keys. `lib/nav.js`, `ControlCenter.jsx`, `shell.js`,
   `globals.css`, `Icons.jsx`.
2. **Popups and the session hub.** The sheet becomes the popup with the
   gesture grammar; `lib/sessions.js` holds up to ten sessions with MRU
   order, the counter, the manager, close with undo, previews; the Post
   disc turns into the session dial inside a popup. The `Disc.jsx`
   component lands here (physics, dwell, haptics, disc-off toggle).
3. **The one Feed.** Wire folds into the Feed; cards for TRANSM, STILL,
   MOTION, BRDCST, LISTING, PLACE, SONG, ECHO carousel; vertical wheel with
   slight overlap; Tetris packing targets; LISTING popup; PLACE in place;
   STILL/MOTION float with on-media caption.
4. **Tags.** The `LEFT: RIGHT` renderer over the existing facets, three
   visible, behind the product; tags as search queries; the left-side
   hierarchy and the consistency check in `lib/tagging/`.
5. **ASTERISK governance.** Confidence cap, calibration hooks, the agent
   split policy, per-function pause, the audit ledger on the steward; the
   verification ledger gains Pending, 5-minute / 72-hour timing, the replica
   signal.
6. **Native commerce.** Review and land the native-storefront branch, then
   SELL/DROP modes, the payment-page reservation, offers and discounts,
   relisting, the queue.
7. **Protection, returns, Passenger Score, ASILUM Credit.**
8. **BRDCST outreach and billing.**
9. **Media: video housing, music, captions.** Needs the media worker.
10. **Passport onboarding, Behind the Upload, Exploration Active indicator,
    friend asterisk, offline-first.**
11. **Money in motion** (18 Oct): payouts and top-ups, Credit at the fee,
    Wardrobe private sales, the hourly sweeps, the review screen —
    `docs/v2/slice-11-money-2026-10-18.md`.
12. **The map above a post, substantiated attendance, the valuation
    hierarchy, the overview's BRDCST line** —
    `docs/v2/slice-12-map-attendance-valuation-2026-10-18.md`.
13. **The music seams, last** (owner's order): Spotify PKCE and the MusicKit
    developer token behind honest 503s, sealed tokens, and the two prepared
    developer applications the owner submits —
    `docs/v2/slice-13-music-seams-2026-10-18.md`, `docs/v2/applications/`.

## Decisions the owner must make before the affected slice

1. **Fresh launch** (slice 1): blueprint 1.10 resumes exactly where the
   passenger left off; the 1 October law starts every launch on the Feed.
   Proposed: the blueprint wins (resume), with the Feed as the base beneath.
2. **Front Cover** (slice 1): the blueprint has no Front Cover tab. Proposed:
   `/cover` stays a page (Hot List and placements) opened from the Feed's
   masthead, not a deck key.
3. **eBay inventory** (slice 3 and 6): keep eBay-sourced pieces as discovery
   with external purchase tickets, while only native SELL/DROP listings sell
   through ASILUM checkout. Blueprint 7.1 forbids storefront *integrations*;
   it does not have to forbid *discovery* inventory. Needs the owner's word.
4. **Fees** (slice 6): $1 + 1.5% buyer fee, 0% seller, $30 activation
   (blueprint and the storefront branch) replace the live 1% founders fee
   with the 50¢ floor for new transactions.
5. **Friend asterisk** (slice 10): requires tracking followers server-side,
   which the repository currently refuses by policy.
6. **Music** (slice 9): Spotify profiling is blocked by its developer policy
   and the 27 August ruling; the blueprint's like-sync needs a fresh ruling
   or Apple Music only.
