// app/api/editorial/route.js
// Editorial as hyperlinked articles + user/ASILUM posts (editorial_posts).
// Not a heavy magazine backend: title/excerpt/image/link/tags/author, able to
// reference designers and products so editorial can feed discovery.
//
// GET    ?kind=user|asilum|article&limit= → visible posts, newest first
//        (?id= is the permalink read — a miss answers 404, honestly)
// POST   { user, handle, text, title?, imageUrl?, externalUrl?, tags?, designerRefs?, productRefs? }
// PATCH  { user, id, text, title? } — author-verified edit, stamps edited_at
// DELETE ?id=&user= — author-verified soft delete (the permalink dies with it)

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  createEditorialPost, createModerationTask, deleteEditorialPost, getProfileRoom,
  listEditorialPosts, updateEditorialPost,
} from "../../../lib/db/production.js";
import { accountIdFromIdentity, resolveRequestUser } from "../../../lib/identity.js";
import { sanitizeStatement, screenStatement } from "../../../lib/profile/rooms.js";
import { extractRefs } from "../../../lib/posts/refs.js";
import { safeExternalUrl, safeImageUrl } from "../../../lib/url.js";
import { validateComposition, attachmentsFor, eventsOf } from "../../../lib/posts/compose.js";
import { deliverPosts } from "../../../lib/db/production/brdcst.js";
import { fetchPreview } from "../../../lib/posts/preview.js";
import { postImageUrl } from "../../../lib/posts/media.js";
import { getMotionAsset, motionForPost } from "../../../lib/db/production/media.js";
import { motionUrls } from "../../../lib/media/worker.js";
import { resolveProduct } from "../../../lib/products.js";
import { sourceFor } from "../../../lib/social.js";
import { listPlaces } from "../../../lib/places/registry.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { requestSubject } from "../../../lib/security/request.js";

// The wire's transmission law (owner order, Aug 13): text posts cap at
// 5000 characters; the caption (title) acts as the transmission's header
// and keeps its 200-char cap. Video (≤3:00) and image carousels (≤6)
// arrive with the media pipeline — this route stays text-only until
// storage exists, honestly.
const POST_MAX = 5000;

// Caller-supplied tags + hashtags parsed out of the transmission, deduped
// and capped. Both are lowercased so "#Archival" and "#archival" are the
// same tag on the row and hand off to the same search.
function mergeTags(supplied, extracted) {
  const out = [];
  const push = (raw) => {
    const tag = String(raw ?? "").trim().toLowerCase().slice(0, 60);
    if (tag && !out.includes(tag) && out.length < 12) out.push(tag);
  };
  if (Array.isArray(supplied)) supplied.slice(0, 12).forEach(push);
  extracted.forEach(push);
  return out;
}

// The byline is server truth, never caller input: a published room handle
// when the account has one, otherwise a stable per-identity reader tag.
// (Spoofing "ASILUM" or another member's handle is what this closes.)
async function deriveAuthorHandle(user) {
  const accountId = accountIdFromIdentity(user);
  if (accountId) {
    try {
      const room = await getProfileRoom(accountId);
      if (room?.published && room?.handle) return room.handle;
    } catch {}
  }
  return "reader-" + createHash("sha256").update(String(user)).digest("hex").slice(0, 6);
}

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const requestedKind = searchParams.get("kind") || null;
  if (requestedKind && !["user", "asilum", "article"].includes(requestedKind)) {
    return NextResponse.json({ error: "unknown editorial kind" }, { status: 400 });
  }
  const kind = requestedKind;
  const limit = Math.max(1, Math.min(120, parseInt(searchParams.get("limit"), 10) || 60));
  // The identity chain (owner order, Aug 13): ?handle= reads a poster's
  // visible posts, ?id= reads one post (the permalink), ?mine=1 reads the
  // verified caller's own visible posts — filtered by author_id on the
  // server, which the response still never exposes. Visibility rules are
  // the same on every path.
  const handle = (searchParams.get("handle") || "").trim().slice(0, 80) || null;
  const rawId = searchParams.get("id");
  let id = null;
  if (rawId != null && rawId !== "") {
    if (!/^\d{1,18}$/.test(rawId)) return NextResponse.json({ error: "bad post id" }, { status: 400 });
    id = rawId;
  }
  let authorId = null;
  if (searchParams.get("mine") === "1") {
    const user = await resolveRequestUser(req, String(searchParams.get("user") || "")).catch(() => null);
    if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
    authorId = user;
  }
  const quota = await consumeRateLimit({ scope: "editorial-read", subject: requestSubject(req), limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    // An expired ECHO is never served live (V.2 Terms 5.4): filtered here,
    // after the store, so the memory and the Postgres backends agree.
    const now = Date.now();
    // BRDCST delivery (V.2 5.13–5.15, 9.13; slice 8): a post's event footer
    // rides only on a live campaign in reach of THIS viewer; on the feed
    // path a viewer whose taste does not match does not see the promoted
    // post at all; a permalink or a poster's page shows it bare instead.
    const viewerId = authorId || (await resolveRequestUser(req, String(searchParams.get("user") || "")).catch(() => null));
    const lat = searchParams.get("lat"), lng = searchParams.get("lng");
    const delivered = await deliverPosts(await listEditorialPosts({ kind, limit, handle, id, authorId }), { viewerId, lat, lng, now, hide: id == null && !handle && !authorId }).catch((e) => { console.error("[editorial] delivery failed", e?.message || e); return null; });
    const posts = (delivered || await listEditorialPosts({ kind, limit, handle, id, authorId }))
      .map(({ authorId: _a, ...post }) => post)
      .filter((post) => !(post.attachments && post.attachments.echo) || Number(post.attachments.echo.expiresAt) > now);
    // The permalink read answers 404 when the transmission is not on the
    // wire — deleted, held for review, or never published. A dead link
    // that pretends to be a page would be a lie (owner directive, Aug 14).
    if (id != null && posts.length === 0) {
      return NextResponse.json({ posts: [] }, { status: 404 });
    }
    return NextResponse.json({ posts });
  } catch {
    return NextResponse.json({ posts: [] });
  }
}

export async function POST(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  // POSTING REQUIRES A SIGNED-IN ACCOUNT (launch-readiness audit, Aug 16).
  // A device cookie proves a browser, not a person, and browsers are free:
  // before this, any signed-out visitor could publish to the wire and a
  // disposable identity could do it repeatedly. That is an anonymous abuse
  // surface with no moderation, reporting, or takedown behind it.
  //
  // Deliberately checked BEFORE the body is sanitized or any quota is spent,
  // so a caller who cannot post learns that first and cannot use the endpoint
  // to probe the sanitizer. 403, not 401 — the caller's identity is real and
  // proven; it is simply not the KIND of identity that may publish.
  //
  // Reading, engaging and editing are untouched. This is not the pending
  // "designers only vs everyone posts" ruling — that decides WHICH accounts
  // may post. This only establishes that an account is required at all.
  if (!accountIdFromIdentity(user)) {
    return NextResponse.json({
      error: "posting to the Feed requires a signed-in account",
      note: "sign in on PROFILE — a device on its own cannot publish",
    }, { status: 403 });
  }
  let text;
  try {
    text = sanitizeStatement(String(body.text || "").trim().slice(0, POST_MAX), POST_MAX);
  } catch {
    return NextResponse.json({ error: "text could not be sanitized" }, { status: 400 });
  }
  // THE COMPOSITION (V.2 brief §6): the same validator the composer ran, run
  // again here — a transmission over 500 graphemes is refused with the
  // composer's own sentence, never truncated; a post's pieces must resolve to
  // listings, its event to a map record, its link to a public https page the
  // preview service could read. The server resolves and SNAPSHOTS them.
  const composition = body.composition && typeof body.composition === "object" ? { ...body.composition, text, title: body.title ? String(body.title) : "" } : null;
  let compositionRow = null;
  if (composition) {
    const v = validateComposition(composition);
    if (!v.ok) return NextResponse.json({ error: v.errors[0].message, errors: v.errors }, { status: 400 });
    const pieceSnapshots = [];
    for (const ref of (composition.pieces || []).slice(0, 10)) {
      const id = typeof ref === "string" ? ref : ref && ref.id;
      // Resolve through the same discoverability authority as Feed/search.
      // A known id is not enough: draft, moderated, removed and sold-out
      // native inventory must never become public through a Wire attachment.
      const it = await resolveProduct(String(id)).catch(() => null);
      if (!it) return NextResponse.json({ error: `piece ${id} is not an active catalog listing` }, { status: 400 });
      pieceSnapshots.push({
        id: it.id, title: it.title, brand: it.brand, img: it.img || null,
        price: it.price ?? null, currency: it.currency || "USD", source: sourceFor(it),
      });
    }
    // every BRDCST on the post resolves to a map record (5.9–5.10); the
    // snapshot never carries coordinates — the campaign keeps the centre
    const eventSnapshots = [];
    for (const ev of eventsOf(composition)) {
      const row = listPlaces({ dated: true }).find((pl) => pl.id === String(ev.id));
      if (!row) return NextResponse.json({ error: "the event must be one the map knows" }, { status: 400 });
      eventSnapshots.push({ id: row.id, name: row.name, kind: row.kind, city: row.city, startsAt: row.startsAt || null, endsAt: row.endsAt || null, tz: row.tz || null, status: row.status, admission: row.admission || null, sourceUrl: row.sourceUrl || null, sample: !!row.sample });
    }
    let linkSnapshot = null;
    if (composition.link) {
      const url = safeExternalUrl(String(composition.link.url || composition.link));
      if (!url) return NextResponse.json({ error: "a link must be a public https address" }, { status: 400 });
      const snap = await fetchPreview(url);
      linkSnapshot = snap.refused ? { url, title: "", description: "", image: "", host: new URL(url).hostname.replace(/^www\./, ""), refused: snap.refused, fetchedAt: new Date().toISOString() } : snap;
    }
    // a MOTION resolves to ITS OWN admitted asset (slice 9): the row must be
    // the author's and ready; the facts stored are the worker's, never the body's
    let videoSnapshot = null;
    if (composition.video) {
      const asset = await getMotionAsset(String(composition.video.id || "")).catch(() => null);
      if (!asset || asset.ownerId !== user) return NextResponse.json({ error: "the video is not an upload of yours", code: "VIDEO_NOT_YOURS" }, { status: 400 });
      if (asset.state !== "ready") return NextResponse.json({ error: asset.state === "refused" ? `the video was refused: ${asset.refusalNote || asset.refusalCode}` : `the video is ${asset.state}, not admitted`, code: "VIDEO_NOT_READY" }, { status: 400 });
      videoSnapshot = motionForPost(asset, motionUrls(asset));
      composition.video = { ...composition.video, id: asset.id, state: asset.state, durationMs: asset.durationMs };
    }
    let attachments;
    try { attachments = attachmentsFor(composition, { pieceSnapshots, eventSnapshots, linkSnapshot, videoSnapshot }); }
    catch (e) { return NextResponse.json({ error: String(e.message).slice(0, 300) }, { status: 400 }); }
    compositionRow = { postKind: v.kind, layout: v.layout, attachments,
      imageUrl: attachments.media && attachments.media[0] ? postImageUrl(attachments.media[0].path) : videoSnapshot && videoSnapshot.poster ? videoSnapshot.poster : safeImageUrl(body.imageUrl),
      externalUrl: linkSnapshot ? linkSnapshot.url : safeExternalUrl(body.externalUrl),
      productRefs: pieceSnapshots.map((p) => p.id) };
  } else if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const quota = await consumeRateLimit({ scope: "editorial", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    // Same deterministic screen as profile rooms: a flag never blocks the
    // author's post from being SAVED — it parks it out of public view and
    // files a moderation task for a human.
    const flagged = screenStatement(text);
    const post = await createEditorialPost({
      authorId: user,
      authorHandle: await deriveAuthorHandle(user),
      kind: "user",
      moderationStatus: flagged.length ? "under_review" : "visible",
      title: body.title ? String(body.title).slice(0, 200) : null,
      body: text,
      excerpt: text.slice(0, 200),
      imageUrl: compositionRow ? compositionRow.imageUrl : safeImageUrl(body.imageUrl),
      externalUrl: compositionRow ? compositionRow.externalUrl : safeExternalUrl(body.externalUrl),
      ...(compositionRow ? { postKind: compositionRow.postKind, layout: compositionRow.layout, attachments: compositionRow.attachments } : {}),
      // Hashtags are extracted from the SANITIZED text (owner directive,
      // Aug 14: parse after the sanitizer, never before) and stored on the
      // row. A caller-supplied tags array still rides along — the two are
      // merged, deduped, and capped. Mentions are not stored: they render
      // as links from the text itself, and no consumer (notifications)
      // exists yet, so keeping a list of who someone talked about would be
      // collecting data nothing reads.
      tags: mergeTags(body.tags, extractRefs(text).hashtags),
      designerRefs: Array.isArray(body.designerRefs) ? body.designerRefs.slice(0, 12).map((v) => String(v).slice(0, 160)) : [],
      productRefs: compositionRow ? compositionRow.productRefs : (Array.isArray(body.productRefs) ? body.productRefs.slice(0, 24).map((v) => String(v).slice(0, 80)) : []),
    });
    if (flagged.length) {
      await createModerationTask({
        kind: "editorial-content", subjectType: "editorial_post", subjectId: String(post.id),
        payload: { flags: flagged, excerpt: text.slice(0, 160) }, priority: "high",
      });
    }
    return NextResponse.json({
      id: post.id, persistent: post.persistent,
      ...(compositionRow ? { postKind: compositionRow.postKind, layout: compositionRow.layout, attachments: compositionRow.attachments } : {}),
      ...(flagged.length
        ? { held: true, note: "your post is saved and paused for a human review" }
        : {}),
    });
  } catch {
    return NextResponse.json({ error: "post failed" }, { status: 500 });
  }
}

// The lifecycle verbs (owner directive, 14 Aug 2026, backlog 1).
// Both resolve the caller from proof, then let the database's WHERE
// author_id clause be the whole authorization story: a stranger's post and
// a missing post answer the same 404, so the API never confirms whose a
// transmission is. Edits pass the SAME sanitize + screen as a fresh post —
// a flagged edit parks the transmission under review instead of publishing
// it, and the author is told so in the same words POST uses.

export async function PATCH(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const rawId = String(body.id ?? "");
  if (!/^\d{1,18}$/.test(rawId)) return NextResponse.json({ error: "bad post id" }, { status: 400 });
  let text;
  try {
    text = sanitizeStatement(String(body.text || "").trim().slice(0, POST_MAX), POST_MAX);
  } catch {
    return NextResponse.json({ error: "text could not be sanitized" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  // Edits share the posting quota — rewriting the wire is writing to it.
  const quota = await consumeRateLimit({ scope: "editorial", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const flagged = screenStatement(text);
    const post = await updateEditorialPost({
      id: rawId, authorId: user,
      title: body.title ? String(body.title).slice(0, 200) : null,
      body: text, excerpt: text.slice(0, 200),
      // Re-extracted from the edited text: a tag the author removed must
      // stop being on the row, or the transmission would keep answering a
      // search for words it no longer contains.
      tags: mergeTags(body.tags, extractRefs(text).hashtags),
      moderationStatus: flagged.length ? "under_review" : "visible",
    });
    if (!post) return NextResponse.json({ error: "transmission not found" }, { status: 404 });
    if (flagged.length) {
      await createModerationTask({
        kind: "editorial-content", subjectType: "editorial_post", subjectId: String(post.id),
        payload: { flags: flagged, excerpt: text.slice(0, 160), edit: true }, priority: "high",
      });
    }
    return NextResponse.json({
      id: post.id, editedAt: post.editedAt ?? null,
      ...(flagged.length
        ? { held: true, note: "your edit is saved and paused for a human review" }
        : {}),
    });
  } catch {
    return NextResponse.json({ error: "edit failed" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const rawId = String(searchParams.get("id") || "");
  if (!/^\d{1,18}$/.test(rawId)) return NextResponse.json({ error: "bad post id" }, { status: 400 });
  const quota = await consumeRateLimit({ scope: "editorial", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const gone = await deleteEditorialPost({ id: rawId, authorId: user });
    if (!gone) return NextResponse.json({ error: "transmission not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id: rawId });
  } catch {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
