# Production-readiness audit — July 21, 2026

Scope: full read-only audit of the live app (asilummagazine.com) per the
July 2026 hardening handoff ("harden and productionize ASILUM without
redesigning it"). Three independent evidence-gathering passes were run —
security surface, query/storage/realtime efficiency, and junk/bloat
screening — against main at the SEO-foundation merge. Every finding cites
file:line evidence. No code changed during the audit itself.

UI impact of everything proposed here: **none**. Every fix is server,
database, configuration, or repo-hygiene work; no pixel moves.

---

## 1. Baseline and architecture

- **Stack**: Next.js 16.2.10 / React 18.3.1, app router, `next start` (dev)
  and Vercel serverless (prod, iad1). Postgres via `pg` on Supabase
  (transaction pooler 6543 in prod), in-memory fallback when keyless.
  Supabase Auth (magic link + email/password), private Storage bucket
  `wardrobe`. No queues, no cron runner, no SMS/OTP, no third-party AI
  calls active (Anthropic adapter exists, gated off).
- **Trust boundary**: all authority server-side. Anonymous identity =
  signed HttpOnly `asilum-device` cookie (HMAC, constant-time compare);
  account identity = `sb-<uuid>` proven by a Supabase bearer validated
  live via `auth.getUser`. `resolveRequestUser` (lib/identity.js) is the
  single choke point; client-supplied `user` fields are never authority.
  DB runtime role `asilum_app` is least-privilege (no DDL, no BYPASSRLS,
  connection-capped); RLS + anon/authenticated revokes on all ~50 public
  tables with an auto-enable trigger for future tables.
- **Test/CI baseline at audit time**: build clean; suite 164 (163 pass,
  1 gated pg-integration skip); CI green streak intact. No unrelated
  failures observed.
- **Edge**: Vercel WAF — bot-protection challenge, /api rate ceiling
  600/60s/IP, managed DDoS. Canonical host redirect live.

## 2. Findings

### P0 — none found.

### P1 — none in security. Three operational P1s (scale/cost, not exploits):

| id | Finding | Evidence | Fix |
|---|---|---|---|
| EFF-1 | Six discovery routes load the full catalog via `getDiscoverablePool()` → `SELECT * … LIMIT 5000`, then facet/sort/paginate in Node. Fine at 915 items; degrades linearly as live inventory grows, silent at the 5000 cap. | lib/products.js:184-203; app/api/discover/route.js:63-92 | Push facets/sort/pagination into SQL (search already does); surface `truncated`. Trigger: catalog growth, not urgent today. |
| EFF-2 | No retention/TTL on append-only tables: `search_logs`, `user_events`, `ai_model_events`, `interactions`, `learned_facts`. Only `api_rate_limits` (2d) and `processed_operations` (7d) are pruned. Unbounded growth = table/index bloat + storage cost. | lib/security/rateLimit.js:35-39 (the only sweep); lib/db/production.js:449, lib/db/index.js:545 | Extend the hourly sweep with env-configured windows (default off). Retention periods are owner decision #10 (recommended: search_logs 180d). NOTE: `user_events`/`interactions` feed the taste graph — pruning changes recommendations; window needs owner sign-off. |
| EFF-3 | No storage orphan reconciliation for the `wardrobe` bucket. Photo rotation can strand the old object on a failed delete (route 502s, object remains); abandoned anonymous identities' photos have no lifecycle. The code comment promises a sweep that does not exist. | app/api/wardrobe/photo/route.js:104-121; lib/wardrobe/photos.js:10-12,170-203 | Scheduled reconciliation: list bucket, left-join `wardrobe_items.photo_path`, dry-run report first, delete only on explicit approval. Add object-count/orphan metrics. |

### P2 — small hardening PRs, no UI change:

| id | Finding | Evidence | Fix |
|---|---|---|---|
| SEC-1 | `POST /api/editorial` accepts an arbitrary caller-supplied `authorHandle` (spoofable, e.g. "ASILUM") and publishes straight to `moderation_status='visible'` with no sanitize/screen pass — unlike profile rooms, which screen and park at `under_review`. Not stored XSS (React escapes; no `dangerouslySetInnerHTML`). | app/api/editorial/route.js:50; lib/db/production.js:665-696; supabase/schema-v2.sql:180 | Server-derive the handle from verified identity; route through the room sanitize+screen pipeline. |
| SEC-2 | Identity-gated JSON routes lack explicit `Cache-Control: private, no-store` (measurements, orders, tickets, profile, why, asterisk/memory, style-profile, outfits, follow). They are `force-dynamic`, so this is defense-in-depth against a misconfigured intermediary cache, not an active leak. wardrobe + profile/room already do it. | app/api/measurements/route.js:21; app/api/orders/route.js:42; app/api/tickets/route.js:113 | Add the header everywhere identity-gated (mirror wardrobe). |
| SEC-3 | `GET /api/stats` returns aggregate brain metrics (interaction volumes, user/board counts, most-engaged items) unauthenticated. Deidentified, but internal telemetry. | app/api/stats/route.js:17-34 | Gate behind ADMIN_TOKEN or a verified device subject. |
| EFF-4 | `getPopularity()` fetches up to 5000 rows sorted by `eng` on every feed request, uncached (the product pool has a 15s cache; this doesn't). `popularity` has no `eng` index — but it's catalog-bounded and write-hot, so cache the read rather than index the sort. | app/api/feed/route.js:138-141; lib/db/index.js:668-682; schema-v1-brain.sql:30-35 | Cache with the same 15s TTL, or top-N. |
| EFF-5 | Wardrobe photo upload has no idempotency key — a network retry of a succeeded request stores then deletes an extra object (correct final state, wasted round-trips). Moodboard uploads already carry one. | app/api/wardrobe/photo/route.js:80; lib/wardrobe/photos.js:47,135; contrast lib/db/production.js:759 | Accept a client idempotency key like moodboard's. |
| JUNK-1 | Eight never-imported placeholder modules (~32KB source): lib/ai/search-adapter.js + seven contract/registry/facade `index.js` files (background-jobs, connectors, feed, mock-data, music-mapping, recommendations, visual-personalization). Not in the client bundle (nothing imports them) — repo clarity only. They are deliberate architecture seams under the no-fake-integrations rule. | grep: zero import sites each | Owner call: keep as scaffolding (recommended — they document intent) or prune. |
| JUNK-2 | MOCK_USERS/DEMO_SOCIAL fixture literals ship in the client bundle even when disabled in prod (lib/social.js is client-imported; the gate empties the arrays at runtime, not at build). Low value: trim via build-time gating if bundle size ever matters. | lib/social.js | Optional. |

### Future / informational:

- RL-1: fixed-window rate limiter allows 2× burst at window edges — acceptable for current budgets (lib/security/rateLimit.js:21).
- Non-prod device-secret fallback is per-process random — fails closed in prod; only matters for multi-instance non-prod (lib/identity.js:5-10).
- Sharding/consistent hashing: **do not implement**. No capacity pressure. Provider-native scaling + EFF-1 SQL push-down covers the visible horizon.
- `popularity.eng` index: revisit only if feed latency shows sort cost after EFF-4.

## 3. What is definitively healthy (verified, with evidence)

- **Auth/session**: live bearer validation rejects expired/revoked/logged-out tokens; adoption is self-only (403 otherwise); logout reverts to device identity cleanly.
- **IDOR/BOLA**: all 34 API routes derive the actor from verified identity; every object-by-id mutation carries an ownership check (tickets, boards, stylist, wardrobe, outfits, rooms). None missing.
- **RLS/service-role**: 49 RLS enables + auto-enable trigger + default-privilege revokes; service-role key used server-side only (lib/wardrobe/photos.js) — not reachable from any client bundle.
- **Secrets**: `.env*` gitignored (only `.env.example` tracked); no secret-shaped values in tracked files; no JWT/key material in client code.
- **Rate limiting**: DB-backed distributed limiter on every mutating/expensive route, per-subject quotas + global anonymous-flood budgets + identity-issuance throttle; subjects SHA-256 hashed.
- **Connections/realtime**: single memoized pg pool; every onAuthStateChange/timer/observer/listener has a matching cleanup — no leaks found in 13 files checked.
- **Query hygiene**: search path is indexed and truncation-reporting; feed parallelizes its fetches; no N+1 found; index coverage verified adequate on all six high-traffic tables.
- **Storage deletes**: item/photo/privacy deletion erase Storage first and fail loud on incomplete erasure.
- **Dependencies**: 6 runtime deps, all used; zero unused. No committed build output, zips, or backups; largest tracked files are legitimate server-side data (catalog.json 448K, culture.research.json 428K — neither ships to the browser).
- **Repo hygiene (performed with this audit)**: 58 fully-merged local branches deleted; `day32/research-batch-32-wip` verified content-identical on main (362/362 records) and deleted. Kept for owner review: `day7/agents-md` (AGENTS.md never landed — old PR #11), `day13/event-integrity` (superseded by #18/#19 but has unique commits), `agent/harden-identity-ingestion-db` (historical branch).

## 4. Dependency-ordered implementation plan

1. **PR-A "P2 security trio"** (small, immediate): SEC-1 editorial handle + screening pipeline; SEC-2 private cache headers; SEC-3 gate /api/stats. Independent of everything else.
2. **PR-B "retention sweep"** (needs owner decision #10 for windows): extend the existing hourly cleanup with env-gated windows for search_logs / ai_model_events first (no recommendation impact), user_events / interactions only with owner sign-off. Ships off-by-default.
3. **PR-C "storage reconciliation"**: dry-run orphan report as an admin action + metrics; destructive pass gated on explicit approval. EFF-5 idempotency key rides along.
4. **PR-D "feed read cache"**: EFF-4 popularity cache (tiny, isolated).
5. **Deferred until catalog growth**: EFF-1 SQL push-down for discover faceting (design against the search-path precedent when triggered).
6. **Owner calls, no code yet**: JUNK-1 placeholder modules; retention windows; the three kept branches.

## 5. Assumptions and open questions

- Live inventory stays near catalog scale (915) short-term → EFF-1 deferred.
- Retention windows are owner decision #10 (OWNER-DECISIONS.md); the draft there recommends search_logs 180d.
- A cloud environment held the old owner credential; both DB passwords were rotated July 21 (owner + asilum_app) — if that cloud environment should retain DB access, it needs new values from the owner's side; otherwise nothing to do.
- SMTP: Supabase built-in mailer is rate-limited to a few emails/hour — custom SMTP (Resend) is being wired; until it lands, signup confirmations and magic links throttle. Tracked outside this audit.

## 6. Requirement status vs the handoff prompt

| Handoff requirement | Status |
|---|---|
| DB/object-level authorization, RLS, IDOR | **Present** (verified; no gaps) |
| Session/logout correctness | **Present** (server-side rejection verified) |
| Secrets & transport | **Present** (gitignore verified; HSTS/CSP/secure cookies live) |
| Input validation & AI safety | **Present** (readJsonRequest/validate.js; model paths gated off; model output validated when enabled) |
| Abuse/paid-endpoint controls | **Present** (distributed limiter everywhere + global budgets + WAF) |
| Query audit | **Present with P1 scale caveat** (EFF-1) |
| Realtime/connection hygiene | **Present** (no leaks) |
| Storage lifecycle | **Partial** — deletes loud (present); orphan reconciliation **Absent** (EFF-3) |
| Background work/resilience | **Partial** — no job runner exists by design; the two request-path sweeps have budgets; retention **Absent** (EFF-2) |
| SMS/OTP | **Absent by design** — feature does not exist; nothing added (per prompt). |
| Observability/alerts | **Partial** — Vercel logs/WAF metrics; no structured cost/growth alarms yet (fold into PR-B/C metrics) |
| Sharding | **Future — explicitly not implemented** (no pressure) |
