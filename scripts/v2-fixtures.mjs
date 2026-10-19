// scripts/v2-fixtures.mjs — write the V.2 engine fixtures the UI renders from.
//
// Every fixture is a REAL response from the real route handler in mem mode
// (tests/helpers/route.js), or a real call to a pure engine module — never a
// hand-typed shape. Re-run after any contract change:
//
//   node scripts/v2-fixtures.mjs        → docs/v2/fixtures/*.json
//
// Items are trimmed to a few entries to keep the files readable; the shape
// of each entry is complete.

import fs from "node:fs";
import path from "node:path";
import { callRoute, loadRoute, newDevice } from "../tests/helpers/route.js";
import { sizeRecord, fitAssessment, fitPhrase } from "../lib/brain/sizing.js";
import { normalizeMeasurementProfile, measurementProfileForDisplay } from "../lib/brain/measurements.js";
import { buildPurchaseHub } from "../lib/orders/hub.js";
import { CATALOG } from "../lib/ingest/catalog.js";
import { registryCoverage, CAREER_PROVENANCE } from "../lib/people/careers.js";

const OUT = process.env.V2_FIXTURES_OUT || path.join(process.cwd(), "docs", "v2", "fixtures");
fs.mkdirSync(OUT, { recursive: true });
const write = (name, value) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + "\n");
  console.log("wrote", name);
};
const trimItems = (body, n = 3) => ({
  ...body,
  ...(Array.isArray(body.items) ? { items: body.items.slice(0, n), itemsShown: `${Math.min(n, body.items.length)} of ${body.items.length} on this page` } : {}),
  ...(Array.isArray(body.results) ? { results: body.results.slice(0, n), resultsShown: `${Math.min(n, body.results.length)} of ${body.results.length} on this page` } : {}),
});

const discover = await loadRoute("app/api/discover/route.js");
const search = await loadRoute("app/api/search/route.js");
const records = await loadRoute("app/api/records/route.js");
const why = await loadRoute("app/api/why/route.js");
const orders = await loadRoute("app/api/orders/route.js");
const tickets = await loadRoute("app/api/tickets/route.js");

// ---- search page: the pair, both directions, the chronology --------------
{
  const pair = await callRoute(discover.GET, { path: "/api/discover", query: { q: "tom ford: gucci", limit: "6" } });
  write("search-page.tom-ford-gucci.json", { request: "GET /api/discover?q=tom%20ford%3A%20gucci&limit=6", status: pair.status, body: trimItems(pair.body) });
  const celine = await callRoute(search.GET, { path: "/api/search", query: { q: "hedi slimane: celine" } });
  write("search-page.hedi-slimane-celine.json", { request: "GET /api/search?q=hedi%20slimane%3A%20celine", status: celine.status, body: trimItems(celine.body) });
  const house = await callRoute(discover.GET, { path: "/api/discover", query: { q: "gucci", limit: "3" } });
  write("search-page.gucci-house-overview.json", { request: "GET /api/discover?q=gucci&limit=3", status: house.status, body: trimItems(house.body, 2) });
  const miss = await callRoute(discover.GET, { path: "/api/discover", query: { q: "nobody: gucci", limit: "3" } });
  write("search-page.pair-miss.json", { request: "GET /api/discover?q=nobody%3A%20gucci&limit=3", status: miss.status, body: trimItems(miss.body) });
  const unsourced = await callRoute(discover.GET, { path: "/api/discover", query: { q: "tom ford: prada", limit: "3" } });
  write("search-page.pair-unsourced.json", { request: "GET /api/discover?q=tom%20ford%3A%20prada&limit=3", status: unsourced.status, body: trimItems(unsourced.body) });
}

// ---- cursors: page one, page two, stale, invalid ---------------------------
{
  const p1 = await callRoute(discover.GET, { path: "/api/discover", query: { q: "jacket", limit: "5" } });
  const p2 = await callRoute(discover.GET, { path: "/api/discover", query: { q: "jacket", limit: "5", cursor: p1.body.nextCursor } });
  const stale = await callRoute(discover.GET, { path: "/api/discover", query: { q: "coat", limit: "5", cursor: p1.body.nextCursor } });
  const invalid = await callRoute(discover.GET, { path: "/api/discover", query: { q: "jacket", limit: "5", cursor: "zzz.zzz" } });
  write("discover-cursor.json", {
    pageOne: { request: "GET /api/discover?q=jacket&limit=5", status: p1.status, body: trimItems(p1.body, 2) },
    pageTwo: { request: "GET /api/discover?q=jacket&limit=5&cursor=<pageOne.nextCursor>", status: p2.status, body: trimItems(p2.body, 2) },
    staleCursor: { request: "GET /api/discover?q=coat&limit=5&cursor=<pageOne.nextCursor>", status: stale.status, body: stale.body },
    invalidCursor: { request: "GET /api/discover?q=jacket&limit=5&cursor=zzz.zzz", status: invalid.status, body: invalid.body },
    law: "a cursor is bound to query + filters + eligibility + a snapshot of the ordered ids; 409 stale_cursor means restart from page one; offset still works for older clients",
  });
}

// ---- failures: the typed envelope -------------------------------------------
{
  const me = newDevice();
  const empty = await callRoute(tickets.GET, { path: "/api/tickets", cookies: me.cookies, query: { user: me.uid } });
  const anon = await callRoute(records.GET, { path: "/api/records", query: { kind: "save" } });
  write("outcomes.json", {
    emptyIsNotUnavailable: { request: "GET /api/tickets (a reader with no tickets)", status: empty.status, body: empty.body },
    unauthorized: { request: "GET /api/records?kind=save (no identity)", status: anon.status, body: anon.body },
    unavailable: {
      request: "GET /api/search when the engine throws (shape; cannot be forced in mem mode)",
      status: 503,
      body: { contractVersion: 1, requestId: "<uuid>", outcome: "unavailable", error: { code: "search_engine_failed", message: "the search engine could not answer — retry", retryable: true }, q: "<query>", results: [], total: null },
    },
    outcomes: ["ok", "empty", "unavailable", "unauthorized", "invalid", "stale_cursor", "rate_limited", "not_found"],
  });
}

// ---- fit evidence ------------------------------------------------------------
{
  const profile = { usualSize: "M", measurements: { chest: 38, waist: 36 } };
  const estimated = sizeRecord("M", { category: "tops", measurementSource: "merchant" });
  const measured = sizeRecord("M", { category: "tops", measurementSource: "listing", measurements: { chest: 42, waist: 40 } });
  const unverified = sizeRecord("M", { category: "tops", measurementSource: "seller says", measurements: { chest: 42, waist: 40 } });
  const nullProfile = normalizeMeasurementProfile({ usualSize: "M", unit: "cm" });
  write("fit-evidence.json", {
    law: "provenance is earned by supplied numbers; evidence is a property of what was compared; null never becomes zero",
    estimatedDespiteMerchantWord: { record: estimated, assessment: fitAssessment(estimated, profile), phrase: fitPhrase(estimated, profile) },
    measured: { record: measured, assessment: fitAssessment(measured, profile), phrase: fitPhrase(measured, profile) },
    unknownProvenanceWord: { record: unverified, assessment: fitAssessment(unverified, profile), phrase: fitPhrase(unverified, profile) },
    noProfile: { assessment: fitAssessment(measured, null) },
    sizeOnlyProfile: { assessment: fitAssessment(measured, { usualSize: "M", measurements: {} }) },
    measurementsDisplay: { storage: nullProfile.storage, display: measurementProfileForDisplay(nullProfile.storage) },
  });
}

// ---- records ------------------------------------------------------------------
{
  const me = newDevice();
  const put = await callRoute(records.PUT, { path: "/api/records", method: "PUT", cookies: me.cookies, json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing", payload: { kind: "person", id: "olivier-rousteing", title: "Olivier Rousteing", href: "/discover?q=olivier%20rousteing", at: "2026-09-19T12:00:00.000Z" } } });
  const loc = await callRoute(records.PUT, { path: "/api/records", method: "PUT", cookies: me.cookies, json: { user: me.uid, kind: "location", recordId: "base", payload: { baseCity: { name: "Bowie", lat: 38.94, lng: -76.73, country: "US" }, publicDetail: "none", audience: "me", mapDiscoverable: false } } });
  const list = await callRoute(records.GET, { path: "/api/records", cookies: me.cookies, query: { user: me.uid } });
  const del = await callRoute(records.DELETE, { path: "/api/records", method: "DELETE", cookies: me.cookies, json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing" } });
  const bad = await callRoute(records.PUT, { path: "/api/records", method: "PUT", cookies: me.cookies, json: { user: me.uid, kind: "wishes", recordId: "x", payload: {} } });
  write("records.json", {
    kinds: ["save", "location", "correction", "draft"],
    caps: { save: 400, location: 1, correction: 50, draft: 50, payloadBytes: 8192 },
    put: { request: "PUT /api/records", status: put.status, body: put.body },
    putLocation: { request: "PUT /api/records (kind location, recordId base)", status: loc.status, body: loc.body },
    list: { request: "GET /api/records", status: list.status, body: list.body },
    delete: { request: "DELETE /api/records", status: del.status, body: del.body },
    invalidKind: { status: bad.status, body: bad.body },
    capRefusal: { status: 409, body: { contractVersion: 1, requestId: "<uuid>", outcome: "invalid", error: { code: "record_cap", message: "at most 50 draft records — remove one first", retryable: false }, cap: 50 } },
  });
}

// ---- corrections: lanes, scope, undo ------------------------------------------
{
  const me = newDevice();
  const piece = CATALOG.find((it) => Number(it.price) > 200);
  const post = await callRoute(why.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, productId: piece.id, code: "too-expensive", scope: "session" } });
  const undo = await callRoute(why.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, undoOf: post.body.correction.id } });
  const badScope = await callRoute(why.POST, { path: "/api/why", cookies: me.cookies, json: { user: me.uid, productId: piece.id, code: "too-expensive", scope: "forever" } });
  write("corrections.json", {
    codes: {
      price: ["too-expensive"], fit: ["too-small", "too-large"], finish: ["dislike-finish"],
      item: ["not-interested", "already-own"], taste: ["not-my-style", "less-like-this", "more-like-this", "dont-recommend-silhouette"],
      brand: ["dont-recommend-brand"], note: ["right-vibe-wrong-product", "too-literal", "too-abstract"],
      data: ["wrong-brand", "wrong-color", "wrong-category", "wrong-material", "wrong-era", "wrong-attribution"],
    },
    scopes: ["item", "session", "ongoing"],
    record: { request: "POST /api/why { productId, code, scope }", status: post.status, body: post.body },
    undo: { request: "POST /api/why { undoOf }", status: undo.status, body: undo.body },
    invalidScope: { status: badScope.status, body: badScope.body },
    effects: {
      "too-expensive": "a price ceiling on recommendation surfaces (lowest price called too expensive); item scope excludes the piece only; no tag touched",
      "too-small/too-large": "a fit hint { brand, category, size, direction } on the exclusions and the memory facade; no tag touched",
      "dislike-finish": "only the finish/material words are subtracted from taste",
      "not-interested": "the piece is excluded; no tag touched",
      "wrong-attribution": "a desk task; never a taste signal; the piece is not demoted for the reporter",
    },
  });
}

// ---- purchase hub ----------------------------------------------------------------
{
  const me = newDevice();
  const empty = await callRoute(orders.GET, { path: "/api/orders", cookies: me.cookies, query: { user: me.uid, hub: "1" } });
  const titles = new Map([["it-1", { title: "Leather blazer", brand: "Celine" }], ["it-2", { title: "Wool coat", brand: "Gucci" }]]);
  const at = (d) => `2026-09-1${d}T12:00:00.000Z`;
  const states = buildPurchaseHub({
    orders: [
      { id: "ord_paid", kind: "sale", item_id: "it-1", status: "paid", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(1), updated_at: at(1) },
      { id: "ord_wait", kind: "sale", item_id: "it-1", status: "awaiting_payment", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(2), updated_at: at(2), resume_url: "https://checkout.stripe.com/c/pay/cs_test_x" },
      { id: "ord_ref", kind: "sale", item_id: "it-2", status: "refunded", amount_cents: 90000, fee_cents: 900, currency: "usd", created_at: at(3), updated_at: at(4) },
      { id: "ord_fee1", kind: "ticket_fee", item_id: "it-2", status: "paid", amount_cents: 90000, fee_cents: 900, currency: "usd", created_at: at(5), updated_at: at(5) },
      { id: "ord_fee2", kind: "ticket_fee", item_id: "it-1", status: "awaiting_payment", amount_cents: 60000, fee_cents: 600, currency: "usd", created_at: at(6), updated_at: at(6) },
    ],
    tickets: [
      { id: 11, productId: "it-1", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/1", status: "awaiting_user_consent", itemPriceAtRequest: 600, currentPriceChecked: 600, availabilityStatus: "available", consented: false, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(7)), idempotencyKey: "k-11" },
      { id: 12, productId: "it-2", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/2", status: "checkout_started", itemPriceAtRequest: 900, currentPriceChecked: 900, availabilityStatus: "available", consented: true, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(5)), idempotencyKey: "fee-ord-fee1" },
      { id: 13, productId: "it-1", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/3", status: "checkout_completed_on_source", itemPriceAtRequest: 600, currentPriceChecked: null, availabilityStatus: "available", consented: true, userReportedOutcome: "bought", outcomeReportedAt: Date.parse(at(8)), createdAt: Date.parse(at(6)), idempotencyKey: "fee-ord-fee2" },
      { id: 14, productId: "it-2", sourceName: "ebay", sourceProductUrl: "https://www.ebay.com/itm/4", status: "unavailable", itemPriceAtRequest: 900, currentPriceChecked: null, availabilityStatus: "sold", consented: false, userReportedOutcome: null, outcomeReportedAt: null, createdAt: Date.parse(at(9)), idempotencyKey: "k-14" },
    ],
    titles,
  });
  write("purchase-hub.json", {
    request: "GET /api/orders?hub=1",
    empty: { status: empty.status, body: empty.body },
    representativeStates: states,
    lanes: {
      payment: ["none", "awaiting", "paid", "failed", "expired", "refunded", "unknown"],
      fee: ["none", "awaiting", "paid", "failed", "expired", "refunded", "unknown"],
      merchant: ["none", "handoff", "requested", "checking", "available", "unavailable", "awaiting_consent", "awaiting_checkout", "checkout_started", "completed_on_source", "canceled", "failed", "completed", "unknown"],
      outcome: ["unknown", "bought", "kept", "returned", "not-bought"],
      fulfillment: ["unknown"],
    },
    allowedActions: ["resume_payment", "consent", "cancel", "report_outcome"],
  });
}

// ---- BRDCST (slice 8): the public quote and forecast, a draft, the idle payment --------
{
  const brdcst = await loadRoute("app/api/brdcst/route.js");
  const { listPlaces } = await import("../lib/places/registry.js");
  const { eventLive } = await import("../lib/brdcst/index.js");
  const ev = listPlaces({ dated: true }).find((p) => !p.sample && eventLive(p));
  const quote = await callRoute(brdcst.GET, { path: "/api/brdcst", query: { quote: "1", radiusMi: "100", tasteBreadth: "0.25", durationDays: "7", eventId: ev.id, tags: "ARCHIVAL" } });
  const me = newDevice();
  // slice 10b (Terms 2.2): a device cannot run a BRDCST — the route refuses with the law's sentence;
  // the draft and the idle payment are the store's answers for an 18+ account
  const B = await import("../lib/db/production/brdcst.js");
  const refused = await callRoute(brdcst.POST, { path: "/api/brdcst", cookies: me.cookies, json: { user: me.uid, action: "create", eventIds: [ev.id], radiusMi: 100, tasteBreadth: 0.25, durationDays: 7 } });
  const draft = await B.createCampaign({ ownerId: "sb-00000000-0000-4000-8000-000000000000", events: [ev], radiusMi: 100, tasteBreadth: 0.25, durationDays: 7 });
  const idle = await B.payCampaign({ campaignId: draft.id, ownerId: draft.ownerId, creditCents: 0 }).then(() => ({ status: 200, body: {} })).catch((e) => ({ status: e.status, body: { error: e.message, code: e.code } }));
  const ticker = await callRoute(brdcst.GET, { path: "/api/brdcst", query: { ticker: "1" } });
  const scrub = (c) => ({ ...c, id: "<uuid>", ownerId: "<uid>", createdAt: "<iso>", updatedAt: "<iso>" });
  write("brdcst.json", {
    quote: { request: `GET /api/brdcst?quote=1&radiusMi=100&tasteBreadth=0.25&durationDays=7&eventId=${ev.id}&tags=ARCHIVAL`, status: quote.status, body: quote.body },
    createAsDevice: { request: "POST /api/brdcst { action: create, … } from a device identity", status: refused.status, body: refused.body },
    draft: { request: "createCampaign for an 18+ account (the store; the route is the same call behind the gate)", campaign: scrub(draft) },
    payIdle: { request: "payCampaign { creditCents: 0 } with no STRIPE_SECRET_KEY", status: idle.status, body: idle.body },
    ticker: { request: "GET /api/brdcst?ticker=1 (anonymous: no taste to match)", status: ticker.status, body: ticker.body },
  });
}

// ---- MOTION (slice 9): the worker's gate and law, a device refused, an
// admitted asset's captions served as text/vtt, the probe over the sample ----
{
  const motion = await loadRoute("app/api/editorial/motion/route.js");
  const M = await import("../lib/db/production/media.js");
  const { probeVideo, admitMotion } = await import("../lib/media/index.js");
  const gate = await callRoute(motion.GET, { path: "/api/editorial/motion" });
  const me = newDevice();
  const begin = await callRoute(motion.POST, { path: "/api/editorial/motion", cookies: me.cookies, json: { user: me.uid, action: "begin", mime: "video/mp4", bytes: 26879, durationMs: 6000 } });
  const asset = await M.createMotionAsset({ ownerId: me.uid, path: `${me.uid}/00000000-0000-4000-8000-000000000000.mp4`, container: "mp4", mime: "video/mp4", declaredBytes: 26879 });
  const bytes = fs.readFileSync(path.join(process.cwd(), "public", "model", "motion-test-pattern.mp4"));
  const probe = probeVideo(bytes);
  const verdict = admitMotion(probe, { bytes: bytes.length });
  await M.admitMotionAsset({ id: asset.id, ownerId: me.uid, facts: verdict.facts });
  await M.setMotionCaptions({ id: asset.id, ownerId: me.uid, tracks: [{ lang: "en", label: "English", default: true, vtt: fs.readFileSync(path.join(process.cwd(), "public", "model", "motion-test-pattern.vtt"), "utf8") }] });
  const vtt = await callRoute(motion.GET, { path: "/api/editorial/motion", query: { captions: asset.id, lang: "en" } });
  const mine = await callRoute(motion.GET, { path: "/api/editorial/motion", cookies: me.cookies, query: { user: me.uid } });
  const scrub = (a) => ({ ...a, id: "<uuid>", ownerId: "<uid>", path: "<uid>/<uuid>.mp4", createdAt: "<iso>", updatedAt: "<iso>", verifiedAt: "<iso>" });
  write("media.json", {
    gate: { request: "GET /api/editorial/motion (no WIRE_VIDEO_ENABLED)", status: gate.status, body: gate.body },
    beginDevice: { request: "POST /api/editorial/motion { action: begin, mime, bytes, durationMs } as a device", status: begin.status, body: begin.body },
    probeSample: { file: "public/model/motion-test-pattern.mp4", probe, verdict },
    captions: { request: "GET /api/editorial/motion?captions=<id>&lang=en", status: vtt.status, contentType: vtt.response.headers.get("content-type"), text: vtt.text },
    mine: { request: "GET /api/editorial/motion?user=<uid>", status: mine.status, body: { ...mine.body, mine: mine.body.mine.map(scrub) } },
  });
}

write("registry-coverage.json", { coverage: registryCoverage(), provenance: CAREER_PROVENANCE });
console.log("done");
