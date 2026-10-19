# ASILUM operating costs and verification

Planning date: September 17, 2026. USD before tax. Code audit based on
`734e105e5ff048c1d2babf9da49c855fcd9e14cb`.

This is a target budget, not a statement of current invoices. Production
usage, provider plans, source licensing costs and staffing have not been
measured. No subscription or paid AI setting was changed for this work.

## Owner's current verification policy

The owner revised the policy during this cost review:

- Every piece receives parent/source website verification and AI research.
- **Only a discrepancy between the source and AI requires an ASILUM
  archivalist.** Human approval is not required for every matching piece.
- **All ASILUM human labor remains TBD.** No wage, review duration, headcount
  or unpaid founder contribution is assumed in the dollar projection.

The third layer is conditional. It is not removed.

| Layer | Work | Completion rule |
| --- | --- | --- |
| Source website | Retain source URL, listing ID, seller, original tags, images or image references, fetch time and source revision. Refresh availability and price from approved access. | Evidence is available and attributable to the source. A seller claim remains a seller claim. |
| AI research | Research the actual piece and asserted facts using cited evidence. Compare normalized source values with independently supported AI findings. Keep AI findings separate from source tags. | Adequately supported agreement can complete automatically. Unknown values, absent evidence, failed research or a disabled model do not count as agreement. |
| ASILUM archivalist | Review a source–AI discrepancy with both values, citations and the relevant listing version. Record the decision, reason, reviewer and time. | The discrepancy remains unresolved until the archivalist resolves or rejects it. |

Normalize equivalent labels, case and units before comparing. Different
spelling of the same canonical tag is not a factual disagreement. A material
disagreement about brand, category, material, color, measurements, season or
other asserted facts is a discrepancy. Do not silently suppress a disagreement
just because the model's confidence is below the current moderation threshold.

Incomplete research stays pending for automated retry or further research.
It is not automatically assigned to a human unless a discrepancy is found.
Do not infer that an absent source field and an unsupported AI value agree.
Matching output alone is insufficient: the evidence must support the claims.

Verification of listing information is not physical garment authentication.
Do not add a blanket authenticity claim or a false human-reviewed label to
items that passed the automated route. This policy describes the verification
outcome; it does not authorize silently removing the existing catalog.

## What the code actually does today

| Existing component | Observed behavior | Gap before the target workflow is operational |
| --- | --- | --- |
| `lib/ingest/adapters/sync.js` | Approved adapters supply items and base tags; color evidence is processed. | Ingestion does not drive a complete source, research and resolution lifecycle. |
| `lib/asterisk/tagAudit.js` | Produces separate AI tags and reconciliation records; can create moderation work for high-confidence conflicts. | The model receives listing context, not an implemented web-research tool. Repeated audits do not reuse an evidence fingerprint. Conflict-only human routing needs complete coverage. |
| `lib/asterisk/research.js`, `facts.js` | Support cited research proposals and approval of learned facts. | These facilities do not establish a universal per-listing verification gate. |
| `lib/ai/adapter.js` | Anthropic Messages integration and hourly call caps exist. Failures and local-rule fallbacks are marked. | No integrated search tool, usage-based dollar ledger, monthly budget, batch processing or evidence cache. A local fallback must not qualify as AI-verified. |
| `lib/provenance.js` | Distinguishes source provenance and seller claims. | Source registration must not be treated as garment authentication. |

The forecast prices the **target** workflow. It does not claim that all pieces
currently receive independent AI research or automatic, evidence-backed approval.

## Cost reductions

1. **Research a listing version once.** Cache successful cited findings against
   source/listing identity, seller, normalized facts, image revisions and the
   research policy/model version. Reuse only while the evidence is current.
   Material changes, stale evidence or a changed policy invalidate the relevant
   result. Preserve history instead of overwriting verified source facts.
2. **Separate freshness from historical research.** Lightweight price and stock
   refreshes should not re-run all historical research on an unchanged piece.
   Share canonical collection references across items, while each listing still
   gets its own source check and comparison.
3. **Send only discrepancies to the archivalist.** Queue one unresolved case
   per listing version and conflicting field set. Deduplicate retries. Keep
   human labor TBD; measure discrepancy volume before choosing staffing.
4. **Use bounded AI research.** Pilot Haiku 4.5 for ordinary checks and a stronger
   model for difficult research. Measure factual agreement against cited
   evidence before enabling automatic completion. Log model, tokens, searches,
   retries and cost per job. Reserve a job's budget before starting; queue work
   when the monthly budget is exhausted. Do not bypass verification or pause
   the entire website as a substitute for an AI-job budget.
5. **Keep the existing stack lean.** Target one Vercel deploying seat and one
   Supabase production project, with included database backups. Reuse existing
   Postgres search and job infrastructure before adding another paid service.
   Review build-machine size, media storage and egress against actual usage.
6. **Pause hidden-tab inbox polling.** This change-set prepares that small
   optimization. The old 45-second timer could schedule up to 80 summary polls
   per hidden tab-hour before browser throttling. The new lifecycle clears the
   timer while hidden, refreshes on return and preserves the visible cadence.
   An in-flight request may finish. Production dollar savings are unmeasured.

Items 1–5 are implementation or configuration work to perform after measuring
the current environment; they are not represented as completed in this PR.
No redundant steward schedule was deleted: the repository describes its two
schedules as resilience. A cheaper bill is not a reason to silently remove that.

## Base operating budget

| Service | Lean monthly amount | Basis |
| --- | ---: | --- |
| Vercel Pro | $20 | One deploying seat and $20 of eligible usage credit. [Pricing](https://vercel.com/pricing). |
| Supabase Pro | $25 | $10 compute credit covers one Micro instance; do not add another $10 for that same instance. [Pricing](https://supabase.com/pricing). |
| Transactional email | $0–$20 | Resend is a priced option, not a confirmed current provider. Free: 3,000/month and 100/day. Pro: $20 for 50,000/month; $0.90 per extra 1,000. [Pricing](https://resend.com/pricing). |
| Domain | $1.67 allowance | $20/year planning assumption, accrued monthly. Actual TLD, renewal price and payment month unknown. |
| Extra backup/monitoring | $5 allowance | Unquoted reserve for extra storage or monitoring. Database backups do not back up uploaded media. |
| Source access and incremental development tools | Unpriced | Model assumes no new recurring charge. Replace with actual contracts and allocated subscriptions. Chat subscriptions do not cover API usage. |
| ASILUM human labor | **TBD** | Excluded from software totals. |

The core hosting/database floor is **$45/month**. The modeled non-AI services
start at **$51.67/month** and move to **$71.67/month** when email needs Pro,
before storage/egress overages. This is conditional on the target configuration.

Vercel introduced an optional [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn)
on September 8, 2026. Its included tier has 1 million requests and 1 TB of
transfer; the next tier adds $20/month. The model assumes this regime and
budgets the needed capacity in advance. Actual account enrollment is unknown.
Large-scale media delivery has eligibility restrictions; do not assume unlimited
video bandwidth. Existing on-demand accounts can have different allowances.

Standard GitHub-hosted Actions runners are free for this public repository.
[GitHub runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Paid runners, extra environments, premium analytics and other add-ons are not
assumed. Taxes, marketing, major feature development, legal work, source licenses
and any future ASILUM payment-processing fees need separate amounts where applicable.

## AI calculation

The editable model uses these assumptions per verification job:

- Primary research: 6,000 total input tokens, 800 total output tokens and two
  searches. Input covers prompts, images, tool overhead and search-result context
  across research rounds; measure the real totals in a pilot.
- An extra pass on 10% of jobs: 8,000 input, 1,000 output and one additional search.
- A 10% retry allowance on both passes. No batch or prompt-cache discount assumed.

[Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
lists Haiku 4.5 at $1/$5 per million input/output tokens and Sonnet 5 at $2/$10.
[Web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
adds $0.01/search, plus the tokens already allowed for above.

The resulting modeled AI cost is **$0.03696 per verification**, or about
**$36.96 per 1,000**. This is a workload estimate, not a quality guarantee or a
measured production cost. Hard cases can require substantially more research.

## Monthly cloud baseline

Illustrative October 2026–September 2027 rollout: 500–6,000 monthly visitors,
100–400 new pieces/month, explicitly entered change/expiry rechecks, and an
initial 500-piece catalog processed in batches of 100 over the first five months.
The 500 is a planning input, not a measured catalog count.

The **10% discrepancy rate is an editable assumption**, independent of the AI
escalation rate. It estimates queue volume and does not assign a human cost.

| Month | Source + AI jobs | Projected human discrepancies | Software + services | Budget with 10% reserve |
| --- | ---: | ---: | ---: | ---: |
| Oct 2026 | 200 | 20 | $59.06 | $64.96 |
| Nov 2026 | 220 | 22 | $59.80 | $65.78 |
| Dec 2026 | 280 | 28 | $62.02 | $68.22 |
| Jan 2027 | 300 | 30 | $62.75 | $69.03 |
| Feb 2027 | 360 | 36 | $64.97 | $71.47 |
| Mar 2027 | 280 | 28 | $82.02 | $90.22 |
| Apr 2027 | 350 | 35 | $84.60 | $93.06 |
| May 2027 | 370 | 37 | $85.34 | $93.88 |
| Jun 2027 | 440 | 44 | $87.93 | $96.72 |
| Jul 2027 | 460 | 46 | $88.67 | $97.54 |
| Aug 2027 | 530 | 53 | $91.56 | $100.71 |
| Sep 2027 | 600 | 60 | $95.34 | $104.88 |
| **12 months** | **4,390** | **439** | **$924.05** | **$1,016.46** |

All human labor is **TBD**, including archivalist work, maintenance, support and
moderation. Therefore the all-in operating total is also **TBD**. Annual figures
use unrounded calculations. The initial catalog's $18.48 of AI cost is included
above and separately identified in the workbook; do not add it twice.

Before treating this as a spending ceiling, replace assumptions with the last
30 days of Vercel/Supabase/email bills and usage, actual catalog change counts,
AI token/search totals, discrepancy rate and media growth. The model retains
separate inputs for authenticated users, cached/uncached egress, disk, storage,
build minutes and other metered charges. It is not a guarantee that the current
production app fits the cheapest configuration.

## Future physical server and database

The owner intends to move to ASILUM-owned hardware eventually. The workbook's
**Ownership** sheet adds a 24-month projection with cloud operation, migration
overlap, a hardware purchase and then self-hosting. The editable timing
assumption is full cutover in month 13 (October 2027), with one month of overlap.
This is a modeling assumption, not a migration date or a hardware order. Year
two holds the selected month-12 workload constant so the hosting comparison
does not invent traffic growth.

Buying a server can replace Vercel's hosting and Supabase's managed service
charges after the complete workloads move and those subscriptions are closed.
Moving only Postgres does not replace authentication, storage, required jobs
or the website. Next.js supports
[self-hosting](https://nextjs.org/docs/app/guides/self-hosting), and Supabase
documents a [self-hosted stack](https://supabase.com/docs/guides/self-hosting).
ASILUM would own upgrades, security, monitoring, backups and recovery. No
migration or subscription cancellation is included in this change-set.

GitHub is already modeled at $0 for this public repository and standard
Actions runners, so the projection claims no new GitHub savings. The repository
can stay there. Owning application hardware does not eliminate the separate AI
API, email, domain, internet, power or off-site backup costs. Local AI hardware
and model operation would be a separate project and are not assumed.

| Ownership input | Illustrative amount | Status |
| --- | ---: | --- |
| Server and primary storage | $900 once | Unquoted allowance |
| UPS and network equipment | $200 once | Unquoted allowance |
| Local backup equipment | $100 once | Unquoted allowance |
| Combined hardware purchase | **$1,200 once** | Does not specify or guarantee capacity |
| Power | $8.76/month | 60 W average × 730 hours × $0.20/kWh; all editable assumptions |
| Extra internet/static IP | $10/month | Unquoted allowance |
| Off-site backup | $10/month | Unquoted allowance |
| Extra paid monitoring/other hosting | $0 assumed | Enter any needed service or colocation quote |
| Equipment replacement reserve | $25/month | $1,200 over 48 months; funds a future purchase |
| Migration and ongoing human labor | **TBD** | Excluded from dollar totals |

At the modeled month-12 workload, owned-server running cash is **$28.76/month**.
Retained AI, email, domain and other services add **$43.84**, giving **$72.60/month**
before reserves and human labor. With the 10% operating contingency and $25
hardware replacement reserve, monthly funding is approximately **$104.86**.
The comparable cloud-only budget is **$104.88**. These rounded, assumption-driven
values do not establish a meaningful monthly saving at this lean scale.

The hardware-only cash payback is about **55 months after cutover**, including
overlap running cost but excluding labor, replacements, financing and taxes.
That is longer than the assumed 48-month replacement period. The calculation
is a planning comparison, not an ROI promise. Cloud costs would need to grow,
hardware cost less, or the operating assumptions improve for a compelling
cost-only move. Ownership can still support the separate goal of control over
ASILUM's infrastructure.

The Ownership sheet records the hardware purchase once in the first overlap
month, retains managed charges during overlap and removes them only after
cutover. It shows operating cash, hardware replacement funding and cumulative
cash versus the cloud baseline separately. Human labor stays TBD throughout.
Change the cutover month to 25 to keep all 24 projected months in the cloud.
Before a real move, obtain hardware/connection quotes, measure storage and
peak load, prove backup restoration, test authentication and object storage,
and retain a rollback path during the overlap period.

## Acceptance criteria for the next verification implementation

- Independently evidenced agreement completes without archivalist work.
- A material source–AI difference creates one traceable human case and cannot
  auto-complete, regardless of a confidence-only threshold.
- Missing evidence, model failure, budget exhaustion and local-rule fallback
  stay pending; they never masquerade as agreement or auto-create human work.
- Unchanged valid evidence is reused; changed facts/images or expiry invalidate
  the affected result. Resolved discrepancies retain the reviewer and version.
- Repeated jobs do not duplicate cases or provider calls for an identical,
  already-completed version. Cost is recorded and monthly limits queue new work.
- Tests cover agreement, discrepancy, unknown, failure, expiry, revision change,
  retry deduplication and memory/Postgres parity before any production enablement.
