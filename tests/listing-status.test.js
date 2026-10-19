// tests/listing-status.test.js — the ListingStatus service (V.2 brief §5),
// memory mode. The laws: only a provider's confirmed sold signal says
// sold; a 404 is "removed", never sold; an outage changes nothing and
// notifies no one; a transition is recorded once however many times the
// job runs; a person who kept the piece is told once; a person who
// switched the kind off is not told; the pick is bounded and oldest first.
import test from "node:test";
import assert from "node:assert/strict";
import { classify, transition, recheckKeptItems, pickItemsToRecheck, PROVIDERS } from "../lib/listing-status/index.js";
import { recordStatusEvent, latestStatusEvents, usersWhoKept, enqueueNotification, listNotifications, markNotificationsRead, setNotificationPrefs, getNotificationPrefs, resetMemoryListingStatus } from "../lib/db/production/listingStatus.js";
import { mem } from "../lib/db/core/store.js";
import { upsertItems } from "../lib/db/index.js";

const A = "u-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "sb-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", C = "u-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const item = (id, over = {}) => ({ id, title: "Piece " + id, brand: "House", price: 100, currency: "USD", source: "ebay", source_name: "ebay", source_product_id: "v1|" + id + "|0", availability_status: "available", is_available: true, last_synced_at: "2026-09-01T00:00:00.000Z", ...over });
const enabledAdapter = (answers) => ({ getSourceName: () => "ebay", enabled: () => ({ enabled: true }), checkAvailability: async (spid) => answers[spid] || { availability_status: "unknown" } });

test.beforeEach(() => { resetMemoryListingStatus(); mem.items.clear(); mem.boards.clear(); mem.interactions.length = 0; });

test("classification: only a confirmed sold signal is sold; a disappearance is removed; an outage is an outage", () => {
  assert.equal(classify({ availability_status: "sold" }), "sold");
  assert.equal(classify({ availability_status: "removed", source_response_status: 404 }), "removed");
  assert.equal(classify({ availability_status: "available" }), "available");
  assert.equal(classify({ availability_status: "source_unavailable" }), "source_unavailable");
  assert.equal(classify({ availability_status: "weird" }), "unknown");
  assert.equal(classify(null), "unknown");
  assert.deepEqual(transition("available", "sold"), { from: "available", to: "sold" });
  assert.equal(transition("available", "source_unavailable"), null, "an outage is not a transition");
  assert.equal(transition("available", "unknown"), null);
  assert.equal(transition("sold", "sold"), null);
});

test("a transition is recorded once; the outbox holds one row per person; the switch is honoured", async () => {
  const first = await recordStatusEvent({ itemId: "x1", fromStatus: "available", toStatus: "sold", provider: "ebay", observedAt: "2026-10-01T10:00:00.000Z" });
  assert.equal(first.recorded, true);
  const again = await recordStatusEvent({ itemId: "x1", fromStatus: "available", toStatus: "sold", provider: "ebay" });
  assert.equal(again.recorded, false, "a listing sells once");
  assert.equal((await latestStatusEvents(["x1"])).get("x1").toStatus, "sold");
  assert.deepEqual(await enqueueNotification({ userId: A, kind: "liked-sold", subjectId: "x1", payload: { title: "t" } }), { queued: true });
  assert.deepEqual(await enqueueNotification({ userId: A, kind: "liked-sold", subjectId: "x1" }), { queued: false, reason: "duplicate" });
  await setNotificationPrefs(B, { soldLikes: false });
  assert.equal((await getNotificationPrefs(B)).soldLikes, false, "the sold-likes switch is off (the commerce preferences ride beside it since slice 6)");
  assert.deepEqual(await enqueueNotification({ userId: B, kind: "liked-sold", subjectId: "x1" }), { queued: false, reason: "opted-out" });
  await assert.rejects(enqueueNotification({ userId: A, kind: "spam", subjectId: "x1" }), /known kind/);
  const list = await listNotifications(A, { unreadOnly: true });
  assert.equal(list.length, 1); assert.equal(list[0].kind, "liked-sold");
  assert.equal(await markNotificationsRead(A, [list[0].id]), 1);
  assert.equal((await listNotifications(A, { unreadOnly: true })).length, 0);
  assert.equal((await listNotifications(A)).length, 1, "read, not gone");
});

test("a run: sold notifies every keeper once, a 404 is removed and silent, an outage changes nothing, a retry duplicates nothing", async () => {
  await upsertItems([item("s1"), item("r1"), item("o1"), item("a1")]);
  mem.boards.set("b1", { id: "b1", userId: A, name: "x", items: [{ id: "s1" }, { id: "o1" }] });
  mem.boards.set("b2", { id: "b2", userId: B, name: "y", items: [{ id: "s1" }] });
  mem.interactions.push({ userId: C, itemId: "s1", action: "favorite", at: 1 }, { userId: C, itemId: "r1", action: "favorite", at: 1 });
  await setNotificationPrefs(B, { soldLikes: false });
  assert.deepEqual((await usersWhoKept("s1")).sort(), [A, B, C].sort());
  const adapter = enabledAdapter({
    "v1|s1|0": { availability_status: "sold", price: 100, source_response_status: 200 },
    "v1|r1|0": { availability_status: "removed", source_response_status: 404 },
    "v1|o1|0": { availability_status: "source_unavailable" },
    "v1|a1|0": { availability_status: "available", source_response_status: 200 },
  });
  const now = Date.parse("2026-10-02T00:00:00Z");
  const r = await recheckKeptItems({ adapterOverride: adapter, now });
  assert.equal(r.checked, 3, "only kept listings are checked (a1 is kept by nobody)");
  assert.deepEqual(r.byStatus, { sold: 1, removed: 1, source_unavailable: 1 });
  assert.equal(r.events, 2); assert.equal(r.notified, 2, "A and C, not B (switched off)"); assert.equal(r.optedOut, 1); assert.equal(r.outages, 1);
  assert.equal(mem.items.get("s1").availability_status, "sold");
  assert.equal(mem.items.get("r1").availability_status, "removed");
  assert.equal(mem.items.get("o1").availability_status, "available", "an outage left the row alone");
  assert.equal((await listNotifications(A)).length, 1);
  assert.equal((await listNotifications(C)).length, 1);
  assert.equal((await listNotifications(B)).length, 0);
  assert.equal((await listNotifications(C))[0].payload.soldAt, "2026-10-02T00:00:00.000Z");
  // the retry: s1 and r1 are no longer due (sold/removed), o1 is checked again, nothing is duplicated
  const r2 = await recheckKeptItems({ adapterOverride: { ...adapter, checkAvailability: async () => ({ availability_status: "sold" }) }, now: now + 1 });
  assert.equal(r2.checked, 1);
  assert.equal(r2.events, 1, "o1 sells now");
  assert.equal((await listNotifications(A)).length, 2, "A kept o1 too");
  const r3 = await recheckKeptItems({ adapterOverride: adapter, items: [item("s1")], now });
  assert.equal(r3.events, 0); assert.equal(r3.duplicates >= 1, true, "a forced re-run of a sold listing records and notifies nothing");
  assert.equal((await listNotifications(A)).length, 2);
});

test("the pick is bounded, oldest check first, and skips what is already sold or removed", async () => {
  await upsertItems([item("p1", { last_synced_at: "2026-09-03T00:00:00.000Z" }), item("p2", { last_synced_at: "2026-09-01T00:00:00.000Z" }), item("p3", { availability_status: "sold" }), item("p4", { last_synced_at: new Date().toISOString() }), item("p5", { source_name: "shopify", source: "shopify" })]);
  mem.boards.set("b", { id: "b", userId: A, name: "x", items: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }, { id: "p5" }] });
  const due = await pickItemsToRecheck({ provider: "ebay", now: Date.now() });
  assert.deepEqual(due.map((i) => i.id), ["p2", "p1"], "oldest first; p3 sold, p4 fresh, p5 another provider");
  assert.deepEqual((await pickItemsToRecheck({ provider: "ebay", limit: 1 })).map((i) => i.id), ["p2"]);
  assert.equal(PROVIDERS.ebay.webhook, false, "polled, not pushed");
  const off = await recheckKeptItems({ adapterOverride: { enabled: () => ({ enabled: false }) } });
  assert.match(off.skipped, /not enabled/);
});
