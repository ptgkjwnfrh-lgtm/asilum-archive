-- schema-v47-dm-unsend-locks-what-it-checks.sql
--
-- A GUARD THAT DOES NOT LOCK WHAT IT CHECKED HAS ONLY CHECKED THE PAST.
--
-- dm_guard_reaction refuses a reaction on an unsent message by reading the row
-- with a plain SELECT. A plain SELECT takes no lock, so between that read and
-- the reaction's COMMIT the message can be unsent by someone else — and it
-- was: the reaction survived on a tombstone, permanently, visible to the
-- author of the message they had just withdrawn, removable only by the person
-- who left it.
--
-- SELECT ... FOR SHARE takes a row-level share lock, which is exactly the
-- statement of intent this guard needs: *this row must not change underneath
-- me before I commit*. The unsend's UPDATE needs an exclusive lock on the same
-- row, so it now waits for the reaction to land and then removes it in the
-- same transaction (lib/db/dm.js, this PR). The two orderings that used to
-- produce an orphan produce the same clean end state instead.
--
-- Serious finding of docs/history/dm-open-findings-2026-08-23.md. It is the same
-- lesson as v40's idempotency ordering, one table over: the ordering of a
-- check against the write it guards IS the law, not an implementation detail.
--
-- Nothing else in the function changes. It is recreated whole because that is
-- how this schema does it — a function is replaced, never patched.

CREATE OR REPLACE FUNCTION dm_guard_reaction() RETURNS TRIGGER AS $$
DECLARE convo dm_conversations%ROWTYPE; msg dm_messages%ROWTYPE;
BEGIN
  -- v47: FOR SHARE. The unsend cannot slip between this read and the commit.
  SELECT * INTO msg FROM dm_messages WHERE id = NEW.message_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dm: no such message' USING ERRCODE='23503'; END IF;
  SELECT * INTO convo FROM dm_conversations WHERE id = msg.conversation_id;

  IF NEW.account_id NOT IN (convo.lo_account_id, convo.hi_account_id) THEN
    RAISE EXCEPTION 'dm: not a participant' USING ERRCODE='42501';
  END IF;

  -- A reaction on an unaccepted request is a notification past law 3.
  IF convo.state <> 'accepted' THEN
    RAISE EXCEPTION 'dm: reactions need an accepted conversation' USING ERRCODE='P0003';
  END IF;

  -- Blocking holds here too, in both directions. A block that stops words but
  -- allows a heart every few minutes is not a block.
  IF EXISTS (
    SELECT 1 FROM dm_blocks
    WHERE (blocker_account_id = convo.lo_account_id AND blocked_account_id = convo.hi_account_id)
       OR (blocker_account_id = convo.hi_account_id AND blocked_account_id = convo.lo_account_id)
  ) THEN
    RAISE EXCEPTION 'dm: blocked' USING ERRCODE='P0001';
  END IF;

  -- Nothing to react to once it is gone.
  IF msg.unsent_at IS NOT NULL OR msg.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'dm: that message is gone' USING ERRCODE='P0005';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Orphans left by the old ordering: a reaction on a message that is already
-- gone. Cleared once here; the guard above and the transaction in the store
-- are what stop new ones (trap 93 — a migration DELETE sweeps only what
-- exists when it runs).
DELETE FROM dm_reactions r
 USING dm_messages m
 WHERE m.id = r.message_id
   AND (m.unsent_at IS NOT NULL OR m.redacted_at IS NOT NULL);

INSERT INTO app_schema_migrations (version, name)
VALUES (47, 'dm-unsend-locks-what-it-checks')
ON CONFLICT (version) DO NOTHING;
