# Feature Flags & Kill-Switch Register

Convention (existing, now codified): every optional or externally-dependent
capability is env-gated, defaults OFF/deny, and degrades to an HONEST
unavailable state — never a fake success. `describeAiConfig()` /
`adapterStatuses()` expose live gate state to the admin surface.

## Live flags today

| Flag | Gates | Default | Honest-off behavior |
|---|---|---|---|
| `AI_FEATURES_ENABLED` + `AI_PROVIDER` + `AI_API_KEY` | master model seam | off | local deterministic paths |
| `AI_MOOD_BOARD_ENABLED` | model moodboard analysis | off | palette-v0 + filename rules |
| `AI_STYLIST_ENABLED` (+ per-request `aiConsent`) | model stylist | off | local trend+taste engine, notice shown |
| `AI_TAG_AUDIT_ENABLED` | model tag audit | off | local rules, conf-capped 0.6 |
| `AI_RESEARCH_ENABLED` | model research drafting | off | `notImplemented` |
| `AI_USER_HOURLY_LIMIT` / `AI_GLOBAL_HOURLY_LIMIT` | paid-call ceilings | 12 / 200 | 429-style refusal |
| `INGEST_ALLOWED_HOSTS` | research/in-app fetch allowlist | deny-all | fetch refused with named reason |
| `EBAY_CLIENT_ID/SECRET` (+ approval) | eBay adapter | unset | adapter reports disabled |
| `EBAY_DELETION_VERIFICATION_TOKEN` (+ optional `EBAY_DELETION_ENDPOINT`) | eBay account-deletion notification endpoint | unset | honest 503 (eBay's portal verification fails until set) |
| `WOOCOMMERCE_STORE_APPROVED` + `WOOCOMMERCE_STORE_URL` | WooCommerce adapter | off | adapter reports disabled |
| `DEVICE_COOKIE_SECRET` | identity issuing | required (503 if unset in prod) | honest 503 |
| `ADMIN_TOKEN` | admin surface | disabled if unset | honest 503 |
| `DATABASE_EXPECTED_ROLE` / prod default `asilum_app` | least-privilege runtime | enforced in prod | fail-closed boot |
| `WARDROBE_ENABLED` | private owned-piece collection + stylist anchors | on (`0` is the kill switch) | wardrobe API refuses with 503; wardrobe anchors refuse instead of silently dropping |
| `DISCOVER_RAILS_ENABLED` (+ per-rail registry `enabled` rows) | D: cultural Discover rails | on (`0` is the kill switch) | rails API refuses with 503; Discover stays strip-only |
| `PROFILE_THEMES_ENABLED` (+ per-theme registry `enabled` rows) | E: profile rooms | on (`0` is the kill switch) | rooms API refuses with 503; profile keeps the default skin; published rooms 404 |
| `BRAIN_BRIDGE_TUNING` | evidence-gated bridge re-weighting (lib/brain/tuning.js) | on (`0` = the shipped split) | the base 30/15/20/10/15/10 split, always |
| `BRAIN_EXAMINED_IMPRESSIONS` | attribution counts only examined slots (lib/brain/attribution.js) | on (`0` = serve-counting) | every served slot counts as an impression |
| `BRAIN_DECAY_BY_CLASS` | decay by evidence class: explicit never fades, inferred 6 days, session 1 day (lib/brain/memory.js) | on (`0` = one half-life) | one 6-day half-life for everything, explicit tags included |
| `BRAIN_EDGE_CORROBORATION` / `BRAIN_POPULARITY_DEDUP` / `BRAIN_POPULARITY_DECAY` / `BRAIN_IMAGE_GAMMA` / `BRAIN_VECTOR_NEIGHBORS` | per-module gamma/delta behaviour (lib/brain/*) | on | the pre-flag behaviour of each module |
| `SEARCH_TASTE_BLEND` | search personalisation reads tasteVector (60/40, clamped) like every other surface (lib/search/index.js) | on (`0` = the old 1:1 sum) | long + session summed, unclamped |
| `SEARCH_BRAIN_LOOP` / `SEARCH_SEMANTIC_RERANK` / `SEARCH_SEMANTIC_TIEBREAK` / `SEARCH_ERA_READING` / `SEARCH_ORIGIN_READING` / `SEARCH_BRAND_SPELLING` / `SEARCH_DESIGNER_CREDIT` / `SEARCH_NEGATION` / `SEARCH_SIZE_READING` / `SEARCH_PRICE_SORT` / `SEARCH_GARMENT_TITLE_EQUIV` / `SEARCH_PASSPORT_ASSUMPTION` / `SEARCH_CULTURE_FALLBACK` | the search readers, one kill switch each (lib/search/index.js) | on | that reader off; the word is disclosed as unmatched instead |
| `BRAIN_CATALOG_LANE` | the 25% catalog lane + chunk shares in /api/feed (lib/brain/chunk.js) | on (`0` is the kill switch) | legacy zoning: discovery every 5th slot, two spread reaches, no lane; `chunk.catalog` is null. Layout only — equal scores break on an id hash in BOTH modes since #433, so the pre-#433 page order is not restored |
| `STOREFRONT_ENABLED` | the one native Storefront surface under Profile | on (`0` kills the surface) | storefront records remain intact and existing financial operations remain readable |
| `NATIVE_LISTINGS_ENABLED` | native Storefront draft/listing writes | on (`0` makes the owner surface read-only) | public/read paths remain; no listing or inventory mutation |
| `NATIVE_CHECKOUT_ENABLED` | creation of new native payment attempts | **off** (`1` opts in) | draft/catalog work continues; checkout explains that payment validation is incomplete |
| `STOREFRONT_FEE_COLLECTION_ENABLED` | reserve/collect the one-time $30 from eligible seller proceeds | **off** (`1` opts in, also requires checkout + current validation artifact) | outstanding balance carries forward; it is never moved to the buyer |
| `STRIPE_CONNECT_LIVE_ENABLED` + `STOREFRONT_PAYMENT_VALIDATION_VERSION` | live connected-account money | **off** | test mode may operate when explicitly enabled; live keys cannot open native checkout |

`STRIPE_CONNECT_ACCOUNT_ID` is not a rollout flag or a runtime seller-id
override. It is accepted only by `npm run verify:stripe-connect`, whose
preflight requires an `sk_test_` key and refuses database, notification, and
live-enablement variables before making a provider request.

## Roadmap flags (reserve now, one per phase-1+ surface)

| Flag | Feature | Kill behavior |
|---|---|---|
| `ASTERISK_ORCHESTRATOR_ENABLED` | A: multi-resolver interpretation | fall back to deterministic router (current behavior) |
| `ASTERISK_UNKNOWN_QUERIES_ENABLED` | A: aggregation + research queueing | queries still answered; nothing recorded |
| `ASTERISK_NOTIFICATIONS_ENABLED` | A: learning notices | silent |
| `ASTERISK_DRAWER_ENABLED` / `ASTERISK_PAGE_ENABLED` | B | nav item hidden |
| `WARDROBE_UPLOADS_ENABLED` | C photo uploads + private Storage | new uploads/replacements absent; existing-photo erasure remains available |
| `MESSAGING_ENABLED` | F | feature absent (not "coming soon" fake states in API responses) |
| `WIRE_VIDEO_ENABLED` | V.2 slice 9: MOTION uploads through the media worker (`lib/media/worker.js`, `/api/editorial/motion`) — a signed direct upload to the Wire bucket, then the server probes its own copy; needs `WIRE_UPLOADS_ENABLED=1` + storage | absent — the composer's VIDEO says why; `begin`/`verify` answer 503; the housing still plays the generated sample and any already-admitted asset |
| `DM_MEDIA_ENABLED` | V.2 Stage C: the DM media pipeline (`lib/dm/media.js`, `/api/dm/media`); needs `MESSAGING_ENABLED=1` + storage; gated by OWNER-DECISIONS #3 | absent — `/api/dm/media` and `op=attach` 404; the per-conversation consent toggle still records |
| `SEARCH_TASTE_RERANK` (default ON; `0` kills) | V.2 Stage D: the taste reranker over a guided search (`brain=1`), exact-identity rows pinned, no row added or removed (`lib/search/reranker.js`) | the engine's own order is served |
| `DM_CLEAR_NOTICES` (default OFF; `1` enables) | V.2 Stage C: tell the other participant once, neutrally, when a viewer clears their own copy — built as the brief requested; **OFF by owner decision (OWNER-DECISIONS §9, 2 Oct 2026)** | the clear happens, no notice is written |
| `BRAND_VERIFICATION_ENABLED` | G | no badge surfaces (case machinery shipped v18, admin-only and flag-independent; the flag gates future PUBLIC badges) |
| `EDITORIAL_PUBLISHING_ENABLED` | Restructure Phase 1 (ADR-004): public publishing pipeline | drafts still work; publish action absent |
| `MIXED_FEEDS_ENABLED` | Restructure Phase 2 (ADR-005): TODAY/Editorial candidate feeds | existing home feed unchanged |
| `SOCIAL_GRAPH_ENABLED` | Restructure Phase 4: reactions, comments, notifications surfaces | follows (v14) unaffected; new surfaces absent |
| `SPONSORED_PLACEMENTS_ENABLED` | Restructure Phase 5+ (ADR-005 gates): disclosed sponsored candidates | no sponsored rows ever enter feeds |

Rules:
1. A kill switch must be flippable by env change + restart alone — no
   migration, no data loss.
2. Flags gate SURFACES; data written while a flag was on must survive the
   flag going off.
3. Every new external adapter adds its row here + in RIGHTS-REGISTER.md in
   the same PR.
4. Disabling native checkout blocks only **new attempts**. Webhook ingestion,
   refunds, reconciliation, in-flight order reads and immutable ledgers must
   remain available so rollback cannot strand money.
