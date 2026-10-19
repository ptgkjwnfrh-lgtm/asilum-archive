# ASILUM production foundation

How the real system fits together (July 10, 2026). Governed by CONSTITUTION.md:
UI locked, no fake integrations, no scraping, env-vars only.

## Database

Supabase Postgres via `DATABASE_URL` (transaction pooler URI for serverless;
direct/session mode for a persistent backend). `lib/db/index.js`
verifies migrations but never runs DDL at application startup; it falls back
to an in-memory store only when no database is configured. A configured but
unmigrated/unavailable database fails loudly instead of silently losing data.

Schema files (idempotent, apply with `node --experimental-default-type=module
scripts/apply-schema.mjs <file>`):

- `supabase/schema-v1-brain.sql` — core items, profiles, interactions, graph,
  popularity, boards, and canonical user events.
- `supabase/schema.sql` — MVP: user_profiles, designers, saved_items
  (= saved_products), articles, product_sources + RLS.
- `supabase/schema-v2.sql` — production: extends **items (= products)** with
  source/availability/moderation fields, adds product_images, product_tags,
  search_mappings, search_logs, source_connections, source_sync_logs,
  product_availability_checks, stylist_outfits, purchase_tickets,
  editorial_posts, mood_board_uploads.
- `supabase/schema-v3-ai.sql` — analysis, style profile, stylist request, and
  model audit tables.
- `supabase/schema-v4-asterisk.sql` — ontology, tag audit, fact provenance,
  and moderation tables.
- `supabase/schema-v5-corrections.sql` — structured user correction signals.
- `supabase/schema-v6-hardening.sql` — quotas, idempotency, honest bag-event
  migration, sync uniqueness, and hot-path indexes.
- `supabase/schema-v7-integrity.sql` — explicit schema version, transactional
  identity adoption, one default board per user, and ticket-state constraints.
- `supabase/schema-v8-lockdown.sql` — private server-only tables, restricted
  privileged functions, and deny-by-default privileges for future API objects.
- `supabase/schema-v9-discovery.sql` — indexed product discovery, explicit
  sponsorship gates, post-handoff outcomes, and privacy-delete indexes.
- `supabase/schema-v10-policy-performance.sql` — statement-scoped auth checks
  for the client-facing profile and saved-item RLS policies.
- `supabase/schema-alpha.sql` — staged, NOT applied.

Apply v1, `schema.sql`, then v2 through v10 in order before deploying. TLS
certificate verification stays enabled; configure `DATABASE_SSL_CA` when the
provider CA is not in Node's trust store.

Constitution table mapping: products = items, mood_boards = boards,
mood_board_items = board_items, saved_products = saved_items.

Seeding: `scripts/seed-supabase.mjs` (catalog → items),
`scripts/seed-mappings.mjs` (search mappings + product_tags backfill).

## Products & fetching

Inventory reads pull up to 5,000 recent database products. The synthetic
catalog is used only when the live pool is empty; it is never mixed into live
inventory and is labeled as demo stock.

## Source adapters (`lib/ingest/adapters/`)

Common interface (`types.js`): `getSourceName, enabled, searchProducts,
fetchProductById, checkAvailability, normalizeSourceProduct, syncProducts`.

- **ebay** — implemented against the official Browse API but disabled until
  `EBAY_PARTNERSHIP_APPROVED=1` and API credentials are present.
- **woocommerce** — official Store API, enabled only for an exact HTTPS store
  origin whose merchant approved ASILUM (`WOOCOMMERCE_STORE_APPROVED=1`).
- **shopify** — honest disabled placeholder until an independent store grants
  Storefront access. It returns empty results and never scrapes or fakes data.

`normalize.js` converts any raw source product into the ASILUM shape and
derives typed tags; `sync.js` runs enabled adapters → upserts items → writes
product_images + product_tags → logs to source_sync_logs. Trigger via
`/api/admin` `sync.run` (run on demand; the steward and the sweeps are the scheduled jobs).

Availability: `checkAvailability` per adapter; results land in
product_availability_checks and reflect onto `items.availability_status` /
`is_available` (vocabulary: available, sold, removed, price_changed,
source_unavailable, unknown). Sold/removed items sink in search and are
excluded from stylist looks.

## Search engine v1 (`lib/search/`)

Flow: query → `interpretSearchQuery` (intent: brand / "like designer" /
text + mapping expansion) → `rankSearchResults` → `logSearch`.

Database-backed searches first use the generated `items.search_document` GIN
index plus `product_tags` to retrieve a bounded candidate set. Ranking order
of force: exact product name > full title > brand/designer >
garment-category alignment (a "jeans" query surfaces bottoms — this is what
keeps "bootcut" specific instead of every flare) > product_tags layer >
aesthetic vector > related terms > era > availability penalty > Mood Board
Brain nudge (only when the toggle is on) > AI confidence placeholder (0).
Each result carries `confidenceScore`, `matchReason`, `matchedTags`.

Search mappings: `search_mappings` table, curated seed in
`lib/search/mappings-seed.js` (also the no-database fallback). Admin can
add/edit via `/api/admin`. Searches log to `search_logs` (user, query,
interpreted tags, result count) — ASILUM gets smarter through behavior.

Autocomplete: `/api/suggest` (3–10 suggestions, prefix + levenshtein fuzzy,
"like <designer>" companions) rendered in the shell search panel and the
Discover search box.

## Mood Board → personalization

Every training action writes a real `mood_board_uploads` record: image uploads
are honestly `analyzed_by: "filename"` (no vision model exists yet — the
record structure is ready for one), train-text is `analyzed_by: "manual"`.
The brain profile it feeds flows into feed ranking (as before) and now into
search ranking via the **Use Mood Board Brain** toggle on /board
(localStorage `asilum-brain-off`; callers send `&brain=1|0`). Off = general
results, on = slight personalization. Saved products (favorites/boards/bag)
already train the same profile via /api/interaction.

## Stylist

The first-party Stylist generates through `POST /api/outfits`. Local generation
keeps the five-genre backbone, applies a deliberately small dated-trend boost,
and runs fit scoring from transient JSON-body measurements that are never
stored, logged in URLs, or sent to a model. The explicit **AI Trend Lens**
toggle is off by default; when enabled, `/api/outfits` calls the validated
`generateStylistOutfits` seam and prepends a model edit only when a configured
provider succeeds. Disabled or failed AI never replaces the local looks.
Saved looks persist to `stylist_outfits`.

Trend claims live in `lib/ai/trendKnowledge.js` with direct per-claim sources,
expiry dates, and snapshot-level TikTok methodology. The scheduled
`trend-freshness` workflow runs `npm run trends:check` weekly and fails when
the human review date or minimum active coverage is missed; it never scrapes.

## Editorial

`editorial_posts` (user/asilum/article kinds, tags + designer/product refs,
moderation fields) via `/api/editorial`. The home composer posts to it
alongside the localStorage social layer. Articles remain original summaries +
external links only (copyright rule).

## Purchase tickets (third-party purchase assistant)

ASILUM does NOT fulfill: the original marketplace confirms, ships, tracks,
and handles returns. Demo products cannot create purchase tickets. For live
source products, flow: BUY → POST `/api/tickets` (creates
`purchase_tickets` row, checks availability through the source adapter) →
disclaimer popup (exact wording in `lib/tickets.js`, version-stamped) →
REQUIRED consent checkbox → PATCH consent → `checkout_started` and the source
site opens for the user to complete checkout. Statuses: requested →
checking_availability → available/unavailable → awaiting_user_consent →
awaiting_payment_or_checkout → checkout_started → checkout_completed_on_source
/ canceled / failed / completed. No card data, no external-site passwords,
no automated checkout beyond the handoff. Tickets render on /orders.
After checkout starts, users can report bought / kept / returned / not bought.
These are explicitly self-reported outcomes, not marketplace confirmation.

## Privacy controls

`POST /api/reset` clears only learned recommendation weights and lists what it
retains. `DELETE /api/privacy` requires an exact confirmation phrase and
deletes user-linked personalization records transactionally. Purchase tickets
and consent records, the auth account, and deidentified aggregate item
statistics remain and are disclosed in the UI and response.

## Admin (`/api/admin`)

Bearer `ADMIN_TOKEN` (16+ chars; unset = 503 disabled). Read areas: overview
counts, tags, mappings, sync-logs, search-logs, tickets, adapters. Write
actions: tag.add/delete/merge, mapping.upsert/delete, product.moderate
(visible/hidden/flagged), sync.run. Public UI intentionally not built — the
locked design stays untouched; an admin page can mount on these later.

## AI readiness

Stylist, mood-board analysis, and tag audit use deterministic local logic by
default. External model calls require explicit environment feature flags;
user-derived stylist/moodboard calls additionally require `aiConsent: true`.
Per-user and global hourly quotas protect every model call. A future model reads:
product_tags, search_mappings, mood_board_uploads, search_logs,
stylist_outfits, user_events — all persisted now.

## Production-ready today vs waiting on access

READY: Postgres persistence, 915-product seed inventory (clearly labeled),
search + mappings + suggestions + logs, ticket flow + disclaimer, moodboard
records + brain toggle, stylist persistence, editorial posts, admin API,
adapter framework with availability checking, transient craving context,
indexed catalog candidates, privacy controls, and self-reported outcomes.

WAITING ON OFFICIAL ACCESS: eBay approval + keys (adapter ready), per-store Shopify
tokens, any vision/embedding provider, and Pinterest OAuth. Checkout remains
out of scope by constitution.
