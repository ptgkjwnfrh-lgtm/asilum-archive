// app/api/admin/route.js
// Admin/moderation backend — no public UI yet (deliberate: the public design
// is locked; a full admin page can mount on these functions later).
//
// Auth: ADMIN_TOKEN env var; requests send "Authorization: Bearer <token>".
// Unset token = admin disabled entirely (503, honest error).
//
// GET  ?area=overview|tags|mappings|sync-logs|search-logs|tickets|adapters|business|orders
//   orders — the order ledger with event trails (operator read)
// POST { action, ... }:
//   business.approve { accountId, note? }   — raise passport → business
//   business.reject  { accountId, note }    — note required; applicant reads it
//   tag.add    { productId, tag, tagType?, confidence? } — tagType from the
//              vocabulary (lib/tagging/vocabulary.js); an invented one is a 400
//   tag.delete { id }
//   tag.merge  { from, to }
//   mapping.upsert { searchPhrase, mappedTags, relatedTerms, referenceType?, confidence? }
//   mapping.delete { searchPhrase }
//   product.moderate { productId, status: visible|hidden|flagged }
//   sync.run   { query?, limit? }
//   inventory.upsert { sourceName, items: [...] } — real-inventory intake
//     (L1); every item must pass the checkout honesty gate or the whole
//     batch refuses 409 with per-index reasons. docs/DESIGNER-INTAKE.md.
//   order.refund { orderId } — full refund of a PAID order (mechanism only;
//     the published policy decides when). Actor lands on the ledger.
//   business.domain-check { accountId } — read-only evidence collector:
//     is the account's verify token served by its claimed domains?
//   business.link-source { accountId, sourceName } — verified business ↔
//     inventory namespace, unique, one time each.
//   asterisk.functions — ASTERISK governance (V.2, slice 5): every function's
//     state (paused, grade, standing, settings), the open queue counts
//   asterisk.pause { function, paused, note? } — stop or resume one function;
//     a paused function's new work waits in the admin queue
//   asterisk.ledger { function?, limit? } — every logged decision with its
//     evidence, confidence and reasoning, overrides marked
//   asterisk.override { id, outcome: {answer?, ...}, note? } — supersede a
//     decision; the override is a new row, ground truth
//   asterisk.queue.list { status?, function? } · asterisk.queue.decide { id, decision }
//   asterisk.grade { function } — audit one function over its ledger and set
//     its standing (two poor grades hand it to the queue)
//   asterisk.threshold { category, amount } — the high-value gate per category
//   verification.replica.confirm { house, pattern, note? } — add to the library
//   aftersale.returns { status? } · aftersale.deliver { order, source?, tracking? }
//   aftersale.decide { id, approve, fault, refundTo, refundCents?, decision }
//   aftersale.refund { id } · aftersale.dispatch { order, extensionDays, approved }
//   score.penalty { propose, userId, reason } | { id, penaltyAction } · score.mark { review, excluded?, refunded? }
//   score.read { subject } · credit.void { userId, amountCents, note } · credit.read { userId }
//   brdcst.list { state? } — every campaign (V.2 chapter 5; slice 8)
//   brdcst.interrupt { id, reason: "interrupted"|"event_cancelled"|"policy", note? }
//     — ASILUM stops a campaign: unused days refund as credit with the bonus;
//     a policy reason parks it under review
//   brdcst.review { id, refund: true|false, note } — decide a policy review
//   brdcst.sweep — send the three-hourly failed-payment reminders now
//   payouts.list { state? } · payouts.release { order } · payouts.deduct { order, returnId, amountCents } — 10.12–10.13, 6.7 (slice 11)
//   topups.list { state? } · topups.settle { id } — the platform's Credit top-ups (5.32)
//   wardrobe.offers { limit? } — every Wardrobe private-sale negotiation (chapter 13)
//   verification.appeals { state? } · verification.appeal.decide { id, upheld, decision } — 12.9, a human decides
//   identity.read { accountId } — the home town and whether an ethnicity is on record (never the value)
//   steward.report — the board, the repairs the hands would make, the ledger
//   steward.act { confirm?: [actionId], dryRun? } — make the delegated
//     repairs (lib/steward/decisions.js); `confirm` is a person's yes, for
//     this run only, to a confirm-tier one. Never-tier ids are refused.
//   steward.revert { id } — undo one ledger row; refuses a second time
//   inventory.import-shopify { accountId, currency?, allowImageCollisions? }
//     — consented bulk import from the business's own store; gate-passing
//     items land, failures are reported loudly (partial, unlike
//     inventory.upsert). Both inventory doors run the stolen-image screen:
//     cross-source photo collisions refuse/skip until the operator judges
//     them (allowImageCollisions:true) or opens an impersonation case.

import { NextResponse } from "next/server";
import { getPool, upsertItems } from "../../../lib/db/index.js";
import { validateIntakeBatch, validSourceName } from "../../../lib/ingest/intake.js";
import { typedTagsFrom } from "../../../lib/ingest/adapters/normalize.js";
import { facetOf, FACET_NAMES } from "../../../lib/tagging/vocabulary.js";
import { checkDomainProof } from "../../../lib/brands/verify.js";
import { importShopifyInventory } from "../../../lib/brands/shopify.js";
import { refundOrder } from "../../../lib/orders.js";
import { listRecentOrders, listOrderEvents } from "../../../lib/db/orders.js";
import {
  getProductTags, addProductTags, deleteProductTag, mergeProductTags,
  listSearchMappings, upsertSearchMapping, deleteSearchMapping,
  listSyncLogs,
  listBusinessApplications, listVerifiedBusinesses, decideBusinessApplication,
  getBusinessAccount, setBusinessSourceName, findBrandNameCollisions,
  setHotlistMembership, recordHotlistRent, hotlistProgramState,
} from "../../../lib/db/production.js";
import { HOTLIST_RENT_CENTS } from "../../../lib/hotlist.js";
import { screenItemImages, saveImageFingerprint } from "../../../lib/db/imageFingerprints.js";
import { fingerprintImageUrl } from "../../../lib/images/fingerprint.js";
import { adapterStatuses } from "../../../lib/ingest/adapters/index.js";
import { bearerToken, secureTokenEqual } from "../../../lib/security/request.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../lib/security/json.js";

export const dynamic = "force-dynamic";

function authed(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 16) return { ok: false, status: 503, error: "admin disabled — set ADMIN_TOKEN (16+ chars)" };
  if (!secureTokenEqual(bearerToken(req), token)) return { ok: false, status: 401, error: "bad admin token" };
  return { ok: true };
}

// Audit attribution is server configuration, never caller-controlled JSON.
// ADMIN_TOKEN authenticates the operator surface; ADMIN_ACTOR names that
// operator in durable review/case ledgers.
function adminActor() {
  const actor = String(process.env.ADMIN_ACTOR || "admin").trim();
  return actor ? actor.slice(0, 80) : "admin";
}

export async function GET(req) {
  const gate = authed(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const quota = await consumeRateLimit({ scope: "admin-read", subject: "operator", limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const { searchParams } = new URL(req.url);
  const area = searchParams.get("area") || "overview";
  const p = await getPool();

  try {
    if (area === "adapters") return NextResponse.json({ adapters: adapterStatuses() });
    if (area === "orders") {
      // The order ledger, operator's read: recent orders with their full
      // event trails. The notify mail says "the ledger is the authority" —
      // this is where the operator reads it without psql.
      const orders = await listRecentOrders(50);
      const withEvents = [];
      for (const order of orders) {
        withEvents.push({
          ...order,
          events: (await listOrderEvents(order.id, 20)).map((e) => ({
            type: e.type, source: e.source, created_at: e.created_at || null,
          })),
        });
      }
      return NextResponse.json({ orders: withEvents });
    }
    if (area === "business") {
      // The booth review desk: pending applications + the current roster.
      // nameCollisions computed LIVE per application (a stale flag from
      // submit time would miss applications that arrived after it).
      const applications = await listBusinessApplications({ status: "under_review", limit: 100 });
      for (const application of applications) {
        application.nameCollisions = await findBrandNameCollisions(
          application.brandName, application.accountId).catch(() => []);
      }
      return NextResponse.json({
        applications,
        verified: await listVerifiedBusinesses(50),
      });
    }
    if (area === "mappings") return NextResponse.json({ mappings: await listSearchMappings() });
    if (area === "sync-logs") return NextResponse.json({ logs: await listSyncLogs() });
    if (area === "tags") {
      const productId = searchParams.get("productId");
      if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
      return NextResponse.json({ tags: await getProductTags(productId) });
    }
    if (area === "search-logs") {
      if (!p) return NextResponse.json({ logs: [], persistent: false });
      const { rows } = await p.query("SELECT * FROM search_logs ORDER BY created_at DESC LIMIT 100");
      return NextResponse.json({ logs: rows, persistent: true });
    }
    if (area === "tickets") {
      if (!p) return NextResponse.json({ tickets: [], persistent: false });
      const { rows } = await p.query("SELECT * FROM purchase_tickets ORDER BY created_at DESC LIMIT 100");
      return NextResponse.json({ tickets: rows, persistent: true });
    }
    // overview
    const counts = { persistent: !!p };
    if (p) {
      for (const t of ["items", "product_tags", "search_mappings", "search_logs", "purchase_tickets", "editorial_posts", "mood_board_uploads", "stylist_outfits"]) {
        counts[t] = (await p.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      }
    }
    return NextResponse.json({ counts, adapters: adapterStatuses() });
  } catch {
    return NextResponse.json({ error: "admin read failed" }, { status: 500 });
  }
}

export async function POST(req) {
  const gate = authed(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const quota = await consumeRateLimit({ scope: "admin-write", subject: "operator", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const parsed = await readJsonRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  try {
    switch (body.action) {
      case "order.refund": {
        // Full refund of a paid order — mechanism only, the published policy
        // and the operator decide WHEN. Actor lands on the ledger event.
        const result = await refundOrder(String(body.orderId || ""), { actor: adminActor() });
        if (result.status !== 200) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }
        return NextResponse.json({ refunded: result.order.id, refund: result.refund, status: result.order.status });
      }
      case "business.domain-check": {
        // Evidence COLLECTOR for the verification case — reports whether the
        // account's token is served by its claimed domains. Read-only: the
        // named human attaches this when deciding; no machine path to
        // verified (v18 law).
        const account = await getBusinessAccount(String(body.accountId || ""));
        if (!account) return NextResponse.json({ error: "no application for that account" }, { status: 404 });
        const report = await checkDomainProof({
          websiteUrl: account.websiteUrl,
          shopifyDomain: account.shopifyDomain,
          accountId: account.accountId,
        });
        return NextResponse.json({
          ...report,
          note: report.found
            ? "attach this as evidence on the decide step — a named human still makes the call"
            : "token not found — the applicant places it (meta tag or /.well-known/asilum-verify.txt), then re-run",
        });
      }
      case "business.link-source": {
        const named = validSourceName(body.sourceName);
        if (!named.ok) return NextResponse.json({ error: named.reason }, { status: 400 });
        try {
          const row = await setBusinessSourceName(String(body.accountId || ""), named.source);
          return NextResponse.json({ linked: { accountId: row.accountId, brandName: row.brandName, sourceName: row.sourceName } });
        } catch (err) {
          const msg = err && err.message ? err.message : "link failed";
          const status = /another business/.test(msg) ? 409 : /verified business|no business/.test(msg) ? 409 : 500;
          return NextResponse.json({ error: msg }, { status });
        }
      }
      case "inventory.import-shopify": {
        // Consented bulk import from the business's own store. Partial with a
        // LOUD skip report (contrast: inventory.upsert is atomic on purpose).
        const account = await getBusinessAccount(String(body.accountId || ""));
        if (!account) return NextResponse.json({ error: "no application for that account" }, { status: 404 });
        if (account.status !== "business") {
          return NextResponse.json({ error: "only a verified business imports inventory" }, { status: 409 });
        }
        if (!account.sourceName) {
          return NextResponse.json({ error: "link a source name first (business.link-source)" }, { status: 409 });
        }
        const currency = /^[A-Za-z]{3}$/.test(String(body.currency || "")) ? String(body.currency).toUpperCase() : "USD";
        const result = await importShopifyInventory({
          shopifyDomain: account.shopifyDomain,
          sourceName: account.sourceName,
          currency,
        });
        if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
        // Stolen-image screen: cross-source collisions move the item to the
        // skip list (import's partial-with-loud-report law) unless overridden.
        const screen = await screenItemImages(result.imported, {
          excludeSource: account.sourceName, fingerprint: fingerprintImageUrl,
        });
        const collided = new Set(
          body.allowImageCollisions === true ? [] : screen.collisions.map((c) => c.itemId));
        const landing = result.imported.filter((p) => !collided.has(p.id));
        for (const c of screen.collisions) {
          if (collided.has(c.itemId)) {
            result.skipped.push({
              handle: c.itemId, title: c.title,
              reason: `image matches ${c.against[0].sourceName}'s ${c.against[0].itemId} (distance ${c.against[0].distance}) — judge it, then override or open an impersonation case`,
            });
          }
        }
        if (landing.length) {
          await upsertItems(landing);
          for (const p of landing) {
            await addProductTags(p.id, typedTagsFrom(p));
            const fp = screen.fingerprints.get(p.id);
            if (fp) await saveImageFingerprint({ itemId: p.id, sourceName: p.source_name, imageUrl: fp.imageUrl, dhash: fp.dhash });
          }
        }
        return NextResponse.json({
          imported: landing.length,
          skipped: result.skipped,
          fingerprinted: screen.fingerprints.size,
          unfingerprinted: screen.unfingerprinted,
          imageCollisionsOverridden: body.allowImageCollisions === true ? screen.collisions : undefined,
          items: landing.map((p) => ({ id: p.id, title: p.title, price: p.price, currency: p.currency, availability_status: p.availability_status })),
        });
      }
      case "inventory.upsert": {
        // Real-inventory intake (risk campaign L1). The checkout engine's own
        // honesty gate validates every item BEFORE anything is written — one
        // bad item refuses the whole batch with per-index reasons, so the
        // catalog can never drift half-real. docs/DESIGNER-INTAKE.md is the
        // operator runbook.
        const { ok, problems, normalized } = validateIntakeBatch(body.items, body.sourceName);
        if (!ok) {
          return NextResponse.json({ error: "intake refused — nothing written", problems }, { status: 409 });
        }
        // Stolen-image screen (18 Aug): cross-source photo collisions refuse
        // the batch (intake's atomic law) unless the operator explicitly
        // overrides after judging them. Unfingerprintable images are
        // reported, never fatal.
        const screen = await screenItemImages(normalized, {
          excludeSource: normalized[0].source_name, fingerprint: fingerprintImageUrl,
        });
        if (screen.collisions.length && body.allowImageCollisions !== true) {
          return NextResponse.json({
            error: "intake refused — image collisions with another source; judge them, then resend with allowImageCollisions:true or open an impersonation case",
            imageCollisions: screen.collisions,
          }, { status: 409 });
        }
        await upsertItems(normalized);
        for (const p of normalized) {
          await addProductTags(p.id, typedTagsFrom(p));
          const fp = screen.fingerprints.get(p.id);
          if (fp) await saveImageFingerprint({ itemId: p.id, sourceName: p.source_name, imageUrl: fp.imageUrl, dhash: fp.dhash });
        }
        return NextResponse.json({
          upserted: normalized.length,
          fingerprinted: screen.fingerprints.size,
          unfingerprinted: screen.unfingerprinted,
          imageCollisionsOverridden: body.allowImageCollisions === true ? screen.collisions : undefined,
          items: normalized.map((p) => ({ id: p.id, title: p.title, price: p.price, currency: p.currency, availability_status: p.availability_status })),
        });
      }
      case "tag.add": {
        // NAME THE CAUSE, NOT THE SYMPTOM. `addProductTags` resolves the facet
        // through lib/tagging/vocabulary.js and DROPS one nobody defined, which
        // is right for a batch of ingest rows and useless for a person typing a
        // single tag: they got `{added: 0}` and no reason. The facet a caller
        // invented is the only thing worth telling them, so it is said here
        // rather than counted as a silent no-op.
        const facet = facetOf(body.tagType || "aesthetic");
        if (!facet) {
          return NextResponse.json({
            error: `unknown facet "${String(body.tagType).slice(0, 40)}"`,
            facets: FACET_NAMES,
          }, { status: 400 });
        }
        return NextResponse.json({
          added: await addProductTags(body.productId, [{ tag: body.tag, tagType: facet, confidence: body.confidence, source: "admin" }]),
          facet,
        });
      }
      case "tag.delete":
        return NextResponse.json({ deleted: await deleteProductTag(body.id) });
      case "tag.merge":
        return NextResponse.json({ merged: await mergeProductTags(body.from, body.to) });
      case "mapping.upsert":
        return NextResponse.json({ mapping: await upsertSearchMapping(body) });
      case "mapping.delete":
        return NextResponse.json({ deleted: await deleteSearchMapping(body.searchPhrase) });
      case "product.moderate": {
        const p = await getPool();
        if (!p) return NextResponse.json({ error: "requires database" }, { status: 503 });
        if (!["visible", "hidden", "flagged"].includes(body.status)) {
          return NextResponse.json({ error: "status must be visible, hidden, or flagged" }, { status: 400 });
        }
        const status = body.status;
        const r = await p.query(
          "UPDATE items SET moderation_status=$2, flagged=($2='flagged'), updated_at=now() WHERE id=$1",
          [body.productId, status]
        );
        return NextResponse.json({ moderated: r.rowCount });
      }
      case "hotlist.enroll": {
        // P3 (manual first cohort): a verified business opts into the paid
        // program. Rent is recorded separately; enrollment alone places
        // nothing.
        const state = await setHotlistMembership(String(body.accountId || ""), true);
        return NextResponse.json({ program: state });
      }
      case "hotlist.unenroll": {
        const state = await setHotlistMembership(String(body.accountId || ""), false);
        return NextResponse.json({ program: state });
      }
      case "hotlist.rent-paid": {
        // One manual invoice settled = one month of coverage, appended to
        // the rent ledger; paid-through advances from max(today, current).
        const state = await recordHotlistRent(String(body.accountId || ""), {
          amountCents: HOTLIST_RENT_CENTS,
          actor: adminActor(),
          note: body.note ? String(body.note).slice(0, 400) : null,
        });
        return NextResponse.json({ program: state });
      }
      case "hotlist.state": {
        const state = await hotlistProgramState(String(body.accountId || ""));
        if (!state) return NextResponse.json({ error: "no business account" }, { status: 404 });
        return NextResponse.json({ program: state });
      }
      case "business.approve":
      case "business.reject": {
        // The human decision the whole upgrade waits on. Attribution is
        // the server-configured operator, never caller JSON; the linked
        // verification case enforces evidence + CAS underneath.
        const accountId = String(body.accountId || "").trim();
        if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });
        const approve = body.action === "business.approve";
        const note = body.note ? String(body.note).slice(0, 500) : null;
        if (!approve && !note) {
          return NextResponse.json({ error: "a rejection carries a note — the applicant reads it" }, { status: 400 });
        }
        try {
          const row = await decideBusinessApplication({ accountId, approve, note, actor: adminActor() });
          return NextResponse.json({ account: row });
        } catch (error) {
          return NextResponse.json({ error: String(error?.message || "decision failed") }, { status: 409 });
        }
      }
      case "sync.run": {
        const { syncProducts } = await import("../../../lib/ingest/adapters/sync.js");
        return NextResponse.json({ runs: await syncProducts({ query: body.query, limit: body.limit }) });
      }
      // ---- AI-foundation inspection (Day 9): admin/debug review ----
      case "ai.events": {
        const { listAiModelEvents } = await import("../../../lib/db/production.js");
        return NextResponse.json({ events: await listAiModelEvents({ feature: body.feature || null, limit: body.limit || 100 }) });
      }
      case "ai.analyses": {
        const { listMoodBoardAnalyses } = await import("../../../lib/db/production.js");
        if (!body.user) return NextResponse.json({ error: "user required" }, { status: 400 });
        return NextResponse.json({ analyses: await listMoodBoardAnalyses(body.user, body.limit || 60) });
      }
      case "ai.profile": {
        const { getUserStyleProfileRow } = await import("../../../lib/db/production.js");
        if (!body.user) return NextResponse.json({ error: "user required" }, { status: 400 });
        return NextResponse.json({ profile: await getUserStyleProfileRow(body.user) });
      }
      case "ai.config": {
        const { describeAiConfig } = await import("../../../lib/ai/config.js");
        return NextResponse.json({ config: describeAiConfig() });
      }
      case "stylist.feedback": {
        const { listStylistFeedback } = await import("../../../lib/db/production.js");
        if (!body.user) return NextResponse.json({ error: "user required" }, { status: 400 });
        return NextResponse.json({ feedback: await listStylistFeedback(body.user, body.limit || 100) });
      }
      // ---- Asterisk AI (Day 10): dual-tag audit, ontology, facts, moderation ----
      case "asterisk.audit": {
        const { auditProductTags } = await import("../../../lib/asterisk/tagAudit.js");
        if (!body.productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
        const r = await auditProductTags(body.productId);
        return NextResponse.json(r, { status: r.ok ? 200 : 404 });
      }
      case "asterisk.aiTags": {
        const { getProductAiTags } = await import("../../../lib/db/production.js");
        if (!body.productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
        return NextResponse.json({ aiTags: await getProductAiTags(body.productId) });
      }
      case "asterisk.reconciliations": {
        const { listTagReconciliations } = await import("../../../lib/db/production.js");
        return NextResponse.json({ reconciliations: await listTagReconciliations({
          productId: body.productId || null,
          reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : null,
          limit: body.limit || 50 }) });
      }
      case "asterisk.ontology.sync": {
        const { syncOntology } = await import("../../../lib/asterisk/ontology.js");
        return NextResponse.json({ upserted: await syncOntology() });
      }
      case "asterisk.ontology": {
        const { listOntologyTags } = await import("../../../lib/db/production.js");
        return NextResponse.json({ tags: await listOntologyTags({ tagType: body.tagType || null, limit: body.limit || 500 }) });
      }
      case "asterisk.fact.record": {
        const { recordFact } = await import("../../../lib/asterisk/facts.js");
        const r = await recordFact(body);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.fact.review": {
        const { reviewFact } = await import("../../../lib/asterisk/facts.js");
        const r = await reviewFact(body.id, body.status, adminActor());
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.facts": {
        const { listLearnedFacts } = await import("../../../lib/db/production.js");
        return NextResponse.json({ facts: await listLearnedFacts({
          entityType: body.entityType || null, entityId: body.entityId || null,
          status: body.status || null, limit: body.limit || 100 }) });
      }
      // ---- the steward: one read-only pass over the live machine ----------
      // No arguments, no writes, nothing destructive: it reports and the
      // person at the desk decides. The runner never throws — a check that
      // cannot run comes back as `unmeasurable`, which the desk shows as a
      // finding rather than as silence. Migration FILES are not in this
      // bundle, so schemaVersions is deliberately not passed and the ledger
      // check says so in its own evidence.
      // ---- 09 THE STEWARD. report = the board + what the hands WOULD do +
      // the ledger (all reads). act = the delegated repairs, plus any confirm-
      // tier one named in `confirm` (a person's yes for THIS run). revert =
      // undo one ledger row. Every write goes through lib/steward/index.js,
      // where the ledger row precedes the mutation in one transaction.
      // ---- ASTERISK governance (V.2 Blueprint, Part I; slice 5) -------------
      case "asterisk.functions": {
        const [gov, G] = await Promise.all([import("../../../lib/db/production/asterisk.js"), import("../../../lib/asterisk/governance.js")]);
        const states = await gov.getFunctionStates();
        const backlog = await gov.countOpenQueue();
        return NextResponse.json({
          policy: { confidenceCap: G.CONFIDENCE_CAP, splitUnder: G.SPLIT_UNDER, collectiveBar: G.COLLECTIVE_BAR, maxAgents: G.MAX_AGENTS, taskBudgetMs: G.TASK_BUDGET_MS },
          functions: G.FUNCTION_IDS.map((fn) => ({ ...states.get(fn), label: G.FUNCTIONS[fn].label, safe: G.FUNCTIONS[fn].safe, prevents: G.FUNCTIONS[fn].prevents, implementedBy: G.FUNCTIONS[fn].implementedBy, backlog: backlog[fn] || 0 })),
        });
      }
      case "asterisk.pause": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        const { isFunction } = await import("../../../lib/asterisk/governance.js");
        if (!isFunction(body.function)) return NextResponse.json({ error: "function must be one of the seven" }, { status: 400 });
        const state = await gov.setFunctionPaused(body.function, body.paused !== false, { actor: adminActor(), note: body.note ? String(body.note).slice(0, 300) : null });
        return NextResponse.json({ state });
      }
      case "asterisk.ledger": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        const { isFunction } = await import("../../../lib/asterisk/governance.js");
        const fn = body.function && isFunction(body.function) ? body.function : null;
        return NextResponse.json({ actions: await gov.listAsteriskActions({ fn, limit: body.limit || 50 }) });
      }
      case "asterisk.override": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const outcome = body.outcome && typeof body.outcome === "object" ? body.outcome : null;
        if (!outcome) return NextResponse.json({ error: "outcome (an object) required — an override states what stands" }, { status: 400 });
        const r = await gov.overrideAsteriskAction(String(body.id), { outcome, note: body.note ? String(body.note).slice(0, 300) : null, actor: adminActor() });
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "asterisk.queue.list": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        const { isFunction } = await import("../../../lib/asterisk/governance.js");
        const status = ["open", "decided", "all"].includes(body.status) ? body.status : "open";
        return NextResponse.json({ cases: await gov.listAdminQueue({ status, fn: isFunction(body.function) ? body.function : null, limit: body.limit || 100 }) });
      }
      case "asterisk.queue.decide": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const decision = body.decision && typeof body.decision === "object" ? body.decision : null;
        if (!decision) return NextResponse.json({ error: "decision (an object) required" }, { status: 400 });
        const r = await gov.decideAdminCase(String(body.id), { decision, actor: adminActor() });
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "asterisk.grade": {
        const [gov, G] = await Promise.all([import("../../../lib/db/production/asterisk.js"), import("../../../lib/asterisk/governance.js")]);
        if (!G.isFunction(body.function)) return NextResponse.json({ error: "function must be one of the seven" }, { status: 400 });
        const windowMs = 7 * 86_400_000;
        const since = new Date(Date.now() - windowMs).toISOString();
        const rows = await gov.listAsteriskActions({ fn: body.function, limit: 500, since });
        const decisions = rows.filter((r) => r.actor === "asterisk" && r.outcome !== "queued").map((r) => ({ ...r.decision, overridden: r.overridden }));
        const backlog = (await gov.countOpenQueue())[body.function] || 0;
        const audit = G.auditFunction(body.function, { decisions, backlog, windowMs });
        const prev = await gov.getFunctionState(body.function);
        const standing = G.standingAfter(prev, audit.grade);
        const state = standing.changed ? await gov.setFunctionStanding(body.function, { ...standing, audit }) : prev;
        const calibration = G.calibrate(decisions.filter((d) => Number.isFinite(Number(d.confidence))).map((d) => ({ confidence: d.confidence, correct: !d.overridden })));
        return NextResponse.json({ audit, standing, state, calibration });
      }
      case "asterisk.threshold": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        const category = String(body.category || "").trim().toLowerCase().slice(0, 40);
        const amount = Number(body.amount);
        if (!category || !Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "category and a non-negative amount" }, { status: 400 });
        const cur = await gov.getFunctionState("authentication");
        const state = await gov.setFunctionSettings("authentication", { highValue: { ...((cur.settings || {}).highValue || {}), [category]: amount } });
        return NextResponse.json({ state });
      }
      case "verification.replica.confirm": {
        const gov = await import("../../../lib/db/production/asterisk.js");
        const r = await gov.confirmReplicaPattern({ house: body.house, pattern: body.pattern, note: body.note ? String(body.note).slice(0, 300) : null, actor: adminActor() });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      // ---- after the sale (V.2 chapter 6; slice 7) ---------------------------------
      case "aftersale.returns": {
        const A = await import("../../../lib/db/production/aftersale.js");
        return NextResponse.json({ returns: await A.openReturns({ status: ["open", "approved", "refused", "refunded", "all"].includes(body.status) ? body.status : "open", limit: body.limit || 100 }) });
      }
      case "aftersale.deliver": {
        const A = await import("../../../lib/db/production/aftersale.js");
        try { return NextResponse.json(await A.recordDelivery({ orderId: String(body.order || ""), by: "admin", source: body.source === "carrier" ? "carrier" : "admin", tracking: body.tracking || null, deliveredAt: body.deliveredAt ? Date.parse(body.deliveredAt) : Date.now() }), { status: 201 }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "aftersale.decide": {
        const A = await import("../../../lib/db/production/aftersale.js");
        try { return NextResponse.json(await A.decideReturn({ returnId: String(body.id || ""), actor: adminActor(), approve: body.approve === true, fault: body.fault || "undetermined", refundTo: body.refundTo || "credit", refundCents: body.refundCents == null ? null : Number(body.refundCents), decision: body.decision || "" })); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "aftersale.refund": {
        // an approved return refunds: in Credit here; to the original method through the order engine (external rail) or the connected refund ledger (native, not yet)
        const A = await import("../../../lib/db/production/aftersale.js");
        try {
          const r = await A.getReturn(String(body.id || ""));
          if (!r) return NextResponse.json({ error: "return not found" }, { status: 404 });
          if (r.refundTo === "original") {
            const result = await refundOrder(r.orderId, { actor: adminActor() });
            if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
          }
          return NextResponse.json({ return: await A.settleReturnRefund({ returnId: r.id, actor: adminActor() }) });
        } catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "aftersale.dispatch": {
        const A = await import("../../../lib/db/production/aftersale.js");
        try { return NextResponse.json(await A.markDispatch({ orderId: String(body.order || ""), by: "admin", event: "extension", extensionMs: Number(body.extensionDays || 0) * 86_400_000, approved: body.approved === true })); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "score.penalty": {
        const S = await import("../../../lib/db/production/score.js");
        try {
          if (body.propose) return NextResponse.json({ penalty: await S.proposePenalty({ userId: String(body.userId || ""), reason: String(body.reason || ""), orderId: body.order || null, halfStars: body.halfStars || 1 }) }, { status: 201 });
          const action = ["confirm", "overturn", "uphold"].includes(body.penaltyAction) ? body.penaltyAction : null;
          if (!action) return NextResponse.json({ error: "penaltyAction must be confirm, overturn or uphold" }, { status: 400 });
          return NextResponse.json({ penalty: await S.movePenalty({ penaltyId: String(body.id || ""), action, by: adminActor() }) });
        } catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "score.mark": {
        const S = await import("../../../lib/db/production/score.js");
        try { return NextResponse.json({ review: await S.markReview({ reviewId: String(body.review || ""), excluded: body.excluded, refunded: body.refunded, actor: adminActor() }) }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "score.read": {
        const S = await import("../../../lib/db/production/score.js");
        const subject = String(body.subject || "");
        return NextResponse.json({ score: await S.passengerScore(subject), penalties: await S.penaltiesFor(subject), reviews: await S.reviewsAbout(subject, { includeHidden: true }) });
      }
      case "credit.void": {
        const Cr = await import("../../../lib/db/production/credit.js");
        try { return NextResponse.json({ entry: await Cr.voidCredit({ userId: String(body.userId || ""), amountCents: Number(body.amountCents), note: body.note || "", actor: adminActor() }) }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "credit.read": {
        const Cr = await import("../../../lib/db/production/credit.js");
        const userId = String(body.userId || "");
        return NextResponse.json({ userId, balanceCents: await Cr.creditBalance(userId), ledger: await Cr.creditLedger(userId, { limit: body.limit || 100 }) });
      }
      // ---- BRDCST (V.2 chapter 5; slice 8) --------------------------------------------
      case "brdcst.list": {
        const B = await import("../../../lib/db/production/brdcst.js");
        const { stateAt, usage } = await import("../../../lib/brdcst/index.js");
        const now = Date.now();
        const all = (await B.listCampaigns({ limit: body.limit || 200 })).map((c) => ({ ...c, state: stateAt(c, now), usage: usage(c, now) }));
        return NextResponse.json({ campaigns: body.state ? all.filter((c) => c.state === body.state) : all });
      }
      case "brdcst.interrupt": {
        const B = await import("../../../lib/db/production/brdcst.js");
        const reason = ["interrupted", "event_cancelled", "policy"].includes(body.reason) ? body.reason : "interrupted";
        try { return NextResponse.json(await B.cancelCampaign({ campaignId: String(body.id || ""), by: "admin", reason, refundTo: "credit", bonusAs: "days" })); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "brdcst.review": {
        const B = await import("../../../lib/db/production/brdcst.js");
        try { return NextResponse.json({ campaign: await B.decideReview({ campaignId: String(body.id || ""), refund: body.refund === true, note: body.note || "", actor: adminActor() }) }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "verification.appeals": {
        const I = await import("../../../lib/db/production/identity.js");
        return NextResponse.json({ appeals: await I.listAppeals({ state: body.state || "open", limit: body.limit || 100 }) });
      }
      case "verification.appeal.decide": {
        const I = await import("../../../lib/db/production/identity.js");
        try { return NextResponse.json({ appeal: await I.decideAppeal({ appealId: String(body.id || ""), upheld: body.upheld === true, decision: body.decision || "", actor: adminActor() }) }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "identity.read": {
        const I = await import("../../../lib/db/production/identity.js");
        const row = await I.getIdentity(String(body.accountId || ""));
        return NextResponse.json({ identity: row ? { hometown: row.hometown, ethnicityOnRecord: !!row.ethnicity, updatedAt: row.updatedAt } : null, devices: (await I.listDevices(String(body.accountId || ""))).length });
      }
      case "payouts.list": {
        const M = await import("../../../lib/db/production/money.js");
        return NextResponse.json({ payouts: await M.listPayouts({ state: body.state || null, limit: body.limit || 200 }) });
      }
      case "payouts.release": {
        const M = await import("../../../lib/db/production/money.js");
        try { return NextResponse.json(await M.releasePayout({ orderId: String(body.order || ""), by: adminActor() })); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "payouts.deduct": {
        const M = await import("../../../lib/db/production/money.js");
        try { return NextResponse.json({ payout: await M.deductFromPayout({ orderId: String(body.order || ""), returnId: String(body.returnId || ""), amountCents: Number(body.amountCents) }) }); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "topups.list": {
        const M = await import("../../../lib/db/production/money.js");
        return NextResponse.json({ topups: await M.listTopUps({ state: body.state || null, limit: body.limit || 200 }) });
      }
      case "topups.settle": {
        const M = await import("../../../lib/db/production/money.js");
        try { return NextResponse.json(await M.settleTopUp({ id: body.id })); }
        catch (e) { return NextResponse.json({ error: e.message, code: e.code || null }, { status: e.status || 409 }); }
      }
      case "wardrobe.offers": {
        const M = await import("../../../lib/db/production/money.js");
        return NextResponse.json({ offers: await M.listWardrobeOffers({ limit: body.limit || 200 }) });
      }
      case "brdcst.sweep": {
        const B = await import("../../../lib/db/production/brdcst.js");
        return NextResponse.json({ reminders: await B.sweepPaymentReminders() });
      }
      case "steward.report":
      case "steward.act":
      case "steward.revert": {
        const [steward, { getPool }] = await Promise.all([
          import("../../../lib/steward/index.js"),
          import("../../../lib/db/index.js"),
        ]);
        const pool = await getPool();
        const ctx = {
          query: pool ? (sql, params) => pool.query(sql, params) : null,
          transact: steward.transactorFor(pool),
          now: new Date().toISOString(),
        };
        if (body.action === "steward.revert") {
          const r = await steward.revertAction(ctx, String(body.id || ""), { actor: adminActor() });
          return NextResponse.json(r, { status: r.ok ? 200 : 409 });
        }
        if (body.action === "steward.act") {
          const known = new Set(steward.BOUNDARY.map((b) => b.id));
          const confirm = (Array.isArray(body.confirm) ? body.confirm : []).map(String).filter((id) => known.has(id));
          const out = await steward.actSteward(ctx, { confirm, dryRun: !!body.dryRun, actor: adminActor(), firedBy: "desk" });
          return NextResponse.json({ hands: out.hands, runId: out.runId, acts: out.acts,
            plans: out.plans.map(({ targets, inverse, ...p }) => p) });
        }
        const report = await steward.runSteward(ctx);
        // An unread ledger is reported as unread, never as empty — on a
        // memory-mode deploy "the hands have not acted yet" would be a claim
        // the server cannot make.
        const [plans, ledger] = await Promise.all([
          steward.planRepairs(ctx, report),
          ctx.query
            ? steward.readLedger(ctx, { limit: 20 }).catch((err) => ({ error: err?.message || String(err) }))
            : { error: "no database" },
        ]);
        return NextResponse.json({
          ...report, exitCode: steward.exitCodeFor(report),
          repairs: plans.map(({ targets, inverse, ...p }) => p),
          ledger,
          boundary: steward.BOUNDARY.map(({ id, check, tier, cap }) => ({ id, check, tier, cap: cap ?? null })),
        });
      }
      case "asterisk.corrections": {
        const { listUserCorrections } = await import("../../../lib/db/production.js");
        if (!body.user) return NextResponse.json({ error: "user required" }, { status: 400 });
        return NextResponse.json({ corrections: await listUserCorrections(body.user, body.limit || 100) });
      }
      // ---- research-ingestion pipeline (Day 15, P2 v1) ----
      case "asterisk.research.propose": {
        const { proposeCultureEntity } = await import("../../../lib/asterisk/research.js");
        const r = await proposeCultureEntity(body.proposal || {}, {
          sourceUrls: body.sourceUrls, sourceTypes: body.sourceTypes,
          publicationDates: body.publicationDates,
          reliabilityScore: body.reliabilityScore, modelVersion: body.modelVersion || null,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.research.queue": {
        const { researchQueue } = await import("../../../lib/asterisk/research.js");
        return NextResponse.json({ proposals: await researchQueue({
          status: body.status || null, limit: body.limit || 100 }) });
      }
      case "asterisk.research.review": {
        const { reviewResearch } = await import("../../../lib/asterisk/research.js");
        const r = await reviewResearch(body.id, body.status, adminActor());
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.research.approved": {
        const { approvedCultureProposals } = await import("../../../lib/asterisk/research.js");
        return NextResponse.json(await approvedCultureProposals());
      }
      case "asterisk.research.fetch": {
        const { fetchResearchSource } = await import("../../../lib/asterisk/research.js");
        if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
        const r = await fetchResearchSource(String(body.url));
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      // ---- unknown-query aggregation (Phase 1) ----
      case "asterisk.unknown.list": {
        const { unknownQueryQueue } = await import("../../../lib/asterisk/unknownQueries.js");
        return NextResponse.json({ unknownQueries: await unknownQueryQueue({
          status: body.status === "all" ? null : (body.status || "observed"), limit: body.limit || 50 }) });
      }
      case "asterisk.unknown.promote": {
        const { promoteUnknownQuery } = await import("../../../lib/asterisk/unknownQueries.js");
        const r = await promoteUnknownQuery(body.id, adminActor());
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.unknown.resolve": {
        const { resolveUnknownQuery } = await import("../../../lib/asterisk/unknownQueries.js");
        const r = await resolveUnknownQuery(body.id, adminActor(), body.researchFactId || null);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.unknown.dismiss": {
        const { dismissUnknownQuery } = await import("../../../lib/asterisk/unknownQueries.js");
        const r = await dismissUnknownQuery(body.id, adminActor());
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "asterisk.research.draft": {
        const { draftProposalsFromSource } = await import("../../../lib/asterisk/research.js");
        return NextResponse.json(await draftProposalsFromSource());
      }
      case "brand.case.open": {
        const { validateOpenCase } = await import("../../../lib/brands/cases.js");
        const { insertBrandCase } = await import("../../../lib/db/production.js");
        let opened;
        try {
          opened = validateOpenCase({ ...body, openedBy: adminActor() });
        } catch (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ case: await insertBrandCase(opened) });
      }
      case "brand.case.transition": {
        const { validateTransition } = await import("../../../lib/brands/cases.js");
        const { getBrandCase, applyBrandCaseTransition } = await import("../../../lib/db/production.js");
        const kase = await getBrandCase(String(body.id || ""));
        if (!kase) return NextResponse.json({ error: "case not found" }, { status: 404 });
        let t;
        try {
          t = validateTransition(kase, { to: body.to, actor: adminActor(),
            evidence: body.evidence, resolution: body.resolution });
          if (body.note !== undefined) t.note = String(body.note).slice(0, 500);
        } catch (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        try {
          const moved = await applyBrandCaseTransition(kase.id, kase.status, t);
          return NextResponse.json({ case: moved });
        } catch (error) {
          if (error?.message === "case-moved") {
            return NextResponse.json({ error: "case moved under you — re-read and retry" }, { status: 409 });
          }
          throw error;
        }
      }
      case "brand.cases.list": {
        const { listBrandCases } = await import("../../../lib/db/production.js");
        return NextResponse.json({ cases: await listBrandCases({
          status: body.status || null, kind: body.kind || null,
          brandName: body.brandName || null, limit: body.limit || 100 }) });
      }
      case "brand.case.get": {
        const { getBrandCase, listBrandCaseEvents } = await import("../../../lib/db/production.js");
        const kase = await getBrandCase(String(body.id || ""));
        if (!kase) return NextResponse.json({ error: "case not found" }, { status: 404 });
        return NextResponse.json({ case: kase, events: await listBrandCaseEvents(kase.id) });
      }
      case "discover.rails.list": {
        const { listDiscoverRails } = await import("../../../lib/db/production.js");
        return NextResponse.json({ rails: await listDiscoverRails() });
      }
      case "discover.rail.update": {
        const { updateDiscoverRail } = await import("../../../lib/db/production.js");
        const rail = await updateDiscoverRail(String(body.railId || ""), {
          enabled: body.enabled, position: body.position, title: body.title });
        return rail ? NextResponse.json({ rail })
                    : NextResponse.json({ error: "rail not found (registry edits require the database)" }, { status: 404 });
      }
      case "profile.rooms.list": {
        const { listProfileRooms } = await import("../../../lib/db/production.js");
        return NextResponse.json({ rooms: await listProfileRooms({
          status: body.status === "all" ? null : (body.status || null), limit: body.limit || 100 }) });
      }
      case "profile.room.moderate": {
        const { setProfileRoomModeration } = await import("../../../lib/db/production.js");
        if (!["visible", "under_review", "hidden"].includes(body.status)) {
          return NextResponse.json({ error: "status must be visible, under_review, or hidden" }, { status: 400 });
        }
        const room = await setProfileRoomModeration(body.accountId, body.status);
        return room ? NextResponse.json({ room })
                    : NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      case "moderation.list": {
        const { listModerationTasks } = await import("../../../lib/db/production.js");
        return NextResponse.json({ tasks: await listModerationTasks({
          status: body.status === "all" ? null : (body.status || "open"), limit: body.limit || 100 }) });
      }
      case "moderation.resolve": {
        const { resolveModerationTask } = await import("../../../lib/db/production.js");
        const r = await resolveModerationTask(body.id, {
          status: body.status || "resolved", resolution: body.resolution || null,
          resolvedBy: adminActor() });
        return r ? NextResponse.json({ task: r })
                 : NextResponse.json({ error: "task not found or bad status" }, { status: 400 });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "admin action failed" }, { status: 500 });
  }
}
