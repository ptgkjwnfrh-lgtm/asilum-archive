# ⚖ EPN terms check — 22 August 2026

**Not legal advice.** This is a research brief that reads the published eBay
Partner Network terms and narrows what counsel has to answer. Every finding
below is checkable against the two sources named at the end; where the text is
ambiguous this file says so instead of resolving it.

## What was asked

From `hotlist-program-spec-2026-08-20.md`, the ⚖ row: *verify terms before
combining the customer fee with affiliate links on the same click; per-source
fallback (eBay pieces: affiliate only OR fee only).*

The worry was that charging a buyer a 1% founders fee on the same click that
sends them to eBay through an affiliate link is an "incentivized traffic"
model EPN restricts.

## Answer to the question as asked: that is not the sharp edge

Nothing in the Network Agreement prohibits a publisher from charging its own
users. Searching the full agreement text (~74k characters) for `charge` and
`fee` returns only EPN's own currency-conversion and banking fees. `paywall`,
`incentive` and `reward` do not appear in the agreement body at all.

The Special Business Models list — the seven methods needing prior written
approval — is: messaging (email/IM/chat/text), loyalty & incentive programs,
installable software, mobile apps, sub-affiliate networks, PLA / paid traffic,
and AI tools. **Charging end users is not on it.**

**Loyalty / Incentive probably does not apply, but check one detail.** That
category is about *offering a reward or incentive* for a qualifying
transaction. ASILUM's fee is the inverse — the user pays rather than receives.
The one wrinkle worth counsel's eye is the **dead-listing auto-refund**: a
refund contingent on what happens at the source could be read as consideration
flowing back to the user around a qualifying transaction. Weak, but cheap
to ask about.

## The real finding: the default is approval, not permission

The agreement's catch-all inverts the question. Unless a promotional method is
expressly permitted by the Participation Requirements, it is *"subject to EPN's
prior written approval"*, revocable at EPN's sole discretion.

So the useful question is not "is the fee forbidden?" — it is "is the terminal's
promotional method approved?" Those are different tasks, and only the second
one is answerable by EPN rather than by reading.

## The bigger finding, which nobody was looking for

The agreement carries a **Prohibited AI Uses** section, and it collides with
ASILUM's own architecture far harder than the fee ever did. Paraphrasing:

1. A partner may not use eBay Data to train, fine-tune, adapt, benchmark,
   validate **or otherwise improve in any way** a machine-based system that
   infers from its input how to generate outputs such as predictions, content,
   **recommendations**, or decisions.
2. A partner may not input or expose eBay Data to any foundation model, LLM, or
   generative AI service **except with eBay's prior written approval**, and
   then only under a contract with the AI provider that forbids training and
   retention, segregates the data, prevents persistence in model weights, and
   requires prompt deletion.
3. EPN has an audit right over the partner's sites and activities.

Point 1 has no approval carve-out on its face. Point 2 does, but the conditions
are contractual obligations on the *AI provider*, not on ASILUM.

**Why this bites here, concretely:**

- `lib/ingest/ebay.js:8` states the eBay path is the *same pipeline as seed
  items: `inferTags()` for the brain vector*. So ingested eBay items feed the
  six-bridge brain — a system whose entire purpose is generating
  recommendations. That is the shape point 1 describes.
- `EMBEDDINGS_PROVIDER=voyage` is configured with a live key. If embeddings are
  ever computed over catalog items, eBay-derived text reaches a third-party AI
  service. That is the shape point 2 describes.

**This is dormant today, and that is the only reason it is not already a
problem.** `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` are unset, so
`lib/ingest/ebay.js:30` throws and the adapter never runs. Nothing eBay-derived
is in the catalog, the brain, or any embedding.

**One caveat, stated because it matters:** this section's wording slips between
"Partner" and "Supplier", which reads like vendor-agreement language folded
into the affiliate terms. Whether it binds an affiliate publisher at all is a
real question, and it is counsel's, not mine.

## Two more clauses worth knowing

- **Cookie stuffing / affirmative action.** Tracking may only be dropped on an
  affirmative user interaction with the promotional content. The referral click
  must be a genuine user action, not a side effect of rendering a piece.
- **Last-click attribution.** EPN pays the affiliate whose qualifying event
  *last* preceded the transaction. The fee-first flow deliberately inserts a
  Stripe checkout between the click and the purchase; if the buyer wanders and
  arrives at eBay by another route, attribution is lost. That is a *commercial*
  risk to the affiliate half, not a terms violation — but it argues the same
  way the per-source fallback did, for a different reason.

## What this changes

The spec's proposed mitigation — *eBay pieces: affiliate only OR fee only* —
was aimed at a restriction this brief could not find. The fee and the affiliate
link do not appear to conflict.

The gate that does exist sits earlier: **eBay ingest cannot be switched on until
the Prohibited AI Uses question is resolved**, because switching it on routes
eBay Data into a recommender by design. That is a ruling, and rulings are the
owner's; this file does not make it.

## Questions for counsel

1. Does the Prohibited AI Uses section bind an affiliate publisher, given the
   Partner/Supplier drafting?
2. If it does, does a deterministic tag-and-graph recommender count as the
   machine-based system described, or is that aimed at learned models?
3. Does catalog data *derived from* an eBay listing (inferred tags, a price
   band) remain "eBay Data" once normalized?
4. Is the dead-listing auto-refund an "incentive" for SBM purposes?
5. Should ASILUM simply file for approval of its promotional method, given the
   default-approval posture — and if so, under which category?

## Sources

- eBay Partner Network — Network Agreement: https://partnernetwork.ebay.com/legal
- eBay Partner Network — Special Business Models: https://partnernetwork.ebay.com/sbm

Both read 22 August 2026. EPN revises these without notice; re-read before
acting on anything here.
