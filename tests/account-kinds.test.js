// tests/account-kinds.test.js — the split between a passport and a business.
//
// The kind re-shapes navigation, six routes, the profile layout and the DM
// rules. The danger in a split like this is not that one branch is wrong — it
// is that two branches DISAGREE: a nav that hides a link while the route stays
// reachable is not a hidden feature, it is an unguarded one. So these tests
// pin the capability table as the single answer, and pin that the guard reads
// the same table the nav does.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_KINDS, CAPABILITIES, CAPABILITY_NAMES, DEFAULT_KIND, ROUTE_CAPABILITY,
  can, capabilityForRoute, homeFor, isAccountKind, isBusiness, normalizeKind, routeAllowed,
} from "../lib/accounts.js";
import {
  accountKind, accountKindCounts, accountKindHistory, readAccountKind,
  setAccountKind, __resetAccountKindsForTests,
} from "../lib/db/accountKinds.js";

test("the capability matrix is TOTAL — no kind may be missing a row", () => {
  // The failure this prevents: a new capability added for `business` and
  // forgotten for `passport` reads as undefined, which is falsy, which means
  // "denied" — a default nobody chose and nobody reviewed.
  for (const kind of ACCOUNT_KINDS) {
    assert.ok(CAPABILITIES[kind], `${kind} has no capability row`);
    for (const name of CAPABILITY_NAMES) {
      assert.equal(typeof CAPABILITIES[kind][name], "boolean",
        `${kind}.${name} must be an explicit boolean, got ${typeof CAPABILITIES[kind][name]}`);
    }
    assert.deepEqual(Object.keys(CAPABILITIES[kind]).sort(), [...CAPABILITY_NAMES].sort(),
      `${kind} has a different capability set from ${DEFAULT_KIND}`);
  }
});

test("the two kinds actually differ, and in the direction the owner specified", () => {
  // Both kinds may sell through the one native Storefront; business remains a
  // distinct analytics/watchtower choice. Asserted explicitly because a refactor
  // that made both rows identical would pass every other test in this file.
  assert.equal(can("passport", "passport"), true);
  assert.equal(can("passport", "stylist"), true);
  assert.equal(can("passport", "discover"), true);
  assert.equal(can("passport", "analytics"), false);
  assert.equal(can("passport", "watchtower"), false);
  assert.equal(can("passport", "storefront"), true,
    "opening a native Storefront must not trade away the Passport");

  assert.equal(can("business", "passport"), false, "a business has no passport tab");
  assert.equal(can("business", "stylist"), false, "a business has no stylist");
  assert.equal(can("business", "discover"), false, "a business has no discovery");
  assert.equal(can("business", "analytics"), true);
  assert.equal(can("business", "watchtower"), true);
  assert.equal(can("business", "storefront"), true);
});

test("a passport may switch DMs off; a business may not", () => {
  // The one asymmetry that is a product rule rather than a surface: a
  // storefront that can be browsed but never asked a question is worse than
  // no storefront. This removes the BLANKET switch only — per-conversation
  // media consent and blocking an individual apply to both sides.
  assert.equal(can("passport", "dmOptOut"), true);
  assert.equal(can("business", "dmOptOut"), false);
});

test("an unknown or absent kind is a passport, never a business", () => {
  // Defaulting the other way would hand analytics/watchtower surfaces to
  // every account that predates this table and remove its Passport.
  assert.equal(normalizeKind(undefined), "passport");
  assert.equal(normalizeKind(""), "passport");
  assert.equal(normalizeKind("BUSINESS"), "passport", "the check is exact, not case-folded");
  assert.equal(normalizeKind("admin"), "passport");
  assert.equal(can("nonsense", "analytics"), false);
  assert.equal(isBusiness("nonsense"), false);
  assert.equal(DEFAULT_KIND, "passport");
  assert.equal(isAccountKind("passport"), true);
  assert.equal(isAccountKind("business"), true);
  assert.equal(isAccountKind("stylist"), false);
});

test("every guarded route resolves to a capability that exists", () => {
  // A route guarded by a capability nobody defined would be open to everyone
  // while looking guarded.
  for (const [route, capability] of Object.entries(ROUTE_CAPABILITY)) {
    assert.ok(CAPABILITY_NAMES.includes(capability),
      `${route} is guarded by unknown capability "${capability}"`);
  }
});

test("the guard reads the same table the nav does, sub-paths included", () => {
  assert.equal(routeAllowed("business", "/board"), false);
  assert.equal(routeAllowed("business", "/board/anything"), false, "sub-paths are guarded too");
  assert.equal(routeAllowed("business", "/stylist"), false);
  assert.equal(routeAllowed("business", "/discover"), false);
  // A query string must not open a guarded route. It did: capabilityForRoute
  // matched on the raw pathname, so "/discover?q=raf" resolved to no
  // capability at all and read as open — and a query string is what an
  // ordinary link carries.
  assert.equal(routeAllowed("business", "/discover?q=raf"), false);
  assert.equal(routeAllowed("business", "/board#top"), false);
  assert.equal(routeAllowed("business", "/analytics"), true);
  assert.equal(routeAllowed("passport", "/analytics"), false);
  assert.equal(routeAllowed("passport", "/watchtower"), false);
  assert.equal(routeAllowed("passport", "/board"), true);

  // Shared routes stay shared. The catalog, the wire and settings are not
  // part of the split, and a guard that quietly closed them would be a much
  // bigger regression than a missing tab.
  for (const shared of ["/", "/cover", "/hotlist", "/settings", "/profile", "/terms"]) {
    assert.equal(capabilityForRoute(shared), null, `${shared} must stay open to both`);
    assert.equal(routeAllowed("business", shared), true);
    assert.equal(routeAllowed("passport", shared), true);
  }
});

test("a kind that cannot reach a route is sent somewhere it CAN reach", () => {
  // Bouncing a business to the catalog answers "no" without answering
  // "then where?". It arrived at /board wanting its own equivalent.
  assert.equal(homeFor("business"), "/analytics");
  assert.equal(homeFor("passport"), "/board");
  assert.equal(routeAllowed("business", homeFor("business")), true);
  assert.equal(routeAllowed("passport", homeFor("passport")), true);
});

// --- the store -------------------------------------------------------------

test("an account that never chose has NO row, and reads as the default", () => {
  // "defaulted" and "chose passport" are different facts. The admin desk needs
  // to tell them apart, so absence must stay absence rather than being
  // back-filled with a row nobody asked for.
  __resetAccountKindsForTests();
  return (async () => {
    assert.equal(await readAccountKind("11111111-1111-4111-8111-111111111111"), null);
    assert.equal(await accountKind("11111111-1111-4111-8111-111111111111"), "passport");
  })();
});

test("choosing records the kind AND a ledger entry", async () => {
  __resetAccountKindsForTests();
  const result = await setAccountKind("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "business", { actor: "signup" });
  assert.deepEqual(result, { kind: "business", changed: true });
  assert.equal(await readAccountKind("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"), "business");

  const history = await accountKindHistory("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
  assert.equal(history.length, 1);
  assert.equal(history[0].fromKind, null, "the first choice comes from nothing");
  assert.equal(history[0].toKind, "business");
  assert.equal(history[0].actor, "signup");
});

test("re-choosing the same kind is a no-op and does NOT pad the ledger", async () => {
  // A retry, a double-click, or a client that replays its own request must not
  // make the trail unreadable.
  __resetAccountKindsForTests();
  await setAccountKind("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "business");
  const again = await setAccountKind("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "business");
  assert.deepEqual(again, { kind: "business", changed: false });
  assert.equal((await accountKindHistory("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb")).length, 1);
});

test("a change records where it came FROM", async () => {
  __resetAccountKindsForTests();
  await setAccountKind("cccccccc-3333-4333-8333-cccccccccccc", "passport", { actor: "signup" });
  await setAccountKind("cccccccc-3333-4333-8333-cccccccccccc", "business", { actor: "admin", note: "verified storefront" });
  const history = await accountKindHistory("cccccccc-3333-4333-8333-cccccccccccc");
  assert.equal(history.length, 2);
  assert.equal(history[0].toKind, "business");
  assert.equal(history[0].fromKind, "passport", "the trail must say what it was");
  assert.equal(history[0].actor, "admin");
  assert.equal(history[0].note, "verified storefront");
});

test("the store refuses a kind or an actor it does not know", async () => {
  __resetAccountKindsForTests();
  await assert.rejects(() => setAccountKind("dddddddd-4444-4444-8444-dddddddddddd", "superuser"), /unknown account kind/);
  await assert.rejects(() => setAccountKind("dddddddd-4444-4444-8444-dddddddddddd", "business", { actor: "itself" }), /unknown actor/);
  await assert.rejects(() => setAccountKind("", "business"), /bare auth uuid/);
  assert.equal(await readAccountKind("dddddddd-4444-4444-8444-dddddddddddd"), null, "a refused write leaves nothing behind");
});

test("the roster splits by kind for the admin terminal", async () => {
  __resetAccountKindsForTests();
  await setAccountKind("aaaaaaaa-0001-4001-8001-aaaaaaaaaaaa", "business");
  await setAccountKind("bbbbbbbb-0002-4002-8002-bbbbbbbbbbbb", "passport");
  await setAccountKind("cccccccc-0003-4003-8003-cccccccccccc", "business");
  assert.deepEqual(await accountKindCounts(), { passport: 1, business: 2 });
});

// --- the navigation the two kinds are offered -------------------------------

test("a business is offered ANALYTICS with WATCH TOWER inside it, never ACCOUNT's passport", async () => {
  // V.2 (blueprint, 17 Oct): FEED, PASSPORT and ACCOUNT for a passenger; a
  // business swaps ACCOUNT for ANALYTICS, reaches WATCH TOWER as its
  // sub-link, and has no PASSPORT (the globe) because the guard closes /board.
  const { navFor, deckFor } = await import("../lib/nav.js");
  const nav = navFor("business");
  const labels = nav.map((n) => n.label);
  assert.ok(labels.includes("ANALYTICS"), "the business ledger must be reachable");
  assert.ok(nav.some((n) => (n.sub || []).some((s) => s.label === "WATCH TOWER")), "watch tower rides under analytics");
  assert.ok(!labels.includes("ACCOUNT"), "a business has no passport account key");
  assert.ok(!labels.includes("PASSPORT"), "a business has no passport, so no globe");
  assert.deepEqual(deckFor("business").map((n) => n.label), ["FEED", "ANALYTICS"]);
});

test("a passport's navigation is untouched by the split", async () => {
  const { navFor } = await import("../lib/nav.js");
  const labels = navFor("passport").map((n) => n.label);
  assert.ok(labels.includes("ACCOUNT"));
  assert.ok(labels.includes("PASSPORT"));
  assert.ok(!labels.includes("ANALYTICS"));
  assert.ok(!labels.includes("WATCH TOWER"));
  // An unknown kind must render the passport nav, not an empty one.
  assert.deepEqual(navFor("nonsense").map((n) => n.label), labels);
});

test("the swap keeps the deck's slots in the same order — it is a swap, not a subtraction", async () => {
  const { deckFor } = await import("../lib/nav.js");
  const passport = deckFor("passport"), business = deckFor("business");
  assert.equal(passport.length, 2, "V.2: two routes on the deck, FEED and ACCOUNT");
  assert.equal(business.length, passport.length,
    "a business must not simply lose deck keys");
  // The shared slots must sit in identical positions, so the OS is the same
  // building whichever door you came through.
  passport.forEach((entry, i) => {
    if (["ACCOUNT"].includes(entry.label)) return;
    assert.equal(business[i].label, entry.label, `slot ${i} moved`);
  });
});

test("the nav never offers a door the route guard closes", async () => {
  // THE failure this whole design exists to prevent. Asserted for both kinds
  // across every destination and every sub-link, because a hidden link over a
  // live URL is an unguarded feature, not a hidden one.
  const { navFor } = await import("../lib/nav.js");
  for (const kind of ACCOUNT_KINDS) {
    for (const entry of navFor(kind)) {
      assert.equal(routeAllowed(kind, entry.href), true,
        `${kind} is offered ${entry.href} but the guard refuses it`);
      for (const sub of entry.sub || []) {
        assert.equal(routeAllowed(kind, sub.href), true,
          `${kind} is offered sub-link ${sub.href} but the guard refuses it`);
      }
    }
  }
});

// --- ADR-002: a kind belongs to an ACCOUNT, never to a device ---------------

test("only a bare auth uuid may hold a kind — ADR-002", async () => {
  // v37 keyed on the raw identity string. The chooser then wrote the DEVICE id
  // `u-<uuid>` (adoption to `sb-<uuid>` happens later, in the shell's auth
  // listener), and the reader looked up `sb-<uuid>`. The row existed, no error
  // was raised, and the account read as `passport` forever: a business whose
  // storefront silently never appeared.
  __resetAccountKindsForTests();
  const uuid = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

  for (const wrong of [`u-${uuid}`, `sb-${uuid}`, "guest", "acct-1", "", null, undefined]) {
    await assert.rejects(
      () => setAccountKind(wrong, "business"),
      /bare auth uuid/,
      `${JSON.stringify(wrong)} must not be able to hold a kind`);
  }

  // and the bare uuid works, case-insensitively
  await setAccountKind(uuid.toUpperCase(), "business");
  assert.equal(await readAccountKind(uuid), "business",
    "the uuid is normalized, so case cannot split one account into two rows");
});

test("a device identity reads as an unchosen passport, not as an error", async () => {
  // Reading is the hot path on every page. A device that has not signed in is
  // definitionally a passport (ADR-002: a business account is impossible for a
  // signed-out user), so the read answers rather than throwing.
  __resetAccountKindsForTests();
  assert.equal(await readAccountKind("u-eeeeeeee-5555-4555-8555-eeeeeeeeeeee"), null);
  assert.equal(await accountKind("u-eeeeeeee-5555-4555-8555-eeeeeeeeeeee"), "passport");
});

test("the store and the route agree on what an account id is", async () => {
  // The defect was a DISAGREEMENT between two id spaces, so pin that the
  // helper the route uses produces exactly what the store accepts.
  const { accountIdFromIdentity } = await import("../lib/identity.js");
  const uuid = "ffffffff-6666-4666-8666-ffffffffffff";
  assert.equal(accountIdFromIdentity("sb-" + uuid), uuid);
  assert.equal(accountIdFromIdentity("u-" + uuid), null, "a device identity maps to no account");
  __resetAccountKindsForTests();
  await setAccountKind(accountIdFromIdentity("sb-" + uuid), "business");
  assert.equal(await readAccountKind(uuid), "business");
});
