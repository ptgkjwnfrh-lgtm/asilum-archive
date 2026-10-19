import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// The applied schema version must match the migrations actually committed.
// DERIVED rather than hardcoded (it read a literal 23 until Aug 6): CI applies
// every supabase/schema-v*.sql, so a literal turns "someone added a migration"
// into a red build that says only "25 !== 23" — and it fails on the ONE suite
// that skips locally without a database, so the author sees it first in CI.
// The substantive guard is unchanged: applied state must equal committed
// files, which still catches an out-of-band apply and a migration that forgot
// its app_schema_migrations row.
// `[-.]` rather than `-`: schema-v2.sql has no hyphen after its digit, so the
// old pattern silently skipped it. It never changed the max, which is exactly
// why nobody noticed.
function committedMigrations() {
  const dir = path.join(process.cwd(), "supabase");
  return fs.readdirSync(dir)
    .map((file) => ({ file, match: /^schema-v(\d+)[-.]/.exec(file) }))
    .filter((entry) => entry.match)
    .map((entry) => ({ version: Number(entry.match[1]), file: entry.file }))
    .sort((a, b) => a.version - b.version);
}

function committedSchemaVersion() {
  const versions = committedMigrations().map((m) => m.version);
  return versions.length ? Math.max(...versions) : 0;
}

// Migrations that do NOT write their own app_schema_migrations row, so the
// ledger legitimately has no entry for them. Everything here is historical:
// the ledger habit started at v7. They are listed one by one rather than as a
// range so that adding a NEW silent migration fails the guard below.
//
// v16 is claimed by TWO files. schema-v16-discover-rails.sql records version
// 16; schema-v16-embeddings.sql records nothing, so the `embeddings` table it
// creates is invisible to the ledger. Both are applied on live today, so there
// is no drift — but a fresh environment that skipped the embeddings file would
// look perfectly healthy. Renumbering it is the owner's call (flagged in
// docs/audit-verified-2026-08-14.md), so it is allowed for here rather than
// silently fixed.
const LEDGER_SILENT = new Map([
  [1, "schema-v1-brain.sql"],
  [2, "schema-v2.sql"],
  [3, "schema-v3-ai.sql"],
  [4, "schema-v4-asterisk.sql"],
  [5, "schema-v5-corrections.sql"],
  [6, "schema-v6-hardening.sql"],
]);
const DUPLICATE_VERSIONS = new Map([[16, ["schema-v16-discover-rails.sql", "schema-v16-embeddings.sql"]]]);

const databaseUrl = process.env.TEST_DATABASE_URL || "";

// The ledger REKEY that adoption performs had no Postgres coverage — exactly
// the gap #144 existed to close for the popularity write path. The statements
// run INSIDE adoptAccountData's transaction, and the unit suite that proves
// them runs mem-mode, so a Postgres-only fault (a parse error, a wrong
// conflict target, a recompute that reads a pre-write snapshot) would ship
// green. This drives the real transaction against a real database.
//
// THE ORDERING RULE THAT USED TO BE WRITTEN HERE IS GONE, AND THIS IS WHY.
//
// These tests once had to run BEFORE anything called pool.end(). The
// `?suffix=1` trick below gives each later test a fresh module instance, and
// that used to mean a private pool — but only because the pool state lived in
// the file being suffixed. production.js imports "./index.js" without a query
// string, so a suffixed production.js already reached for the DEFAULT pool,
// which the board/ticket test ends in its cleanup. CI caught it the first
// time these ran: "Cannot use a pool after calling end on the pool".
//
// The split of lib/db/index.js into ./core/ removed the trick entirely — the
// suffixed barrels all share one core/pool.js — so the rule was fixed at the
// source instead: getPool() now rebuilds an ended pool rather than handing
// back a dead handle forever (lib/db/core/pool.js). Ending a pool is no
// longer contagious, and no test's position in this file depends on another
// test's cleanup.
//
// Keep them here anyway. Nothing breaks if they move, but they read as the
// foundation the rest builds on.
test("Postgres adoption rekeys the identity_hash ledgers", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const device = `u-${randomUUID()}`;
  const account = `sb-${randomUUID()}`;
  const A = `pgadopt-a-${suffix}`;
  const B = `pgadopt-b-${suffix}`;
  const lo = A < B ? A : B, hi = A < B ? B : A;
  const item = `pgadopt-item-${suffix}`;

  t.after(async () => {
    await pool.query("DELETE FROM edge_contributors WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [[A, B]]);
    await pool.query("DELETE FROM edges WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [[A, B]]);
    await pool.query("DELETE FROM popularity_contributors WHERE item_id=$1", [item]);
    await pool.query("DELETE FROM popularity WHERE item_id=$1", [item]);
    await pool.query(
      "DELETE FROM identity_adoptions WHERE from_user_id=ANY($1::text[]) OR to_user_id=ANY($1::text[])",
      [[device, account]]);
    for (const uid of [device, account]) await production.purgePersonalizationData(uid).catch(() => {});
  });

  // The device corroborates a pair and an item, hard. Repetition buys nothing.
  for (let i = 0; i < 5; i++) {
    await db.bumpEdges([{ a: A, b: B, w: 2 }], device);
    await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], device);
  }
  let edge = (await pool.query("SELECT w,contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi])).rows[0];
  assert.equal(edge.contributors, 1, "device is ONE contributor before sign-in");

  // Sign in.
  await db.saveProfile(device, { long: { MINIMAL: 0.5 }, session: {}, _meta: {} });
  await production.adoptAccountData(device, account);

  // The rows must now BELONG to the account, not merely still exist.
  const stranded = await pool.query(
    "SELECT count(*)::int n FROM edge_contributors WHERE a=$1 AND b=$2 AND identity_hash=$3",
    [lo, hi, db.identityHash(device)]);
  assert.equal(stranded.rows[0].n, 0, "no ledger row left stranded under the device hash");

  // The same human, now signed in, engages the SAME pair and item again.
  await db.bumpEdges([{ a: A, b: B, w: 1 }], account);
  await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], account);

  edge = (await pool.query("SELECT w,contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi])).rows[0];
  assert.equal(edge.contributors, 1, "one human is still ONE contributor after signing in");
  assert.equal(Number(edge.w), 2, "GREATEST of the two bests (2 and 1), never their sum");

  const pop = (await pool.query(
    "SELECT engagers,viewers,engagers_decayed FROM popularity WHERE item_id=$1", [item])).rows[0];
  assert.equal(pop.engagers, 1, "one human, one engager");
  assert.equal(pop.viewers, 1, "one human, one viewer");
  // The recompute is a separate statement from the rekey for the same reason
  // writeEdges splits its two: a CTE fused onto the write reads a snapshot
  // taken at statement start and would lag by exactly one contributor.
  assert.ok(Math.abs(Number(pop.engagers_decayed) - 1) < 1e-4,
    `decayed engagers must collapse to one person, got ${pop.engagers_decayed}`);

  // Erasure must now reach what was corroborated BEFORE sign-in.
  await production.purgePersonalizationData(account);
  const leftEdge = await pool.query(
    "SELECT contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi]);
  assert.equal(leftEdge.rows[0]?.contributors ?? 0, 0,
    "pre-sign-in edge corroboration is erased with the account");
  const leftPop = await pool.query("SELECT engagers FROM popularity WHERE item_id=$1", [item]);
  assert.equal(leftPop.rows[0]?.engagers ?? 0, 0,
    "pre-sign-in engager is erased with the account");
});

// The early return that made the rekey above unreachable. adoptAccountData
// short-circuits when a prior adoption exists and the device shows no NEW
// signals — but "signals" enumerated user_id tables only, and the ledgers are
// keyed by identity_hash. GET /api/interpret writes unknown_query_votes and
// nothing else, so a signed-out search between two sign-ins produced exactly
// the state the short-circuit could not see.
//
// Postgres-only by construction: the mem path dedupes on an in-flight promise
// it deletes in `finally`, so it has no persistent `prior` and never takes
// this branch. That is why every mem-mode unit test misses it.
test("Postgres adoption does not short-circuit past ledger-only signals",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const device = `u-${randomUUID()}`;
  const account = `sb-${randomUUID()}`;
  const query = `pgshort-unknown-${suffix}`;

  t.after(async () => {
    await pool.query(
      `DELETE FROM unknown_query_votes WHERE query_id IN
         (SELECT id FROM unknown_queries WHERE normalized_query=$1)`, [query]);
    await pool.query("DELETE FROM unknown_queries WHERE normalized_query=$1", [query]);
    await pool.query(
      "DELETE FROM identity_adoptions WHERE from_user_id=ANY($1::text[]) OR to_user_id=ANY($1::text[])",
      [[device, account]]);
    for (const uid of [device, account]) await production.purgePersonalizationData(uid).catch(() => {});
  });

  // 1. A first, ordinary sign-in. This is what writes the identity_adoptions
  //    row that arms the short circuit.
  await db.saveProfile(device, { long: { MINIMAL: 0.4 }, session: {}, _meta: {} });
  await production.adoptAccountData(device, account);
  const prior = await pool.query(
    "SELECT 1 FROM identity_adoptions WHERE from_user_id=$1 AND to_user_id=$2", [device, account]);
  assert.equal(prior.rowCount, 1, "the prior adoption row exists");

  // 2. Signed out. A research-flagged search writes a vote and NOTHING else —
  //    no profile, no event, no search log, no interaction.
  await production.recordUnknownQuery(query, db.identityHash(device), "none");
  const linked = await pool.query(
    `SELECT (
       (SELECT count(*) FROM interactions WHERE user_id=$1) +
       (SELECT count(*) FROM user_events WHERE user_id=$1) +
       (SELECT count(*) FROM search_logs WHERE user_id=$1)
     )::int AS n`, [device]);
  assert.equal(linked.rows[0].n, 0, "the device really has no user_id-keyed signal");

  // 3. Sign back in. The short circuit must NOT fire.
  await production.adoptAccountData(device, account);

  const stranded = await pool.query(
    "SELECT count(*)::int n FROM unknown_query_votes WHERE identity_hash=$1",
    [db.identityHash(device)]);
  assert.equal(stranded.rows[0].n, 0, "the vote was rekeyed, not skipped");

  // And the tally is still honest: one human, one vote.
  const again = await production.recordUnknownQuery(query, db.identityHash(account), "none");
  assert.equal(again.distinctIdentities, 1, "one human is still one voter after signing back in");
});

// The mem/pg DIFFERENTIAL for operation replay across sign-in. Postgres rekeys
// processed_operations to the account; mem deleted the keys outright, so a
// replayed batch was refused on Postgres and re-applied in mem — the backend
// nearly every test and every preview deploy actually runs on. This is the
// Postgres half; tests/adoption-replay.test.js is the mem half, asserting the
// SAME answer, so the two can no longer drift apart silently.
test("Postgres refuses a replayed operation after sign-in", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const device = `u-${randomUUID()}`;
  const account = `sb-${randomUUID()}`;
  const item = `pgreplay-item-${suffix}`;
  const op = `pgreplay-op-${suffix}`.slice(0, 80);

  t.after(async () => {
    await pool.query("DELETE FROM popularity_contributors WHERE item_id=$1", [item]);
    await pool.query("DELETE FROM popularity WHERE item_id=$1", [item]);
    await pool.query(
      "DELETE FROM identity_adoptions WHERE from_user_id=ANY($1::text[]) OR to_user_id=ANY($1::text[])",
      [[device, account]]);
    for (const uid of [device, account]) await production.purgePersonalizationData(uid).catch(() => {});
  });

  const mkEvent = (uid) => ({
    itemId: item, action: "favorite", dwellMs: null,
    canonicalEvent: { userId: uid, type: "USER_FAVORITED_ITEM", payload: { itemId: item } },
  });
  const reduce = () => ({
    profile: { long: { TAILORED: 1 }, session: {}, _meta: {} },
    edgePairs: [],
    popularity: [{ id: item, eng: 1, imp: 1 }],
  });

  const first = await db.commitInteractionBatch({
    userId: device, operationId: op, events: [mkEvent(device)], reduce });
  assert.equal(first.duplicate, false, "the first commit applies");

  await production.adoptAccountData(device, account);

  const moved = await pool.query(
    "SELECT count(*)::int n FROM processed_operations WHERE user_id=$1 AND operation_id=$2",
    [account, op]);
  assert.equal(moved.rows[0].n, 1, "the operation id moved to the account");
  const stranded = await pool.query(
    "SELECT count(*)::int n FROM processed_operations WHERE user_id=$1", [device]);
  assert.equal(stranded.rows[0].n, 0, "and nothing is left under the device");

  const replay = await db.commitInteractionBatch({
    userId: account, operationId: op, events: [mkEvent(account)], reduce });
  assert.equal(replay.duplicate, true, "replay after sign-in is refused, same as mem");

  const pop = (await pool.query(
    "SELECT eng,imp FROM popularity WHERE item_id=$1", [item])).rows[0];
  assert.equal(Number(pop.eng), 1, "raw engagement counter did not double");
  assert.equal(Number(pop.imp), 1, "raw impression counter did not double");
});

// THE STRUCTURAL TEST. Round A found four bugs in adoption, and THREE of them
// were invisible for the same reason: mem and Postgres disagreed, and almost
// every test runs mem. Each was caught by hand, one at a time:
//
//   #149  the identity_hash ledgers were never moved
//   #150  the early return could skip that move (Postgres only)
//   #151  mem deleted operation ids where Postgres rekeyed them
//
// Hand-diffing two backends does not scale and does not stay done. This runs
// ONE scenario through BOTH and asserts the observable outcomes are identical,
// so the next divergence fails a test instead of waiting to be noticed.
//
// Two child processes rather than two module instances: getPool() caches, and
// production.js imports "./index.js" without a query string, so a suffixed
// import still binds the default pool. One process cannot host both backends.
//
// Skipped without TEST_DATABASE_URL — there is no Postgres to differ FROM.
//
// IT LIVES IN THIS FILE ON PURPOSE. It was written as its own suite and its
// first CI run reported "ok ... # SKIP": CI sets TEST_DATABASE_URL only on the
// step that runs THIS file, so a database-gated suite anywhere else skips in
// the unit step and never runs at all, reporting as coverage while providing
// none. Adding it to the workflow would have been the other fix; this one
// needs no `workflow` token scope. A new database-backed test belongs here
// unless someone also edits .github/workflows/ci.yml.
//
// It spawns child processes and does not touch the shared pool, so its
// position relative to the board/ticket test does not matter — but it is kept
// above it with the others for one obvious rule rather than two.
test("mem and Postgres agree on the whole adoption scenario",
  { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "adoption-scenario.mjs");

  // Distinct run ids: the two runs must not collide on shared state, and the
  // Postgres run writes real rows it then cleans up.
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());

  // Field by field, so a failure names the divergence instead of dumping two
  // blobs and leaving the reader to spot the difference.
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort(),
    "both backends must report the same snapshot shape");

  // Guard the guard: a scenario that silently degraded to nothing would make
  // every comparison above trivially true. Pin the facts Round A established.
  assert.equal(mem.adoption.movedProfile, true, "the scenario must actually adopt a profile");
  assert.equal(mem.deviceProfileEmpty, true, "adoption empties the device (#148)");
  assert.equal(mem.edgeContributors, 1, "one human is one contributor (#149)");
  assert.equal(mem.popularity.engagers, 1, "one human is one engager (#149)");
  assert.equal(mem.replayAfterAdoptionDuplicate, true, "a replayed op is refused (#151)");
  // #148. This scenario's evidence ratio is 45:5, not the 500:5 of the unit
  // battery, so the account keeps ~77% of its conviction rather than ~99%.
  // The property being pinned is that it beats the OLD flat average, which for
  // 0.8 and 0.1 was exactly 0.45 — not any particular tuned number.
  assert.ok(mem.accountLong.TAILORED > 0.55,
    `evidence weighting must beat the old 0.45 flat average (#148), got ${mem.accountLong.TAILORED}`);
  assert.ok(mem.accountLong.TAILORED < 0.8,
    "and the device must still move it — this is a merge, not account-wins");
  assert.deepEqual(mem.accountSeen, ["acct-a", "dev-a"], "the _meta rings merge, not overwrite");
});

// ASTERISK governance (slice 5) has a mem branch and a Postgres branch for
// every function in lib/db/production/asterisk.js; the unit battery runs mem.
test("mem and Postgres agree on the ASTERISK governance scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "governance-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  // guard the guard
  assert.equal(mem.override.ok, true); assert.equal(mem.overrideTwice, false);
  assert.deepEqual(mem.queueOrder, ["-b", "-a"], "fraud before value");
  assert.equal(mem.paused.queued, true); assert.equal(mem.paused.ran, 0);
});

// Native commerce (slice 6) has a mem branch and a Postgres branch for every
// function in lib/db/production/commerce.js; the unit battery runs mem.
test("mem and Postgres agree on the native commerce scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "commerce-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.accepted.price, 15000); assert.equal(mem.closed, "OFFERS_CLOSED"); assert.equal(mem.relist.ok, true);
});

// After the sale (slice 7) has a mem branch and a Postgres branch for every
// function in lib/db/production/{aftersale,score,credit}.js; the unit battery runs mem.
test("mem and Postgres agree on the after-sale scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "aftersale-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.settled.creditKind, "refund"); assert.equal(mem.review1.published, 0); assert.equal(mem.review2.published, 2);
});

// BRDCST (slice 8) has a mem branch and a Postgres branch for every function
// in lib/db/production/brdcst.js; the unit battery runs mem.
test("mem and Postgres agree on the BRDCST scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "brdcst-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.delivery.near.footer, true); assert.equal(mem.delivery.far.footer, false); assert.equal(mem.cancelled.unused, 4); assert.equal(mem.late.billedDays, 5);
});

// MOTION assets (slice 9) have a mem branch and a Postgres branch for every
// function in lib/db/production/media.js; the unit battery runs mem.
test("mem and Postgres agree on the MOTION asset scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "media-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.ready.state, "ready"); assert.equal(mem.refused.code, "codec"); assert.equal(mem.captions.length, 2); assert.equal(mem.foreignCaptions, "NOT_YOURS");
});

// Identity (slice 10b) has a mem branch and a Postgres branch for every function
// in lib/db/production/identity.js; the unit battery runs mem.
test("mem and Postgres agree on the identity scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "identity-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.noConsent, "CONSENT_REQUIRED"); assert.equal(mem.scoreAfter, "0.0 ★ · No reviews"); assert.equal(mem.erased, true);
  assert.equal(mem.orphanReview, "ORDER_NOT_FOUND", "a review without an order is refused, not stored");
});

// Money in motion (slice 11) has a mem branch and a Postgres branch for every
// function in lib/db/production/money.js; the unit battery runs mem.
test("mem and Postgres agree on the money scenario", { skip: !databaseUrl }, async () => {
  const scenario = path.join(process.cwd(), "tests", "helpers", "money-scenario.mjs");
  const memRun = await run(process.execPath, [scenario, `mem${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  });
  const pgRun = await run(process.execPath, [scenario, `pg${randomUUID().slice(0, 8)}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const mem = JSON.parse(memRun.stdout.trim().split("\n").pop());
  const pg = JSON.parse(pgRun.stdout.trim().split("\n").pop());
  assert.equal(mem.error, undefined, mem.error);
  assert.equal(pg.error, undefined, pg.error);
  for (const key of Object.keys(mem)) {
    assert.deepEqual(pg[key], mem[key],
      `backends diverge on "${key}":\n  mem = ${JSON.stringify(mem[key])}\n  pg  = ${JSON.stringify(pg[key])}`);
  }
  assert.deepEqual(Object.keys(pg).sort(), Object.keys(mem).sort());
  assert.equal(mem.sellerDelivery.moved, false); assert.equal(mem.payoutOpen, "releasable"); assert.equal(mem.released.net, 7500); assert.equal(mem.released.twice, "NOT_RELEASABLE");
});

// The §6 export has a mem branch and a Postgres branch, and AGENTS.md makes
// mem/pg parity a hard rule — the unit battery in tests/privacy-export.test.js
// runs mem, so a Postgres-only fault in the export would ship green.
test("Postgres assembles the §6 export with the same shape as mem", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const pool = await db.getPool();
  const user = `u-${randomUUID()}`;
  const item = `pgexport-item-${randomUUID()}`;

  t.after(async () => {
    await pool.query("DELETE FROM popularity_contributors WHERE item_id=$1", [item]);
    await pool.query("DELETE FROM popularity WHERE item_id=$1", [item]);
    await production.purgePersonalizationData(user).catch(() => {});
  });

  await db.saveProfile(user, { long: { TAILORED: 0.8 }, session: {}, _meta: { seen: ["x"] } });
  await db.recordInteraction(user, item, "favorite", null);
  await production.setFollow(user, "brand", "Helmut Lang", true);
  await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], user);

  const out = await production.exportPersonalizationData(user);

  assert.equal(out.persistent, true, "this must be the Postgres branch, not a mem fallback");
  assert.equal(out.identity.kind, "device");
  assert.equal(out.data.taste.long.TAILORED, 0.8, "taste comes back");
  assert.equal(out.data.interactions.rows.length, 1, "interactions come back");
  assert.deepEqual(out.data.follows.map((f) => f.target), ["Helmut Lang"]);
  assert.equal(out.counts.corroboration.popularity, 1, "the ledger count is real on Postgres too");

  // Same SHAPE as mem: every bounded domain reports its cap and truncation.
  for (const d of [out.data.interactions, out.data.events, out.data.searches,
                   out.data.wardrobe, out.data.corrections, out.data.editorial,
                   out.data.aiEvents, out.data.stylist.requests]) {
    assert.ok(Array.isArray(d.rows), "bounded domain carries rows");
    assert.equal(typeof d.cap, "number", "and states its cap (§6: no silent caps)");
    assert.equal(typeof d.truncated, "boolean", "and whether it truncated");
  }

  // Export and delete must describe the same retained world on this backend too.
  const purged = await production.purgePersonalizationData(user);
  assert.deepEqual(out.retained, purged.retained);
});

// WHY THESE EXIST (audit resume, Aug 14 — law 4 of HANDOVER-2026-08-08:
// "mem and Postgres are one system with two implementations, and mem is the
// one being exercised"). The v27 lifecycle verbs and the v28 engagement
// ledger shipped with mem-mode unit tests, and every hand-walk of them ran
// on the mem preview — so their SQL had never once executed against
// Postgres. A parse error, a wrong conflict target, or a predicate that
// behaves differently in SQL than in the mem filter would have shipped
// green. These run the real statements against a real database.
// ---------------------------------------------------------------------------
// THE MAIL DESK STORE, end to end. lib/db/dm.js has no memory mirror by
// design, so this is the ONLY place its behaviour is exercised. If these do
// not run, the store is unproven — which is the point of putting them here
// rather than writing a mem mirror the unit suite would certify instead.
//
// THESE LIVE ABOVE THE BOARD/TICKET TEST, ON THE DEFAULT POOL, AND END
// NOTHING. lib/db/dm.js imports "./index.js" with NO query suffix, so a
// suffixed pool in the test does not reach it — the store still asks for the
// DEFAULT pool, and the board/ticket test ends that one in its cleanup. Placed
// below it, every store test failed with "Cannot use a pool after calling end
// on the pool". This is the trap the note at the top of this file describes,
// walked into exactly as written.

test("DM store: a stranger's first message lands in REQUESTS, with no preview",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "  hello there  " });

  // the RECIPIENT sees a request, and the request carries no words
  const theirRequests = await dm.listFolder(b, { folder: "requests" });
  assert.equal(theirRequests.items.length, 1);
  assert.equal(theirRequests.items[0].unread, 1, "unread is DERIVED, not counted");
  assert.equal(theirRequests.items[0].preview, null,
    "a request must not put a stranger's words in the recipient's list");
  assert.equal((await dm.listFolder(b, { folder: "inbox" })).items.length, 0);

  // the SENDER's own copy is in their inbox — they chose to send it
  const mine = await dm.listFolder(a, { folder: "inbox" });
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].preview, "hello there", "trimmed, and visible to its author");
  assert.equal(mine.items[0].unread, 0, "your own message is not unread to you");

  const summary = await dm.unreadSummary(b);
  assert.deepEqual(summary, { inbox: 0, requests: 1 });
});

test("DM store: accepting moves the thread and opens the channel",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "knock" });

  // the one-knock law, through the store
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: a, body: "again" }),
    (e) => e.name === "MessageRefused" && e.code === "P0003");

  assert.equal(await dm.acceptRequest(b, convo.id), true);
  assert.equal((await dm.listFolder(b, { folder: "requests" })).items.length, 0);
  assert.equal((await dm.listFolder(b, { folder: "inbox" })).items.length, 1,
    "an accepted thread leaves the requests queue");
  // and now the initiator may speak freely
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "thanks for accepting" });

  // the accepted thread DOES show a preview
  const inbox = await dm.listFolder(b, { folder: "inbox" });
  assert.equal(inbox.items[0].preview, "thanks for accepting");
});

test("DM store: an idempotent retry returns the ORIGINAL, even after a block",
  { skip: !databaseUrl }, async () => {
  // The red team's finding: the block trigger fires BEFORE INSERT, so a design
  // that detects duplicates by catching the unique violation reports an
  // already-delivered message as undelivered. Resolving by SELECT first is the
  // fix, and this is the sequence that proves it.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);

  const op = "retry-token-0001";
  const first = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "did this land?", clientOperationId: op });
  assert.equal(first.duplicate, false);

  // b now blocks a — the response to the FIRST send was lost, and a retries
  await dm.blockAccount(b, a);
  const retry = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "did this land?", clientOperationId: op });
  assert.equal(retry.duplicate, true, "the retry must recognise its own delivered message");
  assert.equal(Number(retry.id), Number(first.id));

  // a genuinely NEW message is still refused
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello?" }),
    (e) => e.name === "MessageRefused" && e.code === "P0001");
});

test("DM store: declining blocks, and the block is LISTED BACK to its author",
  { skip: !databaseUrl }, async () => {
  // The red team found a decline installing a permanent block that an
  // ambiguous refusal then hid from the person who made it.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });

  assert.equal(await dm.declineRequest(b, convo.id), true);
  const blocks = await dm.listBlocks(b);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].accountId, a);
  assert.equal(blocks[0].source, "decline",
    "distinguished from a manual block so it can be shown and undone");
  assert.equal(await dm.iBlocked(b, a), true, "so the refusal shown to b names b's own block");

  // and it is undoable
  assert.equal(await dm.unblockAccount(b, a), true);
  assert.equal(await dm.iBlocked(b, a), false);
});

test("DM store: a declined request cannot later be accepted",
  { skip: !databaseUrl }, async () => {
  // BLOCKER 1 of the 23 Aug register. `acceptRequest`'s predicate was
  // `state <> 'accepted'`, which reads a DECLINED row as acceptable. The
  // register reaches this state through a double-tap racing on the pair lock,
  // but no race is needed: decline, then ACCEPT from a panel that has not
  // reloaded. The result displayed as an accepted thread in the inbox while
  // LAW 1 refused every message in both directions, because the decline's
  // block row was still there — a conversation that is alive on screen and
  // dead in the database.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });
  assert.equal(await dm.declineRequest(b, convo.id), true);

  assert.equal(await dm.acceptRequest(b, convo.id), false,
    "a decline is a decision, not a state to be overwritten");

  const row = (await pool.query(
    `SELECT state, accepted_at, declined_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0];
  assert.equal(row.state, "declined");
  assert.equal(row.accepted_at, null, "and it never became half-accepted");
  assert.ok(row.declined_at, "the decline is still on the record");

  // the two visible halves of the hybrid state, both checked
  assert.equal(await dm.iBlocked(b, a), true, "the decline's block still stands");
  assert.equal((await dm.listFolder(b, { folder: "inbox" })).items.length, 0,
    "and a dead conversation is not sitting in the inbox looking alive");
});

test("DM store: only the RECIPIENT can decline, and only an undecided request",
  { skip: !databaseUrl }, async () => {
  // BLOCKER 3 of the 23 Aug register. `declineRequest` checked that the
  // caller was A participant, never that they were the recipient, and its
  // UPDATE had no state predicate. An opener who declined their own thread
  // hit LAW 1's `state='declined' AND sender = opened_by` and was refused
  // forever with no way back: accept requires `opened_by <> me`, there is no
  // block to unblock, and UNIQUE(lo,hi) makes a second thread unrepresentable.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  // the opener cannot decline their own knock
  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });
  assert.equal(await dm.declineRequest(a, convo.id), false,
    "declining is the recipient's answer to a knock, not the knocker's");
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0].state, "requested");
  // and the proof it was not silently half-applied: a can still be accepted
  assert.equal(await dm.acceptRequest(b, convo.id), true);

  // nor can either side decline a thread that was already accepted
  assert.equal(await dm.declineRequest(a, convo.id), false, "an accepted thread is past declining");
  assert.equal(await dm.declineRequest(b, convo.id), false);
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0].state, "accepted");
  assert.equal(await dm.iBlocked(a, b), false, "and no block was installed on the way past");
  assert.equal(await dm.iBlocked(b, a), false);
  // the channel is still open in both directions, which is the whole point
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "still here" });
  await dm.sendMessage({ conversationId: convo.id, senderId: b, body: "so am I" });
});

test("DM store: declining twice is the same decline, not a second one",
  { skip: !databaseUrl }, async () => {
  // The state predicate added for blockers 1 and 3 must not turn a double-tap
  // into a refusal the panel cannot explain. Declining an already-declined
  // request is what the caller asked for and already true, so it answers true
  // — without moving declined_at, which is evidence.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });

  assert.equal(await dm.declineRequest(b, convo.id), true);
  const first = (await pool.query(
    `SELECT declined_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0].declined_at;
  assert.equal(await dm.declineRequest(b, convo.id), true, "idempotent, not a refusal");
  const second = (await pool.query(
    `SELECT declined_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0].declined_at;
  assert.deepEqual(second, first, "the second tap did not restamp the record");
  // and accepting is still shut, which is the law the idempotence must not reopen
  assert.equal(await dm.acceptRequest(b, convo.id), false);
});

test("DM store: a message written later reads later, whatever now() says",
  { skip: !databaseUrl }, async () => {
  // BLOCKER 2 of the 23 Aug register, at its root. `now()` is the TRANSACTION
  // START time in PostgreSQL — fixed at BEGIN and never moved again — so a
  // transaction that begins early and commits late stamps a row that lands
  // second with a time from before the row that landed first. The pair
  // advisory lock is taken AFTER BEGIN, which is exactly such a wait.
  //
  // No race is staged here and none is needed: two transactions, interleaved
  // by hand, reproduce the inversion deterministically. Message two is
  // inserted after message one commits, so it has the LATER id — and under
  // `DEFAULT now()` it carried the EARLIER created_at.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);

  const early = await pool.connect();
  const late = await pool.connect();
  try {
    // `early` begins first, so its now() is fixed here...
    await early.query("BEGIN");
    await early.query("SELECT 1");
    await new Promise((r) => setTimeout(r, 60));
    // ...but `late` begins, inserts and commits entirely inside that gap.
    await late.query("BEGIN");
    const first = await late.query(
      `INSERT INTO dm_messages (conversation_id, sender_account_id, body)
       VALUES ($1,$2,'first to land') RETURNING id, created_at`, [convo.id, a]);
    await late.query("COMMIT");
    // and only now does the transaction that began earlier write its row
    const second = await early.query(
      `INSERT INTO dm_messages (conversation_id, sender_account_id, body)
       VALUES ($1,$2,'second to land') RETURNING id, created_at`, [convo.id, a]);
    await early.query("COMMIT");

    assert.ok(Number(second.rows[0].id) > Number(first.rows[0].id),
      "the second insert has the later id — that is not in question");
    assert.ok(second.rows[0].created_at >= first.rows[0].created_at,
      "and its stamp must not be earlier than the message it followed: the thread "
      + "reads newest-first BY ID, so a backwards clock renders out of order");
  } finally {
    await early.query("ROLLBACK").catch(() => {});
    await late.query("ROLLBACK").catch(() => {});
    early.release(); late.release();
  }
});

test("DM store: a conversation's activity time is the newest message's, and never walks back",
  { skip: !databaseUrl }, async () => {
  // The other half of blocker 2. listFolder's keyset cursor is
  // `(last_activity_at, id) < (cursor)` under `ORDER BY last_activity_at DESC`
  // — built on the key only ever moving forward. `SET last_activity_at = now()`
  // could move it backwards past a write that had already committed: the
  // conversation then falls below a cursor it was returned above, comes back
  // on the next page, and the panel's de-dupe drops it and spends the slot.
  //
  // The forward stamp here stands in for that already-committed writer. It is
  // set directly rather than raced, because a test that only fails on an
  // unlucky schedule is not a regression test.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);

  const sent = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "one" });
  const after = (await pool.query(
    `SELECT last_activity_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0];
  assert.deepEqual(after.last_activity_at, sent.at,
    "the activity time IS the newest message's time — not a second clock reading");

  // somebody else's write lands ahead of us
  const ahead = new Date(Date.now() + 60_000);
  await pool.query(`UPDATE dm_conversations SET last_activity_at=$2 WHERE id=$1`, [convo.id, ahead]);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "two" });
  const now = (await pool.query(
    `SELECT last_activity_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0];
  assert.deepEqual(now.last_activity_at, ahead,
    "a send must never move the inbox key backwards past a write already made");
});

test("DM store: the block a decline made can be undone without an account id",
  { skip: !databaseUrl }, async () => {
  // The register's SERIOUS finding: the request banner promised "you can undo
  // that in settings" and no such surface existed — nothing outside the route
  // and the store referenced unblock at all. The one API that could have
  // served it keyed on a raw account uuid, which the client has never held and
  // must not: route.js strips it from every inbox row on purpose.
  //
  // So the undo names the person the two ways a client legitimately can.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  // BY CONVERSATION — the case that matters, because knocking requires no room
  // of your own, so most people a decline blocks have no handle to name.
  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });
  assert.equal(await dm.declineRequest(b, convo.id), true);

  const listed = await dm.listBlocks(b);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].conversationId, convo.id,
    "the row carries the conversation, which is the handle-free way to name them");
  assert.equal(listed[0].source, "decline");

  // the other party cannot undo MY block through their copy of the thread
  assert.equal(await dm.unblockByConversation(a, convo.id), false,
    "a block is undone by the person who made it, not by its target");
  assert.equal(await dm.iBlocked(b, a), true);

  assert.equal(await dm.unblockByConversation(b, convo.id), true);
  assert.equal(await dm.iBlocked(b, a), false);
  assert.equal((await dm.listBlocks(b)).length, 0);
  assert.equal(await dm.unblockByConversation(b, convo.id), false, "and once is once");

  // BY HANDLE — resolved against profile_rooms directly, NOT through
  // resolveAddressee, which excludes the very people this is for.
  const { lo: me, hi: them } = await dmAccounts(pool);
  const tag = randomUUID().slice(0, 6);
  await publishRoom(pool, them, `ub${tag}`);
  await dm.blockAccount(me, them);
  assert.equal(await dm.resolveAddressee(me, `ub${tag}`), null,
    "someone I blocked is unaddressable — which is why the undo cannot go through that path");
  assert.equal(await dm.unblockByHandle(me, `ub${tag}`), true);
  assert.equal(await dm.iBlocked(me, them), false);
  assert.equal(await dm.unblockByHandle(me, `ub${tag}`), false);
  assert.equal(await dm.unblockByHandle(me, "no"), false, "a handle too short to be one");
});

test("DM presence: a knock is not a conversation yet",
  { skip: !databaseUrl }, async () => {
  // A SERIOUS finding of the 23 Aug register, and the same omission twice.
  // v42 refused reactions on an unaccepted conversation because "a reaction on
  // an unaccepted request is a notification a stranger can send". The typing
  // channel shipped one migration EARLIER and never got the rule; and the
  // receipt a stranger can READ never got it either — opening a knock to see
  // who it was told the sender a real human had opened it, which is the
  // tracking-pixel confirmation that separates a live address from a dead one.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  const knock = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello?" });

  // THE READ SIDE. b opens the request to see who it is — which marks it read,
  // because unread must clear when you look at it.
  await dm.markRead(b, convo.id, knock.id);
  const beforeAccept = await dm.peerActivity(a, convo.id);
  assert.deepEqual(
    { typing: beforeAccept.typing, readYours: beforeAccept.readYours },
    { typing: false, readYours: false },
    "a stranger learns nothing from a knock being opened");

  // THE WRITE SIDE, through the store: nothing is broadcast either way.
  assert.equal(await dm.pingTyping(b, convo.id), false, "and nothing is broadcast from one");
  assert.equal(await dm.pingTyping(a, convo.id), false);

  // and the LAW, not just the caller: a direct insert is refused by the
  // trigger, because the route is not the only writer.
  await assert.rejects(
    () => pool.query(
      `INSERT INTO dm_typing (conversation_id, account_id, typing_until)
       VALUES ($1,$2, now() + interval '6 seconds')`, [convo.id, b]),
    (e) => e.code === "P0003", "the trigger is where the law lives");

  // ACCEPTED, and both halves come alive.
  assert.equal(await dm.acceptRequest(b, convo.id), true);
  assert.equal(await dm.pingTyping(b, convo.id), true);
  const afterAccept = await dm.peerActivity(a, convo.id);
  assert.equal(afterAccept.typing, true, "now presence means something");
  assert.equal(afterAccept.readYours, true, "and so does the receipt");
});

test("DM unsend: a reaction cannot land on a tombstone",
  { skip: !databaseUrl }, async () => {
  // A SERIOUS finding of the 23 Aug register. dm_guard_reaction read the
  // message with a plain, NON-LOCKING SELECT, so a reaction inserted at the
  // same instant as an unsend passed its check (unsent_at still NULL), the
  // sweep ran before that insert committed and deleted nothing, and the
  // reaction stayed on a withdrawn message forever — visible to the author,
  // removable only by the person who left it.
  //
  // This is deterministic, not a race: the reaction is held OPEN in its own
  // transaction, which is the same state the racing insert is in at the
  // instant that matters. If the guard takes no lock the unsend sails past it.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "the thing" });

  const reactor = await pool.connect();
  let unsend;
  try {
    await reactor.query("BEGIN");
    // b reacts. v47's FOR SHARE means this row is now pinned until b commits.
    await reactor.query(
      // The palette is a LAW TABLE and dm_reactions carries an FK to it, so
      // this has to be a real one: \u2665 is the house heart.
      `INSERT INTO dm_reactions (message_id, account_id, emoji) VALUES ($1,$2,'\u2665')`,
      [m.id, b]);

    // a unsends at the same instant. It must WAIT — this is the assertion that
    // fails without the lock, because the UPDATE would otherwise sail through
    // and its DELETE would find nothing to remove.
    unsend = dm.unsendMessage(a, m.id);
    const raced = await Promise.race([
      unsend.then(() => "finished"),
      new Promise((r) => setTimeout(() => r("waiting"), 400)),
    ]);
    assert.equal(raced, "waiting",
      "the unsend must wait for the reaction it is about to sweep");

    await reactor.query("COMMIT");
  } finally {
    reactor.release();
  }

  assert.equal(await unsend, true, "and then it proceeds");
  const left = await pool.query(`SELECT count(*)::int AS n FROM dm_reactions WHERE message_id=$1`,
    [m.id]);
  assert.equal(left.rows[0].n, 0, "no heart survives on the tombstone");

  // the other ordering: once it IS unsent, the guard refuses outright
  await assert.rejects(
    () => pool.query(
      `INSERT INTO dm_reactions (message_id, account_id, emoji) VALUES ($1,$2,'\u2665')`,
      [m.id, b]),
    (e) => e.code === "P0005", "nothing to react to once it is gone");

  // and the withdrawal itself is intact and idempotent
  const row = (await pool.query(
    `SELECT body, unsent_at FROM dm_messages WHERE id=$1`, [m.id])).rows[0];
  assert.equal(row.body, null);
  assert.ok(row.unsent_at);
  assert.equal(await dm.unsendMessage(a, m.id), false, "an unsend cannot be undone or repeated");
});

test("DM settings: a refused half rolls the other half back",
  { skip: !databaseUrl }, async () => {
  // A SERIOUS finding of the 23 Aug register. The settings op applied
  // activity_signals and dms_open as two separate autocommit statements. A
  // BUSINESS closing its door is refused by the v40 trigger — and by then the
  // signals write had already committed, so the caller got a 409 with half of
  // what they asked for standing, and the refusal body carried no state to
  // tell them which half.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: shop } = await dmAccounts(pool);
  await pool.query(`INSERT INTO account_kinds (account_id, kind) VALUES ($1,'business')
                    ON CONFLICT (account_id) DO UPDATE SET kind='business'`, [shop]);

  assert.equal(await dm.readActivitySignals(shop), true, "the default both start from");
  assert.equal(await dm.readDmsOpen(shop), true);

  await assert.rejects(
    () => dm.setDmSettings(shop, { activitySignals: false, dmsOpen: false }),
    (e) => e.code === "P0004", "a business cannot switch messages off");

  assert.equal(await dm.readActivitySignals(shop), true,
    "and the half that WAS legal must not survive the refusal — one gesture, one act");
  assert.equal(await dm.readDmsOpen(shop), true);

  // the legal half alone still applies
  await dm.setDmSettings(shop, { activitySignals: false });
  assert.equal(await dm.readActivitySignals(shop), false);
  assert.equal(await dm.readDmsOpen(shop), true, "untouched, because it was not asked about");

  // and a passport may do both together
  const { lo: person } = await dmAccounts(pool);
  await dm.setDmSettings(person, { activitySignals: false, dmsOpen: false });
  assert.equal(await dm.readActivitySignals(person), false);
  assert.equal(await dm.readDmsOpen(person), false);
});

test("DM block: the block waits for the send it is racing",
  { skip: !databaseUrl }, async () => {
  // A SERIOUS finding of the 23 Aug register. dm_guard_message's LAW 1 check
  // is a plain EXISTS inside the SENDER's transaction, which holds the pair
  // advisory lock for its whole life. blockAccount never took that lock, so a
  // block could commit AFTER the sender's check and BEFORE the sender's
  // commit: the message landed in the thread of someone whose block was
  // already durable, and their badge counted it. The window opened at exactly
  // the moment a person reaches for the block button.
  //
  // Deterministic, and it has to be: the test HOLDS the pair lock itself —
  // `pairLockKey` is exported for this — and asserts the block WAITS. A test
  // that only fails on an unlucky schedule is not a regression test.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);

  const sender = await pool.connect();
  let blocking;
  try {
    await sender.query("BEGIN");
    // stand where a send in flight stands: holding the pair lock
    await sender.query("SELECT pg_advisory_xact_lock($1::bigint)", [dm.pairLockKey(a, b)]);

    blocking = dm.blockAccount(b, a);
    const raced = await Promise.race([
      blocking.then(() => "finished"),
      new Promise((r) => setTimeout(() => r("waiting"), 400)),
    ]);
    assert.equal(raced, "waiting",
      "a block must not slip past a send that is already inside the lock");

    // the send completes on its own terms, as it must — it was legal when it
    // began and nothing may retroactively unsend it
    await sender.query(
      `INSERT INTO dm_messages (conversation_id, sender_account_id, body)
       VALUES ($1,$2,'in flight')`, [convo.id, a]);
    await sender.query("COMMIT");
  } finally {
    sender.release();
  }

  await blocking;
  assert.equal(await dm.iBlocked(b, a), true);
  // and from here the law holds with no window at all
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: a, body: "after" }),
    (e) => e.name === "MessageRefused" && e.code === "P0001");
});

test("DM: a knock from someone you follow lands in the inbox, not the requests queue",
  { skip: !databaseUrl }, async () => {
  // A SERIOUS finding of the 23 Aug register, and the worst kind: a green test
  // over an unreachable path. `knownToRecipient`, `foldersForNewConversation`
  // and the unit test asserting "a thread you asked for should not arrive as a
  // request" all shipped with NO CALLER, so the suite reported the rule as
  // covered while nothing could produce it.
  //
  // user_follows predates this subsystem: it keys on the IDENTITY STRING
  // (sb-<uuid>), not the bare account uuid ADR-002 requires here, and its
  // target for kind='user' is a HANDLE. Both conversions are what this proves.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: sender, hi: recipient } = await dmAccounts(pool);
  await publishRoom(pool, sender, `fol${tag}`);

  assert.equal(await dm.recipientFollowsSender(recipient, sender), false, "nobody follows anybody yet");

  await pool.query(
    `INSERT INTO user_follows (user_id, kind, target) VALUES ($1,'user',$2)
     ON CONFLICT DO NOTHING`, ['sb-' + recipient, `fol${tag}`]);
  assert.equal(await dm.recipientFollowsSender(recipient, sender), true,
    "the identity string and the handle are both converted here, not by the caller");
  assert.equal(await dm.recipientFollowsSender(sender, recipient), false,
    "and it is not symmetric — following is not being followed");

  const convo = await dm.openConversation(sender, recipient, {
    knownToRecipient: await dm.recipientFollowsSender(recipient, sender),
  });
  const knock = await dm.sendMessage({ conversationId: convo.id, senderId: sender, body: "hello you" });

  assert.equal((await dm.listFolder(recipient, { folder: "requests" })).items.length, 0,
    "not in the queue you screen strangers with");
  const inbox = await dm.listFolder(recipient, { folder: "inbox" });
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].preview, "hello you",
    "and it carries its words, because you asked for this thread");

  // THE ONE-KNOCK LAW IS UNTOUCHED. A follow moves the knock; it does not open
  // the door.
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0].state, "requested");
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: sender, body: "and again" }),
    (e) => e.name === "MessageRefused" && e.code === "P0003",
    "still one message until they reply");
  assert.ok(knock.id);
});

test("DM export: both people get the record, and neither gets more than the thread showed",
  { skip: !databaseUrl }, async () => {
  // OWNER RULING, 23 Aug: **two people should have records.** #395 left open
  // whether a DM export ships at all, because a conversation is two people's
  // record and one side asking for a copy is asking for words the other side
  // wrote. Both sides are IN it, so both sides get it.
  //
  // What this proves is the shape of that answer: the SAME conversation from
  // both directions, each person's own `mine` flags, counterparties named by
  // HANDLE and never by uuid (law 7), and every absence rendered exactly the
  // way the thread renders it — because an export is a copy of the record, not
  // a way around it.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: a, hi: b } = await dmAccounts(pool);
  await publishRoom(pool, a, `xa${tag}`);
  // b deliberately publishes NO room: knocking needs none, so a counterparty
  // with no handle is the normal case, not an edge one.
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);

  const mine = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "kept" });
  const theirs = await dm.sendMessage({ conversationId: convo.id, senderId: b, body: "also kept" });
  const withdrawn = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "said too fast" });
  const removed = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "moderator took this" });
  const hidden = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hidden from them" });

  await dm.react(b, mine.id, "♥");
  assert.equal(await dm.unsendMessage(a, withdrawn.id), true);
  await pool.query(`UPDATE dm_messages SET redacted_at=now() WHERE id=$1`, [removed.id]);
  await pool.query(`UPDATE dm_messages SET hidden_for_recipient=true WHERE id=$1`, [hidden.id]);

  const forA = await dm.exportMessagesFor(a);
  const forB = await dm.exportMessagesFor(b);

  // BOTH RECORDS EXIST, and they are the same conversation.
  assert.equal(forA.conversations.length, 1);
  assert.equal(forB.conversations.length, 1);
  assert.equal(forA.conversations[0].id, convo.id);
  assert.equal(forB.conversations[0].id, convo.id);
  assert.equal(forA.conversations[0].openedByMe, true, "a opened it");
  assert.equal(forB.conversations[0].openedByMe, false, "and b did not — each record is its own side");

  // THE SHARED STATE COLUMN IS NOT RE-EMITTED. The route strips it from the
  // inbox because it names "declined" to the person who was declined — the
  // fact P0001 and P0002 are collapsed to hide — and an export is not a way
  // around that.
  assert.ok(!("state" in forA.conversations[0]), "the opener does not learn the answer here");
  assert.ok(!("state" in forB.conversations[0]));

  // NAMED BY HANDLE, NEVER BY UUID (law 7).
  assert.equal(forB.conversations[0].with, `xa${tag}`, "b's record names a by handle");
  assert.equal(forA.conversations[0].with, null,
    "and someone who never published a room has no handle — the record is still theirs");
  const asText = JSON.stringify({ forA, forB });
  assert.ok(!asText.includes(a) && !asText.includes(b),
    "no account uuid anywhere in either export — the key stops at the server");

  // EACH SIDE SEES ITS OWN AUTHORSHIP.
  //
  // Keyed by NUMBER on both sides. sendMessage returns the BIGSERIAL as pg
  // hands it over — a string — while the export narrows it with Number(), the
  // same way readThread does. A Map keyed on one and read with the other
  // misses every entry and reports it as "undefined has no property mine",
  // which is what CI said the first time.
  const id = (returned) => Number(returned.id);
  const aById = new Map(forA.messages.map((m) => [m.id, m]));
  const bById = new Map(forB.messages.map((m) => [m.id, m]));
  assert.equal(aById.get(id(mine)).mine, true);
  assert.equal(bById.get(id(mine)).mine, false);
  assert.equal(aById.get(id(theirs)).mine, false);
  assert.equal(bById.get(id(theirs)).mine, true);
  assert.equal(aById.get(id(mine)).body, "kept");
  assert.equal(bById.get(id(mine)).body, "kept", "the other person's words ARE the other person's record too");

  // THE THREE ABSENCES, EACH KEPT AS ITSELF.
  for (const [who, map] of [["a", aById], ["b", bById]]) {
    assert.equal(map.get(id(withdrawn)).body, null, `${who}: an unsend stays withdrawn`);
    assert.equal(map.get(id(withdrawn)).unsent, true);
    assert.equal(map.get(id(removed)).body, null, `${who}: a moderator's redaction is not undone by an export`);
    assert.equal(map.get(id(removed)).redacted, true);
    assert.equal(map.get(id(removed)).unsent, false, "and the two are not conflated");
  }
  assert.equal(aById.get(id(hidden)).body, "hidden from them", "the sender still sees their own words");
  assert.equal(bById.get(id(hidden)).body, null, "and hidden means hidden, in the download too");

  // REACTIONS RIDE WITH THEIR MESSAGE, from each side's point of view.
  assert.deepEqual(aById.get(id(mine)).reactions, [{ emoji: "♥", mine: false }]);
  assert.deepEqual(bById.get(id(mine)).reactions, [{ emoji: "♥", mine: true }]);
  assert.deepEqual(aById.get(id(withdrawn)).reactions, [],
    "an unsend clears the marks on it, so the export has none to carry");

  // THE SIDE-STATE IS PER SIDE.
  assert.equal(await dm.setMuted(b, convo.id, true), true);
  const mutedForB = await dm.exportMessagesFor(b);
  assert.equal(mutedForB.conversations[0].muted, true);
  assert.equal((await dm.exportMessagesFor(a)).conversations[0].muted, false,
    "mute is undetectable by the other party — including in their export");

  // BLOCKS AND SETTINGS come with it, by handle.
  await dm.blockAccount(b, a);
  const blockedForB = await dm.exportMessagesFor(b);
  assert.equal(blockedForB.blocks.length, 1);
  assert.equal(blockedForB.blocks[0].handle, `xa${tag}`);
  assert.equal(blockedForB.blocks[0].source, "manual");
  assert.equal(blockedForB.blocks[0].conversationId, convo.id,
    "and the conversation comes with it — a decline blocks whoever knocked, "
    + "knocking needs no published room, so the handle is NULL in the common case "
    + "and a block nobody can name is a record nobody can act on");
  assert.equal((await dm.exportMessagesFor(a)).blocks.length, 0,
    "and a block is the blocker's record, not the blocked person's");
});

test("DM export: a cap is reported, never silently applied",
  { skip: !databaseUrl }, async () => {
  // CONSTITUTION §6 forbids silent caps. The export's own contract is that
  // every bounded list says what it was cut to; this proves the store honours
  // a cap it is handed rather than quietly returning everything or nothing.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);
  for (let i = 0; i < 4; i++) {
    await dm.sendMessage({ conversationId: convo.id, senderId: a, body: `line ${i}` });
  }

  const capped = await dm.exportMessagesFor(a, { messages: 2 });
  assert.equal(capped.messages.length, 2, "the cap is applied");
  assert.equal(capped.caps.messages, 2, "and reported, so the caller can say it truncated");
  assert.ok(capped.messages[0].id > capped.messages[1].id, "newest first, so a cut loses the oldest");

  const whole = await dm.exportMessagesFor(a);
  assert.equal(whole.messages.length, 4);
  assert.equal(whole.caps.messages, 5000, "the default cap is stated even when nothing was cut");

  // WHERE the cut fell, not merely that one happened. The cap is global and
  // newest-first, so hitting it removes the oldest messages — and with them
  // the entire content of the oldest conversations.
  assert.equal(capped.oldestExportedMessageId, capped.messages[1].id,
    "the reader can tell which end of their history is missing");
  // Nothing was cut, so there is no cut to describe. The marker used to be set
  // unconditionally, which said "your history begins here" about a complete
  // export — a claim of loss where there was none.
  assert.equal(whole.oldestExportedMessageId, null,
    "an untruncated export has no missing end to point at");

  // a garbage cap does not become "everything" or "nothing"
  // A CAP THAT SAYS WHICH CAP. Two caps feed one list: conversations are
  // limited first, and messages are read only for the survivors. So an account
  // past the CONVERSATION cap loses whole conversations' worth of messages
  // while the message list sits far below its own cap — and the caller,
  // computing `rows.length >= cap` per list, affirmatively reported
  // `items.truncated: false` while every message of the cut conversations was
  // absent. §6 forbids a silent cap and that is the field which exists to
  // satisfy it.
  const { lo: many } = await dmAccounts(pool);
  for (let i = 0; i < 3; i++) {
    const { lo: other } = await dmAccounts(pool);
    const c = await dm.openConversation(many, other, { knownToRecipient: true });
    await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [c.id]);
    await dm.sendMessage({ conversationId: c.id, senderId: many, body: `note ${i}` });
  }
  const clipped = await dm.exportMessagesFor(many, { conversations: 2 });
  assert.equal(clipped.conversations.length, 2, "the conversation cap bit");
  assert.equal(clipped.truncated.conversations, true);
  assert.ok(clipped.messages.length < 5000, "and the message list is nowhere near ITS cap");
  assert.equal(clipped.truncated.messages, true,
    "yet messages ARE missing — a whole conversation of them — and the export must say so");
  assert.equal(clipped.oldestExportedMessageId, null,
    "and it must NOT claim the loss is 'everything older than this id', because it is not: "
    + "the missing messages are whole conversations from anywhere in the history");

  // when the MESSAGE cap is the one that bit, the marker is meaningful again
  const byMessages = await dm.exportMessagesFor(many, { messages: 2 });
  assert.equal(byMessages.truncated.messages, true);
  assert.equal(byMessages.truncated.conversations, false);
  assert.ok(byMessages.oldestExportedMessageId, "here the cut IS an id, and it is reported");

  // and an untruncated export says so on every list
  const whole2 = await dm.exportMessagesFor(many);
  assert.deepEqual(whole2.truncated, { conversations: false, messages: false, blocks: false });
  assert.equal(whole2.oldestExportedMessageId, null);

  // A CAP IN BYTES, because the row cap alone can build a response that cannot
  // be delivered: 5000 messages x the 2000-character body limit is ~10MB of
  // bodies before anything else in the export, and a serverless response body
  // has a ceiling well under that. The export would then FAIL for exactly the
  // people whose history is large enough to need it, and the route's catch
  // does not see a response-size rejection — so they would get an unexplained
  // failure rather than a file that says it was cut.
  const { lo: chatty, hi: withThem } = await dmAccounts(pool);
  const long = await dm.openConversation(chatty, withThem, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [long.id]);
  for (let i = 0; i < 5; i++) {
    await dm.sendMessage({ conversationId: long.id, senderId: chatty, body: "x".repeat(500) });
  }
  const byBytes = await dm.exportMessagesFor(chatty, { bytes: 1400 });
  assert.ok(byBytes.messages.length >= 1, "a byte cap never returns an empty file");
  assert.ok(byBytes.messages.length < 5, "but it does stop");
  assert.equal(byBytes.truncated.messages, true, "and says so");
  assert.ok(byBytes.oldestExportedMessageId,
    "a byte cut drops the OLDEST, like the row cap, so the marker still means something");
  assert.equal(byBytes.caps.bytes, 1400, "the cap it was read under is reported");

  // one message always survives, even one bigger than the whole budget —
  // returning nothing would be a worse answer than returning what fits
  const huge = await dm.exportMessagesFor(chatty, { bytes: 1 });
  assert.equal(huge.messages.length, 1);
  assert.equal(huge.truncated.messages, true);

  // Garbage is not a cap. A negative must not become a cap of ONE — that is a
  // truncation to a single message arrived at by accident, which is exactly
  // the silent cap §6 forbids.
  const junk = await dm.exportMessagesFor(a, { messages: "not a number" });
  assert.equal(junk.caps.messages, 5000);
  assert.equal((await dm.exportMessagesFor(a, { messages: -5 })).caps.messages, 5000);
  assert.equal((await dm.exportMessagesFor(a, { messages: 0 })).caps.messages, 5000);
  assert.equal((await dm.exportMessagesFor(a, { messages: Infinity })).caps.messages, 5000);
});

test("DM store: the counterparty is answerable from a conversation or a message, and only to a member",
  { skip: !databaseUrl }, async () => {
  // These two exist so the route can honour what lib/dm.js promises: "a
  // refusal caused by the CALLER'S OWN block is NOT vague ... Yours is always
  // explained, and always with the undo." It could only do that on first
  // contact by handle, where the other person had already been resolved.
  //
  // They are membership-scoped for the same reason readThread is: a lookup
  // that answers for a conversation you are not in is an oracle, and this one
  // would hand back a handle-resolvable account id.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const { lo: stranger } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello" });

  assert.equal(await dm.peerOf(a, convo.id), b, "from either side");
  assert.equal(await dm.peerOf(b, convo.id), a);
  assert.equal(await dm.peerOf(stranger, convo.id), null,
    "and never for somebody who is not in it");
  assert.equal(await dm.peerOfMessage(a, m.id), b, "the same answer from a message id");
  assert.equal(await dm.peerOfMessage(b, m.id), a);
  assert.equal(await dm.peerOfMessage(stranger, m.id), null);

  // garbage in is null out, not a thrown query
  assert.equal(await dm.peerOf(a, "not-a-uuid"), null);
  assert.equal(await dm.peerOf(a, ""), null);
  assert.equal(await dm.peerOf(a, randomUUID()), null, "a real uuid nobody owns");
  assert.equal(await dm.peerOfMessage(a, 0), null);
  assert.equal(await dm.peerOfMessage(a, "nonsense"), null);

  // and the answer they make possible: after MY OWN decline-block, the refusal
  // names it instead of collapsing to "not reachable"
  const { lo: opener, hi: recipient } = await dmAccounts(pool);
  const knock = await dm.openConversation(opener, recipient);
  await dm.sendMessage({ conversationId: knock.id, senderId: opener, body: "hi" });
  assert.equal(await dm.declineRequest(recipient, knock.id), true);
  const peer = await dm.peerOf(recipient, knock.id);
  assert.equal(peer, opener);
  assert.equal(await dm.iBlocked(recipient, peer), true,
    "which is what lets the route say 'you blocked this person' to the person who did");
});

test("DM: law 1 has a control inside an accepted conversation",
  { skip: !databaseUrl }, async () => {
  // A MINOR finding, and the half of it that survived #385: the only path
  // that ever created a block was DECLINE + BLOCK on a pending request, and
  // that branch never renders once a request is accepted. Harassment that
  // began AFTER acceptance had no user-facing remedy at all — the victim's
  // only lever was MUTE, which by design silences their own badge and does
  // not stop delivery.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "this is fine" });
  await dm.pingTyping(a, convo.id);

  assert.equal(await dm.blockByConversation(b, convo.id), true, "addressed by CONVERSATION");
  assert.equal(await dm.iBlocked(b, a), true);

  // It DELEGATES to blockAccount, so it inherits both of that function's
  // guarantees rather than reimplementing them: the pair lock every law-1
  // writer takes, and the sweep of presence written before the block.
  const presence = await pool.query(
    `SELECT 1 FROM dm_typing WHERE conversation_id=$1`, [convo.id]);
  assert.equal(presence.rowCount, 0, "typing written before the block does not outlive it");

  // and the law itself now holds in a thread that was already open
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: a, body: "and again" }),
    (e) => e.name === "MessageRefused" && e.code === "P0001");
  await assert.rejects(
    () => dm.react(b, m.id, "♥"),
    (e) => e.name === "MessageRefused" && e.code === "P0001");

  // a stranger cannot block a pair they are not in
  const { lo: stranger } = await dmAccounts(pool);
  assert.equal(await dm.blockByConversation(stranger, convo.id), false);
  assert.equal(await dm.blockByConversation(b, randomUUID()), false, "nor a conversation nobody owns");

  // and the undo #385 built still works on it
  assert.equal(await dm.unblockByConversation(b, convo.id), true);
  assert.equal(await dm.iBlocked(b, a), false);
});

test("DM: a decline reports the block that STANDS, not the one it was asked for",
  { skip: !databaseUrl }, async () => {
  // A MINOR finding. The route answered `blocked: ok && body.block !== false`
  // — the request flag, not the world — so a second decline of an
  // already-declined request said blocked:true whether or not a row existed.
  // Reachable through the shipped UI: decline, unblock from the BLOCKED list,
  // then decline again from a panel that had not reloaded.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hi" });

  const first = await dm.declineRequestDetailed(b, convo.id);
  assert.deepEqual(first, { ok: true, blocked: true });

  // the exact sequence the panel can produce
  assert.equal(await dm.unblockByConversation(b, convo.id), true);
  const stale = await dm.declineRequestDetailed(b, convo.id);
  assert.equal(stale.ok, true, "declining what is already declined is not a failure");
  assert.equal(stale.blocked, false,
    "and it must not claim a block the person deliberately undid");

  // declining WITHOUT blocking says so
  const { lo: c, hi: d } = await dmAccounts(pool);
  const quiet = await dm.openConversation(c, d);
  await dm.sendMessage({ conversationId: quiet.id, senderId: c, body: "hello" });
  assert.deepEqual(await dm.declineRequestDetailed(d, quiet.id, { block: false }),
    { ok: true, blocked: false });

  // and a decline that lands where a MANUAL block already stands is truthfully
  // blocked, even though its ON CONFLICT insert added nothing
  const { lo: e, hi: f } = await dmAccounts(pool);
  const knock = await dm.openConversation(e, f);
  await dm.sendMessage({ conversationId: knock.id, senderId: e, body: "hello" });
  await dm.blockAccount(f, e);
  assert.deepEqual(await dm.declineRequestDetailed(f, knock.id, { block: false }),
    { ok: true, blocked: true }, "asked of the table, not inferred from rowCount");

  // the boolean wrapper still answers what seven other assertions expect
  const { lo: g, hi: h } = await dmAccounts(pool);
  const third = await dm.openConversation(g, h);
  await dm.sendMessage({ conversationId: third.id, senderId: g, body: "hello" });
  assert.equal(await dm.declineRequest(h, third.id), true);
  assert.equal(await dm.declineRequest(g, third.id), false, "the opener still cannot decline");
});

test("DM unsend: the database requires the withdrawal to name its author",
  { skip: !databaseUrl }, async () => {
  // A MINOR finding. v42's header says "Unsend is the SENDER'S act and nobody
  // else's", and the trigger enforced only the one-way half. Who did it was
  // checked in exactly one place — the WHERE clause of unsendMessage — which
  // is the shape the core decisions rule out in as many words: "a law that
  // lives in one caller is a convention", and "the route is not the only
  // writer". asilum_app holds UPDATE on dm_messages.
  //
  // The consequence was not abstract: a moderator tool nulling a body and
  // setting unsent_at makes readThread report `unsent: true, redacted: false`,
  // which tells the recipient the AUTHOR withdrew their words when a moderator
  // removed them. v42's own header calls those different facts.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "mine to withdraw" });

  // A raw write with NO actor named — the moderator tool, the cleanup
  // migration, the future job — is refused by the trigger, not by a caller.
  await assert.rejects(
    () => pool.query(
      `UPDATE dm_messages SET body=NULL, unsent_at=now() WHERE id=$1`, [m.id]),
    (e) => e.code === "42501", "an unattributed withdrawal is nobody's act");

  // Naming the WRONG person is refused too — it is not a formality to satisfy.
  //
  // Two statements on ONE client inside a transaction, not one multi-statement
  // query: node-postgres uses the extended protocol, so a parameterised
  // `SELECT …; UPDATE …` is rejected before it ever reaches the trigger. The
  // first version of this assertion did exactly that and failed for a reason
  // that had nothing to do with the law it was testing.
  const impostor = await pool.connect();
  try {
    await impostor.query("BEGIN");
    await impostor.query("SELECT set_config('asilum.dm_actor', $1, true)", [b]);
    await assert.rejects(
      () => impostor.query(
        `UPDATE dm_messages SET body=NULL, unsent_at=now() WHERE id=$1`, [m.id]),
      (e) => e.code === "42501", "the recipient cannot withdraw the sender's words");
    await impostor.query("ROLLBACK");
  } finally {
    impostor.release();
  }

  // and the message is untouched by either attempt
  const intact = (await pool.query(
    `SELECT body, unsent_at FROM dm_messages WHERE id=$1`, [m.id])).rows[0];
  assert.equal(intact.body, "mine to withdraw");
  assert.equal(intact.unsent_at, null);

  // The store's own path names its actor and works.
  assert.equal(await dm.unsendMessage(a, m.id), true);
  const gone = (await pool.query(
    `SELECT body, unsent_at, redacted_at FROM dm_messages WHERE id=$1`, [m.id])).rows[0];
  assert.equal(gone.body, null);
  assert.ok(gone.unsent_at);
  assert.equal(gone.redacted_at, null, "an unsend is not a redaction, and stays distinguishable");

  // THE MODERATION PATH IS UNTOUCHED. The check is scoped strictly to the
  // unsent_at NULL -> NOT NULL transition, so a redaction — which is what a
  // moderator should actually write — needs no actor and still works.
  const other = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "removed later" });
  await pool.query(`UPDATE dm_messages SET redacted_at=now(), body=NULL WHERE id=$1`, [other.id]);
  const redacted = (await pool.query(
    `SELECT unsent_at, redacted_at FROM dm_messages WHERE id=$1`, [other.id])).rows[0];
  assert.equal(redacted.unsent_at, null, "and it does not masquerade as the author's own withdrawal");
  assert.ok(redacted.redacted_at);

  // and the per-side hide, the other future UPDATE on this table, is untouched
  const third = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hidden later" });
  await pool.query(`UPDATE dm_messages SET hidden_for_recipient=true WHERE id=$1`, [third.id]);
  assert.equal((await pool.query(
    `SELECT hidden_for_recipient FROM dm_messages WHERE id=$1`, [third.id])).rows[0].hidden_for_recipient,
    true);
});

test("DM: a non-member gets the same answer as a nonexistent conversation, from every op",
  { skip: !databaseUrl }, async () => {
  // readThread states the rule — "A non-member gets the same answer as a
  // nonexistent conversation, so the endpoint is not a membership oracle" —
  // and TWO ops broke it, both of them broken BY THE ROUND THAT FIXED
  // SOMETHING ELSE:
  //
  //   acceptRequest's idempotence branch (#381) re-read the row with no
  //   participant predicate, so a stranger POSTing a well-formed uuid got
  //   {ok:true} for an accepted conversation and {ok:false} otherwise. One
  //   probe, no write, no trace.
  //
  //   pingTyping's guarded upsert (#387) matched nothing for a nonexistent or
  //   unaccepted conversation (200 {ok:false}) but reached the trigger for an
  //   accepted one, raising 42501 with no catch — a 500. Before #387 the
  //   INSERT was unconditional and both surfaced as 500, indistinguishable.
  //
  // The rule is per-op and has to be tested per-op, so this walks all of them
  // with one stranger and one uuid nobody owns.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const { lo: stranger } = await dmAccounts(pool);
  const accepted = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [accepted.id]);
  const m = await dm.sendMessage({ conversationId: accepted.id, senderId: a, body: "private" });
  const nowhere = randomUUID();

  // Each probe must answer identically for a real conversation the stranger is
  // not in, and for a uuid that names nothing.
  const probes = {
    accept: (id) => dm.acceptRequest(stranger, id),
    decline: (id) => dm.declineRequest(stranger, id),
    typing: (id) => dm.pingTyping(stranger, id),
    thread: (id) => dm.readThread(stranger, id).then((t) => t === null),
    mute: (id) => dm.setMuted(stranger, id, true),
    consent: (id) => dm.setMediaConsent(stranger, id, true),
    peer: (id) => dm.peerOf(stranger, id),
    block: (id) => dm.blockByConversation(stranger, id),
    unblock: (id) => dm.unblockByConversation(stranger, id),
  };
  for (const [name, probe] of Object.entries(probes)) {
    const real = JSON.stringify(await probe(accepted.id) ?? null);
    const fake = JSON.stringify(await probe(nowhere) ?? null);
    assert.equal(real, fake,
      `op="${name}" answers differently for a conversation the caller is not in `
      + `(${real}) than for one that does not exist (${fake}) — that difference IS the oracle`);
  }

  // peerOfMessage takes a message id rather than a conversation id, and gets
  // the same treatment: a real message in someone else's thread must read like
  // a message id nobody owns.
  assert.equal(await dm.peerOfMessage(stranger, m.id), await dm.peerOfMessage(stranger, 999999999));

  // SEND AND REACT ARE THE TWO THAT TAKE A BODY, so they were not in the loop
  // above — and both were oracles.
  //
  // send: the conversation read had no membership predicate and threw a PLAIN
  // Error when the row was absent, so `error.code` was undefined, the
  // MessageRefused wrapper did not apply, and the route answered 500. When the
  // row existed and the sender was not a party, the trigger raised 42501, the
  // wrapper caught it, and the route answered 409. The status code alone told
  // a stranger whether a uuid named something real.
  const sendReal = await dm.sendMessage({ conversationId: accepted.id, senderId: stranger, body: "x" })
    .then(() => "delivered", (e) => `${e.name}:${e.code}`);
  const sendFake = await dm.sendMessage({ conversationId: nowhere, senderId: stranger, body: "x" })
    .then(() => "delivered", (e) => `${e.name}:${e.code}`);
  assert.equal(sendReal, sendFake,
    "sending into a real conversation you are not in must fail exactly like sending into one "
    + "that does not exist");
  assert.equal(sendReal, "MessageRefused:DM_NO_ACCESS",
    "and as a REFUSAL the route collapses, not a 500 that says the row was missing");

  // react: dm_messages.id is a guessable BIGSERIAL and the route passes it
  // straight through. The trigger raised 23503 for "no such message" and 42501
  // for "not in that conversation", and #399 gave those two DIFFERENT wire
  // strings — so "mark-unavailable" meant "this id names a real message in
  // somebody else's thread".
  const reactReal = await dm.react(stranger, m.id, "♥")
    .then(() => "ok", (e) => `${e.name}:${e.code}`);
  const reactFake = await dm.react(stranger, 999999999, "♥")
    .then(() => "ok", (e) => `${e.name}:${e.code}`);
  assert.equal(reactReal, reactFake, "and a real message in someone else's thread reads like no message");
  assert.equal(reactReal, "MessageRefused:P0005");

  // the members can still do both, which is the half a gate must not break
  await dm.sendMessage({ conversationId: accepted.id, senderId: b, body: "still works" });
  await dm.react(b, m.id, "♥");

  // and none of the probes wrote anything
  const untouched = (await pool.query(
    `SELECT state, accepted_at FROM dm_conversations WHERE id=$1`, [accepted.id])).rows[0];
  assert.equal(untouched.state, "accepted");
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM dm_typing WHERE conversation_id=$1`, [accepted.id])).rows[0].n, 0,
    "a stranger's typing ping left no presence row");
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM dm_participants WHERE conversation_id=$1`, [accepted.id])).rows[0].n, 2,
    "and no participant row appeared");

  // THE MEMBERS STILL GET REAL ANSWERS — a gate that denies everybody is not a
  // gate, it is an outage.
  assert.equal(await dm.pingTyping(a, accepted.id), true);
  assert.ok(await dm.readThread(a, accepted.id));
  assert.equal(await dm.peerOf(a, accepted.id), b);
});

test("DM: both send paths tell an opener the same thing",
  { skip: !databaseUrl }, async () => {
  // #403 collapsed the refusal for an opener whose knock was never accepted —
  // ignored, declined, blocked or shut out all read "one message until they
  // reply." — and did it in the catch around sendMessage. The OTHER send path
  // returns before that catch: when a handle does not resolve, the route
  // answers 409 straight away.
  //
  // The panel takes a reader through the second path by itself. Knock, get
  // declined, search the handle again (they are still listed — the search
  // lists blockers on purpose), click, send. Two sentences, one difference,
  // and the opener knows the recipient acted.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const { describeRefusal } = await import("../lib/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: opener, hi: ignoring } = await dmAccounts(pool);
  const { lo: opener2, hi: declining } = await dmAccounts(pool);
  await publishRoom(pool, ignoring, `ig${tag}`);
  await publishRoom(pool, declining, `de${tag}`);

  // both openers knock, by handle, exactly as the panel does
  for (const [me, handle] of [[opener, `ig${tag}`], [opener2, `de${tag}`]]) {
    const them = await dm.resolveAddressee(me, handle);
    assert.ok(them, "the first knock resolves");
    const convo = await dm.openConversation(me, them);
    await dm.sendMessage({ conversationId: convo.id, senderId: me, body: "hello" });
  }
  // one is ignored; the other declines, which blocks by default
  const declined = await dm.listFolder(declining, { folder: "requests" });
  assert.equal(await dm.declineRequest(declining, declined.items[0].id), true);

  // NOW BOTH SEND AGAIN BY HANDLE. The ignored one resolves and is refused by
  // LAW 3; the declined one does not resolve at all.
  const ignoredResolves = await dm.resolveAddressee(opener, `ig${tag}`);
  const declinedResolves = await dm.resolveAddressee(opener2, `de${tag}`);
  assert.ok(ignoredResolves, "an ignored knock still resolves");
  assert.equal(declinedResolves, null, "a declined one does not — which is the fork");

  // The route's two answers, built the way the route builds them.
  const ignoredAnswer = describeRefusal("P0003", {
    knockPending: await dm.pendingKnockBy(opener, declined.items[0].id) || true,
  });
  const declinedAnswer = describeRefusal("P0001", {
    knockPending: await dm.pendingKnockToHandle(opener2, `de${tag}`),
  });
  assert.deepEqual(declinedAnswer, ignoredAnswer,
    "the handle path must reach the same sentence as the conversation path");
  assert.equal(declinedAnswer.message, "one message until they reply.");

  // and a handle that never existed is NOT given the pending wording — there
  // is no knock to be pending, and claiming one would invent a conversation
  assert.equal(await dm.pendingKnockToHandle(opener2, `no${tag}`), false);
  assert.equal(await dm.pendingKnockToHandle(opener2, "xy"), false, "too short to be a handle");

  // nor is somebody I never knocked
  assert.equal(await dm.pendingKnockToHandle(opener, `de${tag}`), false,
    "it answers only about a conversation the CALLER opened");
});

test("DM: answering a knock accepts it, and a thread the recipient asked for can be answered",
  { skip: !databaseUrl }, async () => {
  // Pressing ACCEPT was the only way to reach 'accepted', and that button
  // renders only when the reader's folder is 'requests'. Two consequences,
  // both reachable in the shipped product:
  //
  //   A recipient who simply REPLIED left the state at 'requested'. LAW 3
  //   gates on `state <> 'accepted' AND sender = opened_by`, so the opener
  //   stayed frozen at one message — and was shown "one message until they
  //   reply." AFTER they had replied.
  //
  //   Worse, #392 puts a FOLLOWED sender's knock straight into the recipient's
  //   inbox. State stays 'requested', folder is not 'requests', so the button
  //   never renders: the thread could never advance, presence was dead in it
  //   forever, and the opener was frozen for its life. The thread the
  //   recipient had asked for was the one that could not be answered.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  // THE PLAIN CASE: a reply, with no button pressed.
  const { lo: opener, hi: recipient } = await dmAccounts(pool);
  const convo = await dm.openConversation(opener, recipient);
  await dm.sendMessage({ conversationId: convo.id, senderId: opener, body: "knock" });
  await assert.rejects(
    () => dm.sendMessage({ conversationId: convo.id, senderId: opener, body: "again" }),
    (e) => e.code === "P0003", "one knock, as always");

  await dm.sendMessage({ conversationId: convo.id, senderId: recipient, body: "who is this?" });
  const state = (await pool.query(
    `SELECT state, accepted_at FROM dm_conversations WHERE id=$1`, [convo.id])).rows[0];
  assert.equal(state.state, "accepted", "the reply IS the acceptance");
  assert.ok(state.accepted_at, "and it is stamped, as the CHECK requires");
  await dm.sendMessage({ conversationId: convo.id, senderId: opener, body: "it is me" });

  // THE #392 CASE: a followed sender, whose knock lands in the inbox and whose
  // thread therefore never shows an accept button.
  const tag = randomUUID().slice(0, 6);
  const { lo: sender, hi: follower } = await dmAccounts(pool);
  await publishRoom(pool, sender, `an${tag}`);
  await pool.query(
    `INSERT INTO user_follows (user_id, kind, target) VALUES ($1,'user',$2) ON CONFLICT DO NOTHING`,
    ["sb-" + follower, `an${tag}`]);
  const asked = await dm.openConversation(sender, follower, {
    knownToRecipient: await dm.recipientFollowsSender(follower, sender),
  });
  await dm.sendMessage({ conversationId: asked.id, senderId: sender, body: "hello you" });
  assert.equal((await dm.listFolder(follower, { folder: "inbox" })).items.length, 1,
    "it lands in the inbox, which is what #392 is for");
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [asked.id])).rows[0].state, "requested",
    "and the state is still requested, which is what made it unanswerable");

  await dm.sendMessage({ conversationId: asked.id, senderId: follower, body: "hi!" });
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [asked.id])).rows[0].state, "accepted");
  // the three things that were dead in that thread are alive
  await dm.sendMessage({ conversationId: asked.id, senderId: sender, body: "not frozen" });
  assert.equal(await dm.pingTyping(sender, asked.id), true, "presence works");
  assert.equal((await dm.peerActivity(follower, asked.id)).typing, true);

  // A KNOCKER CANNOT ACCEPT THEIR OWN KNOCK — the whole point of the gate.
  const { lo: pushy, hi: silent } = await dmAccounts(pool);
  const unanswered = await dm.openConversation(pushy, silent);
  await dm.sendMessage({ conversationId: unanswered.id, senderId: pushy, body: "hello?" });
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [unanswered.id])).rows[0].state, "requested",
    "their own message does not accept it");

  // AND IT CANNOT REVIVE A DECLINE. The predicate is state='requested', so a
  // declined conversation stays declined even if the decliner writes into it.
  const { lo: knocker, hi: decliner } = await dmAccounts(pool);
  const refused = await dm.openConversation(knocker, decliner);
  await dm.sendMessage({ conversationId: refused.id, senderId: knocker, body: "hi" });
  assert.equal(await dm.declineRequest(decliner, refused.id, { block: false }), true);
  await dm.sendMessage({ conversationId: refused.id, senderId: decliner, body: "no thanks" });
  assert.equal((await pool.query(
    `SELECT state FROM dm_conversations WHERE id=$1`, [refused.id])).rows[0].state, "declined",
    "a decline is not undone by writing into the thread");
});

test("DM: the thread says who it is with, and the poll says when something arrived",
  { skip: !databaseUrl }, async () => {
  // Two things the mail desk did not do. Neither is in the findings register;
  // both are the first things a person would notice.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: a, hi: b } = await dmAccounts(pool);
  await publishRoom(pool, b, `th${tag}`);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [convo.id]);

  // WHO IT IS WITH, by handle, from either side — and never a uuid.
  const forA = await dm.readThread(a, convo.id);
  assert.equal(forA.with, `th${tag}`);
  const forB = await dm.readThread(b, convo.id);
  assert.equal(forB.with, null, "a counterparty with no published room has no handle");
  assert.ok(!JSON.stringify(forA).includes(b), "and the uuid stays on the server");

  // WHEN SOMETHING ARRIVED. The activity poll is the only thing that runs
  // while a thread sits open, so it is what has to notice.
  const before = await dm.peerActivity(a, convo.id);
  assert.equal(before.newest, 0, "nothing said yet");
  const first = await dm.sendMessage({ conversationId: convo.id, senderId: b, body: "hello?" });
  const after = await dm.peerActivity(a, convo.id);
  assert.equal(after.newest, Number(first.id), "the poll reports the newest id in the thread");
  const second = await dm.sendMessage({ conversationId: convo.id, senderId: b, body: "still there?" });
  assert.equal((await dm.peerActivity(a, convo.id)).newest, Number(second.id), "and it moves");

  // It is a fact about MY OWN thread, so a non-member learns nothing from it —
  // the same answer as a conversation that does not exist.
  const { lo: stranger } = await dmAccounts(pool);
  assert.equal((await dm.peerActivity(stranger, convo.id)).newest, 0);
  assert.equal((await dm.peerActivity(stranger, randomUUID())).newest, 0);

  // and it survives the cases that deny presence, because a message arriving
  // is not presence: with signals off, both sides still learn that the thread
  // moved — otherwise switching off receipts would stop your mail.
  await dm.setActivitySignals(a, false);
  const quiet = await dm.peerActivity(a, convo.id);
  assert.equal(quiet.typing, false, "no presence");
  assert.equal(quiet.newest, Number(second.id), "but the mail still arrives");
});

test("DM store: mark-read is monotonic and unread is derived from it",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const m1 = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "one" });
  const m2 = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "two" });

  assert.equal((await dm.unreadSummary(b)).inbox, 1, "one CONVERSATION unread, not two messages");
  const thread = await dm.readThread(b, convo.id);
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[0].mine, false);

  await dm.markRead(b, convo.id, m2.id);
  assert.equal((await dm.unreadSummary(b)).inbox, 0);
  // a stale client replaying an older mark must not un-read the newer message
  await dm.markRead(b, convo.id, m1.id);
  assert.equal((await dm.unreadSummary(b)).inbox, 0, "GREATEST() keeps it read");
});

test("DM store: a non-member reading a thread gets the same answer as a missing one",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  const { lo: stranger } = await dmAccounts(pool);
  assert.equal(await dm.readThread(stranger, convo.id), null);
  assert.equal(await dm.readThread(stranger, "00000000-0000-4000-8000-000000000000"), null,
    "membership and existence are indistinguishable from outside");
});

test("DM store: the media consent toggle records BOTH sides, and revocation stamps",
  { skip: !databaseUrl }, async () => {
  // Nothing can send an attachment yet (OWNER-DECISIONS #3). What is proven
  // here is that the STATE the pipeline will enforce against is recorded
  // per-side and that revoking leaves a timestamp rather than erasing the
  // fact that consent once existed.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });

  assert.equal((await dm.readThread(a, convo.id)).mediaConsent.given, false, "off by default");
  await dm.setMediaConsent(a, convo.id, true);
  assert.equal((await dm.readThread(a, convo.id)).mediaConsent.given, true);
  assert.equal((await dm.readThread(b, convo.id)).mediaConsent.given, false,
    "one side consenting does NOT consent for the other");

  await dm.setMediaConsent(a, convo.id, false);
  const after = await dm.readThread(a, convo.id);
  assert.equal(after.mediaConsent.given, false);
  assert.ok(after.mediaConsent.revokedAt,
    "revocation is a timestamp, so 'was this sent under a consent that still stands?' stays answerable");

  // A SERIOUS finding of the 23 Aug register: the RE-GRANT was lossy. It kept
  // `COALESCE(media_consent_at, now())` — the ORIGINAL grant time — and set
  // `media_consent_revoked_at = NULL`, so a consent granted, revoked and
  // granted again read as "granted the first time, never revoked". The one
  // question these two columns exist to answer was answered wrongly, while the
  // schema comment and the function's own docstring claimed the opposite.
  const firstGrant = after.mediaConsent.grantedAt;
  const revoked = after.mediaConsent.revokedAt;
  await dm.setMediaConsent(a, convo.id, true);
  const again = await dm.readThread(a, convo.id);
  assert.equal(again.mediaConsent.given, true, "consent can be given back");
  assert.deepEqual(again.mediaConsent.revokedAt, revoked,
    "and the revocation is STILL ON THE RECORD — it is not erased by the re-grant");
  assert.ok(new Date(again.mediaConsent.grantedAt) > new Date(firstGrant),
    "the new grant is a NEW fact with its own time, not the old one re-used");
  assert.ok(new Date(again.mediaConsent.grantedAt) > new Date(revoked),
    "so the later stamp is the state, and the window each attachment fell in stays answerable");

  // idempotent in both directions: asking for the state you are already in
  // must not restamp the record, because the stamps are evidence
  assert.equal(await dm.setMediaConsent(a, convo.id, true), false, "already given");
  const unchanged = await dm.readThread(a, convo.id);
  assert.deepEqual(unchanged.mediaConsent.grantedAt, again.mediaConsent.grantedAt);
  await dm.setMediaConsent(a, convo.id, false);
  assert.equal(await dm.setMediaConsent(a, convo.id, false), false, "already revoked");
});

// --- v44: a block stops PRESENCE, not only words ---------------------------
// v40 stopped messages, v42 stopped reactions, and v41's activity signals were
// written between them and never got the predicate. The person you blocked
// kept watching you type and kept seeing your read position. Found only by
// reviewing the FINISHED subsystem: each feature was correct on the day it
// shipped, and the law moved underneath the ones written earlier.

test("a block stops typing and read receipts in BOTH directions",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello" });
  await dm.markRead(b, convo.id, m.id);
  await dm.pingTyping(b, convo.id);

  // baseline: the channel works
  assert.equal((await dm.peerActivity(a, convo.id)).typing, true);
  assert.equal((await dm.peerActivity(a, convo.id)).readYours, true);

  await dm.blockAccount(a, b);

  // the blocked party can no longer BROADCAST
  await assert.rejects(() => dm.pingTyping(b, convo.id),
    (e) => e.code === "P0001" || e.name === "MessageRefused",
    "the trigger refuses a typing row across a block");

  // and neither side can READ the other's presence — including the receipt,
  // which no trigger can stop because it is a plain column read
  const seenByBlocker = await dm.peerActivity(a, convo.id);
  assert.equal(seenByBlocker.typing, false, "the blocker sees no typing");
  assert.equal(seenByBlocker.readYours, false, "and no receipt");
  const seenByBlocked = await dm.peerActivity(b, convo.id);
  assert.equal(seenByBlocked.typing, false, "and the blocked party sees nothing either");
  assert.equal(seenByBlocked.readYours, false);

  // Stale rows written BEFORE the block do not outlive it. This is swept by
  // blockAccount, NOT by v44's migration DELETE -- the migration runs once and
  // can only clear what existed at that moment, which this test proved when it
  // failed against the migration-only version.
  const stale = await pool.query(`SELECT 1 FROM dm_typing WHERE conversation_id=$1`, [convo.id]);
  assert.equal(stale.rowCount, 0, "blocking clears presence written before it");
});

test("peerActivity refuses a conversation I am not in", { skip: !databaseUrl }, async () => {
  // It filters `account_id <> me`, which without a membership check answers
  // for ANY conversation id a caller can name. The conversation is ACCEPTED on
  // purpose: after v46 an unaccepted one returns nothing to anybody, so
  // leaving it a knock would let this test pass without membership ever being
  // checked — a green light for the wrong reason.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  // v46: presence needs an ACCEPTED conversation — a knock carries none.
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  await dm.markRead(b, convo.id, 0);
  const { lo: stranger } = await dmAccounts(pool);
  const peeked = await dm.peerActivity(stranger, convo.id);
  assert.equal(peeked.readYours, false, "a stranger learns nothing about someone else's thread");
  assert.equal(peeked.typing, false);
});

// --- mute and pagination ---------------------------------------------------
// Mute's whole risk is being built as a quiet block. These pin that it changes
// EXACTLY ONE thing: the badge. Delivery, unread inside the thread, and the
// other person's experience are all untouched.

test("mute silences the BADGE and nothing else", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "one" });

  assert.equal((await dm.unreadSummary(b)).inbox, 1);
  assert.equal(await dm.setMuted(b, convo.id, true), true);

  assert.equal((await dm.unreadSummary(b)).inbox, 0, "the corner goes quiet");

  // ...and NOTHING else changed:
  const list = await dm.listFolder(b, { folder: "inbox" });
  assert.equal(list.items.length, 1, "still in the list");
  assert.equal(list.items[0].muted, true, "and says so");
  assert.equal(list.items[0].unread, 1, "still unread INSIDE the conversation");

  // delivery is untouched — this is the line between mute and block
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "two" });
  assert.equal((await dm.listFolder(b, { folder: "inbox" })).items[0].unread, 2);
  assert.equal((await dm.unreadSummary(b)).inbox, 0, "still quiet, still arriving");

  // the sender cannot tell: their side of the conversation is unchanged
  const fromA = await dm.listFolder(a, { folder: "inbox" });
  assert.equal(fromA.items[0].muted, false, "muting is my view, not a property of the thread");

  assert.equal(await dm.setMuted(b, convo.id, false), false);
  assert.equal((await dm.unreadSummary(b)).inbox, 1, "unmuting restores the badge");
});

test("mute is per-side and refuses a conversation I am not in",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  const { lo: stranger } = await dmAccounts(pool);
  assert.equal(await dm.setMuted(stranger, convo.id, true), null,
    "no row to update, so no mute — and no error that confirms the thread exists");
});

test("thread pagination pages UP without a count query", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const ids = [];
  for (let i = 0; i < 7; i += 1) {
    const m = await dm.sendMessage({ conversationId: convo.id, senderId: i % 2 ? b : a, body: `m${i}` });
    ids.push(Number(m.id));
  }

  const page1 = await dm.readThread(b, convo.id, { limit: 3 });
  assert.equal(page1.messages.length, 3, "the limit is respected exactly");
  assert.equal(page1.hasOlder, true);
  assert.deepEqual(page1.messages.map((m) => m.id), ids.slice(-3).reverse(), "newest first");

  const page2 = await dm.readThread(b, convo.id, { limit: 3, before: page1.olderBefore });
  assert.deepEqual(page2.messages.map((m) => m.id), ids.slice(1, 4).reverse());
  assert.equal(page2.hasOlder, true);

  const page3 = await dm.readThread(b, convo.id, { limit: 3, before: page2.olderBefore });
  assert.deepEqual(page3.messages.map((m) => m.id), [ids[0]]);
  assert.equal(page3.hasOlder, false, "the top of the thread reports itself");
  assert.equal(page3.olderBefore, null);

  // no page repeats or skips an id
  const walked = [...page1.messages, ...page2.messages, ...page3.messages].map((m) => m.id).sort((x, y) => x - y);
  assert.deepEqual(walked, ids, "every message exactly once across the walk");
});

test("inbox pagination walks folders without repeating a conversation",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: me } = await dmAccounts(pool);
  const made = [];
  for (let i = 0; i < 5; i += 1) {
    const { lo: other } = await dmAccounts(pool);
    const partner = other === me ? (await dmAccounts(pool)).hi : other;
    const convo = await dm.openConversation(me, partner, { knownToRecipient: true });
    await dm.sendMessage({ conversationId: convo.id, senderId: me, body: `hello ${i}` });
    made.push(convo.id);
  }

  const seen = [];
  let cursor = "";
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await dm.listFolder(me, { folder: "inbox", cursor, limit: 2 });
    seen.push(...page.items.map((i) => i.id));
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  assert.equal(new Set(seen).size, seen.length, "no conversation appears twice");
  for (const id of made) assert.ok(seen.includes(id), `${id} was skipped by the walk`);
});

// --- reactions and unsend --------------------------------------------------
// The interesting failures here are not "does a heart appear". They are the
// two ways these features become something else: a reaction as a covert text
// channel past the one-knock law, and an unsend as a way to rewrite history.

test("reactions: the palette is CLOSED and the app cannot widen it",
  { skip: !databaseUrl }, async () => {
  // An open emoji field is a text channel. A stranger held to one message
  // could otherwise spell sentences one glyph at a time, and no moderation
  // pass would read them as messages.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello" });

  const palette = await dm.reactionKinds();
  assert.ok(palette.length >= 3 && palette.includes("♥"));
  await dm.react(b, m.id, "♥");

  for (const smuggled of ["🅷", "A", "help me", "♥♥", "\u200b"]) {
    await assert.rejects(() => dm.react(b, m.id, smuggled),
      (e) => e.name === "MessageRefused", `${JSON.stringify(smuggled)} is not in the palette`);
  }
  // THE GRANT CANNOT BE TESTED HERE, and pretending otherwise is worse than
  // not testing it. CI's Postgres connects as SUPERUSER, so a SELECT-only
  // grant restrains nothing — the INSERT below succeeds in CI and is refused
  // in production, where asilum_app is a real restricted role. The red team
  // named this exact gap ("CI's Postgres runs as superuser, so the entire
  // constraint layer is untested by any gate"). Asserted conditionally, and
  // verified against production by hand after the migration is applied.
  const su = await pool.query(`SELECT usesuper FROM pg_user WHERE usename = current_user`);
  if (!su.rows[0]?.usesuper) {
    await assert.rejects(
      () => pool.query(`INSERT INTO dm_reaction_kinds (emoji) VALUES ('+')`),
      (e) => e.code === "42501",
      "SELECT-only on the law table is what keeps the set closed");
  }
});

test("reactions: one per person per message, and replacing is not a second one",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "hello" });

  await dm.react(b, m.id, "♥");
  await dm.react(b, m.id, "✓");
  const counts = await dm.reactionsFor([m.id], a);
  assert.equal(counts[String(m.id)].length, 1, "replacing, not accumulating");
  assert.equal(counts[String(m.id)][0].emoji, "✓");

  // removal
  await dm.react(b, m.id, null);
  assert.deepEqual(await dm.reactionsFor([m.id], a), {});
});

test("reactions: refused on an unaccepted request, and after a block",
  { skip: !databaseUrl }, async () => {
  // A reaction on a request is a notification a stranger can send repeatedly,
  // straight past law 3.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);           // still 'requested'
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "knock" });
  await assert.rejects(() => dm.react(b, m.id, "♥"),
    (e) => e.name === "MessageRefused" && e.code === "P0003",
    "requests get replies or nothing");

  await dm.acceptRequest(b, convo.id);
  await dm.react(b, m.id, "♥");                            // now fine

  // a block stops the heart too: one that allows a mark every few minutes is
  // not a block
  await dm.blockAccount(b, a);
  await assert.rejects(() => dm.react(b, m.id, "✓"),
    (e) => e.name === "MessageRefused" && e.code === "P0001");
});

test("unsend: only mine, one-way, and the envelope survives",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const mine = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "regrettable" });

  assert.equal(await dm.unsendMessage(b, mine.id), false, "not b's to unsend");
  assert.equal(await dm.unsendMessage(a, mine.id), true);
  assert.equal(await dm.unsendMessage(a, mine.id), false, "already gone");

  // the envelope stays: "unsent" is not "never existed"
  const row = await pool.query(`SELECT sender_account_id, body, unsent_at, created_at
                                  FROM dm_messages WHERE id=$1`, [mine.id]);
  assert.equal(row.rows[0].body, null, "the words are gone");
  assert.ok(row.rows[0].unsent_at, "the fact that it happened is not");
  assert.equal(row.rows[0].sender_account_id, a);
  assert.ok(row.rows[0].created_at);

  // and it cannot be undone or refilled, by any path
  await assert.rejects(
    () => pool.query(`UPDATE dm_messages SET unsent_at=NULL WHERE id=$1`, [mine.id]),
    (e) => e.code === "P0006", "an unsend cannot be reversed");
  await assert.rejects(
    () => pool.query(`UPDATE dm_messages SET body='back again' WHERE id=$1`, [mine.id]),
    (e) => e.code === "P0006", "nor the body restored");

  // the reader sees a tombstone, distinct from a moderator removal
  const thread = await dm.readThread(b, convo.id);
  const seen = thread.messages.find((x) => x.id === Number(mine.id));
  assert.equal(seen.unsent, true);
  assert.equal(seen.redacted, false, "unsent and removed stay different facts");
  assert.equal(seen.body, null);
});

test("unsend: derived unread and preview follow it with no recompute",
  { skip: !databaseUrl }, async () => {
  // The payoff for deriving them in v40 instead of denormalising.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "first" });
  const last = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "the one I regret" });

  let inbox = await dm.listFolder(b, { folder: "inbox" });
  assert.equal(inbox.items[0].preview, "the one I regret");
  assert.equal((await dm.unreadSummary(b)).inbox, 1);

  await dm.unsendMessage(a, last.id);
  inbox = await dm.listFolder(b, { folder: "inbox" });
  assert.equal(inbox.items[0].preview, "first",
    "the preview falls back to the newest surviving message, with no write");

  // reactions on it are cleared: a mark on a tombstone is noise
  assert.deepEqual(await dm.reactionsFor([last.id], b), {});
});

// --- activity signals: read receipts + typing ------------------------------
// RECIPROCITY is the whole control, so it is the thing pinned hardest: with my
// signals off I see nothing, no matter what the other side chose. A test that
// only checked "their setting hides their receipt" would pass on a one-way
// mirror, which is exactly what a privacy setting must not be.

test("activity: a receipt appears only when BOTH sides emit", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const m = await dm.sendMessage({ conversationId: convo.id, senderId: a, body: "did you see this?" });

  // default: both on, b has not read yet
  let seen = await dm.peerActivity(a, convo.id);
  assert.equal(seen.readYours, false, "nothing read yet");
  await dm.markRead(b, convo.id, m.id);
  seen = await dm.peerActivity(a, convo.id);
  assert.equal(seen.readYours, true, "a's view of whether b reached a's newest");

  // B switches signals off -> A sees nothing from B
  await dm.setActivitySignals(b, false);
  seen = await dm.peerActivity(a, convo.id);
  assert.equal(seen.readYours, false, "their setting stops them emitting");
  assert.equal(seen.typing, false);
  assert.equal(seen.reciprocal, true, "A's own signals are still on");

  // RECIPROCITY: A switches OFF -> A sees nothing even though B is back on
  await dm.setActivitySignals(b, true);
  await dm.setActivitySignals(a, false);
  seen = await dm.peerActivity(a, convo.id);
  assert.equal(seen.readYours, false, "with my signals off I see nobody's");
  assert.equal(seen.reciprocal, false);
  // From B's side the two reasons for a null must stay DISTINGUISHABLE in the
  // payload even though both render as nothing: B's channel is open
  // (reciprocal: true) and A simply is not emitting. My first version of this
  // asserted B could still see A's receipt, which was wrong about the feature
  // -- switching your signals off stops you EMITTING as well as seeing, and
  // that is the primary effect, not a side one.
  const fromB = await dm.peerActivity(b, convo.id);
  assert.equal(fromB.reciprocal, true, "B's own view is not disabled by A's choice");
  assert.equal(fromB.readYours, false, "but A, with signals off, emits nothing to see");
});

test("activity: the payload cannot be used to read the other person's setting",
  { skip: !databaseUrl }, async () => {
  // THE TEST THAT SHOULD HAVE EXISTED. An UNVERIFIED finding said the
  // `reciprocal` flag let a caller read their correspondent's activity_signals
  // off the wire. It was removed — and it was never the carrier: `reciprocal`
  // is false in exactly ONE branch, when the CALLER's own signals are off,
  // which the caller already knows.
  //
  // The carrier was `readUpTo: Number(last_read_message_id) || 0`. Signals ON
  // with nothing read serialised as 0; signals OFF as null. One request, no
  // baseline, and you had classified your correspondent's GLOBAL setting — one
  // column in dm_settings, the same in every conversation they have.
  //
  // So this compares the two payloads directly, which is the only thing that
  // could ever have caught it.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  // `reciprocal` is stripped by the route. `newest` is NOT — the client needs
  // it to know a message arrived — and it is excluded here for a different
  // reason: it is the id of the newest message in the CALLER'S OWN thread,
  // which they can already read off the messages they are looking at. What
  // must be indistinguishable is everything that describes the OTHER person.
  const onWire = (activity) => {
    const { reciprocal, newest, ...rest } = activity;
    return JSON.stringify(rest);
  };

  // Two identical conversations. In one the peer has signals ON and has read
  // nothing; in the other the peer has signals OFF. Nothing else differs.
  const { lo: a1, hi: quiet } = await dmAccounts(pool);
  const { lo: a2, hi: silent } = await dmAccounts(pool);
  const pairs = [];
  for (const [me, them] of [[a1, quiet], [a2, silent]]) {
    const convo = await dm.openConversation(me, them, { knownToRecipient: true });
    await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
      [convo.id]);
    await dm.sendMessage({ conversationId: convo.id, senderId: me, body: "hello" });
    pairs.push({ me, them, id: convo.id });
  }
  await dm.setActivitySignals(silent, false);

  assert.equal(
    onWire(await dm.peerActivity(a1, pairs[0].id)),
    onWire(await dm.peerActivity(a2, pairs[1].id)),
    "a peer who has not read it yet and a peer who switched signals off must be "
    + "BYTE-IDENTICAL on the wire — otherwise every accepted contact is a permanent "
    + "monitor of that person's global privacy switch");

  // And the same collapse for every other denied case, so the ordinary one
  // keeps them company: a block, an unaccepted knock, a conversation I am not in.
  const { lo: c, hi: d } = await dmAccounts(pool);
  const knock = await dm.openConversation(c, d);
  await dm.sendMessage({ conversationId: knock.id, senderId: c, body: "hi" });
  assert.equal(onWire(await dm.peerActivity(c, knock.id)), onWire(await dm.peerActivity(a1, pairs[0].id)),
    "an unaccepted knock reads the same");

  const { lo: stranger } = await dmAccounts(pool);
  assert.equal(onWire(await dm.peerActivity(stranger, pairs[0].id)),
    onWire(await dm.peerActivity(a1, pairs[0].id)), "so does a conversation I am not in");

  await dm.blockAccount(quiet, a1);
  assert.equal(onWire(await dm.peerActivity(a1, pairs[0].id)),
    onWire(await dm.peerActivity(a2, pairs[1].id)), "and so does a block");

  // And `newest` really is the reader's own thread rather than a channel: it
  // equals the newest id in the conversation they are in, and is 0 for one
  // they are not.
  const own = await dm.peerActivity(a1, pairs[0].id);
  const seen = await dm.readThread(a1, pairs[0].id);
  assert.equal(own.newest, seen.messages[0].id, "the id they can already see");

  // The positive case still WORKS — a collapse that hides everything would be
  // a feature that never fires.
  const { lo: e, hi: f } = await dmAccounts(pool);
  const live = await dm.openConversation(e, f, { knownToRecipient: true });
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`,
    [live.id]);
  const mine = await dm.sendMessage({ conversationId: live.id, senderId: e, body: "read this" });
  await dm.markRead(f, live.id, mine.id);
  const shown = await dm.peerActivity(e, live.id);
  assert.equal(shown.readYours, true, "when they HAVE read it, the receipt appears");

  // and it goes back to false when I send something newer — which is exactly
  // what makes the false above ambiguous rather than merely undefined
  await dm.sendMessage({ conversationId: live.id, senderId: e, body: "and this" });
  assert.equal((await dm.peerActivity(e, live.id)).readYours, false,
    "the ordinary reason for a false is the commonest thing in the product");
});

test("activity: typing expires rather than needing a 'stopped' write",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  // v46: presence needs an ACCEPTED conversation — a knock carries none.
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);

  assert.equal((await dm.peerActivity(a, convo.id)).typing, false);
  await dm.pingTyping(b, convo.id);
  assert.equal((await dm.peerActivity(a, convo.id)).typing, true);

  // A browser that vanished writes nothing. Simulate the lapse by ageing the
  // row rather than sleeping the suite.
  await pool.query(`UPDATE dm_typing SET typing_until = now() - interval '1 second'
                     WHERE conversation_id=$1 AND account_id=$2`, [convo.id, b]);
  assert.equal((await dm.peerActivity(a, convo.id)).typing, false,
    "absence of a refresh IS 'stopped'");

  // an explicit stop still works, for the tab that closes politely
  await dm.pingTyping(b, convo.id);
  await dm.clearTyping(b, convo.id);
  assert.equal((await dm.peerActivity(a, convo.id)).typing, false);
});

test("activity: someone with signals off does not even write a typing row",
  { skip: !databaseUrl }, async () => {
  // Checked before the INSERT, so there is no row to leak in the seconds
  // before it would have lapsed.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  // v46: presence needs an ACCEPTED conversation — a knock carries none.
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  await dm.setActivitySignals(b, false);
  assert.equal(await dm.pingTyping(b, convo.id), false);
  const rows = await pool.query(`SELECT 1 FROM dm_typing WHERE conversation_id=$1 AND account_id=$2`,
    [convo.id, b]);
  assert.equal(rows.rowCount, 0, "nothing was written at all");
});

test("activity: a non-participant cannot claim to be typing", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b);
  // v46: presence needs an ACCEPTED conversation — a knock carries none.
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  const { lo: stranger } = await dmAccounts(pool);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_typing (conversation_id, account_id, typing_until)
                      VALUES ($1,$2, now() + interval '5 seconds')`, [convo.id, stranger]),
    (e) => e.code === "42501", "the trigger guards it, not the route");
});

test("activity: a client cannot pin itself 'typing' for an hour", { skip: !databaseUrl }, async () => {
  // A broken or lying client must not leave an indicator that outlives the
  // person it describes.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: a, hi: b } = await dmAccounts(pool);
  const convo = await dm.openConversation(a, b, { knownToRecipient: true });
  // v46: presence needs an ACCEPTED conversation — a knock carries none.
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [convo.id]);
  await pool.query(`INSERT INTO dm_typing (conversation_id, account_id, typing_until)
                    VALUES ($1,$2, now() + interval '1 hour')`, [convo.id, b]);
  const row = await pool.query(
    `SELECT typing_until <= now() + interval '31 seconds' AS capped FROM dm_typing
      WHERE conversation_id=$1 AND account_id=$2`, [convo.id, b]);
  assert.equal(row.rows[0].capped, true, "the horizon is capped at 30s by the trigger");
});

// --- search-to-start: the enumeration surface ------------------------------
// A DM search is how a messaging product leaks its user list. These pin the
// four exclusions; each one, removed, turns the search into a directory.

async function publishRoom(pool, account, handle) {
  await pool.query(
    `INSERT INTO profile_rooms (account_id, handle, published, moderation_status)
     VALUES ($1,$2,true,'visible')
     ON CONFLICT (account_id) DO UPDATE SET handle=EXCLUDED.handle, published=true`,
    [account, handle]);
}

test("DM search finds ONLY people who published a room", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const { lo: me, hi: published } = await dmAccounts(pool);
  const { lo: unpublished } = await dmAccounts(pool);
  const tag = randomUUID().slice(0, 6);
  await publishRoom(pool, published, `pub-${tag}`);
  // present in profile_rooms but NOT published — the common case, and the
  // reason this search is not a directory of everyone who signed up
  await pool.query(
    `INSERT INTO profile_rooms (account_id, handle, published) VALUES ($1,$2,false)
     ON CONFLICT (account_id) DO UPDATE SET published=false`, [unpublished, `pub-${tag}-x`]);

  const hits = await dm.findAddressees(me, `pub-${tag}`);
  assert.deepEqual(hits.map((h) => h.handle), [`pub-${tag}`],
    "an unpublished room is absent from the table this reads, not filtered by policy");
  assert.equal("accountId" in (hits[0] || {}), false,
    "the uuid must never leave the server — it is the key that skips the search");
});

test("DM search is not a block detector",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: me } = await dmAccounts(pool);
  const { lo: iBlockedThem } = await dmAccounts(pool);
  const { lo: theyBlockedMe } = await dmAccounts(pool);
  const { lo: doorShut } = await dmAccounts(pool);
  const { lo: openPerson } = await dmAccounts(pool);
  await publishRoom(pool, me, `x${tag}-me`);
  await publishRoom(pool, iBlockedThem, `x${tag}-a`);
  await publishRoom(pool, theyBlockedMe, `x${tag}-b`);
  await publishRoom(pool, doorShut, `x${tag}-c`);
  await publishRoom(pool, openPerson, `x${tag}-d`);

  await dm.blockAccount(me, iBlockedThem);
  await dm.blockAccount(theyBlockedMe, me);
  await dm.setDmsOpen(doorShut, false);

  const hits = (await dm.findAddressees(me, `x${tag}`, { limit: 10 })).map((h) => h.handle);

  // BLOCKER 4 of the 23 Aug register, and the assertion this test used to
  // make is the defect. It required `x-b` — the person who blocked ME — to be
  // ABSENT, which made absence caller-specific and therefore readable: search
  // the handle from your own account and from a throwaway, compare, and you
  // have been told the block landed. For a business it took no second account
  // at all, since a business cannot close its door.
  //
  // A person who blocked me is LISTED. Nothing is leaked by that: their room
  // is a public page, so the handle was already visible.
  assert.deepEqual(hits, [`x${tag}-b`, `x${tag}-c`, `x${tag}-d`],
    "a block made against me is not a fact the result set may carry — AND NEITHER IS "
    + "A CLOSED DOOR. Listing blockers while hiding closed doors made the pair readable: "
    + "present in search and refused on send could only mean a block, because a shut "
    + "door would have removed them. The refusal collapses P0001 and P0002 on purpose, "
    + "and both surfaces have to agree for that collapse to be worth anything.");

  // What the block actually stops is ADDRESSING, and that predicate keeps
  // BOTH directions — so a handle kept from before a block, or read off a
  // public room, still opens nothing.
  assert.equal(await dm.resolveAddressee(me, `x${tag}-a`), null, "a person I blocked");
  assert.equal(await dm.resolveAddressee(me, `x${tag}-b`), null,
    "a person who blocked me — visible, and still unaddressable");
  assert.equal(await dm.resolveAddressee(me, `x${tag}-c`), null, "a closed door");
  assert.equal(await dm.resolveAddressee(me, `x${tag}-me`), null, "myself");
  assert.equal(await dm.resolveAddressee(me, `x${tag}-d`), openPerson);

  // The refusals must be INDISTINGUISHABLE, which is the property the whole
  // ruling rests on: a null from a block reads exactly like a null from a
  // closed door and from a handle nobody ever registered.
  assert.equal(await dm.resolveAddressee(me, `x${tag}-nobody`), null, "never existed");

  // AND THE TWO SURFACES MUST AGREE. Everything the search lists and the
  // resolve refuses has to be more than one thing, or "listed but unreachable"
  // names which one it was.
  const listedButRefused = [];
  for (const h of hits) {
    if (await dm.resolveAddressee(me, h) === null) listedButRefused.push(h);
  }
  assert.deepEqual(listedButRefused.sort(), [`x${tag}-b`, `x${tag}-c`].sort(),
    "a blocker AND a closed door, indistinguishable from each other — one of them "
    + "alone would have been an answer");

  // And a business that blocked me stays listed too — the case where absence
  // needed no second account to interpret.
  const { lo: shopBlockedMe } = await dmAccounts(pool);
  await publishRoom(pool, shopBlockedMe, `x${tag}-shop`);
  await pool.query(
    `INSERT INTO account_kinds (account_id, kind) VALUES ($1,'business')
     ON CONFLICT (account_id) DO UPDATE SET kind='business'`, [shopBlockedMe]);
  await dm.blockAccount(shopBlockedMe, me);
  const withShop = (await dm.findAddressees(me, `x${tag}`, { limit: 10 })).map((h) => h.handle);
  assert.ok(withShop.includes(`x${tag}-shop`),
    "a business cannot close its door, so its absence could only ever mean a block");
  assert.equal(await dm.resolveAddressee(me, `x${tag}-shop`), null, "and it is still unaddressable");
});

test("a BUSINESS is always findable — it cannot close its door", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();

  const tag = randomUUID().slice(0, 6);
  const { lo: me, hi: shop } = await dmAccounts(pool);
  await publishRoom(pool, shop, `biz${tag}`);
  await pool.query(`INSERT INTO account_kinds (account_id, kind) VALUES ($1,'business')
                    ON CONFLICT (account_id) DO UPDATE SET kind='business'`, [shop]);

  const hits = await dm.findAddressees(me, `biz${tag}`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "business", "labelled, so a reader knows it is a storefront");
});

test("DM search refuses a query short or odd enough to walk the table",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  await db.getPool();
  const { lo: me } = await dmAccounts(await db.getPool());

  // One character walks the alphabet in 26 requests; a wildcard walks it in 1.
  for (const q of ["", "a", " ", "%", "_", "a%", "----------------------------x"]) {
    assert.deepEqual(await dm.findAddressees(me, q), [],
      `${JSON.stringify(q)} must not return anything`);
  }
});

// They live ABOVE the board/ticket test on purpose: that test ends the
// default pool in its cleanup (see the note at the top of this file).
test("Postgres transmission lifecycle: author-bound edit and soft delete", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const production = await import("../lib/db/production.js");
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();
  const author = `u-${randomUUID()}`;
  const stranger = `u-${randomUUID()}`;
  const handle = `pgwire-${randomUUID().slice(0, 8)}`;

  // Clean up exactly what this test created, and nothing else.
  t.after(async () => {
    await pool.query("DELETE FROM editorial_posts WHERE author_id=ANY($1::text[])", [[author, stranger]]);
  });

  const post = await production.createEditorialPost({
    authorId: author, authorHandle: handle, kind: "user", moderationStatus: "visible",
    title: "PG FIRST CUT", body: "the first account", excerpt: "the first account",
  });
  const before = (await production.listEditorialPosts({ id: post.id }))[0];
  assert.equal(before.editedAt, null, "an untouched transmission carries no edit stamp");

  // A stranger's edit must not match the WHERE clause.
  assert.equal(
    await production.updateEditorialPost({
      id: post.id, authorId: stranger, body: "hijacked", excerpt: "hijacked",
    }),
    null, "not the author → the same answer as a missing post");
  assert.equal((await production.listEditorialPosts({ id: post.id }))[0].body, "the first account");

  const edited = await production.updateEditorialPost({
    id: post.id, authorId: author, title: "PG SECOND CUT",
    body: "the corrected account", excerpt: "the corrected account",
    tags: ["archival"],
  });
  assert.ok(edited, "the author's edit lands");
  assert.ok(edited.editedAt, "edited_at is stamped by the database (now())");
  const read = (await production.listEditorialPosts({ id: post.id }))[0];
  assert.equal(read.body, "the corrected account");
  assert.deepEqual(read.tags, ["archival"], "jsonb tags round-trip through the UPDATE");

  // COALESCE($7::jsonb, tags): omitting tags must leave the stored ones alone.
  await production.updateEditorialPost({
    id: post.id, authorId: author, body: "same words", excerpt: "same words",
  });
  assert.deepEqual((await production.listEditorialPosts({ id: post.id }))[0].tags, ["archival"],
    "an edit that passes no tags does not wipe them");

  assert.equal(await production.deleteEditorialPost({ id: post.id, authorId: stranger }), false,
    "a stranger cannot retire someone else's transmission");
  assert.equal(await production.deleteEditorialPost({ id: post.id, authorId: author }), true);
  assert.equal((await production.listEditorialPosts({ id: post.id })).length, 0,
    "the permalink read is dead on the Postgres path too");
  assert.equal(await production.deleteEditorialPost({ id: post.id, authorId: author }), false,
    "a second delete finds nothing to retire");
  assert.equal(
    await production.updateEditorialPost({ id: post.id, authorId: author, body: "zombie", excerpt: "zombie" }),
    null, "a deleted transmission cannot be edited back to life");

  // The row SURVIVES as record — soft delete, not erasure.
  const { rows } = await pool.query(
    "SELECT moderation_status FROM editorial_posts WHERE id=$1", [post.id]);
  assert.equal(rows[0]?.moderation_status, "deleted", "the row is retained, marked deleted");
});

test("Postgres wire engagement: one person counts once, and identity moves whole", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const production = await import("../lib/db/production.js");
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();
  const author = `u-${randomUUID()}`;
  const alice = `u-${randomUUID()}`;
  const bob = `u-${randomUUID()}`;
  const device = `u-${randomUUID()}`;
  const account = `sb-${randomUUID()}`;
  const handle = `pgeng-${randomUUID().slice(0, 8)}`;
  let postId = null;

  t.after(async () => {
    if (postId != null) await pool.query("DELETE FROM transmission_engagements WHERE post_id=$1", [postId]);
    await pool.query("DELETE FROM editorial_posts WHERE author_id=$1", [author]);
    await pool.query(
      "DELETE FROM identity_adoptions WHERE from_user_id=ANY($1::text[]) OR to_user_id=ANY($1::text[])",
      [[device, account]]);
    for (const uid of [alice, bob, device, account]) {
      await production.purgePersonalizationData(uid).catch(() => {});
    }
  });

  const post = await production.createEditorialPost({
    authorId: author, authorHandle: handle, kind: "user", moderationStatus: "visible",
    body: "count me once", excerpt: "count me once",
  });
  postId = post.id;

  // Repetition buys nothing — the primary key is the dedupe.
  for (let i = 0; i < 5; i++) {
    await production.setTransmissionEngagement({ postId, userId: alice, kind: "like", on: true });
  }
  let counts = (await production.engagementFor([postId], alice))[String(postId)];
  assert.equal(counts.likes, 1, "five presses, one person");
  assert.equal(counts.youLike, true, "bool_or reports this viewer's own state");

  // Only another human moves it.
  await production.setTransmissionEngagement({ postId, userId: bob, kind: "like", on: true });
  assert.equal((await production.engagementFor([postId]))[String(postId)].likes, 2);
  // An anonymous read gets true counts and no personal state (the
  // $2::text IS NULL branch of the aggregate).
  const anon = (await production.engagementFor([postId], null))[String(postId)];
  assert.equal(anon.likes, 2);
  assert.equal(anon.youLike, false);

  // Withdrawal.
  await production.setTransmissionEngagement({ postId, userId: bob, kind: "like", on: false });
  assert.equal((await production.engagementFor([postId]))[String(postId)].likes, 1);

  // The same person, before and after signing in, is ONE vote.
  await production.setTransmissionEngagement({ postId, userId: device, kind: "like", on: true });
  await production.setTransmissionEngagement({ postId, userId: account, kind: "like", on: true });
  assert.equal((await production.engagementFor([postId]))[String(postId)].likes, 3,
    "before adoption they look like two people");
  await production.adoptAccountData(device, account);
  const merged = (await production.engagementFor([postId], account))[String(postId)];
  assert.equal(merged.likes, 2, "the collision collapses — one human, one vote");
  assert.equal(merged.youLike, true, "and it belongs to the account");
  const stranded = await pool.query(
    "SELECT count(*)::int n FROM transmission_engagements WHERE post_id=$1 AND identity_hash=$2",
    [postId, db.identityHash(device)]);
  assert.equal(stranded.rows[0].n, 0, "no engagement left stranded under the device hash");

  // Erasure removes this person from everyone's counters.
  await production.purgePersonalizationData(alice);
  assert.equal((await production.engagementFor([postId]))[String(postId)].likes, 1,
    "the purge reaches the identity_hash ledger");

  // A retired transmission refuses engagement (the INSERT…SELECT gate).
  await production.deleteEditorialPost({ id: postId, authorId: author });
  assert.equal(
    await production.setTransmissionEngagement({ postId, userId: bob, kind: "save", on: true }),
    null, "engagement cannot land on a transmission the wire will not show");
});

test("Postgres refuses a non-numeric ticket id instead of raising 22P02", { skip: !databaseUrl }, async () => {
  // The mem/Postgres divergence confirmed by the Aug 14 verification pass:
  // `ticketId` was validated as a STRING only, so "abc" reached
  // `SELECT … WHERE id=$1` against a BIGSERIAL column. Postgres raises
  // 22P02, the route has no try/catch there, and the caller got a 500 —
  // while mem returned a clean 400 the whole time. This test belongs HERE
  // and not in the mem suite: in mem the bad id misses either way, so the
  // assertion cannot fail and would prove nothing.
  process.env.DATABASE_URL = databaseUrl;
  const { normalizeWardrobeAdd } = await import("../lib/wardrobe/index.js");
  const user = `u-${randomUUID()}`;

  for (const bad of ["abc", "12; DROP TABLE items", "9999999999999999999999"]) {
    const result = await normalizeWardrobeAdd(user, { source: "ticket", ticketId: bad });
    assert.equal(result.ok, false, `refused: ${bad}`);
    assert.equal(result.error, "ticket not found", "the same words mem has always used");
  }
  // A well-shaped id that does not exist still resolves cleanly, so the
  // guard narrowed the SHAPE and not the behaviour.
  const missing = await normalizeWardrobeAdd(user, { source: "ticket", ticketId: "999999999" });
  assert.equal(missing.error, "ticket not found");
});

test("Postgres resolves a batch of products in ONE query, not one per id",
  { skip: !databaseUrl }, async (t) => {
  // Audit #10. resolveProducts awaited resolveProduct per id, so a 60-id
  // /api/interaction request became 60 primary-key queries — against the
  // shipped max:5 pool that is 12 sequential round-trip waves, each holding
  // every connection while it waited.
  //
  // This test belongs HERE and nowhere else, for the same reason the ticket-id
  // test above does: in mem, resolveProducts is a Map hit per id either way, so
  // a mem assertion cannot tell the batched implementation from the fanned-out
  // one and would prove nothing. The defect is Postgres-only; so is its guard.
  //
  // The test seeds its OWN inventory and removes it again. The first draft read
  // whatever rows happened to be in `items`, which passed against the seeded
  // production database and failed on CI, where the table is empty after a
  // fresh migration — a test that measures the environment rather than the
  // code. Its own rows make it say the same thing everywhere.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const { resolveProducts } = await import("../lib/products.js");
  const { CATALOG } = await import("../lib/ingest/catalog.js");
  const pool = await db.getPool();

  const suffix = randomUUID();
  const seeded = CATALOG.slice(0, 25).map((item, n) => ({
    ...item, id: `res-batch-${suffix}-${n}`,
  }));
  const ids = seeded.map((item) => item.id);
  t.after(async () => {
    await pool.query("DELETE FROM items WHERE id = ANY($1::text[])", [ids]);
  });
  await db.upsertItems(seeded);

  const original = pool.query.bind(pool);
  const statements = [];
  pool.query = (...args) => {
    statements.push(typeof args[0] === "string" ? args[0] : args[0]?.text || "");
    return original(...args);
  };
  let resolved;
  try {
    resolved = await resolveProducts(ids);
  } finally {
    pool.query = original;
  }

  assert.equal(statements.length, 1,
    `one round trip for ${ids.length} ids, not ${statements.length}`);
  assert.match(statements[0], /= ANY\(/, "and it must be the batched form");
  assert.equal(resolved.size, ids.length, "every existing id still resolves");
  for (const id of ids) {
    assert.equal(resolved.get(id).id, id, "keyed by the id that was asked for");
  }

  // An id that does not exist is simply absent — no throw, no synthetic
  // stand-in, because live inventory exists.
  const withGhost = await resolveProducts([...ids.slice(0, 3), `ghost-${randomUUID()}`]);
  assert.equal(withGhost.size, 3, "a missing id resolves to nothing, not to a guess");
});

// No database needed: this one is about the FILES.
test("no two migrations claim the same version number", () => {
  const byVersion = new Map();
  for (const { version, file } of committedMigrations()) {
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(file);
  }
  const collisions = [...byVersion.entries()]
    .filter(([, files]) => files.length > 1)
    .filter(([version, files]) =>
      // A known collision is allowed only if it is EXACTLY the known one.
      JSON.stringify(files.sort()) !== JSON.stringify((DUPLICATE_VERSIONS.get(version) || []).sort()));
  assert.deepEqual(collisions, [],
    "two files sharing a version means one of them can be skipped invisibly");
});

test("every committed migration is accounted for in the ledger",
  { skip: !databaseUrl }, async () => {
  // The guard used to compare only max(version), which cannot see a HOLE.
  // Measured on live before this test existed: the ledger held 7..29 and the
  // check was green, because max was 29 either way. A migration that forgets
  // its row, or one skipped during a partial manual apply, was undetectable
  // unless it happened to be the highest-numbered file.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();
  const { rows } = await pool.query("SELECT version FROM app_schema_migrations");
  const applied = new Set(rows.map((row) => Number(row.version)));

  const missing = committedMigrations()
    .map((m) => m.version)
    .filter((v) => !applied.has(v) && !LEDGER_SILENT.has(v));
  assert.deepEqual([...new Set(missing)], [],
    "a committed migration with no ledger row — either it never ran, or it forgot to record");

  const unexpected = [...applied].filter(
    (v) => !committedMigrations().some((m) => m.version === v));
  assert.deepEqual(unexpected, [],
    "the ledger claims a version no committed file provides — an out-of-band apply");
});

test("Postgres serves the profiles recency scan from an index",
  { skip: !databaseUrl }, async () => {
  // Audit #12. listProfiles runs ORDER BY updated_at DESC LIMIT 500 on every
  // similarUsers call and no migration had ever indexed that column, so
  // Postgres sorted the whole table to return 500 rows. Measured on live
  // before schema-v29: Seq Scan over 4,132 rows + top-N heapsort, 362ms of
  // execution. After: Index Scan, 4.0ms.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();

  const { rows: index } = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'profiles' AND indexname = 'profiles_updated_at_desc'`);
  assert.equal(index.length, 1, "schema-v29 must be applied");

  // Whether the PLANNER picks it is a function of table size, and on a fresh
  // CI database a sequential scan of a handful of rows is genuinely cheaper —
  // asserting the plan unconditionally would be a test of the environment, not
  // the code (the mistake the batch-resolution test above already made once).
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM profiles");
  if (n < 1000) return;

  const plan = (await pool.query(
    "EXPLAIN SELECT user_id, vec FROM profiles ORDER BY updated_at DESC LIMIT 500"
  )).rows.map((row) => row["QUERY PLAN"]).join("\n");
  assert.match(plan, /Index Scan using profiles_updated_at_desc/,
    `at ${n} rows the planner should use the index:\n${plan}`);
  assert.ok(!/Seq Scan on profiles/.test(plan), "the whole-table sort must be gone");
});

test("Postgres listTasteVectors sends the long vector and nothing else",
  { skip: !databaseUrl }, async (t) => {
  // Audit #12 RESIDUAL. The v29 index killed the 362ms sort but the payload
  // stayed: `SELECT user_id, vec` moved the whole profile blob to compute a
  // cosine over the long-term vector alone. On live that measured 1,408,369 B
  // per call, 84% of it `_meta` (the `seen` array alone was 726 kB) — a field
  // cross-user similarity never reads. Narrowed, the same scan moves 164,606 B.
  //
  // Seeds its own rows: reading ambient `profiles` would test the environment,
  // and this suite already learned that the hard way once.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const ids = {
    modern: `u-tv-modern-${suffix}`,
    legacy: `u-tv-legacy-${suffix}`,
    nulled: `u-tv-null-${suffix}`,
    empty: `u-tv-empty-${suffix}`,
  };
  t.after(async () => {
    await pool.query("DELETE FROM profiles WHERE user_id = ANY($1)", [Object.values(ids)]);
  });

  // Modern two-timescale shape, with the fat `_meta` that motivated the change.
  await pool.query(
    "INSERT INTO profiles (user_id, vec, updated_at) VALUES ($1, $2::jsonb, now())",
    [ids.modern, JSON.stringify({
      long: { minimal: 3, tailoring: 2 },
      session: { neon: 9 },
      _meta: { seen: Array.from({ length: 400 }, (_, i) => `item-${i}`) },
    })]);
  // Legacy flat profile predating the long/session split — the `|| vec` path.
  await pool.query(
    "INSERT INTO profiles (user_id, vec, updated_at) VALUES ($1, $2::jsonb, now())",
    [ids.legacy, JSON.stringify({ archival: 5 })]);
  // JSON null long must fall through to the whole vec, exactly as `||` did.
  await pool.query(
    "INSERT INTO profiles (user_id, vec, updated_at) VALUES ($1, $2::jsonb, now())",
    [ids.nulled, JSON.stringify({ long: null, workwear: 4 })]);
  // An empty object must NOT fall through — `{}` is truthy in the old JS.
  await pool.query(
    "INSERT INTO profiles (user_id, vec, updated_at) VALUES ($1, $2::jsonb, now())",
    [ids.empty, JSON.stringify({ long: {}, session: { loud: 1 } })]);

  const rows = await db.listTasteVectors(1000);
  const byId = new Map(rows.map((r) => [r.userId, r]));

  const modern = byId.get(ids.modern);
  assert.ok(modern, "the seeded modern profile must be in the scan");
  assert.deepEqual(modern.long, { minimal: 3, tailoring: 2 }, "long vector preserved");
  assert.equal(modern.vec, undefined, "the whole-profile field must be gone from the contract");
  const serialized = JSON.stringify(modern);
  assert.ok(!serialized.includes("_meta"), "_meta must never cross the wire");
  assert.ok(!serialized.includes("neon"), "session must never cross the wire");

  assert.deepEqual(byId.get(ids.legacy).long, { archival: 5 },
    "a legacy flat profile still resolves to itself");
  assert.deepEqual(byId.get(ids.nulled).long, { long: null, workwear: 4 },
    "a JSON-null long falls through to the whole vec, as `vec?.long || vec` did");
  assert.deepEqual(byId.get(ids.empty).long, {},
    "an empty long stays empty — `{}` is truthy, so it must not fall through");
});

test("Postgres enforces board, ticket, and adoption integrity", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const suffix = randomUUID();
  const userId = `u-${suffix}`;
  const from = `u-${randomUUID()}`;
  const to = `sb-${randomUUID()}`;
  const itemA = { id: `item-a-${suffix}`, title: "A", tags: { MINIMAL: 0.8 }, price: 100 };
  const itemB = { id: `item-b-${suffix}`, title: "B", tags: { TAILORED: 0.8 }, price: 120 };
  const pool = await db.getPool();
  const userIds = [userId, from, to];
  const itemIds = [itemA.id, itemB.id];
  const factIds = [];
  const unknownQuery = `unknown-${suffix}`;

  t.after(async () => {
    try {
      await pool.query("BEGIN");
      await pool.query(
        "DELETE FROM board_items WHERE board_id IN (SELECT id FROM boards WHERE user_id=ANY($1::text[]))",
        [userIds]
      );
      await pool.query("DELETE FROM boards WHERE user_id=ANY($1::text[])", [userIds]);
      await pool.query("DELETE FROM user_measurements WHERE user_id=ANY($1::text[])", [userIds]);
      for (const table of [
        "purchase_tickets", "user_events", "interactions", "processed_operations",
        "user_style_profiles", "user_follows", "asterisk_memory_preferences", "wardrobe_items", "user_rail_prefs", "profiles",
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [userIds]);
      }
      await pool.query(
        "DELETE FROM identity_adoptions WHERE from_user_id=ANY($1::text[]) OR to_user_id=ANY($1::text[])",
        [userIds]
      );
      await pool.query("DELETE FROM product_tags WHERE product_id=ANY($1::text[])", [itemIds]);
      await pool.query("DELETE FROM popularity WHERE item_id=ANY($1::text[])", [itemIds]);
      await pool.query("DELETE FROM edges WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [itemIds]);
      await pool.query("DELETE FROM items WHERE id=ANY($1::text[])", [itemIds]);
      await pool.query("DELETE FROM learned_facts WHERE id=ANY($1::text[])", [factIds]);
      await pool.query("DELETE FROM interpretation_feedback WHERE user_id=ANY($1::text[])", [userIds]);
      await pool.query("DELETE FROM unknown_queries WHERE normalized_query=$1", [unknownQuery]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await pool.end();
    }
  });

  await db.upsertItems([itemA, itemB]);
  await production.addProductTags(itemA.id, [
    { tag: "sharp", tagType: "mood", confidence: 0.1 },
  ]);
  await production.addProductTags(itemB.id, [
    { tag: "sharp", tagType: "mood", confidence: 0.9 },
    { tag: "sharp", tagType: "material", confidence: 0.9 },
  ]);
  const typedTop = await production.productsByTagsTyped(["sharp"], { limit: 1 });
  assert.deepEqual(Object.keys(typedTop), [itemB.id],
    "typed tag limit counts products, not product/type rows");
  assert.deepEqual(Object.keys(typedTop[itemB.id]).sort(), ["material", "mood"],
    "all score dimensions survive the product cap");

  // Inventory-representation predicate (PR 0A): the SQL count must mirror
  // isDiscoverableProduct — hidden, sold, and unavailable rows never count.
  const zzTag = `ZZPHASE0${suffix.replaceAll("-", "").toUpperCase().slice(0, 8)}`;
  const itemVis = { id: `item-vis-${suffix}`, title: "Vis", tags: { [zzTag]: 1 }, price: 90 };
  const itemSold = { id: `item-sold-${suffix}`, title: "Sold", tags: { [zzTag]: 1 }, price: 90, availability_status: "sold" };
  const itemHidden = { id: `item-hidden-${suffix}`, title: "Hidden", tags: { [zzTag]: 1 }, price: 90 };
  const itemOff = { id: `item-off-${suffix}`, title: "Off", tags: { [zzTag]: 1 }, price: 90, is_available: false };
  itemIds.push(itemVis.id, itemSold.id, itemHidden.id, itemOff.id);
  await db.upsertItems([itemVis, itemSold, itemHidden, itemOff]);
  await pool.query("UPDATE items SET moderation_status='hidden' WHERE id=$1", [itemHidden.id]);
  const products = await import("../lib/products.js");
  assert.equal(await products.countDiscoverableProductsByTags([zzTag]), 1,
    "sold, hidden, and unavailable rows must not inflate inventory confidence");

  // Dual-channel candidate retrieval (PR 0A slice 2): tag-only matches are
  // retrieved by summed evidence confidence, not starved by text recency,
  // and the result shape reports truncation.
  const retrieved = await db.searchItemCandidates("zz-no-text-match", ["sharp"]);
  assert.ok(Array.isArray(retrieved.rows) && typeof retrieved.truncated === "boolean",
    "retrieval returns { rows, truncated }");
  const tagIds = retrieved.rows.map((row) => row.id).filter((id) => itemIds.includes(id));
  assert.deepEqual(tagIds, [itemB.id, itemA.id],
    "tag channel orders by summed evidence confidence (B 1.8 > A 0.1)");
  const candidates = await db.searchItemCandidates("sharp", ["sharp"], 10);
  assert.ok(candidates.rows.some((item) => item.id === itemB.id));
  const save = (item) => db.commitBoardSave({
    userId, item,
    canonicalEvent: (boardId) => ({
      userId, type: "USER_ADDED_TO_MOOD_BOARD", payload: { boardId, itemId: item.id }, at: Date.now(),
    }),
    reduce(profile) {
      return { profile, edgePairs: [], popularity: [] };
    },
  });
  await Promise.all([save(itemA), save(itemB)]);
  const boards = await db.getBoards(userId);
  assert.equal(boards.length, 1);
  assert.equal(boards.filter((board) => board.isDefault).length, 1);
  assert.deepEqual(new Set(boards[0].items.map((item) => item.id)), new Set([itemA.id, itemB.id]));

  const ticket = await production.createTicket({
    userId, productId: itemA.id, sourceName: "ebay",
    sourceProductUrl: "https://www.ebay.com/itm/123", idempotencyKey: randomUUID(),
  });
  await production.updateTicket(ticket.id, { status: "awaiting_user_consent" });
  const consented = await production.transitionTicket(ticket.id, userId, "consent", {
    disclaimerVersion: "server-version",
  });
  assert.equal(consented.status, "checkout_started");
  assert.equal(await production.transitionTicket(ticket.id, userId, "consent", {
    disclaimerVersion: "forged-version",
  }), null);
  assert.equal(await production.transitionTicket(ticket.id, userId, "cancel"), null);
  const outcomeEvent = {
    userId, type: "USER_REPORTED_PURCHASE",
    payload: { ticketId: ticket.id, itemId: itemA.id }, at: Date.now(),
  };
  const outcome = await production.reportTicketOutcome(ticket.id, userId, "bought", outcomeEvent);
  assert.equal(outcome.ticket.userReportedOutcome, "bought");
  assert.equal(outcome.duplicate, false);
  assert.equal((await production.reportTicketOutcome(ticket.id, userId, "bought", outcomeEvent)).duplicate, true);

  await db.saveProfile(from, { long: { MINIMAL: 0.7 } });
  await production.saveUserMeasurements(from, {
    usualSize: "M", preferredUnit: "in",
    inches: { chest: 40, waist: 32, hips: 40, inseam: 31, height: 70 },
  });
  await production.recordInterpretationFeedback({
    userId: from, normalizedQuery: "rain", interpretationId: "1:exact:rain",
    contractVersion: 1, verdict: "not-meant",
  });
  const sourceBoard = await db.createBoard(from, "source board");
  await db.addBoardItem(sourceBoard.id, itemA);
  const [first, second] = await Promise.all([
    production.adoptAccountData(from, to),
    production.adoptAccountData(from, to),
  ]);
  assert.equal([first, second].filter((result) => result.duplicate).length, 1);
  assert.equal((await db.getBoards(to)).length, 1);
  assert.equal((await db.getBoards(from)).length, 0);
  assert.equal((await db.getProfile(to)).long.MINIMAL, 0.7);
  assert.equal((await production.getUserMeasurements(to)).chest, 40);
  assert.equal((await production.getUserMeasurements(from)).chest, "");
  assert.equal((await production.listInterpretationFeedback(from, "rain")).length, 0);
  assert.equal((await production.listInterpretationFeedback(to, "rain"))[0]?.verdict, "not-meant");

  const firstUnknown = await production.recordUnknownQuery(unknownQuery, `identity-${suffix}`, "none");
  assert.equal(firstUnknown.demandCount, 1, "the first persistent vote is counted exactly once");
  assert.equal(firstUnknown.distinctIdentities, 1);
  const duplicateUnknown = await production.recordUnknownQuery(unknownQuery, `identity-${suffix}`, "none");
  assert.equal(duplicateUnknown.demandCount, 1, "a repeated identity cannot inflate demand");

  const fact = await production.createLearnedFact({
    entityType: "test", entityId: suffix, claim: "concurrent review",
    claimType: "test", sourceUrls: ["https://example.com/fact"],
    verificationStatus: "discovered",
  });
  factIds.push(fact.id);
  const competingReviews = await Promise.all([
    production.updateLearnedFactStatus(fact.id, "pending_verification", null, "discovered"),
    production.updateLearnedFactStatus(fact.id, "rejected", "integration-test", "discovered"),
  ]);
  assert.equal(competingReviews.filter(Boolean).length, 1,
    "only one reviewer may advance the same fact version");

  await db.saveProfile(from, { long: { GORP: 0.5 } });
  await db.createBoard(from, "later source board");
  const later = await production.adoptAccountData(from, to);
  assert.equal(later.duplicate, false);
  assert.equal(later.movedBoards, 1);
  assert.equal((await db.getBoards(to)).length, 2);
  assert.ok((await db.getProfile(to)).long.GORP > 0);

  const schema = await pool.query(
    "SELECT max(version)::int AS version FROM app_schema_migrations"
  );
  assert.equal(schema.rows[0].version, committedSchemaVersion());

  // v18 brand cases: CAS transition + same-transaction ledger row.
  //
  // WHAT WAS WRONG (Aug 9): the cleanup was `DELETE FROM brand_cases`, which
  // schema-v19-integrity-hardening.sql:82 REVOKES from asilum_app on purpose —
  // brand cases are an append-only enforcement ledger. The delete only ever
  // worked because CI connects to a DISPOSABLE container as the `postgres`
  // superuser, which bypasses both the grant and RLS. Pointed at a real
  // database as the role the app actually runs as, the delete was denied, the
  // `finally` threw, and the test left a live `under_review` case behind on
  // EVERY run. Measured before the fix: 12 stranded rows in production.
  //
  // So the role decides the contract. Where a hard delete is permitted (CI's
  // owner role) keep the cascade coverage. Where it is not (any real database)
  // assert the hardening ITSELF — the check that would have caught someone
  // "restoring" the v18 grant — and retire the case through its own lifecycle
  // instead of trying to erase it.
  {
    const { validateOpenCase, validateTransition } = await import("../lib/brands/cases.js");
    const priv = await pool.query(
      `SELECT has_table_privilege(current_user,'brand_cases','DELETE')       AS can_delete_case,
              has_table_privilege(current_user,'brand_case_events','UPDATE') AS can_update_event,
              has_table_privilege(current_user,'brand_case_events','DELETE') AS can_delete_event,
              current_user AS role`
    );
    const { can_delete_case: canHardDelete, can_update_event, can_delete_event, role } = priv.rows[0];

    let kase = await production.insertBrandCase(validateOpenCase({
      kind: "verification", brandName: `IT Brand ${suffix.slice(0, 8)}`, openedBy: "it-admin" }));
    try {
      kase = await production.applyBrandCaseTransition(kase.id, "open",
        validateTransition(kase, { to: "under_review", actor: "it-admin" }));
      await assert.rejects(
        () => production.applyBrandCaseTransition(kase.id, "open",
          { to: "archived", actor: "it-admin" }),
        /case-moved/, "stale expectedStatus must 409, not overwrite");
      const ledger = await production.listBrandCaseEvents(kase.id);
      assert.deepEqual(ledger.map((e) => e.toStatus), ["open", "under_review"]);
      assert.deepEqual((await production.listBrandCaseEvents(kase.id, 1)).map((e) => e.toStatus),
        ["under_review"], "a capped ledger returns the latest transition");

      if (!canHardDelete) {
        // v19's own verification block, asserted rather than commented.
        assert.equal(can_update_event, false, "brand_case_events must not be updatable (v19)");
        assert.equal(can_delete_event, false, "brand_case_events must not be deletable (v19)");
        // The cascade is still declared, even though this role may not fire it.
        const fk = await pool.query(
          `SELECT confdeltype FROM pg_constraint
            WHERE conrelid='public.brand_case_events'::regclass AND contype='f'`
        );
        assert.ok(fk.rows.length, "brand_case_events must carry a foreign key to its case");
        assert.ok(fk.rows.every((r) => r.confdeltype === "c"),
          "the ledger FK must still be declared ON DELETE CASCADE");
      }
    } finally {
      if (canHardDelete) {
        await pool.query("DELETE FROM brand_cases WHERE id=$1", [kase.id]);
        const orphans = await pool.query(
          "SELECT count(*)::int AS n FROM brand_case_events WHERE case_id=$1", [kase.id]);
        assert.equal(orphans.rows[0].n, 0, "ledger cascades with the case");
      } else {
        // Append-only: retire through the domain's terminal state so the run
        // never leaves an ACTIVE case behind, and say plainly that a row
        // remains. A silent retention would read as "cleaned up".
        const current = await production.getBrandCase(kase.id);
        if (current && current.status !== "archived") {
          await production.applyBrandCaseTransition(kase.id, current.status,
            validateTransition(current, { to: "archived", actor: "it-admin" }));
        }
        console.error(
          `[postgres-integration] brand case ${kase.id} archived, not deleted: ` +
          `role "${role}" has no DELETE on brand_cases (schema-v19, by design). ` +
          `Append-only ledger — remove with an owner-role connection if this is a shared database.`
        );
      }
    }
  }

  // v17 profile rooms: account-uuid domain (ADR-002), unique handles,
  // module cascade, purge coverage.
  const themeRegistry = await pool.query("SELECT count(*)::int AS n FROM profile_themes");
  assert.ok(themeRegistry.rows[0].n >= 5, "the five seed skins must exist");
  const accountA = randomUUID();
  const accountB = randomUUID();
  const roomHandle = `it-${suffix.slice(0, 12)}`;
  // profile_rooms carries an FK to auth.users wherever the auth schema
  // exists (Supabase, and CI's shim) — give the test accounts parent rows.
  //
  // WHAT WAS WRONG (Aug 9): this asked whether auth.users EXISTS, then wrote
  // to it. Existence is not permission. On CI the connected role is the
  // `postgres` superuser so the INSERT succeeds; on real Supabase the app role
  // has no rights on the auth schema at all, so the INSERT raised "permission
  // denied for schema auth" (42501) and failed the whole test. Same shape as
  // the brand-cases cleanup above: "the code path exists" is not "this role
  // may use it". Ask for the privilege, not the table.
  // Neither catalog probe survives a role without rights on the auth schema:
  // has_table_privilege() RAISES "permission denied for schema auth" instead of
  // returning false, and to_regclass() returns NULL — making "absent" and
  // "invisible to me" indistinguishable, which is how a first attempt at this
  // fix sailed past the guard and hit the foreign key anyway. Let the INSERT's
  // own SQLSTATE decide; it is the only answer that is never ambiguous.
  //   seeded            -> parents exist, run the block
  //   42P01 / 3F000     -> no auth.users at all (plain CI Postgres), no FK to
  //                        satisfy, run the block
  //   42501             -> the table is there but this role may not write it,
  //                        so the FK can never be satisfied: skip, loudly
  let authUsersSeeded = false;
  let authUsersAbsent = false;
  try {
    await pool.query(
      "INSERT INTO auth.users (id) VALUES ($1::uuid), ($2::uuid) ON CONFLICT DO NOTHING",
      [accountA, accountB]);
    authUsersSeeded = true;
  } catch (err) {
    if (err.code === "42P01" || err.code === "3F000") authUsersAbsent = true;
    else if (err.code !== "42501") throw err;
  }
  const roomsRunnable = authUsersSeeded || authUsersAbsent;
  if (!roomsRunnable) {
    const who = (await pool.query("SELECT current_user AS role")).rows[0].role;
    console.error(
      `[postgres-integration] SKIPPED the v17 profile-rooms block: role ` +
      `"${who}" cannot seed auth.users (no rights on the auth schema), and ` +
      `profile_rooms carries an FK to it. This block is covered in CI, which ` +
      `connects as the database owner.`
    );
  }
  if (roomsRunnable) try {
    await assert.rejects(() => production.upsertProfileRoom(accountB, { published: true }),
      /handle-required/, "published rooms require a claimed handle");
    await production.upsertProfileRoom(accountA, { handle: roomHandle, themeId: "after-dark", published: true });
    await assert.rejects(() => production.upsertProfileRoom(accountB, { handle: roomHandle }),
      /handle-taken/, "handles must be unique across accounts");
    await production.setProfileModule(accountA, "statement", { content: { text: "integration words" } });
    await assert.rejects(() => production.setProfileModule(accountB, "statement", { content: { text: "x" } }),
      /room-required/, "modules require the room row");
    const storedRoom = await production.getProfileRoomByHandle(roomHandle);
    assert.equal(storedRoom.accountId, accountA);
    assert.equal(storedRoom.themeId, "after-dark");
    await production.purgePersonalizationData("sb-" + accountA);
    assert.equal(await production.getProfileRoom(accountA), null, "purge erases the room");
    const orphanModules = await pool.query(
      "SELECT count(*)::int AS n FROM profile_modules WHERE account_id=$1::uuid", [accountA]);
    assert.equal(orphanModules.rows[0].n, 0, "modules cascade with the room");
  } finally {
    await pool.query("DELETE FROM profile_rooms WHERE account_id=ANY($1::uuid[])", [[accountA, accountB]]);
    if (authUsersSeeded) {
      await pool.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[accountA, accountB]]);
    }
  }

  const railRegistry = await pool.query("SELECT count(*)::int AS n FROM discover_rails");
  assert.ok(railRegistry.rows[0].n >= 4, "the four seed rails must exist");
  const railBefore = (await production.listDiscoverRails()).find((r) => r.id === "screen");
  const railUpdated = await production.updateDiscoverRail("screen", { position: railBefore.position + 1 });
  assert.equal(railUpdated.position, railBefore.position + 1, "registry update roundtrips");
  await production.updateDiscoverRail("screen", { position: railBefore.position });
  assert.equal(await production.updateDiscoverRail("no-such-rail", { enabled: false }), null);
  const railPref = await production.setRailPref(from, "screen", { collapsed: true });
  assert.equal(railPref.collapsed, true);
  await production.setRailPref(to, "screen", { collapsed: false });
  const railAdoption = await production.adoptAccountData(from, to);
  assert.equal(railAdoption.duplicate, false);
  assert.equal((await production.getRailPrefs(to)).screen.collapsed, false,
    "account-side rail pref wins on adoption");
  assert.deepEqual(await production.getRailPrefs(from), {});

  const memorySecurity = await pool.query(`
    SELECT c.relname,
      c.relrowsecurity AS rls,
      has_table_privilege('asilum_app', c.oid, 'SELECT') AS app_select,
      has_table_privilege('asilum_app', c.oid, 'INSERT') AS app_insert,
      has_table_privilege('asilum_app', c.oid, 'UPDATE') AS app_update,
      has_table_privilege('asilum_app', c.oid, 'DELETE') AS app_delete,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
        WHERE grantee=0 AND privilege_type='SELECT') AS public_read
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('asterisk_memory_preferences', 'user_follows', 'wardrobe_items', 'discover_rails', 'user_rail_prefs',
                        'profile_themes', 'profile_rooms', 'profile_modules', 'brand_cases', 'brand_case_events')
    ORDER BY c.relname`);
  assert.equal(memorySecurity.rows.length, 10);
  for (const row of memorySecurity.rows) {
    assert.equal(row.rls, true, `${row.relname} must have RLS enabled`);
    assert.equal(row.app_select, true, `asilum_app must read ${row.relname}`);
    assert.equal(row.public_read, false, `${row.relname} must not be publicly readable`);
    if (row.relname === "brand_cases") {
      assert.equal(row.app_insert, true);
      assert.equal(row.app_update, true);
      assert.equal(row.app_delete, false, "case records are retained operational evidence");
    } else if (row.relname === "brand_case_events") {
      assert.equal(row.app_insert, true);
      assert.equal(row.app_update, false, "the transition ledger is append-only");
      assert.equal(row.app_delete, false, "the transition ledger is append-only");
    }
  }

  await production.setFollow(from, "brand", "Integration Brand", true);
  await production.setFollow(to, "brand", "Integration Brand", true);
  await production.setFollow(from, "user", "@integration", true);
  await production.saveMemoryPreferences(from, { hiddenSections: ["global"], guidanceEnabled: false });
  await production.saveMemoryPreferences(to, { hiddenSections: ["inferred"], guidanceEnabled: true });
  const memoryAdoption = await production.adoptAccountData(from, to);
  assert.equal(memoryAdoption.duplicate, false);
  assert.equal((await production.listFollows(from)).length, 0);
  const adoptedFollows = await production.listFollows(to);
  assert.equal(adoptedFollows.filter((f) => f.target === "Integration Brand").length, 1,
    "duplicate follows must not double on adoption");
  assert.equal(adoptedFollows.filter((f) => f.target === "@integration").length, 1);
  assert.deepEqual((await production.getMemoryPreferences(to)).hiddenSections, ["inferred"],
    "account-side preferences win on adoption");
  assert.equal((await production.getMemoryPreferences(to)).guidanceEnabled, true,
    "account-side guidance preference wins on adoption");
  assert.deepEqual((await production.getMemoryPreferences(from)).hiddenSections, []);

  let activePhotoOps = 0;
  let peakPhotoOps = 0;
  await Promise.all([1, 2, 3].map(() => production.withUserOperationLock(from, async () => {
    activePhotoOps++;
    peakPhotoOps = Math.max(peakPhotoOps, activePhotoOps);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activePhotoOps--;
  })));
  assert.equal(peakPhotoOps, 1, "persistent owner-operation locks serialize Storage/erasure work");

  const longCatalogRef = `catalog:${"x".repeat(80)}`;
  const wardrobeAdd = await production.createWardrobeItem({
    userId: from, source: "manual", sourceRef: null, catalogItemId: null,
    title: "integration overcoat", brand: null, category: "outerwear",
    sizeLabel: null, colors: [], tags: { MINIMAL: 0.5 }, acquiredAt: null,
  });
  assert.equal(wardrobeAdd.duplicate, false);
  for (const owner of [from, to]) {
    const catalogAdd = await production.createWardrobeItem({
      userId: owner, source: "catalog", sourceRef: longCatalogRef, catalogItemId: null,
      title: "integration duplicate", brand: null, category: "tops",
      sizeLabel: null, colors: [], tags: {}, acquiredAt: null,
    });
    assert.equal(catalogAdd.duplicate, false);
  }
  const wardrobeAdoptions = await Promise.all([
    production.adoptAccountData(from, to),
    production.adoptAccountData(from, to),
  ]);
  assert.equal(wardrobeAdoptions.filter((result) => result.duplicate).length, 1,
    "identity locks make concurrent wardrobe adoption idempotent");
  assert.equal((await production.listWardrobeItems(from, { status: "all" })).length, 0);
  const ownedByAccount = await production.listWardrobeItems(to, { status: "all" });
  assert.equal(ownedByAccount.filter((piece) => piece.title === "integration overcoat").length, 1);
  assert.equal(ownedByAccount.filter((piece) => piece.sourceRef === longCatalogRef).length, 1,
    "namespaced 80-character catalog ids fit and dedupe during adoption");

  const measurementSecurity = await pool.query(`
    SELECT c.relrowsecurity AS rls,
      has_table_privilege('asilum_app', 'public.user_measurements', 'SELECT,INSERT,UPDATE,DELETE') AS app_access,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
        WHERE grantee=0 AND privilege_type='SELECT') AS public_read
    FROM pg_class AS c
    WHERE c.oid='public.user_measurements'::regclass
  `);
  assert.equal(measurementSecurity.rows[0].rls, true);
  assert.equal(measurementSecurity.rows[0].app_access, true);
  assert.equal(measurementSecurity.rows[0].public_read, false);

  const interpretationSecurity = await pool.query(`
    SELECT c.relname, c.relrowsecurity AS rls,
      has_table_privilege('asilum_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS app_access,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
        WHERE grantee=0 AND privilege_type='SELECT') AS public_read
    FROM pg_class AS c
    WHERE c.oid IN (
      'public.unknown_queries'::regclass,
      'public.unknown_query_votes'::regclass,
      'public.interpretation_feedback'::regclass
    )
    ORDER BY c.relname
  `);
  assert.equal(interpretationSecurity.rows.length, 3);
  for (const row of interpretationSecurity.rows) {
    assert.equal(row.rls, true, `${row.relname} must have RLS enabled`);
    assert.equal(row.app_access, true, `${row.relname} must be reachable by asilum_app`);
    assert.equal(row.public_read, false, `${row.relname} must not be publicly readable`);
  }

  const defaults = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_default_acl AS defaults,
        LATERAL aclexplode(defaults.defaclacl) AS privilege
      WHERE defaults.defaclnamespace='public'::regnamespace
        AND defaults.defaclobjtype='f'
        AND privilege.grantee=0
        AND privilege.privilege_type='EXECUTE'
    ) AS public_function_execute
  `);
  assert.equal(defaults.rows[0].public_function_execute, false);
});

// v22 — gamma edge corroboration. The mem path is unit-tested in
// tests/graph-corroboration.test.js; this is the Postgres half, because a
// ledger that existed on only one path would leave every preview deploy and
// local dev running the ungated rule while reporting success.
test("Postgres edge corroboration: one identity contributes once", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  // Fresh module instance: the test above ends the shared pool in its
  // cleanup, and a second test reusing it dies with "Cannot use a pool after
  // calling end on the pool".
  const db = await import("../lib/db/index.js?corroboration=1");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const A = `pgcorr-a-${suffix}`;
  const B = `pgcorr-b-${suffix}`;
  const lo = A < B ? A : B, hi = A < B ? B : A;
  t.after(async () => {
    await pool.query("DELETE FROM edge_contributors WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [[A, B]]);
    await pool.query("DELETE FROM edges WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [[A, B]]);
  });

  // The attack: one identity, the same pair, 25 times.
  for (let i = 0; i < 25; i++) await db.bumpEdges([{ a: A, b: B, w: 2 }], "pg-attacker");
  let row = (await pool.query("SELECT w,contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi])).rows[0];
  assert.equal(row.contributors, 1, "25 forged engagements must remain ONE contributor");
  assert.equal(Number(row.w), 2, "w is that contributor's BEST action, never a sum");

  for (const who of ["pg-2", "pg-3"]) await db.bumpEdges([{ a: A, b: B, w: 1 }], who);
  row = (await pool.query("SELECT w,contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi])).rows[0];
  assert.equal(row.contributors, 3, "distinct people accumulate");
  assert.equal(Number(row.w), 4, "sum of per-contributor bests (2 + 1 + 1)");

  const edges = await db.getEdges([A]);
  assert.equal(edges[A][B], 3, "getEdges reports the distinct-contributor count");
});

// The path that broke production: writeEdges called with a transaction CLIENT
// rather than a pool. A pooled client also exposes .connect(), so a naive
// pool check called connect() on it and every /api/interaction 500'd. The unit
// suite runs mem-mode and the test above uses the POOL path, so neither could
// see it — this drives the real commit transaction.
test("Postgres edge corroboration through commitInteractionBatch", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?corroboration-txn=1");
  const { learn } = await import("../lib/brain/index.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const userId = `u-txn-${suffix}`;
  const anchor = `txn-anchor-${suffix}`;
  const item = { id: `txn-item-${suffix}`, tags: { MINIMAL: 0.7 }, brand: "X" };
  t.after(async () => {
    for (const table of ["user_events", "interactions", "processed_operations", "profiles"]) {
      await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    }
    await pool.query("DELETE FROM edge_contributors WHERE identity_hash=$1", [db.identityHash(userId)]);
    await pool.query("DELETE FROM edges WHERE a=ANY($1::text[]) OR b=ANY($1::text[])", [[anchor, item.id]]);
  });

  const commit = async (op) => db.commitInteractionBatch({
    userId, operationId: op,
    events: [{ itemId: item.id, action: "bag", dwellMs: null,
      canonicalEvent: { userId, type: "USER_ADDED_TO_BAG", payload: { itemId: item.id }, at: Date.now(), v: 1 } }],
    reduce: (cur) => ({
      profile: learn(cur || {}, item, "bag"),
      edgePairs: [{ a: anchor, b: item.id, w: 2 }],
      popularity: [{ id: item.id, eng: 1 }],
    }),
  });

  await commit(null);
  await commit(null);
  await commit(null);
  const lo = anchor < item.id ? anchor : item.id;
  const hi = anchor < item.id ? item.id : anchor;
  const row = (await pool.query("SELECT w,contributors FROM edges WHERE a=$1 AND b=$2", [lo, hi])).rows[0];
  assert.ok(row, "the in-transaction write must actually land");
  assert.equal(row.contributors, 1, "three commits by one identity remain one contributor");
});

// The popularity write path had NO Postgres coverage until now, and it is the
// one place a ranking-critical SQL statement reached production untested: the
// v25 decayed-aggregate recompute runs INSIDE the interaction transaction, so
// a syntax or type error there would 500 every /api/interaction. The unit
// suite exercises only mem mode, which computes the same quantity in
// JavaScript and therefore cannot see a broken query.
//
// This is the same class of gap that once broke production through
// writeEdges — covered by the two tests above only after it shipped.
test("Postgres popularity: people counted once, evidence ages, erasure recomputes",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?popularity=1");
  // production.js imports "./index.js" WITHOUT a query string, so its module
  // graph points at the instance whose pool the first test in this file ends
  // (getPool caches, and an ended pool stays ended). Every call below therefore
  // injects THIS test's live pool via queryTarget rather than letting the
  // erasure path reach for a dead one.
  const production = await import("../lib/db/production.js?popularity=1");
  const { halfLifeMs } = await import("../lib/brain/popularity.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const item = `pgpop-item-${suffix}`;
  const people = [1, 2, 3, 4].map((n) => `pgpop-u${n}-${suffix}`);
  const HALF_SECONDS = Math.round(halfLifeMs() / 1000);
  const row = async () => (await pool.query(
    "SELECT engagers,viewers,engagers_decayed,viewers_decayed,decayed_at FROM popularity WHERE item_id=$1",
    [item]
  )).rows[0];

  t.after(async () => {
    await pool.query("DELETE FROM popularity_contributors WHERE item_id=$1", [item]);
    await pool.query("DELETE FROM popularity WHERE item_id=$1", [item]);
    for (const table of ["user_events", "interactions", "processed_operations", "profiles"]) {
      await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [people]);
    }
    await pool.end();
  });

  // ---- the counting rule, through real SQL ---------------------------------
  for (let i = 0; i < 12; i++) await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], people[0]);
  let r = await row();
  assert.equal(r.engagers, 1, "twelve forged engagements from one identity remain ONE engager");
  assert.equal(r.viewers, 1);

  for (const who of people.slice(1)) await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], who);
  r = await row();
  assert.equal(r.engagers, 4, "distinct people accumulate");
  assert.equal(r.viewers, 4);

  // ---- v25: the decayed aggregate the mem path cannot validate -------------
  assert.ok(r.decayed_at, "the recompute must stamp decayed_at");
  assert.ok(Math.abs(Number(r.engagers_decayed) - 4) < 1e-4,
    `fresh evidence is worth a whole person each: ${r.engagers_decayed}`);
  assert.ok(Math.abs(Number(r.viewers_decayed) - 4) < 1e-4);

  // Age every contributor by exactly ONE half-life, then force a recompute
  // that changes no counts (a repeat from a known identity). This is the
  // assertion that actually exercises power(0.5, epoch/half_life) against a
  // real interval — the arithmetic no other test in the repo runs on Postgres.
  await pool.query(
    "UPDATE popularity_contributors SET first_seen = now() - make_interval(secs => $2) WHERE item_id=$1",
    [item, HALF_SECONDS]
  );
  await db.bumpPopularity([{ id: item, eng: 1, imp: 1 }], people[0]);
  r = await row();
  assert.equal(r.engagers, 4, "ageing changes what evidence is WORTH, never who is counted");
  assert.ok(Math.abs(Number(r.engagers_decayed) - 2) < 0.02,
    `four people at one half-life must weigh ~2.0, got ${r.engagers_decayed}`);
  assert.ok(Number(r.engagers_decayed) <= r.engagers + 1e-6, "decayed can never exceed lifetime");

  // ---- materialize-then-carry, through the real reader ---------------------
  // Backdate the stamp rather than the ledger: this is the OTHER half of the
  // arithmetic — the read-time factor getPopularity applies to a sum that was
  // materialized in the past.
  const storedAt = Number((await row()).engagers_decayed);
  await pool.query(
    "UPDATE popularity SET decayed_at = now() - make_interval(secs => $2) WHERE item_id=$1",
    [item, HALF_SECONDS]
  );
  const snapshot = await db.getPopularity(5000);
  assert.ok(snapshot[item], "the item must appear in the popularity snapshot");
  assert.ok(Math.abs(snapshot[item].engagersDecayed - storedAt / 2) < 0.02,
    `a sum materialized one half-life ago must read at half: ${snapshot[item].engagersDecayed} vs ${storedAt / 2}`);
  assert.equal(snapshot[item].engagers, 4, "lifetime counts are carried through unaged");

  // ---- erasure recomputes the DECAYED columns too --------------------------
  // The bug this catches: an erasure that updated only engagers/viewers would
  // leave a departed person's recency-weighted contribution scoring forever.
  // queryTarget is used as the CLIENT, not as a pool to connect from — the
  // function runs BEGIN/COMMIT on it directly. Handing it a Pool would scatter
  // those across different connections and leave a dangling transaction, so
  // this checks out one dedicated client and releases it here (ownsClient is
  // false when queryTarget is supplied, so the function will not release it).
  const purgeClient = await pool.connect();
  try {
    await production.purgePersonalizationData(people[0], { queryTarget: purgeClient });
  } finally {
    purgeClient.release();
  }
  r = await row();
  assert.equal(r.engagers, 3, "a departed person stops being an engager");
  assert.equal(r.viewers, 3);
  assert.ok(Math.abs(Number(r.engagers_decayed) - 1.5) < 0.02,
    `and stops being counted in the WEIGHTED total too: ${r.engagers_decayed} (three people at one half-life = 1.5)`);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM popularity_contributors WHERE item_id=$1", [item])).rows[0].n,
    3, "the ledger row is gone, not merely ignored");
});

// The transaction path, for the same reason the edge version of this test
// exists: /api/interaction writes popularity inside commitInteractionBatch,
// against a transaction CLIENT rather than the pool. A statement that works on
// the pool and fails on the client 500s every interaction, and nothing else in
// the suite would notice.
test("Postgres popularity through commitInteractionBatch", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?popularity-txn=1");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const userId = `pgpoptxn-u-${suffix}`;
  const item = `pgpoptxn-item-${suffix}`;

  t.after(async () => {
    await pool.query("DELETE FROM popularity_contributors WHERE item_id=$1", [item]);
    await pool.query("DELETE FROM popularity WHERE item_id=$1", [item]);
    for (const table of ["user_events", "interactions", "processed_operations", "profiles"]) {
      await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    }
    await pool.end();
  });

  const result = await db.commitInteractionBatch({
    userId,
    operationId: randomUUID(),
    events: [{
      itemId: item, action: "favorite", dwellMs: null,
      canonicalEvent: { userId, type: "USER_FAVORITED_ITEM", payload: { itemId: item }, at: Date.now(), v: 1 },
    }],
    reduce: () => ({ profile: { long: { MINIMAL: 0.4 }, session: {}, _meta: {} }, edgePairs: [], popularity: [{ id: item, eng: 1 }] }),
  });
  assert.equal(result.duplicate, false);

  const r = (await pool.query(
    "SELECT engagers,engagers_decayed,decayed_at FROM popularity WHERE item_id=$1", [item])).rows[0];
  assert.ok(r, "the transaction must have written a popularity row");
  assert.equal(r.engagers, 1, "the identity ledger is written inside the transaction");
  assert.ok(r.decayed_at, "and the v25 recompute runs there too — this is the statement that had never executed on Postgres");
  assert.ok(Math.abs(Number(r.engagers_decayed) - 1) < 1e-4, "one fresh person weighs 1.0");
});
// ---------------------------------------------------------------------------
// THE DM LAWS (schema v40). These are Postgres triggers, and until now every
// law in this product that lived in a trigger was proved only by a memory-mode
// mirror written from the same prose — a second implementation that tests then
// certified. The red team named that as the standing defect in the DM design,
// and traps 58 and 71 are the same shape. So the laws are exercised HERE,
// against a real database, through raw SQL rather than through the store, so
// that a store that forgets to check still fails.
//
// Each law is asserted with the SQLSTATE the trigger raises, not just "it
// threw" — a CHECK failing for an unrelated reason would otherwise read as the
// law working.

// CI creates a stub `auth.users (id uuid PRIMARY KEY)` (ci.yml), and v40 adds
// the conditional FK against it — so a DM account must EXIST before it can
// hold a conversation. That is the constraint working: a thread cannot name a
// person who was never here. The fixture seeds the two accounts.
async function dmAccounts(pool) {
  const ids = [randomUUID(), randomUUID()].sort();  // lo < hi, as the CHECK requires
  for (const id of ids) {
    await pool.query(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
  }
  return { lo: ids[0], hi: ids[1] };
}

async function dmFixture(pool, { state = "accepted", openedBy = "lo" } = {}) {
  const { lo, hi } = await dmAccounts(pool);
  const opener = openedBy === "lo" ? lo : hi;
  const stamp = state === "accepted" ? ", accepted_at = now()"
    : state === "declined" ? ", declined_at = now()" : "";
  const r = await pool.query(
    `INSERT INTO dm_conversations (lo_account_id, hi_account_id, state, opened_by, accepted_at, declined_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $3='accepted' THEN now() END, CASE WHEN $3='declined' THEN now() END)
     RETURNING id`, [lo, hi, state, opener]);
  const id = r.rows[0].id;
  await pool.query(`INSERT INTO dm_participants (conversation_id, account_id) VALUES ($1,$2),($1,$3)`,
    [id, lo, hi]);
  return { id, lo, hi, opener };
}

test("DM law 1: a per-account block stops delivery in BOTH directions",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm1");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const c = await dmFixture(pool);
  // baseline: both directions work
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'hello')`, [c.id, c.lo]);
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'hi')`, [c.id, c.hi]);

  // hi blocks lo. Per-account (owner ruling), so the row names people, not a thread.
  await pool.query(`INSERT INTO dm_blocks (blocker_account_id, blocked_account_id) VALUES ($1,$2)`, [c.hi, c.lo]);

  await assert.rejects(
    () => pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'again')`, [c.id, c.lo]),
    (e) => e.code === "P0001", "the blocked person cannot send");
  // and the BLOCKER cannot send either — a block is not a mute
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'reply')`, [c.id, c.hi]),
    (e) => e.code === "P0001", "the block stops both directions");

  // THE RULING: per-account, so it survives a brand-new conversation.
  const second = await pool.query(
    `INSERT INTO dm_conversations (lo_account_id, hi_account_id, state, opened_by, accepted_at)
     VALUES ($1,$2,'accepted',$1, now()) RETURNING id`, [c.lo, c.hi]).catch((e) => e);
  assert.ok(second instanceof Error && second.code === "23505",
    "a duplicate pair is unrepresentable, so there is no second thread to escape into");
});

test("DM law 2: a passport can close its DMs; a BUSINESS cannot",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm2");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const c = await dmFixture(pool);
  // hi is a passport and closes its door
  await pool.query(`INSERT INTO dm_settings (account_id, dms_open) VALUES ($1,false)`, [c.hi]);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'x')`, [c.id, c.lo]),
    (e) => e.code === "P0002", "a closed passport receives nothing");

  // the same account becomes a business — the door must reopen, and must not
  // be closable again. The kind is read LIVE, so no pinned copy can go stale.
  await pool.query(`INSERT INTO account_kinds (account_id, kind) VALUES ($1,'business')
                    ON CONFLICT (account_id) DO UPDATE SET kind='business'`, [c.hi]);
  // (c.hi already exists in auth.users — the fixture seeded it — so v38's FK
  // on account_kinds is satisfied.)
  await assert.rejects(
    () => pool.query(`UPDATE dm_settings SET dms_open=false WHERE account_id=$1`, [c.hi]),
    (e) => e.code === "P0004", "a business cannot switch messages off");

  await pool.query(`UPDATE dm_settings SET dms_open=true WHERE account_id=$1`, [c.hi]);
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'now open')`, [c.id, c.lo]);
});

test("DM law 3: one knock until the request is accepted",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm3");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const c = await dmFixture(pool, { state: "requested", openedBy: "lo" });
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'knock')`, [c.id, c.lo]);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'and again')`, [c.id, c.lo]),
    (e) => e.code === "P0003", "a stranger gets one message, not a channel");

  // the RECIPIENT is not limited — replying is how a request gets accepted
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'who is this')`, [c.id, c.hi]);

  // once accepted, the initiator is free
  await pool.query(`UPDATE dm_conversations SET state='accepted', accepted_at=now() WHERE id=$1`, [c.id]);
  await pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'thanks')`, [c.id, c.lo]);
});

test("DM: a non-participant cannot insert into someone else's conversation",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm4");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const c = await dmFixture(pool);
  const stranger = randomUUID();
  await pool.query(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, [stranger]);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_messages (conversation_id, sender_account_id, body) VALUES ($1,$2,'intruder')`,
      [c.id, stranger]),
    (e) => e.code === "42501",
    "a REAL account that is simply not in this thread is refused by the trigger, not by the FK");
});

test("DM: self-conversations and duplicate threads are UNREPRESENTABLE",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm5");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const me = randomUUID();
  await pool.query(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, [me]);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_conversations (lo_account_id, hi_account_id, opened_by) VALUES ($1,$1,$1)`, [me]),
    (e) => e.code === "23514", "lo < hi refuses a self-DM, before the FK is even consulted");

  const { lo, hi } = await dmAccounts(pool);
  await pool.query(`INSERT INTO dm_conversations (lo_account_id, hi_account_id, opened_by) VALUES ($1,$2,$1)`, [lo, hi]);
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_conversations (lo_account_id, hi_account_id, opened_by) VALUES ($1,$2,$2)`, [lo, hi]),
    (e) => e.code === "23505", "one pair, one thread");
  // and the pair cannot be smuggled in reversed
  await assert.rejects(
    () => pool.query(`INSERT INTO dm_conversations (lo_account_id, hi_account_id, opened_by) VALUES ($1,$2,$1)`, [hi, lo]),
    (e) => e.code === "23514", "the ordered pair has no back door");
});

test("DM: leaving 'accepted' does not destroy the record that consent happened",
  { skip: !databaseUrl }, async (t) => {
  // A biconditional CHECK would force accepted_at to be NULLed to change
  // state, deleting material context from a harassment case.
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js?dm6");
  const pool = await db.getPool();
  t.after(async () => { await pool.end(); });

  const c = await dmFixture(pool);
  await pool.query(`UPDATE dm_conversations SET state='declined', declined_at=now() WHERE id=$1`, [c.id]);
  const row = await pool.query(`SELECT accepted_at, declined_at FROM dm_conversations WHERE id=$1`, [c.id]);
  assert.ok(row.rows[0].accepted_at, "the acceptance timestamp survives the state change");
  assert.ok(row.rows[0].declined_at);
});

// ---- v53: user_records ------------------------------------------------------
// The device-only V.2 records (saves of people/places/events/articles, the
// base city, corrections, studio drafts) as real rows. The mem twin is in
// tests/user-records.test.js; this is the Postgres half of the differential:
// the unique key, the no-clobber adoption, erasure, and the app role's grants.
test("v53: user_records adopt without clobbering, erase, export, and the app role can write them", { skip: !databaseUrl }, async () => {
  const db = await import("../lib/db/index.js");
  const production = await import("../lib/db/production.js");
  const pool = await db.getPool();
  const device = `u-${randomUUID()}`;
  const account = `sb-${randomUUID()}`;
  const first = await production.putUserRecord(device, { kind: "save", recordId: "place:pg-fashion-week", payload: { from: "device" } });
  assert.equal(first.created, true);
  assert.equal(first.record.persistent, true);
  const upsert = await production.putUserRecord(device, { kind: "save", recordId: "place:pg-fashion-week", payload: { from: "device", edited: true } });
  assert.equal(upsert.created, false, "the unique key makes a second write an update");
  await production.putUserRecord(device, { kind: "location", recordId: "base", payload: { from: "device" } });
  await production.putUserRecord(device, { kind: "save", recordId: "person:x", payload: { from: "device" } });
  await production.putUserRecord(account, { kind: "save", recordId: "person:x", payload: { from: "account" } });
  await assert.rejects(production.putUserRecord(device, { kind: "wishes", recordId: "a", payload: {} }), /unknown record kind/);

  await production.adoptAccountData(device, account);
  const saves = await production.listUserRecords(account, { kind: "save" });
  assert.equal(saves.length, 2);
  assert.equal(saves.find((r) => r.recordId === "person:x").payload.from, "account", "no-clobber");
  assert.equal(saves.find((r) => r.recordId === "place:pg-fashion-week").payload.edited, true);
  assert.equal((await production.listUserRecords(account, { kind: "location" })).length, 1);
  assert.equal((await production.listUserRecords(device)).length, 0);

  const exported = await production.exportPersonalizationData(account);
  assert.equal(exported.data.records.rows.length, 3);

  await production.purgePersonalizationData(account);
  assert.equal((await production.listUserRecords(account)).length, 0);
  const left = await pool.query("SELECT count(*)::int AS n FROM user_records WHERE user_id = ANY($1)", [[device, account]]);
  assert.equal(left.rows[0].n, 0, "erasure reaches the table");

  const grants = await pool.query(
    `SELECT privilege_type FROM information_schema.role_table_grants
     WHERE table_name='user_records' AND grantee='asilum_app' ORDER BY privilege_type`);
  if (grants.rows.length) {
    assert.deepEqual(grants.rows.map((r) => r.privilege_type), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
  }
  const policy = await pool.query("SELECT policyname FROM pg_policies WHERE tablename='user_records'");
  assert.ok(policy.rows.some((r) => r.policyname === "asilum_app_server_access"), "RLS policy for the app role");
  const scopeCol = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='user_corrections' AND column_name IN ('scope','undone_at')");
  assert.equal(scopeCol.rows.length, 2, "v53 also gave user_corrections scope + undone_at");
});

// ---- the dead vectors (optimize round, 20 Sep 2026) --------------------------
// The mem law (tests/perf-read-paths E7) is a Map lookup; the Postgres law is
// a JOIN. This is the differential that keeps them the same law.
test("Postgres: a product vector loads only while its product exists", { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const pool = await db.getPool();
  const suffix = randomUUID();
  const space = `pgvec-${suffix}`;
  const live = `pgvec-live-${suffix}`;
  const ghost = `pgvec-ghost-${suffix}`;
  // A row id is `<space>:<owner>` regardless of owner_kind, so a user vector
  // needs its own owner id here (in the app, user ids and product ids never
  // share a namespace).
  const person = `pgvec-person-${suffix}`;
  t.after(async () => {
    await pool.query("DELETE FROM embeddings WHERE space=$1", [space]);
    await pool.query("DELETE FROM items WHERE id=$1", [live]);
  });
  await db.upsertItems([{ id: live, title: "a live listing", price: 10 }]);
  await db.saveEmbeddings([
    { ownerId: live, space, vector: [1, 0, 0] },
    { ownerId: ghost, space, vector: [0, 0, 1] },
    { ownerId: person, ownerKind: "user", space, vector: [0, 1, 0] },
  ]);
  const { rows: stored } = await pool.query("SELECT count(*)::int AS n FROM embeddings WHERE space=$1", [space]);
  assert.equal(stored[0].n, 3, "all three rows are in the table — the filter is on the read, not the write");
  const products = (await db.listEmbeddings(space, "product")).map((r) => r.owner_id);
  assert.deepEqual(products, [live], "the ghost's product vector does not load");
  const users = (await db.listEmbeddings(space, "user")).map((r) => r.owner_id);
  assert.deepEqual(users, [person], "a non-product vector is not judged by the items table");
});

// ---------------------------------------------------------------------------
// STAGE C OF THE MAIL DESK (V.2 brief §3–§4, schema v59). The laws a unit
// suite cannot prove: the hour measured by the database's clock, the version
// check, the per-viewer clear boundary, the search predicate, the profile
// card's refusals and its view-time render.
// ---------------------------------------------------------------------------

async function stageCFixture(pool) {
  const f = await dmFixture(pool, { state: "accepted", openedBy: "lo" });
  return f;
}

test("DM stage C: an edit is the sender's, inside the hour, carrying the version it saw",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();
  assert.equal(await dm.stageCApplied(pool), true, "CI applies v59");
  const { id: convo, lo: a, hi: b } = await stageCFixture(pool);
  const m = await dm.sendMessage({ conversationId: convo, senderId: a, body: "first words" });

  // the recipient cannot edit the sender's words — and learns only "cannot"
  await assert.rejects(() => dm.editMessage(b, m.id, "theirs now", 0), (e) => e.code === "P0006");
  // a stale version is refused, never merged
  const e1 = await dm.editMessage(a, m.id, "second words", 0);
  assert.equal(e1.editVersion, 1); assert.ok(e1.editedAt);
  await assert.rejects(() => dm.editMessage(a, m.id, "from a stale tab", 0), (e) => e.code === "P0008");
  const e2 = await dm.editMessage(a, m.id, "third words", 1);
  assert.equal(e2.editVersion, 2);
  // the thread says so
  const t = await dm.readThread(a, convo);
  const row = t.messages.find((x) => x.id === Number(m.id));
  assert.equal(row.body, "third words"); assert.equal(row.edited, true); assert.equal(row.editVersion, 2); assert.equal(row.kind, "text");

  // 59:59 works, 60:00 fails — the DATABASE's clock, not the client's
  await pool.query(`UPDATE dm_messages SET created_at = clock_timestamp() - interval '59 minutes 59 seconds' WHERE id=$1`, [m.id]);
  const e3 = await dm.editMessage(a, m.id, "just in time", 2);
  assert.equal(e3.editVersion, 3);
  await pool.query(`UPDATE dm_messages SET created_at = clock_timestamp() - interval '1 hour' WHERE id=$1`, [m.id]);
  await assert.rejects(() => dm.editMessage(a, m.id, "too late", 3), (e) => e.code === "P0007");
  assert.equal((await pool.query(`SELECT body FROM dm_messages WHERE id=$1`, [m.id])).rows[0].body, "just in time");

  // the trigger is the second lock: a raw write that skips the version is refused
  const raw = await pool.connect();
  try {
    await raw.query("BEGIN");
    await raw.query("SELECT set_config('asilum.dm_actor', $1, true)", [a]);
    await pool.query(`UPDATE dm_messages SET created_at = clock_timestamp() WHERE id=$1`, [m.id]);
    await assert.rejects(() => raw.query(`UPDATE dm_messages SET body='raw', edited_at=now() WHERE id=$1`, [m.id]), (e) => e.code === "P0008", "the version must climb by one");
    await raw.query("ROLLBACK");
    await raw.query("BEGIN");
    await assert.rejects(() => raw.query(`UPDATE dm_messages SET body='raw', edited_at=now(), edit_version=edit_version+1 WHERE id=$1`, [m.id]), (e) => e.code === "42501", "an unattributed edit is nobody's act");
    await raw.query("ROLLBACK");
  } finally { raw.release(); }

  // an unsent message cannot be edited, and unsend itself closes at the hour
  const u = await dm.sendMessage({ conversationId: convo, senderId: a, body: "withdraw me" });
  await pool.query(`UPDATE dm_messages SET created_at = clock_timestamp() - interval '1 hour' WHERE id=$1`, [u.id]);
  assert.equal(await dm.unsendMessage(a, u.id), false, "60:00 — the unsend window is closed");
  await pool.query(`UPDATE dm_messages SET created_at = clock_timestamp() - interval '59 minutes' WHERE id=$1`, [u.id]);
  assert.equal(await dm.unsendMessage(a, u.id), true);
  await assert.rejects(() => dm.editMessage(a, u.id, "back from the dead", 0), (e) => e.code === "P0006");
  // and a too-long edit is refused by count before any write
  await assert.rejects(() => dm.editMessage(a, m.id, "x".repeat(1001), 3), (e) => e.code === "DM_TOO_LONG");
});

test("DM stage C: clear history is per viewer, reintroduced by a new message, told once and neutrally",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const notes = await import("../lib/db/production/listingStatus.js");
  const pool = await db.getPool();
  const { id: convo, lo: a, hi: b } = await stageCFixture(pool);
  const m1 = await dm.sendMessage({ conversationId: convo, senderId: a, body: "before the clear" });
  await dm.sendMessage({ conversationId: convo, senderId: b, body: "also before" });

  assert.equal(await dm.clearHistory(b, randomUUID()), null, "a non-member gets the absent answer");
  // the notice is OFF by default (OWNER-DECISIONS §9); this test turns it on to prove the path
  process.env.DM_CLEAR_NOTICES = "1";
  const cleared = await dm.clearHistory(a, convo);
  assert.equal(cleared.clearedBeforeId >= Number(m1.id) + 1, true);
  assert.equal(cleared.noticed, true, "the other participant is told once, when the switch is on");

  // my copy is empty, theirs is whole
  assert.deepEqual((await dm.readThread(a, convo)).messages, []);
  assert.ok((await dm.readThread(a, convo)).clearedAt);
  assert.equal((await dm.readThread(b, convo)).messages.length, 2, "the other participant's copy is untouched");
  // the conversation leaves MY list until something new arrives
  assert.equal((await dm.listFolder(a)).items.some((i) => i.id === convo), false, "cleared: gone from my inbox");
  assert.equal((await dm.listFolder(b)).items.some((i) => i.id === convo), true);
  assert.deepEqual(await dm.unreadSummary(a), { inbox: 0, requests: 0 }, "nothing unread behind the boundary");

  // a new message reintroduces it — without the history
  const m3 = await dm.sendMessage({ conversationId: convo, senderId: b, body: "after the clear" });
  const mine = await dm.listFolder(a);
  const row = mine.items.find((i) => i.id === convo);
  assert.ok(row, "reintroduced"); assert.equal(row.preview, "after the clear"); assert.equal(row.unread, 1);
  assert.deepEqual((await dm.readThread(a, convo)).messages.map((x) => x.body), ["after the clear"]);
  assert.equal((await dm.readThread(b, convo)).messages.length, 3);

  // the notice: neutral words, no body, once per clear; a second clear is a second notice
  const list = await notes.listNotifications("sb-" + b);
  const notice = list.find((n) => n.kind === "dm-cleared" && n.subjectId.startsWith(convo));
  assert.ok(notice); assert.match(notice.payload.text, /cleared their own copy/); assert.doesNotMatch(notice.payload.text, /delet/);
  assert.equal(JSON.stringify(notice.payload).includes("before the clear"), false, "a notice never carries message text");
  await new Promise((r) => setTimeout(r, 5));
  const again = await dm.clearHistory(a, convo);
  assert.equal(again.clearedBeforeId >= Number(m3.id), true);
  assert.equal((await notes.listNotifications("sb-" + b)).filter((n) => n.kind === "dm-cleared" && n.subjectId.startsWith(convo)).length, 2);

  // the default: off means no notice, and the clear still happens
  delete process.env.DM_CLEAR_NOTICES;
  try {
    await dm.sendMessage({ conversationId: convo, senderId: b, body: "one more" });
    const quiet = await dm.clearHistory(a, convo);
    assert.equal(quiet.noticed, false);
    assert.equal((await notes.listNotifications("sb-" + b)).filter((n) => n.kind === "dm-cleared" && n.subjectId.startsWith(convo)).length, 2);
  } finally { delete process.env.DM_CLEAR_NOTICES; }
});

test("DM stage C: search sees only my own visible history — after my cutoff, never unsent, never a knock, never another viewer's",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const pool = await db.getPool();
  const tag = randomUUID().slice(0, 6);
  const { id: convo, lo: a, hi: b } = await stageCFixture(pool);
  await publishRoom(pool, b, `jerry-${tag}`);
  await dm.sendMessage({ conversationId: convo, senderId: a, body: `Jerry’s ice cream ${tag} is the best` });
  const gone = await dm.sendMessage({ conversationId: convo, senderId: b, body: `ice cream ${tag} unsent soon` });
  await dm.unsendMessage(b, gone.id);
  await dm.sendMessage({ conversationId: convo, senderId: b, body: `cream ${tag} without the ice` });

  // words, with a straight apostrophe finding the curly one
  const words = await dm.searchMessages(a, `jerry's ice cream ${tag}`);
  assert.equal(words.mode, "messages");
  assert.deepEqual(words.hits.map((h) => h.handle), [`jerry-${tag}`]);
  assert.ok(words.hits[0].excerpt.includes("Jerry's ice cream"));
  assert.equal(words.hits[0].conversationId, convo); assert.equal(typeof words.hits[0].messageId, "number");
  // the unsent message is not findable by anyone
  assert.equal((await dm.searchMessages(b, `unsent soon`)).hits.length, 0);
  assert.equal((await dm.searchMessages(a, `unsent soon`)).hits.length, 0);
  // exact phrase vs words
  assert.equal((await dm.searchMessages(a, `"ice ${tag} without"`)).hits.length, 0, "a quoted phrase is contiguous");
  assert.equal((await dm.searchMessages(a, `ice ${tag} without`)).hits.length, 1, "words need not be adjacent");
  // *handle → conversations; *handle: words → messages with them; an unknown handle → nothing
  const convos = await dm.searchMessages(a, `*jerry-${tag}`);
  assert.equal(convos.mode, "conversations"); assert.deepEqual(convos.hits.map((h) => h.conversationId), [convo]);
  assert.equal((await dm.searchMessages(a, `*jerry-${tag}: cream ${tag}`)).hits.length, 2);
  assert.equal((await dm.searchMessages(a, `*nobody-${tag}: cream`)).hits.length, 0);
  // LIKE's own characters are literal
  assert.equal((await dm.searchMessages(a, `%${tag}%`)).hits.length, 0);
  // another viewer sees nothing of this thread
  const { lo: stranger } = await dmAccounts(pool);
  assert.equal((await dm.searchMessages(stranger, `cream ${tag}`)).hits.length, 0, "a forged viewer changes nothing");
  // after my clear, my search is empty; theirs is not
  await dm.clearHistory(a, convo);
  assert.equal((await dm.searchMessages(a, `cream ${tag}`)).hits.length, 0, "cleared history is not searchable");
  assert.equal((await dm.searchMessages(b, `cream ${tag}`)).hits.length, 2);
  // a stranger's knock in REQUESTS is not mine to search
  const { lo: c } = await dmAccounts(pool);
  const knock = await dm.openConversation(c, a);
  await dm.sendMessage({ conversationId: knock.id, senderId: c, body: `knock knock ${tag}` });
  assert.equal((await dm.searchMessages(a, `knock knock ${tag}`)).hits.length, 0, "an unaccepted request has no preview and no search");
  assert.equal((await dm.searchMessages(c, `knock knock ${tag}`)).hits.length, 1, "the knocker can search their own words");
});

test("DM stage C: a profile card is refused server-side with the owner's words, and renders from the live state",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const dm = await import("../lib/db/dm.js");
  const { SHARE_REFUSED_COPY } = await import("../lib/dm.js");
  const notes = await import("../lib/db/production/listingStatus.js");
  const pool = await db.getPool();
  const tag = randomUUID().slice(0, 6);
  const { id: convo, lo: a, hi: b } = await stageCFixture(pool);
  const { lo: shared } = await dmAccounts(pool);
  await publishRoom(pool, shared, `third-${tag}`);
  await pool.query(`INSERT INTO profile_modules (account_id, module, content) VALUES ($1,'statement',$2::jsonb)
                    ON CONFLICT (account_id, module) DO UPDATE SET content=EXCLUDED.content`, [shared, JSON.stringify({ text: "a public statement " + tag })]);

  await assert.rejects(() => dm.sendProfileCard(a, convo, `nobody-${tag}`), (e) => e.code === "DM_NO_SUCH_PASSENGER");
  const sent = await dm.sendProfileCard(a, convo, `third-${tag}`);
  assert.equal(sent.handle, `third-${tag}`); assert.equal(sent.duplicate, false);
  let t = await dm.readThread(b, convo);
  let card = t.messages.find((m) => m.kind === "profile-card");
  assert.ok(card); assert.equal(card.body, `*third-${tag}`);
  assert.deepEqual(card.sharedProfile, { available: true, handle: `third-${tag}`, statement: "a public statement " + tag });
  assert.equal(JSON.stringify(t).includes(shared), false, "the shared passenger's uuid never leaves the server");
  // the shared passenger is told, without sender or recipient, once per day
  const n = (await notes.listNotifications("sb-" + shared)).filter((x) => x.kind === "profile-shared");
  assert.equal(n.length, 1); assert.equal(JSON.stringify(n[0].payload).includes(a), false); assert.equal(JSON.stringify(n[0].payload).includes(b), false);
  await dm.sendProfileCard(a, convo, `third-${tag}`);
  assert.equal((await notes.listNotifications("sb-" + shared)).filter((x) => x.kind === "profile-shared").length, 1, "aggregated by day");
  // a card cannot be edited like text
  await assert.rejects(() => dm.editMessage(a, sent.id, "rewritten", 0), (e) => e.code === "P0006");

  // the passenger switches sharing off: creation refused with the exact words, and EXISTING cards go unavailable
  await dm.setDmSettings(shared, { profileSharing: false });
  assert.equal(await dm.readProfileSharing(shared), false);
  await assert.rejects(() => dm.sendProfileCard(a, convo, `third-${tag}`), (e) => e.code === "DM_SHARE_REFUSED" && e.message === SHARE_REFUSED_COPY);
  t = await dm.readThread(b, convo);
  card = t.messages.find((m) => m.kind === "profile-card");
  assert.deepEqual(card.sharedProfile, { available: false, handle: null, statement: null }, "an old card cannot defeat a later change");
  await dm.setDmSettings(shared, { profileSharing: true });
  assert.equal((await dm.readThread(b, convo)).messages.find((m) => m.kind === "profile-card").sharedProfile.available, true);

  // a block between the VIEWER and the passenger hides the card from that viewer only, and a block
  // between sharer and passenger refuses creation with the same words (no block oracle)
  await dm.blockAccount(shared, b);
  assert.equal((await dm.readThread(b, convo)).messages.find((m) => m.kind === "profile-card").sharedProfile.available, false);
  assert.equal((await dm.readThread(a, convo)).messages.find((m) => m.kind === "profile-card").sharedProfile.available, true);
  await dm.blockAccount(shared, a);
  await assert.rejects(() => dm.sendProfileCard(a, convo, `third-${tag}`), (e) => e.code === "DM_SHARE_REFUSED" && e.message === SHARE_REFUSED_COPY);
  // unpublished: not a passenger
  await pool.query(`UPDATE profile_rooms SET published=false WHERE account_id=$1`, [shared]);
  assert.equal((await dm.readThread(a, convo)).messages.find((m) => m.kind === "profile-card").sharedProfile.available, false);
});

// ---------------------------------------------------------------------------
// WARDROBE GIFTING (V.2 brief §8, schema v60): the concurrency law a unit
// suite cannot prove — two accepts of one offer, two offers of one card.
// ---------------------------------------------------------------------------

test("wardrobe gift: concurrent accepts give one card to one person, and the pending lock refuses a second offer",
  { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const prod = await import("../lib/db/production.js");
  const gifts = await import("../lib/db/production/wardrobeTransfers.js");
  const { addWardrobeItem } = await import("../lib/wardrobe/index.js");
  const pool = await db.getPool();
  const { lo: aId, hi: bId } = await dmAccounts(pool);
  const tag = randomUUID().slice(0, 6);
  await publishRoom(pool, aId, `giver-${tag}`);
  await publishRoom(pool, bId, `taker-${tag}`);
  const A = "sb-" + aId, B = "sb-" + bId;
  const item = (await addWardrobeItem(A, { source: "manual", title: "gift " + tag, brand: "House" })).item;

  const offer = await gifts.offerGift(A, { itemId: item.id, toHandle: `taker-${tag}`, idempotencyKey: "pgkey-" + tag });
  assert.equal(offer.state, "pending");
  assert.equal((await gifts.offerGift(A, { itemId: item.id, toHandle: `taker-${tag}`, idempotencyKey: "pgkey-" + tag })).duplicate, true);
  await assert.rejects(() => gifts.offerGift(A, { itemId: item.id, toHandle: `taker-${tag}` }), (e) => e.code === "already-offered", "the partial unique index is the lock");

  // TWO ACCEPTS AT ONCE: exactly one wins, the other finds it decided
  const results = await Promise.all([gifts.acceptGift(B, offer.id), gifts.acceptGift(B, offer.id), gifts.acceptGift(B, offer.id)]);
  assert.equal(results.filter((r) => r.ok).length, 1, "one winner");
  assert.equal(results.filter((r) => !r.ok && r.reason === "not-pending").length, 2);
  const rows = (await pool.query(`SELECT user_id, provenance, transferred_from, transfer_id FROM wardrobe_items WHERE id = $1`, [item.id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, B); assert.equal(rows[0].provenance, "transferred"); assert.equal(rows[0].transferred_from, A); assert.equal(String(rows[0].transfer_id), offer.id);
  assert.equal((await prod.listWardrobeItems(A)).length, 0);
  assert.equal((await prod.listWardrobeItems(B)).length, 1);
  const events = (await pool.query(`SELECT event FROM wardrobe_transfer_events WHERE transfer_id = $1 ORDER BY id`, [offer.id])).rows.map((r) => r.event);
  assert.deepEqual(events, ["offered", "accepted"], "one event per act, never a second accept");
  // the sender's receipt
  assert.equal((await gifts.listGifts(A)).given[0].item.title, "gift " + tag);

  // decline / cancel / expiry leave ownership exactly where it is
  const two = (await addWardrobeItem(A, { source: "manual", title: "two " + tag })).item;
  const o2 = await gifts.offerGift(A, { itemId: two.id, toHandle: `taker-${tag}` });
  const race = await Promise.all([gifts.declineGift(B, o2.id), gifts.cancelGift(A, o2.id)]);
  assert.equal(race.filter((r) => r.ok).length, 1, "a decline and a cancel at once: one lands");
  assert.equal((await pool.query(`SELECT user_id FROM wardrobe_items WHERE id = $1`, [two.id])).rows[0].user_id, A);
  const o3 = await gifts.offerGift(A, { itemId: two.id, toHandle: `taker-${tag}` });
  await pool.query(`UPDATE wardrobe_transfers SET expires_at = now() - interval '1 second' WHERE id = $1`, [o3.id]);
  assert.deepEqual(await gifts.acceptGift(B, o3.id), { ok: false, reason: "expired" });
  assert.equal((await pool.query(`SELECT user_id FROM wardrobe_items WHERE id = $1`, [two.id])).rows[0].user_id, A);
  // a block between them closes the gift
  const dm = await import("../lib/db/dm.js");
  await dm.blockAccount(bId, aId);
  await assert.rejects(() => gifts.offerGift(A, { itemId: two.id, toHandle: `taker-${tag}` }), (e) => e.code === "no-recipient");
});

// ---------------------------------------------------------------------------
// NATIVE STOREFRONT (schema v62): real row locks, idempotency advisory locks,
// reservation ceilings and the server-only RLS posture. Unit coverage drives
// the same memory contract; this is deliberately the only file with PG-backed
// storefront tests.
// ---------------------------------------------------------------------------

test("native storefront v62 serializes fee and inventory reservations in Postgres",
  { skip: !databaseUrl }, async (t) => {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../lib/db/index.js");
  const storefronts = await import("../lib/db/production/storefronts.js");
  const { STOREFRONT_TERMS_VERSION } = await import("../lib/storefront/contracts.js");
  const pool = await db.getPool();
  const accountId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  let storefrontId = null;
  let listingId = null;
  let variantId = null;
  let secondVariantId = null;
  const orders = ["inv-a", "inv-b", "fee-a", "fee-b"].map((name) => `ord_sf_${name}_${suffix}`);
  const crossTenantOrder = `ord_sf_cross_${suffix}`;
  const allOrderIds = [...orders, crossTenantOrder];
  const attempts = orders.map(() => randomUUID());

  t.after(async () => {
    if (storefrontId) {
      await pool.query("DELETE FROM storefront_fee_events WHERE storefront_id=$1", [storefrontId]);
      await pool.query("DELETE FROM storefront_fee_reservations WHERE storefront_id=$1", [storefrontId]);
    }
    const storefrontVariantIds = [variantId, secondVariantId].filter(Boolean);
    if (storefrontVariantIds.length) {
      await pool.query("DELETE FROM inventory_reservations WHERE variant_id=ANY($1::uuid[])", [storefrontVariantIds]);
    }
    await pool.query("DELETE FROM refund_operations WHERE order_id=ANY($1::text[])", [allOrderIds]);
    await pool.query("DELETE FROM payment_attempts WHERE order_id=ANY($1::text[])", [allOrderIds]);
    await pool.query("DELETE FROM order_lines WHERE order_id=ANY($1::text[])", [allOrderIds]);
    await pool.query("DELETE FROM order_events WHERE order_id=ANY($1::text[])", [allOrderIds]);
    await pool.query("DELETE FROM orders WHERE id=ANY($1::text[])", [allOrderIds]);
    if (listingId) {
      await pool.query("DELETE FROM items WHERE native_listing_id=$1", [listingId]);
      await pool.query("DELETE FROM native_listing_variants WHERE listing_id=$1", [listingId]);
      await pool.query("DELETE FROM native_listings WHERE id=$1", [listingId]);
    }
    if (storefrontId) {
      await pool.query("DELETE FROM storefront_payment_accounts WHERE storefront_id=$1", [storefrontId]);
      await pool.query("DELETE FROM storefront_fee_accounts WHERE storefront_id=$1", [storefrontId]);
      await pool.query("DELETE FROM storefronts WHERE id=$1", [storefrontId]);
    }
    await pool.query("DELETE FROM profile_rooms WHERE account_id=$1", [accountId]);
    if (authUserSeeded) await pool.query("DELETE FROM auth.users WHERE id=$1", [accountId]);
  });

  // profile_rooms carries an FK to auth.users wherever the auth schema exists
  // (Supabase, and CI's shim), so the seller handle below needs a parent row,
  // as the v17 profile-rooms block gives its accounts. Absent auth schema
  // (42P01 / 3F000) means no FK to satisfy; any other refusal is a real error.
  let authUserSeeded = false;
  try {
    await pool.query("INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT DO NOTHING", [accountId]);
    authUserSeeded = true;
  } catch (err) {
    if (err.code !== "42P01" && err.code !== "3F000") throw err;
  }

  let owner = await storefronts.createStorefront({
    accountId, name: `PG Store ${suffix.slice(0, 6)}`, accepted: true,
    acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
  });
  storefrontId = owner.storefront.id;
  owner = await storefronts.updateStorefront(accountId, {
    version: owner.storefront.version, status: "pending_review", name: owner.storefront.name,
  });
  await storefronts.applyStorefrontModerationDecision({
    storefrontId, state: "active", actor: "postgres-acceptance",
  });
  const made = await storefronts.createStorefrontListing(accountId, {
    title: "PG single stock", category: "other", priceCents: 2_000, inventory: 1,
    fulfillment: { shipping: true, pickup: false }, status: "pending_review",
  });
  listingId = made.storefront.listings[0].id;
  variantId = made.storefront.listings[0].variants[0].id;
  await storefronts.applyStorefrontListingModerationDecision({
    listingId, state: "active", actor: "postgres-acceptance",
  });
  const sellerHandle = `pg-${suffix.slice(0, 12)}`;
  await pool.query(
    `INSERT INTO profile_rooms (account_id,handle,published,moderation_status)
     VALUES ($1,$2,true,'visible')`,
    [accountId, sellerHandle],
  );
  const publicStore = await storefronts.getPublicStorefrontBySlug(owner.storefront.slug);
  assert.equal(publicStore.storefront.sellerHandle, sellerHandle);
  assert.equal(JSON.stringify(publicStore).includes(accountId), false,
    "the PG public projection returns the published handle without its account UUID");
  await pool.query("UPDATE profile_rooms SET moderation_status='hidden' WHERE account_id=$1", [accountId]);
  assert.equal(
    (await storefronts.getPublicStorefrontBySlug(owner.storefront.slug)).storefront.sellerHandle,
    null,
  );
  secondVariantId = randomUUID();
  await pool.query(
    `INSERT INTO native_listing_variants
       (id,listing_id,label,option_values,price_cents,currency,stock_on_hand,state,is_default)
     VALUES ($1,$2,'Second','{"finish":"two"}'::jsonb,2000,'usd',1,'active',false)`,
    [secondVariantId, listingId],
  );

  for (let index = 0; index < orders.length; index++) {
    await pool.query(
      `INSERT INTO orders
         (id,user_id,item_id,status,amount_cents,currency,commerce_rail,storefront_id)
       VALUES ($1,$2,$3,'awaiting_payment',2000,'usd','native_storefront',$4)`,
      [orders[index], `u-${randomUUID()}`, `native-${listingId}`, storefrontId],
    );
    const reserved = index === 2 ? 2_000 : index === 3 ? 1_000 : 0;
    await pool.query(
      `INSERT INTO payment_attempts
         (id,order_id,storefront_id,idempotency_key,stripe_account_id,livemode,
          expected_buyer_total_cents,passenger_fee_cents,storefront_fee_reserved_cents,
          application_fee_cents,currency)
       VALUES ($1,$2,$3,$4,'acct_pg_acceptance',false,2130,130,$5,$6,'usd')`,
      [attempts[index], orders[index], storefrontId, `attempt-${suffix}-${index}`, reserved, reserved + 130],
    );
  }
  await pool.query(
    `INSERT INTO orders (id,user_id,item_id,status,amount_cents,currency,commerce_rail)
     VALUES ($1,$2,$3,'awaiting_payment',2000,'usd','native_storefront')`,
    [crossTenantOrder, `u-${randomUUID()}`, `native-${listingId}`],
  );

  await assert.rejects(
    () => storefronts.reserveStorefrontInventory({
      variantId, orderId: crossTenantOrder, quantity: 1,
      operationKey: `inventory-cross-${suffix}`,
    }),
    (error) => error.code === "ORDER_STOREFRONT_MISMATCH",
  );
  await assert.rejects(
    () => storefronts.reserveStorefrontFee({
      storefrontId, orderId: crossTenantOrder, maximumCents: 100,
      operationKey: `fee-cross-${suffix}`,
    }),
    (error) => error.code === "ORDER_STOREFRONT_MISMATCH",
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO storefront_fee_reservations
         (storefront_id,order_id,operation_key,amount_cents,state)
       VALUES ($1,$2,$3,100,'active')`,
      [storefrontId, crossTenantOrder, `fee-cross-raw-${suffix}`],
    ),
    (error) => error.code === "23503",
    "a fee reservation cannot cross the order/store tenant graph without an attempt",
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO inventory_reservations
         (storefront_id,listing_id,variant_id,order_id,operation_key,quantity,state)
       VALUES ($1,$2,$3,$4,$5,1,'active')`,
      [storefrontId, listingId, variantId, crossTenantOrder, `inventory-cross-raw-${suffix}`],
    ),
    (error) => error.code === "23503",
    "inventory cannot cross the order/store tenant graph without an attempt",
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO refund_operations
         (order_id,payment_attempt_id,storefront_id,idempotency_key,amount_cents,
          currency,stripe_account_id,livemode)
       VALUES ($1,$2,$3,$4,100,'usd','acct_pg_acceptance',false)`,
      [orders[0], attempts[1], storefrontId, `refund-mismatch-${suffix}`],
    ),
    (error) => error.code === "23503",
    "a refund attempt cannot be attached to a different order",
  );

  const sameInventory = await Promise.all([
    storefronts.reserveStorefrontInventory({
      variantId, orderId: orders[0], paymentAttemptId: attempts[0], quantity: 1,
      operationKey: `inventory-${suffix}-same`,
    }),
    storefronts.reserveStorefrontInventory({
      variantId, orderId: orders[0], paymentAttemptId: attempts[0], quantity: 1,
      operationKey: `inventory-${suffix}-same`,
    }),
  ]);
  assert.equal(sameInventory[0].reservation.id, sameInventory[1].reservation.id);
  assert.equal(sameInventory.filter((value) => value.duplicate).length, 1);
  const secondLine = await storefronts.reserveStorefrontInventory({
    variantId: secondVariantId, orderId: orders[0], paymentAttemptId: attempts[0], quantity: 1,
    operationKey: `inventory-${suffix}-second-variant`,
  });
  assert.equal(secondLine.reservation.variantId, secondVariantId,
    "one payment attempt can reserve multiple variants");
  await assert.rejects(() => storefronts.reserveStorefrontInventory({
    variantId, orderId: orders[1], paymentAttemptId: attempts[1], quantity: 1,
    operationKey: `inventory-${suffix}-other`,
  }), (error) => error.code === "OUT_OF_STOCK");

  const sameFee = await Promise.all([
    storefronts.reserveStorefrontFee({
      storefrontId, orderId: orders[2], paymentAttemptId: attempts[2], maximumCents: 2_000,
      operationKey: `fee-${suffix}-same`,
    }),
    storefronts.reserveStorefrontFee({
      storefrontId, orderId: orders[2], paymentAttemptId: attempts[2], maximumCents: 2_000,
      operationKey: `fee-${suffix}-same`,
    }),
  ]);
  assert.equal(sameFee[0].reservation.id, sameFee[1].reservation.id);
  assert.equal(sameFee.filter((value) => value.duplicate).length, 1);
  const remainder = await storefronts.reserveStorefrontFee({
    storefrontId, orderId: orders[3], paymentAttemptId: attempts[3], maximumCents: 2_000,
    operationKey: `fee-${suffix}-remainder`,
  });
  assert.equal(remainder.reservation.amountCents, 1_000);
  assert.equal(remainder.feeBalance.reservedCents, 3_000);

  await assert.rejects(
    () => pool.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,
          operation_key,currency)
       VALUES ($1,$2,$3,$4,'reserved',100,$5,'usd')`,
      [storefrontId, sameFee[0].reservation.id, crossTenantOrder, null, `event-cross-${suffix}`],
    ),
    (error) => error.code === "23503",
    "fee events cannot leave their reservation/order/store graph",
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,
          operation_key,currency)
       VALUES ($1,$2,$3,$4,'collected',1000,$5,'usd')`,
      [storefrontId, remainder.reservation.id, orders[3], attempts[3], `event-no-proof-${suffix}`],
    ),
    (error) => error.code === "23514",
    "a collected ledger event requires immutable provider proof",
  );
  await assert.rejects(
    () => storefronts.confirmStorefrontFee({
      reservationId: sameFee[0].reservation.id,
      operationKey: `fee-confirm-no-proof-${suffix}`,
    }),
    (error) => error.code === "PROVIDER_PROOF_REQUIRED",
  );
  const collected = await storefronts.confirmStorefrontFee({
    reservationId: sameFee[0].reservation.id,
    operationKey: `fee-confirm-${suffix}`,
    stripeAccountId: "acct_pg_acceptance",
    stripeApplicationFeeId: `fee_${suffix}`,
    stripeEventId: `evt_collect_${suffix}`,
    livemode: false,
  });
  await assert.rejects(
    () => storefronts.reverseStorefrontFee({
      collectionEventId: collected.event.id,
      amountCents: 100,
      operationKey: `fee-reverse-no-proof-${suffix}`,
    }),
    (error) => error.code === "PROVIDER_PROOF_REQUIRED",
  );
  const reversed = await storefronts.reverseStorefrontFee({
    collectionEventId: collected.event.id,
    amountCents: 100,
    operationKey: `fee-reverse-${suffix}`,
    stripeFeeRefundId: `fr_${suffix}`,
    stripeEventId: `evt_reverse_${suffix}`,
  });
  assert.equal(reversed.event.kind, "reversed");

  await pool.query("UPDATE native_listings SET state='paused' WHERE id=$1", [listingId]);
  const listingVersion = Number((await pool.query(
    "SELECT version FROM native_listings WHERE id=$1", [listingId],
  )).rows[0].version);
  const firstVariant = (await pool.query(
    "SELECT * FROM native_listing_variants WHERE id=$1", [variantId],
  )).rows[0];
  await assert.rejects(
    () => storefronts.updateStorefrontListing(accountId, listingId, {
      version: listingVersion,
      variants: [{
        id: variantId, label: firstVariant.label, priceCents: Number(firstVariant.price_cents),
        stockOnHand: Number(firstVariant.stock_on_hand), optionValues: firstVariant.option_values,
      }],
    }),
    (error) => error.code === "INVENTORY_RESERVED",
    "an omitted variant with a pending reservation cannot be archived",
  );
  await storefronts.releaseStorefrontInventory({
    reservationId: secondLine.reservation.id,
    operationKey: `inventory-release-${suffix}`,
  });
  await storefronts.updateStorefrontListing(accountId, listingId, {
    version: listingVersion,
    variants: [{
      id: variantId, label: firstVariant.label, priceCents: Number(firstVariant.price_cents),
      stockOnHand: Number(firstVariant.stock_on_hand), optionValues: firstVariant.option_values,
    }],
  });
  assert.equal((await pool.query(
    "SELECT state FROM native_listing_variants WHERE id=$1", [secondVariantId],
  )).rows[0].state, "archived");

  const policyCount = await pool.query(
    `SELECT count(*)::int AS n FROM pg_policies
      WHERE policyname='asilum_app_server_access'
        AND tablename=ANY($1::text[])`,
    [["storefronts", "storefront_payment_accounts", "storefront_fee_accounts",
      "native_listings", "native_listing_variants", "order_lines", "payment_attempts",
      "storefront_fee_reservations", "storefront_fee_events", "inventory_reservations",
      "refund_operations", "stripe_event_inbox"]],
  );
  const appRole = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='asilum_app'");
  assert.equal(policyCount.rows[0].n, appRole.rowCount ? 12 : 0);
  assert.equal((await pool.query("SELECT to_regclass('refund_operations') AS name")).rows[0].name, "refund_operations");
});
