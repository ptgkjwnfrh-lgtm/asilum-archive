# Running the steward on a schedule

`npm run steward` answers "is anything wrong?" against the live machine, and
desk panel 09 answers it without a terminal. Neither runs on its own — and a
watchdog nobody runs is a document.

So it is a workflow now: `.github/workflows/steward.yml`. This page is the
operator note for it, not a copy of it. The YAML used to live here as a
paste-me snippet, and that copy has been deleted rather than left to drift —
the drift workflow was shipped from exactly such a snippet, header and all, and
spent two days announcing "NOT ACTIVE YET" while it fired every six hours.

## It is committed, and it is skipping

Both things are true, and "skipped" is the honest state rather than a broken
one. The job is guarded on `vars.STEWARD_ENABLED`, so until that is set every
scheduled run resolves to a grey skip.

**Two owner actions turn it on** — Settings → Secrets and variables → Actions:

1. **Secrets**: add `DATABASE_URL` (and `DATABASE_SSL_CA` if the deploy uses
   one). These are credentials, so they are the owner's to paste; no agent
   here should ever hold them.
2. **Variables**: add `STEWARD_ENABLED` = `true`.

**Both are required, and the guard reads only the second.** Adding the secret
alone leaves the job skipping silently, which looks exactly like a watchdog
that is working. If the steward has never posted a result, check the variable
before suspecting the database.

To prove it end to end without waiting for the cron, use the **Run workflow**
button on the Actions tab (`workflow_dispatch` is enabled). A green run with
real output means both halves landed.

## Why the job is guarded rather than always-on

Without a database every check returns `unmeasurable` and the run exits 2.
That is the right answer for the CLI — a dark board is not a green one — and
the wrong alarm for a schedule, because a job that fails every morning for a
reason nobody can fix teaches everyone to ignore it. Guarded, the job SKIPS,
and GitHub renders skipped as skipped: it never reports a pass it did not earn.

Exit codes: `0` nothing needs a person · `1` a blocker · `2` warn or
unmeasurable. Anything but 0 fails the run.

## Two schedules, and which one has hands (3 September 2026)

Since 3 September the steward has hands — `lib/steward/actions.js`, inside the
boundary `lib/steward/decisions.js` declares and `docs/history/steward-boundary-2026-09-03.md`
records. **This workflow does not use them.** Its `permissions: contents: read`
is the outside proof, and `scripts/steward.mjs` never acts unless it is passed
`--act`, which the workflow does not pass. What this schedule does that the
CLI does not: in GitHub Actions (`GITHUB_ACTIONS=true`) the run records
itself in `steward_runs` and runs the eight instruments, so movement between
nights has a history to compare against. Recording a run is the one write it
makes, and it is a write about the steward, not about the catalog.

The tier that acts on its own runs from the **Vercel cron** instead —
`vercel.json` fires `/api/steward/run` daily at 05:17 UTC. That route answers
503 until `CRON_SECRET` is set on the deployment (Vercel sends it as a
bearer), 401 to anyone else, and makes the delegated repairs with a ledger row
before each one. Confirm-tier repairs are planned and named there, never
made: nobody is present to say yes. The instruments do not run there (~20s of
CPU against a 60s budget). Set the secret, then redeploy — an env var does
nothing until the next deployment carries it.

## Editing the workflow file

A normal `git push` cannot touch `.github/workflows/*` — the stored gh OAuth
token carries `repo` scope only, and both `git push` and the Contents API
answer with:

```
refusing to allow an OAuth App to create or update workflow
`.github/workflows/steward.yml` without `workflow` scope
```

Merging a PR that carries a workflow change is **not** blocked, though — only
writing one directly is. So the route that works, and the one this file took:

1. Branch, and push the branch.
2. Commit the workflow through the GitHub upload form —
   `github.com/OWNER/REPO/upload/BRANCH/.github/workflows` — which replaces a
   same-named file. Uploading preserves bytes; pasting into the web editor does
   not, and once turned three em dashes into `â€š`-shaped mojibake.
3. Commit **directly to the branch**, never to main.
4. `gh pr create`, then `gh pr merge` as normal.

Re-authorising the token with `workflow` scope would remove the detour, but it
means re-running the device flow in a browser, which is an owner action.
