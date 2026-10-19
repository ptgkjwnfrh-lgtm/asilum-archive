// tests/admin-governance.test.js — the admin console's governance actions
// (/api/admin, slice 5) and the public badge that hides the machinery
// (/api/verification/listing). Memory store, ADMIN_TOKEN set per test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callRoute, loadRoute } from "./helpers/route.js";
import { resetMemoryAsterisk } from "../lib/db/production/asterisk.js";
import { resetMemoryVerifications } from "../lib/db/production/verification.js";
import { upsertItems } from "../lib/db/index.js";

const { POST: adminPOST } = await loadRoute("app/api/admin/route.js");
const { GET: listingGET, POST: listingPOST } = await loadRoute("app/api/verification/listing/route.js");
const TOKEN = "governance-admin-token-0123456789";
async function withToken(fn) {
  const prev = process.env.ADMIN_TOKEN; process.env.ADMIN_TOKEN = TOKEN;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev; }
}
const post = (json) => callRoute(adminPOST, { path: "/api/admin", method: "POST", json, bearer: TOKEN });

test.beforeEach(() => { resetMemoryAsterisk(); resetMemoryVerifications(); });

test("the functions panel: seven functions with their safe outcomes, the policy numbers, the backlog; pause and resume take effect", async () => withToken(async () => {
  const r = await post({ action: "asterisk.functions" });
  assert.equal(r.status, 200);
  assert.equal(r.body.functions.length, 7);
  assert.equal(r.body.policy.confidenceCap, 0.9);
  assert.ok(r.body.functions.every((f) => f.safe && f.grade === "U" && f.paused === false && f.backlog === 0));
  const p = await post({ action: "asterisk.pause", function: "tagging", paused: true, note: "drift" });
  assert.equal(p.status, 200); assert.equal(p.body.state.paused, true); assert.equal(p.body.state.pausedBy, "admin");
  const bad = await post({ action: "asterisk.pause", function: "oracle", paused: true });
  assert.equal(bad.status, 400);
  const again = await post({ action: "asterisk.functions" });
  assert.equal(again.body.functions.find((f) => f.function === "tagging").paused, true);
  const resumed = await post({ action: "asterisk.pause", function: "tagging", paused: false });
  assert.equal(resumed.body.state.paused, false);
}));

test("a paused authentication appends nothing and answers 202 queued; resumed, the pass is logged and the public badge hides confidence", async () => withToken(async () => {
  const item = { id: "gov-item-1", title: "black leather biker jacket", brand: "Schott", designers: [], size: { label: "M" }, category: "outerwear", img: "https://i.ebayimg.com/x.jpg", source: "ebay", source_name: "ebay", source_product_id: "v1|1|0", url: "https://www.ebay.com/itm/1", tags: { ARCHIVAL: 0.6 }, price: 300 };
  await upsertItems([item]);
  await post({ action: "asterisk.pause", function: "authentication", paused: true });
  const queued = await callRoute(listingPOST, { path: "/api/verification/listing", method: "POST", json: { itemId: item.id, run: true }, bearer: TOKEN });
  assert.equal(queued.status, 202); assert.equal(queued.body.queued, true);
  const q = await post({ action: "asterisk.queue.list" });
  assert.equal(q.body.cases.length, 1); assert.equal(q.body.cases[0].function, "authentication"); assert.equal(q.body.cases[0].subjectId, item.id);
  await post({ action: "asterisk.pause", function: "authentication", paused: false });
  const ran = await callRoute(listingPOST, { path: "/api/verification/listing", method: "POST", json: { itemId: item.id, run: true }, bearer: TOKEN });
  assert.equal(ran.status, 200); assert.equal(ran.body.record.governance.outcome, "safe", "local rules at 0.5 take the safe outcome");
  const ledger = await post({ action: "asterisk.ledger", function: "authentication" });
  assert.equal(ledger.body.actions[0].actor, "asterisk"); assert.ok(ledger.body.actions[0].decision.reasoning.length > 10);
  assert.ok(ledger.body.actions[0].decision.evidence.some((e) => /^source:/.test(e)));
  const pub = await callRoute(listingGET, { path: "/api/verification/listing", query: { ids: item.id } });
  assert.equal(pub.status, 200);
  const badge = pub.body.items[0].badge;
  assert.equal(badge.state, "pending");
  assert.equal(badge.checks.ai.confidence, undefined, "passengers never see the confidence");
  assert.equal(badge.fraud, undefined); assert.equal(badge.resolveBy, undefined);
  assert.ok(badge.reason.length > 10, "the plain-language reason stays");
  // an override supersedes the decision and is ground truth
  const id = ledger.body.actions[0].id;
  const o = await post({ action: "asterisk.override", id, outcome: { answer: "pass" }, note: "label checked by hand" });
  assert.equal(o.status, 200); assert.equal(o.body.action.groundTruth, true); assert.equal(o.body.supersedes, id);
  const twice = await post({ action: "asterisk.override", id, outcome: { answer: "fail" } });
  assert.equal(twice.status, 409);
  const noOutcome = await post({ action: "asterisk.override", id: "5" });
  assert.equal(noOutcome.status, 400);
  const decided = await post({ action: "asterisk.queue.decide", id: q.body.cases[0].id, decision: { word: "re-run" } });
  assert.equal(decided.status, 200);
  assert.equal((await post({ action: "asterisk.queue.decide", id: q.body.cases[0].id, decision: { word: "again" } })).status, 409);
}));

test("a confirmed replica pattern forces Unverified with a fraud flag that alerts the queue; the threshold gates high value", async () => withToken(async () => {
  const item = { id: "gov-item-2", title: "Schott Perfecto wrong stitch leather jacket", brand: "Schott", designers: [], size: { label: "M" }, category: "outerwear", img: "https://i.ebayimg.com/y.jpg", source: "ebay", source_name: "ebay", source_product_id: "v1|2|0", url: "https://www.ebay.com/itm/2", tags: {}, price: 2500 };
  await upsertItems([item]);
  assert.equal((await post({ action: "verification.replica.confirm", house: "Schott", pattern: "x" })).status, 400, "three characters at least");
  const lib = await post({ action: "verification.replica.confirm", house: "Schott", pattern: "wrong stitch", note: "confirmed on case 12" });
  assert.equal(lib.status, 200); assert.equal(lib.body.pattern.confirmedBy, "admin");
  const t = await post({ action: "asterisk.threshold", category: "outerwear", amount: 1500 });
  assert.equal(t.status, 200); assert.deepEqual(t.body.state.settings.highValue, { outerwear: 1500 });
  const ran = await callRoute(listingPOST, { path: "/api/verification/listing", method: "POST", json: { itemId: item.id, run: true }, bearer: TOKEN });
  assert.equal(ran.status, 200);
  assert.equal(ran.body.badge.state, "unverified"); assert.match(ran.body.badge.reason, /replica signal/);
  assert.equal(ran.body.record.fraud, true);
  const q = await post({ action: "asterisk.queue.list" });
  assert.equal(q.body.cases.length, 1); assert.equal(q.body.cases[0].fraud, true); assert.equal(q.body.cases[0].alert, true);
  assert.ok(q.body.cases[0].reasons.includes("fraud flag") && q.body.cases[0].reasons.some((r) => /high value/.test(r)));
  const pub = await callRoute(listingGET, { path: "/api/verification/listing", query: { ids: item.id } });
  assert.equal(pub.body.items[0].badge.state, "unverified");
  assert.equal(pub.body.items[0].badge.fraud, undefined, "the fraud flag is the console's");
}));

test("grade: a thin ledger is U and lifts nothing; the standing is recorded", async () => withToken(async () => {
  const g = await post({ action: "asterisk.grade", function: "tagging" });
  assert.equal(g.status, 200); assert.equal(g.body.audit.grade, "U"); assert.equal(g.body.audit.unmeasured, true);
  assert.equal(g.body.standing.changed, false); assert.equal(g.body.calibration.measured, false);
  assert.equal((await post({ action: "asterisk.grade", function: "nothing" })).status, 400);
}));
