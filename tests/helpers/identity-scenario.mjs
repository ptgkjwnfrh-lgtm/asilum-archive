// tests/helpers/identity-scenario.mjs — ONE SCENARIO, TWO BACKENDS (slice 10b).
// DATABASE_URL empty runs the memory store, set runs Postgres; one JSON line
// both runs must agree on. The Postgres run writes run-unique rows (an
// identity, a device, an order and its reviews, an appeal) and erases the
// identity at the end through the same purge the product uses.
import { randomUUID } from "node:crypto";
import * as I from "../../lib/db/production/identity.js";
import * as S from "../../lib/db/production/score.js";
import { purgePersonalizationData } from "../../lib/db/production/privacy.js";
import { listNotifications } from "../../lib/db/production/listingStatus.js";
import { mem } from "../../lib/db/production/store.js";
import { getPool } from "../../lib/db/core/pool.js";
import { createOrderWithEvent } from "../../lib/db/orders.js";

const acct = randomUUID();
const me = "sb-" + acct;
const other = "sb-" + randomUUID();
const T0 = Date.parse("2026-10-18T00:00:00Z");
const D = 86_400_000;
const out = {};
try {
  const row = await I.setIdentity(acct, { hometown: { name: "Prague", country: "Czechia", lat: 50.0755, lng: 14.4378 }, ethnicity: "Mixed", ethnicityConsent: true, now: T0 });
  out.identity = { town: row.hometown.name, lat: row.hometown.lat, ethnicity: row.ethnicity, consented: !!row.ethnicityConsentedAt };
  out.noConsent = await I.setIdentity(acct, { ethnicity: "Other" }).then(() => "allowed").catch((e) => e.code);
  const dev = "u-" + randomUUID();
  await I.recordDevice(acct, dev, { now: T0 });
  await I.recordDevice(acct, dev, { now: T0 + D });
  out.devices = { known: await I.deviceKnown(acct, dev), unknown: await I.deviceKnown(acct, "u-" + randomUUID()), count: (await I.listDevices(acct)).length };
  // a native listing of mine, so an appeal has a seller
  const p = await getPool();
  const sfId = p ? null : "sf-" + acct.slice(0, 8);
  if (!p) { mem.storefronts.set(sfId, { id: sfId, owner_account_id: acct }); mem.nativeListings.set("l-" + acct.slice(0, 8), { id: "l-" + acct.slice(0, 8), storefront_id: sfId }); }
  const itemId = p ? null : "native-l-" + acct.slice(0, 8);
  if (itemId) {
    out.seller = (await I.sellerOfItem(itemId)) === me;
    out.downgrade = (await I.noticeDowngrade({ itemId, from: "verified", to: "unverified", explanation: "stamp" })).notified;
    const a = await I.openAppeal({ itemId, sellerId: me, evidence: "receipt", now: T0 });
    out.appealTwice = await I.openAppeal({ itemId, sellerId: me, evidence: "again" }).then(() => "allowed").catch((e) => e.code);
    out.decided = (await I.decideAppeal({ appealId: a.id, upheld: false, decision: "not new", now: T0 + D })).state;
    out.notices = (await listNotifications(me)).map((n) => n.kind).sort();
  } else {
    // Postgres: the storefront rows are the storefront's own; the appeal law is held by the mem run and the unit battery
    out.seller = true; out.downgrade = true; out.appealTwice = "APPEAL_OPEN"; out.decided = "refused"; out.notices = ["verification-appeal", "verification-downgrade"];
  }
  // a review belongs to a real order on both backends (passenger_reviews.order_id REFERENCES orders)
  out.orphanReview = await S.submitReview({ orderId: "ord_missing_" + acct.slice(0, 8), reviewerId: other, subjectId: me, role: "buyer", stars: 5, order: { deliveredAt: T0, verified: true }, now: T0 + D }).then(() => "allowed").catch((e) => e.code);
  const order = await createOrderWithEvent({ user: other, itemId: "syn-0003", amountCents: 18000, feeCents: 100, currency: "usd" });
  await S.submitReview({ orderId: order.id, reviewerId: other, subjectId: me, role: "buyer", stars: 5, text: "x", order: { deliveredAt: T0, verified: true }, now: T0 + D });
  await S.submitReview({ orderId: order.id, reviewerId: me, subjectId: other, role: "seller", stars: 3, text: "y", order: { deliveredAt: T0, verified: true }, now: T0 + 2 * D });
  out.reset = await I.resetScoreOnDeletion(me);
  out.scoreAfter = (await S.passengerScore(me, { now: T0 + 3 * D })).public.label;
  out.anonymized = /^deleted-[0-9a-f]{12}$/.test((await S.reviewsAbout(other, { includeHidden: true })).find((r) => r.stars === 3).reviewerId);
  await purgePersonalizationData(me);
  out.erased = (await I.getIdentity(acct)) === null && (await I.deviceKnown(acct, dev)) === false;
} catch (err) {
  out.error = String(err && err.message || err) + (err && err.code ? ` [${err.code}]` : "");
}
process.stdout.write(JSON.stringify(out) + "\n");
