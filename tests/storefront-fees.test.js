import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateDiscountAcrossUnits, deriveStorefrontFeeState, passengerUnitFeeCents,
  quoteNativeOrder, roundHalfUpRatio, settleSellerProceeds,
} from "../lib/storefront/fees.js";
import {
  normalizeListingInput, normalizeStorefrontInput, publicStorefront, STOREFRONT_CATEGORIES,
} from "../lib/storefront/contracts.js";

test("passenger fee is $1 per unit plus 1.5% merchandise, rounded half up per unit", () => {
  assert.equal(passengerUnitFeeCents(20_000), 400);
  assert.equal(passengerUnitFeeCents(1_000), 115);
  assert.equal(passengerUnitFeeCents(33), 100);
  assert.equal(passengerUnitFeeCents(34), 101);
  assert.equal(roundHalfUpRatio(1, 1, 2), 1);
  assert.equal(quoteNativeOrder({ unitAmountsCents: [1_000, 1_000, 1_000] }).passengerFeeCents, 345);
});

test("quote excludes shipping, handling and tax from the 1.5% base", () => {
  const quote = quoteNativeOrder({
    unitAmountsCents: [20_000], shippingCents: 1_200, handlingCents: 300, taxCents: 1_600,
  });
  assert.equal(quote.passengerFeeCents, 400);
  assert.equal(quote.buyerTotalCents, 23_500);
});

test("deterministic discount allocation preserves cents and stable ties", () => {
  assert.deepEqual(allocateDiscountAcrossUnits([100, 100, 100], 1), [99, 100, 100]);
  assert.deepEqual(allocateDiscountAcrossUnits([101, 100], 1), [100, 100]);
  const quote = quoteNativeOrder({ unitAmountsCents: [1_000, 1_000, 1_000], discountCents: 1 });
  assert.equal(quote.merchandiseCents, 2_999);
  assert.deepEqual(quote.allocatedUnitAmountsCents, [999, 1_000, 1_000]);
});

test("$200 first and later sale fixtures collect $30 only from seller proceeds", () => {
  const quote = quoteNativeOrder({ unitAmountsCents: [20_000] });
  assert.equal(quote.passengerFeeCents, 400);
  assert.equal(quote.buyerTotalCents, 20_400);
  const first = settleSellerProceeds({ merchandiseCents: 20_000, processingCents: 622 });
  assert.deepEqual({
    activation: first.storefrontFeeCollectedCents,
    seller: first.sellerPayoutCents,
    remainder: first.storefrontFeeRemainingCents,
  }, { activation: 3_000, seller: 16_378, remainder: 0 });
  const later = settleSellerProceeds({
    merchandiseCents: 20_000, processingCents: 622, outstandingStorefrontFeeCents: 0,
  });
  assert.equal(later.storefrontFeeCollectedCents, 0);
  assert.equal(later.sellerPayoutCents, 19_378);
});

test("small sales carry the unpaid storefront fee without a negative payout", () => {
  const one = settleSellerProceeds({ merchandiseCents: 1_000, processingCents: 62 });
  assert.deepEqual([one.storefrontFeeCollectedCents, one.sellerPayoutCents, one.storefrontFeeRemainingCents], [938, 0, 2_062]);
  const two = settleSellerProceeds({ merchandiseCents: 2_000, processingCents: 92, outstandingStorefrontFeeCents: 2_062 });
  assert.deepEqual([two.storefrontFeeCollectedCents, two.sellerPayoutCents, two.storefrontFeeRemainingCents], [1_908, 0, 154]);
  const three = settleSellerProceeds({ merchandiseCents: 1_000, processingCents: 62, outstandingStorefrontFeeCents: 154 });
  assert.deepEqual([three.storefrontFeeCollectedCents, three.sellerPayoutCents, three.storefrontFeeRemainingCents], [154, 784, 0]);
});

test("a processor or refund shortfall is disclosed but never funds the Storefront fee", () => {
  const result = settleSellerProceeds({
    merchandiseCents: 1_000, processingCents: 400, refundsCents: 800,
  });
  assert.equal(result.sellerBalanceBeforeStorefrontFeeCents, -200);
  assert.equal(result.sellerShortfallCents, 200);
  assert.equal(result.eligibleSellerProceedsCents, 0);
  assert.equal(result.storefrontFeeCollectedCents, 0);
  assert.equal(result.sellerPayoutCents, 0);
  assert.equal(result.storefrontFeeRemainingCents, 3_000);
});

test("fee ledger derives collection, active reservations and reversals", () => {
  assert.deepEqual(deriveStorefrontFeeState([
    { kind: "reserved", amountCents: 938, reservationKey: "sale-1" },
    { kind: "collected", amountCents: 938, reservationKey: "sale-1" },
    { kind: "reserved", amountCents: 500, reservationKey: "sale-2" },
  ]), { targetCents: 3_000, collectedCents: 938, reservedCents: 500, outstandingCents: 2_062, unreservedOutstandingCents: 1_562 });
  assert.equal(deriveStorefrontFeeState([
    { kind: "collected", amountCents: 3_000 },
    { kind: "reversed", amountCents: 400 },
  ]).outstandingCents, 400);
});

test("cross-category listing contracts do not require garment fields", () => {
  assert.equal(STOREFRONT_CATEGORIES.length, 7);
  for (const { id } of STOREFRONT_CATEGORIES) {
    const listing = normalizeListingInput({ title: `One ${id}`, category: id, priceCents: 1_000, quantity: 1 });
    assert.equal(listing.category, id);
    assert.deepEqual(listing.attributes, {});
  }
  assert.equal(normalizeListingInput({
    title: "Receiver", category: "electronics_tech", priceCents: 2_000, quantity: 1,
    attributes: { compatibility: "120 V", size: "XL" },
  }).attributes.size, undefined);
});

test("public storefront allowlist excludes owner and payment fields", () => {
  const store = normalizeStorefrontInput({ name: "No Emo Shop", description: "Objects" });
  const publicRow = publicStorefront({
    ...store, account_id: "private", connected_account_id: "acct_private", state: "active",
  });
  assert.equal(publicRow.slug, "no-emo-shop");
  assert.equal("account_id" in publicRow, false);
  assert.equal("connected_account_id" in publicRow, false);
});
