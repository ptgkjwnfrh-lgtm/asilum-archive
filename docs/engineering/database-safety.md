# Database safety

_Read before touching Supabase schema, credentials, migrations, or any destructive data operation on ASILUM._

- Inspect before editing: read supabase/schema.sql + schema-v2.sql and
  the live shape (psql \d via DATABASE_URL) before proposing changes.
- Migrations are staged .sql files in supabase/, applied via
  scripts/apply-schema.mjs — idempotent, reversible, with rollback
  stated in the PR. schema-alpha.sql stays STAGED until owner decision.
- Transactions for multi-write invariants (see
  createMoodBoardUploadWithEvent pattern: event + record atomically).
- NEVER delete or overwrite production rows without explicit owner
  approval at the time. Test rows get deleted immediately
  after verification.
- RLS stays ON. Server bypasses as owner via DATABASE_URL only.
- Secrets: never through the chat transcript or JS eval — dashboard
  Copy → pbpaste → file. A secret that touches the transcript is
  considered burned: re-rotate. After ANY credential change verify
  /api/stats → persistent:true (a malformed paste once caused a 15-min
  outage; "Ready" on the host means nothing).
- Duplicate external products are a defect: source + source_product_id
  is the uniqueness key at ingestion.
