-- schema-v45-dm-monotonic-time.sql
--
-- now() IS THE TRANSACTION START TIME, AND THE INBOX ORDERS ON IT.
--
-- Every DM timestamp defaulted to now(), which PostgreSQL fixes at BEGIN and
-- never moves again. The pair advisory lock is taken AFTER BEGIN, so a send
-- that waits for the lock — or merely for a busy pool between BEGIN and its
-- first statement — stamps a time from BEFORE it waited. The transaction that
-- committed ahead of it wrote a LATER time. The row that lands second holds
-- the earlier stamp.
--
-- That matters because last_activity_at is not decoration: listFolder's keyset
-- cursor is `(last_activity_at, id) < (cursor)` with `ORDER BY
-- last_activity_at DESC, id DESC`, built on the assumption that the key only
-- moves forward. When it moves backwards a conversation already returned above
-- the cursor falls below it, comes back on the next page, is dropped by the
-- panel's de-dupe, and takes a real conversation's slot with it. In the thread
-- itself, messages read newest-first BY ID while their displayed times run the
-- other way.
--
-- clock_timestamp() is the wall clock at the moment of the statement, so a row
-- written later reads later. It is the only one of PostgreSQL's five time
-- functions that is not frozen for the transaction.
--
-- Blocker 2 of docs/history/dm-open-findings-2026-08-23.md. The store's own bump is
-- fixed alongside this, in lib/db/dm.js: it now takes the created_at of the
-- message it just inserted, under GREATEST, so the conversation's activity
-- time is the newest message's time and can never walk backwards even if some
-- future writer stamps one for itself.
--
-- ALTER ... SET DEFAULT is idempotent by nature: it names an end state.
-- Existing rows are NOT rewritten. Their stamps are as accurate as they ever
-- were — at worst a few milliseconds early — and rewriting history to tidy a
-- default would destroy the record of when things actually happened.

ALTER TABLE dm_messages      ALTER COLUMN created_at       SET DEFAULT clock_timestamp();
ALTER TABLE dm_conversations ALTER COLUMN created_at       SET DEFAULT clock_timestamp();
ALTER TABLE dm_conversations ALTER COLUMN last_activity_at SET DEFAULT clock_timestamp();

-- The reaction and the block carry no ordering, but a reader comparing a
-- reaction's time with its message's should not see the reaction land first.
ALTER TABLE dm_reactions     ALTER COLUMN created_at       SET DEFAULT clock_timestamp();
ALTER TABLE dm_blocks        ALTER COLUMN created_at       SET DEFAULT clock_timestamp();

INSERT INTO app_schema_migrations (version, name)
VALUES (45, 'dm-monotonic-time')
ON CONFLICT (version) DO NOTHING;
