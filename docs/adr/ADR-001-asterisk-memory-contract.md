# ADR-001: One versioned Asterisk memory contract (read facade, not a new store)

- Status: ACCEPTED — implemented in Phase 2 (`lib/asterisk/memory.js`,
  `GET/POST /api/asterisk/memory`, schema v14; drawer in the shell, full page
  at `/asterisk`; brand/user follows graduated to `user_follows`)
- Date: 2026-07-15
- Deciders: owner

## Context

Feature B requires that Home, Discover, Stylist, Moodboard, Profile, the
future drawer, and `/asterisk` all present ONE coherent memory. Today each
surface reads its own slice: `user_style_profiles` (dominant/avoided),
`user_corrections`, brain profile vec (`profiles`), craving state, follows
(client-side), measurements (v12), culture knowledge, trend calls. The data
is real and non-duplicative; the fragmentation is at the READ layer.

## Decision

Introduce `lib/asterisk/memory.js` as a versioned READ FACADE plus a narrow
mutation router — **no new persistence of taste**. Contract shape (v1):

```
GET /api/asterisk/memory  (identity-gated, resolveRequestUser)
{
  contractVersion: 1,
  explicit:   { corrections[], follows[], craving, measurementsStatus },   // user told us
  inferred:   { dominantAesthetics[], avoidedTags[], recentActivity },     // behavior-derived
  global:     { recentlyLearned[], trendReviewDue },                       // culture/trends, provenance'd
  uncertainty:{ lowSignal: bool, openQuestions[] },
  controls:   { forget: [...], export: true, delete: true }                // links to real endpoints
}
```

Rules:
1. Every field maps to an existing store; the facade may aggregate but never
   invent or cache-persist a competing profile.
2. `measurementsStatus` exposes presence/staleness only — never raw values.
3. Mutations route to the EXISTING endpoints (`/api/why`, `/api/privacy`,
   `/api/reset`, `/api/measurements`) — the facade adds no write paths of
   its own beyond preference visibility toggles (`asterisk_memory_preferences`,
   a genuinely new, tiny domain).
4. Contract is versioned; pages pin a version; breaking changes bump it.

## Consequences

- Drawer + `/asterisk` + existing pages converge on one API without a data
  migration.
- One new table (`asterisk_memory_preferences`) instead of the handoff's
  worry-case of per-page profiles.
- Client-side stores (follows, bag) need a documented sync path — follows
  should graduate to a server table in the same phase the drawer ships
  (they already blend into feeds server-side via `?brands=`).

## Alternatives rejected

- New unified `asterisk_memory` table: duplicates truth, drifts, violates
  the handoff's own architecture rule.
- Per-page contracts: the current state; explicitly what Feature B forbids.
