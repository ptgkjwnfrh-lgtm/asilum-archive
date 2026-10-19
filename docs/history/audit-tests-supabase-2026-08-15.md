# The `tests/` and `supabase/` audit

**What this is.** `docs/history/audit-verified-2026-08-14.md` closed by naming what it
had never looked at:

> **`tests/` and `supabase/` were never audited** by the original run. This pass
> made a start: all 71 test files carry real assertions with no tautologies, and
> the migration ledger was checked. That is a spot check, not an audit.

On **August 15 2026** that audit ran. It was done by reading, not by a workflow
fan-out — the Aug-8 run's raw findings were unrecoverable (its journal and
scratchpad are both empty), so there was no list to work through, only code.

Every claim below was checked against the **live production database**, which is
the advantage this pass had over the original: an index either exists or it does
not, a ledger row is either there or it is not, and `EXPLAIN ANALYZE` settles a
performance argument that reading cannot.

**Result: 3 confirmed and fixed, 1 refuted, 1 raised for the owner, and a list
of things that turned out to be clean.**

---

## Confirmed and fixed

### 1. The migration ledger guard could not see a hole

`tests/postgres-integration.test.js` compared `max(version)` from
`app_schema_migrations` against the highest number among `supabase/schema-v*.sql`.
A maximum cannot detect a gap underneath it.

Measured on live:

```
APPLIED on live:  7, 8, 9, ... 29
MISSING:          1, 2, 3, 4, 5, 6
max(version) = 29   <- the only thing the guard checked, so it was green
```

Seven committed migrations never write a ledger row: **v1–v6** (the audit
doc said v2–v6; v1 is one too) and **schema-v16-embeddings.sql**. A migration
that forgets to record, or one skipped in a partial manual apply, was invisible
unless it happened to be the highest-numbered file.

Replaced with two guards: every committed version must have a ledger row
(with the historical silent migrations listed individually, so a *new* silent
one fails), and the ledger may not claim a version no file provides. Verified
by adding a probe migration with no ledger row and watching it go red — the old
guard stayed green on the same probe.

### 2. The version parser silently skipped a migration

`/^schema-v(\d+)-/` requires a hyphen after the digits. **`schema-v2.sql` has
none**, so it was never counted. It never changed the maximum, which is exactly
why nobody noticed. Now `/^schema-v(\d+)[-.]/`.

### 3. `tests/adoption-merge.test.js` asserted things that could not fail

Three assertions, all proven empirically rather than by inspection:

- **`assert.ok(res.movedProfile || res.movedRecords >= 0, "adoption completed")`**
  — a count is always `>= 0`, so this held for a **complete no-op adoption**.
  Demonstrated: `{movedProfile: false, movedRecords: 0}` satisfies it.
- **`assert.ok(merged._meta.recent.length <= 20)`** and the `follows <= 10`
  twin — upper bounds only. The fixture overflows both caps (18+18 recent,
  8+8 follows), so the caps must *bite*; `<=` also passed for an adoption that
  **dropped every ring**. Now asserts equality at 20 and 10, the numbers the
  test's own name claims.
- **`assert.ok(merged.long, "merged profile is well-formed")`** — `{}` is
  truthy in JS, so an empty taste vector (precisely the outcome that means the
  taste was lost) passed. Now asserts the device's `GORP: 0.5` actually
  arrived, that the recent ring came with it, and that no `bridgeStats` keys
  were fabricated for a profile that never had them — which is what the test's
  name, "no fabricated keys break reads", actually means.

---

## Refuted

### 4. The `edges` two-sided `OR` is **not** a missing-index defect

This one is recorded because I got it wrong first, and the wrong version was
convincing.

`getEdges` runs `WHERE a = anchor.id OR b = anchor.id ORDER BY contributors
DESC, w DESC LIMIT k`, while schema-v22 provides `edges_a_corroborated
(a, contributors DESC, w DESC)` and its `_b` twin. The plan confirms the
suspicion — a `BitmapOr` of both indexes followed by a **Sort**, because
BitmapOr discards index ordering:

```
Limit -> Sort (Sort Key: contributors DESC, w DESC)
  -> Bitmap Heap Scan on edges (Recheck: a = 'x' OR b = 'x')
     -> BitmapOr -> Bitmap Index Scan on edges_a_corroborated
                 -> Bitmap Index Scan on edges_b_corroborated
```

A `UNION ALL` of two one-sided branches lets each walk its index in order and
stop at the limit. First measurement said **16.8ms → 3.7ms**, identical rows.

**That measurement was wrong.** The `OR` ran cold and the `UNION` ran second on
a warm cache. Warmed properly and run three times per shape across three
representative anchor sets, the shipped `OR` wins every time:

| anchor set | `OR` | `UNION ALL` |
|---|---|---|
| 40 highest-degree nodes | **4.50 ms** | 6.68 ms |
| 20 top-corroborated | **2.58 ms** | 3.62 ms |
| 40 random | **2.88 ms** | 4.49 ms |

At 2,632 rows the sort is cheaper than doubling the index descent. The rewrite
was reverted. The shipped shape is correct; revisit only if `edges` grows by
orders of magnitude.

---

## Raised for the owner — not a defect

### 5. The gamma bridge is currently inert on production

All **2,632** edges on live have `contributors = 0`, and `edge_contributors`
holds **0 rows**. With corroboration enabled — the default —
`edgeStrength()` returns `min(CONTRIB_CAP, contributors)`, so it returns `0`
for every edge, and `getEdges` only emits a neighbour when `strength > 0`.
**`getEdges` therefore returns nothing on production**, for every anchor,
including nodes with degree 84.

This is **deliberate and documented**. `schema-v22-edge-corroboration.sql`
says so in its own header: pre-v22 edges "get contributors = 0, so they score
zero on the new curve until real distinct identities corroborate them", and
inferring contributors from the legacy `w` was explicitly rejected.

What is worth the owner's attention is not the choice but its consequence.
Since v22 was applied on **2026-08-05**, production has recorded **93 events,
85 interactions, and exactly 1 favourite**. An edge pair needs two positives
from one identity, so one favourite cannot form one. The write path itself is
healthy — the sibling ledger `popularity_contributors` has **111 rows** from
the same period — so this is a traffic fact, not a broken path.

The gap: **nothing surfaces that a whole bridge is contributing zero.** `/stats`
and the operating dashboards report edges as a row count (2,632), which reads
as a healthy graph. Options are the owner's call — a one-off backfill from
`user_events`, flipping `BRAIN_EDGE_CORROBORATION=0` to restore the legacy `w`
curve until real corroboration accumulates, or leaving it and reporting gamma's
true contribution on `/stats`.

---

## Clean — checked, nothing found

Recording these matters as much as the findings; it is what stops the next pass
re-treading them.

- **RLS is enabled on every table** in `public`. No exceptions.
- **Every table has a primary key.**
- **All 15 skipped tests** are the single legitimate `{ skip: !databaseUrl }`
  gate in `tests/postgres-integration.test.js` — they run in CI against a real
  database and skip locally without one. There are no quietly-disabled tests.
- **No test file contains a test without an assertion.**
- **No law-2 violations.** `tests/mem-pg-parity.test.js` is the model
  implementation: it states the law in its header, and its comment explains why
  the non-numeric-ticket-id case must live in the Postgres suite instead.
- **One unused index**: `items_source` (48 kB, never scanned). Too small to be
  worth a migration on its own; fold it into the next schema change.

## What this pass did not cover

- `tests/` was audited for whether assertions can fail, not for **coverage
  holes** — "what has no test at all" is a different question and a larger one.
- The **~461 medium/low findings** from the Aug-8 run remain unexamined and are
  now unrecoverable; only regenerable by re-running the audit workflow.
- Migration **content** was checked for idempotency and ledger discipline, not
  line-by-line for SQL correctness against every `lib/db` call site.
