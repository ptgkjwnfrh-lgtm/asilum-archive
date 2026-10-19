# ADR-003: Migration tooling — keep versioned schema files + runtime assertion; adopt CLI only with owner sign-off

- Status: PROPOSED (Phase 0) — CONTRADICTION FLAG for the owner
- Date: 2026-07-15

## Context

The handoff (§5.1) mandates Supabase CLI sequential migrations. The repo's
actual, working convention — built and enforced across schema v1–v12 —
is: sequential idempotent `supabase/schema-vN-*.sql` files, applied via
`scripts/apply-schema.mjs`, recorded in `app_schema_migrations`, enforced
at runtime by `verifySchema` (REQUIRED_SCHEMA_VERSION, currently 12,
fail-closed), with least-privilege `asilum_app` grants updated per
migration. CI and the pg-integration test assert this machinery. There is
no `supabase/migrations/` directory and no CLI state.

## Decision (proposed)

Keep the existing convention for now, upgraded with the handoff's
verification demands:

- every new migration file MUST ship with: verification SQL, rollback /
  forward-fix notes, index review, RLS negative tests, and
  `EXPLAIN (ANALYZE, BUFFERS)` notes for its critical query shapes;
- never modify an applied schema file (already the rule; restated as
  policy);
- bump `REQUIRED_SCHEMA_VERSION` + `asilum_app` grants in the same PR.

Adopting the Supabase CLI is a REAL option (advisors integration, diff
tooling) but is a migration-of-the-migration-system: it needs a baseline
squash and CI changes, and every branch that authors migrations has to
move with it. That switch, if wanted, is its own Phase 0/1 PR after an
owner decision — not a silent side effect.

## Consequences

- No tooling churn mid-roadmap; the fail-closed runtime assertion (which
  the CLI does not provide) is preserved.
- The handoff's per-migration quality gates apply immediately regardless
  of tooling.

## Alternatives

- Immediate CLI adoption: cleaner long-term, but breaks the convention
  every branch actively uses and adds risk exactly when schema volume increases.
