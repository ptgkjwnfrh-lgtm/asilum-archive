# ASILUM launch checklist — 19 August 2026

One list, gate-ordered: a gate opens when everything above it is done.
Sources of truth it consolidates: the 18 Aug 2026 notes (owner queue),
designer-program/ONBOARDING.md §0, SETUP-KEYS.md §5, risk-campaign §7/§8.
**Owner** = only you can do it. **Agent** = say the word and it runs.

## GATE 0 — ✅ CLOSED 20 Aug 2026 (all eight, owner driving)

- [x] **Owner** Supabase Site URL → `https://www.asilummagazine.com` —
      saved + DOM-verified. Ruling 7 fully closed.
- [x] **Owner** Stripe sandbox key ROTATED + proven (3 keyed tests pass on
      the new key; old key dead).
- [x] **Owner** `asilum-vq9p` DELETED (held zero domains) — build spend
      halved; plain merge ritual restored the same hour (#300).
- [x] **Owner** `/admin` STEP 1 — token re-minted (old was
      Vercel-Sensitive, trap 20), all four panels verified.
- [x] **Owner** Claim 12 — VoiceOver pass by ear; caught + fixed the AT
      ghost-click bug (#300).
- [x] **Owner** Deploy-drift workflow ACTIVE via web commit (`c40e1ff`).
- [x] **Owner ruling** Booth fee: the $5 fee stays dead — economics
      re-ruled 20 Aug: 1% buyer-paid founders fee on every sale, no base
      commission, hotlist booth = optional paid program ($150/mo + 15%
      attributed-only, taste-gated). Ruling record + build spec:
      `hotlist-program-spec-2026-08-20.md`; designer docs rewritten.
- [x] **Owner ruling** D4 = (b) first-visit consent moment. Spec awaiting
      owner approval: `d4-consent-spec-2026-08-20.md`; ships in an
      owner-directed UI round, live before doors open (see Gate 6).

## GATE 1 — Supabase, hard deadline **5 Sep**

- [ ] **Owner** Pro upgrade decision. It carries two things at once: the
      quota restriction lifts AND the leaked-password toggle (Pro-gated)
      becomes flippable. Decide before the 5th, not after.
- [ ] **Owner** After upgrade: flip "Prevent use of leaked passwords"
      (Auth → Sign In / Providers → Email). Closes the last advisor WARN.
- [ ] **Owner** Custom-SMTP ceiling check: 30 mails/hour stands until the
      plan changes — fine for founding scale, known before launch spikes.

## GATE 2 — the LLC arrives (~25 Aug)

- [ ] **Owner** Stripe "Verify your business" (live keys exist only after).
- [ ] **Owner** LIVE `STRIPE_SECRET_KEY` → Vercel env (clipboard ritual —
      never through a transcript, no screenshots while revealed).
- [ ] **Owner** Dashboard → Webhooks → endpoint
      `https://www.asilummagazine.com/api/stripe/webhook`
      (`checkout.session.completed`, `checkout.session.expired`,
      `payment_intent.succeeded`, `payment_intent.payment_failed` — the
      PI pair settles the ticket-fee lane) →
      its `whsec_` → Vercel as `STRIPE_WEBHOOK_SECRET`.
- [ ] **Owner** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: pk_test_ →
      `.env.local` now (unlocks card entry in the housing for sandbox
      E2E), pk_live_ → Vercel at launch. Public by design; without it
      card entry says so and stays idle.
- [ ] **Owner** New SendGrid key (Mail Send ONLY) + `ORDER_NOTIFY_EMAIL`
      → Vercel. Until then paid orders settle silently (ledger holds).
- [x] Schema current on prod (v33, probed) — **done 18 Aug**.
- [ ] **Agent** After keys land: smoke the live webhook with one $1 real
      order (part of Gate 5's drill).

## GATE 3 — paper

- [ ] **Owner** Counsel pass on `designer-program/AGREEMENT-DRAFT.md` +
      `legal-drafts/refund-policy-draft-2026-08-18.md` — ONE
      merchant-of-record answer across both.
- [ ] **Owner + Agent** Refund policy onto `/terms` (owner directs the UI
      round; the draft is written).
- [ ] **Owner** Voice pass on `designer-program/OFFER.md` and
      `OUTREACH-LETTER.md` (terms are binding — re-ruled 20 Aug to the
      founders-fee model; the words are yours).

## GATE 4 — designers (the real work)

- [x] **Agent** Founders fee (1%) live in checkout BEFORE the first real
      piece can sell (`hotlist-program-spec-2026-08-20.md` P1) —
      **shipped #303, 20 Aug**: Stripe line item + `fee_cents` ledger
      (schema v34 on prod), browser-proven \$100 piece → \$101.00 total.
- [ ] **Owner** First five outreach sends — [PERSONAL LINE] each, one at a
      time, log who/when. (Letter parked at OUTREACH-LETTER.md.)
- [ ] **Owner + Agent** Per yes: ONBOARDING.md §§1–4 (apply → domain token →
      approve with evidence → link source → import/intake). Same-day live.
- [ ] **Owner** Standing weekly availability duty until source sync exists
      (re-running the Shopify import IS the interim sync).

## GATE 5 — the first-order drill (before any stranger pays)

- [ ] **Owner** Buy one real low-value piece END TO END in live mode:
      pay → notify email arrives → `admin ?area=orders` shows the trail →
      designer ships with tracking → delivered.
- [ ] **Owner + Agent** Refund drill on that same order (`order.refund`) —
      money back, ledger `refunded`, statement drafted. Ten minutes of
      rehearsal before real customers exist.

## GATE 6 — doors open

- [x] **Owner + Agent** D4 consent moment live BEFORE announce — **built
      20 Aug on the owner's order** (server-enforced unanswered =
      unobserved; `d4-consent-spec-2026-08-20.md` is the record). Voice
      pass on the moment's draft copy rides the Gate 3 owner pass.
- [ ] **Owner** Announce (however small — founding is the story).
- [ ] **Agent** Watch `?area=orders` + deploy/floor/trigger checks;
      C1–C4 dashboards ship once real data exists (defined in the metric
      register, `—` until measured).
- [ ] **Owner** The Sep 5 / Oct 14 (SendGrid trial → 100/day) deadlines
      stay on the calendar regardless of launch date.

**Standing laws that outlive every gate:** no fake integrations; demo stays
labeled until it isn't demo; no machine path to verified; flag-never-judge;
the ledger is the authority; UI changes only in owner-directed rounds.
