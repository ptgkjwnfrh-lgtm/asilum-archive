-- schema-v40-direct-messages.sql
--
-- Direct messages between two SIGNED-IN accounts. Text only: OWNER-DECISIONS
-- #3 keeps the media pipeline switched off until a CSAM provider, a designated
-- DMCA agent and named moderators exist, so no attachment table is created —
-- the consent STATE ships here, the pipeline does not.
--
-- Rationale and the full cut list: docs/history/dm-core-decisions-2026-08-23.md.
-- Keys are the bare auth uuid (ADR-002). Device identities cannot hold a row.
--
-- WHY THE LAWS ARE TRIGGERS AND NOT APPLICATION CHECKS. The route is not the
-- only writer: the admin desk, a migration and any future job write too. A law
-- that lives in one caller is a convention, and v38 is the local proof that a
-- convention silently fails.

-- ---------------------------------------------------------------------------
-- the pair
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordered pair. `lo < hi` makes a self-DM and a duplicate thread
  -- UNREPRESENTABLE rather than prevented: there is no second row to race for.
  lo_account_id UUID NOT NULL,
  hi_account_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested','accepted','declined')),
  opened_by UUID NOT NULL,
  -- One-way implications, never biconditionals. A CHECK of the form
  -- `(state='accepted') = (accepted_at IS NOT NULL)` forces accepted_at to be
  -- NULLED to leave the state, destroying the record that the recipient once
  -- agreed to hear from this person — material context in a harassment case.
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  CONSTRAINT dm_conversations_accepted_ck CHECK (state <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT dm_conversations_declined_ck CHECK (state <> 'declined' OR declined_at IS NOT NULL),
  CONSTRAINT dm_conversations_order_ck CHECK (lo_account_id < hi_account_id),
  CONSTRAINT dm_conversations_opener_ck CHECK (opened_by IN (lo_account_id, hi_account_id)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lo_account_id, hi_account_id)
);

-- ---------------------------------------------------------------------------
-- the two sides
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_participants (
  conversation_id UUID NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  -- The owner's ruling (23 Aug): first contact from a stranger lands in a
  -- REQUESTS queue, not the inbox. Per-side, because the initiator's own copy
  -- of an unaccepted thread belongs in their inbox — they chose to send it.
  folder TEXT NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox','requests','archived')),
  -- Unread is DERIVED from this against dm_messages. No counter: a counter
  -- needs an invariant nobody can violate, and drift downward hides messages
  -- while the badge stays quiet.
  last_read_message_id BIGINT NOT NULL DEFAULT 0,
  -- The per-conversation "receive images and videos" toggle, BOTH sides.
  -- Revocation is a timestamp rather than a flag flip so "was this attachment
  -- sent under a consent that still stands?" stays answerable after the fact.
  -- THE STATE IS THE LATER OF THE TWO STAMPS (corrected 23 Aug): a re-grant
  -- stamps a new grant and does NOT erase the revocation, which is what the
  -- first version did — see setMediaConsent in lib/db/dm.js. What is kept is
  -- the latest grant and the latest revocation, not every one of them; the
  -- append-only table ships with the pipeline.
  -- Nothing can send an attachment yet; this is the state the pipeline will
  -- enforce against, in the same transaction, when it ships.
  media_consent_at TIMESTAMPTZ,
  media_consent_revoked_at TIMESTAMPTZ,
  CONSTRAINT dm_participants_revoke_ck
    CHECK (media_consent_revoked_at IS NULL OR media_consent_at IS NOT NULL),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, account_id)
);

CREATE INDEX IF NOT EXISTS dm_participants_inbox
  ON dm_participants (account_id, folder);

-- ---------------------------------------------------------------------------
-- the messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_account_id UUID NOT NULL,
  body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  -- Idempotency. Resolved by SELECT before the insert is attempted, inside the
  -- pair lock — NOT by catching this conflict. The block trigger below fires
  -- BEFORE INSERT and would raise ahead of any unique violation, so a retried
  -- already-delivered message would be reported as undelivered.
  client_operation_id TEXT CHECK (client_operation_id IS NULL
    OR client_operation_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- Per-side hide and moderator redaction. Both must recompute anything
  -- derived from the message; there is no denormalized preview to go stale
  -- precisely because of that.
  hidden_for_recipient BOOLEAN NOT NULL DEFAULT false,
  redacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dm_messages_thread
  ON dm_messages (conversation_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS dm_messages_idem
  ON dm_messages (sender_account_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- blocking — PER ACCOUNT (owner ruling, 23 Aug)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker_account_id UUID NOT NULL,
  blocked_account_id UUID NOT NULL,
  -- 'manual' is a deliberate act; 'decline' is one the UI must SAY it is
  -- making. They are distinguished so a person can be shown their own
  -- decline-blocks and undo them — the red team found a decline installing a
  -- permanent block that an ambiguous refusal then hid from the person who
  -- installed it.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','decline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dm_blocks_not_self CHECK (blocker_account_id <> blocked_account_id),
  PRIMARY KEY (blocker_account_id, blocked_account_id)
);

-- ---------------------------------------------------------------------------
-- reachability — dms_open ONLY. No pinned account_kind: see the doc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_settings (
  account_id UUID PRIMARY KEY,
  dms_open BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- THE LAWS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dm_guard_message() RETURNS TRIGGER AS $$
DECLARE
  convo dm_conversations%ROWTYPE;
  recipient UUID;
  recipient_kind TEXT;
  recipient_open BOOLEAN;
  prior_count INT;
BEGIN
  SELECT * INTO convo FROM dm_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dm: no such conversation' USING ERRCODE='23503'; END IF;

  IF NEW.sender_account_id NOT IN (convo.lo_account_id, convo.hi_account_id) THEN
    RAISE EXCEPTION 'dm: sender is not a participant' USING ERRCODE='42501';
  END IF;
  recipient := CASE WHEN NEW.sender_account_id = convo.lo_account_id
                    THEN convo.hi_account_id ELSE convo.lo_account_id END;

  -- LAW 1 — a block stops delivery, in EITHER direction, per account.
  IF EXISTS (
    SELECT 1 FROM dm_blocks
    WHERE (blocker_account_id = recipient AND blocked_account_id = NEW.sender_account_id)
       OR (blocker_account_id = NEW.sender_account_id AND blocked_account_id = recipient)
  ) THEN
    RAISE EXCEPTION 'dm: blocked' USING ERRCODE='P0001';
  END IF;

  -- LAW 2 — a passport with DMs off receives nothing; a BUSINESS cannot be
  -- closed. The kind is read LIVE from account_kinds rather than from a pinned
  -- copy: a copy of a fact is a second fact, and the red team found four
  -- blockers in the pinned version. An account with no row is a passport,
  -- exactly as lib/accounts.js defaults.
  SELECT COALESCE(k.kind, 'passport') INTO recipient_kind
    FROM (SELECT recipient AS id) r
    LEFT JOIN account_kinds k ON k.account_id = r.id;
  SELECT COALESCE(s.dms_open, true) INTO recipient_open
    FROM (SELECT recipient AS id) r
    LEFT JOIN dm_settings s ON s.account_id = r.id;

  IF recipient_kind = 'passport' AND recipient_open IS FALSE THEN
    RAISE EXCEPTION 'dm: recipient is not accepting messages' USING ERRCODE='P0002';
  END IF;

  -- LAW 3 — one knock. An unaccepted conversation takes exactly one message
  -- from whoever opened it. COUNTED here rather than trusted from a
  -- denormalized column that a plain UPDATE could move.
  IF convo.state <> 'accepted' AND NEW.sender_account_id = convo.opened_by THEN
    SELECT count(*) INTO prior_count FROM dm_messages
      WHERE conversation_id = NEW.conversation_id
        AND sender_account_id = NEW.sender_account_id;
    IF prior_count >= 1 THEN
      RAISE EXCEPTION 'dm: one message until the request is accepted' USING ERRCODE='P0003';
    END IF;
  END IF;

  -- A declined conversation is closed to the person who was declined.
  IF convo.state = 'declined' AND NEW.sender_account_id = convo.opened_by THEN
    RAISE EXCEPTION 'dm: request was declined' USING ERRCODE='P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dm_guard_message_trg ON dm_messages;
CREATE TRIGGER dm_guard_message_trg
  BEFORE INSERT ON dm_messages
  FOR EACH ROW EXECUTE FUNCTION dm_guard_message();

-- A business may not be closed. Enforced on dm_settings itself so no path —
-- route, desk, migration — can write the forbidden state.
CREATE OR REPLACE FUNCTION dm_guard_settings() RETURNS TRIGGER AS $$
DECLARE actual_kind TEXT;
BEGIN
  IF NEW.dms_open IS FALSE THEN
    SELECT COALESCE(kind, 'passport') INTO actual_kind
      FROM account_kinds WHERE account_id = NEW.account_id;
    IF actual_kind = 'business' THEN
      RAISE EXCEPTION 'dm: a business cannot switch messages off' USING ERRCODE='P0004';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dm_guard_settings_trg ON dm_settings;
CREATE TRIGGER dm_guard_settings_trg
  BEFORE INSERT OR UPDATE ON dm_settings
  FOR EACH ROW EXECUTE FUNCTION dm_guard_settings();

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT; role_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['dm_conversations','dm_participants','dm_messages','dm_blocks','dm_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='asilum_app') THEN
    FOREACH t IN ARRAY ARRAY['dm_conversations','dm_participants','dm_blocks','dm_settings'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO asilum_app', t);
      EXECUTE format('DROP POLICY IF EXISTS asilum_app_server_access ON %I', t);
      EXECUTE format('CREATE POLICY asilum_app_server_access ON %I FOR ALL TO asilum_app USING (true) WITH CHECK (true)', t);
    END LOOP;
    -- Messages: no DELETE. Redaction and per-side hide are UPDATEs; removal is
    -- the owner role's, so "erased" and "hidden" stay distinguishable.
    GRANT SELECT, INSERT, UPDATE ON TABLE dm_messages TO asilum_app;
    GRANT USAGE, SELECT ON SEQUENCE dm_messages_id_seq TO asilum_app;
    DROP POLICY IF EXISTS asilum_app_server_access ON dm_messages;
    CREATE POLICY asilum_app_server_access ON dm_messages
      FOR ALL TO asilum_app USING (true) WITH CHECK (true);
    -- A block must be removable by the person who made it.
    GRANT DELETE ON TABLE dm_blocks TO asilum_app;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dm_conversations_lo_fk'
  ) THEN
    ALTER TABLE dm_conversations ADD CONSTRAINT dm_conversations_lo_fk
      FOREIGN KEY (lo_account_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE dm_conversations ADD CONSTRAINT dm_conversations_hi_fk
      FOREIGN KEY (hi_account_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

INSERT INTO app_schema_migrations (version, name)
VALUES (40, 'direct-messages')
ON CONFLICT (version) DO NOTHING;
