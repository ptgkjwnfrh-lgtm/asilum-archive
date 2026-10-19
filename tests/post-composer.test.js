// tests/post-composer.test.js — THE ONE COMPOSER's law (V.2 brief §6):
// the derived kind, the 500-grapheme transmission with no silent
// truncation, the candidate limits, the draft's attachment history, the
// safe link preview's refusals and parser, and the row that carries the
// composition in memory mode.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateComposition, kindOf, defaultLayout, graphemeCount, attachmentsFor,
  TRANSMISSION_MAX, MAX_IMAGES, MAX_PIECES, MAX_EVENT_ATTACHMENTS, MAX_LAYERS, LAYER_COLORS,
} from "../lib/posts/compose.js";
import { newDraft, attachMedia, detachMedia, restoreMedia, discardMedia, setText, setEvent, describe, writeDraft, readDraft } from "../lib/posts/draft.js";
import { previewAllowed, parsePreview, fetchPreview, resolvesPublic } from "../lib/posts/preview.js";
import { createEditorialPost, listEditorialPosts } from "../lib/db/production.js";

const img = (n) => ({ path: `u-abc/${"0".repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`, alt: "a jacket" });

test("the kind is derived from the attachments, never chosen from a menu", () => {
  assert.equal(kindOf({ text: "hello" }), "transmission");
  assert.equal(kindOf({ text: "hello", media: [img(1)] }), "post");
  assert.equal(kindOf({ text: "hello", video: { path: "x" } }), "video");
  assert.equal(kindOf({ text: "", event: { id: "pgc-fashion-week-2026" } }), "post");
  assert.equal(defaultLayout({ media: [img(1), img(2)] }), "carousel");
  assert.equal(defaultLayout({ media: [img(1)] }), "single");
  assert.equal(defaultLayout({ event: { id: "x" } }), "event");
  assert.equal(defaultLayout({ text: "x" }), null);
});

test("a transmission is at most 500 grapheme clusters and is never truncated", () => {
  assert.equal(graphemeCount("👩🏽‍🎤ab"), 3, "a composed emoji is one");
  const ok = validateComposition({ text: "a".repeat(TRANSMISSION_MAX) });
  assert.equal(ok.ok, true); assert.equal(ok.kind, "transmission");
  const long = validateComposition({ text: "a".repeat(TRANSMISSION_MAX + 1) });
  assert.equal(long.ok, false);
  assert.equal(long.errors[0].code, "transmission-long");
  assert.match(long.errors[0].message, /501/);
  assert.match(long.errors[0].message, /shorten it/);
  // the same text with an image is a post whose caption may be long
  const asPost = validateComposition({ text: "a".repeat(TRANSMISSION_MAX + 1), media: [img(1)] });
  assert.equal(asPost.ok, true); assert.equal(asPost.kind, "post"); assert.equal(asPost.layout, "single");
  assert.equal(validateComposition({ text: "   " }).errors[0].code, "empty");
});

test("the candidate limits are enforced and named", () => {
  assert.deepEqual([MAX_IMAGES, MAX_PIECES, MAX_EVENT_ATTACHMENTS, MAX_LAYERS], [10, 10, 1, 3]);
  const many = validateComposition({ text: "x", media: Array.from({ length: 11 }, (_, i) => img(i)) });
  assert.equal(many.errors[0].code, "too-many-images");
  const pieces = validateComposition({ text: "x", layout: "fragment", pieces: Array.from({ length: 11 }, (_, i) => "ebay-" + i) });
  assert.equal(pieces.errors[0].code, "too-many-pieces");
  assert.equal(validateComposition({ text: "x", layout: "fragment", pieces: ["Helmut Lang jeans"] }).errors[0].code, "unresolved-piece", "a plain phrase is not a tag");
  assert.equal(validateComposition({ text: "x", layout: "fragment", pieces: [] }).errors[0].code, "fragment-empty");
  assert.equal(validateComposition({ text: "x", event: { name: "no id" } }).errors[0].code, "unresolved-event");
  assert.equal(validateComposition({ text: "x", link: "http://example.org" }).errors[0].code, "bad-link");
  // slice 9: a video is an ADMITTED asset — a path or a link is refused until the worker has read it
  assert.equal(validateComposition({ text: "x", video: { path: "v" } }).errors[0].code, "video-unadmitted");
  const expose = validateComposition({ text: "x", media: [img(1)], layout: "expose", layers: [{ text: "THE CUT", color: "neon" }] });
  assert.equal(expose.errors[0].code, "layer-color");
  assert.ok(LAYER_COLORS.includes("paper"));
  const good = validateComposition({ text: "x", media: [img(1)], layout: "expose", layers: [{ text: "THE CUT", align: "center", position: "bottom", color: "paper", x: 0.1, y: 0.9 }] });
  assert.equal(good.ok, true); assert.equal(good.layout, "expose");
});

test("attachments are stored structured and bounded — text layers as text, never a flattened picture", () => {
  const c = { text: "caption", media: [img(1), img(2)], layout: "expose", layers: [{ text: "THE CUT", color: "red", x: 0.2, y: 0.8 }], alt: "two jackets" };
  const a = attachmentsFor(c, { pieceSnapshots: [{ id: "ebay-1", title: "Jacket" }], linkSnapshot: { url: "https://example.org", title: "T" } });
  assert.equal(a.media.length, 2); assert.equal(a.media[0].alt, "a jacket");
  assert.deepEqual(a.layers, [{ text: "THE CUT", align: "left", position: "bottom", color: "red", font: "display", x: 0.2, y: 0.8 }]);
  assert.equal(a.pieces[0].id, "ebay-1"); assert.equal(a.link.title, "T"); assert.equal(a.alt, "two jackets");
  assert.throws(() => attachmentsFor({ text: "a".repeat(600) }), /shorten it/);
});

test("the draft keeps detached media until discarded; kind switches never lose the text", () => {
  let d = setText(newDraft(), "tonight's uniform");
  assert.equal(describe(d).kind, "transmission");
  d = attachMedia(d, img(1));
  assert.equal(describe(d).kind, "post"); assert.equal(d.composition.text, "tonight's uniform");
  d = detachMedia(d, img(1).path);
  assert.equal(describe(d).kind, "transmission"); assert.equal(d.detached.length, 1, "detached, not deleted");
  d = setText(d, "a".repeat(600));
  assert.equal(describe(d).ok, false, "overlong text blocks publishing");
  assert.equal(d.composition.text.length, 600, "and is kept, not cut");
  d = restoreMedia(d, img(1).path);
  assert.equal(describe(d).kind, "post"); assert.equal(describe(d).ok, true); assert.equal(d.detached.length, 0);
  d = detachMedia(d, img(1).path); d = discardMedia(d, img(1).path);
  assert.equal(d.detached.length, 0);
  d = setEvent(d, { id: "pgc-fashion-week-2026", name: "PGC Fashion Week" });
  assert.equal(d.composition.layout, "event");
  d = setEvent(d, null);
  assert.equal(d.composition.layout, null);
  // versions climb on write; a fresh read with no storage is a new draft
  const w = writeDraft(d);
  assert.equal(w.version, 1); assert.ok(w.updatedAt);
  assert.equal(readDraft().version, 0);
});

test("the preview service refuses what it must and parses what it may", async () => {
  assert.equal(previewAllowed("http://example.org").ok, false);
  assert.equal(previewAllowed("https://localhost/x").ok, false);
  assert.equal(previewAllowed("https://10.0.0.1/x").ok, false);
  assert.equal(previewAllowed("https://user:pw@example.org/").ok, false);
  assert.equal(previewAllowed("https://example.org/article").ok, true);
  assert.equal(await resolvesPublic("example.org", async () => [{ address: "93.184.216.34" }]), true);
  assert.equal(await resolvesPublic("evil.example", async () => [{ address: "93.184.216.34" }, { address: "10.1.1.1" }]), false, "one private address poisons the host");
  assert.equal(await resolvesPublic("nx.example", async () => { throw new Error("ENOTFOUND"); }), false);
  const html = `<html><head><title>Plain &amp; Title</title><meta property="og:title" content="The Cut: a reading"><meta name="description" content="A <b>bold</b> claim">
    <meta property="og:image" content="/img/x.jpg"><meta property="og:site_name" content="Example"></head><body><script>alert(1)</script></body></html>`;
  const snap = parsePreview(html, "https://example.org/article");
  assert.equal(snap.title, "The Cut: a reading");
  assert.equal(snap.description, "A <b>bold</b> claim", "text, not markup — the card renders it as text");
  assert.equal(snap.image, "https://example.org/img/x.jpg");
  assert.equal(snap.host, "example.org"); assert.equal(snap.site, "Example");
  assert.equal(parsePreview('<meta name="robots" content="noindex, nosnippet"><title>x</title>', "https://example.org"), null, "a page that asks not to be summarised is not");
  assert.equal(parsePreview("<html></html>", "https://example.org"), null);
  // redirects are re-checked hop by hop
  const lookup = async () => [{ address: "93.184.216.34" }];
  const toPrivate = await fetchPreview("https://example.org/a", { lookup, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }) });
  assert.match(toPrivate.refused, /not a public host/);
  const loop = await fetchPreview("https://example.org/a", { lookup, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.org/a" } }) });
  assert.match(loop.refused, /too many redirects/);
  const notHtml = await fetchPreview("https://example.org/a.pdf", { lookup, fetchImpl: async () => new Response("x", { status: 200, headers: { "content-type": "application/pdf" } }) });
  assert.match(notHtml.refused, /not an html/);
  const ok = await fetchPreview("https://example.org/a", { lookup, fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) });
  assert.equal(ok.title, "The Cut: a reading");
});

test("the row carries the composition and a legacy row with an image reads as a post", async () => {
  const author = "u-33333333-3333-4333-8333-333333333333";
  const post = await createEditorialPost({ authorId: author, authorHandle: "reader-c1", kind: "user", body: "caption", excerpt: "caption",
    postKind: "post", layout: "carousel", attachments: { media: [img(1), img(2)], pieces: [{ id: "ebay-1", title: "Jacket" }] } });
  const back = (await listEditorialPosts({ id: post.id }))[0];
  assert.equal(back.postKind, "post"); assert.equal(back.layout, "carousel"); assert.equal(back.attachments.media.length, 2);
  const legacy = await createEditorialPost({ authorId: author, authorHandle: "reader-c2", kind: "user", body: "old", excerpt: "old", imageUrl: "https://example.org/x.jpg" });
  assert.equal((await listEditorialPosts({ id: legacy.id }))[0].postKind, "post");
  const minted = await createEditorialPost({ authorId: author, authorHandle: "reader-c3", kind: "user", body: "t", excerpt: "t", postKind: "deleted", layout: "weird", attachments: ["no"] });
  const m = (await listEditorialPosts({ id: minted.id }))[0];
  assert.equal(m.postKind, "transmission"); assert.equal(m.layout, null); assert.deepEqual(m.attachments, {});
});
