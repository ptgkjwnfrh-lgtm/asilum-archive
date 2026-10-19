// app/api/editorial/media/route.js — the Wire's image upload (V.2 brief §6
// "Add media"). POST multipart/form-data: user, photo (client-re-encoded
// JPEG ≤ 2 MB — the browser redrew it to a canvas, so EXIF and GPS never
// left the device), alt? → { path, url }. DELETE { user, path } — an author
// discarding a draft image removes the object. Gated by WIRE_UPLOADS_ENABLED
// + configured storage (lib/posts/media.js); a signed-in ACCOUNT is required
// to upload, the same rule as posting. No analysis of any kind runs here.
import { NextResponse } from "next/server";
import { accountIdFromIdentity, resolveRequestUser } from "../../../../lib/identity.js";
import { postUploadsAvailable, storePostImage, deletePostImage, postImageUrl, safePostPath, WIRE_IMAGE_MAX_BYTES } from "../../../../lib/posts/media.js";
import { looksLikeJpeg } from "../../../../lib/wardrobe/photos.js";
import { PHOTO_REQUEST_MAX_BYTES } from "../../../../lib/wardrobe/photo-contract.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { readMultipartRequest } from "../../../../lib/security/multipart.js";
import { readJsonRequest } from "../../../../lib/security/json.js";

export const dynamic = "force-dynamic";

/** The gate, for the composer's ADD MEDIA — the same sentence the POST gives. */
export async function GET() {
  return NextResponse.json(postUploadsAvailable());
}

export async function POST(req) {
  const parsed = await readMultipartRequest(req, { maxBytes: PHOTO_REQUEST_MAX_BYTES });
  if (parsed.response) return parsed.response;
  const form = parsed.form;
  const user = await resolveRequestUser(req, String(form.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (!accountIdFromIdentity(user)) return NextResponse.json({ error: "images ride on a signed-in account" }, { status: 403 });
  const gate = postUploadsAvailable();
  if (!gate.available) return NextResponse.json({ error: gate.reason }, { status: 503 });
  const quota = await consumeRateLimit({ scope: "wire-media", subject: user, limit: 40, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const photo = form.get("photo");
  if (!photo || typeof photo.arrayBuffer !== "function") return NextResponse.json({ error: "image file required" }, { status: 400 });
  if (!photo.size || photo.size > WIRE_IMAGE_MAX_BYTES) return NextResponse.json({ error: "image exceeds 2MB — the composer downsizes first" }, { status: 400 });
  let bytes;
  try { bytes = new Uint8Array(await photo.arrayBuffer()); } catch { return NextResponse.json({ error: "image could not be read" }, { status: 400 }); }
  if (!looksLikeJpeg(bytes)) return NextResponse.json({ error: "image must be a client-re-encoded JPEG" }, { status: 400 });
  try {
    const path = await storePostImage(user, bytes);
    return NextResponse.json({ path, url: postImageUrl(path) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 });
  }
}

export async function DELETE(req) {
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const user = await resolveRequestUser(req, String(parsed.body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  let path;
  try { path = safePostPath(parsed.body.path); } catch { return NextResponse.json({ error: "invalid path" }, { status: 400 }); }
  // an author may remove only their own objects: the path's first segment is the uploader
  if (!path.startsWith(user + "/")) return NextResponse.json({ error: "not your image" }, { status: 403 });
  const gate = postUploadsAvailable();
  if (!gate.available) return NextResponse.json({ error: gate.reason }, { status: 503 });
  const ok = await deletePostImage(path).catch(() => false);
  return NextResponse.json({ removed: ok });
}
