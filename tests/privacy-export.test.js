// tests/privacy-export.test.js — Privacy export and erasure: every table
// erasure deletes is declared in the export manifest, the manifest declares
// nothing extra, and the export really contains the user's data.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  saveProfile, createBoard, addBoardItem, recordInteraction, bumpEdges, bumpPopularity,
} from "../lib/db/index.js";
import {
  exportPersonalizationData, purgePersonalizationData, setFollow, EXPORT_MANIFEST,
  DM_EXPORT_STATUS, EXPORTED_BUT_RETAINED, RETAINED_AFTER_ERASURE,
} from "../lib/db/production.js";

// CONSTITUTION.md §6 requires every signal to expose
// "edit/disconnect/forget/export/delete controls". Delete existed;
// EXPORT did not, so a user could erase their data but never see it.
//
// THE CONTRACT IS SYMMETRY WITH ERASURE: what we delete is what we show you.
// E1 enforces that mechanically against the real source of purge, so a table
// added to erasure and forgotten in the export fails a test rather than
// quietly narrowing the access right. That is the same class of drift that
// produced the identity_hash ledger bug (#149) — found by diffing two lists
// nobody had ever diffed.

async function fresh(...uids) {
  for (const uid of uids) await purgePersonalizationData(uid).catch(() => {});
}

// E1 and E2 read purge's OWN DELETE statements out of the source, so they have
// to know which file that is. They used to name lib/db/production.js; the split
// moved purge into lib/db/production/privacy.js, to sit with the export whose
// mirror it is, and both tests went red on "must be findable" — loudly, which
// is the right failure, but a test that has to be hand-repaired every time the
// file moves will eventually be repaired by deleting it. So it SEARCHES.
//
// Exactly one definition must exist. Two would mean a duplicated erasure path,
// which is the precise bug this pair of tests exists to prevent.
const PURGE_DECL = "export async function purgePersonalizationData";
function purgeSource() {
  const dbDir = path.join(process.cwd(), "lib", "db");
  const files = [
    path.join(dbDir, "production.js"),
    ...readdirSync(path.join(dbDir, "production")).filter((f) => f.endsWith(".js"))
      .map((f) => path.join(dbDir, "production", f)),
  ];
  const found = files.filter((f) => readFileSync(f, "utf8").includes(PURGE_DECL));
  assert.deepEqual(found.length, 1,
    `purgePersonalizationData must be findable in exactly one file, saw ${found.length}: ${found.join(", ")}`);
  const src = readFileSync(found[0], "utf8");
  const start = src.indexOf(PURGE_DECL);
  // The body runs to the next top-level export, or to the end of the file.
  const end = src.indexOf("\nexport ", start + PURGE_DECL.length);
  return src.slice(start, end === -1 ? src.length : end);
}

// The strong one. Reads purge's own DELETE statements out of the source and
// requires every table to be declared in the manifest.
test("E1 every table erasure deletes is declared in the export manifest", () => {
  const body = purgeSource();

  const erased = [...new Set(
    [...body.matchAll(/DELETE FROM ([a-z_]+)/g)].map((m) => m[1])
  )].sort();
  assert.ok(erased.length > 20, `expected purge to cover many tables, saw ${erased.length}`);

  const declared = new Set(Object.keys(EXPORT_MANIFEST));
  const undeclared = erased.filter((t) => !declared.has(t));
  assert.deepEqual(undeclared, [],
    "these tables are erased but not declared in EXPORT_MANIFEST — the export " +
    "would silently omit data the user is entitled to see");
});

// The manifest must not claim coverage it does not have either.
test("E2 the manifest declares nothing erasure does not touch", () => {
  const body = purgeSource();
  const erased = new Set([...body.matchAll(/DELETE FROM ([a-z_]+)/g)].map((m) => m[1]));

  const phantom = Object.keys(EXPORT_MANIFEST).filter((t) => !erased.has(t));
  assert.deepEqual(phantom, [],
    "declared in the manifest but never erased — either erasure has a gap or " +
    "the manifest is describing a table that is not the user's to export");
});

test("E3 the export actually contains the user's data", async () => {
  const user = "u-export-e3";
  await fresh(user);

  await saveProfile(user, { long: { TAILORED: 0.8 }, session: {}, _meta: { seen: ["x"] } });
  const board = await createBoard(user, "export board");
  await addBoardItem(board.id, { id: "e3-item", title: "piece", tags: ["TAILORED"] });
  await recordInteraction(user, "e3-item", "favorite", null);
  await setFollow(user, "brand", "Helmut Lang", true);

  const out = await exportPersonalizationData(user);

  assert.equal(out.identity.id, user);
  assert.equal(out.identity.kind, "device", "a u- identity is a device, not an account");
  assert.equal(out.data.taste.long.TAILORED, 0.8, "taste is included");
  assert.equal(out.data.boards.length, 1, "boards are included");
  assert.equal(out.data.interactions.rows.length, 1, "interactions are included");
  assert.deepEqual(out.data.follows.map((f) => f.target), ["Helmut Lang"]);

  await fresh(user);
});

// §6: "No silent caps: any bounded retrieval reports its truncation."
//
// E4 CHECKS SHAPE ONLY, and on a near-empty identity it asserts
// `truncated === false` — which is true no matter how broken the caps are.
// It passed while the export was silently returning 500 of a user's 3,000
// interactions under `cap: 5000, truncated: false`. E8 below is the test that
// actually detects that; this one is kept for the shape contract, relabelled
// so nobody mistakes it for a truncation test again.
test("E4 every bounded domain carries the cap/truncated SHAPE (not the values)", async () => {
  const user = "u-export-e4";
  await fresh(user);
  await saveProfile(user, { long: { GORP: 0.5 }, session: {}, _meta: {} });

  const out = await exportPersonalizationData(user);
  const boundedDomains = [
    out.data.interactions, out.data.events, out.data.searches, out.data.wardrobe,
    out.data.moodboard.uploads, out.data.moodboard.analyses,
    out.data.stylist.outfits, out.data.stylist.feedback, out.data.stylist.requests,
    out.data.corrections, out.data.aiEvents, out.data.editorial,
  ];
  for (const [i, d] of boundedDomains.entries()) {
    assert.ok(d && Array.isArray(d.rows), `bounded domain ${i} must carry rows`);
    assert.equal(typeof d.cap, "number", `bounded domain ${i} must state its cap`);
    assert.equal(typeof d.truncated, "boolean", `bounded domain ${i} must state truncation`);
    assert.equal(d.truncated, false, "nothing should truncate on a near-empty identity");
  }

  await fresh(user);
});

// Pseudonymous graph contributions are COUNTED, not listed: the content is an
// item pair shared with other people, so exporting rows would hand one user a
// slice of everyone's co-engagement graph. The user's own fact is the count.
test("E5 corroboration is counted, and the count is real", async () => {
  const user = "u-export-e5";
  await fresh(user);
  await saveProfile(user, { long: { GORP: 0.5 }, session: {}, _meta: {} });

  await bumpEdges([{ a: "e5-a", b: "e5-b", w: 1 }], user);
  await bumpPopularity([{ id: "e5-item", eng: 1, imp: 1 }], user);

  const out = await exportPersonalizationData(user);
  assert.equal(out.counts.corroboration.edges, 1, "one corroborated pair");
  assert.equal(out.counts.corroboration.popularity, 1, "one corroborated item");
  assert.ok(out.countedNotDetailed.corroboration.length > 0,
    "and the export must say WHY it is a count rather than rows");

  await fresh(user);
});

// What erasure keeps must be named here too, or the two controls describe
// different worlds and the user cannot reconcile them.
test("E6 the export names what it does not contain, in erasure's own words", async () => {
  const user = "u-export-e6";
  await fresh(user);
  await saveProfile(user, { long: { MINIMAL: 0.3 }, session: {}, _meta: {} });

  const exported = await exportPersonalizationData(user);
  const purged = await purgePersonalizationData(user);

  assert.deepEqual(exported.retained, purged.retained,
    "export and delete must describe the same retained set, word for word");

  await fresh(user);
});

test("E7 an account identity is reported as an account", async () => {
  const user = "sb-11111111-1111-4111-8111-111111111111";
  await fresh(user);
  await saveProfile(user, { long: { TAILORED: 0.2 }, session: {}, _meta: {} });

  const out = await exportPersonalizationData(user);
  assert.equal(out.identity.kind, "account");

  await fresh(user);
});

// THE TEST THAT SHOULD HAVE EXISTED. Found by the Aug 8 codebase audit, in
// code shipped hours earlier: EXPORT_CAPS asked for 5000 interactions, but
// getInteractions clamps its own limit to 500, and bounded() stamped the short
// list with the REQUESTED cap and `truncated: false`. A user with 3,000
// interactions downloaded 500 of them under a header saying nothing was cut —
// the §6 "no silent caps" rule broken by the feature built to satisfy it.
//
// E4 could never have caught it: it asserts truncated === false on an identity
// with almost no data, which is true whatever the caps say. The detector has to
// OVERFLOW a cap and demand the export admit it.
test("E8 a user past a cap gets exactly the cap, and is TOLD it was cut", async () => {
  const user = "u-export-e8";
  await fresh(user);
  await saveProfile(user, { long: { TAILORED: 0.5 }, session: {}, _meta: {} });

  // 520 > the 500 ceiling getInteractions actually enforces.
  const OVERFLOW = 520;
  for (let i = 0; i < OVERFLOW; i++) {
    await recordInteraction(user, `e8-item-${i}`, "favorite", null);
  }

  const out = await exportPersonalizationData(user);
  const d = out.data.interactions;

  // The declared cap must be one the reader can actually honour. Before the
  // fix this read 5000 while the reader returned 500.
  assert.equal(d.cap, 500, "the declared cap must be the reader's REAL ceiling");
  assert.equal(d.rows.length, d.cap, "a user past the ceiling gets exactly the ceiling");
  assert.equal(d.truncated, true,
    "and the export must SAY it was cut — reporting false here is the §6 violation");

  await fresh(user);
});

// The general form of the same defect: any cap that exceeds what its reader
// will return is a silent lie waiting to happen. Assert the invariant directly
// rather than one instance of it.
test("E9 no declared cap exceeds what its reader will actually return", async () => {
  const user = "u-export-e9";
  await fresh(user);
  await saveProfile(user, { long: { GORP: 0.4 }, session: {}, _meta: {} });

  const out = await exportPersonalizationData(user);
  const caps = [
    ["interactions", out.data.interactions.cap, 500],
    ["events", out.data.events.cap, 1000],
    ["wardrobe", out.data.wardrobe.cap, 500],
    ["moodboard.uploads", out.data.moodboard.uploads.cap, 200],
    ["moodboard.analyses", out.data.moodboard.analyses.cap, 200],
    ["stylist.outfits", out.data.stylist.outfits.cap, 100],
    ["stylist.feedback", out.data.stylist.feedback.cap, 500],
    ["corrections", out.data.corrections.cap, 500],
    // The mail desk's three. exportMessagesFor clamps to exactly what it is
    // handed, so these are self-consistent by construction — which is why
    // they belong here: the guard is against a future edit that raises a
    // declared cap above what the reader will return.
    ["messages.conversations", out.data.messages.conversations.cap, 500],
    ["messages.items", out.data.messages.items.cap, 5000],
    ["messages.blocks", out.data.messages.blocks.cap, 500],
  ];
  for (const [name, declared, readerCeiling] of caps) {
    assert.ok(declared <= readerCeiling,
      `${name}: export declares cap ${declared} but its reader clamps to ${readerCeiling} — ` +
      "the difference is data the user never receives and is never told about");
  }

  await fresh(user);
});

test("E10 every messaging table is declared in exactly one place", () => {
  // An UNVERIFIED claim of docs/history/dm-open-findings-2026-08-23.md, checked and
  // true: erasure and export did not know the DM subsystem existed. No dm_*
  // table was deleted, none was exported, and the retention disclosure did not
  // name them — so /api/privacy's DELETE response listed what it keeps and the
  // message store was in NEITHER list. Silence read as "erased".
  //
  // E1 above cannot catch that, and says so in its own comment: it requires
  // every table ERASURE touches to be in the manifest, and a table in NEITHER
  // list passes. This is the missing half.
  //
  // THREE PLACES, EXACTLY ONE EACH:
  //   EXPORT_MANIFEST       — erased and exported (E1/E2 hold both directions)
  //   EXPORTED_BUT_RETAINED — exported and KEPT, because it is also somebody
  //                           else's record (owner ruling, 23 Aug)
  //   DM_EXPORT_STATUS      — absent, with a reason
  const root = process.cwd();
  const sql = readFileSync(path.join(root, "supabase", "schema-v40-direct-messages.sql"), "utf8")
    + readFileSync(path.join(root, "supabase", "schema-v41-dm-activity.sql"), "utf8")
    + readFileSync(path.join(root, "supabase", "schema-v42-dm-reactions-unsend.sql"), "utf8");
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(dm_[a-z_]+)/g)].map((m) => m[1]);

  assert.ok(tables.length >= 6, `expected the mail desk's tables, found ${tables.join(", ")}`);

  // A LAW TABLE is not anybody's data. dm_reaction_kinds is a fixed palette
  // granted SELECT-only — the shape v42 chose deliberately, because an open
  // emoji field is a covert text channel. It is not created per person and
  // belongs in NONE of the three. Named here rather than skipped silently, so
  // a future law table has to be named too.
  const LAW_TABLES = new Set(["dm_reaction_kinds"]);

  for (const table of new Set(tables)) {
    const places = [
      table in EXPORT_MANIFEST && "EXPORT_MANIFEST",
      table in EXPORTED_BUT_RETAINED && "EXPORTED_BUT_RETAINED",
      table in DM_EXPORT_STATUS && "DM_EXPORT_STATUS",
    ].filter(Boolean);

    if (LAW_TABLES.has(table)) {
      assert.deepEqual(places, [],
        `${table} is a law table and must not be claimed as personal data`);
      continue;
    }
    assert.equal(places.length, 1,
      `${table} is declared in ${places.length === 0 ? "NONE" : places.join(" and ")} — `
      + "which is exactly how the whole subsystem went missing from both lists");
    if (table in DM_EXPORT_STATUS) {
      assert.ok(DM_EXPORT_STATUS[table].length > 20, `${table} is declared absent but the reason is not one`);
    }
    if (table in EXPORTED_BUT_RETAINED) {
      assert.ok(EXPORTED_BUT_RETAINED[table].length > 20, `${table} is declared kept but the reason is not one`);
    }
  }
  // and the enumeration really did reach the palette — a skip nobody exercises
  // is a rule nobody has
  assert.ok(tables.includes("dm_reaction_kinds"));
});

test("E11 exported-but-retained means retained — erasure must not touch it", () => {
  // The invariant that keeps the new third category honest, in the direction
  // E2 cannot see. E2 asks "is every manifest table erased?"; this asks the
  // opposite of the other list. A table that is both exported-and-retained AND
  // erased is one of the two lists lying, and the person reading the DELETE
  // response is the one who finds out.
  const src = readFileSync(path.join(process.cwd(), "lib", "db", "production.js"), "utf8");
  const start = src.indexOf("export async function purgePersonalizationData");
  const end = src.indexOf("\n// ---- §6 export", start);
  const body = src.slice(start, end === -1 ? src.length : end);
  const erased = new Set([...body.matchAll(/DELETE FROM ([a-z_]+)/g)].map((m) => m[1]));

  const contradictions = Object.keys(EXPORTED_BUT_RETAINED).filter((t) => erased.has(t));
  assert.deepEqual(contradictions, [],
    "declared retained AND erased — one of the two lists is lying to whoever reads the DELETE response");

  // and the manifest and the retained list must not overlap either: a table is
  // erased-and-exported, or kept-and-exported, never described as both
  const both = Object.keys(EXPORTED_BUT_RETAINED).filter((t) => t in EXPORT_MANIFEST);
  assert.deepEqual(both, []);
});

test("E12 the export actually carries the mail desk, in the same shape as everything else", async () => {
  // A declaration in a table is not an export. This asserts the DOMAIN exists
  // on the payload with the cap/truncated shape §6 requires, and that it says
  // WHICH answer it is giving — because "no messages" and "the store could not
  // be read" are different facts, and mem mode can only ever give the second.
  const out = await exportPersonalizationData("u-export-messages-shape");

  assert.ok(out.data.messages, "the domain exists");
  assert.ok(["read", "none", "unavailable", "unreadable"].includes(out.data.messages.store),
    `store must say which answer this is, got ${out.data.messages.store}`);
  for (const [name, list] of Object.entries({
    conversations: out.data.messages.conversations,
    items: out.data.messages.items,
    blocks: out.data.messages.blocks,
  })) {
    assert.ok(Array.isArray(list.rows), `${name} carries rows`);
    assert.equal(typeof list.cap, "number", `${name} states its cap (§6: no silent caps)`);
    assert.equal(typeof list.truncated, "boolean", `${name} says whether it truncated`);
  }

  // MEM MODE MUST NOT REPORT AN EMPTY INBOX. lib/db/dm.js refuses in mem
  // rather than mirroring the laws in JS; an export claiming "no messages"
  // there would be the exact mem-vs-Postgres lie that module exists to prevent.
  const { getPool } = await import("../lib/db/index.js");
  if (!(await getPool())) {
    assert.equal(out.data.messages.store, "unavailable",
      "mem mode has no messaging at all, and the export has to say so");
  }
});

test("E13 the retention disclosure names the messages it keeps", () => {
  // The /api/privacy DELETE response returns this array verbatim. It listed
  // purchase tickets, deidentified counters and the auth account — and not the
  // message store, which is also kept. A retention list that omits something
  // retained is a false statement to the person who asked to be forgotten.
  const named = RETAINED_AFTER_ERASURE.join(" | ").toLowerCase();
  assert.match(named, /direct messages/, "the messages are named");
  assert.match(named, /other person/, "and WHY they are kept is named with them");
  assert.match(named, /blocks you made/, "so are the safety controls erasure must not undo");

  // and the three original entries are still there — this is an addition, not
  // a rewrite of what was already disclosed
  assert.match(named, /purchase tickets/);
  assert.match(named, /deidentified raw event counters/);
  assert.match(named, /auth account/);

  const source = readFileSync(path.join(process.cwd(), "lib", "db", "production.js"), "utf8");
  const literals = source.match(/retained: \[/g) || [];
  assert.deepEqual(literals, [],
    "and no call site rebuilds the list as a literal — the mem branch drifted from "
    + "the Postgres one exactly that way once before");
});

test("E14 the manifest does not claim a table the export never reads", async () => {
  // Found by a reviewer while the mail desk was going in, and it had been
  // true since the manifest existed: `user_profiles` is declared
  // { domain: "profileRoom" } and only profile_rooms was ever selected. E1 and
  // E2 both pass, because both diff purge's DELETE list against the manifest
  // and NEITHER compares the manifest against what the export actually reads.
  //
  // This checks the one domain that had the gap, by name. A general version
  // would need a table→reader map the code does not have, and inventing one to
  // satisfy a test would be a second description of the export that could
  // drift from the first.
  const out = await exportPersonalizationData("u-export-e14");
  assert.ok("profileRoom" in out.data, "the published page");
  assert.ok("profileAccount" in out.data,
    "and the account row behind it — user_profiles, which the manifest has always declared");

  const declaredForDomain = Object.entries(EXPORT_MANIFEST)
    .filter(([, entry]) => entry.domain === "profileRoom")
    .map(([table]) => table)
    .sort();
  assert.deepEqual(declaredForDomain, ["profile_rooms", "user_profiles"],
    "if a third table joins this domain, the export needs a third read");
});
