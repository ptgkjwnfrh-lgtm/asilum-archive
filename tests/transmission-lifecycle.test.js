// tests/transmission-lifecycle.test.js — transmission edit + delete
// (owner directive, 14 Aug 2026, backlog 1), mem mode. The law
// under test: only the author — bound in the WHERE clause, not in caller
// claims — can touch a transmission; deletion is a soft moderation state
// that kills every read path including the permalink; edits stamp
// edited_at (the floor's honesty label) and can never mint 'deleted';
// and the 5000-character transmission law survives the db layer intact.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createEditorialPost, listEditorialPosts, updateEditorialPost, deleteEditorialPost,
} from "../lib/db/production.js";

const AUTHOR = "u-11111111-1111-4111-8111-111111111111";
const STRANGER = "u-22222222-2222-4222-8222-222222222222";

let seq = 0;
async function seed(text, { title = null, handle = null } = {}) {
  seq += 1;
  const h = handle || "reader-t" + seq;
  return createEditorialPost({
    authorId: AUTHOR, authorHandle: h, kind: "user", moderationStatus: "visible",
    title, body: text, excerpt: text.slice(0, 200),
  });
}

async function readById(id) {
  const rows = await listEditorialPosts({ id });
  return rows[0] || null;
}

test("author edit rewrites the transmission and stamps edited_at", async () => {
  const post = await seed("original account of the fitting", { title: "FIRST CUT" });
  const before = await readById(post.id);
  assert.equal(before.editedAt ?? null, null, "an untouched transmission carries no edited stamp");

  const updated = await updateEditorialPost({
    id: post.id, authorId: AUTHOR,
    title: "SECOND CUT", body: "corrected account of the fitting",
    excerpt: "corrected account of the fitting", moderationStatus: "visible",
  });
  assert.ok(updated, "the author's edit lands");
  assert.equal(updated.title, "SECOND CUT");
  assert.equal(updated.body, "corrected account of the fitting");
  assert.ok(updated.editedAt, "edited_at is stamped");

  const read = await readById(post.id);
  assert.equal(read.body, "corrected account of the fitting", "the wire reads the new text");
  assert.ok(read.editedAt, "the honesty label rides every read");
});

test("an edit with no caption clears the old caption — the fields ARE the transmission", async () => {
  const post = await seed("captioned at first", { title: "HEADER" });
  const updated = await updateEditorialPost({
    id: post.id, authorId: AUTHOR, title: null,
    body: "captioned no longer", excerpt: "captioned no longer",
  });
  assert.equal(updated.title, null);
});

test("a stranger's edit answers null and changes nothing", async () => {
  const post = await seed("the author's own words");
  const result = await updateEditorialPost({
    id: post.id, authorId: STRANGER,
    body: "words the author never wrote", excerpt: "words the author never wrote",
  });
  assert.equal(result, null, "not the author → same answer as a missing post");
  const read = await readById(post.id);
  assert.equal(read.body, "the author's own words", "untouched");
  assert.equal(read.editedAt ?? null, null, "no edit stamp minted");
});

test("editing a transmission that does not exist answers null", async () => {
  assert.equal(await updateEditorialPost({
    id: "999999999", authorId: AUTHOR, body: "into the void", excerpt: "into the void",
  }), null);
});

test("an edit can never mint 'deleted' — deletion has its own verb", async () => {
  const post = await seed("still standing");
  const updated = await updateEditorialPost({
    id: post.id, authorId: AUTHOR, body: "still standing", excerpt: "still standing",
    moderationStatus: "deleted",
  });
  assert.ok(updated, "the edit itself lands");
  const read = await readById(post.id);
  assert.ok(read, "the transmission is still on the wire — the whitelist refused 'deleted'");
});

test("a re-screened edit can park under review; a clean re-edit returns it", async () => {
  const post = await seed("clean at first");
  await updateEditorialPost({
    id: post.id, authorId: AUTHOR, body: "flagged this time", excerpt: "flagged this time",
    moderationStatus: "under_review",
  });
  assert.equal(await readById(post.id), null, "under review = off the public wire, permalink included");

  const restored = await updateEditorialPost({
    id: post.id, authorId: AUTHOR, body: "clean again", excerpt: "clean again",
    moderationStatus: "visible",
  });
  assert.ok(restored, "the author can still reach their parked transmission");
  const read = await readById(post.id);
  assert.equal(read.body, "clean again", "the deterministic screen decides again");
});

test("author delete is soft, kills every read path, and answers only once", async () => {
  const handle = "reader-del1";
  const post = await seed("soon to be retired", { handle });

  assert.equal(await deleteEditorialPost({ id: post.id, authorId: AUTHOR }), true);

  assert.equal(await readById(post.id), null, "the permalink read is dead");
  const byHandle = await listEditorialPosts({ handle });
  assert.equal(byHandle.length, 0, "the poster's page no longer shows it");
  const mine = await listEditorialPosts({ authorId: AUTHOR });
  assert.ok(!mine.some((p) => String(p.id) === String(post.id)), "the durable profile record refuses it too");

  assert.equal(await deleteEditorialPost({ id: post.id, authorId: AUTHOR }), false,
    "a second delete finds nothing to retire");
  assert.equal(await updateEditorialPost({
    id: post.id, authorId: AUTHOR, body: "zombie edit", excerpt: "zombie edit",
  }), null, "a deleted transmission cannot be edited back to life");
});

test("a stranger's delete answers false and retires nothing", async () => {
  const post = await seed("not yours to retire");
  assert.equal(await deleteEditorialPost({ id: post.id, authorId: STRANGER }), false);
  assert.ok(await readById(post.id), "still on the wire");
});

test("the 5000-character transmission law survives the db layer", async () => {
  const long = "x".repeat(5000);
  const post = await seed(long);
  const read = await readById(post.id);
  assert.equal(read.body.length, 5000, "a full-length transmission is not silently truncated");

  const over = await createEditorialPost({
    authorId: AUTHOR, authorHandle: "reader-cap", kind: "user",
    moderationStatus: "visible", body: "y".repeat(5001), excerpt: "cap",
  });
  const readOver = await readById(over.id);
  assert.equal(readOver.body.length, 5000, "past the law, the cap holds");
});

test("both verbs demand an author identity, loudly", async () => {
  await assert.rejects(() => updateEditorialPost({ id: "1", body: "no author", excerpt: "no author" }), TypeError);
  await assert.rejects(() => deleteEditorialPost({ id: "1" }), TypeError);
});
