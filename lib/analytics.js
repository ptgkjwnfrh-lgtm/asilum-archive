// lib/analytics.js
// The /stats dashboards (owner directive, 14 Aug 2026, backlog 5).
// SERVER ONLY — reads the database directly.
//
// The rule the handover set: "read-only, real counters, no invented
// metrics." So every number here is a count of rows that exist, each one
// carries the exact window it was measured over, and nothing is modelled,
// smoothed, projected, or filled in. Where a number cannot be computed,
// this returns null and the page says so rather than drawing a zero.
//
// It also means these are DESCRIPTIONS, not judgments: "returning
// identities" counts identities seen in two consecutive weeks, which is
// not the same as people (one person can hold a device identity and an
// account) and the label says so on the page. A metric that quietly means
// something other than its name is the fabricated number in another coat.

import { getPool } from "./db/index.js";

const WEEK = "7 days";

// Each block is its own try/catch: one unavailable table (an older deploy,
// a permission difference) must not blank the whole dashboard.
async function safe(fn, fallback = null) {
  try { return await fn(); } catch { return fallback; }
}

/**
 * The operator dashboard's numbers.
 *
 * RETURNS `{ available: false }` IN MEM MODE RATHER THAN NUMBERS. The event
 * ring is capped and rotates, so any rate computed from it would measure the
 * cap rather than the product — "requires the database" is the truthful
 * answer, and a plausible wrong number is worse than an absent one.
 *
 * Each section is read through `safe()`, so one failing query (a missing table,
 * a permission difference) blanks its own tile instead of the whole dashboard.
 */
export async function analytics() {
  const p = await getPool();
  // Mem mode cannot answer these honestly — the event ring is capped and
  // rotates, so any rate computed from it would be an artifact of the cap.
  // Saying "requires the database" is the truthful answer.
  if (!p) return { available: false, persistent: false };

  const [retention, wire, search, booths] = await Promise.all([
    safe(() => retentionWeeks(p)),
    safe(() => postActivity(p)),
    safe(() => searchHealth(p)),
    safe(() => boothFunnel(p)),
  ]);

  return { available: true, persistent: true, retention, wire, search, booths };
}

// RETENTION — identities active in a week who were ALSO active the week
// before. Weeks are trailing 7-day buckets from now, not calendar weeks,
// so "this week" never means a partial Monday.
async function retentionWeeks(p, weeks = 4) {
  const { rows } = await p.query(
    `WITH bucketed AS (
       SELECT DISTINCT
              user_id,
              floor(extract(epoch FROM (now() - at)) / 604800)::int AS week_ago
         FROM user_events
        WHERE at >= now() - ($1::int || ' weeks')::interval
     )
     SELECT b.week_ago,
            count(*)::int AS active,
            count(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM bucketed prev
                 WHERE prev.user_id = b.user_id AND prev.week_ago = b.week_ago + 1
              )
            )::int AS returning
       FROM bucketed b
      WHERE b.week_ago < $1::int
      GROUP BY b.week_ago
      ORDER BY b.week_ago`,
    [weeks]
  );
  return rows.map((r) => ({
    weeksAgo: r.week_ago,
    active: r.active,
    // The OLDEST bucket has no prior week inside the window, so its
    // "returning" count is not measurable rather than zero — reporting 0
    // there would invent a retention cliff that is really the edge of the
    // query. The page prints "—" for null.
    returning: r.week_ago === weeks - 1 ? null : r.returning,
  }));
}

// THE WIRE — transmissions per day, and how many distinct people posted.
async function postActivity(p, days = 14) {
  const { rows: daily } = await p.query(
    `SELECT (now()::date - created_at::date) AS days_ago, count(*)::int AS posts
       FROM editorial_posts
      WHERE kind='user' AND moderation_status='visible'
        AND created_at >= now() - ($1::int || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [days]
  );
  const { rows: people } = await p.query(
    `SELECT count(DISTINCT author_id)::int AS posters
       FROM editorial_posts
      WHERE kind='user' AND moderation_status='visible'
        AND author_id IS NOT NULL
        AND created_at >= now() - '${WEEK}'::interval`
  );
  const { rows: totals } = await p.query(
    `SELECT count(*)::int AS visible,
            count(*) FILTER (WHERE moderation_status='under_review')::int AS held,
            count(*) FILTER (WHERE moderation_status='deleted')::int AS retired
       FROM editorial_posts WHERE kind='user'`
  );
  return {
    days,
    daily: daily.map((r) => ({ daysAgo: Number(r.days_ago), posts: r.posts })),
    postersThisWeek: people[0]?.posters ?? null,
    // `visible` counts only what the wire shows; held and retired are named
    // separately so the three never get read as one number.
    visible: totals[0]?.visible ?? null,
    held: totals[0]?.held ?? null,
    retired: totals[0]?.retired ?? null,
  };
}

// SEARCH HEALTH — how often a search finds nothing. The zero-result rate
// is the one number that says whether the catalog answers what people
// actually ask for.
async function searchHealth(p, days = 7) {
  const { rows } = await p.query(
    `SELECT count(*)::int AS searches,
            count(*) FILTER (WHERE result_count = 0)::int AS empty,
            count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS searchers
       FROM search_logs
      WHERE created_at >= now() - ($1::int || ' days')::interval`,
    [days]
  );
  const row = rows[0] || {};
  const searches = row.searches ?? 0;
  const { rows: misses } = await p.query(
    `SELECT query, count(*)::int AS n
       FROM search_logs
      WHERE result_count = 0
        AND created_at >= now() - ($1::int || ' days')::interval
      GROUP BY query ORDER BY n DESC, query LIMIT 10`,
    [days]
  );
  return {
    days,
    searches,
    searchers: row.searchers ?? 0,
    empty: row.empty ?? 0,
    // A rate over zero searches is undefined, not 0% — dividing here would
    // print a perfect score for a week nobody searched.
    emptyRate: searches > 0 ? +((row.empty ?? 0) / searches).toFixed(3) : null,
    topMisses: misses.map((m) => ({ query: m.query, count: m.n })),
  };
}

// BOOTH FUNNEL — applications by state. Ten booths exist; the roster is
// whoever a human verified.
async function boothFunnel(p) {
  const { rows } = await p.query(
    `SELECT status, count(*)::int AS n FROM business_accounts GROUP BY status`
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const verified = by.business ?? 0;
  return {
    underReview: by.under_review ?? 0,
    verified,
    rejected: by.rejected ?? 0,
    boothsHeld: Math.min(verified, 10),
    boothsOpen: Math.max(0, 10 - verified),
  };
}
