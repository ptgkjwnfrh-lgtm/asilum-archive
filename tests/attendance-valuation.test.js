// tests/attendance-valuation.test.js — SLICE 12: substantiated attendance (17.19),
// the valuation hierarchy (chapter 11), the BRDCST line on the overview (16.3)
// and the map popup's seams (5.5). Held here:
//   * a claim is CLAIMED until an area read inside the window and radius, an
//     upload captioned at the event during it, or the passenger's own post
//     carrying it substantiates it; an undated place never does;
//   * comparables are silent below three; the median and the middle half with
//     a confidence; without them rank × era speaks in words with no figure;
//     a label of unknown era falls to the stake;
//   * the route: a claim needs a signed request, a sample fixture is refused,
//     the record re-evaluates on re-post and withdraws on DELETE;
//   * the valuation route answers with the basis for a demo-free item.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../lib/passport/attendance.js";
import * as V from "../lib/valuation/comparables.js";
import { RECORD_KINDS, RECORD_CAPS } from "../lib/db/production/records.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";
import { listPlaces } from "../lib/places/registry.js";

const paris = listPlaces({ dated: true }).find((p) => !p.sample && p.startsAt);
const T = (s) => Date.parse(s);

test("the law: attendance is claimed until the record substantiates it", () => {
  assert.ok(paris, "a sourced dated place exists in the registry");
  const w = A.windowOf(paris);
  assert.ok(w.start < T(paris.startsAt + "T00:00:00Z") && w.end > T((paris.endsAt || paris.startsAt) + "T23:59:59Z"), "a day of slack either side");
  assert.equal(A.windowOf({ id: "x", name: "undated" }), null);
  const during = T(paris.startsAt + "T12:00:00Z");
  const none = A.substantiate({ place: paris });
  assert.equal(none.status, "claimed"); assert.match(none.reason, /no evidence/);
  // the area: inside the window and the radius
  const near = A.substantiate({ place: paris, area: { lat: paris.lat + 0.05, lng: paris.lng, at: during } });
  assert.equal(near.status, "substantiated"); assert.equal(near.evidence[0].kind, "area");
  assert.equal(A.substantiate({ place: paris, area: { lat: paris.lat + 3, lng: paris.lng, at: during } }).status, "claimed", "200 miles away is not there");
  assert.equal(A.substantiate({ place: paris, area: { lat: paris.lat, lng: paris.lng, at: during - 30 * 86_400_000 } }).status, "claimed", "a month early is not there");
  // the upload: captioned at the event, during it
  const up = A.substantiate({ place: paris, uploads: [{ id: 1, caption: `backstage at ${paris.name} in ${paris.city}`, createdAt: during }] });
  assert.equal(up.status, "substantiated"); assert.equal(up.evidence[0].kind, "upload");
  assert.equal(A.substantiate({ place: paris, uploads: [{ id: 1, caption: "my cat", createdAt: during }] }).status, "claimed", "an upload that names nothing is not evidence");
  assert.equal(A.substantiate({ place: paris, uploads: [{ id: 1, caption: `backstage at ${paris.name}`, createdAt: during + 40 * 86_400_000 }] }).status, "claimed", "a caption after the fact is not evidence");
  // the post: carrying the event, during it
  const post = A.substantiate({ place: paris, posts: [{ id: 9, createdAt: during, attachments: { event: { id: paris.id } } }] });
  assert.equal(post.status, "substantiated"); assert.equal(post.evidence[0].kind, "post");
  assert.equal(A.substantiate({ place: { id: "u", name: "undated", lat: 0, lng: 0 }, area: { lat: 0, lng: 0, at: during } }).status, "claimed", "an undated place never substantiates");
  const rec = A.attendanceRecord({ place: paris, result: near, claimedAt: during });
  assert.equal(rec.eventId, paris.id); assert.equal(rec.status, "substantiated");
  assert.match(A.attendanceLine(rec), /substantiated$/); assert.match(A.attendanceLine({ ...rec, status: "claimed" }), /claimed$/);
  assert.deepEqual(A.attendanceSummary([rec, { ...rec, status: "claimed" }]), { total: 2, substantiated: 1, claimed: 1 });
  assert.ok(RECORD_KINDS.includes("attendance")); assert.equal(RECORD_CAPS.attendance, 200);
});

test("the law: comparables first, silent below three; rank × era in words; the stake last", async () => {
  const sale = (amountCents, extra = {}) => ({ brand: "Helmut Lang", category: "jacket", era: { year: 1998 }, condition: "good", amountCents, paidAt: "2026-09-01T00:00:00Z", ...extra });
  const subject = { id: "x", brand: "Helmut Lang", category: "jacket", era: { year: 1999 }, condition: "good", price: 800, source: "test", origin_status: "unverified" };
  assert.equal(V.comparables(subject, [sale(50000), sale(52000)]).silent, true, "two is an anecdote");
  const c = V.comparables(subject, [sale(40000), sale(50000), sale(60000), sale(55000), sale(45000)]);
  assert.equal(c.silent, false); assert.equal(c.n, 5); assert.equal(c.medianCents, 50000); assert.ok(c.lowCents <= c.medianCents && c.highCents >= c.medianCents);
  assert.ok(["medium", "high", "low"].includes(c.confidence));
  assert.equal(V.comparables(subject, [sale(50000, { category: "coat" }), sale(50000, { category: "coat" }), sale(50000, { category: "coat" })]).silent, true, "a coat is not a jacket");
  assert.equal(V.comparables(subject, [sale(50000, { era: { year: 2024 } }), sale(50000, { era: { year: 2024 } }), sale(50000, { era: { year: 2024 } })]).silent, true, "a current piece is not an archive one");
  assert.equal(V.comparables(subject, [sale(50000, { era: null }), sale(50000, { era: null }), sale(50000, { era: null })]).silent, false, "an unknown era is compatible");
  const tight = V.comparables(subject, Array.from({ length: 10 }, (_, i) => sale(50000 + i * 500)));
  assert.equal(tight.confidence, "high");
  // the hierarchy
  const v1 = V.valuationOf(subject, [sale(40000), sale(50000), sale(60000)]);
  assert.equal(v1.basis, "comparables"); assert.match(v1.line, /3 ASILUM sales/);
  assert.equal(V.eraBand({ year: 1998 }), "archive"); assert.equal(V.eraBand({ year: 2010 }), "modern"); assert.equal(V.eraBand({ year: 2024 }), "current"); assert.equal(V.eraBand(null), "unknown"); assert.equal(V.eraBand({ decade: "1990s" }), "archive");
  const known = Object.keys((await import("../lib/asterisk/houses.js")).HOUSES)[0];
  const v2 = V.valuationOf({ ...subject, brand: known, price: 800 }, []);
  assert.equal(v2.basis, "rank-era"); assert.equal(v2.medianCents, null); assert.match(v2.line, /no comparables on record/); assert.equal(v2.confidence, "low");
  assert.ok(["maison", "house"].includes(V.houseRank(known).rank));
  const v3 = V.valuationOf({ id: "y", brand: "Nobody Label", category: "tee", era: null, price: 40, source: "test", origin_status: "unverified" }, []);
  assert.equal(v3.basis, "stake"); assert.equal(v3.rank, "label"); assert.equal(v3.era, "unknown");
  const v4 = V.valuationOf({ ...subject, brand: "Nobody Label", era: { year: 1990 } }, []);
  assert.equal(v4.basis, "rank-era"); assert.match(v4.line, /archive piece from a label/);
});

test("the routes: a claim needs a signed request; a sample is refused; re-post re-evaluates; DELETE withdraws; the valuation names its basis", async () => {
  const att = await loadRoute("app/api/passport/attendance/route.js");
  const me = newDevice();
  assert.equal((await callRoute(att.GET, { path: "/api/passport/attendance" })).status, 401);
  const empty = await callRoute(att.GET, { path: "/api/passport/attendance", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.records, []); assert.equal(empty.body.law.radiusMi, 30);
  const sample = listPlaces({ sample: true, dated: true })[0];
  if (sample) assert.equal((await callRoute(att.POST, { path: "/api/passport/attendance", cookies: me.cookies, json: { user: me.uid, eventId: sample.id } })).status, 409);
  assert.equal((await callRoute(att.POST, { path: "/api/passport/attendance", cookies: me.cookies, json: { user: me.uid, eventId: "nope" } })).status, 404);
  const claimed = await callRoute(att.POST, { path: "/api/passport/attendance", cookies: me.cookies, json: { user: me.uid, eventId: paris.id } });
  assert.equal(claimed.status, 201); assert.equal(claimed.body.record.status, "claimed");
  const during = paris.startsAt + "T12:00:00Z";
  const sub = await callRoute(att.POST, { path: "/api/passport/attendance", cookies: me.cookies, json: { user: me.uid, eventId: paris.id, area: { lat: paris.lat, lng: paris.lng, at: during } } });
  assert.equal(sub.status, 200, "a re-post updates the one record"); assert.equal(sub.body.record.status, "substantiated"); assert.equal(sub.body.record.claimedAt, claimed.body.record.claimedAt, "the first claim's time is kept");
  const mine = await callRoute(att.GET, { path: "/api/passport/attendance", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(mine.body.records.length, 1); assert.equal(mine.body.summary.substantiated, 1);
  const gone = await callRoute(att.DELETE, { path: "/api/passport/attendance", cookies: me.cookies, json: { user: me.uid, eventId: paris.id } });
  assert.equal(gone.body.deleted, true);
  assert.equal((await callRoute(att.GET, { path: "/api/passport/attendance", cookies: me.cookies, query: { user: me.uid } })).body.records.length, 0);
  const val = await loadRoute("app/api/valuation/route.js");
  assert.equal((await callRoute(val.GET, { path: "/api/valuation" })).status, 400);
  assert.equal((await callRoute(val.GET, { path: "/api/valuation", query: { item: "nope-nope" } })).status, 404);
  const { resolveProducts } = await import("../lib/products.js");
  const { loadCatalog } = await import("../lib/brain/catalog.js").catch(() => ({}));
  const any = loadCatalog ? (await loadCatalog()).items?.[0] : null;
  if (any) {
    const r = await callRoute(val.GET, { path: "/api/valuation", query: { item: any.id } });
    assert.equal(r.status, 200); assert.ok(["comparables", "rank-era", "stake"].includes(r.body.valuation.basis)); assert.ok(["high", "medium", "low"].includes(r.body.valuation.confidence));
  }
  void resolveProducts;
});
