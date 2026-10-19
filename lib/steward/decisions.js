// lib/steward/decisions.js — what the steward may decide on its own.
//
// On 3 September 2026 the owner set the constitution's read-only rule aside
// for the steward and asked for a management agent that acts, runs on a
// schedule, and decides. This file is the DECISION half: a declared boundary,
// written down before any hand was built, so that "may the steward do X" is
// answered by reading a table rather than by reading the steward's mood.
//
// THREE TIERS, and an action is in exactly one:
//
//   delegated  the steward does it alone. Reversible, capped per run, ledgered
//              before it is made (schema-v50). The owner reads about it
//              afterwards, in the desk ledger or the run's own output.
//   confirm    the steward plans it and names it, and does it only when a
//              person says yes for THIS run (`--confirm=<id>` or the desk's
//              CONFIRM). Same ledger, same reversibility — the difference is
//              that the decision is a person's each time.
//   never      the steward reports it and stops. The `why` says which rail it
//              would cross. There is no flag that unlocks these.
//
// TWO RAILS THE OWNER'S WAIVER DID NOT MOVE, and nothing here crosses them:
//   * NO FAKING. A repair may hide a piece that cannot be shown honestly; it
//     may never invent the price that would let it be shown.
//   * A HARD STOP BEFORE ANYTHING IRREVERSIBLE. Deleting a source-of-truth
//     row, spending money, sending mail, changing who can get in. Those are
//     `never`, by name, below.

export const TIERS = Object.freeze(["delegated", "confirm", "never"]);

/**
 * The boundary. One entry per steward check that could conceivably be acted
 * on. `id` is the action's id where an action exists; for `never` entries it
 * is the check's own id, because there is nothing else to name.
 */
export const BOUNDARY = Object.freeze([
  // ---- delegated ----------------------------------------------------------
  {
    id: "data.prune-dangling-edges",
    check: "data.dangling-edges",
    tier: "delegated",
    cap: 500,
    why: "an edge to an item that no longer exists resolves to nothing in gamma — it costs recall and can never change a rank. Deleting it changes no reader's page.",
    inverse: "the (a, b, w) rows are recorded and a revert re-inserts them verbatim.",
  },
  {
    id: "catalog.hold-unshowable",
    check: "catalog.integrity",
    tier: "delegated",
    cap: 50,
    why: "a piece without a real price or a title cannot be shown honestly; the checkout gate already refuses it. Holding it under review takes it off discovery and search until a person looks — the opposite of inventing a price for it.",
    inverse: "each item's previous moderation_status is recorded; a revert restores it, and only if the item is still under review.",
  },
  {
    id: "asterisk.promote-demand",
    check: "asterisk.unknown-demand",
    tier: "delegated",
    cap: 10,
    why: "promotion marks a question as worth researching; it grants no trust and writes no knowledge (lib/asterisk/unknownQueries.js). The threshold is the one the desk already enforces.",
    inverse: "status returns to observed; the mark is withdrawn and nothing else was written.",
  },
  // ---- confirm ------------------------------------------------------------
  {
    id: "commerce.reproject-order",
    check: "commerce.order-projection",
    tier: "confirm",
    cap: 20,
    why: "the ledger (order_events) is the truth and the projection (orders.status) is derived, so setting a paid projection where a paid event exists is the ledger's own law — but it is money-adjacent, and a person says yes per run. No event is written, no mail is sent, no fee is invented.",
    inverse: "each order's previous status is recorded; a revert restores it (and recreates the drift, on purpose).",
  },
  // ---- never --------------------------------------------------------------
  {
    id: "asterisk.governance",
    check: "asterisk.governance",
    tier: "never",
    why: "pausing, resuming, grading or overriding an ASTERISK function is an admin's word, written on the governance ledger with their name (/admin panel 10). The steward reports the state of the board and leaves the decision to the person — a supervisor that could pause the supervisor is one layer too many.",
  },
  {
    id: "data.self-edges",
    check: "data.self-edges",
    tier: "never",
    why: "edges carries CHECK (a <> b), so a self-edge cannot exist unless that constraint is gone — and then the constraint is the finding, not the row. The inverse of deleting one would violate the CHECK that should have stopped it.",
  },
  {
    id: "data.foreign-counters",
    check: "data.foreign-counters",
    tier: "never",
    why: "the check itself says some are expected (wire transmissions). Telling pollution from a legitimate foreign id is a judgment, and deleting a counter is a source-of-truth delete.",
  },
  {
    id: "identity.orphan-interactions",
    check: "identity.orphan-interactions",
    tier: "never",
    why: "taste survives the item; these are history. Deleting a source-of-truth row is outside the boundary.",
  },
  {
    id: "db.rls-coverage",
    check: "db.rls-coverage",
    tier: "never",
    why: "DDL. A policy is a migration file, reviewed in a PR and applied with DATABASE_ADMIN_URL — the runtime role cannot, and must not.",
  },
  {
    id: "db.migration-ledger",
    check: "db.migration-ledger",
    tier: "never",
    why: "same: an unapplied file is applied through scripts/apply-schema.mjs by a person holding the admin URL.",
  },
  {
    id: "data.user-records",
    check: "data.user-records",
    tier: "never",
    why: "a record over a cap is a reader's own data that arrived around the app; trimming or deleting it is a source-of-truth delete of something a person wrote. The finding names the writer; a person decides.",
  },
  {
    id: "data.embedding-coverage",
    check: "data.embedding-coverage",
    tier: "never",
    why: "an orphan vector is derived data, but deleting production rows and re-embedding the catalog are both a spend or a delete a person decides; the read path already ignores the dead rows.",
  },
  {
    id: "data.ebay-feed",
    check: "data.ebay-feed",
    tier: "never",
    why: "a stalled or failing feed is a worker that stopped, an entitlement that lapsed, or a column the mapper misreads — operations and code, not data. Re-running a checkpoint is a person's command; nothing here deletes or spends.",
  },
  {
    id: "ai.model-events",
    check: "ai.model-events",
    tier: "never",
    why: "a failing model seam is a prompt, a schema or a provider that changed — code and configuration, not data. The event rows are the audit trail and stay.",
  },
  {
    id: "brain.correction-lanes",
    check: "brain.correction-lanes",
    tier: "never",
    why: "a high undo share is a lane misfiring or a client bug — code, not data. The rows are the readers' own words and their retractions, both of which are evidence.",
  },
  {
    id: "brain.learning",
    check: "brain.learning",
    tier: "never",
    why: "a brain that stopped writing profiles is a code defect, not a data repair.",
  },
  {
    id: "asterisk.search-answer-rate",
    check: "asterisk.search-answer-rate",
    tier: "never",
    why: "a rising zero-result rate is the cultural read breaking — code, not data.",
  },
  {
    id: "asterisk.reading-coverage",
    check: "asterisk.reading-coverage",
    tier: "never",
    why: "an unread search is an engine path answering without interpreting — code, not data.",
  },
]);

/**
 * Things no tier reaches, named so the absence is a decision and not an
 * oversight. Every one of these has come up in this repo's history.
 */
export const NEVER_DELEGATED = Object.freeze([
  "ranking dials — any SEARCH_* flag, gamma, parts, the core slate (the owner's ruling on #336/#339 stands)",
  "money — refunds, fees, Stripe, anything that moves or promises a cent",
  "mail — SendGrid, any outbound message to a customer or an operator",
  "access — ADMIN_TOKEN, database roles, RLS, Vercel or GitHub settings",
  "DDL — migrations, constraints, policies, anything applied with the admin URL",
  "deleting a source-of-truth row — items, orders, order_events, interactions, accounts, messages",
]);

const BY_ID = new Map(BOUNDARY.map((b) => [b.id, b]));
const BY_CHECK = new Map();
for (const b of BOUNDARY) {
  if (!BY_CHECK.has(b.check)) BY_CHECK.set(b.check, []);
  BY_CHECK.get(b.check).push(b);
}

/** The boundary entry for an action id, or null when nothing declares it. */
export function boundaryFor(actionId) {
  return BY_ID.get(actionId) || null;
}

/** Every boundary entry that answers a check. */
export function boundaryForCheck(checkId) {
  return BY_CHECK.get(checkId) || [];
}

/**
 * May this action run in this call? Returns { ok } or { ok:false, why }.
 * `confirm` is the list of action ids a person said yes to for THIS run.
 */
export function permitted(actionId, { confirm = [] } = {}) {
  const b = boundaryFor(actionId);
  if (!b) return { ok: false, why: `no boundary entry declares "${actionId}" — an undeclared action cannot run` };
  if (b.tier === "never") return { ok: false, why: `never: ${b.why}` };
  if (b.tier === "confirm" && !confirm.includes(actionId)) {
    return { ok: false, why: `needs a person's yes for this run — pass --confirm=${actionId} (or CONFIRM on the desk)`, awaiting: true };
  }
  return { ok: true };
}
