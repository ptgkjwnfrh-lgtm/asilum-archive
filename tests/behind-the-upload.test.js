// tests/behind-the-upload.test.js — BEHIND THE UPLOAD AND CAPTIONS AS
// EVIDENCE (V.2 17.2–17.5; slice 10c). Held here:
//   * a caption re-reads the upload and its tags override a conflicting
//     assumption (17.2);
//   * a gathered tag is correctable: one tap removes it (17.3);
//   * deleting an upload removes only its evidence: a tag it alone supported
//     comes down, a tag another upload or the passenger's own anchor supports
//     stays (17.4);
//   * every upload starts with equal importance (17.5); no identity-anchor
//     badge rides on an upload (17.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMoodBoardUpload, listMoodBoardUploads, updateMoodBoardUpload, deleteMoodBoardUpload } from "../lib/db/production/editorial.js";
import { getProfile, saveProfile } from "../lib/db/index.js";
import { captionOverride, evidenceAfterDeletion } from "../lib/passport/evidence.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const uuid = () => globalThis.crypto.randomUUID();

test("the law: a caption's tags override conflicting assumptions and stay distinct; deletion recalculates only what the upload alone supported", () => {
  const assumed = [{ tag: "minimal", tag_type: "aesthetic", confidence: 0.6 }, { tag: "black", tag_type: "palette", confidence: 0.5 }];
  const merged = captionOverride(assumed, { MINIMAL: 0.2, STATEMENT: 0.7 });
  assert.deepEqual(merged.find((t) => t.tag === "minimal"), { tag: "minimal", tag_type: "caption", confidence: 0.2 }, "the caption's reading replaces the assumed one for the same tag");
  assert.ok(merged.find((t) => t.tag === "statement" && t.tag_type === "caption"));
  assert.ok(merged.find((t) => t.tag === "black" && t.tag_type === "palette"), "an uncontested assumption stays");
  const r = evidenceAfterDeletion({ long: { MINIMAL: 0.8, STATEMENT: 0.5, TAILORED: 0.9 }, manual: { TAILORED: 0.9 } }, { MINIMAL: 0.6, STATEMENT: 0.5, TAILORED: 0.3 }, [{ MINIMAL: 0.4 }]);
  assert.equal(r.long.MINIMAL, 0.8, "another upload supports MINIMAL: it stays");
  assert.equal(r.long.STATEMENT, 0, "only this upload supported STATEMENT: it comes down by its weight");
  assert.equal(r.long.TAILORED, 0.9, "an identity anchor is never touched");
  assert.deepEqual(r.recalculated, ["STATEMENT"]);
});

test("the store: caption and tag edits, deletion with its analysis rows, on the memory backend", async () => {
  const user = "u-" + uuid();
  const up = await createMoodBoardUpload({ userId: user, source: "image-upload", tags: [{ tag: "minimal", tag_type: "aesthetic", confidence: 0.6 }], analyzedBy: "filename" });
  const edited = await updateMoodBoardUpload({ id: up.id, userId: user, caption: "a loud statement coat", tags: [{ tag: "statement", tag_type: "caption", confidence: 0.7 }] });
  assert.equal(edited.caption, "a loud statement coat"); assert.deepEqual(edited.tags.map((t) => t.tag), ["statement"]);
  assert.equal(await updateMoodBoardUpload({ id: up.id, userId: "u-else", caption: "x" }), null, "another person's upload is nobody's to edit");
  assert.equal((await listMoodBoardUploads(user)).length, 1);
  assert.equal(await deleteMoodBoardUpload({ id: up.id, userId: "u-else" }), false);
  assert.equal(await deleteMoodBoardUpload({ id: up.id, userId: user }), true);
  assert.equal((await listMoodBoardUploads(user)).length, 0);
});

test("the route: a caption re-reads and trains; a tag removes; deletion recalculates the profile; equal weight; no anchor badge", async () => {
  const route = await loadRoute("app/api/moodboard/route.js");
  const me = newDevice();
  await saveProfile(me.uid, { long: {}, session: {}, _meta: {} });
  const made = await callRoute(route.POST, { path: "/api/moodboard", cookies: me.cookies, json: { user: me.uid, kind: "upload", filenames: ["minimal-black-coat.jpg"], uploadId: "up-" + uuid().slice(0, 12) } });
  assert.equal(made.status, 200);
  const id = made.body.id;
  const before = (await listMoodBoardUploads(me.uid))[0];
  assert.ok(before.tags.every((t) => t.confidence <= 1), "equal starting weight: nothing is important by default");
  assert.ok(!("anchor" in before) && !before.tags.some((t) => t.tag_type === "anchor"), "no inferred identity-anchor badge (17.3)");
  const cap = await callRoute(route.PATCH, { path: "/api/moodboard", method: "PATCH", cookies: me.cookies, json: { user: me.uid, id, caption: "loud statement piece" } });
  assert.equal(cap.status, 200); assert.equal(cap.body.upload.caption, "loud statement piece");
  assert.ok(cap.body.upload.tags.some((t) => t.tag_type === "caption"), "the caption's own reading rides on the upload");
  const profAfterCaption = await getProfile(me.uid);
  assert.ok((profAfterCaption.long.STATEMENT || 0) > 0, "the caption is taste evidence");
  const tagToRemove = cap.body.upload.tags[0];
  const rm = await callRoute(route.PATCH, { path: "/api/moodboard", method: "PATCH", cookies: me.cookies, json: { user: me.uid, id, removeTag: tagToRemove.tag, tagType: tagToRemove.tag_type } });
  assert.equal(rm.status, 200); assert.ok(!rm.body.upload.tags.some((t) => t.tag === tagToRemove.tag && t.tag_type === tagToRemove.tag_type), "a tag is correctable");
  const stranger = newDevice();
  assert.equal((await callRoute(route.PATCH, { path: "/api/moodboard", method: "PATCH", cookies: stranger.cookies, json: { user: stranger.uid, id, caption: "mine now" } })).status, 404);
  const del = await callRoute(route.DELETE, { path: "/api/moodboard", method: "DELETE", cookies: me.cookies, query: { user: me.uid, id } });
  assert.equal(del.status, 200); assert.ok(Array.isArray(del.body.recalculated));
  assert.equal((await listMoodBoardUploads(me.uid)).length, 0);
  const after = await getProfile(me.uid);
  for (const t of del.body.recalculated) assert.ok((after.long[t] || 0) < (profAfterCaption.long[t] || 0) + 1e-9, `${t} came down with its only evidence`);
});
