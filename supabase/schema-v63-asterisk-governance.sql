-- schema-v63-asterisk-governance.sql
--
-- ASTERISK GOVERNANCE (V.2 Blueprint, owner, 17 Oct 2026, Part I; slice 5).
-- ASTERISK runs ASILUM and admins sit above it: every action it takes is
-- logged with its evidence, its confidence and its reasoning; an admin can
-- override any of them and the override stands as ground truth; an admin
-- can pause any function and its new work waits in the admin queue; audits
-- grade each function and a function that fails twice hands its decisions
-- to the queue until it passes. Passengers never see any of this — these
-- tables are read by the admin console and the steward only.
--
--   asterisk_function_state   one row per function: paused or not, by whom,
--                             the standing after the last audit (grade,
--                             consecutive poor grades, handed), and the
--                             admins' settings (high-value thresholds per
--                             category). Upserted; the runtime role may
--                             update it because a pause must take effect in
--                             seconds (lib/asterisk/governance.js).
--   asterisk_actions          APPEND-ONLY. One row per governed decision
--                             (actor 'asterisk') or admin override (actor
--                             'admin', `overrides` naming the row it
--                             supersedes, `ground_truth` true). The decision
--                             JSON is lib/asterisk/governance.js decide()'s
--                             record: evidence, confidence, reasoning, the
--                             split, the cost.
--   asterisk_queue            what reaches an admin: a fraud flag, a
--                             high-value authentication, a dispute, a
--                             conflict, a paused function's work, an audit
--                             sample. Ordered by value, fraud and age when
--                             read; decided in place with the admin's word.
--   replica_patterns          the replica library: a pattern per house that
--                             an admin confirmed. Seeded EMPTY — nothing here
--                             invents a counterfeit signal; every row is an
--                             admin's confirmation (blueprint: "every replica
--                             an admin confirms is added to the library").
--
-- Numbered 63: v61 is the latest applied on the live ledger (read 17 Oct
-- 2026); v62 is reserved by the unpushed the native-storefront branch branch.
--
-- ROLLBACK: DROP TABLE IF EXISTS replica_patterns; DROP TABLE IF EXISTS
--           asterisk_queue; DROP TABLE IF EXISTS asterisk_actions;
--           DROP TABLE IF EXISTS asterisk_function_state;
--           DELETE FROM app_schema_migrations WHERE version = 63;
-- VERIFY:   SELECT function, paused, grade, handed FROM asterisk_function_state;
--           SELECT function, actor, outcome, count(*) FROM asterisk_actions GROUP BY 1,2,3;

CREATE TABLE IF NOT EXISTS asterisk_function_state (
  function         TEXT PRIMARY KEY CHECK (function IN ('tagging','authentication','valuation','sizing','search','exploration','moderation')),
  paused           BOOLEAN NOT NULL DEFAULT false,
  paused_by        TEXT,
  paused_at        TIMESTAMPTZ,
  pause_note       TEXT,
  grade            TEXT NOT NULL DEFAULT 'U' CHECK (grade IN ('A','B','C','D','F','U')),
  consecutive_poor INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_poor >= 0),
  handed           BOOLEAN NOT NULL DEFAULT false,
  audited_at       TIMESTAMPTZ,
  audit            JSONB,
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asterisk_actions (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  function         TEXT NOT NULL CHECK (function IN ('tagging','authentication','valuation','sizing','search','exploration','moderation')),
  kind             TEXT,
  subject_id       TEXT,
  actor            TEXT NOT NULL CHECK (actor IN ('asterisk','admin')),
  outcome          TEXT NOT NULL CHECK (outcome IN ('resolved','safe','queued','overridden')),
  confidence       REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  decision         JSONB NOT NULL,
  overrides        BIGINT REFERENCES asterisk_actions (id),
  ground_truth     BOOLEAN NOT NULL DEFAULT false,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS asterisk_actions_function_at ON asterisk_actions (function, at DESC);
CREATE INDEX IF NOT EXISTS asterisk_actions_subject ON asterisk_actions (subject_id);
CREATE INDEX IF NOT EXISTS asterisk_actions_overrides ON asterisk_actions (overrides) WHERE overrides IS NOT NULL;

CREATE TABLE IF NOT EXISTS asterisk_queue (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  function         TEXT NOT NULL CHECK (function IN ('tagging','authentication','valuation','sizing','search','exploration','moderation')),
  subject_id       TEXT,
  reason           TEXT NOT NULL,
  reasons          JSONB NOT NULL DEFAULT '[]'::jsonb,
  alert            BOOLEAN NOT NULL DEFAULT false,
  fraud            BOOLEAN NOT NULL DEFAULT false,
  value            NUMERIC,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','decided')),
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  decision         JSONB
);
CREATE INDEX IF NOT EXISTS asterisk_queue_open ON asterisk_queue (status, fraud DESC, value DESC NULLS LAST, at ASC);

CREATE TABLE IF NOT EXISTS replica_patterns (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  house            TEXT NOT NULL,
  pattern          TEXT NOT NULL CHECK (length(pattern) BETWEEN 3 AND 200),
  confirmed_by     TEXT NOT NULL,
  note             TEXT
);
-- A house is one house however it is capitalised: the library is read with
-- lower(house) and memory mode matches it case-insensitively, so uniqueness
-- is on (lower(house), pattern). The first version keyed (house, pattern),
-- which let "Scenario House" and "scenario house" hold the same pattern twice
-- in Postgres alone; a database that applied that version drops it here.
-- (A scratch database that already holds such a pair refuses the index with
-- 23505 naming it: merge the pair by hand, keeping the earlier confirmation.
-- Production never applied v63, and CI starts from an empty database.)
ALTER TABLE replica_patterns DROP CONSTRAINT IF EXISTS replica_patterns_house_pattern_key;
CREATE UNIQUE INDEX IF NOT EXISTS replica_patterns_house_pattern_lower_key
  ON replica_patterns (lower(house), pattern);

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asterisk_function_state','asterisk_actions','asterisk_queue','replica_patterns'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
    END LOOP;
  END LOOP;
END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE ON asterisk_function_state TO asilum_app;
  GRANT SELECT, INSERT ON asterisk_actions TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON asterisk_queue TO asilum_app;
  GRANT SELECT, INSERT ON replica_patterns TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE asterisk_actions_id_seq TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE asterisk_queue_id_seq TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE replica_patterns_id_seq TO asilum_app;
  DROP POLICY IF EXISTS asilum_app_server_access ON asterisk_function_state;
  CREATE POLICY asilum_app_server_access ON asterisk_function_state FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON asterisk_actions;
  CREATE POLICY asilum_app_server_access ON asterisk_actions FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON asterisk_queue;
  CREATE POLICY asilum_app_server_access ON asterisk_queue FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON replica_patterns;
  CREATE POLICY asilum_app_server_access ON replica_patterns FOR ALL TO asilum_app USING (true) WITH CHECK (true);
END IF; END $$;

-- The verification ledger (v61) gains the slice's three facts: the fraud
-- flag a replica signal raises, the evidence request that pauses the clock,
-- and the 72-hour deadline a native listing carries. Readers tolerate their
-- absence (lib/db/production/verification.js probes the columns).
ALTER TABLE listing_verifications ADD COLUMN IF NOT EXISTS fraud BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE listing_verifications ADD COLUMN IF NOT EXISTS evidence_request JSONB;
ALTER TABLE listing_verifications ADD COLUMN IF NOT EXISTS resolve_by TIMESTAMPTZ;

INSERT INTO app_schema_migrations (version, name) VALUES (63, 'asterisk-governance')
ON CONFLICT (version) DO NOTHING;
