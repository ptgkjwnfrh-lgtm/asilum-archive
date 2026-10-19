# V.2 slice 12 — the map above a post, substantiated attendance, the valuation hierarchy, the overview's BRDCST line (18 October 2026)

The twelfth slice (PR #484, `v2/build`): the remaining laws the gap matrix
marked BUILD that no earlier slice carried. Schema v71 staged.

## What landed

| Blueprint | Where | Status |
| --- | --- | --- |
| The map opens above a post as a popup, never a page away (5.5) | `app/components/MapSheet.jsx`, the `map` view in `SheetHost.jsx`; the BRDCST footer's PASSPORT MAP → opens it with the event pinned and a 30 km ring; THE FULL MAP → remains a link | shipped |
| Substantiated attendance (17.19): "I was there" is CLAIMED until evidence already on record substantiates it — the passenger's coarse area during the event within 30 miles, an upload captioned at the event during it, or their own post carrying it; an undated place never substantiates | `lib/passport/attendance.js` (the law), `/api/passport/attendance` (claim, re-evaluate, withdraw; a sample fixture refused), the `attendance` record kind (v71), I WAS THERE ✓ in the map popup, WHERE YOU WENT on the Passport | shipped. **The word is the server's; a reader sees CLAIMED or SUBSTANTIATED, never the evidence** |
| The valuation hierarchy (chapter 11): comparables first — sales ASILUM itself recorded of the same brand and garment, compatible era and condition, silent below three, the median and the middle half with a confidence; then house rank × era in words with no figure; then the provenance stake | `lib/valuation/comparables.js`, `lib/db/production/valuation.js salesHistory` (the orders ledger joined to the catalog, both backends), `/api/valuation?item=`, the VALUATION line in the listing popup naming the rung | shipped. **No comparables on record today** — every read is rank × era or the stake until sales accrue, and says so |
| The Search overview carries the BRDCSTs in the viewer's reach that name the entity (16.3) | `lib/db/production/brdcst.js brdcstsForEntity` (delivery exactly as the Feed's law), `/api/search` `overview.brdcst`, one line each under the ASILUM OVERVIEW card | shipped |
| The Passenger Score on the Passport (6.18) | `ScoreLine` on `/board` beside BEHIND THE UPLOAD | shipped |

## Decisions recorded (the owner may overrule)

1. **Attendance evidence is only what ASILUM already holds.** No ticket ASILUM
   did not sell, no friend's word, no inference. The radius is 30 miles and
   the window is the event's dates with a day of slack either side.
2. **A valuation without comparables has no number.** The house register and
   the era say what carries the price; the figure waits for three real sales.
3. **The overview shows no broadcast the Feed would not** — reach and taste
   decide, through the same `tickerFor`.

## Proof

`tests/attendance-valuation.test.js`; `npm test`, `npm run build` green.
