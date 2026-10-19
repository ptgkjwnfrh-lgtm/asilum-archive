// app/api/credit/route.js — ASILUM CREDIT (V.2 Blueprint 5.26–5.32, Terms
// 10; slice 7). Refunds and gifts in, spends and gifts out; never purchased.
//
// GET  ?user=                         → { balanceCents, ledger, rules }
// POST { user, action: "gift", toHandle, amountCents, twoFactor, deviceVerified, note? }
//        A gift needs two-factor and device authentication (10.4): the
//        session's assurance level (aal2, a second factor enrolled in
//        Settings) and a signed device the account adopted — both read by
//        the identity layer (lib/identity/gate.js), never from the body.
//        Sender and receiver are 18+ (Terms 2.2).

import { NextResponse } from "next/server";
import { resolveRequestUser } from "../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { creditBalance, creditLedger, giftCredit, CreditRefused } from "../../../lib/db/production/credit.js";
import { resolveGiftRecipient } from "../../../lib/db/production/wardrobeTransfers.js";
import { CREDIT_SOURCES, GIFT_REQUIREMENTS } from "../../../lib/storefront/credit.js";
import { gate } from "../../../lib/identity/gate.js";
import { canTransact } from "../../../lib/identity/commerce.js";
import { readBirthDate } from "../../../lib/db/accountAges.js";
import { accountIdFromIdentity } from "../../../lib/identity.js";

export const dynamic = "force-dynamic";
const RULES = Object.freeze({ sources: CREDIT_SOURCES, purchasable: false, expires: null, appliedAutomatically: false, giftRequires: GIFT_REQUIREMENTS, twoFactorAvailable: true, twoFactorHow: "enroll an authenticator app in Settings → IDENTITY; a gift is sent from a session that presented it, on a device this account signed in on" });

function refused(error) {
  if (error instanceof CreditRefused || (error && typeof error.status === "number" && error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 409 });
  console.error("[credit] failed", error?.message || error);
  return NextResponse.json({ error: "credit is unavailable", code: "CREDIT_UNAVAILABLE" }, { status: 503 });
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const user = await resolveRequestUser(req, String(searchParams.get("user") || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "credit-read", subject: user, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    return NextResponse.json({ balanceCents: await creditBalance(user), ledger: await creditLedger(user, { limit: 50 }), rules: RULES });
  } catch (error) { return refused(error); }
}

async function handlePOST(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const user = await resolveRequestUser(req, String(body.user || ""));
  if (!user) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  const quota = await consumeRateLimit({ scope: "credit-write", subject: user, limit: 20, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  if (body.action !== "gift") return NextResponse.json({ error: "gift is the only action", code: "UNKNOWN_ACTION" }, { status: 400 });
  try {
    // the proofs are the identity layer's to present; a body flag is not a proof
    const g = await gate(req, String(body.user || ""), { needs: ["gift"] });
    if (!g.ok) return NextResponse.json(g.body, { status: g.status });
    const { twoFactor, deviceVerified } = g.identity.proofs;
    const recipient = await resolveGiftRecipient(user, String(body.toHandle || "")).catch(() => null);
    if (!recipient) return NextResponse.json({ error: "no passenger by that handle", code: "RECIPIENT_NOT_FOUND" }, { status: 404 });
    const receiverAge = canTransact({ birthDate: await readBirthDate(accountIdFromIdentity(recipient.toUserId)).catch(() => null) });
    if (!receiverAge.ok) return NextResponse.json({ error: "the receiver must be 18 or over to receive ASILUM Credit (Terms 2.2)", code: "RECEIVER_UNDER_AGE" }, { status: 403 });
    const out = await giftCredit({ fromId: user, toId: recipient.toUserId, amountCents: Number(body.amountCents), twoFactor, deviceVerified, note: body.note ? String(body.note).slice(0, 200) : null });
    return NextResponse.json(out, { status: 201 });
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const POST = withPrivateCache(handlePOST);
