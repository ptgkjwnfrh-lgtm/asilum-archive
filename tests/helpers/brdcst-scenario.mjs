// tests/helpers/brdcst-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 8).
// DATABASE_URL empty runs the memory store, set runs Postgres; one JSON line
// both runs must agree on. The Postgres run writes run-unique rows (a post,
// a campaign, credit, bonuses) and leaves them — the ledgers are append-only.
import { randomUUID } from "node:crypto";
import * as B from "../../lib/db/production/brdcst.js";
import * as C from "../../lib/db/production/credit.js";
import { createEditorialPost } from "../../lib/db/production/editorial.js";
import { saveProfile } from "../../lib/db/core/profiles.js";
import { putUserRecord } from "../../lib/db/production/records.js";
import { listNotifications } from "../../lib/db/production/listingStatus.js";
import { listPlaces } from "../../lib/places/registry.js";

const owner = "sb-" + randomUUID();
const near = "sb-" + randomUUID();   // matching taste, inside the radius
const far = "sb-" + randomUUID();    // matching taste, 200+ miles away
const cold = "sb-" + randomUUID();   // no taste on record
const T0 = Date.parse("2026-10-18T00:00:00Z");
const D = 86_400_000;
const out = {};
try {
  const ev = { ...listPlaces({ dated: true }).find((p) => !p.sample && Number.isFinite(p.lat)), startsAt: "2026-11-20", endsAt: "2026-11-22" };
  const post = await createEditorialPost({ authorId: owner, authorHandle: "scn-" + owner.slice(3, 9), kind: "user", body: "a show #ARCHIVAL", tags: ["ARCHIVAL"], postKind: "post", layout: "event", attachments: { event: { id: ev.id, name: ev.name, startsAt: ev.startsAt } } });
  await saveProfile(near, { long: { ARCHIVAL: 0.9 }, session: {} });
  await saveProfile(far, { long: { ARCHIVAL: 0.9 }, session: {} });
  await putUserRecord(near, { kind: "location", recordId: "base", payload: { baseCity: { name: ev.city, lat: ev.lat + 0.1, lng: ev.lng } } });
  await putUserRecord(far, { kind: "location", recordId: "base", payload: { baseCity: { name: "far", lat: ev.lat + 4, lng: ev.lng } } });
  await C.creditIn({ userId: owner, source: "refund", amountCents: 5000, note: "scenario", now: T0 });
  const sample = await B.createCampaign({ ownerId: owner, events: [{ id: "x", sample: true, name: "s" }], radiusMi: 50, durationDays: 7 }).then(() => "allowed").catch((e) => e.code);
  const c = await B.createCampaign({ ownerId: owner, postId: post.id, events: [ev], tags: ["ARCHIVAL"], radiusMi: 100, tasteBreadth: 0.2, durationDays: 7, now: T0 });
  out.created = { state: c.state, total: c.totalCents, perDay: c.perDayCents, radius: c.radiusMi, sample };
  out.forecastNear = (await B.estimateAudience({ tags: ["ARCHIVAL"], radiusMi: 100, center: c.center, durationDays: 7 })).audience.counted >= 1;
  const beforePay = await B.deliverPosts([post], { viewerId: near, now: T0 });
  out.beforePay = { shown: beforePay.length, footer: beforePay[0] ? beforePay[0].attachments.brdcst.footer : null };
  const over = await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: 99999, now: T0 }).then(() => "allowed").catch((e) => e.code);
  const paid = await B.payCampaign({ campaignId: c.id, ownerId: owner, creditCents: c.totalCents, bonusAs: "miles", now: T0 + D });
  out.paid = { via: paid.via, state: paid.campaign.state, startsAt: paid.campaign.startsAt, endsAt: paid.campaign.endsAt, bonus: paid.bonus, over, balance: await C.creditBalance(owner) };
  const bank = await B.bonusBank(owner);
  out.bank = { days: bank.days, miles: bank.miles };
  const now = T0 + 2 * D;
  const dn = await B.deliverPosts([post], { viewerId: near, now });
  const df = await B.deliverPosts([post], { viewerId: far, now });
  const dc = await B.deliverPosts([post], { viewerId: cold, now });
  const dcp = await B.deliverPosts([post], { viewerId: cold, now, hide: false });
  const da = await B.deliverPosts([post], { viewerId: owner, now });
  out.delivery = {
    near: dn.length ? { footer: dn[0].attachments.brdcst.footer, reason: dn[0].attachments.brdcst.reason, hasEvent: !!dn[0].attachments.event } : "hidden",
    far: df.length ? { footer: df[0].attachments.brdcst.footer, reason: df[0].attachments.brdcst.reason, hasEvent: !!df[0].attachments.event } : "hidden",
    cold: dc.length ? "shown" : "hidden",
    coldPermalink: dcp.length ? { footer: dcp[0].attachments.brdcst.footer } : "hidden",
    author: da.length ? { footer: da[0].attachments.brdcst.footer, yours: da[0].attachments.brdcst.yours, state: da[0].attachments.brdcst.state } : "hidden",
  };
  out.ticker = (await B.tickerFor({ viewerId: near, now })).map((r) => r.name);
  out.tickerFar = (await B.tickerFor({ viewerId: far, now })).length;
  const cancelled = await B.cancelCampaign({ campaignId: c.id, by: owner, reason: "voluntary", refundTo: "credit", bonusAs: "days", now: T0 + 3 * D + 3600_000 });
  out.cancelled = { state: cancelled.campaign.state, used: cancelled.campaign.refund.usedDays, unused: cancelled.campaign.refund.unusedDays, amount: cancelled.refund.amountCents, to: cancelled.refund.to, bonus: cancelled.refund.bonus, balance: await C.creditBalance(owner) };
  out.cancelTwice = await B.cancelCampaign({ campaignId: c.id, by: owner, now: T0 + 4 * D }).then(() => "allowed").catch((e) => e.code);
  out.afterCancel = (await B.deliverPosts([post], { viewerId: near, now: T0 + 4 * D })).length;
  const bank2 = await B.bonusBank(owner);
  out.bank2 = { days: bank2.days, miles: bank2.miles };
  // a second campaign redeems banked bonus days, scheduled ahead, paid late
  const c2 = await B.createCampaign({ ownerId: owner, postId: post.id, events: [ev], tags: ["ARCHIVAL"], radiusMi: 50, durationDays: 7, scheduledStart: new Date(T0 + 10 * D).toISOString(), now: T0 + 5 * D });
  const late = await B.payCampaign({ campaignId: c2.id, ownerId: owner, creditCents: 1500, useBonusDays: 2, now: T0 + 12 * D });
  out.late = { billedDays: late.campaign.billedDays, bonusDays: late.campaign.bonusDays, total: late.campaign.totalCents, endsAt: late.campaign.endsAt, state: late.campaign.state };
  const bank3 = await B.bonusBank(owner);
  out.bank3 = { days: bank3.days, miles: bank3.miles };
  out.reviewed = await B.cancelCampaign({ campaignId: c2.id, by: "admin", reason: "policy", now: T0 + 13 * D }).then((r) => r.campaign.state);
  out.decided = (await B.decideReview({ campaignId: c2.id, refund: false, note: "refused", now: T0 + 14 * D })).refund.decided;
  out.notices = (await listNotifications(owner)).map((n) => n.kind).sort();
  out.ledger = (await C.creditLedger(owner)).map((e) => e.kind).sort();
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
