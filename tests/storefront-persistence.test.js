import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// This suite intentionally exercises the keyless memory implementation. Its
// laws mirror the PG transactions; database concurrency coverage lives only
// in postgres-integration.test.js.
delete process.env.DATABASE_URL;

const storefronts = await import("../lib/db/production/storefronts.js");
const { createOrderWithEvent } = await import("../lib/db/orders.js");
const { mem } = await import("../lib/db/production/store.js");
const { mem: catalogMem } = await import("../lib/db/core/store.js");
const { STOREFRONT_TERMS_VERSION } = await import("../lib/storefront/contracts.js");

function clearStorefrontMemory() {
  for (const key of [
    "storefronts", "storefrontOwners", "storefrontSlugs", "storefrontPaymentAccounts",
    "storefrontFeeAccounts", "storefrontFeeReservations", "storefrontFeeReservationOps",
    "nativeListings", "nativeListingOperations", "nativeVariants", "inventoryReservations",
    "inventoryReservationOps", "paymentAttempts", "paymentAttemptOps", "stripeEventInbox",
  ]) mem[key].clear();
  mem.storefrontFeeEvents.length = 0;
  mem.storefrontFeeEventOps.clear();
  for (const id of [...catalogMem.items.keys()]) if (String(id).startsWith("native-")) catalogMem.items.delete(id);
}

async function createNativeMemoryOrder(storefrontId, itemId = "native-memory-test") {
  const order = await createOrderWithEvent({
    user: `sb-${randomUUID()}`,
    itemId,
    amountCents: 2_000,
    currency: "usd",
  });
  order.storefront_id = storefrontId;
  order.commerce_rail = "native_storefront";
  return order.id;
}

test("native storefront persists free ownership, catalog projection and moderated public allowlist", async () => {
  clearStorefrontMemory();
  const accountId = randomUUID();
  const created = await storefronts.createStorefront({
    accountId,
    name: "Signal Objects",
    description: "Cross-category things",
    accepted: true,
    acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
  });
  assert.equal(created.storefront.status, "draft");
  assert.equal(created.feeBalance.targetCents, 3_000);
  assert.equal(created.feeBalance.collectedCents, 0);
  assert.deepEqual(created.feeEvents, []);
  assert.equal(created.capabilities.canReceiveOrders, false);

  const duplicate = await storefronts.createStorefront({
    accountId,
    name: "A different name",
    accepted: true,
    acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.storefront.id, created.storefront.id);
  await assert.rejects(
    () => storefronts.createStorefront({
      accountId: `u-${randomUUID()}`, name: "Device Store", accepted: true,
      acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
    }),
    (error) => error.code === "ACCOUNT_REQUIRED",
  );

  process.env.NATIVE_LISTINGS_ENABLED = "0";
  try {
    assert.equal((await storefronts.getStorefrontForOwner(accountId)).capabilities.canManageListings, false);
    await assert.rejects(
      () => storefronts.createStorefrontListing(accountId, {
        title: "Blocked draft", category: "other", priceCents: 100, inventory: 1,
      }),
      (error) => error.code === "LISTING_WRITES_DISABLED",
    );
  } finally {
    delete process.env.NATIVE_LISTINGS_ENABLED;
  }

  const made = await storefronts.createStorefrontListing(accountId, {
    title: "Chrome receiver",
    description: "Tested functions listed",
    category: "electronics_tech",
    currency: "USD",
    priceCents: 12_345,
    inventory: 1,
    photos: ["https://example.com/receiver.jpg"],
    attributes: { compatibility: "120 V", size: "ignored garment field" },
    fulfillment: { shipping: true, pickup: false },
    status: "pending_review",
    variants: [{
      label: "Default", sku: "RX-1", optionValues: {}, priceCents: 12_345, stockOnHand: 1,
    }],
  });
  const listing = made.storefront.listings[0];
  const projected = catalogMem.items.get(listing.itemId);
  assert.equal(projected.commerce_rail, "native_storefront");
  assert.equal(projected.price_cents, 12_345);
  assert.equal(projected.price, 123.45);
  assert.equal(projected.inventory_available, 1);
  assert.equal(projected.native_checkout_ready, false);
  assert.equal(projected.source_product_url, null);
  assert.equal(projected.url, null);
  assert.equal(projected.is_available, false, "review is not public availability");
  assert.equal(listing.attributes.size, undefined);
  const retryableInput = {
    operationKey: "listing-create-retry-one",
    title: "Retry-safe print", category: "posters_prints", priceCents: 2_500, inventory: 2,
    attributes: { dimensions: "18 × 24 in", medium: "screen print" },
    fulfillment: { shipping: true, pickup: false },
  };
  const retryable = await storefronts.createStorefrontListing(accountId, retryableInput);
  const replay = await storefronts.createStorefrontListing(accountId, retryableInput);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.listingId, retryable.listingId);
  await assert.rejects(
    () => storefronts.createStorefrontListing(accountId, { ...retryableInput, title: "Changed after retry" }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    () => storefronts.updateStorefront(accountId, { version: created.storefront.version, status: "active" }),
    (error) => error.code === "PUBLICATION_DISABLED",
  );

  const pending = await storefronts.updateStorefront(accountId, {
    version: created.storefront.version, status: "pending_review",
    name: created.storefront.name, description: created.storefront.description,
  });
  await storefronts.applyStorefrontModerationDecision({
    storefrontId: pending.storefront.id, state: "active", actor: "acceptance-moderator",
  });
  await storefronts.applyStorefrontListingModerationDecision({
    listingId: listing.id, state: "active", actor: "acceptance-moderator",
  });
  const publicResult = await storefronts.getPublicStorefrontBySlug(created.storefront.slug);
  assert.equal(publicResult.storefront.listings.length, 1);
  assert.equal(publicResult.storefront.sellerHandle, null);
  assert.equal(publicResult.capabilities.canReceiveOrders, false);
  assert.equal("ownerAccountId" in publicResult.storefront, false);
  assert.equal("feeBalance" in publicResult, false);
  assert.equal(JSON.stringify(publicResult).includes(accountId), false, "the public payload never leaks the owner UUID");
  assert.equal(catalogMem.items.get(listing.itemId).is_available, true);

  mem.profileRooms.set(accountId, {
    accountId, handle: "signal-seller", published: true, moderationStatus: "hidden",
  });
  assert.equal(
    (await storefronts.getPublicStorefrontBySlug(created.storefront.slug)).storefront.sellerHandle,
    null,
    "a moderated profile handle is not public through Storefront",
  );
  mem.profileRooms.get(accountId).moderationStatus = "visible";
  assert.equal(
    (await storefronts.getPublicStorefrontBySlug(created.storefront.slug)).storefront.sellerHandle,
    "signal-seller",
  );
  mem.profileRooms.get(accountId).published = false;
  assert.equal(
    (await storefronts.getPublicStorefrontBySlug(created.storefront.slug)).storefront.sellerHandle,
    null,
    "an unpublished profile handle is not public through Storefront",
  );

  const payment = await storefronts.syncStorefrontPaymentAccount({
    storefrontId: created.storefront.id,
    stripeAccountId: `acct_${randomUUID().replaceAll("-", "")}`,
    detailsSubmitted: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    validationVersion: "connect-test-v1",
    validatedAt: new Date().toISOString(),
    expectedLivemode: false,
  });
  assert.equal(payment.onboardingState, "ready");
  const owner = await storefronts.getStorefrontForOwner(accountId);
  assert.equal(owner.capabilities.paymentOnboarding, "ready");
  assert.equal(owner.capabilities.canReceiveOrders, false, "provider sync alone never enables money");
});

test("variant-list replacement archives omissions and refuses to orphan reserved stock", async () => {
  clearStorefrontMemory();
  const accountId = randomUUID();
  const owner = await storefronts.createStorefront({
    accountId, name: "Variant Replace", accepted: true,
    acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
  });
  const made = await storefronts.createStorefrontListing(accountId, {
    title: "Replace variants", category: "clothing", priceCents: 4_000, inventory: 3,
    variants: [
      { label: "Small", priceCents: 4_000, stockOnHand: 3, optionValues: { size: "S" } },
      { label: "Large", priceCents: 4_200, stockOnHand: 2, optionValues: { size: "L" } },
    ],
  });
  const listing = made.storefront.listings.find((entry) => entry.id === made.listingId);
  const [kept, omitted] = listing.variants;
  const replaced = await storefronts.updateStorefrontListing(accountId, listing.id, {
    version: listing.version,
    variants: [{
      id: kept.id,
      label: kept.label,
      priceCents: kept.priceCents,
      stockOnHand: kept.stockOnHand,
      optionValues: kept.optionValues,
    }],
  });
  const after = replaced.storefront.listings.find((entry) => entry.id === listing.id);
  assert.equal(after.variants.find((entry) => entry.id === omitted.id).state, "archived");
  assert.equal(after.variants.find((entry) => entry.id === kept.id).isDefault, true);

  const blockedMade = await storefronts.createStorefrontListing(accountId, {
    title: "Reserved variants", category: "other", priceCents: 1_000, inventory: 2,
    variants: [
      { label: "Keep", priceCents: 1_000, stockOnHand: 2 },
      { label: "Reserved", priceCents: 1_100, stockOnHand: 1 },
    ],
  });
  const blocked = blockedMade.storefront.listings.find((entry) => entry.id === blockedMade.listingId);
  const blockedOmission = blocked.variants[1];
  mem.nativeVariants.get(blockedOmission.id).stock_reserved = 1;
  await assert.rejects(
    () => storefronts.updateStorefrontListing(accountId, blocked.id, {
      version: blocked.version,
      variants: [{
        id: blocked.variants[0].id,
        label: blocked.variants[0].label,
        priceCents: blocked.variants[0].priceCents,
        stockOnHand: blocked.variants[0].stockOnHand,
      }],
    }),
    (error) => error.code === "INVENTORY_RESERVED",
  );
  assert.equal(mem.nativeVariants.get(blockedOmission.id).state, "active");
  assert.equal(owner.feeBalance.targetCents, 3_000);
});

test("fee and inventory reservations serialize, replay idempotently and never overdraw", async () => {
  clearStorefrontMemory();
  const accountId = randomUUID();
  let owner = await storefronts.createStorefront({
    accountId, name: "Ledger Test", accepted: true, acceptedTermsVersion: STOREFRONT_TERMS_VERSION,
  });
  owner = await storefronts.updateStorefront(accountId, {
    version: owner.storefront.version, status: "pending_review", name: "Ledger Test",
  });
  await storefronts.applyStorefrontModerationDecision({
    storefrontId: owner.storefront.id, state: "active", actor: "test",
  });
  const listingResult = await storefronts.createStorefrontListing(accountId, {
    title: "One only", category: "other", priceCents: 1_000, inventory: 2,
    status: "pending_review", fulfillment: { shipping: true, pickup: false },
    variants: [
      { label: "First", priceCents: 1_000, stockOnHand: 2, optionValues: { finish: "one" } },
      { label: "Second", priceCents: 1_000, stockOnHand: 1, optionValues: { finish: "two" } },
    ],
  });
  const listing = listingResult.storefront.listings[0];
  await storefronts.applyStorefrontListingModerationDecision({
    listingId: listing.id, state: "active", actor: "test",
  });
  const variantId = listing.variants[0].id;
  const secondVariantId = listing.variants[1].id;
  const mixedOrderId = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);

  const sharedAttempt = randomUUID();
  mem.paymentAttempts.set(sharedAttempt, {
    id: sharedAttempt,
    order_id: mixedOrderId,
    storefront_id: owner.storefront.id,
  });
  const firstLine = await storefronts.reserveStorefrontInventory({
    variantId, orderId: mixedOrderId, paymentAttemptId: sharedAttempt,
    quantity: 1, operationKey: "inventory-mixed-first",
  });
  const secondLine = await storefronts.reserveStorefrontInventory({
    variantId: secondVariantId, orderId: mixedOrderId, paymentAttemptId: sharedAttempt,
    quantity: 1, operationKey: "inventory-mixed-second",
  });
  assert.notEqual(firstLine.reservation.variantId, secondLine.reservation.variantId,
    "one seller payment attempt may reserve multiple variants");
  const wrongSellerAttempt = randomUUID();
  const wrongSellerOrderId = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);
  mem.paymentAttempts.set(wrongSellerAttempt, {
    id: wrongSellerAttempt,
    order_id: wrongSellerOrderId,
    storefront_id: randomUUID(),
  });
  await assert.rejects(
    () => storefronts.reserveStorefrontInventory({
      variantId, orderId: wrongSellerOrderId, paymentAttemptId: wrongSellerAttempt,
      quantity: 1, operationKey: "inventory-wrong-seller-op",
    }),
    (error) => error.code === "PAYMENT_ATTEMPT_MISMATCH",
  );

  const crossTenantOrderId = await createNativeMemoryOrder(randomUUID(), listing.itemId);
  await assert.rejects(
    () => storefronts.reserveStorefrontInventory({
      variantId, orderId: crossTenantOrderId, quantity: 1,
      operationKey: "inventory-cross-tenant-op",
    }),
    (error) => error.code === "ORDER_STOREFRONT_MISMATCH",
  );
  await assert.rejects(
    () => storefronts.reserveStorefrontFee({
      storefrontId: owner.storefront.id, orderId: crossTenantOrderId, maximumCents: 100,
      operationKey: "fee-cross-tenant-op",
    }),
    (error) => error.code === "ORDER_STOREFRONT_MISMATCH",
  );

  const stockOrderA = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);
  const stockOrderB = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);
  const stockRace = await Promise.allSettled([
    storefronts.reserveStorefrontInventory({
      variantId, orderId: stockOrderA, quantity: 1, operationKey: "inventory-reserve-a",
    }),
    storefronts.reserveStorefrontInventory({
      variantId, orderId: stockOrderB, quantity: 1, operationKey: "inventory-reserve-b",
    }),
  ]);
  assert.equal(stockRace.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(stockRace.filter((entry) => entry.status === "rejected" && entry.reason.code === "OUT_OF_STOCK").length, 1);
  const reservation = stockRace.find((entry) => entry.status === "fulfilled").value.reservation;
  const consumed = await storefronts.consumeStorefrontInventory({
    reservationId: reservation.id, operationKey: "inventory-consume-a",
  });
  assert.equal(consumed.reservation.state, "consumed");
  assert.equal((await storefronts.consumeStorefrontInventory({
    reservationId: reservation.id, operationKey: "inventory-consume-a",
  })).duplicate, true);
  assert.equal(catalogMem.items.get(listing.itemId).inventory_available, 0);

  const feeOrderA = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);
  const feeOrderB = await createNativeMemoryOrder(owner.storefront.id, listing.itemId);
  const feeRace = await Promise.all([
    storefronts.reserveStorefrontFee({
      storefrontId: owner.storefront.id, orderId: feeOrderA, maximumCents: 2_000,
      operationKey: "fee-reserve-order-a",
    }),
    storefronts.reserveStorefrontFee({
      storefrontId: owner.storefront.id, orderId: feeOrderB, maximumCents: 2_000,
      operationKey: "fee-reserve-order-b",
    }),
  ]);
  assert.equal(feeRace.reduce((sum, value) => sum + value.reservation.amountCents, 0), 3_000);
  assert.equal(feeRace.at(-1).feeBalance.reservedCents, 3_000);
  await assert.rejects(
    () => storefronts.confirmStorefrontFee({
      reservationId: feeRace[0].reservation.id,
      operationKey: "fee-confirm-missing-proof",
    }),
    (error) => error.code === "PROVIDER_PROOF_REQUIRED",
  );
  const collected = [];
  for (const [index, value] of feeRace.entries()) {
    collected.push(await storefronts.confirmStorefrontFee({
      reservationId: value.reservation.id,
      operationKey: `fee-confirm-order-${index}`,
      stripeAccountId: "acct_test_storefront",
      stripeApplicationFeeId: `fee_test_${index}`,
      stripeEventId: `evt_test_${index}`,
      livemode: false,
    }));
  }
  assert.equal(collected.at(-1).feeBalance.collectedCents, 3_000);
  assert.equal((await storefronts.confirmStorefrontFee({
    reservationId: feeRace[0].reservation.id,
    operationKey: "fee-confirm-order-0",
  })).duplicate, true);
  await assert.rejects(
    () => storefronts.reverseStorefrontFee({
      collectionEventId: collected[0].event.id,
      amountCents: 400,
      operationKey: "fee-reverse-missing-proof",
    }),
    (error) => error.code === "PROVIDER_PROOF_REQUIRED",
  );
  const reversed = await storefronts.reverseStorefrontFee({
    collectionEventId: collected[0].event.id,
    amountCents: 400,
    operationKey: "fee-reverse-order-a",
    stripeFeeRefundId: "fr_test_1",
    stripeEventId: "evt_test_reverse_1",
  });
  assert.equal(reversed.feeBalance.collectedCents, 2_600);
  assert.equal(reversed.feeBalance.remainingCents, 400);
  assert.equal((await storefronts.reverseStorefrontFee({
    collectionEventId: collected[0].event.id,
    amountCents: 400,
    operationKey: "fee-reverse-order-a",
  })).duplicate, true);
  const envelope = await storefronts.getStorefrontForOwner(accountId);
  assert.equal(envelope.feeEvents.length, 5);
  assert.deepEqual(Object.keys(envelope.feeEvents[0]).sort(), [
    "amountCents", "createdAt", "currency", "id", "kind", "orderId",
  ]);
});
