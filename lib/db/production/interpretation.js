// lib/db/production/interpretation.js — HOW ASTERISK READS, and what it
// remembers about a person.
//
// Schema v13 onward: the unknown-query ledger, interpretation feedback,
// Asterisk memory preferences, follows, wardrobe items, rail preferences,
// profile rooms and brand cases.
//
// The unknown-query ledger is the one to understand first. It counts DISTINCT
// IDENTITIES rather than hits, so one person searching the same thing thirty
// times is one person's interest — a hit counter would let a single user set
// the research agenda.

import { randomUUID } from "node:crypto";
import { getPool, withUserLock, identityHash, hasColumns } from "../index.js";
import { mem, push, boundedLimit } from "./store.js";

// ---- universal interpretation (schema v13) -----------------------------------
// Server-only domains. unknown_queries is demand-counted with per-identity
// dedupe (one identity cannot vote a query into research); promotion into
// the research pipeline is an ADMIN action recorded with a reviewer id.

const unknownRow = (r) => ({
  id: Number(r.id), normalizedQuery: r.normalized_query,
  demandCount: Number(r.demand_count), distinctIdentities: Number(r.distinct_identities),
  lastMethod: r.last_method, status: r.status, researchFactId: r.research_fact_id,
  firstSeen: new Date(r.first_seen).getTime(), lastSeen: new Date(r.last_seen).getTime(),
  reviewedBy: r.reviewed_by || null,
});

export async function recordUnknownQuery(normalizedQuery, identityHash, lastMethod = "none") {
  const p = await getPool();
  if (!p) {
    let row = mem.unknownQueries.get(normalizedQuery);
    if (!row) {
      row = { id: mem.seq++, normalized_query: normalizedQuery, demand_count: 0,
        distinct_identities: 0, last_method: lastMethod, status: "observed",
        research_fact_id: null, first_seen: Date.now(), last_seen: Date.now(), reviewed_by: null };
      mem.unknownQueries.set(normalizedQuery, row);
    }
    const voteKey = row.id + "|" + identityHash;
    if (!mem.unknownVotes.has(voteKey)) {
      mem.unknownVotes.add(voteKey);
      row.demand_count += 1;
      row.distinct_identities += 1;
    }
    row.last_seen = Date.now();
    row.last_method = lastMethod;
    return unknownRow(row);
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO unknown_queries (normalized_query, last_method)
       VALUES ($1,$2)
       ON CONFLICT (normalized_query) DO UPDATE
         SET last_seen=now(), last_method=EXCLUDED.last_method, updated_at=now()
       RETURNING *`, [normalizedQuery, lastMethod]);
    const vote = await client.query(
      `INSERT INTO unknown_query_votes (query_id, identity_hash) VALUES ($1,$2)
       ON CONFLICT (query_id, identity_hash) DO NOTHING RETURNING query_id`,
      [rows[0].id, identityHash]);
    let row = rows[0];
    if (vote.rowCount) {
      const bumped = await client.query(
        `UPDATE unknown_queries
           SET demand_count = demand_count + 1,
               distinct_identities = distinct_identities + 1,
               updated_at = now()
         WHERE id=$1 AND status='observed' RETURNING *`, [rows[0].id]);
      if (bumped.rows[0]) row = bumped.rows[0];
    }
    await client.query("COMMIT");
    return unknownRow(row);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listUnknownQueries({ status = "observed", limit = 50 } = {}) {
  limit = boundedLimit(limit, 50, 200);
  const p = await getPool();
  if (!p) {
    return [...mem.unknownQueries.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.demand_count - a.demand_count)
      .slice(0, limit).map(unknownRow);
  }
  const { rows } = await p.query(
    `SELECT * FROM unknown_queries WHERE ($1::text IS NULL OR status=$1)
     ORDER BY demand_count DESC, last_seen DESC LIMIT $2`, [status, limit]);
  return rows.map(unknownRow);
}

export async function updateUnknownQueryStatus(id, status, {
  reviewedBy = null,
  researchFactId = null,
  minimumDistinctIdentities = 0,
  expectedStatus = null,
} = {}) {
  if (!["observed", "research_created", "resolved", "dismissed"].includes(status)) return null;
  const minimum = Math.max(0, Math.trunc(Number(minimumDistinctIdentities)) || 0);
  const p = await getPool();
  if (!p) {
    const row = [...mem.unknownQueries.values()].find((r) => r.id === Number(id));
    if (!row || row.distinct_identities < minimum || (expectedStatus && row.status !== expectedStatus)) return null;
    row.status = status;
    if (reviewedBy) row.reviewed_by = reviewedBy;
    if (researchFactId) row.research_fact_id = researchFactId;
    return unknownRow(row);
  }
  const { rows } = await p.query(
     `UPDATE unknown_queries
       SET status=$2, reviewed_by=COALESCE($3, reviewed_by),
           research_fact_id=COALESCE($4, research_fact_id), updated_at=now()
     WHERE id=$1
       AND distinct_identities >= $5
       AND ($6::text IS NULL OR status=$6)
     RETURNING *`, [id, status, reviewedBy, researchFactId, minimum, expectedStatus]);
  return rows[0] ? unknownRow(rows[0]) : null;
}

const feedbackRow = (r) => ({
  userId: r.user_id, normalizedQuery: r.normalized_query,
  interpretationId: r.interpretation_id, contractVersion: Number(r.contract_version),
  verdict: r.verdict, createdAt: new Date(r.created_at).getTime(),
});

// Returns feedbackRow with an extra `changed` flag: true when this call
// created the row or flipped its verdict, false when the stored verdict was
// already this value. The interpret route trains ONLY on a change (audit #5:
// the pill had no re-click guard, so N identical "meant" clicks stacked N
// times of training — 5 clicks drove a tag 0.00→0.84, 25 saturated to 1.0).
export async function recordInterpretationFeedback({ userId, normalizedQuery, interpretationId, contractVersion, verdict }) {
  const p = await getPool();
  if (!p) {
    const existing = mem.interpretationFeedback.find((f) =>
      f.user_id === userId && f.normalized_query === normalizedQuery && f.interpretation_id === interpretationId);
    if (existing) {
      const changed = existing.verdict !== verdict;
      existing.verdict = verdict;
      return { ...feedbackRow(existing), changed };
    }
    const row = { user_id: userId, normalized_query: normalizedQuery,
      interpretation_id: interpretationId, contract_version: contractVersion,
      verdict, created_at: Date.now() };
    push(mem.interpretationFeedback, row);
    return { ...feedbackRow(row), changed: true };
  }
  // One statement: capture the prior verdict, upsert, and report both. The
  // LEFT JOIN yields old_verdict = null on a fresh insert (→ changed true).
  const { rows } = await p.query(
    `WITH prev AS (
       SELECT verdict AS old_verdict FROM interpretation_feedback
       WHERE user_id=$1 AND normalized_query=$2 AND interpretation_id=$3
     ),
     up AS (
       INSERT INTO interpretation_feedback (user_id, normalized_query, interpretation_id, contract_version, verdict)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, normalized_query, interpretation_id)
         DO UPDATE SET verdict=EXCLUDED.verdict, contract_version=EXCLUDED.contract_version
       RETURNING *
     )
     SELECT up.*, prev.old_verdict FROM up LEFT JOIN prev ON true`,
    [userId, normalizedQuery, interpretationId, contractVersion, verdict]);
  const row = rows[0];
  return { ...feedbackRow(row), changed: row.old_verdict !== verdict };
}

export async function listInterpretationFeedback(userId, normalizedQuery) {
  const p = await getPool();
  if (!p) {
    return mem.interpretationFeedback
      .filter((f) => f.user_id === userId && f.normalized_query === normalizedQuery)
      .map(feedbackRow);
  }
  const { rows } = await p.query(
    `SELECT * FROM interpretation_feedback WHERE user_id=$1 AND normalized_query=$2 LIMIT 50`,
    [userId, normalizedQuery]);
  return rows.map(feedbackRow);
}

// ── Asterisk memory surface (v14 + guidance v20) ───────────────────────────
// asterisk_memory_preferences: the ONLY write domain the memory facade owns
// (ADR-001 rule 3) — section visibility + whether taste may guide surfaces,
// never taste itself. user_follows: brand and user follows graduated from
// localStorage; board follows stay on the profile.

export const MEMORY_FOLLOW_KINDS = new Set(["brand", "user"]);
const FOLLOWS_CAP = 50;
const MEMORY_PREFERENCE_SECTIONS = new Set(["explicit", "inferred", "global", "uncertainty"]);

export async function getMemoryPreferences(userId) {
  const p = await getPool();
  if (!p) {
    const row = mem.memoryPreferences.get(userId);
    return {
      hiddenSections: [...(row?.hiddenSections || [])],
      guidanceEnabled: row?.guidanceEnabled !== false,
      explorationOff: row?.explorationOff === true,
    };
  }
  // v69 (slice 10c) adds exploration_off; an unapplied column reads as false
  const v69 = await hasColumns(p, "asterisk_memory_preferences", ["exploration_off"]);
  const { rows } = await p.query(
    v69 ? "SELECT hidden_sections, guidance_enabled, exploration_off FROM asterisk_memory_preferences WHERE user_id=$1"
        : "SELECT hidden_sections, guidance_enabled FROM asterisk_memory_preferences WHERE user_id=$1", [userId]);
  return {
    hiddenSections: Array.isArray(rows[0]?.hidden_sections) ? rows[0].hidden_sections : [],
    guidanceEnabled: rows[0]?.guidance_enabled !== false,
    explorationOff: rows[0]?.exploration_off === true,
  };
}

export async function saveMemoryPreferences(userId, settings) {
  if (!userId) throw new TypeError("userId required");
  const patch = Array.isArray(settings) ? { hiddenSections: settings } : settings;
  if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
      (patch.hiddenSections === undefined && patch.guidanceEnabled === undefined && patch.explorationOff === undefined)) {
    throw new TypeError("hiddenSections, guidanceEnabled or explorationOff required");
  }
  if (patch.explorationOff !== undefined && typeof patch.explorationOff !== "boolean") {
    throw new TypeError("explorationOff must be boolean");
  }
  if (patch.hiddenSections !== undefined &&
      (!Array.isArray(patch.hiddenSections) ||
       patch.hiddenSections.length > MEMORY_PREFERENCE_SECTIONS.size ||
       new Set(patch.hiddenSections).size !== patch.hiddenSections.length ||
       !patch.hiddenSections.every((section) => MEMORY_PREFERENCE_SECTIONS.has(section)))) {
    throw new TypeError("hiddenSections contains an invalid or duplicate section");
  }
  if (patch.guidanceEnabled !== undefined && typeof patch.guidanceEnabled !== "boolean") {
    throw new TypeError("guidanceEnabled must be boolean");
  }
  const p = await getPool();
  if (!p) {
    const current = mem.memoryPreferences.get(userId) || {
      hiddenSections: [], guidanceEnabled: true,
    };
    const next = {
      hiddenSections: patch.hiddenSections === undefined
        ? [...current.hiddenSections] : [...patch.hiddenSections],
      guidanceEnabled: patch.guidanceEnabled === undefined
        ? current.guidanceEnabled !== false : patch.guidanceEnabled,
      explorationOff: patch.explorationOff === undefined
        ? current.explorationOff === true : patch.explorationOff,
      updatedAt: Date.now(),
    };
    mem.memoryPreferences.set(userId, next);
    return { hiddenSections: [...next.hiddenSections], guidanceEnabled: next.guidanceEnabled, explorationOff: next.explorationOff };
  }
  const v69 = await hasColumns(p, "asterisk_memory_preferences", ["exploration_off"]);
  if (patch.explorationOff !== undefined && !v69) throw new Error("exploration off needs schema v69 applied");
  const { rows } = await p.query(
    v69 ? `INSERT INTO asterisk_memory_preferences
       (user_id,hidden_sections,guidance_enabled,exploration_off,updated_at)
     VALUES ($1,COALESCE($2::jsonb,'[]'::jsonb),COALESCE($3::boolean,true),COALESCE($4::boolean,false),now())
     ON CONFLICT (user_id) DO UPDATE SET
       hidden_sections=COALESCE($2::jsonb,asterisk_memory_preferences.hidden_sections),
       guidance_enabled=COALESCE($3::boolean,asterisk_memory_preferences.guidance_enabled),
       exploration_off=COALESCE($4::boolean,asterisk_memory_preferences.exploration_off),
       updated_at=now()
     RETURNING hidden_sections,guidance_enabled,exploration_off`
    : `INSERT INTO asterisk_memory_preferences
       (user_id,hidden_sections,guidance_enabled,updated_at)
     VALUES ($1,COALESCE($2::jsonb,'[]'::jsonb),COALESCE($3::boolean,true),now())
     ON CONFLICT (user_id) DO UPDATE SET
       hidden_sections=COALESCE($2::jsonb,asterisk_memory_preferences.hidden_sections),
       guidance_enabled=COALESCE($3::boolean,asterisk_memory_preferences.guidance_enabled),
       updated_at=now()
     RETURNING hidden_sections,guidance_enabled`,
    v69 ? [
      userId,
      patch.hiddenSections === undefined ? null : JSON.stringify(patch.hiddenSections),
      patch.guidanceEnabled === undefined ? null : patch.guidanceEnabled,
      patch.explorationOff === undefined ? null : patch.explorationOff,
    ] : [
      userId,
      patch.hiddenSections === undefined ? null : JSON.stringify(patch.hiddenSections),
      patch.guidanceEnabled === undefined ? null : patch.guidanceEnabled,
    ]);
  return {
    hiddenSections: rows[0].hidden_sections,
    guidanceEnabled: rows[0].guidance_enabled !== false,
    explorationOff: rows[0].exploration_off === true,
  };
}

export async function listFollows(userId) {
  const p = await getPool();
  if (!p) {
    // reverse insertion order first so same-millisecond follows still come
    // back newest-first under the stable sort
    return [...mem.follows].reverse()
      .filter((f) => f.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((f) => ({ kind: f.kind, target: f.target, createdAt: f.createdAt }));
  }
  const { rows } = await p.query(
    "SELECT kind, target, created_at FROM user_follows WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [userId, FOLLOWS_CAP]);
  return rows.map((r) => ({ kind: r.kind, target: r.target, createdAt: new Date(r.created_at).getTime() }));
}

/**
 * THE FRIEND ASTERISK (V.2 Foundations; owner ruling 18 Oct 2026, A6 (2)):
 * following is one-directional; a follow back makes two passengers friends.
 * The follows table has always held both directions — reading it by TARGET
 * is the followers' side the earlier policy refused to expose, now allowed
 * for this one purpose. Friends are read relative to the viewer and never
 * listed to anyone else; a block on either side removes the mark (the
 * caller filters blocks, which live with the mail desk).
 * Returns { handle, friends: [handle…] } — handles folded to lower case; a
 * viewer without a published handle has no friends to show.
 */
export async function friendsOf(userId) {
  const { accountIdFromIdentity } = await import("../../identity.js");
  const accountId = accountIdFromIdentity(userId);
  const room = accountId ? await getProfileRoom(accountId).catch(() => null) : null;
  const handle = room && room.handle ? String(room.handle).toLowerCase() : null;
  if (!handle) return { handle: null, friends: [] };
  const mine = (await listFollows(userId)).filter((f) => f.kind === "user").map((f) => String(f.target).toLowerCase());
  if (!mine.length) return { handle, friends: [] };
  const p = await getPool();
  let followerIds;
  if (!p) followerIds = mem.follows.filter((f) => f.kind === "user" && String(f.target).toLowerCase() === handle).map((f) => f.userId);
  else followerIds = (await p.query("SELECT user_id FROM user_follows WHERE kind='user' AND lower(target)=$1", [handle])).rows.map((r) => r.user_id);
  const friends = [];
  for (const id of new Set(followerIds)) {
    const acct = accountIdFromIdentity(id);
    const theirs = acct ? await getProfileRoom(acct).catch(() => null) : null;
    const h = theirs && theirs.handle ? String(theirs.handle).toLowerCase() : null;
    if (h && mine.includes(h)) friends.push(h);
  }
  return { handle, friends: friends.sort() };
}

export async function setFollow(userId, kind, target, on = true) {
  if (!userId || !MEMORY_FOLLOW_KINDS.has(kind)) throw new TypeError("userId and kind brand|user required");
  const normalizedTarget = typeof target === "string" ? target.trim() : "";
  if (!normalizedTarget.length || normalizedTarget.length > 120) {
    throw new TypeError("target must be a 1-120 char string");
  }
  const p = await getPool();
  if (!p) {
    return withUserLock(`follow:${userId}`, async () => {
      const match = (f) => f.userId === userId && f.kind === kind && f.target === normalizedTarget;
      if (!on) {
        mem.follows = mem.follows.filter((f) => !match(f));
        return { ok: true };
      }
      if (mem.follows.some(match)) return { ok: true };
      if (mem.follows.filter((f) => f.userId === userId).length >= FOLLOWS_CAP) {
        return { ok: false, error: "follow cap reached" };
      }
      push(mem.follows, { userId, kind, target: normalizedTarget, createdAt: Date.now() });
      return { ok: true };
    });
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`follow-cap:${userId}`]);
    if (!on) {
      await client.query(
        "DELETE FROM user_follows WHERE user_id=$1 AND kind=$2 AND target=$3",
        [userId, kind, normalizedTarget]);
      await client.query("COMMIT");
      return { ok: true };
    }
    const existing = await client.query(
      "SELECT 1 FROM user_follows WHERE user_id=$1 AND kind=$2 AND target=$3",
      [userId, kind, normalizedTarget]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      return { ok: true };
    }
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM user_follows WHERE user_id=$1", [userId]);
    if ((rows[0]?.n || 0) >= FOLLOWS_CAP) {
      await client.query("ROLLBACK");
      return { ok: false, error: "follow cap reached" };
    }
    await client.query(
      "INSERT INTO user_follows (user_id,kind,target) VALUES ($1,$2,$3)",
      [userId, kind, normalizedTarget]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Wardrobe (v15) ────────────────────────────────────────────────────────
// Explicit ownership only (lib/wardrobe normalizes the sources). Rows are
// private; promotion from tickets/uploads is idempotent via the per-user
// (user_id, source, source_ref) unique index.

function wardrobeRow(r) {
  return {
    id: String(r.id), userId: r.user_id, source: r.source,
    sourceRef: r.source_ref || null, catalogItemId: r.catalog_item_id || null,
    title: r.title, brand: r.brand || null, category: r.category || null,
    sizeLabel: r.size_label || null,
    colors: Array.isArray(r.colors) ? r.colors : [],
    tags: r.tags && typeof r.tags === "object" ? r.tags : {},
    photoPath: r.photo_path || null,
    status: r.status,
    // v70 (slice 11, 13.3): Wardrobe offers per piece; absent until the column exists → false
    acceptOffers: r.accept_offers === true,
    offerCooldownUntil: r.offer_cooldown_until ? new Date(r.offer_cooldown_until).toISOString() : null,
    // v60: how THIS owner came by it (the origin `source` is kept). Derived
    // from the source until the column exists.
    provenance: r.provenance || (r.source === "ticket" ? "purchase" : "self"),
    transferredFrom: r.transferred_from || null,
    transferId: r.transfer_id ? String(r.transfer_id) : null,
    acquiredAt: r.acquired_at ? new Date(r.acquired_at).getTime() : null,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function createWardrobeItem(row) {
  const p = await getPool();
  if (!p) {
    return withUserLock(row.userId, async () => {
      if (row.sourceRef) {
        const existing = mem.wardrobe.find((w) =>
          w.user_id === row.userId && w.source === row.source && w.source_ref === row.sourceRef);
        if (existing) return { item: wardrobeRow(existing), duplicate: true };
      }
      const record = {
        id: String(mem.seq++), user_id: row.userId, source: row.source,
        source_ref: row.sourceRef, catalog_item_id: row.catalogItemId,
        title: row.title, brand: row.brand, category: row.category,
        size_label: row.sizeLabel, colors: row.colors, tags: row.tags,
        photo_path: null, status: "active",
        acquired_at: row.acquiredAt, created_at: new Date(),
      };
      push(mem.wardrobe, record);
      return { item: wardrobeRow(record), duplicate: false };
    });
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    // Use the same identity lock as adoption so a promoted piece cannot be
    // deleted or collide midway through a device → account move.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-lock:${row.userId}`]);
    const { rows } = await client.query(
      `INSERT INTO wardrobe_items
         (user_id,source,source_ref,catalog_item_id,title,brand,category,size_label,colors,tags,acquired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
       ON CONFLICT (user_id,source,source_ref) WHERE source_ref IS NOT NULL DO NOTHING
       RETURNING *`,
      [row.userId, row.source, row.sourceRef, row.catalogItemId, row.title, row.brand,
       row.category, row.sizeLabel, JSON.stringify(row.colors || []),
       JSON.stringify(row.tags || {}), row.acquiredAt]);
    if (rows[0]) {
      await client.query("COMMIT");
      return { item: wardrobeRow(rows[0]), duplicate: false };
    }
    const { rows: prior } = await client.query(
      "SELECT * FROM wardrobe_items WHERE user_id=$1 AND source=$2 AND source_ref=$3",
      [row.userId, row.source, row.sourceRef]);
    await client.query("COMMIT");
    return { item: wardrobeRow(prior[0]), duplicate: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listWardrobeItems(userId, { status = "active", limit = 200 } = {}) {
  limit = boundedLimit(limit, 200, 500);
  const p = await getPool();
  if (!p) {
    return [...mem.wardrobe].reverse()
      .filter((w) => w.user_id === userId && (status === "all" || w.status === status))
      .slice(0, limit).map(wardrobeRow);
  }
  const filter = status === "all" ? "" : " AND status=$3";
  const params = status === "all" ? [userId, limit] : [userId, limit, status];
  const { rows } = await p.query(
    `SELECT * FROM wardrobe_items WHERE user_id=$1${filter} ORDER BY created_at DESC LIMIT $2`,
    params);
  return rows.map(wardrobeRow);
}

export async function getWardrobeItem(userId, id, queryTarget = null) {
  const p = queryTarget || await getPool();
  if (!p) {
    const r = mem.wardrobe.find((w) => w.user_id === userId && String(w.id) === String(id));
    return r ? wardrobeRow(r) : null;
  }
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const { rows } = await p.query(
    "SELECT * FROM wardrobe_items WHERE user_id=$1 AND id=$2", [userId, id]);
  return rows[0] ? wardrobeRow(rows[0]) : null;
}

export async function setWardrobeItemStatus(userId, id, status) {
  if (!["active", "retired"].includes(status)) throw new TypeError("status must be active or retired");
  const p = await getPool();
  if (!p) {
    const r = mem.wardrobe.find((w) => w.user_id === userId && String(w.id) === String(id));
    if (!r) return null;
    r.status = status;
    return wardrobeRow(r);
  }
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const { rows } = await p.query(
    "UPDATE wardrobe_items SET status=$3, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
    [userId, id, status]);
  return rows[0] ? wardrobeRow(rows[0]) : null;
}

export async function deleteWardrobeItem(userId, id, options = {}) {
  const hasExpectedPath = Object.prototype.hasOwnProperty.call(options, "expectedPhotoPath");
  const expectedPhotoPath = options.expectedPhotoPath ?? null;
  const p = options.queryTarget || await getPool();
  if (!p) {
    const before = mem.wardrobe.length;
    mem.wardrobe = mem.wardrobe.filter((w) => !(w.user_id === userId && String(w.id) === String(id) &&
      (!hasExpectedPath || (w.photo_path || null) === expectedPhotoPath)));
    return mem.wardrobe.length < before;
  }
  if (!/^\d{1,18}$/.test(String(id))) return false;
  const expectedClause = hasExpectedPath ? " AND photo_path IS NOT DISTINCT FROM $3" : "";
  const params = hasExpectedPath ? [userId, id, expectedPhotoPath] : [userId, id];
  const r = await p.query(`DELETE FROM wardrobe_items WHERE user_id=$1 AND id=$2${expectedClause}`, params);
  return r.rowCount > 0;
}

// Photo attachment (Phase 3b): path + consent version live on the row; bytes
// live in private Storage (lib/wardrobe/photos.js). Owner-scoped like every
// other wardrobe accessor.
export async function setWardrobePhoto(userId, id, photoPath, consentVersion, options = {}) {
  const hasExpectedPath = Object.prototype.hasOwnProperty.call(options, "expectedPhotoPath");
  const expectedPhotoPath = options.expectedPhotoPath ?? null;
  const paletteColors = Array.isArray(options.colors) ? options.colors.slice(0, 8) : [];
  const p = options.queryTarget || await getPool();
  if (!p) {
    const r = mem.wardrobe.find((w) => w.user_id === userId && String(w.id) === String(id));
    if (!r) return null;
    if (hasExpectedPath && (r.photo_path || null) !== expectedPhotoPath) return null;
    r.photo_path = photoPath;
    r.photo_consent = photoPath ? consentVersion : null;
    if (paletteColors.length && (!Array.isArray(r.colors) || !r.colors.length)) r.colors = paletteColors;
    return wardrobeRow(r);
  }
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const expectedClause = hasExpectedPath ? " AND photo_path IS NOT DISTINCT FROM $6" : "";
  const params = [userId, id, photoPath, photoPath ? consentVersion : null, JSON.stringify(paletteColors)];
  if (hasExpectedPath) params.push(expectedPhotoPath);
  const { rows } = await p.query(
    `UPDATE wardrobe_items SET photo_path=$3, photo_consent=$4,
       colors=CASE WHEN jsonb_array_length(colors)=0 AND jsonb_array_length($5::jsonb)>0
         THEN $5::jsonb ELSE colors END,
       updated_at=now()
     WHERE user_id=$1 AND id=$2${expectedClause} RETURNING *`,
    params);
  return rows[0] ? wardrobeRow(rows[0]) : null;
}

// ── Discover rails (v16) ──────────────────────────────────────────────────
// Registry rows are operator data (seeded in schema-v16); prefs are the only
// per-user writes. Rail CONTENT never lives in the database.

const DEFAULT_RAILS = [
  { id: "screen", kind: "screen", title: "FROM THE SCREEN", position: 10, enabled: true, version: 1 },
  { id: "soundtrack", kind: "soundtrack", title: "THE SOUNDTRACK", position: 20, enabled: true, version: 1 },
  { id: "trend", kind: "trend", title: "RISING NOW", position: 30, enabled: true, version: 1 },
  { id: "exploration", kind: "exploration", title: "FAR FROM YOUR TASTE", position: 40, enabled: true, version: 1 },
];

export async function listDiscoverRails() {
  const p = await getPool();
  if (!p) return DEFAULT_RAILS.map((rail) => ({ ...rail }));
  const { rows } = await p.query(
    "SELECT id, kind, title, position, enabled, version FROM discover_rails ORDER BY position, id");
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title,
    position: r.position, enabled: r.enabled, version: r.version,
  }));
}

export async function getRailPrefs(userId) {
  const p = await getPool();
  if (!p) {
    const out = {};
    for (const [key, pref] of mem.railPrefs) {
      const [uid, railId] = key.split("|");
      if (uid === userId) out[railId] = pref;
    }
    return out;
  }
  const { rows } = await p.query(
    "SELECT rail_id, collapsed, hidden FROM user_rail_prefs WHERE user_id=$1", [userId]);
  return Object.fromEntries(rows.map((r) => [r.rail_id, { collapsed: r.collapsed, hidden: r.hidden }]));
}

export async function setRailPref(userId, railId, { collapsed = null, hidden = null } = {}) {
  if (!userId || typeof railId !== "string" || !/^[a-z0-9-]{2,40}$/.test(railId)) {
    throw new TypeError("userId and a valid railId required");
  }
  const p = await getPool();
  if (!p) {
    if (!DEFAULT_RAILS.some((rail) => rail.id === railId)) return null;
    const key = `${userId}|${railId}`;
    const current = mem.railPrefs.get(key) || { collapsed: false, hidden: false };
    const next = {
      collapsed: collapsed === null ? current.collapsed : !!collapsed,
      hidden: hidden === null ? current.hidden : !!hidden,
    };
    mem.railPrefs.set(key, next);
    return { railId, ...next };
  }
  const { rows } = await p.query(
    `INSERT INTO user_rail_prefs (user_id, rail_id, collapsed, hidden, updated_at)
     SELECT $1, id, COALESCE($3, false), COALESCE($4, false), now() FROM discover_rails WHERE id=$2
     ON CONFLICT (user_id, rail_id) DO UPDATE SET
       collapsed = COALESCE($3, user_rail_prefs.collapsed),
       hidden    = COALESCE($4, user_rail_prefs.hidden),
       updated_at = now()
     RETURNING rail_id, collapsed, hidden`,
    [userId, railId, collapsed, hidden]);
  return rows[0] ? { railId: rows[0].rail_id, collapsed: rows[0].collapsed, hidden: rows[0].hidden } : null;
}

// ── Profile rooms (v17, Feature E) ─────────────────────────────────────────
// Social/trust domain per ADR-002: rows key on the VERIFIED auth uuid.
// profile_themes is operator data (seeded in schema-v17); rooms/modules are
// the only per-account writes. Derived module content (top pieces, brands)
// never lives here — the read facade assembles it live.

const ACCOUNT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROOM_MODERATION_STATUSES = new Set(["visible", "under_review", "hidden"]);
const ROOM_MODULE_IDS = new Set(["statement", "soundtrack", "top-pieces", "brands"]);

const DEFAULT_PROFILE_THEMES = [
  { id: "asilum", name: "HOUSE", tokens: { accent: "#e5342b", ink: "#000000", paper: "#ffffff", rule: "solid" }, position: 10, enabled: true, version: 1 },
  { id: "after-dark", name: "AFTER DARK", tokens: { accent: "#e5342b", ink: "#f2f2f2", paper: "#101013", rule: "solid" }, position: 20, enabled: true, version: 1 },
  { id: "archive-paper", name: "ARCHIVE PAPER", tokens: { accent: "#8a3324", ink: "#2b2016", paper: "#f4ead8", rule: "double" }, position: 30, enabled: true, version: 1 },
  { id: "acid", name: "ACID", tokens: { accent: "#00a651", ink: "#101010", paper: "#fbfff2", rule: "solid" }, position: 40, enabled: true, version: 1 },
  { id: "pageant", name: "PAGEANT", tokens: { accent: "#ff2d78", ink: "#1a1a1a", paper: "#fff5fa", rule: "double" }, position: 50, enabled: true, version: 1 },
];

function requireAccountId(accountId) {
  const id = typeof accountId === "string" ? accountId.toLowerCase() : "";
  if (!ACCOUNT_UUID_RE.test(id)) throw new TypeError("a verified account uuid is required");
  return id;
}

function roomRow(r) {
  return {
    accountId: r.account_id, handle: r.handle, themeId: r.theme_id,
    published: r.published, moderationStatus: r.moderation_status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function moduleRowOut(r) {
  return {
    accountId: r.account_id, module: r.module, position: r.position,
    visible: r.visible, content: r.content || {}, updatedAt: r.updated_at,
  };
}

export async function listProfileThemes(queryTarget = null) {
  const p = queryTarget || await getPool();
  if (!p) return DEFAULT_PROFILE_THEMES.map((t) => ({ ...t, tokens: { ...t.tokens } }));
  const { rows } = await p.query(
    "SELECT id, name, tokens, position, enabled, version FROM profile_themes ORDER BY position, id");
  return rows.map((r) => ({
    id: r.id, name: r.name, tokens: r.tokens || {},
    position: r.position, enabled: r.enabled, version: r.version,
  }));
}

export async function getProfileRoom(accountId, queryTarget = null) {
  const id = requireAccountId(accountId);
  const p = queryTarget || await getPool();
  if (!p) return mem.profileRooms.get(id) || null;
  const { rows } = await p.query("SELECT * FROM profile_rooms WHERE account_id=$1", [id]);
  return rows[0] ? roomRow(rows[0]) : null;
}

export async function getProfileRoomByHandle(handle) {
  if (typeof handle !== "string" || !handle) return null;
  const key = handle.toLowerCase();
  const p = await getPool();
  if (!p) {
    for (const room of mem.profileRooms.values()) if (room.handle === key) return room;
    return null;
  }
  const { rows } = await p.query("SELECT * FROM profile_rooms WHERE handle=$1", [key]);
  return rows[0] ? roomRow(rows[0]) : null;
}

// Upsert the room root. Handle uniqueness surfaces as the string
// "handle-taken" error so the route can answer 409 without leaking SQL.
export async function upsertProfileRoom(accountId, { handle, themeId, published } = {}, { queryTarget = null } = {}) {
  const id = requireAccountId(accountId);
  const patch = {};
  if (handle !== undefined) patch.handle = handle; // pre-validated by rooms.js
  if (themeId !== undefined) {
    const themes = await listProfileThemes(queryTarget);
    if (!themes.some((t) => t.id === themeId && t.enabled)) throw new TypeError("unknown theme");
    patch.themeId = themeId;
  }
  if (published !== undefined) patch.published = !!published;
  const p = queryTarget || await getPool();
  if (!p) {
    if (patch.handle) {
      for (const [other, room] of mem.profileRooms) {
        if (other !== id && room.handle === patch.handle) throw new Error("handle-taken");
      }
    }
    const current = mem.profileRooms.get(id) || {
      accountId: id, handle: null, themeId: "asilum", published: false,
      moderationStatus: "visible", createdAt: Date.now(), updatedAt: Date.now(),
    };
    if (patch.published && !(patch.handle || current.handle)) throw new Error("handle-required");
    const next = { ...current, ...patch, updatedAt: Date.now() };
    mem.profileRooms.set(id, next);
    return { ...next };
  }
  try {
    if (patch.published && !patch.handle) {
      const current = await getProfileRoom(id, p);
      if (!current?.handle) throw new Error("handle-required");
    }
    const { rows } = await p.query(
      `INSERT INTO profile_rooms (account_id, handle, theme_id, published, updated_at)
       VALUES ($1, $2, COALESCE($3,'asilum'), COALESCE($4,false), now())
       ON CONFLICT (account_id) DO UPDATE SET
         handle     = COALESCE($2, profile_rooms.handle),
         theme_id   = COALESCE($3, profile_rooms.theme_id),
         published  = COALESCE($4, profile_rooms.published),
         updated_at = now()
       RETURNING *`,
      [id, patch.handle ?? null, patch.themeId ?? null,
       patch.published === undefined ? null : patch.published]);
    return roomRow(rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw new Error("handle-taken");
    if (error?.code === "23514" && error?.constraint === "profile_rooms_published_handle") {
      throw new Error("handle-required");
    }
    throw error;
  }
}

export async function setProfileRoomModeration(accountId, status, queryTarget = null) {
  const id = requireAccountId(accountId);
  if (!ROOM_MODERATION_STATUSES.has(status)) throw new TypeError("bad moderation status");
  const p = queryTarget || await getPool();
  if (!p) {
    const room = mem.profileRooms.get(id);
    if (!room) return null;
    room.moderationStatus = status;
    room.updatedAt = Date.now();
    return { ...room };
  }
  const { rows } = await p.query(
    "UPDATE profile_rooms SET moderation_status=$2, updated_at=now() WHERE account_id=$1 RETURNING *",
    [id, status]);
  return rows[0] ? roomRow(rows[0]) : null;
}

export async function listProfileModules(accountId) {
  const id = requireAccountId(accountId);
  const p = await getPool();
  if (!p) {
    const out = [];
    for (const [key, row] of mem.profileModules) if (key.startsWith(id + "|")) out.push({ ...row });
    return out.sort((a, b) => a.position - b.position || a.module.localeCompare(b.module));
  }
  const { rows } = await p.query(
    "SELECT * FROM profile_modules WHERE account_id=$1 ORDER BY position, module", [id]);
  return rows.map(moduleRowOut);
}

// content arrives pre-validated (rooms.js sanitize/validate); the DB layer
// still enforces the module vocabulary and the room-row prerequisite.
export async function setProfileModule(accountId, module, { position, visible, content } = {}, { queryTarget = null } = {}) {
  const id = requireAccountId(accountId);
  if (!ROOM_MODULE_IDS.has(module)) throw new TypeError("unknown module");
  const patch = {};
  if (position !== undefined) {
    const n = Math.trunc(Number(position));
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new TypeError("position must be 0-1000");
    patch.position = n;
  }
  if (visible !== undefined) patch.visible = !!visible;
  if (content !== undefined) {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new TypeError("content must be an object");
    }
    patch.content = content;
  }
  const p = queryTarget || await getPool();
  const defaultVisible = module === "statement" || module === "soundtrack";
  if (!p) {
    if (!mem.profileRooms.has(id)) throw new Error("room-required");
    const key = `${id}|${module}`;
    const current = mem.profileModules.get(key) || {
      accountId: id, module, position: 100, visible: defaultVisible, content: {}, updatedAt: Date.now(),
    };
    const next = { ...current, ...patch, updatedAt: Date.now() };
    mem.profileModules.set(key, next);
    return { ...next };
  }
  try {
    const { rows } = await p.query(
      `INSERT INTO profile_modules (account_id, module, position, visible, content, updated_at)
       VALUES ($1, $2, COALESCE($3,100), COALESCE($4::boolean,$6::boolean), COALESCE($5,'{}'::jsonb), now())
       ON CONFLICT (account_id, module) DO UPDATE SET
         position   = COALESCE($3, profile_modules.position),
         visible    = COALESCE($4::boolean, profile_modules.visible),
         content    = COALESCE($5, profile_modules.content),
         updated_at = now()
       RETURNING *`,
      [id, module, patch.position ?? null,
       patch.visible === undefined ? null : patch.visible,
       patch.content === undefined ? null : JSON.stringify(patch.content),
       defaultVisible]);
    return moduleRowOut(rows[0]);
  } catch (error) {
    if (error?.code === "23503") throw new Error("room-required");
    throw error;
  }
}

// Admin surface: list rooms newest-first, optionally by moderation status.
export async function listProfileRooms({ status = null, limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 100));
  if (status !== null && !ROOM_MODERATION_STATUSES.has(status)) throw new TypeError("bad moderation status");
  const p = await getPool();
  if (!p) {
    return [...mem.profileRooms.values()]
      .filter((room) => !status || room.moderationStatus === status)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, cap)
      .map((room) => ({ ...room }));
  }
  const { rows } = await p.query(
    `SELECT * FROM profile_rooms
     WHERE ($1::text IS NULL OR moderation_status=$1)
     ORDER BY updated_at DESC LIMIT $2`,
    [status, cap]);
  return rows.map(roomRow);
}

// Operator mutation surface for the rail registry (v16 follow-up flagged on
// PR #37 — edits were SQL-only). Registry rows are operator data; the
// persistent registry is the only real one, so this requires the database.
export async function updateDiscoverRail(railId, { enabled, position, title } = {}) {
  if (typeof railId !== "string" || !/^[a-z0-9-]{2,40}$/.test(railId)) {
    throw new TypeError("valid railId required");
  }
  const patch = {};
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (position !== undefined) {
    const n = Math.trunc(Number(position));
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new TypeError("position must be 0-1000");
    patch.position = n;
  }
  if (title !== undefined) {
    const t = typeof title === "string" ? title.trim() : "";
    if (!t.length || t.length > 80) throw new TypeError("title must be a 1-80 char string");
    patch.title = t;
  }
  if (!Object.keys(patch).length) throw new TypeError("enabled, position, or title required");
  const p = await getPool();
  if (!p) return null; // registry edits are persistent-only operator actions
  const { rows } = await p.query(
    `UPDATE discover_rails SET
       enabled    = COALESCE($2, enabled),
       position   = COALESCE($3, position),
       title      = COALESCE($4, title),
       updated_at = now()
     WHERE id=$1
     RETURNING id, kind, title, position, enabled, version`,
    [railId, patch.enabled ?? null, patch.position ?? null, patch.title ?? null]);
  return rows[0] || null;
}

// ── Brand cases (v18, Feature G groundwork) ────────────────────────────────
// Case rows + an APPEND-ONLY transition ledger. lib/brands/cases.js owns
// the state machine and validation; this layer owns atomicity: every move
// is CAS-guarded on the caller's expectedStatus and writes its ledger row
// in the same transaction (competing reviewers race safely — the
// updateLearnedFactStatus lesson).

function brandCaseRow(r) {
  return {
    id: r.id, kind: r.kind, brandName: r.brand_name,
    subjectType: r.subject_type, subjectId: r.subject_id,
    status: r.status, openedBy: r.opened_by, evidence: r.evidence || {},
    resolution: r.resolution, resolvedBy: r.resolved_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// input arrives pre-validated by lib/brands/cases.js validateOpenCase
export async function insertBrandCase(v) {
  const id = "bc-" + randomUUID();
  const p = await getPool();
  if (!p) {
    const row = {
      id, kind: v.kind, brandName: v.brandName, subjectType: v.subjectType,
      subjectId: v.subjectId, status: "open", openedBy: v.openedBy,
      evidence: v.evidence, resolution: null, resolvedBy: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    mem.brandCases.set(id, row);
    mem.brandCaseEvents.push({ caseId: id, fromStatus: "open", toStatus: "open", actor: v.openedBy, note: "opened", at: Date.now() });
    return { ...row };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO brand_cases (id, kind, brand_name, subject_type, subject_id, opened_by, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, v.kind, v.brandName, v.subjectType, v.subjectId, v.openedBy, JSON.stringify(v.evidence)]);
    await client.query(
      "INSERT INTO brand_case_events (case_id, from_status, to_status, actor, note) VALUES ($1,'open','open',$2,'opened')",
      [id, v.openedBy]);
    await client.query("COMMIT");
    return brandCaseRow(rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getBrandCase(id) {
  if (typeof id !== "string" || !id.startsWith("bc-")) return null;
  const p = await getPool();
  if (!p) return mem.brandCases.get(id) ? { ...mem.brandCases.get(id) } : null;
  const { rows } = await p.query("SELECT * FROM brand_cases WHERE id=$1", [id]);
  return rows[0] ? brandCaseRow(rows[0]) : null;
}

// CAS-guarded move: UPDATE ... WHERE status=expectedStatus. Zero rows means
// another reviewer moved first — surfaced as "case-moved", never a silent
// overwrite. Ledger row rides the same transaction.
export async function applyBrandCaseTransition(id, expectedStatus, t) {
  if (typeof expectedStatus !== "string" || !expectedStatus) {
    throw new TypeError("expectedStatus required");
  }
  const p = await getPool();
  if (!p) {
    const row = mem.brandCases.get(id);
    if (!row) return null;
    if (row.status !== expectedStatus) throw new Error("case-moved");
    row.status = t.to;
    if (t.evidence !== undefined) row.evidence = t.evidence;
    if (t.resolution !== undefined) { row.resolution = t.resolution; row.resolvedBy = t.actor; }
    row.updatedAt = Date.now();
    mem.brandCaseEvents.push({ caseId: id, fromStatus: expectedStatus, toStatus: t.to, actor: t.actor, note: t.note || null, at: Date.now() });
    return { ...row };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE brand_cases SET
         status=$3,
         evidence=COALESCE($4, evidence),
         resolution=COALESCE($5, resolution),
         resolved_by=CASE WHEN $5::text IS NOT NULL THEN $6 ELSE resolved_by END,
         updated_at=now()
       WHERE id=$1 AND status=$2 RETURNING *`,
      [id, expectedStatus, t.to,
       t.evidence === undefined ? null : JSON.stringify(t.evidence),
       t.resolution === undefined ? null : t.resolution, t.actor]);
    if (!rows[0]) {
      await client.query("ROLLBACK");
      const exists = await client.query("SELECT 1 FROM brand_cases WHERE id=$1", [id]);
      if (!exists.rows[0]) return null;
      throw new Error("case-moved");
    }
    await client.query(
      "INSERT INTO brand_case_events (case_id, from_status, to_status, actor, note) VALUES ($1,$2,$3,$4,$5)",
      [id, expectedStatus, t.to, t.actor, t.note || null]);
    await client.query("COMMIT");
    return brandCaseRow(rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listBrandCases({ status = null, kind = null, brandName = null, limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 100));
  const p = await getPool();
  if (!p) {
    return [...mem.brandCases.values()]
      .filter((c) => (!status || c.status === status) && (!kind || c.kind === kind)
        && (!brandName || c.brandName.toLowerCase() === String(brandName).toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, cap).map((c) => ({ ...c }));
  }
  const { rows } = await p.query(
    `SELECT * FROM brand_cases
     WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR kind=$2)
       AND ($3::text IS NULL OR lower(brand_name)=lower($3))
     ORDER BY updated_at DESC LIMIT $4`,
    [status, kind, brandName, cap]);
  return rows.map(brandCaseRow);
}

