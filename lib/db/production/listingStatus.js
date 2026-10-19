// lib/db/production/listingStatus.js — the ListingStatus service's writers
// and readers (schema v58). SERVER-ONLY; memory mode mirrors every law.
//
//   recordStatusEvent  — one row per (item, to_status): a retry cannot sell
//                        a listing twice (returns { recorded: false } the
//                        second time).
//   usersWhoKept       — everyone who saved or favourited the item: the
//                        boards that hold it and the favourite interactions.
//                        Device identities count too — a like is a like.
//   enqueueNotification — the outbox, one row per (user, kind, subject);
//                        refused when the person turned the kind off.
//   listNotifications / markNotificationsRead / getNotificationPrefs /
//   setNotificationPrefs — the in-app delivery and the switch.

import { getPool, hasRelation, hasColumns } from "../core/pool.js";

// v58 may not be applied where this runs: every reader answers empty and
// every writer answers "unapplied" until it is — the Likes sheet and the
// worker then say so instead of failing the request.
async function table(p, name) { return hasRelation(p, name); }
import { mem } from "../core/store.js";

const memEvents = [];        // { itemId, fromStatus, toStatus, provider, providerStatus, observedAt }
const memOutbox = [];        // { id, userId, kind, subjectId, payload, createdAt, readAt, sentAt }
const memPrefs = new Map();  // userId -> { soldLikes }
let memSeq = 1;

// v58 named one kind; v59 adds the mail desk's two (brief §3–§4); v60 the gift (§8)
// v64 (slice 6, native commerce) adds the offer, discount and queue kinds
export const NOTIFICATION_KINDS = Object.freeze([
  "liked-sold", "dm-cleared", "profile-shared", "wardrobe-gift",
  "offer-new", "offer-counter", "offer-accepted", "offer-declined", "offer-expiring", "offer-invalidated",
  "discount", "queue-available", "queue-sold", "queue-returned",
  // v65 (slice 7): after the sale
  "delivered", "return-opened", "return-decided", "review-published", "penalty", "credit",
  // v66 (slice 8): BRDCST outreach and billing
  "brdcst-payment", "brdcst-started", "brdcst-ended", "brdcst-refund",
  // v68 (slice 10b): identity
  "verification-downgrade", "verification-appeal", "mfa",
]);
export const STATUS_WORDS = Object.freeze(["available", "sold", "ended", "unavailable", "removed", "price_changed", "unknown"]);

export async function recordStatusEvent({ itemId, fromStatus = null, toStatus, provider, providerStatus = null, observedAt = null }) {
  const id = String(itemId || "");
  if (!id || !STATUS_WORDS.includes(toStatus) || !provider) throw new TypeError("recordStatusEvent needs itemId, a known toStatus and a provider");
  const at = observedAt || new Date().toISOString();
  const p = await getPool();
  if (p && !(await table(p, "listing_status_events"))) return { recorded: false, observedAt: null, reason: "unapplied" };
  if (!p) {
    if (memEvents.some((e) => e.itemId === id && e.toStatus === toStatus)) return { recorded: false, observedAt: null };
    memEvents.push({ itemId: id, fromStatus, toStatus, provider, providerStatus, observedAt: at });
    return { recorded: true, observedAt: at };
  }
  const { rows } = await p.query(
    `INSERT INTO listing_status_events (item_id, from_status, to_status, provider, provider_status, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_id, to_status) DO NOTHING RETURNING observed_at`,
    [id, fromStatus, toStatus, provider, providerStatus, at]
  );
  return rows.length ? { recorded: true, observedAt: new Date(rows[0].observed_at).toISOString() } : { recorded: false, observedAt: null };
}

/** The latest event per item, for a list of items — the Sold tab's date. */
export async function latestStatusEvents(itemIds = []) {
  const ids = [...new Set(itemIds.map(String).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const p = await getPool();
  if (p && !(await table(p, "listing_status_events"))) return out;
  if (!p) {
    for (const e of memEvents) if (ids.includes(e.itemId)) { const cur = out.get(e.itemId); if (!cur || e.observedAt > cur.observedAt) out.set(e.itemId, { toStatus: e.toStatus, observedAt: e.observedAt, provider: e.provider }); }
    return out;
  }
  const { rows } = await p.query(
    `SELECT DISTINCT ON (item_id) item_id, to_status, observed_at, provider FROM listing_status_events
      WHERE item_id = ANY($1::text[]) ORDER BY item_id, observed_at DESC`, [ids]);
  for (const r of rows) out.set(r.item_id, { toStatus: r.to_status, observedAt: new Date(r.observed_at).toISOString(), provider: r.provider });
  return out;
}

export async function usersWhoKept(itemId) {
  const id = String(itemId || "");
  if (!id) return [];
  const p = await getPool();
  if (!p) {
    const users = new Set();
    for (const b of mem.boards.values()) if ((b.items || []).some((x) => x && x.id === id)) users.add(b.userId);
    for (const i of mem.interactions) if (i.itemId === id && (i.action === "favorite" || i.action === "save")) users.add(i.userId);
    return [...users];
  }
  const { rows } = await p.query(
    `SELECT DISTINCT user_id FROM (
       SELECT b.user_id FROM board_items bi JOIN boards b ON b.id = bi.board_id WHERE bi.item_id = $1
       UNION SELECT user_id FROM interactions WHERE item_id = $1 AND action IN ('favorite', 'save')
     ) u`, [id]);
  return rows.map((r) => r.user_id);
}

// The commerce preferences (slice 6, v64): the discount threshold below which
// no alert is sent (7.34; the platform floor is 10%, 8.1), the offer reminder
// preset (7.28–7.30, Standard by default), and the queue alerts switch (7.12).
export const DEFAULT_PREFS = Object.freeze({ soldLikes: true, discountMinPercent: 10, offerReminders: "standard", queueAlerts: true });
const REMINDER_PRESETS = new Set(["minimal", "standard", "frequent"]);
const cleanPrefs = (raw = {}) => ({
  soldLikes: raw.soldLikes == null ? DEFAULT_PREFS.soldLikes : !!raw.soldLikes,
  discountMinPercent: Number.isFinite(Number(raw.discountMinPercent)) ? Math.max(10, Math.min(90, Math.round(Number(raw.discountMinPercent)))) : DEFAULT_PREFS.discountMinPercent,
  offerReminders: REMINDER_PRESETS.has(raw.offerReminders) ? raw.offerReminders : DEFAULT_PREFS.offerReminders,
  queueAlerts: raw.queueAlerts == null ? DEFAULT_PREFS.queueAlerts : !!raw.queueAlerts,
});
const V64_PREF_COLUMNS = ["discount_min_percent", "offer_reminders", "queue_alerts"];

export async function getNotificationPrefs(userId) {
  const id = String(userId || "");
  const p = await getPool();
  if (!p) return memPrefs.has(id) ? { ...DEFAULT_PREFS, ...memPrefs.get(id) } : { ...DEFAULT_PREFS };
  if (!(await table(p, "user_notification_prefs"))) return { ...DEFAULT_PREFS, unapplied: true };
  const wide = await hasColumns(p, "user_notification_prefs", V64_PREF_COLUMNS);
  const { rows } = await p.query(wide
    ? "SELECT sold_likes, discount_min_percent, offer_reminders, queue_alerts FROM user_notification_prefs WHERE user_id = $1"
    : "SELECT sold_likes FROM user_notification_prefs WHERE user_id = $1", [id]);
  if (!rows.length) return { ...DEFAULT_PREFS };
  return cleanPrefs({ soldLikes: rows[0].sold_likes, discountMinPercent: rows[0].discount_min_percent, offerReminders: rows[0].offer_reminders, queueAlerts: rows[0].queue_alerts });
}

export async function setNotificationPrefs(userId, patch = {}) {
  const id = String(userId || "");
  if (!id) throw new TypeError("user required");
  const current = await getNotificationPrefs(userId);
  const next = cleanPrefs({ ...current, ...patch });
  const p = await getPool();
  if (!p) { memPrefs.set(id, next); return next; }
  if (!(await table(p, "user_notification_prefs"))) throw new Error("notification preferences need schema v58 applied");
  if (await hasColumns(p, "user_notification_prefs", V64_PREF_COLUMNS)) {
    await p.query(
      `INSERT INTO user_notification_prefs (user_id, sold_likes, discount_min_percent, offer_reminders, queue_alerts) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET sold_likes = EXCLUDED.sold_likes, discount_min_percent = EXCLUDED.discount_min_percent,
         offer_reminders = EXCLUDED.offer_reminders, queue_alerts = EXCLUDED.queue_alerts, updated_at = now()`,
      [id, next.soldLikes, next.discountMinPercent, next.offerReminders, next.queueAlerts]);
    return next;
  }
  await p.query(
    `INSERT INTO user_notification_prefs (user_id, sold_likes) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET sold_likes = EXCLUDED.sold_likes, updated_at = now()`, [id, next.soldLikes]);
  return { ...next, unapplied: true };
}

/** One outbox row per (user, kind, subject). Returns { queued, reason }. */
export async function enqueueNotification({ userId, kind, subjectId, payload = {} }) {
  const id = String(userId || "");
  if (!id || !NOTIFICATION_KINDS.includes(kind) || !subjectId) throw new TypeError("enqueueNotification needs user, a known kind and a subject");
  const prefs = await getNotificationPrefs(id);
  if (kind === "liked-sold" && !prefs.soldLikes) return { queued: false, reason: "opted-out" };
  if (kind.startsWith("queue-") && !prefs.queueAlerts) return { queued: false, reason: "opted-out" };
  // a discount below the passenger's own threshold is not an alert (7.34); the floor is 10% (8.1)
  if (kind === "discount" && Number(payload.percent) < Math.max(10, prefs.discountMinPercent || 10)) return { queued: false, reason: "below-threshold" };
  const p = await getPool();
  if (p && !(await table(p, "notifications"))) return { queued: false, reason: "unapplied" };
  if (!p) {
    if (memOutbox.some((n) => n.userId === id && n.kind === kind && n.subjectId === String(subjectId))) return { queued: false, reason: "duplicate" };
    memOutbox.push({ id: memSeq++, userId: id, kind, subjectId: String(subjectId), payload, createdAt: new Date().toISOString(), readAt: null, sentAt: null });
    return { queued: true };
  }
  let rows;
  try {
    ({ rows } = await p.query(
      `INSERT INTO notifications (user_id, kind, subject_id, payload) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (user_id, kind, subject_id) DO NOTHING RETURNING id`, [id, kind, String(subjectId), JSON.stringify(payload)]));
  } catch (error) {
    // a kind the applied CHECK does not know yet (v59 unapplied) is "unapplied", not a fault
    if (error.code === "23514") return { queued: false, reason: "unapplied" };
    throw error;
  }
  return rows.length ? { queued: true } : { queued: false, reason: "duplicate" };
}

export async function listNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  const id = String(userId || "");
  const n = Math.max(1, Math.min(200, limit));
  const p = await getPool();
  if (!p) return memOutbox.filter((x) => x.userId === id && (!unreadOnly || !x.readAt)).slice(-n).reverse();
  if (!(await table(p, "notifications"))) return [];
  const { rows } = await p.query(
    `SELECT id, kind, subject_id, payload, created_at, read_at FROM notifications
      WHERE user_id = $1 AND ($2::boolean = false OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3`, [id, unreadOnly, n]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, subjectId: r.subject_id, payload: r.payload || {}, createdAt: new Date(r.created_at).toISOString(), readAt: r.read_at ? new Date(r.read_at).toISOString() : null }));
}

export async function markNotificationsRead(userId, ids = []) {
  const id = String(userId || "");
  const list = ids.map(Number).filter(Number.isFinite);
  if (!id || !list.length) return 0;
  const p = await getPool();
  if (p && !(await table(p, "notifications"))) return 0;
  if (!p) { let n = 0; for (const x of memOutbox) if (x.userId === id && list.includes(x.id) && !x.readAt) { x.readAt = new Date().toISOString(); n++; } return n; }
  const { rowCount } = await p.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL", [id, list]);
  return rowCount;
}

/** Test seam. */
export function resetMemoryListingStatus() { memEvents.length = 0; memOutbox.length = 0; memPrefs.clear(); memSeq = 1; }
