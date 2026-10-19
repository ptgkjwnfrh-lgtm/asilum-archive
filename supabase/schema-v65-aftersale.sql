-- schema-v65-aftersale.sql
--
-- AFTER THE SALE: PROTECTION, RETURNS, THE PASSENGER SCORE, ASILUM CREDIT
-- (V.2 Blueprint, owner, 17 Oct 2026, chapters 5 (Credit), 6 and 10, Terms
-- 10–12; slice 7). The laws are lib/storefront/protection.js, score.js and
-- credit.js; these are their rows.
--
--   credit_ledger          APPEND-ONLY. Credit enters by refund, gift and the
--                          $1 return incentive only (never purchased); leaves by
--                          spend, gift or an admin's void. The balance is derived.
--   passenger_reviews      double-blind reviews per order and role, revisable
--                          with a private history, one permanent response
--                          (deletable, never replaced, audited), excluded or
--                          refunded marks (6.13–6.30).
--   conduct_penalties      half-star penalties: pending → confirmed → appealed
--                          → overturned / upheld (6.7–6.8, 6.19–6.22).
--   order_deliveries       the delivery event per order WITH its source —
--                          carrier (none integrated yet), seller (manual
--                          tracking, 10.7) or admin; it starts the clocks (10.21).
--   order_returns          change-of-mind returns and complaints with evidence,
--                          the admin's decision, the fault, the label payer,
--                          the refund destination (6.1, 6.7, 11.5).
--   protection_elections   |A| Protection per order: the offer shown, what was
--                          elected (never preselected), what it cost (6.3–6.4).
--   return_incentives      the $1 credit per returnable listing, once (6.5–6.6).
--   order_dispatch         label printed, handed off, approved extensions
--                          (10.1–10.5).
--   native_listings.returns_enabled   the seller's returns switch (6.1).
--   orders.credit_applied_cents       the credit the buyer applied (10.5).
--   notifications.kind     gains the after-sale kinds.
--
-- Numbered 65 after v64 (native commerce, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS order_dispatch, return_incentives,
--           protection_elections, order_returns, order_deliveries,
--           conduct_penalties, passenger_reviews, credit_ledger;
--           ALTER TABLE native_listings DROP COLUMN IF EXISTS returns_enabled;
--           ALTER TABLE orders DROP COLUMN IF EXISTS credit_applied_cents;
--           (restore the v64 notifications kind check by hand);
--           DELETE FROM app_schema_migrations WHERE version = 65;
-- VERIFY:   SELECT kind, sum(amount_cents) FROM credit_ledger GROUP BY 1;
--           SELECT state, count(*) FROM passenger_reviews GROUP BY 1;

ALTER TABLE native_listings ADD COLUMN IF NOT EXISTS returns_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied_cents >= 0);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('refund','gift_in','gift_out','incentive','spend','release','void','bonus')),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  order_id         TEXT,
  counterparty_id  TEXT,
  note             TEXT,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, at DESC);

CREATE TABLE IF NOT EXISTS passenger_reviews (
  id                   UUID PRIMARY KEY,
  order_id             TEXT NOT NULL REFERENCES orders(id),
  reviewer_id          TEXT NOT NULL,
  subject_id           TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('buyer','seller')),
  stars                REAL NOT NULL CHECK (stars >= 1 AND stars <= 5),
  text                 TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 1000),
  verified             BOOLEAN NOT NULL DEFAULT false,
  state                TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','published','held','excluded')),
  excluded             BOOLEAN NOT NULL DEFAULT false,
  refunded             BOOLEAN NOT NULL DEFAULT false,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revised_at           TIMESTAMPTZ,
  published_at         TIMESTAMPTZ,
  history              JSONB NOT NULL DEFAULT '[]'::jsonb,
  response             JSONB,
  response_deleted_at  TIMESTAMPTZ,
  response_audit       JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (order_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS passenger_reviews_subject_idx ON passenger_reviews (subject_id, state, submitted_at DESC);

CREATE TABLE IF NOT EXISTS conduct_penalties (
  id            UUID PRIMARY KEY,
  user_id       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  order_id      TEXT,
  half_stars    INTEGER NOT NULL DEFAULT 1 CHECK (half_stars > 0),
  state         TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','appealed','overturned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at  TIMESTAMPTZ,
  appealed_at   TIMESTAMPTZ,
  appeal        TEXT,
  decided_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conduct_penalties_user_idx ON conduct_penalties (user_id, state);

CREATE TABLE IF NOT EXISTS order_deliveries (
  order_id      TEXT PRIMARY KEY REFERENCES orders(id),
  delivered_at  TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('carrier','seller','admin')),
  tracking      TEXT,
  recorded_by   TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  estimated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_returns (
  id                UUID PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  buyer_id          TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('change_of_mind','wrong_item','damage','non_delivery')),
  reason            TEXT NOT NULL DEFAULT '',
  evidence          TEXT,
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','approved','refused','refunded')),
  ground            TEXT,
  fault             TEXT NOT NULL DEFAULT 'undetermined' CHECK (fault IN ('buyer','seller','carrier','undetermined')),
  label_payer       TEXT,
  refund_to         TEXT CHECK (refund_to IS NULL OR refund_to IN ('credit','original')),
  refund_cents      INTEGER CHECK (refund_cents IS NULL OR refund_cents >= 0),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        TEXT,
  decision          TEXT,
  seller_pays_label BOOLEAN
);
CREATE INDEX IF NOT EXISTS order_returns_order_idx ON order_returns (order_id, state);
CREATE INDEX IF NOT EXISTS order_returns_open_idx ON order_returns (state, opened_at DESC);

CREATE TABLE IF NOT EXISTS protection_elections (
  order_id      TEXT PRIMARY KEY REFERENCES orders(id),
  offer         JSONB,
  elected       BOOLEAN NOT NULL DEFAULT false,
  price_cents   INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  provider      TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS return_incentives (
  listing_id    UUID PRIMARY KEY REFERENCES native_listings(id),
  storefront_id UUID NOT NULL REFERENCES storefronts(id),
  order_id      TEXT NOT NULL REFERENCES orders(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  earned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_dispatch (
  order_id          TEXT PRIMARY KEY REFERENCES orders(id),
  mode              TEXT NOT NULL DEFAULT 'sell' CHECK (mode IN ('sell','drop')),
  label_printed_at  TIMESTAMPTZ,
  handed_at         TIMESTAMPTZ,
  extensions        JSONB NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('liked-sold', 'dm-cleared', 'profile-shared', 'wardrobe-gift',
                  'offer-new', 'offer-counter', 'offer-accepted', 'offer-declined', 'offer-expiring', 'offer-invalidated',
                  'discount', 'queue-available', 'queue-sold', 'queue-returned',
                  'delivered', 'return-opened', 'return-decided', 'review-published', 'penalty', 'credit'));

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_ledger','passenger_reviews','conduct_penalties','order_deliveries','order_returns','protection_elections','return_incentives','order_dispatch'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
    END LOOP;
  END LOOP;
END $$;
DO $$ DECLARE t TEXT;
BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT ON credit_ledger TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE credit_ledger_id_seq TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON passenger_reviews TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON conduct_penalties TO asilum_app;
  GRANT SELECT, INSERT ON order_deliveries TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON order_returns TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON protection_elections TO asilum_app;
  GRANT SELECT, INSERT ON return_incentives TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON order_dispatch TO asilum_app;
  FOREACH t IN ARRAY ARRAY['credit_ledger','passenger_reviews','conduct_penalties','order_deliveries','order_returns','protection_elections','return_incentives','order_dispatch'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS asilum_app_server_access ON %I', t);
    EXECUTE format('CREATE POLICY asilum_app_server_access ON %I FOR ALL TO asilum_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (65, 'aftersale')
ON CONFLICT (version) DO NOTHING;
