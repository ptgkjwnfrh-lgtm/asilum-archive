# *ASILUM

A fashion marketplace and discovery terminal, designed and built by Ebube
Ogokeh (EMO).

One Feed carries everything: pieces from the catalog and native storefronts,
posts (stills, motion, transmissions, BRDCST events), places and echoes,
packed by weight into a single stream. Underneath it, a six-bridge
personalization engine (content match, dominant trait, a co-engagement taste
graph, popularity, exploration and sponsored placement) ranks what each
passenger sees, learns from favourites, saves, shares, skips and dwell, and
explains itself through ASTERISK, a deterministic reading and memory layer
that is not a chatbot. The Passport holds a passenger's identity, taste and
the map of the places they have been; native commerce, the Wardrobe and
seller payouts run on Stripe; nothing is ever faked.

Next.js App Router, plain JavaScript, Postgres on Supabase, with an
in-memory fallback so the whole app runs with no database at all.

## Start here

**`docs/README.md` is the front door**: current state, how the codebase is
organized, and how work is done. Then `docs/CODE-MAP.md` for where every file
lives, and `CONSTITUTION.md` for the rules that govern what may be built.

| Command | What it tells you |
| --- | --- |
| `npm test` | the unit suite, about 1,950 tests (no database needed) |
| `npm run build` | production build |
| `npm run v2:check` | the V.2 gates, search latency and the feed's chunk laws |
| `npm run deploy:check` | whether production is actually serving `main` |
| `npm run steward` | read-only health checks against the live database |
| `npm run docs:codemap` | regenerate `docs/CODE-MAP.md` from the tree |

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

No database needed for local play — everything runs in memory (and resets on
restart).

## Deploy (persistence)

Apply the versioned files in `supabase/` in order using an owner/migration
connection. Schema v11 creates a non-login `asilum_app` runtime role with only
the DML privileges and role-scoped RLS policies the server needs. Activate it
without putting its password in git:

```bash
DATABASE_ADMIN_URL='<owner connection>' \
DATABASE_APP_PASSWORD='<32+ character random secret>' \
npm run db:configure-role
```

Then set production `DATABASE_URL` to the `asilum_app` transaction-pooler URL
(`asilum_app.<project-ref>` is the Supavisor username) and set
`DATABASE_EXPECTED_ROLE=asilum_app`. Do not deploy the owner URL or the role
setup password. Startup verifies both the role and schema version and refuses
an owner connection or partial migration. Without a database URL, learning
lives in process memory and is lost on restart — fine locally, wrong in
production.

## Ingesting real listings

`POST /api/ingest` pulls from **permitted sources only** (merchant/affiliate
feeds and official product APIs — never ToS-restricted retailers; see
`lib/ingest/sources.js`). Guard it by setting `INGEST_TOKEN` in the
environment, then:

```bash
curl -X POST https://<host>/api/ingest \
  -H "Authorization: Bearer <INGEST_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"merchantFeedUrl":"https://merchant.example/feed.json"}'
```

Wire that to a cron on the deploy platform for fresh inventory. The seed
catalog (915 items in `lib/ingest/catalog.json`) is used whenever the items
table is empty. `node scripts/fill-met-images.mjs` re-runs the Met open-access
enrichment (public-domain images + object links).

## Pages

The shell is three fixtures and no header: the Info Dock (likes, bag,
notices) at the top left, the Passport Button at the top right, and the
Central Control Deck (FEED, SEARCH, POST, MESSAGES, ACCOUNT) at the bottom,
with the ad ticker beneath it. Every secondary surface opens as a popup over
the page rather than a page of its own.

- `/`: the Feed. Pieces, posts, places and echoes in one packed stream; a
  piece opens its listing popup, a double tap floats it.
- `/board`: the Passport. The document, stamps, the map, the taste record.
- `/profile`, `/settings`, `/orders`: the account. Wardrobe, storefront,
  settings, tickets and receipts.
- `/map`: the local and global fashion map.
- `/discover`, `/stylist`, `/hotlist`, `/cover`: the open index, outfits
  built around a piece, the ten-booth hotlist, the front cover.
- `/u/[handle]`, `/piece/[id]`, `/store/[slug]`: a passenger, a piece, a
  storefront.
- `/analytics`, `/watchtower`: the business account's ledger.
- `/admin`, `/asterisk`, `/stats`: the operator desk and the brain's own
  instruments.
- API routes live under `app/api/`; `docs/CODE-MAP.md` lists every one.

## Stress test

```bash
npx next build && npx next start -p 3457 &
python3 tests/stress_test.py
```

1,000 simulated users across 10 taste archetypes; verifies personalization
convergence, taste-graph coherence, cross-account popularity transfer, board
taste transfer, archetype separation, and the zone mix.
