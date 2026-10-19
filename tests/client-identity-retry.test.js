// tests/client-identity-retry.test.js — The client's identity issuance: a 429
// or 503 is retried rather than cached for the page, and a successful identity
// is cached so it is never re-issued per call.

import test from "node:test";
import assert from "node:assert/strict";

// Found by the Aug 8 codebase audit. ensureDeviceCookie cached an HTTP FAILURE
// for the lifetime of the page:
//
//   deviceReady = fetch("/api/auth").then(async (res) => {
//     if (!res.ok) return null;          // <-- resolves; the cache keeps it
//     ...
//   }).catch(() => { deviceReady = null; ... });   // <-- only THROWN errors
//
// The "retry on the next call rather than caching the failure forever" comment
// lives in the .catch, which covers offline/DNS. The !res.ok path is the one
// that actually happens: /api/auth answers 429 when the identity-issuance
// budget is exhausted and 503 when DEVICE_COOKIE_SECRET is unset. One 429
// during a burst left that visitor with no device cookie until they reloaded —
// long after the limit cleared — so nothing personalised and every
// identity-bearing write 401'd.
//
// Behavioural, not a source grep: stub fetch, fail once, and assert the module
// ASKS AGAIN. A grep would pass against any code that merely mentions the
// variable.

async function freshClient(tag) {
  return import(`../lib/client.js?identity-retry=${tag}`);
}

function stubFetch(sequence) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("/api/auth")) {
      const next = sequence.shift() ?? { status: 200, uid: "u-fallback" };
      return {
        ok: next.status === 200,
        status: next.status,
        json: async () => (next.status === 200 ? { uid: next.uid } : { error: "nope" }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return calls;
}

test("C1 a 429 on identity issuance is retried, not cached for the page's life", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { authorizedFetch } = await freshClient("c1");
    const calls = stubFetch([
      { status: 429 },                              // the burst
      { status: 200, uid: "u-issued-after-retry" }, // the limit has cleared
    ]);

    await authorizedFetch("/api/anything");
    await authorizedFetch("/api/anything");

    const authCalls = calls.filter((u) => u.startsWith("/api/auth")).length;
    assert.equal(authCalls, 2,
      "after a 429 the client must ask for an identity again — caching the " +
      "failure leaves the visitor un-personalised until they reload");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("C2 a 503 (secret unset) is retried too, not just a 429", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { authorizedFetch } = await freshClient("c2");
    const calls = stubFetch([{ status: 503 }, { status: 200, uid: "u-later" }]);

    await authorizedFetch("/api/anything");
    await authorizedFetch("/api/anything");

    assert.equal(calls.filter((u) => u.startsWith("/api/auth")).length, 2,
      "any non-ok status must clear the cached attempt, not only a throw");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("C3 a SUCCESSFUL identity is cached — the fix must not re-issue every call", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { authorizedFetch } = await freshClient("c3");
    const calls = stubFetch([{ status: 200, uid: "u-stable" }]);

    await authorizedFetch("/api/anything");
    await authorizedFetch("/api/anything");
    await authorizedFetch("/api/anything");

    assert.equal(calls.filter((u) => u.startsWith("/api/auth")).length, 1,
      "identity issuance is throttled server-side; asking on every request " +
      "would turn this fix into the very burst that triggers the 429");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A 200 carrying no uid is also a failed issuance and must not be cached as if
// it were an identity.
test("C4 a 200 with no uid is treated as a failure and retried", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { authorizedFetch } = await freshClient("c4");
    const calls = [];
    let n = 0;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("/api/auth")) {
        n++;
        return { ok: true, status: 200, json: async () => (n === 1 ? {} : { uid: "u-eventually" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await authorizedFetch("/api/anything");
    await authorizedFetch("/api/anything");

    assert.equal(calls.filter((u) => u.startsWith("/api/auth")).length, 2,
      "an empty body is not an identity");
  } finally {
    globalThis.fetch = realFetch;
  }
});
