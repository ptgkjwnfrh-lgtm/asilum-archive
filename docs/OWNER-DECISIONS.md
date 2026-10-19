# OWNER DECISIONS 1–10 — one-sitting memo

Status: DECISION AID — engineering recommendations, not product mandates.
Prepared 2026-07-17. The ten decisions from the July-15 Master Handoff,
each with current state, what it unblocks, a recommendation, and the safe
default that applies while it stays unanswered. Companion registers:
RIGHTS-REGISTER.md, DATA-INVENTORY.md, CAPABILITY-MAP.md, FEATURE-FLAGS.md.
Items marked ⚖ need counsel in the loop (see EU-AI-TRANSPARENCY.md — the
counsel email routes those questions).

Answer sheet at the bottom — ten lines, fill and return.

## 1. Launch countries / regions ⚖

- **Question:** which markets does ASILUM launch in first?
- **Current state:** private prototype, no deployment; DB in ca-central-1.
- **Unblocks:** privacy-policy jurisdiction set, EU AI Act scope answer,
  currency/sizing defaults, source licensing priorities.
- **Recommendation:** US + Canada first; EU second wave only after the
  counsel package (transparency, retention, policy stack) is signed off.
  Sequencing EU second converts the 2026-08-02 question from a deadline
  into a launch-checklist item.
- **Default while undecided:** nothing ships publicly anywhere.

## 2. Minimum age & age policy ⚖ (blocks Feature F with #3)

- **Question:** minimum age, and how it is asserted (self-declare vs
  verification).
- **Current state:** no age gate exists; no UI collects age.
- **Unblocks:** DMs (Feature F), any social surface going public
  (profile rooms are built but the product is private).
- **Recommendation:** 16+ self-declared at account creation, no biometric
  or document verification at this scale; counsel confirms per launch
  region (13/16 split varies).
- **Default:** no messaging, no public social surfaces.
- **DECIDED 23 Aug 2026 — 13+, self-declared at account creation.** The
  owner set the minimum at 13, below the 16+ recommended above. Recorded as
  given; engineering does not decide this one.
  - **Assertion:** self-declared date of birth at account creation, no
    document or biometric verification at this scale. Stored so the check
    survives a birthday — someone who is 12 today is 13 next year, and a
    one-off boolean would silently never re-evaluate.
  - **⚖ STILL COUNSEL'S, and this note's own words:** "counsel confirms per
    launch region (13/16 split varies)". 13 is the US COPPA line and works
    for the US/UK; several EU member states set the GDPR digital-age-of-
    consent at 14, 15 or 16, so 13+ is not uniformly lawful across the EEA.
    Launch regions (decision #1) and this one have to be answered together.
  - **Consequence for DMs:** 13+ means minors ARE present. That does not
    block text messaging; it is precisely why the media pipeline stays
    gated on a CSAM provider, a designated DMCA agent, and named
    moderators (below).

## 3. DMs: build or not, and under what safety bar (blocks Feature F with #2)

- **Question:** do DMs ship at all — and if yes, the minimum safety stack
  (blocking, reporting, retention, moderation staffing).
- **Current state:** THREAT-MODEL.md §3 sketches the policy stack; no
  schema, no UI (deliberate — CAPABILITY-MAP).
- **Unblocks:** Feature F end to end.
- **Recommendation:** defer DMs entirely until after public launch;
  fashion moodboarding does not need messaging to prove itself, and the
  moderation surface is the single biggest ops cost on the board. If a
  social loop is wanted sooner, profile-room reports + follows already
  exist without free-text risk.
- **Default:** not built.
- **DECIDED 23 Aug 2026 — DMs SHIP.** The owner directed the build against
  the recommendation to defer. Recorded as given. Scope as ruled:
  - a **separate requests inbox** — first contact from a stranger lands in
    a requests queue, not the main inbox (owner ruling, 23 Aug). This is
    load-bearing rather than cosmetic: a business cannot switch DMs off, so
    without a request lane its inbox IS the spam target.
  - **blocking is per-account**, not per-conversation (owner ruling,
    23 Aug) — a block covers the person and must survive a new thread, a
    second storefront thread, and every reply path.
  - **text first.** Ships behind `MESSAGING_ENABLED` (FEATURE-FLAGS.md:37),
    absent by default, no fake "coming soon" states in API responses.
  - **media is a SEPARATE flag and is NOT enabled.** The per-conversation
    "receive images and videos" consent law is built — both sides, per
    conversation, revocable — but no attachment can be sent until the four
    items below exist. There is also no video handling anywhere in the
    codebase today; that is from-nothing work.
- **STILL OPEN, and each one gates media rather than text:**
  1. a CSAM hash-matching provider,
  2. DMCA designated-agent registration (DATA-INVENTORY names it as
     required before any user-media surface goes public),
  3. named moderator credentials — today there is ONE shared `ADMIN_TOKEN`
     and one `ADMIN_ACTOR` string, so "logged and purpose-limited" is only
     half-satisfiable and no action can be attributed to a person,
  4. a moderation response target, and who is on the other end of it.

## 4. Wardrobe default visibility

- **Question:** does wardrobe stay private-only, or gain opt-in sharing
  (e.g., pieces surfaced on profile rooms)?
- **Current state:** private-only by design; copy says "Private in this
  version"; photos in a private Storage bucket, signed URLs, erasure
  proven (Feature C, PRs #35/#36).
- **Unblocks:** profile-room wardrobe modules; social proof loops.
- **Recommendation:** keep private-only through launch. Sharing is a
  one-way door reputationally; the erasure story is currently clean and
  simple to state in the privacy policy.
- **Default:** private-only (already enforced).

## 5. AI provider approval ⚖ (unblocks the live model call)

- **Question:** approve Anthropic as the model provider (terms + retention),
  set a key, and turn on the first gated feature?
- **Current state:** adapter seam REAL but OFF (no key; every flag in
  `lib/ai/config.js` defaults off). Phase-1 exit gate (model-resolver ECE)
  waits on this. EU-AI-TRANSPARENCY.md now defines the model-enable gate:
  counsel sign-off + on-surface disclosure + `ai_model_events` retention
  BEFORE any flag ships enabled.
- **Recommendation:** approve Anthropic, start with the lowest-risk
  surface (mood-board analysis wording, validated + certainty-capped),
  keep stylist/model ranking off until the eval harness has a baseline.
- **Default:** everything deterministic/curated — the product works and
  the disclosure copy stays literally true.

## 6. Licensed commerce sources

- **Question:** which source integrations to pursue with real agreements,
  in what order (eBay ready-gated; WooCommerce approval-gated; others
  disabled by contract design).
- **Current state:** eBay adapter live-when-keyed behind explicit approval
  env; WooCommerce behind `WOOCOMMERCE_STORE_APPROVED=1`; 6-source
  contract scaffolding exists (RIGHTS-REGISTER rows per source).
- **Recommendation:** eBay first (adapter finished, affiliate-compatible,
  archive-fashion inventory matches the product), one boutique
  WooCommerce partner second as the small-merchant proof. Nothing else
  until those two produce real tickets.
- **Default:** demo inventory only; tickets refuse demo purchases
  (already enforced).

## 7. Spotify path (register row: decide, don't drift)

- **Question:** abandon / manual-only / pursue written approval.
- **Current state:** automatic profiling BLOCKED by Spotify Developer
  Policy (RIGHTS-REGISTER); manual path (user picks artist/genre, curated
  `lib/music-mapping`, zero Spotify data) is allowed and partially built.
- **Recommendation:** manual-only, permanently. The curated mapping is
  honest, already trains the brain, and removes a whole compliance
  surface. Write "abandoned: automatic profiling" in the register and
  stop carrying the question.
- **Default:** manual-only (identical to the recommendation — this one is
  effectively decided by inaction; the memo just asks you to make it
  official).
- **SUPERSEDED 18 Oct 2026 by CONSTITUTION A6 (3):** Spotify and Apple Music are to be pursued (applications prepared last in the build; the owner submits). The 2 Oct ruling stands only as history:
- **DECIDED 2 Oct 2026 (owner: "take the wheel"): manual-only, permanently.**
  Automatic profiling is abandoned. The connector registry
  (`lib/connectors/index.js`) states it: `artist-stamps` available from
  ASILUM's own table, `taste-import` unsupported. RIGHTS-REGISTER row updated.

## 8. TikTok: wait or drop

- **Question:** keep waiting for a partnership/app approval, or drop trend
  ingestion from TikTok entirely.
- **Current state:** BLOCKED (Research API ≠ commercial personalization);
  trend layer already runs on editorial press with citation discipline
  (trends.js, reviewed 2026-07-17, next review 2026-09-15).
- **Recommendation:** drop it. The press-sourced trend authority just
  proved it can hold a review cycle without platform data; a TikTok
  partnership is a business-development project, not an engineering gap.
- **Default:** no TikTok data (already true).

## 9. Brand verification staffing (Feature G ops)

- **Question:** who works brand cases (verification/impersonation) —
  owner, contractor, or deferred until brands actually apply?
- **Current state:** full case machinery live (schema v18: TRANSITIONS,
  evidence rules, append-only ledger, admin API) but `BRAND_VERIFICATION_
  ENABLED` off and no public intake exists.
- **Recommendation:** defer staffing; keep the flag off until the Shopify
  partner app exists (the OAuth half of G) — cases can't originate at
  volume before that. Revisit when partner-app review is submitted.
- **Default:** machinery dormant, no badges shown.

## 10. Retention periods ⚖ (unblocks the cleanup job)

- **Question:** confirm the DRAFT retention periods in DATA-INVENTORY.md
  (notably search_logs — currently UNBOUNDED — and security telemetry
  DRAFT 90 days).
- **Unblocks:** the retention cleanup job (a small scheduled PR once
  numbers are fixed), privacy-policy retention table, counsel gap #3.
- **Recommendation:** adopt the drafts as written (they were set
  conservatively), with search_logs capped at 180 days; counsel confirms
  in the same pass as the transparency review.
- **Default:** drafts remain drafts; search_logs keeps growing — this is
  the one decision where inaction actively accrues risk.

## 11. Taobao and marketplace provenance — ✅ RULED 27 August 2026

- **Question:** a large share of Taobao fashion is replica. A pipeline that
  surfaces it and an authenticity checker that flags it pull against each
  other unless one policy is stated.
- **RULING (owner, 27 Aug 2026):** *"taobao is unverified-origin, label
  everything, dont hide it."*
- **What that means, as built:**
  - Marketplace inventory **is ingested**. It is not suppressed, not filtered
    out, not quietly ranked into oblivion.
  - Every piece carries `originEvidence` — stamped server-side in
    `publicProduct`, so no surface can re-derive it and drift.
  - The label is **visible on every surface that shows a piece**, pinned to
    the colour-evidence line by `tests/provenance.test.js` so a new grid
    cannot ship without it.
  - On an unverified piece **the brand is recorded as a CLAIM**
    (`brandIsClaim: true`), never as a fact. This is ASTERISK's first law at
    the catalog boundary: it may not reason from a word it cannot back.
  - **Verification is earned.** An unregistered source defaults to
    `unverified`. Guessing "verified" would tell a reader something is genuine
    when nobody checked.
- **What this is NOT:** `verified` describes an agreement with a MERCHANT, not
  an authenticated garment. **ASILUM authenticates nothing** — asserted in the
  tests, which reject the words "authentic" or "genuine" in that note.
- **✅ RULED 27 Aug 2026 (the open half):** *"unverified stock ranks the same,
  dont demote it just add a verified sticker in the top left of the listing."*
  Ranking is untouched, and `tests/provenance.test.js` asserts it two ways —
  `lib/search` and `lib/brain` may not even reference the provenance fields,
  and two otherwise-identical pieces are shown to score identically (6 and 6).
  The sticker is the whole intervention.

- **✅ AND THE REASONING BEHIND IT, which shaped the design:** *"the avid
  consumer doesnt really care if its real if it looks cool at a good price its
  being bought. if it is highly priced comparitivley to construction, brand
  socially viewed value, matreial used, associated hype then the verifcation is
  needed because multiple factors are at play for my choice to buy it."*

  So verification is not a constant worry — **it scales with what is riding on
  it.** `stakeOf` in `lib/provenance.js` holds that ladder, and the sticker's
  weight follows it: dashed and faded under $150, solid to $600, and red and
  unmissable above it, where the name is most of what is being bought.

  **What that model does NOT yet know, stated in the code rather than implied:**
  the ruling says *comparatively to* construction, brand value, material and
  hype. We cannot compute that today — it needs the comparables model
  (ROADMAP §4.6, silent below n=3). Absolute price is the honest proxy in the
  meantime: a real number we hold, moving the right way, not pretending to be
  the comparison actually described. When comparables land, `stakeOf` gains a
  second input and these thresholds become the fallback.

- **Deliberately quiet:** the VERIFIED sticker recedes. A reader trained to
  hunt for a green tick stops noticing anything; the point is that its
  **absence** is legible where it matters.

## Answer sheet

Reply with ten lines (any format):

    1. countries: …
    2. min age: …
    3. DMs: …
    4. wardrobe: …
    5. AI provider: …
    6. sources: …
    7. spotify: …
    8. tiktok: …
    9. brand-verify staffing: …
    10. retention: …

Engineering acts the same day on: 5 (model-enable gate walk), 6 (eBay
keying), 7/8 (register updates), 10 (cleanup job PR). 1/2/3 route through
counsel; 4/9 are register updates until their features go public.

## 9. The clear-history notice (V.2 §3) — DECIDED 2 Oct 2026

- **Question:** tell the other participant when a viewer clears their own
  copy of a conversation (the brief's requested behaviour), or suppress it
  (the brief's own recommendation: clearing one's inbox is ordinarily private).
- **Decided (owner: "fix any recommendations you have"):** SUPPRESSED —
  the code default is OFF (`lib/dm.js clearNoticesEnabled`). The handler stays
  configurable; `DM_CLEAR_NOTICES=1` turns the notice on.

## 10. Listing verification reviewers (V.2 §12) — DECIDED 2 Oct 2026

- With the model off, the AI metadata check is LOCAL RULES capped at 0.5
  confidence (`lib/verification/ledger.js`), so **every badge needs a named
  human review** until a keyed model is evaluated on fixtures. Reviewer name =
  `ADMIN_ACTOR` on production; the breakdown prints it on every verified card.
- No listing carries a badge today. `npm run verify:listings` lands passing
  listings PENDING; a review is `POST /api/verification/listing { itemId,
  human: pass|fail }` with the admin token.

## 12. The 18 October 2026 rulings — DECIDED (CONSTITUTION A6)

The owner's word on the open rows of `docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
given in one message on 18 Oct 2026 and recorded verbatim in spirit:

- **Fees:** $1 + 1.5% passenger fee on every purchase (supersedes the 1%
  founders fee); the $30 activation only for DROP; SELL is subject only to
  the processor's fees, which ASILUM does not control.
- **Friend asterisk:** followers are tracked server-side; the refusal is
  lifted. The asterisk is a plain typographic mark, never the boxed |A|.
- **|A|:** a box with the letter A in it.
- **Music:** apply for Spotify and Apple Music developer access — last in
  the build. ASILUM prepares; the owner's hand signs what a service requires
  of the account holder.
- **BRDCST pricing:** best judgment — profitable, affordable to a small band.
  `lib/brdcst/index.js PRICE` is the figure.
- **MOTION limits:** the slice 9 figures stand.
- **Onboarding:** account creation collects birth date, home town and an
  optional, explained, erasable ethnicity; 14.11's questions ("what was
  12-year-old you listening to on the bus ride to school") use them to
  suggest a popular artist for the passenger's cohort, and more questions of
  that kind gather identity anchors. The passenger confirms or corrects
  every suggestion; nothing is assumed.
- **Everything that is law but not yet in motion is to be built**, the
  identity work included, with the fewest questions back to the owner.
