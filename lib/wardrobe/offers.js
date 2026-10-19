// lib/wardrobe/offers.js — WARDROBE PRIVATE SALES (V.2 Blueprint, owner, 17
// Oct 2026, chapter 13 "Wardrobe and private sales" 13.3–13.17; slice 11).
// PURE and client-safe.
//
//   TWO TOGGLES (13.3)       Wardrobe visibility and Accept Wardrobe Offers
//                            are different choices.
//   DM FIRST (13.4)          a buyer sends a message to the owner to make an
//                            offer; there is no offer button without a
//                            message. The store takes an offer only with the
//                            conversation it came from.
//   ONE AT A TIME (13.5)     one active offer or negotiation per item;
//                            lifetime offers unlimited.
//   ACCEPTANCE (13.6–13.9)   opens a private, exclusive 24-hour checkout for
//                            that buyer only; never a public listing; the
//                            item leaves Search on acceptance and stays
//                            hidden through the paid transfer; unpaid after
//                            24 hours, nothing changed.
//   OWNERSHIP (13.10)        stays with the owner until carrier-confirmed
//                            delivery, then moves to the buyer's Wardrobe,
//                            exactly once.
//   COOLDOWN (13.11–13.13)   declined, unanswered or accepted-but-unpurchased
//                            puts the item on a 14-day offer cooldown, no
//                            public indicator; turning offers off cancels
//                            active unpaid negotiations, accepted-but-unpaid
//                            included; re-enabling does not bypass a cooldown.
//   CANCELLATION (13.14–13.16)  the seller may cancel before carrier handoff
//                            (refund, 14-day cooldown, no automatic conduct
//                            penalty); no voluntary buyer cancellation after
//                            payment; a failed transfer restores prior
//                            ownership and visibility.
//   PRICE (13.17)            whatever the owner accepts; the passenger fee
//                            and shipping rules apply as for any sale.

import { DAY } from "../storefront/protection.js"; // one day — imported, not copied
export const OFFER_WINDOW_MS = 3 * DAY;         // an unanswered offer expires after three days (unanswered → cooldown, 13.11)
export const EXCLUSIVE_WINDOW_MS = 24 * 3_600_000; // 13.6
export const COOLDOWN_MS = 14 * DAY;              // 13.11
export const OFFER_STATES = Object.freeze(["open", "accepted", "declined", "expired", "cancelled", "paid", "lapsed"]);
export const ACTIVE_STATES = Object.freeze(["open", "accepted"]);

const ms = (v) => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v)));
const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN);

/** The state at `now`: an open offer past its window is expired; an accepted one past its 24 hours lapsed. */
export function offerStateAt(offer = {}, now = Date.now()) {
  if (offer.state === "open" && ms(offer.expiresAt) <= now) return "expired";
  if (offer.state === "accepted" && ms(offer.acceptedUntil) <= now) return "lapsed";
  return offer.state;
}

/** May a buyer open an offer on this item now (13.3–13.5, 13.11, 13.13)? */
export function offerAllowed({ item = {}, buyerId, active = [], viaMessage = false, now = Date.now() } = {}) {
  if (!item || !item.id) return { ok: false, reason: "no such piece" };
  if (item.status && item.status !== "active") return { ok: false, reason: "that piece is not in a Wardrobe any more" };
  if (String(item.ownerId) === String(buyerId)) return { ok: false, reason: "that piece is already yours" };
  if (!item.acceptOffers) return { ok: false, reason: "the owner is not accepting Wardrobe offers (13.3)" };
  if (!viaMessage) return { ok: false, reason: "an offer starts with a message to the owner — there is no offer button without one (13.4)" };
  if (item.offerCooldownUntil && ms(item.offerCooldownUntil) > now) return { ok: false, reason: "this piece is resting after its last negotiation", until: item.offerCooldownUntil, private: true };
  if ((active || []).some((o) => ACTIVE_STATES.includes(offerStateAt(o, now)))) return { ok: false, reason: "one active offer or negotiation per piece at a time (13.5)" };
  return { ok: true };
}

/** A new offer row (the store gives it an id). */
export function newOffer({ itemId, ownerId, buyerId, amountCents, conversationId = null, now = Date.now() } = {}) {
  const a = int(amountCents);
  if (!(a > 0)) return { ok: false, reason: "an offer is a positive whole number of cents" };
  return { ok: true, offer: { itemId: String(itemId), ownerId: String(ownerId), buyerId: String(buyerId), conversationId: conversationId == null ? null : String(conversationId), amountCents: a, state: "open", expiresAt: new Date(now + OFFER_WINDOW_MS).toISOString(), acceptedUntil: null, orderId: null, respondedAt: null, createdAt: new Date(now).toISOString() } };
}

/** The owner answers (13.6, 13.11): accept opens the 24-hour exclusive checkout; decline starts the cooldown. */
export function respond(offer = {}, decision, now = Date.now()) {
  const s = offerStateAt(offer, now);
  if (s !== "open") return { ok: false, reason: `this offer is ${s}` };
  if (decision === "accept") return { ok: true, offer: { ...offer, state: "accepted", acceptedUntil: new Date(now + EXCLUSIVE_WINDOW_MS).toISOString(), respondedAt: new Date(now).toISOString() }, cooldownUntil: null, hideFromSearch: true };
  if (decision === "decline") return { ok: true, offer: { ...offer, state: "declined", respondedAt: new Date(now).toISOString() }, cooldownUntil: new Date(now + COOLDOWN_MS).toISOString(), hideFromSearch: false };
  return { ok: false, reason: "accept or decline" };
}

/** Does this buyer hold the exclusive checkout on the item now (13.6, 13.8)? */
export function exclusiveFor(offer = {}, buyerId, now = Date.now()) {
  return offerStateAt(offer, now) === "accepted" && String(offer.buyerId) === String(buyerId) && ms(offer.acceptedUntil) > now;
}

/** What an ended negotiation does to the item (13.9, 13.11): nothing changes, the cooldown starts, Search may show it again when visibility allows. */
export function afterNegotiation(state, now = Date.now()) {
  if (["declined", "expired", "lapsed"].includes(state)) return { cooldownUntil: new Date(now + COOLDOWN_MS).toISOString(), hideFromSearch: false };
  if (state === "cancelled") return { cooldownUntil: null, hideFromSearch: false };
  return { cooldownUntil: null, hideFromSearch: state === "accepted" || state === "paid" };
}

/** Turning Accept Wardrobe Offers off (13.12): every active unpaid negotiation cancels; paid orders are untouched. */
export function cancelOnDisable(offers = [], now = Date.now()) {
  return (offers || []).filter((o) => ACTIVE_STATES.includes(offerStateAt(o, now))).map((o) => ({ ...o, state: "cancelled", respondedAt: new Date(now).toISOString() }));
}

/** The seller's cancellation of a paid private sale (13.14): before carrier handoff only; refund, 14-day cooldown, no automatic penalty. The buyer has none (13.15). */
export function sellerCancellation({ handedAt = null, delivered = false, now = Date.now() } = {}) {
  if (delivered || handedAt) return { ok: false, reason: "after the carrier handoff a sale is a sale; a return is the buyer's path" };
  return { ok: true, refund: "full", cooldownUntil: new Date(now + COOLDOWN_MS).toISOString(), penalty: 0, note: "no automatic conduct penalty applies solely for cancelling (13.14)" };
}

/** Ownership moves on carrier-confirmed delivery, exactly once (13.10); a failed transfer restores what was (13.16). */
export function transferOnDelivery({ paid = false, deliverySource = null, alreadyMoved = false } = {}) {
  if (alreadyMoved) return { move: false, reason: "ownership moved already — exactly once" };
  if (!paid) return { move: false, reason: "unpaid: ownership stays with the owner" };
  if (deliverySource !== "carrier") return { move: false, reason: "ownership moves on carrier-confirmed delivery, not on a seller's or an admin's word (13.10)" };
  return { move: true };
}
