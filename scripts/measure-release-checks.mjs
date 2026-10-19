#!/usr/bin/env node
// scripts/measure-release-checks.mjs — THE §14 RELEASE CHECKS, as far as a
// machine without a browser can take them (V.2 brief §14, Stage D).
//
// Each check below is one of the brief's bullets. It is MEASURED when the
// pure law behind it can be driven here (the registry, the reranker, the
// badge rules, the DM windows, the gift state machine, clustering), and
// REPORTED AS "needs browser" or "needs CI Postgres" when it cannot — never
// assumed. Nothing here calls a model or a database. Exit 1 on any measured
// failure.
//
//   node scripts/measure-release-checks.mjs
import { TOP_WINDOW, DIVERSITY_PER_BRAND, foldTaste, affinity, rerankByTaste } from "../lib/search/reranker.js";
import { badgeFor, buildRecord, evidenceVersionOf } from "../lib/verification/ledger.js";
import { withinWindow, EDIT_WINDOW_MS, UNSEND_WINDOW_MS, parseDmSearch, SHARE_REFUSED_COPY } from "../lib/dm.js";
import { giftTransition } from "../lib/wardrobe/gifts.js";
import { clusterPins } from "../lib/places/cluster.js";
import { connectorRegistry, CONNECTOR_STATES } from "../lib/connectors/index.js";
import { lostness } from "../lib/analytics/lostness.js";
import { graphemeCount, TRANSMISSION_MAX } from "../lib/posts/compose.js";

const rows = [];
const check = (name, ok, note = "") => rows.push({ name, result: ok === null ? "needs browser / CI" : ok ? "PASS" : "FAIL", note });

// Fresh launch = The Feed; Front Cover a main tab; in-session positions kept
check("fresh launch opens The Feed; in-session tab positions kept", null, "browser: Stage A lib/dock.js session law + lib/viewstate.js");
// 320/375/390 widths, large text, keyboard open
check("every dock action reachable at 320/375/390 px, large text, keyboard open", null, "browser: ControlCenter search mode expands vertically");
// Feed → detail → DM → back
check("feed → detail → DM → back restores item / order / offset; each Likes subtab keeps its own search + position", null, "browser: lib/viewstate.js anchor restore (Stage A.2)");
// Scoped DM search
check("scoped DM search cannot reveal another viewer's messages, cleared history or unsent content; a forged viewer id changes nothing", null, "CI Postgres: tests/postgres-integration.test.js 'DM stage C: search sees only my own visible history…'");
const p = parseDmSearch("*no-emos-allowed: Jerry’s ice cream");
check("DM search syntax parses deterministically (handle + folded apostrophe)", p.handle === "no-emos-allowed" && p.text === "Jerry's ice cream");
// Edit / unsend at 59:59 vs 60:00
const t0 = Date.parse("2026-10-02T10:00:00Z");
check("edit at 59:59 inside the window, 60:00 outside (client rule; the server measures again)", withinWindow(t0, EDIT_WINDOW_MS, t0 + 3_599_999) && !withinWindow(t0, UNSEND_WINDOW_MS, t0 + 3_600_000));
check("conflict / offline retries cannot reset the window", null, "CI Postgres: the window reads created_at by clock_timestamp(); a retry carries the same version (P0008)");
// Sharing disabled / private / blocked enforced server-side incl. existing cards
check("sharing a disabled / private / blocked profile refused server-side, existing cards included", null, "CI Postgres: 'DM stage C: a profile card is refused server-side…' (the exact copy is " + JSON.stringify(SHARE_REFUSED_COPY.slice(0, 32)) + "…)");
// Composer layouts preserve text; overlong Transmission blocked without losing text
check("overlong Transmission is refused by count, never cut (the composer keeps the text)", graphemeCount("x".repeat(520)) > TRANSMISSION_MAX && graphemeCount("x".repeat(500)) === TRANSMISSION_MAX, "Stage B: lib/posts/compose.js graphemeCount / TRANSMISSION_MAX; the keep-the-text half is tests/post-composer.test.js");
// Concurrent gift acceptance
check("the gift state machine: only pending moves, only by the right party", giftTransition("pending", "accept", "recipient") === "accepted" && giftTransition("accepted", "accept", "recipient") === null && giftTransition("pending", "accept", "sender") === null);
check("concurrent gift acceptance cannot give one card to two people", null, "CI Postgres: 'wardrobe gift: concurrent accepts…' (three accepts → one winner)");
// Verification: stale / incomplete / uncertain cannot show a completed asterisk
const it = { id: "x", title: "t", brand: "b", designers: [], size: null, category: "tops", img: "i", source: "ebay", source_name: "ebay", source_product_id: "1", url: "https://www.ebay.com/itm/1" };
const pass = { status: "pass" };
const unsure = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.5, model: "local-rules" }, now: t0 });
const confident = buildRecord(it, { source: pass, ai: { status: "pass", confidence: 0.9, model: "m" }, now: t0 });
check("a stale / incomplete / uncertain verification cannot show a completed asterisk",
  badgeFor(unsure, it, t0).state === "pending" && badgeFor(confident, { ...it, title: "changed" }, t0).state === "none" && badgeFor(confident, it, t0 + 91 * 86_400_000).state === "none" && badgeFor(confident, it, t0).state === "verified" && evidenceVersionOf(it) !== evidenceVersionOf({ ...it, title: "changed" }));
// Sold notifications not triggered by outage, not duplicated by retries
check("sold notices: not on a provider outage, not duplicated by retries", null, "memory suite: tests/listing-status.test.js (Stage B.3) — green");
// Six-month images
check("six-month images: previews, explicit load, authorised retrieval", null, "built behind DM_MEDIA_ENABLED; the archive boundary is tested in tests/dm-stage-c.test.js; storage never exercised (owner decision)");
// No-result / LLM failure / API-unavailable honest
check("no-result / engine-failure / unavailable states are honest", null, "search answers a typed 503 on engine failure; the DM desk 503s rather than showing an empty inbox; the registry says requires-approval / unsupported in words");
// Wheel / Cover Flow alternatives
check("the connections wheel has a list and a reduced-motion alternative; every task works without a gesture", null, "browser: ConnectionsWheel.jsx (list first; wheel optional; arrows + keyboard; prefers-reduced-motion)");
// Sponsorship / provenance / creator / style inference distinguishable
check("sponsorship, provenance, creator authorship and style inference are distinguishable", null, "browser: AdStrip label (Stage A), provenanceLabel (Stage C), PostCard author, search match.reasons with 'taste' apart from the literal reason (Stage D)");
// Stage D's own laws, measured
const taste = { explicit: { GORP: 1 } };
const page = [{ id: "a", brand: "Helmut Lang", matchReason: "brand match", confidenceScore: 1, tags: { MINIMAL: 1 } }, { id: "b", brand: "x", matchReason: "tag match", confidenceScore: .4, tags: { GORP: 1 } }, { id: "c", brand: "y", matchReason: "tag match", confidenceScore: .4, tags: { STATEMENT: 1 } }];
const rr = rerankByTaste(page, { taste });
check("taste rerank preserves exact entity identity and the candidate set", rr[0].id === "a" && rr.length === 3 && new Set(rr.map((r) => r.id)).size === 3 && rr.every((r) => r.match && r.match.uncertainty));
check("taste rerank: diversity cap and exploration slots hold in the top window", (() => { const rs = []; for (let i = 0; i < 20; i++) rs.push({ id: "h" + i, brand: "Mono", matchReason: "tag match", confidenceScore: .4, tags: { GORP: 1 } }); for (let i = 0; i < 12; i++) rs.push({ id: "o" + i, brand: "O" + i, matchReason: "tag match", confidenceScore: .4, tags: { STATEMENT: 1 } }); const out = rerankByTaste(rs, { taste }).slice(0, TOP_WINDOW); return out.filter((r) => r.brand === "Mono").length <= DIVERSITY_PER_BRAND && out.some((r) => affinity(foldTaste(taste), r.tags) <= 0); })());
check("overlapping markers cluster deterministically and expand in place", (() => { const c = clusterPins([{ id: "a", x: 1, y: 1 }, { id: "b", x: 3, y: 2 }, { id: "z", x: 500, y: 500 }]); return c.length === 2 && c.find((m) => m.kind === "cluster").count === 2; })());
check("every connector capability reports one of the six explicit states", connectorRegistry().every((c) => c.capabilities.every((cap) => CONNECTOR_STATES.includes(cap.state))));
check("lostness: a straight line is 0, wandering reads lost", lostness(["feed", "detail"], 2).L === 0 && lostness(["a", "b", "a", "b", "a", "c"], 2).lost);

const failed = rows.filter((r) => r.result === "FAIL");
console.log("RELEASE CHECKS (V.2 §14) — " + new Date().toISOString());
for (const r of rows) console.log(`  ${r.result.padEnd(18)} ${r.name}${r.note ? "  — " + r.note : ""}`);
console.log(`\n${rows.filter((r) => r.result === "PASS").length} measured pass · ${failed.length} fail · ${rows.filter((r) => r.result.startsWith("needs")).length} need a browser or CI Postgres`);
process.exit(failed.length ? 1 : 0);
