# DM core — what was cut, and why

The design pass (13 agents) produced a 14-table design; the red team returned
**9 blockers and 23 serious findings** against it. This file records what the
core actually builds and what was deliberately removed, because the reasoning
is the valuable part and a later reader will otherwise re-add the cut pieces.

## The three shapes that produced most of the blockers

**1. A pinned copy of a fact that lives elsewhere.** `dm_settings.account_kind`
was a denormalized copy of `account_kinds.kind`. Four blockers came from it:
the reach FK evaluated the PIN rather than the account's real kind, a
passport→business conversion could not be written at all, and a stale pin
disarmed "a business cannot switch DMs off" on the write side. **Cut. The
trigger joins `account_kinds` live.** A copy of a fact is a second fact.

**2. Denormalized counters.** `dm_inbox_counters.unread_conversations`,
`dm_participants.unread_count` and `message_count` each need an invariant
nobody can violate, and the red team found drift in both directions plus a
CHECK that aborted a user's send when it fired. **Cut. Unread is DERIVED** from
`dm_messages` against `last_read_message_id`, on an index built for it. At this
scale the read cost is nothing and the drift class disappears entirely.

**3. Media.** Consent laundering across media classes, no revocation backstop,
validation only at window birth, a membership check missing from the media
route, and an all-or-nothing promise split across two transactions — five
blockers, all in a pipeline that OWNER-DECISIONS #3 keeps switched off.
**Cut from the core.** The consent STATE ships (both sides, per conversation,
revocable, with the revocation timestamp); the pipeline that could leak through
it does not exist yet, so there is nothing to leak. Enforcement lands in the
same transaction as the pipeline, which is the only place it can be correct.

## What the core builds

- `dm_conversations` — the pair, `CHECK (lo < hi)` + `UNIQUE (lo, hi)`, so a
  self-DM and a duplicate thread are unrepresentable rather than prevented.
- `dm_participants` — two rows, the per-side state: folder (inbox/requests/
  archived), `last_read_message_id`, and the media-consent pair.
- `dm_messages` — append-only text.
- `dm_blocks` — **per-account** (owner ruling, 23 Aug). Not per-conversation,
  so it survives a new thread and every reply path by construction.
- `dm_settings` — `dms_open` only. No pinned kind.

## The laws, and where each is enforced

Every one is a database trigger, not an application check, because the route is
not the only writer — the admin desk, a migration and a future job are writers
too, and a law that lives in one caller is a convention.

1. **A block stops delivery, in either direction.** Per-account.
2. **A passport with `dms_open = false` receives nothing.** The trigger reads
   `account_kinds` LIVE; a business's row is refused by the same trigger, so
   "a business cannot switch DMs off" is enforced rather than asserted.
3. **One knock.** An unaccepted conversation takes exactly one message from the
   initiator, counted in the trigger rather than trusted from a column.

## Deliberately NOT in the core, with the reason

- **Media** — see above. OWNER-DECISIONS #3.
- **Moderation, reports, legal holds** — the red team showed `op:"report"` is a
  weapon when it both freezes a thread and authorises moderator read access,
  and there are no named moderator credentials to attribute an action to
  (one shared `ADMIN_TOKEN`). Reporting without staffing is a button that
  promises a response nobody is on the other end of.
- **`dm_events`** — an append-only record of every send, refusal and consent
  flip, keyed to a person, with no purge grant. That is a surveillance ledger
  the privacy contract would have to answer for.
- **Ambiguous refusals** — collapsing every negative outcome to "not
  reachable" hides a person's OWN block from them. The core tells you when the
  refusal is yours.

---

## RULING — search is not a block detector (23 Aug, autonomy window)

**Blocker 4** of `dm-open-findings-2026-08-23.md` was a design error of mine,
not an oversight. I wrote the rule that collapses "they blocked you" and "their
door is shut" into one sentence — *"precisely because distinguishing them tells
a stranger which one it was"* — and then, three PRs later, excluded blockers
from the DM search. A person vanishing from your search says exactly what the
collapsed refusal refuses to say.

The register parked it as needing a ruling because both options look like they
leak something. **The owner was away, so I made the call.** It is one predicate
and it reverses in one line; the reasoning is here so that reversal is an
informed one.

### The ruling
**A person who has blocked me stays LISTED in search, and stays UNADDRESSABLE.**

`findAddressees` excludes only blocks *I* made. `resolveAddressee` keeps the
full bidirectional predicate, so addressing still fails — with the same
collapsed refusal, from the same branch, as a closed door or a handle nobody
registered. It returns *before* `openConversation`, so a blocked sender cannot
bring an empty thread into existence in someone's requests folder.

### Why this and not the other way
- **The exclusion never enforced anything.** A profile room is a public page.
  The handle was always visible; only the DM search hid it. Enforcement lives
  in the trigger and in `resolveAddressee`, and neither moved.
- **It cost the entire ambiguity design.** Two searches — one from your own
  account, one from a throwaway — read the block. Against a business it took no
  second account at all: a business cannot close its door, so absence could
  only mean a block.
- **Detection is the cost driver in ban evasion.** Someone who cannot tell
  whether a block landed wastes effort. Someone with a definitive read
  re-registers immediately.

### What it costs, stated plainly
Someone you blocked can see your handle in a DM search result. They could
already see it on your public room, and they cannot write to you from either.
If the owner would rather the blocked person never see the handle in the mail
desk at all, that is a legitimate product preference — but it brings the oracle
back with it, and the honest version of that choice is to also drop the
ambiguity in `describeRefusal` and tell people plainly when they have been
blocked. Half of each is the state we were in.

### To reverse
Restore the second arm of the `NOT EXISTS` in `findAddressees`
(`b.blocker_account_id = r.account_id AND b.blocked_account_id = $1`) and
update the "DM search is not a block detector" test. Read this note first.

---

## RULING — two people should have records (23 Aug, owner)

`#395` closed the half of the erasure/export finding that was mine to close —
the retention disclosure now names the messages it keeps — and left one
question that was not: **does a DM export ship, and in what shape?** A
conversation is two people's record, so one side asking for a copy is asking
for words the other side wrote. That is a disclosure decision, not plumbing.

### The ruling
**Two people should have records.** Both sides are *in* the conversation, so
both sides get it. A person's own conversation is theirs to keep; the
alternative is a record only the company holds.

### What that means in the code
- `exportMessagesFor` in `lib/db/dm.js` reads one person's whole record:
  conversations, both sides' messages, the marks on them, their blocks, their
  two settings.
- **It shows exactly what the thread shows.** Bodies go through `visibleBody`,
  the same function `readThread` renders by — extracted for this, because a
  second copy of that rule is how an export ends up showing something the
  thread would not. An unsend stays withdrawn, a moderator's redaction stays
  redacted, and a message hidden from the recipient does not reappear in their
  download.
- **Law 7 holds.** Counterparties are named by handle; the account uuid stops
  at the server. Someone who never published a room has no handle, and the
  conversation is still theirs to read.
- **Presence is not a record.** `dm_typing` expires in six seconds and says
  nothing about what was said. It stays declared-absent.

### The structural consequence, which is the interesting part
`EXPORT_MANIFEST` meant *erased AND exported*, and `E2` enforces that
biconditional — a manifest table erasure never touches fails the test, because
until now such a table could only be a mistake.

**A two-party record is the first thing that is genuinely exported and
retained.** Erasing it would delete somebody else's history of a conversation
they were in. So the asymmetry got its own name — `EXPORTED_BUT_RETAINED` —
rather than a hole in `E2`, and every `dm_*` table now sits in exactly one of
three declared places, with tests that fail on a table in none of them or in
more than one.

`dm_settings` is in that list for a reason worth repeating: **both switches
default to open**, so erasing the row is not neutral. It silently reopens what
somebody closed.

### AMENDMENT to the search ruling (23 Aug, same day)

The ruling above kept blocked-by-them people **listed** and unaddressable. The
adversarial pass over the UNVERIFIED findings showed that half-applied it: the
search still excluded a passport whose **door was shut**, so

> present in search **and** refused on send

could only mean a block, because a shut door would have removed them from the
results. The refusal collapses P0001 and P0002 on purpose. **Both surfaces have
to agree for that collapse to be worth anything, and it was the search that
disagreed.**

`findAddressees` now excludes only: myself, people **I** blocked, and hidden or
under-review rooms. Everything it lists and `resolveAddressee` refuses is more
than one thing.

**The cost, stated:** a search result you cannot write to. Their room is a
public page either way, so nothing is revealed that was not already published —
and the alternative is a collapse that only looks like one.

And the same day showed the third surface: the **refusal wording** named what
the payload and the search had stopped naming, on both send paths. An opener
whose knock was never accepted now reads the same sentence whether it was
ignored, declined, blocked or shut out — by handle or by conversation.
