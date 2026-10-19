-- supabase/schema-v28-wire-engagement.sql
-- LIKES + SAVES on transmissions (owner directive, 14 Aug 2026
-- backlog 2). The handover's law: "person-deduped counters in the
-- popularity style (engagers, not events). NO fabricated numbers, ever."
--
-- One row per (transmission, person, kind). The primary key IS the
-- dedupe: liking twice, from ten tabs, or in a loop writes ONE row and
-- therefore counts ONE person — the v22/v23 anti-manipulation law
-- (repetition buys nothing; only another human moves a counter).
--
-- The person is identified by identity_hash = sha256(uid), the
-- unknown_query_votes / edge_contributors / popularity_contributors
-- precedent: pseudonymous in the table, still personal data, so it is
-- reached by BOTH movers of identity — purgePersonalizationData deletes
-- it and adoptAccountData rekeys it (device hash → account hash,
-- ON CONFLICT DO NOTHING so one signed-in human never counts twice).
-- That is the identity-coverage law: a new per-identity table joins both
-- functions or is deliberately excluded with a reason.
--
-- NO denormalized counter column exists on purpose. popularity carries
-- materialized counts because it ranks the whole catalog; the wire reads
-- at most a page of transmissions, so the counts are computed on read
-- and CANNOT drift from the ledger. A count that can disagree with its
-- evidence is exactly the fabricated number the constitution forbids.
--
-- ON DELETE CASCADE: the author's own delete is SOFT (the transmission
-- keeps its engagements, and its record), but the privacy purge HARD
-- deletes editorial_posts — when a person erases their account, the
-- likes on their transmissions must go with them, not dangle.
--
-- Rollback: DROP TABLE transmission_engagements;

CREATE TABLE IF NOT EXISTS transmission_engagements (
  post_id BIGINT NOT NULL REFERENCES editorial_posts(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL CHECK (char_length(identity_hash) = 64),
  kind TEXT NOT NULL CHECK (kind IN ('like','save')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, identity_hash, kind)
);

-- The floor's read: counts per transmission, and a viewer's own state.
CREATE INDEX IF NOT EXISTS transmission_engagements_post
  ON transmission_engagements (post_id, kind);
-- Purge and adoption both sweep by identity.
CREATE INDEX IF NOT EXISTS transmission_engagements_identity
  ON transmission_engagements (identity_hash);

ALTER TABLE transmission_engagements ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE transmission_engagements FROM PUBLIC;

-- anon/authenticated exist on Supabase, not on plain CI Postgres — guard.
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE transmission_engagements FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='asilum_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE transmission_engagements TO asilum_app;
    DROP POLICY IF EXISTS asilum_app_server_access ON transmission_engagements;
    CREATE POLICY asilum_app_server_access ON transmission_engagements
      FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO app_schema_migrations (version,name)
  VALUES (28, 'wire-engagement')
  ON CONFLICT (version) DO NOTHING;
