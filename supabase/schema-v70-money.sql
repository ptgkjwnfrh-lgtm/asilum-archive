-- schema-v70-money.sql
--
-- MONEY IN MOTION (V.2 Blueprint, owner, 17 Oct 2026: 5.32 / 10.5 Credit at
-- checkout, 10.12–10.13 payouts after the window, 6.7 the covered label's
-- deduction, 7.20 offer reminders, chapter 13 Wardrobe private sales; owner
-- ruling 18 Oct 2026 "anything that is law and not set in motion is to be
-- built"; slice 11). The laws are lib/storefront/payouts.js,
-- lib/wardrobe/offers.js and lib/storefront/credit.js; these are their rows.
--
--   seller_payouts        one row per paid order with a seller: the merchandise
--                         owed, the deductions (a covered return label), the
--                         state the 14-day window and open issues give it,
--                         the release and the provider reference when money
--                         moved. Derived state recomputed on read; released is
--                         a fact.
--   platform_topups       what ASILUM owes a seller for the share a buyer paid
--                         with Credit (5.32): a transfer obligation from the
--                         platform balance, settled when the provider is keyed.
--   wardrobe_offers       DM-first offers on owned pieces (13.4–13.17): one
--                         active per item, the 24-hour exclusive checkout on
--                         acceptance, the 14-day cooldown, ownership on
--                         carrier-confirmed delivery.
--   wardrobe_items        gains accept_offers (13.3) and the cooldown clock.
--   listing_offers        gains reminders_sent (7.20): which reminder moments
--                         the job already sent.
--
-- Numbered 70 after v69 (passport, staged); v61 is the latest applied.
--
-- ROLLBACK: DROP TABLE IF EXISTS wardrobe_offers, platform_topups, seller_payouts;
--           ALTER TABLE wardrobe_items DROP COLUMN IF EXISTS accept_offers, DROP COLUMN IF EXISTS offer_cooldown_until;
--           ALTER TABLE listing_offers DROP COLUMN IF EXISTS reminders_sent;
--           DELETE FROM app_schema_migrations WHERE version = 70;
-- VERIFY:   SELECT state, count(*), sum(amount_cents) FROM seller_payouts GROUP BY 1;

CREATE TABLE IF NOT EXISTS seller_payouts (
  order_id          TEXT PRIMARY KEY REFERENCES orders(id),
  seller_id         TEXT NOT NULL,
  rail              TEXT NOT NULL CHECK (rail IN ('native_storefront','wardrobe')),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents >= 0),
  deduction_cents   INTEGER NOT NULL DEFAULT 0 CHECK (deduction_cents >= 0),
  deductions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  state             TEXT NOT NULL DEFAULT 'waiting_delivery' CHECK (state IN ('waiting_delivery','held_window','held_issue','releasable','released','void')),
  releasable_at     TIMESTAMPTZ,
  released_at       TIMESTAMPTZ,
  released_by       TEXT,
  provider          TEXT,
  provider_ref      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_payouts_seller_idx ON seller_payouts (seller_id, state);

CREATE TABLE IF NOT EXISTS platform_topups (
  id                BIGSERIAL PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  seller_account_id UUID,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  state             TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','transferred','void')),
  provider_ref      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS platform_topups_state_idx ON platform_topups (state);

ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS accept_offers BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS offer_cooldown_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS wardrobe_offers (
  id                 UUID PRIMARY KEY,
  item_id            BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
  owner_id           TEXT NOT NULL,
  buyer_id           TEXT NOT NULL,
  conversation_id    TEXT,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  state              TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','declined','expired','cancelled','paid','lapsed')),
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_until     TIMESTAMPTZ,
  order_id           TEXT,
  responded_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wardrobe_offers_item_idx ON wardrobe_offers (item_id, state);
CREATE INDEX IF NOT EXISTS wardrobe_offers_buyer_idx ON wardrobe_offers (buyer_id, created_at DESC);

ALTER TABLE listing_offers ADD COLUMN IF NOT EXISTS reminders_sent JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seller_payouts','platform_topups','wardrobe_offers'] LOOP
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
  GRANT SELECT, INSERT, UPDATE ON seller_payouts TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON platform_topups TO asilum_app;
  GRANT USAGE, SELECT ON SEQUENCE platform_topups_id_seq TO asilum_app;
  GRANT SELECT, INSERT, UPDATE ON wardrobe_offers TO asilum_app;
END IF; END $$;

INSERT INTO app_schema_migrations (version, name) VALUES (70, 'money')
ON CONFLICT (version) DO NOTHING;
