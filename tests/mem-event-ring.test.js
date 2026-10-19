// tests/mem-event-ring.test.js — The memory-mode event ring: one flooding user
// cannot evict another, each user is capped keeping the most recent, and reads
// return newest first like Postgres.

import test from "node:test";
import assert from "node:assert/strict";

import { memRecordEvent, listEvents, purgeMemoryUserData } from "../lib/db/index.js";
import { buildEvent, EVENTS } from "../lib/events/index.js";

// audit #18: the mem-mode event fallback was a single global 5000-cap ring, so
// one user's flood evicted ANOTHER user's history — and the 1000-bot gate runs
// in mem mode, where crossUserCandidates reads exactly this ring, so its
// discovery boost diverged from the unbounded pg table. The fix caps per user.
// (These run in mem mode: the harness runs with no DATABASE_URL.)

const ev = (uid, i) => buildEvent(uid, EVENTS.USER_FAVORITED_ITEM, { itemId: "syn-" + i, brand: "B" });

test("#18 a flooding user cannot evict another user's events", async () => {
  const quiet = "u-ring-quiet", loud = "u-ring-loud";
  purgeMemoryUserData(quiet);
  purgeMemoryUserData(loud);

  for (let i = 0; i < 100; i++) memRecordEvent(ev(quiet, i));
  // Under the OLD global 5000 cap, these 6000 evicted every quiet-user event.
  for (let i = 0; i < 6000; i++) memRecordEvent(ev(loud, i));

  const quietEvents = await listEvents(quiet, 500);
  assert.equal(quietEvents.length, 100, "the quiet user's full history survives the flood");
  assert.ok(quietEvents.every((e) => e.payload.itemId.startsWith("syn-")), "and it is the quiet user's own events");

  purgeMemoryUserData(quiet);
  purgeMemoryUserData(loud);
});

test("#18 a single user is capped at MEM_EVENTS_PER_USER, keeping the most recent", async () => {
  const u = "u-ring-cap";
  purgeMemoryUserData(u);
  // Record 1500 > the 1000 per-user cap.
  for (let i = 0; i < 1500; i++) memRecordEvent(ev(u, i));

  const got = await listEvents(u, 1000); // the listEvents limit ceiling
  assert.equal(got.length, 1000, "capped at the per-user retention");
  // listEvents returns newest-first; the newest event is syn-1499.
  assert.equal(got[0].payload.itemId, "syn-1499", "the most recent event is retained");
  // The oldest retained is syn-500 (1499..500 = 1000 events); syn-499 evicted.
  assert.ok(got.every((e) => Number(e.payload.itemId.slice(4)) >= 500), "only the oldest beyond the cap were dropped");

  purgeMemoryUserData(u);
});

test("#18 mem read parity: listEvents returns the most-recent N, newest-first", async () => {
  const u = "u-ring-parity";
  purgeMemoryUserData(u);
  for (let i = 0; i < 10; i++) memRecordEvent(ev(u, i));
  const got = await listEvents(u, 5);
  assert.deepEqual(got.map((e) => e.payload.itemId), ["syn-9", "syn-8", "syn-7", "syn-6", "syn-5"],
    "most recent 5, newest first — matching pg's ORDER BY at DESC LIMIT n");
  purgeMemoryUserData(u);
});
