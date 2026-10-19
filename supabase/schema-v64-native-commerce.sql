-- schema-v64-native-commerce.sql
--
-- NATIVE COMMERCE (V.2 Blueprint, owner, 17 Oct 2026, chapters 7 and 8;
-- slice 6 over the native-storefront branch's v62). The law is
-- lib/storefront/commerce.js; these are its rows.
--
--   native_listings.mode       SELL (single item) or DROP (quantities, sizes,
--                              colors, variations; authenticated before
--                              release). Existing rows default to SELL.
--   storefronts.offer_settings the seller's: acceptOffers, offersDuringDiscount,
--                              discountsStack, autoAcceptCents (7.19–7.20).
--   listing_offers             every offer and counter, each a row with its own
--                              24-hour window; nothing is withdrawn once sent
--                              (8.9); acceptance unlocks a 24-hour exclusive
--                              checkout at the agreed price for that buyer
--                              only and reserves nothing (7.21); a sale
--                              invalidates it (7.22).
--   listing_discounts          24-hour discounts, manual renewal (`renewed_from`),
--                              edit or cancel any time; every application and
--                              renewal notifies the likers (7.31–7.33, 8.3).
--   listing_price_history      PRIVATE: every price and discount change, for
--                              fraud detection and dispute review; only the
--                              current price is public (8.13, 7.17).
--   availability_queue         the first-come waiting queue on a reserved
--                              listing; notified on release, closed on sale,
--                              reopened on return (7.10–7.13).
--   listing_relists            every relist with the seller's confirmation, the
--                              condition confirmation, the photographs and the
--                              new price (7.14–7.17).
--   notifications.kind         gains the offer, discount and queue kinds;
--   user_notification_prefs    gains the discount threshold (7.34), the offer
--                              reminder preset (7.28–7.30) and the queue alerts
--                              switch (7.12).
--
-- Numbered 64 after v63 (asterisk governance, staged) and v62 (the
-- storefront, staged); v61 is the latest applied on the live ledger.
--
-- ROLLBACK: DROP TABLE IF EXISTS listing_relists, availability_queue,
--           listing_price_history, listing_discounts, listing_offers;
--           ALTER TABLE native_listings DROP COLUMN IF EXISTS mode;
--           ALTER TABLE storefronts DROP COLUMN IF EXISTS offer_settings;
--           ALTER TABLE user_notification_prefs DROP COLUMN IF EXISTS queue_alerts,
--             DROP COLUMN IF EXISTS offer_reminders, DROP COLUMN IF EXISTS discount_min_percent;
--           (restore the v60 notifications kind check by hand);
--           DELETE FROM app_schema_migrations WHERE version = 64;
-- VERIFY:   SELECT mode, count(*) FROM native_listings GROUP BY 1;
--           SELECT state, count(*) FROM listing_offers GROUP BY 1;

ALTER TABLE native_listings ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'sell' CHECK (mode IN ('sell','drop'));
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS offer_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS listing_offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES native_listings(id),
  variant_id        UUID REFERENCES native_listing_variants(id),
  storefront_id     UUID NOT NULL REFERENCES storefronts(id),
  buyer_id          TEXT NOT NULL,
  seller_account_id UUID NOT NULL,
  by_party          TEXT NOT NULL CHECK (by_party IN ('buyer','seller')),
  parent_id         UUID REFERENCES listing_offers(id),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  currency          TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','declined','countered','expired','invalidated')),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_until    TIMESTAMPTZ,
  responded_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS listing_offers_listing_idx ON listing_offers (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_offers_buyer_idx ON listing_offers (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_offers_seller_idx ON listing_offers (seller_account_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS listing_discounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         UUID NOT NULL REFERENCES native_listings(id),
  storefront_id      UUID NOT NULL REFERENCES storefronts(id),
  percent            INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 90),
  price_before_cents INTEGER NOT NULL CHECK (price_before_cents > 0),
  price_cents        INTEGER NOT NULL CHECK (price_cents > 0),
  state              TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','cancelled','expired')),
  starts_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at            TIMESTAMPTZ NOT NULL,
  ended_at           TIMESTAMPTZ,
  renewed_from       UUID REFERENCES listing_discounts(id),
  created_by         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_discounts_listing_idx ON listing_discounts (listing_id, state, ends_at DESC);

CREATE TABLE IF NOT EXISTS listing_price_history (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    UUID NOT NULL REFERENCES native_listings(id),
  variant_id    UUID REFERENCES native_listing_variants(id),
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  reason        TEXT NOT NULL,
  actor         TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_price_history_listing_idx ON listing_price_history (listing_id, at DESC);

CREATE TABLE IF NOT EXISTS availability_queue (
  listing_id    UUID NOT NULL REFERENCES native_listings(id),
  user_id       TEXT NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  state         TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','notified','closed')),
  notified_at   TIMESTAMPTZ,
  PRIMARY KEY (listing_id, user_id)
);
CREATE INDEX IF NOT EXISTS availability_queue_listing_idx ON availability_queue (listing_id, state, joined_at);

CREATE TABLE IF NOT EXISTS listing_relists (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    UUID NOT NULL REFERENCES native_listings(id),
  from_version  INTEGER NOT NULL,
  condition     TEXT,
  condition_changed BOOLEAN NOT NULL DEFAULT false,
  photos        JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  confirmed_by  TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('liked-sold', 'dm-cleared', 'profile-shared', 'wardrobe-gift',
                  'offer-new', 'offer-counter', 'offer-accepted', 'offer-declined', 'offer-expiring', 'offer-invalidated',
                  'discount', 'queue-available', 'queue-sold', 'queue-returned'));
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS discount_min_percent INTEGER NOT NULL DEFAULT 10 CHECK (discount_min_percent BETWEEN 10 AND 90);
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS offer_reminders TEXT NOT NULL DEFAULT 'standard' CHECK (offer_reminders IN ('minimal','standard','frequent'));
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS queue_alerts BOOLEAN NOT NULL DEFAULT true;

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['listing_offers','listing_discounts','listing_price_history','availability_queue','listing_relists'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name); END IF;
    END LOOP;
  END LOOP;
END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
  GRANT SELECT, INSERT, UPDATE ON listing_offers TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON listing_discounts TO asilum_app;
  GRANT SELECT, INSERT ON listing_price_history TO asilum_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON availability_queue TO asilum_app;
  GRANT SELECT, INSERT ON listing_relists TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE listing_price_history_id_seq TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE listing_relists_id_seq TO asilum_app;
  DROP POLICY IF EXISTS asilum_app_server_access ON listing_offers;
  CREATE POLICY asilum_app_server_access ON listing_offers FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON listing_discounts;
  CREATE POLICY asilum_app_server_access ON listing_discounts FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON listing_price_history;
  CREATE POLICY asilum_app_server_access ON listing_price_history FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON availability_queue;
  CREATE POLICY asilum_app_server_access ON availability_queue FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS asilum_app_server_access ON listing_relists;
  CREATE POLICY asilum_app_server_access ON listing_relists FOR ALL TO asilum_app USING (true) WITH CHECK (true);
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (64, 'native-commerce')
ON CONFLICT (version) DO NOTHING;
