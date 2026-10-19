// tests/storefront-reconcile-command.test.js — The Stripe reconciliation
// command: refuses a live key before any network call, requires the durable
// app database, and fails loudly naming any held attempts.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SCRIPT = "./scripts/reconcile-storefront-payments.mjs";

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    "DATABASE_URL", "DATABASE_ADMIN_URL", "STRIPE_SECRET_KEY",
    "STOREFRONT_RECONCILE_LIMIT", "NODE_TEST_CONTEXT",
  ]) delete env[name];
  return { ...env, ...overrides };
}

function run(env) {
  const source = `
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network forbidden"); };
    await import(${JSON.stringify(SCRIPT)});
    console.log("FETCH_CALLS=" + fetchCalls);
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("reconciliation command refuses a live Stripe key before imports or network", () => {
  const result = run(cleanEnv({
    DATABASE_URL: "postgres://not-used.invalid/asilum",
    STRIPE_SECRET_KEY: "sk_live_never_use_this_fixture",
  }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be a Stripe TEST secret key/);
  assert.match(result.stdout, /FETCH_CALLS=0/);
});

test("reconciliation command requires the durable app database and rejects admin credentials", () => {
  const missing = run(cleanEnv({ STRIPE_SECRET_KEY: "sk_test_fixture" }));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /DATABASE_URL is required/);
  assert.match(missing.stdout, /FETCH_CALLS=0/);

  const admin = run(cleanEnv({
    DATABASE_URL: "postgres://not-used.invalid/asilum",
    DATABASE_ADMIN_URL: "postgres://admin.invalid/asilum",
    STRIPE_SECRET_KEY: "sk_test_fixture",
  }));
  assert.equal(admin.status, 2);
  assert.match(admin.stderr, /DATABASE_ADMIN_URL must not be set/);
  assert.match(admin.stdout, /FETCH_CALLS=0/);
});

test("reconciliation command fails loudly and names durable targets when attempts are held", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.match(source, /held: result\.held \|\| 0/);
  assert.match(source, /attention: result\.results/);
  assert.match(source, /attemptId: entry\.attemptId \|\| null/);
  assert.match(source, /orderId: entry\.orderId \|\| null/);
  assert.match(source, /result\.failed \|\| result\.held/);
});
