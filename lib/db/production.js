// lib/db/production.js — THE DOOR, AND NOTHING ELSE.
//
// This file used to be 4,502 lines: CRUD for every production-foundation table
// (supabase/schema-v2.sql onwards) in one place, the largest file in the
// repository and the one a newcomer was least able to hold in their head. It
// has been split by TABLE GROUP into ./production/*, each group extracted in
// its own step and verified by the full suite before the next one started.
//
// What remains here is the DOOR. Every module below is re-exported, so
// `import { anything } from "@/lib/db/production"` still resolves exactly as
// it did before the split and not one caller anywhere changed. The public
// surface is pinned by scripts/db-export-surface.mjs: 126 names, LOST none /
// gained none across every step.
//
// WHERE THINGS WENT, and why each line is where it is:
//
//   store.js          the in-memory fallback (`mem`) and the primitives that
//                     guard it — bounded pushes, ordered user locks, the
//                     advisory-lock helper. NOT re-exported wholesale: mem and
//                     its helpers were private before the split and stay
//                     private, or the split would have widened the surface.
//   catalog.js        product_tags, product_images, measurements — the pieces.
//   tickets.js        purchase_tickets — somebody trying to buy one.
//   editorial.js      posts, mood boards, stylist outfits, engagements.
//   ai.js             what a model was asked and what the system believes.
//   moderation.js     the queue a human reads. Shared: corrections opens tasks
//                     and so does the Asterisk layer, so it belongs to neither.
//   corrections.js    a reader telling us we got it wrong, and the standing
//                     exclusions that promise must produce.
//   interpretation.js unknown queries, follows, wardrobe, rail prefs, brand
//                     cases — what the system makes of a person.
//   booths.js         business accounts and the hotlist: who gets to sell here.
//   privacy.js        §6 — the export AND the erasure, together, because they
//                     are two halves of one promise and drifted once apart.
//
// The dependency direction is one-way: privacy.js reads from every domain
// module and nothing reads from privacy.js. That is why it was extracted last.
//
// A NOTE ON THE `import` LINES BESIDE EACH `export *`, wherever one appears:
// `export *` publishes a name, it does NOT bind it in this module's scope. A
// re-export alone left a helper undefined at runtime while every import of it
// from outside kept working — a green build and twelve red tests. Any code
// still living in this file that CALLS a re-exported name needs both lines.
// Today no code lives here, so no such pairs remain.

export { isPersistent, withUserOperationLock } from "./production/store.js";
export * from "./production/catalog.js";
export * from "./production/tickets.js";
export * from "./production/editorial.js";
export * from "./production/ai.js";
export { createModerationTask, listModerationTasks, resolveModerationTask } from "./production/moderation.js";
export * from "./production/corrections.js";
export * from "./production/interpretation.js";
export * from "./production/booths.js";
export * from "./production/wardrobeTransfers.js";
export * from "./production/verification.js";
export * from "./production/privacy.js";
export * from "./production/records.js";
export * from "./production/listingStatus.js";
export * from "./production/storefronts.js";
export * from "./production/commerce.js";
export * from "./production/credit.js";
export * from "./production/score.js";
export * from "./production/aftersale.js";
