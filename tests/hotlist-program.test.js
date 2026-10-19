// tests/hotlist-program.test.js — P2–P4's laws in memory mode: the
// attribution channel (visit → window → stamp, members only), the program
// state machine (enroll → rent → placeable → lapse), and the placement
// floor (taste gates the door; rent never buys the wrong audience).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

const {
  HOTLIST_RENT_CENTS, HOTLIST_COMMISSION_RATE, ATTRIBUTION_WINDOW_DAYS,
  BOOTH_MATCH_FLOOR, tagCosine, attributionFor,
} = await import("../lib/hotlist.js");
const { recordBoothVisit, hasRecentBoothVisit } = await import("../lib/db/booths.js");
const {
  submitBusinessApplication, decideBusinessApplication, setBusinessSourceName,
  setHotlistMembership, recordHotlistRent, hotlistProgramState, listPaidBooths,
} = await import("../lib/db/production.js");
const { createOrderWithEvent, getOrder } = await import("../lib/db/orders.js");

test("the program's numbers have one home", () => {
  assert.equal(HOTLIST_RENT_CENTS, 15000);          // $150/month, monthly cycles
  assert.equal(HOTLIST_COMMISSION_RATE, 0.15);      // attributed-only, per ruling
  assert.equal(ATTRIBUTION_WINDOW_DAYS, 7);         // approved with the build order
  assert.equal(BOOTH_MATCH_FLOOR, 0.15);            // the discovery-threshold precedent
});

test("tagCosine: identical tastes match, disjoint tastes do not — the ruling's own example", () => {
  const rick = { "AVANT-GARDE": 0.5, ARCHIVAL: 0.3, MINIMAL: 0.2 };
  const jeremy = { STATEMENT: 0.5, SEDUCTIVE: 0.3, STREETWEAR: 0.2 };
  assert.ok(tagCosine(rick, rick) > 0.99, "self-similarity is 1");
  assert.equal(tagCosine(rick, jeremy), 0, "disjoint tag spaces share nothing");
  assert.ok(tagCosine(rick, jeremy) < BOOTH_MATCH_FLOOR,
    "a Rick-Owens-adjacent booth never lands on a Jeremy-Scott-adjacent hotlist");
  assert.equal(tagCosine({}, rick), 0, "a cold passport matches nothing");
});

const ACCT = "acct-hotlist-test-1";

test("program lifecycle: verified → enroll → rent → placeable → unenroll", async () => {
  await submitBusinessApplication({
    accountId: ACCT, brandName: "Atelier Hotlist",
    websiteUrl: "https://atelier-hotlist.example", shopifyDomain: "atelier-hotlist.myshopify.com",
  });
  // Only a VERIFIED business can enroll — the application alone is not it.
  await assert.rejects(() => setHotlistMembership(ACCT, true), /verified business/);
  await decideBusinessApplication({ accountId: ACCT, approve: true, note: "test", actor: "test" });
  await setBusinessSourceName(ACCT, "atelier-hotlist");

  let state = await hotlistProgramState(ACCT);
  assert.deepEqual(state, { member: false, paidThrough: null, active: false });

  state = await setHotlistMembership(ACCT, true);
  assert.equal(state.member, true);
  assert.equal(state.active, false, "enrollment without rent places nothing");
  assert.equal((await listPaidBooths()).length, 0);

  const paid = await recordHotlistRent(ACCT, { amountCents: HOTLIST_RENT_CENTS, actor: "test" });
  assert.equal(paid.active, true);
  assert.ok(paid.periodEnd > paid.periodStart, "one payment covers one forward month");
  const placeable = await listPaidBooths();
  assert.equal(placeable.length, 1);
  assert.equal(placeable[0].sourceName, "atelier-hotlist");

  await setHotlistMembership(ACCT, false);
  assert.equal((await listPaidBooths()).length, 0, "unenrolled = unlisted, rent record stands");
  await setHotlistMembership(ACCT, true); // back on for the attribution test
});

test("attribution: member + visit inside the window, nothing else", async () => {
  const item = { source_name: "atelier-hotlist" };
  assert.equal(await attributionFor("u-attr", item), null, "no visit, no attribution");

  await recordBoothVisit("u-attr", "atelier-hotlist");
  assert.equal(await hasRecentBoothVisit("u-attr", "atelier-hotlist", ATTRIBUTION_WINDOW_DAYS), true);
  assert.equal(await hasRecentBoothVisit("u-attr", "someone-else", ATTRIBUTION_WINDOW_DAYS), false);

  assert.equal(await attributionFor("u-attr", item), "atelier-hotlist");
  assert.equal(await attributionFor("u-attr", { source_name: "no-such-booth" }), null,
    "a source with no business behind it attributes nothing");
  assert.equal(await attributionFor("u-someone-else", item), null,
    "the visit belongs to one buyer, not to everyone");
});

test("the stamp persists on the ledger row", async () => {
  const order = await createOrderWithEvent({
    user: "u-attr", itemId: "test-real-item", amountCents: 10000, feeCents: 100,
    currency: "usd", kind: "ticket_fee", hotlistAttribution: "atelier-hotlist",
  });
  assert.equal(order.hotlist_attribution, "atelier-hotlist");
  const read = await getOrder(order.id);
  assert.equal(read.hotlist_attribution, "atelier-hotlist");
  const base = await createOrderWithEvent({
    user: "u-attr", itemId: "test-real-item", amountCents: 10000, feeCents: 100, currency: "usd",
  });
  assert.equal(base.hotlist_attribution, null, "base sales carry no attribution");
});

// ---------------------------------------------------------------------------
// ⚖ The EPN finding must survive the person who turns eBay on.
//
// The queue item asked whether the founders fee may share a click with an eBay
// affiliate link. Reading the terms (docs/history/epn-terms-check-2026-08-22.md) found
// no bar on that — and found a harder one nobody was looking for: EPN's
// Prohibited AI Uses section bars using eBay Data to improve a system that
// generates recommendations, which is exactly what ingested eBay items would
// do, because they take the same inferTags() path as seed items.
//
// It is dormant only because EBAY_CLIENT_ID/SECRET are unset. A finding whose
// entire protection is "someone will remember" is not protected, so the
// pointer sits in the adapter a person edits to enable it.

test("⚖ turning the eBay adapter on leads a reader to the EPN AI finding", () => {
  const brief = readFileSync(
    fileURLToPath(new URL("../docs/history/epn-terms-check-2026-08-22.md", import.meta.url)), "utf8");
  const adapter = readFileSync(
    fileURLToPath(new URL("../lib/ingest/adapters/ebayAdapter.js", import.meta.url)), "utf8");

  assert.match(adapter, /epn-terms-check-2026-08-22\.md/,
    "the file someone edits to enable eBay must point at the brief");
  assert.match(adapter, /Prohibited AI Uses/);

  // The brief must keep saying what is unresolved. A version that quietly
  // reads as settled is worse than none — it would license the switch-on.
  assert.match(brief, /Not legal advice/);
  assert.match(brief, /Questions for counsel/);
  assert.match(brief, /unresolved|counsel's, not mine|rulings are the owner's/);
  // and it must not have lost the concrete hook that makes it checkable
  assert.match(brief, /inferTags\(\)/);
});
