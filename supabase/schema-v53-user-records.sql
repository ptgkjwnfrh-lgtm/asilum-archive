-- schema-v53-user-records.sql
--
-- THE DEVICE RECORDS BECOME REAL (V.2, 19 Sep 2026).
--
-- Live Launch V.2 kept four kinds of record on the device alone and said so
-- on screen: saves of people / places / events / articles (asilum-saves),
-- the reader's base city and its visibility (asilum-location), corrections
-- to an overview or a place (asilum-corrections) and studio drafts
-- (asilum-studio-drafts). The owner's word for V.2 is "everything real":
-- a record that lives in one browser is not a record. This table holds all
-- four as the SAME JSON the client already writes, keyed by the identity
-- every other per-person table uses, so adoption on sign-in, erasure and
-- export reach them like everything else (docs/engineering/architecture.md § Identity).
--
-- One table, not four. The rows differ in `kind`; the laws (identity,
-- adoption, purge, export, caps) are identical, and four copies of the same
-- law drift — the lib/db split of 6 Sep found exactly that.
--
--   user_records   (user_id, kind, record_id) is the key. `payload` is the
--                  client's record as written; the app caps it at 8 KiB and
--                  never reads instructions out of it. `location` has one
--                  row per person (record_id 'base'); the coordinates in it
--                  are PRIVATE and the route serves them only to their owner.
--
-- Also in this version: user_corrections gains the two columns reason-
-- specific learning needs — `scope` (this item / this session / ongoing) and
-- `undone_at` (an undo is a stamp, not a delete; the row stays as evidence
-- that the correction was made and taken back).
--
-- ROLLBACK: DROP TABLE IF EXISTS user_records; ALTER TABLE user_corrections
-- DROP COLUMN IF EXISTS scope, DROP COLUMN IF EXISTS undone_at;
-- DELETE FROM app_schema_migrations WHERE version = 53;

CREATE TABLE IF NOT EXISTS user_records (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('save', 'location', 'correction', 'draft')),
  record_id   TEXT NOT NULL CHECK (char_length(record_id) BETWEEN 1 AND 160),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, record_id)
);
CREATE INDEX IF NOT EXISTS user_records_user_kind ON user_records (user_id, kind, updated_at DESC);

ALTER TABLE user_corrections ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'ongoing';
ALTER TABLE user_corrections ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_corrections_scope_check') THEN
    ALTER TABLE user_corrections ADD CONSTRAINT user_corrections_scope_check
      CHECK (scope IN ('item', 'session', 'ongoing'));
  END IF;
END $$;

-- Row-level security and the runtime role, the v50 way: RLS on, PUBLIC and
-- the Supabase client roles revoked, asilum_app granted through a policy.
DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN FOREACH t IN ARRAY ARRAY['user_records'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
  END LOOP; END LOOP; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON user_records TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE user_records_id_seq TO asilum_app;
  DROP POLICY IF EXISTS asilum_app_server_access ON user_records;
  CREATE POLICY asilum_app_server_access ON user_records FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  -- undo is an UPDATE of undone_at; the role already holds SELECT/INSERT on user_corrections (v11)
  GRANT UPDATE (undone_at) ON user_corrections TO asilum_app;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (53, 'user-records')
ON CONFLICT (version) DO NOTHING;
