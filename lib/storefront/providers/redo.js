// lib/storefront/providers/redo.js — THE PROTECTION PROVIDER SEAM (V.2
// Blueprint 6.2: "Dynamic provider quote based on item value, shipping,
// destination and coverage. REDO is the proposed provider pending
// agreement"). SERVER-ONLY.
//
// There is no agreement and no key, so this adapter never quotes: it answers
// `available: false` with the reason, and the checkout's |A| Protection toggle
// says so (lib/storefront/protection.js protectionOffer). When an agreement
// exists, REDO_API_KEY names it and this file gains the request; until then a
// quote would be a number nobody can honour.

export const PROVIDER = "redo";

export function providerConfigured(env = process.env) {
  return typeof env.REDO_API_KEY === "string" && env.REDO_API_KEY.length >= 16;
}

/** The quote for one order's protection, or the honest absence of one. */
export async function quoteProtection({ itemValueCents, shippingCents = 0, destination = null, coverage = "returns+transit" } = {}, env = process.env) {
  if (!providerConfigured(env)) {
    return { available: false, provider: PROVIDER, reason: "no protection provider is agreed yet — REDO is proposed, pending agreement (6.2)" };
  }
  // The agreed request lands here. Nothing is invented before it does.
  return { available: false, provider: PROVIDER, reason: "the REDO quote request is not implemented — the key is set but no contract is in the code", inputs: { itemValueCents, shippingCents, destination, coverage } };
}
