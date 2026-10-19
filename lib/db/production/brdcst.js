// lib/db/production/brdcst.js — BRDCST CAMPAIGNS AND THE BONUS BANK (V.2
// Blueprint chapter 5, 5.10–5.28, 9.13, Terms 15; slice 8; schema v66).
// SERVER-ONLY; memory mode mirrors Postgres. The law is lib/brdcst/index.js —
// this keeps:
//
//   campaigns   one paid promotion of a post's event attachment(s): the
//               targeting, the quote as shown, the schedule a payment fixed,
//               the order that paid it, the credit applied, the failed-payment
//               clock, the cancellation and its refund
//   bonuses     days or miles earned by a credit refund or a credit share,
//               redeemed on a later campaign (append-only, bank derived)
//   delivery    for one viewer: taste first (cosine against the profile),
//               distance second (the base record or the request's area),
//               blocks suppress; the author sees their own footer always
//   audience    a REAL count for the forecast: passports whose taste clears
//               the floor and whose base city lies inside the radius
//
// A campaign's card charge is an order of kind 'brdcst' on the order engine
// (one checkout session, one ledger); credit pays through the credit ledger.
// Nothing here moves money without a configured provider: unkeyed, the
// campaign stays a draft and the route says why.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { getProfile } from "../core/profiles.js";
import { createOrderWithEvent, attachOrderSession, applyOrderEvent, getOrder } from "../orders.js";
import { enqueueNotification } from "./listingStatus.js";
import { creditBalance, creditSpend, creditRelease, creditIn } from "./credit.js";
import { listUserRecords } from "./records.js";
import { tagCosine } from "../../hotlist.js";
import { tasteVector } from "../../brain/index.js";
import { accountIdFromIdentity } from "../../identity.js";
import { createCheckoutSession, createRefund, stripeConfigured, retrieveCheckoutSession, StripeApiError } from "../../payments/stripe.js";
import { SITE_ORIGIN } from "../../site.js";
import {
  normalizeTargeting, quote as quoteLaw, forecast as forecastLaw, schedule, stateAt, usage, refundPolicy, refundOffer, creditShareBonus,
  reminderDue, deliver, distanceMi, eventLive, REFUND_BONUS, CANCEL_REASONS, PRICE,
} from "../../brdcst/index.js";

export class BrdcstRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "BrdcstRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "brdcst_campaigns") : true);
const needs = () => { throw new BrdcstRefused("SCHEMA_V66_REQUIRED", "BRDCST campaigns need schema v66 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
const newId = () => globalThis.crypto.randomUUID();

const out = (r) => {
  const c = {
    id: String(r.id), ownerId: r.owner_id, postId: r.post_id == null ? null : String(r.post_id), eventIds: json(r.event_ids) || [], eventName: r.event_name || "", eventKind: r.event_kind || null, eventStartsAt: r.event_starts_at || null,
    center: Number.isFinite(Number(r.center_lat)) && Number.isFinite(Number(r.center_lng)) ? { lat: Number(r.center_lat), lng: Number(r.center_lng) } : null,
    tags: json(r.tags) || [], radiusMi: Number(r.radius_mi), tasteBreadth: Number(r.taste_breadth), durationDays: Number(r.duration_days), scheduledStart: iso(r.scheduled_start),
    quote: json(r.quote) || {}, perDayCents: Number(r.per_day_cents), totalCents: Number(r.total_cents), billedDays: Number(r.billed_days || 0), bonusDays: Number(r.bonus_days || 0), bonusMiles: Number(r.bonus_miles || 0),
    creditCents: Number(r.credit_cents || 0), orderId: r.order_id || null, paidAt: iso(r.paid_at), paidVia: r.paid_via || null, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at),
    state: r.state, paymentFailedAt: iso(r.payment_failed_at), lastReminderAt: iso(r.last_reminder_at), remindersMuted: !!r.reminders_muted,
    cancelledAt: iso(r.cancelled_at), cancelReason: r.cancel_reason || null, cancelledBy: r.cancelled_by || null, refund: json(r.refund), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
  return c;
};
const row = (c) => ({
  id: c.id, owner_id: c.ownerId, post_id: c.postId, event_ids: c.eventIds || [], event_name: c.eventName || "", event_kind: c.eventKind || null, event_starts_at: c.eventStartsAt || null,
  center_lat: c.center ? c.center.lat : null, center_lng: c.center ? c.center.lng : null, tags: c.tags || [], radius_mi: c.radiusMi, taste_breadth: c.tasteBreadth, duration_days: c.durationDays, scheduled_start: c.scheduledStart,
  quote: c.quote || {}, per_day_cents: c.perDayCents, total_cents: c.totalCents, billed_days: c.billedDays || 0, bonus_days: c.bonusDays || 0, bonus_miles: c.bonusMiles || 0, credit_cents: c.creditCents || 0,
  order_id: c.orderId, paid_at: c.paidAt, paid_via: c.paidVia, starts_at: c.startsAt, ends_at: c.endsAt, state: c.state, payment_failed_at: c.paymentFailedAt, last_reminder_at: c.lastReminderAt, reminders_muted: !!c.remindersMuted,
  cancelled_at: c.cancelledAt, cancel_reason: c.cancelReason, cancelled_by: c.cancelledBy, refund: c.refund || null, created_at: c.createdAt, updated_at: c.updatedAt,
});

async function save(c, now = Date.now()) {
  const p = await getPool();
  const r = row({ ...c, updatedAt: new Date(now).toISOString(), createdAt: c.createdAt || new Date(now).toISOString() });
  if (!p) { mem.brdcstCampaigns.set(r.id, r); return out(r); }
  await p.query(
    `INSERT INTO brdcst_campaigns (id, owner_id, post_id, event_ids, event_name, event_kind, event_starts_at, center_lat, center_lng, tags, radius_mi, taste_breadth, duration_days, scheduled_start, quote, per_day_cents, total_cents, billed_days, bonus_days, bonus_miles, credit_cents, order_id, paid_at, paid_via, starts_at, ends_at, state, payment_failed_at, last_reminder_at, reminders_muted, cancelled_at, cancel_reason, cancelled_by, refund, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
     ON CONFLICT (id) DO UPDATE SET post_id=EXCLUDED.post_id, radius_mi=EXCLUDED.radius_mi, taste_breadth=EXCLUDED.taste_breadth, duration_days=EXCLUDED.duration_days, scheduled_start=EXCLUDED.scheduled_start, quote=EXCLUDED.quote,
       per_day_cents=EXCLUDED.per_day_cents, total_cents=EXCLUDED.total_cents, billed_days=EXCLUDED.billed_days, bonus_days=EXCLUDED.bonus_days, bonus_miles=EXCLUDED.bonus_miles, credit_cents=EXCLUDED.credit_cents, order_id=EXCLUDED.order_id,
       paid_at=EXCLUDED.paid_at, paid_via=EXCLUDED.paid_via, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, state=EXCLUDED.state, payment_failed_at=EXCLUDED.payment_failed_at, last_reminder_at=EXCLUDED.last_reminder_at,
       reminders_muted=EXCLUDED.reminders_muted, cancelled_at=EXCLUDED.cancelled_at, cancel_reason=EXCLUDED.cancel_reason, cancelled_by=EXCLUDED.cancelled_by, refund=EXCLUDED.refund, updated_at=EXCLUDED.updated_at`,
    [r.id, r.owner_id, r.post_id, JSON.stringify(r.event_ids), r.event_name, r.event_kind, r.event_starts_at, r.center_lat, r.center_lng, JSON.stringify(r.tags), r.radius_mi, r.taste_breadth, r.duration_days, r.scheduled_start,
     JSON.stringify(r.quote), r.per_day_cents, r.total_cents, r.billed_days, r.bonus_days, r.bonus_miles, r.credit_cents, r.order_id, r.paid_at, r.paid_via, r.starts_at, r.ends_at, r.state, r.payment_failed_at, r.last_reminder_at,
     r.reminders_muted, r.cancelled_at, r.cancel_reason, r.cancelled_by, r.refund == null ? null : JSON.stringify(r.refund), r.created_at, r.updated_at]);
  return out(r);
}

export async function getCampaign(id) {
  const p = await getPool();
  if (!(await applied(p))) return null;
  if (!p) { const r = mem.brdcstCampaigns.get(String(id)); return r ? out(r) : null; }
  const { rows } = await p.query("SELECT * FROM brdcst_campaigns WHERE id=$1", [String(id)]);
  return rows[0] ? out(rows[0]) : null;
}

export async function listCampaigns({ ownerId = null, postId = null, states = null, limit = 100 } = {}) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  if (!p) rows = [...mem.brdcstCampaigns.values()].filter((r) => (!ownerId || r.owner_id === ownerId) && (postId == null || String(r.post_id) === String(postId))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  else rows = (await p.query("SELECT * FROM brdcst_campaigns WHERE ($1::text IS NULL OR owner_id=$1) AND ($2::text IS NULL OR post_id=$2) ORDER BY created_at DESC LIMIT $3", [ownerId, postId == null ? null : String(postId), limit])).rows;
  const list = rows.map(out);
  return states ? list.filter((c) => states.includes(stateAt(c))) : list;
}

/** Every campaign that is live at `now` (paid, started, not ended, not cancelled). */
export async function liveCampaigns(now = Date.now()) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  let rows;
  const at = new Date(now).toISOString();
  if (!p) rows = [...mem.brdcstCampaigns.values()].filter((r) => r.paid_at && r.starts_at && r.ends_at && r.starts_at <= at && r.ends_at > at && !["cancelled", "under_review"].includes(r.state));
  else rows = (await p.query("SELECT * FROM brdcst_campaigns WHERE paid_at IS NOT NULL AND starts_at <= $1 AND ends_at > $1 AND state NOT IN ('cancelled','under_review')", [at])).rows;
  return rows.map(out).filter((c) => stateAt(c, now) === "active");
}

// ---- the bonus bank -------------------------------------------------------------------

const bonusOut = (r) => ({ id: String(r.id), userId: r.user_id, kind: r.kind, amount: Number(r.amount), source: r.source, campaignId: r.campaign_id || null, earnedAt: iso(r.earned_at), redeemedAt: iso(r.redeemed_at), redeemedCampaignId: r.redeemed_campaign_id || null });

export async function listBonuses(userId) {
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return mem.brdcstBonuses.filter((r) => r.user_id === userId).map(bonusOut);
  const { rows } = await p.query("SELECT * FROM brdcst_bonuses WHERE user_id=$1 ORDER BY earned_at ASC, id ASC", [userId]);
  return rows.map(bonusOut);
}

/** The bank: unredeemed days and miles. */
export async function bonusBank(userId) {
  const all = await listBonuses(userId);
  const bank = { days: 0, miles: 0, entries: all };
  for (const b of all) if (!b.redeemedAt) bank[b.kind] += b.amount;
  return bank;
}

async function earnBonus({ userId, kind, amount, source, campaignId = null, now = Date.now() }) {
  if (!(amount > 0)) return null;
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const r = { id: mem.brdcstBonusSeq++, user_id: userId, kind, amount, source, campaign_id: campaignId, earned_at: new Date(now).toISOString(), redeemed_at: null, redeemed_campaign_id: null };
    mem.brdcstBonuses.push(r);
    return bonusOut(r);
  }
  const { rows } = await p.query("INSERT INTO brdcst_bonuses (user_id, kind, amount, source, campaign_id, earned_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [userId, kind, amount, source, campaignId, new Date(now).toISOString()]);
  return bonusOut(rows[0]);
}

/** Redeem up to `want` of a kind, oldest first, onto a campaign. Returns what was redeemed. */
async function redeemBonus({ userId, kind, want, campaignId, now = Date.now() }) {
  if (!(want > 0)) return 0;
  const bank = await bonusBank(userId);
  if (bank[kind] < want) throw new BrdcstRefused("BONUS_SHORT", `only ${bank[kind]} bonus ${kind} are banked`, 409);
  const p = await getPool();
  let left = want;
  const at = new Date(now).toISOString();
  for (const b of bank.entries) {
    if (left <= 0) break;
    if (b.kind !== kind || b.redeemedAt) continue;
    // a bonus entry redeems whole: a partial redemption splits it into two rows
    if (b.amount > left) {
      await earnBonus({ userId, kind, amount: b.amount - left, source: b.source, campaignId: b.campaignId, now });
    }
    if (!p) { const r = mem.brdcstBonuses.find((x) => String(x.id) === b.id); r.redeemed_at = at; r.redeemed_campaign_id = campaignId; r.amount = Math.min(b.amount, left); }
    else await p.query("UPDATE brdcst_bonuses SET redeemed_at=$2, redeemed_campaign_id=$3, amount=$4 WHERE id=$1", [b.id, at, campaignId, Math.min(b.amount, left)]);
    left -= Math.min(b.amount, left);
  }
  return want;
}

// ---- campaigns --------------------------------------------------------------------------

/**
 * A draft campaign for a post's event attachment(s). The post may follow
 * (the composer creates the campaign right after publishing); the events
 * are map rows the route already resolved. A sample fixture cannot be
 * promoted — nothing is sold on an event that does not exist.
 */
export async function createCampaign({ ownerId, postId = null, events = [], tags = [], radiusMi, tasteBreadth, durationDays, scheduledStart = null, now = Date.now() } = {}) {
  if (!ownerId) throw new BrdcstRefused("AUTH_REQUIRED", "a campaign has an owner", 401);
  const list = (events || []).filter((e) => e && e.id);
  if (!list.length) throw new BrdcstRefused("NO_EVENT", "a BRDCST promotes an event the map knows", 400);
  if (list.some((e) => e.sample)) throw new BrdcstRefused("SAMPLE_EVENT", "a sample fixture is not an event — nothing can be promoted on it", 400);
  if (list.some((e) => !eventLive(e, now))) throw new BrdcstRefused("EVENT_ENDED", "an event that has ended cannot be promoted", 400);
  const t = normalizeTargeting({ radiusMi, tasteBreadth, durationDays });
  if (!t.ok) throw new BrdcstRefused("TARGETING", t.errors.map((e) => e.message).join("; "), 400);
  const start = scheduledStart ? Date.parse(String(scheduledStart)) : NaN;
  if (scheduledStart && !Number.isFinite(start)) throw new BrdcstRefused("START", "a scheduled start is a date", 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const q = quoteLaw(t);
  const first = list.slice().sort((a, b) => String(a.startsAt || "9999").localeCompare(String(b.startsAt || "9999")))[0];
  const center = Number.isFinite(Number(first.lat)) && Number.isFinite(Number(first.lng)) ? { lat: Number(first.lat), lng: Number(first.lng) } : null;
  const c = {
    id: newId(), ownerId, postId: postId == null ? null : String(postId), eventIds: list.map((e) => String(e.id)), eventName: String(first.name || "").slice(0, 120), eventKind: first.kind || null, eventStartsAt: first.startsAt || null,
    center, tags: (tags || []).map((x) => String(x).toUpperCase()).slice(0, 20), radiusMi: t.radiusMi, tasteBreadth: t.tasteBreadth, durationDays: t.durationDays,
    scheduledStart: Number.isFinite(start) ? new Date(start).toISOString() : null, quote: q, perDayCents: q.perDayCents, totalCents: q.totalCents, billedDays: 0, bonusDays: 0, bonusMiles: 0, creditCents: 0,
    orderId: null, paidAt: null, paidVia: null, startsAt: null, endsAt: null, state: "draft", paymentFailedAt: null, lastReminderAt: null, remindersMuted: false, cancelledAt: null, cancelReason: null, cancelledBy: null, refund: null,
    createdAt: new Date(now).toISOString(),
  };
  return save(c, now);
}

/** Attach the published post to a draft (the composer publishes first, then names the post). */
export async function attachPost({ campaignId, ownerId, postId, now = Date.now() } = {}) {
  const c = await getCampaign(campaignId);
  if (!c || c.ownerId !== ownerId) throw new BrdcstRefused("NOT_YOURS", "not your campaign", 403);
  return save({ ...c, postId: String(postId) }, now);
}

/**
 * The quote at payment time: a late payment on a scheduled campaign bills
 * the remaining days only (5.23). Bonus days banked are redeemed here if
 * asked; bonus miles extend the radius without charge.
 */
export function payQuote(c, { now = Date.now(), bonusDays = 0, bonusMiles = 0 } = {}) {
  const radius = Math.min(500, c.radiusMi + Math.max(0, bonusMiles));
  const s = schedule({ scheduledStart: c.scheduledStart, durationDays: c.durationDays, paidAt: now, bonusDays });
  if (!s.ok) return { ok: false, reason: s.reason };
  const q = quoteLaw({ radiusMi: c.radiusMi, tasteBreadth: c.tasteBreadth, durationDays: c.durationDays, days: s.billedDays });
  return { ok: true, quote: q, schedule: s, radiusMi: radius, totalCents: q.totalCents, perDayCents: q.perDayCents };
}

/**
 * Pay: the passenger's exact credit amount first (never automatic, 5.32),
 * banked bonus days or miles if chosen, the remainder by card through the
 * order engine. Credit covering the whole quote pays outright. Without a
 * payment provider the card remainder cannot be charged: the credit is
 * released and the campaign stays a draft with the reason.
 */
export async function payCampaign({ campaignId, ownerId, creditCents = 0, bonusAs = "days", useBonusDays = 0, useBonusMiles = 0, origin = null, now = Date.now() } = {}) {
  const c = await getCampaign(campaignId);
  if (!c || c.ownerId !== ownerId) throw new BrdcstRefused("NOT_YOURS", "not your campaign", 403);
  if (c.paidAt) throw new BrdcstRefused("ALREADY_PAID", "this campaign is paid", 409);
  if (["cancelled", "under_review"].includes(c.state)) throw new BrdcstRefused("CLOSED", `this campaign is ${c.state}`, 409);
  const bonusDays = Math.max(0, Number(useBonusDays) || 0), bonusMiles = Math.max(0, Number(useBonusMiles) || 0);
  const pq = payQuote(c, { now, bonusDays, bonusMiles });
  if (!pq.ok) throw new BrdcstRefused("WINDOW_PASSED", pq.reason, 409);
  const credit = Math.max(0, Number(creditCents) || 0);
  if (!Number.isSafeInteger(credit)) throw new BrdcstRefused("INVALID_AMOUNT", "credit is a whole number of cents", 400);
  if (credit > pq.totalCents) throw new BrdcstRefused("CREDIT_OVER", "credit cannot exceed the quote", 400);
  const remainder = pq.totalCents - credit;
  // every refusal before any side effect: the bank, the balance, the provider
  const bank = bonusDays || bonusMiles ? await bonusBank(ownerId) : null;
  if (bank && bank.days < bonusDays) throw new BrdcstRefused("BONUS_SHORT", `only ${bank.days} bonus days are banked`, 409);
  if (bank && bank.miles < bonusMiles) throw new BrdcstRefused("BONUS_SHORT", `only ${bank.miles} bonus miles are banked`, 409);
  if (credit > 0 && credit > (await creditBalance(ownerId))) throw new BrdcstRefused("INSUFFICIENT", `only ${await creditBalance(ownerId)} cents of credit are available`, 409);
  if (remainder > 0 && !stripeConfigured()) throw new BrdcstRefused("PAYMENT_IDLE", "card payment is idle — no payment provider is configured; the broadcast waits in Drafts", 503);
  if (bonusDays) await redeemBonus({ userId: ownerId, kind: "days", want: bonusDays, campaignId: c.id, now });
  if (bonusMiles) await redeemBonus({ userId: ownerId, kind: "miles", want: bonusMiles, campaignId: c.id, now });
  if (credit > 0) await creditSpend({ userId: ownerId, amountCents: credit, orderId: `brdcst-${c.id}`, now });
  const share = creditShareBonus({ creditCents: credit, totalCents: pq.totalCents, as: bonusAs });
  const base = { ...c, quote: pq.quote, perDayCents: pq.perDayCents, totalCents: pq.totalCents, billedDays: pq.schedule.billedDays, bonusDays, bonusMiles, radiusMi: pq.radiusMi, creditCents: credit };
  if (remainder === 0) {
    const paid = await save({ ...base, paidAt: new Date(now).toISOString(), paidVia: "credit", startsAt: pq.schedule.startsAt, endsAt: pq.schedule.endsAt, state: stateAt({ ...base, paidAt: now, startsAt: pq.schedule.startsAt, endsAt: pq.schedule.endsAt }, now), paymentFailedAt: null }, now);
    if (share.amount > 0) await earnBonus({ userId: ownerId, kind: share.kind, amount: share.amount, source: "credit_share", campaignId: c.id, now });
    await enqueueNotification({ userId: ownerId, kind: "brdcst-started", subjectId: c.id, payload: { campaignId: c.id, startsAt: paid.startsAt, endsAt: paid.endsAt, radiusMi: paid.radiusMi, scheduled: paid.state === "scheduled" } }).catch(() => null);
    return { campaign: paid, paid: true, via: "credit", bonus: share, checkoutUrl: null };
  }
  // the card remainder: an order of kind brdcst, one checkout session
  let order, session;
  try {
    order = await createOrderWithEvent({ user: ownerId, itemId: `brdcst-${c.id}`, amountCents: remainder, feeCents: 0, currency: PRICE.currency, kind: "brdcst" });
    session = await createCheckoutSession({ orderId: order.id, itemId: `brdcst-${c.id}`, title: `BRDCST · ${c.eventName || "event"} · ${pq.schedule.billedDays} DAY${pq.schedule.billedDays === 1 ? "" : "S"} · ${pq.radiusMi} MI`, amountCents: remainder, feeCents: 0, currency: PRICE.currency, origin: origin || SITE_ORIGIN, user: ownerId });
    await attachOrderSession(order.id, session.id);
  } catch (err) {
    if (credit > 0) await creditRelease({ userId: ownerId, amountCents: credit, orderId: `brdcst-${c.id}`, now }).catch(() => null);
    throw new BrdcstRefused("PAYMENT_FAILED", err instanceof StripeApiError ? err.message : "the payment could not be started", 502);
  }
  const pending = await save({ ...base, orderId: order.id, paidVia: credit > 0 ? "mixed" : "card", state: "draft" }, now);
  return { campaign: pending, paid: false, via: pending.paidVia, bonus: share, checkoutUrl: session.url || null, orderId: order.id, pendingSchedule: pq.schedule };
}

/**
 * The order settled (webhook, reconcile): fix the schedule from the moment
 * the money arrived, bank the credit-share bonus, say so. Idempotent. A
 * failed or expired order starts the reminder clock instead.
 */
export async function settleCampaignOrder(orderId, { now = Date.now() } = {}) {
  const order = await getOrder(orderId);
  if (!order || order.kind !== "brdcst") return { settled: false, reason: "not a BRDCST order" };
  const p = await getPool();
  if (!(await applied(p))) return { settled: false, reason: "schema v66 not applied" };
  let rows;
  if (!p) rows = [...mem.brdcstCampaigns.values()].filter((r) => r.order_id === orderId);
  else rows = (await p.query("SELECT * FROM brdcst_campaigns WHERE order_id=$1", [orderId])).rows;
  const c = rows[0] ? out(rows[0]) : null;
  if (!c) return { settled: false, reason: "no campaign for this order" };
  if (c.paidAt) return { settled: true, duplicate: true, campaign: c };
  if (order.status === "paid") {
    const paidAt = Date.parse(order.updated_at) || now;
    const s = schedule({ scheduledStart: c.scheduledStart, durationDays: c.durationDays, paidAt, bonusDays: c.bonusDays });
    const startsAt = s.ok ? s.startsAt : new Date(paidAt).toISOString();
    const endsAt = s.ok ? s.endsAt : new Date(paidAt + (c.durationDays + c.bonusDays) * 86_400_000).toISOString();
    const next = await save({ ...c, paidAt: new Date(paidAt).toISOString(), startsAt, endsAt, billedDays: s.ok ? s.billedDays : c.durationDays, state: stateAt({ ...c, paidAt, startsAt, endsAt }, now), paymentFailedAt: null }, now);
    const share = creditShareBonus({ creditCents: c.creditCents, totalCents: c.totalCents, as: "days" });
    if (share.amount > 0) await earnBonus({ userId: c.ownerId, kind: share.kind, amount: share.amount, source: "credit_share", campaignId: c.id, now });
    await enqueueNotification({ userId: c.ownerId, kind: "brdcst-started", subjectId: c.id, payload: { campaignId: c.id, startsAt, endsAt, radiusMi: c.radiusMi, scheduled: next.state === "scheduled" } }).catch(() => null);
    return { settled: true, campaign: next };
  }
  if (["failed", "expired"].includes(order.status)) {
    if (c.creditCents > 0) await creditRelease({ userId: c.ownerId, amountCents: c.creditCents, orderId: `brdcst-${c.id}`, now }).catch(() => null);
    const next = await save({ ...c, creditCents: 0, orderId: null, paidVia: null, paymentFailedAt: new Date(now).toISOString(), lastReminderAt: new Date(now).toISOString() }, now);
    await enqueueNotification({ userId: c.ownerId, kind: "brdcst-payment", subjectId: c.id, payload: { campaignId: c.id, failed: true, note: "the payment did not go through and the broadcast failed to send — pay by another method to keep the launch date" } }).catch(() => null);
    return { settled: false, failed: true, campaign: next };
  }
  return { settled: false, reason: `order ${order.status}` };
}

/** The reminder sweep (5.23): every three hours until resolved, unless muted. Returns how many were sent. */
export async function sweepPaymentReminders(now = Date.now()) {
  const p = await getPool();
  if (!(await applied(p))) return 0;
  let rows;
  if (!p) rows = [...mem.brdcstCampaigns.values()].filter((r) => r.payment_failed_at && !r.paid_at && !r.reminders_muted);
  else rows = (await p.query("SELECT * FROM brdcst_campaigns WHERE payment_failed_at IS NOT NULL AND paid_at IS NULL AND reminders_muted = false")).rows;
  let n = 0;
  for (const r of rows) {
    const c = out(r);
    if (!reminderDue(c, now)) continue;
    await enqueueNotification({ userId: c.ownerId, kind: "brdcst-payment", subjectId: c.id, payload: { campaignId: c.id, failed: true, reminder: true } }).catch(() => null);
    await save({ ...c, lastReminderAt: new Date(now).toISOString() }, now);
    n++;
  }
  return n;
}

export async function muteReminders({ campaignId, ownerId, muted = true, now = Date.now() } = {}) {
  const c = await getCampaign(campaignId);
  if (!c || c.ownerId !== ownerId) throw new BrdcstRefused("NOT_YOURS", "not your campaign", 403);
  return save({ ...c, remindersMuted: !!muted }, now);
}

/**
 * Cancel (5.23–5.26): the unused days' refund, offered as credit first with
 * the bonus (days or miles, the passenger's pick), the original method only
 * on decline. A policy review refunds nothing until an admin decides.
 */
export async function cancelCampaign({ campaignId, by, reason = "voluntary", refundTo = "credit", bonusAs = "days", now = Date.now() } = {}) {
  const c = await getCampaign(campaignId);
  if (!c) throw new BrdcstRefused("NOT_FOUND", "campaign not found", 404);
  const admin = by === "admin";
  if (!admin && c.ownerId !== by) throw new BrdcstRefused("NOT_YOURS", "not your campaign", 403);
  if (!admin && reason !== "voluntary" && reason !== "event_cancelled") throw new BrdcstRefused("REASON", "a passenger cancels voluntarily or because the event is cancelled; interruptions and reviews are ASILUM's", 400);
  if (["cancelled", "under_review"].includes(c.state)) throw new BrdcstRefused("CLOSED", `already ${c.state}`, 409);
  const policy = refundPolicy(reason);
  if (!policy.ok) throw new BrdcstRefused("REASON", policy.reason, 400);
  const u = usage(c, now);
  const base = { ...c, cancelledAt: new Date(now).toISOString(), cancelReason: reason, cancelledBy: String(by) };
  if (policy.refund === "review") {
    return { campaign: await save({ ...base, state: "under_review", refund: { pending: "review", unusedDays: u.unusedDays, amountCents: u.refundCents } }, now), refund: null, offer: null };
  }
  const offer = refundOffer({ amountCents: u.refundCents });
  if (!offer.ok || !c.paidAt) {
    return { campaign: await save({ ...base, state: "cancelled", refund: { amountCents: 0, unusedDays: u.unusedDays, note: c.paidAt ? "no completely unused day" : "never paid" } }, now), refund: null, offer: null };
  }
  const refund = await settleRefund({ c: base, amountCents: u.refundCents, refundTo, bonusAs, now });
  const next = await save({ ...base, state: "cancelled", refund: { ...refund, unusedDays: u.unusedDays, usedDays: u.usedDays } }, now);
  await enqueueNotification({ userId: c.ownerId, kind: "brdcst-refund", subjectId: c.id, payload: { campaignId: c.id, amountCents: u.refundCents, to: refund.to, bonus: refund.bonus || null, reason } }).catch(() => null);
  return { campaign: next, refund, offer };
}

async function settleRefund({ c, amountCents, refundTo, bonusAs, now }) {
  if (refundTo !== "original") {
    const entry = await creditIn({ userId: c.ownerId, source: "refund", amountCents, orderId: c.orderId || `brdcst-${c.id}`, note: `BRDCST ${c.id} unused days`, now });
    const kind = bonusAs === "miles" ? "miles" : "days";
    const bonus = await earnBonus({ userId: c.ownerId, kind, amount: REFUND_BONUS[kind], source: "refund", campaignId: c.id, now });
    return { to: "credit", amountCents, credit: entry.id, bonus: bonus ? { kind: bonus.kind, amount: bonus.amount } : null };
  }
  // the original method: the credit share returns to credit; the card share through the provider
  const creditShare = Math.min(amountCents, Math.round(amountCents * (c.totalCents ? c.creditCents / c.totalCents : 0)));
  const cardShare = amountCents - creditShare;
  const result = { to: "original", amountCents, creditCents: creditShare, cardCents: cardShare, provider: null };
  if (creditShare > 0) result.credit = (await creditIn({ userId: c.ownerId, source: "refund", amountCents: creditShare, orderId: c.orderId, note: `BRDCST ${c.id} unused days (credit share)`, now })).id;
  if (cardShare > 0) {
    if (!stripeConfigured() || !c.orderId) { result.provider = "pending"; result.note = "the card refund waits for the payment provider"; return result; }
    const order = await getOrder(c.orderId);
    let pi = order && order.stripe_payment_intent_id;
    if (!pi && order && order.stripe_session_id) {
      try { const s = await retrieveCheckoutSession(order.stripe_session_id); pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id; } catch { pi = null; }
    }
    if (!pi) { result.provider = "pending"; result.note = "the order carries no payment intent yet"; return result; }
    try {
      const r = await createRefund(pi, { amountCents: cardShare, idempotencyKey: `brdcst-refund-${c.id}` });
      result.provider = r.id;
      await applyOrderEvent({ orderId: c.orderId, type: "refunded", source: "api", payload: { refund: r.id, partial: true, amountCents: cardShare, campaignId: c.id } }).catch(() => null);
    } catch (err) { result.provider = "failed"; result.note = err instanceof StripeApiError ? err.message : "the provider refused the refund"; }
  }
  return result;
}

/** An admin decides a policy review: refund the unused days or refuse (15.5). */
export async function decideReview({ campaignId, refund = false, note = "", actor = "admin", now = Date.now() } = {}) {
  const c = await getCampaign(campaignId);
  if (!c || c.state !== "under_review") throw new BrdcstRefused("NOT_UNDER_REVIEW", "only a campaign under review is decided", 409);
  const amount = Number(c.refund && c.refund.amountCents) || 0;
  const settled = refund && amount > 0 && c.paidAt ? await settleRefund({ c, amountCents: amount, refundTo: "credit", bonusAs: "days", now }) : null;
  return save({ ...c, state: "cancelled", refund: { ...(c.refund || {}), pending: null, decided: refund ? "refunded" : "refused", by: actor, note: String(note || "").slice(0, 300), ...(settled || {}) } }, now);
}

// ---- delivery -----------------------------------------------------------------------------

/** The viewer's taste as a tag→weight map, or null when nothing is on record. */
export async function viewerTaste(userId) {
  if (!userId) return null;
  const profile = await getProfile(userId).catch(() => null);
  if (!profile || typeof profile !== "object") return null;
  const taste = tasteVector(profile);
  return Object.keys(taste).length ? taste : null;
}

/** The viewer's point: the request's area first (rounded by the client), else the base-city record. */
export async function viewerPoint(userId, { lat = null, lng = null } = {}) {
  // null and "" are "not given", never the equator (Number(null) is 0)
  const given = (v) => v != null && v !== "" && Number.isFinite(Number(v));
  if (given(lat) && given(lng)) return { lat: Number(lat), lng: Number(lng), source: "request" };
  if (!userId) return null;
  const rows = await listUserRecords(userId, { kind: "location", limit: 1 }).catch(() => []);
  const base = rows[0] && rows[0].payload && rows[0].payload.baseCity;
  if (base && Number.isFinite(Number(base.lat)) && Number.isFinite(Number(base.lng))) return { lat: Number(base.lat), lng: Number(base.lng), source: "base", label: base.name || null };
  return null;
}

/** Has `viewer` blocked `author`, or the other way (9.12–9.13)? Postgres only — the DM subsystem has no memory mirror; mem answers false. */
export async function blockedBetween(viewerId, authorId) {
  const a = accountIdFromIdentity(viewerId), b = accountIdFromIdentity(authorId);
  if (!a || !b || a === b) return false;
  const p = await getPool();
  if (!p || !(await hasRelation(p, "dm_blocks"))) return false;
  const { rows } = await p.query("SELECT 1 FROM dm_blocks WHERE (blocker_account_id=$1 AND blocked_account_id=$2) OR (blocker_account_id=$2 AND blocked_account_id=$1) LIMIT 1", [a, b]);
  return rows.length > 0;
}

const postVector = (tags) => Object.fromEntries((tags || []).map((t) => [String(t).toUpperCase(), 1]));

/**
 * Deliver a list of posts to one viewer. A post with an event attachment
 * is shown with its footer only through a live campaign in reach; a
 * taste-matched viewer beyond the radius sees it bare; a viewer whose
 * taste does not match does not see it; a block hides it. The author sees
 * their own with the campaign's state. Returns the posts to serve, each
 * event-bearing one with `attachments.brdcst` stating the decision.
 */
export async function deliverPosts(posts, { viewerId = null, lat = null, lng = null, now = Date.now(), hide = true } = {}) {
  const withEvents = (posts || []).filter((p) => p && p.attachments && (p.attachments.event || (Array.isArray(p.attachments.events) && p.attachments.events.length)));
  if (!withEvents.length) return posts || [];
  const live = await liveCampaigns(now);
  const byPost = new Map();
  for (const c of live) if (c.postId) byPost.set(String(c.postId), c);
  const taste = await viewerTaste(viewerId);
  const point = await viewerPoint(viewerId, { lat, lng });
  const outList = [];
  for (const post of posts || []) {
    if (!withEvents.includes(post)) { outList.push(post); continue; }
    const author = viewerId && post.authorId && post.authorId === viewerId;
    let campaign = byPost.get(String(post.id)) || null;
    if (!campaign && author) campaign = (await listCampaigns({ postId: post.id, limit: 1 }))[0] || null;
    const blocked = !author && viewerId && post.authorId ? await blockedBetween(viewerId, post.authorId) : false;
    const match = taste && campaign ? tagCosine(taste, postVector(post.tags)) : null;
    const d = campaign && campaign.center && point ? distanceMi(point, campaign.center) : null;
    const v = deliver({ campaign, viewer: { author, blocked, match: match == null ? null : Math.round(match * 1000) / 1000, distanceMi: d }, now });
    // the feed hides a promoted post from a taste that does not match (5.13);
    // a permalink or a poster's page shows it bare; a block hides it everywhere
    if (!v.post && (hide || v.reason === "blocked")) continue;
    const a = { ...post.attachments };
    const meta = { state: v.state || "draft", footer: v.footer, reason: v.reason, radiusMi: campaign ? campaign.radiusMi : null, endsAt: campaign ? campaign.endsAt : null, yours: !!author };
    if (!v.footer) { delete a.event; delete a.events; }
    outList.push({ ...post, attachments: { ...a, brdcst: meta } });
  }
  return outList;
}

/** The ticker's SPONSORED entries for one viewer: live campaigns in reach (the ad ticker, Foundations). */
/**
 * 16.3 (slice 12): the live BRDCSTs delivered to this viewer that name an entity —
 * the post's tags carry the entity's name or a catalog brand of it, or the event's
 * name does. Reach and taste decide delivery exactly as the Feed's law does; the
 * overview never shows a broadcast the Feed would not.
 */
export async function brdcstsForEntity({ viewerId = null, entity = null, lat = null, lng = null, now = Date.now() } = {}) {
  if (!entity || !entity.name) return [];
  const names = [entity.name, ...(entity.catalogBrands || [])].map((n) => String(n).toLowerCase()).filter(Boolean);
  const slugs = names.map((n) => n.replace(/[^a-z0-9]+/g, ""));
  const rows = await tickerFor({ viewerId, lat, lng, now });
  const live = await liveCampaigns(now);
  const byId = new Map(live.map((c) => [c.id, c]));
  return rows.filter((r) => {
    const c = byId.get(r.id);
    if (!c) return false;
    const tags = (c.tags || []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ""));
    const ev = String(c.eventName || "").toLowerCase();
    return slugs.some((s) => s && tags.includes(s)) || names.some((n) => n && ev.includes(n));
  }).map((r) => ({ ...r, line: `BRDCST · ${r.name}${r.startsAt ? " · " + r.startsAt : ""}` }));
}

export async function tickerFor({ viewerId = null, lat = null, lng = null, now = Date.now() } = {}) {
  const live = await liveCampaigns(now);
  if (!live.length) return [];
  const taste = await viewerTaste(viewerId);
  const point = await viewerPoint(viewerId, { lat, lng });
  const rows = [];
  for (const c of live) {
    const match = taste ? tagCosine(taste, postVector(c.tags)) : null;
    const d = c.center && point ? distanceMi(point, c.center) : null;
    const v = deliver({ campaign: c, viewer: { author: viewerId && c.ownerId === viewerId, match, distanceMi: d }, now });
    if (!v.footer) continue;
    rows.push({ id: c.id, name: c.eventName, kind: c.eventKind, startsAt: c.eventStartsAt, href: c.postId ? "/?post=" + encodeURIComponent(c.postId) : "/map?pin=" + encodeURIComponent(c.eventIds[0] || ""), radiusMi: c.radiusMi });
  }
  return rows;
}

/**
 * The audience a campaign would reach (5.18): a REAL count of passports
 * whose taste clears the floor against the post's tags and whose base city
 * lies inside the radius. Profiles without a base city cannot be placed
 * and are not counted — the forecast says it measured.
 */
export async function estimateAudience({ tags = [], radiusMi, tasteBreadth = 0, center = null, durationDays = 7 } = {}) {
  const t = normalizeTargeting({ radiusMi, tasteBreadth, durationDays });
  const vec = postVector(tags);
  const floor = quoteLaw(t).targeting.matchFloor;
  const p = await getPool();
  let bases = [];
  if (!p) {
    for (const r of mem.records.values()) if (r.kind === "location" && r.payload && r.payload.baseCity) bases.push({ userId: r.userId, base: r.payload.baseCity });
  } else if (await hasRelation(p, "user_records")) {
    const { rows } = await p.query("SELECT user_id, payload FROM user_records WHERE kind='location' LIMIT 20000");
    bases = rows.map((r) => ({ userId: r.user_id, base: r.payload && r.payload.baseCity })).filter((b) => b.base);
  }
  let audience = 0;
  for (const b of bases) {
    const d = center ? distanceMi(center, { lat: Number(b.base.lat), lng: Number(b.base.lng) }) : null;
    if (center && (d == null || d > t.radiusMi)) continue;
    const taste = await viewerTaste(b.userId);
    if (!taste) continue;
    if (tagCosine(taste, vec) >= floor) audience++;
  }
  return forecastLaw({ audience, durationDays: t.durationDays, radiusMi: t.radiusMi, center, measured: true });
}

export function resetMemoryBrdcst() { mem.brdcstCampaigns.clear(); mem.brdcstBonuses.length = 0; mem.brdcstBonusSeq = 1; }
export { CANCEL_REASONS };
