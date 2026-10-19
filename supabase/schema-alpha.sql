-- supabase/schema-alpha.sql
-- STAGED, NOT APPLIED. Future tables for the ASILUM Alpha Learning Brain.
-- The live app runs on lib/db's tables (see supabase/schema.sql for the
-- MVP set). Apply these only when the feature that writes them ships —
-- empty tables invite code that pretends they're populated.
-- Shapes follow the entity model in lib/ALPHA-BRAIN.md. All user-owned tables get RLS like schema.sql.

-- user_events GRADUATED (July 8, Day 5): now part of schema-v1-brain.sql.

create table if not exists product_images (
  id bigint generated always as identity primary key,
  product_id text not null,
  url text not null,
  kind text default 'product',     -- product | runway | editorial | detail
  analysis jsonb                   -- ImageAnalysis, null until vision runs
);

create table if not exists embeddings (
  id text primary key,             -- "<space>:<owner_id>"
  owner_id text not null,          -- product / user / board / image ref
  owner_kind text not null,        -- product | user | board | image
  space text not null,             -- tag-v0 | visual-v1 | text-v1
  provider text,
  vector jsonb,                    -- swap to pgvector when provider ships
  updated_at timestamptz not null default now()
);
create index if not exists embeddings_owner on embeddings (owner_kind, owner_id);

create table if not exists fit_analyses (
  id bigint generated always as identity primary key,
  user_id text not null,
  image_ref text not null,
  result jsonb,                    -- FitAnalysis; confidence-scored, never certain
  at timestamptz not null default now()
);

create table if not exists brands (
  id text primary key,
  name text not null,
  tags jsonb not null default '{}',
  designers jsonb default '[]',
  sources jsonb default '[]',
  rising_score real
);

create table if not exists external_accounts (
  user_id text not null,
  platform text not null,
  status text not null default 'connected',   -- opt-in only; revocable
  scopes jsonb not null default '[]',
  connected_at timestamptz not null default now(),
  primary key (user_id, platform)
  -- tokens go in a separate service-role-only secrets store, never here
);

create table if not exists taste_clusters (
  id text primary key,
  centroid jsonb not null,
  label text,
  size int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists user_similarity (
  uid_a text not null,
  uid_b text not null,
  similarity real not null,
  updated_at timestamptz not null default now(),
  primary key (uid_a, uid_b)
);

create table if not exists music_profiles (
  user_id text primary key,
  artists jsonb not null default '[]',
  genres jsonb not null default '[]',
  tags jsonb not null default '{}',
  coverage int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists board_profiles (
  board_id text primary key,
  tags jsonb not null default '{}',
  items int not null default 0,
  clusters jsonb default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists feed_items (
  id bigint generated always as identity primary key,
  user_id text not null,
  source text not null,            -- lib/feed FEED_SOURCES
  ref_id text not null,
  score real not null,
  reasons jsonb not null default '[]',
  served_at timestamptz
);
create index if not exists feed_items_user on feed_items (user_id, served_at desc);

create table if not exists recommendations (
  id bigint generated always as identity primary key,
  user_id text not null,
  kind text not null,              -- the recommender's function name
  payload jsonb not null,
  created_at timestamptz not null default now()
);
