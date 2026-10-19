// tests/post-refs.test.js — hashtags + @mentions on the wire (owner
// directive, 14 Aug 2026, backlog 3). The law under test: parsing
// only SPLITS already-sanitized text (concatenating the segments must
// reproduce the author's characters exactly), a ref is linked only when
// the target could exist, and an edit re-extracts so a removed tag
// really leaves the row.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractRefs, segmentTransmission, linkableHandle, normalizeHashtag,
  hashtagHref, mentionHref,
} from "../lib/posts/refs.js";
import { sanitizeStatement } from "../lib/profile/rooms.js";
import { createEditorialPost, updateEditorialPost, listEditorialPosts } from "../lib/db/production.js";

const rebuild = (text) => segmentTransmission(text).map((s) => s.text).join("");

test("segments always reproduce the author's exact text", () => {
  for (const text of [
    "plain words, no refs at all",
    "#archival tailoring with @grey-market",
    "starts with @someone and ends with #tag",
    "#a #b #c back to back @x-y-z",
    "punctuation: (#gorp) \"@vex-archive\" — done.",
    "not a tag: C# and an email a@b.com and a url https://x.com/#anchor",
    "",
    "   ",
  ]) {
    assert.equal(rebuild(text), text, `rebuild failed for: ${JSON.stringify(text)}`);
  }
});

test("hashtags and mentions are found, lowercased, and deduped", () => {
  const refs = extractRefs("#Archival and #archival with @Grey-Market and @grey-market again #gorp");
  assert.deepEqual(refs.hashtags, ["archival", "gorp"]);
  assert.deepEqual(refs.mentions, ["grey-market"]);
});

test("display keeps the author's capitalization; the link does not", () => {
  const segs = segmentTransmission("wearing #Archival today");
  const tag = segs.find((s) => s.type === "hashtag");
  assert.equal(tag.text, "#Archival", "the reader sees what was written");
  assert.equal(tag.value, "archival", "the link normalizes");
  assert.equal(hashtagHref(tag.value), "/discover?q=archival");
});

test("a ref must be at a word boundary — C#, emails and url anchors are not refs", () => {
  const refs = extractRefs("scoring C# and mailing a@b.com, see https://x.com/page#anchor");
  assert.deepEqual(refs.hashtags, [], "no hashtags");
  assert.deepEqual(refs.mentions, [], "no mentions");
  assert.equal(segmentTransmission("scoring C# and a@b.com").every((s) => s.type === "text"), true);
});

test("only a handle that COULD exist is linked", () => {
  // Reserved words can never be claimed, so linking one would promise a
  // page that can never load.
  assert.equal(linkableHandle("asilum"), null);
  assert.equal(linkableHandle("admin"), null);
  assert.equal(linkableHandle("ab"), null, "too short for the handle rules");
  assert.equal(linkableHandle("Vex-Archive"), "vex-archive");
  assert.equal(mentionHref("vex-archive"), "/u/vex-archive");

  const refs = extractRefs("credit to @asilum and @vex-archive");
  assert.deepEqual(refs.mentions, ["vex-archive"], "the reserved mention is left as plain text");
  const segs = segmentTransmission("credit to @asilum and @vex-archive");
  assert.equal(segs.filter((s) => s.type === "mention").length, 1);
});

test("normalizeHashtag trims trailing hyphens and refuses the empty tag", () => {
  assert.equal(normalizeHashtag("Gorp-"), "gorp");
  assert.equal(normalizeHashtag(""), null);
});

test("extraction is bounded so one transmission cannot flood the row", () => {
  const many = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
  assert.equal(extractRefs(many).hashtags.length, 12);
});

test("parsing runs AFTER the sanitizer, so segments align with the stored text", () => {
  // WHY THE ORDER IS LOAD-BEARING: the sanitizer rewrites the string —
  // it collapses runs of whitespace and drops control characters — so
  // offsets computed against the RAW text would land in the wrong places
  // once the sanitized version is what gets stored and rendered.
  const raw = "wearing   #Archival    today with @Grey-Market";
  const clean = sanitizeStatement(raw, 5000);
  assert.notEqual(clean, raw, "the sanitizer really did rewrite the text");

  const refs = extractRefs(clean);
  assert.deepEqual(refs.hashtags, ["archival"]);
  assert.deepEqual(refs.mentions, ["grey-market"]);
  // The property that matters: what is rendered reassembles exactly the
  // text that was stored — never the raw input, never something else.
  assert.equal(rebuild(clean), clean);
});

test("markup the sanitizer destroyed does not come back as a tag", () => {
  // <b>#archival</b> sanitizes to "b#archival/b" — the tag is now glued
  // to a letter, and by the same boundary rule that spares C# it is NOT
  // a hashtag. Inventing one here would be reconstructing structure from
  // markup the sanitizer deliberately removed.
  const clean = sanitizeStatement("<b>#archival</b> by @grey-market", 5000);
  assert.equal(clean, "b#archival/b by @grey-market");
  assert.deepEqual(extractRefs(clean).hashtags, []);
  assert.deepEqual(extractRefs(clean).mentions, ["grey-market"], "the clean mention still links");
});

test("an edit re-extracts: a removed hashtag leaves the row", async () => {
  const AUTHOR = "u-77777777-7777-4777-8777-777777777777";
  const first = "the #archival cut, with @grey-market";
  const post = await createEditorialPost({
    authorId: AUTHOR, authorHandle: "reader-r1", kind: "user", moderationStatus: "visible",
    body: first, excerpt: first, tags: extractRefs(first).hashtags,
  });
  const before = (await listEditorialPosts({ id: post.id }))[0];
  assert.deepEqual(before.tags, ["archival"]);

  const second = "the tailored cut, no tag now";
  await updateEditorialPost({
    id: post.id, authorId: AUTHOR, body: second, excerpt: second,
    tags: extractRefs(second).hashtags,
  });
  const after = (await listEditorialPosts({ id: post.id }))[0];
  assert.deepEqual(after.tags, [], "the transmission stops answering a search for a word it no longer contains");
});

test("an edit that passes no tags leaves the stored tags alone", async () => {
  const AUTHOR = "u-88888888-8888-4888-8888-888888888888";
  const text = "#gorp weather";
  const post = await createEditorialPost({
    authorId: AUTHOR, authorHandle: "reader-r2", kind: "user", moderationStatus: "visible",
    body: text, excerpt: text, tags: ["gorp"],
  });
  await updateEditorialPost({ id: post.id, authorId: AUTHOR, body: "same words", excerpt: "same words" });
  const after = (await listEditorialPosts({ id: post.id }))[0];
  assert.deepEqual(after.tags, ["gorp"]);
});
