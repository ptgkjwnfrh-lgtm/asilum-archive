// lib/consent.js
// D4's law (ruled 20 Aug 2026; spec docs/history/d4-consent-spec-2026-08-20.md):
// UNANSWERED = UNOBSERVED. The state rides an HttpOnly cookie the server
// reads on every observation write path; clients only ever ask
// /api/consent. Three states, two tiers of writes:
//
//   null (unanswered) → NOTHING persists: no impressions, no
//                       interaction-derived mutation, explicit included.
//   "general"         → the existing pause's parity: passive observation
//                       (dwell, impressions, serve memory) refused, while
//                       EXPLICIT acts (save, favorite, train) still teach —
//                       the settings copy has promised exactly that split
//                       since July ("the brain only learns from explicit
//                       actions").
//   "observe"         → everything.

export const CONSENT_COOKIE = "asilum-consent";
export const CONSENT_VERSION = "d4-2026-08-20";

const STATES = new Set(["observe", "general"]);

/**
 * What this reader consented to: "observe", "general", or null.
 *
 * NULL MEANS UNANSWERED, AND UNANSWERED MEANS UNOBSERVED — never treat it as a
 * default yes. An unrecognised cookie value also reads as null, so a stale or
 * tampered cookie fails closed rather than granting the wider state.
 */
export function consentState(req) {
  try {
    const value = req.cookies.get(CONSENT_COOKIE)?.value || "";
    return STATES.has(value) ? value : null;
  } catch {
    return null;
  }
}

// The allowance matrix, pure and testable. kind: "passive" | "explicit".
/**
 * May we record this kind of signal? `kind` is "passive" or "explicit".
 *
 * The split the settings copy has promised since July: under "general",
 * PASSIVE observation (dwell, impressions, serve memory) is refused while
 * EXPLICIT acts (save, favourite, train) still teach — a person who deliberately
 * saved something has asked for it to count.
 *
 * Pure and total, so the promise is testable without a request.
 */
export function observationAllowed(state, kind) {
  if (state === "observe") return true;
  if (state === "general") return kind === "explicit";
  return false; // unanswered = unobserved
}
