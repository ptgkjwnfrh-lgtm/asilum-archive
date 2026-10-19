// app/api/moodboard/route.js
// The Mood Board as a database feeder. Every training action becomes a real
// mood_board_uploads record the future vision/AI layer can re-analyze.
//
// POST { user, kind: "upload"|"text", filenames?, prompt?, caption?, palette?, uploadId (required for uploads) }
//   upload → filename words + optional palette v0 swatches. The client sends
//            RAW {hex, weight} swatches only — canonical color names and
//            shared-TAGS weights are derived server-side (lib/vision/palette
//            paletteFromSwatches); client-supplied labels are never trusted.
//            Malformed palettes reject the whole request (400, atomic).
//            Record + USER_UPLOADED_IMAGE event persist in one transaction.
//   text   → manual tag entry (analyzed_by "manual")
// GET ?user= → the user's upload/training records.
// PATCH { user, id, caption } — the caption re-reads the upload: its tags
//       override a conflicting assumption and train the Passport (17.2)
// PATCH { user, id, removeTag, tagType } — a gathered tag is corrected away (17.3)
// DELETE ?user=&id= — the upload and its analysis leave; the taste edges it
//       alone supported are recalculated, anchors and shared evidence kept (17.4)
// Identity: resolveRequestUser proof (device cookie / bearer), per PR #12.

import { NextResponse } from "next/server";
import { inferTags } from "../../../lib/ingest/sources.js";
import {
  createMoodBoardUpload, createMoodBoardUploadWithEvent, listMoodBoardUploads,
} from "../../../lib/db/production.js";
import { paletteFromSwatches } from "../../../lib/vision/palette.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { consentState, observationAllowed } from "../../../lib/consent.js";
import { EVENTS, buildEvent } from "../../../lib/events/index.js";
import { analyzeMoodBoardItem } from "../../../lib/ai/moodBoardAnalyzer.js";
import { rebuildUserStyleProfile } from "../../../lib/ai/styleProfile.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { findImageCollisions } from "../../../lib/db/imageFingerprints.js";
import { getDiscoverablePool, publicProduct } from "../../../lib/products.js";
import { updateMoodBoardUpload, deleteMoodBoardUpload } from "../../../lib/db/production/editorial.js";
import { mutateProfile } from "../../../lib/db/index.js";
import { migrateProfile } from "../../../lib/brain/index.js";
import { captionOverride, evidenceOf, evidenceAfterDeletion } from "../../../lib/passport/evidence.js";

export const dynamic = "force-dynamic";

function tagRows(vec, tagType) {
  return Object.entries(vec.long || vec)
    .filter(([, v]) => typeof v === "number" && v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag, v]) => ({ tag: tag.toLowerCase(), tag_type: tagType, confidence: Math.min(1, Math.round(v * 100) / 100) }));
}

export async function POST(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  // D4: uploads train deliberately — an EXPLICIT act; unanswered stays
  // fully unobserved.
  if (!observationAllowed(consentState(req), "explicit")) {
    return NextResponse.json({
      observed: false,
      reason: "the first-visit question is unanswered — the terminal does not learn yet",
    });
  }
  const quota = await consumeRateLimit({ scope: "moodboard", subject: user, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const kind = body.kind === "upload" ? "upload" : "text";

  let text = "";
  let idemKey = null;
  if (kind === "upload") {
    // filenames: must be a real array of bounded strings — malformed shapes
    // are a 400, never a throw (Codex re-review of #13).
    if (!Array.isArray(body.filenames) || body.filenames.length < 1 || body.filenames.length > 24) {
      return NextResponse.json({ error: "filenames must be an array of 1-24 strings" }, { status: 400 });
    }
    const names = [];
    for (const n of body.filenames) {
      if (typeof n !== "string" || !n.trim() || n.length > 200) {
        return NextResponse.json({ error: "each filename must be a non-empty string ≤ 200 chars" }, { status: 400 });
      }
      names.push(n.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " "));
    }
    text = names.join(" ");
    // Client-generated idempotency key, REQUIRED for uploads (Codex #13
    // follow-up): a retry after a lost response returns the ORIGINAL stored
    // record instead of writing a duplicate upload + event.
    if (typeof body.uploadId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.uploadId)) {
      return NextResponse.json({ error: "uploadId required (8-64 chars, [A-Za-z0-9-])" }, { status: 400 });
    }
    idemKey = body.uploadId;
  } else {
    text = String(body.prompt || "").slice(0, 400);
    if (!text.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // Server-side palette derivation from untrusted {hex, weight} swatches.
  // A supplied-but-invalid palette is an atomic reject — no silent salvage.
  // An EMPTY array is legitimate (client read no pixels) → filename fallback.
  let derived = null;
  if (kind === "upload" && body.palette !== undefined) {
    if (!Array.isArray(body.palette)) {
      return NextResponse.json({ error: "invalid palette payload" }, { status: 400 });
    }
    if (body.palette.length) {
      derived = paletteFromSwatches(body.palette);
      if (!derived) return NextResponse.json({ error: "invalid palette payload" }, { status: 400 });
    }
  }
  const palette = derived ? derived.palette : [];
  const paletteTags = derived
    ? Object.entries(derived.tags).map(([t, w]) => ({ tag: t.toLowerCase(), tag_type: "palette", confidence: w }))
    : [];

  try {
    const vec = inferTags(text);
    const row = {
      userId: user,
      caption: body.caption || (kind === "text" ? text : null),
      source: kind === "upload" ? "image-upload" : "train-text",
      colors: palette,
      tags: [...tagRows(vec, kind === "text" ? "personalization" : "aesthetic"), ...paletteTags],
      styleNotes: kind === "upload"
        ? (palette.length
            ? `palette v0: ${palette.map((s) => `${s.name}(${s.weight})`).join(" ")}; filename words: ${text.slice(0, 160)}`
            : `filename words: ${text.slice(0, 200)}`)
        : null,
      analyzedBy: kind === "upload" ? (palette.length ? "palette-v0" : "filename") : "manual",
    };
    // Uploads persist the record and its canonical event in one transaction —
    // a failed write leaves neither behind, so client retries can't
    // double-count USER_UPLOADED_IMAGE.
    const rec = kind === "upload"
      ? await createMoodBoardUploadWithEvent(row, buildEvent(user, EVENTS.USER_UPLOADED_IMAGE, {
          files: body.filenames.length,
          analyzedBy: row.analyzedBy,
          palette: palette.map((s) => s.name),
          uploadId: idemKey,
        }), idemKey)
      : await createMoodBoardUpload(row);

    // Feed the intelligence layer: analyze (local rules today, model when
    // enabled) and refresh the style profile. Derived data — a failure here
    // must never fail the upload, and duplicates are not re-analyzed.
    let analysis = null;
    if (kind === "upload" && rec.duplicate !== true) {
      const a = await analyzeMoodBoardItem(rec, { userId: user, allowExternalAi: body.aiConsent === true });
      if (a.ok) analysis = { source: a.source, summary: a.analysis.summary, confidence: a.analysis.confidenceScore };
      rebuildUserStyleProfile(user).catch(() => {});
    }
    // RECOGNITION. Nobody asked for this and nothing in the interface offers
    // it — see docs/INVISIBLE-MACHINERY.md. If a stamp IS a photograph the
    // archive already holds, the passport says so; otherwise it says nothing
    // at all. There is no "no match found", because a person who did not ask
    // a question is not owed a negative answer.
    //
    // The client sends 16-character hashes, never the pictures. Matching is a
    // pixel computation over evidence we hold, which is why it is allowed to
    // speak plainly under ASTERISK's first law — and why it goes quiet the
    // moment it is merely probable.
    const recognized = await recognizeStamps(body.stamps);

    return NextResponse.json({
      id: rec.id, persistent: rec.persistent, tags: rec.tags, palette,
      duplicate: rec.duplicate === true, analysis,
      ...(recognized.length ? { recognized } : {}),
    });
  } catch {
    return NextResponse.json({ error: "moodboard record failed" }, { status: 500 });
  }
}

/**
 * Pieces the archive already holds a photograph of, for the stamps just
 * uploaded.
 *
 * ONLY EXACT PHOTOGRAPH MATCHES. `findImageCollisions` defaults to the
 * "same photo" hamming threshold, and that tightness is the feature: a
 * recognition that is sometimes wrong is not magic, it is a bug with good
 * lighting. A different photograph of the same garment will not match, and
 * that is correct — we go silent rather than guess.
 *
 * Never throws and never explains itself. A failure here leaves the upload
 * untouched and the passport quiet.
 */
async function recognizeStamps(stamps) {
  if (!Array.isArray(stamps) || !stamps.length) return [];
  const clean = stamps
    .filter((h) => typeof h === "string" && /^[0-9a-f]{16}$/i.test(h))
    .slice(0, 6);
  if (!clean.length) return [];
  try {
    const seen = new Set();
    const ids = [];
    for (const dhash of clean) {
      for (const hit of await findImageCollisions(dhash)) {
        if (!seen.has(hit.itemId)) { seen.add(hit.itemId); ids.push(hit.itemId); }
      }
    }
    if (!ids.length) return [];
    const pool = await getDiscoverablePool();
    return ids
      .map((id) => pool.find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 4)
      .map(publicProduct)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "moodboard-read", subject: user, limit: 60, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    return NextResponse.json({ uploads: await listMoodBoardUploads(user) });
  } catch {
    return NextResponse.json({ error: "moodboard history unavailable" }, { status: 503 });
  }
}


export async function PATCH(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "moodboard-edit", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const id = body.id;
  const mine = (await listMoodBoardUploads(user)).find((u) => String(u.id) === String(id));
  if (!mine) return NextResponse.json({ error: "no such upload of yours" }, { status: 404 });
  try {
    if (body.removeTag) {
      const tag = String(body.removeTag).toLowerCase(), type = body.tagType ? String(body.tagType) : null;
      const tags = (mine.tags || []).filter((t) => !(String(t.tag).toLowerCase() === tag && (!type || t.tag_type === type)));
      const upload = await updateMoodBoardUpload({ id, userId: user, tags });
      return NextResponse.json({ upload, removed: tag });
    }
    if (typeof body.caption === "string") {
      const caption = body.caption.trim().slice(0, 400);
      // the caption's own reading (the same reader the upload had), laid over the assumptions
      const vec = caption ? inferTags(caption) : {};
      const captionTags = {};
      for (const [t, w] of Object.entries(vec.long || vec)) if (typeof w === "number" && w > 0.05) captionTags[t] = Math.min(1, Math.round(w * 100) / 100);
      const tags = captionOverride(mine.tags || [], captionTags);
      const upload = await updateMoodBoardUpload({ id, userId: user, caption: caption || null, tags });
      // captions are taste evidence: the caption's tags enter the long vector (never past what they say)
      if (Object.keys(captionTags).length) {
        await mutateProfile(user, (current) => {
          const next = migrateProfile(current);
          for (const [t, w] of Object.entries(captionTags)) next.long[t] = Math.max(next.long[t] || 0, Math.min(1, w));
          return next;
        });
      }
      return NextResponse.json({ upload, captionTags });
    }
    return NextResponse.json({ error: "caption or removeTag" }, { status: 400 });
  } catch (error) {
    console.error("[moodboard] edit failed", error?.message || error);
    return NextResponse.json({ error: "the upload could not be edited" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const id = searchParams.get("id");
  const all = await listMoodBoardUploads(user);
  const mine = all.find((u) => String(u.id) === String(id));
  if (!mine) return NextResponse.json({ error: "no such upload of yours" }, { status: 404 });
  try {
    const gone = evidenceOf(mine.tags);
    const others = all.filter((u) => String(u.id) !== String(id)).map((u) => evidenceOf(u.tags));
    await deleteMoodBoardUpload({ id, userId: user });
    let recalculated = [];
    await mutateProfile(user, (current) => {
      const next = migrateProfile(current);
      const r = evidenceAfterDeletion({ long: next.long, manual: (next._meta && next._meta.manual) || {} }, gone, others);
      next.long = r.long; recalculated = r.recalculated;
      return next;
    });
    return NextResponse.json({ deleted: true, recalculated });
  } catch (error) {
    console.error("[moodboard] delete failed", error?.message || error);
    return NextResponse.json({ error: "the upload could not be deleted" }, { status: 500 });
  }
}
