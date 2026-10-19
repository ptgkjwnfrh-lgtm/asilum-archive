// lib/db/production/store.js — THE SHARED IN-MEMORY STORE, and nothing else.
//
// Split out of lib/db/production.js so the domain modules beside it can each be
// read on their own. This file is what they share, and sharing it correctly is
// the whole reason it exists as a module rather than a copy.
//
// `mem` IS ONE OBJECT AND MUST STAY ONE OBJECT. Every domain writes into the
// same collections and draws ids from the same `seq`, so two modules holding
// two `mem` objects would silently split the store in half: a ticket written
// by one would be invisible to the §6 export reading the other. ES modules
// give us that for free — a module body runs once and every importer gets the
// same binding — but only while there is exactly ONE of this file.
//
// This is the keyless-development fallback. With DATABASE_URL set none of it
// is touched; every function checks `getPool()` first and the memory path is
// what keeps a local run honest rather than crashing.

import { getPool, withUserLock } from "../index.js";

export const mem = {
  ontologyTags: new Map(),  // id -> row
  productAiTags: [],        // append-only, grouped by auditId
  reconciliations: [],
  facts: [],
  moderationTasks: [],
  corrections: [],
  productTags: [],       // {productId, tag, tagType, confidence, source}
  mappings: new Map(),   // phrase -> {mappedTags, relatedTerms, referenceType, confidence}
  searchLogs: [],
  tickets: [],           // capped ring
  posts: [],
  uploads: [],
  outfits: [],
  analyses: [],          // mood_board_analysis
  styleProfiles: new Map(), // userId -> profile row
  stylistRequests: [],
  stylistFeedback: [],
  aiEvents: [],          // ai_model_events
  adoptions: new Map(),  // "device|account" -> in-flight/completed result promise
  measurements: new Map(), // userId -> canonical inch storage
  unknownQueries: new Map(), // normalized_query -> row (v13)
  unknownVotes: new Set(),   // "queryId|identityHash"
  interpretationFeedback: [], // v13
  memoryPreferences: new Map(), // userId -> {hiddenSections, guidanceEnabled, updatedAt} (v14/v20)
  follows: [], // {userId, kind, target, createdAt} (v14; brand/user only)
  wardrobe: [], // wardrobe_items rows, snake_case (v15)
  railPrefs: new Map(), // "userId|railId" -> {collapsed, hidden} (v16)
  profileRooms: new Map(), // accountId(uuid) -> room row, camelCase (v17)
  profileModules: new Map(), // "accountId|module" -> module row (v17)
  brandCases: new Map(), // caseId -> case row, camelCase (v18)
  brandCaseEvents: [], // append-only transition ledger (v18)
  businessAccounts: new Map(), // accountId -> business-account row (v26)
  engagements: new Set(), // keyed by engKey() below — person-deduped (v28)
  records: new Map(), // "userId|kind|recordId" -> user_records row, camelCase (v53)
  // Native Storefront (v62). Financial collections are deliberately separate
  // from the catalog maps: a listing edit can never mutate money received, and
  // a pending reservation is not represented as a collected event.
  storefronts: new Map(), // storefrontId -> snake_case persistence row
  storefrontOwners: new Map(), // bare auth UUID -> storefrontId
  storefrontSlugs: new Map(), // lowercase slug -> storefrontId
  storefrontPaymentAccounts: new Map(), // storefrontId -> private provider state
  storefrontFeeAccounts: new Map(), // storefrontId -> target/collected/reserved projection
  storefrontFeeReservations: new Map(), // reservationId -> mutable reservation
  storefrontFeeReservationOps: new Map(), // operationKey -> reservationId
  storefrontFeeEvents: [], // immutable reserved/collected/released/reversed events
  storefrontFeeEventOps: new Map(), // operationKey -> event id
  nativeListings: new Map(), // listingId -> native listing authority
  nativeListingOperations: new Map(), // storefrontId|operationKey -> listingId
  nativeVariants: new Map(), // variantId -> inventory authority
  inventoryReservations: new Map(), // reservationId -> mutable reservation
  inventoryReservationOps: new Map(), // operationKey -> reservationId
  // native commerce (slice 6, v64): offers, discounts, the private price history, the queue, relists
  listingOffers: new Map(),     // offerId -> offer row (camelCase, lib/storefront/commerce.js shape)
  listingDiscounts: new Map(),  // discountId -> discount row
  priceHistory: [],             // { listingId, variantId, priceCents, reason, at } — private
  availabilityQueue: new Map(), // `${listingId}|${userId}` -> { listingId, userId, joinedAt, state }
  listingRelists: [],           // { listingId, fromVersion, condition, photos, priceCents, quantity, confirmedBy, at }
  // after the sale (slice 7, v65): credit, reviews, penalties, deliveries, returns, elections, incentives, dispatch
  creditLedger: [], creditSeq: 1,
  passengerReviews: new Map(),  // reviewId -> row
  conductPenalties: new Map(),  // penaltyId -> row
  orderDeliveries: new Map(),   // orderId -> row
  orderReturns: new Map(),      // returnId -> row
  protectionElections: new Map(), // orderId -> row
  returnIncentives: [],         // { listing_id, storefront_id, order_id, amount_cents, earned_at }
  orderDispatch: new Map(),     // orderId -> row
  // BRDCST (slice 8, v66): campaigns and the bonus bank
  brdcstCampaigns: new Map(),   // campaignId -> row (snake_case, the v66 columns)
  brdcstBonuses: [], brdcstBonusSeq: 1,
  motionAssets: new Map(),      // assetId -> row (snake_case, the v67 columns; slice 9)
  paymentAttempts: new Map(), // attemptId -> provider outbox row
  paymentAttemptOps: new Map(), // idempotencyKey -> attemptId
  stripeEventInbox: new Map(), // Stripe event id -> durable-receipt mirror
  seq: 1,
};
export const MEM_CAP = 2000;
export function push(arr, row) { arr.push(row); if (arr.length > MEM_CAP) arr.splice(0, arr.length - MEM_CAP); return row; }
export function boundedLimit(value, fallback, max) {
  return Math.max(1, Math.min(max, Math.trunc(Number(value)) || fallback));
}

export function withOrderedUserLocks(userIds, fn) {
  const ids = [...new Set(userIds)].sort();
  const acquire = (index) => index >= ids.length
    ? fn()
    : withUserLock(ids[index], () => acquire(index + 1));
  return acquire(0);
}

// The key shape of `mem.engagements`. It lives here rather than with the
// engagement writers because two modules read that Set (editorial toggles it,
// corrections re-keys it when a device's history is adopted by an account),
// and a Set whose two writers disagree about its key format is a silent
// duplicate. Deliberately NOT re-exported from production.js: this is the
// store's internal shape, not part of the public surface.
export const engKey = (postId, hash, kind) => `${postId}|${hash}|${kind}`;

// Coordinate ownership-sensitive operations across server instances without
// holding a database transaction open while Storage performs network I/O.
// The persistent key intentionally matches account adoption's user lock.
export async function withUserOperationLock(userId, fn) {
  if (!userId || typeof fn !== "function") throw new TypeError("user operation lock requires an identity and callback");
  const p = await getPool();
  if (!p) return withUserLock(userId, () => fn(null));
  const client = await p.connect();
  let locked = false;
  let releaseError = null;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`user-lock:${userId}`]);
    locked = true;
    return await fn(client);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`user-lock:${userId}`]);
      } catch (error) {
        releaseError = error;
      }
    }
    client.release(releaseError || undefined);
  }
}

export async function isPersistent() {
  return !!(await getPool());
}
