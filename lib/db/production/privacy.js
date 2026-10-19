// lib/db/production/privacy.js — WHAT WE HOLD ABOUT YOU, AND HANDING IT BACK.
//
// Split out of production.js unchanged. Its own reasoning follows.

// The §6 export reads EVERY signal we hold, so it necessarily imports from
// every domain module. That is why it sits at the bottom of the split: it is
// the one module that depends on all the others and is depended on by none.
import {
  getPool, getProfile, getBoards, getInteractions, listEvents, identityHash,
  countMemOperations, countMemLedgers, purgeMemoryUserData, hasDecayColumns,
} from "../index.js";
import { halfLifeMs } from "../../brain/popularity.js";
import { listUserRecords } from "./records.js";
import { mem, boundedLimit } from "./store.js";
import { getUserMeasurements } from "./catalog.js";
import { listMoodBoardUploads, listStylistOutfits } from "./editorial.js";
import { getUserStyleProfileRow, listMoodBoardAnalyses, listStylistFeedback } from "./ai.js";
import { listUserCorrections } from "./corrections.js";
import { getMemoryPreferences, getRailPrefs, listFollows, listWardrobeItems } from "./interpretation.js";

// ---- §6 export (the access right) -------------------------------------------
//
// CONSTITUTION.md §6 requires every signal to expose
// "edit/disconnect/forget/export/delete controls". Delete has existed since
// purgePersonalizationData; EXPORT did not, so a user could erase their data
// but never see it. This is that control.
//
// THE CONTRACT IS SYMMETRY WITH ERASURE: what we delete is what we show you.
// Anything purgePersonalizationData removes must appear here, and anything it
// deliberately RETAINS must be named rather than silently missing. The
// manifest below is that promise in machine-checkable form, and
// tests/privacy-export.test.js asserts purge's DELETE list is a subset of it —
// so a future table added to erasure and forgotten here fails a test instead
// of quietly narrowing the user's access right.
//
// §6 also forbids silent caps, so every bounded read reports `truncated` and
// the `cap` it hit rather than returning a short list that looks complete.
// WHAT ERASURE LEAVES BEHIND, in one place because three call sites returned
// it as a literal and the mem branch had already drifted from the Postgres one
// once — telling people on preview deploys a different retention from the one
// production performs.
//
// DIRECT MESSAGES ARE NAMED HERE because the 23 Aug review found erasure and
// export did not know the subsystem existed: no dm_* table was deleted, none
// was exported, and the retention disclosure did not mention them either.
// Silence read as "erased".
//
// They are now EXPORTED (owner ruling: two people should have records) and
// still RETAINED, and those two facts are not in tension — they are the same
// fact seen from both ends. A message is also the OTHER person's record of a
// conversation they took part in: deleting one side's copy destroys somebody
// else's history, and handing one side a copy destroys nothing. So the export
// gives it to you and erasure leaves it alone, and this list says so rather
// than letting you infer it.
export const RETAINED_AFTER_ERASURE = Object.freeze([
  "purchase tickets and order/payment/refund ledgers — transaction records, not personalization",
  "storefront ownership and public-content audit snapshots, inventory/payment attempts, and the one-time fee collection/reversal ledger — retained for fulfilment, reconciliation, disputes and financial audit; publishing can be paused or archived separately",
  "deidentified raw event counters (eng/imp, no identity column)",
  "auth account",
  "direct messages, which are also the other person's record of a conversation they were in — retained, AND included in your export (owner ruling, 23 Aug: two people should have records)",
  "a listing's verification appeals (12.9) and the Passenger Score's confirmed penalties (6.32) — the listing's and the marketplace's enforcement records; the score itself resets to zero and your reviews of others stay, anonymized (6.31, 14.6)",
  "your messaging settings and the blocks you made — erasing them would silently reopen a door you closed",
]);

export const EXPORT_MANIFEST = Object.freeze({
  // domain -> how the table is represented in the export
  profiles: { domain: "taste", mode: "rows" },
  boards: { domain: "boards", mode: "rows" },
  board_items: { domain: "boards", mode: "rows" },
  interactions: { domain: "interactions", mode: "rows" },
  user_events: { domain: "events", mode: "rows" },
  search_logs: { domain: "searches", mode: "rows" },
  user_follows: { domain: "follows", mode: "rows" },
  user_measurements: { domain: "measurements", mode: "rows" },
  wardrobe_items: { domain: "wardrobe", mode: "rows" },
  mood_board_uploads: { domain: "moodboard", mode: "rows" },
  mood_board_analysis: { domain: "moodboard", mode: "rows" },
  stylist_requests: { domain: "stylist", mode: "rows" },
  stylist_outfits: { domain: "stylist", mode: "rows" },
  stylist_feedback: { domain: "stylist", mode: "rows" },
  user_corrections: { domain: "corrections", mode: "rows" },
  interpretation_feedback: { domain: "interpretationFeedback", mode: "rows" },
  asterisk_memory_preferences: { domain: "preferences", mode: "rows" },
  user_rail_prefs: { domain: "preferences", mode: "rows" },
  // v53: saves of people/places/events/articles, the base city and its
  // visibility, queued corrections and studio drafts — the person's own acts.
  user_records: { domain: "records", mode: "rows" },
  // v68 (slice 10b): the home town and the consented ethnicity, served only to their owner
  account_identity: { domain: "identity", mode: "rows" },
  account_devices: { domain: "identity", mode: "count" },
  // v72 (the music seams): the sealed Spotify / Apple Music tokens — a count of connections, never a token
  connector_tokens: { domain: "identity", mode: "count" },
  // verification_appeals is NOT here: an appeal is the LISTING's record (12.9), kept with the
  // storefront's own rows like the listing itself; RETAINED_AFTER_ERASURE names it.
  user_style_profiles: { domain: "styleProfile", mode: "rows" },
  ai_model_events: { domain: "aiEvents", mode: "rows" },
  editorial_posts: { domain: "editorial", mode: "rows" },
  profile_rooms: { domain: "profileRoom", mode: "rows" },
  user_profiles: { domain: "profileRoom", mode: "rows" },
  // NOTE: the dm_* tables are deliberately absent — see DM_EXPORT_STATUS below.
  // Absent-with-a-reason, in a table a test can read, rather than absent.
  // Pseudonymous, identity_hash-keyed. The CONTENT is other people's graph —
  // an item pair or an item id — so exporting rows would hand one user a slice
  // of the co-engagement graph. The user's own fact is "you corroborated N of
  // these", which is what erasure removes, so counts are the honest unit.
  edge_contributors: { domain: "corroboration", mode: "count" },
  popularity_contributors: { domain: "corroboration", mode: "count" },
  unknown_query_votes: { domain: "corroboration", mode: "count" },
  // Also identity_hash-keyed (v28), but the CONTENT is the person's own act —
  // "you liked/saved these transmissions" — so rows are theirs to export,
  // unlike the graph ledgers above.
  transmission_engagements: { domain: "engagement", mode: "rows" },
  // Internal plumbing, not a signal about the person: replay-idempotency keys
  // and the record of which device identities merged in. Counted so the export
  // is complete, not detailed, because the contents describe the system.
  processed_operations: { domain: "internal", mode: "count" },
  identity_adoptions: { domain: "internal", mode: "count" },
});

// THE MAIL DESK IS IN THE EXPORT, AND IT IS NOT IN ERASURE. BOTH ON PURPOSE.
//
// OWNER RULING, 23 August: **two people should have records.** #395 left one
// question open — whether a DM export ships at all, given that a conversation
// is two people's record and one side asking for a copy is asking for words
// the other side wrote. The answer is that both sides are IN it, so both sides
// get it. A person's own conversation is theirs to keep; the alternative is a
// record only the company holds.
//
// That breaks an assumption this file was built on. EXPORT_MANIFEST means
// "erased AND exported", and E2 enforces the second half of that biconditional
// — a manifest table that erasure never touches fails the test, because until
// now such a table could only be a mistake. A two-party record is the first
// thing that is genuinely EXPORTED AND RETAINED: erasing it would delete
// somebody else's history of a conversation they were in.
//
// So the asymmetry gets its own name rather than a hole in E2. Every dm_*
// table appears in exactly one of three places — EXPORT_MANIFEST,
// EXPORTED_BUT_RETAINED, or DM_EXPORT_STATUS — and the tests fail on a table
// in none of them, or in more than one.
export const EXPORTED_BUT_RETAINED = Object.freeze({
  dm_conversations: "the conversation itself — the other person was in it too",
  dm_participants: "your side of it: folder, read position, mute, media consent",
  dm_messages: "what was said, by both people, through the SAME visibility rule the thread renders by",
  dm_reactions: "the marks left on those messages",
  dm_blocks: "who you blocked and why — erasing it would silently reopen a door you closed",
  dm_settings: "your door and your activity signals — both DEFAULT TO OPEN, so erasing the row is not neutral: it silently reopens what you closed",
});

// Still absent, and still with a reason.
export const DM_EXPORT_STATUS = Object.freeze({
  dm_typing: "presence with a six-second expiry — it says nothing about what was said, and it is gone before an export could read it",
});

// WHAT WAS WRONG (Aug 8, found by the codebase audit — in code shipped hours
// earlier). These were ASPIRATIONAL numbers, not achievable ones. Most of the
// readers below clamp their own `limit` internally, so asking for 5000
// interactions returned 500, and `bounded()` then stamped the short list with
// the REQUESTED cap and `truncated: false`.
//
//   requested   actually returned   reported
//   5000        500  (getInteractions Math.min(500,…))     cap 5000, truncated false
//   5000        1000 (listEvents Math.min(1000,…))         cap 5000, truncated false
//   200         100  (listStylistOutfits boundedLimit …100) cap 200,  truncated false
//
// A user with 3,000 interactions downloaded 500 of them under a header saying
// nothing had been cut. That is precisely the §6 "no silent caps" rule the
// export exists to satisfy — the honesty feature was the thing lying.
//
// Every value here is now the reader's REAL ceiling, verified against its
// clamp, so `truncated` means what it says. One cap per READER, not per
// display group: the three stylist readers have three different ceilings and
// sharing one number is how the outfits case slipped through.
const EXPORT_CAPS = Object.freeze({
  records: 500,             // listUserRecords      boundedLimit(…, 500, 1000)
  interactions: 500,        // getInteractions      Math.min(500, …)
  events: 1000,             // listEvents           Math.min(1000, …)
  searches: 1000,           // direct SQL below, no internal clamp
  wardrobe: 500,            // listWardrobeItems    boundedLimit(…, 200, 500)
  moodboardUploads: 200,    // listMoodBoardUploads boundedLimit(…, 60, 200)
  moodboardAnalyses: 200,   // listMoodBoardAnalyses boundedLimit(…, 60, 200)
  stylistOutfits: 100,      // listStylistOutfits   boundedLimit(…, 30, 100)
  stylistFeedback: 500,     // listStylistFeedback  boundedLimit(…, 100, 500)
  stylistRequests: 200,     // direct SQL below, no internal clamp
  corrections: 500,         // listUserCorrections  boundedLimit(…, 200, 500)
  editorial: 200,           // direct SQL below, no internal clamp
  aiEvents: 500,            // direct SQL below, no internal clamp
  // The mail desk. Conversations and blocks are small; messages are the only
  // list here that a heavy user can genuinely fill, so it gets the largest cap
  // in the export — and, like every other one, it reports when it hits it.
  dmConversations: 500,
  dmMessages: 5000,
  dmBlocks: 500,
});

const bounded = (rows, cap) => ({
  rows, cap, truncated: Array.isArray(rows) && rows.length >= cap,
});

export async function exportPersonalizationData(userId, { queryTarget = null } = {}) {
  if (!userId) throw new TypeError("userId required");
  const accountId = /^sb-[0-9a-f-]{36}$/i.test(userId) ? userId.slice(3).toLowerCase() : null;
  const p = queryTarget || await getPool();

  const [
    taste, boards, interactions, events, follows, measurements, wardrobe,
    uploads, analyses, outfits, stylistFb, corrections, memoryPrefs, railPrefs,
    styleProfile, records,
  ] = await Promise.all([
    getProfile(userId),
    getBoards(userId),
    getInteractions(userId, { limit: EXPORT_CAPS.interactions }),
    listEvents(userId, EXPORT_CAPS.events),
    listFollows(userId),
    getUserMeasurements(userId),
    listWardrobeItems(userId, { status: "all", limit: EXPORT_CAPS.wardrobe }).catch(() => []),
    listMoodBoardUploads(userId, EXPORT_CAPS.moodboardUploads).catch(() => []),
    listMoodBoardAnalyses(userId, EXPORT_CAPS.moodboardAnalyses).catch(() => []),
    listStylistOutfits(userId, EXPORT_CAPS.stylistOutfits).catch(() => []),
    listStylistFeedback(userId, EXPORT_CAPS.stylistFeedback).catch(() => []),
    listUserCorrections(userId, EXPORT_CAPS.corrections).catch(() => []),
    getMemoryPreferences(userId).catch(() => null),
    getRailPrefs(userId).catch(() => ({})),
    getUserStyleProfileRow(userId).catch(() => null),
    listUserRecords(userId, { limit: EXPORT_CAPS.records }).catch(() => []),
  ]);

  const data = {
    taste,
    boards,
    interactions: bounded(interactions, EXPORT_CAPS.interactions),
    events: bounded(events, EXPORT_CAPS.events),
    follows,
    measurements,
    wardrobe: bounded(wardrobe, EXPORT_CAPS.wardrobe),
    moodboard: {
      uploads: bounded(uploads, EXPORT_CAPS.moodboardUploads),
      analyses: bounded(analyses, EXPORT_CAPS.moodboardAnalyses),
    },
    stylist: {
      outfits: bounded(outfits, EXPORT_CAPS.stylistOutfits),
      feedback: bounded(stylistFb, EXPORT_CAPS.stylistFeedback),
      requests: bounded([], EXPORT_CAPS.stylistRequests),
    },
    corrections: bounded(corrections, EXPORT_CAPS.corrections),
    interpretationFeedback: [],
    preferences: { memory: memoryPrefs, rails: railPrefs },
    records: bounded(records, EXPORT_CAPS.records),
    styleProfile,
    aiEvents: bounded([], EXPORT_CAPS.aiEvents),
    editorial: bounded([], EXPORT_CAPS.editorial),
    profileRoom: null,
    // The other half of the profileRoom domain the manifest has always
    // declared — see the read below.
    profileAccount: null,
    // v68 (slice 10b): the home town and the consented ethnicity — the
    // person's own words — and their appeals; the adopted devices as a count
    identity: null, devices: 0, connections: 0,
    // The mail desk (owner ruling: two people should have records). Filled in
    // below — `store` says which of the three answers this is, because "no
    // messages" and "the store could not be read" are different facts and the
    // desk itself already refuses to conflate them.
    messages: { store: "none", conversations: bounded([], EXPORT_CAPS.dmConversations),
      items: bounded([], EXPORT_CAPS.dmMessages), blocks: bounded([], EXPORT_CAPS.dmBlocks),
      settings: null },
  };

  const counts = { corroboration: { edges: 0, popularity: 0, researchVotes: 0 },
    internal: { operations: 0, adoptions: 0 } };

  if (!p) {
    // MEM MODE HAS NO MESSAGING AT ALL — lib/db/dm.js refuses rather than
    // mirroring the laws in JS, which is the whole reason that module exists.
    // Reporting an empty inbox here would be the exact mem-vs-Postgres lie it
    // was built to prevent, so the export says the store is unavailable.
    data.messages.store = "unavailable";
    const hash = identityHash(userId);
    data.searches = bounded(
      mem.searchLogs.filter((r) => r.userId === userId).slice(-EXPORT_CAPS.searches).reverse(),
      EXPORT_CAPS.searches);
    data.stylist.requests = bounded(
      mem.stylistRequests.filter((r) => r.userId === userId).slice(-EXPORT_CAPS.stylistRequests).reverse(),
      EXPORT_CAPS.stylistRequests);
    data.aiEvents = bounded(
      mem.aiEvents.filter((r) => r.userId === userId).slice(-EXPORT_CAPS.aiEvents).reverse(),
      EXPORT_CAPS.aiEvents);
    data.editorial = bounded(
      mem.posts.filter((r) => r.authorId === userId).slice(-EXPORT_CAPS.editorial).reverse(),
      EXPORT_CAPS.editorial);
    data.interpretationFeedback = mem.interpretationFeedback.filter((r) => r.user_id === userId);
    data.profileRoom = accountId ? (mem.profileRooms.get(accountId) || null) : null;
    {
      const I = await import("./identity.js");
      data.identity = accountId ? await I.getIdentity(accountId) : null;
      data.devices = accountId ? (await I.listDevices(accountId)).length : 0;
      data.connections = (await import("../../connectors/tokens.js")).listConnections(userId).then((rows) => rows.length).catch(() => 0);
      data.connections = await data.connections;
    }
    // The edge/popularity ledgers live in index.js's `mem`, not this module's.
    const ledgers = countMemLedgers(userId);
    counts.corroboration.edges = ledgers.edges;
    counts.corroboration.popularity = ledgers.popularity;
    for (const key of mem.unknownVotes) if (key.endsWith("|" + hash)) counts.corroboration.researchVotes++;
    counts.internal.operations = countMemOperations(userId);
    counts.internal.adoptions = 0; // mem keeps no durable adoption ledger
  } else {
    const hash = identityHash(userId);
    const q = (sql, params) => p.query(sql, params);
    const [searches, requests, aiEvents, editorial, interp, room, account, corro, internal] = await Promise.all([
      q(`SELECT query, created_at FROM search_logs WHERE user_id=$1
         ORDER BY created_at DESC LIMIT $2`, [userId, EXPORT_CAPS.searches]),
      q(`SELECT id, created_at FROM stylist_requests WHERE user_id=$1
         ORDER BY created_at DESC LIMIT $2`, [userId, EXPORT_CAPS.stylistRequests]),
      q(`SELECT id, created_at FROM ai_model_events WHERE user_id=$1
         ORDER BY created_at DESC LIMIT $2`, [userId, EXPORT_CAPS.aiEvents]),
      q(`SELECT id, created_at FROM editorial_posts WHERE author_id=$1
         ORDER BY created_at DESC LIMIT $2`, [userId, EXPORT_CAPS.editorial]),
      q(`SELECT normalized_query, interpretation_id, verdict, created_at
         FROM interpretation_feedback WHERE user_id=$1`, [userId]),
      accountId
        ? q("SELECT * FROM profile_rooms WHERE account_id=$1::uuid", [accountId])
        : Promise.resolve({ rows: [] }),
      // DECLARED IN THE MANIFEST SINCE THE MANIFEST EXISTED, AND NEVER READ.
      // `user_profiles` maps to the profileRoom domain and only profile_rooms
      // was ever selected — so the export claimed a table it did not deliver,
      // and E1/E2 could not see it: both diff purge's DELETE list against the
      // manifest, and neither compares the manifest against what the export
      // actually READS. Found while adding the mail desk to the same file.
      // It keys on `id`, not account_id (supabase/schema.sql:15-16) — which is
      // also how purge addresses it.
      accountId
        ? q("SELECT * FROM user_profiles WHERE id=$1::uuid", [accountId])
        : Promise.resolve({ rows: [] }),
      q(`SELECT
           (SELECT count(*) FROM edge_contributors WHERE identity_hash=$1)::int AS edges,
           (SELECT count(*) FROM popularity_contributors WHERE identity_hash=$1)::int AS popularity,
           (SELECT count(*) FROM unknown_query_votes WHERE identity_hash=$1)::int AS votes`,
        [hash]),
      q(`SELECT
           (SELECT count(*) FROM processed_operations WHERE user_id=$1)::int AS operations,
           (SELECT count(*) FROM identity_adoptions WHERE to_user_id=$1)::int AS adoptions`,
        [userId]),
    ]);
    data.searches = bounded(searches.rows, EXPORT_CAPS.searches);
    data.stylist.requests = bounded(requests.rows, EXPORT_CAPS.stylistRequests);
    data.aiEvents = bounded(aiEvents.rows, EXPORT_CAPS.aiEvents);
    data.editorial = bounded(editorial.rows, EXPORT_CAPS.editorial);
    data.interpretationFeedback = interp.rows;
    // Both halves of the profileRoom domain, which is what the manifest has
    // always claimed: the room is the published page, the account row is the
    // handle and display name behind it.
    data.profileRoom = room.rows[0] || null;
    data.profileAccount = account.rows[0] || null;
    try {
      const I = await import("./identity.js");
      data.identity = accountId ? await I.getIdentity(accountId) : null;
      data.devices = accountId ? (await I.listDevices(accountId)).length : 0;
      data.connections = await (await import("../../connectors/tokens.js")).listConnections(userId).then((rows) => rows.length).catch(() => 0);
    } catch { /* v68 not applied: the domain stays empty, never a failed export */ }
    counts.corroboration = {
      edges: corro.rows[0].edges, popularity: corro.rows[0].popularity,
      researchVotes: corro.rows[0].votes,
    };
    counts.internal = {
      operations: internal.rows[0].operations, adoptions: internal.rows[0].adoptions,
    };

    // THE MAIL DESK. Only an ACCOUNT can hold a conversation — the DM tables
    // key on the bare auth uuid (ADR-002) and a device identity can never own
    // one, so a device export says "none" rather than reporting a failure it
    // did not have.
    if (accountId) {
      try {
        const { exportMessagesFor } = await import("../dm.js");
        // NOT gated on messagingEnabled(). An access right is not a feature:
        // the flag decides whether the desk is open, not whether a person may
        // have the record of what was already said there. Stated because it is
        // the kind of omission that reads as an oversight.
        const desk = await exportMessagesFor(accountId, {
          conversations: EXPORT_CAPS.dmConversations,
          messages: EXPORT_CAPS.dmMessages,
          blocks: EXPORT_CAPS.dmBlocks,
        }, { queryTarget });
        // `bounded()` computes truncation as `rows.length >= cap`, which is
        // right for a list fed by ONE cap. The mail desk has two: conversations
        // are limited first, and messages are read only for the survivors — so
        // an account past the conversation cap loses whole conversations' worth
        // of messages while the message list sits far below its own cap, and
        // `rows.length >= cap` reported `false`. The store now says WHICH cap
        // bit, and that answer is used instead of re-deriving it here.
        const cut = desk.truncated;
        data.messages = {
          store: "read",
          conversations: { ...bounded(desk.conversations, EXPORT_CAPS.dmConversations),
            truncated: cut.conversations },
          items: { ...bounded(desk.messages, EXPORT_CAPS.dmMessages),
            truncated: cut.messages },
          blocks: { ...bounded(desk.blocks, EXPORT_CAPS.dmBlocks), truncated: cut.blocks },
          settings: desk.settings,
          // Which end of the history a truncation took, not merely that one
          // happened — the cap is global and newest-first.
          oldestExportedMessageId: desk.oldestExportedMessageId,
        };
      } catch {
        // A read that FAILS must not render as empty. That rule is already
        // written on the mail desk itself ("A read that FAILS shows a fault
        // marker, never 0"), and an export is the one place a false empty
        // would read as "you have no messages" to somebody exercising an
        // access right.
        data.messages.store = "unreadable";
      }
    }
  }

  return {
    manifestVersion: 1,
    generatedAt: Date.now(),
    identity: { id: userId, kind: accountId ? "account" : "device" },
    persistent: !!p,
    data,
    counts,
    // Named, not silently absent — the same vocabulary purge returns, so the
    // two controls describe the same world.
    retained: RETAINED_AFTER_ERASURE,
    countedNotDetailed: {
      corroboration: "pseudonymous graph contributions — the content is an item pair or item id shared with other people, so your own fact is how many you corroborated",
      internal: "replay-idempotency keys and the record of which device identities merged into this one — system records, not signals about you",
    },
  };
}

// ---- erasure (the other half of the same promise) ---------------------------
//
// EXPORT AND ERASURE ARE ONE FEATURE AND NOW ONE FILE. The manifest above says
// "what we delete is what we show you"; tests/privacy-export.test.js enforces
// that as a subset relation. Keeping the two functions apart is what let them
// drift once already — a table added to erasure and forgotten in the export
// silently narrows the access right, and reading one file no longer tells you
// whether that happened.

// Delete user-linked personalization records while retaining purchase tickets
// and consent records.
//
// (Aug 6) This comment used to say that aggregate popularity and edge weights
// "are deidentified and cannot be reliably subtracted, so they remain". That
// stopped being true when the corroboration ledgers landed: edge_contributors
// (v22) and popularity_contributors (v23) are per-identity rows, so this
// function now erases them AND recomputes the affected aggregates. A privacy
// statement that outlives the code it describes is worse than the gap it
// described. What genuinely remains deidentified is the raw eng/imp event
// counters, which carry no identity column and are diagnostic only.
export async function purgePersonalizationData(userId, { queryTarget = null } = {}) {
  if (!userId) throw new TypeError("userId required");
  const p = queryTarget || await getPool();
  if (!p) {
    purgeMemoryUserData(userId);
    mem.corrections = mem.corrections.filter((row) => row.userId !== userId);
    mem.searchLogs = mem.searchLogs.filter((row) => row.userId !== userId);
    mem.posts = mem.posts.filter((row) => row.authorId !== userId);
    mem.uploads = mem.uploads.filter((row) => row.userId !== userId);
    mem.outfits = mem.outfits.filter((row) => row.userId !== userId);
    mem.analyses = mem.analyses.filter((row) => row.userId !== userId);
    mem.styleProfiles.delete(userId);
    mem.stylistRequests = mem.stylistRequests.filter((row) => row.userId !== userId);
    mem.stylistFeedback = mem.stylistFeedback.filter((row) => row.userId !== userId);
    mem.aiEvents = mem.aiEvents.filter((row) => row.userId !== userId);
    mem.measurements.delete(userId);
    mem.interpretationFeedback = mem.interpretationFeedback.filter((row) => row.user_id !== userId);
    mem.memoryPreferences.delete(userId);
    mem.follows = mem.follows.filter((row) => row.userId !== userId);
    mem.wardrobe = mem.wardrobe.filter((row) => row.user_id !== userId);
    // Wire engagement (v28) is identity_hash-keyed like the ledgers below;
    // erasure means this person stops counting on every transmission.
    {
      const goneHash = identityHash(userId);
      for (const key of [...mem.engagements]) {
        if (key.split("|")[1] === goneHash) mem.engagements.delete(key);
      }
    }
    // Mirrors the Postgres branch: erase this identity's research votes and
    // take them back out of the demand tallies.
    {
      const voterHash = identityHash(userId);
      for (const voteKey of [...mem.unknownVotes]) {
        const split = voteKey.lastIndexOf("|");
        if (voteKey.slice(split + 1) !== voterHash) continue;
        mem.unknownVotes.delete(voteKey);
        const queryId = voteKey.slice(0, split);
        for (const row of mem.unknownQueries.values()) {
          if (String(row.id) !== queryId) continue;
          row.demand_count = Math.max(0, row.demand_count - 1);
          row.distinct_identities = Math.max(0, row.distinct_identities - 1);
        }
      }
    }
    for (const key of mem.railPrefs.keys()) if (key.startsWith(userId + "|")) mem.railPrefs.delete(key);
    for (const key of [...mem.records.keys()]) if (key.startsWith(userId + "|")) mem.records.delete(key);
    await (await import("../../connectors/tokens.js")).removeConnection(userId).catch(() => null); // v72: the sealed music tokens
    // slice 10b: deletion resets the Passenger Score (6.31) and erases the
    // identity rows (home town, ethnicity, adopted devices); appeals stay as
    // the listing's record
    {
      const I = await import("./identity.js");
      await I.resetScoreOnDeletion(userId);
      if (/^sb-[0-9a-f-]{36}$/i.test(userId)) await I.eraseIdentity(userId.slice(3));
    }
    // Profile rooms key on the auth uuid (ADR-002) — erase them when the
    // purged identity is the account's sb- form.
    if (/^sb-[0-9a-f-]{36}$/i.test(userId)) {
      const accountId = userId.slice(3).toLowerCase();
      mem.profileRooms.delete(accountId);
      for (const key of mem.profileModules.keys()) if (key.startsWith(accountId + "|")) mem.profileModules.delete(key);
    }
    // The SAME disclosure the Postgres branch returns. It used to read
    // "deidentified aggregate item statistics", which stopped being accurate
    // on Aug 6 when the corroboration ledgers made the aggregates recomputable
    // — the Postgres wording was corrected then and this one was not, so mem
    // (what preview deploys and local dev run on) named a broader retention to
    // the user than actually happens. /api/privacy returns this array
    // verbatim, so the two backends were telling people different things.
    return { persistent: false, retained: RETAINED_AFTER_ERASURE };
  }
  const ownsClient = !queryTarget;
  const client = queryTarget || await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM mood_board_analysis WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM mood_board_uploads WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM stylist_feedback WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM stylist_outfits WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM stylist_requests WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_style_profiles WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM ai_model_events WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_corrections WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM editorial_posts WHERE author_id=$1", [userId]);
    // Wire engagement (v28): this person's likes/saves on OTHER people's
    // transmissions. (Engagements ON their own posts leave with those posts,
    // via ON DELETE CASCADE from the line above.) Counts are computed on
    // read, so there is no aggregate to recompute — the ledger IS the count.
    await client.query("DELETE FROM transmission_engagements WHERE identity_hash=$1", [identityHash(userId)]);
    await client.query("DELETE FROM search_logs WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM board_items WHERE board_id IN (SELECT id FROM boards WHERE user_id=$1)", [userId]);
    await client.query("DELETE FROM boards WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM interactions WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_events WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM processed_operations WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM identity_adoptions WHERE from_user_id=$1 OR to_user_id=$1", [userId]);
    await client.query("DELETE FROM user_measurements WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM interpretation_feedback WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM asterisk_memory_preferences WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_follows WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM wardrobe_items WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_rail_prefs WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_records WHERE user_id=$1", [userId]);
    // v72 (the music seams): the sealed tokens, guarded on the relation
    if ((await client.query("SELECT to_regclass('public.connector_tokens') AS r")).rows[0]?.r) await client.query("DELETE FROM connector_tokens WHERE user_id=$1", [userId]);
    // slice 10b (v68): the score reset and the identity rows — guarded on the relation so an
    // unapplied v65/v68 never fails the whole erasure
    {
      const I = await import("./identity.js");
      await I.resetScoreOnDeletion(userId, client);
      if (/^sb-[0-9a-f-]{36}$/i.test(userId)) {
        const acct = userId.slice(3).toLowerCase();
        const has = (await client.query("SELECT to_regclass('public.account_identity') AS r")).rows[0]?.r;
        if (has) { await client.query("DELETE FROM account_identity WHERE account_id=$1", [acct]); await client.query("DELETE FROM account_devices WHERE account_id=$1", [acct]); }
      }
    }
    await client.query("DELETE FROM profiles WHERE user_id=$1", [userId]);
    // The contributor ledger is the first identity-linked row in the gamma
    // graph, so erasure reaches it now. Deleting a contributor MUST recompute
    // the pair — otherwise a departed person keeps corroborating an edge and
    // its influence never falls back to what the remaining people actually
    // support. Pairs left with no contributors keep w=0/contributors=0 and
    // therefore score zero; the row itself is deidentified aggregate state.
    // popularity ledger: drop this identity's rows, then recompute the people
    // counts for every item they touched — a departed person must stop
    // counting as an engager or a viewer.
    const popGone = await client.query(
      "DELETE FROM popularity_contributors WHERE identity_hash=$1 RETURNING item_id", [identityHash(userId)]);
    if (popGone.rowCount) {
      // (r25) The DECAYED sums must be recomputed here too. Erasure that
      // updated only the lifetime counts would leave a departed person's
      // recency-weighted contribution scoring forever — the aggregate is
      // deidentified, but it would still be THEIR evidence, and "they stop
      // counting" has to mean every counter they are in.
      const decayCols = await hasDecayColumns(client).catch(() => false);
      await client.query(
        decayCols
          ? `WITH touched AS (
               SELECT DISTINCT id FROM jsonb_to_recordset($1::jsonb) AS x(id text)
             ), agg AS (
               SELECT t.id,
                      count(*) FILTER (WHERE c.engaged)::int AS engagers,
                      count(*) FILTER (WHERE c.viewed)::int AS viewers,
                      COALESCE(sum(power(0.5, extract(epoch FROM (now() - c.first_seen)) / $2::float8))
                               FILTER (WHERE c.engaged), 0) AS engagers_decayed,
                      COALESCE(sum(power(0.5, extract(epoch FROM (now() - c.first_seen)) / $2::float8))
                               FILTER (WHERE c.viewed), 0) AS viewers_decayed
               FROM touched t LEFT JOIN popularity_contributors c ON c.item_id = t.id
               GROUP BY t.id
             )
             UPDATE popularity p SET engagers = agg.engagers, viewers = agg.viewers,
               engagers_decayed = agg.engagers_decayed,
               viewers_decayed = agg.viewers_decayed,
               decayed_at = now()
             FROM agg WHERE p.item_id = agg.id`
          : `WITH touched AS (
               SELECT DISTINCT id FROM jsonb_to_recordset($1::jsonb) AS x(id text)
             ), agg AS (
               SELECT t.id,
                      count(*) FILTER (WHERE c.engaged)::int AS engagers,
                      count(*) FILTER (WHERE c.viewed)::int AS viewers
               FROM touched t LEFT JOIN popularity_contributors c ON c.item_id = t.id
               GROUP BY t.id
             )
             UPDATE popularity p SET engagers = agg.engagers, viewers = agg.viewers
             FROM agg WHERE p.item_id = agg.id`,
        decayCols
          ? [JSON.stringify(popGone.rows.map((r) => ({ id: r.item_id }))), halfLifeMs() / 1000]
          : [JSON.stringify(popGone.rows.map((r) => ({ id: r.item_id })))]
      );
    }
    const gone = await client.query(
      "DELETE FROM edge_contributors WHERE identity_hash=$1 RETURNING a,b", [identityHash(userId)]);
    if (gone.rowCount) {
      await client.query(
        `WITH touched AS (
           SELECT DISTINCT a,b FROM jsonb_to_recordset($1::jsonb) AS x(a text,b text)
         ), agg AS (
           SELECT t.a, t.b,
                  COALESCE(sum(c.w),0)::real AS w,
                  count(c.identity_hash)::int AS contributors
           FROM touched t LEFT JOIN edge_contributors c ON c.a=t.a AND c.b=t.b
           GROUP BY t.a, t.b
         )
         UPDATE edges e SET w = agg.w, contributors = agg.contributors
         FROM agg WHERE e.a = agg.a AND e.b = agg.b`,
        [JSON.stringify(gone.rows.map((r) => ({ a: r.a, b: r.b })))]
      );
    }
    // (Aug 7, Round A) unknown_query_votes was NEVER erased — while the v22
    // header cites it as the PRECEDENT for hashing identity precisely because
    // it "is still pseudonymous personal data, so account deletion erases it".
    // The precedent did not do the thing it was cited for. Same shape as the
    // ledgers above: drop the rows, then take the votes back out of the
    // tallies that decide whether a query is promoted into research.
    const votesGone = await client.query(
      "DELETE FROM unknown_query_votes WHERE identity_hash=$1 RETURNING query_id",
      [identityHash(userId)]);
    if (votesGone.rowCount) {
      await client.query(
        `UPDATE unknown_queries q
         SET demand_count = GREATEST(0, q.demand_count - d.n),
             distinct_identities = GREATEST(0, q.distinct_identities - d.n)
         FROM (SELECT id, count(*)::int AS n
               FROM jsonb_to_recordset($1::jsonb) AS x(id bigint)
               GROUP BY id) d
         WHERE q.id = d.id`,
        [JSON.stringify(votesGone.rows.map((r) => ({ id: Number(r.query_id) })))]
      );
    }
    // The app namespaces authenticated identities as `sb-<auth uuid>` in its
    // server-owned tables. The original MVP profile uses the raw auth UUID and
    // cascades to legacy saved_items, so remove that row explicitly as well.
    if (/^sb-[0-9a-f-]{36}$/i.test(userId)) {
      await client.query("DELETE FROM user_profiles WHERE id=$1::uuid", [userId.slice(3)]);
      // v17 profile rooms key on the auth uuid (ADR-002): statement/anthem
      // are personal content — modules cascade from the room row.
      await client.query("DELETE FROM profile_rooms WHERE account_id=$1::uuid", [userId.slice(3)]);
    }
    await client.query("COMMIT");
    return { persistent: true, retained: RETAINED_AFTER_ERASURE };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}
