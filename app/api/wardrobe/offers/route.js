// app/api/wardrobe/offers/route.js — WARDROBE PRIVATE SALES (V.2 chapter 13;
// slice 11). DM first: an offer is taken only with the conversation it came
// from (13.4) — the route verifies the two passengers share it on the mail
// desk; where the desk is not open (memory mode, messaging off) the offer is
// refused with that reason, never faked.
//
// GET  ?user=                   → my offers (as buyer and as owner), each with its state now
// POST { user, action: "offer", itemId, amountCents, conversationId }       (the buyer)
// POST { user, action: "respond", id, decision: "accept"|"decline" }         (the owner)
// POST { user, action: "accept_offers", itemId, on: true|false }             (the owner's toggle, 13.3)
// POST { user, action: "checkout", id }                                      (the buyer, inside the 24 hours → { url })
// POST { user, action: "cancel_sale", id }                                   (the owner, before handoff, 13.14)

import { NextResponse } from "next/server";
import { resolveRequestUser, accountIdFromIdentity } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { gate } from "../../../../lib/identity/gate.js";
import { getPool, hasRelation } from "../../../../lib/db/core/pool.js";
import { listWardrobeOffers, openWardrobeOffer, respondWardrobeOffer, setAcceptOffers, startWardrobeCheckout, cancelWardrobeSale, wardrobePiece, MoneyRefused } from "../../../../lib/db/production/money.js";
import { offerStateAt, exclusiveFor } from "../../../../lib/wardrobe/offers.js";

export const dynamic = "force-dynamic";

function refused(error) {
  if (error instanceof MoneyRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[wardrobe offers] failed", error?.message || error);
  return NextResponse.json({ error: "Wardrobe offers are unavailable", code: "OFFERS_UNAVAILABLE" }, { status: 503 });
}

/** 13.4: the conversation is real and both passengers are in it. Null when the desk is not open here. */
async function sharedConversation(conversationId, a, b) {
  const p = await getPool();
  if (!p || !(await hasRelation(p, "dm_conversations"))) return { ok: false, reason: "an offer starts with a message to the owner — the mail desk is not open on this deployment" };
  const x = accountIdFromIdentity(a), y = accountIdFromIdentity(b);
  if (!x || !y) return { ok: false, reason: "an offer runs between two signed-in passengers" };
  const { rows } = await p.query("SELECT 1 FROM dm_conversations WHERE id=$1::uuid AND lo_account_id=LEAST($2::uuid,$3::uuid) AND hi_account_id=GREATEST($2::uuid,$3::uuid)", [String(conversationId || ""), x, y]).catch(() => ({ rows: [] }));
  return rows.length ? { ok: true } : { ok: false, reason: "no conversation between you and the owner carries this offer — send a message first (13.4)" };
}

const withState = (o, now) => ({ ...o, stateNow: offerStateAt(o, now), exclusiveUntil: offerStateAt(o, now) === "accepted" ? o.acceptedUntil : null });

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-offers-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const now = Date.now();
    const [asBuyer, asOwner] = await Promise.all([listWardrobeOffers({ buyerId: user }), listWardrobeOffers({ ownerId: user })]);
    return NextResponse.json({ asBuyer: asBuyer.map((o) => withState(o, now)), asOwner: asOwner.map((o) => withState(o, now)), law: { dmFirst: true, exclusiveHours: 24, cooldownDays: 14, oneActivePerPiece: true } });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "wardrobe-offers-write", subject: user, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    switch (body.action) {
      case "accept_offers":
        return NextResponse.json(await setAcceptOffers({ ownerId: user, itemId: String(body.itemId || ""), on: body.on !== false }));
      case "offer": {
        const g = await gate(req, String(body.user || ""), { needs: ["age"] }); // Terms 2.2: 18+ buys
        if (!g.ok) return NextResponse.json(g.body, { status: g.status });
        const piece = await wardrobePiece(String(body.itemId || ""));
        if (!piece) return NextResponse.json({ error: "no such piece", code: "NOT_FOUND" }, { status: 404 });
        const conv = await sharedConversation(body.conversationId, user, piece.ownerId);
        if (!conv.ok) return NextResponse.json({ error: conv.reason, code: "DM_FIRST" }, { status: 409 });
        const offer = await openWardrobeOffer({ itemId: piece.id, buyerId: user, amountCents: Number(body.amountCents), conversationId: String(body.conversationId), viaMessage: true });
        return NextResponse.json({ offer: withState(offer, Date.now()) }, { status: 201 });
      }
      case "respond":
        return NextResponse.json({ offer: withState(await respondWardrobeOffer({ offerId: String(body.id || ""), ownerId: user, decision: body.decision }), Date.now()) });
      case "checkout": {
        const g = await gate(req, String(body.user || ""), { needs: ["age"] });
        if (!g.ok) return NextResponse.json(g.body, { status: g.status });
        const origin = new URL(req.url).origin;
        const r = await startWardrobeCheckout({ offerId: String(body.id || ""), buyerId: user, origin: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin) ? origin : null });
        return NextResponse.json(r, { status: 202 });
      }
      case "cancel_sale":
        return NextResponse.json(await cancelWardrobeSale({ offerId: String(body.id || ""), ownerId: user }));
      default:
        return NextResponse.json({ error: "offer, respond, accept_offers, checkout or cancel_sale", code: "UNKNOWN_ACTION" }, { status: 400 });
    }
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
export { exclusiveFor };
