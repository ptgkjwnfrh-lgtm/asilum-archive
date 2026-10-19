-- schema-v29-profiles-recency-index.sql — index the profiles recency scan.
--
-- Audit finding #12 (docs/history/audit-verified-2026-08-14.md). listProfiles runs
--   SELECT user_id, vec FROM profiles ORDER BY updated_at DESC LIMIT 500
-- on every similarUsers call, and no index on profiles.updated_at exists in
-- any migration — so Postgres sorts the WHOLE table to return 500 rows. The
-- table holds 4,132 rows today and only grows; each row carries a JSONB taste
-- vector, so the sort is over wide tuples to produce a 10-entry result.
--
-- Additive + idempotent. Rollback: DROP INDEX IF EXISTS profiles_updated_at_desc;
-- (safe — an index carries no data, and dropping it restores the sort).
--
-- DESC matches the query's own direction. Postgres can scan either way, but
-- declaring it makes the intent legible next to listProfiles.

CREATE INDEX IF NOT EXISTS profiles_updated_at_desc ON profiles (updated_at DESC);

INSERT INTO app_schema_migrations (version,name)
  VALUES (29, 'profiles-recency-index')
  ON CONFLICT (version) DO NOTHING;
