// lib/db/production/credit.js — ASILUM CREDIT'S LEDGER (V.2 Blueprint
// 5.26–5.32, Terms 10; slice 7; schema v65). SERVER-ONLY; memory mode mirrors
// Postgres. Append-only: a balance is derived from the entries, never stored.
// Credit enters by refund, gift and the $1 return incentive only; it leaves by
// spend, gift or an admin's void. A gift needs two-factor and device proofs
// the caller presents — this store never assumes them.

import { getPool, hasRelation } from "../core/pool.js";
import { mem } from "./store.js";
import { balanceOf, canEnter, giftCheck, LEDGER_KINDS } from "../../storefront/credit.js";

export class CreditRefused extends Error {
  constructor(code, message, status = 409) { super(message); this.name = "CreditRefused"; this.code = code; this.status = status; }
}
const applied = async (p) => (p ? hasRelation(p, "credit_ledger") : true);
const needs = () => { throw new CreditRefused("SCHEMA_V65_REQUIRED", "ASILUM Credit needs schema v65 applied", 503); };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const entryOut = (r) => ({ id: String(r.id), userId: r.user_id, kind: r.kind, amountCents: Number(r.amount_cents), orderId: r.order_id || null, counterpartyId: r.counterparty_id || null, note: r.note || null, at: iso(r.at) });

async function append({ userId, kind, amountCents, orderId = null, counterpartyId = null, note = null, now = Date.now() }) {
  if (!LEDGER_KINDS.includes(kind)) throw new CreditRefused("INVALID_KIND", "unknown ledger kind", 400);
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new CreditRefused("INVALID_AMOUNT", "a ledger entry is a positive whole number of cents", 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  if (!p) {
    const row = { id: mem.creditSeq++, user_id: userId, kind, amount_cents: amount, order_id: orderId, counterparty_id: counterpartyId, note, at: new Date(now).toISOString() };
    mem.creditLedger.push(row);
    return entryOut(row);
  }
  const { rows } = await p.query("INSERT INTO credit_ledger (user_id, kind, amount_cents, order_id, counterparty_id, note, at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [userId, kind, amount, orderId, counterpartyId, note, new Date(now).toISOString()]);
  return entryOut(rows[0]);
}

export async function creditLedger(userId, { limit = 100 } = {}) {
  const id = String(userId || "");
  const p = await getPool();
  if (!(await applied(p))) return [];
  if (!p) return mem.creditLedger.filter((r) => r.user_id === id).slice(-limit).reverse().map(entryOut);
  const { rows } = await p.query("SELECT * FROM credit_ledger WHERE user_id=$1 ORDER BY at DESC, id DESC LIMIT $2", [id, limit]);
  return rows.map(entryOut);
}

export async function creditBalance(userId) {
  const all = await creditLedger(userId, { limit: 100_000 });
  return balanceOf(all);
}

/** Credit enters: a refund, a gift, the return incentive. Nothing else (5.31). */
export async function creditIn({ userId, source, amountCents, orderId = null, counterpartyId = null, note = null, now = Date.now() }) {
  if (!canEnter(source)) throw new CreditRefused("NOT_A_SOURCE", "credit enters by refund, gift or the return incentive only — it cannot be purchased", 400);
  const kind = source === "gift" ? "gift_in" : source;
  return append({ userId, kind, amountCents, orderId, counterpartyId, note, now });
}

/** A spend at checkout: the exact amount the passenger chose, within the balance. */
export async function creditSpend({ userId, amountCents, orderId, now = Date.now() }) {
  const balance = await creditBalance(userId);
  const amount = Number(amountCents);
  if (!(amount > 0)) throw new CreditRefused("INVALID_AMOUNT", "a spend is a positive whole number of cents", 400);
  if (amount > balance) throw new CreditRefused("INSUFFICIENT", `only ${balance} cents of credit are available`, 409);
  return append({ userId, kind: "spend", amountCents: amount, orderId, now });
}

/** A spend released back (a checkout that never settled). */
export async function creditRelease({ userId, amountCents, orderId, now = Date.now() }) {
  return append({ userId, kind: "release", amountCents, orderId, note: "checkout did not settle", now });
}

/**
 * A gift through Direct Messages (10.4): the giver's two-factor and device
 * proofs are presented by the caller; without both the gift is refused.
 * Two entries, one transaction's worth: out of the giver, into the receiver.
 */
export async function giftCredit({ fromId, toId, amountCents, twoFactor = false, deviceVerified = false, note = null, now = Date.now() }) {
  const balance = await creditBalance(fromId);
  const check = giftCheck({ fromId, toId, amountCents, balanceCents: balance, twoFactor, deviceVerified });
  if (!check.ok) throw new CreditRefused("GIFT_REFUSED", check.reason, check.missing ? 403 : 400);
  const p = await getPool();
  if (!(await applied(p))) needs();
  const at = new Date(now).toISOString();
  if (p) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO credit_ledger (user_id, kind, amount_cents, counterparty_id, note, at) VALUES ($1,'gift_out',$2,$3,$4,$5)", [fromId, check.amountCents, toId, note, at]);
      await client.query("INSERT INTO credit_ledger (user_id, kind, amount_cents, counterparty_id, note, at) VALUES ($1,'gift_in',$2,$3,$4,$5)", [toId, check.amountCents, fromId, note, at]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return { gifted: check.amountCents, fromBalance: await creditBalance(fromId), toBalance: await creditBalance(toId) };
  }
  await append({ userId: fromId, kind: "gift_out", amountCents: check.amountCents, counterpartyId: toId, note, now });
  await append({ userId: toId, kind: "gift_in", amountCents: check.amountCents, counterpartyId: fromId, note, now });
  return { gifted: check.amountCents, fromBalance: await creditBalance(fromId), toBalance: await creditBalance(toId) };
}

/** An admin voids credit obtained by fraud or error (10.7). */
export async function voidCredit({ userId, amountCents, note, actor = "admin", now = Date.now() }) {
  const balance = await creditBalance(userId);
  const amount = Math.min(Number(amountCents) || 0, balance);
  if (!(amount > 0)) throw new CreditRefused("NOTHING_TO_VOID", "no credit to void", 409);
  return append({ userId, kind: "void", amountCents: amount, note: `${actor}: ${String(note || "voided").slice(0, 200)}`, now });
}

export function resetMemoryCredit() { mem.creditLedger.length = 0; mem.creditSeq = 1; }
