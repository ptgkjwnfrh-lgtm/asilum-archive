-- schema-v66-brdcst.sql
--
-- BRDCST OUTREACH AND BILLING (V.2 Blueprint, owner, 17 Oct 2026, chapter 5
-- 5.10–5.28, 9.13, Terms 15; slice 8). The law is lib/brdcst/index.js; these
-- are its rows.
--
--   brdcst_campaigns   one paid promotion of a post's event attachment(s):
--                      the targeting (radius, taste breadth, duration), the
--                      quote as it was shown, the schedule a payment fixed,
--                      the order that paid it (card) and the credit applied,
--                      the failed-payment clock and its mute, the cancellation
--                      and its refund. State is derived at read time
--                      (lib/brdcst stateAt) except cancelled / under_review.
--   brdcst_bonuses     APPEND-ONLY. Days or miles earned by a credit refund
--                      (two days or 45 miles) or by the credit share of a
--                      payment (proportional, rounded down); redeemed on a
--                      later campaign. The bank is derived.
--   orders.kind        gains 'brdcst' — a campaign's card charge rides the
--                      order engine (one checkout session, one ledger).
--   notifications.kind gains the BRDCST kinds.
--
-- Numbered 66 after v65 (after the sale, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS brdcst_bonuses, brdcst_campaigns;
--           (restore the v35 orders kind check and the v65 notifications kind
--           check by hand);
--           DELETE FROM app_schema_migrations WHERE version = 66;
-- VERIFY:   SELECT state, count(*) FROM brdcst_campaigns GROUP BY 1;
--           SELECT kind, sum(amount) FROM brdcst_bonuses WHERE redeemed_at IS NULL GROUP BY 1;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_kind_check CHECK (kind IN ('sale','ticket_fee','brdcst'));

CREATE TABLE IF NOT EXISTS brdcst_campaigns (
  id                  UUID PRIMARY KEY,
  owner_id            TEXT NOT NULL,
  post_id             TEXT,
  event_ids           JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_name          TEXT NOT NULL DEFAULT '',
  event_kind          TEXT,
  event_starts_at     TEXT,
  center_lat          DOUBLE PRECISION,
  center_lng          DOUBLE PRECISION,
  tags                JSONB NOT NULL DEFAULT '[]'::jsonb,
  radius_mi           INTEGER NOT NULL CHECK (radius_mi >= 50 AND radius_mi <= 500),
  taste_breadth       REAL NOT NULL DEFAULT 0 CHECK (taste_breadth >= 0 AND taste_breadth <= 1),
  duration_days       INTEGER NOT NULL CHECK (duration_days IN (1,3,7,14,30)),
  scheduled_start     TIMESTAMPTZ,
  quote               JSONB NOT NULL DEFAULT '{}'::jsonb,
  per_day_cents       INTEGER NOT NULL CHECK (per_day_cents >= 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0),
  billed_days         INTEGER NOT NULL DEFAULT 0,
  bonus_days          INTEGER NOT NULL DEFAULT 0,
  bonus_miles         INTEGER NOT NULL DEFAULT 0,
  credit_cents        INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  order_id            TEXT,
  paid_at             TIMESTAMPTZ,
  paid_via            TEXT CHECK (paid_via IN ('credit','card','mixed')),
  starts_at           TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,
  state               TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','scheduled','active','ended','cancelled','under_review')),
  payment_failed_at   TIMESTAMPTZ,
  last_reminder_at    TIMESTAMPTZ,
  reminders_muted     BOOLEAN NOT NULL DEFAULT false,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT CHECK (cancel_reason IN ('voluntary','event_cancelled','interrupted','policy')),
  cancelled_by        TEXT,
  refund              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brdcst_campaigns_owner_idx ON brdcst_campaigns (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brdcst_campaigns_post_idx ON brdcst_campaigns (post_id);
CREATE INDEX IF NOT EXISTS brdcst_campaigns_live_idx ON brdcst_campaigns (state, ends_at) WHERE paid_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS brdcst_bonuses (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('days','miles')),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  source                TEXT NOT NULL CHECK (source IN ('refund','credit_share')),
  campaign_id           UUID REFERENCES brdcst_campaigns(id),
  earned_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at           TIMESTAMPTZ,
  redeemed_campaign_id  UUID REFERENCES brdcst_campaigns(id)
);
CREATE INDEX IF NOT EXISTS brdcst_bonuses_user_idx ON brdcst_bonuses (user_id, redeemed_at);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('liked-sold', 'dm-cleared', 'profile-shared', 'wardrobe-gift',
                  'offer-new', 'offer-counter', 'offer-accepted', 'offer-declined', 'offer-expiring', 'offer-invalidated',
                  'discount', 'queue-available', 'queue-sold', 'queue-returned',
                  'delivered', 'return-opened', 'return-decided', 'review-published', 'penalty', 'credit',
                  'brdcst-payment', 'brdcst-started', 'brdcst-ended', 'brdcst-refund'));

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['brdcst_campaigns','brdcst_bonuses'] LOOP
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
  GRANT SELECT, INSERT, UPDATE ON brdcst_campaigns TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON brdcst_bonuses TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE brdcst_bonuses_id_seq TO asilum_app;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (66, 'brdcst')
ON CONFLICT (version) DO NOTHING;
