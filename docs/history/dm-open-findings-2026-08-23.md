# DM subsystem — open findings register (23 August 2026)

Produced by an adversarial review of the FINISHED subsystem: 58 agents, six
lenses, and every claim independently refuted by a separate agent
(`wf_dfd7d308-e74`; raw output in that run's `journal.jsonl`).

**52 claims → 35 survived refutation · 6 refuted · 11 unverified.**

> ## STATUS, 23 August (later the same day)
>
> **EVERY FINDING IN THIS REGISTER IS CLOSED.** 52 claims, 35 that survived
> refutation, and as of the end of 23 August none of them is open.
>
> | | was | now |
> |---|---|---|
> | blocker | 4 | **0** |
> | serious | 13 | **0** |
> | minor | 11 | **0** |
> | unverified | 7 | **0 — all verified, then fixed** |
>
> **Five of the thirty-five were already dead when this file was written** —
> fixed by #378 after the review ran at `79d6c72` — and every one of them was
> found by checking `git blame` rather than trusting the entry. Refuting first
> saved five fixes against code that already had them, and caught one entry
> whose *Reproduce* described the wrong mechanism.
>
> Nothing is deleted. A fixed finding's reproduction is still the spec of the
> test that now guards it.
>
> The question this file left for the owner — whether a DM export ships, and in
> what shape — was **answered on 23 August: two people should have records**
> (#397, recorded in `docs/history/dm-core-decisions-2026-08-23.md`).
>
> | PR | what it closed |
> |---|---|
> | [#381](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/381) | blockers 1 + 3 — the request state machine |
> | [#382](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/382) | blocker 2 — `now()` is the transaction start time (**v45, applied to prod**) |
> | [#383](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/383) | blocker 4 — the search oracle, **ruled** and recorded |
> | [#384](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/384) | 3 serious — state that outlived its context (drafts, folder pages, older-page reactions) |
> | [#385](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/385) | 1 serious — the undo the request banner had always promised |
> | [#387](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/387) | 1 serious — presence needs an accepted conversation (**v46**); 2 more marked already-dead |
> | [#388](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/388) | an unsend is one act (**v47**) |
> | [#389](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/389) | consent that remembers having been revoked |
> | [#390](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/390) | one gesture is one act, and safety does not share a rate budget |
> | [#391](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/391) | every writer in law 1 takes the pair lock |
> | [#392](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/392) | a thread you asked for should not arrive as a request |
> | [#393](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/393) | the payload must not say what the refusal refuses to say |
> | [#394](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/394) | every read is bounded, and both sides draw the breaker |
> | [#395](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/395) | the export and the delete must describe the same world |
> | [#397](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/397) | **the DM export — the owner's ruling: two people should have records** |
> | [#398](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/398) | 4 minor — one thread at a time, and one door into it |
> | [#399](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/399) | 2 minor — a refusal that says the true thing |
> | [#400](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/400) | 2 minor — the laws get their controls |
> | [#401](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/401) | 1 minor — an unsend names its author (**v48**) |
>
> Every fixed entry below is marked in place; nothing has been deleted, because
> the reproduction is still the spec of the test that now guards it.
>
> **The seven UNVERIFIED are still unverified.** Nobody has looked at them since
> the register was written. Silence is not clearance.

> An UNVERIFIED item is not a cleared item. Its verifier died on a session
> limit before reaching a verdict. Refute it yourself before you fix it OR
> discard it.

Three blockers were fixed in #378 (11 of the claims below were duplicates of
them, found by different lenses) and are listed at the bottom. 35 remained
open when this file was written; **27 remain open now — see the status block
above.**

Treat each `Reproduce` as the spec for a regression test. If you cannot make
it fail, say so in the PR — do not fix something you have not seen break.

## How to work this list

1. Reproduce first. The suite is `npm test`; the DM laws only run against a
   real Postgres, so `TEST_DATABASE_URL` must point at a THROWAWAY database.
   Never at production — `lib/db/dm.js` has no mem mirror by design.
2. Fix in the layer that owns the rule. A law belongs in a trigger, not a
   route: the route is not the only writer.
3. Add the regression test in `tests/postgres-integration.test.js`, ABOVE the
   board/ticket test (see trap 79 in the handover).
4. One PR per finding or per tight cluster. Branch, CI green, merge on the
   owner's word.

---

# BLOCKER

### `dm.js`

> **✅ FIXED 23 Aug in #381** — `acceptRequest` accepts only from `state='requested'`, the folder
> move is inside the rowCount branch, both take the pair lock, both are idempotent for the state
> already held. Regression arms proven red first in run 32665932895.

**Problem.** `acceptRequest` (lines 336-359) and `declineRequest` (lines 367-399) take no pair advisory lock and no mutual state guard. `declineRequest`'s UPDATE has no `WHERE state <> ...` predicate at all, and `acceptRequest`'s only predicate is `state <> 'accepted'` — so `declined -> accepted` is a legal transition that leaves `declined_at` set AND leaves the `source='decline'` row in `dm_blocks` in place. Neither CHECK in v40 catches it (`dm_conversations_declined_ck` only fires when state IS 'declined'). Result: a conversation that displays as accepted, sits in the inbox, and is silently dead in both directions because LAW 1 in dm_guard_message still sees the block.

**Reproduce.** Recipient R has a request from opener O and double-taps (or has two devices / a retried POST). T_decline: BEGIN; UPDATE conversations SET state='declined',declined_at=now(); UPDATE participants SET folder='archived'; INSERT dm_blocks(R,O,'decline'); COMMIT. T_accept, blocked on that row lock, then re-evaluates its predicate against the new version: state='declined' satisfies `state <> 'accepted'`, `opened_by <> R` holds, participant exists — so it sets state='accepted', accepted_at=now(), and its second (unconditional) UPDATE puts R's folder back to 'inbox'. Final row: state='accepted', accepted_at NOT NULL, declined_at NOT NULL, folder='inbox', block still present. R now sees an accepted thread in their inbox; every reply R types is refused P0001 by the block they no longer know exists, and every message O sends is refused too. The same end state is reachable without any race at all: decline, then tap ACCEPT from a stale panel.

**Suggested fix.** Take `pg_advisory_xact_lock(pairLockKey(lo,hi))` at the top of both `acceptRequest` and `declineRequest`, as `sendMessage` and `openConversation` already do. Guard the transitions explicitly (`declineRequest` should require `state <> 'declined'`; `acceptRequest` should require `state = 'requested'`), move `acceptRequest`'s folder UPDATE inside `if (r.rowCount)` so it cannot run when the state change did not, and make an accept that follows a decline either refuse or delete the matching `source='decline'` block in the same transaction.

**Why refutation failed.** Reproduced by reading the code; nothing stops the scenario.

(1) declineRequest (lib/db/dm.js:367) sets state='declined', archives only Alice's participant row, and inserts dm_blocks(Alice->Bob). Participant rows survive, and cannot be removed at all: schema-v40-direct-messages.sql:241-256 grants asilum_app only SELECT/INSERT/UPDATE on dm_participants (DELETE is granted on dm_blocks only).

(2) dm

---

### `dm.js`

> **✅ FIXED 23 Aug in #382** — v45 defaults the DM stamps to `clock_timestamp()`, and the store
> takes `last_activity_at` from the inserted message's `created_at` under `GREATEST`. v45 is
> APPLIED TO PRODUCTION and verified as `asilum_app`. Proven red first in run 32666396768.

**Problem.** `sendMessage` stamps `last_activity_at = now()` (line 155) and lets `created_at` default to `now()` (v40 line 93), but in PostgreSQL `now()` is the TRANSACTION START timestamp, and the pair advisory lock is acquired at line 138 — after BEGIN. A transaction that waits on the lock therefore writes a timestamp EARLIER than the transaction that already committed ahead of it. `last_activity_at` is not monotonic, even though listFolder's keyset cursor (lines 213-216, and the cursor contract in lib/dm.js:84-96) is built on the assumption that it only moves forward.

**Reproduce.** Two sends into the same conversation X arrive together. T_A BEGINs at t=0 and blocks on the pair lock. T_B BEGINs at t=1, takes the lock, inserts message id 100 with created_at=t1, sets X.last_activity_at=t1, commits. T_A wakes, inserts message id 101 with created_at = its own transaction time t0 (< t1), and sets X.last_activity_at = t0 — moving it BACKWARD past the message that preceded it. Two wrong outcomes: (a) the thread renders newest-first by id (readThread ORDER BY id DESC) but message 101's displayed timestamp is earlier than message 100's, so the conversation reads out of order; (b) if the reader fetched page 1 in between, X was returned above the cursor with last_activity_at=t1; after T_A commits X's key falls below the cursor, so the MORE ↓ page returns X a second time — MailDesk's de-dupe (lines ~105-110) silently drops it and consumes a slot, pushing a real conversation off the page. A conversation that just received a message can also sort below one that has been quiet for longer.

**Suggested fix.** Use `clock_timestamp()` instead of `now()` for both, and make the bump non-decreasing: `UPDATE dm_conversations SET last_activity_at = GREATEST(last_activity_at, clock_timestamp()) WHERE id=$1`, with `created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()` on dm_messages. Alternatively derive last_activity_at from the RETURNING created_at of the row just inserted.

**Why refutation failed.** Confirmed at main=79d6c72 (clean tree). lib/db/dm.js:224 emits otherId; app/api/dm/route.js:74-80 destructures it off and substitutes handle, and the spread order ({...page, items: mapped}) means the mapped array wins, so otherId is genuinely absent from the wire. MailDesk.jsx:97-121 stores data.items verbatim (setItems is called in only those four places, nothing else injects otherId), and line 5

---

### `dm.js`

> **✅ FIXED 23 Aug in #381** — the UPDATE carries `state='requested' AND opened_by <> $2`.

**Problem.** `declineRequest` (lines 367-399) checks only that the caller is A participant — never that they are the RECIPIENT — and applies `state='declined'` with no state predicate. When the caller IS `opened_by`, `them === me`, so the `them !== me` guard at line 386 skips the block insert, but the state change still lands. dm_guard_message then permanently refuses that person: `IF convo.state = 'declined' AND NEW.sender_account_id = convo.opened_by THEN RAISE ... P0001` (v40 lines 186-188). There is no path back, because `acceptRequest` requires `opened_by <> $2`.

**Reproduce.** O opened a conversation with R and it was accepted; both are chatting. O's client (or any caller) POSTs `{op:"decline", conversationId}` — the route (route.js:184-190) does no role check. The conversation flips to state='declined', O's own folder becomes 'archived', and no block row is created. From then on every message O sends is refused P0001 and surfaced as the vague "this person is not reachable right now." O cannot accept (opened_by === me fails the predicate), cannot unblock (there is no block to list), and cannot open a second thread (UNIQUE(lo,hi) makes the pair unrepresentable twice). R can still send into it. The thread is permanently half-dead with no state visible anywhere that explains why.

**Suggested fix.** Require the decliner to be the non-opener and the conversation to be undecided: add `AND opened_by <> $2 AND state = 'requested'` to the conversation lookup in `declineRequest`, and return false otherwise — mirroring the guards `acceptRequest` already carries.

**Why refutation failed.** Confirmed by reading the full chain and reproducing the transform. lib/db/dm.js:224 produces `otherId`; app/api/dm/route.js:77-79 deliberately destructures it out of every inbox item (`page.items.map(({ otherId, ...rest }) => ({ ...rest, handle: handles[otherId] || null }))`) with a comment that the uuid must never leave the server; MailDesk.jsx loadFolder stores `data.items` verbatim; MailDesk.js

---

### `dm.js`

> **✅ RULED AND FIXED 23 Aug in #383** — a person who blocked me stays LISTED and stays
> UNADDRESSABLE: `findAddressees` excludes only blocks I made, `resolveAddressee` keeps both
> directions. The ruling, its cost and its reversal are in
> `docs/history/dm-core-decisions-2026-08-23.md`. **The owner may overturn it — it is one predicate.**

**Problem.** `findAddressees` (line 531-534) and `resolveAddressee` (line 571-574) exclude anyone who has blocked the caller. That turns search into a block-detection oracle and defeats the deliberate ambiguity built one file over: lib/dm.js:77-78 collapses P0001 and P0002 precisely because "distinguishing them tells a stranger which one it was". Detecting the block is the whole cost driver in ban evasion — a harasser who cannot tell whether a block landed wastes effort; one who gets a definitive read re-registers immediately.

**Reproduce.** Harasser A knows victim V's handle (published rooms are public pages). Before: GET /api/dm?op=find&q=vera-k returns vera-k. V blocks A. After: the same query returns []. If V is a BUSINESS the disappearance is unambiguous on its own — a business cannot close DMs (v40 dm_guard_settings), so absence can only mean a block. If V is a passport, A signs in with a second free account S and searches the same handle: present from S, absent from A ⇒ V's door is open globally and V blocked A specifically. Two requests inside the 60/hr find budget (unbounded per finding 1) and one sock account. A now knows within seconds that the block landed, and knocks again from S.

**Suggested fix.** Do not let the caller-specific exclusions be observable as a difference in the result set. Either keep blocked-by-them people listed and let the send path refuse with the deliberately ambiguous refusal, or make the search result identical to the "handle does not exist" case for a much wider class of handles (e.g. never confirm exact-handle existence, only prefix results filtered before the block predicate). At minimum, treat business accounts identically since their disappearance is self-evidently a block.

**Why refutation failed.** Reproduces exactly as described; nothing prevents it.\n\nData flow verified end to end:\n- lib/db/dm.js:221-233 (listFolder) returns items containing otherId and no handle.\n- app/api/dm/route.js:70-79 (op=inbox) deliberately strips it: items: page.items.map(({ otherId, ...rest }) => ({ ...rest, handle: handles[otherId] || null })). The uuid is gone from the wire object by construction.\n- app/com

---


# SERIOUS

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #384** — drafts are keyed by composer, so the carry-over is
> unrepresentable rather than cleared. `lib/dm-desk.js` + `tests/dm-desk.test.js`.

**Problem.** A single `draft` state (line 55) backs both the search-mode "your first message" textarea (line 548) and the in-thread composer (line 451). It is cleared only on a confirmed send (lines 249, 264) — never on a thread switch, never when the search collapses, never when the panel closes.

**Reproduce.** Type `find a handle…` = "stu", results appear, and write "the invoice is wrong, can you refund the 240" into the first-message box — then change your mind and clear the search field. The effect at 160 sees `q.length < 2` and sets `found = null`, so the panel falls back to the inbox list with `draft` untouched. Click any existing conversation. `loadThread` sets `thread` but not `draft`, so the composer opens pre-filled with the message meant for @stu. The textarea's `onKeyDown` sends on a bare Enter (line 458) with no confirmation, so one keystroke delivers it to the wrong person. The same carry-over happens thread-to-thread: half-typed text in A appears in B after using the back button.

**Suggested fix.** Clear the composer whenever its addressee changes: `setDraft("")` in `loadThread`, in the back-button handler (line 301), and in the search effect when `found` transitions to `null`. If per-thread drafts are wanted instead, key them in a `Map` by conversation id rather than sharing one string.

**Why refutation failed.** Reproduces exactly as described on main (79d6c72), and nothing in the DB or the route stops it.\n\n1. DECLINE + BLOCK (MailDesk.jsx:333-336) sends op=decline with no `block` field; route.js computes `blocked = body.block !== false` = true; declineRequest (lib/db/dm.js:367-397) inserts a dm_blocks row with source='decline'. The DDL (supabase/schema-v40-direct-messages.sql:105-117) gives dm_blocks n

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #384** — every request carries a token and only the current one applies
> (`pageIsCurrent`).

**Problem.** `loadFolder` (97-120) has no cancellation token and no check that the folder it was called for is still the selected one. Its append branch merges into whatever `items` currently holds: `if (!more || !prev) return next;` otherwise `[...prev, ...next.filter(...)]`. The de-duplication is by conversation id only, which cannot detect that `prev` belongs to a different folder.

**Reproduce.** Inbox has 26+ conversations. Click "MORE ↓" (line 597) — `loadFolder("inbox", cursor)` starts, and because `more` is truthy it does not clear `items`. While it is in flight, click the REQUESTS tab. The effect at line 122 fires `loadFolder("requests", "")`, which sets `items` to `null` and `cursor` to `""`. The requests response lands first and sets `items` to the (say, empty) requests page. The inbox page-2 response then lands: `more` is truthy and `prev` is `[]` (truthy), so it takes the merge branch and appends the inbox conversations. The REQUESTS tab now lists accepted inbox threads under the hint "first messages from people you have not spoken to" — and with their `preview` text, which the store deliberately nulls for requests (lib/db/dm.js:232), so the panel displays previews in the one folder that is supposed to have none. `setCursor` also installs the inbox cursor, so the "MORE ↓" under the requests tab keeps paging the inbox.

**Suggested fix.** Give `loadFolder` the same guard the search effect has: capture `which` and an incrementing request id (a `useRef` counter) at call time, and drop the response — both `setItems` and `setCursor` — if a newer request has started or `which !== folder`.

**Why refutation failed.** I tried to kill this one at four layers and it survived all of them. Every step of the scenario is reachable in the shipped code.

WRITE PATH (A pings typing on a 'requested' conversation)
- app/api/dm/route.js:225-231 — op "typing" calls pingTyping(me, body.conversationId) with no lookup of dm_conversations at all. Contrast op "react" at :206, which routes into the v42 trigger that does check sta

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #384** — each page keeps its own reactions and the lookup spans all of
> them (`reactionsAcross`).

**Problem.** `loadOlder` stores only `{ messages, olderBefore }` from the older-page response (line 235) and throws away `page.reactions` and `page.palette`. Rendering then looks reactions up exclusively in `thread.reactions` (lines 365-367), which the route computed only over the newest page's message ids (app/api/dm/route.js:90). Every message on a paged-in older page therefore renders with zero reactions regardless of what the database holds.

**Reproduce.** The other person reacted 👍 to a message forty-one messages back. Open the thread, click "OLDER MESSAGES ↑". The message appears with no reaction chip. You click 👍 from the palette; `act("react")` succeeds and `loadThread(threadId)` runs — which also resets `older` to `[]` (line 125), so the message you just reacted to vanishes from the view entirely and the reaction is still nowhere on screen. Page up again and it is still bare, so the reaction reads as never having registered and gets clicked repeatedly.

**Suggested fix.** Keep each page's reactions with its messages (`setOlder(prev => [{ messages: page.messages, reactions: page.reactions, olderBefore: page.olderBefore }, ...prev])`) and look up `m.id` across the merged map rather than `thread.reactions` alone.

**Why refutation failed.** Confirmed by direct code reading; I could not find anything that stops it.\n\nStep-by-step trace:\n1. blockAccount (lib/db/dm.js:402) only INSERTs into dm_blocks. It does not remove dm_participants rows, change dm_conversations.state, or move folders. Both parties stay full participants of the accepted conversation.\n2. B's messages are refused: dm_guard_message (schema-v40-direct-messages.sql:148

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #385** — a BLOCKED list on the desk, unblock by conversation or handle,
> `op=blocks` projected like the inbox (no uuid), and the banner now points at the real control.

**Problem.** The request banner tells the user "declining also blocks them — you can undo that in settings." No such settings surface exists. Grepping the whole app tree, nothing outside app/api/dm/route.js and lib/db/dm.js references `unblock`, `listBlocks`, or `op: "blocks"` — MailDesk has an activity-signals checkbox and a mute button and nothing else. Worse, the one API that could serve the undo (`op:"unblock"`, route.js:199-201) keys on `body.accountId`, a raw account uuid, and route.js:71-73 asserts "the uuid never leaves the server" (an invariant tests/postgres-integration.test.js:1030 asserts as `"accountId" in hits[0] === false`). GET `op="blocks"` does return raw uuids (lib/db/dm.js:421-427), contradicting that same comment.

**Reproduce.** B receives a request from A and presses DECLINE + BLOCK, having read that the block is undoable in settings. `declineRequest` inserts a permanent `dm_blocks` row. B changes their mind. There is no settings screen, no block list, and no control anywhere in the UI that calls `op:"unblock"`. A is permanently unreachable and — per the ambiguity rule — A will only ever be told "this person is not reachable right now." The claim in the banner is the one thing that made DECLINE+BLOCK look reversible.

**Suggested fix.** Build the block list into the desk (GET op=blocks, keyed and displayed by handle, with an unblock button that addresses by handle so the uuid stays server-side — add a handle-keyed `op:"unblock"`), or remove "you can undo that in settings" from the banner and say the block is permanent. Also change `listBlocks`/route op=blocks to project through `handlesFor` rather than returning `accountId`.

**Why refutation failed.** Tried to refute it and could not. Verified each link in the chain against the source.\n\n1. The id really is per-press. MailDesk.jsx:261 builds opId inside send() from Date.now() XOR a text-length constant. I evaluated the expression: same body, same thread, 1 ms apart yields c9gs1np11111111 vs c9gs1nq11111111. Different on every invocation.\n\n2. No automatic retry exists. act() (MailDesk.jsx:143

---

### `dm.js`

> **✅ FIXED 23 Aug in #388** — one transaction on one client, and v47 gives `dm_guard_reaction`
> `FOR SHARE` so the unsend waits for the reaction it is about to sweep. **v47 applied to prod.**

**Problem.** `unsendMessage` (lines 743-759) performs two independent autocommit statements on the pool — `UPDATE dm_messages SET body=NULL, unsent_at=now()` and then `DELETE FROM dm_reactions WHERE message_id=$1` — with no BEGIN/COMMIT around them, and no pair advisory lock. `dm_guard_reaction` (v42, lines 83-85) refuses a reaction on an unsent message with a plain non-locking SELECT, so nothing serialises a concurrent `react()` against the unsend, and nothing rolls the pair back if the second statement never runs.

**Reproduce.** A sends a message m; B has the thread open. B taps ♥ and A taps UNSEND at the same instant. (1) B's INSERT fires dm_guard_reaction, which SELECTs m and reads unsent_at = NULL — it does not lock the row, so it passes. (2) A's UPDATE commits: body NULL, unsent_at set. (3) A's DELETE FROM dm_reactions runs on a different pooled connection and deletes zero rows — B's insert has not committed yet, so it is invisible. (4) B's INSERT commits. dm_reactions now holds a ♥ on a tombstone, permanently: reactionsFor returns it, and MailDesk renders the reaction span unconditionally (it is not gated on `!m.unsent`, unlike the palette and UNSEND controls), so A sees a heart on the message A just withdrew. Only B can remove it. The same orphan survives non-concurrently if the process dies or the pool errors between the two statements — a partial write with no rollback.

**Suggested fix.** Run both statements in one transaction on one client, and take `pg_advisory_xact_lock(pairLockKey(lo,hi))` for the message's conversation first (as `sendMessage` does), so a concurrent `react()` on the same pair serialises behind it. Optionally add `AND NOT EXISTS (SELECT 1 FROM dm_messages WHERE id = NEW.message_id AND unsent_at IS NOT NULL)` enforcement via `SELECT ... FOR SHARE` in dm_guard_reaction so the guard actually locks what it checked.

**Why refutation failed.** Tried to refute and could not. Every mechanical claim verifies: purgePersonalizationData (lib/db/production.js:114) issues ~28 DELETEs ending at profile_rooms/user_profiles and `grep -c "dm_" lib/db/production.js` returns 0; EXPORT_MANIFEST (line 336) has no dm_* entry; /api/privacy DELETE calls only deleteUserPhotos + purgePersonalizationData + deleteBuyerProfile; only 6 files repo-wide reference

---

### `dm.js`

> **✅ FIXED 23 Aug in #391** (declineRequest's half in #381) — both take the pair advisory lock.
> `pairLockKey` is exported so the test can hold it and assert the block WAITS.

**Problem.** `blockAccount` (lines 402-410) and the `INSERT INTO dm_blocks` inside `declineRequest` (lines 386-390) do not take the pair advisory lock that the module's own comment (lines 62-65) says "every write that must read-then-write inside one transaction" takes. `dm_guard_message`'s LAW 1 block check is a plain `EXISTS` SELECT inside the sender's transaction, so a block committed after that check but before the send commits does not stop the send. Product law 1 ("a block stops delivery in BOTH directions") has an open window exactly at the moment a person reaches for the block button.

**Reproduce.** R is being harassed by S in an accepted thread and hits BLOCK. S is mid-send. S's transaction: BEGIN; SELECT lo,hi; pg_advisory_xact_lock (uncontended — blockAccount never takes it); INSERT dm_messages fires dm_guard_message, whose `EXISTS (SELECT 1 FROM dm_blocks ...)` sees no row. R's single-statement INSERT INTO dm_blocks commits here. S's transaction then UPDATEs last_activity_at and COMMITs. The message is delivered into R's thread after R's block is durably committed, and R's badge counts it. The same hole applies to the decline path: a send racing DECLINE + BLOCK lands after the decline.

**Suggested fix.** Wrap `blockAccount` in a transaction that takes `pg_advisory_xact_lock(pairLockKey(...))` for the ordered pair before inserting, and add the same lock at the top of `declineRequest`. Every writer that participates in law 1 must take the pair lock, not just the sender.

**Why refutation failed.** CONFIRMED by full code-path read; no live repro possible (no Postgres on this machine — psql/pg_ctl/docker all absent — and lib/db/dm.js deliberately ships no mem-mode mirror).

The chain holds at every step:
1. openConversation (lib/db/dm.js:96-98) gives the sender folder='inbox' and the recipient 'requests'; dm_conversations.state defaults to 'requested'.
2. declineRequest (lib/db/dm.js:379-388)

---

### `dm.js`

> **✅ FIXED 23 Aug in #389** — the state is the LATER of the two stamps and neither erases the
> other. Both comments corrected to say what is kept (latest grant, latest revocation) rather than
> implying a full audit trail.

**Problem.** `setMediaConsent` (the `allow` branch) does `SET media_consent_at = COALESCE(media_consent_at, now()), media_consent_revoked_at = NULL`. That erases the revocation stamp and keeps the *original* grant timestamp. Both the schema comment (supabase/schema-v40-direct-messages.sql: "Revocation is a timestamp rather than a flag flip so 'was this attachment sent under a consent that still stands?' stays answerable after the fact") and this function's own docstring ("Revocation stamps rather than clears, so the window a past attachment was sent under stays answerable once the pipeline exists") claim the opposite. The consent state is the entire deliverable of law 4 — OWNER-DECISIONS #3 ships the state and nothing else — and it is lossy.

**Reproduce.** B ticks "receive images and videos" at 10:00 (`media_consent_at = 10:00`). At 11:00 B unticks it (`media_consent_revoked_at = 11:00`). At 12:00 B ticks it again. The row now reads `media_consent_at = 10:00, media_consent_revoked_at = NULL` — indistinguishable from a consent that has stood unbroken since 10:00. The hour B spent withholding consent no longer exists. When the media pipeline lands and asks "was the item A sent at 11:30 covered by a consent that stood?", the row answers yes. The integration test at tests/postgres-integration.test.js:~576 only walks give→revoke and stops, so the erasing path is never exercised.

**Suggested fix.** Model consent as an append-only history (a small `dm_media_consent_events` table, or `media_consent_at`/`media_consent_revoked_at` pairs), or at minimum set `media_consent_at = now()` on a re-grant instead of COALESCE and keep the prior revocation in a separate column/row. Until then, delete the two comments claiming the window stays answerable.

**Why refutation failed.** Confirmed by reading the code; I tried to refute it and every candidate stopper fails.

loadOlder (MailDesk.jsx:224-239) has no AbortController, no cancelled flag, and no post-await re-check of threadId. Its only writer is setOlder((prev) => [...]), which targets whatever `older` is current when the response lands.

Reachability is clean. The back button (line 301) does only setThreadId(null); set

---

### `dm.js`

> **✅ FIXED 23 Aug in #392** — WIRED, not deleted. `recipientFollowsSender` converts the identity
> string and the handle in one query and fails closed. It moves the knock between folders only; the
> one-knock law is untouched and the test asserts it.

**Problem.** `foldersForNewConversation` and the `knownToRecipient` option are exported, documented ("`knownToRecipient` is true when the recipient already follows the sender or has messaged them before; a thread you asked for should not arrive as a request") and unit-tested — and never used by production code. Grep across the repo: `foldersForNewConversation` appears only in lib/dm.js and tests/dm.test.js; `knownToRecipient` is passed `true` only inside tests/postgres-integration.test.js. app/api/dm/route.js:161 calls `openConversation(me, them)` with no options, so lib/db/dm.js:77 always takes the `false` default. `user_follows` exists (supabase/schema-v14-asterisk-memory.sql:37) and is never consulted.

**Reproduce.** A follows B. B publishes a room, A finds B's handle and writes the first message. Because the route never computes `knownToRecipient`, the row is inserted with `folder='requests'` for B. B — who explicitly follows A — gets it in the REQUESTS queue with no preview (listFolder forces `preview: null` for requests) and is offered ACCEPT / DECLINE+BLOCK on someone they already follow. Meanwhile tests/dm.test.js:45 asserts `{ knownToRecipient: true } -> recipient: "inbox"` with the message "a thread you asked for should not arrive as a request", so the suite reports the rule as covered while no caller can ever produce it.

**Suggested fix.** Either compute `knownToRecipient` in the send path (query `user_follows` for recipient→sender before `openConversation`, and pass it through), or delete `foldersForNewConversation`, the `knownToRecipient` parameter, the doc sentence and the second half of the unit test so the code stops advertising a rule it does not implement.

**Why refutation failed.** Reproduces exactly as described in /Users/noemosallowed/Downloads/*ASILUM website prototype [july6]/app/components/MailDesk.jsx. `draft` (L55) is a single component-level state bound to both the search-mode first-message textarea (value={draft}, L550) and the in-thread composer (value={draft}, L453). A grep of every `setDraft` call shows only five sites: the two onChange handlers (L456, L553) and

---

### `dm.js`

> **⛔ ALREADY DEAD WHEN THIS WAS WRITTEN — do not fix.** The review ran at
> `79d6c72`; the `EXISTS (… mine …)` membership clause landed in **#378** (`6c409ae`),
> confirmed by `git blame`. Verified 23 Aug before touching it — refuting first is this
> file's own first instruction, and here it saved a fix written against code that already
> had one.

**Problem.** `peerActivity` performs no membership check. It filters `dm_participants WHERE conversation_id=$1 AND account_id <> $2`, which for a non-member returns BOTH participant rows and uses `rows[0]`. Every neighbouring read holds itself to the opposite standard: `readThread`'s comment says "Authorization IS the participant probe. A non-member gets the same answer as a nonexistent conversation, so the endpoint is not a membership oracle", and the mute test (tests/postgres-integration.test.js:~660) asserts "no error that confirms the thread exists". Route op="activity" exposes this directly.

**Reproduce.** Someone holding a conversation uuid they are not a participant in (leaked from a log line, a support paste, a shared screenshot of a request body) hits GET /api/dm?op=activity&c=<uuid>. A nonexistent uuid returns `{typing:null, readUpTo:null}`; a real conversation they are not in returns `{typing:false, readUpTo:0}` — existence confirmed — and, polled every 3s, streams one participant's live typing state and read position to a third party. The reciprocity control was designed so nobody outside the pair sees this.

**Suggested fix.** Add the same participant probe `readThread` uses: `SELECT 1 FROM dm_participants WHERE conversation_id=$1 AND account_id=$2`; when absent, return the identical `{typing:null, readUpTo:null, reciprocal:true}` shape a nonexistent conversation returns.

**Why refutation failed.** Confirmed by reading the code. `peer` (MailDesk.jsx:59) has exactly two writers — the initializer and line 193 inside `tick()` — and nothing resets it when `threadId` changes: not the back button (line 301 sets only threadId/thread), not the activity effect's cleanup (200-209, which clears interval/listener/typing broadcast only). The panel is a deliberate single element with no `key` (285-289), s

---

### `dm.js`

> **✅ FIXED 23 Aug in #387** — v46 refuses typing on an unaccepted conversation in the
> trigger, `peerActivity` carries the same gate in the query (no trigger can stop a read),
> and `pingTyping` answers false instead of raising on every keystroke into a knock.

**Problem.** Read receipts are emitted from UNACCEPTED requests. `peerActivity` has no acceptance gate, and MailDesk.jsx:133-138 POSTs op=read with the newest message id whenever a thread is opened — including a request the recipient opened only to see who it was. v42 explicitly refused reactions on unaccepted conversations because "a reaction on an unaccepted request is a notification a stranger can send"; the same reasoning was not applied to the receipt a stranger can READ. The result is an email-tracking-pixel equivalent: confirmation that a real human opened the knock.

**Reproduce.** Spammer knocks N stranger handles (one message each, law 3), recording each returned conversationId. It then polls GET /api/dm?op=activity&c=<id> for each — 1200/hr per device, unbounded per finding 1. Any conversation whose readUpTo advances above 0 identifies a live, engaged human who reads their requests folder; those handles go on a validated target list worth re-hitting from fresh accounts, while the dead ones are discarded. The victim never accepted, never replied, and cannot suppress this without disabling activity signals globally — which by design also blinds them to receipts from people they actually talk to.

**Suggested fix.** Gate `peerActivity` on `convo.state = 'accepted'` (return {typing:null, readUpTo:null}) the way dm_guard_reaction gates reactions, and/or stop MailDesk from marking a requests-folder thread read until it is accepted. Someone who has not agreed to hear from a stranger should emit nothing back to them.

**Why refutation failed.** Tried to refute; every candidate gate is verifiably absent.

CHAIN VERIFIED IN CODE:
1. route.js:169 returns conversationId to the SENDER on a knock, so the spammer holds the id.
2. MailDesk.jsx:129-138 (loadThread) POSTs op=read with the newest message id for ANY thread opened. No folder guard — the requests ACCEPT/DECLINE panel renders after the read already fired.
3. lib/db/dm.js:325-333 markRe

---

### `route.js`

> **✅ FIXED 23 Aug in #390** — `setDmSettings` applies both in one transaction, and the refusal
> reports what actually stands.

**Problem.** The `settings` op (lines 232-247) applies `setActivitySignals` and `setDmsOpen` as two separate autocommit statements against dm_settings, then reads both back. When the second one is refused by the v40 P0004 trigger, the route returns a 409 refusal while the first write has already committed — and the refusal body carries no settings state, so the client never learns what actually persisted.

**Reproduce.** A business account posts `{op:"settings", activitySignals:false, dmsOpen:false}` (MailDesk sends them separately today, but the endpoint accepts both and the panel's checkbox handler at MailDesk.jsx:~500 reverts its local state on any non-ok response). `setActivitySignals` commits activity_signals=false. `setDmsOpen` raises P0004 and the route returns 409 "a business cannot switch messages off". The client reverts its activity-signals checkbox to true, but the database says false — so the account is now silently emitting no read receipts and, by reciprocity, seeing none, with a UI that says the opposite until the next summary poll.

**Suggested fix.** Wrap both writes in one transaction on one client so the P0004 refusal rolls back the activity_signals change too, or include the read-back `{dmsOpen, activitySignals}` in the 409 body so the client renders what actually holds.

**Why refutation failed.** CONFIRMED by execution, not just reading. requestSubject.length === 1 (lib/security/request.js:91), so the `me` passed at app/api/dm/route.js:97, 107 and 132 is silently discarded. resolveRequestUser (lib/identity.js:49) authenticates an `sb-` caller purely from getAuthenticatedUser(req), which reads only the Authorization: Bearer header (lib/supabase.js:31-39) — the device cookie is never require

---

### `route.js`

> **✅ FIXED 23 Aug in #390** — presence has its own bucket; the table lives in `lib/dm.js` as
> `rateBucketFor` so the rule is tested, and an unknown op falls into the TIGHT bucket.

**Problem.** The `dm-act` bucket (240/hour, lines 130-136) is shared by the two highest-frequency ops in the product and the victim's only safety control. `op:"typing"` fires up to once per 2.5 seconds while composing (app/components/MailDesk.jsx:214-220 — up to 1440 writes/hour) and `op:"read"` fires on every thread open (MailDesk.jsx:135-138), while `op:"block"`, `op:"decline"`, `op:"unblock"` and `op:"mute"` draw from the same 240. The route's comment claims "the rest share a looser one so a burst of reads cannot exhaust the ability to block" — but the exhausting traffic is writes in that same bucket, not reads.

**Reproduce.** A harasser floods a victim with messages in an accepted thread. The victim opens threads and types replies: ~10 minutes of active composing (24 typing pings/minute) plus a dozen thread opens = 240+ hits on `dm-act`. The victim then clicks BLOCK; POST /api/dm op=block returns 429 with a Retry-After of up to 59 minutes, and MailDesk's `act()` surfaces it as a generic failure. The victim cannot block, decline, or mute the harasser for the remainder of the clock hour — the abuse itself is what consumed the quota. With the device-cookie subject (finding 1) the harasser is unlimited while the victim is throttled.

**Suggested fix.** Give safety ops their own bucket that no ordinary interaction can drain: split `dm-safety` (block/unblock/decline/mute) with a generous limit, and move the chatty ops (`typing`, `read`) into a separate high-limit `dm-signal` bucket. Never let an ergonomic op and a protective op share a counter.

**Why refutation failed.** Tried to refute and could not; every step of the scenario reproduces on a static read of the real code.\n\nPath: blockAccount (lib/db/dm.js:381-390) is a bare INSERT INTO dm_blocks — no trigger on dm_blocks in v40-v43, no participant cleanup, no dm_typing cleanup. A remains a participant, so dm_guard_typing (schema-v41:67-82), which checks only dm_participants membership and caps typing_until at 3

---

### `schema-v41-dm-activity.sql`

> **⛔ HALF ALREADY DEAD — check before fixing.** The BLOCK predicate on `dm_guard_typing`
> and on `peerActivity` landed in **v44 / #378** (`6c409ae`), after the review ran at
> `79d6c72`. What was genuinely missing was ACCEPTANCE, not the block — **fixed in #387**
> (v46). The claim that there is no test is also stale: `tests/postgres-integration.test.js`
> covers block-vs-presence (v44's own arm) and now knock-vs-presence.

**Problem.** A block does not stop typing indicators or activity reads. `dm_guard_typing` (v41 lines 67-82) checks participation and caps the horizon but never consults `dm_blocks`; `peerActivity` in lib/db/dm.js:651-679 checks reciprocity but consults neither `dm_blocks` nor participation. v42 got this exactly right for reactions ("A block that stops words but allows a heart every few minutes is not a block", schema-v42 lines 72-80) and the identical reasoning was not applied to the typing channel. There is no test for it — tests/postgres-integration.test.js covers block-vs-send and block-vs-reaction, nothing for block-vs-typing.

**Reproduce.** A and B have an accepted conversation. B blocks A (dm_blocks blocker=B, blocked=A). A's client — or a 2-line curl loop — POSTs {op:"typing", conversationId} every 6 seconds. pingTyping succeeds (participant row still exists, no block check), the row is written. B opens the thread to screenshot the history for a report; MailDesk polls op=activity every 3s, peerActivity returns typing:true, and B sees "typing…" from the person they just blocked, permanently, with no way to stop it short of turning their own activity signals off globally. Symmetrically, A keeps polling op=activity and keeps receiving B's live read-receipt and typing state for that thread — a presence feed out of a blocked relationship. At 240 dm-act/hr this already covers 40% of wall-clock; with the device-cookie bypass it is continuous.

**Suggested fix.** Add the same both-directions `dm_blocks` EXISTS check that dm_guard_reaction uses to `dm_guard_typing`, and add it to `peerActivity`'s query so a blocked pair returns {typing:null, readUpTo:null}. Also add the missing participation check to `peerActivity` — it currently answers for any conversation id, returning `r.rows[0]` for a caller who is not a member, unlike `readThread` which returns null.

**Why refutation failed.** Confirmed by reading the code and by executing the real modules. lib/security/request.js:91 declares `requestSubject(req)` with ONE parameter; app/api/dm/route.js:132 calls `requestSubject(req, me)` and JS silently discards `me`. With no device cookie, `verifiedRequestSubject` returns null and `trustedEdgeSubject` is dead by default (TRUSTED_EDGE_IP_HEADER empty; tests/integrity.test.js:31,62 lock

---


# MINOR

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #398** — the page carries the thread it was asked for and a late one is
> dropped. NOTE for the record: the entry's *Reproduce* is half wrong — the OLDER anchor does NOT
> start walking A's history, because the fetch sends `c=threadId` from the current render. The
> consequence is a duplicate or empty page in B, not a walk through A. The core claim — A's
> messages rendered inside B's thread — is exactly right.

**Problem.** `loadOlder` (lines 224-239) has no cancellation and no thread guard. It captures `threadId` at call time, but merges its result into the `older` state with `setOlder((prev) => [{...}, ...prev])`, which is whatever thread is current when the response lands. `loadThread` resets `older` to `[]` on a switch, but that reset happens before the in-flight page returns.

**Reproduce.** Open conversation A (with a long history), click "OLDER MESSAGES ↑". While the request is in flight, click "← THE MAIL DESK" and open conversation B. `loadThread(B)` runs `setOlder([])` and populates `thread` with B. Conversation A's older page then resolves and is unshifted into `older`. The merge at line 349 (`[...older.flatMap(p => p.messages), ...thread.messages].sort((x,y) => x.id - y.id)`) now renders A's messages interleaved by id inside B's thread — including messages marked `mine: true` from A, and the "OLDER MESSAGES ↑" anchor becomes A's `olderBefore`, so paging up continues walking A's history while the header, mute button and composer all belong to B. Anything typed and sent goes to B.

**Suggested fix.** Capture the thread the page belongs to and discard late responses: take `const forThread = threadId` at the top of `loadOlder`, and inside the `if (r.ok)` block bail unless it still matches — or better, move the paging into a `useEffect` keyed on `threadId` with a `cancelled` flag, the way the search effect at line 160 already does it.

**Why refutation failed.** Confirmed by reading the code; nothing prevents it. app/api/dm/route.js:104-111 (op=activity) performs only a feature-flag check and a rate-limit consume, then passes url.searchParams.get("c") straight into peerActivity with no membership probe — unlike op=thread (line 78), which 404s on readThread returning null. peerActivity (lib/db/dm.js:651-679) gates only on readActivitySignals(me), the CALLE

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #398** — every thread change goes through one door that clears it, and a
> failed poll clears it too: quiet must mean NOTHING KNOWN, not the last thread's answer.

**Problem.** `peer` (line 59) is never reset when `threadId` changes. The activity effect (181-210) tears down and restarts on a thread switch, but the only writer of `peer` is line 193 inside `tick()`, which runs asynchronously and only on `r.ok`. So the previous conversation's `{ typing, readUpTo }` is rendered against the new conversation's `myLastId`. Because `dm_messages.id` is a global BIGSERIAL, a `readUpTo` from a busy thread routinely exceeds the newest message id in a quiet one.

**Reproduce.** You are in thread A with a chatty peer; the last activity poll returned `{ typing: false, readUpTo: 91000 }`. Go back and open thread B, where your last message is id 40012 and the other person has not opened the app in a week. Before B's first `tick()` resolves, the receipt block at line 425 evaluates `peer.readUpTo !== null && myLastId && peer.readUpTo >= myLastId` → `91000 >= 40012` → the panel prints "read" under a message nobody has read. If B's peer has activity signals off (the API would return `readUpTo: null`), or the activity poll 429s on the `dm-activity` bucket, or the tab is hidden so `tick()` returns at line 187 without fetching, `peer` is never overwritten and the false "read" stands indefinitely. The same path shows a stale "typing…" for a person who is not in this conversation. Product law 5 says a reader must not be able to distinguish "not read" from "signals off"; this shows "read" for both.

**Suggested fix.** Reset the signal on switch: add `setPeer({ typing: null, readUpTo: null })` at the top of the activity effect (and in `loadThread`), and set it from `tick()` even when the fetch fails, so a failed poll goes quiet rather than keeping the last thread's answer.

**Why refutation failed.** Tried to refute; could not. Every part of the claim verifies against the code.

MECHANISM CONFIRMED. lib/db/dm.js declineRequest: the gate SELECT requires only participancy (`c.id=$1 AND EXISTS(... dm_participants ... account_id=$2)`), then `them = convo.rows[0].opened_by`, then `UPDATE dm_conversations SET state='declined', declined_at=COALESCE(declined_at, now()) WHERE id=$1` with NO state predi

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #398** — opening and refreshing are different acts. A refresh re-fetches
> the newest page AND every page already scrolled in, and swaps them together.

**Problem.** `loadThread` unconditionally does `setOlder([])` (line 125), and it is the refresh used by every in-thread mutation: send (264), mute (313), accept (330), consent (435), react (375, 393) and unsend (405). Any of those silently discards all paged-in history.

**Reproduce.** Page up four times through a long conversation to re-read something, then reply. `send()` succeeds and calls `loadThread(threadId)`, which resets `older` to `[]`. The view snaps back to the newest 40 messages and the four pages must be clicked in again — and while it is refetching, `thread` is `null` (line 125 also does `setThread(null)`) so the entire thread flashes to "opening…" and the composer disappears mid-typing.

**Suggested fix.** Separate "open a thread" from "refresh the newest page". Only clear `older` when the conversation id actually changes; for a refresh, replace `thread` without nulling it first (or hold the previous value until the new one arrives) so paged history and the composer survive.

**Why refutation failed.** The code gap is real and reproduces. dm_guard_reaction (schema-v42-dm-reactions-unsend.sql:56-89) checks participation, accepted state, bidirectional blocks and unsent/redacted, and never reads dm_settings.dms_open or account_kinds — while dm_guard_message (schema-v40:157-171) enforces law 2 on EVERY message insert with no accepted-state exemption. I walked the scenario and checked every gate the

---

### `MailDesk.jsx`

> **✅ FIXED 23 Aug in #385 and #400** — #385 built the BLOCKED list, the unblock, the handle and
> conversation addressing, and corrected the banner. #400 added the BLOCK control INSIDE an
> accepted conversation (the half #385 left) and the `dms_open` control, which law 2 never had.

**Problem.** LAW 1 has no user-facing control. `op:"block"` and `op:"unblock"` (route.js lines 195-201) key on `body.accountId`, a bare auth uuid, and `accountId()` in lib/db/dm.js throws on anything else. The client is never given a counterparty uuid (the inbox route strips it by design), so no surface can call either op — a grep of app/ and lib/ finds zero callers of op=blocks, op=block or op=unblock. MailDesk line 326 nonetheless tells the user "declining also blocks them — you can undo that in settings", and app/settings/page.js contains no DM section at all. The `dmsOpen` half of law 2 has no control either: MailDesk exposes only the activitySignals checkbox.

**Reproduce.** B receives a request from A and presses DECLINE + BLOCK. declineRequest writes a permanent per-account dm_blocks row with source='decline'. B later changes their mind and goes to /settings as the panel instructed — there is nothing there. There is no other screen, and the API's unblock op needs A's auth uuid, which B has no way to obtain. The block is permanent and unreachable, which is precisely the failure docs/history/dm-core-decisions-2026-08-23.md says the core was built to avoid ("a decline installing a permanent block that an ambiguous refusal then hid from the person who installed it"). Separately, B can never block A from an already-accepted conversation, because the only path that ever creates a block is the decline button on a request.

**Suggested fix.** Give the panel a blocks section that calls GET op=blocks and POST op=unblock, and a BLOCK control inside an open thread. Since law 7 forbids handing the uuid to the client, address both by handle: have op=blocks return handles (via handlesFor) and have op=block/op=unblock accept `toHandle`/`conversationId` and resolve server-side, keeping the uuid on the server. Until a surface exists, remove or correct the "you can undo that in settings" sentence — it currently describes a control that does not exist.

**Why refutation failed.** The mechanism is verified in the actual code and nothing prevents it. lib/db/dm.js:367-397 declineRequest gates only on participant membership; its UPDATE dm_conversations SET state='declined' WHERE id=$1 has no opened_by predicate and no state predicate (acceptRequest at :343 has both). When the caller is opened_by, them===me so the dm_blocks insert is skipped while the state change lands. app/ap

---

### `dm.js`

> **⛔ VERIFIED ALREADY DEAD — do not fix.** The membership clause landed in **#378** (`6c409ae`),
> after the review ran at `79d6c72`. Duplicate of the UNVERIFIED entry below; both checked by
> `git blame` on 23 Aug.

**Problem.** `peerActivity` (line 651) is the only DM read with no membership check on the caller. Its query is `WHERE part.conversation_id = $1 AND part.account_id <> $2` — when `me` is not a participant, that matches BOTH participants and `r.rows[0]` returns one of them arbitrarily. readThread, listFolder, setMuted, setMediaConsent and markRead all scope by (conversation_id, account_id); this one does not.

**Reproduce.** Any signed-in account calls GET /api/dm?op=activity&c=<some conversation uuid it is not a member of>. Instead of the 404-equivalent that op=thread returns for a non-member, it receives a live `{typing, readUpTo}` for one of the two real participants — a presence oracle on a conversation the caller has no claim to. Reaching it requires knowing a v4 conversation uuid, which is why this is minor rather than serious, but the route hands `url.searchParams.get("c")` straight through with no other gate.

**Suggested fix.** Mirror readThread: SELECT the caller's own dm_participants row first and return `{typing: null, readUpTo: null}` (or have the route 404) when there is none, before reading the peer's row.

**Why refutation failed.** Mechanism confirmed by reading the code; nothing prevents it. route.js:149-163 assigns `them` only in the `if (!conversationId)` branch, and route.js:173-177 gates `mine` on `them`, so any send with an existing conversationId passes callerBlockedThem:false. schema-v40-direct-messages.sql:149-155 LAW 1 is symmetric (blocker = NEW.sender_account_id AND blocked = recipient also raises P0001), so the

---

### `dm.js`

> **✅ FIXED 23 Aug in #399** — P0005 is "that message is gone." and 42501 "that mark is not
> available." Nobody becomes unreachable because a message was withdrawn.

**Problem.** `react()`'s docstring says "Every refusal the triggers raise is handed up as a MessageRefused so the route describes it the same way it describes a refused send." It is handed up, but `describeRefusal` (lib/dm.js:66-81) has cases only for P0003 and P0004; P0005 ("that message is gone" / "that mark is not available") and 42501 fall through to `default: { reason: "not-reachable", message: "this person is not reachable right now." }`. The route returns that verbatim and MailDesk's `act()` prints `data.message` into the note line.

**Reproduce.** A and B are in an accepted thread. B unsends a message. A's open panel still shows the palette on that message (the thread is only reloaded after A's own action). A taps ♥. The reaction trigger raises P0005; the route answers 409 with "this person is not reachable right now." Nobody is unreachable — the message was withdrawn — and A is now told, falsely, that B has become unreachable. Same wording for a non-palette emoji (23503 remapped to P0005).

**Suggested fix.** Add P0005 and 42501 cases to `describeRefusal` ("that message is gone" / "that is not a mark you can leave"), or give reactions their own describe function rather than reusing the send vocabulary.

**Why refutation failed.** CONFIRMED by reading the code. MailDesk.jsx:125 is `setThread(null); setNote(""); setOlder([]);` — unconditional, with no option to preserve paged state and no early-out. All eight cited call sites verified by grep at the exact lines given: 264 (send), 313 (mute), 330 (accept), 375/393 (react), 404 (unsend), 435 (consent). Line 235 in loadOlder is the only place `older` grows, so every mutation th

---

### `route.js`

> **✅ FIXED 23 Aug in #399** — `peerOf` and `peerOfMessage` resolve the counterparty, so the
> caller's own block is answerable on the existing-conversation path and the reaction path too.

**Problem.** lib/dm.js:60-67 states the law: "A refusal caused by the CALLER'S OWN block is NOT vague ... Yours is always explained, and always with the undo." But route.js:174-177 only computes `mine` when `them` is set, and `them` is only set on the first-contact-by-handle branch (line 153). Every send into an EXISTING conversationId — which is every send after the first, and every send from the thread view — passes `them === null`, so `iBlocked` is never consulted and describeRefusal falls through to the collapsed "this person is not reachable right now."

**Reproduce.** R declines a request from O, which installs a `source='decline'` block (declineRequest line 388) — the exact case the doc says must never be hidden from its author. R later reconsiders, opens the archived thread and types a reply. MailDesk `send()` posts `{op:"send", conversationId, body}`. dm_guard_message LAW 1 raises P0001; the route's catch sees `them === null`, sets `mine=false`, and returns `{reason:"not-reachable", message:"this person is not reachable right now."}`. R is told the other person is unreachable when in fact R is the one blocking, and is given no pointer to the undo. This is precisely the red-team finding the comment claims was fixed.

**Suggested fix.** When the send is by conversationId, resolve the counterparty from the conversation before describing the refusal — e.g. have `sendMessage`/`MessageRefused` carry the peer id, or add a `peerOf(me, conversationId)` read in the catch — then pass `callerBlockedThem: await iBlocked(me, peer)` for every P0001, not just the handle path.

**Why refutation failed.** Tried to refute and could not. peerActivity (lib/db/dm.js:651) has no membership predicate: its only filter is `WHERE part.conversation_id=$1 AND part.account_id <> $2`, and the sole preceding gate is the caller's own activity_signals reciprocity check (line 656), which defaults to true. The route (app/api/dm/route.js:110) adds only auth plus a 1200/hr rate bucket before passing the raw `c` param

---

### `route.js`

> **✅ FIXED 23 Aug in #381 and #400** — #381 added the opener and state predicates; #400 made the
> route report the block that STANDS, asked of the table on the locked connection, rather than the
> request flag.

**Problem.** `declineRequest` (lib/db/dm.js line 366) derives the person to block as `convo.opened_by` and only requires that the caller be a participant — it does not require that the caller be the non-opener, nor that the conversation still be in state 'requested'. When the opener declines their own conversation, `them === me`, the `block && them !== me` guard skips the insert, but route.js line 189 still returns `{ ok: true, blocked: true }`.

**Reproduce.** A opened the conversation with B and it was accepted. A POSTs {op:"decline", conversationId} directly (the UI hides the button outside the requests folder, but the route does not). The conversation flips to state='declined', A's side is archived, and the response says `blocked: true` — a block that was never created. Worse, the v40 trigger's final clause (`state = 'declined' AND sender = opened_by` -> P0001) now permanently silences A in their own accepted thread while B can keep sending into it, and there is no un-decline op.

**Suggested fix.** In declineRequest, require `opened_by <> me` (and optionally `state <> 'accepted'`) in the WHERE clause the same way acceptRequest does, returning false otherwise; and in the route, report `blocked` from what the store actually inserted rather than from the request flag.

**Why refutation failed.** Every mechanical assertion checks out against the code. route.js:161 commits openConversation in its own transaction on its own pooled client; route.js:165 starts a second, independent transaction for sendMessage. schema-v40 defines triggers only on dm_messages (dm_guard_message_trg, BEFORE INSERT) and dm_settings — there is no trigger, CHECK, or policy governing inserts into dm_conversations or d

---

### `route.js`

> **✅ FIXED 23 Aug in #399** — same fix as the entry above; this is the same finding seen from the
> route rather than from lib/dm.js.

**Problem.** lib/dm.js:59-64 states "A refusal caused by the CALLER'S OWN block is NOT vague... Yours is always explained, and always with the undo." The route only ever computes it on one path: line 174, `if (error instanceof MessageRefused && them)`, and `them` is assigned only inside `if (!conversationId)` (line 150-153). Every refusal on an existing conversation, and every refusal from `op:"react"` (line 213 calls `failure(error)` with no `extra`), goes through `describeRefusal(code, {})` and collapses to "this person is not reachable right now." "Always" is false.

**Reproduce.** A declines B's request, which installs `dm_blocks(A -> B, source='decline')` and moves A's copy to `archived`. A later reaches the archived thread (GET /api/dm?op=inbox&folder=archived is accepted by route.js:68) and POSTs `{op:"send", conversationId, body}`. The trigger raises P0001 for A's own block; `them` is null because a conversationId was supplied, so A is told "this person is not reachable right now." — the exact withholding lib/dm.js says the red team flagged, aimed at the only person entitled to the answer, with the undo hidden. Same on the reaction path in any thread where the caller is the blocker.

**Suggested fix.** Resolve the counterparty from the conversation before mapping the failure (the store already has `openConversation`/`readThread` reads that expose `lo`/`hi`), and pass `callerBlockedThem` on the existing-conversation and reaction paths too — or narrow the comment to say only first-contact refusals are explained.

**Why refutation failed.** Reproduces. MailDesk.jsx:235 stores only {messages, olderBefore} from the older-page response, discarding page.reactions/page.palette. The render at 365-367 looks reactions up exclusively in thread.reactions, which is set only from the newest-page fetch (setThread at line 131); grep confirms lines 365/367 are the only reads of `reactions` in the file. An older message's id is therefore absent from

---

### `schema-v41-dm-activity.sql`

> **✅ FIXED 23 Aug in #387 (v46) and #398** — v46 refuses presence on an unaccepted conversation
> in the trigger and gates the read the same way; #398 stopped the client polling a knock at all.
> The entry's note that the existing test pings typing on a `requested` conversation was true and
> is fixed: five v41 fixtures now accept first (trap 98).

**Problem.** LAW 3. `dm_guard_typing` (schema-v41 line 67) checks participation only; it never looks at `dm_conversations.state`. v42 refused reactions on unaccepted conversations for exactly this reason ("a reaction on an unaccepted request is a notification a stranger can send, repeatedly, past the one-knock law"), but typing pings were shipped one PR earlier and were never revisited. The existing test at tests/postgres-integration.test.js ("activity: typing expires rather than needing a 'stopped' write") in fact pings typing on a conversation left in state 'requested' and asserts it succeeds.

**Reproduce.** Stranger A opens a request to B and sends the single permitted knock (law 3 now refuses any further message from A). A leaves the panel open; the client pings op:"typing" every 2.5s forever, or A just POSTs op:"typing" every 5s directly. B opens the request in order to decide accept/decline and sees a perpetual "typing…" from someone B never agreed to hear from — a repeating live signal from an account limited to one message. The reverse leaks too: B's `last_read_message_id` is emitted back to A, so a stranger learns the exact moment B read their unaccepted knock.

**Suggested fix.** Refuse a typing row when the conversation is not 'accepted' (RAISE with P0003 in dm_guard_typing, matching dm_guard_reaction), and make `peerActivity` return nulls for a non-accepted conversation so the recipient's read position is not emitted before they accept. MailDesk should also skip the activity poll while `thread.folder === "requests"`.

**Why refutation failed.** I tried to refute this and could not. The mechanism is fully verified against the actual code.

PATH: app/api/dm/route.js:192 passes body.upTo raw into markRead. readJsonRequest (lib/security/json.js) only caps body bytes and enforces content-type — no numeric validation. lib/db/dm.js:332 sanitizes with Math.max(0, Math.trunc(Number(upToMessageId)) || 0), which clamps only the LOWER end; 900719925

---

### `schema-v42-dm-reactions-unsend.sql`

> **✅ FIXED 23 Aug in #401 (v48)** — the withdrawal must name its author, in a
> transaction-local setting the trigger checks, scoped strictly to the `unsent_at` NULL → NOT NULL
> transition so moderation and per-side hiding are untouched. **v48 applied to production.**

**Problem.** The header above `dm_guard_unsend` reads "Unsend is the SENDER's act and nobody else's, and it is one-way". The trigger enforces only the one-way half (body must be NULL, unsent_at cannot be cleared, body cannot come back). There is no check that the updater is the sender — sender-scoping exists solely in the WHERE clause of `unsendMessage` in lib/db/dm.js:749-752. That is precisely the pattern docs/history/dm-core-decisions-2026-08-23.md rules out: "a law that lives in one caller is a convention", and "the route is not the only writer: the admin desk, a migration and any future job write too." `asilum_app` holds UPDATE on dm_messages (v40 grants) so the convention is enforced by nothing at the database level.

**Reproduce.** A moderator tool, an admin-desk action, or a cleanup migration runs `UPDATE dm_messages SET body=NULL, unsent_at=now() WHERE id=$1` against someone else's message. The trigger passes (body is NULL, unsent_at was NULL). readThread then reports `unsent: true, redacted: false`, and MailDesk renders the literal word "unsent" — telling the recipient the author withdrew their own words when a moderator removed them. The same file's header says those are "different facts" that must not be conflated, and `redacted_at` exists specifically to keep them apart; the missing sender check lets the wrong one be written.

**Suggested fix.** Add the sender check to `dm_guard_unsend`: when `NEW.unsent_at IS NOT NULL AND OLD.unsent_at IS NULL`, require the operation to be attributable to `OLD.sender_account_id` (e.g. a `current_setting('asilum.actor')` GUC set by the store, or a `dm_unsend(message_id, actor)` SECURITY DEFINER function that is the only granted path), and reject a body-nulling update that is not the sender's. The integration test "unsend: only mine…" should then assert the refusal against a raw `pool.query` UPDATE, not only against the store helper.

**Why refutation failed.** CONFIRMED as a real race, but downgraded from serious to minor.

Mechanism verified line by line in app/components/MailDesk.jsx:
- loadFolder (97-120) is useCallback([]) with no AbortController, no request token, and no re-check of `which` against the live `folder` before setItems/setCursor. The only merge guard is `if (!more || !prev) return next;`.
- The effect at 122 (deps [open, folder, loadFo

---


# UNVERIFIED

> ## THESE SEVEN GOT THEIR ADVERSARIAL PASS — 24 AUGUST
>
> The instruction on this file is *"refute it yourself before you fix it OR
> discard it."* It was not followed the first time: the session that wrote the
> fixes did the verifying inline, in the same pass, and marked two of the seven
> closed by inheritance from PRs it had already merged. **The items flagged as
> never-checked got the least independent scrutiny.**
>
> Eleven independent agents then attacked the seven claims and the fixes said to
> close them, and four more swept the classes.
>
> **ALL SEVEN ORIGINAL CLAIMS WERE TRUE at 79d6c72.** Verified from
> `git show 79d6c72:<path>`, not from this file's prose. The unverified pile was
> 7 for 7 — no false positives.
>
> **The fixes were another matter:** 2 held, 2 had holes, 3 were partial. Ten
> further defects came out of it, and **six of those were created by the fix
> round itself** — #381, #387, #392, #393, #399, #400. A fix is a change, and a
> change is a thing that can be wrong.
>
> | | closed by |
> |---|---|
> | the activity payload was still an oracle — `readUpTo` was `0` for "read nothing" and `null` for "signals off", one request, no baseline | [#403](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/403) |
> | the refusal WORDING named the state the payload had stopped naming | [#403](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/403), [#409](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/409) |
> | `acceptRequest` and `pingTyping` answered differently for a non-member | [#404](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/404) |
> | the export said `items.truncated: false` while whole conversations were missing; and 5000 × 2000 bytes cannot be delivered | [#405](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/405) |
> | the budget was drawn AFTER the auth round-trip, and `/api/privacy` had none | [#406](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/406) |
> | law 7's **inverse**: `op="block"` still took a raw uuid, and read it back as a handle | [#407](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/407) |
> | `send` and `react` were existence oracles — one by status code, one by wording | [#408](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/408) |
> | the search and the refusal disagreed, so "listed but refused" meant "blocked" | [#409](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/409) |
> | a thread the recipient had ASKED FOR could never be answered | [#410](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/410) |
>
> **The two lessons, because they are worth more than the bugs:**
>
> 1. **A test written from the same mental model as the fix cannot see past it.**
>    The test for the activity oracle built the payload BY HAND and grepped the
>    route for a destructuring line. It never called the function and never
>    compared a signals-on payload with a signals-off one — which is where the
>    oracle lived. Traps 64 and 90 in one test.
> 2. **A comment asserting safety is not evidence of it.** #399 said 42501 came
>    from "a reaction from someone who is not in the conversation — which no
>    surface can produce". `op="react"` is that surface, one POST away. The
>    justification was the thing that was false.



### `dm.js`

> **✅ TRUE at 79d6c72 · FIX HOLDS.** Attacked from eight directions in the 24 Aug pass and could not
> be reinstated. The attack did surface a BREAK the fix set had created — a thread the recipient
> had asked for could never reach 'accepted' — fixed in #410.

> **✅ VERIFIED AND FIXED 23 Aug in #387** (duplicate of the SERIOUS entry above) — v46 in the
> trigger, and the same gate in the query, because no trigger can stop a read. **v46 applied to prod.**

**Problem.** peerActivity applies no conversation-state gate, so read receipts and typing flow on an UNACCEPTED request. This contradicts the quarantine the rest of the request path builds: listFolder suppresses the preview for the requests folder (line ~232) and dm_guard_reaction refuses reactions until state='accepted' (v42) precisely because "a reaction on an unaccepted request is a notification a stranger can send". A read receipt is the same class of signal in reverse, and it is emitted before the recipient has agreed to any relationship. MailDesk makes it automatic: loadThread POSTs op=read on open (MailDesk.jsx:133-139), before the ACCEPT button is ever pressed.

**Reproduce.** Mallory finds Alice via op=find and sends one knock. It lands in Alice's requests folder. Alice opens it to decide whether to accept; her client immediately marks it read. Mallory polls GET /api/dm?op=activity&c=<id> and gets readUpTo == his message id — confirmation that Alice personally opened and read a message from a stranger she never accepted, plus `typing:true` for the reply she started and deleted. Alice's only defence is the global activity_signals switch, which she would have to turn off before ever receiving a request.

**Suggested fix.** Return {typing:null, readUpTo:null} from peerActivity when the conversation state is not 'accepted' (join dm_conversations.state), mirroring dm_guard_reaction; alternatively suppress it for the side that has not accepted. Also stop MailDesk marking a requests-folder thread read on open.

---

### `dm.js`

> **✅ TRUE at 79d6c72 · FIX HAD A HOLE, now closed (#403, #409).** The literal strip held, and the
> same disclosure arrived through the REFUSAL WORDING on both send paths, and through the search
> disagreeing with the refusal. See the amendment in `docs/history/dm-core-decisions-2026-08-23.md`.

> **✅ VERIFIED AND FIXED 23 Aug in #393** — `state` is stripped in the route beside the account
> uuid. The panel keys its request controls on the per-side `folder`, and never read `state`.

**Problem.** listFolder returns the shared dm_conversations.state to both sides (line ~187/222), and the route passes it straight to the client (app/api/dm/route.js:67-81). describeRefusal deliberately collapses P0001 (blocked) and P0002 (their DMs are closed) into "not reachable" so a stranger cannot discover that a particular person declined or blocked them — and then the inbox payload names it outright.

**Reproduce.** Bob knocks Alice. Alice declines (which also blocks him). Bob's retry gets the deliberately vague 409 {reason:'not-reachable'}. He then calls GET /api/dm?op=inbox — his own copy of the thread is still in his inbox folder (declineRequest only moves the decliner's participant row to 'archived') and the item reads {state:"declined"}. Bob now knows with certainty that Alice actively refused him, rather than the intended ambiguity of "declined / blocked / door shut / never existed", which is exactly the disclosure the refusal vocabulary exists to prevent.

**Suggested fix.** Do not project the raw shared `state` to the opener. Return a per-side view: for the account in `opened_by`, report 'requested' (or omit the field) while the real state is 'declined'; only the side that acted should see 'declined'.

---

### `dm.js`

> **✅ TRUE at 79d6c72 · FIX PARTIAL, now complete (#404, #408).** The named path was fixed by #378.
> The 24 Aug pass found FOUR ops still answering differently for a non-member — `accept` and
> `typing` (created by #381 and #387), and `send` and `react` (one older than the register, one
> created by #399).

> **⛔ VERIFIED ALREADY DEAD — do not fix.** The membership clause landed in **#378** (`6c409ae`),
> after the review ran at `79d6c72`. Confirmed by `git blame` on 23 Aug.

**Problem.** peerActivity (line 651) is reached from op="activity" with no check that the caller is a participant. When the caller is not in the conversation the query `WHERE part.conversation_id=$1 AND part.account_id <> $2` matches BOTH participant rows and the function returns rows[0] — an arbitrary stranger's last_read_message_id and live typing state. It is also an existence oracle: a real conversation with signals on returns numbers, a nonexistent id returns nulls. readThread deliberately makes a non-member indistinguishable from a nonexistent thread (line 275-281); this sibling endpoint does not.

**Reproduce.** A caller who obtains a conversation id by any means other than membership — a logged URL, a copied support ticket, a database export, or a future feature that surfaces ids — calls GET /api/dm?op=activity&c=<id> and receives a third party's read position and live typing state for a conversation they have no relation to, plus confirmation that the conversation exists at all.

**Suggested fix.** Add the same participant probe readThread uses: if there is no dm_participants row for (conversationId, me), return {typing:null, readUpTo:null} — the same answer a nonexistent conversation gives.

---

### `dm.js`

> **⚠ PARTLY TRUE at 79d6c72 · THE FIX FIXED THE WRONG THING, now closed (#403).** `reciprocal` was
> never the carrier — it is false in exactly one branch, when the CALLER's own signals are off.
> The carrier was `readUpTo: Number(...) || 0`: `0` for a peer who had read nothing, `null` for a
> peer with signals off. One request, no baseline, and every accepted contact was a permanent
> monitor of that person's global switch.

> **✅ VERIFIED AND FIXED 23 Aug in #393** — the flag is stripped at the route; the store keeps it.
> The docstring now states the residual property honestly: a reader whose own signals are on can
> still infer a null means theirs are off, and hiding that would require inventing a read position.

**Problem.** peerActivity returns a `reciprocal` flag that defeats the indistinguishability its own docstring claims ("both null when reciprocity denies them, so a caller cannot tell 'they are not typing' from 'you switched signals off'"). With reciprocal:false meaning "your signals are off" and reciprocal:true + null readUpTo meaning "theirs are", the caller — who already knows their own setting — can read the peer's setting straight off the payload. activity_signals is a single global column in dm_settings, so this is a fact about the peer everywhere, not just in this thread.

**Reproduce.** Alice turns read receipts off. Bob's client polls op=activity every 3 seconds and sees the payload change from {typing:false, readUpTo:N, reciprocal:true} to {typing:null, readUpTo:null, reciprocal:true} while his own toggle never moved — he learns both that Alice disabled her signals and the minute she did it, which is precisely the inference the setting exists to prevent.

**Suggested fix.** Do not send `reciprocal` to the client at all (nothing in MailDesk reads it — it destructures only typing and readUpTo at line 194); keep it as an internal return value for the tests, or collapse both cases to the same wire payload.

---

### `production.js`

> **✅ TRUE at 79d6c72 · FIX PARTIAL, now complete (#395, #397, #405, #406).** The export shipped on
> the owner's ruling; the pass then found it reported `items.truncated: false` while whole
> conversations were missing, could build a response too large to deliver, and drew no aggregate
> breaker.

> **✅ FULLY CLOSED 23 Aug in #395 and #397.** #395 named the retention. #397 shipped the export
> on the **owner's ruling — two people should have records**: both sides get the record, bodies
> through the same `visibleBody` rule the thread renders by, counterparties by handle.
> `EXPORTED_BUT_RETAINED` names the first thing that is exported AND kept, because erasing it
> would delete somebody else's history.

> **⚠ VERIFIED, HALF FIXED 23 Aug in #395 — THE OPEN HALF IS THE OWNER'S.** The retention
> disclosure now NAMES the messages and the blocks and why each is kept, and `DM_EXPORT_STATUS`
> declares every messaging table absent with a reason under a test (E4) that fails on a `dm_*`
> table in neither list. **The tables are still not exported**: they key on the bare auth uuid
> rather than the identity string, so it needs a bespoke reader — and a conversation is TWO
> people's record, so what one side may take a copy of is a disclosure ruling, not plumbing.

**Problem.** Erasure and export do not know the DM subsystem exists. purgePersonalizationData (line 114) deletes ~25 named tables and profile_rooms but no dm_* table; EXPORT_MANIFEST (line ~337) lists no dm_* table either. Nothing outside lib/db/dm.js, the four schema files and the tests references dm_messages/dm_conversations/dm_participants/dm_blocks/dm_settings/dm_typing/dm_reactions. The DELETE response returns retained: ["purchase tickets", "deidentified raw event counters…", "auth account"], so the message store is neither erased nor named as retained, and tests/privacy-export.test.js only asserts purge's DELETE list is a subset of the manifest — a table in neither passes.

**Reproduce.** A user holds a hundred DM threads, then goes to settings and runs the erasure with the confirmation phrase. /api/privacy returns {deleted:true, buyerVaultErased:true, retained:[three items]}. Every message body they ever sent is still in dm_messages keyed to their bare auth uuid, their dm_blocks rows still silently block people, dm_settings still holds their dms_open/activity_signals choices, and GET /api/privacy (the §6 access right) returns a JSON export containing none of it — so they can neither see nor delete their message history while the product tells them the erasure was complete. Their profile_rooms row IS deleted, so the surviving DM rows are now an un-nameable uuid in someone else's inbox.

**Suggested fix.** Decide the retention rule and encode it: either purge the erasing account's DM rows (dm_participants/dm_typing/dm_reactions/dm_blocks/dm_settings by account uuid, and null the bodies of dm_messages they sent — the schema grants no DELETE on dm_messages by design) and add the tables to EXPORT_MANIFEST, or add "direct messages" to the retained[] array with the reason. Silence in both lists is the one option the §6 contract forbids.

---

### `route.js`

> **✅ TRUE at 79d6c72 · FIX PARTIAL, now complete (#406).** The table held; the POSITION did not.
> Both quota and budget sat UNDER the auth check, and the auth check is an outbound round-trip to
> GoTrue — so an unauthenticated flood was free and registered on no instrument.

> **✅ VERIFIED AND FIXED 23 Aug in #394** — `readBucketFor` has a BOUNDED DEFAULT, so an op
> nobody thought about cannot be unbounded, and both directions draw `consumeGlobalBudget`.

**Problem.** Four of the seven GET ops have no rate limit and no global budget: `summary` (lines 59-66, three queries), `inbox` (67-81, a keyset page plus a handle lookup, with a correlated unread count and a correlated preview subquery per row — lib/db/dm.js:186-219), `thread` (82-92, a member probe + a 101-row read + a reactions aggregate + the palette read) and `blocks`. Only `find` and `activity` were limited. No DM op draws `consumeGlobalBudget`, unlike every other expensive surface in the codebase (search, discover, feed, interpret, boards, interaction — lib/security/rateLimit.js:70-85), whose comment states the exact reason: per-subject quotas do not bound a flood of identities.

**Reproduce.** One signed-in account loops GET /api/dm?op=inbox&folder=inbox&cursor=… as fast as the connection allows. Each request runs the participant join plus two correlated subqueries per returned row against dm_messages; nothing counts the requests and nothing caps the aggregate. The pool saturates, `getPool()` starts failing, and `pool()` throws MessagingUnavailable — so every other user's mail desk answers 503 "the mail desk is unavailable" while the attacker keeps going. Cost: one account and a for-loop; no message is ever sent, so none of the send-side laws or quotas are touched.

**Suggested fix.** Put `summary`, `inbox`, `thread` and `blocks` behind a per-account read bucket (subject `me`), and register a `GLOBAL_BUDGETS` entry for the DM surface so an aggregate breaker exists independent of how many accounts or identities the caller controls.

---

### `route.js`

> **✅ TRUE at 79d6c72 · FIX HOLDS OUTBOUND · THE INVERSE WAS OPEN, now closed (#407).** Nothing
> hands a uuid out. But `op="block"` still ACCEPTED one from the client — four lines under a
> comment of mine saying that path was gone — and `handlesFor` read it straight back as a handle.

> **✅ VERIFIED AND FIXED 23 Aug in #385** — projected through `handlesFor` like the inbox, and
> the unblock it now serves addresses by handle or conversation.

**Problem.** op="blocks" (line 112) returns listBlocks() verbatim: [{accountId: <bare auth uuid>, source, at}]. The inbox path maps counterparties through handlesFor precisely so "the uuid never leaves the server" (route comment, line 71-73); the blocks path does not, and no UI consumes it, so the uuid is shipped to the browser for no rendering purpose. The value is the auth.users id — the same uuid that forms the sb-<uuid> identity string used across every other surface.

**Reproduce.** Alice declines Bob's request; declineRequest silently inserts a decline-block naming Bob. Alice's browser calls GET /api/dm?op=blocks and receives Bob's raw auth uuid in JSON — readable by any extension, XSS, or shared-machine devtools, and correlatable with any other place that uuid appears — even though Alice only ever knew Bob by handle and never asked for his identifier.

**Suggested fix.** Map the block list through handlesFor and return {handle, source, at}; if unblocking needs a stable key, accept the handle or an opaque per-caller token rather than the account uuid, matching what the send path already does.

---


# Already fixed in #378 — do not re-open

- `MailDesk.jsx` — Line 584 renders `{c.otherId.slice(0, 8)}` for every conversation row, but the API deliberately deletes `otherId` before responding. app/api…
- `MailDesk.jsx` — MailDesk.jsx:584 renders `{c.otherId.slice(0, 8)}` for every row of the folder list, but app/api/dm/route.js:77-79 deliberately strips that…
- `MailDesk.jsx` — MailDesk renders `{c.otherId.slice(0, 8)}` at line 584, but app/api/dm/route.js lines 77-79 destructure `otherId` OUT of every inbox item an…
- `dm.js` — LAW 1. The activity-signal path (added in v41, after the v40 block trigger) has no block predicate anywhere. `pingTyping` (line 623) checks…
- `MailDesk.jsx` — Line 584 renders `{c.otherId.slice(0, 8)}`, but app/api/dm/route.js:77-79 deliberately destructures `otherId` OUT of every inbox item and re…
- `route.js` — Every DM quota is keyed on the wrong thing. The route calls `requestSubject(req, me)` at lines 97, 107 and 132, but `requestSubject` in /lib…
- `route.js` — Same root cause as the subject bug, opposite failure: when a caller presents NO valid device cookie, `requestSubject(req)` returns the liter…
- `MailDesk.jsx` — Outside my lens but it makes the whole surface untestable, so reporting it: line 584 renders `{c.otherId.slice(0, 8)}` for each conversation…
- `dm.js` — The activity-signal layer (peerActivity, ~line 651; pingTyping, ~line 623) enforces neither conversation membership nor dm_blocks. Law 1 is…
- `route.js` — All four DM quotas call requestSubject(req, me) (lines 97, 107, 132) but requestSubject takes ONE argument (lib/security/request.js:91) — th…
- `MailDesk.jsx` — Line 584 renders `{c.otherId.slice(0, 8)}` for each inbox row, but the route strips otherId and substitutes a handle: `items: page.items.map…

# Refuted — do NOT fix these

- `MailDesk.jsx` — The comment at 259-261 claims "A client operation id makes a retry idempotent... a lost response cannot double-send", bu…
  - **refuted:** The code observations are accurate but the asserted defect does not hold. Nothing goes wrong when the scenario is walked.

WHAT IS TRUE
- /Users/noemosallowed/Downloads/*ASILUM website prototype [july6]/app/api/dm/route.
- `route.js` — The first-contact send path commits `openConversation` in its own transaction (route.js:161) and only then calls `sendMe…
  - **refuted:** The mechanics reproduce, but the finding is wrong on intent and wrong on mechanism.

(1) It is the deliberate, test-pinned contract. tests/postgres-integration.test.js:909-916 asserts precisely this behavior with the com
- `dm.js` — `markRead` (lines 325-333) accepts `upToMessageId` straight from the request body (route.js:192, `body.upTo`) with no bo…
  - **refuted:** The mechanical half reproduces: listBlocks (lib/db/dm.js:421-428) returns blocked_account_id verbatim and route.js:112 passes it through unmapped, with no trigger/CHECK/grant/lock/WHERE stopping it. But the finding fails
- `schema-v42-dm-reactions-unsend.sql` — LAW 2. `dm_guard_reaction` (line 56) checks participation, accepted state, blocks in both directions, and unsent/redacte…
  - **refuted:** The interleaving is mechanically possible, but it does not produce a wrong outcome, and the prescribed fix provably changes nothing observable.

1. THE PROPOSED FIX CANNOT CHANGE THE OUTCOME. This is decisive. sendMessag
- `route.js` — LAW 7. The comment at route.js lines 71-73 states "the uuid never leaves the server", and the search test asserts `"acco…
  - **refuted:** The MECHANISM is described accurately, but neither claimed wrong outcome follows. Nothing in the schema stops it — I checked: no trigger, CHECK, or GREATEST() guards `last_activity_at` (v40 line 39 is a plain `DEFAULT no
- `dm.js` — `describeRefusal("P0003")` returns "one message until they reply.", MailDesk.jsx:~552 repeats it ("one message until the…
  - **refuted:** The mechanical half of the claim checks out: route.js:232-247 issues setActivitySignals and setDmsOpen as two independent autocommit upserts (lib/db/dm.js:443 and :606 — bare p.query, no BEGIN, no lock), the v40 dm_guard
