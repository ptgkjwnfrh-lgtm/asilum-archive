# The optimize round — 20 September 2026

**Owner's word:** a five-hour round of brainstorming and optimizing the whole site, two lanes at once.

Branch `ops/optimize-round` from `main` at `4a31253`, draft PR #476. The client and provider lane ran on its own stacked branch; the two lanes coordinated through an append-only log and issue #472, claiming files before editing. Nothing here touches a component, a page, CSS, a provider adapter, a payment policy, the schema, `main` or a deployment. Merge is the owner's word.

## Method

Production named the targets. `pg_stat_statements` on the live database (role `asilum_app`, cumulative since 10 July) listed the costliest statements; the live search API, driven through the in-app browser, showed what the engine says to a reader on the real 897-listing catalog; the steward ran read-only against production before and after. Each slice removes one defect at its mechanism and pins it with a test that was run with the fix reverted and failed. The statement statistics were reset at 16:17 EDT after the capture, so the round has a before/after window; the pre-reset table is in the PR.

## The slices

### 1. The dead vectors

The second-costliest statement in production was the embedding snapshot — 444 calls, 258 ms mean, 907 rows each — and every one of those rows belonged to the seed catalog deleted on 12 September. 915 orphan vectors, 0 for the 897 live listings. With the provider keyed (the live search reports `semantic.engaged: true`), every keyed search on every instance loaded ~6 MB of JSONB, paid the provider for a query vector, and cosined it against nothing. In the post-reset window, 24 probe searches cost 1.56 s of database time and two cold instances loading the dead vectors were 702 ms of it — 45%.

Product vectors now read through the `items` table in both backends (mem: the map; Postgres: a JOIN); search asks the provider only when the snapshot has rows; the steward's `data.embedding-coverage` says how many live vectors cover how many items, how many are dead, and — a WARN — when a keyed provider has nothing to compare against. `EMBEDDINGS_*` is read where the steward runs, and the evidence says so.

### 2. The neighbour scan is a snapshot

`similarUsers` scanned every profile on every personalised feed request and every `/api/similar` call: 520 calls, 45 ms mean, ~400 rows. The vectors it scans are other people's long-term taste, slow by construction (the decay laws), so a frozen per-instance snapshot with a 30-second TTL ranks the same neighbours. It is deliberately not invalidated by profile writes — the feed instance is also the writer, and a write-invalidated cache would exist on paper only. The reader's own vector is still read fresh through `getProfile`, so their newest action reaches their own feed at once. T4 pins the wiring.

### 3. A word the engine owns is not a name

On the live catalog, bare "black" was a brand query: one listing's brand field says "Black" (its title is a Stone Island jacket), and the rack of 261 opened on it under "reading "black" as the designer …". Bare "leather" resolved to the single listing branded "casablanca leather" through the whole-word partial rule — 1 result, with ~100 leather pieces in stock, and a note reading "leather" as the designer Wilson's Leather. Marketplace brand fields are free text.

`lib/search/ordinary.js` is the houses register's `kb: false` law for brand fields: a bare colour, material, gender or garment word — looked up in the engine's own lists, never guessed — is a description, whatever a brand field says. Intent reads it before exact, partial, short-form or spelling resolution; ranking pays no "brand match" for it and reads no house from it; a brand whose whole name is an ordinary word is never a house for any token. Multi-token queries keep the disclosed partial reading ("green jacket" → Craig Green, said out loud). Two demo-catalog tests that pinned bare "green" as Craig Green's rack were changed on purpose: a bare colour is a colour now.

### 4. Who a piece is cut for is read, not defaulted

`lib/ingest/ebay.js` records `size.gender = "unisex"` on every eBay row — 839 of 897 in production — while 72 titles say women's and 110 say men's. The gender constraint let every "unisex" row through, so "womens under 200" (a query a real reader typed, 22 August) answered with 513 pieces led by a jacket whose own title says "Mens".

`lib/search/gender.js`: an explicit mens/womens on the record wins; then the seller's title (women's, womens, ladies, femme; men's, mens, homme — never inside "women's"; a title naming both decides nothing); unisex is kept only when the title says nothing; silence passes, because absent data must never over-filter. The three gender predicates read through one function. With a gender asked, a piece that says it is cut for it earns a little more, and the constraint-only rack orders the pieces that say so before the pieces that do not. The adapter default itself belongs to the client lane and is noted there.

### 5. A paid call is an event

The chat/vision adapter has written every attempt to `ai_model_events` since it existed; the embedding provider never did. Production paid one embedding call per keyed search for weeks and the steward's model-seam check read "no model events in 30 days — the seam is off or unused". `embedText` / `embedTexts` now record feature (`search.embed`, `catalog.embed`), provider, model, input and output shape, latency, and status ok|error with the reason; a memo hit is not a call and writes no row; the ledger can never take the search down. The file also held a literal NUL byte as the catalog-hash separator, which made git treat it as binary and grep skip it; it is the backslash-u0000 escape now, and the hash is byte-identical.

### 6. The reading goes on record

The search log kept four fields of the interpretation and none of the answer, so the steward could count empty searches but never explain them: "6 of 96 returned nothing" blamed the cultural fallback for three prefix fragments ("lov", "dol", "ba"), an unknown house ("telfar") and a contradiction ("under $500 over $900") alike. The log now carries the note, the unmatched tokens, the typo corrections, whether the semantic and cultural tiers engaged, the constraint labels that applied, and — for an empty rack — the engine's own reason: fragment, pair-miss, constraint-conflict, constraint-miss, unknown-words, other. The steward groups the empties by reason; an explained empty share is honest and never warns; the culture-fallback action fires only for unexplained empties.

### 7. A shoe size is a shoe size

On the live catalog, "boots size 42" read 42 as a waist and answered "nothing with a 42 waist in footwear"; "boots size 9" read no size at all, because 9 is below the waist floor. The sellers label footwear "8", "9.5", "EU 45", "US10.5=UK9.5=EUR44=27CM" and "38.5,39,40,…,45". When the query names footwear, "size N" now reads as a shoe size — the US ladder up to 16, the EU ladder from 35 to 50, or whichever marker the reader typed — and matches the label as printed: a bare number is the US ladder, an EU number needs its marker or a seller's list. No conversion table. A miss lists the shoe sizes that are here. Outside footwear the old readings stand.

### 8. A grammar word is never what the rack is showing instead

Live, "dolce and gabana" said "showing dolce and instead" and "love and basket" said "showing and instead": the words a note claims to show were the tokens that had not been reported unmatched, and grammar was never reported. Stopwords now leave the shown words. Not fixed, recorded for the next round: the compositional read behind those racks — 861 and 895 pieces from a house or phrase the brain recognised — should say what it read, the way the cultural tier does ("read as blade runner — neon noir").

## Gates on the branch head

`npm test` green on every commit (1,546 → 1,574 tests, 0 fail); `npm run build` green; `npm run v2:check` PASS; `search:snapshot` byte-identical to `main` on every commit (35 identity queries); every new test run with its fix reverted and seen to fail. Steward against production before the round: 0 blocker / 0 warn / 2 note / 14 ok (the new coverage check is one of the notes).

## Production measurements (the in-app browser against www.asilummagazine.com, 20 Sep)

| Route | Warm latency | Notes |
|---|---|---|
| `/api/search` | 250–420 ms (1,279 ms cold) | `semantic.engaged: true` on every keyed search — the provider call and the dead-vector load are inside this number |
| `/api/discover?limit=24` | 348 ms | |
| `/api/feed?limit=24` | 186–381 ms | |

After merge, search should lose the provider round-trip and the vector load entirely until the catalog is embedded.

## For the owner — rulings, in order of consequence

1. **The eBay storage conflict (found in review).** The 897 durable eBay rows in production were written on 12 September by scripts on branch `market/ebay-catalog-ingest` (commit `cc4ae58`, PR #467), which is not on `main`; `main`'s `SOURCE_POLICIES["ebay-browse"]` and `docs/RIGHTS-REGISTER.md` still say live-only, storage denied, ranking denied. Production data and the policy on `main` disagree. Neither agent changed either side. Your ruling: update the rights grant, or take durable eBay inventory out of ranked storage. The other lane committed a pure eligibility verdict, unwired, for whichever you choose.
2. **The 897 listings are eight days stale** (last sync 12 Sep 05:52 UTC), every one still marked available, and no availability check has ever run. A sold listing shown as buyable is the fake the constitution forbids. Provider lane; blocked on ruling 1.
3. **Embed the live catalog, or unkey the provider.** The semantic tier is keyed and silent. `node scripts/embed-catalog.mjs` embeds the 897 listings — a paid provider call per batch, cents in total — and the steward will show the coverage. Your word.
4. **Delete the 915 dead vectors.** They no longer load; the steward names the statement. Your word.
5. **The stacked branch carries migrations v54 and v55 with a startup requirement.** Production deploys from `main` on merge; apply v54 then v55 to production and verify the ledger BEFORE merging that branch, or the app refuses to boot. The other lane's PR says so in its PR.

## Not done

The `lib/search/index.js` split (1,800 lines): the hot path measured fine (p50 7 ms in mem, the production cost was the provider call and the vectors), so the risk of a split bought nothing this round. The seven unindexed foreign keys the Supabase advisor names sit on tables with 0–3 rows. The two permissive RLS policies on `user_profiles` are a schema change for another round.
