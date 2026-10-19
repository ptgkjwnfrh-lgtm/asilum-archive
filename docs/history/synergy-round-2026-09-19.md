# The synergy round — 19 September 2026

**Owner's word:** "work for 4 hours under your own judgment, optimize app synergy and operation streamlining in the ai and all systems." Branch `ops/synergy-round` from `main` at `8b79b28`, draft PR #474. Merge is the owner's word; nothing here touches a provider, a payment policy, `main` or a deployment.

The round's question was: where do two systems answer the same question differently, and where does a system act without saying which law it acted under? Each commit closes one such gap and pins it with a test.

## 1. One taste

Search added `long + session` 1:1 and unclamped; the feed, the taste network and the Asterisk memory read `tasteVector` (60/40, clamped to ±1). A reason-specific correction therefore landed differently on the rack than in the feed, and a hot session outweighed a year of taste in search alone. Search now reads the same vector. The 28-query identity snapshot is byte-identical to `main` (personalisation is a tiebreak). `SEARCH_TASTE_BLEND=0` restores the sum.

## 2. Decay by evidence class

One 6-day half-life governed everything, so a tag the reader chose on the taste network faded exactly like an inferred one, and the session vector outlived a week away. Now: an explicit choice (`_meta.manual`) never fades and is never logged as forgotten; inferred long taste keeps 6 days; the session vector fades in a day. `BRAIN_DECAY_BY_CLASS=0` restores one half-life. A **reduce** on the network is recorded like keep and explore, the network says "you reduced this on …", and one undo takes it back.

## 3. The systems name what applies now

- The memory facade carries `explicit.lanes` — the price ceiling and fit hints a reader's corrections hold open — and `policyVersion` (`lib/brain/policy.js`). Feed, search, taste-network and correction events carry the same version.
- `/api/taste` GET carries the lanes beside the nodes, from the same source the feed reads.
- `/api/why` accepts an optional `serveId`, so a correction can name the impression it answers; the event carries it.
- `/api/search` pages by the same signed cursor as `/api/discover` (`limit` 1..96, `nextCursor`, `snapshotId`, 409 `stale_cursor`).
- One overview path: the legacy person records (Olivier Rousteing) reach the client in the contract `Entity` shape through `resolveOverviewForQuery`, with the registry's tenure riding along.
- A house entity carries `origin` from the table the search engine reads for "japanese coat", so an overview and a search never disagree about a country.

## 4. The registry covers the catalog

The career registry grew from 42 to 105 entities, 48 to 89 dated edges, 68 to 143 sources. Every designer the catalog credits now has a sourced overview and at least one dated tenure — pinned by a test that walks the catalog's `designers[]`. Unknown dates stay null (13 recorded gaps). Vogue remains an open owner item: its domains refuse both the crawler and the in-app browser.

## 5. Gates, not dashboards

- `npm run v2:gates` — the launch gates the handoff asked for, composed end to end in mem mode with thresholds declared before the run: pair violations 0, pair precision 1 over eleven probes, cursor duplicates + skips 0 over full walks, sourced claims 1, fit abstention 1, empty-vs-unavailable 1, latency. PASS on this branch; the suite runs it too.
- `npm run search:latency` — p50 / p95 / max with declared thresholds (60 / 250 / 800 ms). Baseline p50 7.5 · p95 10.8 · max 11.8 ms over 120 samples.
- `npm run v2:check` — gates, latency and the feed chunk laws in one command.
- A fixture drift guard: the committed `docs/v2/fixtures` must have the keys the routes produce today.

## 6. The steward sees the new surfaces

Three read-only checks with never-tier boundary entries: `data.user-records` (payload and per-kind caps), `brain.correction-lanes` (codes and the undo share over 30 days), `ai.model-events` (calls by feature and status, failure share). Run read-only against production on 19 Sep: 15 of 15 ok.

## 7. Paperwork that was lying

`docs/FEATURE-FLAGS.md` now registers the brain and search kill switches it was missing. `docs/engineering/architecture.md` says v53 and warns to read `app_schema_migrations` on the live database before numbering a migration (v51 and v52 were taken by branches not on main; this round's predecessor collided with them).

## Verification

`npm test` and `npm run build` green on every commit; `search:snapshot` identical to main; `feed:chunks` 0 defects; `feed:rotation` unchanged; `search:honesty` 15/15; `v2:gates` PASS; steward 15/15 ok against production.

## Not done, with an owner

- Vogue-sourced prose (domain blocked; owner allows the domain or supplies URLs).
- The DM two-account demonstration on the authorized database (CI covers the laws; a live demo needs `MESSAGING_ENABLED=1` and two accounts).
- Client follow-ups (typed `error` object, `fitHints` into the card fit profile, the records client in the correction and draft writers, the lanes on FULL READ).
