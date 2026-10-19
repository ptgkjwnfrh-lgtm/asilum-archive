# ADR-004: Content model — one additive editorial spine, typed objects, sanitized documents

- Status: PROPOSED (Phase 0 → governs Phase 1)
- Date: 2026-07-19
- Deciders: owner

## Context

The current `editorial_posts` table is a short-post foundation (composer
posts). The Restructure Handoff Prong 2 requires a full publication
system: articles, reviews, interviews, guides, outfit journals, and
excerpts — with drafts, revisions, citations, disclosures, rights
confirmation, and a moderation lifecycle. Rewriting or reinterpreting
existing rows in place is prohibited (v2 Constitution §2).

## Decision

1. **Additive spine.** New tables, existing domains untouched:
   - `content_items` — UUID id, verified `author_account_id`
     (`auth.users.id`, per ADR-002), `type`, visibility, publication
     state, moderation state, disclosure state, canonical slug,
     timestamps, ranking eligibility.
   - `article_documents` — 1:1 title, dek, **sanitized portable body
     document** (typed JSON blocks; never raw user HTML/scripts/CSS),
     cover metadata, reading time.
   - `content_revisions` — immutable history + editor attribution.
   - `content_media` — private staging → approved public paths, type,
     dimensions, alt text, caption, rights/credit.
   - `content_entity_refs` — designer / house / show / event / culture
     entity / product / outfit / wardrobe-publication references.
   - `content_disclosures` — affiliate, sponsored, gifted, relationship,
     AI assistance, policy version.
   - `content_citations` — source URL, publisher, title, dates,
     quoted-text bounds.
   - `content_reports`, `moderation_decisions`, `moderation_appeals`;
     `comments` only after the blocking/moderation foundation exists
     (Phase 4 gate).
2. **Publication state machine**: `draft → pending_review/eligible →
   published → limited/removed`, with appeal and immutable moderation
   history. Drafting is open immediately; publishing requires the §7
   trust gates.
3. **`editorial_posts` evolves via expand → backfill → switch →
   contract.** Current rows migrate losslessly into `content_items`
   (type `short_post`); the old table is contracted only after the
   switch is verified. No drops, no in-place reinterpretation.
4. **Every content object keeps its type, author/source, commercial
   disclosure, and explanation** through every feed and API (feeds:
   ADR-005). No flattening into generic rows.

## Consequences

- Phase 1 ships schema + server-owned content service + editor +
  moderation queue against this model; the PR that creates the tables
  carries the migration/backfill plan and RLS/negative tests.
- Sanitization is a server responsibility with a hostile-payload test
  battery (XSS gate in the Phase 1 exit criteria).
- Original writing and licensed/user-owned media only; plagiarism,
  copyright, and impersonation workflows are §7 launch dependencies.
