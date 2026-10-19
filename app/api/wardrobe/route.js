// app/api/wardrobe/route.js — the ownership surface (Feature C, Phase 3a).
// GET    ?user=&status=active|retired|all → your wardrobe (private, always).
// POST   { source: manual|catalog|ticket, ... }  → add a piece you OWN.
//        manual: title (+brand/category/sizeLabel); catalog: itemId;
//        ticket: ticketId whose outcome you reported as "bought"
//        (idempotent — one wardrobe row per ticket).
// PATCH  { id, status: active|retired } → retire/restore.
// DELETE { id } → remove the record entirely.
// Bag and favorites never create rows here — ownership is explicit.

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { addWardrobeItem, listWardrobe, wardrobeEnabled } from "../../../lib/wardrobe/index.js";
import { uploadsAvailable, signedPhotoUrl, deleteWardrobePhoto, PHOTO_CONSENT_VERSION } from "../../../lib/wardrobe/photos.js";
import {
  setWardrobeItemStatus, deleteWardrobeItem, getWardrobeItem, withUserOperationLock,
} from "../../../lib/db/production.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../lib/security/json.js";

export const dynamic = "force-dynamic";

function disabled() {
  return NextResponse.json({ error: "wardrobe is not enabled on this deployment" }, { status: 503 });
}

async function identity(req, claimed) {
  return resolveRequestUser(req, String(claimed || ""));
}

export async function GET(req) {
  if (!wardrobeEnabled()) return disabled();
  const { searchParams } = new URL(req.url);
  // V.2 13.2–13.4 (slice 11): the pieces a passenger is willing to sell, by handle —
  // title and photo only, to a signed-in viewer, so an offer can start from a message
  if (searchParams.get("handle") && searchParams.get("offerable") === "1") {
    const viewer = await identity(req, searchParams.get("user"));
    if (!viewer) return NextResponse.json({ error: "authentication required" }, { status: 401 });
    const { getProfileRoomByHandle } = await import("../../../lib/db/production.js");
    const room = await getProfileRoomByHandle(String(searchParams.get("handle") || "").toLowerCase()).catch(() => null);
    const ownerId = room && room.account_id ? "sb-" + room.account_id : null;
    if (!ownerId) return NextResponse.json({ handle: searchParams.get("handle"), items: [] });
    const items = (await listWardrobe(ownerId, { status: "active" })).filter((it) => it.acceptOffers === true || it.accept_offers === true);
    const withPhotos = await Promise.all(items.map(async (item) => ({ id: item.id, title: item.title, category: item.category || null, photoUrl: item.photoPath ? await signedPhotoUrl(item.photoPath).catch(() => null) : null })));
    return NextResponse.json({ handle: room.handle, ownerId, items: withPhotos }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  const user = await identity(req, searchParams.get("user"));
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const status = ["active", "retired", "all"].includes(searchParams.get("status"))
    ? searchParams.get("status") : "active";
  const items = await listWardrobe(user, { status });
  // Signed, short-lived URLs — the bucket is private; nothing else can read it.
  const gate = uploadsAvailable();
  const withPhotos = await Promise.all(items.map(async (item) => item.photoPath
    ? { ...item, photoUrl: await signedPhotoUrl(item.photoPath).catch(() => null) }
    : item));
  return NextResponse.json({
    user, status, count: items.length, items: withPhotos,
    uploads: gate.available
      ? { available: true, consentVersion: PHOTO_CONSENT_VERSION }
      : { available: false, reason: gate.reason },
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(req) {
  if (!wardrobeEnabled()) return disabled();
  const parsed = await readJsonRequest(req, { maxBytes: 16 * 1024 });
  if (parsed.response) return parsed.response;
  const user = await identity(req, parsed.body.user);
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-write", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const r = await addWardrobeItem(user, parsed.body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ item: r.item, duplicate: r.duplicate }, { status: r.duplicate ? 200 : 201 });
}

export async function PATCH(req) {
  if (!wardrobeEnabled()) return disabled();
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const user = await identity(req, parsed.body.user);
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-write", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const status = String(parsed.body.status || "");
  if (!["active", "retired"].includes(status)) {
    return NextResponse.json({ error: "status must be active or retired" }, { status: 400 });
  }
  const item = await setWardrobeItemStatus(user, String(parsed.body.id || ""), status);
  if (!item) return NextResponse.json({ error: "wardrobe item not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(req) {
  if (!wardrobeEnabled()) return disabled();
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const user = await identity(req, parsed.body.user);
  if (!user) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-write", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  return withUserOperationLock(user, async (queryTarget) => {
    const target = await getWardrobeItem(user, String(parsed.body.id || ""), queryTarget);
    if (!target) return NextResponse.json({ error: "wardrobe item not found" }, { status: 404 });
    if (target.photoPath) {
      let removed = false;
      try { removed = await deleteWardrobePhoto(target.photoPath); } catch {}
      if (!removed) return NextResponse.json({ error: "photo could not be erased" }, { status: 502 });
    }
    const deleted = await deleteWardrobeItem(user, target.id, {
      expectedPhotoPath: target.photoPath,
      queryTarget,
    });
    if (!deleted) return NextResponse.json({ error: "wardrobe item changed; retry removal" }, { status: 409 });
    return NextResponse.json({ deleted: true });
  });
}
