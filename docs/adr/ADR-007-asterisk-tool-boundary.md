# ADR-007: Asterisk tool boundary — one orchestrator, seven typed modes

- Status: PROPOSED (Phase 0 → governs Phase 3)
- Date: 2026-07-19
- Deciders: owner (model enablement: owner decision 5)

## Context

The handoff positions *ASTERISK as travel agent over the Passport map —
explicitly NOT one omnipotent model with database access. Most of the
required machinery already exists as deterministic services; this ADR
fixes the boundary before any live model call is enabled.

## Decision

1. **Seven modes, each a typed facade over existing engines** — the
   orchestrator composes these; nothing else reaches storage:
   - `READ` — query/reference/feeling interpretation:
     `lib/asterisk/orchestrator.js` + `queryRouter` + culture catalog.
   - `ROUTE` — ranking across products/people/articles/exploration:
     `lib/search`, `lib/brain` bridges, `lib/discover/tagRank`, rails.
   - `STYLE` — outfit construction/revision: `lib/brain/stylist` +
     `lib/ai/stylistReasoningEngine` (validated candidates only).
   - `SCOUT` — sourced trends/shows/unfamiliar directions:
     `lib/asterisk/trends.js` + research pipeline + Discover rails.
   - `REMEMBER` — the ADR-001 memory facade + explicit corrections
     (`lib/asterisk/memory.js`, `explain.js` corrections).
   - `EXPLAIN` — why a result appeared, evidence, uncertainty:
     `explainProduct`, separated confidence, reason codes (ADR-005).
   - `CONTROL` — pause personalization, edit signals, disconnect,
     export, forget, erase: guidance preference, `/api/privacy`,
     `/asterisk` page.
2. **Database boundary.** Modes call typed, least-privilege application
   services. No generated SQL, no `service_role`, runtime role stays
   `asilum_app`. Trusted global knowledge remains staged → sourced →
   reviewed → versioned → compiled (the research pipeline is the only
   write path).
3. **Model seam.** `lib/ai/adapter.js` is the single seam; every flag
   defaults off; output is validated (`lib/ai/validate.js`), certainty-
   capped (models may never claim confirmed/verified), and can only
   draft or rank — never publish, verify, ban, or change state. Live
   enablement requires owner decision 5 + the EU-AI-TRANSPARENCY gate
   (disclosure, retention, kill switch, payload tests).
4. **Separated confidence** (entity resolution, interpretation, evidence
   coverage, inventory representation, ranking/match) is part of every
   mode's contract; current-events claims carry source + freshness data
   (Constitution §5 freshness law).
5. **OFF contract binds every mode.** Personalization pauses everywhere;
   hard filters and the current request still apply; stale personalized
   responses cannot overwrite OFF results (stale-response guards,
   PR #77); OFF ≠ erase.

## Consequences

- Phase 3 implements the drawer/control-room UI and any missing typed
  tool signatures; no mode gains storage access beyond its named
  services without a new ADR.
- Adding a model provider changes NOTHING in this boundary — it swaps
  the adapter's provider while validation and caps stay.
- Every Asterisk-surface PR lists which modes it touches and proves the
  OFF contract and payload rules for them.
