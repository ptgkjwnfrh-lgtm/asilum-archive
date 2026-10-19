// tests/identity-commerce.test.js — IDENTITY FOR COMMERCE (V.2 Terms 2.2,
// 6.31–6.34, 10.4, 12.8–12.9, 14.11; owner rulings 18 Oct 2026, A6; slice
// 10b). The law (lib/identity/commerce.js) is pure; the rows
// (lib/db/production/identity.js) run on the memory store; the gate and the
// routes through the harness. Held here:
//   * 18+ to buy, sell, run a BRDCST or move Credit — from the stored birth
//     date, never a flag; a device has no birth date and is told so;
//   * verification for commerce: e-mail for SELL, the enhanced checks (an
//     approved business) for DROP, phone only where an SMS provider exists;
//   * gift proofs come from the session's assurance level and an adopted
//     device, never from the body;
//   * the home town and a consented, erasable ethnicity; nothing stored
//     without consent;
//   * a Verified native listing that goes down tells its seller why; the
//     seller's appeal reaches a human, once per item, and the decision is
//     told;
//   * deletion resets the Passenger Score and anonymizes the reviews the
//     person wrote; penalties stay;
//   * the fees of A6: $1 + 1.5% on the ticket lane, activation for DROP only.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../lib/identity/commerce.js";
import * as I from "../lib/db/production/identity.js";
import * as S from "../lib/db/production/score.js";
import { createOrderWithEvent } from "../lib/db/orders.js";
import { gate } from "../lib/identity/gate.js";
import { bearerAssuranceLevel } from "../lib/identity.js";
import { purgePersonalizationData } from "../lib/db/production/privacy.js";
import { listNotifications, resetMemoryListingStatus } from "../lib/db/production/listingStatus.js";
import { activationApplies, activationOwedCents } from "../lib/storefront/fees.js";
import { passengerFeeCents, ticketFeeCents } from "../lib/orders.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

const uuid = () => globalThis.crypto.randomUUID();
const NOW = Date.parse("2026-10-18T12:00:00Z");

test.beforeEach(() => { I.resetMemoryIdentity(); S.resetMemoryScore(); resetMemoryListingStatus(); });

test("the law: 18+ to transact, from the birth date; verification for SELL and DROP; the gift's two proofs", () => {
  assert.equal(L.COMMERCE_AGE, 18);
  assert.equal(L.canTransact({ birthDate: null, now: NOW }).code, "AGE_UNKNOWN");
  assert.equal(L.canTransact({ birthDate: "2008-10-19", now: NOW }).code, "UNDER_COMMERCE_AGE", "17 years and 364 days is 17");
  assert.deepEqual(L.canTransact({ birthDate: "2008-10-18", now: NOW }), { ok: true, age: 18 });
  const sell = L.commerceVerification({ mode: "sell", emailConfirmed: false, phoneAvailable: false });
  assert.equal(sell.ok, false); assert.deepEqual(sell.missing, ["email"]); assert.match(sell.checks.find((c) => c.id === "phone").note, /SMS provider/);
  assert.equal(L.commerceVerification({ mode: "sell", emailConfirmed: true, phoneAvailable: true, phoneConfirmed: false }).missing[0], "phone", "where phone exists it is required (6.34)");
  const drop = L.commerceVerification({ mode: "drop", emailConfirmed: true, businessApproved: false });
  assert.deepEqual(drop.missing, ["enhanced"]); assert.match(drop.reason, /release a DROP/);
  assert.equal(L.commerceVerification({ mode: "drop", emailConfirmed: true, businessApproved: true }).ok, true);
  assert.deepEqual(L.giftProofs({ aal: "aal2", deviceKnown: true }), { twoFactor: true, deviceVerified: true });
  assert.deepEqual(L.giftProofs({ aal: "aal1", deviceKnown: true }), { twoFactor: false, deviceVerified: true });
  assert.deepEqual(L.giftProofs({}), { twoFactor: false, deviceVerified: false });
  assert.equal(L.yearAtAge("2000-05-01"), 2012);
  assert.deepEqual(L.normalizeHometown({ name: "  Bowie,   Maryland ", country: "United States", lat: 38.94281, lng: -76.73 }), { name: "Bowie, Maryland", country: "United States", lat: 38.94, lng: -76.73 });
  assert.equal(L.normalizeHometown({ name: "" }), null);
  assert.equal(L.normalizeEthnicity("Caribbean").ok, false, "no consent, no storage");
  assert.deepEqual(L.normalizeEthnicity("Caribbean", { consent: true }), { ethnicity: "Caribbean", ok: true });
  assert.deepEqual(L.normalizeEthnicity("prefer not to say", { consent: false }), { ethnicity: null, ok: true });
});

test("the assurance level is read from a verified bearer's own claims, never the body", () => {
  const jwt = (claims) => "h." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".s";
  const req = (auth) => ({ headers: new Map(auth ? [["authorization", auth]] : []) });
  assert.equal(bearerAssuranceLevel(req("Bearer " + jwt({ aal: "aal2", sub: "x" }))), "aal2");
  assert.equal(bearerAssuranceLevel(req("Bearer " + jwt({ sub: "x" }))), null);
  assert.equal(bearerAssuranceLevel(req(null)), null);
  assert.equal(bearerAssuranceLevel(req("Bearer not-a-jwt")), null);
});

test("the store: the home town and the consented ethnicity; erasure; adopted devices", async () => {
  const acct = uuid();
  assert.equal(await I.getIdentity(acct), null);
  await assert.rejects(() => I.setIdentity(acct, { ethnicity: "Mixed" }), /consent/);
  const row = await I.setIdentity(acct, { hometown: { name: "Prague", country: "Czechia" }, ethnicity: "Mixed", ethnicityConsent: true, now: NOW });
  assert.deepEqual(row.hometown, { name: "Prague", country: "Czechia", lat: null, lng: null }); assert.equal(row.ethnicity, "Mixed"); assert.ok(row.ethnicityConsentedAt);
  const kept = await I.setIdentity(acct, { hometown: { name: "Brno" } });
  assert.equal(kept.ethnicity, "Mixed", "an untouched field stays");
  const cleared = await I.setIdentity(acct, { ethnicity: null });
  assert.equal(cleared.ethnicity, null); assert.equal(cleared.ethnicityConsentedAt, null); assert.equal(cleared.hometown.name, "Brno");
  await assert.rejects(() => I.setIdentity("u-not-an-account", { hometown: { name: "x" } }), /ADR-002/);
  assert.equal(await I.deviceKnown(acct, "u-" + uuid()), false);
  const dev = "u-" + uuid();
  const rec = await I.recordDevice(acct, dev);
  assert.equal(rec.deviceHash.length, 64); assert.notEqual(rec.deviceHash, dev, "the row holds a hash, never the id");
  assert.equal(await I.deviceKnown(acct, dev), true);
  assert.equal((await I.listDevices(acct)).length, 1);
  await I.eraseIdentity(acct);
  assert.equal(await I.getIdentity(acct), null); assert.equal(await I.deviceKnown(acct, dev), false);
});

test("the gate: a device cannot transact; an account needs a birth date; the refusal is the law's sentence", async () => {
  const me = newDevice();
  const req = { headers: new Map(), cookies: { get: (k) => (k === "asilum-device" ? { value: me.cookies["asilum-device"] } : undefined) } };
  const g = await gate(req, me.uid, { needs: ["age"] });
  assert.equal(g.ok, false); assert.equal(g.status, 403); assert.equal(g.body.code, "ACCOUNT_REQUIRED"); assert.match(g.body.error, /Terms 2\.2/);
  const anon = await gate({ headers: new Map(), cookies: { get: () => undefined } }, "", { needs: ["age"] });
  assert.equal(anon.status, 401);
});

test("the routes: a device is refused at every door that transacts, with the reason; identity needs an account", async () => {
  const brdcst = await loadRoute("app/api/brdcst/route.js");
  const checkout = await loadRoute("app/api/checkout/route.js");
  const ticket = await loadRoute("app/api/ticket-fee/route.js");
  const credit = await loadRoute("app/api/credit/route.js");
  const identity = await loadRoute("app/api/account/identity/route.js");
  const me = newDevice();
  const b = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "create", eventIds: ["pfw-menswear-fw-2027"], radiusMi: 50, durationDays: 7 } });
  assert.equal(b.status, 403); assert.equal(b.body.code, "ACCOUNT_REQUIRED");
  const c = await callRoute(checkout.POST, { path: "/api/checkout", cookies: me.cookies, json: { user: me.uid, itemId: "syn-0003" } });
  assert.equal(c.status, 403); assert.equal(c.body.code, "ACCOUNT_REQUIRED");
  const t = await callRoute(ticket.POST, { path: "/api/ticket-fee", cookies: me.cookies, json: { user: me.uid, itemId: "syn-0003", consent: true } });
  assert.equal(t.status, 403); assert.equal(t.body.code, "ACCOUNT_REQUIRED");
  const g = await callRoute(credit.POST, { path: "/api/credit", cookies: me.cookies, json: { user: me.uid, action: "gift", toHandle: "someone", amountCents: 100 } });
  assert.equal(g.status, 403); assert.equal(g.body.code, "ACCOUNT_REQUIRED");
  const rules = await callRoute(credit.GET, { path: "/api/credit", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(rules.body.rules.twoFactorAvailable, true, "two-factor exists now: Settings enrolls an authenticator");
  const id = await callRoute(identity.GET, { path: "/api/account/identity", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(id.status, 200); assert.equal(id.body.account, false); assert.deepEqual(id.body.options.ethnicity, [...L.ETHNICITY_OPTIONS]);
  const put = await callRoute(identity.PUT, { path: "/api/account/identity", method: "PUT", cookies: me.cookies, json: { user: me.uid, hometown: { name: "x" } } });
  assert.equal(put.status, 403); assert.equal(put.body.code, "ACCOUNT_REQUIRED");
  assert.equal((await callRoute(identity.GET, { path: "/api/account/identity" })).status, 401);
});

test("appeals and the downgrade notice: only the seller appeals, once per item, with evidence; a human decides and the seller is told", async () => {
  const { mem } = await import("../lib/db/production/store.js");
  const owner = uuid();
  mem.storefronts.set("sf-1", { id: "sf-1", owner_account_id: owner });
  mem.nativeListings.set("l-1", { id: "l-1", storefront_id: "sf-1" });
  const seller = "sb-" + owner;
  assert.equal(await I.sellerOfItem("native-l-1"), seller); assert.equal(await I.sellerOfItem("syn-0003"), null);
  const n = await I.noticeDowngrade({ itemId: "native-l-1", from: "verified", to: "unverified", explanation: "the hardware stamp does not match the house's" });
  assert.equal(n.notified, true);
  assert.equal(await I.noticeDowngrade({ itemId: "syn-0003", from: "verified", to: "unverified" }).then((r) => r.notified), false, "an external record has no seller to tell");
  await assert.rejects(() => I.openAppeal({ itemId: "native-l-1", sellerId: "sb-" + uuid(), evidence: "receipt" }), /only the listing's seller/);
  await assert.rejects(() => I.openAppeal({ itemId: "native-l-1", sellerId: seller, evidence: "  " }), /materially new evidence/);
  const a = await I.openAppeal({ itemId: "native-l-1", sellerId: seller, evidence: "the boutique's receipt and the care label", now: NOW });
  assert.equal(a.state, "open");
  await assert.rejects(() => I.openAppeal({ itemId: "native-l-1", sellerId: seller, evidence: "again" }), /already with a human/);
  assert.equal((await I.listAppeals({ state: "open" })).length, 1);
  const d = await I.decideAppeal({ appealId: a.id, upheld: true, decision: "the receipt is the boutique's", actor: "desk", now: NOW + 1000 });
  assert.equal(d.state, "upheld"); assert.equal(d.decidedBy, "desk");
  await assert.rejects(() => I.decideAppeal({ appealId: a.id, upheld: false }), /decided/);
  const kinds = (await listNotifications(seller)).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["verification-appeal", "verification-downgrade"]);
  mem.storefronts.delete("sf-1"); mem.nativeListings.delete("l-1");
});

test("deletion resets the Passenger Score: reviews about the person are excluded, reviews by them stay anonymized, penalties stay", async () => {
  const gone = "sb-" + uuid(), other = "sb-" + uuid();
  const T0 = NOW - 10 * 86_400_000;
  // a review needs a real order, on both backends
  await assert.rejects(() => S.submitReview({ orderId: "ord_missing", reviewerId: other, subjectId: gone, role: "buyer", stars: 5, order: { deliveredAt: T0, verified: true }, now: T0 + 86_400_000 }), (e) => e.code === "ORDER_NOT_FOUND");
  const ordA = (await createOrderWithEvent({ user: other, itemId: "syn-0003", amountCents: 18000, currency: "usd" })).id;
  const ordB = (await createOrderWithEvent({ user: other, itemId: "syn-0003", amountCents: 18000, currency: "usd" })).id;
  await S.submitReview({ orderId: ordA, reviewerId: other, subjectId: gone, role: "buyer", stars: 5, text: "great", order: { deliveredAt: T0, verified: true }, now: T0 + 86_400_000 });
  await S.submitReview({ orderId: ordA, reviewerId: gone, subjectId: other, role: "seller", stars: 4, text: "fine", order: { deliveredAt: T0, verified: true }, now: T0 + 2 * 86_400_000 });
  const pen = await S.proposePenalty({ userId: gone, reason: "label refused", now: T0 });
  await S.movePenalty({ penaltyId: pen.id, action: "confirm", now: T0 });
  assert.ok((await S.passengerScore(gone, { now: NOW })).public.score > 0, "scored before deletion");
  const r = await I.resetScoreOnDeletion(gone);
  assert.deepEqual(r, { about: 1, by: 1 });
  assert.equal((await S.passengerScore(gone, { now: NOW })).public.label, "0.0 ★ · No reviews", "6.31");
  const theirs = (await S.reviewsAbout(other, { includeHidden: true }))[0];
  assert.match(theirs.reviewerId, /^deleted-[0-9a-f]{12}$/, "14.6: the review remains, anonymized"); assert.equal(theirs.stars, 4);
  assert.equal((await S.penaltiesFor(gone)).length, 1, "6.32: enforcement records remain");
  // the purge path calls the same reset
  const gone2 = "sb-" + uuid();
  await S.submitReview({ orderId: ordB, reviewerId: other, subjectId: gone2, role: "buyer", stars: 5, text: "ok", order: { deliveredAt: T0, verified: true }, now: T0 + 86_400_000 });
  await I.setIdentity(gone2.slice(3), { hometown: { name: "Seoul" } });
  await purgePersonalizationData(gone2);
  assert.equal((await S.passengerScore(gone2, { now: NOW })).public.score, 0);
  assert.equal(await I.getIdentity(gone2.slice(3)), null, "the identity row leaves with the person");
});

test("the fees of A6: $1 + 1.5% on the ticket lane; activation owed by a DROP, never by SELL", () => {
  assert.equal(passengerFeeCents(10000), 250); assert.equal(ticketFeeCents(10000), 250);
  assert.equal(activationApplies(["sell", "sell"]), false); assert.equal(activationApplies(["sell", "drop"]), true); assert.equal(activationApplies([]), false);
  assert.equal(activationOwedCents({ modes: ["sell"] }), 0);
  assert.equal(activationOwedCents({ modes: ["drop"], collectedCents: 1200 }), 1800);
  assert.equal(activationOwedCents({ modes: ["drop"], collectedCents: 5000 }), 0);
});
