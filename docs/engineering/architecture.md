# ASILUM architecture rules

_Read before any structural, backend, API, or dependency work on ASILUM — stack boundaries, module ownership, build gates, and where the facts live._

FACTS live in knowledge/architecture/ — read the relevant file first.
This page is the procedure around them.

## Stack (approved; changes need owner approval)
Next.js (App Router) + React 18, plain JS (no TS migration), Supabase
Postgres with full in-memory fallback, no new runtime dependencies
without explicit owner sign-off. This machine has NO system Node — use
`~/.local/node-v20.18.1-darwin-arm64/bin` on PATH for every npm/node call.

## Hard boundaries
- Client-safe modules (lib/client.js, lib/social.js, lib/memory.js,
  lib/vision/palette.js) must NEVER import lib/brain/index.js or lib/db —
  that drags the catalog/pg into the client bundle.
- All persistence goes through lib/db; all product ingestion through
  lib/ingest/normalize.js (THE normalizer — never fabricate missing
  fields; absent is absent).
- /api/interaction actions are exactly: bag|share|save|favorite|dwell|
  skip|hide. Events persist BEFORE derived mutations and fail loud.
- Identity: server-issued device cookie → optional sb- adoption via
  verified bearer. Never trust a client-claimed uid.
- Honesty seams (knowledge/architecture/ai.md): real / gated / never.
  Unkeyed integrations return honest 503/coming-soon.

## Gates
`npm run build` must pass before any feature is declared done. Never
commit to main; branch per change-set; PR for review, never
auto-merge. Report format per CONSTITUTION.md.

## Identity and the two backends

- **Identity.** A signed HttpOnly device cookie (`u-<uuid>`) is the base
  identity; an account (`sb-<auth uuid>`) adopts it on sign-in via
  `adoptAccountData`. Adoption moves BOTH `user_id`-keyed rows and
  `identity_hash`-keyed rows — the corroboration ledgers (edge_contributors,
  popularity_contributors, unknown_query_votes) are the latter, and missing
  them let one person count as two distinct contributors. Any new
  per-identity table is handled in `adoptAccountData` AND
  `purgePersonalizationData`, or deliberately excluded with a comment.
- **The two backends agree.** Memory mode is what preview deploys, local dev
  and nearly every test run on, so a mem/Postgres divergence ships green.
  Changing one backend means changing both, and
  `tests/postgres-integration.test.js` holds the differential that checks it.
- **Database-backed tests live in `tests/postgres-integration.test.js`.** CI
  sets `TEST_DATABASE_URL` only on the step that runs that file, so a suite
  gated on it anywhere else reports `# SKIP` forever and never executes.
- **Client bundles.** `lib/brain/memory.js` and other client-imported modules
  must not import `lib/brain/index.js`, or the catalog lands in the client
  bundle.
- **A true memory-mode preview needs `DATABASE_URL=` set EMPTY**, not unset:
  `next start` loads `.env.local` itself and fills any variable that is
  absent.
- products = items, mood_boards = boards, mood_board_items = board_items,
  saved_products = saved_items.
