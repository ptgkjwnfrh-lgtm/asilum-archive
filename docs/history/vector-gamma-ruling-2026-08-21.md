# RULED — option 2, shipped 21 August 2026

> **The owner ruled option 2 and it is live.** The core slate now RANKS
> uncorroborated similarity lower without SCORING it lower: `parts.gamma` is
> untouched, so the ordering law below still holds and every explanation still
> reconciles; only `byScore` — the core slate's ranking key — discounts
> similarity that no behavioural edge corroborates. Any edge at all, including
> a single unverified identity, restores full weight.
>
> Measured after: `measure-vector-feed` flat GATE **FAIL → PASS**, top-24
> affinity **0.5393 → 0.5466** (it was 0.5226), reach +0.0193 and gamma-slot
> 0.2428 → 0.4595, both better than the shipped configuration — the same
> quality win option 1 offered, with nothing spent. The two tests that refused
> option 1 pass **unamended**. `measure-tuning` flat and satiating both PASS;
> `measure-distribution` improved from underpowered to **power PASS in both
> worlds**, because the change makes an injected concentrator easier to see,
> not harder.
>
> The record below is left exactly as it was written before the ruling.

---

# RULING NEEDED — vector gamma costs the slate, and the cheap fix breaks a security law

*Measured 21 August 2026, autonomous round. Nothing was shipped from this
document: the change it describes is a product ruling, not an engineering
call, and the owner was away. Every number here is reproducible with
`node scripts/measure-vector-feed.mjs` against the keyed pool.*

## The finding

**`measure-vector-feed` FAILS at head, in both worlds, and has for some time.**
It is not in any handover, because nothing runs it on a schedule.

```
--- world: flat (THE GATE) ---
reach affinity     : off 0.1748 → on 0.1917   (79 bots with reach slots)
gamma-slot affinity: off 0.2614 → on 0.3968   (13 bots with gamma slots)
top-24 affinity    : off 0.5393 → on 0.5226   (paired sigma 0.0053)
VERDICT (flat): FAIL
```

Turning vector neighbours ON costs **0.0167 of top-24 affinity at a paired
sigma of 0.0053** — more than three sigma of harm to the primary slate, which
is the part of the feed almost every reader actually sees.

Three things make this worth a ruling rather than a shrug:

1. **It is live.** `vectorNeighborsEnabled()` returns true unless
   `BRAIN_VECTOR_NEIGHBORS=0`, and that variable is set nowhere. Production
   is running the arm that loses.
2. **It predates this round.** Verified by running the same gate in a
   worktree at the commit before this session's first change: byte-identical
   numbers. Nothing recent caused it.
3. **The instrument, not the feature, changed.** The satiating arm prints
   `ESTIMATOR CHANGED the top-24 verdict: pass -> fail`. The r26 resampled
   paired-sigma noise floor is what exposed it; under the old single-draw
   estimator this looked like noise. The feature was shipped honestly against
   the instrument of its day.

## What the sweep says

`VEC_GAMMA_DISCOUNT` swept in the flat world. The off-arm is 0.5393
throughout, so the columns are directly comparable.

| discount | top-24 | Δ vs off | sigma | verdict | reach Δ |
|---------:|-------:|---------:|------:|:--------|--------:|
| **0.60 (shipped)** | 0.5226 | −0.0167 | 0.0053 | FAIL | +0.0169 |
| 0.45 | 0.5271 | −0.0122 | 0.0047 | FAIL | +0.0209 |
| 0.30 | 0.5355 | −0.0038 | 0.0030 | FAIL | +0.0168 |
| 0.15 | 0.5392 | −0.0001 | 0.0017 | **PASS** | +0.0159 |
| 0.00 | 0.5397 | +0.0004 | 0.0007 | **PASS** | +0.0157 |

**The reach gain survives at 0.00.** It was never vector-gamma's doing —
`VEC_REACH_BOOST` earns all of it, through a separate mechanism in
`assembleFeed`. So the feature's headline benefit does not depend on the part
that is causing the harm.

## The fix that looked right, and why it is not shippable

Vector nearness at full discount exists to be a floor a forged edge cannot
beat. That job only means anything where an edge EXISTS. So: keep full
strength when there is behavioural evidence, and drop to the sweep's highest
safe level (0.6 × 0.25 = 0.15) when there is none.

Measured, it **dominates the shipped configuration on every axis**:

```
reach affinity     : off 0.1748 → on 0.1941   (shipped: 0.1917)
gamma-slot affinity: off 0.2428 → on 0.4595   (shipped: 0.3968)
top-24 affinity    : off 0.5393 → on 0.5466   (shipped: 0.5226)  ← harm becomes gain
zone structure identical: true
VERDICT (flat): PASS                          (shipped: FAIL)
```

**And three tests refuse it, correctly.** `tests/image-gamma.test.js` pins a
declared ordering:

> ORDERING: a strong visual match narrowly beats ONE unverified person's click

A strong visual match with no behavioural edge scores 0.8 × 0.45 = **0.36**.
One unverified person's click scores 1/(1+2) = **0.333**. The gap is
deliberate and documented: it is the rung that stops a single forged identity
from outranking genuine similarity evidence. Discounting the uncorroborated
side to 0.09 **inverts it** — after the change, one anonymous click beats a
perfect visual match. `tests/vector-neighbors.test.js` pins the same law for
text vectors, and `tests/distribution.test.js` independently notices the
exposure concentration shift.

So the quality win and the anti-manipulation law are expressed through the
same scalar, and cannot both be had by tuning it.

## The options, with what each costs

1. **Rule the ordering law less important than the slate.** Ship the
   corroboration gate, amend `image-gamma` and `vector-neighbors` to the new
   ordering, and accept that one unverified identity's edge can outrank a
   strong similarity match. Cheapest in code, and it spends a security
   property to buy 0.024 of top-24 affinity.
2. **Separate the two jobs.** Keep `parts.gamma` exactly as it is — the
   ordering law and every explanation stay true — and discount uncorroborated
   gamma only in the CORE slate's ranking key, where the harm was measured.
   `assembleFeed` already ranks core, discovery and reach separately, and
   vector-gamma only ever moved `byScore`. More code, no law spent, and it
   needs its own declared criteria and its own run.
3. **Turn the feature off** (`BRAIN_VECTOR_NEIGHBORS=0` in Vercel). Recovers
   the slate immediately and gives up the reach gain, which is real and
   belongs to a mechanism that would still be disabled with it.
4. **Do nothing, knowingly.** The harm is ~3 sigma on a simulated population,
   not a live outage. Acceptable only if it is written down, which is what
   this file is for.

**Recommendation: option 2.** It is the only one that pays for the slate
without spending a declared law, and the measurement above says the win is
there to be had. It should be its own round, with criteria declared before the
run — the same discipline the replay harness's own header demands of itself,
one instrument over.

## Also found, not fixed

`measure-replay` reads **NOT CALIBRATED** in the flat world at head — 8 of 10
decided pairs agree where all must. Both disagreements involve near-ties on the
replay side (adjusted Δ 0.0053 and −0.0031) being read as confident verdicts,
because the live Δ is tested against a noise floor and **the replay Δ is not**.
The script's own header already names this and defers it:

> Giving replay its own floor, and treating pairs inside it as undecided the
> way live pairs already are, is the obvious next amendment — and it is exactly
> the move that would turn this red light green, so it does not get made in the
> same round that wants the pass. It needs its own declared criteria and its
> own run.

That amendment is still owed, and it must carry a power criterion — a floor on
both sides makes pairs undecided, and a gate that passes because it decided
nothing has laundered the harm it exists to catch.
