// lib/db/production/storefronts.js — native Storefront persistence (v62).
// SERVER-ONLY. Memory mode mirrors the Postgres laws for local development and
// unit tests; provider money in production still requires durable Postgres.
//
// Store ownership is a bare auth UUID. A device id (`u-*`) and an `sb-`-prefixed
// identity are both refused here so a caller cannot accidentally place a
// financial entitlement in the personalization/adoption namespace.

import crypto from "node:crypto";

import { getPool, hasRelation } from "../core/pool.js";
import { mem as catalogMem } from "../core/store.js";
import { getOrder } from "../orders.js";
import { mem, withOrderedUserLocks } from "./store.js";
import {
  LISTING_STATES,
  STOREFRONT_STATES,
  STOREFRONT_TERMS_VERSION,
  normalizeListingInput,
  normalizeStorefrontInput,
  plainText,
  safePublicImageUrl,
  storefrontSlug,
} from "../../storefront/contracts.js";
import {
  STOREFRONT_FEE_POLICY_VERSION,
  STOREFRONT_FEE_TARGET_CENTS, ACTIVATION_APPLIES_TO, activationApplies,
} from "../../storefront/fees.js";
import { storefrontRuntimeFlags } from "../../storefront/flags.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_STORE_STATES = new Set(["draft", "pending_review", "paused", "archived"]);
const OWNER_LISTING_STATES = new Set(["draft", "pending_review", "paused", "sold_out", "archived"]);
const VARIANT_STATES = new Set(["active", "paused", "archived"]);
const MAX_VARIANTS = 50;
const MAX_PHOTOS = 12;

export class StorefrontRefused extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "StorefrontRefused";
    this.code = code;
    this.status = status;
  }
}

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const dateIso = (value) => value ? new Date(value).toISOString() : null;

function accountId(value) {
  const id = String(value || "").toLowerCase();
  if (!UUID.test(id)) {
    throw new StorefrontRefused("ACCOUNT_REQUIRED", "a signed-in account is required", 403);
  }
  return id;
}

function uuid(value, name) {
  const id = String(value || "").toLowerCase();
  if (!UUID.test(id)) throw new StorefrontRefused("INVALID_ID", `${name} is invalid`, 400);
  return id;
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new StorefrontRefused("INVALID_AMOUNT", `${name} must be a positive integer`, 400);
  }
  return n;
}

function nonnegativeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new StorefrontRefused("INVALID_AMOUNT", `${name} must be a non-negative integer`, 400);
  }
  return n;
}

function operationKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 200) {
    throw new StorefrontRefused("INVALID_OPERATION_KEY", "operation key must be 8-200 characters", 400);
  }
  return key;
}

function orderKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 120) throw new StorefrontRefused("INVALID_ORDER", "order id is required", 400);
  return key;
}

function listingItemId(listingId) {
  return `native-${listingId}`;
}

function normalizedStorefrontPayload(input) {
  try {
    return normalizeStorefrontInput(input);
  } catch (error) {
    throw new StorefrontRefused("INVALID_STOREFRONT", error?.message || "invalid storefront", 400);
  }
}

function requireOwnerSurfaceWrite() {
  if (!storefrontRuntimeFlags().surfaceEnabled) {
    throw new StorefrontRefused("STOREFRONT_DISABLED", "storefront writes are disabled", 503);
  }
}

function requireOwnerListingWrite() {
  requireOwnerSurfaceWrite();
  if (!storefrontRuntimeFlags().listingWritesEnabled) {
    throw new StorefrontRefused("LISTING_WRITES_DISABLED", "storefront listing writes are disabled", 503);
  }
}

async function schemaApplied(p) {
  return !p || hasRelation(p, "storefronts");
}

async function requireSchema(p) {
  if (!(await schemaApplied(p))) {
    throw new StorefrontRefused(
      "STOREFRONT_SCHEMA_REQUIRED",
      "storefront storage is not available until schema v62 is applied",
      503,
    );
  }
}

function requireDurableMoney(p) {
  if (!p && process.env.NODE_ENV === "production") {
    throw new StorefrontRefused(
      "DURABLE_STORE_REQUIRED",
      "money and inventory reservations require persistent storage",
      503,
    );
  }
}

async function transaction(p, fn) {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Operation keys are unique in the schema, but a pre-read alone is not an
// idempotency lock: two transactions can both miss it and one then receives a
// 23505. Serialize each stable key for the transaction, re-read under that
// lock, and only then perform the business transition.
async function lockOperation(client, namespace, key) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${namespace}:${key}`]);
}

function idempotencyConflict() {
  throw new StorefrontRefused(
    "IDEMPOTENCY_CONFLICT",
    "that operation key already belongs to a different operation",
    409,
  );
}

function pgConflict(error, fallback = "storefront write conflicted") {
  if (error?.code !== "23505") throw error;
  const constraint = String(error.constraint || "");
  if (constraint.includes("slug")) {
    throw new StorefrontRefused("SLUG_TAKEN", "that storefront address is already in use", 409);
  }
  if (constraint.includes("sku")) {
    throw new StorefrontRefused("SKU_TAKEN", "a variant already uses that SKU", 409);
  }
  throw new StorefrontRefused("WRITE_CONFLICT", fallback, 409);
}

function storefrontRowOut(row) {
  if (!row) return null;
  const state = row.state || "draft";
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    imageUrl: row.image_url || null,
    bannerUrl: row.banner_url || null,
    state,
    status: state,
    termsVersion: row.terms_version,
    termsAcceptedAt: dateIso(row.terms_accepted_at),
    version: Number(row.version),
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

function variantRowOut(row) {
  const state = row.state || "active";
  const stockOnHand = Number(row.stock_on_hand);
  const stockReserved = Number(row.stock_reserved);
  return {
    id: String(row.id),
    label: row.label || "Default",
    sku: row.sku || null,
    optionValues: row.option_values || {},
    priceCents: Number(row.price_cents),
    currency: String(row.currency || "usd").toUpperCase(),
    stockOnHand,
    stockReserved,
    availableQuantity: Math.max(0, stockOnHand - stockReserved),
    state,
    status: state,
    isDefault: row.is_default === true,
    version: Number(row.version),
  };
}

function listingRowOut(row, variants = []) {
  const shaped = variants.map(variantRowOut);
  const fallback = shaped.find((variant) => variant.isDefault) || shaped[0] || null;
  const state = row.state || "draft";
  const available = shaped
    .filter((variant) => variant.state === "active")
    .reduce((sum, variant) => sum + variant.availableQuantity, 0);
  const photos = Array.isArray(row.photos) ? row.photos : [];
  return {
    id: String(row.id),
    storefrontId: String(row.storefront_id),
    itemId: listingItemId(row.id),
    title: row.title,
    description: row.description || "",
    category: row.category,
    subcategory: row.subcategory || null,
    condition: row.condition || null,
    currency: String(fallback?.currency || "USD").toUpperCase(),
    priceCents: fallback?.priceCents ?? null,
    status: state,
    state,
    origin: "native",
    imageUrl: photos[0] || null,
    photos,
    attributes: row.attributes || {},
    fulfillment: row.fulfillment || { shipping: true, pickup: false },
    inventory: available,
    availableQuantity: available,
    version: Number(row.version),
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
    variants: shaped,
    // slice 6: SELL (single item) or DROP (quantities, variations; authenticated before release)
    mode: row.mode === "drop" ? "drop" : "sell",
  };
}

function publicListing(row, variants) {
  const listing = listingRowOut(row, variants);
  return {
    id: listing.id,
    itemId: listing.itemId,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    subcategory: listing.subcategory,
    condition: listing.condition,
    currency: listing.currency,
    priceCents: listing.priceCents,
    status: listing.status,
    origin: listing.origin,
    imageUrl: listing.imageUrl,
    photos: listing.photos,
    attributes: listing.attributes,
    fulfillment: listing.fulfillment,
    availableQuantity: listing.availableQuantity,
    version: listing.version,
    mode: listing.mode,
    variants: listing.variants
      .filter((variant) => variant.state === "active")
      .map((variant) => ({
        id: variant.id,
        label: variant.label,
        optionValues: variant.optionValues,
        priceCents: variant.priceCents,
        currency: variant.currency,
        availableQuantity: variant.availableQuantity,
        status: variant.availableQuantity > 0 ? "active" : "sold_out",
        version: variant.version,
      })),
  };
}

function feeBalanceOut(row, modes = null) {
  if (!row) return null;
  const targetCents = Number(row.target_cents);
  const collectedCents = Number(row.collected_cents);
  const reservedCents = Number(row.reserved_cents);
  // the activation is owed only by a storefront with a DROP (A6, 18 Oct 2026);
  // `modes` null means the caller did not say, and the ledger's own numbers answer
  const applies = modes == null ? true : activationApplies(modes);
  return {
    currency: String(row.currency || "usd").toLowerCase(),
    policyVersion: row.policy_version,
    targetCents,
    collectedCents,
    reservedCents,
    remainingCents: Math.max(0, targetCents - collectedCents),
    unreservedRemainingCents: Math.max(0, targetCents - collectedCents - reservedCents),
    activation: { appliesTo: ACTIVATION_APPLIES_TO, applies, owedCents: applies ? Math.max(0, targetCents - collectedCents) : 0, note: applies ? "owed: the storefront releases a DROP" : "not owed: SELL carries no ASILUM fee on the seller's side — only the processor's" },
  };
}

function paymentOnboardingState(payment) {
  if (!payment?.stripe_account_id) return "not_started";
  if (payment.details_submitted && payment.charges_enabled && payment.payouts_enabled
    && payment.validation_version && payment.validated_at) return "ready";
  if (payment.details_submitted && (!payment.charges_enabled || !payment.payouts_enabled)) return "restricted";
  return "pending";
}

function capabilitiesFor(storefront, payment = null) {
  const hasStore = Boolean(storefront);
  const runtime = storefrontRuntimeFlags();
  const manageable = runtime.surfaceEnabled && hasStore
    && !["archived", "rejected"].includes(storefront.state);
  const paymentReady = paymentOnboardingState(payment) === "ready";
  return {
    canCreateStore: runtime.surfaceEnabled && !hasStore,
    canEditStore: manageable,
    canManageListings: manageable && runtime.listingWritesEnabled,
    canPublishListings: false,
    canReceiveOrders: false,
    checkoutMode: "off",
    paymentOnboarding: paymentOnboardingState(payment),
    feeCollectionEnabled: false,
    reasons: [...runtime.reasons, paymentReady ? {
      code: "CHECKOUT_DISABLED",
      message: "Payment capability is recorded, but native checkout remains disabled until the release gate is enabled.",
    } : {
      code: "PAYMENTS_NOT_VALIDATED",
      message: "Native checkout remains unavailable until the payment configuration is validated in test mode.",
    }],
  };
}

function ownerFeeEventOut(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    orderId: row.order_id,
    kind: row.kind,
    amountCents: Number(row.amount_cents),
    currency: String(row.currency || "usd").toLowerCase(),
    createdAt: dateIso(row.created_at),
  };
}

function ownerOrderOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    itemId: row.item_id,
    title: typeof row.snapshot?.title === "string" ? row.snapshot.title : null,
    variantLabel: typeof row.snapshot?.variant_label === "string" ? row.snapshot.variant_label : null,
    quantity: Number(row.quantity || 0),
    merchandiseCents: Number(row.merchandise_cents || 0),
    passengerFeeCents: Number(row.passenger_fee_cents || 0),
    storefrontFeeCents: 0,
    shippingCents: Number(row.shipping_cents || 0),
    handlingCents: Number(row.handling_cents || 0),
    taxCents: Number(row.tax_cents || 0),
    buyerTotalCents: Number(row.buyer_total_cents || 0),
    totalCents: Number(row.buyer_total_cents || 0),
    currency: String(row.currency || "usd").toLowerCase(),
    paymentStatus: row.payment_status || null,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

async function loadListings(target, storefrontId, { publicOnly = false } = {}) {
  if (!target) {
    const rows = [...mem.nativeListings.values()]
      .filter((row) => row.storefront_id === storefrontId && (!publicOnly || row.state === "active"))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows.map((row) => ({
      row,
      variants: [...mem.nativeVariants.values()]
        .filter((variant) => variant.listing_id === row.id && (!publicOnly || variant.state === "active"))
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || String(a.created_at).localeCompare(String(b.created_at))),
    }));
  }
  const listingResult = await target.query(
    `SELECT * FROM native_listings
      WHERE storefront_id=$1 ${publicOnly ? "AND state='active'" : ""}
      ORDER BY created_at DESC, id`,
    [storefrontId],
  );
  if (!listingResult.rows.length) return [];
  const ids = listingResult.rows.map((row) => row.id);
  const variantResult = await target.query(
    `SELECT * FROM native_listing_variants
      WHERE listing_id=ANY($1::uuid[]) ${publicOnly ? "AND state='active'" : ""}
      ORDER BY is_default DESC, created_at, id`,
    [ids],
  );
  const byListing = new Map();
  for (const variant of variantResult.rows) {
    if (!byListing.has(String(variant.listing_id))) byListing.set(String(variant.listing_id), []);
    byListing.get(String(variant.listing_id)).push(variant);
  }
  return listingResult.rows.map((row) => ({ row, variants: byListing.get(String(row.id)) || [] }));
}

async function loadOwnerEnvelope(account) {
  const owner = accountId(account);
  const p = await getPool();
  await requireSchema(p);
  let storeRow = null;
  let feeRow = null;
  let paymentRow = null;
  let listings = [];
  let feeEvents = [];
  let orders = [];
  if (!p) {
    const id = mem.storefrontOwners.get(owner);
    storeRow = id ? mem.storefronts.get(id) || null : null;
    if (storeRow) {
      feeRow = mem.storefrontFeeAccounts.get(storeRow.id) || null;
      paymentRow = mem.storefrontPaymentAccounts.get(storeRow.id) || null;
      listings = await loadListings(null, storeRow.id);
      feeEvents = mem.storefrontFeeEvents
        .filter((event) => event.storefront_id === storeRow.id)
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 100);
    }
  } else {
    const storeResult = await p.query("SELECT * FROM storefronts WHERE owner_account_id=$1", [owner]);
    storeRow = storeResult.rows[0] || null;
    if (storeRow) {
      const [feeResult, paymentResult, listingRows, eventResult, orderResult] = await Promise.all([
        p.query("SELECT * FROM storefront_fee_accounts WHERE storefront_id=$1", [storeRow.id]),
        p.query("SELECT * FROM storefront_payment_accounts WHERE storefront_id=$1", [storeRow.id]),
        loadListings(p, storeRow.id),
        p.query(
          `SELECT id,order_id,kind,amount_cents,currency,created_at
             FROM storefront_fee_events WHERE storefront_id=$1 ORDER BY id DESC LIMIT 100`,
          [storeRow.id],
        ),
        p.query(
          `SELECT o.id,o.status,o.item_id,o.merchandise_cents,o.passenger_fee_cents,
                  o.shipping_cents,o.handling_cents,o.tax_cents,o.buyer_total_cents,
                  o.currency,o.created_at,o.updated_at,ol.quantity,ol.snapshot,
                  a.status AS payment_status
             FROM orders o
             JOIN order_lines ol ON ol.order_id=o.id AND ol.storefront_id=o.storefront_id AND ol.line_number=1
             LEFT JOIN LATERAL (
               SELECT status FROM payment_attempts pa
                WHERE pa.order_id=o.id AND pa.storefront_id=o.storefront_id
                ORDER BY pa.created_at DESC LIMIT 1
             ) a ON true
            WHERE o.storefront_id=$1 AND o.commerce_rail='native_storefront'
            ORDER BY o.created_at DESC LIMIT 50`,
          [storeRow.id],
        ),
      ]);
      feeRow = feeResult.rows[0] || null;
      paymentRow = paymentResult.rows[0] || null;
      listings = listingRows;
      feeEvents = eventResult.rows;
      orders = orderResult.rows;
    }
  }
  const storefront = storefrontRowOut(storeRow);
  if (storefront) storefront.listings = listings.map(({ row, variants }) => listingRowOut(row, variants));
  return {
    storefront,
    feeBalance: feeBalanceOut(feeRow, listings.map(({ row }) => (row.mode === "drop" ? "drop" : "sell"))),
    feeEvents: feeEvents.map(ownerFeeEventOut),
    orders: orders.map(ownerOrderOut),
    capabilities: capabilitiesFor(storefront, paymentRow),
  };
}

/** Re-project one listing onto the shared catalog row after a change made
 *  outside this module (a discount, a relist — lib/db/production/commerce.js). */
export async function reprojectListing(listingId) {
  const id = String(listingId || "");
  if (!id) return null;
  const p = await getPool();
  if (!p) return projectListingMemory(id);
  return projectListingPg(p, id);
}

export async function getStorefrontForOwner(account) {
  return loadOwnerEnvelope(account);
}

export async function getPublicStorefrontBySlug(value) {
  const slug = storefrontSlug(value);
  if (!slug || slug !== String(value || "").toLowerCase()) return null;
  const p = await getPool();
  await requireSchema(p);
  let storeRow;
  let listings;
  let sellerHandle = null;
  if (!p) {
    const id = mem.storefrontSlugs.get(slug);
    storeRow = id ? mem.storefronts.get(id) || null : null;
    if (!storeRow || storeRow.state !== "active") return null;
    const room = mem.profileRooms.get(storeRow.owner_account_id);
    sellerHandle = room?.published === true && room?.moderationStatus === "visible"
      && typeof room?.handle === "string" && room.handle
      ? room.handle
      : null;
    listings = await loadListings(null, storeRow.id, { publicOnly: true });
  } else {
    const storeResult = await p.query(
      `SELECT s.*,
              CASE WHEN r.published=true AND r.moderation_status='visible'
                    THEN r.handle ELSE NULL END AS seller_handle
         FROM storefronts s
         LEFT JOIN profile_rooms r ON r.account_id=s.owner_account_id
        WHERE s.slug=$1 AND s.state='active'`,
      [slug],
    );
    storeRow = storeResult.rows[0] || null;
    if (!storeRow) return null;
    sellerHandle = storeRow.seller_handle || null;
    listings = await loadListings(p, storeRow.id, { publicOnly: true });
  }
  const base = storefrontRowOut(storeRow);
  return {
    storefront: {
      slug: base.slug,
      name: base.name,
      description: base.description,
      imageUrl: base.imageUrl,
      bannerUrl: base.bannerUrl,
      sellerHandle,
      status: base.status,
      state: base.state,
      listings: listings.map(({ row, variants }) => publicListing(row, variants)),
    },
    capabilities: {
      canReceiveOrders: false,
      checkoutMode: "off",
      reasons: [{ code: "PAYMENTS_NOT_VALIDATED", message: "Native checkout is not available yet." }],
    },
  };
}

export async function createStorefront({
  accountId: ownerRaw,
  name,
  slug,
  description = "",
  imageUrl = null,
  bannerUrl = null,
  acceptedTermsVersion,
  accepted = false,
} = {}) {
  requireOwnerSurfaceWrite();
  const owner = accountId(ownerRaw);
  if (accepted !== true || acceptedTermsVersion !== STOREFRONT_TERMS_VERSION) {
    throw new StorefrontRefused(
      "TERMS_VERSION_REQUIRED",
      "the current storefront terms must be accepted",
      409,
    );
  }
  const clean = normalizedStorefrontPayload({ name, slug, description, imageUrl, bannerUrl });
  const p = await getPool();
  await requireSchema(p);
  let duplicate = false;

  if (!p) {
    await withOrderedUserLocks([`storefront-owner:${owner}`, `storefront-slug:${clean.slug}`], async () => {
      const priorId = mem.storefrontOwners.get(owner);
      if (priorId) { duplicate = true; return; }
      if (mem.storefrontSlugs.has(clean.slug)) {
        throw new StorefrontRefused("SLUG_TAKEN", "that storefront address is already in use", 409);
      }
      const at = nowIso();
      const id = newId();
      mem.storefronts.set(id, {
        id,
        owner_account_id: owner,
        business_account_id: null,
        slug: clean.slug,
        name: clean.name,
        description: clean.description,
        image_url: clean.imageUrl,
        banner_url: clean.bannerUrl,
        state: "draft",
        terms_version: STOREFRONT_TERMS_VERSION,
        terms_accepted_at: at,
        version: 1,
        created_at: at,
        updated_at: at,
      });
      mem.storefrontOwners.set(owner, id);
      mem.storefrontSlugs.set(clean.slug, id);
      mem.storefrontFeeAccounts.set(id, {
        storefront_id: id,
        target_cents: STOREFRONT_FEE_TARGET_CENTS,
        collected_cents: 0,
        reserved_cents: 0,
        currency: "usd",
        policy_version: STOREFRONT_FEE_POLICY_VERSION,
        created_at: at,
        updated_at: at,
      });
    });
  } else {
    try {
      duplicate = await transaction(p, async (client) => {
        const inserted = await client.query(
          `INSERT INTO storefronts
             (owner_account_id,slug,name,description,image_url,banner_url,state,terms_version,terms_accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,now())
           ON CONFLICT (owner_account_id) DO NOTHING
           RETURNING id`,
          [owner, clean.slug, clean.name, clean.description, clean.imageUrl, clean.bannerUrl, STOREFRONT_TERMS_VERSION],
        );
        if (!inserted.rows.length) return true;
        await client.query(
          `INSERT INTO storefront_fee_accounts
             (storefront_id,target_cents,collected_cents,reserved_cents,currency,policy_version)
           VALUES ($1,$2,0,0,'usd',$3)`,
          [inserted.rows[0].id, STOREFRONT_FEE_TARGET_CENTS, STOREFRONT_FEE_POLICY_VERSION],
        );
        return false;
      });
    } catch (error) {
      pgConflict(error, "a storefront already exists for that account");
    }
  }
  return { ...(await loadOwnerEnvelope(owner)), duplicate };
}

function ownerStoreState(value, current = null) {
  const state = String(value || current || "draft");
  // keeping the current state asserts nothing (slice 6 review finding; the listing rule says the same)
  if (current && state === current) return state;
  if (state === "active" || state === "rejected") {
    throw new StorefrontRefused(
      "PUBLICATION_DISABLED",
      "storefront publication requires moderation and payment readiness",
      409,
    );
  }
  if (!OWNER_STORE_STATES.has(state) || !STOREFRONT_STATES.includes(state)) {
    throw new StorefrontRefused("INVALID_STATE", "unsupported storefront status", 400);
  }
  return state;
}

export async function updateStorefront(ownerRaw, input = {}) {
  requireOwnerSurfaceWrite();
  const owner = accountId(ownerRaw);
  const expected = positiveInt(input.version, "storefront version");
  const p = await getPool();
  await requireSchema(p);

  if (!p) {
    const storeId = mem.storefrontOwners.get(owner);
    if (!storeId) throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
    await withOrderedUserLocks([`storefront:${storeId}`], async () => {
      const current = mem.storefronts.get(storeId);
      if (Number(current.version) !== expected) {
        throw new StorefrontRefused("STALE_VERSION", "the storefront changed; reload before saving", 409);
      }
      const clean = normalizedStorefrontPayload({
        name: input.name ?? current.name,
        slug: input.slug ?? current.slug,
        description: input.description ?? current.description,
        imageUrl: input.imageUrl ?? current.image_url,
        bannerUrl: input.bannerUrl === undefined ? current.banner_url : input.bannerUrl,
      });
      const nextState = ownerStoreState(input.status ?? input.state ?? current.state, current.state);
      const occupied = mem.storefrontSlugs.get(clean.slug);
      if (occupied && occupied !== storeId) {
        throw new StorefrontRefused("SLUG_TAKEN", "that storefront address is already in use", 409);
      }
      if (clean.slug !== current.slug) {
        mem.storefrontSlugs.delete(current.slug);
        mem.storefrontSlugs.set(clean.slug, storeId);
      }
      Object.assign(current, {
        slug: clean.slug,
        name: clean.name,
        description: clean.description,
        image_url: clean.imageUrl,
        banner_url: clean.bannerUrl,
        state: nextState,
        version: current.version + 1,
        updated_at: nowIso(),
      });
      for (const listing of mem.nativeListings.values()) {
        if (listing.storefront_id === storeId) projectListingMemory(listing.id);
      }
    });
  } else {
    try {
      await transaction(p, async (client) => {
        const locked = await client.query(
          "SELECT * FROM storefronts WHERE owner_account_id=$1 FOR UPDATE",
          [owner],
        );
        const current = locked.rows[0];
        if (!current) throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
        if (Number(current.version) !== expected) {
          throw new StorefrontRefused("STALE_VERSION", "the storefront changed; reload before saving", 409);
        }
        const clean = normalizedStorefrontPayload({
          name: input.name ?? current.name,
          slug: input.slug ?? current.slug,
          description: input.description ?? current.description,
          imageUrl: input.imageUrl ?? current.image_url,
          bannerUrl: input.bannerUrl === undefined ? current.banner_url : input.bannerUrl,
        });
        const nextState = ownerStoreState(input.status ?? input.state ?? current.state, current.state);
        await client.query(
          `UPDATE storefronts SET slug=$2,name=$3,description=$4,image_url=$5,banner_url=$6,
             state=$7,version=version+1,updated_at=now()
           WHERE id=$1`,
          [current.id, clean.slug, clean.name, clean.description, clean.imageUrl, clean.bannerUrl, nextState],
        );
        const listingIds = await client.query("SELECT id FROM native_listings WHERE storefront_id=$1", [current.id]);
        for (const row of listingIds.rows) await projectListingPg(client, row.id);
      });
    } catch (error) {
      if (error instanceof StorefrontRefused) throw error;
      pgConflict(error);
    }
  }
  return loadOwnerEnvelope(owner);
}

function fulfillmentObject(value, fallback = { shipping: true, pickup: false }) {
  if (value == null) return { ...fallback };
  if (typeof value === "string") {
    if (value === "pickup") return { shipping: false, pickup: true };
    if (value === "shipping_or_pickup") return { shipping: true, pickup: true };
    return { shipping: true, pickup: false };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StorefrontRefused("INVALID_FULFILLMENT", "fulfillment must name shipping or pickup", 400);
  }
  const out = { shipping: value.shipping === true, pickup: value.pickup === true };
  if (!out.shipping && !out.pickup) {
    throw new StorefrontRefused("INVALID_FULFILLMENT", "at least one fulfillment method is required", 400);
  }
  return out;
}

function fulfillmentContract(value) {
  if (value.shipping && value.pickup) return "shipping_or_pickup";
  return value.pickup ? "pickup" : "shipping";
}

function photoList(value, fallback = []) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new StorefrontRefused("INVALID_PHOTOS", "photos must be a list", 400);
  const result = [];
  for (const candidate of value.slice(0, MAX_PHOTOS)) {
    const clean = safePublicImageUrl(candidate);
    if (!clean) throw new StorefrontRefused("INVALID_PHOTO", "product photos must use public https URLs", 400);
    if (!result.includes(clean)) result.push(clean);
  }
  return result;
}

function optionValues(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StorefrontRefused("INVALID_VARIANT_OPTIONS", "variant options must be an object", 400);
  }
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 16)) {
    const key = plainText(rawKey, 40).toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/\s+/g, "_");
    if (!key || rawValue == null || rawValue === "") continue;
    if (!["string", "number", "boolean"].includes(typeof rawValue)) continue;
    out[key] = typeof rawValue === "string" ? plainText(rawValue, 120) : rawValue;
  }
  return out;
}

function listingState(value, fallback = "draft") {
  const state = String(value ?? fallback);
  // KEEPING THE CURRENT STATE ASSERTS NOTHING (slice 6 review finding): an
  // owner editing a live listing — a relist, a photograph, a price — is not
  // publishing it; only a CHANGE to active or rejected is moderation's.
  if (state === fallback) return state;
  if (state === "active" || state === "rejected") {
    throw new StorefrontRefused(
      "PUBLICATION_DISABLED",
      "listing publication requires moderation and payment readiness",
      409,
    );
  }
  if (!OWNER_LISTING_STATES.has(state) || !LISTING_STATES.includes(state)) {
    throw new StorefrontRefused("INVALID_STATE", "unsupported listing status", 400);
  }
  return state;
}

function normalizedVariant(raw, fallback, base, index) {
  const existing = fallback || {};
  const id = raw?.id ? uuid(raw.id, "variant id") : existing.id || newId();
  const label = plainText(raw?.label ?? existing.label ?? (index === 0 ? "Default" : `Variant ${index + 1}`), 100);
  if (!label) throw new StorefrontRefused("INVALID_VARIANT", "variant label is required", 400);
  const sku = plainText(raw?.sku ?? existing.sku ?? "", 80) || null;
  const priceCents = positiveInt(raw?.priceCents ?? existing.price_cents ?? base.priceCents, "variant price cents");
  const stockOnHand = nonnegativeInt(
    raw?.stockOnHand ?? raw?.inventory ?? raw?.quantity ?? existing.stock_on_hand ?? base.quantity,
    "variant stock",
  );
  const currency = String(raw?.currency || existing.currency || base.currency || "usd").toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new StorefrontRefused("INVALID_CURRENCY", "currency must be a three-letter ISO code", 400);
  }
  const state = String(raw?.status ?? raw?.state ?? existing.state ?? "active");
  if (!VARIANT_STATES.has(state)) {
    throw new StorefrontRefused("INVALID_STATE", "unsupported variant status", 400);
  }
  return {
    id,
    label,
    sku,
    option_values: optionValues(raw?.optionValues ?? existing.option_values),
    price_cents: priceCents,
    currency,
    stock_on_hand: stockOnHand,
    stock_reserved: Number(existing.stock_reserved || 0),
    state,
    is_default: index === 0,
    version: Number(existing.version || 0) + (existing.id ? 1 : 1),
  };
}

function normalizeListingPayload(input = {}, current = null, currentVariants = []) {
  const defaultCurrent = currentVariants.find((variant) => variant.is_default) || currentVariants[0] || null;
  const inputVariants = Array.isArray(input.variants) && input.variants.length ? input.variants : null;
  if (inputVariants && inputVariants.length > MAX_VARIANTS) {
    throw new StorefrontRefused("TOO_MANY_VARIANTS", `a listing supports at most ${MAX_VARIANTS} variants`, 400);
  }
  const firstInput = inputVariants?.[0] || null;
  const basePrice = input.priceCents ?? firstInput?.priceCents ?? defaultCurrent?.price_cents;
  const baseQuantity = input.inventory ?? input.quantity ?? firstInput?.stockOnHand
    ?? defaultCurrent?.stock_on_hand ?? 0;
  const fulfillment = fulfillmentObject(input.fulfillment, current?.fulfillment || { shipping: true, pickup: false });
  let normalized;
  try {
    normalized = normalizeListingInput({
      title: input.title ?? current?.title,
      description: input.description ?? current?.description,
      category: input.category ?? current?.category,
      subcategory: input.subcategory === undefined ? current?.subcategory : input.subcategory,
      priceCents: basePrice,
      currency: String(input.currency ?? defaultCurrent?.currency ?? "usd").toLowerCase(),
      quantity: baseQuantity,
      sku: input.sku ?? defaultCurrent?.sku,
      imageUrl: Array.isArray(input.photos) ? input.photos[0] : null,
      fulfillment: fulfillmentContract(fulfillment),
      attributes: input.attributes ?? current?.attributes ?? {},
    });
  } catch (error) {
    throw new StorefrontRefused("INVALID_LISTING", error.message || "invalid listing", 400);
  }

  const photos = photoList(
    input.photos === undefined && input.imageUrl !== undefined ? [input.imageUrl] : input.photos,
    current?.photos || [],
  );
  const condition = plainText(input.condition === undefined ? current?.condition : input.condition, 80) || null;
  let variants;
  if (inputVariants) {
    variants = inputVariants.map((raw, index) => normalizedVariant(
      raw,
      raw?.id
        ? currentVariants.find((variant) => String(variant.id) === String(raw.id))
        : currentVariants[index],
      normalized,
      index,
    ));
  } else if (currentVariants.length) {
    variants = currentVariants.map((variant, index) => {
      if (index !== currentVariants.indexOf(defaultCurrent)) {
        return normalizedVariant({}, variant, normalized, index);
      }
      return normalizedVariant({
        priceCents: input.priceCents,
        stockOnHand: input.inventory ?? input.quantity,
        sku: input.sku,
      }, variant, normalized, 0);
    });
    const defaultIndex = variants.findIndex((variant) => variant.id === defaultCurrent.id);
    if (defaultIndex > 0) variants = [variants[defaultIndex], ...variants.filter((_, index) => index !== defaultIndex)];
    variants.forEach((variant, index) => { variant.is_default = index === 0; });
  } else {
    variants = [normalizedVariant({
      label: "Default",
      sku: normalized.sku,
      priceCents: normalized.priceCents,
      stockOnHand: normalized.quantity,
    }, null, normalized, 0)];
  }
  const seenIds = new Set();
  for (const variant of variants) {
    if (seenIds.has(variant.id)) throw new StorefrontRefused("DUPLICATE_VARIANT", "variant ids must be unique", 400);
    seenIds.add(variant.id);
    if (variant.stock_on_hand < variant.stock_reserved) {
      throw new StorefrontRefused(
        "INVENTORY_RESERVED",
        "stock cannot be reduced below quantity reserved by pending checkouts",
        409,
      );
    }
  }
  return {
    title: normalized.title,
    description: normalized.description,
    category: normalized.category,
    subcategory: normalized.subcategory,
    condition,
    photos,
    attributes: normalized.attributes,
    fulfillment,
    state: listingState(input.status ?? input.state, current?.state || "draft"),
    variants,
  };
}

function projectionFacts(store, listing, variants) {
  const activeVariants = variants.filter((variant) => variant.state === "active");
  const defaultVariant = variants.find((variant) => variant.is_default) || variants[0];
  const inventoryAvailable = activeVariants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.stock_on_hand) - Number(variant.stock_reserved)),
    0,
  );
  const visible = store.state === "active" && listing.state === "active";
  const isAvailable = visible && inventoryAvailable > 0;
  const moderationStatus = visible
    ? "visible"
    : (["archived", "rejected"].includes(listing.state) || store.state === "archived" ? "deleted" : "under_review");
  return { defaultVariant, inventoryAvailable, visible, isAvailable, moderationStatus };
}

function projectListingMemory(listingId) {
  const listing = mem.nativeListings.get(String(listingId));
  if (!listing) return null;
  const store = mem.storefronts.get(listing.storefront_id);
  if (!store) return null;
  const variants = [...mem.nativeVariants.values()].filter((variant) => variant.listing_id === listing.id);
  const facts = projectionFacts(store, listing, variants);
  if (!facts.defaultVariant) return null;
  const prior = catalogMem.items.get(listingItemId(listing.id));
  const attributes = listing.attributes || {};
  const item = {
    id: listingItemId(listing.id),
    title: listing.title,
    brand: store.name,
    price: facts.defaultVariant.price_cents / 100,
    price_cents: facts.defaultVariant.price_cents,
    currency: facts.defaultVariant.currency,
    tags: {},
    img: listing.photos?.[0] || null,
    alt: listing.title,
    source: "asilum-native",
    source_name: "asilum-native",
    source_product_id: listing.id,
    source_product_url: null,
    url: null,
    designers: [store.name],
    category: listing.category,
    description: listing.description,
    subcategory: listing.subcategory,
    color: attributes.color || null,
    material: attributes.material || null,
    condition: listing.condition || attributes.condition || null,
    is_available: facts.isAvailable,
    availability_status: facts.isAvailable ? "available" : (facts.visible ? "sold" : "unknown"),
    moderation_status: facts.moderationStatus,
    commerce_rail: "native_storefront",
    storefront_slug: store.slug,
    native_listing_id: listing.id,
    default_variant_id: facts.defaultVariant.id,
    inventory_available: facts.inventoryAvailable,
    listing_version: listing.version,
    native_checkout_ready: prior?.native_checkout_ready === true,
    created_at: prior?.created_at || listing.created_at,
    updated_at: nowIso(),
  };
  catalogMem.items.set(item.id, item);
  return item;
}

async function projectListingPg(client, listingId) {
  const result = await client.query(
    `SELECT l.*,s.slug AS storefront_slug,s.name AS storefront_name,s.state AS storefront_state
       FROM native_listings l JOIN storefronts s ON s.id=l.storefront_id
      WHERE l.id=$1`,
    [listingId],
  );
  const listing = result.rows[0];
  if (!listing) return null;
  const variantResult = await client.query(
    "SELECT * FROM native_listing_variants WHERE listing_id=$1 ORDER BY is_default DESC,created_at,id",
    [listing.id],
  );
  const facts = projectionFacts(
    { state: listing.storefront_state, name: listing.storefront_name, slug: listing.storefront_slug },
    listing,
    variantResult.rows,
  );
  if (!facts.defaultVariant) return null;
  const attributes = listing.attributes || {};
  const itemId = listingItemId(listing.id);
  await client.query(
    `INSERT INTO items
       (id,title,brand,price,price_cents,currency,tags,img,alt,source,designers,category,url,
        source_name,source_product_id,source_product_url,description,subcategory,color,material,
        condition,is_available,availability_status,moderation_status,commerce_rail,storefront_slug,
        native_listing_id,default_variant_id,inventory_available,listing_version,native_checkout_ready,updated_at)
     VALUES
       ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7,$2,'asilum-native',$8::jsonb,$9,NULL,
        'asilum-native',$10,NULL,$11,$12,$13,$14,$15,$16,$17,$18,'native_storefront',$19,
        $20,$21,$22,$23,false,now())
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title,brand=EXCLUDED.brand,price=EXCLUDED.price,price_cents=EXCLUDED.price_cents,
       currency=EXCLUDED.currency,img=EXCLUDED.img,alt=EXCLUDED.alt,source='asilum-native',
       designers=EXCLUDED.designers,category=EXCLUDED.category,url=NULL,source_name='asilum-native',
       source_product_id=EXCLUDED.source_product_id,source_product_url=NULL,
       description=EXCLUDED.description,subcategory=EXCLUDED.subcategory,color=EXCLUDED.color,
       material=EXCLUDED.material,condition=EXCLUDED.condition,is_available=EXCLUDED.is_available,
       availability_status=EXCLUDED.availability_status,moderation_status=EXCLUDED.moderation_status,
       commerce_rail='native_storefront',storefront_slug=EXCLUDED.storefront_slug,
       native_listing_id=EXCLUDED.native_listing_id,default_variant_id=EXCLUDED.default_variant_id,
       inventory_available=EXCLUDED.inventory_available,listing_version=EXCLUDED.listing_version,
       updated_at=now()`,
    [
      itemId,
      listing.title,
      listing.storefront_name,
      Number(facts.defaultVariant.price_cents) / 100,
      Number(facts.defaultVariant.price_cents),
      facts.defaultVariant.currency,
      listing.photos?.[0] || null,
      JSON.stringify([listing.storefront_name]),
      listing.category,
      String(listing.id),
      listing.description,
      listing.subcategory,
      attributes.color || null,
      attributes.material || null,
      listing.condition || attributes.condition || null,
      facts.isAvailable,
      facts.isAvailable ? "available" : (facts.visible ? "sold" : "unknown"),
      facts.moderationStatus,
      listing.storefront_slug,
      listing.id,
      facts.defaultVariant.id,
      facts.inventoryAvailable,
      Number(listing.version),
    ],
  );
  return itemId;
}

async function ownerStoreForWriteMemory(owner) {
  const storeId = mem.storefrontOwners.get(owner);
  const store = storeId ? mem.storefronts.get(storeId) : null;
  if (!store) throw new StorefrontRefused("STORE_NOT_FOUND", "create a storefront first", 404);
  if (["archived", "rejected"].includes(store.state)) {
    throw new StorefrontRefused("STORE_NOT_EDITABLE", "this storefront cannot manage listings", 409);
  }
  return store;
}

function listingCreateFingerprint(clean) {
  const canonical = {
    title: clean.title,
    description: clean.description,
    category: clean.category,
    subcategory: clean.subcategory,
    condition: clean.condition,
    photos: clean.photos,
    attributes: clean.attributes,
    fulfillment: clean.fulfillment,
    state: clean.state,
    variants: clean.variants.map((variant) => ({
      label: variant.label,
      sku: variant.sku,
      option_values: variant.option_values,
      price_cents: variant.price_cents,
      currency: variant.currency,
      stock_on_hand: variant.stock_on_hand,
      state: variant.state,
      is_default: variant.is_default,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function createStorefrontListing(ownerRaw, input = {}) {
  requireOwnerListingWrite();
  const owner = accountId(ownerRaw);
  const clean = normalizeListingPayload(input);
  const requestFingerprint = listingCreateFingerprint(clean);
  const op = input.operationKey ? operationKey(input.operationKey) : null;
  const p = await getPool();
  await requireSchema(p);
  let listingId = null;
  let duplicate = false;

  if (!p) {
    const store = await ownerStoreForWriteMemory(owner);
    await withOrderedUserLocks([`storefront:${store.id}`], async () => {
      if (op) {
        const prior = mem.nativeListingOperations.get(`${store.id}|${op}`);
        if (prior) {
          const priorListing = mem.nativeListings.get(prior);
          if (priorListing?.request_fingerprint !== requestFingerprint) idempotencyConflict();
          listingId = prior; duplicate = true; return;
        }
      }
      const at = nowIso();
      listingId = newId();
      mem.nativeListings.set(listingId, {
        id: listingId,
        storefront_id: store.id,
        operation_key: op,
        request_fingerprint: requestFingerprint,
        title: clean.title,
        description: clean.description,
        category: clean.category,
        subcategory: clean.subcategory,
        condition: clean.condition,
        photos: clean.photos,
        attributes: clean.attributes,
        fulfillment: clean.fulfillment,
        state: clean.state,
        version: 1,
        created_at: at,
        updated_at: at,
      });
      for (const variant of clean.variants) {
        mem.nativeVariants.set(variant.id, {
          ...variant,
          listing_id: listingId,
          version: 1,
          created_at: at,
          updated_at: at,
        });
      }
      if (op) mem.nativeListingOperations.set(`${store.id}|${op}`, listingId);
      projectListingMemory(listingId);
    });
  } else {
    try {
      const result = await transaction(p, async (client) => {
        const storeResult = await client.query(
          "SELECT * FROM storefronts WHERE owner_account_id=$1 FOR UPDATE",
          [owner],
        );
        const store = storeResult.rows[0];
        if (!store) throw new StorefrontRefused("STORE_NOT_FOUND", "create a storefront first", 404);
        if (["archived", "rejected"].includes(store.state)) {
          throw new StorefrontRefused("STORE_NOT_EDITABLE", "this storefront cannot manage listings", 409);
        }
        if (op) {
          const prior = await client.query(
            "SELECT id,request_fingerprint FROM native_listings WHERE storefront_id=$1 AND operation_key=$2",
            [store.id, op],
          );
          if (prior.rows[0]) {
            if (prior.rows[0].request_fingerprint !== requestFingerprint) idempotencyConflict();
            return { id: prior.rows[0].id, duplicate: true };
          }
        }
        const id = newId();
        await client.query(
          `INSERT INTO native_listings
             (id,storefront_id,operation_key,request_fingerprint,title,description,category,subcategory,condition,
              photos,attributes,fulfillment,state,version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,1)`,
          [id, store.id, op, requestFingerprint, clean.title, clean.description, clean.category, clean.subcategory,
            clean.condition, JSON.stringify(clean.photos), JSON.stringify(clean.attributes),
            JSON.stringify(clean.fulfillment), clean.state],
        );
        for (const variant of clean.variants) {
          await client.query(
            `INSERT INTO native_listing_variants
               (id,listing_id,label,sku,option_values,price_cents,currency,stock_on_hand,
                stock_reserved,state,is_default,version)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,0,$9,$10,1)`,
            [variant.id, id, variant.label, variant.sku, JSON.stringify(variant.option_values),
              variant.price_cents, variant.currency, variant.stock_on_hand, variant.state, variant.is_default],
          );
        }
        await projectListingPg(client, id);
        return { id, duplicate: false };
      });
      listingId = result.id;
      duplicate = result.duplicate;
    } catch (error) {
      if (error instanceof StorefrontRefused) throw error;
      pgConflict(error, "the listing could not be created");
    }
  }
  return { ...(await loadOwnerEnvelope(owner)), listingId: String(listingId), duplicate };
}

function listingForOwnerMemory(owner, listingId) {
  const listing = mem.nativeListings.get(listingId);
  if (!listing) return null;
  const store = mem.storefronts.get(listing.storefront_id);
  return store?.owner_account_id === owner ? { store, listing } : null;
}

export async function updateStorefrontListing(ownerRaw, listingIdRaw, input = {}) {
  requireOwnerListingWrite();
  const owner = accountId(ownerRaw);
  const listingId = uuid(listingIdRaw, "listing id");
  const expected = positiveInt(input.version, "listing version");
  const replacingVariants = Array.isArray(input.variants) && input.variants.length > 0;
  const p = await getPool();
  await requireSchema(p);

  if (!p) {
    const pair = listingForOwnerMemory(owner, listingId);
    if (!pair) throw new StorefrontRefused("LISTING_NOT_FOUND", "listing not found", 404);
    await withOrderedUserLocks([`storefront:${pair.store.id}`, `listing:${listingId}`], async () => {
      const current = mem.nativeListings.get(listingId);
      if (Number(current.version) !== expected) {
        throw new StorefrontRefused("STALE_VERSION", "the listing changed; reload before saving", 409);
      }
      const currentVariants = [...mem.nativeVariants.values()]
        .filter((variant) => variant.listing_id === listingId)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || String(a.created_at).localeCompare(String(b.created_at)));
      const clean = normalizeListingPayload(input, current, currentVariants);
      const submittedVariantIds = new Set(clean.variants.map((variant) => variant.id));
      const omittedVariants = replacingVariants
        ? currentVariants.filter((variant) => !submittedVariantIds.has(variant.id))
        : [];
      if (omittedVariants.some((variant) => Number(variant.stock_reserved) > 0)) {
        throw new StorefrontRefused(
          "INVENTORY_RESERVED",
          "a variant with pending inventory reservations cannot be removed",
          409,
        );
      }
      Object.assign(current, {
        title: clean.title,
        description: clean.description,
        category: clean.category,
        subcategory: clean.subcategory,
        condition: clean.condition,
        photos: clean.photos,
        attributes: clean.attributes,
        fulfillment: clean.fulfillment,
        state: clean.state,
        version: current.version + 1,
        updated_at: nowIso(),
      });
      const at = nowIso();
      for (const variant of currentVariants) variant.is_default = false;
      for (const variant of omittedVariants) {
        variant.state = "archived";
        variant.version += 1;
        variant.updated_at = at;
      }
      for (const cleanVariant of clean.variants) {
        const prior = mem.nativeVariants.get(cleanVariant.id);
        if (prior && prior.listing_id !== listingId) {
          throw new StorefrontRefused("VARIANT_NOT_FOUND", "variant does not belong to this listing", 404);
        }
        mem.nativeVariants.set(cleanVariant.id, {
          ...cleanVariant,
          listing_id: listingId,
          version: prior ? prior.version + 1 : 1,
          created_at: prior?.created_at || at,
          updated_at: at,
        });
      }
      projectListingMemory(listingId);
    });
  } else {
    try {
      await transaction(p, async (client) => {
        const listingResult = await client.query(
          `SELECT l.*,s.owner_account_id,s.state AS storefront_state
             FROM native_listings l JOIN storefronts s ON s.id=l.storefront_id
            WHERE l.id=$1 FOR UPDATE OF l,s`,
          [listingId],
        );
        const current = listingResult.rows[0];
        if (!current || String(current.owner_account_id) !== owner) {
          throw new StorefrontRefused("LISTING_NOT_FOUND", "listing not found", 404);
        }
        if (Number(current.version) !== expected) {
          throw new StorefrontRefused("STALE_VERSION", "the listing changed; reload before saving", 409);
        }
        if (["archived", "rejected"].includes(current.storefront_state)) {
          throw new StorefrontRefused("STORE_NOT_EDITABLE", "this storefront cannot manage listings", 409);
        }
        const variantResult = await client.query(
          "SELECT * FROM native_listing_variants WHERE listing_id=$1 ORDER BY is_default DESC,created_at,id FOR UPDATE",
          [listingId],
        );
        const clean = normalizeListingPayload(input, current, variantResult.rows);
        const submittedVariantIds = clean.variants.map((variant) => variant.id);
        const omittedVariants = replacingVariants
          ? variantResult.rows.filter((variant) => !submittedVariantIds.includes(String(variant.id)))
          : [];
        if (omittedVariants.some((variant) => Number(variant.stock_reserved) > 0)) {
          throw new StorefrontRefused(
            "INVENTORY_RESERVED",
            "a variant with pending inventory reservations cannot be removed",
            409,
          );
        }
        await client.query(
          `UPDATE native_listings SET title=$2,description=$3,category=$4,subcategory=$5,
             condition=$6,photos=$7::jsonb,attributes=$8::jsonb,fulfillment=$9::jsonb,
             state=$10,version=version+1,updated_at=now()
           WHERE id=$1`,
          [listingId, clean.title, clean.description, clean.category, clean.subcategory,
            clean.condition, JSON.stringify(clean.photos), JSON.stringify(clean.attributes),
            JSON.stringify(clean.fulfillment), clean.state],
        );
        await client.query("UPDATE native_listing_variants SET is_default=false WHERE listing_id=$1", [listingId]);
        if (replacingVariants && omittedVariants.length) {
          await client.query(
            `UPDATE native_listing_variants
                SET state='archived',is_default=false,version=version+1,updated_at=now()
              WHERE listing_id=$1 AND NOT (id=ANY($2::uuid[]))`,
            [listingId, submittedVariantIds],
          );
        }
        for (const variant of clean.variants) {
          const prior = variantResult.rows.find((row) => String(row.id) === variant.id);
          if (prior) {
            await client.query(
              `UPDATE native_listing_variants SET label=$3,sku=$4,option_values=$5::jsonb,
                 price_cents=$6,currency=$7,stock_on_hand=$8,state=$9,is_default=$10,
                 version=version+1,updated_at=now()
               WHERE id=$1 AND listing_id=$2`,
              [variant.id, listingId, variant.label, variant.sku, JSON.stringify(variant.option_values),
                variant.price_cents, variant.currency, variant.stock_on_hand, variant.state, variant.is_default],
            );
          } else {
            await client.query(
              `INSERT INTO native_listing_variants
                 (id,listing_id,label,sku,option_values,price_cents,currency,stock_on_hand,
                  stock_reserved,state,is_default,version)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,0,$9,$10,1)`,
              [variant.id, listingId, variant.label, variant.sku, JSON.stringify(variant.option_values),
                variant.price_cents, variant.currency, variant.stock_on_hand, variant.state, variant.is_default],
            );
          }
        }
        await projectListingPg(client, listingId);
      });
    } catch (error) {
      if (error instanceof StorefrontRefused) throw error;
      if (error?.code === "23514" && String(error.constraint || "").includes("reserved")) {
        throw new StorefrontRefused(
          "INVENTORY_RESERVED",
          "stock cannot be reduced below quantity reserved by pending checkouts",
          409,
        );
      }
      pgConflict(error, "the listing could not be updated");
    }
  }
  return loadOwnerEnvelope(owner);
}

export function archiveStorefrontListing(owner, listingId, version) {
  return updateStorefrontListing(owner, listingId, { version, status: "archived" });
}

function moderationState(value, kind) {
  const state = String(value || "");
  if (!["active", "rejected"].includes(state)) {
    throw new StorefrontRefused("INVALID_STATE", `${kind} moderation must decide active or rejected`, 400);
  }
  return state;
}

function moderationActor(value) {
  const actor = plainText(value, 200);
  if (!actor) throw new StorefrontRefused("MODERATOR_REQUIRED", "a moderator identity is required", 400);
  return actor;
}

/** Trusted server/admin transition. This is intentionally not exposed by the owner API. */
export async function applyStorefrontModerationDecision({ storefrontId: rawId, state: rawState, actor: rawActor, note = "" } = {}) {
  const storefrontId = uuid(rawId, "storefront id");
  const state = moderationState(rawState, "storefront");
  const actor = moderationActor(rawActor);
  const cleanNote = plainText(note, 500) || null;
  const p = await getPool();
  await requireSchema(p);

  if (!p) {
    await withOrderedUserLocks([`storefront:${storefrontId}`], async () => {
      const row = mem.storefronts.get(storefrontId);
      if (!row) throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
      if (row.state !== "pending_review") {
        throw new StorefrontRefused("INVALID_TRANSITION", "storefront must be pending review", 409);
      }
      const at = nowIso();
      Object.assign(row, {
        state, moderation_actor: actor, moderation_note: cleanNote,
        moderated_at: at, updated_at: at, version: Number(row.version) + 1,
      });
      for (const listing of mem.nativeListings.values()) {
        if (listing.storefront_id === storefrontId) projectListingMemory(listing.id);
      }
    });
    return storefrontRowOut(mem.storefronts.get(storefrontId));
  }

  return transaction(p, async (client) => {
    const result = await client.query("SELECT * FROM storefronts WHERE id=$1 FOR UPDATE", [storefrontId]);
    const row = result.rows[0];
    if (!row) throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
    if (row.state !== "pending_review") {
      throw new StorefrontRefused("INVALID_TRANSITION", "storefront must be pending review", 409);
    }
    const updated = await client.query(
      `UPDATE storefronts SET state=$2,moderation_actor=$3,moderation_note=$4,
         moderated_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
      [storefrontId, state, actor, cleanNote],
    );
    const listingIds = await client.query("SELECT id FROM native_listings WHERE storefront_id=$1", [storefrontId]);
    for (const listing of listingIds.rows) await projectListingPg(client, listing.id);
    return storefrontRowOut(updated.rows[0]);
  });
}

/** Trusted server/admin transition. Owners can only request pending_review. */
export async function applyStorefrontListingModerationDecision({ listingId: rawId, state: rawState, actor: rawActor, note = "" } = {}) {
  const listingId = uuid(rawId, "listing id");
  const state = moderationState(rawState, "listing");
  const actor = moderationActor(rawActor);
  const cleanNote = plainText(note, 500) || null;
  const p = await getPool();
  await requireSchema(p);

  if (!p) {
    const listing = mem.nativeListings.get(listingId);
    if (!listing) throw new StorefrontRefused("LISTING_NOT_FOUND", "listing not found", 404);
    await withOrderedUserLocks([`storefront:${listing.storefront_id}`, `listing:${listingId}`], async () => {
      const current = mem.nativeListings.get(listingId);
      const store = mem.storefronts.get(current.storefront_id);
      if (current.state !== "pending_review") {
        throw new StorefrontRefused("INVALID_TRANSITION", "listing must be pending review", 409);
      }
      if (state === "active" && store?.state !== "active") {
        throw new StorefrontRefused("STORE_NOT_ACTIVE", "the storefront must be active first", 409);
      }
      const at = nowIso();
      Object.assign(current, {
        state, moderation_actor: actor, moderation_note: cleanNote,
        moderated_at: at, updated_at: at, version: Number(current.version) + 1,
      });
      projectListingMemory(listingId);
    });
    const current = mem.nativeListings.get(listingId);
    const variants = [...mem.nativeVariants.values()].filter((row) => row.listing_id === listingId);
    return listingRowOut(current, variants);
  }

  return transaction(p, async (client) => {
    const result = await client.query(
      `SELECT l.*,s.state AS storefront_state FROM native_listings l
         JOIN storefronts s ON s.id=l.storefront_id WHERE l.id=$1 FOR UPDATE OF l,s`,
      [listingId],
    );
    const row = result.rows[0];
    if (!row) throw new StorefrontRefused("LISTING_NOT_FOUND", "listing not found", 404);
    if (row.state !== "pending_review") {
      throw new StorefrontRefused("INVALID_TRANSITION", "listing must be pending review", 409);
    }
    if (state === "active" && row.storefront_state !== "active") {
      throw new StorefrontRefused("STORE_NOT_ACTIVE", "the storefront must be active first", 409);
    }
    const updated = await client.query(
      `UPDATE native_listings SET state=$2,moderation_actor=$3,moderation_note=$4,
         moderated_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
      [listingId, state, actor, cleanNote],
    );
    await projectListingPg(client, listingId);
    const variants = await client.query(
      "SELECT * FROM native_listing_variants WHERE listing_id=$1 ORDER BY is_default DESC,created_at,id",
      [listingId],
    );
    return listingRowOut(updated.rows[0], variants.rows);
  });
}

function paymentAccountOut(row) {
  if (!row) return null;
  return {
    storefrontId: String(row.storefront_id),
    stripeAccountId: row.stripe_account_id || null,
    expectedLivemode: row.expected_livemode === true,
    detailsSubmitted: row.details_submitted === true,
    chargesEnabled: row.charges_enabled === true,
    payoutsEnabled: row.payouts_enabled === true,
    feePayer: row.fee_payer || null,
    lossesCollector: row.losses_collector || null,
    capabilitySnapshot: row.capability_snapshot || {},
    validationVersion: row.validation_version || null,
    validatedAt: dateIso(row.validated_at),
    providerRetrievedAt: dateIso(row.provider_retrieved_at),
    onboardingState: paymentOnboardingState(row),
  };
}

/** Persist only provider-retrieved Connect state. Never accept this object from a browser. */
export async function syncStorefrontPaymentAccount({
  storefrontId: rawId,
  stripeAccountId: rawAccount,
  expectedLivemode = false,
  detailsSubmitted = false,
  chargesEnabled = false,
  payoutsEnabled = false,
  feePayer = null,
  lossesCollector = null,
  capabilitySnapshot = {},
  validationVersion = null,
  validatedAt = null,
  providerRetrievedAt = null,
} = {}) {
  const storefrontId = uuid(rawId, "storefront id");
  const stripeAccountId = String(rawAccount || "");
  if (!/^acct_[A-Za-z0-9_]{4,250}$/.test(stripeAccountId)) {
    throw new StorefrontRefused("INVALID_PROVIDER_ID", "Stripe account id is invalid", 400);
  }
  if (typeof expectedLivemode !== "boolean" || typeof detailsSubmitted !== "boolean"
    || typeof chargesEnabled !== "boolean" || typeof payoutsEnabled !== "boolean") {
    throw new StorefrontRefused("INVALID_PAYMENT_STATE", "payment capability flags must be boolean", 400);
  }
  if (!capabilitySnapshot || typeof capabilitySnapshot !== "object" || Array.isArray(capabilitySnapshot)) {
    throw new StorefrontRefused("INVALID_PAYMENT_STATE", "capability snapshot must be an object", 400);
  }
  const at = nowIso();
  const row = {
    storefront_id: storefrontId,
    stripe_account_id: stripeAccountId,
    expected_livemode: expectedLivemode,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    fee_payer: plainText(feePayer, 100) || null,
    losses_collector: plainText(lossesCollector, 100) || null,
    capability_snapshot: capabilitySnapshot,
    validation_version: plainText(validationVersion, 100) || null,
    validated_at: validatedAt ? dateIso(validatedAt) : null,
    provider_retrieved_at: providerRetrievedAt ? dateIso(providerRetrievedAt) : at,
    updated_at: at,
  };
  const p = await getPool();
  await requireSchema(p);

  if (!p) {
    await withOrderedUserLocks([`storefront:${storefrontId}`, `stripe-account:${stripeAccountId}`], async () => {
      if (!mem.storefronts.has(storefrontId)) {
        throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
      }
      for (const [id, existing] of mem.storefrontPaymentAccounts) {
        if (id !== storefrontId && existing.stripe_account_id === stripeAccountId) {
          throw new StorefrontRefused("PAYMENT_ACCOUNT_IN_USE", "payment account already belongs to another storefront", 409);
        }
      }
      const existing = mem.storefrontPaymentAccounts.get(storefrontId);
      mem.storefrontPaymentAccounts.set(storefrontId, { ...existing, ...row, created_at: existing?.created_at || at });
    });
    return paymentAccountOut(mem.storefrontPaymentAccounts.get(storefrontId));
  }

  try {
    const result = await p.query(
      `INSERT INTO storefront_payment_accounts
         (storefront_id,stripe_account_id,expected_livemode,details_submitted,charges_enabled,
          payouts_enabled,fee_payer,losses_collector,capability_snapshot,validation_version,
          validated_at,provider_retrieved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       ON CONFLICT (storefront_id) DO UPDATE SET
         stripe_account_id=EXCLUDED.stripe_account_id,
         expected_livemode=EXCLUDED.expected_livemode,
         details_submitted=EXCLUDED.details_submitted,
         charges_enabled=EXCLUDED.charges_enabled,
         payouts_enabled=EXCLUDED.payouts_enabled,
         fee_payer=EXCLUDED.fee_payer,losses_collector=EXCLUDED.losses_collector,
         capability_snapshot=EXCLUDED.capability_snapshot,
         validation_version=EXCLUDED.validation_version,validated_at=EXCLUDED.validated_at,
         provider_retrieved_at=EXCLUDED.provider_retrieved_at,updated_at=now()
       RETURNING *`,
      [storefrontId, stripeAccountId, expectedLivemode, detailsSubmitted, chargesEnabled,
        payoutsEnabled, row.fee_payer, row.losses_collector, JSON.stringify(capabilitySnapshot),
        row.validation_version, row.validated_at, row.provider_retrieved_at],
    );
    return paymentAccountOut(result.rows[0]);
  } catch (error) {
    if (error?.code === "23503") throw new StorefrontRefused("STORE_NOT_FOUND", "storefront not found", 404);
    if (error?.code === "23505") {
      throw new StorefrontRefused("PAYMENT_ACCOUNT_IN_USE", "payment account already belongs to another storefront", 409);
    }
    throw error;
  }
}

export async function getStorefrontPaymentAccount(storefrontIdRaw) {
  const storefrontId = uuid(storefrontIdRaw, "storefront id");
  const p = await getPool();
  await requireSchema(p);
  const row = p
    ? (await p.query("SELECT * FROM storefront_payment_accounts WHERE storefront_id=$1", [storefrontId])).rows[0]
    : mem.storefrontPaymentAccounts.get(storefrontId);
  return paymentAccountOut(row || null);
}

function feeReservationOut(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    storefrontId: String(row.storefront_id),
    orderId: row.order_id,
    paymentAttemptId: row.payment_attempt_id ? String(row.payment_attempt_id) : null,
    operationKey: row.operation_key,
    amountCents: Number(row.amount_cents),
    state: row.state,
    expiresAt: dateIso(row.expires_at),
    terminalOperationKey: row.terminal_operation_key || null,
    terminalReason: row.terminal_reason || null,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
    terminalAt: dateIso(row.terminal_at),
  };
}

function feeEventOut(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    storefrontId: String(row.storefront_id),
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    orderId: row.order_id,
    paymentAttemptId: row.payment_attempt_id ? String(row.payment_attempt_id) : null,
    kind: row.kind,
    amountCents: Number(row.amount_cents),
    operationKey: row.operation_key,
    reversesEventId: row.reverses_event_id ? String(row.reverses_event_id) : null,
    stripeAccountId: row.stripe_account_id || null,
    stripeApplicationFeeId: row.stripe_application_fee_id || null,
    stripeFeeRefundId: row.stripe_fee_refund_id || null,
    stripeEventId: row.stripe_event_id || null,
    livemode: row.livemode == null ? null : row.livemode === true,
    currency: row.currency,
    createdAt: dateIso(row.created_at),
  };
}

function inventoryReservationOut(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    storefrontId: String(row.storefront_id),
    listingId: String(row.listing_id),
    variantId: String(row.variant_id),
    orderId: row.order_id,
    paymentAttemptId: row.payment_attempt_id ? String(row.payment_attempt_id) : null,
    operationKey: row.operation_key,
    quantity: Number(row.quantity),
    state: row.state,
    expiresAt: dateIso(row.expires_at),
    terminalOperationKey: row.terminal_operation_key || null,
    terminalReason: row.terminal_reason || null,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
    terminalAt: dateIso(row.terminal_at),
  };
}

function optionalAttemptId(value) {
  return value == null || value === "" ? null : uuid(value, "payment attempt id");
}

function optionalFuture(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new StorefrontRefused("INVALID_EXPIRY", "reservation expiry is invalid", 400);
  }
  return date.toISOString();
}

function providerId(value, name) {
  if (value == null || value === "") return null;
  const id = String(value);
  if (id.length > 255) throw new StorefrontRefused("INVALID_PROVIDER_ID", `${name} is too long`, 400);
  return id;
}

function stripeObjectId(value, prefix, name) {
  const id = providerId(value, name);
  if (id && !(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`)).test(id)) {
    throw new StorefrontRefused("INVALID_PROVIDER_ID", `${name} is invalid`, 400);
  }
  return id;
}

function requireCollectionProof({ providerAccount, applicationFee, providerEvent, livemode }) {
  if (!providerAccount || !applicationFee || !providerEvent || typeof livemode !== "boolean") {
    throw new StorefrontRefused(
      "PROVIDER_PROOF_REQUIRED",
      "verified Stripe account, application fee, event and mode are required",
      400,
    );
  }
}

function assertCollectionProofReplay(event, {
  providerAccount, applicationFee, providerEvent, livemode,
}) {
  requireCollectionProof({
    providerAccount: event?.stripe_account_id,
    applicationFee: event?.stripe_application_fee_id,
    providerEvent: event?.stripe_event_id,
    livemode: event?.livemode,
  });
  if ((providerAccount && providerAccount !== event.stripe_account_id)
    || (applicationFee && applicationFee !== event.stripe_application_fee_id)
    || (providerEvent && providerEvent !== event.stripe_event_id)
    || (livemode != null && livemode !== event.livemode)) idempotencyConflict();
}

function requireReversalProof(original, feeRefund, providerEvent) {
  requireCollectionProof({
    providerAccount: original?.stripe_account_id,
    applicationFee: original?.stripe_application_fee_id,
    providerEvent: original?.stripe_event_id,
    livemode: original?.livemode,
  });
  if (!feeRefund || !providerEvent) {
    throw new StorefrontRefused(
      "PROVIDER_PROOF_REQUIRED",
      "verified Stripe application-fee refund and event are required",
      400,
    );
  }
}

function assertReversalProofReplay(event, { feeRefund, providerEvent }) {
  if (!event?.stripe_account_id || !event?.stripe_application_fee_id
    || !event?.stripe_fee_refund_id || !event?.stripe_event_id
    || typeof event?.livemode !== "boolean") {
    throw new StorefrontRefused("PROVIDER_PROOF_REQUIRED", "stored reversal proof is incomplete", 409);
  }
  if ((feeRefund && feeRefund !== event.stripe_fee_refund_id)
    || (providerEvent && providerEvent !== event.stripe_event_id)) idempotencyConflict();
}

async function requireMemoryStorefrontOrder(orderId, storefrontId) {
  const order = await getOrder(orderId);
  if (!order || String(order.storefront_id || "") !== storefrontId) {
    throw new StorefrontRefused(
      "ORDER_STOREFRONT_MISMATCH",
      "the order does not belong to this storefront",
      409,
    );
  }
  return order;
}

async function requirePgStorefrontOrder(target, orderId, storefrontId) {
  const result = await target.query(
    "SELECT 1 FROM orders WHERE id=$1 AND storefront_id=$2",
    [orderId, storefrontId],
  );
  if (!result.rows[0]) {
    throw new StorefrontRefused(
      "ORDER_STOREFRONT_MISMATCH",
      "the order does not belong to this storefront",
      409,
    );
  }
}

async function pgFeeAccount(target, storefrontId, lock = false) {
  const result = await target.query(
    `SELECT * FROM storefront_fee_accounts WHERE storefront_id=$1${lock ? " FOR UPDATE" : ""}`,
    [storefrontId],
  );
  return result.rows[0] || null;
}

export async function getStorefrontFeeBalance(storefrontIdRaw) {
  const storefrontId = uuid(storefrontIdRaw, "storefront id");
  const p = await getPool();
  await requireSchema(p);
  const row = p
    ? await pgFeeAccount(p, storefrontId)
    : mem.storefrontFeeAccounts.get(storefrontId) || null;
  return feeBalanceOut(row);
}

/**
 * Reserve no more than the caller's already-computed safe proceeds bound and
 * no more than the unreserved lifetime remainder. This function moves no
 * provider money; confirmation is a separate verified-provider transition.
 */
export async function reserveStorefrontFee({
  storefrontId: storefrontIdRaw,
  orderId: orderIdRaw,
  paymentAttemptId = null,
  maximumCents,
  amountCents,
  operationKey: operationRaw,
  expiresAt = null,
} = {}) {
  const storefrontId = uuid(storefrontIdRaw, "storefront id");
  const orderId = orderKey(orderIdRaw);
  const attemptId = optionalAttemptId(paymentAttemptId);
  const maximum = nonnegativeInt(maximumCents ?? amountCents, "maximum safe collection cents");
  const op = operationKey(operationRaw);
  const expiry = optionalFuture(expiresAt);
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);

  if (!p) {
    return withOrderedUserLocks([`fee-op:${op}`, `storefront-fee:${storefrontId}`], async () => {
      const priorEventId = mem.storefrontFeeEventOps.get(op);
      if (priorEventId) {
        const event = mem.storefrontFeeEvents.find((entry) => entry.id === priorEventId);
        if (event?.kind !== "reserved") idempotencyConflict();
      }
      const priorId = mem.storefrontFeeReservationOps.get(op);
      if (priorId) {
        const prior = mem.storefrontFeeReservations.get(priorId);
        if (prior.storefront_id !== storefrontId || prior.order_id !== orderId
          || prior.payment_attempt_id !== attemptId
          || Number(prior.amount_cents) > maximum) idempotencyConflict();
        return {
          reservation: feeReservationOut(prior),
          feeBalance: feeBalanceOut(mem.storefrontFeeAccounts.get(storefrontId)),
          duplicate: true,
        };
      }
      const account = mem.storefrontFeeAccounts.get(storefrontId);
      if (!account) throw new StorefrontRefused("FEE_ACCOUNT_NOT_FOUND", "storefront fee account not found", 404);
      await requireMemoryStorefrontOrder(orderId, storefrontId);
      if (attemptId) {
        const attempt = mem.paymentAttempts.get(attemptId);
        if (!attempt || attempt.order_id !== orderId || attempt.storefront_id !== storefrontId) {
          throw new StorefrontRefused(
            "PAYMENT_ATTEMPT_MISMATCH",
            "the payment attempt does not belong to this storefront order",
            409,
          );
        }
      }
      if (attemptId && [...mem.storefrontFeeReservations.values()].some(
        (row) => row.order_id === orderId && row.payment_attempt_id === attemptId)) {
        throw new StorefrontRefused("RESERVATION_EXISTS", "that payment attempt already has a fee reservation", 409);
      }
      const unreserved = Math.max(0, account.target_cents - account.collected_cents - account.reserved_cents);
      const amount = Math.min(maximum, unreserved);
      if (amount === 0) return { reservation: null, feeBalance: feeBalanceOut(account), duplicate: false };
      const at = nowIso();
      const id = newId();
      const row = {
        id,
        storefront_id: storefrontId,
        order_id: orderId,
        payment_attempt_id: attemptId,
        operation_key: op,
        amount_cents: amount,
        state: "active",
        expires_at: expiry,
        terminal_operation_key: null,
        terminal_reason: null,
        created_at: at,
        updated_at: at,
        terminal_at: null,
      };
      mem.storefrontFeeReservations.set(id, row);
      mem.storefrontFeeReservationOps.set(op, id);
      account.reserved_cents += amount;
      account.updated_at = at;
      const event = {
        id: mem.seq++, storefront_id: storefrontId, reservation_id: id, order_id: orderId,
        payment_attempt_id: attemptId, kind: "reserved", amount_cents: amount,
        operation_key: op, reverses_event_id: null, stripe_account_id: null,
        stripe_application_fee_id: null, stripe_fee_refund_id: null,
        stripe_event_id: null, livemode: null, currency: account.currency, created_at: at,
      };
      mem.storefrontFeeEvents.push(event);
      mem.storefrontFeeEventOps.set(op, event.id);
      return { reservation: feeReservationOut(row), feeBalance: feeBalanceOut(account), duplicate: false };
    });
  }

  return transaction(p, async (client) => {
    await lockOperation(client, "storefront-fee", op);
    if (attemptId) await lockOperation(client, "storefront-fee-attempt", `${orderId}:${attemptId}`);
    const priorEvent = await client.query("SELECT kind FROM storefront_fee_events WHERE operation_key=$1", [op]);
    if (priorEvent.rows[0] && priorEvent.rows[0].kind !== "reserved") idempotencyConflict();
    const prior = await client.query(
      "SELECT * FROM storefront_fee_reservations WHERE operation_key=$1",
      [op],
    );
    if (prior.rows[0]) {
      if (String(prior.rows[0].storefront_id) !== storefrontId
        || prior.rows[0].order_id !== orderId
        || (prior.rows[0].payment_attempt_id ? String(prior.rows[0].payment_attempt_id) : null) !== attemptId
        || Number(prior.rows[0].amount_cents) > maximum) idempotencyConflict();
      const balance = await pgFeeAccount(client, prior.rows[0].storefront_id);
      return { reservation: feeReservationOut(prior.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: true };
    }
    const account = await pgFeeAccount(client, storefrontId, true);
    if (!account) throw new StorefrontRefused("FEE_ACCOUNT_NOT_FOUND", "storefront fee account not found", 404);
    await requirePgStorefrontOrder(client, orderId, storefrontId);
    if (attemptId) {
      const attempt = await client.query(
        "SELECT 1 FROM payment_attempts WHERE id=$1 AND order_id=$2 AND storefront_id=$3",
        [attemptId, orderId, storefrontId],
      );
      if (!attempt.rows[0]) {
        throw new StorefrontRefused(
          "PAYMENT_ATTEMPT_MISMATCH",
          "the payment attempt does not belong to this storefront order",
          409,
        );
      }
      const occupied = await client.query(
        "SELECT 1 FROM storefront_fee_reservations WHERE order_id=$1 AND payment_attempt_id=$2",
        [orderId, attemptId],
      );
      if (occupied.rows[0]) {
        throw new StorefrontRefused("RESERVATION_EXISTS", "that payment attempt already has a fee reservation", 409);
      }
    }
    const unreserved = Math.max(0,
      Number(account.target_cents) - Number(account.collected_cents) - Number(account.reserved_cents));
    const amount = Math.min(maximum, unreserved);
    if (amount === 0) return { reservation: null, feeBalance: feeBalanceOut(account), duplicate: false };
    const id = newId();
    const inserted = await client.query(
      `INSERT INTO storefront_fee_reservations
         (id,storefront_id,order_id,payment_attempt_id,operation_key,amount_cents,state,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7) RETURNING *`,
      [id, storefrontId, orderId, attemptId, op, amount, expiry],
    );
    await client.query(
      `UPDATE storefront_fee_accounts
          SET reserved_cents=reserved_cents+$2,updated_at=now()
        WHERE storefront_id=$1`,
      [storefrontId, amount],
    );
    await client.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,
          operation_key,currency)
       VALUES ($1,$2,$3,$4,'reserved',$5,$6,$7)`,
      [storefrontId, id, orderId, attemptId, amount, op, account.currency],
    );
    const balance = await pgFeeAccount(client, storefrontId);
    return { reservation: feeReservationOut(inserted.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: false };
  });
}

export async function confirmStorefrontFee({
  reservationId: reservationIdRaw,
  operationKey: operationRaw,
  stripeAccountId = null,
  stripeApplicationFeeId = null,
  stripeEventId = null,
  livemode = null,
} = {}) {
  const reservationId = uuid(reservationIdRaw, "fee reservation id");
  const op = operationKey(operationRaw);
  const providerAccount = stripeObjectId(stripeAccountId, "acct", "Stripe account id");
  const applicationFee = stripeObjectId(stripeApplicationFeeId, "fee", "application fee id");
  const providerEvent = stripeObjectId(stripeEventId, "evt", "Stripe event id");
  if (livemode != null && typeof livemode !== "boolean") {
    throw new StorefrontRefused("INVALID_MODE", "livemode must be boolean", 400);
  }
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);

  if (!p) {
    const preview = mem.storefrontFeeReservations.get(reservationId);
    if (!preview) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "fee reservation not found", 404);
    return withOrderedUserLocks([`fee-op:${op}`, `storefront-fee:${preview.storefront_id}`], async () => {
      const priorEventId = mem.storefrontFeeEventOps.get(op);
      if (priorEventId) {
        const event = mem.storefrontFeeEvents.find((entry) => entry.id === priorEventId);
        if (event.reservation_id !== reservationId || event.kind !== "collected") idempotencyConflict();
        assertCollectionProofReplay(event, { providerAccount, applicationFee, providerEvent, livemode });
        return { event: feeEventOut(event), feeBalance: feeBalanceOut(mem.storefrontFeeAccounts.get(preview.storefront_id)), duplicate: true };
      }
      const reservation = mem.storefrontFeeReservations.get(reservationId);
      const account = mem.storefrontFeeAccounts.get(reservation.storefront_id);
      if (reservation.state === "confirmed") {
        const event = mem.storefrontFeeEvents.find((entry) => entry.reservation_id === reservationId && entry.kind === "collected");
        if (!event || event.operation_key !== op) idempotencyConflict();
        assertCollectionProofReplay(event, { providerAccount, applicationFee, providerEvent, livemode });
        return { event: feeEventOut(event), feeBalance: feeBalanceOut(account), duplicate: true };
      }
      if (reservation.state !== "active") {
        throw new StorefrontRefused("RESERVATION_FINAL", "a released fee reservation cannot be confirmed", 409);
      }
      requireCollectionProof({ providerAccount, applicationFee, providerEvent, livemode });
      const at = nowIso();
      account.reserved_cents -= reservation.amount_cents;
      account.collected_cents += reservation.amount_cents;
      account.updated_at = at;
      Object.assign(reservation, {
        state: "confirmed", terminal_operation_key: op, terminal_reason: "provider-confirmed",
        terminal_at: at, updated_at: at,
      });
      const event = {
        id: mem.seq++, storefront_id: reservation.storefront_id, reservation_id: reservation.id,
        order_id: reservation.order_id, payment_attempt_id: reservation.payment_attempt_id,
        kind: "collected", amount_cents: reservation.amount_cents, operation_key: op,
        reverses_event_id: null, stripe_account_id: providerAccount,
        stripe_application_fee_id: applicationFee, stripe_fee_refund_id: null,
        stripe_event_id: providerEvent, livemode, currency: account.currency, created_at: at,
      };
      mem.storefrontFeeEvents.push(event);
      mem.storefrontFeeEventOps.set(op, event.id);
      return { event: feeEventOut(event), feeBalance: feeBalanceOut(account), duplicate: false };
    });
  }

  return transaction(p, async (client) => {
    await lockOperation(client, "storefront-fee", op);
    const duplicate = await client.query("SELECT * FROM storefront_fee_events WHERE operation_key=$1", [op]);
    if (duplicate.rows[0]) {
      if (String(duplicate.rows[0].reservation_id) !== reservationId || duplicate.rows[0].kind !== "collected") {
        idempotencyConflict();
      }
      assertCollectionProofReplay(duplicate.rows[0], {
        providerAccount, applicationFee, providerEvent, livemode,
      });
      const balance = await pgFeeAccount(client, duplicate.rows[0].storefront_id);
      return { event: feeEventOut(duplicate.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: true };
    }
    const preview = await client.query("SELECT storefront_id FROM storefront_fee_reservations WHERE id=$1", [reservationId]);
    if (!preview.rows[0]) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "fee reservation not found", 404);
    const account = await pgFeeAccount(client, preview.rows[0].storefront_id, true);
    const locked = await client.query("SELECT * FROM storefront_fee_reservations WHERE id=$1 FOR UPDATE", [reservationId]);
    const reservation = locked.rows[0];
    if (reservation.state === "confirmed") {
      const event = await client.query(
        "SELECT * FROM storefront_fee_events WHERE reservation_id=$1 AND kind='collected' ORDER BY id LIMIT 1",
        [reservationId],
      );
      if (!event.rows[0] || event.rows[0].operation_key !== op) idempotencyConflict();
      assertCollectionProofReplay(event.rows[0], {
        providerAccount, applicationFee, providerEvent, livemode,
      });
      return { event: feeEventOut(event.rows[0]), feeBalance: feeBalanceOut(account), duplicate: true };
    }
    if (reservation.state !== "active") {
      throw new StorefrontRefused("RESERVATION_FINAL", "a released fee reservation cannot be confirmed", 409);
    }
    requireCollectionProof({ providerAccount, applicationFee, providerEvent, livemode });
    await client.query(
      `UPDATE storefront_fee_accounts SET
         reserved_cents=reserved_cents-$2,collected_cents=collected_cents+$2,updated_at=now()
       WHERE storefront_id=$1`,
      [reservation.storefront_id, reservation.amount_cents],
    );
    await client.query(
      `UPDATE storefront_fee_reservations SET state='confirmed',terminal_operation_key=$2,
         terminal_reason='provider-confirmed',terminal_at=now(),updated_at=now() WHERE id=$1`,
      [reservationId, op],
    );
    const event = await client.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,
          operation_key,stripe_account_id,stripe_application_fee_id,stripe_event_id,livemode,currency)
       VALUES ($1,$2,$3,$4,'collected',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [reservation.storefront_id, reservation.id, reservation.order_id, reservation.payment_attempt_id,
        reservation.amount_cents, op, providerAccount, applicationFee, providerEvent, livemode, account.currency],
    );
    const balance = await pgFeeAccount(client, reservation.storefront_id);
    return { event: feeEventOut(event.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: false };
  });
}

export async function releaseStorefrontFee({
  reservationId: reservationIdRaw,
  operationKey: operationRaw,
  reason = "provider-terminal-without-payment",
} = {}) {
  const reservationId = uuid(reservationIdRaw, "fee reservation id");
  const op = operationKey(operationRaw);
  const why = plainText(reason, 240) || "provider-terminal-without-payment";
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);

  if (!p) {
    const preview = mem.storefrontFeeReservations.get(reservationId);
    if (!preview) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "fee reservation not found", 404);
    return withOrderedUserLocks([`fee-op:${op}`, `storefront-fee:${preview.storefront_id}`], async () => {
      const priorEventId = mem.storefrontFeeEventOps.get(op);
      if (priorEventId) {
        const event = mem.storefrontFeeEvents.find((entry) => entry.id === priorEventId);
        if (event.reservation_id !== reservationId || event.kind !== "released") idempotencyConflict();
        return { event: feeEventOut(event), feeBalance: feeBalanceOut(mem.storefrontFeeAccounts.get(preview.storefront_id)), duplicate: true };
      }
      const reservation = mem.storefrontFeeReservations.get(reservationId);
      const account = mem.storefrontFeeAccounts.get(reservation.storefront_id);
      if (reservation.state === "released") {
        const event = mem.storefrontFeeEvents.find((entry) => entry.reservation_id === reservationId && entry.kind === "released");
        return { event: feeEventOut(event), feeBalance: feeBalanceOut(account), duplicate: true };
      }
      if (reservation.state !== "active") {
        throw new StorefrontRefused("RESERVATION_FINAL", "a confirmed fee reservation cannot be released", 409);
      }
      const at = nowIso();
      account.reserved_cents -= reservation.amount_cents;
      account.updated_at = at;
      Object.assign(reservation, {
        state: "released", terminal_operation_key: op, terminal_reason: why,
        terminal_at: at, updated_at: at,
      });
      const event = {
        id: mem.seq++, storefront_id: reservation.storefront_id, reservation_id: reservation.id,
        order_id: reservation.order_id, payment_attempt_id: reservation.payment_attempt_id,
        kind: "released", amount_cents: reservation.amount_cents, operation_key: op,
        reverses_event_id: null, stripe_account_id: null, stripe_application_fee_id: null,
        stripe_fee_refund_id: null, stripe_event_id: null, livemode: null,
        currency: account.currency, created_at: at,
      };
      mem.storefrontFeeEvents.push(event);
      mem.storefrontFeeEventOps.set(op, event.id);
      return { event: feeEventOut(event), feeBalance: feeBalanceOut(account), duplicate: false };
    });
  }

  return transaction(p, async (client) => {
    await lockOperation(client, "storefront-fee", op);
    const duplicate = await client.query("SELECT * FROM storefront_fee_events WHERE operation_key=$1", [op]);
    if (duplicate.rows[0]) {
      if (String(duplicate.rows[0].reservation_id) !== reservationId || duplicate.rows[0].kind !== "released") {
        idempotencyConflict();
      }
      const balance = await pgFeeAccount(client, duplicate.rows[0].storefront_id);
      return { event: feeEventOut(duplicate.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: true };
    }
    const preview = await client.query("SELECT storefront_id FROM storefront_fee_reservations WHERE id=$1", [reservationId]);
    if (!preview.rows[0]) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "fee reservation not found", 404);
    const account = await pgFeeAccount(client, preview.rows[0].storefront_id, true);
    const locked = await client.query("SELECT * FROM storefront_fee_reservations WHERE id=$1 FOR UPDATE", [reservationId]);
    const reservation = locked.rows[0];
    if (reservation.state === "released") {
      const event = await client.query(
        "SELECT * FROM storefront_fee_events WHERE reservation_id=$1 AND kind='released' ORDER BY id LIMIT 1",
        [reservationId],
      );
      return { event: feeEventOut(event.rows[0]), feeBalance: feeBalanceOut(account), duplicate: true };
    }
    if (reservation.state !== "active") {
      throw new StorefrontRefused("RESERVATION_FINAL", "a confirmed fee reservation cannot be released", 409);
    }
    await client.query(
      "UPDATE storefront_fee_accounts SET reserved_cents=reserved_cents-$2,updated_at=now() WHERE storefront_id=$1",
      [reservation.storefront_id, reservation.amount_cents],
    );
    await client.query(
      `UPDATE storefront_fee_reservations SET state='released',terminal_operation_key=$2,
         terminal_reason=$3,terminal_at=now(),updated_at=now() WHERE id=$1`,
      [reservationId, op, why],
    );
    const event = await client.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,operation_key,currency)
       VALUES ($1,$2,$3,$4,'released',$5,$6,$7) RETURNING *`,
      [reservation.storefront_id, reservation.id, reservation.order_id,
        reservation.payment_attempt_id, reservation.amount_cents, op, account.currency],
    );
    const balance = await pgFeeAccount(client, reservation.storefront_id);
    return { event: feeEventOut(event.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: false };
  });
}

export async function reverseStorefrontFee({
  collectionEventId: eventIdRaw,
  amountCents: amountRaw,
  operationKey: operationRaw,
  stripeFeeRefundId = null,
  stripeEventId = null,
} = {}) {
  const eventId = String(eventIdRaw || "");
  if (!/^\d+$/.test(eventId)) throw new StorefrontRefused("INVALID_EVENT", "collection event id is invalid", 400);
  const amount = positiveInt(amountRaw, "reversal amount cents");
  const op = operationKey(operationRaw);
  const feeRefund = stripeObjectId(stripeFeeRefundId, "fr", "application-fee refund id");
  const providerEvent = stripeObjectId(stripeEventId, "evt", "Stripe event id");
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);

  if (!p) {
    const original = mem.storefrontFeeEvents.find((entry) => String(entry.id) === eventId);
    if (!original || original.kind !== "collected") {
      throw new StorefrontRefused("COLLECTION_NOT_FOUND", "collected storefront fee event not found", 404);
    }
    return withOrderedUserLocks([`fee-op:${op}`, `storefront-fee:${original.storefront_id}`], async () => {
      const priorEventId = mem.storefrontFeeEventOps.get(op);
      if (priorEventId) {
        const event = mem.storefrontFeeEvents.find((entry) => entry.id === priorEventId);
        if (String(event.reverses_event_id) !== eventId || event.kind !== "reversed"
          || Number(event.amount_cents) !== amount) idempotencyConflict();
        assertReversalProofReplay(event, { feeRefund, providerEvent });
        return { event: feeEventOut(event), feeBalance: feeBalanceOut(mem.storefrontFeeAccounts.get(original.storefront_id)), duplicate: true };
      }
      requireReversalProof(original, feeRefund, providerEvent);
      const reversed = mem.storefrontFeeEvents
        .filter((entry) => entry.kind === "reversed" && String(entry.reverses_event_id) === eventId)
        .reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
      if (amount > original.amount_cents - reversed) {
        throw new StorefrontRefused("REVERSAL_EXCEEDS_COLLECTION", "reversal exceeds the original collection", 409);
      }
      const account = mem.storefrontFeeAccounts.get(original.storefront_id);
      if (amount > account.collected_cents) {
        throw new StorefrontRefused("LEDGER_MISMATCH", "fee balance does not cover that reversal", 409);
      }
      const at = nowIso();
      account.collected_cents -= amount;
      account.updated_at = at;
      const event = {
        id: mem.seq++, storefront_id: original.storefront_id, reservation_id: original.reservation_id,
        order_id: original.order_id, payment_attempt_id: original.payment_attempt_id,
        kind: "reversed", amount_cents: amount, operation_key: op,
        reverses_event_id: original.id, stripe_account_id: original.stripe_account_id,
        stripe_application_fee_id: original.stripe_application_fee_id,
        stripe_fee_refund_id: feeRefund, stripe_event_id: providerEvent,
        livemode: original.livemode, currency: original.currency, created_at: at,
      };
      mem.storefrontFeeEvents.push(event);
      mem.storefrontFeeEventOps.set(op, event.id);
      return { event: feeEventOut(event), feeBalance: feeBalanceOut(account), duplicate: false };
    });
  }

  return transaction(p, async (client) => {
    await lockOperation(client, "storefront-fee", op);
    const duplicate = await client.query("SELECT * FROM storefront_fee_events WHERE operation_key=$1", [op]);
    if (duplicate.rows[0]) {
      if (String(duplicate.rows[0].reverses_event_id) !== eventId
        || duplicate.rows[0].kind !== "reversed"
        || Number(duplicate.rows[0].amount_cents) !== amount) idempotencyConflict();
      assertReversalProofReplay(duplicate.rows[0], { feeRefund, providerEvent });
      const balance = await pgFeeAccount(client, duplicate.rows[0].storefront_id);
      return { event: feeEventOut(duplicate.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: true };
    }
    const preview = await client.query(
      "SELECT storefront_id FROM storefront_fee_events WHERE id=$1 AND kind='collected'",
      [eventId],
    );
    if (!preview.rows[0]) {
      throw new StorefrontRefused("COLLECTION_NOT_FOUND", "collected storefront fee event not found", 404);
    }
    const account = await pgFeeAccount(client, preview.rows[0].storefront_id, true);
    const locked = await client.query(
      "SELECT * FROM storefront_fee_events WHERE id=$1 AND kind='collected' FOR UPDATE",
      [eventId],
    );
    const original = locked.rows[0];
    requireReversalProof(original, feeRefund, providerEvent);
    const sum = await client.query(
      "SELECT COALESCE(sum(amount_cents),0)::int AS amount FROM storefront_fee_events WHERE kind='reversed' AND reverses_event_id=$1",
      [eventId],
    );
    const reversed = Number(sum.rows[0].amount);
    if (amount > Number(original.amount_cents) - reversed) {
      throw new StorefrontRefused("REVERSAL_EXCEEDS_COLLECTION", "reversal exceeds the original collection", 409);
    }
    if (amount > Number(account.collected_cents)) {
      throw new StorefrontRefused("LEDGER_MISMATCH", "fee balance does not cover that reversal", 409);
    }
    await client.query(
      "UPDATE storefront_fee_accounts SET collected_cents=collected_cents-$2,updated_at=now() WHERE storefront_id=$1",
      [original.storefront_id, amount],
    );
    const event = await client.query(
      `INSERT INTO storefront_fee_events
         (storefront_id,reservation_id,order_id,payment_attempt_id,kind,amount_cents,
          operation_key,reverses_event_id,stripe_account_id,stripe_application_fee_id,
          stripe_fee_refund_id,stripe_event_id,livemode,currency)
       VALUES ($1,$2,$3,$4,'reversed',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [original.storefront_id, original.reservation_id, original.order_id,
        original.payment_attempt_id, amount, op, original.id, original.stripe_account_id,
        original.stripe_application_fee_id, feeRefund, providerEvent, original.livemode, original.currency],
    );
    const balance = await pgFeeAccount(client, original.storefront_id);
    return { event: feeEventOut(event.rows[0]), feeBalance: feeBalanceOut(balance), duplicate: false };
  });
}

function activeVariantMemory(variantId) {
  const variant = mem.nativeVariants.get(variantId);
  const listing = variant ? mem.nativeListings.get(variant.listing_id) : null;
  const store = listing ? mem.storefronts.get(listing.storefront_id) : null;
  if (!variant || !listing || !store) return null;
  if (variant.state !== "active" || listing.state !== "active" || store.state !== "active") return null;
  return { variant, listing, store };
}

export async function reserveStorefrontInventory({
  variantId: variantIdRaw,
  orderId: orderIdRaw,
  paymentAttemptId = null,
  quantity: quantityRaw = 1,
  operationKey: operationRaw,
  expiresAt = null,
} = {}) {
  const variantId = uuid(variantIdRaw, "variant id");
  const orderId = orderKey(orderIdRaw);
  const attemptId = optionalAttemptId(paymentAttemptId);
  const quantity = positiveInt(quantityRaw, "inventory quantity");
  const op = operationKey(operationRaw);
  const expiry = optionalFuture(expiresAt);
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);

  if (!p) {
    return withOrderedUserLocks([`inventory-op:${op}`, `inventory:${variantId}`], async () => {
      const priorId = mem.inventoryReservationOps.get(op);
      if (priorId) {
        const prior = mem.inventoryReservations.get(priorId);
        if (prior.variant_id !== variantId || prior.order_id !== orderId
          || prior.payment_attempt_id !== attemptId
          || Number(prior.quantity) !== quantity) idempotencyConflict();
        return { reservation: inventoryReservationOut(prior), duplicate: true };
      }
      const authority = activeVariantMemory(variantId);
      if (!authority) {
        throw new StorefrontRefused("LISTING_NOT_PURCHASABLE", "the listing is not active", 409);
      }
      await requireMemoryStorefrontOrder(orderId, authority.store.id);
      if (attemptId) {
        const attempt = mem.paymentAttempts.get(attemptId);
        if (!attempt || attempt.order_id !== orderId
          || attempt.storefront_id !== authority.store.id) {
          throw new StorefrontRefused(
            "PAYMENT_ATTEMPT_MISMATCH",
            "the payment attempt does not own this seller inventory",
            409,
          );
        }
      }
      if (attemptId && [...mem.inventoryReservations.values()].some(
        (row) => row.order_id === orderId && row.payment_attempt_id === attemptId
          && row.variant_id === variantId)) {
        throw new StorefrontRefused("RESERVATION_EXISTS", "that payment attempt already reserved this variant", 409);
      }
      const available = authority.variant.stock_on_hand - authority.variant.stock_reserved;
      if (available < quantity) throw new StorefrontRefused("OUT_OF_STOCK", "not enough inventory is available", 409);
      const at = nowIso();
      const id = newId();
      authority.variant.stock_reserved += quantity;
      authority.variant.version += 1;
      authority.variant.updated_at = at;
      const row = {
        id,
        storefront_id: authority.store.id,
        listing_id: authority.listing.id,
        variant_id: variantId,
        order_id: orderId,
        payment_attempt_id: attemptId,
        operation_key: op,
        quantity,
        state: "active",
        expires_at: expiry,
        terminal_operation_key: null,
        terminal_reason: null,
        created_at: at,
        updated_at: at,
        terminal_at: null,
      };
      mem.inventoryReservations.set(id, row);
      mem.inventoryReservationOps.set(op, id);
      projectListingMemory(authority.listing.id);
      return { reservation: inventoryReservationOut(row), duplicate: false };
    });
  }

  return transaction(p, async (client) => {
    await lockOperation(client, "inventory-reserve", op);
    if (attemptId) await lockOperation(client, "inventory-attempt-variant", `${orderId}:${attemptId}:${variantId}`);
    const prior = await client.query("SELECT * FROM inventory_reservations WHERE operation_key=$1", [op]);
    if (prior.rows[0]) {
      if (String(prior.rows[0].variant_id) !== variantId || prior.rows[0].order_id !== orderId
        || (prior.rows[0].payment_attempt_id ? String(prior.rows[0].payment_attempt_id) : null) !== attemptId
        || Number(prior.rows[0].quantity) !== quantity) idempotencyConflict();
      return { reservation: inventoryReservationOut(prior.rows[0]), duplicate: true };
    }
    const authority = await client.query(
      `SELECT l.id AS listing_id,l.storefront_id
         FROM native_listing_variants v JOIN native_listings l ON l.id=v.listing_id
        WHERE v.id=$1`,
      [variantId],
    );
    if (!authority.rows[0]) {
      throw new StorefrontRefused("VARIANT_NOT_FOUND", "variant not found", 404);
    }
    await requirePgStorefrontOrder(client, orderId, String(authority.rows[0].storefront_id));
    if (attemptId) {
      const attempt = await client.query(
        "SELECT storefront_id FROM payment_attempts WHERE id=$1 AND order_id=$2",
        [attemptId, orderId],
      );
      if (!attempt.rows[0]) {
        throw new StorefrontRefused("PAYMENT_ATTEMPT_MISMATCH", "payment attempt does not match the order", 409);
      }
      if (String(authority.rows[0].storefront_id) !== String(attempt.rows[0].storefront_id)) {
        throw new StorefrontRefused(
          "PAYMENT_ATTEMPT_MISMATCH",
          "the payment attempt does not own this seller inventory",
          409,
        );
      }
      const occupied = await client.query(
        "SELECT 1 FROM inventory_reservations WHERE order_id=$1 AND payment_attempt_id=$2 AND variant_id=$3",
        [orderId, attemptId, variantId],
      );
      if (occupied.rows[0]) {
        throw new StorefrontRefused("RESERVATION_EXISTS", "that payment attempt already reserved this variant", 409);
      }
    }
    const updated = await client.query(
      `UPDATE native_listing_variants v SET
         stock_reserved=stock_reserved+$2,version=version+1,updated_at=now()
       WHERE v.id=$1 AND v.state='active' AND v.stock_on_hand-v.stock_reserved >= $2
         AND EXISTS (
           SELECT 1 FROM native_listings l JOIN storefronts s ON s.id=l.storefront_id
            WHERE l.id=v.listing_id AND l.state='active' AND s.state='active'
         )
       RETURNING v.*`,
      [variantId, quantity],
    );
    if (!updated.rows[0]) {
      const present = await client.query("SELECT 1 FROM native_listing_variants WHERE id=$1", [variantId]);
      throw new StorefrontRefused(
        present.rows[0] ? "OUT_OF_STOCK" : "VARIANT_NOT_FOUND",
        present.rows[0] ? "not enough active inventory is available" : "variant not found",
        present.rows[0] ? 409 : 404,
      );
    }
    const id = newId();
    const inserted = await client.query(
      `INSERT INTO inventory_reservations
         (id,storefront_id,listing_id,variant_id,order_id,payment_attempt_id,
          operation_key,quantity,state,expires_at)
       SELECT $1,l.storefront_id,l.id,$2,$3,$4,$5,$6,'active',$7
         FROM native_listing_variants v JOIN native_listings l ON l.id=v.listing_id
        WHERE v.id=$2
       RETURNING *`,
      [id, variantId, orderId, attemptId, op, quantity, expiry],
    );
    await projectListingPg(client, updated.rows[0].listing_id);
    return { reservation: inventoryReservationOut(inserted.rows[0]), duplicate: false };
  });
}

async function finishInventoryMemory(reservationId, desired, op, reason) {
  const preview = mem.inventoryReservations.get(reservationId);
  if (!preview) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "inventory reservation not found", 404);
  return withOrderedUserLocks([`inventory-terminal:${op}`, `inventory:${preview.variant_id}`], async () => {
    const used = [...mem.inventoryReservations.values()]
      .find((entry) => entry.terminal_operation_key === op);
    if (used) {
      if (used.id !== reservationId || used.state !== desired) idempotencyConflict();
      return { reservation: inventoryReservationOut(used), duplicate: true };
    }
    const reservation = mem.inventoryReservations.get(reservationId);
    const variant = mem.nativeVariants.get(reservation.variant_id);
    if (!variant) throw new StorefrontRefused("VARIANT_NOT_FOUND", "variant not found", 404);
    if (reservation.state === desired) return { reservation: inventoryReservationOut(reservation), duplicate: true };
    if (reservation.state !== "active") {
      throw new StorefrontRefused("RESERVATION_FINAL", `inventory was already ${reservation.state}`, 409);
    }
    if (variant.stock_reserved < reservation.quantity) {
      throw new StorefrontRefused("INVENTORY_MISMATCH", "reserved inventory is below the reservation", 409);
    }
    if (desired === "consumed" && variant.stock_on_hand < reservation.quantity) {
      throw new StorefrontRefused("INVENTORY_MISMATCH", "on-hand inventory is below the reservation", 409);
    }
    const at = nowIso();
    variant.stock_reserved -= reservation.quantity;
    if (desired === "consumed") variant.stock_on_hand -= reservation.quantity;
    variant.version += 1;
    variant.updated_at = at;
    Object.assign(reservation, {
      state: desired,
      terminal_operation_key: op,
      terminal_reason: reason,
      terminal_at: at,
      updated_at: at,
    });
    projectListingMemory(variant.listing_id);
    return { reservation: inventoryReservationOut(reservation), duplicate: false };
  });
}

async function finishInventoryPg(p, reservationId, desired, op, reason) {
  return transaction(p, async (client) => {
    await lockOperation(client, "inventory-terminal", op);
    const used = await client.query(
      "SELECT * FROM inventory_reservations WHERE terminal_operation_key=$1",
      [op],
    );
    if (used.rows[0]) {
      if (String(used.rows[0].id) !== reservationId || used.rows[0].state !== desired) idempotencyConflict();
      return { reservation: inventoryReservationOut(used.rows[0]), duplicate: true };
    }
    const preview = await client.query("SELECT variant_id FROM inventory_reservations WHERE id=$1", [reservationId]);
    if (!preview.rows[0]) throw new StorefrontRefused("RESERVATION_NOT_FOUND", "inventory reservation not found", 404);
    // Lock order is always variant then reservation. Reserve locks only the
    // variant, so consume and release cannot form an inverse-order deadlock.
    const variantResult = await client.query(
      "SELECT * FROM native_listing_variants WHERE id=$1 FOR UPDATE",
      [preview.rows[0].variant_id],
    );
    const variant = variantResult.rows[0];
    if (!variant) throw new StorefrontRefused("VARIANT_NOT_FOUND", "variant not found", 404);
    const locked = await client.query("SELECT * FROM inventory_reservations WHERE id=$1 FOR UPDATE", [reservationId]);
    const reservation = locked.rows[0];
    if (reservation.state === desired) return { reservation: inventoryReservationOut(reservation), duplicate: true };
    if (reservation.state !== "active") {
      throw new StorefrontRefused("RESERVATION_FINAL", `inventory was already ${reservation.state}`, 409);
    }
    if (Number(variant.stock_reserved) < Number(reservation.quantity)
      || (desired === "consumed" && Number(variant.stock_on_hand) < Number(reservation.quantity))) {
      throw new StorefrontRefused("INVENTORY_MISMATCH", "inventory no longer matches the reservation", 409);
    }
    const adjustment = desired === "consumed"
      ? "stock_on_hand=stock_on_hand-$2,stock_reserved=stock_reserved-$2"
      : "stock_reserved=stock_reserved-$2";
    await client.query(
      `UPDATE native_listing_variants SET ${adjustment},version=version+1,updated_at=now() WHERE id=$1`,
      [variant.id, reservation.quantity],
    );
    const updated = await client.query(
      `UPDATE inventory_reservations SET state=$2,terminal_operation_key=$3,terminal_reason=$4,
         terminal_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
      [reservationId, desired, op, reason],
    );
    await projectListingPg(client, variant.listing_id);
    return { reservation: inventoryReservationOut(updated.rows[0]), duplicate: false };
  });
}

export async function consumeStorefrontInventory({
  reservationId: reservationIdRaw,
  operationKey: operationRaw,
  reason = "provider-payment-verified",
} = {}) {
  const reservationId = uuid(reservationIdRaw, "inventory reservation id");
  const op = operationKey(operationRaw);
  const why = plainText(reason, 240) || "provider-payment-verified";
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);
  return p
    ? finishInventoryPg(p, reservationId, "consumed", op, why)
    : finishInventoryMemory(reservationId, "consumed", op, why);
}

/** Release only after the caller reconciles a provider-terminal unpaid state. */
export async function releaseStorefrontInventory({
  reservationId: reservationIdRaw,
  operationKey: operationRaw,
  reason = "provider-terminal-without-payment",
} = {}) {
  const reservationId = uuid(reservationIdRaw, "inventory reservation id");
  const op = operationKey(operationRaw);
  const why = plainText(reason, 240) || "provider-terminal-without-payment";
  const p = await getPool();
  await requireSchema(p);
  requireDurableMoney(p);
  return p
    ? finishInventoryPg(p, reservationId, "released", op, why)
    : finishInventoryMemory(reservationId, "released", op, why);
}
