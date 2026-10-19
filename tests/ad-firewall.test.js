// tests/ad-firewall.test.js — The ad firewall: only genuinely active sponsored
// content is fenced as sponsored, the public product strips sponsorship, and
// engagement events record whether they were sponsored.

import test from "node:test";
import assert from "node:assert/strict";

import { productSnapshot, publicProduct, isSponsoredContent } from "../lib/products.js";
import { eventFromInteraction } from "../lib/events/index.js";
import { crossUserCandidates } from "../lib/taste-graph/index.js";
import { saveProfile, recordEvent, purgeMemoryUserData } from "../lib/db/index.js";
import { buildEvent, EVENTS } from "../lib/events/index.js";

// audit #19: genuine engagement on a sponsored item still wrote edges,
// popularity, and cross-user events with no sponsor filter, so a flagged
// campaign could buy organic reach through the co-engagement graph. Unreachable
// today (no sponsored items exist) but a live backdoor the day one is flagged.
// The firewall: sponsored content never enters the organic cross-user surfaces.

const sponsored = {
  id: "syn-ad-1", title: "Sponsored piece", brand: "BrandX", tags: { MINIMAL: 0.6 },
  sponsored: true, sponsorship_status: "active", sponsor_disclosure: "Paid placement",
};
const inactive = { ...sponsored, id: "syn-ad-2", sponsorship_status: "paused" };
const organic = { id: "syn-ad-3", title: "Organic piece", brand: "BrandY", tags: { MINIMAL: 0.6 } };

// ---- the predicate ---------------------------------------------------------

test("#19 isSponsoredContent fences only genuinely active sponsored content", () => {
  assert.equal(isSponsoredContent(productSnapshot(sponsored)), true);
  assert.equal(isSponsoredContent(productSnapshot(inactive)), false, "paused campaign is not fenced organic-wise");
  assert.equal(isSponsoredContent(productSnapshot(organic)), false);
  assert.equal(isSponsoredContent(null), false);
});

// ---- snapshot vs public boundary ------------------------------------------

test("#19 the internal snapshot carries sponsorship; publicProduct strips it", () => {
  const snap = productSnapshot(sponsored);
  assert.equal(snap.sponsored, true, "server paths can see it");
  assert.equal(snap.sponsorship_status, "active");
  const pub = publicProduct(sponsored);
  assert.ok(!("sponsorship_status" in pub), "inactive-status metadata never crosses the API");
  assert.equal(pub.sponsored, true, "disclosed active placement is still labeled publicly");
  const pubOrganic = publicProduct(organic);
  assert.ok(!("sponsored" in pubOrganic), "organic items carry no sponsored key publicly");
});

// ---- event tagging ---------------------------------------------------------

test("#19 a sponsored engagement event is tagged; organic is not", () => {
  const spon = eventFromInteraction("u-1", "favorite", productSnapshot(sponsored));
  assert.equal(spon.payload.sponsored, true);
  const org = eventFromInteraction("u-1", "favorite", productSnapshot(organic));
  assert.ok(!("sponsored" in org.payload), "organic events carry no sponsored flag");
});

// ---- cross-user discovery excludes sponsored -------------------------------

test("#19 a neighbor's sponsored engagement never lifts cross-user discovery", async () => {
  const me = "u-adfw-me", neighbor = "u-adfw-nb";
  purgeMemoryUserData(me);
  purgeMemoryUserData(neighbor);
  // Identical profiles → high similarity so the neighbor is found.
  const vec = { long: { MINIMAL: 0.9, TAILORED: 0.5 }, session: {}, _meta: {} };
  await saveProfile(me, structuredClone(vec));
  await saveProfile(neighbor, structuredClone(vec));
  // Neighbor bagged BOTH an organic and a sponsored item; only organic may
  // surface as a candidate.
  await recordEvent(buildEvent(neighbor, EVENTS.USER_ADDED_TO_BAG, { itemId: "syn-ad-3", brand: "BrandY" }));
  await recordEvent(buildEvent(neighbor, EVENTS.USER_ADDED_TO_BAG, { itemId: "syn-ad-1", brand: "BrandX", sponsored: true }));

  const res = await crossUserCandidates(me, 24, { neighborCount: 5, eventsPerNeighbor: 100 });
  const ids = (res.data?.candidates || res.candidates || []).map((c) => c.itemId);
  assert.ok(ids.includes("syn-ad-3"), "organic neighbor engagement surfaces");
  assert.ok(!ids.includes("syn-ad-1"), "sponsored neighbor engagement is fenced out");

  purgeMemoryUserData(me);
  purgeMemoryUserData(neighbor);
});
