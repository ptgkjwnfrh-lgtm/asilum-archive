# Metric definitions — 17 August 2026

The launch audit's remaining open item was **metric definitions**: numbers the
site prints without saying what they count. This is that register, and it is the
authority for every user-visible figure in the app.

**Why this document exists.** The accessibility and SEO queues both closed on
the same shape of bug — *a claim the code did not keep*. A metric label is a
claim of exactly that kind, and it is a quieter one: nobody proof-reads a
counter. Four of the figures below were wrong when this register was compiled,
and one of them was printing the literal word `undefined` on the front cover,
one line above the cover's own promise that every value on it is real state.

**Method.** Every figure was traced to the expression that produces it, and the
verdicts marked *measured* were read out of a running browser, not inferred.
Where a quantity is not measured anywhere in the codebase it is recorded as
**not measured** and the surface now prints `—`, not `0` — the rule already
stated in `app/stats/page.js`: *anything not measurable prints "—" rather than a
zero that would read as a fact.*

**Scope.** Public and per-visitor surfaces, plus the staff dashboards on
`/stats` (which already name their own windows, and are the one part of the app
that was doing this properly). Numbers that are plainly not metrics — prices,
character counters, pagination indices, the passport's document serial — are out
of scope.

---

## Verdicts at a glance

| # | Figure | Surface | Verdict |
|---|--------|---------|---------|
| M1 | SYSTEM LEDGER — interactions / readers / boards / graph edges | `/cover` | **was FALSE — printed `undefined` ×4 — fixed** |
| M2 | `STATE — MEMORY MODE / PERSISTENT LEDGER` | `/cover` | **was FALSE — always said MEMORY MODE — fixed** |
| M3 | `MATCH n%` | `/stylist` | **was MISLABELLED — not a percentage — fixed** |
| M4 | `MATCH` floor of 75 | `/stylist`, `/api/outfits` | **was INERT — ruling 8 answered, floor is now real** |
| M5 | `CURATED n%` / `TASTE n%` on model looks | `/stylist` | **was FALSE — both were copies of MATCH — fixed** |
| M6 | conf range in the engine's own doc comment | `lib/brain/stylist.js` | **was STALE (said 58–99) — fixed, now 0–99 after ruling 8** |
| M7 | `n BRANDS` | `/profile` | **was MISLABELLED — counted bag brands — fixed** |
| M8 | `n FOLLOWERS` | `/profile` | **NOT MEASURED — now prints `—`** |
| M9 | `n POSTS` / `n FOLLOWING` | `/profile` | **true — definitions recorded below** |
| M10 | `CONVICTIONS n ACTIVE` | `/board` | **true — investigated and cleared** |
| M11 | `n FOLLOWING` / `n FOLLOWERS` / `n AESTHETICS` | `/u/@handle` | **hash-derived — unreachable in production** |
| M12 | `taste match n%`, `interpretation confidence n%` | `/`, `/discover` | **true — real 0–1 quantities** |
| M13 | retention / wire / search / booth dashboards | `/stats` | **true — each already names its window** |

---

## M1 — the front cover printed `undefined` four times

**What a reader saw**, in the masthead and again in the colophon:

```
SYSTEM LEDGER — undefined INTERACTIONS · undefined READERS ·
undefined BOARDS · undefined GRAPH EDGES
```

immediately followed by

```
EVERY VALUE ON THIS PAGE IS REAL STATE — NOTHING IS STAGED
```

**Cause.** `app/cover/page.js` read `/api/stats` with `authorizedFetch` and never
checked `r.ok`. This is the *same* defect the `/stats` page had fixed on 8 August
— its code comment describes it — and the cover's copy was never checked against
it. It became visible on **16 August**, when `/api/stats` was gated to
ADMIN_TOKEN (audit P0-1): a visitor's device cookie now earns
`401 {"error":"stats are staff-only"}`, which is a **truthy** body, so `sys` was
set to the error object and every field interpolated as `undefined`.

**This is the general trap and it is worth stating on its own: gating a route
turns every unchecked `r.json()` on its callers into a rendered lie.** The gate
was correct. The caller was already broken and nobody was looking at it.

**Fix.** Three parts, because the first alone would have left the feature dead:

1. `r.ok` is checked; a refused read leaves `sys` null.
2. The folio moved into `app/cover/ledger.js` as a pure function that prints an
   entry **only if its value is a finite number** — so a future payload dropping
   a counter loses that entry instead of printing `undefined`. `0` is a
   measurement and survives the filter; a test pins that specifically, because
   the obvious `if (!value)` rewrite would silently drop real zeros.
3. The cover reads the staff token from the same `sessionStorage` slot THE DESK
   and `/stats` use, so the folio still draws **for staff** rather than being
   deleted. No second credential was invented.

**Measured after the fix.** Visitor: no folio, and the colophon reads
`*ASILUM LIVE EDITION · AUGUST 17, 2026 · EVERY VALUE ON THIS PAGE IS REAL STATE`
— the claim is now true. Staff (verified against a local instance with a
throwaway token, never the owner's): `SYSTEM LEDGER — 0 INTERACTIONS · 1 READERS
· 0 BOARDS · 0 GRAPH EDGES`.

### Definitions, now that they print

| Folio entry | Counts | Window |
|---|---|---|
| INTERACTIONS | rows in `interactions` — one per bag/share/save/favorite/dwell/skip/hide | all time |
| READERS | distinct identities with a stored profile. **Identities, not people** — one person can hold a device identity and an account | all time |
| BOARDS | mood boards created | all time |
| GRAPH EDGES | rows in `edges`. **An edge count is not a working graph** — `/stats` reports `gamma usable n / total` beside it for that reason (Aug-15 audit: all 2,632 edges had `contributors = 0`, so gamma answered nothing while this number read as health) | all time |

---

## M2 — the cover told every visitor the system was in MEMORY MODE

Same root cause, separate lie, and the worse of the two: `sys.persistent` was
`undefined` on the error body, which is falsy, so the STATE marginalia printed
`MEMORY MODE` **on a deployment running Postgres**. A false claim about the
system's own storage, on the landing page.

The `"READING"` fallback beside it was a placeholder for a request in flight
that **outlived its own request** — after a refusal it said READING forever. The
span is now drawn only when the ledger was actually read. It is absolutely
positioned marginalia, so omitting it costs no layout.

---

## M3 — MATCH is not a percentage

`/stylist` printed `MATCH 94%`. `conf` is not a percentage. `lib/brain/stylist.js`
says so in its own header — *"a calibrated display of relative score … not a
literal purchase probability. Keep it honest in the UI copy"* — and the same
value was already printed **without** a `%` in the `.otfconf` chip on the look's
own header, a few lines above, so the page contradicted itself.

Now: `MATCH 94 of 99`. The chip and the stat row read the same way.

`CURATED` and `TASTE` **keep** their `%`. Those are real percentages —
`Math.round(cohAvg * 100)` and `Math.round(max(tasteAvg, 0) * 100)`, both of a
0–1 quantity.

| Figure | Definition |
|---|---|
| `CURATED n%` | mean pairwise coherence of the chosen pieces — tag affinity, era proximity, price-tier sanity |
| `TASTE n%` | mean similarity of the chosen pieces to the blended taste vector, floored at 0 |
| `MATCH n of 99` | the look's composite quality: `round(min(99, raw * 99))` where `raw = coherence*0.55 + max(taste,0)*0.45`. Below 75 the look is rejected, not shown (ruling 8, §M4). **Not a probability of anything** |

---

## M4 — the match floor of 75 never rejected a look → RULING 8, ANSWERED

**The finding.** `/api/outfits` documented a *"match floor 75"* and enforced it
twice, and **neither check could ever fire.** `raw` is non-negative by
construction, so `75 + raw*24` was already ≥ 75 before `Math.max(75, …)` saw it.
Every look shipped, the worst possible one still displayed 75, and a 24-point
band carried the whole signal.

**The ruling: option (b).** `conf` is now the composite scaled straight onto
0–99, with no lower clamp, so a bad look *can* land under the floor and
`/api/outfits` drops it.

### Measured before changing the mapping

The calibration was chosen from the distribution, not by eye — picking a curve by
eye is how the floor went inert in the first place. Across **9,000 generated
looks** over cold, warm and rich profiles, the composite runs:

| p01 | p05 | p10 | p25 | median | p90 | max |
|---|---|---|---|---|---|---|
| 0.625 | 0.667 | 0.708 | 0.750 | 0.792 | 0.833 | 0.917 |

So `raw × 99` puts the 75 floor at roughly the **27th percentile** — it rejects
the weakest quarter rather than everything or nothing.

### Measured after

A full generation promises 25 looks (5 genres × 5, from 10 candidates each):

| profile | looks shown | rejected by the floor | MATCH shown | empty generations |
|---|---|---|---|---|
| cold | 21.2 / 25 | 19% | 75–86 (median 82) | 0 / 40 |
| warm | 25.0 / 25 | 1% | 77–90 (median 84) | 0 / 40 |
| rich | 18.9 / 25 | 49% | 75–86 (median 79) | 0 / 40 |

**The page never empties**, and MATCH now spans a real range instead of the
93–96 everything used to score.

### Two things that came with it

**The activity bonus is gone.** `conf` used to gain up to +4 from
`min(events, 400) / 100`. With a real floor that term lets a weak look buy its
way past the gate on how much the reader has browsed — a fact about the person,
not about the look. Conflating the two is the exact defect this register exists
to catch.

**The model path was fixed to match.** `modelLook` clamped AI looks with
`Math.max(75, …)` and the AI group skipped the floor filter entirely, so ruling 8
would have been real on the engine path and decoration on the other. Both paths
now obey one rule, and an unrated model look scores 0 rather than a
comfortably-passing 85.

**Side effect, flagged and then measured.** `rankTrendAware` sorts on
`conf + trendScore*6`. When conf spanned four points the trend term dominated the
ordering; widening conf to thirty points could plausibly have gone the other way
and left trend unable to move anything — in which case `trendAwareLook` would be
dead weight still printing "current styling context" on looks. Checked over 300
generations rather than assumed:

| | |
|---|---|
| looks carrying a trend | 1,093 of 2,535 (**43%**) |
| `trendScore` when present | 0.43–0.49, so **up to 2.9 points** after the ×6 |
| trend changed the ORDER | 278 / 300 generations (**93%**) |
| trend changed WHICH FIVE ship | 144 / 300 generations (**48%**) |

So the term is alive and consequential. What changed is its *proportion*: among
looks that survive the floor, conf spans about eleven points, so a ≤2.9-point
nudge reorders within a quality band instead of overriding it. Before ruling 8,
survivors spanned roughly three points and the nudge was as large as the entire
quality signal.

**Do not "rebalance" the ×6 on a hunch** — it is currently doing what it should,
and this table is the baseline to compare against.

## M5 — three labels, one number

`modelLook` in `app/api/outfits/route.js` set `curated: conf, tasteStat: conf`,
so for the **AI TREND EDIT** group `/stylist` printed CURATED, TASTE and MATCH as
three differently-labelled copies of the same figure. The model returns one
score and no decomposition, so there was nothing to put there.

Both are `null` now, and the client **omits** a stat it has no value for rather
than printing `null%`. A missing stat is honest; a duplicated one is not.

---

## M6 — the engine's own definition was stale

`lib/brain/stylist.js` documented the range as `58–99`. The clamp produces
`75–99`; the comment had been wrong since the floor moved. The one place a
future reader would look to find out what the number means was the place that
was wrong. Fixed, and pinned by a test.

---

## M7 — BRANDS counted the wrong brands

`/profile`'s header counter labelled **BRANDS** — sitting immediately beside
**FOLLOWING** — counted *distinct brands appearing in bag history*. The BRANDS
tab's first section is `FOLLOWING`, listing **followed** brands.

So: follow five brands from item modals with an empty bag, and the header read
`0 BRANDS` while the tab listed five. Brand follows were counted in neither
`FOLLOWING` (readers + boards) nor `BRANDS` — nowhere at all.

The counter now reads `followedBrands().length`, and it is held in state and
refreshed on the `asilum:follow` event, because the tab keeps its own local copy
and a render-time read went stale the moment a chip was toggled there.
**Measured:** header `3 BRANDS` → unfollow HELMUT LANG in the tab → `2 BRANDS`,
with `localStorage` agreeing.

Bag brands are still shown, under the heading they belong to: `FROM YOUR BAG`,
candidates to follow.

---

## M8 — FOLLOWERS was a measurement of nothing

`const followers = 0;`, rendered as `0 FOLLOWERS`.

The word "follower" does not appear anywhere in `lib/` or `app/api/` — there is
no follower edge, no counter, no table. Following is one-directional and
device-local (`asilum-follow-users`, `asilum-follow-brands`) plus board follows
on the server profile. A literal `0` claimed a measurement nobody takes, and
read as *nobody follows you*.

It prints `—` now, titled *"ASILUM does not track followers yet"*. When a
follower relation exists, this is the line to change.

---

## M9 — POSTS and FOLLOWING, recorded as they stand

| Figure | Counts | Note |
|---|---|---|
| `n POSTS` | this identity's visible transmissions from the server, merged with device copies the server does not show yet (just posted, or held for review) | the merge is deliberate — a held post stays visible to its author, labelled |
| `n FOLLOWING` | followed readers (device-local) **+** followed boards (server profile `_meta.follows`) | does **not** include followed brands; those are `BRANDS` since M7 |

---

## M10 — CONVICTIONS: investigated, cleared

`/board`'s passport prints `CONVICTIONS n ACTIVE` from a list built with
`.slice(0, 10)`, which looks exactly like a total capped at its own display
limit — the M8 shape.

**It is not.** The taste vector's key space is closed: `TAGS` has exactly ten
entries, and every writer into a profile's `long`/`session` maps into it —
`item.tags` keys are TAGS, and every `LEXICON` entry's targets are TAGS
(enumerated to confirm). The cap equals the key space, so it can never truncate.

Recorded because the next reader will have the same suspicion, and because the
finding I first wrote down here was wrong. **If TAGS ever grows past ten, this
counter silently becomes a display cap.**

---

## M11 — the demo profile's hash-derived counters

`app/u/[handle]/page.js` renders, for a `MOCK_USERS` handle:

```js
<b>{(hashStr(handle) >> 4) % 60}</b> FOLLOWING
<b>{100 + (hashStr(handle) % 900)}</b> FOLLOWERS
```

Invented numbers presented as counts. **Unreachable in production**, verified:
`MOCK_USERS` is `[]` unless `DEMO_SOCIAL_ENABLED`, which requires
`NODE_ENV !== "production"` *and* `NEXT_PUBLIC_ENABLE_DEMO_SOCIAL === "1"`; with
no fixture the page falls through to the real-poster branch or NOT FOUND.
`postStats()` returns `{comments: 0, reposts: 0, likes: 0}` under the same gate.

Left alone rather than fixed — the demo layer exists for local load exercises
and deleting it is a separate call. **Do not lift this page's counters onto a
real surface, and if the demo layer is ever enabled anywhere public, these go
first.**

---

## M12 — the percentages that are genuinely percentages

| Figure | Surface | Definition |
|---|---|---|
| `taste match n%` | `/` — ASTERISK "why this" | `why.tasteMatch × 100`; a 0–1 similarity between the piece and the taste vector |
| `interpretation confidence n%` | `/discover` | `reading.interpretation.confidence.interpretation × 100`; from `lib/asterisk/confidence.js`, provenance-derived (curated editorial without external URLs is 0.7 by design). Prints its leading assumption beside it |

Both are 0–1 quantities scaled by 100. The `%` is correct on both.

---

## M13 — the staff dashboards were already doing this right

`/stats` §"the house — operating numbers" is the model the rest of the app should
follow, and it needed no change:

- every figure names its window (`THE WIRE · last 14 days`, `SEARCH HEALTH ·
  last 7 days`);
- `RETURNING IDENTITIES` states its own definition and its own limit in prose —
  *"identities, not people — one person can hold a device identity and an
  account, and this counts both"*;
- unmeasurable values print `—`, never a zero.

That third rule is the one M8 borrowed and M1 breached.

---

## What to do next with this document

1. ~~**Ruling 8 (M4)**~~ — **answered 17 August**, option (b). No open decisions
   remain in this register.
2. `tests/metric-definitions.test.js` is this register made executable — 14
   tests, each verified to go red under a revert of the thing it pins. If one
   fails, a definition moved and this file must move with it.
3. When a new number ships, add a row. The failure mode is not a wrong
   calculation; it is a label nobody re-read after the thing underneath it
   changed.

---

## Appendix (18 Aug) — the commerce four, DEFINED BEFORE MEASURED

Phase L3 of the risk campaign measures the loop with exactly four numbers.
They are defined here, before any exists, so the first dashboard cannot
invent them ad hoc (this register's founding rule: a metric label is a
claim). All four are **not measured yet** — nothing prints them; when they
ship they follow the `—`-not-zero rule until real data exists.

| # | Figure | Definition | Source of truth |
|---|--------|------------|-----------------|
| C1 | visitor→purchase conversion | distinct identities with ≥1 `orders.status='paid'` in window ÷ distinct identities with ≥1 feed/discover impression in window | `orders` + impressions ledger |
| C2 | repeat rate | identities with ≥2 paid orders ÷ identities with ≥1 paid order (all-time until volume justifies a window) | `orders` |
| C3 | contribution margin per order | (ASILUM revenue on the order − Stripe fees − refund cost share) per paid order, in the order's currency, where revenue = the 1% founders fee + 15% of item price IF hotlist-attributed (economics ruling 20 Aug 2026; booth rent is NOT allocated per order — it reports as its own monthly line); NEGATIVE numbers print as negative, and base-sale orders are EXPECTED negative at current processing costs (recorded flag, `hotlist-program-spec-2026-08-20.md` §2) | `orders` (incl. `fee_cents`) + Stripe balance transactions (fees are Stripe's word, never estimated) |
| C4 | support minutes per order | operator-logged minutes ÷ paid orders in window; **manual log, honestly labeled as such** until a support tool exists | operator log (does not exist yet) |
| C5 | attributed orders per booth per cycle | paid orders with `orders.hotlist_attribution = <booth source>` created inside the booth's rent period (P2's stamp at order creation: program member + booth visit within the 7-day window); the commission base, reported on every statement | `orders.hotlist_attribution` + `booth_visits` + `hotlist_rent_payments` (defined 20 Aug with the P2–P4 build; `—` until a booth pays) |

Rules inherited from this register: windows named on the surface, `—` until
measured, and the expression that produces each figure cited next to it the
day it ships.
