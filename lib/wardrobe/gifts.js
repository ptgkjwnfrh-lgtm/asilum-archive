// lib/wardrobe/gifts.js — THE GIFT, AS RULES (V.2 brief §8). Client-safe.
//
// A gift is a pending DIGITAL TRANSFER of one wardrobe card to one resolved
// passenger. The recipient must accept. Acceptance moves the active card and
// records a transfer event; decline, cancel and expiry leave ownership where
// it was. The store (lib/db/production/wardrobeTransfers.js) holds the
// transaction; this file holds what a route, a test and the tab all need to
// agree on: the words both parties see, the state machine, the expiry.

/** Both parties see this, verbatim, on every transfer surface. */
export const TRANSFER_DISCLAIMER = "Digital wardrobe transfer. Physical delivery is not verified by ASILUM.";

export const GIFT_EXPIRY_DAYS = 14;
export const GIFT_NOTE_MAX = 200;
export const GIFT_STATES = Object.freeze(["pending", "accepted", "declined", "cancelled", "expired"]);
export const PROVENANCE = Object.freeze({ purchase: "purchase record", self: "added by you", transferred: "digitally transferred" });

/**
 * The state machine, as a pure function: which transition `actor` may make
 * from `state`. `actor` is "sender" | "recipient" | "clock".
 * Returns the next state or null.
 */
export function giftTransition(state, act, actor) {
  if (state !== "pending") return null;                       // every decided state is final
  if (act === "accept" && actor === "recipient") return "accepted";
  if (act === "decline" && actor === "recipient") return "declined";
  if (act === "cancel" && actor === "sender") return "cancelled";
  if (act === "expire" && actor === "clock") return "expired";
  return null;
}

/** Has this offer run out? Pure. */
export function giftExpired(expiresAt, now = Date.now()) {
  const t = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

/** The expiry stamp for a new offer. */
export function giftExpiry(now = Date.now(), days = GIFT_EXPIRY_DAYS) {
  return new Date(now + days * 86_400_000).toISOString();
}

/** The sentence the tab shows for how THIS owner came by a piece. */
export function provenanceLabel(piece) {
  const p = piece && piece.provenance;
  if (p === "transferred") return piece.transferredFromHandle ? `digitally transferred from ${piece.transferredFromHandle}` : "digitally transferred";
  if (p === "purchase" || (piece && piece.source === "ticket" && !p)) return "from a purchase record";
  if (piece && piece.source === "catalog" && !p) return "from the catalog";
  return "added by you";
}

/** A card's snapshot at offer time — the sender's receipt, never the photo. */
export function giftSnapshot(piece) {
  return {
    title: piece.title, brand: piece.brand || null, category: piece.category || null,
    sizeLabel: piece.sizeLabel || null, source: piece.source || null,
  };
}
