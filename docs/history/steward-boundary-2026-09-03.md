# The steward's boundary — 3 September 2026

On 3 September the owner set the constitution's read-only rule aside for the
steward and asked for three things: that it **acts** on its own findings, that
it **runs** on a schedule and reports movement, and that it **decides** inside
a declared boundary. This page is the record of that decision and of where the
boundary was drawn. The code is `lib/steward/decisions.js`; if the two ever
disagree, the code is what runs and this page is what to fix.

Two rails did not move, and the owner's waiver was accepted on those terms:

* **No faking.** A repair may take a piece that cannot be shown honestly off
  the floor; it may never invent the price that would let it be shown. Nothing
  the hands do produces a fact the catalog did not already hold.
* **A hard stop before anything irreversible.** Deleting a source-of-truth
  row, moving money, sending mail, changing who can get in, running DDL. These
  are in the `never` tier by name, and no flag unlocks them.

## Three tiers

| Tier | Who decides | What happens |
| --- | --- | --- |
| **delegated** | the steward, alone | planned, ledgered, made, reported. Reversible; capped per run. |
| **confirm** | a person, per run | planned and named; made only when that run carries the person's yes (`--confirm=<id>`, or CONFIRM on desk panel 09). Same ledger, same reversibility. |
| **never** | nobody | reported and left. The entry's `why` names the rail it would cross. |

### Delegated today

| Action | Answers | Cap | Inverse |
| --- | --- | --- | --- |
| `data.prune-dangling-edges` | `data.dangling-edges` | 500 | the `(a, b, w)` rows are recorded; a revert re-inserts them verbatim |
| `catalog.hold-unshowable` | `catalog.integrity` | 50 | each item's prior `moderation_status` is recorded; a revert restores it, only if the item is still under review |
| `asterisk.promote-demand` | `asterisk.unknown-demand` | 10 | status returns to `observed`; promotion writes no knowledge, so nothing else is undone |

### Confirm today

| Action | Answers | Cap | Why a person |
| --- | --- | --- | --- |
| `commerce.reproject-order` | `commerce.order-projection` | 20 | money-adjacent. The fix is the ledger's own law (a paid event ⇒ a paid projection), no event is written and no mail is sent, but a person says yes each run. |

### Never — and why

`data.self-edges` (the CHECK makes one impossible; its presence means the
constraint is gone, and the inverse would violate it) · `data.foreign-counters`
(the check says some are expected) · `identity.orphan-interactions` (history;
a source-of-truth delete) · `db.rls-coverage`, `db.migration-ledger` (DDL — a
migration file, a PR, the admin URL) · `brain.learning`,
`asterisk.search-answer-rate`, `asterisk.reading-coverage` (code defects, not
data repairs).

And, not tied to any check: ranking dials (any `SEARCH_*` flag, gamma, parts,
the core slate — the owner's ruling on #336/#339 stands), money, mail, access,
DDL, deleting source-of-truth rows. `NEVER_DELEGATED` in the code names each.

## How a repair is made

One transaction: the `steward_actions` row is inserted, **then** the mutation
runs on the same connection. If the mutation touches a different number of
rows than the plan named, the whole transaction rolls back and the run reports
"the world moved between plan and act" with both numbers. A row claiming N
when M happened cannot exist; an effect with no row cannot either.

The ledger (`schema-v50-steward-ledger.sql`) is append-only for the runtime
role — SELECT and INSERT, nothing else, verified against production as
`asilum_app` (UPDATE and DELETE answer 42501). A revert is a new row whose
`reverts` names the row it undoes; it refuses to run twice.

Every mutation is guarded by the state it expects (`and moderation_status =
'visible'`, `and status = 'observed'`), so a row a person changed between plan
and act is not touched — it is counted as the world having moved.

## Where it runs

* **`npm run steward`** — the board, reads only. `--plan` adds what the hands
  would do (still reads only). `--act` makes the delegated repairs;
  `--act --confirm=<id>` adds a confirm-tier one. `--revert=<ledger id>`,
  `--ledger`, `--instruments`, `--record`.
* **Vercel cron** — `vercel.json` fires `/api/steward/run` daily at 05:17 UTC.
  The route answers 503 until `CRON_SECRET` is set on the deployment (Vercel
  sends it as a bearer; the gate is `lib/steward/cronGate.js`). It makes the
  delegated repairs and returns the report as JSON; confirm-tier repairs are
  named, never made, because nobody is present to say yes. The instruments do
  not run here (~20s of CPU; a 60s budget).
* **GitHub Actions** — `.github/workflows/steward.yml`, daily at 12:23 UTC.
  Reads only, by its own `contents: read`; records the run and runs the seven
  instruments (`GITHUB_ACTIONS=true` turns both on), so movement between
  nights has a history to compare against. The tier that acts on its own runs
  from the Vercel cron, not from here.
* **Desk panel 09** — the board, HANDS (planned repairs, ACT, CONFIRM), the
  findings, and the LEDGER with REVERT on every standing row.

## Adding an action

1. Write the check first, if it does not exist. A finding is a read.
2. Add the action to `lib/steward/actions.js`: `plan` (reads, names the exact
   rows and the exact inverse, honours the cap), `apply` (guarded by the
   state it expects, returns the count), `revert` (the inverse, same rule).
3. Declare it in `lib/steward/decisions.js` with a tier, a cap, a `why` and
   an `inverse` sentence. `tests/steward-hands.test.js` fails an action with
   no entry, an entry with no `why`, and a `never` entry with an
   implementation.
4. If it would cross a rail, it is `never`, and the `why` says which rail.

## The first act

Production, 3 September 2026, from the CLI: `data.prune-dangling-edges` ×4 —
applied, reverted (the four edges and their weights came back), a second
revert refused, applied again. Three ledger rows. The instruments and the
board were green before and after.
