-- schema-v48-dm-unsend-names-its-actor.sql
--
-- "UNSEND IS THE SENDER'S ACT AND NOBODY ELSE'S" — AND NOW THE DATABASE SAYS SO.
--
-- v42's header made that claim and the trigger enforced only the ONE-WAY half:
-- the body must be cleared, unsent_at cannot be un-set, an unsent body cannot
-- come back. Who did it was checked in exactly one place — the
-- `AND sender_account_id = $2` in unsendMessage's WHERE clause.
--
-- That is the shape docs/history/dm-core-decisions-2026-08-23.md rules out in as many
-- words: "a law that lives in one caller is a convention", and "the route is
-- not the only writer: the admin desk, a migration and any future job write
-- too." `asilum_app` holds UPDATE on dm_messages, so nothing at the database
-- level stopped a moderator tool or a cleanup migration from running
-- `UPDATE dm_messages SET body=NULL, unsent_at=now()` on somebody else's
-- message — and readThread would then report `unsent: true, redacted: false`,
-- telling the recipient the AUTHOR withdrew their words when a moderator had
-- removed them. The same file's header calls those "different facts"; the
-- missing check let the wrong one be written.
--
-- MINOR finding of docs/history/dm-open-findings-2026-08-23.md. No second writer
-- exists in the tree today — `redacted_at` is read in four places and written
-- by nothing — which is exactly why this is cheap to close NOW, before one
-- does.
--
-- HOW THE ACTOR IS NAMED. A trigger cannot see the application's idea of "who
-- is asking": every connection is `asilum_app`. So the writer states it, in
-- the same transaction, and the trigger requires the statement to be there and
-- to match. `set_config(..., true)` is transaction-local, so it cannot leak to
-- the next borrower of a pooled connection — which is the failure mode a
-- session-level GUC would have.
--
-- The check is scoped STRICTLY to the NULL -> NOT NULL unsend transition. The
-- trigger is BEFORE UPDATE on the whole table, so a future moderation write
-- (redacted_at) or per-side hide (hidden_for_recipient) must not be forced to
-- name an unsender it does not have. Those paths are untouched.

CREATE OR REPLACE FUNCTION dm_guard_unsend() RETURNS TRIGGER AS $$
DECLARE actor TEXT;
BEGIN
  IF NEW.unsent_at IS NOT NULL AND OLD.unsent_at IS NULL THEN
    IF NEW.body IS NOT NULL THEN
      RAISE EXCEPTION 'dm: unsending must clear the body' USING ERRCODE='P0006';
    END IF;

    -- NEW in v48: the withdrawal must be attributable, and to its author.
    actor := current_setting('asilum.dm_actor', true);
    IF actor IS NULL OR actor = '' OR actor::uuid <> OLD.sender_account_id THEN
      RAISE EXCEPTION 'dm: an unsend is the sender''s act' USING ERRCODE='42501';
    END IF;
  END IF;
  IF OLD.unsent_at IS NOT NULL AND NEW.unsent_at IS NULL THEN
    RAISE EXCEPTION 'dm: an unsend cannot be undone' USING ERRCODE='P0006';
  END IF;
  IF OLD.unsent_at IS NOT NULL AND NEW.body IS NOT NULL THEN
    RAISE EXCEPTION 'dm: an unsent body cannot come back' USING ERRCODE='P0006';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dm_guard_unsend_trg ON dm_messages;
CREATE TRIGGER dm_guard_unsend_trg
  BEFORE UPDATE ON dm_messages
  FOR EACH ROW EXECUTE FUNCTION dm_guard_unsend();

INSERT INTO app_schema_migrations (version, name)
VALUES (48, 'dm-unsend-names-its-actor')
ON CONFLICT (version) DO NOTHING;
