# Algorithm evaluation

_Read before changing brain/bridge weights, feed zoning, search ranking, or claiming any recommendation change is an improvement._

No algorithm change is "better" because a few recommendations look
convincing. Evidence comes from the harness:

- tests/stress_test.py — run the server on :3457, then
  `python3 tests/stress_test.py`. 1000 bots judge by AFFINITY-EXPANDED
  latent taste (not raw persona match); read satisfaction, zone hit
  rates, and skip patterns before/after.
- API regression suite must stay green (it caught real ranking bugs).
- Verify feed invariants survived: max 2 items/brand/page, discovery
  every 5th slot, 2 far-reach slots (5 when bored), seen-item rotation,
  fast-skip negative weighting.
- Search changes: re-run the canonical probes ("good blanks" → Helmut
  Lang top; "trashed jeans" → bottoms only; "like Rick Owens" penalizes
  Rick Owens) and state confidence/matchReason diffs.
- Metrics like precision@k / nDCG / CTR / save-rate require real
  interaction volume the product does not have yet — do not fabricate
  them; log the aspiration in the PR, measure the harness.
- Record before/after numbers in the PR body. A weight change without
  numbers is a hypothesis, not a fix.
