// app/api/brdcst/route.js — BRDCST OUTREACH AND BILLING, the broadcaster's
// side (V.2 Blueprint chapter 5, 5.13–5.28, Terms 15; slice 8). The admin
// interrupts and reviews through /api/admin (brdcst.*).
//
// GET  ?quote=1&radiusMi=&tasteBreadth=&durationDays=&eventId=&tags=
//                         → the itemized live quote (5.19) and the forecast
//                           (5.18): a REAL audience count, a range around it,
//                           and the note that results vary. Public: pricing
//                           is not a secret.
// GET  ?ticker=1&user=&lat=&lng=  → the ad ticker's SPONSORED entries for this
//                           viewer: live campaigns in reach (public, viewer-aware)
// GET  ?user=              → my campaigns (state at now, usage, what I may do)
//                           and my bonus bank (days, miles)
// POST { user, action: "create", eventIds: [...], postId?, tags?, radiusMi, tasteBreadth, durationDays, scheduledStart? }
// POST { user, action: "attach", id, postId }        — name the published post
// POST { user, action: "pay", id, creditCents?, bonusAs?, useBonusDays?, useBonusMiles? }
//        credit first in the exact amount chosen (never automatic), banked
//        bonus days or miles, the remainder by card through the order engine
//        (a checkout URL comes back). Without a provider: 503 and the
//        campaign waits in Drafts.
// POST { user, action: "cancel", id, reason: "voluntary"|"event_cancelled", refundTo: "credit"|"original", bonusAs? }
// POST { user, action: "mute", id, muted }
// POST { user, action: "settle", id }                — re-read the card order (the success page calls it)

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { requestSubject } from "../../../lib/security/request.js";
import { gate } from "../../../lib/identity/gate.js";
import { listPlaces } from "../../../lib/places/registry.js";
import { reconcileOrder } from "../../../lib/orders.js";
import { getOrder } from "../../../lib/db/orders.js";
import {
  createCampaign, attachPost, payCampaign, payQuote, cancelCampaign, muteReminders, settleCampaignOrder, listCampaigns, getCampaign, bonusBank, estimateAudience, tickerFor, BrdcstRefused,
} from "../../../lib/db/production/brdcst.js";
import { quote, usage, stateAt, eventLive, BASE_RADIUS_MI, MAX_RADIUS_MI, DURATIONS, PRICE, REFUND_BONUS } from "../../../lib/brdcst/index.js";
import { stripeConfigured } from "../../../lib/payments/stripe.js";

export const dynamic = "force-dynamic";
const LAW = Object.freeze({ baseRadiusMi: BASE_RADIUS_MI, maxRadiusMi: MAX_RADIUS_MI, durations: DURATIONS, price: PRICE, refundBonus: REFUND_BONUS, billing: "per day — any day with an active BRDCST counts in full", refund: "completely unused days; credit first with the bonus, the original method after declining" });

function refused(error) {
  if (error instanceof BrdcstRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[brdcst] failed", error?.message || error);
  return NextResponse.json({ error: "BRDCST is unavailable", code: "BRDCST_UNAVAILABLE" }, { status: 503 });
}

function eventRows(ids) {
  const dated = listPlaces({ dated: true });
  return (ids || []).map((id) => dated.find((p) => p.id === String(id)) || null);
}

function publicCampaign(c, now = Date.now()) {
  const state = stateAt(c, now);
  const u = usage(c, now);
  return {
    ...c, state, usage: u,
    can: {
      pay: !c.paidAt && !["cancelled", "under_review"].includes(c.state),
      cancel: !["cancelled", "under_review", "ended"].includes(state),
      mute: !!c.paymentFailedAt && !c.paidAt,
    },
  };
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const q = (k) => searchParams.get(k);
  if (q("quote") === "1") {
    const quota = await consumeRateLimit({ scope: "brdcst-quote", subject: requestSubject(req), limit: 120, windowMs: 60_000 });
    if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
    // the quote reads the raw figures so a bad duration answers ok:false with the law's sentence
    const qt = quote({ radiusMi: q("radiusMi") ?? BASE_RADIUS_MI, tasteBreadth: q("tasteBreadth") ?? 0, durationDays: q("durationDays") ?? 7 });
    const t = qt.targeting;
    const ev = q("eventId") ? eventRows([q("eventId")])[0] : null;
    const center = ev && Number.isFinite(ev.lat) ? { lat: ev.lat, lng: ev.lng, label: ev.city || null } : null;
    const tags = String(q("tags") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    try {
      const forecast = await estimateAudience({ tags, radiusMi: t.radiusMi, tasteBreadth: t.tasteBreadth, center, durationDays: t.durationDays });
      return NextResponse.json({ quote: qt, forecast, event: ev ? { id: ev.id, name: ev.name, sample: !!ev.sample, city: ev.city, live: eventLive(ev) } : null, law: LAW, payment: stripeConfigured() ? "card and credit" : "credit only — no card provider is configured" });
    } catch (error) { return refused(error); }
  }
  if (q("ticker") === "1") {
    const viewerId = await resolveRequestUser(req, String(q("user") || "")).catch(() => null);
    try { return NextResponse.json({ placements: await tickerFor({ viewerId, lat: q("lat"), lng: q("lng") }) }); }
    catch (error) { return refused(error); }
  }
  const user = await resolveRequestUser(req, String(q("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "brdcst-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const now = Date.now();
    const campaigns = (await listCampaigns({ ownerId: user, limit: 100 })).map((c) => publicCampaign(c, now));
    const bank = await bonusBank(user);
    return NextResponse.json({ campaigns, bonus: { days: bank.days, miles: bank.miles }, law: LAW, payment: stripeConfigured() ? "card and credit" : "credit only — no card provider is configured" });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "brdcst-write", subject: user, limit: 30, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const id = String(body.id || "");
  try {
    switch (body.action) {
      case "create": {
        { const g = await gate(req, String(body.user || ""), { needs: ["age"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); } // Terms 2.2: 18+ runs a BRDCST
        const ids = Array.isArray(body.eventIds) ? body.eventIds.map(String).slice(0, 20) : body.eventId ? [String(body.eventId)] : [];
        const rows = eventRows(ids);
        if (!ids.length || rows.some((r) => !r)) return NextResponse.json({ error: "every event must be one the map knows", code: "NO_EVENT" }, { status: 400 });
        const c = await createCampaign({ ownerId: user, postId: body.postId == null ? null : String(body.postId), events: rows, tags: Array.isArray(body.tags) ? body.tags : [], radiusMi: body.radiusMi, tasteBreadth: body.tasteBreadth, durationDays: body.durationDays, scheduledStart: body.scheduledStart || null });
        return NextResponse.json({ campaign: publicCampaign(c) }, { status: 201 });
      }
      case "attach":
        return NextResponse.json({ campaign: publicCampaign(await attachPost({ campaignId: id, ownerId: user, postId: String(body.postId || "") })) });
      case "pay": {
        { const g = await gate(req, String(body.user || ""), { needs: ["age"] }); if (!g.ok) return NextResponse.json(g.body, { status: g.status }); }
        const origin = new URL(req.url).origin;
        const r = await payCampaign({ campaignId: id, ownerId: user, creditCents: Number(body.creditCents) || 0, bonusAs: body.bonusAs === "miles" ? "miles" : "days", useBonusDays: Number(body.useBonusDays) || 0, useBonusMiles: Number(body.useBonusMiles) || 0, origin: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin) ? origin : null });
        return NextResponse.json({ ...r, campaign: publicCampaign(r.campaign) }, { status: r.paid ? 200 : 202 });
      }
      case "preview": {
        const c = await getCampaign(id);
        if (!c || c.ownerId !== user) return NextResponse.json({ error: "not your campaign", code: "NOT_YOURS" }, { status: 403 });
        const pq = payQuote(c, { bonusDays: Number(body.useBonusDays) || 0, bonusMiles: Number(body.useBonusMiles) || 0 });
        return NextResponse.json(pq, { status: pq.ok ? 200 : 409 });
      }
      case "cancel":
        return NextResponse.json(await cancelCampaign({ campaignId: id, by: user, reason: body.reason || "voluntary", refundTo: body.refundTo === "original" ? "original" : "credit", bonusAs: body.bonusAs === "miles" ? "miles" : "days" }).then((r) => ({ ...r, campaign: publicCampaign(r.campaign) })));
      case "mute":
        return NextResponse.json({ campaign: publicCampaign(await muteReminders({ campaignId: id, ownerId: user, muted: body.muted !== false })) });
      case "settle": {
        const c = await getCampaign(id);
        if (!c || c.ownerId !== user) return NextResponse.json({ error: "not your campaign", code: "NOT_YOURS" }, { status: 403 });
        if (!c.orderId) return NextResponse.json({ error: "no card order to settle", code: "NO_ORDER" }, { status: 409 });
        const order = await getOrder(c.orderId);
        if (order) await reconcileOrder(order).catch(() => null);
        const s = await settleCampaignOrder(c.orderId);
        return NextResponse.json({ ...s, campaign: publicCampaign(s.campaign || (await getCampaign(id))) });
      }
      default:
        return NextResponse.json({ error: "create, attach, pay, preview, cancel, mute or settle", code: "UNKNOWN_ACTION" }, { status: 400 });
    }
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
