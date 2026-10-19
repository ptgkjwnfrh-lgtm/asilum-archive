// app/api/sweeps/route.js — THE CLOCKS, RUN BY THE CRON (V.2 slice 11: the
// laws that were "scheduled by the law, not sent by a job"). One guarded
// endpoint (lib/steward/cronGate.js, the same gate the steward's run uses)
// that vercel.json fires ONCE A DAY (06:07 UTC). It was hourly; the Vercel
// Hobby plan refuses any cron finer than daily and rejected every deployment
// that declared one (18 Oct 2026). Until the plan allows hourly, each clock
// below advances at most daily — states read at request time (an expired
// offer reads expired, a lapsed checkout reads lapsed) are unaffected; the
// sends and releases (reminders, discount restores, payout releases) wait
// for the day's run:
//   BRDCST     failed-payment reminders every three hours until resolved (5.23)
//   offers     the seller's reminder preset before an offer expires (7.20);
//              expired offers read expired (7.17)
//   discounts  a discount past 24 hours restores its price (7.31)
//   wardrobe   unanswered offers expire, accepted-but-unpaid lapse (13.9, 13.11);
//              gifts past 14 days expire
//   payouts    every paid order's payout follows its window (10.12–10.13)
// Every count is the job's own; nothing is claimed that did not run.

import { NextResponse } from "next/server";
import { cronGate } from "../../../lib/steward/cronGate.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function fire(req) {
  const gate = cronGate(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const ranAt = new Date().toISOString();
  const out = { ranAt, brdcstReminders: null, offerReminders: null, offersExpired: null, discountsExpired: null, wardrobeOffers: null, giftsExpired: null, payouts: null, errors: [] };
  const step = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out.errors.push({ step: key, error: String(e && e.message || e).slice(0, 200) }); } };
  await step("brdcstReminders", async () => (await import("../../../lib/db/production/brdcst.js")).sweepPaymentReminders());
  await step("offerReminders", async () => (await import("../../../lib/db/production/commerce.js")).sweepOfferReminders());
  await step("offersExpired", async () => (await import("../../../lib/db/production/commerce.js")).expireOffers());
  await step("discountsExpired", async () => (await import("../../../lib/db/production/commerce.js")).expireDiscounts());
  await step("wardrobeOffers", async () => (await import("../../../lib/db/production/money.js")).sweepWardrobeOffers());
  await step("giftsExpired", async () => (await import("../../../lib/db/production/wardrobeTransfers.js")).expireGifts().then((r) => (typeof r === "number" ? r : (r && r.expired) || 0)));
  await step("payouts", async () => (await import("../../../lib/db/production/money.js")).sweepPayouts());
  return NextResponse.json(out, { status: out.errors.length ? 207 : 200 });
}

export const GET = fire;
export const POST = fire;
