# Taste-engine dials — measurement report (main b261590, 8 Sep 2026)

Method: `lib/brain/index.js` + `bridges.js` copied to the scratchpad and given env-switched dials (no repo edits); real seed catalog (915 cards; MINIMAL-dominant 144, GORP 105, SEDUCTIVE 84); `buildFeed` limit 24, rotation "cursor". Scripts: `d1.mjs` (catalog cards), `d1pure.mjs` (single-tag `{MINIMAL:1}` cards), `d2.mjs`; raw tables in `d1-*.md`, `d1p-*.md`, `d2-*.md`; test diffs in `t-*.txt`.

## D1 — three fast skips erase a weak taste

**First finding: the owner's numbers only reproduce with single-tag cards.** With real catalog cards the trajectory is the same (+0.76 → −0.74) but `hasTaste` NEVER goes false: the favourited MINIMAL cards carry UTILITARIAN/STATEMENT side-weights and the halo lifts them above 0.2, so the discovery/reach quotas stay (11/5/2/6, or 9/5/4/6 once the third skip trips fatigue → "bored"). What does vanish is MINIMAL itself: **one** fast skip takes MINIMAL-dominant cards in the core slate from 100% to 0% (status quo). The mechanism is the session vector: a fast skip folds −0.26×2.5 and deducts 0.5 from the dominant tag → −1.16, clamped to −1, and session is 40% of taste. With pure `{MINIMAL:1}` cards the halo is too small (TAILORED 0.11) and `hasTaste` does flip false after skip 1 (fast) / skip 2 (slow) → quotas 18/0/0/6, exactly the reported symptom.

Trajectory = taste.MINIMAL after fav2 → skip1 → skip2 → skip3 (fast, 500 ms). Core share = MINIMAL-dominant share of the core slate after skip 1/2/3. Opt-out = fast skips on MINIMAL cards until core MIN-dom share < 20%, from 2 favs / 5 favs.

| cand | taste trajectory (real cards) | after 5 favs | hasTaste after skips real / pure | next chunk zones real / pure | core MIN share s1/s2/s3 | opt-out real 2f/5f | opt-out pure 2f/5f |
|---|---|---|---|---|---|---|---|
| a status quo | 0.76 → 0.07 → −0.51 → −0.74 | 0.30/−0.28/−0.51 | true / **false** | 9·5·4·6 bored / **18·0·0·6** | 0/0/0% | 1 / 2 | 2 / 2 |
| b penalty session-only | 0.76 → 0.19 → −0.27 → −0.38 | 0.42/−0.04/−0.16 | true / false | same as a | 18/0/0% | 1 / 2 | 2 / 3 |
| c floor 0.3 per action | 0.76 → 0.38 → 0.04 → −0.27 | 0.62/0.27/−0.04 | true / false (from skip 2) | same as a | 73/0/0% | 2 / 4 | 3 / 4 |
| d hasTaste on \|t\|>0.2 | identical to a | identical to a | true / **true** | real same as a; pure: quotas 11·5·2·6 but **served core 16 / disc 0 / reach 2 / cat 6** | 0/0/0% | 1 / 2 | 2 / 2 |
| e = b + c | 0.76 → 0.45 → 0.18 → −0.06 | 0.69/0.41/0.16 | true / false (skip 3 only) | same as a | 91/36/33% | **6** / 5 | 3 / 4 |

Slow skips (5000 ms): a 0.19 → −0.30 → −0.60; b 0.31 → −0.06 → −0.25; c identical to its fast row (the floor binds either way); e 0.50 → 0.27 → 0.08. Dwell speed changes the end point by ~0.15; the penalty and the session clamp do the rest.

(d) "discovery adjacent to a dislike": serves **nothing**. `expandTaste` only expands tags ≥ +0.2, so with only a dislike the adjacent vector is empty, every discovery score is 0 < DISCOVERY_FLOOR 0.15, and the 5 discovery slots fall back to core (mean similarity undefined — 0 discovery cards). Only the 2–4 reach slots actually appear. The quota changes on paper, the page does not.

Tests (brain-importing files run with each dial; 9 baseline failures are path/source-scan artefacts of running outside the repo and are excluded): a/b/d break nothing; **c and e break `skip-dwell-timing #3 "a fast skip is ~1.75x stronger than a slow skip"`** (on a dominant-tag card the floor makes fast and slow equal; the ratio test on a non-dominant tag still passes).

**D1 recommendation.** The complaint is real but mis-located: it is not the quotas (they survive on real cards) but the core slate, and the lever is the session vector hitting −1 in one action. Take **(c), a 0.3 per-action floor**: three fast skips still say "not this" (MINIMAL leaves the core after skip 2) but no longer flip a taste into a strong dislike (−0.27, not −0.74), and a reader who wants out pays 2–4 skips instead of 1–2. Trade-off: exit is slower, and one timing test must be re-expressed (fast vs slow only differs below the floor). Choose (e) instead only if stickiness matters more than exit — it keeps taste positive through three fast skips but costs 6 skips to leave. Do not take (d): it changes counts, not the page. (b) alone leaves the session clamp where the flip lives.

## D2 — taste saturates at 1.0

Protocol: 10 chunks × 3 GORP favourites (picked from the served chunk, core first), then 6 chunks × 3 SEDUCTIVE favourites. Alignment = mean cosine(core card tags, tasteVector used to build the chunk). (b) = no clamp in learn, tasteVector divided by max|w| when max|w| > 1 (a literal divide-by-max would make every reader's top tag 1.0 after one click and trip hasTaste on a single `open`; noted, not measured). (c) = extra ×0.9 on any tag sitting at the clamp before the ordinary decay. (d) = clamp ±2, same normalise-on-read.

| cand | GORP saturates | taste.GORP ch2 / ch10 (long) | align ch2 → ch10 | GORP-dom core ch2 → ch10 | SED overtakes GORP in core | ch16 taste GORP / SED (long GORP / SED) | ranks 30-fav GORP above 18-fav SED? | tests broken |
|---|---|---|---|---|---|---|---|---|
| a status quo | ch2 (6 favs) | 0.97 / 1.00 (1.00) | 0.93 → 0.78 | 11/11 → 8/13 | **ch12**; GORP 0/13 from ch13 | 0.55 / 1.00 (0.85 / 1.00) | no — tie at 1.0 in ch12, then SED wins | — |
| b no clamp + normalise | never (long 7.76 at ch10) | 1.00 / 1.00 (7.76) | 0.94 → 0.82 | 11/11 → 7/11 | **ch14**; SED taste only 0.23 after its first 3 favs | 1.00 / 1.00 (6.77 / 4.76) | yes, through ch15 (0.81 vs 1.00) | memory-decay #11 ×2 (clamp at 1, session = 1), search-brain-loop "clamp must hold", catalog-chunks C20 (no-repeats promise over a session); corrections.js:326 still clamps merges to ±1 → adoption flattens every saturated tag back to a tie |
| c extra decay at clamp | ch2 | 0.97 / 1.00 | 0.93 → 0.79 | 11/11 → 8/13 | ch12 | 0.51 / 1.00 (0.78 / 1.00) | no (same as a ±0.04) | — |
| d clamp ±2 + normalise | ch3 (9 favs, at 2.0) | 1.00 / 1.00 (2.00) | 0.94 → 0.81 | 11/11 → 7/11 | ch12 | 0.55 / 1.00 (1.71 / 2.00) | briefly (ch11–12: 1.00 vs 0.76), then tie at 2.0 | memory-decay #11 ×2, search-brain-loop "clamp must hold" |

**Alignment falls in all four candidates at the same rate (≈0.93 → 0.80 over chunks 2–10).** That fall is supply, not saturation: the cursor's served filter had consumed ≥ 71 of the 105 GORP-dominant seed cards by chunk 10, so the core slate has to reach for weaker GORP cards regardless of the clamp. Side effect seen in a/c/d from chunk 10: reach quota 2 but 0 served — a GORP+SED+halo taste is so wide that no card is "far" (< 0.15 similarity); (b)'s normalised taste stays narrow and keeps its reach slots.

**D2 recommendation.** None of the four is worth taking now. Saturation is real (status quo ties GORP and SEDUCTIVE at 1.0 the moment the second love arrives, and forgets GORP entirely three chunks later), but the only candidate that ranks one love above another, (b), does so by letting weights grow without bound: a new aesthetic then needs four chunks instead of two to show up (SEDUCTIVE at 0.23 after three favourites), four tests and the C20 no-repeats promise break, and the account-adoption merge at `corrections.js:326` clamps everything back to ±1 anyway. (d) just moves the ceiling to 9 favourites; (c) is indistinguishable from the status quo. The "alignment falls over a session" complaint is answered by catalog size, not by the clamp — every candidate falls identically. If ranking between loves is wanted, the mechanism is a bounded accumulator that keeps counting past 1 (e.g. log-scaled or count-normalised long-term taste) and that is not in this candidate set; it needs its own design pass against ADR-002 and the ±1 merge.
