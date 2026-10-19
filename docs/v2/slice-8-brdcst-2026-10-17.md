# V.2 slice 8 — BRDCST outreach and billing (17 October 2026)

The eighth vertical slice of the V.2 build (`docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
"Build order" 8): chapter 5 "BRDCST distribution, billing and ASILUM Credit"
5.9–5.28, the block rule 9.13, Terms 1.6 and 15, the Policies' reminder line.
Ninth commit on `v2/build`, PR #484. Credit itself (5.26–5.32) landed in
slice 7; this slice is what earns it, spends it on reach, and refunds it.

## What landed

| Blueprint | Where | Status |
| --- | --- | --- |
| Who sees a BRDCST: taste first, distance second; a matching passenger beyond the paid radius sees the post with no footer; a non-matching taste does not see the promoted post in the Feed; blocks suppress delivery with no refund (5.13–5.15, 9.13) | `lib/brdcst/index.js` `deliver`, `matchFloor`; `lib/db/production/brdcst.js` `deliverPosts` (cosine of the post's tags against the viewer's taste vector, the base-city record or the request's rounded area for distance, `dm_blocks` on Postgres); `/api/editorial` GET applies it per viewer; `lib/social.js fetchWire` sends the viewer and the area | shipped. A viewer with no taste on record cannot be claimed as a match and does not see a promoted post on the feed path; a permalink or a poster's page shows it bare. An unpaid attachment is the author's draft footer — a reader sees the post without it (5.22: "until paid, the broadcast waits in Drafts") |
| The footer: unlimited attachments, +1–5 collapsed, five soonest-first expanded, paginated (5.9–5.12) | `lib/wire/compose.js` `events[]` (`eventsOf`, `MAX_BRDCSTS` 20, the first kept in the legacy `event` slot), `lib/wire/draft.js` `addEvent` / `removeEvent`, `footerPages` in the law, `WireCard.jsx BrdcstFooter` | shipped; each event collapsed until tapped; the map shortcut stays a link to `/map?pin=` (5.5's map popup waits for a map view in the popup table) |
| Reach and taste as two paid expansions; the compact sliders; live itemized pricing; the forecast (5.15–5.19) | `quote` (base per day, duration, geographic beyond 50 miles, taste breadth), `forecast`; `estimateAudience` counts REAL passports whose taste clears the floor and whose base city lies inside the radius; `BrdcstOptions.jsx` in the composer; `/api/brdcst?quote=1` is public | shipped. **The price list is declared in `PRICE` and nowhere else — USD 3.00 a day base, 2 cents a mile a day beyond 50, up to USD 4.00 a day at full taste breadth — and the owner must ratify the figures.** The forecast's impressions are an upper bound from the feed's own law (one footer per matching passenger per active day), never a projection |
| Durations 1, 3, 7, 14, 30; launch now or schedule; the duration begins when the campaign actually starts; pay whenever; a late payment bills the remaining days (5.20–5.23) | `schedule`, `payQuote`, `payCampaign`; `brdcst_campaigns` (v66) | shipped |
| Payment: Credit in the exact amount chosen (never automatic), the remainder by card; the Credit share earns the bonus in proportion, rounded down (5.29–5.30, 5.32) | `payCampaign`: `creditSpend` on the credit ledger, an order of kind `brdcst` and one Stripe checkout session for the remainder, `creditRelease` if the session cannot be opened; `settleCampaignOrder` on the webhook and the reconcile path (`lib/orders.js settleBrdcst`); `brdcst_bonuses` | shipped. **Without a card provider the remainder cannot be charged: 503 `PAYMENT_IDLE`, nothing spent, the campaign stays a draft.** Credit covering the whole quote pays outright on any deployment |
| Failed payment: told at once, every three hours until resolved, mutable (5.22–5.23, Policies) | `reminderDue`, `sweepPaymentReminders` (`/api/admin brdcst.sweep`), `muteReminders`, the `brdcst-payment` notification | shipped as the clock and the sweep; no scheduler runs the sweep yet (the steward's hands do not call it) |
| Full-day billing; completely unused days refund on a voluntary cancellation, a cancelled event or an ASILUM interruption; policy violations reviewed separately (5.24–5.25, 15.5) | `usage`, `refundPolicy`, `cancelCampaign` (passenger: voluntary / event cancelled; admin: interrupted / event cancelled / policy), `decideReview` | shipped; bonus days run last and never refund |
| Refund destination: Credit first with two extra days OR 45 miles, stored and redeemed whenever; the original method only after declining (5.26–5.28) | `refundOffer`, the bonus bank (`bonusBank`, `redeemBonus` on a later payment); the original method returns the Credit share to Credit and the card share through a partial provider refund | shipped; a card refund without a provider is recorded `pending` |
| The ad ticker shows BRDCSTs within the passenger's radius (Foundations) | `tickerFor`; `/api/brdcst?ticker=1`; `Placements.jsx usePlacements` feeds the SPONSORED slot `lib/placements.js` reserved on 1 October | shipped — the slot that waited for "the table and the charge" has both |
| Drafts: where an unpaid broadcast waits; pay, cancel, mute (5.22) | `Studio.jsx` panel 03 "Your BRDCSTs" replaces the device-local promotion request; Settings shows the bonus bank beside Credit | shipped |
| The desk | `/api/admin` `brdcst.list / interrupt / review / sweep`; panel 11 on `/admin` | shipped |
| An ended event cannot be promoted; a sample fixture never | `eventLive`; `createCampaign` refuses `EVENT_ENDED` / `SAMPLE_EVENT`; the quote reports `event.live` | shipped (found in the browser: every dated row on the map had passed) |
| A sourced upcoming event on the map | `lib/places/registry.js` `pfw-menswear-fw-2027` — Paris Fashion Week® Menswear Fall/Winter 2027-2028, 19–24 January 2027, from the FHCM's "Next seasons" page, checked 17 Oct 2026 | added so a BRDCST can exist at all today; the pin is the city, the venues are the calendar's |
| Schema | `supabase/schema-v66-brdcst.sql` — `brdcst_campaigns`, `brdcst_bonuses`, `orders.kind` gains `brdcst`, the notification kinds | STAGED with v62–v65 |

## Decisions recorded (the owner may overrule)

1. **An unpaid event attachment is not a broadcast.** Slice 3 showed every
   event footer to every reader. Terms 1.6 defines a BRDCST as paid
   promotion delivered by taste and distance, and 5.22 keeps an unpaid one in
   Drafts, so a reader now sees the post without the footer until a
   campaign is live and in reach. The author sees their own footer with the
   campaign's state (DRAFT · UNPAID, SCHEDULED, LIVE · 50 MI, ENDED).
2. **No taste, no promoted post.** 5.13 says a post with a BRDCST appears
   only in Feeds whose taste profile matches it; a cold passport or an
   anonymous visitor has no match to claim, so the feed path hides it. A
   permalink and a poster's page show it bare.
3. **The price list** (`PRICE` in `lib/brdcst/index.js`) is a declared
   placeholder for the owner to ratify. The blueprint names "a low base
   price"; it names no figure.
4. **The 18+ rule** for running a BRDCST (Terms 2.2) is identity work and is
   not enforced here; the route takes any verified identity.

## Honest gaps

- Card payment is one Stripe checkout session on the platform account; it
  is built and untested against a live key in this session. The success page
  (`/orders?checkout=success`) does not yet call `settle`; the Studio's
  CHECK THE CARD PAYMENT does, and the webhook settles on its own.
- The reminder sweep has no scheduler.
- 5.5's map popup above the post is still the map route.
- Blocks suppress delivery on Postgres only (the DM subsystem has no memory
  mirror); memory mode answers "not blocked".
- Substantiated attendance (17.19) and the BRDCST line in Search's overview
  (16.x) are not here.

## Measured

- `npm test`: 1,892 tests, 1,803 pass, 0 fail, 89 skipped. New:
  `tests/brdcst.test.js` (12 tests: the law, the composition, the store, the
  routes), `tests/helpers/brdcst-scenario.mjs` with its mem/pg differential in
  `tests/postgres-integration.test.js` (CI only). The battery fails 6 of 12
  with the distance gate and full-day billing reverted, and passes restored.
- `npm run build`: green. `npm run v2:check`: PASS (G1–G7, latency p95 12.5
  ms, chunk laws). `node scripts/v2-fixtures.mjs` writes
  `docs/v2/fixtures/brdcst.json` (the public quote and forecast on the Paris
  row, a 201 draft, the 503 idle payment, the empty anonymous ticker).
- Browser, the `asilum-v2-mem` launch config (a TRUE memory-mode server —
  `DATABASE_URL=` set empty; the older memmode configs unset it and
  `next start` reads `.env.local` back, so they ran on the live database and
  answered `SCHEMA_V66_REQUIRED`, which is the right answer there): the
  composer's ADD EVENT lists the Paris row; attached, BRDCST OPTIONS renders
  with the reach and taste sliders, the duration chips, NOW or a date, the
  itemized quote (USD 33.60 for seven days at 140 miles) and the measured
  forecast (0 passports placed); the Studio lists a draft (DRAFT · UNPAID ·
  140 MI · 7 DAYS · USD 39.20) with the bonus bank at 0/0, PAY answers "card
  payment is idle … the broadcast waits in Drafts", CANCEL answers "no
  completely unused day to refund" and the card reads CANCELLED; Settings
  shows BRDCST BONUS 0 DAYS · 0 MI; the desk's panel 11 lists the campaign
  and SWEEP NOW runs; the ad ticker carries the Paris row as LISTED. Console:
  the only errors are the page's own geolocation permission line and the
  deliberate 503. Publishing a post needs a signed-in account, which a
  memory-mode server cannot issue, so PAY ON PUBLISH was not exercised end to
  end.
