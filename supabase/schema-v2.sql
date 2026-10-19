-- ASILUM Supabase schema v2 — production marketplace foundation.
-- Idempotent: safe to run repeatedly (IF NOT EXISTS everywhere; RLS enabled,
-- no anon policies — these tables are server-accessed via DATABASE_URL only).
--
-- Table naming continues the constitution mapping:
--   products = items, mood_boards = boards, mood_board_items = board_items,
--   saved_products = saved_items (auth-linked, schema.sql).
-- This file EXTENDS items into the full product shape and adds the
-- ingestion / tagging / search / ticket / editorial / admin foundation.

-- ---- products (items) — external-source + availability + moderation fields ----
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_name TEXT;         -- 'seed' | 'ebay' | 'shopify' | …
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_product_id TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_product_url TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS designer_id UUID;         -- references designers(id), soft
ALTER TABLE items ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS material TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS fit TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS silhouette TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS decade TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE items ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
CREATE INDEX IF NOT EXISTS items_source ON items (source_name, source_product_id);
CREATE INDEX IF NOT EXISTS items_brand ON items (brand);

-- ---- product images (beyond the single items.img) ----
CREATE TABLE IF NOT EXISTS product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  source_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_product ON product_images (product_id, position);

-- ---- normalized product tags (items.tags jsonb stays the brain vector;
--      this is the typed, moderatable tag layer) ----
CREATE TABLE IF NOT EXISTS product_tags (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  tag_type TEXT NOT NULL DEFAULT 'aesthetic',
  -- aesthetic|silhouette|fit|fabric|color|era|decade|city|movie|influencer|
  -- designer_reference|runway_reference|mood|condition|search_reference|
  -- personalization|brand|category|subculture
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'system',   -- system|manual|mapping|moodboard|admin
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, tag, tag_type)
);
CREATE INDEX IF NOT EXISTS product_tags_tag ON product_tags (tag);
CREATE INDEX IF NOT EXISTS product_tags_product ON product_tags (product_id);

-- ---- search mappings (phrase → tags/terms; the cultural lexicon) ----
CREATE TABLE IF NOT EXISTS search_mappings (
  id BIGSERIAL PRIMARY KEY,
  search_phrase TEXT UNIQUE NOT NULL,
  mapped_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_type TEXT NOT NULL DEFAULT 'aesthetic',
  confidence REAL NOT NULL DEFAULT 0.7,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ---- search logs (ASILUM gets smarter through behavior) ----
CREATE TABLE IF NOT EXISTS search_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  query TEXT NOT NULL,
  interpreted JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_count INTEGER NOT NULL DEFAULT 0,
  clicked_product TEXT,
  saved_product TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_logs_at ON search_logs (created_at DESC);

-- ---- source connections + sync logs (adapter registry state) ----
CREATE TABLE IF NOT EXISTS source_connections (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',  -- disabled|awaiting_keys|awaiting_approval|enabled
  auth_type TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_sync_logs (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  items_seen INTEGER NOT NULL DEFAULT 0,
  items_upserted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',   -- running|ok|failed|disabled
  error TEXT
);

-- ---- availability checks (external items go stale; track it) ----
CREATE TABLE IF NOT EXISTS product_availability_checks (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT now(),
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  -- available|sold|removed|price_changed|source_unavailable|unknown
  previous_price NUMERIC,
  current_price NUMERIC,
  source_response_status INTEGER
);
CREATE INDEX IF NOT EXISTS availability_checks_product
  ON product_availability_checks (product_id, checked_at DESC);

-- ---- stylist outfits (persisted generated looks) ----
CREATE TABLE IF NOT EXISTS stylist_outfits (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  signature TEXT,
  genre TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_score REAL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stylist_outfits_user ON stylist_outfits (user_id, created_at DESC);

-- ---- purchase tickets (third-party purchase assistant; ASILUM never fulfills) ----
CREATE TABLE IF NOT EXISTS purchase_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_name TEXT,
  source_product_id TEXT,
  source_product_url TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  -- requested|checking_availability|available|unavailable|awaiting_user_consent|
  -- awaiting_payment_or_checkout|checkout_started|checkout_completed_on_source|
  -- canceled|failed|completed
  item_price_at_request NUMERIC,
  current_price_checked NUMERIC,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  shipping_name TEXT,
  shipping_address_id TEXT,
  user_consent_timestamp TIMESTAMPTZ,
  disclaimer_version TEXT,
  source_confirmation_status TEXT,
  source_order_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_tickets_user ON purchase_tickets (user_id, created_at DESC);

-- ---- editorial posts (user posts + ASILUM posts + linked articles) ----
CREATE TABLE IF NOT EXISTS editorial_posts (
  id BIGSERIAL PRIMARY KEY,
  author_id TEXT,
  author_handle TEXT,
  kind TEXT NOT NULL DEFAULT 'user',        -- user|asilum|article
  title TEXT,
  body TEXT,
  excerpt TEXT,
  image_url TEXT,
  external_url TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  designer_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS editorial_posts_at ON editorial_posts (created_at DESC);

-- ---- mood board uploads (the board teaches the database; honest analysis field) ----
CREATE TABLE IF NOT EXISTS mood_board_uploads (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  board_id TEXT,
  image_url TEXT,
  caption TEXT,
  source TEXT,
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{tag, tag_type, confidence}]
  style_notes TEXT,
  analyzed_by TEXT NOT NULL DEFAULT 'none', -- none|filename|manual|palette-v0|vision (future)
  idempotency_key TEXT,                     -- client retry dedupe (unique per user when present)
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mood_board_uploads_user ON mood_board_uploads (user_id, created_at DESC);
ALTER TABLE mood_board_uploads ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
-- Scoped per user (Day 13, #13 follow-up), matching purchase_tickets;
-- the same DDL runs lazily from lib/db/production.js for the live database.
CREATE UNIQUE INDEX IF NOT EXISTS mood_board_uploads_user_idem
  ON mood_board_uploads (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DROP INDEX IF EXISTS mood_board_uploads_idem;

-- ---- RLS: server-only tables (no anon policies on purpose; the app reaches
--      them through DATABASE_URL, which bypasses RLS as table owner) ----
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_availability_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stylist_outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mood_board_uploads ENABLE ROW LEVEL SECURITY;
