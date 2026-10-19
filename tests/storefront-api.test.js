// tests/storefront-api.test.js — The storefront API: the owner API refuses
// device identities and marks private responses no-store, and non-public slugs
// all return one indistinguishable not-found.

import test from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const owner = await loadRoute("app/api/storefront/route.js");
const publicRoute = await loadRoute("app/api/storefront/public/route.js");

test("Storefront owner API refuses device identities and marks private responses no-store", async () => {
  const device = newDevice();
  const read = await callRoute(owner.GET, {
    path: "/api/storefront", query: { user: device.uid }, cookies: device.cookies,
  });
  assert.equal(read.status, 403);
  assert.equal(read.body.code, "ACCOUNT_REQUIRED");
  assert.match(read.headers.get("cache-control"), /private/);

  const write = await callRoute(owner.POST, {
    path: "/api/storefront", cookies: device.cookies,
    json: { user: device.uid, action: "create_store", name: "Not device owned" },
  });
  assert.equal(write.status, 403);
  assert.equal(write.body.code, "ACCOUNT_REQUIRED");
});

test("public Storefront API returns one indistinguishable not-found response for non-public slugs", async () => {
  const response = await callRoute(publicRoute.GET, {
    path: "/api/storefront/public", query: { slug: "not-a-public-store" },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "storefront not found", code: "STORE_NOT_FOUND" });
  assert.equal("ownerAccountId" in response.body, false);
});

