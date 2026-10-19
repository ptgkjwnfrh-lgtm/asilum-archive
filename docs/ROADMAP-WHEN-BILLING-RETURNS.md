# ROADMAP — the moment billing returns

**Written 27 August 2026, while CI is dead on billing.** This is the file to
open first when it comes back. Everything here is ordered so work can start at
the top and go down without stopping to decide anything.

---

## 0. THE LAW

Owner directive, 27 August 2026. **This supersedes `CONSTITUTION.md` where they
disagree.** Two rules govern everything below.

### 1. ASTERISK does not guess

Every reading ASTERISK produces must trace to one of exactly three things:

| Source | What it means |
| --- | --- |
| **The ASILUM archive** | Our own catalog, tags, edges, events — data we hold |
| **A real internet source** | A cited, fetchable URL. Not a recollection |
| **Archivalist training** | A human with expertise wrote it down and signed it |

A reading with no traceable basis is not shipped weak — **it is not shipped**.
Confidence is *earned from the evidence*, never asserted alongside it. This is
already how `lib/asterisk/confidence.js` works, and that module is now the
pattern for everything new: four separate values, never averaged into one
impressive number, and `1.0` reserved for literally nothing.

### 3. Invisible machinery (added 27 August 2026)

A complex system **does its work without being asked and never names the
mechanism** — no control, no jargon, no empty state. Silence is the correct
output of low confidence, not a caveat.

The moat: a competitor can copy a button in an afternoon because the label
tells them what to build. They cannot copy a capability with no control
attached, because the hard part is the JUDGEMENT about when to speak. Full law
and the four design questions: `docs/INVISIBLE-MACHINERY.md`. Reference
implementation: stamp recognition (§4.4 of that file).

### 2. ASTERISK is an operating system, not a chatbot

**There is no conversational surface. Ever.** No "ask ASTERISK" box, no chat
thread, no assistant persona, no free-text prompt that returns free-text prose.

It expresses itself the way an OS does — by *doing things* the reader can see:

- **reads** a query into constraints (`lib/search`)
- **routes** a person to a shelf (feed zones, rails, racks)
- **ranks** with a stated reason on every result (`matchReason`)
- **remembers**, and shows the person exactly what it holds (`/asterisk`)
- **discloses** when it is uncertain, and says which of the four confidences is low

If a feature below would be easiest as a chat, it is being designed wrong.
Find the OS surface for it.

---

## 1. ✅ DONE, 3 September — the backlog is empty

All six PRs merged, each green through the full Postgres suite. v49 applied and
verified in production. See `docs/history/WORK-IN-FLIGHT.md` for what landed and the
two things the merge taught about stacked PRs.

### The original plan, kept for the record

Four PRs are stacked and green locally, blocked only on CI.

| # | PR | Merge order |
| --- | --- | --- |
| 1 | [#416](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/416) navigation docs (CODE-MAP, HANDOVER, DEBT-REGISTER) | first |
| 2 | [#417](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/417) labelling — 100% headers, 86.8% exports | second |
| 3 | [#418](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/418) culture + search splits | third |
| 4 | [#415](https://github.com/ptgkjwnfrh-lgtm/asilum/pull/415) tag vocabulary + schema v49 | independent of the above |
| 5 | `fix/the-mail-desk-could-never-sign-in` | **highest urgency — see §2** |

```bash
gh pr checks <n> --watch --fail-fast && gh pr merge <n>
npm run deploy:check     # production must land on the new main
```

## 2. FIRST DAY — confirm the thing that has never worked

**Messaging has been live and inert.** Every DM call answered 401 for every
user because `MailDesk.jsx` never sent a bearer token. Fixed on the branch
above; **not yet confirmed end to end.**

- [ ] Sign in as a real account. Open the mail desk. Confirm the inbox loads.
- [ ] Send a message between two real accounts. Confirm it arrives.
- [ ] Accept a request, block, unblock, react, unsend, mute — each once.
- [ ] **Confirm an age assertion is now recorded.** `SELECT count(*) FROM account_ages;`
      It should have been non-zero for months and is not.
- [ ] **Confirm a business signup files as a business.** `SELECT kind, count(*) FROM account_kinds GROUP BY kind;`
- [ ] Backfill: every existing account is missing its age assertion. Decide —
      re-prompt at next sign-in, or accept the gap and record the decision.

> **The lesson worth keeping.** Production was verified as *"401 not 404"*,
> which only ever proved a feature flag was on. Never accept a status code as
> proof that a feature works. `tests/authenticated-wiring.test.js` now asks the
> real question of every call in `app/`.

## 3. FIRST WEEK — the held database work

`lib/db` is **7,932 lines across three files and 116 unlabelled functions** —
the largest single block of debt, held all month because only the 72-test
Postgres suite can verify it and only CI can run that.

- [ ] Split `lib/db/production.js` (4,461) by table group: `products`, `tags`,
      `tickets`, `identity`, `measurements`, `brands`
- [ ] Split `lib/db/dm.js` (1,747) and `lib/db/index.js` (1,724)
- [ ] **Label as you go** — do not label first and split later, that touches
      every function twice
- [ ] Use the identity-proof discipline: serialize before, refactor, serialize
      after, diff. `npm run search:snapshot` is the pattern
- [ ] Then decompose `searchProducts` (1,283 lines) — the last oversized file

> **Read this before starting.** During the search split, a green unit suite
> **and** a 35-query identity corpus both reported the extraction inert while
> it carried a `ReferenceError` on a live path. Only the suite caught it. In
> `lib/db` the equivalent depth is the Postgres suite — which is exactly why
> this waited.

---

## 4. THE SWAGSEARCH BUILD

### 4.1 What SwagSearch actually is

Observed from the live site, 27 Aug 2026. It is an **arbitrage scanner**: find
underpriced Japanese archive listings before the market, buy through a proxy,
resell on Grailed at 3–8x. $25/month, free trial, Discord community.

| # | System | What it does |
| --- | --- | --- |
| 1 | **Multi-marketplace ingestion** | Yahoo Japan Auctions, Mercari Japan, Rakuma — 115,000+ listings, continuous |
| 2 | **JP↔EN identity resolution** | Listings are Japanese (`ディオール` = Dior, `プラダ` = Prada). Matching them to a curated brand list is the hard part |
| 3 | **Price intelligence** | "Underpriced" implies a market comparable per piece, plus JPY→USD |
| 4 | **Reverse image search** | ✅ **BUILT, invisibly, both directions** — a stamp uploaded to a passport is recognised, and a listing says where else its photograph appears. No control either way |
| 5 | **Proxy deep links** | ZenMarket + Buyee links built into every listing |
| 6 | **Sub-60s alerting** | ✅ **ENGINE BUILT** as waiting — see `docs/WAITING.md`. No alert to configure: a want is an empty search you already made |
| 7 | **Dashboard + filters** | ✅ **BUILT, inverted** — no filter controls; the sentence carries the constraints, and `lib/search/constraints.js` shows them back and releases one |
| 8 | **Curated brand watch** | CDG, Number Nine, Yohji, Issey, Raf, Undercover + 30 more |
| 9 | **Weekly digest** | Declared channel. Sends what ARRIVED, and does not send when nothing did |

### 4.2 What ASILUM already owns

**Most of the skeleton is built.** This is much closer than it looks.

| SwagSearch system | ASILUM today | Gap |
| --- | --- | --- |
| Ingestion | `lib/ingest/adapters/` — the adapter pattern, `syncProducts`, sync logs | Three JP adapters |
| Brand resolution | `lib/search/intent.js` `resolveBrandSpelling`, `lib/asterisk/houses.js` | **Japanese script handling** |
| Price band | `lib/tagging/dense.js` `priceBand` | Market comparables, FX |
| Reverse image | ✅ **done both ways** — `lib/vision/stampReading.js` + `lib/vision/sameShot.js` | True visual similarity, which needs `embedImage` |
| Proxy links | `purchase_tickets`, `refusalReason`, booth attribution | Proxy URL builder |
| Alerting | ✅ `lib/waiting/` — wants, answering, channel registry | The off-platform channels |
| Dashboard/filters | ✅ done — constraints read from the sentence, shown back, releasable | Surfacing on more than `/discover` |
| Curated watch | `lib/asterisk/culture.js`, the designer register | Watchlist model |

### 4.3 The ingestion problem, stated honestly

**Mercari and Rakuma have no public API.** Yahoo! JAPAN Auctions' API is
restricted. SwagSearch is near-certainly scraping or using reverse-engineered
endpoints.

Two facts, and they are not ASILUM's rules to waive:

1. **Their ToS is their ToS.** Scraping exposure exists whether or not we keep
   a policy document. SwagSearch is a $25/month tool with a Discord; ASILUM is
   trying to be a licensable platform with real merchant agreements. The two
   carry very different downside.
2. **Rule #1 makes it worse.** ASTERISK may only reason from data we can point
   at. Data we cannot lawfully hold is data we cannot point at.

### 4.4 The move: THE PROXY IS THE DATA SOURCE

**This is the key insight of the whole plan.**

Buyee (Tenso Co.) and ZenMarket already aggregate **exactly** the three
marketplaces SwagSearch monitors. They already handle purchase, consolidation,
customs and international shipping. They already run affiliate programmes that
pay commission.

So one licensed integration delivers, in a single stroke:

- ✅ **Ingestion** — the same Yahoo/Mercari/Rakuma inventory, licensed
- ✅ **The proxy dilemma** — solved, because they *are* the proxy
- ✅ **Monetization** — affiliate commission instead of a $25 subscription
- ✅ **Rule #1** — data we can point at

That is strictly better than what SwagSearch does, and defensible to a partner,
a merchant, and a lawyer.

- [ ] Apply to **Buyee affiliate** and **ZenMarket affiliate**; get feed access
      terms in writing (display, caching, source labelling, aggregation)
- [ ] Add rows to `docs/RIGHTS-REGISTER.md` — one per source, with kill switch
- [ ] Build `lib/ingest/adapters/buyeeAdapter.js` on the existing interface
      (`getSourceName`, `enabled`, `fetchProducts`)
- [ ] Gate: `BUYEE_AFFILIATE_APPROVED=1` — the same pattern as eBay/WooCommerce
- [ ] Fall back: Yahoo! JAPAN official Shopping API, Rakuten Web Service
      (Rakuten owns Rakuma) as direct licensed channels

### 4.5 ✅ BUILT — Japanese ↔ English identity resolution

`lib/ingest/japan/` reads a listing title into facets — houses, garments,
materials, condition grades, departments — plus the seller's colour claim and
any authenticity claim, and reports every katakana run it could NOT read to an
archivalist queue ordered by frequency.

It never guesses: no transliteration, no fuzzy brand match, no model. Full
spec and the finishing procedure: **`docs/JAPAN-INGESTION.md`**.

The FETCH is what remains, and it is blocked on a Buyee/ZenMarket agreement
rather than on code. Both adapters are registered and honestly disabled.

### 4.5b The original design notes

This is the piece with the most depth, and the best ASTERISK training ground.

- [ ] Extend `lib/search/text.js` — kana/kanji/romaji folding beside accent-folding
- [ ] Brand register gains a Japanese name set: `ディオール`→Dior,
      `メゾンマルジェラ`→Margiela, `ヨウジヤマモト`→Yohji
- [ ] Condition grades are a Japanese retail vocabulary — `Aランク`, `美品`,
      `中古`, `新品未使用` — map to the `condition` facet in
      `lib/tagging/vocabulary.js`
- [ ] Size systems: JP sizing already partly handled in `lib/brain/sizing.js`
      (`JP_MENS`) — extend
- [ ] **Archivalist surface**: a review queue where a human confirms or
      corrects each JP→EN mapping. That is rule #1's "trained via ASILUM
      archivalists", and it is the same shape as
      `lib/asterisk/unknownQueries.js` — which already exists

### 4.5c ⚠️ PAGINATION — a precondition of ingestion, not a separate task

**Measured 27 August 2026.** Nothing is broken today. It breaks the day
continuous ingestion runs, which is why it sits here rather than in a backlog.

Three surfaces, three strategies, and **only the DM inbox uses cursors**:

| Surface | Today | Stable while |
| --- | --- | --- |
| Feed | No pagination at all — reissues the same URL, relies on seen-state rotation | always (it is a feed) |
| Search | `offset` — `ranked.slice(offset, offset + limit)` | the pool is static |
| Discover | `offset`, capped at 10,000 | the pool is static |
| DM inbox | **keyset cursor**, with a `snapshot` component | — |

**Why it holds today:** two identical search calls return identical pages with
zero overlap, and `getDiscoverablePool` caches for 15s, so a reader scrolling
quickly sees a consistent pool.

**Why ingestion breaks it:** offset over a re-ranked list is only stable while
the pool does not move. At SwagSearch-like volume — 115k listings, continuous —
the pool changes *between* page 1 and page 2, and offset silently skips and
duplicates. Tagging pushes the same way: a backfill that adds a tag changes an
item's rank, shifting its position under a reader mid-scroll.

- [ ] **Before ingestion goes live at volume**, move `/api/search` and
      `/api/discover` to keyset pagination
- [ ] `lib/dm.js` `encodeCursor`/`decodeCursor` is the in-house model — copy the
      **snapshot component**, which is what stops rows that become active
      mid-scroll from jumping above the cursor
- [ ] The cursor's shape depends on the sort key, so **decide the sort first**:
      recency for a marketplace feed, score for search. Designing the cursor
      before that decision is wasted work

### 4.5d Two feed issues that cursors do NOT fix

Filed separately on purpose. They exist **today**, they are unrelated to
ingestion, and grouping them under "pagination" would bury them.

- [x] ~~**`SEEN_CAP = 200`** is a hard ceiling on feed rotation.~~ **MEASURED
      AND FIXED, 6 September.** The entry read "past ~200 pieces served, the
      oldest fall out and can reappear — a heavy scroller loops." Measured
      (`npm run feed:rotation`) it was much worse: the reader was **confined to
      286 of 915 items permanently**, and never shown the other two thirds
      however long they scrolled. Reach scaled almost linearly with the cap —
      200→286, 400→482, 800→864, 1000→all 915 — so rotation memory is not a
      threshold, it is **the size of the reader's world**.

      `seen` is a score PENALTY (0.3×), not an exclusion, so once every
      remembered item carries it the engine serves the next best 60, those
      enter memory, 60 fall out with the penalty lifted, and the feed
      oscillates over one taste-shaped neighbourhood forever.

      Fixed by sizing the ring from the caller: `app/api/feed/route.js` passes
      the size of the pool it just served. Remembering as many ids as there are
      items in the pool is exactly enough and needs no fitted constant. The
      reader now reaches **915/915**. Also de-duped (a repeated id used to
      occupy two slots) and bounded by BYTES as well as count, because the
      profile has a 256 KiB limit that throws and a marketplace id is five
      times a synthetic one.

      Account adoption carried its own copy of the `200` and would have thrown
      most of the memory away at sign-in, silently. It imports the constant now
      (`tests/adoption-merge.test.js`).

      **Measured against production, 6 September** (read-only query), so the
      storage cost is a number rather than a worry:

      | | before | after, worst case |
      | --- | ---: | ---: |
      | catalog | 915 items, ids 8 chars | unchanged |
      | `seen` per profile | 200 ids ≈ 2 KB | 915 ids ≈ 10 KB |
      | largest profile | 4,909 B | ~14 KB |
      | all 4,158 profiles | 5.0 MB | under 60 MB if every one maxed |

      Most profiles are cold and will never approach it. The 48 KB byte budget
      does not bind at all at this id length — it exists for the ingested
      catalog, where ids are five times longer.

      **`max(jsonb_array_length(seen))` in production was exactly 200**, which
      is the confirmation that this was not a theoretical defect: real readers
      were sitting on the ceiling.

      **Still open, and this is the part ingestion needs:** the byte budget
      caps the ring at a few thousand ids. A 100k-item catalog will exceed it
      and the ceiling returns. A served-ledger table with a time window, or a
      bloom filter, is the answer there — not a bigger number.
- [x] ~~**Feed rotation mutates shared state.** Two tabs, or a double-fire,
      both write `_meta.seen` and can serve overlapping sets. Nothing guards
      it.~~ **This entry was wrong when it was written** (3 September). The
      feed route's only profile write goes through `mutateProfile`, which has
      taken a `pg_advisory_xact_lock` and a `SELECT … FOR UPDATE` since 14 July
      (#18), and re-reads inside the transaction. There are no `saveProfile`
      callers outside `lib/db/`. Lost updates are not possible.

      What IS possible, and is a different and much smaller thing: two feed
      requests can both READ the same rotation memory before either writes, and
      serve overlapping items. The read is outside the transaction and only the
      write is inside. Two tabs opened together see some of the same pieces
      once. Not filed as work — the fix is holding the lock across a whole feed
      build, which costs more than the wart.

### 4.6 Price intelligence — no guessing

"Underpriced" is a claim. Under rule #1 it needs evidence.

- [ ] Comparable model: same brand + garment + era + condition, from **our own
      sold/seen history**. Never an invented "market value"
- [ ] State the basis: *"below the 12 comparable Yohji trousers we hold"*, with
      n and spread. Never a bare number
- [ ] `n < 3` → **say nothing**. Refuse the reading rather than weaken it
- [ ] FX: real rate, timestamped, source named

### 4.7 What we will NOT copy

- ❌ **Discord as the product.** ASILUM is the OS. Alerts belong on-platform.
- ❌ **"Resell at 3–8x" framing.** That is a flipper tool. ASILUM is a magazine
      and a wardrobe. Same pipe, different promise.
- ❌ **Scraping.**

---

## 5. TAOBAO — a separate path, and a conflict to resolve

Taobao is **not** the same problem as Japan and should not share a pipeline.

- [ ] **Alibaba/Taobao Open Platform** affiliate API is the licensed route
- [ ] Agent-proxy partners (Superbuy, CSSBuy, Sugargoo) are the practical path
      most buyers already use
- [ ] Shipping/customs differ from Japan — line consolidation, longer lead times

> ### ✅ RULED, 27 August 2026 — position 2
>
> *"taobao is unverified-origin, label everything, dont hide it."*
>
> Marketplace stock is **ingested and labelled**, never hidden. Built and
> shipped ahead of the pipeline, because ASILUM already carried unlabelled
> unverified inventory: `lib/provenance.js`, stamped onto every public payload,
> rendered on all nine product surfaces, pinned by `tests/provenance.test.js`.
>
> The load-bearing part: on an unverified piece **the brand is a CLAIM**, not a
> fact. That is ASTERISK's first law at the catalog boundary — it may not reason
> from a word it cannot back. And **verification is earned**: an unregistered
> source defaults to unverified, because the failure mode of guessing the other
> way is telling a reader something is genuine when nobody checked.
>
> **Both halves now ruled.** Unverified stock **ranks the same** — the sticker
> is the whole intervention, and the tests assert ranking cannot even see the
> provenance fields. The sticker's weight scales with what is riding on the
> claim (`stakeOf`), because verification matters in proportion to how much of
> the price rests on an unchecked name.
>
> §4.6's comparables model is now load-bearing for a second reason: it is what
> turns "expensive" into "expensive *relative to what would justify it*", which
> is the comparison the owner actually described. Until then `stakeOf` uses
> absolute price and says so.
>
> Recorded in `docs/OWNER-DECISIONS.md` §11.

## 6. THE AUTHENTICITY SYSTEM

### 6.1 What cannot be done, stated plainly

**"Clone a preexisting AI rep checker" is not available**, and it is worth
knowing exactly why:

- **Entrupy** — proprietary, and requires a specialised microscope camera.
  The hardware *is* the product
- **CheckCheck / LegitGrails** — human expert networks with proprietary models
- None publish weights, datasets, or methods

More importantly: **your own rule #1 forbids the thing a cloned checker would
do.** A model that outputs "authentic — 94%" from a phone photo is guessing,
and it is guessing about a purchase, where being wrong costs a reader real
money and costs ASILUM real liability.

### 6.2 ✅ BUILT — the evidence engine

`lib/authenticity/evidence.js` ships with the frame complete and one real
signal (`image-reuse`) running. Four more are **declared and unbuilt**, so they
report honestly as "not checked" today and each is one function away.

Full spec, including the add-a-signal procedure: **`docs/AUTHENTICITY-EVIDENCE.md`**.

It is invisible by the third law: no control, evidence rides the request that
already fires when a piece opens, and it is silent below the stake threshold.

### 6.3 The original design notes

Not a verdict machine. **It never says "authentic".** It reports what was
checked, what was found, and what it could not see — which is exactly the
posture `lib/asterisk/confidence.js` already takes.

| Signal | Basis | Already built? |
| --- | --- | --- |
| **Image reuse** | dhash against listings + known stock photography | ✅ `lib/images/fingerprint.js` |
| **Price deviation** | vs. our own comparables (§4.6) | partial |
| **Seller history** | listing volume, brand spread, account age | needs source |
| **House tells** | tag fonts, stitch, hardware, serial formats — **written by archivalists, per house, with reference images** | ❌ the real work |
| **Provenance chain** | source, prior sales we hold | ✅ `product_sources` |
| **Detail coverage** | which required photos exist at all | ❌ |

**The output shape, under rule #1:**

> **6 of 9 checks returned evidence.**
> ✓ This image appears in no other listing we hold
> ✓ Price sits within the 14 comparable pieces we hold
> ✗ The neck tag font does not match either reference we hold for this house and era
> — No reference held for this hardware stamp. **Not checked.**
> **ASILUM does not authenticate. This is what we could see.**

- [ ] Archivalist console — a house/era/detail reference library with images
- [ ] Never a single number. Never the word "authentic" or "fake"
- [ ] Every check names its evidence and links it
- [ ] Unknown is loud: **"not checked"** is a first-class result, never a pass
- [ ] Legal review before any of it is user-visible

---

## 7. TRAINING ASTERISK — every facet, no chat

The JP pipeline is the best training corpus ASILUM will ever get: tens of
thousands of real archive pieces, described by sellers, in a second language,
with condition grades and real prices.

Each facet in `lib/tagging/vocabulary.js` gets a training path — and note that
`origin`, `subculture` and `mood` are currently marked `written: false`,
meaning **nothing fills them yet**:

| Facet | Trained by |
| --- | --- |
| `garment`, `category` | JP seller titles → archivalist-confirmed mappings |
| `material` | Japanese fabric vocabulary |
| `condition` | `Aランク` / `美品` / `中古` grade ladder |
| `decade`, `year`, `season` | Archive collection codes |
| `origin` | **currently unwritten** — JP listings are the source |
| `designer`, `collection` | Runway archives, archivalist review |
| `size`, `size-system` | Extend `lib/brain/sizing.js` JP tables |
| `mood`, `subculture` | **currently unwritten** — archivalist only |

**The training loop, and it is an OS loop, not a conversation:**

1. Pipeline ingests a piece it cannot fully read
2. It lands on a review queue — the shape `unknownQueries.js` already has
3. An archivalist confirms, corrects, or rejects, and **signs it**
4. The correction becomes training data with recorded provenance
5. Confidence rises **only** because evidence arrived

> **No chat, at any step.** The archivalist works a queue with buttons, not a
> conversation. ASTERISK never explains itself in prose — it shows the reading,
> the evidence, and the confidence, and a human accepts or corrects it.

---

## 8. FEATURE AUDIT — 27 August 2026

Run in memory mode against a throwaway database. Nothing touched production.

### ✅ Healthy

- **25 GET endpoints** — correct codes throughout. No 500s, no absent routes.
  The two 404s (`/api/related`, `/api/profile/room`) are honest "not found",
  confirmed against a real item id
- **18 write endpoints** — every one fails closed with 401. `/api/stripe/webhook`
  answers 503 unconfigured, which is the honest answer
- **Buttons exist and are wired** — follow, favourite, board save, bag, buy,
  ticket, and all 16 mail-desk controls covering all 6 read ops and all 12
  write ops

### 🔴 Found broken, fixed, awaiting confirmation

| What | Impact |
| --- | --- |
| MailDesk sent no bearer | **All messaging inert in production** |
| `recordAge` sent no bearer, swallowed the 401 | **No age assertion ever recorded** |
| `recordKind` same | **Every business signup filed as passport** |
| `KindGate` read the kind unauthenticated | **Business bounced off its own analytics** |

All four fixed on `fix/the-mail-desk-could-never-sign-in`.
`tests/authenticated-wiring.test.js` prevents recurrence.

### ⏳ Cannot verify without a signed-in account

Anything behind `sb-` identity: real DM delivery, checkout completion, order
history, business surfaces. **These are §2's first-day list.**

---

## 9. THE SHORT VERSION

1. Merge five PRs
2. **Confirm messaging actually works** — it never has
3. Split and label `lib/db`
4. Apply to Buyee/ZenMarket — **the proxy is the data source**
5. Build JP↔EN resolution with an archivalist queue
6. Comparables from our own history, never an invented market price
7. ⚖ **Rule on Taobao** before building it
8. Evidence engine, never a verdict — ASILUM does not authenticate
9. No chat. It is an operating system.
