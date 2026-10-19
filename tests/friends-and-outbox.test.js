// tests/friends-and-outbox.test.js — THE FRIEND ASTERISK AND THE OFFLINE
// QUEUE (V.2 Foundations "The friend asterisk"; chapter 1 offline-first; A6
// (2); slice 10d). Held here:
//   * a friend is a mutual user-follow, relative to the viewer; one-way is
//     not; a handle cannot begin with an asterisk, so the mark cannot be faked;
//   * the viewer's friends are theirs alone and need a published handle;
//   * the outbox keeps writes in order, dedupes by operation id, replays
//     when the network returns, drops what the server refuses, keeps what
//     it could not reach, and says "queued" instead of pretending.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setFollow, friendsOf, getProfileRoomByHandle } from "../lib/db/production.js";
import { HANDLE_RE } from "../lib/profile/handles.js";
import { mem } from "../lib/db/production/store.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const uuid = () => globalThis.crypto.randomUUID();
function room(accountId, handle) { mem.profileRooms.set(accountId, { account_id: accountId, handle, published: true, moderationStatus: "visible" }); }

test("friends: a mutual follow, relative to the viewer; one-way is not; no handle, no friends", async () => {
  const a = uuid(), b = uuid(), c = uuid();
  room(a, "ava"); room(b, "ben"); room(c, "cy");
  const A = "sb-" + a, B = "sb-" + b, C = "sb-" + c;
  await setFollow(A, "user", "ben", true);
  assert.deepEqual(await friendsOf(A), { handle: "ava", friends: [] }, "one way is a follow, not a friendship");
  await setFollow(B, "user", "Ava", true);
  assert.deepEqual(await friendsOf(A), { handle: "ava", friends: ["ben"] });
  assert.deepEqual(await friendsOf(B), { handle: "ben", friends: ["ava"] }, "relative to each viewer");
  await setFollow(C, "user", "ava", true);
  assert.deepEqual((await friendsOf(A)).friends, ["ben"], "a third party who follows Ava is not her friend until she follows back");
  await setFollow(A, "user", "ben", false);
  assert.deepEqual((await friendsOf(A)).friends, [], "removed the moment either side unfollows");
  assert.deepEqual(await friendsOf("u-" + uuid()), { handle: null, friends: [] }, "a device has no handle");
  assert.equal(HANDLE_RE.test("*ava"), false, "usernames cannot begin with an asterisk");
  assert.equal(HANDLE_RE.test("ava"), true);
  assert.ok(await getProfileRoomByHandle("ben"));
});

test("the route: friends are the viewer's own; anonymous is refused", async () => {
  const follow = await loadRoute("app/api/follow/route.js");
  assert.equal((await callRoute(follow.GET, { path: "/api/follow", query: { friends: "1" } })).status, 401);
  const me = newDevice();
  const r = await callRoute(follow.GET, { path: "/api/follow", cookies: me.cookies, query: { friends: "1", user: me.uid } });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { handle: null, friends: [] });
  assert.equal((await callRoute(follow.GET, { path: "/api/follow", cookies: me.cookies, query: { user: me.uid } })).status, 400);
});

test("the outbox: order, dedupe, replay, drop what the server refuses, keep what it cannot reach", async () => {
  // a window for the client module
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, dispatchEvent() {}, addEventListener() {} };
  // Node 21+ defines globalThis.navigator as a getter, so a plain assignment
  // throws (CI runs Node 22; it failed there and passed on 20). Define it, and
  // put the runtime's own back at the end.
  const ownNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const setNavigator = (v) => Object.defineProperty(globalThis, "navigator", { value: v, configurable: true, writable: true, enumerable: true });
  setNavigator({ onLine: false });
  const ob = await import("../lib/outbox.js");
  assert.equal(ob.isOffline(), true);
  const e1 = ob.enqueue({ url: "/api/interaction", payload: { operationId: "op-1", action: "favorite" } });
  ob.enqueue({ url: "/api/follow", payload: { operationId: "op-2", follow: true } });
  ob.enqueue({ url: "/api/interaction", payload: { operationId: "op-1", action: "favorite" } });
  assert.equal(ob.outboxCount(), 2, "the same operation id is one write");
  const q = ob.queuedResponse(e1);
  assert.equal(q.status, 202); assert.equal(q.headers.get("x-asilum-queued"), "1");
  assert.equal((await q.json()).queued, true, "honest: queued, not landed");
  assert.deepEqual(await ob.flushOutbox(async () => ({ ok: true, status: 200 })), { sent: 0, dropped: 0, kept: 2 }, "offline: nothing is sent");
  setNavigator({ onLine: true });
  const seen = [];
  const r1 = await ob.flushOutbox(async (entry) => { seen.push(entry.id); if (entry.id === "op-2") return { ok: false, status: 400 }; return { ok: true, status: 200 }; });
  assert.deepEqual(seen, ["op-1", "op-2"], "in order"); assert.deepEqual(r1, { sent: 1, dropped: 1, kept: 0 });
  ob.enqueue({ url: "/api/interaction", payload: { operationId: "op-3" } });
  const r2 = await ob.flushOutbox(async () => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual(r2, { sent: 0, dropped: 0, kept: 1 }, "the network is not back: keep it");
  const r3 = await ob.flushOutbox(async () => ({ ok: false, status: 429 }));
  assert.deepEqual(r3, { sent: 0, dropped: 0, kept: 1 }, "429 is not a refusal");
  const r4 = await ob.flushOutbox(async () => ({ ok: true, status: 200 }));
  assert.deepEqual(r4, { sent: 1, dropped: 0, kept: 0 });
  delete globalThis.window;
  if (ownNavigator) Object.defineProperty(globalThis, "navigator", ownNavigator); else delete globalThis.navigator;
});
