-- schema-v36-hotlist-program.sql
-- P2–P4 of the hotlist program (owner build order, 20 Aug 2026;
-- docs/history/hotlist-program-spec-2026-08-20.md §4):
--   booth_visits            — THE separate attribution channel: who reached
--                             which booth on their hotlist, when. A 15% is
--                             chargeable ONLY on orders this channel proves.
--   business_accounts       — program membership + rent-paid-through (P3 is
--                             manual first cohort; these two columns are its
--                             state).
--   hotlist_rent_payments   — append-only rent ledger the admin desk writes.
--   orders.hotlist_attribution — the stamp at order creation: the booth
--                             source whose visit (within the 7-day window)
--                             preceded this order. NULL = base sale.
--
-- Rollback:
--   ALTER TABLE orders DROP COLUMN hotlist_attribution;
--   DROP TABLE IF EXISTS hotlist_rent_payments;
--   ALTER TABLE business_accounts DROP COLUMN hotlist_paid_through;
--   ALTER TABLE business_accounts DROP COLUMN hotlist_member;
--   DROP TABLE IF EXISTS booth_visits;
--   DELETE FROM app_schema_migrations WHERE version = 36;

CREATE TABLE IF NOT EXISTS booth_visits (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  source_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booth_visits_user_source
  ON booth_visits (user_id, source_name, created_at DESC);

ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS hotlist_member BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS hotlist_paid_through DATE;

CREATE TABLE IF NOT EXISTS hotlist_rent_payments (
  id           BIGSERIAL PRIMARY KEY,
  account_id   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  actor        TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hotlist_rent_account
  ON hotlist_rent_payments (account_id, created_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS hotlist_attribution TEXT;

ALTER TABLE booth_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotlist_rent_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asilum_app') THEN
    GRANT SELECT, INSERT ON booth_visits TO asilum_app;             -- append-only
    GRANT USAGE, SELECT ON SEQUENCE booth_visits_id_seq TO asilum_app;
    DROP POLICY IF EXISTS asilum_app_server_access ON booth_visits;
    CREATE POLICY asilum_app_server_access ON booth_visits
      FOR ALL TO asilum_app USING (true) WITH CHECK (true);

    GRANT SELECT, INSERT ON hotlist_rent_payments TO asilum_app;    -- append-only
    GRANT USAGE, SELECT ON SEQUENCE hotlist_rent_payments_id_seq TO asilum_app;
    DROP POLICY IF EXISTS asilum_app_server_access ON hotlist_rent_payments;
    CREATE POLICY asilum_app_server_access ON hotlist_rent_payments
      FOR ALL TO asilum_app USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO app_schema_migrations (version, name)
  VALUES (36, 'hotlist-program')
  ON CONFLICT (version) DO NOTHING;
