// lib/storefront/commerce.js — NATIVE COMMERCE'S LAW (V.2 Blueprint, owner,
// 17 Oct 2026, chapter 7 "Native commerce, offers and discounts", chapter 8
// "Discounts, price locks and private offers"; slice 6 over
// the native-storefront branch). PURE and client-safe: every rule is a number or
// a function here, so a test can hold it and both backends read one law.
//
//   SELL and DROP (7.4)          SELL is single-item; DROP carries quantities,
//                                sizes, colors, variations; DROP is
//                                authenticated before release (chapter 12).
//   RESERVATIONS (7.5–7.9)       inventory is reserved only during an active
//                                checkout; the Bag reserves nothing; the first
//                                valid request wins; others see "reserved".
//                                The reservation itself is the storefront's
//                                (lib/db/storefrontCheckout.js); this module
//                                reads its state.
//   THE QUEUE (7.10–7.13)        a reserved listing has a first-come waiting
//                                queue; a release notifies everyone and stays
//                                first come, first served — a courtesy, never
//                                a hold; a sale notifies everyone and closes
//                                it; a return reopens it to everyone.
//   RELISTING (7.14–7.18)        seller confirmation for every relist, one
//                                tap with a condition confirmation; a changed
//                                condition needs new details and photographs;
//                                any new price; previous prices private;
//                                likes and saves carry over; discounts do not
//                                (8.12).
//   OFFERS (7.19–7.30, 8.7–8.11) accept, decline or counter, optional
//                                auto-accept; acceptance unlocks checkout at
//                                the agreed price for that buyer only, for 24
//                                hours, reserving nothing; sold meanwhile
//                                invalidates it; unlimited offers and
//                                counters; every counter restarts the 24-hour
//                                window for the receiving party; nothing is
//                                withdrawn once sent; reminders by preset.
//   DISCOUNTS (7.31–7.34, 8.1–8.6, 8.13)  24 hours, manual renewal, every
//                                application and renewal notifies the likers
//                                at 10% or more above the passenger's own
//                                threshold; edit or cancel any time; the
//                                discounted price with the percentage off,
//                                the original never the headline; a private
//                                history; the locked checkout price is the
//                                price (8.4–8.5).

export const MODES = Object.freeze(["sell", "drop"]);
export const OFFER_WINDOW_MS = 24 * 3_600_000;
export const ACCEPTED_WINDOW_MS = 24 * 3_600_000;
export const DISCOUNT_WINDOW_MS = 24 * 3_600_000;
export const DISCOUNT_NOTIFY_MIN_PERCENT = 10;     // 8.1 supersedes the earlier 20%
export const DISCOUNT_MAX_PERCENT = 90;
export const OFFER_STATES = Object.freeze(["open", "accepted", "declined", "countered", "expired", "invalidated"]);
export const QUEUE_STATES = Object.freeze(["waiting", "notified", "closed"]);
export const REMINDER_PRESETS = Object.freeze({
  minimal: [60],
  standard: [12 * 60, 3 * 60, 30],
  frequent: [12 * 60, 6 * 60, 3 * 60, 60, 30, 5],
});
export const DEFAULT_REMINDER_PRESET = "standard";
export const OFFER_NOTIFICATION_KINDS = Object.freeze(["offer-new", "offer-counter", "offer-accepted", "offer-declined", "offer-expiring", "offer-invalidated"]);
export const DISCOUNT_NOTIFICATION_KIND = "discount";
export const QUEUE_NOTIFICATION_KINDS = Object.freeze(["queue-available", "queue-sold", "queue-returned"]);

const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN);
const ms = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v || "")));

// ---- SELL and DROP --------------------------------------------------------------

/** The mode a listing is in: its own column, or SELL when it has one unit and one variant. */
export function modeOf(listing = {}) {
  if (MODES.includes(listing.mode)) return listing.mode;
  const variants = Array.isArray(listing.variants) ? listing.variants : [];
  const units = variants.length
    ? variants.reduce((s, v) => s + (int(v.stockOnHand ?? v.stock_on_hand ?? v.quantity) || 0), 0)
    : int(listing.quantity ?? listing.inventory) || 0;
  return variants.length <= 1 && units <= 1 ? "sell" : "drop";
}

/**
 * Does the listing's shape fit its mode? SELL: one unit, one variant, no
 * option values. DROP: any quantity, any variants. `{ ok, reason }`.
 */
export function validateMode(mode, { quantity = 1, variants = [] } = {}) {
  if (!MODES.includes(mode)) return { ok: false, reason: "mode must be sell or drop" };
  const list = Array.isArray(variants) ? variants : [];
  if (mode === "sell") {
    if (list.length > 1) return { ok: false, reason: "SELL is a single item: one variant" };
    const units = list.length ? int(list[0].stockOnHand ?? list[0].quantity ?? quantity) : int(quantity);
    if (!(units >= 0 && units <= 1)) return { ok: false, reason: "SELL is a single item: quantity 1" };
    if (list.length && list[0].optionValues && Object.keys(list[0].optionValues).length) return { ok: false, reason: "SELL carries no variations" };
    return { ok: true };
  }
  if (!(int(quantity) >= 0) && !list.length) return { ok: false, reason: "DROP needs a quantity" };
  return { ok: true };
}

/** A DROP is authenticated before release (12.2): active needs VERIFIED; a SELL goes live as PENDING. */
export function releasable(mode, verificationState) {
  const v = String(verificationState || "none").toLowerCase();
  if (mode === "drop") return { ok: v === "verified", reason: v === "verified" ? null : "a DROP is authenticated before release — STATUS must be VERIFIED" };
  return { ok: true, reason: null }; // a SELL item is live immediately as STATUS: PENDING (12.2)
}

// ---- availability and the queue -----------------------------------------------------

/** What a passenger sees: available, reserved (every unit is in someone's checkout), or sold out. */
export function availabilityOf(variant = {}) {
  const onHand = int(variant.stockOnHand ?? variant.stock_on_hand) || 0;
  const reserved = int(variant.stockReserved ?? variant.stock_reserved) || 0;
  if (onHand <= 0) return "sold_out";
  return onHand - reserved > 0 ? "available" : "reserved";
}

/** The queue is first come, first served: joined-at ascending. */
export function queueOrder(members = []) {
  return [...members].sort((a, b) => ms(a.joinedAt) - ms(b.joinedAt));
}

/**
 * What the queue does on an event. A release notifies every waiting member
 * (a courtesy — nothing is held); a sale notifies everyone and closes the
 * queue; a return or cancellation reopens it and notifies everyone again.
 */
export function queueEvent(event, members = []) {
  const waiting = members.filter((m) => m.state !== "closed");
  if (event === "released") return { notify: queueOrder(waiting).map((m) => m.userId), kind: "queue-available", close: false };
  if (event === "sold") return { notify: queueOrder(waiting).map((m) => m.userId), kind: "queue-sold", close: true };
  if (event === "returned") return { notify: queueOrder(members).map((m) => m.userId), kind: "queue-returned", close: false, reopen: true };
  return { notify: [], kind: null, close: false };
}

// ---- offers -----------------------------------------------------------------------

/** Round half up to whole cents from a percentage. */
export function percentOff(priceCents, percent) {
  const p = int(priceCents), pct = Number(percent);
  if (!(p > 0) || !Number.isFinite(pct) || pct < 0) return NaN;
  return p - Math.floor((p * pct) / 100 + 0.5);
}

/** The live state of an offer at `now` — expiry is read, never written. */
export function offerState(offer = {}, now = Date.now()) {
  const s = offer.state || "open";
  if (s === "open" && ms(offer.expiresAt) <= now) return "expired";
  if (s === "accepted" && ms(offer.acceptedUntil) <= now) return "expired";
  return s;
}

/** May a buyer offer on this listing now? (7.19: the seller decides during a discount.) */
export function offerAllowed({ listing = {}, discountActive = false, settings = {} } = {}) {
  if (listing.state && listing.state !== "active") return { ok: false, reason: "offers are open on active listings only" };
  if (settings.acceptOffers === false) return { ok: false, reason: "this seller is not taking offers" };
  if (discountActive && settings.offersDuringDiscount === false) return { ok: false, reason: "this seller is not taking offers while a discount runs" };
  return { ok: true };
}

/** A new offer from a buyer: open for 24 hours; nothing is withdrawn once sent (8.9). */
export function newOffer({ listingId, variantId = null, buyerId, sellerAccountId, amountCents, listPriceCents, currency = "usd", now = Date.now(), parentId = null, by = "buyer" } = {}) {
  const amount = int(amountCents);
  if (!(amount > 0)) return { ok: false, reason: "an offer is a positive whole number of cents" };
  if (int(listPriceCents) > 0 && amount > int(listPriceCents) * 10) return { ok: false, reason: "an offer cannot be ten times the price" };
  return {
    ok: true,
    offer: {
      listingId, variantId, buyerId, sellerAccountId, amountCents: amount, currency: String(currency).toLowerCase(),
      state: "open", by, parentId, createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OFFER_WINDOW_MS).toISOString(), acceptedUntil: null, respondedAt: null,
    },
  };
}

/** Auto-accept: a buyer's offer at or above the seller's threshold is accepted on arrival (7.20). */
export function autoAccepts(offer, settings = {}) {
  const t = int(settings.autoAcceptCents);
  return offer && offer.by === "buyer" && t > 0 && int(offer.amountCents) >= t;
}

/**
 * The seller's (or, on a counter, the buyer's) response. Accept unlocks a
 * 24-hour exclusive checkout at the agreed price, reserving nothing; a
 * counter is a NEW offer from the other side with a fresh 24-hour window;
 * decline ends it. Only the receiving party may respond, and only while open.
 */
export function respondToOffer(offer, { action, amountCents = null, by, now = Date.now() } = {}) {
  const state = offerState(offer, now);
  if (state !== "open") return { ok: false, reason: `the offer is ${state}` };
  const receiver = offer.by === "buyer" ? "seller" : "buyer";
  if (by !== receiver) return { ok: false, reason: `only the ${receiver} can answer this offer` };
  const at = new Date(now).toISOString();
  if (action === "accept") {
    return { ok: true, offer: { ...offer, state: "accepted", respondedAt: at, acceptedUntil: new Date(now + ACCEPTED_WINDOW_MS).toISOString() }, counter: null };
  }
  if (action === "decline") return { ok: true, offer: { ...offer, state: "declined", respondedAt: at }, counter: null };
  if (action === "counter") {
    const made = newOffer({ listingId: offer.listingId, variantId: offer.variantId, buyerId: offer.buyerId, sellerAccountId: offer.sellerAccountId, amountCents, currency: offer.currency, now, parentId: offer.id || null, by });
    if (!made.ok) return made;
    return { ok: true, offer: { ...offer, state: "countered", respondedAt: at }, counter: made.offer };
  }
  return { ok: false, reason: "accept, decline or counter" };
}

/** A sale during an accepted offer invalidates it (7.22) — the buyer is told why. */
export function invalidateOnSale(offer, now = Date.now()) {
  const s = offerState(offer, now);
  if (s !== "accepted" && s !== "open") return offer;
  return { ...offer, state: "invalidated", respondedAt: new Date(now).toISOString(), note: "the item was bought by someone else — accepted offers never reserve inventory" };
}

/** The price an accepted offer unlocks for ITS buyer, or null. */
export function acceptedPriceFor(offer, buyerId, now = Date.now()) {
  if (!offer || offer.buyerId !== buyerId) return null;
  if (offerState(offer, now) !== "accepted") return null;
  return int(offer.amountCents);
}

/** The reminder moments before an expiry for a preset, as ISO strings, in order. */
export function reminderTimes(expiresAt, preset = DEFAULT_REMINDER_PRESET, now = Date.now()) {
  const minutes = REMINDER_PRESETS[preset] || REMINDER_PRESETS[DEFAULT_REMINDER_PRESET];
  const end = ms(expiresAt);
  return minutes.map((m) => end - m * 60_000).filter((t) => t > now).sort((a, b) => a - b).map((t) => new Date(t).toISOString());
}

// ---- discounts --------------------------------------------------------------------

/** A discount: percent off the price before it, for 24 hours. `{ ok, discount | reason }`. */
export function newDiscount({ listingId, percent, priceBeforeCents, now = Date.now(), renewedFrom = null } = {}) {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct < 1 || pct > DISCOUNT_MAX_PERCENT) return { ok: false, reason: `a discount is 1–${DISCOUNT_MAX_PERCENT} percent` };
  const before = int(priceBeforeCents);
  if (!(before > 0)) return { ok: false, reason: "a discount needs the price before it" };
  const priceCents = percentOff(before, pct);
  if (!(priceCents > 0)) return { ok: false, reason: "the discounted price must stay above zero" };
  return {
    ok: true,
    discount: { listingId, percent: pct, priceBeforeCents: before, priceCents, startsAt: new Date(now).toISOString(), endsAt: new Date(now + DISCOUNT_WINDOW_MS).toISOString(), state: "active", renewedFrom },
  };
}

/** Is the discount live at `now`? */
export function discountActive(discount, now = Date.now()) {
  return !!discount && discount.state === "active" && ms(discount.endsAt) > now;
}

/** Who is told: everyone who liked it, when the percent clears both the platform floor and the passenger's own threshold (8.1, 7.34). Every application and renewal notifies (7.33). */
export function discountNotifies(percent, passengerMinPercent = DISCOUNT_NOTIFY_MIN_PERCENT) {
  const pct = Number(percent);
  const min = Math.max(DISCOUNT_NOTIFY_MIN_PERCENT, Number(passengerMinPercent) || 0);
  return pct >= min;
}

/** What a passenger sees (8.6): the discounted price with the percent off; the original is not the headline. */
export function displayPrice(priceBeforeCents, discount, now = Date.now()) {
  if (discountActive(discount, now)) return { priceCents: discount.priceCents, percentOff: discount.percent, discounted: true };
  return { priceCents: int(priceBeforeCents), percentOff: 0, discounted: false };
}

// ---- relisting ----------------------------------------------------------------------

/**
 * Relisting needs the seller's confirmation and a condition confirmation;
 * a changed condition needs new details and new photographs; the new price
 * is the seller's; discounts do not survive. `{ ok, plan | reasons }`.
 */
export function relistPlan({ listing = {}, confirm = false, conditionConfirmed = false, conditionChanged = false, condition = null, photos = [], priceCents = null, quantity = 1 } = {}) {
  const reasons = [];
  if (!confirm) reasons.push("seller confirmation is required for every relisting (7.14)");
  if (!conditionConfirmed) reasons.push("confirm the condition (7.15)");
  if (conditionChanged) {
    if (!condition || String(condition).trim().length < 3) reasons.push("a changed condition needs updated condition details (7.16)");
    const fresh = (Array.isArray(photos) ? photos : []).filter((p) => p && !(listing.photos || []).includes(p));
    if (!fresh.length) reasons.push("a changed condition needs new photographs (7.16)");
  }
  const price = priceCents == null ? int(listing.priceCents) : int(priceCents);
  if (!(price > 0)) reasons.push("a relist carries a positive price (7.17)");
  const qty = int(quantity);
  if (!(qty >= 1)) reasons.push("a relist carries at least one unit");
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    plan: {
      condition: conditionChanged ? String(condition).trim() : (listing.condition || null),
      photos: conditionChanged ? photos : (listing.photos || []),
      priceCents: price, quantity: qty,
      cancelDiscounts: true,            // 8.12
      preserveEngagement: true,         // 7.18 — the item id is unchanged, likes and saves stay
      previousPricePrivate: true,       // 7.17
    },
  };
}
