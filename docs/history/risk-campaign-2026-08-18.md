# ASILUM risk campaign — 18 August 2026

Provenance: the owner supplied 200 numbered items — "100 ways ASILUM could go
wrong" (F1–F100) and "100 reasons investors would reject ASILUM" (I1–I100) —
plus their own synthesis: the 200 collapse into five objections (unfocused /
commerce loop not real / revenue model can't carry the ops / cross-border trust
+ compliance exposure / vision ahead of evidence), and the single most
important proof is **a narrow, real transaction system**.

This document is the campaign against that list. It is the strategy authority
for risk work; the state authority remains the 17 Aug 2026 notes (git history), and
product decisions live in `docs/OWNER-DECISIONS.md`.

**The honesty rule this document obeys:** most of the 200 cannot be "nullified"
by code, and a plan that claims otherwise is the same class of fake the
constitution forbids. Every item gets exactly one disposition, and WATCH —
"this can only be instrumented, never removed" — is a legitimate disposition,
not a dodge.

---

## 1. Dispositions

| Code | Meaning |
|---|---|
| **SHIPPED** | Already nullified by merged, test-pinned work. Citation given. |
| **OWNER-2MIN** | Nullified by a small owner action already queued, with exact steps. |
| **DECISION** | Requires an owner ruling. Recommendation + safe default recorded (most already in OWNER-DECISIONS.md — referenced by their numbers, not restated). |
| **LOOP** | Nullified by construction inside the Proof-of-Loop program (§2) — either the loop's design removes the risk, or its gates surface the risk early enough to act on. |
| **CUT** | Nullified by not building the thing. The risk exists only if a feature ships; the recommendation is that it doesn't ship in v1. |
| **WATCH** | Irreducible external risk. Assigned an early-warning signal and a posture. Cannot be nullified by anyone. |

A large fraction of the founder list is already SHIPPED because the app was
rebuilt around honesty this summer. That is worth seeing plainly before
building anything new: the demo catalog is disclosed on every surface
(`app/layout.js` site description, the per-piece DEMO label per owner ruling
#212, the og:image card's own disclosure line — all pinned by
`tests/demo-mode.test.js` and `tests/opengraph-image.test.js`), fake
integrations return honest 501s with the red `soon` convention, fabricated
editorial was killed (#213), and the purchase path is a consent-gated ticket
with `DISCLAIMER v1-2026-07` (`lib/tickets.js`) rather than a fake Buy button.

---

## 2. The spine: Proof-of-Loop

The owner's own synthesis names the cure, so the campaign's spine is that cure
made executable. Everything else in this document either supports it, waits
behind it, or watches from outside it.

**Goal:** inside ~90 days of the LLC arriving (~25 Aug), complete **10 real
purchases** of real garments from real designers, with **at least 1 repeat
buyer** and **positive contribution margin per order** measured after payment
fees, shipping, and support time.

**Phase L0 — Preconditions (now → LLC arrival).**
Owner rulings D1–D5 (§8), Stripe account creation (owner — account creation is
never agent work), counsel review of terms/refund/privacy for the launch
region. The demo-honesty layer stays exactly as is until real inventory
replaces synthetic — the disclosure comes down only when it stops being true.

**Phase L1 — One corridor, real supply.**
5–10 designers, one region (recommendation: US+Canada domestic,
OWNER-DECISIONS #1), designer-ships fulfillment. Real inventory rows with live
source URLs and availability checks (the `product_sources` /
`product_availability_checks` tables and the six-adapter ingest contract have
existed since PR #10 — the machinery is built, only honest data has ever been
missing). **Gate:** if 5 designers can't be signed in ~30 days, that is F21/F39
surfacing at the cheapest possible moment — the answer is to fix the offer, not
to widen the scope.

**Phase L2 — Real checkout.**
Stripe Checkout (card data never touches ASILUM — PCI stays Stripe's), an
append-only order ledger in the `brand_cases` pattern (single source of truth
for order state, F68 dead by construction), transparent all-in price before
payment, refund policy on `/terms` before the first order, logging on every
transition of the purchase path (F70 for the only path where it's fatal).
This is new build work and it is **owner-gated**: checkout sits on the
constitution's "do NOT build yet" list, and unbuilding that requires the
owner's word, not an agent's initiative.

*Status 18 Aug: the owner unlocked this ("stripe is setup, go forth") and the
ENGINE is built and test-mode-verified — schema-v31 (orders + append-only
order_events), lib/payments/stripe.js (fetch client, no SDK), lib/orders.js
(honesty gate + reconcile-on-read), /api/checkout + /api/stripe/webhook,
`scripts/verify-stripe-e2e.mjs`. Demo items refuse 409 by construction, so
nothing user-facing changes until L1 lands real inventory. Launch runbook:
SETUP-KEYS.md §5. Still open here: refund policy copy on /terms (counsel),
UI wiring (owner-directed round), live keys (owner business verification).*

**Phase L3 — Measure.**
Extend `docs/history/metric-definitions-2026-08-17.md` with the commerce four:
visitor→purchase conversion, repeat rate, contribution margin per order,
support minutes per order. Real numbers, however small — ten honest orders
answer I21–I30 in a way no waitlist can.

**What the spine kills by construction:** the five objections directly.
Focus (one corridor, one loop), realness (actual transactions), economics
(measured per-order P&L before scaling), compliance exposure (domestic
designer-ships — see §3), evidence (the loop IS the evidence).

---

## 3. The single largest de-risking move: CUT cross-border proxy purchasing from v1

Items F43–F48, F51–F60, F76, F90, I34–I36, I58, I61–I68 — roughly **35 of the
200, including the entire worst cluster** (payment-security exposure, sanctions
screening, customs, agent data leaks, merchant-of-record ambiguity, per-order
manual labor) — exist only if v1 ships proxy purchasing through human agents
abroad.

Recommendation: **v1 is domestic designer-ships only.** Proxy purchasing
returns, if ever, as its own later program with counsel, a payments partner,
and real unit economics from the loop. Two sub-items are permanent regardless:

- **F52/I62 (delegated card data): never.** No architecture in which agents
  see customer card data is acceptable at any scale. If proxy buying is ever
  built, it uses issued virtual cards or ASILUM-as-buyer — this is recorded
  now so it never has to be argued from scratch.
- **F27/I67 (counterfeits):** invite-only supply is the current control and
  stays; the SOURCE-POLICY.md legitimate-sources-only rule already encodes it.

This is DECISION D1 (§8) — the recommendation is strong, but cutting scope is
the owner's call, per constitution.

---

## 4. Track A — Truth & trust (F5–F20, F63, F83, I12–I18)

| Items | Disposition | Evidence / mechanism |
|---|---|---|
| F11, F12, F13, F83, I12, I13, I15 (synthetic mistaken for real; Buy → demo; fake traction) | **SHIPPED** | Demo disclosure on layout, per-piece labels, og:image card; ticket flow is consent-gated with versioned disclaimer, not a fake checkout. `tests/demo-mode.test.js` pins it. The disclosure comes down only when inventory is real (L1). |
| F14, I14 (no live source URLs) | **LOOP L1** | Real `product_sources` rows are the entry criterion for real inventory; synthetic pieces stay labeled DEMO until then. |
| F15, F16, F28 (stale availability/prices/links) | **LOOP L1** | `product_availability_checks` machinery exists; the L1 rule is: no availability signal → no live listing. This is also the standing holdings rule (Aug 7: no holds until a real availability signal exists). |
| F7 (taste-match % feels fabricated) | **SHIPPED** | Ruling 8 (#254): the match floor is a real gate calibrated from 9,000 measured looks; the activity bonus that let browsing buy past the gate is gone; MATCH is recomputable from the stats printed beside it. `npm run floor:check` re-measures it. |
| F9 (Discover unaffected by Mood Board) | **SHIPPED as design, DECISION if unwanted** | Discover is deliberately taste-free (documented product law). If the owner wants it personalized, that's a product ruling, not a bug. |
| F5, F6 (onboarding load; cold start) | **LOOP L3** | Measurable only with real visitors: instrument onboarding completion + first-session depth when the loop opens the doors. Cold-start floor already exists (21.2/25 usable looks on a cold profile, measured in ruling 8). |
| F8 (stylist combines unwearable pieces) | **SHIPPED + person** | Sizing/fit engine + match floor are live; §NEXT item 1 keeps a person's eye on the page because genre biasing is deliberately outside the automated check. |
| F19, F20, I20 (readability, a11y, mobile) | **SHIPPED except one** | Contrast AA across tokens (#216/#218/#219), structural a11y (#214), claims 5/6/8/10 mutation-audited (#270). The one soft claim is 12 (screen reader) — OWNER-2MIN #4. |
| F63 (ASTERISK invents details) | **SHIPPED by architecture** | ASTERISK is deterministic by product law; no live LLM calls exist in production (the Anthropic adapter is gated off). There is no surface on which to hallucinate. Any future LLM feature inherits the honesty contract in `lib/ai/contract.js`. |
| F10 (constant redesigns) | **SHIPPED as process** | The UI is under owner-directed rounds only; brand/copy/type law is test-pinned so drift reddens CI. The stabilize-before-expand rule is the constitution's first law. |
| F17, F18 (order ownership/returns unclear) | **LOOP L2** | Refund/returns copy on `/terms` is an L2 entry criterion, with counsel (OWNER-DECISIONS ⚖ items). |

Remaining open in this track: `/cover`'s optimistic wire post needs owner copy
for the refusal case (flagged in-code, #268), and claim 12 needs a human at a
screen reader.

---

## 5. Track B — Platform integrity (F61–F70, I69, F94, F98)

| Items | Disposition | Evidence / mechanism |
|---|---|---|
| F66 (breach) | **SHIPPED baseline + OWNER-2MIN** | RLS on all 59 tables with the app locked to least privilege (v30 closed the one no-policy gap, #279, `tests/rls-app-policy.test.js`); identity has a single server-side chokepoint (`resolveRequestUser`, tested down to `lib/supabase.js` #257); secrets are env-only. Remaining 2-minute item: leaked-password protection toggle (§7). |
| F67 (account takeover) | **SHIPPED baseline** | Supabase auth with server-verified bearers; password reset loop verified end-to-end in production (Aug 15). HaveIBeenPwned toggle (§7) closes the advisor finding. |
| F68 (order state disagreement) | **LOOP L2** | Append-only order ledger, one source of truth — the `brand_cases` pattern already proven in production. |
| F69 (fragile prototype code) | **SHIPPED as discipline** | 110 test files, 881 tests, mutation-audited claims, copied-constants sweep (#271), coverage sorted by callers not size. This is the track record I71/I80 ask about, in artifact form. |
| F70 (missing logging/monitoring) | **Partial + LOOP L2** | `deploy:check` / `floor:check` / `triggers:check` measure instead of carry; CI status readable (`gh pr checks`); scheduled trend-freshness job confirmed healthy. The purchase path gets transition logging as an L2 entry criterion. Full APM is deliberately deferred — WATCH-grade until there is commerce to monitor. |
| F61 (third-party API shutoff) | **WATCH + design** | Current production has zero third-party AI/search/payment dependencies at runtime (readiness audit). Each future integration (Stripe, eBay) enters behind the existing adapter/flag pattern so a shutoff degrades honestly instead of breaking. |
| F62 (merchants block scraping) | **CUT** | No scraping is built or planned for v1; supply arrives via consenting designers. If ingest adapters ever scrape, that's a new decision. |
| F64 (prompt injection vs purchasing agent) | **CUT for v1, rule recorded** | No LLM purchasing agent exists. Standing rule for any future one: merchant-page content is data, never instructions — same boundary this repo's agents already operate under. |
| F65 (default-on observation backlash) | **DECISION D4 — RULED (b) 20 Aug** | The observation toggle exists in Settings; anonymous feed impressions are the default-on part. Options in §8. `/terms` + DATA-INVENTORY.md already document practices; EU-AI-TRANSPARENCY.md routes the counsel questions. |
| F98 (viral overload) | **WATCH** | Free-tier ceilings are the honest current capacity (Supabase quota, Vercel builds, 30 emails/hour). Signal: sustained traffic > free-tier headroom. Posture: the §7 quota decisions before any launch push, not after. |
| I69 (seller verification) | **LOOP L1** | Invite-only + designer contracts in the loop corridor; identity verification formalizes when supply opens beyond invites. |

---

## 6. Track C — Economics (F41–F50, I31–I40), supply & demand (F21–F40), brand (F81–F90)

**Economics.** The current 2% + $5 model (F41/F42, I31/I32) cannot carry
support, fraud, and engineering — the owner's list is right. But the honest
fix is not to pick a new number from a chair: it is DECISION D2 with a
recommendation (start at 15% commission + payment fees passed through,
designer-ships domestic; revisit against measured support-minutes-per-order
from L3) and the loop as the calibration instrument. F43–F48 fall away with
the proxy cut (§3); F49 (fraud) rides Stripe Radar + domestic-only in v1;
F50 / I37–I39 (LTV, CAC, contribution margin) are exactly what L3 measures.
I40 (working capital float): designer-ships + Stripe standard payouts keep
ASILUM out of the float business in v1.

**Supply & demand.** F21–F26, F29–F40 and I41–I50 are founder-ops questions
that no code can answer; the campaign's contribution is that the loop makes
them **small and measurable** (5–10 designers, one corridor, real conversion
numbers) instead of large and theoretical. Specific standing controls:
supplier quality bar stays invite-only (F24); incompatible product data goes
through the one normalizer that already exists (`lib/ingest/normalize.js`,
F26); payout accuracy inherits the append-only ledger (F30). The
demand-side risks (F31–F38: browse-don't-buy, disintermediation, small
audience, editorial without commerce) are WATCH until L3 produces the first
real funnel numbers — then they become measured facts with names.

**Brand & community.** F81 (exclusionary invite language) and F86 (editorial
independence) are owner voice decisions — the copy-law mechanism (#250) is
the enforcement tool once ruled. F84/F85 (spam, moderation): the Wire is not
public today; OWNER-DECISIONS #2/#3 (age policy, DMs safety bar) already
gate any public social surface, and the safe default — nothing social ships
publicly — is in force. F87 (privacy controversy): §7 items + D4. F82
(mission dilution): the loop's one-corridor rule is the anti-dilution
mechanism. F88/F89 (platform copies the features): WATCH — defensibility
per I51–I60 comes from supply relationships and proprietary taste data
earned over time, neither of which a feature-copy replicates; the honest
posture is speed on the loop, not moats on paper.

---

## 7. The owner action queue (every OWNER-2MIN item, one sitting)

Already queued in the handover; restated here because eight of the 200 die in
about fifteen minutes total:

1. **Supabase leaked-password protection** — Dashboard → Authentication →
   toggle HaveIBeenPwned checking. Kills the last real advisor finding
   (F66/F67 hardening).
2. **Supabase Site URL** → `https://www.asilummagazine.com` — closes ruling 7
   (canonical-host consistency; F19-adjacent trust polish).
3. **Vercel duplicate project** — dashboard: check whether `asilum-vq9p`
   serves anything; if not, disconnect it. **Halves build spend** (F98/F100
   runway hygiene). Check before paying for any tier upgrade.
4. **Claim 12** — five minutes with VoiceOver on /cover, /discover, the item
   modal. Last soft accessibility claim (F19/F20/I20).
5. **`/admin` STEP 1** — unlock and eyeball the four Asterisk panels (16 Aug
   handover carries the expected row counts).
6. **gh token `workflow` scope** (or hand-commit
   `docs/deploy-drift-workflow.yml.txt` to `.github/workflows/`) — unparks
   deploy-drift automation (F70).
7. **Supabase quota decision before 5 Sep** — upgrade or reduce usage; the
   production project gets restricted on that date (F98/F100).
8. **Stripe account** (L0 precondition) — owner-created, agent-configured
   after.

---

## 8. Decisions required (D-queue — recommendations recorded, owner rules)

Existing register: OWNER-DECISIONS.md #1 (launch regions), #2 (age), #3 (DMs)
stand as written. New rulings this campaign needs:

- **D1 — v1 commerce scope. ✅ RULED 18 AUG 2026: APPROVED as recommended.**
  Domestic designer-ships only (US + Canada corridor); cross-border proxy
  purchasing is CUT from v1; delegated card data is refused permanently.
  The ~35 items in §3/§10 marked CUT are now ruled, not proposed.
- **D2 — fee model. ✅ RULED 18 AUG 2026: 15% commission.** Applied as: 15%
  of the item price on completed sales, payment processing borne by ASILUM
  out of that margin, no listing or booth fees in v1 (the $5 booth was not
  affirmed in the ruling — flagged, owner can reinstate). Recalibrate against
  L3's measured support-minutes-per-order. The number's canonical home is
  `docs/designer-program/OFFER.md`; when payout code exists, it moves to one
  constant with a test (the #271 copied-constants law).
  **⟶ SUPERSEDED 20 AUG 2026 (owner ruling):** base sales carry NO
  commission — the buyer pays a 1% "founders fee" on every piece sold
  (non-negotiable; ASILUM still absorbs processing). The 15% survives only
  inside the optional hotlist-booth program: $150/month rent + 15% of
  hotlist-ATTRIBUTED completed sales, with a dedicated attribution channel
  as a precondition of charging it, and booth placement taste-gated to
  matching Passports. Ruling record, recorded flags (processing exceeds
  the founders fee on base sales), and build spec:
  `docs/history/hotlist-program-spec-2026-08-20.md`. Canonical terms home remains
  `docs/designer-program/OFFER.md` (rewritten same day).
- **D3 — unbuild order for the constitution's "do NOT build yet" list.**
  Checkout must move off that list for L2 to exist. Recommendation: unlock
  checkout only, leave payouts/tax automation manual for the first ten orders.
- **D4 — observation default.** Options: (a) keep default-on with the
  existing toggle + disclosure, (b) first-visit consent moment, (c) observe
  only after account creation. Recommendation: (b) for EU-safety and F65
  optics; counsel confirms per OWNER-DECISIONS #1's region choice.
  **✅ RULED 20 AUG 2026: (b) first-visit consent moment.** Spec for the
  owner's approval: `docs/history/d4-consent-spec-2026-08-20.md`; the build ships
  in an owner-directed UI round after approval, live before doors open.
  Interim: (a)'s disclosed default-on stands while strangers are not yet
  invited.
- **D5 — `/cover` wire-post refusal copy** — the one #268 gap; needs the
  owner's voice.
- **D6 — investor timing.** The lists' own conclusion (I91–I100):
  don't raise before the loop produces its numbers. Recommendation: treat
  L3's four metrics as the pitch's evidence section; revisit at 10 orders.

---

## 9. WATCH register (the irreducibles, named honestly)

| Item(s) | Signal to watch | Posture |
|---|---|---|
| F93/I49 (recession, discretionary spend) | L3 conversion + AOV trend | Corridor economics sized to survive thin demand; no fixed costs added ahead of revenue. |
| F88, F89, I51–I60 (copying, bundling, defensibility) | Feature launches by Pinterest/Shopify/majors | Speed on the loop; supply relationships + taste data are the only compounding assets — invest there, not in feature breadth. |
| F94 (processor freeze) | Stripe reserve/review notices | Domestic, designer-ships, clean refund policy = low-risk profile; keep dispute rate visible from order one. |
| F95, F97 (platform/API restrictions, algorithm changes) | Referral mix in analytics | No acquisition channel gets load-bearing status while it's rented; the loop's first buyers are hand-recruited on purpose. |
| F71, F80, I77 (founder bottleneck, burnout) | Decision queue age (this doc's §7/§8 sitting unanswered is the metric) | The D-queue pattern exists precisely to batch decisions into sittings instead of ambient drag. |
| F72, I71–I76 (no CTO, team gaps) | — | The engineering-discipline artifacts (881 tests, handover system, audit trail) are the current answer; a fractional security/payments review before L2 goes live is the recommendation. |
| F92, F99, F100, I91–I100 (capital misallocation, legal drag, running dry) | Runway vs. loop progress | The campaign's sequencing IS the mitigation: nothing scales before ten orders prove the unit. |

---

## 10. Full disposition index

F = founder list, I = investor list. Group dispositions; single-item
exceptions noted inline.

| Range | Disposition |
|---|---|
| F1–F4, F10 | LOOP (focus by construction; one corridor, one loop) — F3 partially SHIPPED (aesthetic rounds are closed; the buying experience is the open half, which is the loop) |
| F5–F9 | Track A row-by-row (§4): F7 SHIPPED, F8 SHIPPED+person, F9 SHIPPED-as-design, F5/F6 LOOP L3 |
| F11–F20 | Track A (§4): F11–F13 SHIPPED; F14–F16 LOOP L1; F17/F18 LOOP L2; F19/F20 SHIPPED except claim 12 (OWNER-2MIN #4) |
| F21–F30 | §6 supply: F24 SHIPPED (invite bar), F26 SHIPPED (normalizer), F27 SHIPPED (source policy) + LOOP L1, F30 LOOP L2 (ledger); F21–F23, F25, F28–F29 LOOP L1 gates |
| F31–F40 | WATCH → become L3 measurements |
| F41–F50 | §6 economics: F41/F42 DECISION D2; F43–F48 CUT (§3); F49 LOOP L2 (Stripe Radar + domestic); F50 LOOP L3 |
| F51–F60 | CUT (§3) — F52 permanently (delegated cards never) |
| F61–F70 | Track B (§5): F63/F64 CUT-by-architecture, F62 CUT, F65 DECISION D4, F66/F67 SHIPPED+OWNER-2MIN, F68/F70 LOOP L2, F69 SHIPPED, F61 WATCH |
| F71–F80 | WATCH (§9) + owner ops; F74/F75/F76 stay CUT-scale in v1 (ten orders need no fraud team); F78 SHIPPED (the handover system is the bus-factor control) |
| F81–F90 | §6 brand: F81/F86 DECISION (copy-law enforceable), F83 SHIPPED, F84/F85 gated by OWNER-DECISIONS #2/#3 safe default, F82 LOOP, F87 §7+D4, F88–F90 WATCH/CUT |
| F91–F100 | §9 + D6: F91 DECISION D6 (don't), F92 SHIPPED-as-posture (the spend went to trust infrastructure, and stops), F93–F97 WATCH, F98 WATCH+§7, F99 WATCH (counsel ⚖ items), F100 the loop exists to prevent exactly this |
| I1–I10 | LOOP (the one-sentence answer becomes true when the loop is the product) — I5/I7 DECISION D1 |
| I11–I20 | Track A: I12/I13/I15 SHIPPED (disclosed demo ≠ fake marketplace), I14 LOOP L1, I16 SHIPPED (search engine v1 + suggest, measured), I17 SHIPPED (ruling 8), I18 SHIPPED (honest 501s), I19 partial (terms live; counsel pass = L0), I20 SHIPPED except claim 12 |
| I21–I30 | LOOP L3 (these ARE the loop's output metrics; nothing else answers them) |
| I31–I40 | D2 + §6; I34 CUT, I40 designer-ships |
| I41–I50 | WATCH + D1 (corridor focus is the answer to I50) |
| I51–I60 | WATCH (§9 defensibility row); I58 CUT |
| I61–I70 | I61/I65/I66/I68 CUT for v1 (domestic) + counsel ⚖; I62 CUT permanently; I63 D4; I64 minimized by designer-ships; I67 invite bar + source policy; I69 LOOP L1; I70 gated by OWNER-DECISIONS #3 safe default |
| I71–I80 | §9 team row; I78 (contractor IP): repo history is single-owner + agent commits — formal assignment docs are an L0 counsel item |
| I81–I90 | LOOP (I85's both-sides-at-once is precisely what one corridor avoids); I84 WATCH (editorial stays cheap: reading room, not original reporting); I90 answered by L2's checkout design (approval friction measured, not assumed) |
| I91–I100 | D6 + §9: raise after evidence, one objective (the loop), milestones = L-phases, I97/I98 counsel at L0, I99/I100 WATCH honestly |

---

## 11. What was true before this campaign

Fairness note, because the lists read as indictments of a product that has
quietly fixed many of them: of the 200, roughly **45 were already dead** on
18 August — killed by the honesty layer, brand/copy law, ruling 8, RLS
hardening, canonical host, a11y program, and the engineering-discipline track
record, all merged, all test-pinned, all cited above. The campaign's job was
to make that visible, cut the worst cluster (§3), and put every survivor in
front of the person who can kill it.
