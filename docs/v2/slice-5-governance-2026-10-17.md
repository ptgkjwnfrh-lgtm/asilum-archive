# V.2 slice 5 — ASTERISK governance (17 October 2026)

The fifth vertical slice of the V.2 build (`docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
"Build order" 5): the blueprint's Part I "ASTERISK governance" — confidence
cap, calibration hooks, the agent split policy, per-function pause, the audit
ledger — and the verification ledger's adaptation: Pending as a state with an
evidence request, the five-minute / 72-hour timing, the replica signal. Fifth
commit on `v2/build`, PR #484.

## What landed

| Blueprint | Where | Status |
| --- | --- | --- |
| The 90% cap; only an admin confirmation is certain | `lib/asterisk/governance.js` `cap`; applied in the tag grammar (`tagsFor`: an ASTERISK tag never carries more than 0.9, an admin's typed row is 1) and the verification ledger (a keyed model's 0.92 is recorded as 0.9; VERIFIED without a human needs the checklist AT the cap) | shipped |
| The 65% split: one to five blind agents, each with a share of the budget, reconciled after all have answered; collective confidence from agreement and evidence, never an average; done at 75% | `agentsFor`, `budgetShares`, `reconcile` (agreeing share × noisy-or of DISTINCT evidence, capped), `decide` | shipped as policy; the governor runs the agents a caller supplies. With no keyed model no agent runs: the split is RECORDED as unavailable and the safe outcome applies — the honest state production is in |
| Five minutes per task; cost per task logged | `TASK_BUDGET_MS`, `decide().withinBudget`, `cost.tokensUsed` | shipped |
| Safe outcomes per function, no escalation under 75% | `FUNCTIONS[fn].safe`; tagging and authentication are wired through `govern`; valuation, exploration are declared with what implements them today named honestly | shipped / declared |
| Admins supersede; every action logged with evidence, confidence and reasoning; admins can stop it per function | `lib/db/production/asterisk.js` (mem + pg): `asterisk_actions` append-only, `overrideAsteriskAction` (a new row, ground truth, names the row it supersedes, never twice), `asterisk_function_state` pause / resume; `lib/asterisk/governor.js` `govern` refuses work for a paused or handed function and queues it | shipped |
| What reaches an admin; the queue's order; only fraud and high value alert | `needsAdmin` (fraud, the per-category threshold the admins set, dispute, conflict, audit sample), `orderQueue` (fraud, value, age), `asterisk_queue` | shipped |
| Calibrated, not claimed | `calibrate`: per band, stated vs observed over admin overrides; thin bands UNMEASURED, never assumed right | shipped as the instrument; retuning a threshold is an admin's edit to the policy |
| Audits: productivity, accuracy, complex search handling; grades; two poor in a row hand the function to the queue | `auditFunction`, `standingAfter`; `/api/admin` `asterisk.grade` over the last seven days of the ledger; fewer than ten decisions is grade U — unmeasured, not a pass | shipped |
| Passengers never see the machinery | `/api/verification/listing` strips confidence, the fraud flag, the evidence request and the deadline from the public badge; the console (`/admin` panel 10) is the only reader | shipped |
| Verified requires positive evidence at the cap; replica signals override confidence and raise a fraud flag; every confirmed replica joins the library | `lib/verification/replicas.js` over `replica_patterns` (admin-confirmed, seeded EMPTY); `runChecks` forces `ai: fail` + `fraud` → UNVERIFIED and an alerting queue case | shipped |
| Missing evidence is a request, not a guess; the clock pauses | `evidenceRequestFor` (native listings only — an external listing has nobody to ask), `record.evidenceRequest`, badge PENDING naming the asks | shipped |
| SELL live as PENDING; five minutes to 90%; 72 hours to resolve; Unverified is not a punishment | `AUTH_PASS_MS`, `RESOLVE_WINDOW_MS`, `record.resolveBy` for native listings; past it an open request resolves UNVERIFIED with the item still listed | shipped — no native listing exists until slice 6; the mechanism is pinned by tests |
| UNVERIFIED is a state; absence of proof is never evidence (12.6) | `badgeFor`: failed on positive evidence → `unverified`; stale / missing / expired → no badge; `statusWordFor`; `VerificationBadge.jsx` draws UNVERIFIED | shipped |
| Sold freezes; relisting re-evaluates | `badgeFor` keeps a sold item's state past a material change or expiry; a relist is a new evidence version | shipped |
| The admin console | `/admin` panel 10 ASTERISK GOVERNANCE: the policy numbers, the seven functions (state, grade, backlog, PAUSE / RESUME, GRADE with the audit and the calibration), the queue (DECIDE), the ledger per function (OVERRIDE with a note) | shipped |
| Schema | `supabase/schema-v63-asterisk-governance.sql` — STAGED, not applied (v61 is live; v62 is the unpushed storefront's). Readers answer defaults and writers refuse by name until it is applied; the v61 ledger gains `fraud`, `evidence_request`, `resolve_by` with column probes so a v61-only database keeps working | staged |

## Honest gaps

- No model is keyed, so no blind agent ever runs today; every split is
  recorded as unavailable and the safe outcome applies. The agent factory is
  the seam (`govern(fn, task, { agents })`).
- Valuation and exploration are governed on paper: their safe outcomes are
  declared, nothing calls `govern` for them yet (the comparables model and
  the Exploration Active state are later slices).
- The audit's "complex search handling" reading is accepted from the search
  honesty instrument when a caller passes it; the grade endpoint does not
  yet wire that instrument in.
- The pg half of the governance differential (`tests/helpers/
  governance-scenario.mjs`) runs only in CI, where `TEST_DATABASE_URL`
  applies every migration; locally the only database is production and v63
  is not applied there.
- The seller notice on a downgrade (12.8) and structured appeals (12.9) are
  not built; a dispute reaches the queue through `task.dispute` only.

## Measured

- `npm test`: 1,765 tests, 1,680 pass, 0 fail, 85 skipped (the one new skip
  is the pg half of the governance differential, which runs in CI). New:
  `tests/asterisk-governance.test.js` (the policy, the rows, the governor),
  `tests/admin-governance.test.js` (the console's actions, the queued 202,
  the public badge without the machinery, the replica signal, the grade),
  the slice-5 cases in `tests/verification-ledger.test.js`, the steward's
  `asterisk.governance` check in `tests/steward.test.js`.
- `npm run build`: green. `npm run docs:codemap` regenerated.
- The steward board gains `asterisk.governance` (never tier: pausing,
  grading and overriding are an admin's word, not the steward's).
- Memory-mode dev server (port 3481, a generated desk token): the governance
  panel reads the seven functions; PAUSE on authentication makes a listing
  check answer 202 and land in the queue; RESUME clears it; the ledger shows
  the pass with its evidence and reasoning; OVERRIDE writes the ground-truth
  row; GRADE on a thin ledger reads U.
