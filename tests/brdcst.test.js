// tests/brdcst.test.js — BRDCST OUTREACH AND BILLING (V.2 Blueprint, owner,
// 17 Oct 2026, chapter 5 5.10–5.28, 9.13, Terms 15; slice 8). The law
// (lib/brdcst/index.js) is pure; the rows (lib/db/production/brdcst.js) run
// on the memory store; the routes through the harness. Held here:
//   * taste first, distance second: a matching passport beyond the paid
//     radius sees the post bare; a cold or non-matching one does not see a
//     promoted post on the feed; a block hides it; the author always sees
//     their own with the campaign's state;
//   * the itemized quote is per day and never discounted; the forecast is a
//     range around a measured count and says results vary;
//   * the duration begins when the campaign actually starts; a late payment
//     bills the remaining days only; a passed window is refused;
//   * full-day billing: any started day counts; completely unused days
//     refund, Credit first with two days or 45 miles, the original method
//     only on decline; bonus days never refund; a policy review refunds
//     nothing until decided;
//   * credit pays in the exact amount chosen, never more than the quote, and
//     earns the bonus in proportion rounded down; without a card provider the
//     remainder cannot be charged and the campaign waits in Drafts;
//   * a failed payment reminds at once and every three hours unless muted;
//   * the footer: soonest first, five per page, +N beside the expander.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../lib/brdcst/index.js";
import * as B from "../lib/db/production/brdcst.js";
import * as C from "../lib/db/production/credit.js";
import { createEditorialPost } from "../lib/db/production/editorial.js";
import { saveProfile } from "../lib/db/core/profiles.js";
import { putUserRecord } from "../lib/db/production/records.js";
import { listNotifications, resetMemoryListingStatus } from "../lib/db/production/listingStatus.js";
import { listPlaces, PLACES, placeRating, mapsUrl, milesLabel } from "../lib/places/registry.js";
import { eventsOf, validateComposition, attachmentsFor } from "../lib/wire/compose.js";
import { addEvent, removeEvent, newDraft } from "../lib/wire/draft.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const T0 = Date.parse("2026-10-18T00:00:00Z");
const D = 86_400_000;
const H = 3_600_000;
const uuid = () => globalThis.crypto.randomUUID();
// a sourced dated row from the map, moved ahead of T0: the store takes event
// rows as the route resolved them, and an ended event cannot be promoted
const PAST = listPlaces({ dated: true }).find((p) => !p.sample && Number.isFinite(p.lat));
const EV = { ...PAST, startsAt: "2026-11-20", endsAt: "2026-11-22" };
// the route resolves ids on the registry itself, so it needs a row that is still ahead
const LIVE_ROW = listPlaces({ dated: true }).find((p) => !p.sample && L.eventLive(p));
const LIVE = { paidAt: T0, startsAt: new Date(T0).toISOString(), endsAt: new Date(T0 + 7 * D).toISOString(), radiusMi: 50, tasteBreadth: 0, perDayCents: 300, billedDays: 7, bonusDays: 0, state: "active" };

test.beforeEach(() => { B.resetMemoryBrdcst(); C.resetMemoryCredit(); resetMemoryListingStatus(); });

test("the law: targeting clamps, the quote itemizes per day, the floor widens with breadth", () => {
  assert.deepEqual(L.normalizeTargeting({ radiusMi: 10, tasteBreadth: 2, durationDays: 7 }).radiusMi, 50, "never below the base radius");
  assert.equal(L.normalizeTargeting({ radiusMi: 9999 }).radiusMi, L.MAX_RADIUS_MI);
  assert.equal(L.normalizeTargeting({ durationDays: 5 }).ok, false, "1, 3, 7, 14 or 30");
  const q = L.quote({ radiusMi: 100, tasteBreadth: 0.5, durationDays: 7 });
  assert.equal(q.perDayCents, 300 + 50 * 3 + 250); assert.equal(q.totalCents, q.perDayCents * 7);
  assert.equal(L.quote({ radiusMi: 50, tasteBreadth: 0, durationDays: 7 }).totalCents, 2100, "a small band's week in the base radius: USD 21 (A6)");
  assert.equal(L.quote({ radiusMi: 200, tasteBreadth: 0, durationDays: 7 }).totalCents, 5250);
  assert.deepEqual(q.lines.map((l) => l.id), ["base", "duration", "geo", "taste"]);
  assert.equal(L.quote({ radiusMi: 50, tasteBreadth: 0, durationDays: 30 }).totalCents, 300 * 30, "no volume discount — per day (5.23)");
  assert.equal(L.matchFloor(0), L.TASTE_FLOOR); assert.equal(L.matchFloor(1), 0); assert.ok(L.matchFloor(0.5) < L.TASTE_FLOOR);
  const f = L.forecast({ audience: 10, durationDays: 7, radiusMi: 50 });
  assert.deepEqual(f.audience, { low: 8, high: 12, counted: 10 }); assert.equal(f.impressions.atMost, 70); assert.match(f.note, /not guaranteed/);
});

test("the law: the schedule begins when the campaign starts; a late payment bills the remaining days; a passed window is refused", () => {
  const now = L.schedule({ durationDays: 7, paidAt: T0 });
  assert.equal(now.startsAt, new Date(T0).toISOString()); assert.equal(now.billedDays, 7); assert.equal(now.late, false);
  const ahead = L.schedule({ scheduledStart: T0 + 5 * D, durationDays: 7, paidAt: T0 });
  assert.equal(ahead.startsAt, new Date(T0 + 5 * D).toISOString()); assert.equal(ahead.endsAt, new Date(T0 + 12 * D).toISOString());
  const late = L.schedule({ scheduledStart: T0, durationDays: 7, paidAt: T0 + 2 * D + H });
  assert.equal(late.late, true); assert.equal(late.billedDays, 5, "the 15th to the 21st paid on the 17th pays five days (5.23)"); assert.equal(late.endsAt, new Date(T0 + 7 * D).toISOString());
  assert.equal(L.schedule({ scheduledStart: T0, durationDays: 7, paidAt: T0 + 8 * D }).ok, false);
  assert.equal(L.schedule({ durationDays: 7, paidAt: T0, bonusDays: 2 }).endsAt, new Date(T0 + 9 * D).toISOString(), "bonus days extend the run");
  assert.equal(L.stateAt({ ...LIVE }, T0 - 1), "scheduled"); assert.equal(L.stateAt({ ...LIVE }, T0 + D), "active"); assert.equal(L.stateAt({ ...LIVE }, T0 + 7 * D), "ended");
  assert.equal(L.stateAt({ ...LIVE, paidAt: null }), "draft"); assert.equal(L.stateAt({ ...LIVE, state: "cancelled" }), "cancelled");
});

test("the law: full-day billing — a day with an active BRDCST counts in full; only completely unused days refund; bonus days never", () => {
  assert.deepEqual(L.usage(LIVE, T0 + 2 * D + 14 * H), { usedDays: 3, unusedDays: 4, refundCents: 1200 }, "cancelled at 2 PM on day three: three days used (5.24)");
  assert.deepEqual(L.usage(LIVE, T0 - D), { usedDays: 0, unusedDays: 7, refundCents: 2100 }, "not started: everything refunds");
  assert.deepEqual(L.usage(LIVE, T0 + 9 * D), { usedDays: 7, unusedDays: 0, refundCents: 0 });
  assert.deepEqual(L.usage({ ...LIVE, endsAt: new Date(T0 + 9 * D).toISOString(), bonusDays: 2 }, T0 + 6 * D), { usedDays: 6, unusedDays: 1, refundCents: 300 }, "the two bonus days at the end are free and do not refund");
  assert.equal(L.refundPolicy("voluntary").refund, "unused_days"); assert.equal(L.refundPolicy("interrupted").refund, "unused_days"); assert.equal(L.refundPolicy("policy").refund, "review"); assert.equal(L.refundPolicy("bored").ok, false);
  const offer = L.refundOffer({ amountCents: 600 });
  assert.equal(offer.first, "credit"); assert.deepEqual(offer.credit.bonus, { days: 2, miles: 45, either: true }); assert.equal(offer.original.offeredAfterDecline, true);
  assert.equal(L.refundOffer({ amountCents: 0 }).ok, false);
});

test("the law: the credit share earns the bonus in proportion, rounded down; reminders every three hours unless muted", () => {
  assert.deepEqual(L.creditShareBonus({ creditCents: 2100, totalCents: 2100, as: "days" }), { kind: "days", amount: 2, share: 1 });
  assert.deepEqual(L.creditShareBonus({ creditCents: 1050, totalCents: 2100, as: "miles" }), { kind: "miles", amount: 22, share: 0.5 }, "half of 45 rounds down");
  assert.equal(L.creditShareBonus({ creditCents: 700, totalCents: 2100, as: "days" }).amount, 0, "a third of two days is no day");
  assert.equal(L.reminderDue({ paymentFailedAt: T0, lastReminderAt: null }, T0), true);
  assert.equal(L.reminderDue({ paymentFailedAt: T0, lastReminderAt: T0 }, T0 + 2 * H), false);
  assert.equal(L.reminderDue({ paymentFailedAt: T0, lastReminderAt: T0 }, T0 + 3 * H), true);
  assert.equal(L.reminderDue({ paymentFailedAt: T0, lastReminderAt: T0, remindersMuted: true }, T0 + 9 * H), false);
  assert.equal(L.reminderDue({ paymentFailedAt: T0, paidAt: T0 + H }, T0 + 9 * H), false, "resolved");
});

test("the law: delivery — taste first, distance second, blocks suppress, the author always", () => {
  const c = { ...LIVE };
  assert.deepEqual(L.deliver({ campaign: c, viewer: { match: 0.5, distanceMi: 10 }, now: T0 + D }).footer, true);
  const far = L.deliver({ campaign: c, viewer: { match: 0.5, distanceMi: 100 }, now: T0 + D });
  assert.deepEqual([far.post, far.footer], [true, false], "a matching passenger 100 miles away sees the post but not the broadcast (5.13–5.14)");
  assert.equal(L.deliver({ campaign: c, viewer: { match: 0.1, distanceMi: 10 }, now: T0 + D }).post, false, "below the floor: not in this Feed");
  assert.equal(L.deliver({ campaign: c, viewer: { match: null, distanceMi: 10 }, now: T0 + D }).post, false, "no taste on record cannot be claimed as a match");
  assert.equal(L.deliver({ campaign: { ...c, tasteBreadth: 1 }, viewer: { match: 0.01, distanceMi: 10 }, now: T0 + D }).footer, true, "full breadth reaches any taste");
  const unknown = L.deliver({ campaign: c, viewer: { match: 0.5, distanceMi: null }, now: T0 + D });
  assert.deepEqual([unknown.post, unknown.footer], [true, false], "an unknown location is not inside a radius");
  assert.deepEqual(L.deliver({ campaign: c, viewer: { blocked: true, match: 0.9, distanceMi: 1 }, now: T0 + D }).post, false, "9.13");
  assert.deepEqual(L.deliver({ campaign: c, viewer: { author: true }, now: T0 + 30 * D }).footer, true);
  assert.equal(L.deliver({ campaign: null, viewer: { match: 0.9, distanceMi: 1 } }).footer, false, "no campaign: the broadcast waits in Drafts");
  assert.equal(L.deliver({ campaign: c, viewer: { match: 0.9, distanceMi: 1 }, now: T0 + 8 * D }).footer, false, "ended");
});

test("the law: the footer pages — soonest first, ended dropped, five per page, +N", () => {
  const evs = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: "e" + i, startsAt: `2026-11-${String(20 - i).padStart(2, "0")}` })).concat([{ id: "old", startsAt: "2026-09-01", endsAt: "2026-09-01" }]);
  const p0 = L.footerPages(evs, { now: T0, page: 0 });
  assert.equal(p0.total, 7); assert.equal(p0.pages, 2); assert.equal(p0.more, 5, "+1–5 beside the expander (5.11)"); assert.equal(p0.next, true);
  assert.deepEqual(p0.visible.map((e) => e.id), ["e7", "e6", "e5", "e4", "e3"], "soonest to latest");
  assert.deepEqual(L.footerPages(evs, { now: T0, page: 1 }).visible.map((e) => e.id), ["e2", "e1"]);
  assert.equal(L.footerPages([{ id: "a" }], { now: T0 }).more, 0);
  assert.equal(L.footerPages([{ id: "a", startsAt: "2026-10-01" }], { now: T0 }).total, 0, "an ended event is never shown live");
});

test("the composition: several BRDCSTs on one post, the first in the legacy slot, bounded", () => {
  let d = addEvent(newDraft(), { id: "a", name: "A" });
  d = addEvent(d, { id: "b", name: "B" }); d = addEvent(d, { id: "a", name: "A again" });
  assert.deepEqual(eventsOf(d.composition).map((e) => e.id), ["a", "b"]); assert.equal(d.composition.layout, "event"); assert.equal(d.composition.event.id, "a");
  d = removeEvent(d, "a");
  assert.deepEqual(eventsOf(d.composition).map((e) => e.id), ["b"]); assert.equal(d.composition.event.id, "b");
  d = removeEvent(d, "b"); assert.equal(d.composition.event, null); assert.equal(d.composition.layout, null);
  assert.equal(validateComposition({ text: "x", events: [{ id: "ok" }, { name: "no id" }] }).errors[0].code, "unresolved-event");
  assert.equal(validateComposition({ text: "x", events: Array.from({ length: 21 }, (_, i) => ({ id: "ev" + i })) }).errors[0].code, "too-many-events");
  const a = attachmentsFor({ text: "x", events: [{ id: "ev-a" }, { id: "ev-b" }] }, { eventSnapshots: [{ id: "ev-a", name: "A" }, { id: "ev-b", name: "B" }] });
  assert.equal(a.event.id, "ev-a"); assert.deepEqual(a.events.map((e) => e.id), ["ev-a", "ev-b"]);
  assert.equal(attachmentsFor({ text: "x", event: { id: "ev-a" } }, { eventSnapshot: { id: "ev-a" } }).events, undefined, "one event: the legacy slot alone");
});

test("the store: a draft, the real forecast, credit pays in the exact amount, the bonus banks, cancellation refunds unused days as Credit with the bonus", async () => {
  const owner = "sb-" + uuid(), near = "sb-" + uuid();
  await C.creditIn({ userId: owner, source: "refund", amountCents: 5000, now: T0 });
  await assert.rejects(() => B.createCampaign({ ownerId: owner, events: [{ id: "s", sample: true, name: "s" }], radiusMi: 50, durationDays: 7 }), /sample fixture/);
  await assert.rejects(() => B.createCampaign({ ownerId: owner, events: [], radiusMi: 50, durationDays: 7 }), /the map knows/);
  await assert.rejects(() => B.createCampaign({ ownerId: owner, events: [PAST], radiusMi: 50, durationDays: 7, now: T0 }), /has ended/);
  assert.equal(L.eventLive(PAST, T0), false); assert.equal(L.eventLive(EV, T0), true); assert.equal(L.eventLive({ id: "x" }, T0), true, "an undated row is a venue, always ahead");
  const c = await B.createCampaign({ ownerId: owner, postId: "p1", events: [EV], tags: ["ARCHIVAL"], radiusMi: 100, tasteBreadth: 0, durationDays: 7, now: T0 });
  assert.equal(c.state, "draft"); assert.equal(c.totalCents, (300 + 150) * 7); assert.deepEqual(c.center, { lat: EV.lat, lng: EV.lng });
  assert.equal((await B.estimateAudience({ tags: ["ARCHIVAL"], radiusMi: 100, center: c.center })).audience.counted, 0, "nobody placed yet — the forecast counts, never invents");
  await saveProfile(near, { long: { ARCHIVAL: 0.9 }, session: {} });
  await putUserRecord(near, { kind: "location", recordId: "base", payload: { baseCity: { name: "n", lat: EV.lat + 0.1, lng: EV.lng } } });
  assert.equal((await B.estimateAudience({ tags: ["ARCHIVAL"], radiusMi: 100, center: c.center })).audience.counted, 1);
  assert.equal((await B.estimateAudience({ tags: ["TECHNO"], radiusMi: 100, center: c.center })).audience.counted, 0, "taste first");
  assert.equal((await B.estimateAudience({ tags: ["ARCHIVAL"], radiusMi: 50, center: { lat: EV.lat + 3, lng: EV.lng } })).audience.counted, 0, "distance second");
  await assert.rejects(() => B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: c.totalCents + 1, now: T0 }), /exceed the quote/);
  await assert.rejects(() => B.payCampaign({ campaignId: c.id, ownerId: "sb-else", creditCents: 0, now: T0 }), /not your campaign/);
  await assert.rejects(() => B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: 100, now: T0 }), /card payment is idle/, "a remainder needs a provider; the broadcast waits in Drafts (5.22)");
  assert.equal(await C.creditBalance(owner), 5000, "a refused payment spends nothing");
  const paid = await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: c.totalCents, bonusAs: "days", now: T0 });
  assert.equal(paid.paid, true); assert.equal(paid.via, "credit"); assert.equal(paid.campaign.state, "active"); assert.deepEqual(paid.bonus, { kind: "days", amount: 2, share: 1 });
  assert.equal(await C.creditBalance(owner), 5000 - c.totalCents);
  assert.deepEqual((await B.bonusBank(owner)).days, 2);
  await assert.rejects(() => B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: 0, now: T0 }), /is paid/);
  assert.equal((await B.liveCampaigns(T0 + D)).length, 1); assert.equal((await B.liveCampaigns(T0 + 8 * D)).length, 0);
  // day three, afternoon: three days used, four refund, as Credit with 45 miles
  const r = await B.cancelCampaign({ campaignId: c.id, by: owner, reason: "voluntary", refundTo: "credit", bonusAs: "miles", now: T0 + 2 * D + 14 * H });
  assert.equal(r.campaign.state, "cancelled"); assert.equal(r.refund.amountCents, 4 * 450); assert.equal(r.refund.to, "credit"); assert.deepEqual(r.refund.bonus, { kind: "miles", amount: 45 });
  assert.equal(await C.creditBalance(owner), 5000 - c.totalCents + 1800);
  assert.deepEqual([(await B.bonusBank(owner)).days, (await B.bonusBank(owner)).miles], [2, 45]);
  await assert.rejects(() => B.cancelCampaign({ campaignId: c.id, by: owner, now: T0 + 3 * D }), /already cancelled/);
  const kinds = (await listNotifications(owner)).map((n) => n.kind).sort();
  assert.deepEqual(kinds, ["brdcst-refund", "brdcst-started"]);
});

test("the store: a scheduled campaign paid late bills the remaining days; banked bonus days redeem onto it; the original method returns the credit share to credit", async () => {
  const owner = "sb-" + uuid();
  await C.creditIn({ userId: owner, source: "gift", amountCents: 10000, now: T0 });
  const first = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 7, now: T0 });
  await B.payCampaign({ campaignId: first.id, ownerId: owner, creditCents: first.totalCents, bonusAs: "days", now: T0 });
  assert.equal((await B.bonusBank(owner)).days, 2);
  const c = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 7, scheduledStart: new Date(T0 + 10 * D).toISOString(), now: T0 });
  await assert.rejects(() => B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: 0, useBonusDays: 3, now: T0 + 12 * D }), /only 2 bonus days/);
  const pq = B.payQuote(c, { now: T0 + 12 * D, bonusDays: 2 });
  assert.equal(pq.schedule.billedDays, 5); assert.equal(pq.totalCents, 1500);
  const paid = await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: 1500, useBonusDays: 2, bonusAs: "miles", now: T0 + 12 * D });
  assert.equal(paid.campaign.billedDays, 5); assert.equal(paid.campaign.bonusDays, 2); assert.equal(paid.campaign.endsAt, new Date(T0 + 19 * D).toISOString(), "five billed days to the planned end, then two bonus days");
  assert.equal((await B.bonusBank(owner)).days, 0, "redeemed"); assert.equal((await B.bonusBank(owner)).miles, 45, "and the credit share earned miles");
  assert.equal(L.stateAt(paid.campaign, T0 + 12 * D), "active");
  // the original method: the credit share comes back as credit; no card share here, no bonus
  const r = await B.cancelCampaign({ campaignId: c.id, by: owner, reason: "event_cancelled", refundTo: "original", now: T0 + 13 * D + H });
  assert.equal(r.refund.to, "original"); assert.equal(r.refund.amountCents, 3 * 300, "two days used of five billed; the bonus days never refund"); assert.equal(r.refund.creditCents, 900); assert.equal(r.refund.cardCents, 0); assert.equal(r.refund.bonus, undefined);
  assert.equal(await C.creditBalance(owner), 10000 - first.totalCents - 1500 + 900);
  assert.equal(B.payQuote({ ...c, scheduledStart: new Date(T0).toISOString() }, { now: T0 + 8 * D }).ok, false, "a passed window is refused");
});

test("the store: an admin interrupts or parks under review; a review decides refund or refuse; reminders sweep every three hours unless muted", async () => {
  const owner = "sb-" + uuid();
  await C.creditIn({ userId: owner, source: "refund", amountCents: 9000, now: T0 });
  const c = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 7, now: T0 });
  await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: c.totalCents, now: T0 });
  await assert.rejects(() => B.cancelCampaign({ campaignId: c.id, by: owner, reason: "interrupted", now: T0 + D }), /ASILUM's/, "a passenger does not declare an interruption");
  const parked = await B.cancelCampaign({ campaignId: c.id, by: "admin", reason: "policy", now: T0 + D + H });
  assert.equal(parked.campaign.state, "under_review"); assert.equal(parked.refund, null); assert.equal(parked.campaign.refund.pending, "review");
  assert.equal((await B.liveCampaigns(T0 + 2 * D)).length, 0, "under review stops delivery");
  const decided = await B.decideReview({ campaignId: c.id, refund: true, note: "fine after all", now: T0 + 2 * D });
  assert.equal(decided.state, "cancelled"); assert.equal(decided.refund.decided, "refunded"); assert.equal(decided.refund.amountCents, 5 * 300);
  assert.equal(await C.creditBalance(owner), 9000 - 2100 + 1500);
  const c2 = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 3, now: T0 });
  await B.payCampaign({ campaignId: c2.id, ownerId: owner, creditCents: 900, now: T0 });
  const stopped = await B.cancelCampaign({ campaignId: c2.id, by: "admin", reason: "interrupted", now: T0 + 10 * H });
  assert.equal(stopped.refund.amountCents, 600); assert.deepEqual(stopped.refund.bonus, { kind: "days", amount: 2 });
  // a failed card payment: the clock
  const c3 = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 1, now: T0 });
  // simulate the settle path's failure branch directly through the store's row (no provider here)
  const failed = { ...c3, paymentFailedAt: new Date(T0).toISOString(), lastReminderAt: new Date(T0).toISOString() };
  const { mem } = await import("../lib/db/production/store.js");
  mem.brdcstCampaigns.set(c3.id, { ...mem.brdcstCampaigns.get(c3.id), payment_failed_at: failed.paymentFailedAt, last_reminder_at: failed.lastReminderAt });
  assert.equal(await B.sweepPaymentReminders(T0 + 2 * H), 0);
  assert.equal(await B.sweepPaymentReminders(T0 + 3 * H), 1);
  assert.equal(await B.sweepPaymentReminders(T0 + 4 * H), 0, "not again inside three hours");
  await B.muteReminders({ campaignId: c3.id, ownerId: owner, muted: true });
  assert.equal(await B.sweepPaymentReminders(T0 + 9 * H), 0, "muted");
  assert.equal((await listNotifications(owner)).filter((n) => n.kind === "brdcst-payment").length, 1);
});

test("delivery through the store: in reach, beyond the radius, cold, blocked-free mem, the author; the ticker's SPONSORED slot", async () => {
  const owner = "sb-" + uuid(), near = "sb-" + uuid(), far = "sb-" + uuid(), cold = "sb-" + uuid(), other = "sb-" + uuid();
  await C.creditIn({ userId: owner, source: "refund", amountCents: 9000, now: T0 });
  const post = await createEditorialPost({ authorId: owner, authorHandle: "h", kind: "user", body: "a show #ARCHIVAL", tags: ["ARCHIVAL"], postKind: "post", layout: "event", attachments: { event: { id: EV.id, name: EV.name, startsAt: EV.startsAt } } });
  const plain = await createEditorialPost({ authorId: other, authorHandle: "o", kind: "user", body: "no event", tags: [] });
  for (const [u, dlat] of [[near, 0.1], [far, 4]]) {
    await saveProfile(u, { long: { ARCHIVAL: 0.9 }, session: {} });
    await putUserRecord(u, { kind: "location", recordId: "base", payload: { baseCity: { name: "x", lat: EV.lat + dlat, lng: EV.lng } } });
  }
  const c = await B.createCampaign({ ownerId: owner, postId: post.id, events: [EV], tags: ["ARCHIVAL"], radiusMi: 50, durationDays: 7, now: T0 });
  const unpaid = await B.deliverPosts([post, plain], { viewerId: near, now: T0 });
  assert.equal(unpaid.length, 2); assert.equal(unpaid[0].attachments.brdcst.footer, false); assert.equal(unpaid[0].attachments.event, undefined, "unpaid: the post, bare");
  await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: c.totalCents, now: T0 });
  const n = await B.deliverPosts([post, plain], { viewerId: near, now: T0 + D });
  assert.equal(n[0].attachments.brdcst.footer, true); assert.equal(n[0].attachments.event.id, EV.id); assert.equal(n[0].attachments.brdcst.radiusMi, 50);
  const f = await B.deliverPosts([post, plain], { viewerId: far, now: T0 + D });
  assert.equal(f.length, 2); assert.equal(f[0].attachments.brdcst.footer, false); assert.equal(f[0].attachments.event, undefined, "beyond the radius: the post without the footer (5.14)");
  assert.deepEqual((await B.deliverPosts([post, plain], { viewerId: cold, now: T0 + D })).map((p) => p.id), [plain.id], "no taste on record: the promoted post is not in this Feed");
  assert.equal((await B.deliverPosts([post], { viewerId: cold, now: T0 + D, hide: false })).length, 1, "a permalink shows it bare");
  assert.equal((await B.deliverPosts([post], { viewerId: null, now: T0 + D })).length, 0, "anonymous has no taste to match");
  const a = await B.deliverPosts([post], { viewerId: owner, now: T0 + D });
  assert.deepEqual([a[0].attachments.brdcst.yours, a[0].attachments.brdcst.state, a[0].attachments.brdcst.footer], [true, "active", true]);
  const req = await B.deliverPosts([post], { viewerId: far, lat: EV.lat + 0.2, lng: EV.lng, now: T0 + D });
  assert.equal(req[0].attachments.brdcst.footer, true, "the request's area wins over the base record");
  assert.deepEqual((await B.tickerFor({ viewerId: near, now: T0 + D })).map((r) => r.name), [EV.name]);
  assert.equal((await B.tickerFor({ viewerId: far, now: T0 + D })).length, 0);
  assert.equal((await B.tickerFor({ viewerId: near, now: T0 + 8 * D })).length, 0, "ended");
});

test("the routes: the quote is public and itemized; campaigns are the owner's; pay without a provider waits in Drafts; the feed strips an unpaid footer for a reader", async () => {
  const brdcst = await loadRoute("app/api/brdcst/route.js");
  const editorial = await loadRoute("app/api/editorial/route.js");
  assert.ok(LIVE_ROW, "the map holds a sourced event that is still ahead");
  const q = await callRoute(brdcst.GET, { path: "/api/brdcst", query: { quote: "1", radiusMi: "120", tasteBreadth: "0.25", durationDays: "3", eventId: LIVE_ROW.id, tags: "ARCHIVAL" } });
  assert.equal(q.status, 200); assert.equal(q.body.quote.totalCents, (300 + 70 * 3 + 125) * 3); assert.equal(q.body.forecast.measured, true); assert.match(q.body.forecast.note, /not guaranteed/); assert.equal(q.body.event.id, LIVE_ROW.id); assert.equal(q.body.event.live, true);
  assert.equal((await callRoute(brdcst.GET, { path: "/api/brdcst", query: { quote: "1", eventId: PAST.id } })).body.event.live, false);
  assert.equal((await callRoute(brdcst.GET, { path: "/api/brdcst", query: { quote: "1", durationDays: "9" } })).body.quote.ok, false);
  assert.equal((await callRoute(brdcst.GET, { path: "/api/brdcst" })).status, 401);
  const me = newDevice();
  // slice 10b (Terms 2.2): a device cannot run a BRDCST — it carries no birth date; the
  // harness cannot mint an 18+ account, so create and pay are held by the store tests
  // and the route holds the refusal with the law's own sentence
  const dev = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "create", eventIds: [LIVE_ROW.id], radiusMi: 50, durationDays: 7 } });
  assert.equal(dev.status, 403); assert.equal(dev.body.code, "ACCOUNT_REQUIRED"); assert.match(dev.body.error, /Terms 2\.2/);
  const owner = "sb-" + uuid();
  const c = await B.createCampaign({ ownerId: owner, events: [EV], radiusMi: 50, durationDays: 7 });
  const id = c.id;
  const mine = await callRoute(brdcst.GET, { path: "/api/brdcst", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(mine.status, 200); assert.equal(mine.body.campaigns.length, 0, "the device owns nothing"); assert.deepEqual(mine.body.bonus, { days: 0, miles: 0 }); assert.match(mine.body.payment, /credit only/);
  const notMine = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "pay", id, creditCents: 0 } });
  assert.equal(notMine.status, 403, "pay is behind the same door");
  await assert.rejects(() => B.payCampaign({ campaignId: id, ownerId: owner, creditCents: 0 }), /card payment is idle/);
  await assert.rejects(() => B.payCampaign({ campaignId: id, ownerId: owner, creditCents: 2100 }), /only 0 cents of credit/);
  const preview = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "preview", id } });
  assert.equal(preview.status, 403, "not the device's campaign");
  assert.equal(B.payQuote(c, {}).totalCents, 2100);
  const cancelled = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "cancel", id } });
  assert.equal(cancelled.status, 403);
  const r = await B.cancelCampaign({ campaignId: id, by: owner });
  assert.equal(r.campaign.state, "cancelled"); assert.equal(r.refund, null, "never paid: nothing to refund");
  // the feed path: a reader sees an event-bearing post without its footer until a campaign is live
  await createEditorialPost({ authorId: "sb-" + uuid(), authorHandle: "poster", kind: "user", body: "tonight #ARCHIVAL", tags: ["ARCHIVAL"], postKind: "post", layout: "event", attachments: { event: { id: EV.id, name: EV.name } } });
  const stranger = newDevice();
  const feed = await callRoute(editorial.GET, { path: "/api/editorial", cookies: stranger.cookies, query: { kind: "user", user: stranger.uid } });
  assert.equal(feed.status, 200);
  const served = feed.body.posts.find((p) => p.body === "tonight #ARCHIVAL");
  assert.ok(served, "the post itself is served"); assert.equal(served.attachments.event, undefined); assert.equal(served.attachments.brdcst.footer, false); assert.match(served.attachments.brdcst.reason, /Drafts/);
  assert.equal(served.authorId, undefined, "the author id never leaves the server");
  const ticker = await callRoute(brdcst.GET, { path: "/api/brdcst", query: { ticker: "1" } });
  assert.equal(ticker.status, 200); assert.deepEqual(ticker.body.placements, []);
});

test("slice 14: a place's rating is drawn only from a named source with a count and a link; MAPS is the place's own coordinates", () => {
  for (const p of PLACES) assert.equal(placeRating(p), null, p.id + " carries no sourced rating, so none is drawn");
  assert.equal(placeRating({ rating: { value: 4.6, count: 24000 } }), null, "a figure without a source is never printed");
  assert.equal(placeRating({ rating: { value: 9, count: 3, source: "x", url: "https://x" } }), null, "out of range");
  assert.deepEqual(placeRating({ rating: { value: 4.63, count: 24000, source: "a review source", url: "https://example.org/r" } }), { value: 4.6, count: 24000, source: "a review source", url: "https://example.org/r" });
  assert.match(mapsUrl({ lat: 38.9605, lng: -76.8701 }), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=38\.96050%2C-76\.87010$/);
  assert.equal(mapsUrl({ lat: null, lng: 1 }), null);
  assert.equal(milesLabel(305.4), "305 mi"); assert.equal(milesLabel(0.4), "under a mile"); assert.equal(milesLabel(NaN), "");
});
