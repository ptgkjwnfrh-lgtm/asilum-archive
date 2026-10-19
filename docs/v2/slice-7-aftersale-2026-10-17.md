# V.2 slice 7 — protection, returns, the Passenger Score, ASILUM Credit (17 October 2026)

The seventh vertical slice of the V.2 build (`docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
"Build order" 7): chapter 6 "Protection, returns and the Passenger Score",
chapter 10 "Shipping, payouts and claims" where it bounds the windows, ASILUM
Credit (5.26–5.32) and Terms 10–12. Eighth commit on `v2/build`, PR #484.

## What landed

| Blueprint | Where | Status |
| --- | --- | --- |
| \|A\| Protection: a dynamic provider quote; a compact toggle beside it; off by default, never preselected or silently charged (6.2–6.4) | `lib/storefront/protection.js` `protectionOffer`, `electProtection`; `lib/storefront/providers/redo.js` (the seam: no agreement, no key → no quote, with the reason); `protection_elections` (v65); `/api/aftersale?protection=1`, `elect`; Settings states it | shipped as the law and the seam. **No provider is agreed**, so the toggle is never offered — nothing is quoted that nobody can honour |
| No refunds or returns on a Credit purchase without Protection; seller-enabled returns; admin override on a complaint with evidence; refund in Credit or to the original method (6.1, 11.2, 11.5) | `refundEligibility`, `refundDestination`; `order_returns`; `openReturn` (buyer), `decideReturn` and `settleReturnRefund` (admin, `/api/admin` `aftersale.decide` / `aftersale.refund`); `native_listings.returns_enabled` with `set_returns` on `/api/storefront` | shipped; a refund to the original method goes through the order engine's refund on the external rail, and waits for the connected refund ledger on the native one |
| The $1 incentive once, after the first clean sale and a closed window (6.5–6.6) | `incentiveDue`, `incentiveFor` → `return_incentives` + a Credit entry | shipped |
| Return shipping: seller's fault and a refused label → ASILUM covers, deducts from the next payout, half a star once responsibility is confirmed; the innocent party never (6.7–6.8) | `returnShipping`; `decideReturn` proposes the penalty; the penalty's own path confirms it | shipped; the deduction is recorded on the return (`labelPayer`), the payout ledger that applies it is the storefront's later work |
| Carrier-confirmed delivery starts the 14-day return, review and payout windows (10.21, 10.12–10.13) | `order_deliveries` WITH its source — carrier (none integrated), seller (manual tracking, 10.7), admin; `windowsFrom`, `payoutState`; `recordDelivery` | shipped; a seller-entered delivery is labelled as the seller's, never a carrier's |
| Dispatch clocks: SELL 14 days, DROP 31 + 31, two approved extensions of seven days, late → the buyer may cancel for a full refund, seller cancels before handoff, no voluntary buyer cancellation (10.1–10.5, 10.17–10.19) | `dispatchDeadlines`, `dispatchLate`, `extendDispatch`, `cancellation`; `order_dispatch`; `/api/aftersale` `dispatch`, `/api/admin` `aftersale.dispatch` | shipped as the law and the record; the cancellation itself is the order engine's |
| The Passenger Score: 0.0 and "No reviews" until the first verified review; the balanced model; penalties; the floor; Account and Passport only (6.9–6.12, 6.19–6.22, 6.27) | `lib/storefront/score.js` `computeScore` (recency-weighted mean shrunk by volume, n/(n+2); half a star per confirmed penalty; floor 0.0 with private accrual and escalation levels); `ScoreSheet.jsx` popup (6.18) and `ScoreLine` on the profile; `/api/score` | shipped |
| Double blind reviews after delivery, 14 days, revisions with a private history, held during disputes, one permanent response deletable never replaced (6.13–6.16, 6.28–6.29) | `canReview`, `reviewVisibility`, `newReview`, `reviseReview`, `respondToReview`, `deleteResponse`; `passenger_reviews`; `submitReview` publishes the pair when both are in or the period ends | shipped |
| Penalties confirmed before they count, notified, appealable, restored if overturned (6.8, 6.20) | `conduct_penalties`, `proposePenalty`, `movePenalty`; `/api/score` `appeal`; `/api/admin` `score.penalty` | shipped |
| Excluded and refunded reviews (6.24) | `markReview` (`/api/admin` `score.mark`) | shipped |
| ASILUM Credit: refunds and gifts only, never purchased, never expiring, chosen at checkout never automatic, the BRDCST bonus rounded down, gifts with two-factor and device authentication (5.26–5.32, Terms 10) | `lib/storefront/credit.js`; `credit_ledger` (append-only, balance derived); `/api/credit`; Settings shows the balance | shipped as the law and the ledger. **Gifting is refused** until two-factor and device authentication exist on ASILUM (neither does; the route never takes a body flag as a proof). **Spending Credit at checkout is not wired**: a native sale pays the seller through a connected charge, and the top-up transfer a partial-credit payment needs is unbuilt — the amount a buyer could apply is the law's (`applyCredit`), the charge is not reduced |
| Where scores appear (6.27) | `SCORE_SURFACES`; the popup opens from Account (and the Passport line is the same component) | shipped; never on a listing, offer, checkout or message |
| Schema | `supabase/schema-v65-aftersale.sql` — STAGED with v62–v64 | staged |

## Honest gaps

- Protection has no provider; the law is complete, the quote is not.
- Credit cannot yet be spent at checkout or gifted (above).
- The payout that deducts a covered return label is recorded, not paid: the
  storefront's seller payouts are after the return window by law and not yet
  implemented as transfers.
- Review moderation (6.17, 6.23) is the admin's `score.mark` and the
  governance queue, not a detector.
- Account deletion resetting the score (6.31–6.33) and verification for
  commerce (6.34) are identity work outside this slice.
- The Orders page shows the after-sale record per paid order; the Passport's
  score line reuses the Account's component and is not yet placed on /board.

## Measured

- `npm test`: 1,879 tests, 1,791 pass, 0 fail, 88 skipped (the new skip is
  the pg half of the after-sale differential, CI only). New:
  `tests/aftersale.test.js` (the three laws, the three stores, the routes),
  `tests/helpers/aftersale-scenario.mjs`.
- `npm run build`: green. `npm run docs:codemap` regenerated.
- Browser (the dev server on the production catalog, v62–v65 not applied):
  the profile's PASSENGER SCORE line reads "0.0 ★ · No reviews" and opens the
  popup in the session hub (the distribution, the ALL / AS BUYER / AS SELLER
  filters, the private line to the subject); Settings shows the Credit
  balance (USD 0.00) and |A| Protection OFF BY DEFAULT with its reason; the
  Orders page carries the after-sale record per paid order (none on this
  device); console clean.
