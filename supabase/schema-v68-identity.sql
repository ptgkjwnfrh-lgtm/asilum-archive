-- schema-v68-identity.sql
--
-- IDENTITY FOR COMMERCE AND THE PASSPORT (V.2 Blueprint, owner, 17 Oct 2026:
-- 6.31–6.34, 12.8–12.9, 14.11, Terms 2.2; owner rulings 18 Oct 2026,
-- CONSTITUTION A6 (7); slice 10b). The law is lib/identity/commerce.js;
-- these are its rows.
--
--   account_identity       the home town and — optional, consented, erasable —
--                          the self-described ethnicity an account gave at
--                          creation for the Passport's identity anchors
--                          (14.11). Keyed on the bare auth uuid (ADR-002).
--                          Never public; exported; erased with the person.
--   account_devices        the signed devices an account has adopted (device
--                          authentication for gifts, 5.29 / Terms 10.4): the
--                          HMAC of the device id, never the id itself.
--   verification_appeals   a seller's structured appeal with materially new
--                          evidence against a listing's status (12.9), decided
--                          by a human.
--   notifications.kind     gains verification-downgrade, verification-appeal
--                          and mfa.
--
-- Numbered 68 after v67 (media, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS verification_appeals, account_devices, account_identity;
--           (restore the v66 notifications kind check by hand);
--           DELETE FROM app_schema_migrations WHERE version = 68;
-- VERIFY:   SELECT count(*) FILTER (WHERE ethnicity IS NOT NULL) AS with_ethnicity,
--                  count(*) FILTER (WHERE ethnicity IS NOT NULL AND ethnicity_consented_at IS NULL) AS unconsented
--           FROM account_identity;   -- unconsented must be 0

CREATE TABLE IF NOT EXISTS account_identity (
  account_id              UUID PRIMARY KEY,
  hometown                TEXT CHECK (hometown IS NULL OR char_length(hometown) <= 120),
  hometown_country        TEXT CHECK (hometown_country IS NULL OR char_length(hometown_country) <= 60),
  hometown_lat            DOUBLE PRECISION,
  hometown_lng            DOUBLE PRECISION,
  ethnicity               TEXT CHECK (ethnicity IS NULL OR char_length(ethnicity) <= 80),
  ethnicity_consented_at  TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ethnicity IS NULL OR ethnicity_consented_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS account_devices (
  account_id   UUID NOT NULL,
  device_hash  TEXT NOT NULL CHECK (char_length(device_hash) = 64),
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, device_hash)
);

CREATE TABLE IF NOT EXISTS verification_appeals (
  id          UUID PRIMARY KEY,
  item_id     TEXT NOT NULL,
  seller_id   TEXT NOT NULL,
  evidence    TEXT NOT NULL CHECK (char_length(evidence) BETWEEN 1 AND 2000),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','upheld','refused')),
  decision    TEXT,
  decided_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS verification_appeals_item_idx ON verification_appeals (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_appeals_open_idx ON verification_appeals (state) WHERE state = 'open';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('liked-sold', 'dm-cleared', 'profile-shared', 'wardrobe-gift',
                  'offer-new', 'offer-counter', 'offer-accepted', 'offer-declined', 'offer-expiring', 'offer-invalidated',
                  'discount', 'queue-available', 'queue-sold', 'queue-returned',
                  'delivered', 'return-opened', 'return-decided', 'review-published', 'penalty', 'credit',
                  'brdcst-payment', 'brdcst-started', 'brdcst-ended', 'brdcst-refund',
                  'verification-downgrade', 'verification-appeal', 'mfa'));

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_identity','account_devices','verification_appeals'] LOOP
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
  GRANT SELECT, INSERT, UPDATE, DELETE ON account_identity TO asilum_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON account_devices TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON verification_appeals TO asilum_app;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (68, 'identity')
ON CONFLICT (version) DO NOTHING;
