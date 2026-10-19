-- supabase/schema-v27-transmission-lifecycle.sql
-- Transmission edit + delete (owner directive, 14 Aug 2026
-- backlog 1): the author — and only the author, server-verified — may
-- edit or retire their own transmission.
--
-- Deletion is a SOFT moderation state (moderation_status='deleted'):
-- the row survives as record, every read path already refuses
-- non-visible rows (listEditorialPosts filters on 'visible'), and the
-- post's permalink honestly 404s from the moment of deletion. No new
-- status vocabulary constraint exists on editorial_posts (v2 left the
-- column free TEXT), so 'deleted' needs no DDL here.
--
-- Editing stamps edited_at — server truth for the floor's "edited"
-- honesty label. A transmission that was touched says so; one that
-- wasn't carries NULL and no label. That is the whole column.
--
-- Grants: asilum_app already holds table-level UPDATE on editorial_posts
-- (v11), and no later migration revokes it (checked v12–v26; the only
-- editorial-adjacent revoke is brand_case_events in v19). Nothing to
-- grant here.
--
-- Rollback: ALTER TABLE editorial_posts DROP COLUMN edited_at;
-- (deleted rows keep their status — reverting visibility is a data
-- decision, not a schema one).

ALTER TABLE editorial_posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

INSERT INTO app_schema_migrations (version,name)
  VALUES (27, 'transmission-lifecycle')
  ON CONFLICT (version) DO NOTHING;
