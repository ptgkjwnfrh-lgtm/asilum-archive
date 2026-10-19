// app/api/score/route.js — THE PASSENGER SCORE (V.2 Blueprint chapter 6;
// slice 7). The score lives on Account and Passport only (6.27).
//
// GET  ?subject=<uid>&role=buyer|seller   → the popup (6.18): score, verified
//        count, distribution, the published reviews with the role filter;
//        the private part (below-floor accrual, escalation) only to the subject
// POST { order, action: "review", stars, text }         the party reviews (double blind)
// POST { review, action: "revise", stars, text }
// POST { review, action: "respond", text }  /  { review, action: "unrespond" }
// POST { penalty, action: "appeal", evidence }

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { passengerScore, reviewsAbout, submitReview, reviseExisting, respond, removeResponse, movePenalty, getReview, ScoreRefused } from "../../../lib/db/production/score.js";
import { orderFacts } from "../../../lib/db/production/aftersale.js";

export const dynamic = "force-dynamic";

function refused(error) {
  if (error instanceof ScoreRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[score] failed", error?.message || error);
  return NextResponse.json({ error: "the score is unavailable", code: "SCORE_UNAVAILABLE" }, { status: 503 });
}

const publicReview = (r) => ({ id: r.id, role: r.role, stars: r.stars, text: r.text, at: r.publishedAt || r.submittedAt, revised: !!r.revisedAt, refunded: r.refunded, response: r.response });

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const subject = String(searchParams.get("subject") || "");
  if (!subject) return NextResponse.json({ error: "subject required" }, { status: 400 });
  const role = ["buyer", "seller"].includes(searchParams.get("role")) ? searchParams.get("role") : null;
  const viewer = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  try {
    const s = await passengerScore(subject, { role });
    const reviews = (await reviewsAbout(subject, { role })).map(publicReview);
    return NextResponse.json({ subject, ...s.public, reviews, surfaces: ["account", "passport"], ...(viewer === subject ? { private: s.private } : {}) });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "score-write", subject: user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    switch (body.action) {
      case "review": {
        const facts = await orderFacts(String(body.order || ""));
        if (!facts) return NextResponse.json({ error: "order not found", code: "ORDER_NOT_FOUND" }, { status: 404 });
        const seller = facts.sellerAccountId ? "sb-" + facts.sellerAccountId : null;
        const role = facts.buyerId === user ? "buyer" : seller === user ? "seller" : null;
        if (!role) return NextResponse.json({ error: "not your order", code: "NOT_A_PARTY" }, { status: 403 });
        const subject = role === "buyer" ? seller : facts.buyerId;
        if (!subject) return NextResponse.json({ error: "this order has no counterparty on ASILUM to review", code: "NO_COUNTERPARTY" }, { status: 409 });
        const out = await submitReview({ orderId: facts.order.id, reviewerId: user, subjectId: subject, role, stars: body.stars, text: body.text || "", order: { deliveredAt: facts.law.deliveredAt, verified: facts.paid, disputeOpen: facts.openIssues > 0 } });
        // double blind: the reviewer sees their own review, never the other side's
        return NextResponse.json({ review: publicReview(out.review), state: out.review.state, settled: out.settled }, { status: 201 });
      }
      case "revise":
        return NextResponse.json({ review: publicReview(await reviseExisting({ reviewId: String(body.review || ""), reviewerId: user, stars: body.stars, text: body.text || "" })) });
      case "respond":
        return NextResponse.json({ review: publicReview(await respond({ reviewId: String(body.review || ""), subjectId: user, text: body.text })) });
      case "unrespond":
        return NextResponse.json({ review: publicReview(await removeResponse({ reviewId: String(body.review || ""), subjectId: user })) });
      case "appeal":
        return NextResponse.json({ penalty: await movePenalty({ penaltyId: String(body.penalty || ""), action: "appeal", by: user, evidence: body.evidence }) });
      default:
        return NextResponse.json({ error: "review, revise, respond, unrespond or appeal", code: "UNKNOWN_ACTION" }, { status: 400 });
    }
  } catch (error) { return refused(error); }
  void getReview;
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
