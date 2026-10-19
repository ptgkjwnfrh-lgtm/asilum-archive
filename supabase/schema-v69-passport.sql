-- schema-v69-passport.sql
--
-- THE PASSPORT'S ONBOARDING AND EXPLORATION ACTIVE (V.2 Blueprint, owner,
-- 17 Oct 2026: 14.2–14.3, 14.8–14.11, 17.2–17.4; owner ruling 18 Oct 2026,
-- CONSTITUTION A6 (7); slice 10c).
--
--   user_records.kind gains 'anchor'   an identity anchor: the passenger's own
--                                      answer to an onboarding question and the
--                                      tags it carries; never fades; only the
--                                      passenger designates or removes it (14.3)
--   asterisk_memory_preferences        gains exploration_off — the |A| in the
--                                      Info Dock turns exploration off and
--                                      passenger control beats reactivation (14.9)
--
-- Numbered 69 after v68 (identity, staged); v61 is the latest applied.
--
-- ROLLBACK: ALTER TABLE asterisk_memory_preferences DROP COLUMN IF EXISTS exploration_off;
--           (restore the v67 user_records kind check by hand: 'save','location','correction','draft','media');
--           DELETE FROM app_schema_migrations WHERE version = 69;
-- VERIFY:   SELECT count(*) FROM user_records WHERE kind='anchor';

ALTER TABLE user_records DROP CONSTRAINT IF EXISTS user_records_kind_check;
ALTER TABLE user_records ADD CONSTRAINT user_records_kind_check CHECK (kind IN ('save', 'location', 'correction', 'draft', 'media', 'anchor'));

ALTER TABLE asterisk_memory_preferences ADD COLUMN IF NOT EXISTS exploration_off BOOLEAN NOT NULL DEFAULT false;

INSERT INTO app_schema_migrations (version, name) VALUES (69, 'passport')
ON CONFLICT (version) DO NOTHING;
