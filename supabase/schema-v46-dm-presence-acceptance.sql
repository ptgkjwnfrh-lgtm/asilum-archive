-- schema-v46-dm-presence-acceptance.sql
--
-- PRESENCE NEEDS AN ACCEPTED CONVERSATION.
--
-- v42 refused reactions on an unaccepted conversation, and said why: "a
-- reaction on an unaccepted request is a notification a stranger can send".
-- The same reasoning was never applied to the typing channel, which v41 had
-- shipped one migration earlier — so a stranger's knock carried a live
-- presence channel with it. That is trap 92 again, in the same subsystem it
-- was written about: WHEN A LAW GAINS A NEW ENFORCEMENT POINT, EVERY SURFACE
-- OLDER THAN THAT LAW HAS TO BE RE-CHECKED. v44 carried the BLOCK predicate
-- back to typing and stopped there; the ACCEPTANCE predicate was the other
-- half of the same omission.
--
-- The read side is worse than the write side and is fixed in lib/db/dm.js
-- alongside this: `peerActivity` returned the recipient's read position on a
-- REQUEST. Opening a knock to see who it was told the sender a real human had
-- opened it — the tracking-pixel confirmation that separates a live address
-- from a dead one, which is exactly what a stranger sending unsolicited mail
-- wants to learn. No trigger can stop a read; only the query can.
--
-- Serious findings of docs/history/dm-open-findings-2026-08-23.md.
--
-- P0003 is the code v42 uses for "this needs an accepted conversation", and
-- the same one v40 uses for the one-knock law. The refusal is a state, not a
-- fact about a person, so it does not need the collapsing lib/dm.js applies to
-- P0001/P0002.

CREATE OR REPLACE FUNCTION dm_guard_typing() RETURNS TRIGGER AS $$
DECLARE convo dm_conversations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dm_participants
     WHERE conversation_id = NEW.conversation_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'dm: not a participant' USING ERRCODE='42501';
  END IF;

  SELECT * INTO convo FROM dm_conversations WHERE id = NEW.conversation_id;

  -- v44: the same bidirectional predicate dm_guard_message and
  -- dm_guard_reaction already carry.
  IF EXISTS (
    SELECT 1 FROM dm_blocks
    WHERE (blocker_account_id = convo.lo_account_id AND blocked_account_id = convo.hi_account_id)
       OR (blocker_account_id = convo.hi_account_id AND blocked_account_id = convo.lo_account_id)
  ) THEN
    RAISE EXCEPTION 'dm: blocked' USING ERRCODE='P0001';
  END IF;

  -- NEW in v46: a knock is not a conversation yet.
  IF convo.state <> 'accepted' THEN
    RAISE EXCEPTION 'dm: presence needs an accepted conversation' USING ERRCODE='P0003';
  END IF;

  IF NEW.typing_until > now() + interval '30 seconds' THEN
    NEW.typing_until := now() + interval '30 seconds';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rows written before this law are presence inside unaccepted conversations
-- and must not outlive it. As with v44's sweep, this clears only what exists
-- when it runs — the trigger above is what covers everything after (trap 93).
DELETE FROM dm_typing t
 USING dm_conversations c
 WHERE t.conversation_id = c.id
   AND c.state <> 'accepted';

INSERT INTO app_schema_migrations (version, name)
VALUES (46, 'dm-presence-acceptance')
ON CONFLICT (version) DO NOTHING;
