// lib/identity/commerce.js — IDENTITY FOR COMMERCE (V.2 Blueprint, owner,
// 17 Oct 2026: Terms 2.2, 6.32–6.34, 10.4, 12.8–12.9, 14.11; owner rulings
// 18 Oct 2026, CONSTITUTION A6 (7); slice 10b). PURE and client-safe: the
// signup sheet, Settings and the server compute the same answers.
//
//   AGE (Terms 2.2)          13 to use ASILUM (lib/age.js, owner decision #2);
//                            18, or the local age of majority, to buy, sell,
//                            run a BRDCST or send and receive ASILUM Credit.
//                            Computed from the stored birth date on every
//                            call, never frozen into a flag.
//   VERIFICATION (6.34)      everyone verifies email and phone; enhanced
//                            identity and payout checks apply only to a
//                            seller planning DROPs (the business kind's
//                            approval). Phone verification needs an SMS
//                            provider the deployment may not have: then it
//                            is reported unavailable, never silently passed.
//   GIFT PROOFS (10.4)       two-factor (the session's authenticator
//                            assurance level, aal2) and device authentication
//                            (the request's signed device is one the account
//                            adopted) — presented by the identity layer; a
//                            body flag is never a proof.
//   THE PASSPORT'S ANCHORS (14.11, A6 (7))  the home town and an optional,
//                            explained, erasable ethnicity are collected at
//                            account creation; nothing is inferred from them
//                            without the passenger's confirmation.

import { ageOn } from "../age.js";

export const COMMERCE_AGE = 18;
export const AAL_TWO_FACTOR = "aal2";
export const ETHNICITY_OPTIONS = Object.freeze([
  "Black or African", "Caribbean", "East Asian", "South Asian", "Southeast Asian", "Middle Eastern or North African",
  "Latino or Hispanic", "Indigenous or Native", "Pacific Islander", "White or European", "Mixed", "Other",
]);
export const ETHNICITY_WHY = "optional. it helps the Passport suggest what people of your background, age and home town grew up with — you confirm or correct every suggestion. never shown to anyone, erasable here at any time, and nothing is inferred from it without your word.";

const dateMs = (v) => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v)));

/** May this person transact — buy, sell, run a BRDCST, send or receive Credit (Terms 2.2)? */
export function canTransact({ birthDate = null, now = Date.now() } = {}) {
  if (!birthDate) return { ok: false, reason: "a birth date on the account is needed to buy, sell, run a BRDCST or move Credit (Terms 2.2)", code: "AGE_UNKNOWN" };
  const t = dateMs(birthDate);
  if (!Number.isFinite(t)) return { ok: false, reason: "the birth date on record is not a date", code: "AGE_UNKNOWN" };
  const age = ageOn(new Date(t).toISOString().slice(0, 10), new Date(now));
  if (!(age >= COMMERCE_AGE)) return { ok: false, reason: `buying, selling, running a BRDCST and ASILUM Credit are for passengers of ${COMMERCE_AGE} and over (Terms 2.2)`, code: "UNDER_COMMERCE_AGE", age };
  return { ok: true, age };
}

/**
 * Verification for commerce (6.34). `mode` is what the seller plans: "sell"
 * (reselling anything) or "drop" (releasing at scale). Returns what is
 * required, what is met, and whether the seller may proceed.
 */
export function commerceVerification({ mode = "sell", emailConfirmed = false, phoneConfirmed = false, phoneAvailable = false, businessApproved = false } = {}) {
  const checks = [
    { id: "email", label: "email verified", required: true, met: !!emailConfirmed },
    { id: "phone", label: "phone verified", required: !!phoneAvailable, met: !!phoneConfirmed, note: phoneAvailable ? null : "phone verification needs an SMS provider this deployment does not have — not required until it does" },
  ];
  if (mode === "drop") checks.push({ id: "enhanced", label: "enhanced identity and payout checks (a business account, approved)", required: true, met: !!businessApproved });
  const missing = checks.filter((c) => c.required && !c.met);
  return { ok: missing.length === 0, mode, checks, missing: missing.map((c) => c.id), reason: missing.length ? `before you ${mode === "drop" ? "release a DROP" : "sell"}: ${missing.map((c) => c.label).join(", ")}` : null };
}

/** The gift's two proofs from the identity layer (10.4). */
export function giftProofs({ aal = null, deviceKnown = false } = {}) {
  return { twoFactor: aal === AAL_TWO_FACTOR, deviceVerified: deviceKnown === true };
}

/** A home town, cleaned: a short name, an optional country, optional coordinates. */
export function normalizeHometown({ name = "", country = "", lat = null, lng = null } = {}) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!n) return null;
  const c = String(country || "").trim().slice(0, 60) || null;
  // null and "" are "not given", never the equator (Number(null) is 0)
  const given = (v) => v != null && v !== "" && Number.isFinite(Number(v));
  const la = Number(lat), ln = Number(lng);
  const coords = given(lat) && given(lng) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? { lat: Math.round(la * 100) / 100, lng: Math.round(ln * 100) / 100 } : null;
  return { name: n, country: c, ...(coords || { lat: null, lng: null }) };
}

/** An ethnicity, cleaned: one of the options or a short self-description; null for "prefer not to say". Requires consent to be stored. */
export function normalizeEthnicity(value, { consent = false } = {}) {
  const v = String(value || "").trim().slice(0, 80);
  if (!v || /^prefer not/i.test(v)) return { ethnicity: null, ok: true };
  if (consent !== true) return { ethnicity: null, ok: false, reason: "ethnicity is stored only with your consent — tick the line that says why it is asked" };
  return { ethnicity: v, ok: true };
}

/** The year a passenger was 12 (14.11): the birthday sets it. */
export function yearAtAge(birthDate, age = 12) {
  const t = dateMs(birthDate);
  if (!Number.isFinite(t)) return null;
  return new Date(t).getUTCFullYear() + age;
}
