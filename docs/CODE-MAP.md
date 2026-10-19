# CODE MAP — where everything lives

**Audience: the incoming CTO.** This is the first document to read. It answers
one question — *"I need to change X; which file do I open?"* — and it is
generated from the tree's own file headers rather than written from memory, so
it describes the code that exists rather than the code someone remembers.

Regenerate it with `npm run docs:codemap` after any structural change. A map
that drifts is worse than no map: `docs/ARCHITECTURE-MAP.md` sat claiming
"schema v12" for five weeks while production ran v48, and the first person to
trust it would have been wrong about the entire persistence layer.

---

## The 60-second orientation

ASILUM is a Next.js 14 app (App Router, plain JavaScript — no TypeScript
toolchain) with Postgres via Supabase, and an in-memory fallback so it runs
with no database at all.

Four layers, and almost every change lives in exactly one of them:

| Layer | Directory | What it owns |
| --- | --- | --- |
| **Surface** | `app/` (pages, `app/components/`) | What a person sees. Server components by default; `"use client"` marks the interactive ones. |
| **Request plane** | `app/api/*/route.js` | Every HTTP entry point. Auth, rate limits, and validation happen here — never deeper. |
| **Engine** | `lib/` | All the thinking: ranking, search, tagging, the Asterisk system. Pure modules, unit-testable, no HTTP. |
| **Persistence** | `lib/db/` | The only place SQL is written. Everything above it calls functions, never queries. |

**The rule that keeps this honest:** dependencies point *downward only*.
`lib/` must never import from `app/`. If you find yourself wanting to, the
logic belongs in `lib/` and the route should call it.

### The five things worth understanding before the rest

1. **The six-bridge brain** (`lib/brain/`) ranks the feed: alpha (content
   match), beta (dominant trait), gamma (co-engagement graph), delta
   (popularity), epsilon (exploration), and ad. Start at `lib/brain/index.js`.
2. **ASTERISK** (`lib/asterisk/`) is the reading and memory layer — it is
   deterministic by product law, not an LLM agent. `docs/adr/ADR-007` draws its
   tool boundary.
3. **Identity is two-tier**: an HMAC device cookie (`u-<uuid>`) or a verified
   Supabase session (`sb-<uuid>`). `ADR-002` is binding here and has been
   violated before — read it before touching accounts.
4. **Migrations are append-only and numbered**: `supabase/schema-v<N>-*.sql`,
   applied in order by `scripts/apply-schema.mjs`. Production is at **v48**.
5. **Interactions commit in ONE transaction** — profile, interaction, event,
   edges, and popularity together, or not at all. See `commitInteractionBatch`.

---

## Where to start for a given task

| I want to… | Open |
| --- | --- |
| Change how the feed ranks | `lib/brain/index.js`, then `lib/brain/bridges.js` |
| Change what search understands | `lib/search/index.js`, `lib/search/denseQuery.js` |
| Add or rename a tag facet | `lib/tagging/vocabulary.js` — **the single register**, plus a new migration |
| Change a page's look | `app/<route>/page.js` and `app/globals.css` |
| Add an HTTP endpoint | a new `app/api/<name>/route.js`, calling into `lib/` |
| Touch the database | `lib/db/` **only** — plus a new numbered migration |
| Understand a past decision | `docs/adr/` first, then `docs/OWNER-DECISIONS.md` |
| Know what is deliberately not built | `CONSTITUTION.md` §"Do NOT build yet" |

---

## Reading the tables below

- **Lines** is the file's real length. **⚠️** marks files over 1,200 lines —
  these are the ones a newcomer will struggle with, and they are listed in
  `docs/DEBT-REGISTER.md` with a split plan.
- **What it is** quotes the file's own header comment. Where it says
  *no header*, the file has none — that is a tracked gap, not an omission here.

---

## `lib/` — the engine

All the thinking. Pure modules: no HTTP, no React, unit-testable in isolation.
Nothing here may import from `app/`.


### `lib/`
*33 files, 5,979 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `orders.js` | 566 | The checkout engine (risk campaign §2, phase L2). SERVER-ONLY. |
| `client.js` | 529 | Browser-side helpers: per-device identity, JSON POST, and deterministic SVG placeholder thumbnails so the moodboard is visual even for items whose |
| `social.js` | 495 | Client-safe social + marketplace scaffolding: source labels, mock users and editorial stories, the community post store (local state until a posts |
| `products.js` | 434 | Canonical product resolution. Mutation routes accept only an item id and rebuild the snapshot from server-owned inventory before learning or saving. |
| `globe.js` | 411 | THE PURCHASE GLOBE's renderer (client-safe, no imports). |
| `dm.js` | 324 | Direct messages — the isomorphic half. No database, no server-only imports, so the shell and the API agree on the vocabulary. |
| `sessions.js` | 244 | THE UNIVERSAL SESSION HUB, as a pure model (V.2 Blueprint, owner, 17 Oct 2026, chapter 1 "Navigation and popup sessions"). |
| `provenance.js` | 202 | DOES ANYBODY BACK THIS, OR DID A SELLER SAY IT? |
| `viewstate.js` | 194 | THE VIEW-STATE REGISTRY (V.2 brief, owner, 1 Oct 2026, §2 "State and feed parking"). |
| `uilab.js` | 193 | DESIGN CONSOLE registry + persistence (client-safe). |
| `dm-desk.js` | 185 | The mail desk's decisions, as functions. |
| `analytics.js` | 177 | The /stats dashboards (owner directive, HANDOVER-2026-08-14 backlog 5). SERVER ONLY — reads the database directly. |
| `dockstate.js` | 165 | the control deck's live state, shared by the deck, the fixtures, the sheets and the roots without a React context (the |
| `vault.js` | 155 | The buyer vault (owner ruling 20 Aug 2026): name, address, and saved-card REFERENCES — Stripe customer/payment-method ids plus brand/last4 display |
| `save.js` | 152 | ONE SAVE (Live Launch V.2, owner brief 17 Sep 2026). |
| `location.js` | 150 | the three location concepts, on the device (V.2). |
| `dock.js` | 138 | THE CENTRAL CONTROL DECK as DATA (V.2 Blueprint, owner, 17 Oct 2026, Foundations "Screen map"; the 1 Oct brief §1 where the |
| `identity.js` | 135 | WHO THE CALLER IS. The root of trust for the whole app. |
| `accounts.js` | 134 | WHAT KIND OF ACCOUNT THIS IS, and — more importantly — the single table that says what each kind can reach. Isomorphic: no database, no imports with a |
| `hotlist.js` | 126 | The hotlist program's laws in one home (P2–P4, owner build order 20 Aug 2026; ruling record docs/hotlist-program-spec-2026-08-20.md). SERVER-ONLY. |
| `disc.js` | 123 | THE DISC's physics, as pure functions (V.2 Blueprint, owner, 17 Oct 2026, chapter 2 "Disc controls, motion and tactile |
| `url.js` | 104 | Shared URL guard for anything rendered as a link or persisted from a source. ASILUM never needs executable/data URLs, private-network destinations, or |
| `nav.js` | 102 | THE DESTINATIONS, as DATA (V.2 Blueprint, owner, 17 Oct 2026 — Foundations, "Central Control Deck" and "Screen map"). Extracted from the |
| `age.js` | 80 | The age gate. Isomorphic: the signup sheet and the server compute the same answer from the same function, because two implementations of "how old is |
| `placements.js` | 79 | STREET COMMERCE: what the device's ticker may carry. |
| `site.js` | 64 | THE canonical origin, in one place. |
| `notify.js` | 62 | Operator notification for paid orders (risk campaign F29/F74: an order nobody notices is a customer failed). SERVER-ONLY. |
| `consent.js` | 54 | D4's law (ruled 20 Aug 2026; spec docs/d4-consent-spec-2026-08-20.md): UNANSWERED = UNOBSERVED. The state rides an HttpOnly cookie the server |
| `haptics.js` | 52 | THE TACTILE VOCABULARY (V.2 Blueprint, owner, 17 Oct 2026, clauses 2.1, 2.20, 2.21 and Foundations "Motion and tactility"). |
| `purchasable.js` | 51 | THE checkout honesty gate, extracted to a pure, dependency-light module so lib/products.js can stamp the public |
| `supabase.js` | 42 | Supabase auth client factory. The app must run fully without Supabase (constitution: nothing fake, no crashes on missing keys), so: |
| `business.js` | 32 | the business-account law (owner order, Aug 13), client-safe: shared validation for the passport → business upgrade. |
| `tickets.js` | 25 | Shared purchase-ticket constants (client-safe — no db imports). ASILUM is a third-party purchase ASSISTANT: it never fulfills, ships, |

### `lib/ai/`
*13 files, 1,640 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `trendKnowledge.js` | 266 | Dated fashion-context snapshot for the stylist. Trend knowledge is an exploration signal, never a rewrite of a user's taste profile. Every entry |
| `stylistReasoningEngine.js` | 244 | Stylist intelligence service — separated from the UI entirely. Today: REAL tag-based logic reusing the live outfit engine (lib/brain/ |
| `validate.js` | 205 | Model output is UNTRUSTED input — same posture as client payloads. Validators check shape, normalize and dedupe tags, strip anything the |
| `promptVersions.js` | 172 | Versioned prompt templates for the future mini-GPT. NO model is called today — these exist so the day a provider is wired, prompts are already |
| `adapter.js` | 158 | THE seam where a real model plugs in. Server-only (logs to the database). |
| `styleProfile.js` | 146 | User style profile: the distilled taste document that Mood Board Brain, Search, Discover, and the Stylist all read. Rebuilt from REAL signals: |
| `moodBoardAnalyzer.js` | 128 | Mood Board intelligence service. Server-only. Route: model if enabled (through the adapter) → local rules otherwise. |
| `search-adapter.js` | 75 | the AI seam for search. |
| `localFashionInterpreter.js` | 74 | The REAL rule-based fallback that runs while no model is connected. Interprets a mood-board item from what we can actually read today: |
| `index.js` | 61 | ASILUM ALPHA LEARNING BRAIN — facade and status map. |
| `config.js` | 56 | AI feature gating. DISABLED BY DEFAULT — the app must run fully, and honestly, with none of these set. Server-only values (AI_API_KEY) are read |
| `types.js` | 30 | Shared JSDoc typedefs for the AI foundation (this project is plain JS — these are the "TypeScript types" of the house style, enforced at runtime |
| `contract.js` | 25 | Shared helpers that keep the Alpha Brain foundation HONEST. Every placeholder in lib/* returns through one of these, so nothing can |

### `lib/analytics/`
*1 file, 67 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `lostness.js` | 67 | THE SMALL ANALYTICS VOCABULARY FOR TASK SUCCESS AND LOSTNESS (V.2 brief §13). Pure and client-safe. |

### `lib/api/`
*1 file, 63 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `outcome.js` | 63 | the typed outcome every V.2 route in the engine lane returns (docs/v2/CONTRACTS.md § Common behavior). |

### `lib/asterisk/`
*20 files, 3,133 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `orchestrator.js` | 392 | Asterisk AI — universal interpretation orchestrator (handoff Feature A, Phase 1). Deterministic, layered, and honest: |
| `governance.js` | 356 | ASTERISK GOVERNANCE, the policy as numbers (V.2 Blueprint, owner, 17 Oct 2026, Part I "ASTERISK governance"; Terms |
| `explain.js` | 296 | Asterisk AI — the explanation system. Every recommendation can answer "why am I seeing this?" with reasons built ONLY from real, named signals: |
| `research.js` | 207 | Asterisk AI — research-ingestion pipeline (docs/ASTERISK-AI.md §9, P2 v1). The controlled path from web research to culture records — and the only |
| `houses.js` | 193 | where the houses are from. |
| `memory.js` | 191 | the Asterisk memory READ FACADE (ADR-001, v2). One versioned contract that Home, Discover, Stylist, Moodboard, Profile, |
| `tagAudit.js` | 184 | Asterisk AI — the secondary audit of every tagged product. Dual tagging: Base Tags (items fields + product_tags: retailer/seller/admin) |
| `confidence.js` | 145 | Asterisk AI — separated, honest confidence (handoff Feature A rules). Four independent values, NEVER averaged into one impressive number: |
| `culture.js` | 142 | Asterisk AI — curated cultural knowledge v1 (films, music, cities, decades). These are EDITORIAL STYLE READINGS, not factual claims: no designer credits, |
| `cultureSchema.js` | 138 | One schema boundary for both staged proposals and checked-in research. Keeping normalization here prevents the database gate and module loader |
| `correctionSignals.js` | 112 | Shared correction semantics for every recommendation surface. Persistence aggregates explicit feedback; consumers apply the same weights |
| `places.js` | 109 | where the houses' cities are on the globe. |
| `unknownQueries.js` | 104 | Asterisk AI — unknown-query aggregation (handoff Feature A, Phase 1). An unresolved or research-flagged query becomes a normalized, demand- |
| `ontology.js` | 100 | Asterisk AI — canonical fashion ontology v1 (the shared fashion language). Every tag has ONE defined meaning: a canonical id ("<type>.<slug>"), a |
| `facts.js` | 98 | Asterisk AI — learned-fact pipeline. External research / model output lands here as STAGED claims with sources and scores; it NEVER writes directly to |
| `trends.js` | 91 | Asterisk AI — trend lifecycle intelligence (docs/ASTERISK-AI.md §4, P4 v1). THE single source of truth for trend claims, reconciling the two layers |
| `governor.js` | 84 | RUN A TASK UNDER GOVERNANCE (V.2 Blueprint, Part I "ASTERISK governance"; slice 5). SERVER-ONLY: the glue between the |
| `margin.js` | 70 | THE MARGIN ASTERISK IS ALLOWED TO ASSUME WITHIN. |
| `queryRouter.js` | 61 | Asterisk AI — query classification + entity resolution v1. A search box entry may be a brand, a garment, an aesthetic, a film, a |
| `interpretationSchema.js` | 60 | Asterisk AI — the versioned interpretation contract (handoff Feature A). One shape every consumer (search, drawer, rails, eval harness) can pin. |

### `lib/asterisk/culture/`
*6 files, 1,842 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `catalog-expansion.js` | 677 | PART OF THE CULTURE CATALOG — see lib/asterisk/culture.js, which assembles every part IN ORDER and is the only module anything else imports. |
| `catalog-hiphop.js` | 377 | PART OF THE CULTURE CATALOG — see lib/asterisk/culture.js, which assembles every part IN ORDER and is the only module anything else imports. |
| `catalog-aesthetics.js` | 300 | PART OF THE CULTURE CATALOG — see lib/asterisk/culture.js, which assembles every part IN ORDER and is the only module anything else imports. |
| `catalog-figures.js` | 248 | PART OF THE CULTURE CATALOG — see lib/asterisk/culture.js, which assembles every part IN ORDER and is the only module anything else imports. |
| `catalog-core.js` | 206 | PART OF THE CULTURE CATALOG — see lib/asterisk/culture.js, which assembles every part IN ORDER and is the only module anything else imports. |
| `provenance.js` | 34 | WHERE A READING CAME FROM. |

### `lib/authenticity/`
*1 file, 174 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `evidence.js` | 174 | WHAT WE COULD SEE. Never a verdict. |

### `lib/background-jobs/`
*1 file, 44 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 44 | Learning-job registry. There is NO job runner in this stack yet (no queue, no cron) — so these are contracts only, and every run() says so honestly. |

### `lib/brain/`
*21 files, 5,120 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 804 | The orchestrator. Ties tags + lexicon + knowledge base + bridges into a single "brain" that can resolve any token (word, designer, era, mood, or |
| `bridges.js` | 688 | ASILUM brain — THE SIX BRIDGES. Each bridge scores a catalog item for a user from a different angle, then |
| `replay.js` | 504 | offline replay harness (r15, bot world r22). |
| `kb.js` | 484 | ASILUM brain — KNOWLEDGE BASE: the 'zenith of fashion knowledge' layer. Maps designers, genres/aesthetics, eras — and (asterisk-boost r1) style |
| `sizing.js` | 428 | Asilum "size brain" — a normalization layer that maps any labeled size (mens / womens / luxury numeric) onto a common "fits like US __" scale, |
| `lexicon.js` | 368 | ASILUM brain — LEXICON: maps non-clothing signals to aesthetic tag vectors. This is what lets the moodboard 'think' — turning a color, a music genre, a |
| `chunk.js` | 283 | the CHUNK: how one served page of the catalog is divided, and the CATALOG LANE that walks the listing in cursor order. |
| `popularity.js` | 276 | the popularity bridge's counters (Aug 6, 2026). |
| `stylist.js` | 177 | THE STYLIST — a branch of the brain that assembles full outfits. Consumes the same flat tag vectors as every bridge, plus category, era and |
| `noise.js` | 173 | noise-floor estimators for the measurement batteries (r26, audit #26). |
| `tuning.js` | 155 | bounded bridge self-tuning (r16). |
| `measurements.js` | 149 | a person's body, in four shapes. |
| `memory.js` | 108 | FORGETTING, made visible. learn() applies per-interaction decay — but a profile untouched for a week should fade on the clock, not only when the |
| `purchase.js` | 108 | A PURCHASE TEACHES THE BRAIN (interconnections round, 19 Sep 2026). |
| `distribution.js` | 103 | distributional-health metrics (r23, audit #12). |
| `edges.js` | 84 | co-engagement graph corroboration (Aug 6, 2026). |
| `tags.js` | 66 | ASILUM brain — canonical aesthetic tags + affinity matrix. The 10 fixed tags every product and every user vector is expressed in. |
| `taste-class.js` | 58 | ASTERISK's one-word read of a taste profile. Client-safe, imports nothing. Each class scores the bearer's REAL |
| `attribution.js` | 52 | examined-impression attribution (r19). |
| `fitHints.js` | 35 | a reader's own fit corrections reach the ladder (V.2, 19 Sep 2026). |
| `policy.js` | 17 | the one version string every learning surface carries. |

### `lib/brands/`
*3 files, 323 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `cases.js` | 134 | brand verification & impersonation cases (Feature G groundwork). The Shopify/OAuth half of Feature G is externally gated; this |
| `shopify.js` | 104 | Consented Shopify import for a VERIFIED business (owner directive, 18 Aug): the designer gave us their myshopify domain in their own |
| `verify.js` | 85 | Domain-control proof for business verification (Feature G's missing evidence collector). SERVER-ONLY. |

### `lib/brdcst/`
*1 file, 250 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 250 | BRDCST OUTREACH AND BILLING (V.2 Blueprint, owner, 17 Oct 2026, chapter 5 "BRDCST distribution, billing and ASILUM Credit" |

### `lib/connectors/`
*1 file, 160 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 160 | THE CONNECTOR REGISTRY (V.2 brief §11, §13). Client-safe for the capability table; the status reader consults the |

### `lib/craving/`
*1 file, 79 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 79 | Transient craving context. This is deliberately separate from the durable taste profile: what someone needs tonight should steer this feed without |

### `lib/db/`
*10 files, 1,938 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `storefrontCheckout.js` | 877 | Durable native-Storefront checkout records. This module is intentionally Postgres-only: real inventory and money may never fall back to process |
| `orders.js` | 270 | Order persistence: `order_events` is the append-only truth, `orders` the projection (schema-v31). SERVER-ONLY. Both stores enforce the same laws: |
| `accountKinds.js` | 171 | account_kinds + account_kind_events (schema v37). SERVER-ONLY. |
| `index.js` | 135 | Persistence layer. Uses Postgres (Neon/Supabase) when DATABASE_URL is set, otherwise falls back to an in-memory store so the app runs locally and in |
| `dm.js` | 128 | THE MAIL DESK. SERVER-ONLY. (schema v40-v43) |
| `imageFingerprints.js` | 96 | Storage + collision scan for image fingerprints (schema-v33). SERVER-ONLY. The scan reads all rows (capped) and compares in JS — hamming distance has |
| `accountAges.js` | 77 | account_ages (schema v39). SERVER-ONLY. |
| `types.js` | 69 | Entity typedefs for the Alpha Learning Brain (JSDoc — this project is plain JS; no TS toolchain added). The LIVE store is lib/db/index.js |
| `production.js` | 65 | THE DOOR, AND NOTHING ELSE. |
| `booths.js` | 50 | booth_visits — THE separate attribution channel (owner's words, §6/P2): a reader reached a booth via THE WIRE's hotlist. Append-only; the 15% |

### `lib/db/core/`
*11 files, 1,996 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `boards.js` | 280 | MOODBOARDS. |
| `events.js` | 240 | THE CANONICAL HISTORY, AND MOVING IT TO AN ACCOUNT. |
| `graph.js` | 237 | THE CO-ENGAGEMENT GRAPH. |
| `popularity.js` | 229 | ENGAGEMENT AND EXPOSURE COUNTERS. |
| `pool.js` | 202 | THE CONNECTION, AND WHAT IT REFUSES TO OPEN. |
| `items.js` | 189 | THE CATALOG ROWS THIS LAYER OWNS. |
| `profiles.js` | 143 | TASTE VECTORS. |
| `interactions.js` | 135 | THE EVENT LOG, AND THE ONE ATOMIC COMMIT. |
| `stats.js` | 131 | AGGREGATES FOR THE DASHBOARD. |
| `embeddings.js` | 122 | THE VECTOR SEAM (v1). |
| `store.js` | 88 | THE FALLBACK STORE, AND THE THREE THINGS EVERY MODULE HERE BORROWS FROM IT. |

### `lib/db/dm/`
*11 files, 2,430 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `threads.js` | 431 | A CONVERSATION. |
| `consent.js` | 359 | WHO MAY REACH YOU. |
| `edits.js` | 289 | STAGE C OF THE MAIL DESK (V.2 brief §3–§4, schema v59). |
| `people.js` | 283 | WHO IS ON THE OTHER END, AND WHO MAY BE ADDRESSED. |
| `export.js` | 232 | HANDING SOMEONE THE RECORD OF THEIR OWN CONVERSATIONS (CONSTITUTION §6). |
| `activity.js` | 218 | READ RECEIPTS AND TYPING. |
| `settings.js` | 201 | A PERSON'S OWN CONTROLS. |
| `reactions.js` | 163 | MARKS ON A MESSAGE, AND TAKING ONE BACK. |
| `attachments.js` | 142 | AN IMAGE IN A THREAD (V.2 brief §3, schema v59). SERVER-ONLY, and reached only when the media pipeline is enabled |
| `core.js` | 80 | WHAT EVERY MAIL-DESK MODULE STANDS ON. |
| `mute.js` | 32 | SILENCE THE BADGE, AND NOTHING ELSE. |

### `lib/db/production/`
*23 files, 10,440 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `storefronts.js` | 2608 ⚠️ | native Storefront persistence (v62). SERVER-ONLY. Memory mode mirrors the Postgres laws for local development and |
| `corrections.js` | 1049 | WHEN A READER SAYS WE GOT IT WRONG. |
| `interpretation.js` | 964 | HOW ASTERISK READS, and what it remembers about a person. |
| `privacy.js` | 633 | WHAT WE HOLD ABOUT YOU, AND HANDING IT BACK. |
| `brdcst.js` | 520 | BRDCST CAMPAIGNS AND THE BONUS BANK (V.2 Blueprint chapter 5, 5.10–5.28, 9.13, Terms 15; slice 8; schema v66). |
| `commerce.js` | 517 | NATIVE COMMERCE'S ROWS (V.2 Blueprint, chapters 7 and 8; slice 6; schema v64 over the storefront's v62). |
| `editorial.js` | 479 | THE WIRE, and what readers put on it. |
| `ai.js` | 455 | THE MACHINE'S OWN RECORDS. |
| `booths.js` | 440 | WHO GETS TO SELL HERE. |
| `catalog.js` | 393 | WHAT WE KNOW ABOUT A PIECE, and what people asked for. |
| `aftersale.js` | 334 | AFTER THE SALE (V.2 Blueprint chapter 6 6.1–6.8, chapter 10; slice 7; schema v65). SERVER-ONLY; memory mode mirrors |
| `asterisk.js` | 274 | ASTERISK GOVERNANCE'S ROWS (V.2 Blueprint, Part I "ASTERISK governance"; schema v63). SERVER-ONLY; memory mode |
| `wardrobeTransfers.js` | 262 | THE GIFT'S TRANSACTIONS (V.2 brief §8, schema v60). SERVER-ONLY; memory mode mirrors every law. |
| `tickets.js` | 259 | SOMEBODY WANTS TO BUY SOMETHING. |
| `listingStatus.js` | 198 | the ListingStatus service's writers and readers (schema v58). SERVER-ONLY; memory mode mirrors every law. |
| `score.js` | 195 | THE PASSENGER SCORE'S ROWS (V.2 Blueprint chapter 6; slice 7; schema v65). SERVER-ONLY; memory mode mirrors Postgres. |
| `ebayFeed.js` | 191 | the eBay feed publisher's two writers (schema v56): the STALE-GUARDED item upsert and the per-file CHECKPOINT. |
| `store.js` | 147 | THE SHARED IN-MEMORY STORE, and nothing else. |
| `records.js` | 138 | user_records (v53): the four kinds of record Live Launch V.2 kept on the device alone, now persisted per identity. |
| `media.js` | 132 | MOTION ASSETS (V.2 Blueprint chapter 3, 17.2; slice 9; schema v67). SERVER-ONLY; memory mode mirrors Postgres. |
| `credit.js` | 106 | ASILUM CREDIT'S LEDGER (V.2 Blueprint 5.26–5.32, Terms 10; slice 7; schema v65). SERVER-ONLY; memory mode mirrors |
| `moderation.js` | 74 | THE QUEUE A HUMAN READS. |
| `verification.js` | 72 | THE VERIFICATION LEDGER'S ROWS (V.2 brief §12, schema v61). SERVER-ONLY; memory mode mirrors it. Append-only: |

### `lib/discover/`
*3 files, 258 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `rails.js` | 174 | cultural Discover rails (handoff Feature D). The registry (discover_rails, v16) says WHICH rails exist and in what |
| `tagRank.js` | 58 | Affinity-aware ranking for Asterisk interpretation tags (?tags=a\|b\|c). |
| `recency.js` | 26 | "newest" means creation time (release blocker 0A-1). publicProduct keeps timestamps server-side by design, so discovery surfaces |

### `lib/dm/`
*1 file, 175 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `media.js` | 175 | THE DM MEDIA PIPELINE (V.2 brief §3), BUILT AND GATED OFF. SERVER-ONLY. |

### `lib/embeddings/`
*2 files, 239 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 168 | Vector contracts for the Alpha Learning Brain. |
| `provider.js` | 71 | the v1 provider adapter (asterisk-boost r4). Plain fetch against an embeddings REST API; NO new runtime dependencies |

### `lib/entities/`
*2 files, 257 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `graph.js` | 201 | THE ENTITY GRAPH (V.2 brief §9, owner, 1 Oct 2026). Five types — :Designer :House :Artist :Spot :Passenger — as one |
| `sources.js` | 56 | THE SOURCE REGISTRY (V.2 brief §9, owner, 1 Oct 2026: "Store source URL, publisher, author, retrieved date, claim/quote |

### `lib/events/`
*1 file, 119 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 119 | Canonical user-event vocabulary for the Alpha Learning Brain. Pure module (no I/O) — safe to import from client or server. |

### `lib/fashion-taxonomy/`
*1 file, 42 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 42 | The shared fashion vocabulary for the Alpha Learning Brain. AESTHETIC_TAGS re-exports the LIVE tag space the Alpha Learning Bridge |

### `lib/feed/`
*5 files, 404 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `rechunk.js` | 146 | which cards a re-chunk may replace. Pure; client-safe. |
| `types.js` | 146 | THE ONE FEED's card law (V.2 Blueprint, owner, 17 Oct 2026, Foundations: "one surface for discovery, publishing and commerce. |
| `actions.js` | 52 | what a card can do to a piece, from anywhere (V.2 slice 3: the LISTING popup lives in the session hub, outside the feed |
| `index.js` | 40 | Feed system foundation. The LIVE product feed is /api/feed (Alpha Learning Bridge): zoned core/discovery/reach, seen-item rotation, 2-per-brand cap, |
| `caption.js` | 20 | the on-media caption's ink (V.2 Blueprint, owner, 17 Oct 2026: "caption text flips between black, gray and white to stay |

### `lib/images/`
*2 files, 122 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `fingerprint.js` | 62 | Deterministic perceptual image fingerprints (dHash) for stolen-image screening — gap 3 of the anti-impersonation directive (18 Aug). |
| `dhash.js` | 60 | PERCEPTUAL HASHING, and nothing else. |

### `lib/ingest/`
*9 files, 1,249 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `ebayFeedPublish.js` | 329 | THE PUBLISHER: a staged eBay feed file (lib/ingest/ebayFeed.js) → rows in the existing catalog. Owner brief §15, |
| `ebayFeed.js` | 179 | Approved Feed Beta downloads, staged on disk, never sent into ASTERISK. A complete gzip + manifest is promoted atomically; interrupted downloads |
| `ebay.js` | 174 | eBay source adapter — the OFFICIAL Browse API path (never scraping). Server-side only: reads EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_ENV from |
| `ebayFeedWorker.js` | 173 | THE WORKER LOOP (owner brief §15 point 4, 1 Oct 2026): the bootstrap, then daily catch-up, then hourly snapshots, |
| `colorEvidence.js` | 163 | Conservative product-color verification. A color becomes a product tag only when the merchant explicitly states it and the actual listing images |
| `sources.js` | 93 | Ingestion adapters. IMPORTANT POLICY: this layer only pulls from sources that PERMIT programmatic access. It never scrapes hotlink-protected or |
| `intake.js` | 71 | Validation for OPERATOR-SUPPLIED real inventory (risk campaign phase L1). The checkout engine's own honesty gate (refusalReason) is the validator — |
| `catalog.js` | 49 | Asilum seed catalog — 915 listings, stored as JSON (catalog.json) so the server parses data instead of executing a half-megabyte JS literal. |
| `inferTags.js` | 18 | ONE text-to-taste bridge for every ingestion path. |

### `lib/ingest/adapters/`
*6 files, 650 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `normalize.js` | 222 | The single normalizer every adapter funnels through: raw source data in, ASILUM NormalizedProduct out. After this point the app does not care |
| `woocommerceAdapter.js` | 134 | WooCommerce Store API adapter. The Store API is officially documented and unauthenticated, but ASILUM still requires explicit merchant approval before |
| `ebayAdapter.js` | 103 | The one adapter with a real implementation today: eBay's OFFICIAL Browse API (lib/ingest/ebay.js). Enabled only when EBAY_CLIENT_ID/SECRET are set. |
| `types.js` | 69 | Source adapter contract (JSDoc — this codebase is plain JS; lib/db/types.js set the precedent). Every marketplace adapter implements the same interface |
| `index.js` | 63 | The adapter registry. One import site for every marketplace source. |
| `sync.js` | 59 | syncProducts(): run every ENABLED adapter, normalize, upsert into the products table (items), write product_images + typed product_tags, and log |

### `lib/ingest/japan/`
*2 files, 380 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `vocabulary.js` | 226 | READING A JAPANESE LISTING. |
| `read.js` | 154 | a Japanese listing title, read into facets. |

### `lib/listing-status/`
*1 file, 129 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 129 | THE LISTING-STATUS SERVICE (V.2 brief §5 and §13, owner, 1 Oct 2026). SERVER-ONLY. |

### `lib/media/`
*4 files, 683 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 458 | MOTION: THE MEDIA LAW (V.2 Blueprint, owner, 17 Oct 2026, chapter 3 "Video playback and persistent music controls" 3.1–3.12, |
| `preferences.js` | 80 | THE MEDIA PREFERENCES, on the device and mirrored (V.2 Blueprint 3.3, 3.6, 3.9–3.10; slice 9). CLIENT-ONLY. |
| `feedplay.js` | 73 | ADAPTIVE AUTOPLAY IN THE FEED (V.2 Blueprint 3.3, 3.4, 3.5, 3.10; slice 9). CLIENT-ONLY. One IntersectionObserver over every |
| `worker.js` | 72 | THE MEDIA WORKER (V.2 Blueprint chapter 3; slice 9). SERVER-ONLY. What it honestly is on this stack is written at the top of |

### `lib/mock-data/`
*1 file, 16 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 16 | Single index of EVERY mock in the app, so demo data can never masquerade as real (constitution). This module points at existing mocks rather than |

### `lib/model/`
*1 file, 127 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `media.js` | 127 | SAMPLE MEDIA for the Live Launch V.2 model. |

### `lib/music/`
*2 files, 199 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 127 | THE MUSIC CIRCLE's law (V.2 Blueprint, owner, 17 Oct 2026, chapter 3 3.13–3.24 "persistent music controls", chapter 4 "Music |
| `player.js` | 72 | THE ONE AUDIO SOURCE (V.2 Blueprint 3.14–3.24; slice 9). CLIENT-ONLY. A single hidden media element (MusicHost.jsx owns |

### `lib/music-mapping/`
*1 file, 83 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 83 | Music-to-Fashion Brain: music taste as an aesthetic signal. The mapping table below is CURATED MOCK DATA (marked as such in every |

### `lib/orders/`
*1 file, 168 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `hub.js` | 168 | THE PURCHASE HUB, a read facade (V.2, 19 Sep 2026; docs/v2/CONTRACTS.md § Purchase hub). |

### `lib/passport/`
*1 file, 52 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `document.js` | 52 | the passport data page's derived strings, in one place (client-safe, no imports), so the document on /board and its |

### `lib/payments/`
*1 file, 498 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `stripe.js` | 498 | Thin Stripe REST client: fetch + form encoding + node crypto, no SDK (stack law: no new runtime dependencies). SERVER-ONLY — never import from client |

### `lib/people/`
*3 files, 425 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `careers.js` | 223 | THE CAREER REGISTRY: sourced, dated designer–house relationships, independent of what the catalog happens to stock (V.2, |
| `overviews.js` | 101 | SOURCED OVERVIEWS of eligible designers and creators (V.2). The compact panel that answers a search for a person the |
| `resolve.js` | 101 | the overview and related edges a query earns (V.2 SearchPage: `overview`, `related`, `query.designerId/houseId`). |

### `lib/places/`
*2 files, 290 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `registry.js` | 240 | THE LOCAL AND GLOBAL FASHION MAP's record (V.2). |
| `cluster.js` | 50 | CLUSTER OVERLAPPING MARKERS (V.2 brief §11). Pure and client-safe: screen-space pins in, clusters out, the same input giving |

### `lib/profile/`
*2 files, 261 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `rooms.js` | 239 | MySpace-inspired profile rooms (handoff Feature E). A room is a signed-in user's OWN corner of the magazine: a claimed handle, |
| `handles.js` | 22 | The handle vocabulary — pure constants, no imports, no db, no window. |

### `lib/recommendations/`
*1 file, 63 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 63 | Recommendation service facade — ONE place that names every recommender the Alpha Learning Brain will offer, delegating to live Alpha Learning Bridge |

### `lib/records/`
*1 file, 41 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `client.js` | 41 | the client half of user_records (v53). |

### `lib/roads/`
*1 file, 190 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `overpass.js` | 190 | THE READER'S OWN STREET MAP (V.2, owner: "instead of the Paris street map, their street map is the background for the |

### `lib/search/`
*26 files, 5,072 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 1940 ⚠️ | ASILUM Search Engine v1 — real, database-backed, tag-expanded, ranked. SERVER-ONLY (imports lib/db). Rule/tag-based logic decides every rack. A |
| `era.js` | 365 | era comprehension for the search engine (Aug 21). |
| `size.js` | 227 | the size the reader asked for (Aug 21). |
| `negation.js` | 218 | the engine stops serving the thing you excluded. |
| `denseQuery.js` | 182 | Dense-layer query understanding for the search engine (Day 26). |
| `mappings-seed.js` | 171 | Curated search mappings — the cultural lexicon that turns human phrases into tags and related terms. Seeded into the search_mappings table (idempotent |
| `typo.js` | 168 | literal-engine typo bridge (r12). |
| `designers.js` | 153 | the people, not just the houses (Aug 21). |
| `intent.js` | 152 | WHAT KIND OF QUESTION IS THIS? |
| `origin.js` | 135 | origin comprehension for the search engine (Aug 21). |
| `suggest.js` | 135 | Autocomplete + misspelling correction. Basic fuzzy matching on purpose (constitution: don't overcomplicate; no AI here). SERVER-ONLY via the pool. |
| `pair.js` | 132 | DESIGNER: HOUSE (19 Sep 2026). |
| `vocabulary.js` | 128 | THE WORDS THE ENGINE KNOWS. |
| `constraints.js` | 124 | THE FILTERS NOBODY SET. |
| `reranker.js` | 122 | THE TASTE RERANKER (V.2 brief §10, step 6). Pure. |
| `eraAnchors.js` | 100 | era-anchor extraction for cultural reads (Aug 5). |
| `wordScope.js` | 96 | "the word is here, just not there" (Aug 21). |
| `passportAssumption.js` | 89 | the influenced-assumption clause (r10). |
| `cursor.js` | 87 | stable search pagination (docs/v2/CONTRACTS.md). |
| `superlative.js` | 87 | "cheapest" is a sort, not a word (Aug 22). |
| `gender.js` | 53 | WHO A PIECE IS CUT FOR, READ FROM WHAT THE RECORD SAYS. |
| `vocab.js` | 53 | stem-indexed token lookup (r11). |
| `ontology.js` | 49 | Fashionpedia-informed garment vocabulary (r13). |
| `ordinary.js` | 46 | A WORD THE ENGINE ALREADY OWNS IS NOT A NAME. |
| `text.js` | 40 | the one place text is folded for matching. |
| `tokens.js` | 20 | HOW A QUERY BECOMES WORDS. |

### `lib/security/`
*5 files, 639 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `request.js` | 166 | WHO IS ASKING, and how much they may ask for. |
| `rateLimit.js` | 164 | Fixed-window quotas backed by Postgres, with a bounded in-memory fallback for keyless development. Subjects are hashed so the quota table stores no user id. |
| `json.js` | 140 | READING A REQUEST BODY FROM A BROWSER, safely. |
| `http.js` | 97 | READING A RESPONSE FROM SOMEWHERE ELSE, safely. |
| `multipart.js` | 72 | Bounded multipart reader for upload routes. Request.formData() buffers the entire body, so consume the stream under an explicit cap before parsing. |

### `lib/steward/`
*6 files, 1,538 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `checks.js` | 663 | what the Asterisk watches when nobody is looking. |
| `index.js` | 330 | the Asterisk steward: one pass over the live machine, and — since 3 September 2026 — hands to act on what it finds. |
| `actions.js` | 229 | the steward's hands. |
| `decisions.js` | 200 | what the steward may decide on its own. |
| `instruments.js` | 98 | the eight instruments, run as one movement. |
| `cronGate.js` | 18 | who may fire the steward from outside. |

### `lib/storefront/`
*10 files, 1,874 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `checkout.js` | 690 | Native Storefront payment orchestration. The catalog dispatch is explicit; all money facts come from server-owned Postgres rows and connected Stripe |
| `commerce.js` | 288 | NATIVE COMMERCE'S LAW (V.2 Blueprint, owner, 17 Oct 2026, chapter 7 "Native commerce, offers and discounts", chapter 8 |
| `protection.js` | 211 | PROTECTION, RETURNS, THE WINDOWS AND THE DISPATCH CLOCKS (V.2 Blueprint, owner, 17 Oct 2026, chapter 6 "Protection, |
| `fees.js` | 186 | canonical native-commerce money policy. |
| `score.js` | 162 | THE PASSENGER SCORE (V.2 Blueprint, owner, 17 Oct 2026, chapter 6, 6.7–6.33; slice 7). PURE and client-safe. |
| `contracts.js` | 113 | client-safe native Storefront contracts. Product facts are explicit; missing facts stay missing. No category borrows |
| `credit.js` | 90 | ASILUM CREDIT (V.2 Blueprint, owner, 17 Oct 2026, 5.26–5.32, 6.1, Terms 10; slice 7). PURE and client-safe. |
| `client.js` | 64 | THE ONE WAY A SURFACE OPENS NATIVE CHECKOUT (V.2 slice 6, over codex/native-storefront). Client-safe. |
| `flags.js` | 54 | rollout and money kill switches. UI/draft work is useful keyless. Every operation that can move money is |
| `catalog.js` | 16 | the explicit first-party catalog discriminator. A missing external URL is NEVER enough to make a row native. Only the |

### `lib/storefront/providers/`
*1 file, 26 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `redo.js` | 26 | THE PROTECTION PROVIDER SEAM (V.2 Blueprint 6.2: "Dynamic provider quote based on item value, shipping, |

### `lib/studio/`
*1 file, 20 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `drafts.js` | 20 | the Studio's DEVICE-LOCAL drafts (events, shops, promotion requests): one key, one reader, one writer, shared by the |

### `lib/tagging/`
*3 files, 754 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `grammar.js` | 372 | THE TAG GRAMMAR: `LEFT: RIGHT` (V.2 Blueprint, owner, 17 Oct 2026, Part I "Tag grammar"; slice 4 of the build order in |
| `vocabulary.js` | 206 | ONE VOCABULARY FOR EVERY TAG ON A PIECE. |
| `dense.js` | 176 | Dense per-piece tagging — 20-30 typed tags per item, every one derived from a REAL product field. Nothing here invents attributes: a material tag exists |

### `lib/taste/`
*1 file, 70 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `network.js` | 70 | THE TASTE NETWORK's reading (V.2), pure. Derives, from the stored profile and the person's own boards, what each of |

### `lib/taste-graph/`
*1 file, 145 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 145 | TikTok-inspired layer: cross-user feed intelligence. Learn not only from one user's actions but from what SIMILAR users save, buy, skip, favorite, |

### `lib/verification/`
*4 files, 393 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `ledger.js` | 211 | THE VERIFICATION LEDGER'S RULES (V.2 brief §12). SERVER-SIDE (node:crypto for the version hash) and pure: the same |
| `desk.js` | 93 | THE VERIFICATION DESK's comparer (V.2). |
| `run.js` | 47 | RUN THE CHECKS on one listing and append the row (V.2 brief §12; slice 5 governance). SERVER-ONLY. The route and the |
| `replicas.js` | 42 | THE REPLICA LIBRARY'S READER (V.2 Blueprint, "Hard gates against authenticating replicas"; slice 5). Pure. |

### `lib/vision/`
*5 files, 861 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `palette.js` | 277 | Palette v0 — the moodboard's first REAL sight. Pure color statistics over image pixels: dominant swatches, brightness/saturation, and a curated |
| `embed.js` | 273 | IMAGE EMBEDDING v0 (r27). The first thing in this system that turns pixels into a VECTOR rather than into words. |
| `sameShot.js` | 125 | THE SAME PHOTOGRAPH, ELSEWHERE. |
| `stampReading.js` | 95 | READING A STAMP, on the device, before it is ever sent anywhere. |
| `index.js` | 91 | Image understanding contracts: Mood Board Intelligence + Fit Pic Analyzer. LIVE today: palette v0 (./palette.js) — real color statistics from pixels, |

### `lib/visual-personalization/`
*1 file, 50 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 50 | Pinterest-inspired layer: taste as a VISUAL WORLD, learned from what users save, organize, and return to — boards first, clicks second. |

### `lib/waiting/`
*1 file, 173 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `index.js` | 173 | WHAT A PERSON IS WAITING FOR, and noticing when it arrives. |

### `lib/wardrobe/`
*6 files, 525 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `photos.js` | 238 | private Storage for wardrobe photos (Phase 3b). SERVER-ONLY. Objects live in the PRIVATE Supabase Storage bucket |
| `index.js` | 172 | the ownership model (handoff Feature C, Phase 3a). A wardrobe row exists ONLY because the user said so: manual add, a catalog |
| `gifts.js` | 59 | THE GIFT, AS RULES (V.2 brief §8). Client-safe. |
| `flow.js` | 42 | THE CLOSET'S COVER FLOW, AS RULES (V.2 brief §8). Client-safe and pure: which cards sit around the selected one, how a |
| `photo-contract.js` | 8 | Client/server shared garment-photo limits. Keep this module dependency-free so browser code never pulls the server-only Storage or Postgres layers into |
| `purchase.js` | 6 | Client-safe ownership rule: an owned anchor participates in styling but is never translated back into purchase intent by a bulk bag action. |

### `lib/wire/`
*5 files, 714 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `compose.js` | 196 | THE ONE COMPOSER's law (V.2 brief §6, owner, 1 Oct 2026). Pure and isomorphic: the composer validates with it as the author |
| `media.js` | 177 | the Wire's IMAGES (V.2 brief §6 "Add media"), stored server-side in the Supabase Storage bucket "wire". SERVER-ONLY. |
| `preview.js` | 129 | THE SAFE LINK PREVIEW (V.2 brief §6: "Article previews are fetched through a safe server preview service: allow |
| `refs.js` | 110 | Hashtags and @mentions on the wire (owner directive, HANDOVER-2026-08-14 backlog 3). Pure text in, structure out — no DOM, |
| `draft.js` | 102 | THE DRAFT (V.2 brief §6): one composition in progress, autosaved on the device with a version, and an ATTACHMENT |

---

## `app/api/` — the request plane

Every HTTP entry point. Authentication, rate limiting and input validation
belong HERE and not deeper — a route is the boundary where an untrusted
request becomes trusted arguments.


### `app/api/account/age/`
*1 file, 92 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 92 | Records the self-declared birth date behind OWNER DECISION #2 (13+). |

### `app/api/account/kind/`
*1 file, 97 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 97 | GET  → this account's kind + the capabilities it opens. POST → choose a kind. Chosen once at signup; changing it afterwards is an |

### `app/api/admin/`
*1 file, 837 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 837 | Admin/moderation backend — no public UI yet (deliberate: the public design is locked; a full admin page can mount on these functions later). |

### `app/api/aftersale/`
*1 file, 107 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 107 | AFTER THE SALE, the passenger's side (V.2 Blueprint chapter 6 and 10; slice 7). The admin decides through |

### `app/api/asterisk/memory/`
*1 file, 68 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 68 | GET  ?user=<uid> → the versioned Asterisk memory contract (ADR-001 v2): what you told us / what we inferred / what Asterisk learned / |

### `app/api/auth/`
*1 file, 144 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 144 | GET issues a server-signed anonymous device identity in an HttpOnly cookie. POST adopts that verified device identity into the Supabase account proven by |

### `app/api/boards/`
*1 file, 171 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 171 | Pinterest-style moodboards. GET    /api/boards?user=<id>      -> the user's boards (with items) |

### `app/api/booth-visit/`
*1 file, 34 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 34 | POST { user?, sourceName } — the attribution channel's ONLY writer (P2). A reader clicked a booth on THE WIRE's hotlist; the visit is recorded so |

### `app/api/brdcst/`
*1 file, 152 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 152 | BRDCST OUTREACH AND BILLING, the broadcaster's side (V.2 Blueprint chapter 5, 5.13–5.28, Terms 15; slice 8). The admin |

### `app/api/business/`
*1 file, 155 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 155 | the passport → business upgrade (owner law, Aug 13). A brand VERIFIES itself: it submits its brand name, its |

### `app/api/checkout/`
*1 file, 145 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 145 | POST { user?, itemId }  → open a Stripe-hosted checkout for a REAL item (demo archive records refuse with 409 — the same |

### `app/api/connect/`
*1 file, 46 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 46 | THE CONNECTOR REGISTRY ON THE WIRE (V.2 brief §11). GET → every connector's capabilities and their explicit states for |

### `app/api/consent/`
*1 file, 61 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 61 | the consent moment's server half (D4). GET reads the state (null = unanswered = unobserved, enforced at every |

### `app/api/credit/`
*1 file, 59 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 59 | ASILUM CREDIT (V.2 Blueprint 5.26–5.32, Terms 10; slice 7). Refunds and gifts in, spends and gifts out; never purchased. |

### `app/api/discover/`
*1 file, 203 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 203 | GET /api/discover?q=&source=&tag=&category=&sort=new&offset=&limit=&user=&brain= The full site inventory — ranked through the user's Passport only when |

### `app/api/discover/rails/`
*1 file, 61 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 61 | cultural Discover rails (Feature D). GET  ?user=  → every enabled rail from the registry, content resolved live |

### `app/api/dm/`
*1 file, 564 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 564 | The mail desk. One route, op-dispatched. |

### `app/api/dm/media/`
*1 file, 85 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 85 | AN IMAGE INTO A THREAD (V.2 brief §3). |

### `app/api/ebay/`
*1 file, 61 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 61 | GET /api/ebay?q=<query>&limit=<n> Live listings from the OFFICIAL eBay Browse API, normalized to the catalog |

### `app/api/ebay/account-deletion/`
*1 file, 71 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 71 | eBay MARKETPLACE ACCOUNT DELETION / CLOSURE notifications — the endpoint every eBay Developers Program keyset must name (or opt out of) before its |

### `app/api/editorial/`
*1 file, 333 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 333 | Editorial as hyperlinked articles + user/ASILUM posts (editorial_posts). Not a heavy magazine backend: title/excerpt/image/link/tags/author, able to |

### `app/api/editorial/engage/`
*1 file, 74 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 74 | LIKES + SAVES on transmissions (owner directive, HANDOVER-2026-08-14 backlog 2). Person-deduped counters in the popularity style: the |

### `app/api/editorial/media/`
*1 file, 63 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 63 | the Wire's image upload (V.2 brief §6 "Add media"). POST multipart/form-data: user, photo (client-re-encoded |

### `app/api/editorial/motion/`
*1 file, 99 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 99 | MOTION: the Wire's video, through the media worker (V.2 Blueprint chapter 3, 17.2; slice 9). What the worker |

### `app/api/editorial/preview/`
*1 file, 26 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 26 | the safe link preview for the composer (V.2 brief §6). GET ?url= → the plain-text snapshot lib/wire/preview.js produces, or { refused } with the reason. A signe |

### `app/api/feed/`
*1 file, 363 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 363 | GET /api/feed?user=<id>&epsilon=<0\|1>&q=<prompt>&board=<boardId>&limit=<12..60>&cursor=<opaque> |

### `app/api/follow/`
*1 file, 71 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 71 | POST /api/follow { user, boardId, follow: true\|false } Following a moodboard makes its taste a standing influence on your feed — |

### `app/api/geo/`
*1 file, 28 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 28 | GET /api/geo → where this connection appears to be, from the edge's own geolocation headers (Vercel stamps x-vercel-ip-* on every request; nothing |

### `app/api/impersonation/`
*1 file, 66 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 66 | the public door to Feature G's impersonation track (gap 1, 18 Aug). |

### `app/api/impressions/`
*1 file, 106 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 106 | POST /api/impressions — the examined-slot beacon (r19). Body: { user, serveId, examined: [itemId, ...] } |

### `app/api/ingest/`
*1 file, 47 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 47 | POST /api/ingest Authorization: Bearer <INGEST_TOKEN> Body: { merchantFeedUrl?, officialApiUrl? } |

### `app/api/interaction/`
*1 file, 185 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 185 | POST /api/interaction Body: { user, item: {id, tags}, action, dwellMs } or  { user, events: [{ item, action, dwellMs }, ...] }  (batched dwell) |

### `app/api/interpret/`
*1 file, 168 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 168 | GET  /api/interpret?q=&user= — Asterisk AI's reading of a search query. Legacy fields (entity/interpretations/personalized) are preserved; the |

### `app/api/items/`
*1 file, 36 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 36 | GET ?ids=a,b,c → the public shape of up to 60 listings by id, with their availability status and when it was last |

### `app/api/measurements/`
*1 file, 75 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 75 | GET / PUT / DELETE — the reader's own body measurements. |

### `app/api/moodboard/`
*1 file, 216 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 216 | The Mood Board as a database feeder. Every training action becomes a real mood_board_uploads record the future vision/AI layer can re-analyze. |

### `app/api/notifications/`
*1 file, 41 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 41 | the in-app notification outbox and its one switch (V.2 brief §5). GET ?user=&unread=1 → the person's notices; |

### `app/api/orders/`
*1 file, 111 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 111 | GET /api/orders?user=<id> — real purchase tickets live elsewhere; this endpoint returns bag intent history, newest first, joined to items. |

### `app/api/outfits/`
*1 file, 312 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 312 | POST /api/outfits { kind:"generate",user,anchor?,full?,fit?,aiConsent? } Legacy GET supports non-sensitive deep links but intentionally ignores fit. |

### `app/api/places/`
*1 file, 39 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 39 | GET /api/places?lat=&lng=&km=&kind=&dated=1\|0&region=&sample=0 The local and global fashion map's record (lib/places/registry.js): two |

### `app/api/privacy/`
*1 file, 120 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 120 | DELETE /api/privacy — erase user-linked personalization data AND the buyer vault (name/address/saved-card references — the right to be |

### `app/api/profile/`
*1 file, 41 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 41 | GET /api/profile?user=<id> — read-only view of the learned profile, used by the brain visualization (vizState runs client-side on this payload). |

### `app/api/profile/room/`
*1 file, 202 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 202 | MySpace-inspired profile rooms (Feature E). GET  ?handle=<claimed>  → the PUBLIC room: published + moderation-visible |

### `app/api/purchase-info/`
*1 file, 57 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 57 | SETTINGS' door to the buyer vault (the other lawful door is the first purchase, in the ticket-fee route; the |

### `app/api/records/`
*1 file, 103 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 103 | the reader's own records (v53, V.2). |

### `app/api/related/`
*1 file, 71 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 71 | GET /api/related?item=<id>&limit=<n> Pinterest-style "more like this": co-engagement graph neighbors first |

### `app/api/reset/`
*1 file, 30 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 30 | POST /api/reset { user } FULL AMNESIA: wipes the learned taste profile (long + session vectors, |

### `app/api/roads/`
*1 file, 29 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 29 | GET /api/roads?lat=&lng=  →  the passport map shape for the streets around a point (lib/roads/overpass.js). Rounded to two decimals so readers a |

### `app/api/score/`
*1 file, 81 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 81 | THE PASSENGER SCORE (V.2 Blueprint chapter 6; slice 7). The score lives on Account and Passport only (6.27). |

### `app/api/search/`
*1 file, 176 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 176 | GET /api/search?q=<text>&user=<id>&brain=<0\|1> ASILUM Search Engine v1 (lib/search): database-backed, mapping-expanded, |

### `app/api/similar/`
*1 file, 47 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 47 | GET /api/similar?user=<id>&limit=<n> TikTok-inspired cross-user layer, live: taste neighbors (profile cosine) |

### `app/api/stats/`
*1 file, 79 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 79 | GET /api/stats — aggregate health metrics for the brain: interaction volume by action, user/board/graph sizes, and the most-engaged items. Read by the |

### `app/api/steward/run/`
*1 file, 52 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 52 | the steward, fired by the clock. |

### `app/api/storefront/`
*1 file, 173 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 173 | Account-owned native Storefront API. Device identities are deliberately refused: storefront, inventory and fee obligations belong to an account. |

### `app/api/storefront/offers/`
*1 file, 69 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 69 | OFFERS, the buyer's side (V.2 Blueprint 7.19–7.30, 8.7–8.11; slice 6). The seller answers through |

### `app/api/storefront/public/`
*1 file, 36 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 36 | Public Storefront read: a strict projection with no owner, provider or fee identifiers. Draft, paused and rejected stores are indistinguishable from |

### `app/api/storefront/queue/`
*1 file, 54 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 54 | THE AVAILABILITY QUEUE (V.2 Blueprint 7.10–7.13; slice 6). A reserved listing can be viewed but not bought; |

### `app/api/stripe/webhook/`
*1 file, 55 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 55 | Stripe → ASILUM. The signature IS the authentication: HMAC over the RAW body with STRIPE_WEBHOOK_SECRET (constant-time, ±5 min). Unkeyed deploys |

### `app/api/style-profile/`
*1 file, 44 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 44 | GET  ?user= → the user's style profile (rebuilt transparently when stale). POST { user } → force a rebuild now. |

### `app/api/stylist/`
*1 file, 87 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 87 | The AI-ready stylist service endpoint (UI-independent; /stylist page and /api/outfits keep working unchanged). |

### `app/api/suggest/`
*1 file, 46 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 46 | GET /api/suggest?q=<partial> — search autocomplete: 3–10 suggestions when possible (corrected spellings, related fashion terms, designers, and |

### `app/api/taste/`
*1 file, 124 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 124 | THE TASTE NETWORK's door (V.2). |

### `app/api/ticket-fee/`
*1 file, 178 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 178 | The §6 referral lane's money door. ASILUM charges the founders fee ALONE; the real purchase — payment, tax, shipping — completes on the source. The |

### `app/api/tickets/`
*1 file, 209 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 209 | The third-party purchase-assistant ticket flow. ASILUM never fulfills: the original marketplace/seller confirms, ships, tracks, and services. |

### `app/api/train/`
*1 file, 57 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 57 | POST /api/train Body: { user, prompt } Cold-starts or reshapes a user's profile from a free-text prompt / moodboard |

### `app/api/verification/`
*1 file, 24 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 24 | GET /api/verification?limit=&status=archivalist\|flagged\|agreed\|pending The verification desk over the catalog: source claims beside a LOCAL-RULES |

### `app/api/verification/listing/`
*1 file, 77 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 77 | THE BADGE AND ITS BREAKDOWN (V.2 brief §12). |

### `app/api/wardrobe/`
*1 file, 108 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 108 | the ownership surface (Feature C, Phase 3a). GET    ?user=&status=active\|retired\|all → your wardrobe (private, always). |

### `app/api/wardrobe/gifts/`
*1 file, 85 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 85 | GIFTING (V.2 brief §8). |

### `app/api/wardrobe/photo/`
*1 file, 151 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 151 | garment photo upload (Feature C, Phase 3b). POST multipart/form-data: user, id (your wardrobe item), consent (the exact |

### `app/api/why/`
*1 file, 93 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `route.js` | 93 | Asterisk AI explanation + correction endpoint. GET  ?item=<id>&user=<uid> → honest "why am I seeing this" (identity-gated; |

---

## `app/` — the surface

Pages and components. Server components by default; `"use client"` marks the
interactive ones. UI is governed by `CONSTITUTION.md` — read it before redesigning.


### `app/`
*7 files, 1,904 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 1189 | CATALOG (home). Straight clothing (owner order, Aug 12; POST folded into THE WIRE at /hotlist by the Aug 13 overhaul — all user posts live there now): |
| `shell.js` | 288 | The shell around every page (V.2 Blueprint, owner, 17 Oct 2026). Three fixtures and nothing else: the INFO DOCK at the top left (likes, bag, |
| `opengraph-image.js` | 175 | the social card, GENERATED, not committed. |
| `not-found.js` | 109 | the 404 plate: a dead record, printed like an editorial page instead of an apology. Owner-directed (21 Aug), references supplied: |
| `layout.js` | 82 | Root layout: every page renders inside the magazine shell. |
| `robots.js` | 38 | served at /robots.txt (Next.js metadata route). NOTE on /piece/<id>: deliberately NOT listed below. It ships a meta |
| `sitemap.js` | 23 | served at /sitemap.xml (Next.js metadata route). Only the public editorial surfaces; personal pages are robots-disallowed |

### `app/accessibility/`
*1 file, 73 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 73 | ACCESSIBILITY STATEMENT. ADA Title III alignment, WCAG 2.1 AA target. Claims here must track what |

### `app/admin/`
*2 files, 853 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 834 | THE DESK (owner directive, HANDOVER-2026-08-14 backlog 4). The operator surface for /api/admin, which has been |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/analytics/`
*1 file, 52 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 52 | the business ledger. Replaces PASSPORT for a business account (lib/nav.js). |

### `app/asterisk/`
*2 files, 180 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 161 | /asterisk — the full Asterisk memory and guidance control room. Everything the drawer shows, plus the control room: export your memory as |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/board/`
*2 files, 573 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 554 | THE PASSPORT (Live Launch V.2). The person's home, archive and command centre, in four tabs under the |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/checkout/`
*2 files, 360 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 341 | THE CHECKOUT HOUSING (owner order, 20 Aug 2026). One clean room for the §6 two-transaction lane: the piece's picture and |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/components/`
*72 files, 12,162 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `MailDesk.jsx` | 1252 ⚠️ | EVERY CALL HERE GOES THROUGH authorizedFetch, AND THAT IS NOT STYLE. |
| `StorefrontTab.jsx` | 905 | ONE STOREFRONT, inside PROFILE. |
| `WireComposer.jsx` | 508 | THE ONE COMPOSER (V.2 brief §6, owner, 1 Oct 2026). One housing for every post: begin with text, then ADD MEDIA |
| `AccountSignup.jsx` | 457 | the account hold (mounted in the shell). Real Supabase accounts only (email + password, or a magic link for |
| `LiquidGlass.jsx` | 395 | LIQUID GLASS, shared: the optics of the header strip (shell.js) and of the item detail (page.js) are one thing — a clear pane whose open edges bend |
| `WardrobeTab.jsx` | 383 | Profile → WARDROBE tab (Feature C, Phase 3a). Pieces you actually own: manual adds here, catalog pieces marked owned, and "bought" ticket |
| `roadBuilder.js` | 352 | passport → /upload build animation (upload-station r5, owner decree). At click the overlay shows a still |
| `DesignConsole.jsx` | 349 | the DESIGN CONSOLE. The owner's hand on the Fashion Intelligence OS: every text size, button |
| `AsteriskDock.jsx` | 308 | ASTERISK's living form (owner decree, redesign/asterisk-hologram): an interactive 3D hologram entity built |
| `Studio.jsx` | 286 | STUDIO, inside the Passport (V.2). One account; the business tools appear here, contextually, without a |
| `MotionHousing.jsx` | 281 | THE VIDEO HOUSING (V.2 Blueprint, owner, 17 Oct 2026, chapter 3 3.1–3.12, 3.14; slice 9). The full-screen |
| `ControlCenter.jsx` | 280 | THE CENTRAL CONTROL DECK (V.2 Blueprint, owner, 17 Oct 2026, Foundations "Screen map"; the 1 Oct brief |
| `ListingSheet.jsx` | 279 | THE LISTING POPUP (V.2 Blueprint, owner, 17 Oct 2026, Foundations: "LISTING opens as a floating popup over |
| `ProfileRoom.jsx` | 277 | Profile rooms (Feature E). Two faces of the same surface: <RoomEditor />  — the owner's editor on /profile. Accounts only (ADR-002); |
| `Disc.jsx` | 257 | THE DISC (V.2 Blueprint, owner, 17 Oct 2026, chapter 2). One rotary component, reused for Post Selection, the session |
| `AsteriskMemory.jsx` | 247 | Asterisk memory surface (contract ADR-001 v2). MemorySections = the shared section renderer /asterisk uses, so the read |
| `PlacesPanel.jsx` | 243 | AROUND YOU / MY PLACES (V.2). The local and global fashion map with its list, filters and the three |
| `WireCard.jsx` | 221 | a post as a card in THE ONE FEED (V.2 Blueprint, owner, 17 Oct 2026: "There is no Wire"; the six publishing |
| `BusinessAccount.jsx` | 205 | the passport → business panel (owner law, Aug 13), mounted on PROFILE → ACCOUNT. Every state shown |
| `ProductSignals.jsx` | 180 | the small honest signals on a piece: what colour it VERIFIABLY is, and how it would fit the reader. |
| `StreetMap.jsx` | 173 | the places map as a STREET MAP in the Apple Maps idiom (V.2 round two, owner: "the map should more similarly copy |
| `SessionCarousel.jsx` | 162 | THE SESSION HUB's face (V.2 Blueprint, owner, 17 Oct 2026, clauses 1.4–1.8, 1.21–1.25, 1.29–1.35). |
| `AddStamp.jsx` | 154 | ADD STAMP (V.2 brief §11): the one housing at the bottom of the personal Passport for everything a passenger may |
| `TasteNetwork.jsx` | 151 | FULL READ as a navigable taste network (V.2). Replaces the rotating asterisk on /stats: the ten tags as nodes on a |
| `SearchSheet.jsx` | 148 | GLOBAL SEARCH's answer (V.2 brief, owner, 1 Oct 2026, §1 + §9–10). The dock's field holds the query; this |
| `SheetHost.jsx` | 148 | THE POPUP (V.2 Blueprint, owner, 17 Oct 2026, chapter 1; the 1 Oct brief decision 2 where the blueprint is |
| `MediaFloat.jsx` | 143 | STILL and MOTION, enlarged (V.2 Blueprint, owner, 17 Oct 2026, Foundations: "STILL and MOTION enlarge |
| `ConsentMoment.jsx` | 138 | D4's first-visit consent moment (ruled 20 Aug 2026; spec docs/d4-consent-spec-2026-08-20.md). Shell- |
| `DiscoverRails.jsx` | 137 | Cultural Discover rails (handoff Feature D). Named, collapsible strips whose content derives live from reviewed sources: the culture catalog |
| `dismiss.js` | 136 | ONE dismissal contract for transient surfaces (synergy phase 1). Every overlay/sheet/modal closes on Escape; panels that |
| `EntityOverview.jsx` | 135 | the ASILUM OVERVIEW for any entity in the graph (V.2 brief §9): a designer (PersonOverview's card, plus the |
| `LikesSheet.jsx` | 133 | LIKES (V.2 brief, owner, 1 Oct 2026, §5). Top subtabs: Pieces \| Wire \| Sold. The one save (lib/save.js) is the |
| `BagSheet.jsx` | 119 | THE BAG, as a sheet (V.2 Blueprint, owner, 17 Oct 2026: the bag opens from the Info Dock, not from a header panel). |
| `PersonOverview.jsx` | 119 | the sourced overview panel (V.2). A knowledge-panel's speed in ASILUM's voice: image with its credit, role, |
| `TicketFlow.jsx` | 117 | the third-party purchase-assistant flow. Buy/Request → ticket created → availability + price shown → REQUIRED |
| `EchoRail.jsx` | 116 | THE ECHO RAIL and THE ECHO VIEWER (V.2 Blueprint, owner, 17 Oct 2026: "ECHO is a story-style temporary viewer |
| `ConnectionsWheel.jsx` | 110 | CONNECTIONS (V.2 brief §11): the people and houses this passenger follows, as a CD-inspired wheel beside a |
| `FloatView.jsx` | 108 | THE FLOAT (owner order, 8 Sep, with a Spotify recording): tap the photograph in the item detail and it floats alone in black space — a |
| `UserBits.jsx` | 105 | Reusable social atoms: monogram avatar, "Who to follow" module, and the user search bar. All follow state is local until real accounts exist. |
| `PurchaseGlobe.jsx` | 101 | THE PURCHASE GLOBE (owner order, 9 Sep: "replace the asterisk figure with a globe that shows all the places users |
| `WardrobeFlow.jsx` | 97 | THE CLOSET (V.2 brief §8): isolated item cards in a closet-like Cover Flow stack — one selected card centred and |
| `MusicCircle.jsx` | 96 | THE MUSIC CIRCLE and its panel (V.2 Blueprint, owner, 17 Oct 2026, 3.17–3.23, 4.2; slice 9). A contextual |
| `PassportPreview.jsx` | 96 | the bearer's passport, in preview (owner, 9 Sep evening: "in the about me there should be a preview of the |
| `ScoreSheet.jsx` | 93 | THE PASSENGER SCORE POPUP (V.2 Blueprint 6.18; slice 7): overall score, verified review count, the star |
| `ParisMap.jsx` | 89 | the real-OSM Paris road hologram, shared (redesign/upload-station). PassportSecurity renders it inside the |
| `TagChip.jsx` | 89 | a tag on screen (V.2 Blueprint, owner, 17 Oct 2026, Part I "Tag grammar" and its Typesetting; slice 4). The law lives in |
| `PassportSecurity.jsx` | 86 | UV security artwork for the PASSPORT document (redesign/passport-uv), color-matched to the OS tokens. |
| `AsteriskWhy.jsx` | 79 | ASTERISK's "why this" panel (Day 11), moved out of the feed page with V.2 slice 3 so the LISTING popup |
| `BrdcstOptions.jsx` | 78 | BRDCST OPTIONS (V.2 Blueprint, owner, 17 Oct 2026, FIG 13 "a BRDCST panel above the disc": 5.13–5.22; slice 8). |
| `FashionMap.jsx` | 75 | the local and global fashion map, drawn (V.2). A SCHEMATIC, on purpose: no tile service, no street map — the |
| `NoticesSheet.jsx` | 73 | NOTICES, the bell's sheet (V.2 Blueprint, owner, 17 Oct 2026, Foundations "Info Dock"). Reads the |
| `KindGate.jsx` | 69 | the client half of the account-kind split. |
| `ConnectionsRack.jsx` | 68 | EXTERNAL CONNECTIONS, each with its explicit state (V.2 brief §11): Available · Requires approval · |
| `VerificationBadge.jsx` | 66 | THE CARD'S ASTERISK (V.2 brief §12). |
| `InfoDock.jsx` | 62 | THE INFO DOCK (V.2 Blueprint, owner, 17 Oct 2026, Foundations "Screen map" and the fixtures sketch, Figure 19). The |
| `Placements.jsx` | 62 | the ONE reading of placements the dock's strip and the Front Cover's block share (V.2 brief §1, 1 Oct 2026: |
| `OverviewPreview.jsx` | 56 | the ASILUM OVERVIEW card in search, cut to the primary reference (IMG_0999, V.2 brief, 1 Oct 2026): the |
| `PlaceCard.jsx` | 56 | THE PLACE CARD (V.2 Blueprint, owner, 17 Oct 2026, Foundations: "PLACE expands in place inside the Feed with a |
| `PostSelection.jsx` | 56 | POST SELECTION on the disc (V.2 Blueprint, owner, 17 Oct 2026: the six publishing types TRANSM · STILL · |
| `Icons.jsx` | 50 | the control center's glyphs. One stroke weight, one grid, no fills: the restraint of the secondary hardware |
| `MessagesSheet.jsx` | 46 | MESSAGES as a utility (V.2 brief, owner, 1 Oct 2026, §1 + §3). The live mail desk (MailDesk.jsx — inbox, |
| `SaveButton.jsx` | 44 | the one SAVE word (V.2). A word, per the button law: SAVE in the signal colour, SAVED in red once it |
| `SavePrompt.jsx` | 37 | the account moment (V.2). The brief: "Let visitors browse. Prompt account creation after a meaningful |
| `Notice.jsx` | 33 | ONE notice surface (synergy phase 1). The app had grown nine ad-hoc notice/error treatments; this is the house primitive |
| `PassportButton.jsx` | 33 | THE PASSPORT BUTTON (V.2 Blueprint, owner, 17 Oct 2026, Foundations "Screen map"; the globe at the top right |
| `TransmissionText.jsx` | 32 | One transmission's body, with #hashtags and @mentions as live links (owner directive, HANDOVER-2026-08-14 backlog 3). Every surface that |
| `GlassPane.jsx` | 30 | one pane of the app's liquid glass, for any page (owner, 9 Sep evening: "make sure you utilize liquid glass when |
| `OverviewSheet.jsx` | 22 | an entity overview opened INSIDE the one sheet (Back returns to the search with its query). The record and |
| `DiscoverTabs.jsx` | 21 | DISCOVER's inner row (V.2). One destination, three doors: the open index (SEARCH), the map (AROUND YOU), and the |
| `PageMast.jsx` | 20 | THE MASTHEAD, EVERYWHERE (owner, 9 Sep: "add more large title words overall to the whole website to match the |
| `Wordmark.jsx` | 20 | THE WORDMARK. It left the shell's header when the header left (V.2 Blueprint, owner, 17 Oct 2026: the top fixtures |
| `ModelTag.jsx` | 10 | the honest tag (V.2). MODEL: simulated in this build. SAMPLE: fixture content, credited. DEVICE: kept on this device only. CONNECTION REQUIRED: a real service |

### `app/cover/`
*3 files, 523 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 455 | FRONT COVER. The landing edition (owner amendment, July 25: seventh destination), rebuilt as a true magazine cover (owner refinement round, Aug 12) and |
| `ledger.js` | 43 | The FRONT COVER's system-ledger folio, as a pure function so it is testable without a browser (same reason /piece/[id]/handoff.js sits beside its page). |
| `layout.js` | 25 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/discover/`
*2 files, 691 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 666 | DISCOVER. The full site inventory across every source. Asterisk may route search and exploration through the user's Passport, but the user can pause that layer. |
| `layout.js` | 25 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/hotlist/`
*2 files, 593 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 568 | THE WIRE (owner overhaul, Aug 13; formerly EDITORIAL — the destination renamed by owner decree). |
| `layout.js` | 25 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/map/`
*1 file, 70 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 70 | MAP (V.2 brief, owner, 1 Oct 2026, §11). A root of its own — the Passport BRANCH's geographic face — distinct from the personal |

### `app/orders/`
*2 files, 311 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 292 | ORDERS & TICKETS. PURCHASE TICKETS are real database records from the third-party purchase assistant (/api/tickets): the source platform fulfills, ships, and tr |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/piece/[id]/`
*2 files, 154 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 132 | a STABLE, SHAREABLE URL for one piece. |
| `handoff.js` | 22 | the hand-off half of the stable piece URL. |

### `app/privacy/`
*1 file, 161 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 161 | PRIVACY POLICY. Constitution §7 launch dependency. Every claim below describes what the product ACTUALLY does today (no-faking rule applies to legal pages first |

### `app/profile/`
*2 files, 833 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 814 | PROFILE. Standard social format (owner order, Aug 12: Grailed × Twitter × MySpace, legibility first), rebuilt in liquid glass on 9 Sep (owner: "the |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/settings/`
*2 files, 535 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 516 | SETTINGS. The rack (owner order, Aug 12: old music-making software — numbered hardware modules, LEDs, engraved labels; every control a user needs to |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/stats/`
*2 files, 273 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 254 | Brain health dashboard: the ASTERISK hologram entity at reading size, interaction volume by action, graph/board/user counts, and the |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/store/[slug]/`
*1 file, 29 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 29 | The storefront is a public view of native catalog records, not a second seller site. Product depth still belongs to the shared `/?item=` surface; |

### `app/stylist/`
*2 files, 323 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 298 | THE STYLIST. Full generations: 5 base genres × 5 looks = 25 LOOKs, cut across sources, match floor 75 (of 99 — not a percentage), with a 30-day repeat memory |
| `layout.js` | 25 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/terms/`
*1 file, 190 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 190 | TERMS OF SERVICE. Constitution §7 launch dependency. Describes the product as it actually is: a discovery and routing service with external checkout plus a gate |

### `app/title-card/`
*1 file, 77 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 77 | the magazine's title card (owner-directed, 21 Aug; revised same day: "make it appear more like the 404 screen"). The card now |

### `app/u/[handle]/`
*1 file, 188 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 188 | a poster's public page (the identity chain, owner order Aug 13: every wire byline lands somewhere REAL). |

### `app/upload/`
*2 files, 579 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 560 | UPLOAD // TEACH ASTERISK (redesign/upload-station). A Pinterest-style moodboard station over the warped-in Paris map: |
| `layout.js` | 19 | Generated for route metadata only. The page itself is a client component and cannot export `metadata`, so the segment layout carries it. This renders its |

### `app/watchtower/`
*1 file, 38 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `page.js` | 38 | demand, in cohorts. Replaces DISCOVER for a business account (lib/nav.js). |

---

## `scripts/` — operational and measurement tooling

Nothing here runs in production. `measure-*` are the evaluation harnesses that
keep the engine honest; the rest are migration and maintenance commands.


### `scripts/`
*70 files, 8,903 lines*

| File | Lines | What it is |
| --- | ---: | --- |
| `measure-attribute-reading.mjs` | 482 | does the engine READ the attribute words in a query, or does it only disclose that it cannot? |
| `measure-replay.mjs` | 382 | declared-criteria measurement for r15: the offline replay harness calibration. |
| `verify-stripe-connect-storefront.mjs` | 352 | A destructive-but-reversible provider check for the native Storefront money path. It creates one real Stripe TEST direct charge on an EXISTING connected |
| `measure-distribution.mjs` | 301 | declared-criteria measurement for r23: DISTRIBUTIONAL HEALTH (audit #12). |
| `measure-noun-coverage.mjs` | 254 | before/after measurement for r8 (generic-noun coverage: knit → knitwear) and the GARMENT_CATEGORY |
| `v2-fixtures.mjs` | 238 | write the V.2 engine fixtures Codex renders from. |
| `measure-disciples.mjs` | 236 | declared-criteria measurement for r10: the fan-tribe study (11 curated culture records from the owner-supplied |
| `measure-tuning.mjs` | 226 | declared-criteria measurement for r16: bounded bridge self-tuning. Offline arms; the python 1000-bot stress |
| `measure-feed-chunks.mjs` | 225 | the chunk laws, composed and measured on the real seed catalog and the real assembler. Runs as a steward instrument |
| `measure-popularity-people.mjs` | 222 | the delta/epsilon counter battery. |
| `backfill-edge-contributors.mjs` | 221 | rebuild the gamma corroboration ledger from the canonical event history. |
| `measure-culture-guidance.mjs` | 219 | declared battery for the search-culture-guidance round (Aug 5, 2026). |
| `measure-vibe-sweep.mjs` | 208 | 1000-query cross-domain search sweep (Aug 5). |
| `check-deploy-drift.mjs` | 195 | Fails when `main` has moved ahead of what production is actually serving. |
| `restore-drill.mjs` | 183 | Rehearse the restore (owner directive, HANDOVER-2026-08-14 backlog 6). |
| `measure-slot-bias.mjs` | 182 | declared-criteria measurement for r24: server-stamped slot/zone on events (audit #27). |
| `measure-noise-stability.mjs` | 165 | declared-criteria measurement for r26: RESAMPLED NOISE FLOORS (audit #26). |
| `measure-vector-feed.mjs` | 162 | declared-criteria measurement for r18: catalog vectors into the feed (gamma sparse-graph fallback + reach |
| `backup-database.mjs` | 161 | Take a restorable backup of the ASILUM database (owner directive, HANDOVER-2026-08-14 backlog 6). |
| `measure-v2-gates.mjs` | 158 | the V.2 launch gates, composed and declared (docs/v2/CLAUDE-BACKEND-HANDOFF.md § Sunday order of work: "Measure |
| `steward.mjs` | 157 | "is anything wrong?", and since 3 Sep 2026, "fix it". |
| `measure-lexical-fidelity.mjs` | 155 | does the engine read the words a person actually types? |
| `measure-feed-rotation.mjs` | 150 | DOES A HEAVY SCROLLER SEE THE SAME PIECES AGAIN, AND WOULD A BIGGER MEMORY STOP IT? |
| `measure-assisted-interpretation.mjs` | 146 | the safety rails around a model-assisted read, measured before anyone turns one on. |
| `generate-code-map.mjs` | 144 | regenerate docs/CODE-MAP.md from the tree. |
| `verify-ebay.mjs` | 143 | prove the eBay path end to end the moment keys exist, and say plainly what is still missing when they do not. |
| `measure-evidence-hygiene.mjs` | 139 | does a served row's matchReason describe evidence the row actually carries? |
| `measure-match-floor.mjs` | 139 | is ruling 8's match floor still a real gate? |
| `measure-sweater.mjs` | 137 | declared-criteria measurement for r9: the sweater retest. r8's beanie guard rejected sweater → knitwear because |
| `check-deferred-triggers.mjs` | 128 | Answers, in one command, the question two handovers have carried by hand: have the deferred optimisations become worth doing yet? |
| `measure-identity-issuance.mjs` | 125 | the issuance lockout battery. |
| `audit-navigability.mjs` | 117 | measure how findable this codebase is. |
| `measure-search-honesty.mjs` | 113 | declared battery for the search-honesty round (Aug 5, 2026). |
| `measure-rerank.mjs` | 111 | A/B measurement for bounded semantic re-ranking (r5). Runs each probe through searchProducts twice (rerank off / |
| `measure-graph-corroboration.mjs` | 107 | the forged-edge battery (Aug 6). |
| `measure-composed-disclosure.mjs` | 106 | does the engine still say what it knows when a query carries TWO constraints instead of one? |
| `measure-tiebreak.mjs` | 105 | declared-criteria measurement for r7 semantic tie-breaking. OFF = r5+r6 shipped behavior, ON = + tie-break. |
| `measure-search-loop.mjs` | 102 | declared-criteria measurement for r17: the search→brain loop (an applied reading trains the feed). |
| `search-identity-snapshot.mjs` | 101 | WHAT SEARCH ANSWERS, serialized. |
| `measure-cultural-reach.mjs` | 99 | does a curated reading actually reach the reader, or does junk evidence shadow it? |
| `measure-ontology.mjs` | 94 | declared-criteria measurement for r13: the Fashionpedia-informed garment vocabulary (curated crosswalk, CC BY 4.0 |
| `measure-typo.mjs` | 92 | declared-criteria measurement for r12: the literal-engine typo bridge (fastest-levenshtein at interpretation time). |
| `measure-stems.mjs` | 91 | declared-criteria measurement for r11: the stem-indexed garment vocabulary (words/stemmer replaces the strip-s |
| `verify-stripe-e2e.mjs` | 90 | Proves the checkout engine end to end against REAL Stripe (test mode), with zero UI and zero database: refuses to run if DATABASE_URL is set, seeds one |
| `measure-attribution.mjs` | 88 | declared-criteria measurement for r14: bridge attribution instrumentation. The whole point of this round is that |
| `embed-catalog.mjs` | 82 | backfill text-v1 embeddings for the catalog (asterisk-boost r4). Requires EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY in |
| `measure-release-checks.mjs` | 78 | THE §14 RELEASE CHECKS, as far as a machine without a browser can take them (V.2 brief §14, Stage D). |
| `apply-schema.mjs` | 73 | Apply a SQL file to the database behind DATABASE_URL (.env.local or env). Usage: node scripts/apply-schema.mjs supabase/schema-v2.sql |
| `check-trend-freshness.mjs` | 69 | Fails scheduled CI before dated fashion claims silently become stale. Covers BOTH trend layers behind lib/asterisk/trends.js: the garment-level |
| `ebay-feed-worker.mjs` | 69 | the eBay feed worker (lib/ingest/ebayFeedWorker.js): bootstrap → daily catch-up → hourly snapshots, from a state file on |
| `measure-search-latency.mjs` | 62 | p50 / p95 of the search engine, in mem mode, over a fixed corpus (docs/v2/CLAUDE-BACKEND-HANDOFF.md asks for |
| `configure-database-role.mjs` | 61 | One-time local helper: activate the v11 asilum_app role with a strong secret. The owner URL and new password are read from the environment and never logged. |
| `build-vector-neighbors.mjs` | 58 | precompute item-item vector neighbors for the feed (r18). Reads the catalog embeddings (text-v1, the space the |
| `reconcile-storefront-payments.mjs` | 54 | Bounded native-Storefront payment reconciliation for an external cron. This worker intentionally ignores NATIVE_CHECKOUT_ENABLED so disabling new |
| `seed-mappings.mjs` | 52 | Idempotent: (1) upserts the curated search mappings into search_mappings, (2) backfills the typed product_tags layer + production source fields for |
| `comment-attachment.mjs` | 51 | did the split move code without its comment? |
| `seed-supabase.mjs` | 50 | Optional demo seeding after schema-v1 through schema-v10 have been applied. Upserts the synthetic catalog into items through the application DB path. |
| `publish-ebay-feed.mjs` | 45 | publish ONE staged feed directory into the catalog (lib/ingest/ebayFeedPublish.js), or plan the daily catch-up. |
| `compile-culture-research.mjs` | 42 | Compile APPROVED culture-entity proposals (learned_facts) into lib/asterisk/culture.research.json — the ONLY way research reaches the |
| `verify-listings.mjs` | 40 | run ASILUM's listing checks (V.2 brief §12) over listings whose current evidence version has no row yet, bounded. |
| `diag-rerank-sims.mjs` | 35 | one-off diagnostic for r5 tuning: what do voyage sims actually look like for the failing storm/hike probes, target |
| `extract-fashionpedia.mjs` | 35 | reproducible extraction of the Fashionpedia ontology (r13). Reads an official annotation file |
| `backfill-dense-tags.mjs` | 34 | Backfill dense per-piece tags (lib/tagging/dense.js) into product_tags. Idempotent: rows upsert on (product_id, tag, tag_type) with max-confidence |
| `listing-status.mjs` | 31 | one run of the ListingStatus service (lib/listing-status): re-check the listings people kept through the |
| `db-export-surface.mjs` | 29 | the public surface of lib/db/production.js. |
| `setup-wardrobe-storage.mjs` | 28 | create the PRIVATE "wardrobe" Storage bucket (idempotent). Run once per environment before enabling |
| `stage-ebay-feed.mjs` | 25 | _no header — tracked in docs/DEBT-REGISTER.md_ |
| `setup-dm-storage.mjs` | 17 | create (idempotently) the PRIVATE "dm" bucket for DM images (lib/dm/media.js). Needs NEXT_PUBLIC_SUPABASE_URL + |
| `dm-archive-sweep.mjs` | 16 | stamp archived_at on DM images past six calendar months (lib/db/dm/attachments.js archiveSweep). Nothing is |
| `setup-wire-storage.mjs` | 16 | create (idempotently) the public-read "wire" bucket for Wire images (lib/wire/media.js). Needs |

---

*Generated by `npm run docs:codemap` from main @ 6133121 — 549 source files, 94,710 lines. Do not edit this file by hand; edit `docs/code-map-preamble.md` or the source headers.*
