-- schema-v57-wire-composition.sql
--
-- THE ONE WIRE COMPOSER (V.2 brief §6, owner, 1 Oct 2026). A transmission
-- is no longer only text with a title: it has a KIND (transmission | post |
-- video), a LAYOUT when it is a post (single | carousel | fragment | expose
-- | event) and ATTACHMENTS — images in the "wire" bucket, tagged pieces
-- (snapshots of resolved listings), one event (a snapshot of the map's
-- record), one link (a plain-text preview snapshot), the exposé's text
-- layers as structured text with normalised positions (never a flattened
-- picture), and an author-written alt. Legacy rows read as `transmission`
-- (or `post` where image_url was set — the read path decides).
--
-- Numbered 57: v54/v55 are on other open branches; v56 is the eBay
-- feed publication on market/ebay-bulk-feed.
--
-- ROLLBACK: ALTER TABLE editorial_posts DROP COLUMN IF EXISTS post_kind,
-- DROP COLUMN IF EXISTS layout, DROP COLUMN IF EXISTS attachments;
-- DELETE FROM app_schema_migrations WHERE version = 57;
-- VERIFY: SELECT post_kind, layout, count(*) FROM editorial_posts GROUP BY 1, 2;

ALTER TABLE editorial_posts ADD COLUMN IF NOT EXISTS post_kind TEXT NOT NULL DEFAULT 'transmission';
ALTER TABLE editorial_posts ADD COLUMN IF NOT EXISTS layout TEXT;
ALTER TABLE editorial_posts ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_post_kind_check') THEN
    ALTER TABLE editorial_posts ADD CONSTRAINT editorial_posts_post_kind_check CHECK (post_kind IN ('transmission', 'post', 'video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_layout_check') THEN
    ALTER TABLE editorial_posts ADD CONSTRAINT editorial_posts_layout_check CHECK (layout IS NULL OR layout IN ('single', 'carousel', 'fragment', 'expose', 'event'));
  END IF;
END $$;
-- a legacy row with an image was a post all along
UPDATE editorial_posts SET post_kind = 'post', layout = COALESCE(layout, 'single') WHERE image_url IS NOT NULL AND post_kind = 'transmission';

INSERT INTO app_schema_migrations (version, name) VALUES (57, 'wire-composition')
ON CONFLICT (version) DO NOTHING;
