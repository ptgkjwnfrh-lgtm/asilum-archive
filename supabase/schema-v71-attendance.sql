-- schema-v71-attendance.sql
--
-- SUBSTANTIATED ATTENDANCE (V.2 Blueprint, owner, 17 Oct 2026: 17.19; slice 12).
--
--   user_records.kind gains 'attendance'   "I was there": one record per dated
--                                          place, claimed until evidence already
--                                          on record substantiates it
--                                          (lib/passport/attendance.js)
--
-- Numbered 71 after v70 (money, staged); v61 is the latest applied.
--
-- ROLLBACK: (restore the v69 user_records kind check by hand:
--           'save','location','correction','draft','media','anchor');
--           DELETE FROM app_schema_migrations WHERE version = 71;
-- VERIFY:   SELECT count(*) FROM user_records WHERE kind='attendance';

ALTER TABLE user_records DROP CONSTRAINT IF EXISTS user_records_kind_check;
ALTER TABLE user_records ADD CONSTRAINT user_records_kind_check CHECK (kind IN ('save', 'location', 'correction', 'draft', 'media', 'anchor', 'attendance'));

INSERT INTO app_schema_migrations (version, name) VALUES (71, 'attendance')
ON CONFLICT (version) DO NOTHING;
