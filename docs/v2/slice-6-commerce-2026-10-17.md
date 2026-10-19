# V.2 slice 6 — native commerce (17 October 2026)

The sixth vertical slice of the V.2 build (`docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
"Build order" 6): land the native-storefront branch, then SELL / DROP, the
payment-page reservation, the availability queue, relisting, offers and
discounts. Two commits on `v2/build`, PR #484: the merge (4830268) and the
slice.

## Part 1 — the storefront lands

the native-storefront branch (fc618e6, 3 Oct, one commit on main 495493b,
10,712 insertions) reviewed against the constitution and merged. The branch's
own suite was green at its base (1,679 pass, 0 fail); the merge keeps it green
on V.2. What the landing changed and why is in the merge commit; in short the
branch wrote its checkout into the retired shell bag panel and feed modal, so on
V.2 the bag popup carries units and CHECK OUT THIS SELLER, the LISTING popup
buys a native listing, and one client (`lib/storefront/client.js`) opens native
checkout for every surface. The name is *ASILUM throughout; the social card
names native storefronts beside the labeled demo archive.

Three review findings fixed in the landing: an owner editing a live listing or
a live store re-asserted `active` and was refused as a publication
(`listingState`, `ownerStoreState` now keep the current state without asserting
it); a bag line's `price_cents: null` — what the API sends for every external
record — became 0 cents through `Number(null)`, so an eBay piece vanished from
the display subtotal (`normalizeBagLine` now treats null and 0 as "no cents" and
falls back to the display price; a line stored at 0 heals on read; measured on
the live Feed); `.bagpanel` rules had no panel to style.

## Part 2 — what landed

| Blueprint | Where | Status |
| --- | --- | --- |
| SELL single-item; DROP quantities, sizes, colors, variations; DROP authenticated before release (7.4, 12.2) | `lib/storefront/commerce.js` `MODES`, `validateMode`, `modeOf`, `releasable`; `native_listings.mode` (v64); `set_mode` on `/api/storefront`; the listing projection carries `mode` | shipped; a SELL goes live as STATUS: PENDING (slice 5's ledger) |
| Inventory reserved only during an active checkout; the Bag reserves nothing; the first valid request wins; others see "reserved" (7.5–7.9) | the storefront's `inventory_reservations` (v62) — `prepareNativeCheckout` reserves for the Stripe session's life; `availabilityOf`; the LISTING popup reads "temporarily reserved" | shipped as the storefront built it. **Gap (7.6–7.7):** a hosted Stripe Checkout cannot report the moment a passenger leaves the payment page; the reservation lasts the session (one hour) and releases on `checkout.session.expired`. The no-timer rule needs an embedded payment page — an owner decision |
| The first-come queue on a reserved listing; a release is a courtesy; a sale closes it; a return reopens it (7.10–7.13) | `availability_queue` (v64), `joinQueue` / `queuePosition` / `notifyQueue`; `/api/storefront/queue`; the LISTING popup's "join the queue"; `afterSale` / `afterRelease` in `lib/storefront/checkout.js` | shipped; queue alerts are a passenger switch (7.12) |
| Relisting: seller confirmation, one tap with a condition confirmation, new details and photographs when the condition changed, any new price, previous prices private, likes carry over (7.14–7.18) | `relistPlan`, `relistListing` → the storefront's `updateStorefrontListing` (one write path), `listing_relists`, the queue told "returned" | shipped; the item id is unchanged so likes and saves stay |
| Offers: accept / decline / counter, auto-accept threshold, unlimited offers and counters, every counter restarts the 24 hours for the receiving party, acceptance unlocks checkout at the agreed price for that buyer only for 24 hours reserving nothing, a sale invalidates, nothing withdrawn (7.19–7.26, 8.7–8.11) | `newOffer`, `respondToOffer`, `offerState`, `acceptedPriceFor`, `invalidateOnSale`, `autoAccepts`, `offerAllowed`; `listing_offers` (v64); `/api/storefront/offers` (buyer), `offer_respond` and `offer_settings` (seller); the accepted price rides `prepareNativeCheckout` as `unitPriceOverrideCents` for that buyer; the LISTING popup's OFFER is real on a native listing | shipped |
| Reminder presets Minimal / Standard / Frequent, Standard by default (7.27–7.30) | `REMINDER_PRESETS`, `reminderTimes`; `user_notification_prefs.offer_reminders` | shipped as the schedule and the preference; the sender that fires `offer-expiring` at those moments is a job not yet scheduled |
| Discounts: 24 hours, manual renewal, every application and renewal notifies the likers at 10% or more above their own threshold, edit or cancel any time restoring the price, bulk apply, the discounted price with the percent off, a private history, no survival through a relist (7.31–7.34, 8.1–8.6, 8.12–8.13) | `newDiscount`, `discountNotifies`, `displayPrice`; `applyDiscount` / `cancelDiscount` / `expireDiscounts` move the variant price and restore it; `listing_discounts`, `listing_price_history`; `discount_apply` / `discount_cancel` / `discount_bulk` / `price_history` | shipped; the owner read sweeps expiry, and so does the steward's cron when it runs |
| The checkout price lock (8.4–8.5) | the storefront's quote at `prepareNativeCheckout` is the price for the attempt's life | shipped by the storefront |
| Offers during a discount and stacking are the seller's rules (7.19, 8.11) | `storefronts.offer_settings`; stacking applies `percentOff` to the accepted price at checkout | shipped |
| The seller's console | `StorefrontTab.jsx` OFFERS & DISCOUNTS: the settings, the open offers with ACCEPT / DECLINE / COUNTER, per listing the mode, DISCOUNT / RENEW / CANCEL, RELIST… with the confirmations | shipped |
| Schema | `supabase/schema-v64-native-commerce.sql` — STAGED with v62 and v63; readers answer empty and writers refuse by name until it is applied | staged |

## Honest gaps

- No native listing exists on production until v62–v64 are applied, so the
  browser pass exercised the external paths and the panels' empty states; the
  native flows are held by `tests/native-commerce.test.js` (law, rows, routes)
  and `tests/helpers/commerce-scenario.mjs` (mem/pg, CI only).
- The reservation follows the Stripe session (one hour), not the passenger's
  presence on the page (7.6–7.7): an owner decision, above.
- `offer-expiring` reminders are scheduled by the law, not yet sent by a job.
- Chapter 13's Wardrobe offers (DM-first, one negotiation at a time, the
  14-day cooldown, ownership on delivery) are a separate rail and stay with
  slice 7.
- The fee policy ($1 + 1.5% passenger fee; the one-time $30) is the branch's
  and remains the owner's DECIDE row in the matrix.

## Measured

- `npm test`: 1,867 tests, 1,780 pass, 0 fail, 87 skipped (the new skip is
  the pg half of the commerce differential, CI only). New:
  `tests/native-commerce.test.js` (the law, the rows, the routes),
  `tests/helpers/commerce-scenario.mjs`; the bag battery gains the null-cents
  rule; `tests/storefront-shell.test.js` and `tests/storefront-ui.test.js`
  rewritten for the V.2 surfaces in part 1.
- `npm run build`: green. `npm run docs:codemap` regenerated.
- Browser (the dev server on the production catalog, where v62–v64 are not
  applied): the LISTING popup's OFFER on an external record stays `soon` with
  its reason and the record buys at its source; the BAG popup carries units
  per line and the display subtotal is right after the null-cents fix
  (USD 340.33 for two lines, where it read USD 89.00); the Storefront tab
  answers "A store needs an account" signed out; console clean.
