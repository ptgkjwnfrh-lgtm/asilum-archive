// tests/feed-rotation.test.js — Feed rotation memory: sized to the pool so a
// reader can reach all of it, an undersized memory confines the reader, and
// the memory holds distinct ids.

import test from "node:test";
import assert from "node:assert/strict";

import { buildFeed, markSeen, migrateProfile } from "../lib/brain/index.js";
import { makeBots } from "../lib/brain/replay.js";
import { CATALOG } from "../lib/ingest/catalog.js";

// WHAT A HEAVY SCROLLER CAN REACH.
//
// `_meta.seen` is feed rotation memory. It was capped at a flat 200, and the
// debt register described the consequence as "past ~200 pieces served, the
// oldest fall out and can reappear — a heavy scroller loops". That was true
// and much too mild: measured (npm run feed:rotation), the reader was confined
// to 286 of 915 items PERMANENTLY, and never shown the other two thirds
// however long they scrolled.
//
// The cause is that the memory is a score penalty rather than an exclusion, so
// it saturates: 200 penalised items, serve the next best 60, those enter
// memory, 60 fall out with their penalty lifted, and the feed oscillates over
// one taste-shaped neighbourhood forever. Reach scaled almost linearly with
// the cap — 200 -> 286, 400 -> 482, 800 -> 864, 1000 -> all 915 — which is
// what makes it a SIZE rather than a threshold.
//
// The cap is now passed by the caller from the pool it served. This test is
// the guard on that, and it asserts the shape rather than the tuning:
//
//   1. sized to the pool, a reader reaches ALL of it;
//   2. under-sized, they do not — so assertion 1 cannot be passing because the
//      pool is small or the engine is uniform;
//   3. the memory is de-duped, because an id held twice is a slot spent
//      remembering the same piece twice.

const PAGES = 25;
const LIMIT = 60;

function reach(cap) {
  const bot = makeBots(1, 11)[0];
  let profile = migrateProfile({ long: { ...bot.latent }, session: {}, _meta: {} });
  const everServed = new Set();
  for (let page = 0; page < PAGES; page++) {
    const { items } = buildFeed({ profile, limit: LIMIT }, CATALOG);
    const ids = items.map((it) => it.id);
    for (const id of ids) everServed.add(id);
    profile = markSeen(profile, ids, cap);
  }
  return everServed.size;
}

test("rotation memory sized to the pool lets a reader reach all of it", () => {
  // What app/api/feed/route.js passes.
  const sized = reach(CATALOG.length);
  assert.equal(sized, CATALOG.length,
    `a reader whose rotation memory is as large as the pool should be shown every item ` +
    `in it across ${PAGES} pages; saw ${sized}/${CATALOG.length}`);
});

test("an under-sized memory still confines the reader, so the test above means something", () => {
  // The old flat cap. If this ALSO reached the whole catalog, the assertion
  // above would be passing on a small pool or a uniform engine rather than on
  // the fix, and neither test would be evidence of anything.
  const starved = reach(200);
  assert.ok(starved < CATALOG.length * 0.5,
    `a 200-slot memory should still confine this reader to well under half the catalog ` +
    `(measured ~31%); saw ${starved}/${CATALOG.length}`);
  assert.ok(starved > CATALOG.length * 0.15,
    `...but to a meaningful slice, not nothing; saw ${starved}/${CATALOG.length}`);
});

test("rotation memory holds distinct ids, not repeats", () => {
  const profile = markSeen(
    markSeen(migrateProfile({}), ["a", "b", "c"]),
    ["c", "b", "d"]);
  assert.deepEqual(profile._meta.seen, ["c", "b", "d", "a"],
    "newest first, each id once — a repeat moves an id forward rather than adding a second copy");
});

test("rotation memory cannot grow the profile past its byte budget", () => {
  // lib/db/core/profiles.js THROWS above 256 KiB. A marketplace id is long,
  // and a pool-sized cap on a large pool would otherwise be unbounded bytes.
  const long = Array.from({ length: 4000 }, (_, i) => `marketplace-listing-${String(i).padStart(20, "0")}`);
  const profile = markSeen(migrateProfile({}), long, 4000);
  const bytes = JSON.stringify(profile._meta.seen).length;
  assert.ok(bytes <= 48 * 1024, `rotation memory took ${bytes} bytes`);
  assert.ok(profile._meta.seen.length > 100,
    `...while still remembering a useful amount; kept ${profile._meta.seen.length}`);
  assert.equal(profile._meta.seen[0], long[0], "and it keeps the NEWEST, not the oldest");
});
