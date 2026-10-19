// app/api/account/identity/route.js — THE ACCOUNT'S IDENTITY (V.2 14.11,
// Terms 2.2; owner ruling 18 Oct 2026, CONSTITUTION A6 (7); slice 10b).
// The home town and the optional, consented, erasable ethnicity collected
// at account creation for the Passport's identity anchors, and the standing
// of this identity for commerce: age, verification, two-factor, device.
//
// GET  ?user=  → { identity: { hometown, ethnicity, ethnicityConsentedAt },
//                  standing: { age, canTransact, verification (sell / drop),
//                  twoFactor, deviceKnown, devices }, options }
// PUT  { user, hometown?: { name, country?, lat?, lng? } | null,
//        ethnicity?: string | null, ethnicityConsent?: true }
// DELETE ?user=&field=ethnicity|hometown|all  — erase one field or both
//
// Never public: an account reads its own row and nothing else. A device
// identity has no row (ADR-002) and is told so.

import { NextResponse } from "next/server";
import { resolveRequestIdentity } from "../../../../lib/identity.js";
import { readJsonRequest, withPrivateCache } from "../../../../lib/security/json.js";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/security/rateLimit.js";
import { getIdentity, setIdentity, listDevices, IdentityRefused } from "../../../../lib/db/production/identity.js";
import { readAccountKind } from "../../../../lib/db/accountKinds.js";
import { canTransact, commerceVerification, giftProofs, ETHNICITY_OPTIONS, ETHNICITY_WHY, COMMERCE_AGE, yearAtAge } from "../../../../lib/identity/commerce.js";
import { PHONE_VERIFICATION_AVAILABLE } from "../../../../lib/identity/gate.js";

export const dynamic = "force-dynamic";
const OPTIONS = Object.freeze({ ethnicity: ETHNICITY_OPTIONS, ethnicityWhy: ETHNICITY_WHY, commerceAge: COMMERCE_AGE });

function refused(error) {
  if (error instanceof IdentityRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("[identity] failed", error?.message || error);
  return NextResponse.json({ error: "identity is unavailable", code: "IDENTITY_UNAVAILABLE" }, { status: 503 });
}

async function standingFor(identity) {
  const age = canTransact({ birthDate: identity.birthDate });
  const business = (await readAccountKind(identity.accountId).catch(() => null)) === "business";
  const base = { emailConfirmed: identity.emailConfirmed, phoneConfirmed: identity.phoneConfirmed, phoneAvailable: PHONE_VERIFICATION_AVAILABLE(), businessApproved: business };
  return {
    age: age.ok ? age.age : null, birthDateOnRecord: !!identity.birthDate, canTransact: age.ok, reason: age.ok ? null : age.reason, yearAtTwelve: yearAtAge(identity.birthDate),
    verification: { sell: commerceVerification({ mode: "sell", ...base }), drop: commerceVerification({ mode: "drop", ...base }) },
    ...giftProofs({ aal: identity.aal, deviceKnown: identity.deviceKnown }), aal: identity.aal,
    devices: (await listDevices(identity.accountId).catch(() => [])).length,
  };
}

async function handleGET(req) {
  const { searchParams } = new URL(req.url);
  const identity = await resolveRequestIdentity(req, String(searchParams.get("user") || ""));
  if (!identity) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!identity.accountId) return NextResponse.json({ identity: null, standing: null, account: false, note: "a device identity has no home town or birth date on record — sign in", options: OPTIONS });
  const quota = await consumeRateLimit({ scope: "identity-read", subject: identity.userId, limit: 120, windowMs: 60_000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    return NextResponse.json({ account: true, identity: await getIdentity(identity.accountId), standing: await standingFor(identity), options: OPTIONS });
  } catch (error) { return refused(error); }
}

async function handlePUT(req) {
  const parsed = await readJsonRequest(req, { maxBytes: 4 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const identity = await resolveRequestIdentity(req, String(body.user || ""));
  if (!identity) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!identity.accountId) return NextResponse.json({ error: "identity keys on an account — sign in first", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  const quota = await consumeRateLimit({ scope: "identity-write", subject: identity.userId, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  try {
    const row = await setIdentity(identity.accountId, {
      hometown: "hometown" in body ? body.hometown : undefined,
      ethnicity: "ethnicity" in body ? body.ethnicity : undefined,
      ethnicityConsent: body.ethnicityConsent === true,
    });
    return NextResponse.json({ identity: row, standing: await standingFor(identity) });
  } catch (error) { return refused(error); }
}

async function handleDELETE(req) {
  const { searchParams } = new URL(req.url);
  const identity = await resolveRequestIdentity(req, String(searchParams.get("user") || ""));
  if (!identity) return NextResponse.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!identity.accountId) return NextResponse.json({ error: "identity keys on an account", code: "ACCOUNT_REQUIRED" }, { status: 403 });
  const field = searchParams.get("field") || "all";
  try {
    const row = await setIdentity(identity.accountId, { hometown: field === "ethnicity" ? undefined : null, ethnicity: field === "hometown" ? undefined : null });
    return NextResponse.json({ identity: row, erased: field });
  } catch (error) { return refused(error); }
}

export const GET = withPrivateCache(handleGET);
export const PUT = withPrivateCache(handlePUT);
export const DELETE = withPrivateCache(handleDELETE);
