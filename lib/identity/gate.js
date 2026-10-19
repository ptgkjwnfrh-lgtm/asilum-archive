// lib/identity/gate.js — THE COMMERCE GATE (V.2 Terms 2.2, 6.34, 10.4; slice
// 10b). SERVER-ONLY. One helper every route that buys, sells, broadcasts or
// moves Credit calls first. It resolves the fuller identity and answers with
// the law's own sentence, as a ready NextResponse, so no route invents a
// second vocabulary for "you are not old enough" or "verify your e-mail".
//
//   gate(req, claimed, { needs })   needs ⊂ { "age", "sell", "drop", "gift" }
//     age   18+ from the stored birth date (every need implies it)
//     sell  e-mail verified (phone when an SMS provider exists)
//     drop  the enhanced checks: an approved business account
//     gift  two-factor (aal2) and an adopted device
//   → { ok: true, identity } or { ok: false, status, body, identity } — the
//     route answers NextResponse.json(body, { status }); this module stays
//     framework-free so the law and the tests can import it directly.

import { resolveRequestIdentity } from "../identity.js";
import { canTransact, commerceVerification, giftProofs } from "./commerce.js";

export const PHONE_VERIFICATION_AVAILABLE = () => process.env.PHONE_VERIFICATION_ENABLED === "1";

async function businessApproved(accountId) {
  try {
    const { readAccountKind } = await import("../db/accountKinds.js");
    return (await readAccountKind(accountId)) === "business";
  } catch { return false; }
}

export async function gate(req, claimed = "", { needs = ["age"] } = {}) {
  const identity = await resolveRequestIdentity(req, claimed);
  if (!identity) return { ok: false, identity: null, status: 401, body: { error: "authentication required", code: "AUTH_REQUIRED" } };
  const refuse = (code, message, extra = {}) => ({ ok: false, identity, status: 403, body: { error: message, code, ...extra } });
  if (!identity.accountId) return refuse("ACCOUNT_REQUIRED", "buying, selling, running a BRDCST and ASILUM Credit need a signed-in account — a device alone cannot carry a birth date (Terms 2.2)");
  const age = canTransact({ birthDate: identity.birthDate });
  if (!age.ok) return refuse(age.code, age.reason);
  const wants = new Set(needs);
  if (wants.has("sell") || wants.has("drop")) {
    const v = commerceVerification({ mode: wants.has("drop") ? "drop" : "sell", emailConfirmed: identity.emailConfirmed, phoneConfirmed: identity.phoneConfirmed, phoneAvailable: PHONE_VERIFICATION_AVAILABLE(), businessApproved: await businessApproved(identity.accountId) });
    if (!v.ok) return refuse("VERIFICATION_REQUIRED", v.reason, { verification: v });
  }
  if (wants.has("gift")) {
    const proofs = giftProofs({ aal: identity.aal, deviceKnown: identity.deviceKnown });
    identity.proofs = proofs;
  }
  return { ok: true, identity };
}
