-- schema-v56-ebay-feed-publication.sql
--
-- THE EBAY FEED PUBLISHER'S TWO FACTS (owner brief §15, 1 Oct 2026, point 3:
-- "bounded idempotent publication into the existing catalog. Persist
-- checkpoints and source timestamps, prevent older updates overwriting newer
-- records").
--
-- Numbered 56: v54 (Wikipedia register) and v55 (catalog connections) are
-- on other open branches and not yet on main; taking either number here
-- would collide at merge. A gap in the ledger is cheaper than a renumber.
--
-- 1. items gains the two columns that let a feed row say WHEN it was true:
--      source_observed_at — the generation time of the feed file the row came
--                            from (the bootstrap's Last-Modified, a daily
--                            file's date, a snapshot's itemSnapshotDate);
--      source_revision    — eBay's sellerItemRevision, incremented when the
--                            seller edits the listing.
--    The publisher's upsert only writes a row when the incoming observation
--    is NEWER (or the same moment with a revision that is not older) — an old
--    bootstrap re-run after a newer daily file cannot roll a price back.
--    Existing rows carry NULL in both, so the first feed row for them wins,
--    which is the right answer: nothing older than "never observed".
--
-- 2. ebay_feed_checkpoints: one row per staged file (keyed by its sha256 from
--    the stager's manifest). Where the publisher got to, line by line, so a
--    killed run resumes and a finished file re-run is a no-op. The rejection
--    counts are kept BY REASON so a hole in the mapping is visible as a
--    number, not as missing inventory.
--
-- ROLLBACK: ALTER TABLE items DROP COLUMN IF EXISTS source_observed_at,
-- DROP COLUMN IF EXISTS source_revision; DROP TABLE IF EXISTS
-- ebay_feed_checkpoints; DELETE FROM app_schema_migrations WHERE version = 56;
--
-- VERIFY: SELECT count(*) FROM items WHERE source_observed_at IS NOT NULL;
--         SELECT sha256, status, rows_read, rows_upserted FROM ebay_feed_checkpoints;

ALTER TABLE items ADD COLUMN IF NOT EXISTS source_observed_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_revision TEXT;
-- the sync paths read a source's rows by (source_name, source_product_id)
-- already (v2 index); the stale guard reads by id, the primary key.

CREATE TABLE IF NOT EXISTS ebay_feed_checkpoints (
  sha256         TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  category_id    TEXT NOT NULL,
  marketplace    TEXT NOT NULL,
  feed_scope     TEXT NOT NULL,
  feed_date      TEXT,
  observed_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  rows_read      INTEGER NOT NULL DEFAULT 0,
  rows_upserted  INTEGER NOT NULL DEFAULT 0,
  rows_stale     INTEGER NOT NULL DEFAULT 0,
  rows_rejected  JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_line      INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ebay_feed_checkpoints_recent ON ebay_feed_checkpoints (started_at DESC);

-- Row-level security and the runtime role, the v50 way: RLS on, PUBLIC and
-- the Supabase client roles revoked, asilum_app granted through a policy.
DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN FOREACH t IN ARRAY ARRAY['ebay_feed_checkpoints'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
  END LOOP; END LOOP; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE ON ebay_feed_checkpoints TO asilum_app;
  DROP POLICY IF EXISTS asilum_app_server_access ON ebay_feed_checkpoints;
  CREATE POLICY asilum_app_server_access ON ebay_feed_checkpoints FOR ALL TO asilum_app USING (true) WITH CHECK (true);
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (56, 'ebay-feed-publication')
ON CONFLICT (version) DO NOTHING;
