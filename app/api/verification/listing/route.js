// app/api/verification/listing/route.js — THE BADGE AND ITS BREAKDOWN (V.2
// brief §12).
//
// GET  ?ids=a,b   → { items: [{ id, badge }] } — the state and the
//                  plain-language breakdown (source checks, AI checks, human
//                  review if any, last checked, expiry, limitations). Public:
//                  the badge is on a public card.
// POST { itemId, run: true }                         → run the checks now
// POST { itemId, human: "pass" | "fail" }            → a named reviewer's word
//                  Both ADMIN (Authorization: Bearer ADMIN_TOKEN; ADMIN_ACTOR
//                  names the reviewer). A human review is a NEW row for the
//                  listing's CURRENT evidence version, carrying the latest
//                  source/AI results forward — never an edit of an old row.

import { NextResponse } from "next/server";
import { getItems } from "../../../../lib/db/index.js";
import { latestVerifications, recordVerification } from "../../../../lib/db/production/verification.js";
import { badgeFor, evidenceVersionOf } from "../../../../lib/verification/ledger.js";
import { runChecks } from "../../../../lib/verification/run.js";
import { bearerToken, secureTokenEqual } from "../../../../lib/security/request.js";
import { consumeGlobalBudget } from "../../../../lib/security/rateLimit.js";
import { readJsonRequest } from "../../../../lib/security/json.js";

export const dynamic = "force-dynamic";

// PASSENGERS NEVER SEE THE MACHINERY (V.2 Blueprint, ASTERISK governance,
// slice 5): the public badge keeps its states and plain-language reasons;
// confidence, the fraud flag, the evidence request and the deadline exist
// only in the admin console.
function publicBadge(badge) {
  if (!badge) return badge;
  const { fraud: _fraud, evidenceRequest: _req, resolveBy: _by, checks, ...rest } = badge;
  const strip = (c) => (c ? { status: c.status, detail: c.detail ?? null, ...(c.reviewer !== undefined ? { reviewer: c.reviewer, at: c.at } : {}) } : c);
  return { ...rest, checks: checks ? { source: strip(checks.source), ai: strip(checks.ai), human: strip(checks.human) } : null };
}

function admin(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 16) return { ok: false, status: 503, error: "admin disabled — set ADMIN_TOKEN (16+ chars)" };
  if (!secureTokenEqual(bearerToken(req), token)) return { ok: false, status: 401, error: "bad admin token" };
  return { ok: true, actor: process.env.ADMIN_ACTOR || "admin" };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const ids = [...new Set(String(searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9_-]{1,80}$/i.test(s)))].slice(0, 60);
  if (!ids.length) return NextResponse.json({ items: [] });
  const budget = await consumeGlobalBudget("items").catch(() => ({ allowed: true }));
  if (budget && budget.allowed === false) return NextResponse.json({ error: "busy — try again shortly" }, { status: 429 });
  const [rows, records] = await Promise.all([getItems(ids), latestVerifications(ids)]);
  return NextResponse.json({
    items: ids.map((id) => { const it = rows.get(id); return it ? { id, badge: publicBadge(badgeFor(records.get(id) || null, it)) } : { id, missing: true }; }),
  });
}

export async function POST(req) {
  const auth = admin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const itemId = String(body.itemId || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(itemId)) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const item = (await getItems([itemId])).get(itemId);
  if (!item) return NextResponse.json({ error: "no such listing" }, { status: 404 });
  const human = body.human === "pass" || body.human === "fail" ? body.human : null;
  if (!human && body.run !== true) return NextResponse.json({ error: "run: true or human: pass|fail" }, { status: 400 });
  try {
    const record = await runChecks(item, { human, reviewer: human ? auth.actor : null });
    // a paused (or handed) authentication function appends nothing: the listing waits in the admin queue
    if (record && record.queued) return NextResponse.json({ ok: false, queued: true, reason: record.reason }, { status: 202 });
    return NextResponse.json({ ok: true, record, badge: badgeFor(record, item), evidenceVersion: evidenceVersionOf(item) });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error).slice(0, 200) }, { status: 503 });
  }
}
