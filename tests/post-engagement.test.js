// tests/post-engagement.test.js — likes + saves on transmissions (owner
// directive, 14 Aug 2026, backlog 2), mem mode. The law under test:
// counters count PEOPLE, not events — pressing LIKE in a loop moves nothing,
// only another human does; engagement never lands on a transmission the wire
// will not show; and the ledger is reached by BOTH movers of identity
// (purge erases it, adoption rekeys it and collapses collisions to one
// person — the v22 anti-manipulation law).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createEditorialPost, deleteEditorialPost, engagementFor,
  setTransmissionEngagement, purgePersonalizationData, adoptAccountData,
} from "../lib/db/production.js";

const ALICE = "u-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "u-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARL = "u-cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let n = 0;
async function transmission(text = "a transmission") {
  n += 1;
  return createEditorialPost({
    authorId: ALICE, authorHandle: "reader-e" + n, kind: "user",
    moderationStatus: "visible", body: text, excerpt: text.slice(0, 200),
  });
}

const counts = async (id, viewer = null) => (await engagementFor([id], viewer))[String(id)];

test("a like counts one person, and repeating it counts no more", async () => {
  const post = await transmission();
  const first = await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true });
  assert.equal(first.likes, 1);
  assert.equal(first.youLike, true, "the engaged person sees their own state");

  for (let i = 0; i < 5; i++) {
    await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true });
  }
  const after = await counts(post.id, BOB);
  assert.equal(after.likes, 1, "repetition buys nothing — the counter is people");
});

test("another person moves the counter; withdrawing takes it back down", async () => {
  const post = await transmission();
  await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true });
  await setTransmissionEngagement({ postId: post.id, userId: CARL, kind: "like", on: true });
  assert.equal((await counts(post.id)).likes, 2, "only another human moves it");

  await setTransmissionEngagement({ postId: post.id, userId: CARL, kind: "like", on: false });
  const after = await counts(post.id, CARL);
  assert.equal(after.likes, 1);
  assert.equal(after.youLike, false, "the withdrawal shows in that person's own state");
});

test("likes and saves are separate counters on the same transmission", async () => {
  const post = await transmission();
  await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "save", on: true });
  const c = await counts(post.id, BOB);
  assert.deepEqual(
    { likes: c.likes, saves: c.saves, youLike: c.youLike, youSave: c.youSave },
    { likes: 0, saves: 1, youLike: false, youSave: true }
  );
});

test("an anonymous viewer sees real counts and no personal state", async () => {
  const post = await transmission();
  await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true });
  const c = await counts(post.id, null);
  assert.equal(c.likes, 1, "true numbers are not hidden from signed-out readers");
  assert.equal(c.youLike, false);
});

test("a transmission nobody touched reports honest zeros", async () => {
  const post = await transmission();
  assert.deepEqual(await counts(post.id), { likes: 0, saves: 0, youLike: false, youSave: false });
});

test("engagement never lands on a transmission the wire will not show", async () => {
  const post = await transmission();
  await deleteEditorialPost({ id: post.id, authorId: ALICE });
  assert.equal(
    await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true }),
    null,
    "a retired transmission cannot be liked — and the answer reveals nothing about it"
  );
  assert.equal((await counts(post.id)).likes, 0);

  assert.equal(
    await setTransmissionEngagement({ postId: "999999999", userId: BOB, kind: "like", on: true }),
    null,
    "neither can one that never existed — the same answer"
  );
});

test("the verbs demand an identity and a known kind, loudly", async () => {
  const post = await transmission();
  await assert.rejects(
    () => setTransmissionEngagement({ postId: post.id, kind: "like", on: true }), TypeError);
  await assert.rejects(
    () => setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "applaud", on: true }), TypeError);
});

test("erasure stops a departed person counting on everyone's transmissions", async () => {
  const post = await transmission();
  await setTransmissionEngagement({ postId: post.id, userId: BOB, kind: "like", on: true });
  await setTransmissionEngagement({ postId: post.id, userId: CARL, kind: "like", on: true });
  assert.equal((await counts(post.id)).likes, 2);

  await purgePersonalizationData(CARL);
  assert.equal((await counts(post.id)).likes, 1,
    "the purge reaches the identity_hash ledger — they stop counting");
  assert.equal((await counts(post.id, BOB)).youLike, true, "everyone else is untouched");
});

test("sign-in absorbs the device's engagement without counting one human twice", async () => {
  const post = await transmission();
  const DEVICE = "u-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const ACCOUNT = "sb-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  // The same person likes before signing in, and again after.
  await setTransmissionEngagement({ postId: post.id, userId: DEVICE, kind: "like", on: true });
  await setTransmissionEngagement({ postId: post.id, userId: ACCOUNT, kind: "like", on: true });
  assert.equal((await counts(post.id)).likes, 2, "before adoption they look like two people");

  await adoptAccountData(DEVICE, ACCOUNT);
  const after = await counts(post.id, ACCOUNT);
  assert.equal(after.likes, 1, "one human, one vote — the collision collapses");
  assert.equal(after.youLike, true, "and it belongs to the account");
});

test("adoption carries a device-only engagement onto the account", async () => {
  const post = await transmission();
  const DEVICE = "u-ffffffff-ffff-4fff-8fff-ffffffffffff";
  const ACCOUNT = "sb-99999999-9999-4999-8999-999999999999";

  await setTransmissionEngagement({ postId: post.id, userId: DEVICE, kind: "save", on: true });
  await adoptAccountData(DEVICE, ACCOUNT);

  const after = await counts(post.id, ACCOUNT);
  assert.equal(after.saves, 1, "the count is unchanged — it was always one person");
  assert.equal(after.youSave, true, "and the account now holds it");
});
