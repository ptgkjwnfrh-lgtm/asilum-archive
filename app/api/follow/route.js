// app/api/follow/route.js
// POST /api/follow { user, boardId, follow: true|false }
//   Following a moodboard makes its taste a standing influence on your feed —
//   the "following" jump-start for users who don't connect a buyer history.
//   Followed board ids live on the profile (_meta.follows); the feed route
//   blends their vectors into the taste vector.
// POST /api/follow { user, kind: "brand"|"user", target, follow: true|false }
//   Brand/user follows graduated from localStorage to user_follows (v14,
//   ADR-001) so the memory surface and future devices see one list. The
//   client keeps localStorage as its instant read model and dual-writes here.

import { NextResponse } from "next/server";
import { migrateProfile } from "../../../lib/brain/index.js";
import { getBoard, mutateProfile } from "../../../lib/db/index.js";
import { setFollow, MEMORY_FOLLOW_KINDS, friendsOf } from "../../../lib/db/production.js";
import { resolveRequestUser } from "../../../lib/identity.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { withPrivateCache } from "../../../lib/security/json.js";

export const dynamic = "force-dynamic";

// GET /api/follow?friends=1&user=  → { handle, friends } — the viewer's own
// friends (mutual follows), relative to them and shown to nobody else; a
// block on either side removes the mark (Foundations, the friend asterisk).
async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("friends") !== "1") return NextResponse.json({ error: "friends=1" }, { status: 400 });
  const userId = await resolveRequestUser(req, searchParams.get("user") || "");
  if (!userId) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "friends-read", subject: userId, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const out = await friendsOf(userId);
  if (out.friends.length) {
    try {
      const { blockedBetween } = await import("../../../lib/db/production/identity.js");
      const { getProfileRoomByHandle } = await import("../../../lib/db/production.js");
      const kept = [];
      for (const h of out.friends) {
        const room = await getProfileRoomByHandle(h).catch(() => null);
        const theirId = room && room.account_id ? "sb-" + room.account_id : null;
        if (!theirId || !(await blockedBetween(userId, theirId))) kept.push(h);
      }
      out.friends = kept;
    } catch { /* blocks are the mail desk's; without it every mutual follow stands */ }
  }
  return NextResponse.json(out);
}

const FOLLOW_CAP = 10;

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 16 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const userId = await resolveRequestUser(req, body.user || "");
  if (!userId) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const boardId = typeof body.boardId === "string" ? body.boardId.slice(0, 80) : "";
  const follow = body.follow !== false;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (!boardId && !kind) return NextResponse.json({ error: "boardId or kind required" }, { status: 400 });
  const quota = await consumeRateLimit({ scope: "follow", subject: userId, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });

  // brand/user follows: server-side list (v14), separate from board follows
  if (kind) {
    if (!MEMORY_FOLLOW_KINDS.has(kind)) {
      return NextResponse.json({ error: "kind must be brand or user" }, { status: 400 });
    }
    const target = typeof body.target === "string" ? body.target.trim().slice(0, 120) : "";
    if (!target) return NextResponse.json({ error: "target required" }, { status: 400 });
    const r = await setFollow(userId, kind, target, follow);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ userId, kind, target, following: follow });
  }
  if (follow) {
    const board = await getBoard(boardId);
    if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });
  }

  let follows = [];
  await mutateProfile(userId, (current) => {
    const profile = migrateProfile(current);
    const cur = profile._meta.follows || [];
    profile._meta.follows = follow
      ? [boardId, ...cur.filter((id) => id !== boardId)].slice(0, FOLLOW_CAP)
      : cur.filter((id) => id !== boardId);
    follows = profile._meta.follows;
    return profile;
  });

  return NextResponse.json({ userId, follows });
}

// Personal data: never shared-cacheable (see withPrivateCache).
export const POST = withPrivateCache(handlePOST);
export const GET = withPrivateCache(handleGET);
