// lib/accounts.js
// WHAT KIND OF ACCOUNT THIS IS, and — more importantly — the single table that
// says what each kind can reach. Isomorphic: no database, no imports with a
// server-only edge, so the shell can ask the same question the API enforces.
//
// WHY A CAPABILITY TABLE AND NOT `if (kind === "business")`.
// The two kinds diverge across the whole product: navigation, six routes, the
// profile layout, the DM rules. Scattered conditionals would mean the nav and
// the route guard could disagree — and the one that is wrong is invisible,
// because a nav that hides a link still leaves the URL reachable. One table,
// read by the nav AND the guard AND the tests, cannot drift against itself.
//
// The kinds are deliberately NOT a boolean. A third kind (an institution, a
// stylist) is a plausible future, and `isBusiness` everywhere would have to be
// unpicked to add one; a named kind with a capability row would not.

export const ACCOUNT_KINDS = ["passport", "business"];

// Everyone starts here. An account that has never chosen — every device
// identity before this shipped, and every reader who signs in without being
// asked — is a passport. A native Storefront is additive to either kind;
// defaulting business would instead hand analytics/watchtower access to people
// who never asked for it and remove their Passport surfaces.
export const DEFAULT_KIND = "passport";

/** Is this one of the two real account kinds? Use before trusting a value
 *  that arrived from a request or an old row. */
export function isAccountKind(value) {
  return ACCOUNT_KINDS.includes(String(value || ""));
}

/** Any value -> a valid kind, falling back to `passport`.
 *  Failing SAFE is the point: an unreadable kind must not be handed the
 *  storefront and analytics surfaces a business gets. */
export function normalizeKind(value) {
  return isAccountKind(value) ? String(value) : DEFAULT_KIND;
}

// Every capability the two kinds differ on. Adding a row here is how a new
// surface joins the split; tests/account-kinds.test.js asserts the matrix is
// total, so a capability that exists for one kind and is simply missing for
// the other fails rather than silently reading as `undefined` (falsy, and
// therefore "denied" — a default nobody chose).
export const CAPABILITIES = {
  passport: {
    passport: true,      // /board — the moodboard, the identity
    stylist: true,       // /stylist
    discover: true,      // /discover
    analytics: false,    // /analytics — the business ledger
    watchtower: false,   // /watchtower — cohort demand
    storefront: true,    // native Storefront is additive; the Passport stays
    dmOptOut: true,      // may switch DMs off entirely
  },
  business: {
    passport: false,
    stylist: false,
    discover: false,
    analytics: true,
    watchtower: true,
    storefront: true,
    // A business may NOT switch DMs off. It is the reachable party in this
    // market: a storefront that can be browsed but not asked a question is a
    // worse experience than no storefront. Per-conversation media consent
    // still applies to both sides, and blocking an individual still applies —
    // this removes the blanket switch, not the ability to refuse a person.
    dmOptOut: false,
  },
};

export const CAPABILITY_NAMES = Object.keys(CAPABILITIES[DEFAULT_KIND]);

/** Can an account of `kind` reach `capability`? Unknown kind ⇒ the default. */
export function can(kind, capability) {
  const row = CAPABILITIES[normalizeKind(kind)];
  return row ? row[capability] === true : false;
}

/** Shorthand for the business branch. Prefer `can(kind, capability)` where a
 *  capability exists — asking WHAT an account may do survives a third kind
 *  being added; asking WHETHER IT IS A BUSINESS does not. */
export function isBusiness(kind) {
  return normalizeKind(kind) === "business";
}

// Route → capability. The guard reads this so a new route cannot be added to
// the nav without declaring which capability opens it.
export const ROUTE_CAPABILITY = {
  "/board": "passport",
  "/upload": "passport",
  "/stats": "passport",
  "/stylist": "stylist",
  "/discover": "discover",
  "/analytics": "analytics",
  "/watchtower": "watchtower",
};

/**
 * The capability guarding `pathname`, or null when the route is open to both.
 * Longest prefix wins so /discover/foo resolves like /discover.
 */
export function capabilityForRoute(pathname) {
  // Strip the query and hash before matching. Without this, "/discover?q=raf"
  // matched nothing and read as an OPEN route — a business could reach the
  // whole of discovery by adding a query string, which is the first thing a
  // real link does. Caught by tests/account-kinds.test.js, not by review.
  const path = String(pathname || "").split("?")[0].split("#")[0];
  let best = null;
  for (const [route, capability] of Object.entries(ROUTE_CAPABILITY)) {
    if ((path === route || path.startsWith(route + "/")) &&
        (!best || route.length > best.route.length)) {
      best = { route, capability };
    }
  }
  return best ? best.capability : null;
}

/** Is `pathname` reachable by `kind`? Routes with no capability are open. */
export function routeAllowed(kind, pathname) {
  const capability = capabilityForRoute(pathname);
  return capability === null ? true : can(kind, capability);
}

// Where a kind belongs when it lands somewhere it cannot reach. Not the
// catalog for a business: the point of a redirect is to answer "then where?",
// and a business arriving at /board wanted its own equivalent.
export const HOME_FOR_KIND = { passport: "/board", business: "/analytics" };

/** Where to send an account that landed somewhere it cannot reach.
 *  A redirect must answer "then where?", so a business bounced off /board goes
 *  to /analytics rather than to the catalog. */
export function homeFor(kind) {
  return HOME_FOR_KIND[normalizeKind(kind)] || "/";
}
