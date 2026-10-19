// tests/steward-hands.test.js — the laws the steward's hands obey.
//
// The hands write to the live machine, so their tests must not need one: a
// fake `transact` records every statement in order, and the assertions are
// about ORDER and REFUSAL — the ledger row before the mutation, the cap on the
// plan, the tier that needs a yes, the tier nothing unlocks, the dry run that
// touches nothing, the revert that will not run twice. None of this can be
// seen from a green suite that only checks the SQL parses.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  actSteward, planRepairs, revertAction, readLedger, runSteward, schemaVersionsFrom,
  ACTIONS, BOUNDARY, NEVER_DELEGATED, TIERS, CHECKS,
} from "../lib/steward/index.js";
import { actionFor } from "../lib/steward/actions.js";
import { boundaryFor, permitted } from "../lib/steward/decisions.js";
import { cronGate } from "../lib/steward/cronGate.js";
import { movement } from "../lib/steward/instruments.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------
// A world the hands can act on. Every check reads ok except the ones named,
// and each named one has exactly the rows its action would plan against.
// ---------------------------------------------------------------------------
function world({ dangling = [], unshowable = [], demanded = [], drifted = [], applyCount = null, ledger = [] } = {}) {
  const log = [];            // every statement, in order, across every transaction
  const txs = [];            // one entry per transaction: { statements, committed }
  const route = (sql, params) => {
    // steward's own ledger
    if (sql.includes("insert into steward_actions")) return { rows: [] };
    if (sql.includes("insert into steward_runs")) return { rows: [] };
    if (sql.includes("from steward_actions a where a.id = $1")) return { rows: ledger.filter((r) => r.id === params[0]) };
    if (sql.includes("from steward_actions a")) return { rows: ledger };
    if (sql.includes("from steward_runs where instruments")) return { rows: [] };
    // checks
    if (sql.includes("pg_tables")) return { rows: [] };
    if (sql.includes("from items") && sql.includes("bad_price")) {
      return { rows: [{ total: 900, bad_price: unshowable.length, no_title: 0, no_brand: 0 }] };
    }
    if (sql.includes("count(*)::int as n from orders")) return { rows: [{ n: drifted.length ? 3 : 0 }] };
    if (sql.includes("from orders o") && sql.includes("count(*)")) return { rows: [{ n: drifted.length }] };
    if (sql.includes("fee_cents")) return { rows: [{ n: 0 }] };
    if (sql.includes("from app_schema_migrations")) return { rows: [{ version: 7 }, { version: 8 }] };
    if (sql.includes("from profiles")) return { rows: [{ profiles: 0, actors: 0 }] };
    if (sql.includes("search_logs")) return { rows: [{ total: 400, zero: 4, read: 400 }] };
    if (sql.includes("from unknown_queries") && sql.includes("demanded")) return { rows: [{ demanded: demanded.length, total: 9 }] };
    if (sql.includes("from edges where a = b")) return { rows: [{ n: 0 }] };
    if (sql.includes("from popularity p where not exists")) return { rows: [{ n: 0 }] };
    if (sql.includes("count(*)::int as n from popularity")) return { rows: [{ n: 10 }] };
    if (sql.includes("count(*)::int as n from edges e where not exists")) return { rows: [{ n: dangling.length }] };
    if (sql.includes("count(*)::int as n from edges")) return { rows: [{ n: 50 }] };
    if (sql.includes("from interactions")) return { rows: [{ n: 0 }] };
    // plans
    if (sql.includes("select a, b, w from edges e")) return { rows: dangling.slice(0, params[0]) };
    if (sql.includes("select id, moderation_status, title, price from items")) return { rows: unshowable.slice(0, params[0]) };
    if (sql.includes("select id, normalized_query, distinct_identities")) return { rows: demanded.slice(0, params[1]) };
    if (sql.includes("select o.id, o.status from orders o")) return { rows: drifted.slice(0, params[0]) };
    // mutations: touch exactly what was asked unless the test says the world moved
    if (/^\s*(delete|update|insert)/i.test(sql)) {
      const asked = Array.isArray(params?.[0]) ? params[0].length : 1;
      return { rows: Array.from({ length: applyCount ?? asked }, (_, i) => ({ id: i })) };
    }
    throw new Error(`unstubbed query: ${sql.slice(0, 70)}`);
  };
  const query = async (sql, params) => { log.push({ sql, params, tx: null }); return route(sql, params); };
  const transact = async (fn) => {
    const tx = { statements: [], committed: false };
    txs.push(tx);
    const q = async (sql, params) => { tx.statements.push({ sql, params }); log.push({ sql, params, tx }); return route(sql, params); };
    const out = await fn(q);
    tx.committed = true;
    return out;
  };
  return { ctx: { query, transact, schemaVersions: [7, 8], now: "2026-09-03T00:00:00Z" }, log, txs };
}

const DANGLING = [{ a: "x1", b: "gone", w: 0.4 }, { a: "gone", b: "x2", w: 0.1 }];
const UNSHOWABLE = [{ id: "i9", moderation_status: "visible", title: "Coat", price: null }];
const DEMANDED = [{ id: 41, normalized_query: "vetements 2016", distinct_identities: 4, reviewed_by: null }];
const DRIFTED = [{ id: "o7", status: "awaiting_payment" }];

// ---------------------------------------------------------------------------
// the boundary is total, and the never tier has no hands
// ---------------------------------------------------------------------------

test("every action is declared in the boundary, and every never entry has no implementation", () => {
  for (const a of ACTIONS) {
    const b = boundaryFor(a.id);
    assert.ok(b, `${a.id} has no boundary entry — an undeclared action must not exist`);
    assert.notEqual(b.tier, "never", `${a.id} is implemented but declared never`);
    assert.equal(b.check, a.check, `${a.id} answers ${a.check} but the boundary says ${b.check}`);
    assert.ok(Number.isInteger(b.cap) && b.cap > 0, `${a.id} needs a per-run cap`);
    assert.ok(b.inverse, `${a.id} must say what a revert does`);
  }
  for (const b of BOUNDARY) {
    assert.ok(TIERS.includes(b.tier), `${b.id}: unknown tier ${b.tier}`);
    assert.ok(b.why && b.why.length > 40, `${b.id}: the why is the decision — it must be written`);
    if (b.tier === "never") assert.equal(actionFor(b.id), null, `${b.id} is never-tier and must have no hands`);
    else assert.ok(actionFor(b.id), `${b.id} is ${b.tier} but nothing implements it`);
  }
  // Every check is either answered by an entry or explicitly not.
  const covered = new Set(BOUNDARY.map((b) => b.check));
  const unaddressed = CHECKS.map((c) => c.id).filter((id) => !covered.has(id));
  assert.deepEqual(unaddressed, [], "a check with no boundary entry is a decision nobody made");
  assert.ok(NEVER_DELEGATED.some((s) => /money/.test(s)) && NEVER_DELEGATED.some((s) => /mail/.test(s)) &&
    NEVER_DELEGATED.some((s) => /access/.test(s)) && NEVER_DELEGATED.some((s) => /ranking/.test(s)),
    "the four rails the waiver did not move must be named");
});

test("permitted: delegated runs, confirm needs a yes for this run, never has no key", () => {
  assert.equal(permitted("data.prune-dangling-edges").ok, true);
  const waiting = permitted("commerce.reproject-order");
  assert.equal(waiting.ok, false);
  assert.equal(waiting.awaiting, true);
  assert.match(waiting.why, /--confirm=commerce\.reproject-order/);
  assert.equal(permitted("commerce.reproject-order", { confirm: ["commerce.reproject-order"] }).ok, true);
  const never = permitted("identity.orphan-interactions", { confirm: ["identity.orphan-interactions"] });
  assert.equal(never.ok, false);
  assert.match(never.why, /^never:/, "a confirm cannot unlock the never tier");
  assert.match(permitted("made.up").why, /undeclared/);
});

// ---------------------------------------------------------------------------
// a plan is a read
// ---------------------------------------------------------------------------

test("planRepairs names what it would touch and writes nothing", async () => {
  const { ctx, log, txs } = world({ dangling: DANGLING, unshowable: UNSHOWABLE });
  const report = await runSteward(ctx);
  const plans = await planRepairs(ctx, report);
  assert.deepEqual(plans.map((p) => p.actionId).sort(), ["catalog.hold-unshowable", "data.prune-dangling-edges"]);
  const edges = plans.find((p) => p.actionId === "data.prune-dangling-edges");
  assert.equal(edges.count, 2);
  assert.deepEqual(edges.inverse, DANGLING, "the inverse IS the rows, not a description of them");
  assert.equal(txs.length, 0, "a plan opens no transaction");
  assert.ok(!log.some((l) => /^\s*(delete|update|insert)/i.test(l.sql)), "a plan issues no mutation");
});

test("every plan carries the boundary's cap as its LIMIT", async () => {
  const many = Array.from({ length: 700 }, (_, i) => ({ a: `a${i}`, b: "gone", w: 0 }));
  const { ctx, log } = world({ dangling: many });
  const plans = await planRepairs(ctx, await runSteward(ctx));
  const plan = plans.find((p) => p.actionId === "data.prune-dangling-edges");
  assert.equal(plan.count, 500, "700 dangling edges, 500 planned — the cap is per run");
  const q = log.find((l) => l.sql.includes("select a, b, w from edges e"));
  assert.match(q.sql, /limit \$1/);
  assert.equal(q.params[0], boundaryFor("data.prune-dangling-edges").cap);
  assert.match(plan.evidence, /capped at 500/);
});

// ---------------------------------------------------------------------------
// the ledger row goes first, and the count must match
// ---------------------------------------------------------------------------

test("an act is one transaction: the ledger row, then the mutation, then commit", async () => {
  const { ctx, txs } = world({ dangling: DANGLING });
  const out = await actSteward(ctx, { actor: "t", firedBy: "cli" });
  assert.equal(out.acts.length, 1);
  assert.equal(out.acts[0].state, "applied");
  assert.equal(out.acts[0].count, 2);
  assert.ok(out.runId, "an act run is recorded");
  // tx[0] is the run row; tx[1] is the action.
  assert.match(txs[0].statements[0].sql, /insert into steward_runs/);
  const act = txs[1];
  assert.match(act.statements[0].sql, /insert into steward_actions/, "the ledger row is the FIRST statement");
  assert.match(act.statements[1].sql, /^\s*delete from edges/, "the mutation comes after it");
  // The delete re-checks what the plan selected on, not just the key. The
  // stub honours any predicate, so this can only be asserted by text.
  assert.match(act.statements[1].sql, /not exists \(select 1 from items i where i\.id = e\.a\)/,
    "an edge whose item came back between plan and act must not be deleted");
  assert.equal(act.statements.length, 2);
  assert.equal(act.committed, true);
  const row = act.statements[0].params;
  assert.equal(row[2], "data.prune-dangling-edges");
  assert.equal(row[5], "applied");
  assert.equal(row[7], 2, "the row carries the planned count");
  assert.deepEqual(JSON.parse(row[9]), DANGLING, "the row carries the exact inverse");
  assert.match(out.hands, /1 repair\(s\) made/);
});

test("when the world moved between plan and act, the transaction throws and nothing stands", async () => {
  const { ctx, txs } = world({ dangling: DANGLING, applyCount: 1 });
  const out = await actSteward(ctx, { actor: "t" });
  assert.equal(out.acts[0].state, "failed");
  assert.match(out.acts[0].why, /planned 2, would have touched 1/);
  assert.equal(txs[1].committed, false, "the action transaction did not commit — the ledger row went with it");
  assert.match(out.hands, /some failed/);
});

test("a confirm-tier repair is planned and named but not made without a yes", async () => {
  const { ctx, txs } = world({ drifted: DRIFTED });
  const out = await actSteward(ctx, { actor: "t" });
  assert.equal(out.plans.length, 1);
  assert.equal(out.acts[0].state, "awaiting-confirmation");
  assert.equal(txs.length, 1, "only the run row was written");
  assert.match(out.hands, /awaiting a person's yes/);

  const yes = world({ drifted: DRIFTED });
  const made = await actSteward(yes.ctx, { actor: "t", confirm: ["commerce.reproject-order"] });
  assert.equal(made.acts[0].state, "applied");
  assert.match(yes.txs[1].statements[1].sql, /update orders o set status = 'paid'/);
  assert.match(yes.txs[1].statements[1].sql, /exists \(select 1 from order_events/, "the paid event is re-checked at write time");
});

test("a dry run makes no writes at all — not even the run row", async () => {
  const { ctx, txs, log } = world({ dangling: DANGLING, unshowable: UNSHOWABLE, demanded: DEMANDED });
  const out = await actSteward(ctx, { dryRun: true });
  assert.equal(out.plans.length, 3);
  assert.equal(out.acts.length, 0);
  assert.equal(out.runId, null);
  assert.equal(txs.length, 0);
  assert.ok(!log.some((l) => /^\s*(delete|update|insert)/i.test(l.sql)));
  assert.match(out.hands, /dry run/);
});

test("with no database the hands say so and touch nothing", async () => {
  const out = await actSteward({});
  assert.deepEqual(out.plans, []);
  assert.deepEqual(out.acts, []);
  assert.match(out.hands, /no database/);
});

test("promotion names its actor and re-checks the threshold at write time", async () => {
  const { ctx, txs } = world({ demanded: DEMANDED });
  const out = await actSteward(ctx, { actor: "steward:test" });
  assert.equal(out.acts[0].state, "applied");
  const upd = txs[1].statements[1];
  assert.match(upd.sql, /status = 'research_created'/);
  assert.match(upd.sql, /and status = 'observed' and distinct_identities >= \$3/);
  assert.equal(upd.params[1], "steward:test", "reviewed_by is the steward, by name");
  assert.equal(upd.params[2], 3);
});

test("holding a piece under review guards on 'visible' and records the prior status", async () => {
  const { ctx, txs } = world({ unshowable: UNSHOWABLE });
  const out = await actSteward(ctx, { actor: "t" });
  assert.equal(out.acts[0].state, "applied");
  const upd = txs[1].statements[1];
  assert.match(upd.sql, /set moderation_status = 'under_review'/);
  assert.match(upd.sql, /and moderation_status = 'visible'/);
  assert.match(upd.sql, /price is null or price <= 0 or title is null/,
    "a piece someone priced between plan and act must not be held");
  assert.deepEqual(JSON.parse(txs[1].statements[0].params[9]), [{ id: "i9", moderation_status: "visible" }]);
});

// ---------------------------------------------------------------------------
// revert
// ---------------------------------------------------------------------------

const APPLIED = {
  id: "11111111-1111-4111-8111-111111111111", action_id: "data.prune-dangling-edges", check_id: "data.dangling-edges",
  tier: "delegated", state: "applied", actor: "t", count: 2, evidence: "delete 2 edges", reverts: null,
  inverse: DANGLING, reverted: false,
};

test("a revert writes a 'reverted' row first, then the recorded inverse", async () => {
  const { ctx, txs } = world({ ledger: [APPLIED] });
  const r = await revertAction(ctx, APPLIED.id, { actor: "owner" });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.count, 2);
  const tx = txs[0];
  assert.match(tx.statements[0].sql, /insert into steward_actions/);
  assert.equal(tx.statements[0].params[5], "reverted");
  assert.equal(tx.statements[0].params[11], APPLIED.id, "the row names what it undoes");
  assert.match(tx.statements[1].sql, /insert into edges \(a, b, w\)/);
  assert.deepEqual(tx.statements[1].params[2], [0.4, 0.1], "the weights come back exactly");
  assert.equal(tx.committed, true);
});

test("a revert refuses a row already reverted, a row that is not applied, and a row that is not there", async () => {
  const twice = world({ ledger: [{ ...APPLIED, reverted: true }] });
  assert.match((await revertAction(twice.ctx, APPLIED.id)).why, /already reverted/);
  assert.equal(twice.txs.length, 0);
  const notApplied = world({ ledger: [{ ...APPLIED, state: "reverted" }] });
  assert.match((await revertAction(notApplied.ctx, APPLIED.id)).why, /not an applied action/);
  const missing = world();
  assert.match((await revertAction(missing.ctx, "22222222-2222-4222-8222-222222222222")).why, /no ledger row/);
});

test("a revert whose inverse no longer fits the world rolls back and says the numbers", async () => {
  const { ctx, txs } = world({ ledger: [APPLIED], applyCount: 1 });
  const r = await revertAction(ctx, APPLIED.id);
  assert.equal(r.ok, false);
  assert.match(r.why, /planned 2, would have touched 1/);
  assert.equal(txs[0].committed, false);
});

test("the ledger reads back newest first with a standing/reverted flag", async () => {
  const { ctx } = world({ ledger: [{ ...APPLIED, at: "2026-09-03T01:00:00Z", run_id: null }] });
  const rows = await readLedger(ctx, { limit: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actionId, "data.prune-dangling-edges");
  assert.equal(rows[0].reverted, false);
});

// ---------------------------------------------------------------------------
// the ledger check compares against the files that actually exist
// ---------------------------------------------------------------------------

test("schemaVersionsFrom reads NAMED migrations — anchored on the real directory", () => {
  const files = readdirSync(ROOT + "supabase");
  const versions = schemaVersionsFrom(files);
  // The exact failure this closes: the old matcher saw one file (v2) in a
  // directory of fifty, and the ledger check compared production to nothing.
  assert.ok(versions.length >= 40, `parsed ${versions.length} of ${files.length} files — the matcher is blind again`);
  assert.ok(versions.includes(49), "schema-v49-tag-facets.sql must be seen");
  assert.ok(versions.includes(50), "schema-v50-steward-ledger.sql must be seen");
  assert.deepEqual(schemaVersionsFrom(["schema.sql", "schema-v7.sql", "schema-alpha.sql", "schema-v36.sql", "notes.md", "schema-v49-tag-facets.sql"]), [7, 36, 49]);
  assert.deepEqual(schemaVersionsFrom(["schema-v49-tag-facets.sql.bak", "xschema-v3.sql"]), [], "a backup or a stray prefix is not a migration");
});

// ---------------------------------------------------------------------------
// the clock's gate
// ---------------------------------------------------------------------------

test("the cron gate: 503 unconfigured, 401 wrong bearer, ok on the secret", () => {
  const req = (auth) => new Request("https://asilum.test/api/steward/run", { headers: auth ? { authorization: auth } : {} });
  assert.equal(cronGate(req(null), {}).status, 503, "no secret means not configured, never open");
  assert.equal(cronGate(req("Bearer short"), { CRON_SECRET: "short" }).status, 503, "a short secret is no secret");
  const env = { CRON_SECRET: "a-real-secret-of-sufficient-length" };
  assert.equal(cronGate(req(null), env).status, 401);
  assert.equal(cronGate(req("Bearer nope-nope-nope-nope-nope"), env).status, 401);
  assert.equal(cronGate(req(`Bearer ${env.CRON_SECRET}`), env).ok, true);
});

test("vercel.json schedules the steward daily at the run route", async () => {
  const { readFileSync } = await import("node:fs");
  const v = JSON.parse(readFileSync(ROOT + "vercel.json", "utf8"));
  const cron = (v.crons || []).find((c) => c.path === "/api/steward/run");
  assert.ok(cron, "the steward's cron is declared");
  assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/, "daily — the hobby plan allows nothing finer");
});

// EVERY cron, not only the steward's (18 Oct 2026): slice 11 declared the
// sweeps hourly ("7 * * * *"); the Hobby plan refuses anything finer than
// daily and Vercel rejected every deployment from that commit on, silently
// from the branch's point of view. A finer schedule is a plan change, made on
// purpose, with this test changed alongside it.
test("vercel.json: every cron is daily at most — the plan refuses finer and fails the deployment", async () => {
  const { readFileSync } = await import("node:fs");
  const v = JSON.parse(readFileSync(ROOT + "vercel.json", "utf8"));
  assert.ok((v.crons || []).length >= 2, "the steward and the sweeps are declared");
  for (const c of v.crons || []) assert.match(c.schedule, /^\d+ \d+ \* \* \*$/, c.path + " runs once a day");
  assert.ok((v.crons || []).some((c) => c.path === "/api/sweeps"), "the sweeps still run");
});

// ---------------------------------------------------------------------------
// movement
// ---------------------------------------------------------------------------

test("movement says what changed between instrument runs and nothing else", () => {
  const a = { results: [{ id: "vibe-sweep", ok: true, defects: 0 }, { id: "cultural-reach", ok: true, defects: null }] };
  const b = { results: [{ id: "vibe-sweep", ok: false, defects: 3 }, { id: "cultural-reach", ok: true, defects: null }] };
  assert.deepEqual(movement(a, a), []);
  assert.deepEqual(movement(a, b), ["vibe-sweep: PASS → FAIL"]);
  assert.deepEqual(movement(null, b), ["no previous instrument run to compare against"]);
  const c = { results: [{ id: "vibe-sweep", ok: true, defects: 2 }, { id: "cultural-reach", ok: true, defects: null }] };
  assert.deepEqual(movement(a, c), ["vibe-sweep: 0 → 2 defects"]);
});
