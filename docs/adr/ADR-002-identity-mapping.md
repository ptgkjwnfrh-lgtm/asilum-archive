# ADR-002: Identity mapping — pseudonymous text ids stay; social domains get account_id uuid

- Status: PROPOSED (Phase 0)
- Date: 2026-07-15
- Deciders: owner

## Context

The recommendation backbone keys everything on pseudonymous TEXT ids:
`u-<uuid>` (HMAC-signed device cookie, server-issued) and `sb-<uuid>`
(server-verified Supabase bearer). `lib/identity.js` resolves proof-only;
`identity_adoptions` (v7) migrates anon → account transactionally and
idempotently. This design is working and audited — it stays.

Features E/F/G (profiles-as-rooms, DMs, brand verification) are
authenticated-only, adversarial domains where "who owns this row" must be
the VERIFIED auth identity, not client-supplied text.

## Decision

1. **Keep** text identities for all taste/recommendation domains
   (profiles, events, corrections, boards, wardrobe-taste signals).
2. **New social/trust domains** (`profile_themes`, `conversations`,
   `messages`, `user_blocks`, `brand_accounts`, enforcement, appeals) use
   `account_id uuid NOT NULL REFERENCES auth.users(id)`. Authorization
   predicate is `(select auth.uid()) = account_id` in RLS or the
   server-side equivalent — never `user_metadata`, never `auth.role()`,
   never client-asserted ids.
3. **Mapping**: `sb-<uuid>` ↔ `auth.users.id` is the substring after
   `sb-`; document it in code where the mapping happens and add a helper
   `accountIdFromIdentity(uid)` (returns null for `u-` identities — device
   identities can NEVER hold social/trust rows).
4. **Adoption**: when a device identity adopts into an account
   (`identity_adoptions`), taste data migrates as today; social rows are
   born account-scoped and need no migration.

## Consequences

- DMs/brand features are impossible for signed-out users by construction.
- No dual-write; the two id spaces meet only at adoption and at the
  documented `sb-` prefix mapping.
- RLS policies for new tables are simple ownership predicates with
  supporting indexes (handoff §5 rules 5–7).

## Alternatives rejected

- Migrating the brain to uuid keys: massive churn, zero product value,
  breaks the working anon-first funnel.
- Using text `sb-` ids in social tables: forgeable-shaped (even if the
  server verifies), harder RLS, fails the "explicit uuid" handoff rule.
