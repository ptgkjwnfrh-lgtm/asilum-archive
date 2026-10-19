// lib/brdcst/index.js — BRDCST OUTREACH AND BILLING (V.2 Blueprint, owner,
// 17 Oct 2026, chapter 5 "BRDCST distribution, billing and ASILUM Credit"
// 5.10–5.28, 9.13, Terms 1.6, 15.1–15.6; slice 8). PURE and client-safe:
// the composer quotes with it live, the server decides delivery with it.
//
//   WHO SEES A BRDCST (5.13–5.15, 9.13)  outreach is governed by taste first
//                           and distance second. A post with a BRDCST appears
//                           only in Feeds whose taste profile matches it; the
//                           broadcast (the footer) reaches the base 50-mile
//                           radius; a matching passenger beyond the paid radius
//                           sees the post with no footer (5.14). Geographic
//                           reach and taste breadth are two separate paid
//                           expansions. A block suppresses delivery; no refund
//                           for suppressed impressions (9.13).
//   PRICING (5.19–5.20)     an itemized live quote: a low base price per day,
//                           the duration (1, 3, 7, 14 or 30 days), geographic
//                           expansion beyond 50 miles, optional taste
//                           expansion. Per-day; any day with an active BRDCST
//                           counts in full (5.24).
//   START AND PAYMENT (5.21–5.23)  launch now or schedule; the duration begins
//                           when the campaign actually starts; until paid the
//                           broadcast waits in Drafts; paid after the scheduled
//                           start bills only the remaining days; a failed
//                           payment notifies at once and every three hours
//                           until resolved, mutable.
//   REFUNDS (5.24–5.28)     completely unused days are refunded for a voluntary
//                           cancellation, a cancelled event or an ASILUM
//                           interruption; policy violations are reviewed
//                           separately. Credit is offered first, with a bonus
//                           of two extra days OR 45 miles, stored and redeemed
//                           whenever; the original method only after declining.
//   THE FOOTER (5.10–5.12)  unlimited attachments; collapsed shows +1–5;
//                           expanded shows five soonest-first; the next five
//                           on a discreet control.
//
// THE PRICE LIST is declared here and nowhere else (#271 copied-constants
// law). Owner ruling 18 Oct 2026 (CONSTITUTION A6): set by best judgment —
// profitable, never so dear that a small band opts out. So the entry is
// cheap and reach is where the money is: a week in the base radius is
// USD 21; the same week at 200 miles is USD 52.50; full taste breadth adds
// USD 5 a day.

import { DAY } from "../storefront/protection.js";
export const BASE_RADIUS_MI = 50;
export const MAX_RADIUS_MI = 500;
export const DURATIONS = Object.freeze([1, 3, 7, 14, 30]);
export const PRICE = Object.freeze({
  baseDayCents: 300,            // the low base price per day — a small band's week is USD 21
  geoCentsPerMileDay: 3,        // every mile beyond the base radius, per day — reach is the paid expansion
  tasteMaxCentsPerDay: 500,     // taste expansion at full breadth, per day (scales linearly)
  currency: "usd",
});
export const TASTE_FLOOR = 0.15;  // the thread-of-familiarity line (lib/hotlist.js BOOTH_MATCH_FLOOR, lib/brain/bridges.js DISCOVERY_FLOOR)
export const REFUND_BONUS = Object.freeze({ days: 2, miles: 45 });
export const REMINDER_EVERY_MS = 3 * 60 * 60 * 1000;
export const FOOTER_PAGE = 5;
export const STATES = Object.freeze(["draft", "scheduled", "active", "ended", "cancelled", "under_review"]);
export const CANCEL_REASONS = Object.freeze(["voluntary", "event_cancelled", "interrupted", "policy"]);
export const NOTIFICATION_KINDS = Object.freeze(["brdcst-payment", "brdcst-started", "brdcst-ended", "brdcst-refund"]);

const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN);
const ms = (v) => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v)));
export const MI_PER_KM = 0.621371;

/** Haversine, in miles. Null when either point is unknown. */
export function distanceMi(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s))) * MI_PER_KM;
}

/** Is the event still ahead at `now`? An ended event cannot be promoted. */
export function eventLive(ev, now = Date.now()) {
  if (!ev) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  if (ev.endsAt) return String(ev.endsAt) >= today;
  if (ev.startsAt) return String(ev.startsAt) >= today;
  return true;
}

/** The targeting, validated and clamped: radius 50–500 mi, breadth 0–1, a preset duration. */
export function normalizeTargeting({ radiusMi = BASE_RADIUS_MI, tasteBreadth = 0, durationDays = 7 } = {}) {
  const errors = [];
  const r = Number(radiusMi);
  if (!Number.isFinite(r)) errors.push({ code: "radius", message: "the radius is a number of miles" });
  const radius = Math.min(MAX_RADIUS_MI, Math.max(BASE_RADIUS_MI, Math.round(Number.isFinite(r) ? r : BASE_RADIUS_MI)));
  const b = Number(tasteBreadth);
  if (!Number.isFinite(b)) errors.push({ code: "breadth", message: "taste breadth is between 0 and 1" });
  const breadth = Math.min(1, Math.max(0, Number.isFinite(b) ? Math.round(b * 100) / 100 : 0));
  const d = int(durationDays);
  if (!DURATIONS.includes(d)) errors.push({ code: "duration", message: `a campaign runs ${DURATIONS.join(", ")} days` });
  return { ok: errors.length === 0, errors, radiusMi: radius, tasteBreadth: breadth, durationDays: DURATIONS.includes(d) ? d : 7 };
}

/** The cosine floor for a breadth: 0 keeps the familiarity line, 1 reaches everyone with any taste. */
export function matchFloor(tasteBreadth = 0) {
  const b = Math.min(1, Math.max(0, Number(tasteBreadth) || 0));
  return Math.round(TASTE_FLOOR * (1 - b) * 1000) / 1000;
}

/** The itemized quote (5.19): per-day lines times the days. Never discounted, never rounded up. */
export function quote({ radiusMi, tasteBreadth, durationDays, days = null } = {}) {
  const t = normalizeTargeting({ radiusMi, tasteBreadth, durationDays });
  const n = days == null ? t.durationDays : Math.max(0, int(days) || 0);
  const geoMiles = t.radiusMi - BASE_RADIUS_MI;
  const geoDay = geoMiles * PRICE.geoCentsPerMileDay;
  const tasteDay = Math.round(PRICE.tasteMaxCentsPerDay * t.tasteBreadth);
  const perDay = PRICE.baseDayCents + geoDay + tasteDay;
  return {
    ok: t.ok, errors: t.errors, currency: PRICE.currency,
    targeting: { radiusMi: t.radiusMi, tasteBreadth: t.tasteBreadth, durationDays: t.durationDays, matchFloor: matchFloor(t.tasteBreadth) },
    days: n, perDayCents: perDay,
    lines: [
      { id: "base", label: "BASE", perDayCents: PRICE.baseDayCents, cents: PRICE.baseDayCents * n },
      { id: "duration", label: `${n} DAY${n === 1 ? "" : "S"}`, perDayCents: null, cents: null },
      { id: "geo", label: geoMiles > 0 ? `REACH +${geoMiles} MI` : `REACH ${BASE_RADIUS_MI} MI`, perDayCents: geoDay, cents: geoDay * n },
      { id: "taste", label: t.tasteBreadth > 0 ? `TASTE +${Math.round(t.tasteBreadth * 100)}%` : "TASTE MATCHED", perDayCents: tasteDay, cents: tasteDay * n },
    ],
    totalCents: perDay * n,
  };
}

/**
 * The forecast (5.18): a transparent range around a REAL audience count the
 * store measured — passports whose taste clears the floor inside the radius.
 * Impressions are bounded by the feed's own law (at most one footer per
 * matching passenger per active day); nothing here promises a result.
 */
export function forecast({ audience = 0, durationDays = 7, radiusMi = BASE_RADIUS_MI, center = null, measured = true } = {}) {
  const n = Math.max(0, int(audience) || 0);
  const days = int(durationDays) || 0;
  return {
    measured: !!measured,
    audience: { low: Math.floor(n * 0.8), high: Math.ceil(n * 1.2), counted: n },
    impressions: { atMost: n * days, basis: "one footer per matching passenger per active day" },
    coverage: { radiusMi: Number(radiusMi) || BASE_RADIUS_MI, center: center ? { lat: center.lat, lng: center.lng, label: center.label || null } : null },
    note: "estimates — impressions, attendance and results are not guaranteed (Terms 15.2)",
  };
}

/** The start and end a payment fixes (5.21–5.23): the duration begins when the campaign actually starts; a late payment bills the remaining days only. */
export function schedule({ scheduledStart = null, durationDays, paidAt, bonusDays = 0 } = {}) {
  const d = int(durationDays) || 0;
  const paid = ms(paidAt);
  const start = ms(scheduledStart);
  const extra = Math.max(0, int(bonusDays) || 0);
  if (!Number.isFinite(paid)) return { ok: false, reason: "a schedule follows a payment" };
  if (!Number.isFinite(start) || start <= paid) {
    // launch now, or a scheduled start that has already passed
    const begin = paid;
    if (Number.isFinite(start) && start < paid) {
      const plannedEnd = start + d * DAY;
      const remaining = Math.ceil((plannedEnd - paid) / DAY);
      if (remaining <= 0) return { ok: false, reason: "the scheduled window has passed — choose a new start" };
      return { ok: true, startsAt: new Date(begin).toISOString(), endsAt: new Date(plannedEnd + extra * DAY).toISOString(), billedDays: remaining, late: true, bonusDays: extra };
    }
    return { ok: true, startsAt: new Date(begin).toISOString(), endsAt: new Date(begin + (d + extra) * DAY).toISOString(), billedDays: d, late: false, bonusDays: extra };
  }
  return { ok: true, startsAt: new Date(start).toISOString(), endsAt: new Date(start + (d + extra) * DAY).toISOString(), billedDays: d, late: false, bonusDays: extra };
}

/** The state at `now` from the record (lazy, never stored ahead of time). */
export function stateAt(c, now = Date.now()) {
  if (!c) return "draft";
  if (c.state === "cancelled" || c.state === "under_review") return c.state;
  if (!c.paidAt) return "draft";
  const s = ms(c.startsAt), e = ms(c.endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "draft";
  if (now < s) return "scheduled";
  if (now < e) return "active";
  return "ended";
}

/** Full-day billing (5.24): the days used by `now`, the unused ones, and the refund for them. */
export function usage(c, now = Date.now()) {
  const s = ms(c?.startsAt), e = ms(c?.endsAt);
  const perDay = int(c?.perDayCents) || 0;
  const billed = int(c?.billedDays) || 0;
  if (!c || !c.paidAt || !Number.isFinite(s) || !Number.isFinite(e)) return { usedDays: 0, unusedDays: 0, refundCents: 0 };
  if (now <= s) return { usedDays: 0, unusedDays: billed, refundCents: billed * perDay };
  const bonus = Math.max(0, int(c.bonusDays) || 0);
  const totalDays = Math.max(1, Math.round((e - s) / DAY));
  const used = Math.min(totalDays, Math.ceil((now - s) / DAY));
  // bonus days were free: they run last and never refund
  const unused = Math.max(0, Math.min(billed, totalDays - used - bonus));
  return { usedDays: used, unusedDays: unused, refundCents: unused * perDay };
}

/** Is a refund owed on this cancellation (5.25)? Policy violations are a separate review. */
export function refundPolicy(reason) {
  if (!CANCEL_REASONS.includes(reason)) return { ok: false, reason: "a cancellation is voluntary, the event's, an interruption or a policy review" };
  if (reason === "policy") return { ok: true, refund: "review", reason: "a campaign that violates the Policies is reviewed separately and may be refused a refund (15.5)" };
  return { ok: true, refund: "unused_days", reason: "completely unused days are refunded" };
}

/** The refund offer (5.26): credit first with the bonus — two days or 45 miles — the original method only after declining. */
export function refundOffer({ amountCents } = {}) {
  const a = int(amountCents);
  if (!(a > 0)) return { ok: false, reason: "no unused day to refund" };
  return { ok: true, first: "credit", credit: { amountCents: a, bonus: { ...REFUND_BONUS, either: true } }, original: { amountCents: a, offeredAfterDecline: true } };
}

/** The bonus a credit share earns (5.29–5.30), the passenger's unit: whole days or whole miles, rounded down. */
export function creditShareBonus({ creditCents = 0, totalCents = 0, as = "days" } = {}) {
  const c = Math.max(0, int(creditCents) || 0), t = int(totalCents);
  if (!(t > 0) || c <= 0) return { kind: as === "miles" ? "miles" : "days", amount: 0, share: 0 };
  const share = Math.min(1, c / t);
  const kind = as === "miles" ? "miles" : "days";
  return { kind, amount: Math.floor(share * REFUND_BONUS[kind]), share: Math.round(share * 1000) / 1000 };
}

/** Is a payment reminder due (5.23)? At once on failure, then every three hours until resolved, unless muted. */
export function reminderDue(c, now = Date.now()) {
  if (!c || !c.paymentFailedAt || c.paidAt || c.remindersMuted) return false;
  const last = ms(c.lastReminderAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= REMINDER_EVERY_MS;
}

/**
 * Delivery for one viewer (5.13–5.15, 9.13). `match` is the cosine between
 * the post's tags and the viewer's taste (null = no taste on record);
 * `distanceMi` null = location unknown. Answers what to show: the post, and
 * whether the footer rides on it. The author always sees their own post with
 * the campaign's state on the footer.
 */
export function deliver({ campaign = null, viewer = {}, now = Date.now() } = {}) {
  if (viewer.author) return { post: true, footer: true, reason: "yours", state: stateAt(campaign, now) };
  if (viewer.blocked) return { post: false, footer: false, reason: "blocked" };
  const state = stateAt(campaign, now);
  if (state !== "active") return { post: true, footer: false, reason: campaign ? `campaign ${state}` : "no campaign — the broadcast waits in Drafts", state };
  const floor = matchFloor(campaign.tasteBreadth);
  const match = viewer.match == null ? null : Number(viewer.match);
  if (match == null || !(match >= floor)) return { post: false, footer: false, reason: match == null ? "no taste on record to match" : "taste below the floor", state, floor, match };
  const d = viewer.distanceMi == null ? null : Number(viewer.distanceMi);
  if (d == null) return { post: true, footer: false, reason: "location unknown — the broadcast reaches a radius", state, floor, match };
  if (d > campaign.radiusMi) return { post: true, footer: false, reason: `beyond the ${campaign.radiusMi}-mile radius`, state, floor, match, distanceMi: Math.round(d) };
  return { post: true, footer: true, reason: "in reach", state, floor, match, distanceMi: Math.round(d) };
}

/** The footer's pages (5.10–5.12): soonest first, ended events dropped, five per page, "+N" beside the expander. */
export function footerPages(events = [], { now = Date.now(), page = 0 } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const live = (events || []).filter((e) => e && !(e.endsAt && e.endsAt < today) && !(!e.endsAt && e.startsAt && e.startsAt < today));
  live.sort((a, b) => String(a.startsAt || "9999").localeCompare(String(b.startsAt || "9999")));
  const pages = Math.max(1, Math.ceil(live.length / FOOTER_PAGE));
  const p = Math.min(Math.max(0, int(page) || 0), pages - 1);
  const visible = live.slice(p * FOOTER_PAGE, (p + 1) * FOOTER_PAGE);
  return { visible, page: p, pages, total: live.length, more: Math.min(FOOTER_PAGE, Math.max(0, live.length - 1)), next: p + 1 < pages };
}
