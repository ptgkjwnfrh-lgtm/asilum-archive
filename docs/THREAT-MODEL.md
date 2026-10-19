# Threat Model (Phase 0) — research, uploads, messaging, brand enforcement

Format: threat → existing mitigation (real, in code today) or planned gate.
Scope: the four handoff-named risk surfaces plus the new Phase-1 domains.

## 1. Research / knowledge pipeline

| Threat | Mitigation |
|---|---|
| Poisoned proposal becomes trusted knowledge | Staged lifecycle, no queue-jumping, approval needs named reviewer + sources; compile fail-closed; loader re-validates (cultureSchema) and THROWS on bad records |
| Model output writes to trusted stores | Model path lands `discovered` only (gated `AI_RESEARCH_ENABLED`, currently notImplemented); certainty vocabulary caps (validate.js) |
| SSRF / private-network fetch | exact-host allowlist (default-deny), https-only, no redirects, content-type gate, streaming byte cap (readBytes), safeExternalUrl blocks localhost/private |
| Self-collision / compile corruption | selfFactId idempotency + refuse-partial-output compile |
| Adversarial query triggers auto-learning | Phase 1: unknown-query recording is flag-gated, bounded, deduped, demand-thresholded; promotion is an ADMIN action into the reviewed pipeline — never automatic |
| Fact laundering via payload/entity mismatch | payload.name must equal fact.entityId; provenance + factId required on compiled records |

## 2. Uploads (moodboard today; wardrobe/profile media in Phase 3/5)

| Threat | Mitigation |
|---|---|
| Client-supplied labels poison taste | server derives palette from raw swatches; labels never trusted; atomic 400s |
| Duplicate/replay writes | uploadId required, per-user idempotency, txn event+record |
| Oversized/malformed payloads | strict shape validation, byte-capped payloads (8 KiB facts), readJsonRequest limits, rate limits |
| PLANNED (image bytes, Phase 3): EXIF/location leakage, decompression bombs, hostile SVG, malware, cross-user reads | private owner-scoped bucket + content-sniffed type checks + dimension/decompression limits + metadata strip + short-lived signed URLs + no face/biometric processing — exit-gate tests specified in handoff §Phase 3 |

## 3. Messaging (Feature F — NOT BUILT, blocked on owner decisions)

Pre-committed invariants for whenever it is approved: authenticated
account_id only (ADR-002); message requests; block/mute/report; no delivery
after effective block (concurrency-tested); per-user+per-recipient rate
limits; retention/deletion + legal hold; moderator access logged and
purpose-limited; no E2E-encryption claims without an audited protocol.
Threats (spam, harassment, block races, forged conversation ids, deleted
accounts, attachment abuse) each map to a required pre-launch test in the
handoff — none are mitigated today because the surface does not exist,
which is itself the mitigation.

## 4. Brand enforcement (Feature G — NOT BUILT, blocked on Shopify approval)

Pre-committed invariants: OAuth state/HMAC/webhook signature verification;
tokens encrypted at rest, never client-visible; perceptual similarity is a
REVIEW SIGNAL never proof; human review before permanent enforcement;
accused users' private identifiers never shared with brands; appeals +
audit history; no permanent IP bans (IPs weak evidence; hash/truncate,
short retention).

## 5. Phase-1 domains (unknown_queries, interpretation_feedback)

| Threat | Mitigation (built with the feature) |
|---|---|
| Query-log privacy leakage | normalized text only, bounded length/charset, server-only tables (no anon/authenticated grants), DRAFT 180-day retention, flag-gated recording |
| Demand-count inflation (one attacker "voting" a query into research) | one lifetime vote per identity/query + rate limits + enforced distinct-identity threshold + admin-only promotion |
| Feedback poisoning another user's interpretations | feedback rows are per-identity; only influence THAT user's ordering; global change only via reviewed research |
| Reflected XSS via echoed queries | responses JSON-only; UI renders text nodes (React escaping); eval case adv-3 asserts no markup reflection |
| Cross-user reads | RLS-equivalent server-side scoping via resolveRequestUser; adversarial tests in suite (security-boundaries + new tests) |

## 6. Anonymous abuse boundary (Restructure Handoff Phase 0, finding 4)

Three layers, outermost first. Layers 2–3 are BUILT (PR 0A slice 2);
layer 1 is a DEPLOYMENT control that must land with the first public
deploy — it cannot exist meaningfully in app code.

**Layer 1 — edge/WAF (DEPLOYED 2026-07-19, as built):** Vercel Firewall
on the production project: managed DDoS mitigation (platform), Bot
Protection in CHALLENGE mode (non-browser sources challenged; verified
crawlers pass), rate-limit rule `api-rate-ceiling` (`/api/*`, 600
req/60s per IP, 429), custom rule `challenge-identity-issuance`
(`/api/auth`) in LOG mode — a Challenge action there broke the app's own
fetch() bootstrap (interactive challenges cannot be answered by XHR), so
enforcement stays with the app-level issuance throttle; never put a WAF
challenge on an XHR path. Firewall changes apply without redeploy.
Original checklist for reference:

- managed WAF or equivalent edge rules in front of the app (hosting
  platform native, e.g. Vercel WAF / Cloudflare): IP/ASN reputation,
  request-rate rules per IP well above app quotas, bot-score challenge
  on `/api/auth` GET (identity issuance) and search surfaces;
- challenge (managed challenge / turnstile-style) is the correct
  response at the edge; the app deliberately has NO CAPTCHA of its own —
  per the platform constitution, bot-detection bypass and homegrown
  challenges are both out of scope;
- static-asset and page routes stay unchallenged; only mutation and
  expensive read APIs carry edge rules;
- alerting when edge rules fire at sustained volume.

**Layer 2 — identity-issuance throttling (BUILT; REWRITTEN 2026-08-06):**
`/api/auth` GET issues anonymous device identities; issuance (not
verification) is throttled. Every issued identity seeds per-subject
quotas everywhere else, so unthrottled minting would let a flood outrun
every other limit.

*Correction.* This section previously claimed issuance was "throttled per
requesting subject (30/hour)". That posture did not exist in code. The
route returns early for an already-verified cookie, so every request
reaching the limiter had NO cookie by construction and the subject was
the literal constant `unverified-public` — one GLOBAL bucket. Thirty
cookie-less requests from any script locked issuance product-wide for the
rest of the clock hour, and the same lockout occurred with no attacker at
all once 30 genuinely new visitors arrived in an hour.

Three buckets now, in increasing coarseness:

1. **Per-subject** — a trusted edge caller when the deployment declares
   one (`TRUSTED_EDGE_IP_HEADER`, default EMPTY; production Vercel:
   `x-vercel-forwarded-for`), otherwise still the shared constant.
   Default `IDENTITY_ISSUE_SUBJECT_LIMIT` 2000/hour. This is an
   **ISOLATION** control — one caller can no longer exhaust everyone
   else's issuance — and explicitly **NOT a sybil price**: no per-IP
   limit can be both NAT-safe (a carrier NAT fronts 10^4–10^5
   subscribers) and tight enough to price minting. IPv6 is masked to a
   /64 before hashing, because a subscriber holds a whole /64 and keying
   on the full address would hand one customer 2^64 subjects.
2. **Shared public ceiling** — `IDENTITY_ISSUE_PUBLIC_LIMIT` 5000/hour
   for callers with no trusted subject: far above legitimate traffic so
   it can never be what locks out a first visitor.
3. **Hourly global** — `IDENTITY_ISSUE_GLOBAL_HOURLY` 3000/hour, scope
   `identity-issue-global`. **This is the actual aggregate bound.**
   `consumeGlobalBudget` only supports 60-second windows, so
   `GLOBAL_BUDGET_IDENTITY_ISSUE` (300/min) permits 18,000/hour
   sustained; before this ceiling existed the accidental 30/hour bucket
   was the only sustained limit. Lower it against measured new-visitor
   volume; never raise it against a guess.

Issuance fails **OPEN** on limiter INFRASTRUCTURE failure and **CLOSED**
on quota exhaustion (`IDENTITY_ISSUE_FAIL_OPEN=0` restores fail-closed).
Issuance writes nothing — a `randomUUID` and one HMAC — and everything
the identity can subsequently do is separately quota'd per identity, so
an over-issued identity costs ~0 while a denied one costs a real visitor
the product.

**Degradation (2026-08-06):** identity is a preference, not a
precondition. `authorizedFetch` proceeds without an identity instead of
throwing, and `/api/feed` — previously the ONLY read surface that failed
closed — serves an anonymous cold-start feed. An issuance outage now
de-personalizes rather than blanking the product.

*Honest limits.* The per-subject bucket is dead code unless a deployment
names a trusted header: Next.js does NOT sanitize `x-forwarded-for`
(`base-server` uses `??=`, preserving a client value), so an unguarded
read would trust the attacker anywhere that is not behind an overwriting
edge — worse than a shared bucket, since it means one identity per forged
value. Enabling it requires empirically confirming the header cannot be
spoofed on the live deployment. The fail-open counter is per-instance, so
a serverless fleet multiplies it. Env changes require a REDEPLOY on
Vercel; the Firewall rule is the only true no-deploy lever.

**Layer 3 — global cost circuit breakers (BUILT):** each expensive
surface (search, interpret, discover, feed) draws from one global
per-minute budget in addition to per-subject quotas
(`consumeGlobalBudget` in lib/security/rateLimit.js; env-tunable via
`GLOBAL_BUDGET_<SCOPE>`, 0 disables). Exhaustion fails closed with
429 + Retry-After. Budgets are generous multiples of legitimate peak so
real users never see them before an attack does; they bound worst-case
database/compute cost, they do not replace layer 1.

| Threat | Mitigation |
|---|---|
| Anonymous identity flood outrunning per-subject quotas | issuance throttle (L2) + global budgets (L3) + edge challenge (L1) |
| Cost-of-goods attack on expensive queries (search/interpret) | global per-scope budgets fail closed at bounded spend |
| Distributed low-and-slow scraping under every per-IP limit | edge bot scoring (L1); app-level budgets bound aggregate cost |
| Rate-limit table growth as attack surface | subjects hashed; windows cleaned hourly (2-day horizon, existing) |

## Standing assumptions to re-verify each phase

- Migrations come from more than one branch: coordinate schema numbers (v13 next) to
  avoid collisions — check remote before every migration PR.
- `service_role` never in client bundles (grep gate in CI is a candidate).
- All new tables default server-only until a client operation is proven
  necessary (handoff §5 rule 4).
