// lib/db/dm/settings.js — A PERSON'S OWN CONTROLS.
//
// Three switches and the follow test the send path consults.
//
// setDmsOpen is not available to everyone: a passport may close its DMs, a
// BUSINESS may not. A shop that can be reached is the deal a business account
// takes; the refusal is a v40 trigger, and this layer surfaces its SQLSTATE
// rather than pre-checking the rule.
//
// Media consent is stored per participant and read on the export and render
// paths, so withdrawing it takes effect on the next read rather than needing
// anything to be rewritten.

import { MessageRefused, accountId, pool, stageCApplied } from "./core.js";

/**
 * The blanket switch. A business is refused by the v40 trigger (P0004), not by
 * a check here — the route is not the only writer.
 */
/**
 * BOTH SETTINGS, ONE TRANSACTION.
 *
 * The route used to apply these as two separate autocommit statements and then
 * read them back. A business closing its door is refused by the v40 trigger
 * (P0004) — and by then the activity-signals write had already committed, so
 * the caller got a 409 while half of what they asked for stood. The refusal
 * body carried no state either, so the client could not learn which half.
 *
 * Two writes the caller made in one gesture are one act. Either both stand or
 * neither does.
 */
export async function setDmSettings(meRaw, { activitySignals = null, dmsOpen = null, profileSharing = null } = {}) {
  const me = accountId(meRaw);
  if (activitySignals === null && dmsOpen === null && profileSharing === null) return;
  const p = await pool();
  // STAGE C: the sharing switch needs its v59 column; refused by name, and
  // BEFORE the transaction so the other two halves are not half-applied.
  if (profileSharing !== null && !(await stageCApplied(p))) throw new MessageRefused("DM_SCHEMA", "profile sharing needs schema v59 applied");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    if (profileSharing !== null) {
      await client.query(
        `INSERT INTO dm_settings (account_id, profile_sharing) VALUES ($1,$2)
         ON CONFLICT (account_id) DO UPDATE SET profile_sharing=EXCLUDED.profile_sharing,
                                                updated_at=clock_timestamp()`,
        [me, Boolean(profileSharing)]);
    }
    if (activitySignals !== null) {
      await client.query(
        `INSERT INTO dm_settings (account_id, activity_signals) VALUES ($1,$2)
         ON CONFLICT (account_id) DO UPDATE SET activity_signals=EXCLUDED.activity_signals,
                                                updated_at=clock_timestamp()`,
        [me, Boolean(activitySignals)]);
    }
    if (dmsOpen !== null) {
      await client.query(
        `INSERT INTO dm_settings (account_id, dms_open) VALUES ($1,$2)
         ON CONFLICT (account_id) DO UPDATE SET dms_open=EXCLUDED.dms_open,
                                                updated_at=clock_timestamp()`,
        [me, Boolean(dmsOpen)]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "P0004") throw new MessageRefused("P0004", error.message);
    throw error;
  } finally {
    client.release();
  }
}

/** The single-setting primitive. The route writes both together through
 * `setDmSettings` above; this is what the store tests and any server-side
 * caller with one thing to change address. */
export async function setDmsOpen(meRaw, open) {
  const me = accountId(meRaw);
  const p = await pool();
  try {
    await p.query(
      `INSERT INTO dm_settings (account_id, dms_open) VALUES ($1,$2)
       ON CONFLICT (account_id) DO UPDATE SET dms_open=EXCLUDED.dms_open, updated_at=now()`,
      [me, Boolean(open)]);
  } catch (error) {
    if (error.code === "P0004") throw new MessageRefused("P0004", error.message);
    throw error;
  }
}

export async function readDmsOpen(meRaw) {
  const me = accountId(meRaw);
  const p = await pool();
  const r = await p.query(`SELECT dms_open FROM dm_settings WHERE account_id=$1`, [me]);
  return r.rows.length ? r.rows[0].dms_open : true;
}

/**
 * The per-conversation "receive images and videos" toggle. BOTH sides hold
 * one; nothing reads them yet because no attachment can be sent.
 *
 * THE STATE IS THE LATER OF THE TWO STAMPS, and neither one erases the other.
 *
 * The re-grant used to do `media_consent_at = COALESCE(media_consent_at,
 * now()), media_consent_revoked_at = NULL` — which kept the ORIGINAL grant
 * time and deleted the revocation outright. So a consent granted in March,
 * revoked in April and granted again in May read as "granted in March, never
 * revoked": the one question the two columns exist to answer — *was this
 * attachment sent under a consent that still stood?* — was answered wrongly,
 * and the schema comment and this docstring both claimed the opposite. Law 4
 * is the whole deliverable here, since OWNER-DECISIONS #3 ships the state and
 * no pipeline, and it was lossy.
 *
 * A grant now stamps a NEW grant, a revocation stamps a revocation, and
 * whichever is later is the answer. WHAT THIS DOES NOT DO, stated so nobody
 * reads more into it: it keeps the latest grant and the latest revocation, not
 * every one of them. A full history needs an append-only table, and building
 * storage for a pipeline that does not exist is what the core cut on purpose —
 * `docs/history/dm-core-decisions-2026-08-23.md`. When attachments ship, that table
 * ships with them, and these two columns become its first two rows.
 */
export async function setMediaConsent(meRaw, conversationId, allow) {
  const me = accountId(meRaw);
  const p = await pool();
  const r = await p.query(
    allow
      ? `UPDATE dm_participants
            SET media_consent_at = clock_timestamp()
          WHERE conversation_id=$1 AND account_id=$2
            AND (media_consent_at IS NULL
                 OR (media_consent_revoked_at IS NOT NULL
                     AND media_consent_revoked_at >= media_consent_at))
          RETURNING 1`
      : `UPDATE dm_participants
            SET media_consent_revoked_at = clock_timestamp()
          WHERE conversation_id=$1 AND account_id=$2
            AND media_consent_at IS NOT NULL
            AND (media_consent_revoked_at IS NULL
                 OR media_consent_revoked_at < media_consent_at)
          RETURNING 1`,
    [conversationId, me]);
  return r.rowCount > 0;
}

/** Given = granted, and not revoked since. The later stamp wins. */
export function mediaConsentGiven(grantedAt, revokedAt) {
  if (!grantedAt) return false;
  if (!revokedAt) return true;
  return new Date(revokedAt) < new Date(grantedAt);
}

/**
 * DOES THE RECIPIENT ALREADY FOLLOW THE SENDER?
 *
 * `openConversation`'s `knownToRecipient` option, the `foldersForNewConversation`
 * rule and the unit test asserting "a thread you asked for should not arrive as
 * a request" all shipped with NO CALLER — the route always took the `false`
 * default. So the suite reported the rule as covered while nothing could
 * produce it, and someone who explicitly follows you had their first message
 * land in your REQUESTS queue, previewless, under an ACCEPT / DECLINE + BLOCK
 * prompt about a person you chose to follow. A green test over an unreachable
 * path is worse than no test.
 *
 * `user_follows` predates the DM subsystem and keys on the IDENTITY STRING
 * (`sb-<uuid>`), not the bare account uuid ADR-002 requires here, and its
 * target for `kind='user'` is a HANDLE. Both conversions happen in this one
 * query so no caller has to know them — and it FAILS CLOSED: no row, no
 * handle, no published room all mean `false`, which is the behaviour that
 * shipped.
 *
 * This only decides WHICH FOLDER the knock lands in. It does not touch the
 * one-knock law: the conversation is still `requested`, still one message
 * until they reply, and still needs accepting. A follow moves the knock; it
 * does not open the door.
 */
export async function recipientFollowsSender(recipientRaw, senderRaw) {
  const recipient = accountId(recipientRaw);
  const sender = accountId(senderRaw);
  const p = await pool();
  const r = await p.query(
    `SELECT 1
       FROM profile_rooms r
       JOIN user_follows f
         ON f.kind = 'user'
        AND lower(f.target) = lower(r.handle)
        AND f.user_id = 'sb-' || $1
      WHERE r.account_id = $2
        AND r.handle IS NOT NULL
      LIMIT 1`,
    [recipient, sender]);
  return r.rows.length > 0;
}

/** My own switch: may others share my profile into their threads? */
export async function readProfileSharing(meRaw) {
  const me = accountId(meRaw);
  const p = await pool();
  if (!(await stageCApplied(p))) return true;
  const r = await p.query(`SELECT profile_sharing FROM dm_settings WHERE account_id = $1`, [me]);
  return r.rows.length ? r.rows[0].profile_sharing !== false : true;
}
