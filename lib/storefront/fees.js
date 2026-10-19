// lib/storefront/fees.js — canonical native-commerce money policy.
//
// Every value in this module is an INTEGER MINOR UNIT. The existing external
// ticket rail keeps its historical 1% / 50-cent snapshots in lib/orders.js;
// native Storefront quotes use only this versioned policy. Keeping the maths
// pure makes the quote, receipt, ledger and reconciliation paths share one
// answer without importing a payment provider.

export const PASSENGER_FEE_POLICY_VERSION = "passenger-v2-2026-10-02";
export const STOREFRONT_FEE_POLICY_VERSION = "storefront-activation-v2-2026-10-18";
export const STOREFRONT_FEE_TARGET_CENTS = 3_000;
// Owner ruling 18 Oct 2026 (CONSTITUTION A6): the one-time activation is
// owed ONLY by a storefront that releases at scale — a DROP. A SELL-only
// storefront owes nothing to ASILUM on the seller's side; it is subject to
// the processor's own fees, which ASILUM does not control.
export const ACTIVATION_APPLIES_TO = Object.freeze(["drop"]);
/** Does the activation apply to a storefront with these listing modes? */
export function activationApplies(modes = []) {
  return (modes || []).some((m) => ACTIVATION_APPLIES_TO.includes(String(m || "").toLowerCase()));
}
/** What a storefront owes toward activation: the target when a DROP exists, else nothing. */
export function activationOwedCents({ modes = [], targetCents = STOREFRONT_FEE_TARGET_CENTS, collectedCents = 0 } = {}) {
  if (!activationApplies(modes)) return 0;
  return Math.max(0, targetCents - Math.max(0, collectedCents));
}
export const PASSENGER_FEE_FLAT_CENTS = 100;
export const PASSENGER_FEE_RATE_NUMERATOR = 150;
export const PASSENGER_FEE_RATE_DENOMINATOR = 10_000;

function cents(value, name, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new TypeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} integer number of cents`);
  }
  return value;
}

/** Round a non-negative integer ratio half up, without binary floating point. */
export function roundHalfUpRatio(value, numerator, denominator) {
  cents(value, "value");
  cents(numerator, "numerator");
  cents(denominator, "denominator", { allowZero: false });
  const scaled = BigInt(value) * BigInt(numerator);
  return Number((scaled * 2n + BigInt(denominator)) / (BigInt(denominator) * 2n));
}

/** The buyer-paid passenger fee for one physical unit. */
export function passengerUnitFeeCents(unitMerchandiseCents) {
  cents(unitMerchandiseCents, "unit merchandise");
  return PASSENGER_FEE_FLAT_CENTS + roundHalfUpRatio(
    unitMerchandiseCents,
    PASSENGER_FEE_RATE_NUMERATOR,
    PASSENGER_FEE_RATE_DENOMINATOR,
  );
}

/**
 * Allocate one order-level discount across physical units deterministically.
 * Floors the pro-rata shares, then assigns leftover cents by largest remainder
 * (stable original-index tie break). No unit can be discounted below zero.
 */
export function allocateDiscountAcrossUnits(unitAmountsCents, discountCents = 0) {
  if (!Array.isArray(unitAmountsCents) || unitAmountsCents.length === 0) {
    throw new TypeError("at least one merchandise unit is required");
  }
  const units = unitAmountsCents.map((value, index) => cents(value, `unit ${index}`, { allowZero: false }));
  const total = units.reduce((sum, value) => sum + value, 0);
  cents(discountCents, "discount");
  if (discountCents > total) throw new RangeError("discount cannot exceed merchandise value");
  if (discountCents === 0) return [...units];
  if (discountCents === total) return units.map(() => 0);

  const shares = units.map((value, index) => {
    const product = BigInt(value) * BigInt(discountCents);
    return {
      index,
      floor: Number(product / BigInt(total)),
      remainder: product % BigInt(total),
    };
  });
  let assigned = shares.reduce((sum, share) => sum + share.floor, 0);
  const ranked = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (let i = 0; assigned < discountCents; i++, assigned++) ranked[i].floor += 1;
  const allocations = Array(units.length).fill(0);
  for (const share of shares) allocations[share.index] = units[share.index] - share.floor;
  return allocations;
}

/** Server quote shared by checkout, receipt and acceptance fixtures. */
export function quoteNativeOrder({
  unitAmountsCents,
  discountCents = 0,
  shippingCents = 0,
  handlingCents = 0,
  taxCents = 0,
  currency = "usd",
} = {}) {
  const allocatedUnitAmountsCents = allocateDiscountAcrossUnits(unitAmountsCents, discountCents);
  cents(shippingCents, "shipping");
  cents(handlingCents, "handling");
  cents(taxCents, "tax");
  if (!/^[a-z]{3}$/.test(String(currency))) throw new TypeError("currency must be a lowercase ISO code");
  const merchandiseCents = allocatedUnitAmountsCents.reduce((sum, amount) => sum + amount, 0);
  const passengerFeeUnitCents = allocatedUnitAmountsCents.map(passengerUnitFeeCents);
  const passengerFeeCents = passengerFeeUnitCents.reduce((sum, amount) => sum + amount, 0);
  return Object.freeze({
    policyVersion: PASSENGER_FEE_POLICY_VERSION,
    currency,
    unitCount: allocatedUnitAmountsCents.length,
    allocatedUnitAmountsCents,
    passengerFeeUnitCents,
    merchandiseCents,
    discountCents,
    passengerFeeCents,
    shippingCents,
    handlingCents,
    taxCents,
    buyerTotalCents: merchandiseCents + passengerFeeCents + shippingCents + handlingCents + taxCents,
  });
}

/**
 * Settle actual seller proceeds after capture. `processingCents` must be the
 * provider's actual attributed processing cost, never a guessed percentage.
 * Shipping/handling stay protected by default as fulfilment obligations.
 */
export function settleSellerProceeds({
  merchandiseCents,
  shippingCents = 0,
  handlingCents = 0,
  processingCents,
  refundsCents = 0,
  reservesCents = 0,
  fulfillmentObligationCents = shippingCents + handlingCents,
  outstandingStorefrontFeeCents = STOREFRONT_FEE_TARGET_CENTS,
} = {}) {
  for (const [name, value] of Object.entries({
    merchandiseCents, shippingCents, handlingCents, processingCents, refundsCents,
    reservesCents, fulfillmentObligationCents, outstandingStorefrontFeeCents,
  })) cents(value, name);
  const grossSellerFundsCents = merchandiseCents + shippingCents + handlingCents;
  // Preserve the signed pre-Storefront result for reconciliation. Collection
  // still clamps at zero, but an underlying processor/refund shortfall must
  // remain visible rather than being disguised as an ordinary zero payout.
  const sellerBalanceBeforeStorefrontFeeCents = grossSellerFundsCents
    - processingCents - refundsCents - reservesCents - fulfillmentObligationCents;
  const sellerShortfallCents = Math.max(0, -sellerBalanceBeforeStorefrontFeeCents);
  const eligibleSellerProceedsCents = Math.max(0, sellerBalanceBeforeStorefrontFeeCents);
  const storefrontFeeCollectedCents = Math.min(
    outstandingStorefrontFeeCents,
    eligibleSellerProceedsCents,
  );
  return Object.freeze({
    policyVersion: STOREFRONT_FEE_POLICY_VERSION,
    grossSellerFundsCents,
    sellerBalanceBeforeStorefrontFeeCents,
    sellerShortfallCents,
    eligibleSellerProceedsCents,
    storefrontFeeCollectedCents,
    sellerPayoutCents: eligibleSellerProceedsCents - storefrontFeeCollectedCents,
    storefrontFeeRemainingCents: outstandingStorefrontFeeCents - storefrontFeeCollectedCents,
  });
}

/** Derive the one-time fee balance from immutable ledger events. */
export function deriveStorefrontFeeState(events = [], targetCents = STOREFRONT_FEE_TARGET_CENTS) {
  cents(targetCents, "target");
  const reservations = new Map();
  let collectedCents = 0;
  for (const [index, event] of events.entries()) {
    if (!event || !["reserved", "collected", "released", "reversed"].includes(event.kind)) {
      throw new TypeError(`invalid storefront fee event at index ${index}`);
    }
    const amount = cents(event.amountCents, `event ${index} amount`, { allowZero: false });
    const key = event.reservationKey ? String(event.reservationKey) : null;
    if (event.kind === "reserved") {
      if (!key) throw new TypeError("reserved events require a reservation key");
      reservations.set(key, (reservations.get(key) || 0) + amount);
    } else if (event.kind === "collected") {
      collectedCents += amount;
      if (key) reservations.set(key, Math.max(0, (reservations.get(key) || 0) - amount));
    } else if (event.kind === "released") {
      if (!key) throw new TypeError("released events require a reservation key");
      reservations.set(key, Math.max(0, (reservations.get(key) || 0) - amount));
    } else {
      collectedCents = Math.max(0, collectedCents - amount);
    }
  }
  const reservedCents = [...reservations.values()].reduce((sum, amount) => sum + amount, 0);
  return Object.freeze({
    targetCents,
    collectedCents,
    reservedCents,
    outstandingCents: Math.max(0, targetCents - collectedCents),
    unreservedOutstandingCents: Math.max(0, targetCents - collectedCents - reservedCents),
  });
}
