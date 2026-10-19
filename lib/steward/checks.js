// lib/steward/checks.js — what the Asterisk watches when nobody is looking.
//
// Every check is a READ. A finding is never produced by a write. What the
// steward may DO about a finding lives in actions.js, and whether it may do
// it in decisions.js — the owner set the constitution's read-only rule aside
// for the steward on 3 Sep 2026, inside a declared boundary: reversible,
// capped, ledgered before it is made, and never across the two rails that did
// not move (no faking; a hard stop before anything irreversible).
//
// THE LAW THIS FILE INHERITS (scripts/check-deferred-triggers.mjs): a check
// that cannot be measured must never read as a check that passed. Every
// failure to measure returns `unmeasurable`, which the runner ranks ABOVE ok
// — silence is a finding, not a clean bill of health.
//
// Each check declares:
//   id      stable, dotted, area-first — the handle a report or a fix cites
//   title   what a person would call it
//   area    which part of the machine it watches
//   run     (ctx) => { state, evidence, detail?, action? }
//
// States, worst first: blocker | warn | note | unmeasurable | ok.
// `evidence` is one sentence a human can act on and, wherever a number
// exists, it carries that number — a finding without an amount is an opinion.

export const STATES = Object.freeze(["blocker", "warn", "note", "unmeasurable", "ok"]);

const RANK = Object.freeze(Object.fromEntries(STATES.map((s, i) => [s, i])));
/** The more severe of two check states. Severity ordering lives in stateRank,
 *  so a run's overall verdict is the worst single finding — never an average,
 *  which would let one blocker be diluted by a dozen ok's. */
export function worseOf(a, b) { return RANK[a] <= RANK[b] ? a : b; }
/** Severity order for check states, worst first. The one place the ordering
 *  is defined. */
export function stateRank(s) { return RANK[s] ?? RANK.unmeasurable; }

/** Every check refuses the same way when its evidence is out of reach. */
function unmeasurable(evidence, action = null) {
  return { state: "unmeasurable", evidence, action };
}

const n = (row, key = "n") => Number(row?.[key] ?? 0);

// ---------------------------------------------------------------------------
// DATA INTEGRITY
// ---------------------------------------------------------------------------

export const foreignCounters = {
  id: "data.foreign-counters",
  title: "counters for entities the catalog cannot serve",
  area: "brain",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — counters unread");
    const [{ rows: foreign }, { rows: total }] = await Promise.all([
      query("select count(*)::int as n from popularity p where not exists (select 1 from items i where i.id = p.item_id)"),
      query("select count(*)::int as n from popularity"),
    ]);
    const f = n(foreign[0]), t = n(total[0]);
    if (!t) return { state: "ok", evidence: "the popularity table is empty — nothing to rank yet" };
    const share = f / t;
    // The ranking population is filtered at read time (lib/brain/popularity.js),
    // so foreign rows no longer distort exposure percentiles. They are still
    // worth watching: a rising share means an ingestion path is writing
    // catalog counters for something that is not a catalog item.
    return {
      state: share > 0.25 ? "warn" : f ? "note" : "ok",
      evidence: `${f} of ${t} counter rows (${(share * 100).toFixed(1)}%) name ids the catalog cannot serve`,
      detail: { foreign: f, total: t, share: +share.toFixed(4) },
      action: f
        ? "expected for wire transmissions; a jump means a writer is mislabeling ids. Probe rows (l1-alpha and friends) are pollution and can be deleted by the owner."
        : null,
    };
  },
};

export const danglingEdges = {
  id: "data.dangling-edges",
  title: "co-engagement edges pointing at missing items",
  area: "brain",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the graph is unread");
    const { rows } = await query(
      "select count(*)::int as n from edges e where not exists (select 1 from items i where i.id = e.a) or not exists (select 1 from items i where i.id = e.b)");
    const { rows: tot } = await query("select count(*)::int as n from edges");
    const bad = n(rows[0]), total = n(tot[0]);
    return {
      state: bad ? "note" : "ok",
      evidence: `${bad} of ${total} edges name an item that no longer exists`,
      detail: { dangling: bad, total },
      action: bad ? "gamma resolves these to nothing, so they cost recall rather than correctness — they are safe to leave and safe for the owner to delete." : null,
    };
  },
};

export const selfEdges = {
  id: "data.self-edges",
  title: "an item co-engaged with itself",
  area: "brain",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the graph is unread");
    const { rows } = await query("select count(*)::int as n from edges where a = b");
    const bad = n(rows[0]);
    return {
      state: bad ? "warn" : "ok",
      evidence: bad ? `${bad} edges join an item to itself` : "no item is its own neighbor",
      detail: { selfEdges: bad },
      action: bad ? "a self-edge is always a writer bug: it lets one piece boost itself through gamma." : null,
    };
  },
};

// ---------------------------------------------------------------------------
// THE DATABASE'S OWN GUARANTEES
// ---------------------------------------------------------------------------

export const rlsCoverage = {
  id: "db.rls-coverage",
  title: "row-level security enabled without a policy",
  area: "database",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — RLS unread");
    const { rows } = await query(`
      select t.tablename from pg_tables t
       where t.schemaname = 'public' and t.rowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)
       order by t.tablename`);
    const names = rows.map((r) => r.tablename);
    // This is the shape of the biggest find in this repo's history: RLS on
    // with no policy is default-DENY, and the app role has no rolbypassrls —
    // so a GRANT is not access. business_accounts was locked out of itself for
    // weeks, invisible because an empty list is what the page was meant to show.
    return {
      state: names.length ? "blocker" : "ok",
      evidence: names.length
        ? `${names.length} table(s) have RLS on and no policy — the app is locked out of them: ${names.join(", ")}`
        : "every RLS table carries a policy",
      detail: { tables: names },
      action: names.length ? "add the asilum_app_server_access policy in a migration; tests/rls-app-policy.test.js fails any migration that forgets." : null,
    };
  },
};

export const migrationLedger = {
  id: "db.migration-ledger",
  title: "applied migrations vs the files in the repo",
  area: "database",
  async run({ query, schemaVersions }) {
    if (!query) return unmeasurable("no database configured — the ledger is unread");
    const { rows } = await query("select version from app_schema_migrations order by version");
    const applied = rows.map((r) => Number(r.version)).filter(Number.isFinite);
    if (!applied.length) return unmeasurable("the ledger table is empty — cannot compare");
    const max = Math.max(...applied);
    const set = new Set(applied);
    const floor = Math.min(...applied);
    // Holes BELOW the ledger's own floor are history (versions 1-6 predate the
    // ledger); holes above it are a migration that ran without recording, or a
    // record without a run.
    const holes = [];
    for (let v = floor; v <= max; v++) if (!set.has(v)) holes.push(v);
    // The repo's migration files are not always in reach — a serverless route
    // does not carry supabase/ in its bundle. When they are missing the check
    // still finds HOLES (its main job) and says out loud that it could not
    // compare files, rather than reporting a comparison it never made.
    const filesCompared = Array.isArray(schemaVersions);
    const unrecorded = filesCompared ? schemaVersions.filter((v) => v >= floor && !set.has(v)) : [];
    const state = holes.length || unrecorded.length ? "warn" : "ok";
    const fileNote = filesCompared ? "" : " (migration files not visible from here — holes only)";
    return {
      state,
      evidence: state === "ok"
        ? `ledger continuous from v${floor} to v${max} (${applied.length} rows)${fileNote}`
        : `holes ${holes.join(", ") || "none"}; files with no ledger row: ${unrecorded.join(", ") || "none"}`,
      detail: { floor, max, count: applied.length, holes, unrecorded, filesCompared },
      action: state === "ok" ? null : "every schema-vN.sql ends with its app_schema_migrations INSERT — a hole means one ran without recording.",
    };
  },
};

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------

export const catalogIntegrity = {
  id: "catalog.integrity",
  title: "items a reader could meet in a broken state",
  area: "catalog",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the catalog is unread");
    // NO IMAGE DIMENSION, DELIBERATELY. Every one of the 915 items has a null
    // `img` and product_images is empty: the catalog is drawn with the
    // deterministic placeholder thumbs (thumbFor, lib/client.js), which is the
    // shipped design and not a defect. A check that reports a permanent,
    // unfixable finding is how the whole board gets ignored — #281's lesson,
    // one layer up. Add it back the day real photography lands.
    const { rows } = await query(`
      select
        count(*)::int as total,
        count(*) filter (where price is null or price <= 0)::int as bad_price,
        count(*) filter (where title is null or btrim(title) = '')::int as no_title,
        count(*) filter (where brand is null or btrim(brand) = '')::int as no_brand
      from items`);
    const r = rows[0] || {};
    const broken = n(r, "bad_price") + n(r, "no_title");
    const soft = n(r, "no_brand");
    return {
      state: broken ? "blocker" : soft ? "note" : "ok",
      evidence: broken
        ? `${broken} item(s) cannot be shown honestly: ${n(r, "bad_price")} without a real price, ${n(r, "no_title")} without a title`
        : `${n(r, "total")} items, all priced and titled${soft ? ` (${soft} without a brand)` : ""}`,
      detail: { total: n(r, "total"), badPrice: n(r, "bad_price"), noTitle: n(r, "no_title"), noBrand: n(r, "no_brand") },
      action: broken ? "the checkout gate already refuses these; they still reach discovery and search as dead ends." : null,
    };
  },
};

// ---------------------------------------------------------------------------
// COMMERCE — the append-only ledger must agree with its projection
// ---------------------------------------------------------------------------

export const orderProjection = {
  id: "commerce.order-projection",
  title: "orders that disagree with their own event history",
  area: "commerce",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — orders unread");
    const { rows: tot } = await query("select count(*)::int as n from orders");
    const total = n(tot[0]);
    if (!total) return { state: "ok", evidence: "no orders yet — nothing to reconcile" };
    // `paid` is terminal and never downgrades (lib/orders.js). An order whose
    // events contain a paid signal while the projection says otherwise is the
    // one disagreement that costs money.
    const { rows } = await query(`
      select count(*)::int as n from orders o
       where o.status <> 'paid'
         and exists (select 1 from order_events e where e.order_id = o.id and e.type = 'paid')`);
    const { rows: fee } = await query("select count(*)::int as n from orders where status = 'paid' and fee_cents is null");
    const drift = n(rows[0]), noFee = n(fee[0]);
    return {
      state: drift ? "blocker" : noFee ? "warn" : "ok",
      evidence: drift
        ? `${drift} order(s) have a paid event and an unpaid projection`
        : `${total} order(s), projection agrees with the ledger${noFee ? `; ${noFee} paid without a recorded passenger fee` : ""}`,
      detail: { total, drift, paidWithoutFee: noFee },
      action: drift ? "reconcile-on-read (/api/checkout GET) rebuilds a projection from events; a persistent disagreement is a webhook that never landed." : null,
    };
  },
};

export const orphanInteractions = {
  id: "identity.orphan-interactions",
  title: "interactions pointing at items that no longer exist",
  area: "identity",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — interactions unread");
    const { rows } = await query(`
      select count(*)::int as n from interactions x
       where not exists (select 1 from items i where i.id = x.item_id)`);
    const { rows: tot } = await query("select count(*)::int as n from interactions");
    const bad = n(rows[0]), total = n(tot[0]);
    const share = total ? bad / total : 0;
    return {
      state: share > 0.05 ? "warn" : bad ? "note" : "ok",
      evidence: `${bad} of ${total} interactions name an item the catalog no longer holds (${(share * 100).toFixed(1)}%)`,
      detail: { orphans: bad, total, share: +share.toFixed(4) },
      action: bad ? "taste survives the item, so these are harmless history — but a rising share means the catalog is churning under the readers." : null,
    };
  },
};

// ---------------------------------------------------------------------------
// THE V.2 RECORDS AND THE CORRECTION LANES (synergy round, 19 Sep 2026)
//
// user_records (v53) holds what used to live only in a browser; the app caps
// payloads at 8 KiB and each kind per person. A row over either cap can only
// have arrived around the app (a direct write, a future writer), which is the
// finding. Undone corrections are healthy up to a point — a reader taking a
// correction back is the undo working — but a HIGH share means the lanes are
// firing on things readers did not mean, or a client is sending corrections
// by accident.
// ---------------------------------------------------------------------------

export const userRecords = {
  id: "data.user-records",
  title: "the reader's records: payload and per-kind caps hold",
  area: "identity",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — user_records unread");
    const { rows } = await query(`
      select count(*)::int as total,
             count(*) filter (where octet_length(payload::text) > 8192)::int as oversized,
             count(distinct user_id)::int as people
        from user_records`);
    const { rows: over } = await query(`
      select kind, count(*)::int as n from (
        select user_id, kind, count(*) as c from user_records group by user_id, kind
      ) t where (kind = 'save' and c > 400) or (kind = 'location' and c > 1)
             or (kind = 'correction' and c > 50) or (kind = 'draft' and c > 50)
      group by kind`);
    const total = n(rows[0], "total"), oversized = n(rows[0], "oversized"), people = n(rows[0], "people");
    const overCap = over.reduce((s, r) => s + n(r), 0);
    if (!total) return { state: "ok", evidence: "user_records is empty — no device record has been mirrored yet" };
    return {
      state: oversized || overCap ? "warn" : "ok",
      evidence: `${total} records for ${people} people; ${oversized} over the 8 KiB payload cap; ${overCap} person-kind pairs over the per-kind cap`,
      detail: { total, people, oversized, overCap: Object.fromEntries(over.map((r) => [r.kind, n(r)])) },
      action: oversized || overCap
        ? "a row the app could not have written — find the writer; the app refuses these with 413 / 409 record_cap."
        : null,
    };
  },
};

export const correctionLanes = {
  id: "brain.correction-lanes",
  title: "reason-specific corrections: what readers say, and how often they take it back",
  area: "brain",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — corrections unread");
    const { rows } = await query(`
      select code, count(*)::int as n, count(*) filter (where undone_at is not null)::int as undone
        from user_corrections
       where created_at > now() - interval '30 days'
       group by code order by n desc`);
    const total = rows.reduce((s, r) => s + n(r), 0);
    const undone = rows.reduce((s, r) => s + n(r, "undone"), 0);
    if (!total) return { state: "ok", evidence: "no corrections in the last 30 days — nothing to read yet" };
    const share = undone / total;
    const lanes = Object.fromEntries(rows.map((r) => [r.code, { n: n(r), undone: n(r, "undone") }]));
    return {
      state: share > 0.4 && total >= 20 ? "warn" : "ok",
      evidence: `${total} corrections in 30 days across ${rows.length} codes; ${undone} undone (${(share * 100).toFixed(1)}%)`,
      detail: { total, undone, share: +share.toFixed(4), lanes },
      action: share > 0.4 && total >= 20
        ? "readers are taking back more than four in ten corrections — a lane is firing on what they did not mean, or a client sends corrections by accident. Read the codes in detail."
        : null,
    };
  },
};

export const aiModelEvents = {
  id: "ai.model-events",
  title: "the model seam: calls by feature and status, and the error share",
  area: "ai",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — ai_model_events unread");
    const { rows } = await query(`
      select feature, status, count(*)::int as n
        from ai_model_events
       where created_at > now() - interval '30 days'
       group by feature, status order by feature, status`);
    const total = rows.reduce((s, r) => s + n(r), 0);
    if (!total) return { state: "ok", evidence: "no model events in 30 days — the seam is off or unused (every AI flag defaults off)" };
    const errors = rows.filter((r) => r.status === "error").reduce((s, r) => s + n(r), 0);
    const invalid = rows.filter((r) => r.status === "invalid-output").reduce((s, r) => s + n(r), 0);
    const share = (errors + invalid) / total;
    const byFeature = {};
    for (const r of rows) { byFeature[r.feature] = byFeature[r.feature] || {}; byFeature[r.feature][r.status] = n(r); }
    return {
      state: share > 0.2 && total >= 20 ? "warn" : errors || invalid ? "note" : "ok",
      evidence: `${total} model calls in 30 days; ${errors} errors, ${invalid} invalid outputs (${(share * 100).toFixed(1)}% failed)`,
      detail: { total, errors, invalid, share: +share.toFixed(4), byFeature },
      action: share > 0.2 && total >= 20
        ? "one call in five is failing — a prompt, a schema or a provider changed under us; read the error messages by feature. Failed calls still cost."
        : null,
    };
  },
};

// ---------------------------------------------------------------------------
// THE MODEL'S OWN LIVE QUALITY
//
// The checks above watch the DATA. These watch the ASTERISK: whether it is
// still reading what people ask, still answering it, and still learning.
//
// WHAT IS DELIBERATELY ABSENT: a click-through or save rate on search. The
// columns exist (`clicked_product`, `saved_product`) and both read zero over
// the last 30 days — because the traffic is bots and a bench, not shoppers.
// A rate computed on that is not a weak signal, it is a fabricated one, and
// the evaluation law is explicit: metrics that need real interaction volume
// the product does not have yet must be logged as an aspiration, never
// measured into a verdict. When real readers arrive, this is the first check
// to add.
// ---------------------------------------------------------------------------

const SEARCH_WINDOW = "30 days";
const MIN_SEARCH_SAMPLE = 25;

export const searchAnswerRate = {
  id: "asterisk.search-answer-rate",
  title: "questions the Asterisk could not answer at all",
  area: "asterisk",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the search log is unread");
    const { rows } = await query(`
      select count(*)::int as total,
             count(*) filter (where result_count = 0)::int as zero
        from search_logs where created_at > now() - interval '${SEARCH_WINDOW}'`);
    const total = n(rows[0], "total"), zero = n(rows[0], "zero");
    // Below the sample floor the rate is noise, and noise reported as health
    // is the failure this whole file exists to avoid.
    if (total < MIN_SEARCH_SAMPLE) {
      return unmeasurable(`only ${total} searches in the last ${SEARCH_WINDOW} — under the ${MIN_SEARCH_SAMPLE} needed to read a rate`);
    }
    const rate = zero / total;
    // The cultural read (SEARCH_CULTURE_FALLBACK) is what keeps this near
    // zero: "kurt cobain", "motley crue", "fight club" all resolve through the
    // culture index. Every zero-result search on record predates it. A rise
    // here is that fallback breaking, and it would otherwise be invisible.
    //
    // WHY (20 Sep 2026): the engine now records its own reason for an empty
    // rack (lib/search/index.js `emptyReason`), so the count can say what
    // kind of nothing it was — a prefix fragment from a live search box, a
    // word the catalog does not carry, two constraints no piece satisfies —
    // and stop blaming the culture index for all of them. Rows logged before
    // the reason existed read "unrecorded"; an explained empty is honest.
    const { rows: why } = zero ? await query(`
      select coalesce(interpreted->>'emptyReason', 'unrecorded') as reason, count(*)::int as n
        from search_logs
       where created_at > now() - interval '${SEARCH_WINDOW}' and result_count = 0
       group by 1 order by 2 desc`) : { rows: [] };
    const reasons = Object.fromEntries(why.map((r) => [r.reason, n(r)]));
    const WORDS = { fragment: "prefix fragments", "unknown-words": "words this catalog does not carry",
                    "constraint-conflict": "two constraints no piece satisfies together",
                    "constraint-miss": "one constraint no piece satisfies",
                    "pair-miss": "a designer: house pair the registry cannot verify",
                    other: "unexplained", unrecorded: "logged before the engine recorded reasons" };
    const breakdown = why.length ? ": " + why.map((r) => `${n(r)} ${WORDS[r.reason] || r.reason}`).join(", ") : "";
    const explained = zero - (reasons.other || 0) - (reasons.unrecorded || 0);
    const honest = zero > 0 && explained / zero >= 0.8;
    return {
      state: rate > 0.15 && !honest ? "warn" : rate > 0.05 && !honest ? "note" : "ok",
      evidence: `${zero} of ${total} searches in the last ${SEARCH_WINDOW} returned nothing (${(rate * 100).toFixed(1)}%)${breakdown}`,
      detail: { total, zero, rate: +rate.toFixed(4), window: SEARCH_WINDOW, reasons },
      action: rate > 0.05 && !honest
        ? "the empties are unexplained — check SEARCH_CULTURE_FALLBACK is not disabled and that the culture index still loads; a cultural query returning nothing is the signature."
        : rate > 0.05 && (reasons.fragment || 0) > zero / 2
          ? "mostly prefix fragments from a live search box — a client debounce, not an engine fault."
          : null,
    };
  },
};

export const interpretationCoverage = {
  id: "asterisk.reading-coverage",
  title: "searches the Asterisk actually read",
  area: "asterisk",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the search log is unread");
    const { rows } = await query(`
      select count(*)::int as total,
             count(*) filter (where interpreted is not null)::int as read
        from search_logs where created_at > now() - interval '${SEARCH_WINDOW}'`);
    const total = n(rows[0], "total"), read = n(rows[0], "read");
    if (total < MIN_SEARCH_SAMPLE) {
      return unmeasurable(`only ${total} searches in the last ${SEARCH_WINDOW} — too few to read a coverage share`);
    }
    const share = read / total;
    return {
      state: share < 0.9 ? "warn" : "ok",
      evidence: `${read} of ${total} searches carry a stored reading (${(share * 100).toFixed(1)}%)`,
      detail: { total, read, share: +share.toFixed(4) },
      action: share < 0.9 ? "an unread search is one the engine answered without interpreting — the honest-explanation contract cannot hold for those." : null,
    };
  },
};

export const unknownDemand = {
  id: "asterisk.unknown-demand",
  title: "questions more than one person asked and nobody answered",
  area: "asterisk",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the demand ledger is unread");
    const { rows } = await query(`
      select count(*) filter (where distinct_identities >= 2 and status = 'observed')::int as demanded,
             count(*)::int as total
        from unknown_queries`);
    const demanded = n(rows[0], "demanded"), total = n(rows[0], "total");
    return {
      state: demanded >= 5 ? "warn" : demanded ? "note" : "ok",
      evidence: demanded
        ? `${demanded} unknown quer${demanded === 1 ? "y" : "ies"} were asked by two or more people and are still unresolved (of ${total} on the ledger)`
        : `nothing on the ${total}-row unknown ledger has repeat demand`,
      detail: { demanded, total },
      action: demanded ? "desk panel 07 promotes one into research — demand is the signal for what to teach the Asterisk next." : null,
    };
  },
};

export const brainLearning = {
  id: "brain.learning",
  title: "whether the engine is still building profiles",
  area: "brain",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — profiles unread");
    const { rows } = await query(`
      select (select count(*) from profiles)::int as profiles,
             (select count(distinct user_id) from user_events)::int as actors`);
    const profiles = n(rows[0], "profiles"), actors = n(rows[0], "actors");
    if (!actors) return { state: "ok", evidence: "nobody has acted yet — nothing to learn from" };
    const share = profiles / actors;
    // People who only ever read carry no taste vector, so the share is not
    // expected to reach 1. It collapsing toward 0 while events keep arriving
    // is the signature of a brain that stopped writing — an outage that shows
    // up nowhere else, because an unpersonalized feed still looks like a feed.
    return {
      state: share < 0.2 ? "blocker" : share < 0.5 ? "warn" : "ok",
      evidence: `${profiles.toLocaleString()} taste profiles for ${actors.toLocaleString()} people who have acted (${(share * 100).toFixed(0)}%)`,
      detail: { profiles, actors, share: +share.toFixed(4) },
      action: share < 0.5 ? "events arriving without profiles means the learn path is failing silently — an unpersonalized feed still looks like a feed." : null,
    };
  },
};

// ---------------------------------------------------------------------------
// THE VECTOR SPACE AND THE CATALOG (optimize round, 20 Sep 2026)
//
// A product vector is only worth loading while its product exists. When the
// seed catalog was retired its 915 vectors stayed behind, so every keyed
// search on every instance loaded ~6 MB of JSONB, paid a provider call for the
// query, and compared it against nothing. listEmbeddings now reads product
// vectors through the items table, so the dead rows no longer load — but they
// are still dead weight in the table, and a keyed provider with ZERO live
// vectors means the semantic tier is configured and silent.
// ---------------------------------------------------------------------------

export const embeddingCoverage = {
  id: "data.embedding-coverage",
  title: "product vectors belong to products that exist",
  area: "search",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — embeddings unread");
    const { rows } = await query(`
      select count(*) filter (where i.id is not null)::int as live,
             count(*) filter (where i.id is null)::int as orphans,
             (select count(*) from items)::int as items
        from embeddings e left join items i on i.id = e.owner_id
       where e.owner_kind = 'product'`);
    const live = n(rows[0], "live"), orphans = n(rows[0], "orphans"), items = n(rows[0], "items");
    // The provider key lives in the APP's environment (Vercel); this host is
    // the steward's, so "keyed" here means keyed WHERE THE STEWARD RUNS and
    // says nothing certain about production. The rows do: 0 live vectors is
    // a silent tier wherever the key is.
    const keyed = !!(process.env.EMBEDDINGS_PROVIDER && process.env.EMBEDDINGS_API_KEY);
    const coverage = items ? live / items : 0;
    const silent = keyed && items > 0 && live === 0;
    return {
      state: silent ? "warn" : orphans ? "note" : "ok",
      evidence: `${live} live product vectors over ${items} items (${(coverage * 100).toFixed(0)}%); ${orphans} vectors whose product is gone; provider ${keyed ? "keyed" : "unkeyed"} on this host (the app's own environment is not visible here)`,
      detail: { live, orphans, items, coverage: +coverage.toFixed(4), keyed },
      action: silent
        ? "the semantic tier is keyed but has nothing to compare against — run scripts/embed-catalog.mjs (a paid provider call per item) or unkey it."
        : orphans
          ? "dead rows: they no longer load, but `DELETE FROM embeddings e WHERE owner_kind='product' AND NOT EXISTS (SELECT 1 FROM items i WHERE i.id = e.owner_id)` is the owner's word."
          : null,
    };
  },
};

// ---------------------------------------------------------------------------
// data.ebay-feed (1 Oct 2026, owner brief §15 point 6): the bulk feed's
// counters — checkpoints by status, rows read / upserted / stale / rejected,
// feed rows visible, and the update LAG: how long since the newest
// observation any feed row carries. No feed rows at all is a note (the
// entitlement is not granted yet), a failed checkpoint is a warn, a lag over
// two days with rows present is a warn (the worker has stopped), and a
// rejection share over a third is a note (a column the mapper misreads).
// ---------------------------------------------------------------------------

export const ebayFeed = {
  id: "data.ebay-feed",
  title: "the eBay bulk feed is flowing and its rows are current",
  area: "catalog",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — feed checkpoints unread");
    const { rows: cp } = await query(`
      select status, count(*)::int as files,
             coalesce(sum(rows_read),0)::bigint as rows_read, coalesce(sum(rows_upserted),0)::bigint as rows_upserted,
             coalesce(sum(rows_stale),0)::bigint as rows_stale,
             coalesce(sum((select coalesce(sum(value::int),0) from jsonb_each_text(rows_rejected))),0)::bigint as rows_rejected
        from ebay_feed_checkpoints group by status`);
    const { rows: it } = await query(`
      select count(*) filter (where source_observed_at is not null)::int as feed_rows,
             count(*) filter (where source_observed_at is not null and is_available and moderation_status = 'visible')::int as visible,
             max(source_observed_at) as newest
        from items where source_name = 'ebay'`);
    const by = Object.fromEntries(cp.map((r) => [r.status, r]));
    const failed = n(by.failed, "files"), running = n(by.running, "files"), done = n(by.done, "files");
    const read = cp.reduce((a, r) => a + Number(r.rows_read || 0), 0);
    const rejected = cp.reduce((a, r) => a + Number(r.rows_rejected || 0), 0);
    const upserted = cp.reduce((a, r) => a + Number(r.rows_upserted || 0), 0);
    const stale = cp.reduce((a, r) => a + Number(r.rows_stale || 0), 0);
    const feedRows = n(it[0], "feed_rows"), visible = n(it[0], "visible");
    const newest = it[0] && it[0].newest ? new Date(it[0].newest).getTime() : null;
    const lagHours = newest ? Math.round((Date.now() - newest) / 3_600_000) : null;
    const rejectShare = read ? rejected / read : 0;
    const state = failed ? "warn" : (feedRows && lagHours > 48) ? "warn" : !feedRows ? "note" : rejectShare > 1 / 3 ? "note" : "ok";
    return {
      state,
      evidence: `${done} file(s) done, ${running} running, ${failed} failed; ${read} rows read, ${upserted} upserted, ${stale} stale, ${rejected} rejected (${(rejectShare * 100).toFixed(0)}%); ${feedRows} feed rows in items, ${visible} visible; newest observation ${newest ? lagHours + " h ago" : "none"}`,
      detail: { files: { done, running, failed }, rows: { read, upserted, stale, rejected }, feedRows, visible, lagHours },
      action: failed ? "a checkpoint failed: read its `error` in ebay_feed_checkpoints and re-run `npm run ebay:publish -- --dir <its directory>` — the checkpoint resumes it."
        : (feedRows && lagHours > 48) ? "the feed rows are over two days old: the worker (`npm run ebay:worker`) has stopped or the entitlement lapsed."
        : !feedRows ? "no feed rows yet — the eBay Feed entitlement is not granted or the worker has never run (docs/EBAY-FEED-ENTITLEMENT.md)."
        : rejectShare > 1 / 3 ? "a third of rows are refused: group the checkpoint's rows_rejected by reason — a column the mapper misreads shows as one reason dominating."
        : null,
    };
  },
};

// ---------------------------------------------------------------------------
// ASTERISK GOVERNANCE (V.2 Blueprint, Part I; slice 5)
// ---------------------------------------------------------------------------

/** A paused or handed function, an alert nobody has taken, a queue growing
 *  old: the board says it before a passenger notices nothing is being tagged. */
export const asteriskGovernance = {
  id: "asterisk.governance",
  title: "ASTERISK functions paused, handed or queueing",
  area: "asterisk",
  async run({ query }) {
    if (!query) return unmeasurable("no database configured — the governance ledger is unread");
    const { rows: present } = await query("select to_regclass('public.asterisk_queue') is not null as ok");
    if (!present[0] || !present[0].ok) return unmeasurable("schema v63 (asterisk governance) is not applied — the functions cannot be read", "apply supabase/schema-v63-asterisk-governance.sql; until then ASTERISK's functions run ungoverned by the console.");
    const { rows: state } = await query("select function, paused, handed, grade from asterisk_function_state where paused or handed");
    const { rows: open } = await query(
      "select count(*)::int as n, count(*) filter (where alert)::int as alerts, count(*) filter (where at < now() - interval '24 hours')::int as stale from asterisk_queue where status = 'open'");
    const paused = state.filter((r) => r.paused).map((r) => r.function);
    const handed = state.filter((r) => r.handed).map((r) => r.function);
    const total = n(open[0]), alerts = n(open[0], "alerts"), stale = n(open[0], "stale");
    const worst = handed.length || alerts ? "warn" : paused.length || stale ? "note" : "ok";
    return {
      state: worst,
      evidence: `${paused.length} paused (${paused.join(", ") || "none"}), ${handed.length} handed to the queue (${handed.join(", ") || "none"}); ${total} open case(s), ${alerts} alerting, ${stale} older than a day`,
      detail: { paused, handed, open: total, alerts, stale },
      action: handed.length ? "a function failed two audits in a row: its decisions wait in the queue until an admin grades it passing (/admin panel 10, GRADE)."
        : alerts ? "a fraud flag or a high-value authentication is waiting for an admin (/admin panel 10, QUEUE)."
        : paused.length ? "a paused function does no new work; resume it when the reason is gone, or its queue keeps growing."
        : stale ? "cases older than a day are waiting without a ping — that is by design for everything but fraud and high value, but a day is long."
        : null,
    };
  },
};

export const CHECKS = Object.freeze([
  asteriskGovernance,
  userRecords,
  embeddingCoverage,
  ebayFeed,
  correctionLanes,
  aiModelEvents,
  rlsCoverage,
  catalogIntegrity,
  orderProjection,
  migrationLedger,
  brainLearning,
  searchAnswerRate,
  interpretationCoverage,
  unknownDemand,
  selfEdges,
  foreignCounters,
  danglingEdges,
  orphanInteractions,
]);
