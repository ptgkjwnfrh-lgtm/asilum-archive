-- schema-v62-native-storefront.sql
--
-- Native Storefront persistence. Creating a storefront is free: the create
-- transaction writes a storefront plus its one-time $30 collection account,
-- and never creates an invoice or charges a card. Buyer passenger fees,
-- storefront-fee reservations, inventory reservations and provider attempts
-- are separate records so a pending checkout can never masquerade as settled
-- money or consumed stock.
--
-- The public `items` row remains the shared catalog projection used by Feed,
-- search and bag. `native_listings` + `native_listing_variants` are the source
-- of truth for seller ownership, integer-minor-unit price and inventory.
-- Native rows deliberately begin with native_checkout_ready=false; publishing
-- or adding stock alone can never enable real-money checkout.
--
-- All tables are server-only. Public storefront reads go through the API's
-- explicit allowlist; browser database roles receive no grants.
--
-- ROLLBACK (maintenance window; preserve/export financial ledgers first):
--   ALTER TABLE items DROP CONSTRAINT IF EXISTS items_native_listing_fkey;
--   ALTER TABLE items DROP CONSTRAINT IF EXISTS items_native_default_variant_fkey;
--   DROP TABLE IF EXISTS stripe_event_inbox, refund_operations, inventory_reservations,
--     storefront_fee_events, storefront_fee_reservations, payment_attempts, order_lines;
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_storefront_fkey;
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_id_storefront_key;
--   ALTER TABLE items DROP COLUMN IF EXISTS native_checkout_ready,
--     DROP COLUMN IF EXISTS listing_version,
--     DROP COLUMN IF EXISTS inventory_available,
--     DROP COLUMN IF EXISTS price_cents,
--     DROP COLUMN IF EXISTS default_variant_id,
--     DROP COLUMN IF EXISTS native_listing_id,
--     DROP COLUMN IF EXISTS storefront_slug,
--     DROP COLUMN IF EXISTS commerce_rail;
--   ALTER TABLE orders DROP COLUMN IF EXISTS storefront_fee_reserved_cents,
--     DROP COLUMN IF EXISTS stripe_livemode,
--     DROP COLUMN IF EXISTS stripe_connected_account_id,
--     DROP COLUMN IF EXISTS buyer_total_cents,
--     DROP COLUMN IF EXISTS tax_cents,
--     DROP COLUMN IF EXISTS handling_cents,
--     DROP COLUMN IF EXISTS shipping_cents,
--     DROP COLUMN IF EXISTS passenger_fee_cents,
--     DROP COLUMN IF EXISTS merchandise_cents,
--     DROP COLUMN IF EXISTS quote_expires_at,
--     DROP COLUMN IF EXISTS pricing_policy_version,
--     DROP COLUMN IF EXISTS storefront_id,
--     DROP COLUMN IF EXISTS commerce_rail;
--   DROP TABLE IF EXISTS native_listing_variants, native_listings,
--     storefront_fee_accounts, storefront_payment_accounts, storefronts;
--   DELETE FROM app_schema_migrations WHERE version = 62;
--
-- VERIFY AFTER APPLY (read-only):
--   SELECT version,name FROM app_schema_migrations WHERE version=62;
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('storefronts','native_listings','native_listing_variants',
--       'storefront_fee_accounts','storefront_fee_reservations',
--       'storefront_fee_events','inventory_reservations','payment_attempts',
--       'stripe_event_inbox') ORDER BY relname;
--   SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
--     WHERE table_name LIKE 'storefront%' OR table_name LIKE 'native_listing%'
--     ORDER BY table_name,grantee,privilege_type;

CREATE TABLE IF NOT EXISTS storefronts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id    UUID NOT NULL UNIQUE,
  business_account_id UUID REFERENCES business_accounts(account_id),
  slug                TEXT NOT NULL UNIQUE
                      CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{1,55}$'),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description         TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 600),
  image_url           TEXT CHECK (image_url IS NULL OR char_length(image_url) <= 1000),
  banner_url          TEXT CHECK (banner_url IS NULL OR char_length(banner_url) <= 1000),
  state               TEXT NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft','pending_review','active','paused','archived','rejected')),
  terms_version       TEXT NOT NULL CHECK (char_length(terms_version) BETWEEN 3 AND 100),
  terms_accepted_at   TIMESTAMPTZ NOT NULL,
  moderation_actor    TEXT,
  moderation_note     TEXT CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 500),
  moderated_at        TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (business_account_id IS NULL OR business_account_id = owner_account_id)
);
CREATE INDEX IF NOT EXISTS storefronts_business_account_idx
  ON storefronts (business_account_id) WHERE business_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storefronts_public_idx
  ON storefronts (state, slug) WHERE state = 'active';

-- Provider/KYC state is private and is never returned by the public store API.
CREATE TABLE IF NOT EXISTS storefront_payment_accounts (
  storefront_id          UUID PRIMARY KEY REFERENCES storefronts(id),
  stripe_account_id      TEXT UNIQUE,
  expected_livemode      BOOLEAN NOT NULL DEFAULT false,
  details_submitted      BOOLEAN NOT NULL DEFAULT false,
  charges_enabled        BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled        BOOLEAN NOT NULL DEFAULT false,
  fee_payer              TEXT,
  losses_collector       TEXT,
  capability_snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(capability_snapshot) = 'object'),
  validation_version     TEXT,
  validated_at           TIMESTAMPTZ,
  provider_retrieved_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One record for the lifetime $30 schedule. It has no recurrence period and
-- cannot become an invoice. Events are the audit truth; these counters are the
-- transactionally maintained projection used by the seller UI.
CREATE TABLE IF NOT EXISTS storefront_fee_accounts (
  storefront_id     UUID PRIMARY KEY REFERENCES storefronts(id),
  target_cents      INTEGER NOT NULL DEFAULT 3000 CHECK (target_cents = 3000),
  collected_cents   INTEGER NOT NULL DEFAULT 0 CHECK (collected_cents >= 0),
  reserved_cents    INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  currency          TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  policy_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (collected_cents + reserved_cents <= target_cents)
);

CREATE TABLE IF NOT EXISTS native_listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id     UUID NOT NULL REFERENCES storefronts(id),
  operation_key     TEXT,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  description       TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  category          TEXT NOT NULL CHECK (category IN
                      ('clothing','jewelry','posters_prints','furniture',
                       'electronics_tech','ornaments_home','other')),
  subcategory       TEXT CHECK (subcategory IS NULL OR char_length(subcategory) <= 80),
  condition         TEXT CHECK (condition IS NULL OR char_length(condition) <= 80),
  photos            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(photos) = 'array'),
  attributes        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  fulfillment       JSONB NOT NULL DEFAULT '{"shipping":true,"pickup":false}'::jsonb
                    CHECK (jsonb_typeof(fulfillment) = 'object'),
  state             TEXT NOT NULL DEFAULT 'draft'
                    CHECK (state IN ('draft','pending_review','active','paused','sold_out','archived','rejected')),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  moderation_actor  TEXT,
  moderation_note   TEXT CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 500),
  moderated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, id)
);
CREATE INDEX IF NOT EXISTS native_listings_storefront_idx
  ON native_listings (storefront_id, created_at DESC);
CREATE INDEX IF NOT EXISTS native_listings_public_idx
  ON native_listings (storefront_id, state, created_at DESC) WHERE state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS native_listings_operation_key
  ON native_listings (storefront_id, operation_key) WHERE operation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS native_listing_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES native_listings(id),
  label             TEXT NOT NULL DEFAULT 'Default' CHECK (char_length(label) BETWEEN 1 AND 100),
  sku               TEXT CHECK (sku IS NULL OR char_length(sku) <= 80),
  option_values     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(option_values) = 'object'),
  price_cents       INTEGER NOT NULL CHECK (price_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  stock_on_hand     INTEGER NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  stock_reserved    INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  state             TEXT NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active','paused','archived')),
  is_default        BOOLEAN NOT NULL DEFAULT false,
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stock_reserved <= stock_on_hand),
  UNIQUE (listing_id, id)
);
CREATE INDEX IF NOT EXISTS native_listing_variants_listing_idx
  ON native_listing_variants (listing_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS native_listing_variants_default_key
  ON native_listing_variants (listing_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS native_listing_variants_sku_key
  ON native_listing_variants (listing_id, lower(sku)) WHERE sku IS NOT NULL;

-- The shared catalog projection. Existing imported rows remain NULL on all
-- native-only columns. Integer price and inventory are authoritative for the
-- native rail; `price` remains its major-unit display mirror for old readers.
ALTER TABLE items ADD COLUMN IF NOT EXISTS commerce_rail TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS storefront_slug TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS native_listing_id UUID;
ALTER TABLE items ADD COLUMN IF NOT EXISTS default_variant_id UUID;
ALTER TABLE items ADD COLUMN IF NOT EXISTS price_cents INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS inventory_available INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS listing_version INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS native_checkout_ready BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='items_native_listing_fkey' AND conrelid='items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT items_native_listing_fkey
      FOREIGN KEY (native_listing_id) REFERENCES native_listings(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='items_native_default_variant_fkey' AND conrelid='items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT items_native_default_variant_fkey
      FOREIGN KEY (native_listing_id, default_variant_id)
      REFERENCES native_listing_variants(listing_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='items_price_cents_nonnegative' AND conrelid='items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT items_price_cents_nonnegative
      CHECK (price_cents IS NULL OR price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='items_inventory_available_nonnegative' AND conrelid='items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT items_inventory_available_nonnegative
      CHECK (inventory_available IS NULL OR inventory_available >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='items_listing_version_positive' AND conrelid='items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT items_listing_version_positive
      CHECK (listing_version IS NULL OR listing_version > 0);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS items_native_listing_key
  ON items (native_listing_id) WHERE native_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_storefront_slug_idx
  ON items (storefront_slug, is_available, created_at DESC)
  WHERE commerce_rail = 'native_storefront';
CREATE INDEX IF NOT EXISTS items_default_variant_idx
  ON items (default_variant_id) WHERE default_variant_id IS NOT NULL;

-- Additive native-order snapshots. Historical sale/ticket-fee rows retain
-- their exact old meanings and NULL native fields.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commerce_rail TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS storefront_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_policy_version TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchandise_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS passenger_fee_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handling_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_total_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_livemode BOOLEAN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS storefront_fee_reserved_cents INTEGER;

DO $$
DECLARE column_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='orders_storefront_fkey' AND conrelid='orders'::regclass) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_storefront_fkey
      FOREIGN KEY (storefront_id) REFERENCES storefronts(id);
  END IF;
  FOREACH column_name IN ARRAY ARRAY[
    'merchandise_cents','passenger_fee_cents','shipping_cents','handling_cents',
    'tax_cents','buyer_total_cents','storefront_fee_reserved_cents'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='orders_' || column_name || '_nonnegative' AND conrelid='orders'::regclass) THEN
      EXECUTE format('ALTER TABLE orders ADD CONSTRAINT %I CHECK (%I IS NULL OR %I >= 0)',
        'orders_' || column_name || '_nonnegative', column_name, column_name);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS orders_storefront_idx
  ON orders (storefront_id, created_at DESC) WHERE storefront_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_connected_account_idx
  ON orders (stripe_connected_account_id, created_at DESC)
  WHERE stripe_connected_account_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='orders_id_storefront_key' AND conrelid='orders'::regclass) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_id_storefront_key UNIQUE (id, storefront_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_lines (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                   TEXT NOT NULL REFERENCES orders(id),
  line_number                INTEGER NOT NULL CHECK (line_number > 0),
  storefront_id              UUID NOT NULL REFERENCES storefronts(id),
  listing_id                 UUID NOT NULL REFERENCES native_listings(id),
  variant_id                 UUID NOT NULL REFERENCES native_listing_variants(id),
  quantity                   INTEGER NOT NULL CHECK (quantity > 0),
  unit_merchandise_cents     INTEGER NOT NULL CHECK (unit_merchandise_cents >= 0),
  unit_passenger_fee_cents   INTEGER NOT NULL CHECK (unit_passenger_fee_cents >= 0),
  refunded_quantity          INTEGER NOT NULL DEFAULT 0 CHECK (refunded_quantity >= 0),
  listing_version            INTEGER NOT NULL CHECK (listing_version > 0),
  variant_version            INTEGER NOT NULL CHECK (variant_version > 0),
  snapshot                   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (refunded_quantity <= quantity),
  UNIQUE (order_id, line_number),
  FOREIGN KEY (order_id, storefront_id)
    REFERENCES orders(id, storefront_id),
  FOREIGN KEY (storefront_id, listing_id)
    REFERENCES native_listings(storefront_id, id),
  FOREIGN KEY (listing_id, variant_id)
    REFERENCES native_listing_variants(listing_id, id)
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id, line_number);
CREATE INDEX IF NOT EXISTS order_lines_storefront_idx ON order_lines (storefront_id, order_id);
CREATE INDEX IF NOT EXISTS order_lines_listing_idx ON order_lines (listing_id);
CREATE INDEX IF NOT EXISTS order_lines_variant_idx ON order_lines (variant_id);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                        TEXT NOT NULL REFERENCES orders(id),
  storefront_id                   UUID NOT NULL REFERENCES storefronts(id),
  idempotency_key                 TEXT NOT NULL UNIQUE,
  stripe_account_id               TEXT NOT NULL,
  livemode                        BOOLEAN NOT NULL DEFAULT false,
  expected_buyer_total_cents      INTEGER NOT NULL CHECK (expected_buyer_total_cents > 0),
  passenger_fee_cents             INTEGER NOT NULL CHECK (passenger_fee_cents >= 0),
  storefront_fee_reserved_cents   INTEGER NOT NULL DEFAULT 0 CHECK (storefront_fee_reserved_cents >= 0),
  application_fee_cents           INTEGER NOT NULL CHECK (application_fee_cents >= 0),
  currency                        TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  status                          TEXT NOT NULL DEFAULT 'prepared'
                                  CHECK (status IN ('prepared','provider_pending','requires_action',
                                    'succeeded','failed','cancelled','reconcile_required')),
  stripe_session_id               TEXT,
  stripe_payment_intent_id        TEXT,
  stripe_charge_id                TEXT,
  stripe_balance_transaction_id   TEXT,
  stripe_application_fee_id       TEXT,
  next_reconcile_at               TIMESTAMPTZ,
  reconcile_attempts              INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_attempts >= 0),
  last_error                      TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (application_fee_cents = passenger_fee_cents + storefront_fee_reserved_cents),
  CHECK (application_fee_cents <= expected_buyer_total_cents),
  UNIQUE (id, order_id),
  UNIQUE (id, order_id, storefront_id),
  FOREIGN KEY (order_id, storefront_id) REFERENCES orders(id, storefront_id)
);
CREATE INDEX IF NOT EXISTS payment_attempts_order_idx ON payment_attempts (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_storefront_idx ON payment_attempts (storefront_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_reconcile_idx
  ON payment_attempts (next_reconcile_at, created_at)
  WHERE status IN ('provider_pending','reconcile_required');
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_provider_intent_key
  ON payment_attempts (stripe_account_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS storefront_fee_reservations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id         UUID NOT NULL REFERENCES storefronts(id),
  order_id              TEXT NOT NULL REFERENCES orders(id),
  payment_attempt_id    UUID REFERENCES payment_attempts(id),
  operation_key         TEXT NOT NULL UNIQUE,
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  state                 TEXT NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active','confirmed','released')),
  expires_at            TIMESTAMPTZ,
  terminal_operation_key TEXT UNIQUE,
  terminal_reason       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminal_at           TIMESTAMPTZ,
  UNIQUE (id, order_id, storefront_id),
  FOREIGN KEY (order_id, storefront_id)
    REFERENCES orders(id, storefront_id),
  FOREIGN KEY (payment_attempt_id, order_id, storefront_id)
    REFERENCES payment_attempts(id, order_id, storefront_id)
);
CREATE INDEX IF NOT EXISTS storefront_fee_reservations_storefront_idx
  ON storefront_fee_reservations (storefront_id, state, created_at);
CREATE INDEX IF NOT EXISTS storefront_fee_reservations_order_idx
  ON storefront_fee_reservations (order_id);
CREATE INDEX IF NOT EXISTS storefront_fee_reservations_attempt_idx
  ON storefront_fee_reservations (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS storefront_fee_reservations_order_attempt_key
  ON storefront_fee_reservations (order_id, payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS storefront_fee_events (
  id                         BIGSERIAL PRIMARY KEY,
  storefront_id              UUID NOT NULL REFERENCES storefronts(id),
  reservation_id             UUID NOT NULL,
  order_id                   TEXT NOT NULL REFERENCES orders(id),
  payment_attempt_id         UUID,
  kind                       TEXT NOT NULL CHECK (kind IN ('reserved','collected','released','reversed')),
  amount_cents               INTEGER NOT NULL CHECK (amount_cents > 0),
  operation_key              TEXT NOT NULL UNIQUE,
  reverses_event_id          BIGINT,
  stripe_account_id          TEXT,
  stripe_application_fee_id  TEXT,
  stripe_fee_refund_id       TEXT,
  stripe_event_id            TEXT,
  livemode                   BOOLEAN,
  currency                   TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, storefront_id, order_id, reservation_id),
  CHECK (stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'),
  CHECK (stripe_application_fee_id IS NULL OR stripe_application_fee_id ~ '^fee_[A-Za-z0-9_]+$'),
  CHECK (stripe_fee_refund_id IS NULL OR stripe_fee_refund_id ~ '^fr_[A-Za-z0-9_]+$'),
  CHECK (stripe_event_id IS NULL OR stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  CHECK (kind <> 'collected' OR
    (stripe_account_id IS NOT NULL AND stripe_application_fee_id IS NOT NULL
      AND stripe_event_id IS NOT NULL AND livemode IS NOT NULL)),
  CHECK (kind <> 'reversed' OR
    (reverses_event_id IS NOT NULL AND stripe_account_id IS NOT NULL
      AND stripe_application_fee_id IS NOT NULL AND stripe_fee_refund_id IS NOT NULL
      AND stripe_event_id IS NOT NULL AND livemode IS NOT NULL)),
  FOREIGN KEY (order_id, storefront_id)
    REFERENCES orders(id, storefront_id),
  FOREIGN KEY (reservation_id, order_id, storefront_id)
    REFERENCES storefront_fee_reservations(id, order_id, storefront_id),
  FOREIGN KEY (payment_attempt_id, order_id, storefront_id)
    REFERENCES payment_attempts(id, order_id, storefront_id),
  FOREIGN KEY (reverses_event_id, storefront_id, order_id, reservation_id)
    REFERENCES storefront_fee_events(id, storefront_id, order_id, reservation_id)
);
CREATE INDEX IF NOT EXISTS storefront_fee_events_storefront_idx
  ON storefront_fee_events (storefront_id, id);
CREATE INDEX IF NOT EXISTS storefront_fee_events_reservation_idx
  ON storefront_fee_events (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storefront_fee_events_order_idx ON storefront_fee_events (order_id, id);
CREATE INDEX IF NOT EXISTS storefront_fee_events_attempt_idx
  ON storefront_fee_events (payment_attempt_id) WHERE payment_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storefront_fee_events_reversal_idx
  ON storefront_fee_events (reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS storefront_fee_events_stripe_event_key
  ON storefront_fee_events (stripe_event_id) WHERE stripe_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS storefront_fee_events_provider_collection_key
  ON storefront_fee_events (stripe_account_id, stripe_application_fee_id)
  WHERE stripe_application_fee_id IS NOT NULL AND kind = 'collected';
CREATE UNIQUE INDEX IF NOT EXISTS storefront_fee_events_provider_refund_key
  ON storefront_fee_events (stripe_fee_refund_id)
  WHERE stripe_fee_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id          UUID NOT NULL REFERENCES storefronts(id),
  listing_id             UUID NOT NULL REFERENCES native_listings(id),
  variant_id             UUID NOT NULL REFERENCES native_listing_variants(id),
  order_id               TEXT NOT NULL REFERENCES orders(id),
  payment_attempt_id     UUID REFERENCES payment_attempts(id),
  operation_key          TEXT NOT NULL UNIQUE,
  quantity               INTEGER NOT NULL CHECK (quantity > 0),
  state                  TEXT NOT NULL DEFAULT 'active'
                         CHECK (state IN ('active','consumed','released')),
  expires_at             TIMESTAMPTZ,
  terminal_operation_key TEXT UNIQUE,
  terminal_reason        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminal_at            TIMESTAMPTZ,
  FOREIGN KEY (storefront_id, listing_id)
    REFERENCES native_listings(storefront_id, id),
  FOREIGN KEY (listing_id, variant_id)
    REFERENCES native_listing_variants(listing_id, id),
  FOREIGN KEY (order_id, storefront_id)
    REFERENCES orders(id, storefront_id),
  FOREIGN KEY (payment_attempt_id, order_id, storefront_id)
    REFERENCES payment_attempts(id, order_id, storefront_id)
);
CREATE INDEX IF NOT EXISTS inventory_reservations_variant_idx
  ON inventory_reservations (variant_id, state, created_at);
CREATE INDEX IF NOT EXISTS inventory_reservations_storefront_idx
  ON inventory_reservations (storefront_id, state, created_at);
CREATE INDEX IF NOT EXISTS inventory_reservations_order_idx ON inventory_reservations (order_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_attempt_idx
  ON inventory_reservations (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_order_attempt_key
  ON inventory_reservations (order_id, payment_attempt_id, variant_id)
  WHERE payment_attempt_id IS NOT NULL;

-- Customer refunds and application-fee refunds are different provider acts.
-- This outbox/projection preserves their split and the original unit
-- allocations used by partial returns; retrying one operation key cannot issue
-- a second refund or reverse the $30 ledger twice.
CREATE TABLE IF NOT EXISTS refund_operations (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                         TEXT NOT NULL REFERENCES orders(id),
  payment_attempt_id               UUID NOT NULL REFERENCES payment_attempts(id),
  storefront_id                    UUID NOT NULL REFERENCES storefronts(id),
  idempotency_key                  TEXT NOT NULL UNIQUE,
  amount_cents                     INTEGER NOT NULL CHECK (amount_cents > 0),
  passenger_fee_refund_cents       INTEGER NOT NULL DEFAULT 0
                                   CHECK (passenger_fee_refund_cents >= 0),
  storefront_fee_reversal_cents    INTEGER NOT NULL DEFAULT 0
                                   CHECK (storefront_fee_reversal_cents >= 0),
  currency                         TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  original_allocations             JSONB NOT NULL DEFAULT '[]'::jsonb
                                   CHECK (jsonb_typeof(original_allocations) = 'array'),
  status                           TEXT NOT NULL DEFAULT 'prepared'
                                   CHECK (status IN ('prepared','provider_pending','succeeded',
                                     'failed','reconcile_required')),
  stripe_account_id                TEXT NOT NULL,
  stripe_refund_id                 TEXT,
  stripe_application_fee_refund_id TEXT,
  livemode                         BOOLEAN NOT NULL DEFAULT false,
  last_error                       TEXT,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (passenger_fee_refund_cents <= amount_cents),
  FOREIGN KEY (payment_attempt_id, order_id, storefront_id)
    REFERENCES payment_attempts(id, order_id, storefront_id)
);
CREATE INDEX IF NOT EXISTS refund_operations_order_idx
  ON refund_operations (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_operations_attempt_idx
  ON refund_operations (payment_attempt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_operations_storefront_idx
  ON refund_operations (storefront_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_operations_reconcile_idx
  ON refund_operations (updated_at)
  WHERE status IN ('provider_pending','reconcile_required');
CREATE UNIQUE INDEX IF NOT EXISTS refund_operations_provider_refund_key
  ON refund_operations (stripe_account_id, stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refund_operations_provider_fee_refund_key
  ON refund_operations (stripe_application_fee_refund_id)
  WHERE stripe_application_fee_refund_id IS NOT NULL;

-- Every verified webhook is durably received before business dispatch. An
-- unknown/out-of-order object stays pending for reconciliation instead of
-- being acknowledged and forgotten.
CREATE TABLE IF NOT EXISTS stripe_event_inbox (
  stripe_event_id    TEXT PRIMARY KEY,
  stripe_account_id  TEXT,
  livemode           BOOLEAN NOT NULL,
  type               TEXT NOT NULL,
  object_id          TEXT,
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processed','failed','ignored')),
  attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         TEXT,
  next_attempt_at    TIMESTAMPTZ,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS stripe_event_inbox_pending_idx
  ON stripe_event_inbox (next_attempt_at, received_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS stripe_event_inbox_account_idx
  ON stripe_event_inbox (stripe_account_id, received_at DESC)
  WHERE stripe_account_id IS NOT NULL;

-- Server-only RLS posture. The app verifies account ownership in its route and
-- connects as asilum_app; Supabase browser roles cannot reach these tables.
ALTER TABLE storefronts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_fee_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_listing_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_fee_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_fee_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_event_inbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE storefronts, storefront_payment_accounts,
  storefront_fee_accounts, native_listings, native_listing_variants,
  order_lines, payment_attempts, storefront_fee_reservations,
  storefront_fee_events, inventory_reservations, refund_operations,
  stripe_event_inbox FROM PUBLIC;

DO $$
DECLARE role_name TEXT; table_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'storefronts','storefront_payment_accounts','storefront_fee_accounts',
        'native_listings','native_listing_variants','order_lines','payment_attempts',
        'storefront_fee_reservations','storefront_fee_events',
        'inventory_reservations','refund_operations','stripe_event_inbox'
      ] LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='asilum_app') THEN
    DROP POLICY IF EXISTS asilum_app_server_access ON storefronts;
    CREATE POLICY asilum_app_server_access ON storefronts FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON storefront_payment_accounts;
    CREATE POLICY asilum_app_server_access ON storefront_payment_accounts FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON storefront_fee_accounts;
    CREATE POLICY asilum_app_server_access ON storefront_fee_accounts FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON native_listings;
    CREATE POLICY asilum_app_server_access ON native_listings FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON native_listing_variants;
    CREATE POLICY asilum_app_server_access ON native_listing_variants FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON order_lines;
    CREATE POLICY asilum_app_server_access ON order_lines FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON payment_attempts;
    CREATE POLICY asilum_app_server_access ON payment_attempts FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON storefront_fee_reservations;
    CREATE POLICY asilum_app_server_access ON storefront_fee_reservations FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON storefront_fee_events;
    CREATE POLICY asilum_app_server_access ON storefront_fee_events FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON inventory_reservations;
    CREATE POLICY asilum_app_server_access ON inventory_reservations FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON refund_operations;
    CREATE POLICY asilum_app_server_access ON refund_operations FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS asilum_app_server_access ON stripe_event_inbox;
    CREATE POLICY asilum_app_server_access ON stripe_event_inbox FOR ALL TO asilum_app USING (true) WITH CHECK (true);

    GRANT SELECT, INSERT, UPDATE ON TABLE storefronts, storefront_payment_accounts,
      storefront_fee_accounts, native_listings, native_listing_variants,
      order_lines, payment_attempts, storefront_fee_reservations,
      inventory_reservations, refund_operations, stripe_event_inbox TO asilum_app;
    GRANT SELECT, INSERT ON TABLE storefront_fee_events TO asilum_app;
    GRANT USAGE, SELECT ON SEQUENCE storefront_fee_events_id_seq TO asilum_app;
  END IF;
END $$;

INSERT INTO app_schema_migrations (version, name)
  VALUES (62, 'native-storefront')
  ON CONFLICT (version) DO NOTHING;
