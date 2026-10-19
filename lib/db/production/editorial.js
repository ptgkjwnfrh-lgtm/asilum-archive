// lib/db/production/editorial.js — THE WIRE, and what readers put on it.
//
// Editorial posts, the likes and saves on them, mood-board uploads, stylist
// outfits, and the source sync log. Grouped because they are all things a
// PERSON produced or a source delivered, as opposed to the catalog facts in
// ./catalog.js or the money in ./commerce.js.
//
// Engagement is person-deduped through `identityHash`, so one reader counts
// once however many devices they carry — see the v28 note in the section
// below.

import { getPool, hasColumns, identityHash, normalizeEvent, memRecordEvent, EVENT_INSERT_SQL } from "../index.js";
import { mem, push, boundedLimit, engKey } from "./store.js";

// ---- editorial posts -------------------------------------------------------------

export async function createEditorialPost(post) {
  const row = {
    authorId: post.authorId || null,
    authorHandle: String(post.authorHandle || "anonymous").slice(0, 80),
    kind: ["user", "asilum", "article"].includes(post.kind) ? post.kind : "user",
    // Screened posts park under review; only the whitelist is accepted so a
    // caller can never mint an arbitrary moderation state.
    moderationStatus: ["visible", "under_review"].includes(post.moderationStatus)
      ? post.moderationStatus : "visible",
    title: post.title ? String(post.title).slice(0, 200) : null,
    // The transmission law (owner order, Aug 13): text posts live to 5000
    // characters. This cap must agree with the route's POST_MAX — a lower
    // one here silently truncated long transmissions for a month.
    body: post.body ? String(post.body).slice(0, 5000) : null,
    excerpt: post.excerpt ? String(post.excerpt).slice(0, 400) : null,
    imageUrl: post.imageUrl || null,
    externalUrl: post.externalUrl || null,
    tags: (post.tags || []).slice(0, 20),
    designerRefs: (post.designerRefs || []).slice(0, 10),
    productRefs: (post.productRefs || []).slice(0, 10),
    // V.2 (1 Oct, schema v57): the composition — a derived kind, a post's
    // layout, and the structured attachments the composer validated.
    postKind: ["transmission", "post", "video"].includes(post.postKind) ? post.postKind : (post.imageUrl ? "post" : "transmission"),
    layout: ["single", "carousel", "fragment", "expose", "event"].includes(post.layout) ? post.layout : null,
    attachments: post.attachments && typeof post.attachments === "object" && !Array.isArray(post.attachments) ? post.attachments : {},
  };
  const p = await getPool();
  if (!p) return push(mem.posts, { id: mem.seq++, ...row, createdAt: Date.now(), persistent: false });
  // v57 may not be applied where this runs yet (hasColumns): the legacy
  // INSERT keeps posting working; the composition is simply not stored.
  const composed = await hasColumns(p, "editorial_posts", ["post_kind", "layout", "attachments"]);
  const { rows } = composed ? await p.query(
    `INSERT INTO editorial_posts
       (author_id, author_handle, kind, title, body, excerpt, image_url, external_url, tags, designer_refs, product_refs, moderation_status,
        post_kind, layout, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, created_at`,
    [row.authorId, row.authorHandle, row.kind, row.title, row.body, row.excerpt, row.imageUrl,
     row.externalUrl, JSON.stringify(row.tags), JSON.stringify(row.designerRefs), JSON.stringify(row.productRefs),
     row.moderationStatus, row.postKind, row.layout, JSON.stringify(row.attachments)]
  ) : await p.query(
    `INSERT INTO editorial_posts
       (author_id, author_handle, kind, title, body, excerpt, image_url, external_url, tags, designer_refs, product_refs, moderation_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, created_at`,
    [row.authorId, row.authorHandle, row.kind, row.title, row.body, row.excerpt, row.imageUrl,
     row.externalUrl, JSON.stringify(row.tags), JSON.stringify(row.designerRefs), JSON.stringify(row.productRefs),
     row.moderationStatus]
  );
  return { id: rows[0].id, ...row, createdAt: new Date(rows[0].created_at).getTime(), persistent: true };
}

export async function listEditorialPosts({ kind = null, limit = 60, handle = null, id = null, authorId = null } = {}) {
  // handle/id/authorId narrow the read (owner order, Aug 13: the wire's
  // identity chain — a poster's page, a post's permalink, the profile's
  // durable posts). Visibility rules are identical on every path: only
  // moderation-visible posts, newest first.
  limit = boundedLimit(limit, 60, 200);
  const p = await getPool();
  if (!p) {
    return mem.posts
      .filter((x) => (x.moderationStatus ?? "visible") === "visible"
        && (!kind || x.kind === kind)
        && (!handle || x.authorHandle === handle)
        && (id == null || String(x.id) === String(id))
        && (!authorId || x.authorId === authorId))
      .slice(-limit).reverse();
  }
  const { rows } = await p.query(
    `SELECT * FROM editorial_posts
     WHERE moderation_status='visible' AND ($1::text IS NULL OR kind=$1)
       AND ($3::text IS NULL OR author_handle=$3)
       AND ($4::bigint IS NULL OR id=$4)
       AND ($5::text IS NULL OR author_id=$5)
     ORDER BY created_at DESC LIMIT $2`,
    [kind, limit, handle, id, authorId]
  );
  return rows.map(editorialRow);
}

const editorialRow = (r) => ({
  id: r.id, authorId: r.author_id, authorHandle: r.author_handle, kind: r.kind,
  title: r.title, body: r.body, excerpt: r.excerpt, imageUrl: r.image_url,
  externalUrl: r.external_url, tags: r.tags || [], designerRefs: r.designer_refs || [],
  productRefs: r.product_refs || [], createdAt: new Date(r.created_at).getTime(),
  editedAt: r.edited_at ? new Date(r.edited_at).getTime() : null, persistent: true,
  // a legacy row (before v57) reads as a post when it carried an image
  postKind: r.post_kind || (r.image_url ? "post" : "transmission"),
  layout: r.layout || (r.image_url && !r.post_kind ? "single" : null),
  attachments: r.attachments && typeof r.attachments === "object" ? r.attachments : {},
});

// Transmission lifecycle (owner directive, HANDOVER-2026-08-14 backlog 1):
// both verbs demand the author's verified identity in the WHERE clause —
// there is no path to another member's transmission, and a missing row and
// a stranger's row answer identically (null/false). Deletion is soft:
// moderation_status='deleted' keeps the row as record while every read
// path above (floor, permalink, profile, /u/[handle]) refuses it, so the
// permalink honestly 404s. Editing stamps edited_at — the floor's honesty
// label. moderationStatus rides along so a re-screened edit can park
// under review; the whitelist means an edit can never mint 'deleted' —
// deletion has its own verb. (An author may also re-edit a post that sits
// under review: the same deterministic screen decides again, and the filed
// moderation task stays for human eyes either way.)
export async function updateEditorialPost({ id, authorId, title = null, body = null, excerpt = null, tags = null, moderationStatus = "visible" }) {
  if (!authorId) throw new TypeError("updateEditorialPost authorId required");
  const status = ["visible", "under_review"].includes(moderationStatus) ? moderationStatus : "visible";
  const next = {
    title: title ? String(title).slice(0, 200) : null,
    body: body ? String(body).slice(0, 5000) : null,
    excerpt: excerpt ? String(excerpt).slice(0, 400) : null,
    // null leaves the stored tags alone; an array (even empty) replaces
    // them, so an author who deletes a hashtag really loses that tag.
    tags: tags == null ? null : (tags || []).slice(0, 20),
  };
  const p = await getPool();
  if (!p) {
    const row = mem.posts.find((x) => String(x.id) === String(id)
      && x.authorId === authorId && (x.moderationStatus ?? "visible") !== "deleted");
    if (!row) return null;
    const { tags: nextTags, ...fields } = next;
    Object.assign(row, fields, { moderationStatus: status, editedAt: Date.now() });
    if (nextTags != null) row.tags = nextTags;
    return { ...row };
  }
  const { rows } = await p.query(
    `UPDATE editorial_posts
        SET title=$3, body=$4, excerpt=$5, moderation_status=$6, edited_at=now(),
            tags = COALESCE($7::jsonb, tags)
      WHERE id=$1 AND author_id=$2 AND moderation_status <> 'deleted'
      RETURNING *`,
    [id, authorId, next.title, next.body, next.excerpt, status,
     next.tags == null ? null : JSON.stringify(next.tags)]
  );
  return rows[0] ? editorialRow(rows[0]) : null;
}

// ---- wire engagement: likes + saves (v28) ----------------------------------
// The handover's law: person-deduped counters in the popularity style
// (engagers, not events) — NO fabricated numbers, ever. The primary key
// (post_id, identity_hash, kind) IS the dedupe: liking twice, from ten tabs,
// or in a loop writes ONE row and counts ONE person. Counts are computed on
// read from that ledger and therefore cannot drift from their evidence —
// there is deliberately no denormalized counter column (see the migration).

const ENGAGE_KINDS = ["like", "save"];

// Toggle one person's like/save on one transmission. Returns the fresh
// counts, or null when the transmission is not on the wire — engaging with
// a deleted or held post must not mint a row (and must not tell the caller
// whether it ever existed).
export async function setTransmissionEngagement({ postId, userId, kind, on }) {
  if (!userId) throw new TypeError("setTransmissionEngagement userId required");
  if (!ENGAGE_KINDS.includes(kind)) throw new TypeError("unknown engagement kind");
  const hash = identityHash(userId);
  const p = await getPool();
  if (!p) {
    const live = mem.posts.some((x) => String(x.id) === String(postId)
      && (x.moderationStatus ?? "visible") === "visible");
    if (!live) return null;
    const key = engKey(postId, hash, kind);
    if (on) mem.engagements.add(key); else mem.engagements.delete(key);
    return (await engagementFor([postId], userId))[String(postId)];
  }
  if (on) {
    // The INSERT ... SELECT is the visibility gate and the write in one
    // statement: no row appears for a transmission the wire will not show.
    const { rowCount } = await p.query(
      `INSERT INTO transmission_engagements (post_id, identity_hash, kind)
       SELECT id, $2, $3 FROM editorial_posts
        WHERE id=$1 AND moderation_status='visible'
       ON CONFLICT (post_id, identity_hash, kind) DO NOTHING`,
      [postId, hash, kind]
    );
    // rowCount 0 is ambiguous — already engaged, or not visible. Ask the
    // ledger which: a row that exists means the engagement stands.
    if (!rowCount) {
      const { rowCount: exists } = await p.query(
        `SELECT 1 FROM transmission_engagements WHERE post_id=$1 AND identity_hash=$2 AND kind=$3`,
        [postId, hash, kind]
      );
      if (!exists) return null;
    }
  } else {
    await p.query(
      `DELETE FROM transmission_engagements WHERE post_id=$1 AND identity_hash=$2 AND kind=$3`,
      [postId, hash, kind]
    );
    // Withdrawing from a post that is gone is a no-op, not an error; the
    // caller still gets honest counts below (zeros if it is not on the wire).
  }
  return (await engagementFor([postId], userId))[String(postId)] || null;
}

// Counts for a page of transmissions, plus this viewer's own state.
// Returns { [postId]: { likes, saves, youLike, youSave } }. An anonymous
// viewer gets counts with both "you" flags false — honest, not hidden.
export async function engagementFor(postIds, userId = null) {
  const ids = [...new Set((postIds || []).map((v) => String(v)))].filter(Boolean);
  const out = {};
  for (const id of ids) out[id] = { likes: 0, saves: 0, youLike: false, youSave: false };
  if (!ids.length) return out;
  const hash = userId ? identityHash(userId) : null;
  const p = await getPool();
  if (!p) {
    for (const key of mem.engagements) {
      const [postId, rowHash, kind] = key.split("|");
      if (!out[postId]) continue;
      if (kind === "like") out[postId].likes += 1; else out[postId].saves += 1;
      if (hash && rowHash === hash) {
        if (kind === "like") out[postId].youLike = true; else out[postId].youSave = true;
      }
    }
    return out;
  }
  const { rows } = await p.query(
    `SELECT post_id, kind,
            count(*)::int AS people,
            bool_or($2::text IS NOT NULL AND identity_hash = $2) AS mine
       FROM transmission_engagements
      WHERE post_id = ANY($1::bigint[])
      GROUP BY post_id, kind`,
    [ids, hash]
  );
  for (const r of rows) {
    const bucket = out[String(r.post_id)];
    if (!bucket) continue;
    if (r.kind === "like") { bucket.likes = r.people; bucket.youLike = !!r.mine; }
    else { bucket.saves = r.people; bucket.youSave = !!r.mine; }
  }
  return out;
}

export async function deleteEditorialPost({ id, authorId }) {
  if (!authorId) throw new TypeError("deleteEditorialPost authorId required");
  const p = await getPool();
  if (!p) {
    const row = mem.posts.find((x) => String(x.id) === String(id)
      && x.authorId === authorId && (x.moderationStatus ?? "visible") !== "deleted");
    if (!row) return false;
    row.moderationStatus = "deleted";
    return true;
  }
  const { rows } = await p.query(
    `UPDATE editorial_posts SET moderation_status='deleted'
      WHERE id=$1 AND author_id=$2 AND moderation_status <> 'deleted'
      RETURNING id`,
    [id, authorId]
  );
  return rows.length > 0;
}

// ---- mood board uploads -------------------------------------------------------------

function buildUploadRow(u) {
  if (!u.userId) throw new TypeError("upload userId required");
  return {
    userId: String(u.userId).slice(0, 80),
    boardId: u.boardId || null,
    imageUrl: u.imageUrl || null,
    caption: u.caption ? String(u.caption).slice(0, 400) : null,
    source: u.source || "upload",
    colors: (u.colors || []).slice(0, 12),
    tags: (u.tags || []).slice(0, 40),        // [{tag, tag_type, confidence}]
    styleNotes: u.styleNotes || null,
    analyzedBy: ["none", "filename", "manual", "palette-v0", "vision"].includes(u.analyzedBy) ? u.analyzedBy : "none",
  };
}

const UPLOAD_INSERT_SQL =
  `INSERT INTO mood_board_uploads
     (user_id, board_id, image_url, caption, source, colors, tags, style_notes, analyzed_by, idempotency_key)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
   ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
   RETURNING id, created_at`;

const uploadParams = (row, idemKey = null) =>
  [row.userId, row.boardId, row.imageUrl, row.caption, row.source,
   JSON.stringify(row.colors), JSON.stringify(row.tags), row.styleNotes, row.analyzedBy, idemKey];

// A stored upload row → the API shape. Shared by list reads and the
// duplicate-return path (which must report the STORED row, not a rebuilt one).
const uploadFromRow = (r) => ({
  id: r.id, userId: r.user_id, boardId: r.board_id, imageUrl: r.image_url,
  caption: r.caption, source: r.source, colors: r.colors || [], tags: r.tags || [],
  styleNotes: r.style_notes, analyzedBy: r.analyzed_by,
  createdAt: new Date(r.created_at).getTime(), persistent: true,
});

export async function createMoodBoardUpload(u) {
  const row = buildUploadRow(u);
  const p = await getPool();
  if (!p) return push(mem.uploads, { id: mem.seq++, ...row, createdAt: Date.now(), persistent: false });
  const { rows } = await p.query(UPLOAD_INSERT_SQL, uploadParams(row));
  return { id: rows[0].id, ...row, createdAt: new Date(rows[0].created_at).getTime(), persistent: true };
}

// Upload + its canonical event in ONE transaction (a failed write leaves
// neither behind), and IDEMPOTENT under client retries: when `idemKey` is
// supplied and a commit already succeeded but the response was lost, the
// retry conflicts on the per-user unique key, writes nothing (no duplicate
// event), and returns the STORED original upload marked duplicate:true.
// Memory mode mirrors the same dedupe. (Codex re-review of #13 + follow-ups.)
export async function createMoodBoardUploadWithEvent(u, evt, idemKey = null) {
  const row = buildUploadRow(u);
  const n = normalizeEvent(evt);
  const p = await getPool();
  if (!p) {
    if (idemKey) {
      const existing = mem.uploads.find(
        (x) => x.userId === row.userId && x.idempotencyKey === idemKey);
      if (existing) return { ...existing, duplicate: true };
    }
    memRecordEvent(n);
    return push(mem.uploads, {
      id: mem.seq++, ...row, idempotencyKey: idemKey || null,
      createdAt: Date.now(), persistent: false,
    });
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    // Upload first: with an idempotency conflict nothing is written, so the
    // event insert below is reached only for genuinely new uploads.
    const { rows } = await client.query(UPLOAD_INSERT_SQL, uploadParams(row, idemKey));
    if (!rows.length) {
      await client.query("ROLLBACK");
      const prior = await p.query(
        "SELECT * FROM mood_board_uploads WHERE user_id = $1 AND idempotency_key = $2",
        [row.userId, idemKey]);
      if (!prior.rows.length) throw new Error("idempotency conflict without prior row");
      // The STORED row, not the freshly-built one — what actually persisted
      // is the honest answer on a retry (Codex #13 follow-up).
      return { ...uploadFromRow(prior.rows[0]), duplicate: true };
    }
    await client.query(EVENT_INSERT_SQL, [n.userId, n.type, n.payloadJson, n.at]);
    await client.query("COMMIT");
    return { id: rows[0].id, ...row, createdAt: new Date(rows[0].created_at).getTime(), persistent: true };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/** Edit an upload's caption and/or replace its tag rows (V.2 17.2–17.3; slice 10c). Author-verified; null when it is not theirs. */
export async function updateMoodBoardUpload({ id, userId, caption = undefined, tags = undefined }) {
  const p = await getPool();
  const cap = caption === undefined ? undefined : (caption ? String(caption).slice(0, 400) : null);
  const rows = tags === undefined ? undefined : (tags || []).slice(0, 40);
  if (!p) {
    const u = mem.uploads.find((x) => String(x.id) === String(id) && x.userId === userId);
    if (!u) return null;
    if (cap !== undefined) u.caption = cap;
    if (rows !== undefined) u.tags = rows;
    return u;
  }
  const { rows: out } = await p.query(
    `UPDATE mood_board_uploads SET caption = CASE WHEN $3::boolean THEN $4 ELSE caption END, tags = CASE WHEN $5::boolean THEN $6::jsonb ELSE tags END
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, userId, cap !== undefined, cap === undefined ? null : cap, rows !== undefined, rows === undefined ? null : JSON.stringify(rows)]);
  return out[0] ? uploadFromRow(out[0]) : null;
}

/** Delete an upload and its analysis rows (17.4). Author-verified; false when it is not theirs. */
export async function deleteMoodBoardUpload({ id, userId }) {
  const p = await getPool();
  if (!p) {
    const i = mem.uploads.findIndex((x) => String(x.id) === String(id) && x.userId === userId);
    if (i < 0) return false;
    mem.uploads.splice(i, 1);
    mem.analyses = mem.analyses.filter((a) => String(a.uploadId) !== String(id));
    return true;
  }
  const { rowCount } = await p.query("DELETE FROM mood_board_uploads WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rowCount) return false;
  await p.query("DELETE FROM mood_board_analysis WHERE upload_id=$1 AND user_id=$2", [id, userId]).catch(() => null);
  return true;
}

export async function listMoodBoardUploads(userId, limit = 60) {
  limit = boundedLimit(limit, 60, 200);
  const p = await getPool();
  if (!p) return mem.uploads.filter((x) => x.userId === userId).slice(-limit).reverse();
  const { rows } = await p.query(
    "SELECT * FROM mood_board_uploads WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit]
  );
  return rows.map(uploadFromRow);
}

// ---- stylist outfits -------------------------------------------------------------

export async function saveStylistOutfit(o) {
  if (!o.userId) throw new TypeError("outfit userId required");
  const row = {
    userId: String(o.userId).slice(0, 80),
    signature: o.signature || null,
    genre: o.genre || null,
    items: (o.items || []).slice(0, 12),
    matchScore: o.matchScore == null ? null : Number(o.matchScore),
    reasons: (o.reasons || []).slice(0, 12),
    // AI-foundation fields (schema-v3) — optional, null for legacy callers.
    stylistRequestId: o.stylistRequestId || null,
    outfitName: o.outfitName || null,
    outfitSummary: o.outfitSummary || null,
    matchedTags: (o.matchedTags || []).slice(0, 16),
    colorLogic: o.colorLogic || null,
    silhouetteLogic: o.silhouetteLogic || null,
    aestheticLogic: o.aestheticLogic || null,
    modelProvider: o.modelProvider || null,
    modelName: o.modelName || null,
  };
  const p = await getPool();
  if (!p) return push(mem.outfits, { id: mem.seq++, ...row, createdAt: Date.now(), persistent: false });
  const { rows } = await p.query(
    `INSERT INTO stylist_outfits (user_id, signature, genre, items, match_score, reasons,
       stylist_request_id, outfit_name, outfit_summary, matched_tags,
       color_logic, silhouette_logic, aesthetic_logic, model_provider, model_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, created_at`,
    [row.userId, row.signature, row.genre, JSON.stringify(row.items), row.matchScore,
     JSON.stringify(row.reasons), row.stylistRequestId, row.outfitName, row.outfitSummary,
     JSON.stringify(row.matchedTags), row.colorLogic, row.silhouetteLogic,
     row.aestheticLogic, row.modelProvider, row.modelName]
  );
  return { id: rows[0].id, ...row, createdAt: new Date(rows[0].created_at).getTime(), persistent: true };
}

export async function getStylistOutfit(id) {
  const p = await getPool();
  if (!p) return mem.outfits.find((o) => String(o.id) === String(id)) || null;
  const { rows } = await p.query("SELECT * FROM stylist_outfits WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, userId: r.user_id, items: r.items || [], matchScore: r.match_score,
    matchedTags: r.matched_tags || [], outfitName: r.outfit_name, persistent: true };
}

export async function listStylistOutfits(userId, limit = 30) {
  limit = boundedLimit(limit, 30, 100);
  const p = await getPool();
  if (!p) return mem.outfits.filter((x) => x.userId === userId).slice(-limit).reverse();
  const { rows } = await p.query(
    "SELECT * FROM stylist_outfits WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit]
  );
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, signature: r.signature, genre: r.genre,
    items: r.items || [], matchScore: r.match_score == null ? null : Number(r.match_score),
    reasons: r.reasons || [], createdAt: new Date(r.created_at).getTime(), persistent: true,
  }));
}

// ---- sync logs + availability checks ----------------------------------------------

export async function recordSyncLog({ sourceName, itemsSeen = 0, itemsUpserted = 0, status = "ok", error = null }) {
  const p = await getPool();
  if (!p) return { persistent: false };
  await p.query(
    `INSERT INTO source_sync_logs (source_name, finished_at, items_seen, items_upserted, status, error)
     VALUES ($1, now(), $2, $3, $4, $5)`,
    [sourceName, itemsSeen, itemsUpserted, status, error]
  );
  return { persistent: true };
}

export async function listSyncLogs(limit = 50) {
  limit = boundedLimit(limit, 50, 200);
  const p = await getPool();
  if (!p) return [];
  const { rows } = await p.query(
    "SELECT * FROM source_sync_logs ORDER BY started_at DESC LIMIT $1", [limit]
  );
  return rows;
}

export async function recordAvailabilityCheck({ productId, availabilityStatus = "unknown",
  previousPrice = null, currentPrice = null, sourceResponseStatus = null }) {
  if (!productId) return { persistent: false };
  const p = await getPool();
  if (!p) return { persistent: false };
  await p.query(
    `INSERT INTO product_availability_checks
       (product_id, availability_status, previous_price, current_price, source_response_status)
     VALUES ($1,$2,$3,$4,$5)`,
    [productId, availabilityStatus, previousPrice, currentPrice, sourceResponseStatus]
  );
  // Reflect the latest state onto the product row itself.
  await p.query(
    `UPDATE items SET availability_status=$2,
       is_available=($2 NOT IN ('sold','removed')),
       price=COALESCE($3, price), updated_at=now()
     WHERE id=$1`,
    [productId, availabilityStatus, currentPrice]
  );
  return { persistent: true };
}

