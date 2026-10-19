# ASILUM — instructions for coding agents

You are working on ASILUM, a fashion marketplace/search platform with a
learning recommendation brain. **Before doing anything, read
`CONSTITUTION.md` — including §10 Amendments**, which is where owner
decisions that supersede earlier rules live. `docs/PRODUCTION.md` maps the
production system (database, source adapters, search engine, tickets).

This file is a pointer, not a second source of truth. Where it disagrees with
the constitution, the constitution wins — and if you find it stale, fix it in
the same PR as the work that revealed the staleness. It sat a month out of
date once, telling agents the UI was locked after the owner had unlocked it.

## Hard rules (from the constitution)

- **The UI is UNLOCKED** (Amendment A1, July 21 2026). Full creative redesign
  is authorized. The owner's sequencing is binding: FIRST streamline systems
  and normalize button placement/interactions, THEN redesign. This reverses
  the older "UI is LOCKED" rule you may still see quoted in §2 — that
  paragraph is annotated as superseded and kept only for history.
- **Never commit or push to `main`.** Branch per change-set; merge only at
  the owner's explicit word. PRs may stack — and a stacked PR merged with
  `--delete-branch=false` merges into its BASE, not `main`, while still
  reporting `MERGED` (Amendment A3). Verify with
  `git merge-base --is-ancestor <sha> origin/main` before believing it.
- **You are the reviewer** (Amendment A2, Aug 5 2026). The Codex-review step
  is retired; do not post @codex comments. Review your own work adversarially:
  declare criteria before measuring, and check that a battery FAILS with the
  fix reverted — a test that cannot detect its own bug is decoration.
- **No fake integrations.** No pretend partnerships (SSENSE/Grailed/Depop/
  Farfetch…), no fake OAuth, no simulated data presented as real, no scraping
  (lib/ingest/sources.js blocklists those hosts). Features without real access
  are disabled and say so (`soon` class, `disabledAdapter()`).
- **No fake AI.** Placeholders return through lib/ai/contract.js
  (notImplemented/mockMarked/real). No paid AI API calls.
- **Secrets via env vars only** (`.env.example` is the catalog). Never
  hardcode keys, never expose server keys client-side, never store card data
  or external-site passwords. Never run `npm test` in a shell that sourced
  `.env.local`.
- `npm run build` and the test suite must pass before any PR. Every page must
  load with no runtime errors on an empty database and with no env vars set.

## Architecture pointers

- Persistence: lib/db/index.js (brain tables) + lib/db/production.js
  (production tables) — Postgres via `DATABASE_URL` (Supabase), in-memory
  fallback otherwise. Migrations are `supabase/schema-v*.sql`, applied with
  `scripts/apply-schema.mjs`; live schema is **v61** (READ
  `app_schema_migrations` on the live database before numbering a migration);
  `schema-v62`–`schema-v72` (the native storefront, ASTERISK governance, native
  commerce, after the sale, BRDCST, the media worker, identity, the Passport,
  money, attendance, the music tokens) are STAGED on `v2/build`, not applied,
  and `schema-alpha.sql` is still STAGED, not applied. Read
  `.claude/skills/database-safety` before touching schema or production rows.
- **The two backends must agree.** mem mode is what preview deploys, local
  dev, and nearly every test run on, so a mem/pg divergence ships green.
  Round A found four adoption bugs and three were exactly this. Changing one
  backend means changing both, and
  `tests/postgres-integration.test.js` holds the differential that checks it.
- **Database-backed tests must live in `tests/postgres-integration.test.js`.**
  CI sets `TEST_DATABASE_URL` only on the step that runs that file, so a
  suite gated on it anywhere else reports `# SKIP` forever and never executes.
  The stored `gh` token has no `workflow` scope, so `.github/workflows/`
  cannot be edited without a re-auth.
- products = items, mood_boards = boards, mood_board_items = board_items,
  saved_products = saved_items.
- Recommendation brain: lib/brain/ (the "Alpha Learning Bridge" — extend,
  never replace); six weighted bridges, three feed zones. Search engine:
  lib/search/. Source adapters: lib/ingest/adapters/. Purchase tickets:
  consent-gated, ASILUM never fulfills orders. Holdings are DEFERRED
  (Amendment A4).
- **Identity.** A signed HttpOnly device cookie (`u-<uuid>`) is the base
  identity; an account (`sb-<auth uuid>`) adopts it on sign-in via
  `adoptAccountData`. Adoption moves BOTH `user_id`-keyed rows and
  `identity_hash`-keyed rows — the corroboration ledgers (edge_contributors,
  popularity_contributors, unknown_query_votes) are the latter, and missing
  them let one human count as two distinct contributors. Any new per-identity
  table must be handled in `adoptAccountData` AND
  `purgePersonalizationData`, or deliberately excluded with a comment.
- lib/brain/memory.js and other client-imported modules must NOT import
  brain/index.js or the catalog lands in the client bundle.
- **A true memory-mode preview needs `DATABASE_URL=` set EMPTY**, not unset:
  `next start` loads `.env.local` itself and fills any variable that is
  absent, so `env -u DATABASE_URL` still runs on the live database. The
  `asilum-v2-mem` launch config (port 3482) does it right; the older
  `asilum-memmode-verify` configs do not.

## Measurement discipline

The `scripts/measure-*.mjs` batteries are gates, not dashboards. Declare the
criteria before running, and **never loosen a criterion to turn its own
failure green** — if a metric has no power, shrink the claim instead. When an
instrument gets sharper, re-check whether the old pass was real: a battery
whose central arm matched zero subjects was not passing.

## V.2 gates

`npm run v2:check` runs the composed V.2 gates (`scripts/measure-v2-gates.mjs`),
the search latency gate and the feed chunk laws. Thresholds are declared in
the scripts before the run; a red gate is a red gate. `docs/v2/` holds the
contracts, the fixtures (regenerate with `node scripts/v2-fixtures.mjs`) and
both agents' status files.

## Review focus

Prioritize: correctness of ranking/status-transition logic, RLS/auth
boundaries, honest failure modes (nothing crashing without keys/db),
constitution compliance (especially no-faking), mem/pg parity, and
duplicate/parallel implementations that should reuse existing modules.
