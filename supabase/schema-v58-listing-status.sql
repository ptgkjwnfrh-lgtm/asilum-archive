-- schema-v58-listing-status.sql
--
-- LIKES KNOW WHEN A LISTING SOLD (V.2 brief §5, owner, 1 Oct 2026). Three
-- small tables, each with one job:
--
--   listing_status_events  — a listing's status TRANSITION as observed by a
--                            provider check (available → sold, → removed,
--                            → unavailable). One row per (item, to_status):
--                            a listing sells once, so a retry of the job
--                            cannot record a second sale. The source of the
--                            observation and the provider's own response
--                            status ride along; "sold" is written only from
--                            a provider's confirmed sold signal, never from
--                            a 404 or an outage.
--   notifications          — the OUTBOX. One row per (user, kind, subject):
--                            the person who kept the piece is told once that
--                            it sold, however many times the worker runs.
--                            Delivery is in-app (read_at); sent_at waits for a
--                            push/email channel that does not exist.
--   user_notification_prefs — one row per person; `sold_likes` off means no
--                            outbox row is ever written for them.
--
-- Numbered 58 after v57 (wire composition) on this branch; v54/v55 are
-- on other branches; v56 is the eBay feed publication branch.
--
-- ROLLBACK: DROP TABLE IF EXISTS listing_status_events, notifications,
-- user_notification_prefs; DELETE FROM app_schema_migrations WHERE version = 58;
-- VERIFY: SELECT to_status, count(*) FROM listing_status_events GROUP BY 1;
--         SELECT kind, count(*) FILTER (WHERE read_at IS NULL) FROM notifications GROUP BY 1;

CREATE TABLE IF NOT EXISTS listing_status_events (
  id            BIGSERIAL PRIMARY KEY,
  item_id       TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL CHECK (to_status IN ('available', 'sold', 'ended', 'unavailable', 'removed', 'price_changed', 'unknown')),
  provider      TEXT NOT NULL,
  provider_status INTEGER,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, to_status)
);
CREATE INDEX IF NOT EXISTS listing_status_events_item ON listing_status_events (item_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('liked-sold')),
  subject_id    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  UNIQUE (user_id, kind, subject_id)
);
CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id       TEXT PRIMARY KEY,
  sold_likes    BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN FOREACH t IN ARRAY ARRAY['listing_status_events', 'notifications', 'user_notification_prefs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
  END LOOP; END LOOP; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE ON listing_status_events, notifications, user_notification_prefs TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE listing_status_events_id_seq, notifications_id_seq TO asilum_app;
  DROP POLICY IF EXISTS asilum_app_server_access ON listing_status_events;
  CREATE POLICY asilum_app_server_access ON listing_status_events FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON notifications;
  CREATE POLICY asilum_app_server_access ON notifications FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON user_notification_prefs;
  CREATE POLICY asilum_app_server_access ON user_notification_prefs FOR ALL TO asilum_app USING (true) WITH CHECK (true);
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (58, 'listing-status')
ON CONFLICT (version) DO NOTHING;
