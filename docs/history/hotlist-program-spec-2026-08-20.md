# The founders fee & the hotlist program — economics ruling + build spec

**Ruled by the owner 20 Aug 2026** (in-session, answering the Gate 0
booth-fee question — the answer was a whole model, not one word). This
supersedes D2's flat 15% (risk campaign §8, annotated there). Canonical
terms home for designer-facing numbers remains
`designer-program/OFFER.md`, rewritten the same day.

**Status:** TERMS are ruled and binding. Of the build pieces below, **P1
(founders fee at checkout) implements a non-negotiable ruled term inside
the already-unlocked checkout (D3) and ships immediately**; P2–P4 are
specified here and await the owner's build-order approval.

---

## 1. The ruling (owner's words, normalized)

- **1% "founders fee", buyer-paid, every piece sold, non-negotiable.**
  The business foots no extra cost on a base sale. Example: a $100 piece →
  the buyer pays $100 + $1 (1%) + shipping/handling + tax *(S&H and tax as
  those exist in checkout — today neither is charged; the fee does not wait
  for them)*.
- **Base sale: no commission.** The designer receives 100% of the item
  price. ASILUM's revenue on a base sale is the buyer's 1%.
- **The hotlist is the paid program (opt-in).** A business that wants a
  spot on the hotlist pays:
  - **$150/month booth rent** — the hotlist runs in monthly cycles;
  - **15% of the item price on hotlist-ATTRIBUTED completed sales only** —
    a reader reaches the business via its booth on their hotlist, then
    buys. A $100 attributed sale: designer nets $85; the buyer still pays
    $100 + $1 + S&H + tax.
- **Attribution is a precondition.** "A separate channel for tracking user
  traffic" must prove hotlist provenance; **no attribution record, no
  15%.**
- **Placement is taste-gated.** A paid booth appears only on the hotlists
  of passport users whose taste profile statistically matches the
  business's product tags — "a Rick Owens-adjacent booth never lands on a
  Jeremy Scott-adjacent hotlist." Rent cannot buy the wrong audience.

## 2. Recorded flags (facts on the record, not relitigation)

- **Processing arithmetic.** The ruling keeps processing costs off the
  business ("no extra cost"), so Stripe's ≈2.9% + 30¢ is ASILUM's. On a
  $100 base sale: founders-fee revenue $1.00 vs processing ≈$3.20 →
  **base sales run ≈ −$2.20 each**. Program sales are strongly positive
  (+$16 gross on the same order). Base volume is therefore priced as a
  cost of supply + taste data until L3 measures real numbers; C3's metric
  definition now says so explicitly (it will print negative, honestly).
- **The 15%'s scope.** The ruling's opening sentence ("15% of revenue of
  every piece sold") is narrowed by its own later clause ("ONLY users that
  discover business accounts via paid hotlist") and by the owner's worked
  example. **Recorded meaning: 15% is attributed-only.**
- **The $5 booth fee is dead** — replaced by the $150/month rent inside
  the opt-in program. (Closes the 18 Aug "unaffirmed, flagged" note.)
- **Rounding:** `fee_cents = round(item_price_cents × 0.01)` — cent
  precision, standard rounding.
- **Disclosure:** `/terms` must name the founders fee before any live
  sale (Gate 3 owner UI round); the checkout itself itemizes it (Stripe-
  hosted line item), so the buyer sees it before paying either way.

## 3. What already exists to build on

- **Checkout engine** — `startCheckout` (`lib/orders.js`) is the single
  money seam; append-only order ledger (schema v31/v33); full-amount
  refunds (a refunded buyer gets the fee back too — correct by default).
- **Booths** — `/api/business?booths=1` public roster, ten booths per the
  hotlist law, `/hotlist` (THE WIRE) renders them, `lib/business.js`.
  Today's roster is the honest-OPEN demo cohort; when the program opens,
  hotlist booth spots belong to paying businesses only.
- **Taste machinery** — alpha-bridge tag-space similarity + the ruling-8
  match floor (`floor:check`, 25th percentile) — P4 reuses this gate
  rather than inventing a second matcher.
- **Metric register** — C1–C4 defined-before-measured; attribution gets
  the same treatment (C5 below) before anything prints.

## 4. Build pieces

### P1 — Founders fee at checkout (✅ SHIPPED — PR #303, 20 Aug 2026)
- `startCheckout` computes `feeCents`; the Stripe session carries **two
  line items**: the piece at list price + "Founders fee (1%)".
- Ledger: `orders.fee_cents` (schema v34, append migration, default 0).
  `amount_cents` keeps its existing meaning — **the item price snapshot**
  — so payout math survives later price edits; total charged =
  `amount_cents + fee_cents`.
- Order API/pages expose the fee and total so `/orders` never
  under-reports what the buyer was charged.
- Tests: fee math, line items, ledger row, mem + pg parity; keyed
  live-Stripe assertion that `amount_total` = 101% (rounded) of price.

### P2 — Attribution channel (precondition of any 15%; build with the first booth)
- Booth click-through on the hotlist → provenance event
  (`USER_VISITED_BOOTH {source_name}`) via a dedicated route —
  `/api/interaction`'s action set is frozen by architecture law and stays
  untouched.
- `startCheckout` stamps attribution at order creation: the caller's most
  recent booth visit for the item's `source_name` inside the window →
  `orders.attribution = 'hotlist'` (+ booth ref; schema v35 when built).
- **Window: RECOMMEND 7 days** (owner rules the number). Reported to the
  designer on every statement; disputes get the audit trail (counsel
  question G).
- **C5 (defined before measured):** attributed paid orders per booth per
  cycle; `—` until real data exists, same register rules as C1–C4.

### P3 — Booth rent billing (with the first paying booth)
- First cohort: **manual monthly invoice** (Stripe invoice/payment link),
  recorded on the admin desk — mirrors the manual-payouts pattern;
  automated Stripe Billing subscription when volume earns it.
- Cycle = the hotlist's monthly cycle, rent in advance; non-payment
  unlists the booth at cycle end (no mid-cycle clawbacks).
- ⚖ Auto-renew/subscription disclosure is counsel question F.

### P4 — Taste-gated placement (law from day one of the program)
- A paid booth renders on a given passport user's hotlist **only when**
  match(business tag profile, user profile) clears the ruling-8 floor.
  Business tag profile = weighted aggregate of the booth's
  `product_tags`.
- Below the floor → not shown, rent notwithstanding: the program sells
  **qualified placement, not impressions** (OFFER says this in plain
  words; no impression guarantees anywhere).
- Fixture test: rick-owens-tagged booth × jeremy-scott-tagged passport →
  absent from that hotlist.

**Sequencing:** P1 now → P2 + P4 must both be live before ANY paying
booth is (attribution + the taste gate are preconditions of charging) →
P3 manual at the first booth.

## 5. What needs the owner

- Approve the P2–P4 build order + the attribution window (7-day
  recommendation) + rent-lapse behavior (unlist at cycle end).
- Voice pass on every buyer/designer-facing word (unchanged law — the
  designer docs are rewritten but still parked).
- ~~Rule §6 below (fee collection on referral purchases).~~ ✅ RULED and
  built the same day (see §6).

---

## 6. Fee collection on referral purchases (✅ RULED 20 AUG 2026 — BUILT SAME DAY)

**The owner ruled the two-transaction model in** ("there has to be a way…
maybe two separate transactions… two transactions on the user's bank
statement with one purchase") **with these additions, all shipped:**

- **Fee floor — RE-RULED to 50¢ FLAT (owner, same night):** the earlier
  31¢/50¢ split is retired. `FOUNDERS_FEE_FLOOR_CENTS = 50` everywhere —
  one number, which also clears Stripe's standalone minimum by
  construction (the 50¢ `amount_too_small` physics, trap 27a, is WHY the
  number is 50; the processor-minimum overlay stays in code as a guard).
- **The checkout housing** (`/checkout?item=…`): one ASILUM-styled room —
  the piece's image and price stay on screen the whole time; the fee split
  is spelled out ("two lines on your statement"); consent (the ticket
  disclaimer) gates payment; Stripe's Payment Element renders the card
  fields (their iframes — SAQ-A holds).
- **Typed once:** name + address collected at FIRST purchase only, stored
  in the buyer vault (`buyer_vault.buyer_profiles`, own schema, v35);
  card saved at Stripe (customer + payment-method references only, brand
  + last4 for display). Returning buyers pay with ONE press
  (server-side off-session confirm — no card form at all). SETTINGS
  module 06 (PURCHASE INFO) is the only editor; the two-door access law
  is test-enforced (`tests/vault-access.test.js`).
- **Money integrity ("heavy protection"):** amounts computed server-side
  only; webhook signatures verified; the settle path asserts the
  processor's amount, currency, and claimed order EQUAL the ledger —
  any mismatch records `amount_mismatch` in the append-only ledger,
  settles nothing, issues no ticket.
- **The hotlist-fee integrity notice** (owner order): suspension +
  PERMANENT hotlist ban for suspicious behaviour relating to the hotlist
  fee — on the business panel (heavy red banner), in OFFER.md, and as
  AGREEMENT-DRAFT §3d. Human-reviewed on the ledger's evidence,
  flag-never-judge preserved.

*The original proposal text below stands as the design record.*

### The proposal as written (now history)

**Context (owner follow-up, 20 Aug):** at launch the real purchase —
payment, tax, shipping — completes on eBay or the business's own Shopify
store; ASILUM never touches it (the ticket lane, as always; D1 keeps proxy
purchasing cut). ASILUM collects only the founders fee and the program
money. The owner floated the mechanism: **two transactions per purchase**
— a 1% charge from ASILUM plus the real purchase on the source, two lines
on the buyer's statement. This section is the workable shape of that idea.

**Sequencing is forced: fee-first.** Charging after the fact needs a saved
card plus purchase detection ASILUM does not have — Shopify referrals are
invisible unless the business reports them (agreement duty, statements),
and EPN reporting lags and covers only eBay. So the flow is:

1. BUY on a referral piece → Stripe checkout for the fee alone
   ("Purchase ticket — 1% founders fee"; statement descriptor LOUD).
2. The paid **purchase ticket** is the deliverable the fee buys: the
   verified source link, an availability/price check at open, the piece's
   provenance in the buyer's Passport, the support channel, follow-up.
   The existing ticket machinery is this lane's object; the fee becomes
   its price.
3. Buyer completes the real purchase on eBay / the designer's Shopify.

**Why the ticket framing (recommended):** the fee buys something real even
when the buyer abandons the source checkout — no "paid for nothing"; a
listing found dead at open **auto-refunds the fee** (availability sink
already knows); and the no-faking register holds: a paid ticket promises
ONLY what ASILUM can do — it never claims order confirmation from the
source (we cannot see it; the business reports attributed sales, EPN
reports eBay, later).

**Engine reuse:** orders gain kind `ticket_fee` (charge = fee only),
linked to `purchase_tickets` (schema v35 when ruled); `foundersFeeCents`,
the ledger, and the refund path carry over unchanged. **Bag batching:**
several referral pieces → ONE fee charge summing their 1%s (dilutes the
fixed 30¢). The direct-checkout lane stays built and gated for any future
storeless designer; nothing is removed.

**Recorded flags (rule with eyes open):**

| Fact | Numbers | Mitigation |
|---|---|---|
| Stripe's fixed cost eats small fees | $100 piece: net ≈ $0.67 of the $1.00 fee; breakeven ≈ a $31 piece — below it the fee loses money; the $80–600 band nets 60–92% | bag batching; optional fee floor (pure pricing — owner's call) |
| Disputes cost more than fees | one $15 dispute ≈ 22 pieces' net fees | loud descriptor + plain checkout copy; dispute rate becomes a defined-before-measured metric before any scaling |
| The toll is skippable | a buyer can search the piece title and buy at the source, fee-free | founding-scale honesty: the fee prices the terminal's value; measure ticket-open → fee-paid → reported-purchase (C6, defined before measured) |
| ⚖ EPN terms | eBay Partner Network restricts some paid/incentivized-traffic models | verify terms BEFORE combining the customer fee with affiliate links on the same click; per-source fallback (eBay pieces: affiliate only OR fee only) |

**Owner choices before build:** (a) ticket framing vs bare fee-toll —
recommend ticket, it is the honest version; (b) bag batching on day one —
recommend yes; (c) dead-listing auto-refund — recommend yes; (d) a fee
floor for cheap pieces — no recommendation, pure pricing. Ruling §6 also
re-scopes P1: the shipped in-checkout fee keeps applying to any direct
ASILUM sale; referral pieces use the ticket fee instead.
