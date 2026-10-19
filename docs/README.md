# ASILUM documentation — start here

This page is the front door. Everything else in `docs/` is either a living
reference (top level), an architecture decision (`adr/`), the V.2 build
record (`v2/`), or history (`history/`).

## 0. The laws

Three rules govern all development. Where `CONSTITUTION.md` disagrees, these
win.

1. **ASTERISK does not guess.** Every reading traces to the ASILUM archive, a
   cited source, or archivalist training. Confidence is earned from evidence,
   never asserted. A reading with no traceable basis is not shipped.
2. **ASTERISK is an operating system, not a chatbot.** There is no
   conversational surface. It reads, routes, ranks, remembers and discloses
   through the product's own surfaces.
3. **Invisible machinery.** A complex system does its work without being asked
   and never names its mechanism. When it is unsure it goes silent rather than
   hedging. The full law: `docs/INVISIBLE-MACHINERY.md`.

## 1. Read these, in this order

| # | Document | Why |
| --- | --- | --- |
| 1 | `docs/CODE-MAP.md` | Where every file lives and what it does. Generated from the tree. |
| 2 | `CONSTITUTION.md` | The binding rules: what may be built, what may not, how changes are made. §10 holds the amendments. |
| 3 | `docs/v2/BLUEPRINT-GAP-2026-10-17.md` | The V.2 blueprint against what is built, row by row. |
| 4 | `docs/PRODUCTION.md`, `docs/DEPLOYMENT.md` | The live system: database, sources, search, deploys. |
| 5 | `docs/adr/` | The decisions that constrain everything else. Read ADR-002 (identity) before touching accounts. |
| 6 | `docs/DEBT-REGISTER.md` | What is not organized yet, measured, with the plan. |

Then, as needed: `docs/OWNER-DECISIONS.md` (product rulings),
`docs/THREAT-MODEL.md`, `docs/RIGHTS-REGISTER.md`, `docs/SOURCE-POLICY.md`,
`docs/AUTHENTICITY-EVIDENCE.md`, `docs/BACKUP-AND-RESTORE.md`.

## 2. What ASILUM is

A fashion marketplace and discovery terminal. One Feed of pieces, posts,
places and echoes; a search that reads sentences rather than keywords; native
storefronts, the Wardrobe and seller payouts on Stripe; direct messages; the
Passport (identity, taste, the map); and ASTERISK, a deterministic reading and
memory layer. Next.js App Router, plain JavaScript, Postgres on Supabase with
an in-memory fallback so the whole app runs with no database.

## 3. Current state (19 October 2026)

| | |
| --- | --- |
| Production | V.2, live at www.asilummagazine.com from `main` |
| Schema | **v72** applied (`app_schema_migrations`); read it before numbering a new migration |
| CI | green on `main` |
| Scheduled jobs | the steward daily at 05:17 UTC; the sweeps (reminders, expiries, payouts) daily at 06:07 UTC — the Hobby plan allows nothing finer |

Re-verify with §4 rather than trusting this block.

## 4. Verify it yourself

```bash
npm test                # the unit suite, no database needed
npm run build           # production build
npm run v2:check        # the V.2 gates, search latency, the feed's chunk laws
npm run deploy:check    # is production serving main?
npm run docs:codemap    # regenerate the code map
npm run steward         # read-only checks against the live database
```

`npm test` does not load `.env.local` (only Next.js does), and must never run
in a shell that sourced it. Database-backed tests live in
`tests/postgres-integration.test.js`, the only file CI runs against Postgres.

## 5. How work is done here

- **Never commit to `main`.** Branch per change-set, open a PR, merge with the
  checks green.
- **Smallest reversible change.** No rewrites, no duplicate routes or
  components, no parallel implementations of something that exists.
- **No faking.** No pretend integrations, no simulated data presented as
  real. An unconnected feature says so.
- **Migrations are append-only.** `supabase/schema-v<N>-*.sql`, applied in
  order with `scripts/apply-schema.mjs`. Never edit a migration that has run.
- **Both backends agree.** Memory mode is what previews and most tests run
  on; any change to one store changes the other, and
  `tests/postgres-integration.test.js` holds the differential.
- **Review adversarially.** Declare a battery's criteria before measuring, and
  check that it fails with the fix reverted.

## 6. History

`docs/history/` holds the dated records — audits, measurement rounds, the V.2
stage write-ups, the launch campaigns. They record what was true and what was
learned on a given day; they are not instructions. The slice-by-slice V.2
build record is `docs/v2/slice-*.md`.

## 7. If you change the shape of the codebase

Regenerate the derived documents in the same PR:

```bash
npm run docs:codemap
npm run audit:nav
```

A map that drifts is worse than no map.
