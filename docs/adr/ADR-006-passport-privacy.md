# ADR-006: Passport privacy — provenance, visibility, and retention over existing stores

- Status: PROPOSED (Phase 0 → governs Phase 3)
- Date: 2026-07-19
- Deciders: owner (counsel for retention: owner decision 10)

## Context

The Passport is the user-owned, inspectable map of taste. Its data
already lives in working stores (profiles, user_events, corrections,
boards, wardrobe, measurements, follows, style profiles, memory
preferences). ADR-001 established the read-facade rule: Asterisk memory
is a facade over these stores, never a duplicate truth store. Phase 3
adds provenance/visibility/retention exposure and controls — not new
truth stores.

## Decision

1. **Signal classes** (handoff Prong 3): explicit, creative, behavioral,
   commerce (user/partner-confirmed purchases only — never bag intent),
   social, external (approved scoped connections only), system (reviewed
   global knowledge, never misrepresented as personal memory).
2. **Every signal exposes**: origin; kind (explicit / inferred /
   imported / global); last use; affected surfaces; visibility;
   retention; and edit / disconnect / forget / export / delete controls.
   Implementation: a `passport_signal_registry` normalization layer is
   added ONLY if the existing stores cannot answer these questions
   directly — facade first, table second.
3. **Private by default.** Public profile ≠ public Passport. Purchase
   history is private and never becomes public automatically. Publishing
   a wardrobe item, outfit, brand list, or "recently worn" entry is an
   explicit per-item action recorded in `passport_visibility_rules`.
4. **Never public and never in external-model payloads**: raw
   measurements, private images, search history, connected-account
   tokens, inferred sensitivities, precise identity. Enforced by the
   existing forbidden-field payload test pattern; extended each phase.
5. **External connections** (Phase 3+): `external_connections` with
   encrypted server-side tokens, provider, scopes, consent version,
   status, expiry, disconnect/deletion state. Disconnect deletes
   provider-derived data. Pinterest requires the approved app + OAuth
   code flow; Spotify path is manual-only (Constitution §4).
6. **No sensitive-trait inference or ad targeting.** Ever.

## Consequences

- Phase 3 exit gates: OFF means no personalization everywhere;
  private-by-default tests; accurate exports; disconnect-deletes-data;
  no forbidden fields in model payloads.
- Retention periods stay DRAFT (DATA-INVENTORY.md) until owner decision
  10; the cleanup job PR follows that decision, not the reverse.
- `/api/privacy` delete, `/asterisk` export, corrections, and the
  guidance pause remain the canonical controls and grow to cover each
  new signal class in the same PR that adds the class.
