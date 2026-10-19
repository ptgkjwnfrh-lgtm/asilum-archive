# ADR-005: One versioned candidate contract for every mixed feed

- Status: PROPOSED (Phase 0 → governs Phase 2)
- Date: 2026-07-19
- Deciders: owner

## Context

Phase 2 introduces mixed feeds (TODAY, Editorial) blending articles,
excerpts, outfit posts, products, people, and cultural cards. Without a
single contract, each surface invents its own row shape, provenance gets
lost, and sponsored content becomes indistinguishable from organic —
all constitution violations.

## Decision

1. **One versioned candidate contract** across products, content,
   people, outfits, and culture:
   `{ contractVersion, id, type, source: {engine, algorithmVersion},
   reasonCodes[], provenance, commercialDisclosure?, recency,
   eligibility }`. Cards render by `type`; the type is never erased.
2. **Reason codes are user-facing.** Every ranked item can state why it
   appeared, separating editorial relevance, social relevance,
   exploration, recency, and commercial placement. This extends the
   existing explainability surfaces (`matchReason`, `_zone`/`_via`,
   `explainProduct`) rather than replacing them.
3. **Chronological Following mode exists from launch** and is not
   personalized. The Asterisk OFF contract (Constitution §5) binds every
   feed surface.
4. **Sponsored separation.** Sponsored candidates pass relevance,
   source, availability, disclosure, frequency, and user-control gates;
   organic ranking signals and campaign eligibility stay in separate
   stores; sponsorship can never modify interpretation or editorial
   confidence. (The `publicProduct` sponsored-disclosure gate is the
   existing precedent.)
5. **Bounded impressions.** `recommendation_impressions` records
   surface, algorithm version, reason codes, sponsored status, and
   clicked/saved outcome — no private content, capped payloads, cursor
   pagination, stable ordering, idempotency keys (house patterns from
   `processed_operations`).
6. **Repetition and domination caps** (per creator, per brand — the
   existing 2-per-brand-per-page feed cap generalizes) plus reset,
   mute, hide, block, "not interested," and Asterisk-off controls.

## Consequences

- Phase 2's first PR defines the contract as code (shared module +
  contract tests) before any feed UI.
- Feed ranking logs ranking-version + reason codes; deterministic
  pagination and no-duplicate-cards are exit-gate tests.
- The existing home feed migrates to the contract additively; the brain
  engines stay the ranking core for product candidates.
