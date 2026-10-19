// tests/ebay-feed.test.js — The eBay feed: configuration fails closed without
// implying entitlement, a missing approval never calls OAuth, and a complete
// file is staged atomically with its manifest, never published.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { feedReadiness, feedRequest, stageEbayFeed, FEED_SCOPE } from "../lib/ingest/ebayFeed.js";
import { getAppToken } from "../lib/ingest/ebay.js";

// Declared gates: no requests without approval; full byte-for-byte archive;
// ranged revision consistency; no completed output after any failure;
// distinct OAuth scope/environment caches. All network is mocked.
const configured = { EBAY_CLIENT_ID: "feed-test-id", EBAY_CLIENT_SECRET: "feed-test-secret",
  EBAY_ENV: "PRODUCTION", EBAY_PARTNERSHIP_APPROVED: "1", EBAY_FEED_APPROVED: "1" };

async function fixture(t) {
  const before = Object.fromEntries(Object.keys(configured).map(k => [k, process.env[k]]));
  Object.assign(process.env, configured);
  const root = await mkdtemp(join(tmpdir(), "asilum-feed-test-"));
  t.after(async () => {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : process.env[k] = v;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const options = root => ({ categoryId: "11450", outputDir: root });
const archive = gzipSync("itemId\ttitle\n123\tCoat\n");
const tokenProvider = async ({ scope }) => { assert.equal(scope, FEED_SCOPE); return "fake-test-token"; };
function response(bytes, overrides = {}) {
  return new Response(bytes, { status: 200, headers: {
    "content-length": String(bytes.length), "last-modified": "Thu, 01 Oct 2026 00:00:00 GMT", ...overrides,
  }});
}

test("feed configuration fails closed without implying real entitlement", () => {
  assert.equal(feedReadiness({}).ready, false);
  assert.deepEqual(feedReadiness({ ...configured, EBAY_FEED_APPROVED: "0" }).missing, ["feed_entitlement"]);
  assert.throws(() => feedRequest({ categoryId: "../bad" }), /categoryId/);
  assert.throws(() => feedRequest({ categoryId: "11450", feedScope: "NEWLY_LISTED" }), /date/);
  assert.throws(() => feedRequest({ categoryId: "11450", date: "2026-02-30" }), /valid/);
});

test("missing approval never calls OAuth or fetch", async t => {
  const root = await fixture(t);
  process.env.EBAY_FEED_APPROVED = "0";
  const fail = () => assert.fail("network called without entitlement attestation");
  await assert.rejects(stageEbayFeed(options(root), { tokenProvider: fail, fetchImpl: fail }), /feed_entitlement/);
  assert.deepEqual(await readdir(root), []);
});

test("complete gzip is atomically staged with manifest, never published", async t => {
  const root = await fixture(t);
  const result = await stageEbayFeed(options(root), { tokenProvider, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).hostname, "api.ebay.com");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
    return response(archive);
  }});
  assert.equal(result.status, "staged_not_published");
  assert.equal(result.aiProcessing, false);
  assert.deepEqual(await readFile(join(result.directory, "items.tsv.gz")), archive);
  const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json")));
  assert.equal(manifest.compressedBytes, archive.length);
  // the generation time is its own validated field, never the ETag (brief §15.4)
  assert.equal(manifest.lastModified, "2026-10-01T00:00:00.000Z");
  assert.equal(manifest.revision, "Thu, 01 Oct 2026 00:00:00 GMT");
  assert.equal((await readdir(root)).length, 1);
});

test("small range responses are assembled without gaps", async t => {
  const root = await fixture(t);
  let calls = 0;
  const result = await stageEbayFeed(options(root), { tokenProvider, fetchImpl: async (url, init) => {
    calls++;
    const start = Number(/^bytes=(\d+)-/.exec(init.headers.Range)[1]);
    const end = Math.min(start + 9, archive.length - 1);
    return new Response(archive.subarray(start, end + 1), { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/${archive.length}`, etag: '"v1"',
    }});
  }});
  assert.ok(calls > 1);
  assert.deepEqual(await readFile(join(result.directory, "items.tsv.gz")), archive);
  assert.equal(result.revision, '"v1"');
  assert.equal(result.lastModified, null, "no Last-Modified offered → null, never the ETag");
});

test("a Last-Modified that is not a date, or that changes mid-download, is refused", async t => {
  for (const bad of ["not-a-date", "changing"]) {
    const root = await fixture(t);
    let calls = 0;
    await assert.rejects(stageEbayFeed(options(root), { tokenProvider, fetchImpl: async (url, init) => {
      calls++;
      const start = Number(/^bytes=(\d+)-/.exec(init.headers.Range)[1]);
      const end = Math.min(start + 9, archive.length - 1);
      return new Response(archive.subarray(start, end + 1), { status: 206, headers: {
        "content-range": `bytes ${start}-${end}/${archive.length}`, etag: '"v1"',
        "last-modified": bad === "not-a-date" ? "yesterday" : `Thu, 0${calls} Oct 2026 00:00:00 GMT`,
      }});
    }}), /Last-Modified/);
    assert.deepEqual(await readdir(root), []);
  }
});

for (const failure of ["truncated", "invalid-gzip", "changed-revision", "wrong-range", "too-large", "expanded-limit", "forbidden"]) {
  test(`${failure} leaves no completed or partial directory`, async t => {
    const root = await fixture(t);
    let calls = 0;
    await assert.rejects(stageEbayFeed({ ...options(root), ...(failure === "expanded-limit" ? { maxExpandedBytes: 2 } : {}) }, {
      tokenProvider, fetchImpl: async () => {
        calls++;
        if (failure === "forbidden") return new Response(null, { status: 403 });
        if (failure === "truncated") return response(archive.subarray(0, 4), { "content-length": String(archive.length) });
        if (failure === "invalid-gzip") return response(Buffer.from("not gzip"));
        if (failure === "too-large") return response(archive, { "content-length": String(11 * 1024 ** 3) });
        if (failure === "wrong-range") return new Response(archive, { status: 206, headers: { etag: '"v1"', "content-range": `bytes 1-${archive.length}/${archive.length + 1}` } });
        if (failure === "changed-revision") return new Response(archive.subarray(0, 5), { status: 206, headers: {
          etag: `"v${calls}"`, "content-range": `bytes ${calls === 1 ? 0 : 5}-${calls === 1 ? 4 : 9}/${archive.length}`,
        }});
        return response(archive);
      },
    }));
    assert.deepEqual(await readdir(root), []);
  });
}

test("OAuth cache separates Browse, Feed and environment", async t => {
  await fixture(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => Response.json({ access_token: `token-${++calls}`, expires_in: 7200 });
  const browse = await getAppToken();
  assert.equal(await getAppToken(), browse);
  assert.notEqual(await getAppToken({ scope: FEED_SCOPE }), browse);
  process.env.EBAY_ENV = "SANDBOX";
  assert.notEqual(await getAppToken(), browse);
  assert.equal(calls, 3);
});
