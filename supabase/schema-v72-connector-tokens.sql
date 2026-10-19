-- schema-v72-connector-tokens.sql
--
-- CONNECTED-ACCOUNT TOKENS (V.2 chapter 4; CONSTITUTION A6 (3); the music
-- seams, last slice). One row per passenger and provider; the tokens are
-- sealed (AES-256-GCM, lib/connectors/tokens.js) with a key derived from
-- DEVICE_COOKIE_SECRET and never stored in clear. Erased with the passenger.
--
-- Numbered 72 after v71 (attendance, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS connector_tokens;
--           DELETE FROM app_schema_migrations WHERE version = 72;
-- VERIFY:   SELECT provider, count(*) FROM connector_tokens GROUP BY 1;

CREATE TABLE IF NOT EXISTS connector_tokens (
  user_id TEXT NOT NULL CHECK (char_length(user_id) BETWEEN 1 AND 80),
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple-music')),
  access_sealed TEXT NOT NULL,
  refresh_sealed TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  provider_user_id TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- RLS on, PUBLIC / anon / authenticated revoked (the browser never reads a token);
-- the server role reads and writes as the owner's app role, as v68 does
DO $$ DECLARE role_name TEXT;
BEGIN
  EXECUTE 'ALTER TABLE connector_tokens ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE connector_tokens FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE connector_tokens FROM %I', role_name); END IF;
  END LOOP;
END $$;
DO $$
BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON connector_tokens TO asilum_app;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connector_tokens' AND policyname = 'asilum_app_server_access') THEN
    CREATE POLICY asilum_app_server_access ON connector_tokens FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  END IF;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (72, 'connector-tokens')
ON CONFLICT (version) DO NOTHING;
