// tests/verification-ledger.test.js — the badge rules (V.2 brief §12):
// the asterisk means completed listing checks; stale, missing, expired or
// failed evidence cannot produce it; a material change invalidates; AI alone
// completes it only when confident; local rules never are.
import test from "node:test";
import assert from "node:assert/strict";
import { AI_CONFIDENT_BAR, LOCAL_RULES_CONFIDENCE, RESOLVE_WINDOW_MS, aiCheckFromComparison, badgeFor, badgeLabel, buildRecord, evidenceVersionOf, sourceCheck, evidenceRequestFor, statusWordFor } from "../lib/verification/ledger.js";
import { replicaSignals, replicaCheck } from "../lib/verification/replicas.js";
import { resetMemoryAsterisk } from "../lib/db/production/asterisk.js";
import { compareItem } from "../lib/verification/desk.js";
import { runChecks } from "../lib/verification/run.js";
import { latestVerifications, resetMemoryVerifications } from "../lib/db/production/verification.js";

const listing = (over = {}) => ({ id: "v1|123|0", title: "black leather biker jacket", brand: "Schott", designers: [], size: { label: "M" }, category: "outerwear", img: "https://i.ebayimg.com/x.jpg", source: "ebay", source_name: "ebay", source_product_id: "v1|123|0", url: "https://www.ebay.com/itm/123", tags: { leather: 1 }, facets: { material: "leather" }, ...over });
const T0 = Date.parse("2026-10-02T12:00:00Z");

test.beforeEach(() => { resetMemoryVerifications(); resetMemoryAsterisk(); });

test("the evidence version follows the material fields only", () => {
  const a = evidenceVersionOf(listing());
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(evidenceVersionOf(listing({ price: 999, tags: { x: 1 } })), a, "price and tags are not material");
  for (const change of [{ title: "brown leather biker jacket" }, { brand: "Other" }, { designers: ["x"] }, { size: { label: "L" } }, { category: "tops" }, { img: "https://i.ebayimg.com/y.jpg" }]) {
    assert.notEqual(evidenceVersionOf(listing(change)), a, JSON.stringify(change) + " is material");
  }
});

test("the source check: an approved provider, a source id, a URL on its host", () => {
  assert.equal(sourceCheck(listing()).status, "pass");
  assert.equal(sourceCheck(listing({ source: "shopify", source_name: "shopify" })).status, "missing", "not an approved provider");
  assert.equal(sourceCheck(listing({ source_product_id: null })).status, "fail");
  assert.equal(sourceCheck(listing({ url: "https://evil.example/itm/123" })).status, "fail", "a URL off the provider's host");
  assert.equal(sourceCheck(listing({ url: "" })).status, "fail");
});

test("the AI check from the desk's comparison: local rules read, flag, fail — and are never confident", () => {
  const agree = aiCheckFromComparison(compareItem(listing()));
  assert.equal(agree.status, "pass"); assert.equal(agree.model, "local-rules"); assert.equal(agree.confidence, LOCAL_RULES_CONFIDENCE);
  assert.ok(LOCAL_RULES_CONFIDENCE < AI_CONFIDENT_BAR, "local rules cannot skip a human");
  const conflict = aiCheckFromComparison(compareItem(listing({ category: "tops", title: "black leather biker jacket outerwear" })));
  assert.equal(conflict.status, "fail", "a material conflict (category) fails");
  const silent = aiCheckFromComparison(compareItem(listing({ title: "item", tags: {}, category: null, facets: {} })));
  assert.equal(silent.status, "missing");
  const keyed = aiCheckFromComparison(compareItem(listing()), { model: "claude-opus-5", version: "p1", confidence: 0.92 });
  assert.equal(keyed.confidence, 0.9, "the 90% cap: a keyed model's 0.92 is reported as 0.9 (slice 5)");
  assert.equal(AI_CONFIDENT_BAR, 0.9, "AI alone completes the checks only at the cap");
});

test("the badge: stale, missing, expired and failed evidence cannot produce it; AI confident or a human completes it", () => {
  const it = listing();
  assert.equal(badgeFor(null, it).state, "none");
  const pass = { status: "pass", detail: "ok" };
  // local rules pass → PENDING (not confident), a human pass → VERIFIED
  let rec = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.5, model: "local-rules" }, now: T0 });
  assert.equal(badgeFor(rec, it, T0).state, "pending");
  rec = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.5, model: "local-rules" }, human: { status: "pass", reviewer: "archivalist" }, now: T0 });
  assert.equal(badgeFor(rec, it, T0).state, "verified");
  // a confident AI pass needs no human
  rec = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.9, model: "m" }, now: T0 });
  assert.equal(badgeFor(rec, it, T0).state, "verified");
  // a flag stays pending until a human passes it; a human fail kills it
  rec = buildRecord(it, { source: pass, ai: { status: "flag", confidence: 0.9, model: "m" }, now: T0 });
  assert.equal(badgeFor(rec, it, T0).state, "pending");
  rec = buildRecord(it, { source: pass, ai: { status: "flag", confidence: 0.9, model: "m" }, human: { status: "fail", reviewer: "r" }, now: T0 });
  assert.equal(badgeFor(rec, it, T0).state, "unverified", "failed on positive evidence is UNVERIFIED, a state (slice 5)");
  // source fail / ai fail → unverified; source missing → pending even with a confident AI
  assert.equal(badgeFor(buildRecord(it, { source: { status: "fail" }, ai: { status: "pass", confidence: 0.9, model: "m" }, now: T0 }), it, T0).state, "unverified");
  assert.equal(badgeFor(buildRecord(it, { source: pass, ai: { status: "fail", confidence: 0.9, model: "m" }, now: T0 }), it, T0).state, "unverified");
  assert.equal(badgeFor(buildRecord(it, { source: { status: "missing" }, ai: { status: "pass", confidence: 0.9, model: "m" }, now: T0 }), it, T0).state, "pending");
  // expiry
  rec = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.9, model: "m" }, now: T0, ttlDays: 90 });
  assert.equal(badgeFor(rec, it, T0 + 89 * 86_400_000).state, "verified");
  assert.equal(badgeFor(rec, it, T0 + 90 * 86_400_000).state, "none", "expired");
  // a MATERIAL CHANGE invalidates: the same record against a changed listing is stale
  assert.equal(badgeFor(rec, listing({ title: "brown leather biker jacket" }), T0).state, "none");
  assert.match(badgeFor(rec, listing({ title: "brown leather biker jacket" }), T0).reason, /changed/);
  assert.equal(badgeFor(rec, listing({ price: 1 }), T0).state, "verified", "a price change is not material");
  // labels
  assert.match(badgeLabel(badgeFor(rec, it, T0)), /not an authentication guarantee/);
  assert.equal(badgeFor(rec, it, T0).limitations.length, 3);
});

test("slice 5: the cap, the replica signal, the evidence request, the 72-hour deadline, the sold freeze, the compact status word", () => {
  const it = listing();
  const pass = { status: "pass", detail: "ok" };
  // the cap: a 0.97 model is 0.9 on the record, and 0.9 is the bar
  const capped = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.97, model: "m" }, now: T0 });
  assert.equal(capped.ai.confidence, 0.9); assert.equal(badgeFor(capped, it, T0).state, "verified");
  assert.equal(badgeFor(buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.89, model: "m" }, now: T0 }), it, T0).state, "pending", "under the cap waits for a reviewer");
  // a replica signal: Unverified regardless of a reviewer's pass, and a fraud flag
  const sig = replicaSignals(listing({ title: "Schott wrong stitch jacket" }), [{ house: "Schott", pattern: "Wrong Stitch" }]);
  assert.equal(sig.length, 1);
  assert.deepEqual(replicaSignals(listing({ title: "Schott wrong stitch jacket", brand: "Other" }), [{ house: "Schott", pattern: "wrong stitch" }]), [], "a pattern is per house");
  assert.deepEqual(replicaSignals(listing({ title: "no stitching wrong here" }), [{ house: "Schott", pattern: "wrong stitch" }]), [], "whole words, in order");
  const forced = buildRecord(it, { source: pass, ai: replicaCheck(sig), human: { status: "pass", reviewer: "r" }, now: T0 });
  assert.equal(forced.fraud, true); assert.equal(badgeFor(forced, it, T0).state, "unverified"); assert.match(badgeFor(forced, it, T0).reason, /replica signal/);
  assert.equal(replicaCheck([]), null);
  // an evidence request only for a native listing, and it pauses: pending with the asks named
  const native = listing({ source: "asilum", source_name: "asilum", listed_at: new Date(T0).toISOString() });
  assert.deepEqual(evidenceRequestFor(native, { status: "missing" }), { asks: ["care label", "additional photographs"] });
  assert.equal(evidenceRequestFor(it, { status: "missing" }), null, "nobody to ask on an external listing");
  assert.equal(evidenceRequestFor(native, { status: "pass" }), null);
  assert.equal(sourceCheck(native).status, "pass", "a listing made with us has our own row as its provenance");
  const asked = buildRecord(native, { source: sourceCheck(native), ai: { status: "missing", confidence: 0.5, model: "local-rules" }, now: T0, evidenceRequest: { asks: ["care label", "nonsense"] } });
  assert.deepEqual(asked.evidenceRequest.asks, ["care label"], "only the checklist's asks");
  assert.equal(asked.resolveBy, new Date(T0 + RESOLVE_WINDOW_MS).toISOString());
  assert.equal(badgeFor(asked, native, T0 + 3_600_000).state, "pending"); assert.match(badgeFor(asked, native, T0 + 3_600_000).reason, /waiting for the seller: care label/);
  // 72 hours: unanswered, it resolves Unverified — and stays listed
  assert.equal(badgeFor(asked, native, T0 + RESOLVE_WINDOW_MS).state, "unverified");
  assert.match(badgeFor(asked, native, T0 + RESOLVE_WINDOW_MS).reason, /72 hours/);
  assert.equal(buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.5, model: "local-rules" }, now: T0 }).resolveBy, null, "an external listing carries no deadline");
  // sold freezes: a material change or expiry no longer invalidates
  const verified = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.9, model: "m" }, now: T0 });
  const sold = listing({ availability_status: "sold", title: "a different title" });
  assert.equal(badgeFor(verified, sold, T0 + 400 * 86_400_000).state, "verified");
  assert.equal(badgeFor(verified, listing({ title: "a different title" }), T0).state, "none", "unsold, the change invalidates");
  // the compact status word (12.1)
  assert.equal(statusWordFor(badgeFor(verified, it, T0)), "VERIFIED");
  assert.equal(statusWordFor(badgeFor(forced, it, T0)), "UNVERIFIED");
  assert.equal(statusWordFor(badgeFor(null, it, T0)), null, "no checks is no word, not Unverified (12.6)");
  assert.match(badgeLabel(badgeFor(forced, it, T0)), /unverified, still listed/);
});

test("runChecks appends a row the ledger reads back; a review is a new row for the current version", async () => {
  const it = listing();
  const r1 = await runChecks(it, { now: T0 });
  assert.equal(r1.source.status, "pass"); assert.equal(r1.ai.status, "pass"); assert.equal(r1.human.status, "none");
  assert.equal(badgeFor(r1, it, T0).state, "pending", "local rules alone leave it pending");
  const r2 = await runChecks(it, { human: "pass", reviewer: "archivalist", now: T0 + 1000 });
  assert.equal(badgeFor(r2, it, T0 + 1000).state, "verified");
  const latest = await latestVerifications([it.id]);
  assert.equal(latest.get(it.id).id, r2.id, "the latest row is the review");
  // the listing changes: the review no longer applies
  assert.equal(badgeFor(latest.get(it.id), listing({ size: { label: "XL" } }), T0 + 2000).state, "none");
});
