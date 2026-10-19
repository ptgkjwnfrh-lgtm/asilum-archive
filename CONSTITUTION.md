# *ASILUM Constitution v2 — PROPOSED

> ## ⚠️ SUPERSEDED IN PART — owner directive, 27 August 2026
>
> The owner has set this document aside as the governing rulebook. **Two rules
> now govern all development**, and where anything below disagrees with them,
> they win:
>
> 1. **ASTERISK does not guess.** Every reading must trace to the ASILUM
>    archive, a cited internet source, or archivalist training. Confidence is
>    earned from evidence, never asserted.
> 2. **ASTERISK is an operating system, not a chatbot.** No conversational
>    surface, ever.
>
> **What is kept below, and why.** The product rules here (build order, UI
> policy, the "do not build yet" list) are the owner's to waive and are waived.
> The passages about THIRD-PARTY TERMS — `docs/SOURCE-POLICY.md`, the
> rights register, per-source approval gates — are NOT ASILUM's rules to waive:
> they describe other companies' terms and the law, which do not change because
> our document did. They remain accurate as a description of external risk.
>
> See `docs/ROADMAP-WHEN-BILLING-RETURNS.md` §0.


Binding rules for all work on this app. v2 drafted July 19, 2026 per the
owner's Restructure Handoff; it supersedes v1 (July 7, 2026 — preserved in
git history) **upon owner approval, which is the owner's merge of the PR
that carries this file**. Until that merge, v1 remains in force. Newly
allowed product domains (§4) may not be implemented before that approval.

## 1. Mission

ASILUM becomes the place where fashion is discovered, interpreted,
discussed, styled, and purchased across the internet — one compounding
journey across six prongs, not five disconnected features:

1. **The Market** — a federated, source-labelled fashion marketplace.
2. **The Press** — every verified user can become an editor.
3. **Passport + *ASTERISK** — the user-owned taste map and the travel
   agent that reads it.
4. **The Community** — a fashion social and editorial network.
5. **The Stylist** — owned wardrobe + market + exploration, as an
   Asterisk mode.
6. **Trust, rights, and operations** — the prong the first five cannot
   scale without.

The moat is the lawful combination of catalog, explainable taste graph,
consented first-party signals, creator/editorial graph, relationships,
and provenance history. Raw personal data is never described as a moat.

North-star metric: **Weekly Completed Fashion Journeys** (two connected
high-intent actions across different prongs in seven days). Raw screen
time is never optimized as the mission.

## 2. Unchanged cores (carried from v1, still highest priority)

- **UI is LOCKED.** No redesign, simplification, or genericization of the
  magazine visual identity. Navigation/flow restructures only after an
  approved information-architecture spec with before/after screenshots.
  > **SUPERSEDED by Amendment A1 (July 21, 2026) — see §10.** The owner
  > unlocked the UI. This paragraph is kept for history, not obeyed.
- **No faking.** No pretend partnerships, fake OAuth, simulated data
  presented as real, invented products/sizes/purchases/celebrity
  looks/runway references, or claimed AI capability that does not exist.
  Unconnected features say so honestly and stay behind kill switches.
- **Working rules.** Inspect first; smallest reversible changes; no
  duplicate routes/stores/components (no second wardrobe, no second
  Asterisk memory, no parallel taste store); no rewrites of working
  domains; `npm run build` and the test suite pass before anything ships.
- **Git.** Never work on `main`. Branch → focused PR → Codex review →
  merge only at the owner's explicit word. Every report: summary, files
  changed, build/test status, remaining issues, manual tests, Codex focus.
  > **PARTLY SUPERSEDED by Amendment A2 (Aug 5, 2026) — see §10.** The
  > Codex-review step is retired; the reviewer is Claude. Everything else
  > in this rule — never work on `main`, branch per change-set, merge only
  > at the owner's explicit word, the report format — still stands.
  > Amendment A3 (Aug 6, 2026) adds a verification step before merging a
  > STACKED PR.
- **Secrets.** Env only; never client-side; `service_role` never in
  bundles; DB runtime as least-privilege `asilum_app`.
- **Stability bar.** Every page loads with no runtime errors; no crash on
  missing keys, empty DB, missing images, or incomplete metadata.

## 3. Allowed scope (phase-gated)

Delivery follows the Restructure Handoff §9. A phase's product surface may
be built only when its predecessor's exit gate passed and its own listed
owner/legal gates are met. One phase = multiple reviewed PRs.

- **Phase 0** — stabilization (findings 1–5) + this Constitution. DONE
  pending this PR's approval.
- **Phase 1** — editorial publishing spine (ADR-004). Drafting is open to
  every account; public publishing requires the §7 gates.
- **Phase 2** — unified Today/Editorial feeds (ADR-005), chronological
  mode from launch, no DMs.
- **Phase 3** — Passport v2 provenance/visibility + Asterisk travel-agent
  drawer and typed tools (ADR-006, ADR-007).
- **Phase 4** — community without DMs: follows, reactions, saves,
  reports, blocks, mutes, notifications; comments only if moderation ops
  are ready.
- **Phase 5** — market scale: canonical product/source-listing split,
  dedup, freshness/cursor search, affiliate attribution, verified
  independent-designer onboarding.
- **Phase 6** — Stylist v2 + creator loop.
- **Phase 7** — DMs and further monetization, only after the owner
  decisions and staffing listed in the handoff exist.

## 4. Blocked (regardless of phase, until the named gate)

- **DMs** — blocked until Phase 7 owner approval + the full safety stack
  (requests, block/report, retention, legal holds, staffing). Never claim
  end-to-end encryption without an audited protocol.
- **Direct checkout / merchant of record** — a separately governed
  company decision. Checkout stays external.
- **Spotify-derived profiling** — blocked by Spotify Developer Policy.
  Manual, user-declared music inspiration through curated first-party
  mapping is the only music path. Never labelled "Spotify connected."
- **Scraping; unapproved platform integrations** — Pinterest, Shopify,
  Apple Music, TikTok, affiliates stay behind kill switches with honest
  unavailable states until real approvals exist.
- **Homegrown CAPTCHA / bot-detection** — bot challenge lives at the edge
  layer (THREAT-MODEL §6), never in app code.
- **Ads from sensitive data; buying interpretation confidence** —
  sponsored placement can never alter Asterisk confidence or editorial
  relevance, and sensitive traits are never ad inputs.
- **Sending accused users' private data to brands; permanent IP bans;
  perceptual similarity as proof** — trust-prong rules from the handoff.

## 5. *ASTERISK doctrine

Asterisk is ASILUM's personal fashion editor and travel agent: one
orchestrator over bounded, typed tools (ADR-007) — never one omnipotent
model with database access. Its laws:

- **Boundary law.** Typed, least-privilege application services only. No
  arbitrary SQL, no `service_role`. Model output may draft or rank; it
  cannot publish knowledge, verify brands, ban accounts, or change
  legal/moderation state. Separated confidence (entity resolution /
  interpretation / evidence coverage / inventory representation /
  ranking) is never averaged into one number.
- **Freshness law.** Trend and cultural-currency layers carry
  `lastReviewed` and a review-by clock enforced in CI
  (`check-trend-freshness`); the review cadence is **at most 60 days**.
  Research batches use dated, citable sources; every record that cites a
  current event, show, or trend carries source and freshness data. New
  entities enter only through the reviewed research pipeline
  (staged fact lifecycle, ≥1 source URL, human sign-off) — never
  directly from model output.
- **Search-accuracy law.** `eval/universal-queries.json` is the accuracy
  benchmark. No search/interpretation PR may regress it; PRs that add
  interpretive capability must extend it with cases that would have
  failed before. Every interpretation states its method and confidence;
  unknown queries fall through honestly to the research queue — a
  fabricated reading is a constitution violation, not a UX improvement.
- **Tagging law.** The typed dense-tag system derives from real item
  fields only. Coverage target: ≥20 typed tags per item **where the
  fields support it** — sparse items stay honestly sparse, never padded.
  The base tag layer is read-only to models; `product_ai_tags` is
  append-only per audit; brand/category/material conflicts at confidence
  ≥0.5 route to moderation. Tag audits sweep on a schedule once a live
  model key exists (owner decision 5).
- **OFF contract.** Asterisk OFF/paused means no Passport or behavioral
  personalization on any surface (search, Discover, home, rails, ads,
  Stylist). Hard filters and the current request still apply; stale
  personalized responses can never overwrite OFF results (guarded in
  code since PR #77); OFF does not erase data — erase/export are
  separate controls.
- **Disclosure.** Conversational surfaces and Privacy/About disclose the
  AI-assisted system (EU-AI-TRANSPARENCY.md); AI-assisted public
  editorial carries labels and human-review state.

## 6. Data doctrine

- Passport is **private by default**; public profile and public Passport
  are different things; purchase history never becomes public
  automatically; publishing any Passport/wardrobe item is an explicit
  per-item action.
- Every signal exposes source, kind (explicit/inferred/imported/global),
  last use, affected surfaces, visibility, retention, and
  edit/disconnect/forget/export/delete controls (ADR-006).
- Never public and never in external-model payloads: raw measurements,
  private images, search history, connected-account tokens, inferred
  sensitivities, precise identity.
- Supabase rules (handoff §6): additive migrations through the repo's
  schema-vN process with runtime version assertion; RLS on exposed
  schemas; server-only by default; ownership predicates in policies
  (`TO authenticated` is not authorization); UPDATE policies carry USING
  + WITH CHECK; private Storage with bounded files and short-lived
  signed URLs; security/performance advisors + negative cross-account
  tests before merge.
- No silent caps: any bounded retrieval (top-N, sampling, candidate
  limits) reports its truncation (`candidatesTruncated` pattern).

## 7. Trust prong — launch dependencies

Before public **publishing**: ToS + community guidelines, content
licence, DMCA agent + operational inbox, copyright/impersonation/
harassment/defamation workflows, corrections + appeals, disclosure UI.
Before public **social**: report flow + taxonomy + appeals, block/mute,
minor/age policy, non-personalized feed, ad-targeting restrictions,
moderation staffing with response targets. Before **Asterisk
conversational/public generation**: AI disclosure, content labelling,
human review for public-interest editorial, vendor data-flow inventory +
kill switches, forbidden-field payload tests. These are gates, not
aspirations — a launch that skips one violates this constitution.

## 8. Owner decisions

Engineering never decides: launch regions; age policy; DMs; wardrobe
visibility default; AI provider/retention; licensed sources; Spotify
path; TikTok; brand-verification staffing; retention periods;
Constitution approvals; merchant of record; creator monetization;
DMCA/counsel workflow (docs/OWNER-DECISIONS.md + handoff §11). Safe
defaults apply while unanswered: nothing ships publicly anywhere.

## 9. PR quality standard

Every PR: objective + user journey; exists-vs-new; schema/API/event
changes; privacy/security/moderation/rights/commercial impact; flag +
rollback; migration/backfill notes; tests with exact results;
screenshots for UI changes; manual test instructions; known limitations;
doc updates; explicit review focus (Codex focus retired by A2 — state what
the reviewer should attack). Required gates: unit/contract
tests, Postgres integration (constraints, concurrency, RLS, Storage),
cross-account negatives, accessibility + browser flows, load/cursor
tests for feeds/search, production build, dependency review, Supabase
advisors after DB changes, no unresolved P1/P2, and **no fake
partnership, connection, purchase, trend, verification, or AI
capability**.

## 10. Amendments (owner-issued, in force)

Each entry is a decision the OWNER made after v2 was written. They were
being carried in session memory only, so this document contradicted the
owner for weeks — §2 still ordered a locked UI the owner had unlocked, and
still routed reviews through Codex after that was retired. A binding
document that outlives its decisions is worse than no document, so
amendments live here from now on. Superseded text above is annotated in
place rather than deleted, so the history stays readable.

**A1 — UI UNLOCKED (July 21, 2026).** Supersedes "UI is LOCKED" in §2.
Full creative redesign is authorized ("full in on ultra creative web
design"). Sequencing mandated by the owner: FIRST streamline systems and
normalize button placement/interactions ("everything more synergized"),
THEN the creative redesign. No-faking, branch+PR, build-must-pass and the
report format are untouched by this.

**A2 — CODEX REVIEW RETIRED (Aug 5, 2026).** Supersedes the "Codex review"
step in §2 Git and "explicit Codex review focus" in §9. Claude reviews its
own work: adversarial verification, declared-criteria batteries, and the
harness laws. Stop posting @codex review comments. Branch + PR + CI green +
merge at the owner's word all still stand.

**A3 — VERIFY A STACKED MERGE (Aug 6, 2026).** Adds a required step to §2
Git. A stacked PR merged with `--delete-branch=false` merges into its BASE
BRANCH, not `main` — and still reports `MERGED`, with nothing in
`gh pr list` showing the difference. GitHub only re-targets a child PR when
its base branch is DELETED, and this project keeps branches (deleting one
auto-closed PR #2 once). Before merging a stack, either retarget each child
to `main` explicitly once its parent lands, or verify afterwards with
`git merge-base --is-ancestor <child-sha> origin/main`. Never trust
`MERGED` on a stacked PR to mean "on main". Cost when learned: recovery
PR #143.

**A4 — HOLDINGS DEFERRED (Aug 7, 2026).** Scope decision, extends §4.
Asked whether a "hold" should be a soft user-owned "keep this for me", an
availability-checked extension of `purchase_tickets`, or deferred, the
owner chose DEFER ENTIRELY: ASILUM controls no inventory, so any hold
implying a purchase guarantee is exactly the fake §2 forbids. No holdings
work starts until a real availability signal exists (eBay keys → ingest).
The bag stays client-side until then. Same decision: sign-in from a second
device MERGES both sides (not account-wins, not ask-the-user), with the
shared-device pollution risk accepted knowingly.

**A5 — THE MARGIN TO ASSUME (Aug 24, 2026).** Extends §5, and narrows it.
The owner's instruction: *"a very small margin for it to assume things."*
Asterisk may infer — it is a recommender and inference is the job — but the
margin between what a person did and what the system says about them is
small, declared, and never compounds.

1. **One floor, one place.** Whether there is enough evidence to describe a
   person at all is ONE number in ONE module (`lib/asterisk/margin.js`,
   `EVIDENCE_FLOOR`). It was the same number typed twice in two files that
   never referenced each other, plus a third that measured something else and
   read like the same rule. A floor in three places is a floor nobody can
   raise.
2. **Abstention is a shippable answer.** Below the floor, Asterisk says it
   does not know yet, in words, on the surface — not only in a payload field.
   Ranking may still fall back to general results; what it may never do is
   present a general result as a personal one.
3. **Bands, not percentages.** No surface prints a confidence percentage.
   `confidenceBand()` is the vocabulary and it already existed for this
   reason — *"a phrase, never a bare percentage pretending to be objective
   truth"* — while two screens printed the percentage it was written to
   prevent. A number carries a precision the evidence does not have.
4. **An inference is not evidence.** The taste halo bleeds a strong signal
   into ADJACENT tags a person never touched. That is legitimate for RANKING —
   it is how a MINIMAL reader is shown an adjacent TAILORED piece instead of a
   wall of the same thing — and it may never be cited back as "your taste",
   nor used as the input to a further inference. Fine to rank with, never to
   cite. A guess drawn from a guess is a claim.
5. **Separated confidence stays separated on screen.** §5 already forbids
   averaging the five confidences into one number; showing exactly one of them
   and calling it "confidence" is the same collapse performed by the UI.

Nothing here loosens the Search-accuracy law: an unknown query still falls
through honestly to the research queue, and a fabricated reading is still a
violation. A5 says the same thing about a PERSON that that law already says
about a QUERY.

**A6 — THE V.2 BLUEPRINT SUPERSEDES (Oct 18, 2026).** The owner's V.2
Blueprint of 17 October 2026 supersedes every older rule in this document,
in docs/OWNER-DECISIONS.md and in the rights register wherever they differ;
where a blueprint clause names a figure, the figure is the law, and where it
names none the owner rules by the word recorded here. Rulings of 18 Oct:
(1) FEES — the passenger fee is $1 + 1.5% of the merchandise on every
purchase through ASILUM, buyer-paid, and supersedes the 1% founders fee with
its 50¢ floor on the ticket lane; the $30 storefront activation applies ONLY
to DROP (a seller releasing at scale); SELL carries no ASILUM fee on the
seller's side and is subject only to the processor's own fees, which ASILUM
does not control. (2) FOLLOWERS are tracked server-side so the friend
asterisk (a mutual follow) can exist; the earlier refusal is lifted.
(3) MUSIC — the manual-only ruling of 2 Oct 2026 (OWNER-DECISIONS §7) is
superseded: Spotify and Apple Music developer access is to be applied for,
last in the build, on the owner's behalf in preparation and by the owner's
hand where a service requires the account holder. (4) |A| is a box with the
letter A in it, nothing more. (5) MOTION limits as declared in slice 9
stand. (6) The BRDCST price list is set by best judgment: profitable, never
so expensive that a small band opts out. (7) Account creation collects the
birth date, the home town and — optional, explained, erasable — ethnicity,
for the Passport's identity anchors; the onboarding questions of 14.11 use
them. The no-faking law, branch + PR, build-must-pass and the report format
are untouched by this.

**A6 addendum — THE LOOK (Oct 18, 2026).** The owner's search-popup
reference picture of 18 October is the primary reference for how the app,
and the search popup in particular, looks: Michroma for headings and names;
the description face — Share Tech Mono, restored from the 1 October build —
for decks, tabs, meta and the search field; Inter for reading paragraphs
and results; an icy white-blue ground with slate ink, blue links and a true
red accent (the asterisk, the active tab, the |A| when on) in light; the
blueprint's dark palette stays. No lines of any kind: no scanlines, no
hairline fields, no grid. Where the 17 October blueprint's "Inter secondary"
differs, this addendum wins (the latest explicit correction beats the
earlier text).

**A6 third addendum — THE DEVICE (Oct 18, 2026, evening).** The owner,
after the slice-14 look: "rainbow refractive reactive liquid glass, cmon …
I want it to look cool"; "pull from the og design language but only some of
it"; "I want the app to feel like a physical device"; "the og passport design
should transfer over 90% accurately"; "I miss the soft gradient of blue to
white and green to black and I miss the dark mode phosphorus glow … add it
back"; "drop the magazine from everything, it's just ASILUM". Rulings:
(1) THE PHOSPHOR GLOW returns in the DARK palette only — a word glows in its
own colour; body text never glows; light keeps none. This narrows the
addendum above ("no glow" in its "no lines of any kind" sense): scanlines,
hairline fields and grids stay retired. (2) THE GROUND is the original
gradient — blue to white in light, green to black in dark. (3) THE DEVICE
LANGUAGE, sparingly: text that loads in from ">>>>>>" when a compacted
description expands; square warning lights that blink and go dark on a
purchase, a bag or an offer; MRZ lines run out in chevrons with a block
cursor. Their red (--warn) is red in both palettes. (4) THE PASSPORT
document follows its 25 July iteration-5 design (7db2b89) at roughly 90%:
the photo slot's fine print lines and the plus registration band are part of
the document, not a CRT. (5) The name is ASILUM — "magazine" is dropped from
every visible string; the domain keeps its current address until it moves.

**Operational note (July 26, 2026), not a rule change.** The device-flow
ritual is retired at the owner's request; a repo-scoped `gh` token is
stored durably in `~/.config/gh/hosts.yml` (chmod 600) with
`gh auth git-credential` as the credential helper. It carries no `workflow`
scope, so `.github/workflows/` cannot be pushed without a re-auth — put
database-backed tests in `tests/postgres-integration.test.js`, which CI
already runs with `TEST_DATABASE_URL`, rather than adding a workflow step.

> Owner: these are transcribed from session records of your own decisions.
> Correct any wording that does not match what you meant — the point is
> that the binding document stops disagreeing with you.
