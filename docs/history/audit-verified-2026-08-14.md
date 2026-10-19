# The Aug-8 audit, verified

**What this is.** The August 8 2026 codebase audit produced 485 findings (53
high) and then died — the session limit killed its verification and synthesis
stages twice. the 8 Aug 2026 notes (git history) published the open high findings and
was explicit that they were **leads, not conclusions**: the adversarial pass
never ran, so nobody knew which were real.

On **August 14 2026** that verification pass ran. Every finding on the published
list was checked against the code as it stands today.

**Result: 24 findings examined — 2 already fixed, 19 confirmed, 3 refuted.**

This document is the defensible list the handover asked for. Each verdict below
was reached by reading the current code, and most by executing it.

---

## Verdict summary

| Group | Examined | Already fixed | Confirmed | Refuted |
|---|---|---|---|---|
| Correctness | 9 | 2 | 7 | 0 |
| Capability + server performance | 9 | 0 | 8 | 1 (partial) |
| Client performance | 6 | 0 | 4 | 2 |

The audit's own hit rate was high: of 24 published leads, **19 were real**. That
is a good instrument, and it is worth finishing.

---

## Already fixed (2)

Both were the handover's two highest-value correctness findings, and both were
closed by PRs #165 and #166 before this pass ran.

1. **`kbResolve` fuzzy-before-lexicon** — `resolveToken` now orders exact-KB →
   lexicon → fuzzy (`lib/brain/index.js:215-222`). Measured: `"white"` →
   `MINIMAL 0.6, TAILORED 0.3`, the curated graded read, not `STREETWEAR 1.0`.
2. **The r10 groundedness gate** — now asks a per-item flag rather than a
   display label (`lib/search/index.js:525`, `_queryEvidence`). Measured: an
   unmatched query yields `queryGrounded = false`, so the cultural tier engages;
   the gate as originally written returns `true` on the same input.

---

## Confirmed — correctness (7)

Ordered by how much they mislead a user.

1. **`/upload` trained the brain on a corner crop.** The palette was read as
   `getImageData(0, 0, 48, 48)` from a ~340px canvas — the top-left corner, not
   a downsample. On a 1600×1200 photo that is ~2.7% of the image, always the
   same corner: a black coat on a white backdrop trained on the backdrop, and
   the page then told the user "palette v0 saw white". `/board` always did this
   correctly. **FIXED in this pass** (see below).
2. **Ticket `consented` existed only on Postgres.** Every Postgres reader
   derives it in `ticketRow()`; every mem reader returned the raw object, which
   has no such key — and `/orders` reads `t.consented`. A user who really had
   consented saw "consent on file" on Postgres and nothing on mem, forever.
   **FIXED in this pass.**
3. **A non-numeric ticket id was a 500 on Postgres and a 400 on mem.**
   `ticketId` was validated as a string only, so `"abc"` reached a `WHERE id=$1`
   against a `BIGSERIAL` column → `22P02` through an unguarded call.
   **FIXED in this pass.**
4. **"winter"/"summer" filter the pool and are then reported as matching
   nothing.** Measured against the live catalog: `"jacket"` → 185 results;
   `"winter jacket"` → 94, with the note *no piece here matches "winter"*. The
   word removed 460 of 915 items and the user was told it did nothing. Contrast
   `"womens jacket"`, where the constraint is lifted out and the note is empty.
5. **`lib/asterisk/confidence.js` reads `entity.sourceUrls`; the router only
   produces `entity.knowledge.sourceUrls`.** So `sourced` is always 0 and two
   confidence branches are unreachable — every entity floors at 0.7 where the
   same entity with URLs read correctly scores 0.9. 714 culture records do carry
   source URLs, so real evidence is being discarded. (Error direction is
   conservative — it under-reports confidence.)
6. **`resolvedVia` never receives `userId`**, so every interpretation outside
   layer 1 is hard-coded non-personalized. Measured with a seeded profile:
   `"fight club"` → personalized, taste affinity 2.4; `"fight clud"` (one typo)
   → same resolved entity, `personalized: false`, affinity 0. The
   Passport-assumption clause silently declines on the typo path.
7. **The bot simulator calibrates against a denominator production cannot
   produce.** `lib/brain/replay.js` counts bridge impressions over *served*
   slots while engagement only accrues over *examined* ones — reintroducing
   inside the calibration harness the position bias r19 removed from
   production. Measured: 2160 served vs 864 examined (2.5×) in the flat world,
   4.2× in the satiating one, and the inflation is position-correlated, so it
   does not cancel: `tunedSplit` returns epsilon 0.15 on served vs 0.10 on
   examined from identical evidence.

## Confirmed — capability (2)

8. **The stylist ignores standing recommendation exclusions.** A brand the user
   corrected away is suppressed in the AI-edit group and appears in **all 25**
   base looks in the same response (`app/api/outfits/route.js:116` builds the
   pool with no user argument). `/api/feed` filters correctly, so the same brand
   vanishes from the feed and returns in the stylist — a visible contradiction.
   Candidate-pool construction is implemented three times with divergent filter
   sets (four, counting the feed).
9. **The `q=` prompt parameter is inverted on both sides.** For any user with
   taste signal it is read, clamped, and never used. For a cold user it is
   silently written into the *long-term* profile. The client says the exact
   opposite: *"routing this edit … without rewriting your Passport"*.

## Confirmed — performance (10)

These are real but none is a correctness defect; they are listed with the cost
actually derived from the code, not the audit's estimate.

10. **`resolveProducts` fans out one query per id** — up to 60 per
    `/api/interaction` request; against the shipped `max: 5` pool that is 12
    sequential round-trip waves, each holding every connection. No batch
    (`id = ANY(...)`) helper exists. *(Postgres only; mem is an O(1) Map hit.)*
11. **Every search loads the entire embedding table**, uncached, on the blocking
    path — 937k floats (~7.5 MB parsed) at today's catalog, ~41 MB at the 5000
    cap, then a cosine against every row. *(Only when `EMBEDDINGS_PROVIDER` +
    `EMBEDDINGS_API_KEY` are set — currently blank, so the cost is latent and
    arrives with the keys.)* The audit's "~18 MB" conflated wire and heap.
12. **`profiles` is scanned unindexed** to read ~10 floats per user. No index on
    `profiles.updated_at` exists in any of the 31 migrations; up to 500 rows,
    each blob capped at 256 KiB, are transferred and parsed to compute a
    10-entry tag vector.
13. **Board-follow transfer pulls up to 5,000 full product snapshots** to derive
    a 10-number vector, as 10 concurrent join+aggregate queries against a
    5-connection pool, on every personalized feed serve for a follower.
14. **Neighbour events are fetched serially** — 5 sequential round trips where a
    `Promise.all` would take one. *(The "similarUsers computed twice" half of
    this finding belongs to #15, not here — see Refuted.)*
15. **`/api/similar` computes neighbours twice**, so two unindexed `profiles`
    scans and 1,000 cosine computations where 500 suffice — and `Promise.all`
    makes them simultaneous, doubling peak memory rather than amortising.
16. **`/api/discover` sanitizes the whole catalog to return 48** — 915 full
    `publicProduct` passes for a 48-item page (19× today, 104× at the cap).
    Caveat: the pool itself is load-bearing for `total` and `sources`; what is
    avoidable is sanitizing *before* the slice.
17. **The stylist computes fit math twice per candidate.** Measured by
    instrumenting the real module against the real catalog: 79,319
    `candidateScore` calls, 158,241 `fitAssessment` calls (exactly 2×), 480,225
    filter predicates per full generation. Computing `fitPhrase` only for the
    winner drops a generation from 72.2 ms to 44.2 ms (−39%); the phrase is
    discarded for >99.4% of candidates.
18. **`AsteriskDock` runs a 60fps canvas loop on every route** with 3
    `getComputedStyle` flushes per frame, mounted unconditionally in the shell,
    with no `IntersectionObserver` / `visibilitychange` / hidden check.
    (Reduced-motion *is* honoured — those users get one static frame. `/stats`
    and `/upload` mount a second dock: 2 loops, 6 flushes per frame.)
19. **`ParisMap` parses an 843 KB JSON twice** on `/board` — two independent
    hook instances — and renders 840,730 chars of SVG path (1.60 MB for the
    pair) as `aria-hidden` decoration.
20. **`getStats()` runs four unbounded aggregates** with no caching, on a
    rate-limited but visitor-reachable route.

---

## Refuted (3)

Recording these matters as much as the confirmations: an unverified list that
gets acted on wholesale spends effort on defects that are not there.

1. **"`app/api/wardrobe/route.js` makes 200 *serial* signed-URL requests."**
   False — the call is `Promise.all(items.map(...))`, i.e. concurrent, and it
   was already `Promise.all` in the Aug 8 tree, so this was wrong when written.
   The real residual is the inverse: up to 200 *unthrottled concurrent*
   requests.
2. **"`lib/tagging/dense.js:140` is a pure function recomputed per request."**
   Wrong function — line 140 sits in `denseTagsForItem`, which has no
   request-path caller (only an offline script and a test). The dense.js export
   that *is* recomputed per request is `enrichItemVec`.
3. **"`lib/db/index.js:294` is unbounded."** Line 294 is `getItem(id)`, a single
   primary-key lookup whose one request caller is bounded to 10 ids. The nearest
   real match is the preceding `listItemBrands`, whose `GROUP BY` runs uncached
   on every search.

*(Half-refuted: the "`similarUsers` computed twice" clause of finding 14 is real
but lives in the caller, `/api/similar` — it is finding 15, counted once.)*

---

## What was fixed in this pass

Three cheap correctness defects, each with a test that was **checked by
reverting the fix and watching it fail** (law 2 of the Aug-8 handover):

- **The palette crop** (`app/upload/page.js`) — the palette is now sampled from
  a real 48×48 downsample of the whole image, the shape `/board` always used.
- **Ticket `consented` on mem** (`lib/db/production.js`) — a `memTicket()`
  shaper now derives the field at all six mem return sites, exactly as
  `ticketRow()` does for Postgres.
- **Non-numeric ticket ids** (`lib/wardrobe/index.js`) — refused by shape, so
  both backends answer identically.

Plus the gap this pass found in *its own session's* work: the v27/v28 wire SQL
had only ever run in mem, so `tests/postgres-integration.test.js` gained real
Postgres coverage for the lifecycle verbs and the engagement ledger.

**A note on where a test can live.** The non-numeric-ticket guard was written
first as a mem test. Reverting the fix left it **green** — mem's
`Number("abc") → NaN` misses either way, so the assertion proved nothing. It was
moved to the Postgres suite, where the unguarded query really does raise and the
test really does go red. That is law 2 doing its job on a test I had just
written.

---

## What is still unexamined

Honesty about the edges of this pass:

- **Only the 24 published high findings were verified.** The audit's other ~461
  findings (medium and low) have never been looked at, and its raw output lives
  in a workflow journal, not here.
- **`tests/` and `supabase/` were never audited** by the original run. This pass
  made a start: all 71 test files carry real assertions with no tautologies, and
  the migration ledger was checked (see below). That is a spot check, not an
  audit.
- **A new finding, from the migration check: version 16 is claimed by two
  files** — `schema-v16-embeddings.sql` and `schema-v16-discover-rails.sql`. The
  ledger holds one row for 16 (named `discover-rails`); the embeddings migration
  records nothing. Both tables exist on live, so there is no drift today, but
  the CI guard compares `max(version)` and therefore **cannot detect that the
  embeddings migration was skipped** in a fresh environment. Also, v2–v6 never
  record themselves, so the ledger starts at 7. Renumbering migrations is not
  something to do unilaterally while a PR stack is pending — flagged for the
  owner.
- **The 16 findings fixed on Aug 8 were verified then**, by hand, and are not
  re-checked here.
