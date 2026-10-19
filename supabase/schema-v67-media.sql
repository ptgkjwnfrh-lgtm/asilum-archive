-- schema-v67-media.sql
--
-- MOTION: THE MEDIA WORKER's rows (V.2 Blueprint, owner, 17 Oct 2026,
-- chapter 3 "Video playback and persistent music controls", chapter 17.2;
-- slice 9). The law is lib/media/index.js; the worker is lib/media/worker.js.
--
--   motion_assets   one uploaded video: who owns it, where it sits in the
--                   Wire's public bucket, what the worker READ from the
--                   server's copy (container, codec, duration, dimensions,
--                   rotation, audio, fast start, bytes), the state —
--                   pending (signed upload issued) → ready (admitted) |
--                   refused (by name, object deleted) | removed — and the
--                   creator-provided caption tracks (WebVTT text, inline:
--                   a track is small and public with the post).
--   user_records    `kind` gains 'media' — the media preferences, one per
--                   person ('preferences'), adopted and erased with the rest.
--
-- No transcoder exists on this stack: there is ONE rendition per asset, the
-- author's own encoding, and the table has no renditions column on purpose.
--
-- Numbered 67 after v66 (BRDCST, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS motion_assets;
--           ALTER TABLE user_records DROP CONSTRAINT IF EXISTS user_records_kind_check;
--           ALTER TABLE user_records ADD CONSTRAINT user_records_kind_check
--             CHECK (kind IN ('save', 'location', 'correction', 'draft'));
--           DELETE FROM app_schema_migrations WHERE version = 67;
-- VERIFY:   SELECT state, count(*) FROM motion_assets GROUP BY 1;

CREATE TABLE IF NOT EXISTS motion_assets (
  id              UUID PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  path            TEXT NOT NULL UNIQUE,
  container       TEXT NOT NULL CHECK (container IN ('mp4','webm')),
  mime            TEXT NOT NULL,
  declared_bytes  BIGINT NOT NULL CHECK (declared_bytes >= 0),
  bytes           BIGINT,
  duration_ms     INTEGER,
  width           INTEGER,
  height          INTEGER,
  rotation        INTEGER NOT NULL DEFAULT 0,
  codec           TEXT,
  audio           BOOLEAN NOT NULL DEFAULT false,
  fast_start      BOOLEAN,
  poster_path     TEXT,
  captions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','refused','removed')),
  refusal_code    TEXT,
  refusal_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motion_assets_owner_idx ON motion_assets (owner_id, created_at DESC);

ALTER TABLE user_records DROP CONSTRAINT IF EXISTS user_records_kind_check;
ALTER TABLE user_records ADD CONSTRAINT user_records_kind_check
  CHECK (kind IN ('save', 'location', 'correction', 'draft', 'media'));

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['motion_assets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
    END LOOP;
  END LOOP;
END $$;
DO $$
BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE ON motion_assets TO asilum_app;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (67, 'media')
ON CONFLICT (version) DO NOTHING;
