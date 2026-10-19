// tests/perf-read-paths.test.js — the performance family from
// docs/history/audit-verified-2026-08-14.md: findings #11, #14, #15, #17, #20.
//
// None of these is a correctness defect, so the bar for every one of them is
// that the ANSWER does not move. Where the fix is a cache, the test proves the
// cache is real by identity rather than by timing — a warm read returns the
// very same array, which a fresh database read cannot do. Where the fix only
// removes wasted work and leaves output untouched, no functional test can
// catch a regression, so the guard is structural and says so.
//
// Wall-clock numbers live in the PR body and were measured against live
// Postgres. Timing assertions are deliberately absent: they are the flakiest
// thing you can put in CI.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getEmbeddingSnapshot, invalidateEmbeddingSnapshots, listEmbeddings, saveEmbeddings,
  getStats, getStatsSnapshot, recordInteraction, saveProfile, recordEvent, upsertItems,
  getTasteVectorSnapshot, invalidateTasteVectorSnapshots, listTasteVectors,
} from "../lib/db/index.js";
import { searchProducts } from "../lib/search/index.js";
import { TEXT_SPACE } from "../lib/embeddings/index.js";
import { buildSlate } from "../lib/brain/stylist.js";
import { crossUserCandidates, similarUsers, CROSS_USER_NEIGHBORS } from "../lib/taste-graph/index.js";
import { CATALOG } from "../lib/ingest/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Everything from a declaration to the next top-level one. Naive "up to the
// first \n}" cuts at a multi-line destructured PARAMETER, which silently
// truncates the body to nothing and makes an absence assertion pass for the
// wrong reason — my first draft of T4 did exactly that.
function declarationBody(code, declaration) {
  const start = code.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} not found — the test is stale`);
  const rest = code.slice(start + declaration.length);
  const end = rest.search(/\n(?:export |function |const |class )/);
  const body = end === -1 ? rest : rest.slice(0, end);
  assert.ok(body.length > 100, `${declaration} body looks truncated (${body.length} chars)`);
  return body;
}

// ---- #11: the embedding snapshot -------------------------------------------
// Measured against live: 915 rows x 1024 dims of JSONB is ~1.9s per call, and
// it was paid on the blocking path of EVERY keyed search.

const SPACE = "test-space-v1";

// A product vector is read through the items table (optimize round, 20 Sep
// 2026), so the products these vectors belong to must exist first.
test("E0 the products the test vectors belong to exist", async () => {
  await upsertItems([
    { id: "e-a", title: "vector a", price: 1 },
    { id: "e-b", title: "vector b", price: 1 },
    { id: "e-c", title: "vector c", price: 1 },
  ]);
});

test("E1 a warm snapshot is the SAME array — it did not go back to the database", async () => {
  invalidateEmbeddingSnapshots();
  await saveEmbeddings([
    { ownerId: "e-a", space: SPACE, vector: [1, 0, 0] },
    { ownerId: "e-b", space: SPACE, vector: [0, 1, 0] },
  ]);
  const first = await getEmbeddingSnapshot(SPACE);
  const second = await getEmbeddingSnapshot(SPACE);
  assert.equal(first, second, "identical reference — a cache hit, not a re-read");
  assert.equal(first.length, 2);

  const raw = await listEmbeddings(SPACE);
  assert.notEqual(raw, first, "the raw read really does build a fresh array each time");
  assert.deepEqual(raw.map((r) => r.owner_id).sort(), first.map((r) => r.owner_id).sort(),
    "and the snapshot's CONTENT is what the raw read would have given");
});

test("E2 concurrent cold callers share one read", async () => {
  // This is half the win: without it, every search arriving inside that ~1.9s
  // window starts its own copy and holds its own connection.
  invalidateEmbeddingSnapshots();
  const all = await Promise.all(Array.from({ length: 5 }, () => getEmbeddingSnapshot(SPACE)));
  assert.ok(all.every((rows) => rows === all[0]),
    "five simultaneous callers, one array between them");
});

test("E3 writing an embedding drops the snapshot at once", async () => {
  invalidateEmbeddingSnapshots();
  const before = await getEmbeddingSnapshot(SPACE);
  await saveEmbeddings([{ ownerId: "e-c", space: SPACE, vector: [0, 0, 1] }]);
  const after = await getEmbeddingSnapshot(SPACE);
  assert.notEqual(after, before, "a re-embed must be visible on the next search, not a TTL later");
  assert.ok(after.some((row) => row.owner_id === "e-c"));
});

test("E4 a write of nothing invalidates nothing", async () => {
  const before = await getEmbeddingSnapshot(SPACE);
  await saveEmbeddings([]);
  await saveEmbeddings([{ ownerId: "", space: SPACE, vector: [1] }]); // rejected by the filter
  assert.equal(await getEmbeddingSnapshot(SPACE), before,
    "a no-op write must not throw away a 1.9-second read");
});

test("E5 spaces are cached separately", async () => {
  const mine = await getEmbeddingSnapshot(SPACE);
  const other = await getEmbeddingSnapshot("test-space-other");
  assert.notEqual(mine, other);
  assert.equal(other.length, 0, "an unknown space is empty, not a leak from another");
});

test("E6 search reads the snapshot, not the raw table", () => {
  const code = read("lib/search/index.js");
  assert.ok(code.includes("getEmbeddingSnapshot("),
    "the search path must go through the cache");
  assert.ok(!/\blistEmbeddings\s*\(/.test(code),
    "and must not reach past it to the uncached read");
});

// ---- #17: the stylist's duplicated fit math --------------------------------

const FIT = { usualSize: "M", measurements: { chest: 40, waist: 33, hips: 39, inseam: 31 } };
const TASTE = { MINIMAL: 0.8, TAILORED: 0.6, ARCHIVAL: 0.3 };

test("S1 winners still carry their fit phrase", async () => {
  // The fix moves fitPhrase out of the candidate loop and onto the winner. If
  // it moved somewhere the winner never reaches, the notes silently vanish —
  // which is the one way this optimisation could break a user-visible thing.
  const looks = buildSlate(CATALOG, TASTE, 25, { fitProfile: FIT, events: 120 });
  assert.ok(looks.length > 0, "an empty slate would pass vacuously");
  const notes = looks.flatMap((look) => look.fitNotes);
  assert.ok(notes.length > 0, "a slate built with a fit profile must produce fit notes");
  assert.ok(notes.every((note) => typeof note === "string" && note.length > 0));
});

test("S2 no fit profile still means no fit notes", async () => {
  const looks = buildSlate(CATALOG, TASTE, 10, { events: 0 });
  assert.deepEqual(looks.flatMap((look) => look.fitNotes), [],
    "nothing to say about fit when the user has told us nothing");
});

test("S3 the slate is deterministic for identical input", () => {
  const a = buildSlate(CATALOG, TASTE, 25, { fitProfile: FIT, events: 120 });
  const b = buildSlate(CATALOG, TASTE, 25, { fitProfile: FIT, events: 120 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("S4 candidateScore does not price a phrase it will throw away", () => {
  // Output is byte-identical before and after this fix, so nothing functional
  // can catch a regression — the guard has to be structural. fitPhrase runs a
  // whole second fitAssessment; it belongs to the winner, not the loop.
  const code = read("lib/brain/stylist.js");
  const body = declarationBody(code, "function candidateScore");
  assert.ok(!body.includes("fitPhrase("),
    "fitPhrase inside candidateScore doubles the fit math for every candidate");
  assert.ok(body.includes("fitScore("), "the SCORE is still what ranks a candidate");
  assert.ok(code.includes("fitPhrase("), "and the phrase is still computed somewhere");
});

// ---- #14 / #15: the taste graph --------------------------------------------

const ME = "u-perf-me";

async function seedNeighbourhood() {
  const TYPES = ["USER_ADDED_TO_BAG", "USER_SAVED_ITEM", "USER_FAVORITED_ITEM", "USER_VIEWED_PRODUCT"];
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  await saveProfile(ME, { long: { MINIMAL: 0.8, TAILORED: 0.5 } });
  for (let u = 0; u < 12; u++) {
    const uid = `u-perf-n${u}`;
    await saveProfile(uid, { long: { MINIMAL: +rnd().toFixed(3), TAILORED: +rnd().toFixed(3) } });
    for (let e = 0; e < 20; e++) {
      await recordEvent({
        userId: uid, type: TYPES[Math.floor(rnd() * TYPES.length)],
        payload: { itemId: `perf-item-${Math.floor(rnd() * 30)}` },
      });
    }
  }
}

test("T1 handing over a neighbour list gives exactly the answer the scan gave", async () => {
  await seedNeighbourhood();
  const own = await crossUserCandidates(ME, 24);
  const shared = await similarUsers(ME, Math.max(10, CROSS_USER_NEIGHBORS));
  const passed = await crossUserCandidates(ME, 24, { neighbors: shared.data.neighbors });
  assert.ok(own.data.candidates.length > 0, "an empty candidate set would pass vacuously");
  assert.deepEqual(passed.data, own.data,
    "/api/similar may share its scan only if sharing changes nothing");
});

test("T2 a LONGER neighbour list cannot change the answer", async () => {
  // The route asks for max(limit, CROSS_USER_NEIGHBORS) neighbours for its own
  // response. If crossUserCandidates scored all of them, the shared scan would
  // quietly widen the algorithm — so it slices back to what it always used.
  const own = await crossUserCandidates(ME, 24);
  const wide = await similarUsers(ME, 48);
  const passed = await crossUserCandidates(ME, 24, { neighbors: wide.data.neighbors });
  assert.deepEqual(passed.data, own.data);
  assert.ok(wide.data.neighbors.length > CROSS_USER_NEIGHBORS,
    "the fixture must actually offer more neighbours than are load-bearing");
});

test("T3 an empty neighbourhood is still answered honestly", async () => {
  const result = await crossUserCandidates("u-perf-nobody", 24, { neighbors: [] });
  assert.deepEqual(result.data.candidates, []);
  assert.match(result.data.note, /no taste neighbors/);
});

test("T4 neighbour histories are read in one wave, not one at a time", () => {
  // Same situation as S4: parallelising the reads changes no output, so the
  // guard is structural. Five sequential round trips cost 176ms against live
  // where one wave costs 61ms.
  const code = read("lib/taste-graph/index.js");
  const body = declarationBody(code, "export async function crossUserCandidates");
  assert.ok(!/for\s*\([^)]*\)\s*\{[^}]*await\s+listEvents/.test(body),
    "awaiting listEvents inside a loop over neighbours is the serial fetch");
  assert.ok(body.includes("Promise.all("), "the reads must go out together");
});

test("T5 /api/similar scans profiles once, not twice", () => {
  const code = read("app/api/similar/route.js");
  // The bound matters: `[^)]*` cannot cross the call's own closing paren, so
  // this can only match a `neighbors:` INSIDE the crossUserCandidates call.
  // My first draft used [\s\S]*? and matched the unrelated `neighbors:` in the
  // response object 15 lines further down — it passed happily with the fix
  // reverted, which is the one thing a guard must never do.
  assert.match(code, /crossUserCandidates\([^)]*neighbors:/,
    "the route must hand its own neighbour scan to the candidate scorer");
  assert.ok(!/Promise\.all\(\[\s*\n?\s*similarUsers\(/.test(code),
    "and must not run the two scans simultaneously, which was the doubled peak memory");
});

// ---- #20: the stats snapshot -----------------------------------------------

test("G1 the snapshot answers what getStats answers", async () => {
  await recordInteraction("u-perf-stats", "perf-item-1", "favorite");
  const direct = await getStats();
  const snapshot = await getStatsSnapshot();
  for (const key of ["persistent", "interactions", "users", "boards", "edges"]) {
    assert.deepEqual(snapshot[key], direct[key], `${key} must match the uncached read`);
  }
});

test("G2 a warm snapshot does not re-run the aggregates", async () => {
  const first = await getStatsSnapshot();
  const before = first.interactions;
  await recordInteraction("u-perf-stats", "perf-item-2", "favorite");
  const second = await getStatsSnapshot();
  assert.equal(second.interactions, before,
    "inside the TTL the aggregates are not re-run — that is the whole point");
  assert.equal(second.topItems, first.topItems,
    "the cached arrays are shared, so nothing was recomputed");
});

test("G3 every caller gets its OWN object to decorate", async () => {
  // /api/stats assigns alphaEvents and a hydrated topItems onto the result. If
  // callers shared one instance, one request's decorations would show up in
  // the next request's response.
  const mine = await getStatsSnapshot();
  mine.alphaEvents = 12345;
  mine.topItems = ["decorated"];
  const theirs = await getStatsSnapshot();
  assert.equal(theirs.alphaEvents, undefined, "a decoration must not survive into another caller");
  assert.notDeepEqual(theirs.topItems, ["decorated"]);
});

test("G4 /api/stats uses the snapshot and batches its top-ten hydration", () => {
  const code = read("app/api/stats/route.js");
  assert.ok(code.includes("getStatsSnapshot("), "the route must use the cached read");
  assert.ok(code.includes("getItems("), "ten primary-key lookups are one batched read");
  assert.ok(!/\bgetItem\s*\(/.test(code), "the per-id fan-out must be gone");
});

// ---- the dead vectors (optimize round, 20 Sep 2026) --------------------------
// Production held 915 product vectors for a catalog that had been deleted and
// 0 for the 897 live listings: every keyed search loaded ~6 MB of JSONB, paid
// the provider for a query vector, and compared it against nothing.

test("E7 a product vector whose product is gone never enters the snapshot", async () => {
  invalidateEmbeddingSnapshots();
  await saveEmbeddings([
    { ownerId: "e-a", space: SPACE, vector: [1, 0, 0] },
    { ownerId: "e-ghost-of-the-seed", space: SPACE, vector: [0, 0, 1] },
  ]);
  const rows = await listEmbeddings(SPACE);
  const ids = rows.map((r) => r.owner_id);
  assert.ok(ids.includes("e-a"), "a vector whose product exists loads");
  assert.ok(!ids.includes("e-ghost-of-the-seed"), "a vector whose product is gone does not");
  const snap = await getEmbeddingSnapshot(SPACE);
  assert.ok(!snap.some((r) => r.owner_id === "e-ghost-of-the-seed"), "and the snapshot agrees with the raw read");
  // Other owner kinds are not products and are not judged by the items table.
  await saveEmbeddings([{ ownerId: "someone", ownerKind: "user", space: SPACE, vector: [1, 1, 0] }]);
  assert.equal((await listEmbeddings(SPACE, "user")).length, 1);
});

test("E8 a keyed search embeds the query ONLY when there is a live vector to compare it with", async () => {
  const saved = {
    p: process.env.EMBEDDINGS_PROVIDER, k: process.env.EMBEDDINGS_API_KEY, fetch: globalThis.fetch,
  };
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return { ok: false, status: 500, text: async () => "stubbed", json: async () => ({}) }; };
  process.env.EMBEDDINGS_PROVIDER = "voyage";
  process.env.EMBEDDINGS_API_KEY = "test-key";
  try {
    invalidateEmbeddingSnapshots();
    // Only a dead vector in the text space: nothing to compare against.
    await saveEmbeddings([{ ownerId: "e-nobody", space: TEXT_SPACE, vector: [1, 0, 0] }]);
    const empty = await searchProducts("black wool coat", { userId: null });
    assert.ok(Array.isArray(empty.results ?? empty), "search still answers");
    assert.equal(providerCalls, 0, "no live product vector → no paid call for a query vector");

    // One live vector: now the provider is worth asking.
    await saveEmbeddings([{ ownerId: "e-a", space: TEXT_SPACE, vector: [1, 0, 0] }]);
    await searchProducts("black wool coat", { userId: null });
    assert.equal(providerCalls, 1, "with something to compare against, the query is embedded");
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.p == null) delete process.env.EMBEDDINGS_PROVIDER; else process.env.EMBEDDINGS_PROVIDER = saved.p;
    if (saved.k == null) delete process.env.EMBEDDINGS_API_KEY; else process.env.EMBEDDINGS_API_KEY = saved.k;
    invalidateEmbeddingSnapshots();
  }
});

// ---- the neighbour scan snapshot (optimize round, 20 Sep 2026) ---------------
// similarUsers scanned every profile on every personalised feed request:
// 45 ms mean in production for ~400 rows. The scan is of OTHER people's
// slow-moving long-term vectors, so a per-instance snapshot with a 30 s TTL
// ranks the same neighbours — and it is deliberately not invalidated by
// profile writes, because the feed instance is also the writer.

test("T1 a warm taste snapshot is the SAME frozen array", async () => {
  invalidateTasteVectorSnapshots();
  await saveProfile("t-a", { long: { MINIMAL: 1 } });
  await saveProfile("t-b", { long: { MINIMAL: 0.9, DARK: 0.2 } });
  const first = await getTasteVectorSnapshot(500);
  const second = await getTasteVectorSnapshot(500);
  assert.equal(first, second, "identical reference — a cache hit, not a re-scan");
  assert.ok(Object.isFrozen(first), "shared, so frozen");
  assert.deepEqual(
    first.map((r) => r.userId).sort(),
    (await listTasteVectors(500)).map((r) => r.userId).sort(),
    "the snapshot's content is what the raw scan would have given",
  );
  const all = await Promise.all(Array.from({ length: 5 }, () => getTasteVectorSnapshot(500)));
  assert.ok(all.every((rows) => rows === all[0]), "five simultaneous callers, one array between them");
});

test("T2 a profile written after the snapshot waits for the TTL (or an explicit invalidation)", async () => {
  invalidateTasteVectorSnapshots();
  const before = await getTasteVectorSnapshot(500);
  await saveProfile("t-late", { long: { MINIMAL: 1 } });
  const during = await getTasteVectorSnapshot(500);
  assert.equal(during, before, "a write does not throw the scan away — the writer is the feed instance");
  assert.ok(!during.some((r) => r.userId === "t-late"));
  invalidateTasteVectorSnapshots();
  const after = await getTasteVectorSnapshot(500);
  assert.ok(after.some((r) => r.userId === "t-late"), "and is visible once the snapshot turns over");
});

test("T3 the reader's OWN vector is always fresh — only the neighbours are snapshotted", async () => {
  const { TAGS } = await import("../lib/brain/tags.js");
  const [DARK, MINIMAL] = TAGS; // two real tags of the shared space, whatever they are called
  invalidateTasteVectorSnapshots();
  await saveProfile("t-me", { long: { [DARK]: 1 } });
  await saveProfile("t-dark", { long: { [DARK]: 1 } });
  await saveProfile("t-min", { long: { [MINIMAL]: 1 } });
  const cold = await similarUsers("t-me", 5);
  assert.equal(cold.data.neighbors[0]?.uid, "t-dark");
  // The reader changes their mind inside the TTL: the neighbour ranking must
  // follow their new vector, because it is read through getProfile, not the snapshot.
  await saveProfile("t-me", { long: { [MINIMAL]: 1 } });
  const warm = await similarUsers("t-me", 5);
  assert.equal(warm.data.neighbors[0]?.uid, "t-min", "the own vector is fresh");
  assert.ok(!warm.data.neighbors.some((n) => n.uid === "t-me"), "and never their own neighbour");
});

test("T4 similarUsers reads the neighbours THROUGH the snapshot — a newcomer waits for it to turn over", async () => {
  const { TAGS } = await import("../lib/brain/tags.js");
  const [A] = TAGS;
  invalidateTasteVectorSnapshots();
  await saveProfile("t4-me", { long: { [A]: 1 } });
  await saveProfile("t4-old", { long: { [A]: 1 } });
  const warm = await similarUsers("t4-me", 10);
  assert.ok(warm.data.neighbors.some((n) => n.uid === "t4-old"));
  await saveProfile("t4-new", { long: { [A]: 1 } });
  const stale = await similarUsers("t4-me", 10);
  assert.ok(!stale.data.neighbors.some((n) => n.uid === "t4-new"),
    "inside the TTL the scan is the snapshot's — a direct listTasteVectors read here would be the 45 ms per feed request this exists to remove");
  invalidateTasteVectorSnapshots();
  const fresh = await similarUsers("t4-me", 10);
  assert.ok(fresh.data.neighbors.some((n) => n.uid === "t4-new"));
});
