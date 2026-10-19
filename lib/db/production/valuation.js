// lib/db/production/valuation.js — THE SALES HISTORY BEHIND A VALUATION
// (V.2 chapter 11; slice 12). The comparables are paid sales ASILUM itself
// recorded — the orders ledger joined to the catalog — on either backend.
// Nothing external, nothing guessed; an item without a brand reads no history.

import { listRecentOrders } from "../orders.js";
import { resolveProducts } from "../../products.js";
import { valuationOf } from "../../valuation/comparables.js";

const norm = (s) => String(s || "").trim().toLowerCase();

/** Paid sales of a brand (and garment, when given): [{ brand, category, era, condition, amountCents, paidAt }]. */
export async function salesHistory({ brand, category = null, limit = 400 } = {}) {
  if (!norm(brand)) return [];
  // the orders ledger's own reader serves both backends (its memory store is module-private)
  const orders = (await listRecentOrders(Math.min(200, limit))).filter((o) => o.status === "paid" && (o.kind || "sale") === "sale");
  const ids = [...new Set(orders.map((o) => String(o.item_id || "")).filter(Boolean))];
  const items = ids.length ? await resolveProducts(ids).catch(() => []) : [];
  const byId = new Map((items || []).map((it) => [String(it.id), it]));
  const out = [];
  for (const o of orders) {
    const it = byId.get(String(o.item_id));
    if (!it || norm(it.brand) !== norm(brand)) continue;
    if (category && norm(it.category) !== norm(category)) continue;
    out.push({ brand: it.brand, category: it.category || null, era: it.era || null, condition: it.condition || null, amountCents: Number(o.merchandise_cents || o.amount_cents || 0), paidAt: o.created_at ? new Date(o.created_at).toISOString() : null });
  }
  return out;
}

/** The valuation read for one catalog item. */
export async function valuationFor(item) {
  if (!item) return null;
  const history = await salesHistory({ brand: item.brand, category: item.category });
  return valuationOf(item, history);
}
