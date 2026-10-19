// lib/db/dm/people.js — WHO IS ON THE OTHER END, AND WHO MAY BE ADDRESSED.
//
// THE UUID NEVER LEAVES THE SERVER. Addressing takes a HANDLE; peerOf and
// handlesFor exist so a thread can show who you are talking to without the
// panel ever holding an account id. That is a rule, not a style: a uuid on the
// wire is a durable identifier for a person who only agreed to a handle.
//
// findAddressees searches PUBLISHED profile rooms only — being reachable is
// something a person opts into by publishing, not a default that comes with
// having an account.

import { ACCOUNT_UUID, accountId, pool } from "./core.js";
import { PROFILE_CARD_STATEMENT_MAX } from "../../dm.js";

/**
 * The other account in a conversation I am in — or null if I am not in it.
 *
 * WHY THIS EXISTS. lib/dm.js says "a refusal caused by the CALLER'S OWN block
 * is NOT vague ... Yours is always explained, and always with the undo." The
 * route could only honour that on ONE path: first contact by handle, where it
 * happened to have resolved the other person already. Every send into an
 * existing conversation — which is every send after the first, and every send
 * from the thread view — and every reaction had nobody to ask about, so the
 * caller's own block collapsed to "this person is not reachable right now."
 *
 * That is the exact withholding the ambiguity rule was written to prevent,
 * aimed at the only person entitled to the answer, with the undo hidden. The
 * decliner is the ONLY person this product lets create a block, so they were
 * also the most likely person to hit it.
 */
export async function peerOf(meRaw, conversationId) {
  const me = accountId(meRaw);
  const id = String(conversationId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const p = await pool();
  const r = await p.query(
    `SELECT CASE WHEN c.lo_account_id = $1 THEN c.hi_account_id ELSE c.lo_account_id END AS other_id
       FROM dm_conversations c
      WHERE c.id = $2::uuid AND $1 IN (c.lo_account_id, c.hi_account_id)`, [me, id]);
  return r.rows.length ? r.rows[0].other_id : null;
}

/**
 * The same question, asked by HANDLE — which is the form the send path has
 * when `resolveAddressee` has just refused to resolve it.
 *
 * Resolved against profile_rooms directly, like unblockByHandle, because
 * resolveAddressee excludes exactly the people this is about. It reveals
 * nothing the caller does not already have: it answers only about a
 * conversation THEY opened.
 */
export async function pendingKnockToHandle(meRaw, handleRaw) {
  const me = accountId(meRaw);
  const handle = String(handleRaw || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,24}$/.test(handle)) return false;
  const p = await pool();
  const r = await p.query(
    `SELECT 1
       FROM profile_rooms r
       JOIN dm_conversations c
         ON c.lo_account_id = LEAST($1, r.account_id)
        AND c.hi_account_id = GREATEST($1, r.account_id)
      WHERE r.handle = $2 AND c.opened_by = $1 AND c.state <> 'accepted'
      LIMIT 1`, [me, handle]);
  return r.rows.length > 0;
}

/**
 * Is this caller the opener of a knock that was never accepted?
 *
 * The one question that decides whether a refusal may keep the recipient's
 * decision private. `state <> 'accepted'` covers both 'requested' (ignored)
 * and 'declined' — which is the point: the opener must not be able to tell
 * them apart. Membership is implicit in `opened_by = me`.
 */
export async function pendingKnockBy(meRaw, conversationId) {
  const me = accountId(meRaw);
  const id = String(conversationId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const p = await pool();
  const r = await p.query(
    `SELECT 1 FROM dm_conversations
      WHERE id = $2::uuid AND opened_by = $1 AND state <> 'accepted'`, [me, id]);
  return r.rows.length > 0;
}

/** The same answer, reached from a message id — what the reaction path holds. */
export async function peerOfMessage(meRaw, messageId) {
  const me = accountId(meRaw);
  const id = Math.trunc(Number(messageId)) || 0;
  if (!id) return null;
  const p = await pool();
  const r = await p.query(
    `SELECT CASE WHEN c.lo_account_id = $1 THEN c.hi_account_id ELSE c.lo_account_id END AS other_id
       FROM dm_messages m
       JOIN dm_conversations c ON c.id = m.conversation_id
      WHERE m.id = $2::bigint AND $1 IN (c.lo_account_id, c.hi_account_id)`, [me, id]);
  return r.rows.length ? r.rows[0].other_id : null;
}

/**
 * Find people you can write to.
 *
 * THE SEARCH DOMAIN IS PUBLISHED PROFILE ROOMS, AND THAT IS THE WHOLE
 * ENUMERATION ANSWER. A DM search over "all accounts" turns the product into a
 * directory of everyone who ever signed up, and there is no rate limit that
 * makes that acceptable — it is the shape that is wrong, not the speed. Here,
 * appearing in a search result is something a person DID: they published a
 * room under a handle. Someone who never published is not hidden by a policy
 * that could be relaxed later; they are absent from the table this reads.
 *
 * Three exclusions here, and the reason each one is not optional:
 *   - MYSELF. A self-conversation is unrepresentable one layer down; offering
 *     it here would only produce a refusal.
 *   - ANYONE **I** HAVE BLOCKED. My own state, which I already know — hiding
 *     it tells me nothing I did not do myself.
 *   - HIDDEN OR UNDER-REVIEW ROOMS. The same for every caller, so absence
 *     carries no fact about the person asking. Moderation applies to discovery
 *     first.
 *
 * A CLOSED DOOR IS NO LONGER AN EXCLUSION EITHER, and that is a correction to
 * the ruling above rather than a new idea. Listing people who blocked me while
 * hiding people whose door is shut made the pair readable: present in search
 * AND refused on send could only mean a block, because a shut door would have
 * removed them from the search. The refusal collapses P0001 and P0002 on
 * purpose; the two surfaces have to agree for that collapse to be worth
 * anything, and it was the search that disagreed.
 *
 * The cost, stated: a search result you cannot write to. Their room is a public
 * page either way, so nothing is revealed that was not already published — and
 * the alternative is a collapse that only looks like one.
 *
 * WHAT IS DELIBERATELY *NOT* EXCLUDED: SOMEONE WHO BLOCKED **ME**.
 *
 * It used to be, and that made search a block detector. Absence was
 * caller-specific, so a harasser could search a handle from their own account
 * and from a throwaway and compare: present there, gone here, therefore the
 * block landed. For a business it took no second account at all — a business
 * cannot close its door, so vanishing could only mean a block. Detecting the
 * block is the whole cost driver in ban evasion: someone who cannot tell
 * whether it landed wastes effort, and someone who gets a definitive read
 * re-registers immediately.
 *
 * That defeated the ambiguity built one file over on purpose (lib/dm.js:
 * P0001 and P0002 collapse "they blocked you" and "their door is shut" into
 * one sentence "precisely because distinguishing them tells a stranger which
 * one it was"). I wrote that rule and then broke it here three PRs later.
 *
 * Listing them costs nothing, because the exclusion never enforced anything:
 * a profile room IS a public page, so the handle was already visible; and
 * `resolveAddressee` below KEEPS the bidirectional predicate, so addressing
 * them still fails — with the same collapsed refusal, from the same branch,
 * as a closed door or a handle that never existed. Nothing is created; there
 * is no thread, no request, no notification. The searcher learns exactly what
 * they learn about everyone they cannot write to: nothing.
 *
 * Ruling made 23 Aug under the owner's autonomy window and recorded in
 * docs/history/dm-core-decisions-2026-08-23.md. To reverse it, restore the second arm
 * of the NOT EXISTS below — and re-read that note first, because the reversal
 * restores the oracle.
 */
export async function findAddressees(meRaw, query, { limit = 8 } = {}) {
  const me = accountId(meRaw);
  const q = String(query || "").trim().toLowerCase();
  // Two characters minimum, and a PREFIX match. A one-character query walks
  // the alphabet in twenty-six requests; a substring match walks it in one.
  if (q.length < 2 || !/^[a-z0-9-]{2,24}$/.test(q)) return [];
  const n = Math.max(1, Math.min(10, Math.trunc(Number(limit)) || 8));

  const p = await pool();
  const r = await p.query(
    `SELECT r.account_id, r.handle,
            COALESCE(k.kind, 'passport') AS kind
       FROM profile_rooms r
       LEFT JOIN account_kinds k ON k.account_id = r.account_id
      WHERE r.published = true
        AND r.moderation_status = 'visible'
        AND r.handle IS NOT NULL
        AND r.handle LIKE $2 || '%'
        AND r.account_id <> $1
        -- ONE DIRECTION ONLY: blocks I MADE. A block made against me is not a
        -- fact this result set may carry — see the note above.
        AND NOT EXISTS (
          SELECT 1 FROM dm_blocks b
           WHERE b.blocker_account_id = $1 AND b.blocked_account_id = r.account_id)
      ORDER BY r.handle
      LIMIT $3`,
    [me, q, n]);

  return r.rows.map((row) => ({
    handle: row.handle,
    kind: row.kind,
    // The uuid is NOT returned. The client addresses people by handle and the
    // server resolves it — otherwise the search hands out the very identifier
    // that lets a caller skip the search next time.
  }));
}

/**
 * Resolve a handle to an account for addressing. This is where the FULL
 * predicate lives, blocks in BOTH directions included, so a handle learned
 * some other way — guessed, read off a public room, or kept from before a
 * block — cannot open a thread. Returns null when it is not addressable,
 * without saying why.
 *
 * The search above is deliberately more permissive than this. That asymmetry
 * is the whole fix for the oracle: what you can SEE says nothing about you,
 * and what you can SEND is refused identically whatever the reason. A null
 * here becomes the same 409 "this person is not reachable right now" as a
 * closed door and as a handle nobody ever registered — and it returns before
 * `openConversation`, so a blocked sender cannot even bring an empty thread
 * into existence in someone's requests folder.
 */
export async function resolveAddressee(meRaw, handleRaw) {
  const me = accountId(meRaw);
  const handle = String(handleRaw || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,24}$/.test(handle)) return null;

  const p = await pool();
  const r = await p.query(
    `SELECT r.account_id
       FROM profile_rooms r
       LEFT JOIN account_kinds k ON k.account_id = r.account_id
       LEFT JOIN dm_settings s   ON s.account_id = r.account_id
      WHERE r.published = true
        AND r.moderation_status = 'visible'
        AND r.handle = $2
        AND r.account_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM dm_blocks b
           WHERE (b.blocker_account_id = $1 AND b.blocked_account_id = r.account_id)
              OR (b.blocker_account_id = r.account_id AND b.blocked_account_id = $1))
        AND (COALESCE(k.kind,'passport') = 'business' OR COALESCE(s.dms_open, true) = true)
      LIMIT 1`,
    [me, handle]);
  return r.rows.length ? r.rows[0].account_id : null;
}

/** The handle to show for a counterparty, or null if they have no room. */
export async function handlesFor(accountIds) {
  const ids = [...new Set((accountIds || []).map((x) => String(x || "").toLowerCase())
    .filter((x) => ACCOUNT_UUID.test(x)))];
  if (!ids.length) return {};
  const p = await pool();
  const r = await p.query(
    `SELECT account_id, handle FROM profile_rooms
      WHERE account_id = ANY($1::uuid[]) AND handle IS NOT NULL`, [ids]);
  const out = {};
  for (const row of r.rows) out[row.account_id] = row.handle;
  return out;
}

/**
 * What a card shows the VIEWER, decided now. Keyed by the passenger's account
 * id for the thread reader, which maps it onto messages and sends the HANDLE
 * out — the uuid stays here.
 */
export async function profileCardsFor(meRaw, accountIds) {
  const me = accountId(meRaw);
  const ids = [...new Set((accountIds || []).filter(Boolean).map(String))];
  const out = {};
  if (!ids.length) return out;
  const p = await pool();
  const r = await p.query(
    `SELECT r.account_id, r.handle, r.published, r.moderation_status,
            COALESCE(s.profile_sharing, true) AS sharing,
            (SELECT content->>'text' FROM profile_modules pm
              WHERE pm.account_id = r.account_id AND pm.module = 'statement' AND pm.visible) AS statement,
            EXISTS (SELECT 1 FROM dm_blocks b
                     WHERE (b.blocker_account_id = $2 AND b.blocked_account_id = r.account_id)
                        OR (b.blocker_account_id = r.account_id AND b.blocked_account_id = $2)) AS blocked
       FROM profile_rooms r LEFT JOIN dm_settings s ON s.account_id = r.account_id
      WHERE r.account_id = ANY($1::uuid[])`, [ids, me]);
  for (const id of ids) out[id] = { available: false, handle: null, statement: null };
  for (const row of r.rows) {
    const ok = row.published && row.moderation_status === "visible" && row.sharing && !row.blocked && row.handle;
    out[row.account_id] = ok
      ? { available: true, handle: row.handle, statement: row.statement ? String(row.statement).slice(0, PROFILE_CARD_STATEMENT_MAX) : null }
      : { available: false, handle: null, statement: null };
  }
  return out;
}
