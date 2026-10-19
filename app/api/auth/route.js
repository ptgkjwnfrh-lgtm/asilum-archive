// app/api/auth/route.js
// GET issues a server-signed anonymous device identity in an HttpOnly cookie.
// POST adopts that verified device identity into the Supabase account proven by
// the bearer token. The client never chooses the source identity.

import { NextResponse } from "next/server";
import { authConfigured, getAuthenticatedUser } from "../../../lib/supabase.js";
import {
  DEVICE_COOKIE, newDeviceId, signedDeviceValue, verifiedDevice,
} from "../../../lib/identity.js";
import { adoptAccountData } from "../../../lib/db/production.js";
import { rebuildUserStyleProfile } from "../../../lib/ai/styleProfile.js";
import { readJsonRequest } from "../../../lib/security/json.js";
import { consumeRateLimit, consumeGlobalBudget, rateLimitResponse } from "../../../lib/security/rateLimit.js";
import { requestSubject, PUBLIC_SUBJECT } from "../../../lib/security/request.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!signedDeviceValue("probe")) {
    return NextResponse.json({ error: "device identity is not configured" }, { status: 503 });
  }
  let uid = verifiedDevice(req);
  if (!uid) {
    // Identity ISSUANCE is throttled; returning an already-verified identity
    // is not. Every issued identity seeds per-subject quotas everywhere else,
    // so unthrottled minting would let a flood outrun every other limit.
    //
    // WHAT WAS WRONG (Aug 6). This branch is only reached when the caller has
    // NO valid device cookie, so requestSubject() was the literal constant
    // "unverified-public" on 100% of issuance attempts. limit:30/hour was
    // therefore ONE GLOBAL BUCKET, not a per-caller one: 30 requests from any
    // script locked identity issuance for the ENTIRE PRODUCT for the rest of
    // the clock hour — and the same lockout happened with no attacker at all
    // as soon as 30 genuinely new visitors arrived in one hour.
    //
    // Three buckets now, in increasing coarseness, and the ordering matters:
    //   1. per-subject — a trusted edge caller when the deployment declares
    //      one (TRUSTED_EDGE_IP_HEADER), else still the shared constant. This
    //      is an ISOLATION control: one caller can no longer exhaust everyone
    //      else's issuance. It is NOT a sybil price — no per-IP limit can be
    //      both NAT-safe (a carrier NAT fronts 10^4-10^5 subscribers) and
    //      tight enough to price minting.
    //   2. the shared public ceiling — deliberately far above legitimate
    //      traffic so it can never be what locks out a first visitor.
    //   3. the HOURLY global — the actual aggregate bound, and new. The old
    //      30/hour constant bucket was silently serving as the only sustained
    //      ceiling: consumeGlobalBudget hardcodes a 60-SECOND window, so
    //      GLOBAL_BUDGET_IDENTITY_ISSUE (300/min) permits 18,000/hour. Making
    //      the subject per-caller WITHOUT adding this would have raised
    //      sustained minting 600x while looking like a pure availability fix.
    //
    // IDENTITY_ISSUE_SUBJECT_LIMIT keeps its name and its stress-harness role
    // (tests/stress_test.py enrolls 1000 bot devices on localhost, where no
    // trusted header is configured), but its default and meaning change.
    const issueLimit = Math.max(1, parseInt(process.env.IDENTITY_ISSUE_SUBJECT_LIMIT, 10) || 2000);
    const publicLimit = Math.max(1, parseInt(process.env.IDENTITY_ISSUE_PUBLIC_LIMIT, 10) || 5000);
    const hourlyLimit = parseInt(process.env.IDENTITY_ISSUE_GLOBAL_HOURLY, 10);
    const hourly = Number.isFinite(hourlyLimit) ? hourlyLimit : 3000;
    const subject = requestSubject(req);
    const shared = subject === PUBLIC_SUBJECT;

    // Quota exhaustion is a DECISION and still fails closed with 429.
    // Limiter INFRASTRUCTURE failure is not a decision: issuance itself writes
    // nothing (a randomUUID and one HMAC), and everything the identity can
    // subsequently do is separately quota'd per identity — so a denied
    // identity costs a real visitor the whole product while an over-issued one
    // costs ~0. IDENTITY_ISSUE_FAIL_OPEN=0 restores fail-closed.
    const failOpen = process.env.IDENTITY_ISSUE_FAIL_OPEN !== "0";
    let blocked = null;
    try {
      const issueQuota = await consumeRateLimit({
        scope: "identity-issue", subject, limit: shared ? publicLimit : issueLimit, windowMs: 60 * 60 * 1000,
      });
      if (!issueQuota.allowed) blocked = issueQuota;
      if (!blocked && hourly > 0) {
        const hourlyQuota = await consumeRateLimit({
          scope: "identity-issue-global", subject: "global", limit: hourly, windowMs: 60 * 60 * 1000,
        });
        if (!hourlyQuota.allowed) blocked = hourlyQuota;
      }
      if (!blocked) {
        const globalQuota = await consumeGlobalBudget("identity-issue");
        if (!globalQuota.allowed) blocked = globalQuota;
      }
    } catch (error) {
      if (!failOpen) {
        return NextResponse.json({ error: "identity issuance unavailable" }, { status: 503 });
      }
      // One structured line, scope and error class only — never the subject,
      // which may be IP-derived.
      console.warn("identity-issue limiter unavailable; failing open", { scope: "identity-issue", error: error?.name || "Error" });
    }
    if (blocked) {
      return NextResponse.json(rateLimitResponse(blocked), {
        status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(blocked.retryAfterMs / 1000))) },
      });
    }
    uid = newDeviceId();
    const response = NextResponse.json({ uid });
    response.cookies.set(DEVICE_COOKIE, signedDeviceValue(uid), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  }
  return NextResponse.json({ uid });
}

export async function POST(req) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "authentication is not configured" }, { status: 503 });
  }
  const from = verifiedDevice(req);
  if (!from) {
    return NextResponse.json({ error: "verified device identity required" }, { status: 401 });
  }
  const authUser = await getAuthenticatedUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "valid bearer token required" }, { status: 401 });
  }
  const user = "sb-" + authUser.id;
  const quota = await consumeRateLimit({ scope: "auth-adopt", subject: user, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!quota.allowed) return NextResponse.json(rateLimitResponse(quota), { status: 429 });
  const parsed = await readJsonRequest(req, { maxBytes: 8 * 1024 });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const claimedUser = body && typeof body.user === "string" ? body.user : "";
  if (claimedUser && claimedUser !== user) {
    return NextResponse.json({ error: "account does not match bearer token" }, { status: 403 });
  }

  const adopted = await adoptAccountData(from, user);
  // device authentication (10.4, slice 10b): the account adopted this signed device
  try { const { recordDevice } = await import("../../../lib/db/production/identity.js"); await recordDevice(authUser.id, from); } catch (e) { console.error("[auth] device record failed", e?.message || e); }
  let correctionProfileUpdated = null;
  if (adopted.movedCorrections > 0 || adopted.movedProfile ||
      adopted.movedBoards > 0 || adopted.movedRecords > 0) {
    correctionProfileUpdated = (await rebuildUserStyleProfile(user)).ok;
  }
  return NextResponse.json({ ok: true, ...adopted, correctionProfileUpdated });
}
