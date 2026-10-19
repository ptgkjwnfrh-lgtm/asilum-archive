# WORK IN FLIGHT — ✅ ALL MERGED, 3 September 2026

**This backlog is empty.** Everything below shipped. Kept as the record of what
landed and why, not as a list of things to do.

Billing was fixed on 3 September and all six PRs merged the same evening, each
one green through the full **72-test Postgres integration suite** — the thing
that could not run for ten days. Production is current at the last merge.

| Merged | What it was |
| --- | --- |
| **#415** | Tag vocabulary + schema **v49**. The PR that sat unverified since 24 Aug — its August failure (`mood` missing from the CHECK) is confirmed fixed |
| **#416** | CODE-MAP, HANDOVER, DEBT-REGISTER + two generators |
| **#421** | 100% file headers, 417→116 unlabelled exports *(recreated from #417)* |
| **#418** | culture.js 1,826→141; search modules split |
| **#419** | **The four authentication bugs** |
| **#420** | Provenance, stamp recognition, authenticity evidence, Japanese reading, waiting, same-shot, constraints |

**v49 is applied to production and verified** — `product_tags_facet_ck` exists
and includes `mood`.

## What the merge taught, at a cost

**A stacked PR dies when its base branch is deleted.** #417 was auto-CLOSED
when `docs/navigation-for-handover` was deleted on merge, and a closed PR whose
base no longer exists **cannot be reopened or retargeted** — GitHub refuses
both. It had to be recreated as #421.

The rule that avoids it: **retarget every dependent to `main` BEFORE merging
its parent**, and never pass `--delete-branch` while anything still bases on
the branch.

**Squash-merging makes every downstream branch diverge by whole commits**, so
each remaining PR needed `git merge origin/main` and hand resolution.
`docs/CODE-MAP.md` conflicts every time and must be resolved by
`npm run docs:codemap`, never by hand.

---

## The stack, in merge order

Each depends on the one above it. **Merge top to bottom.**

| # | PR | Branch | What it is |
| --- | --- | --- | --- |
| 1 | [#416](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/416) | `docs/navigation-for-handover` | CODE-MAP, HANDOVER, DEBT-REGISTER + two generators |
| 2 | [#417](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/417) | `docs/label-the-primitives` | 100% file headers, 417→116 unlabelled exports |
| 3 | [#418](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/418) | `refactor/split-the-culture-catalog` | culture.js 1,826→141; search modules split |
| 4 | [#419](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/419) | `fix/the-mail-desk-could-never-sign-in` | **The auth bugs. Highest urgency.** The law + roadmap |
| 5 | [#420](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/420) | `provenance/unverified-origin` | Provenance labelling, stamp recognition, authenticity evidence |

Independent of the stack:

| # | PR | Branch | What it is |
| --- | --- | --- | --- |
| — | [#415](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/415) | `tagging/one-vocabulary` | Tag vocabulary + schema **v49** |

### The exact sequence, once billing is fixed

Verified 27 Aug: all six branches pushed, tree clean, suite **1381 — 1305 pass
/ 0 fail**, build 0 errors. Nothing is half-applied.

```bash
# 1. confirm CI is actually alive again — a zero-step failure means it is not
gh run list --limit 3

# 2. the independent one first; it is the oldest and carries schema v49
gh pr checks 415 --watch --fail-fast && gh pr merge 415

# 3. then the stack, strictly in this order
for n in 416 417 418 419 420; do
  gh pr checks $n --watch --fail-fast && gh pr merge $n || break
done

# 4. production must land on the new main
npm run deploy:check
```

**If a job fails in under ~6 seconds with no steps, CI is still dead** — read
the check-run annotation, not the logs, which will be empty.

**Then go straight to §2** and confirm messaging actually works. That is the
one thing on this page that is broken in front of users right now.

**If the stack conflicts**, take them in order — each was verified against the
one before it.

## What is URGENT rather than merely ready

**#419 fixes four authentication bugs that are live right now:**

1. Messaging has **never worked** — every DM call 401s
2. **The 13+ age assertion has never been recorded** for any account
3. **Every business signup is filed as a passport**
4. Business accounts are bounced off their own analytics

All fixed and locally verified. **Not yet confirmed end-to-end**, because that
needs a real signed-in account. That is the first-day list in
`ROADMAP-WHEN-BILLING-RETURNS.md` §2.

## The laws that now govern

`CONSTITUTION.md` was set aside by owner directive on 27 August. Three laws:

1. **ASTERISK does not guess** — every reading traces to the archive, a cited
   source, or archivalist training
2. **ASTERISK is an operating system, not a chatbot** — no conversational
   surface, ever
3. **Invisible machinery** — complex systems act without being asked and never
   name their mechanism (`docs/INVISIBLE-MACHINERY.md`)

## The rulings recorded

`docs/OWNER-DECISIONS.md` §11, both halves:

- **Taobao is unverified-origin.** Ingest it, label it, never hide it
- **Unverified stock ranks the same.** Mark it, do not demote it — demotion is
  a soft form of hiding
- **Verification scales with stake.** At a low price the piece is bought for
  itself; at a high price the name is most of what is bought and the name is
  the unchecked part

## One thing to do BEFORE the ingestion work, not after

**Cursor pagination for search and discover.** Nothing is broken today —
measured — but `offset` over a re-ranked list is only stable while the catalog
is static, and continuous Japanese ingestion is exactly what makes it move.
Page 1 and page 2 will silently skip and duplicate.

It is a **precondition of §4**, not a follow-up, because retrofitting it after
readers are paging through live inventory means fixing it while it is visibly
wrong. `ROADMAP-WHEN-BILLING-RETURNS.md` §4.5c has the detail; `lib/dm.js` is
the in-house model.

Two related feed issues (`SEEN_CAP = 200`, and unguarded shared rotation state)
are filed **separately** in §4.5d — they exist today, and cursors do not fix
either of them.

## Documents to read, in order

| Document | What it answers |
| --- | --- |
| `ROADMAP-WHEN-BILLING-RETURNS.md` | What to do, in order, the hour CI is back |
| `CODE-MAP.md` | Where every file lives *(generated — `npm run docs:codemap`)* |
| `DEBT-REGISTER.md` | What is not done, measured, and why |
| `INVISIBLE-MACHINERY.md` | How every complex system is surfaced. Binding |
| `AUTHENTICITY-EVIDENCE.md` | ASILUM authenticates nothing. What it reports instead |
| `JAPAN-INGESTION.md` | The reading is built; the fetch waits on an agreement |
| `WAITING.md` | Alerts and the digest, without an alert to configure |
| `OWNER-DECISIONS.md` | Rulings made |

## Built and ready to extend

Three systems shipped as working frames with real first implementations —
**each designed so the next piece is a drop-in, not a redesign.**

| System | Runs today | Next piece is |
| --- | --- | --- |
| **Provenance** (`lib/provenance.js`) | Every piece labelled, stake computed | Adding a source to `AUTHORIZED_SOURCES` / `MARKETPLACE_SOURCES` |
| **Stamp recognition** (`lib/vision/stampReading.js`) | Same-photograph recognition, on-device hashing | Visual embeddings for same-*garment* — needs `embedImage` |
| **Authenticity evidence** (`lib/authenticity/evidence.js`) | `image-reuse`, `seller-declaration` | Replacing one `read: null` with a function. See §5 of its doc |
| **Japanese reading** (`lib/ingest/japan/`) | Full title reading: houses, garments, materials, conditions, claims | The FETCH. Blocked on a Buyee/ZenMarket agreement, not on code |
| **Waiting** (`lib/waiting/`) | Wants from empty searches; on-platform delivery | Setting `built: true` on a channel and adding a `send` |
| **Same-shot** (`lib/vision/sameShot.js`) | The same photograph elsewhere, with price deltas | Visual similarity — needs `embedImage`, deliberately unbuilt |
| **Constraints** (`lib/search/constraints.js`) | Shows what a sentence became; releases one | Surfacing it on more than `/discover` |

## The verification you can still run without CI

```bash
npm test                # 1,339 tests — the whole unit suite
npm run build           # production build
npm run audit:nav       # navigability debt
npm run docs:codemap    # regenerate the code map
npm run deploy:check    # is production serving main?
npm run steward         # 15 read-only checks (needs DATABASE_URL)
npm run search:snapshot # prove a search refactor inert
```

**What cannot run:** the 72-test Postgres integration suite. It needs CI, and
it is the only thing that verifies `lib/db` — which is why the 7,932-line
database split is held. See `DEBT-REGISTER.md`.

## Instruments added, and what each caught

These are the tests that will keep the above from decaying. Every one is
verified non-tautological — each was shown to go red when its property was
broken.

| Test | Catches |
| --- | --- |
| `authenticated-wiring.test.js` | A call to an authed endpoint with no bearer. **Found 4 live bugs** |
| `provenance.test.js` | A surface showing a piece without what backs it; ranking touching provenance |
| `stamp-recognition.test.js` | Naming the mechanism, an empty state, a widened threshold. **Found missing CSS** |
| `authenticity-evidence.test.js` | A verdict, a score, a stub pretending to be a check |
| `culture-catalog-assembly.test.js` | A catalog re-split that silently reorders records |
| `japan-reading.test.js` | Guessing at an unread Japanese word; a colour claim promoted to a fact |
| `waiting.test.js` | A silent-when-broken engine; a replayed query polluting the search log |
| `same-shot.test.js` | Widening dhash into "similarity"; a missing price rendering as a bargain |
| `constraints.test.js` | A release that mangles the query, or a chip that quietly creates a filter |
