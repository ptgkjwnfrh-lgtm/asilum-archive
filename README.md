# asilum-brain

ASILUM — a fashion moodboard whose feed is ranked by a six-bridge
personalization engine: content match, dominant trait, co-engagement taste
graph (Pinterest-style), popularity, exploration, and sponsored. Feeds are
zoned — pieces you already like, pieces you'll *probably* like (taste expanded
one hop through the aesthetic-affinity matrix), and a couple of deliberate
far-reach explorers. It learns from favorites, board saves, shares, skips
(fast skips count double), and on-screen dwell time.

## New here? Start with the handover

**`docs/HANDOVER.md` is the front door** — current state, how work is done, and
what is open. Then `docs/CODE-MAP.md` for where every file lives, and
`CONSTITUTION.md` for the rules that govern what may be built.

| Command | What it tells you |
| --- | --- |
| `npm test` | the 1,299-test unit suite (no database needed) |
| `npm run build` | production build |
| `npm run deploy:check` | whether production is actually serving `main` |
| `npm run steward` | 12 read-only health checks against the live database |
| `npm run audit:nav` | navigability debt, measured |
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

## Pages & API

- `/` — HOME: the big masonry feed (minimal cards; full detail on click),
  infinite scroll, filters, community posts woven in. First visit offers a
  coming-soon account-link prompt (`POST /api/connect` returns an honest
  unavailable message until real OAuth adapters are wired), else the moodboard
  + following jump-start.
- `/hotlist` — EDITORIAL/HOTLIST: live ranking from the popularity counters.
- `/stylist` — THE STYLIST: full outfits (taste + coherence + fit-gated via
  the size brain); "STYLE IT ✂" on any piece anchors every look around it.
- `/board` — MOODBOARD: view/rename/prune boards; share links
  (`/?board=<id>`) seed the feed of whoever opens them; FOLLOW makes a board
  a standing influence on your feed (`POST /api/follow`).
- `/orders` — every add-to-bag event, shown as purchase/ticket history for the prototype.
- `/stats` — the living brain viz (learns white, forgets red) + what the
  brain has learned. Idle profiles fade on the clock (6-day half-life,
  `lib/brain/memory.js`).
- API: `GET /api/feed`, `POST /api/train`, `POST /api/interaction` (actions:
  bag/share/save/favorite/dwell/skip/hide), `GET|POST|PATCH|DELETE /api/boards`,
  `GET /api/related`, `GET /api/outfits`, `POST /api/connect`,
  `POST /api/follow`, `GET /api/orders`, `GET /api/profile`, `GET /api/stats`,
  `GET /api/ebay` (official Browse API; needs partnership approval and credentials),
  `POST /api/ingest`.

## Stress test

```bash
npx next build && npx next start -p 3457 &
python3 tests/stress_test.py
```

1,000 simulated users across 10 taste archetypes; verifies personalization
convergence, taste-graph coherence, cross-account popularity transfer, board
taste transfer, archetype separation, and the zone mix.
