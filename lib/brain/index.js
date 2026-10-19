// lib/brain/index.js
// The orchestrator. Ties tags + lexicon + knowledge base + bridges into a
// single "brain" that can resolve any token (word, designer, era, mood, or
// non-clothing concept) into a tag vector, deduce a product profile, rank a
// feed, and learn from user interactions.
//
// LEARNING MODEL (two timescales, TikTok-style):
//   profile = {
//     long:    { TAG: w },   // long-term taste; decays slowly
//     session: { TAG: w },   // in-the-moment interest; learns fast, fades fast
//     _meta:   { streak, streakTag, dir, fatigue,
//                recent: [itemIds],  // last engaged items (graph anchors)
//                seen:   [itemIds] } // recently served items (feed rotation)
//   }
// Older flat profiles are migrated on read. The scoring taste vector is a
// blend of long + session, so a burst of interest shifts the feed immediately
// without wiping out long-term taste.

import { TAGS, zeroVec, tagSim } from "./tags.js";
import { SERVE_RING_CARDS, SERVE_RING_MAX } from "../feed/rechunk.js";
import { lexiconVector, LEXICON } from "./lexicon.js";
import { kbResolveExact, kbResolveFuzzy, tagsToVec, kbKeys, kbTagsFor } from "./kb.js";
import { activeSplit, normalizeSplit, assembleChunk, rampedSplit, unfamiliarRatio, RAMP_STEPS } from "./bridges.js";
import { CATALOG, catalogByAffinity } from "../ingest/catalog.js";

// ---- Tuning knobs (kept few on purpose) --------------------------------
const LONG_DECAY = 0.98;        // long-term taste fades gently
const SESSION_DECAY = 0.82;     // session interest fades fast
const SESSION_RATE = 2.5;       // session learns this much faster than long-term
const TASTE_LONG = 0.6;         // blend: long-term share of the taste vector
const TASTE_SESSION = 0.4;      //        session share
const HALO = 0.35;              // how much a strong positive bleeds into adjacent tags
const MOMENTUM_BOOST = 0.15;    // temporary lean toward a hot streak tag
const STREAK_TRIGGER = 3;       // consecutive same-direction hits = "on a roll"
const FATIGUE_TRIGGER = 3;      // consecutive skips / dry spell = "bored"
const SKIP_BETA_PENALTY = 0.2;  // extra deduction from a skipped item's top tag
const FAST_SKIP_MS = 1200;      // skipped faster than this = strong rejection
const FAST_SKIP_MULT = 1.75;
const DWELL_MAX_W = 0.12;       // dwell weight saturates here...
const DWELL_SAT_MS = 8000;      // ...after this much viewing time
const RECENT_CAP = 20;          // engaged-item ids kept as graph anchors
// ROTATION MEMORY IS THE SIZE OF THE READER'S WORLD, not a threshold past
// which repeats begin. Measured 6 September (npm run feed:rotation): reach
// scales almost linearly with this number — a 200-slot memory left a reader
// permanently confined to 286 of 915 items, 400 reached 482, 800 reached 864,
// and 1,000 reached all 915. `seen` is a score PENALTY, not an exclusion, so
// once every remembered item carries it the engine serves the next best 60,
// those enter memory, 60 fall out with their penalty lifted, and the feed
// oscillates over one taste-shaped neighbourhood forever.
//
// So the ceiling is now sized by the CALLER, from the pool it is serving:
// remembering as many ids as there are items in that pool is exactly enough
// and needs no fitted constant. SEEN_CAP is the hard ceiling that protects the
// 256 KiB profile budget (lib/db/core/profiles.js throws above it) when the
// pool grows past what a profile can hold — ingestion will cross that, and a
// served-ledger table or a bloom filter is the answer there, not a bigger
// number here.
//
// EXPORTED because account adoption merges two profiles' rotation rings and
// has to cap them at what the canonical writer uses. It carried its own
// literal `200` and that copy went stale the moment this number moved — the
// exact drift the comment beside it warns about.
export const SEEN_CAP = 4000;   // ceiling on served-item ids kept for rotation
const SEEN_BYTES = 48 * 1024;   // and its share of the 256 KiB profile budget
const FEED_LIMIT = 60;          // max items returned per feed build

// Engagement hierarchy: bag intent beats sharing beats saving beats liking.
const ACTION_WEIGHT = {
  purchase: 1.0,   // the reader paid for it — server records only (lib/brain/purchase.js)
  bag: 0.7,
  share: 0.6,
  save: 0.5,
  favorite: 0.4,
  open: 0.1,       // the reader opened the record — a click, weaker than a favourite
  dwell: 0,        // computed from dwellMs
  skip: -0.15,
  hide: -0.5,
};
const STRONG_POSITIVE = new Set(["bag", "favorite", "save", "share"]);

// ---- Profile shape -------------------------------------------------------

// Migrate any stored profile (old flat vector or v2) into the v2 shape.
export function migrateProfile(raw) {
  const meta = { streak: 0, streakTag: null, dir: 0, fatigue: 0, recent: [], seen: [] };
  if (!raw) return { long: {}, session: {}, _meta: meta };
  if (raw.long || raw.session) {
    return {
      long: { ...(raw.long || {}) },
      session: { ...(raw.session || {}) },
      _meta: { ...meta, ...(raw._meta || {}) },
    };
  }
  // Old flat shape: tag keys at the top level + optional _meta.
  const long = {};
  for (const k in raw) if (k.charAt(0) !== "_") long[k] = raw[k];
  return { long, session: {}, _meta: { ...meta, ...(raw._meta || {}) } };
}

// Blend long-term + session into the single taste vector used for scoring.
export function tasteVector(profile) {
  const p = profile.long ? profile : migrateProfile(profile);
  const taste = {};
  for (const k in p.long) taste[k] = p.long[k] * TASTE_LONG;
  for (const k in p.session) taste[k] = (taste[k] || 0) + p.session[k] * TASTE_SESSION;
  for (const k in taste) {
    if (taste[k] > 1) taste[k] = 1;
    if (taste[k] < -1) taste[k] = -1;
  }
  return taste;
}

// ---- Token resolution -----------------------------------------------------

// ---- typo bridge (asterisk-boost r2) ---------------------------------------
// Bounded levenshtein against the full curated vocabulary (KB keys + lexicon
// keys). Distance budget: 1 edit for 5–7 char tokens, 2 for 8+. Fuzzy hits
// are discounted (×0.8) because a typo read is weaker evidence than an exact
// one. Vocabulary list is built lazily once per process.
let FUZZY_VOCAB = null;
function fuzzyVocab() {
  if (!FUZZY_VOCAB) {
    FUZZY_VOCAB = [
      ...kbKeys().map((k) => ({ k, kind: "kb" })),
      ...Object.keys(LEXICON).map((k) => ({ k, kind: "lex" })),
    ];
  }
  return FUZZY_VOCAB;
}
function levWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function fuzzyToken(token) {
  const t = String(token || "").toLowerCase();
  if (t.length < 5) return null;
  const budget = t.length >= 7 ? 2 : 1;
  let best = null;
  let bestD = budget + 1;
  for (const { k, kind } of fuzzyVocab()) {
    const d = levWithin(t, k, budget);
    if (d < bestD) { bestD = d; best = { k, kind }; if (d === 0) break; }
  }
  if (!best || bestD > budget) return null;
  const vec = best.kind === "kb"
    ? tagsToVec(kbTagsFor(best.k) || [])
    : { ...(Object.hasOwn(LEXICON, best.k) ? LEXICON[best.k] : {}) };
  for (const k2 in vec) vec[k2] *= 0.8;
  return vec;
}

// ---- morphology bridge (asterisk-boost r3) ---------------------------------
// Generalize past the curated vocabulary without a model: derive unknown
// tokens from known stems. Every rule is deterministic and discounted —
// a derived reading is weaker evidence than an exact one.
//   plurals/adjectives:  "corsets"→corset, "grungy"→grunge     (×0.95/×0.85)
//   likeness suffixes:   "margielaesque", "gorpish", "opium-coded" (×0.8)
//   movement suffixes:   "angelcore", "dungeonwave" — resolve the stem;
//     an unresolvable -core/-wave/-punk coinage still reads as an
//     internet-native micro-aesthetic (weak INDEPENDENT/STATEMENT prior —
//     an editorial judgement about the SUFFIX, stated here, capped low) (×0.75)
//   compounds:           "darkacademia" → dark + academia          (×0.75)
const MOVEMENT_SUFFIX = /(core|wave|punk|goth|gaze)$/;
const MOVEMENT_PRIOR = { INDEPENDENT: 0.25, STATEMENT: 0.2 };
// Genuinely exact: the KB's curated key or the LEXICON's, never a substring
// bridge. The compound split below promises "both halves must be exactly
// known" and a fuzzy contains-match cannot honour that promise — it let
// "darkacademia"-shaped coinages split on halves that merely sat inside some
// KB key.
function exactVector(t) {
  const kb = kbResolveExact(t);
  if (kb) return tagsToVec(kb.tags);
  return lexiconVector(t);
}
function scaled(vec, f) {
  if (!vec) return null;
  const out = {};
  for (const k in vec) if (vec[k]) out[k] = vec[k] * f;
  return Object.keys(out).length ? out : null;
}
function morphToken(t) {
  if (t.length < 4) return null;
  // plural / adjective derivations
  if (t.endsWith("s")) {
    const v = exactVector(t.slice(0, -1)) || (t.endsWith("es") ? exactVector(t.slice(0, -2)) : null);
    if (v) return scaled(v, 0.95);
  }
  if (t.endsWith("y")) {
    const v = exactVector(t.slice(0, -1) + "e") || exactVector(t.slice(0, -1));
    if (v) return scaled(v, 0.85);
  }
  // likeness suffixes: X-esque / X-ish / X-coded / X-inspired / X-adjacent
  const like = t.match(/^(.{3,})(?:esque|ish|coded|inspired|adjacent)$/);
  if (like) {
    const v = exactVector(like[1]) || exactVector(like[1].replace(/-$/, ""));
    if (v) return scaled(v, 0.8);
  }
  // movement suffixes: resolve the stem, else the coinage prior
  const mv = t.match(MOVEMENT_SUFFIX);
  if (mv && t.length > mv[1].length + 2) {
    const stem = t.slice(0, -mv[1].length).replace(/-$/, "");
    const v = exactVector(stem);
    if (v) return scaled(v, 0.75);
    return scaled({ ...MOVEMENT_PRIOR }, 1);
  }
  // compound split: both halves must be exactly known
  if (t.length >= 7) {
    for (let i = 3; i <= t.length - 3; i++) {
      const a = exactVector(t.slice(0, i));
      const b = a ? exactVector(t.slice(i)) : null;
      if (a && b) {
        const blend = {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          blend[k] = ((a[k] || 0) + (b[k] || 0)) / 2;
        }
        return scaled(blend, 0.75);
      }
    }
  }
  return null;
}

// Resolve a single token into a tag vector, trying knowledge base first
// (designers/genres/eras), then the non-clothing lexicon, then morphology,
// then the typo bridge, then a neutral vec.
export function resolveToken(token) {
  const kb = kbResolveExact(token);
  if (kb) return tagsToVec(kb.tags);
  const lex = lexiconVector(token);
  if (lex) return lex;
  // Fuzzy KB bridge sits BELOW the curated lexicon and keeps its old position
  // above morphology (see kbResolveFuzzy for what running it first cost).
  const near = kbResolveFuzzy(token);
  if (near) return tagsToVec(near.tags);
  return morphToken(String(token || "").toLowerCase()) || fuzzyToken(token) || zeroVec();
}

// Combine many tokens (a query, a moodboard, a caption) into one profile.
// Bigrams first (asterisk-boost r2): multi-word knowledge — "mob wife",
// "gurkha trouser", "dennis rodman" — resolves as a unit before its words
// are read separately.
export function deduceProduct(tokens = []) {
  const vec = zeroVec();
  let n = 0;
  const add = (v) => {
    let has = false;
    for (const k in v) if (v[k]) { vec[k] += v[k]; has = true; }
    if (has) n++;
    return has;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length) {
      const two = tokens[i] + " " + tokens[i + 1];
      // Same precedence as resolveToken: exact KB, curated lexicon, then the
      // fuzzy bridge. Before this, "new york" fuzzy-matched "new york city"
      // and took all three tags at 1.0 instead of the lexicon's graded read.
      const kb2 = kbResolveExact(two);
      let v2 = kb2 ? tagsToVec(kb2.tags) : lexiconVector(two);
      if (!v2) {
        const near2 = kbResolveFuzzy(two);
        if (near2) v2 = tagsToVec(near2.tags);
      }
      if (v2 && add(v2)) { i++; continue; }
    }
    add(resolveToken(tokens[i]));
  }
  if (n > 0) for (const k in vec) vec[k] /= n;
  return vec;
}

// Return the single strongest tag on an item (the "beta" signal).
function dominantTag(item) {
  const t = item && item.tags ? item.tags : {};
  let best = null, bestV = 0;
  for (const k in t) {
    if (t[k] > bestV) { bestV = t[k]; best = k; }
  }
  return best;
}

// ---- Learning loop ---------------------------------------------------------
// Update the profile from a single interaction.
// action in {"share","save","favorite","dwell","skip","hide"};
// opts.dwellMs scales dwell weight and detects fast skips.

export function learn(profile, item, action, opts = {}) {
  const p = migrateProfile(profile);
  const meta = p._meta;
  if (!item || !item.tags) return p;

  let w = ACTION_WEIGHT[action] ?? 0;
  if (action === "dwell") {
    w = DWELL_MAX_W * Math.min(1, (opts.dwellMs || 0) / DWELL_SAT_MS);
    if (w <= 0) return p;
  }
  // A fast skip is a much stronger "not for me" than a considered pass.
  if (action === "skip" && opts.dwellMs != null && opts.dwellMs < FAST_SKIP_MS) {
    w *= FAST_SKIP_MULT;
  }

  // Recency decay: old taste fades a little before the new signal lands.
  for (const k in p.long) p.long[k] *= LONG_DECAY;
  for (const k in p.session) p.session[k] *= SESSION_DECAY;

  // Fold the interaction across the item's tags — session learns faster.
  for (const k in item.tags) {
    p.long[k] = (p.long[k] || 0) + item.tags[k] * w;
    p.session[k] = (p.session[k] || 0) + item.tags[k] * w * SESSION_RATE;
  }

  // Halo: a strong positive also nudges long-term tags that are aesthetically
  // adjacent (via the tag-affinity matrix), so the brain generalizes like a
  // stylist instead of a keyword matcher.
  if (STRONG_POSITIVE.has(action)) {
    for (const itemTag in item.tags) {
      const strength = item.tags[itemTag];
      for (const cand of TAGS) {
        if (cand === itemTag) continue;
        const sim = tagSim(itemTag, cand);
        if (sim > 0) p.long[cand] = (p.long[cand] || 0) + strength * w * HALO * sim;
      }
    }
  }

  // Skip deducts extra from the dominant tag -> pushes back on the beta signal.
  const dom = dominantTag(item);
  if (action === "skip" && dom) {
    p.long[dom] = (p.long[dom] || 0) - SKIP_BETA_PENALTY;
    p.session[dom] = (p.session[dom] || 0) - SKIP_BETA_PENALTY * SESSION_RATE;
  }

  // Clamp every tag into [-1, 1] so one interaction can't dominate.
  for (const vec of [p.long, p.session]) {
    for (const k in vec) {
      if (vec[k] > 1) vec[k] = 1;
      if (vec[k] < -1) vec[k] = -1;
    }
  }

  // ---- Momentum + fatigue + graph-anchor bookkeeping ----
  if (STRONG_POSITIVE.has(action)) {
    if (dom && dom === meta.streakTag && meta.dir > 0) meta.streak += 1;
    else if (dom) { meta.streak = 1; meta.streakTag = dom; }
    meta.dir = 1;
    meta.fatigue = 0;
    // The anchor ring is the co-engagement graph's seed: gammaScore and the
    // r18 vector supplement look up edges/neighbours BY these ids (bridges.js
    // gammaScore(item, ctx.recent, ctx.edges) + buildVecNear(ctx.recent)). A
    // non-catalog id — the r17 "reading:<id>" training pseudo-item — has no
    // edges and no vector, so admitting it evicts a real anchor for a dead
    // one and, at RECENT_CAP applied readings, silently zeroes both bridges
    // for that user (audit #13/#21). Taste still trains; only the ring is
    // protected. opts.anchor===false forces skip for any synthetic item.
    if (opts.anchor !== false && item.id != null) {
      meta.recent = [item.id, ...(meta.recent || []).filter((id) => id !== item.id)].slice(0, RECENT_CAP);
    }
  } else if (action === "skip" || action === "hide") {
    meta.dir = -1;
    meta.fatigue = (meta.fatigue || 0) + 1;
  }

  return p;
}

// ---- Feed building -----------------------------------------------------------
// state = { profile, epsilonActive:bool, edges:{}, popularity:{}, boardVec:{}, limit }
// `edges` is the co-engagement neighborhood of profile._meta.recent;
// `popularity` is the global engagement/impression map;
// `boardVec` (optional) seeds/blends taste from a shared moodboard link.

export function buildFeed(state = {}, pool = CATALOG) {
  const p = migrateProfile(state.profile);
  const meta = p._meta;

  // Fatigue-aware epsilon: fire exploration automatically when the user seems
  // bored (a run of skips / no recent favorites), even if the toggle is off.
  // V.2 14.8–14.10 (slice 10c): the trigger is adaptive (repetition and a dry
  // spell, not a timer); the passenger's OFF beats reactivation (14.9) —
  // `state.explorationOff` silences the automatic firing and the toggle
  // alike; while active, the split ramps step by step toward 2:1 (14.10).
  const epsilonAuto = !state.explorationOff && (meta.fatigue || 0) >= FATIGUE_TRIGGER;
  const epsilonActive = !state.explorationOff && (!!state.epsilonActive || epsilonAuto);
  const safeMode = state.novelty === "safe";
  const rampStep = epsilonActive ? Math.min(RAMP_STEPS, (meta.explorationStep || 0) + 1) : 0;
  const split = epsilonActive ? rampedSplit(rampStep, safeMode) : activeSplit(false, safeMode);

  // Taste = blended long+session, with a momentum boost on a hot streak.
  const taste = tasteVector(p);
  if ((meta.streak || 0) >= STREAK_TRIGGER && meta.streakTag) {
    taste[meta.streakTag] = Math.min(1, (taste[meta.streakTag] || 0) + MOMENTUM_BOOST);
  }

  // A current craving is an ephemeral overlay, not durable learning. It gets
  // the deciding vote for this feed while retaining a thread of stable taste.
  const contextVec = state.contextVec || null;
  if (contextVec && Object.keys(contextVec).length) {
    const hasStableTaste = Object.keys(taste).length > 0;
    for (const k of new Set([...Object.keys(taste), ...Object.keys(contextVec)])) {
      taste[k] = hasStableTaste
        ? (taste[k] || 0) * 0.4 + (contextVec[k] || 0) * 0.6
        : contextVec[k] || 0;
    }
  }

  // Taste transfer: a shared board blends into (or seeds) the taste vector.
  if (state.boardVec) {
    const own = Object.keys(taste).length > 0;
    for (const k in state.boardVec) {
      taste[k] = own ? (taste[k] || 0) * 0.5 + state.boardVec[k] * 0.5 : state.boardVec[k];
    }
  }

  const { items, catalog, quotas } = assembleChunk(pool, taste, {
    epsilonActive,
    safeMode,
    recent: meta.recent || [],
    // id → rank, newest served first, so the assembler can grade its penalty.
    seen: new Map((meta.seen || []).map((id, i) => [id, i])),
    edges: state.edges || {},
    popularity: state.popularity || {},
    // (r27) id → image embedding, supplied by the caller exactly as edges and
    // popularity are; the brain never fetches. Null today for every request —
    // the catalog has no photographs — and null makes visual gamma inert, so
    // feeds are byte-identical until pixels exist.
    imageVectors: state.imageVectors || null,
    contextVec,
    crossUser: state.crossUser || null,
    limit: state.limit || FEED_LIMIT,
    // (r15) measurement-only candidate policy — full override, validated or
    // ignored; only the replay/calibration harness sets it.
    // (r16) tuned split — the server-computed bounded personal blend. It
    // applies ONLY in the base state: epsilon-active and safe-mode splits
    // are hand-tuned safety modes that tuning must never defeat.
    splitOverride: normalizeSplit(state.splitOverride)
      || (!epsilonActive && !safeMode ? normalizeSplit(state.tunedSplit) : null),
    // (6 Sep) the catalog lane: a fixed share of every chunk walks the listing
    // in cursor order. state.catalog = { cursor, ordered?, enabled? }; absent
    // means "from the top of this pool's listing order".
    catalog: state.catalog || null,
    // (7 Sep) how the taste lanes rotate between chunks — "memory" when the
    // caller persists served ids (the seen penalty rotates too), "cursor"
    // when it does not; the cursor's served filter is honoured either way.
    rotation: state.rotation === "memory" ? "memory" : "cursor",
  });
  const zones = { core: 0, discovery: 0, reach: 0, catalog: 0 };
  for (const it of items) zones[it._zone] = (zones[it._zone] || 0) + 1;
  return { split, items, epsilonActive, epsilonAuto, safeMode, zones, quotas, catalog, exploration: { active: epsilonActive, auto: epsilonAuto, off: !!state.explorationOff, step: rampStep, ratio: Math.round(unfamiliarRatio(split) * 100) / 100 } };
}

// Record served item ids on the profile (feed rotation memory). Returns the
// updated profile for the caller to persist.
//
// `cap` is how many ids to keep. A caller that knows the pool it served should
// pass its size; the default is the ceiling above, not a policy.
//
// DE-DUPED, NEWEST FIRST. It was not, and a repeated id used to occupy two
// slots. That cost nothing at 200 — the older copy was pushed past the cut and
// sliced off anyway — but at a cap large enough to matter it is real: a
// 1,000-slot memory held 850 distinct ids, so 15% of the reader's world was
// spent remembering the same pieces twice.
//
// Then bounded by BYTES as well as by count, because the count that fits
// depends on how long ids are and this profile has a hard 256 KiB limit that
// THROWS. A synthetic id is 8 characters; a marketplace id can be 40. Failing
// to serve a feed because rotation memory grew is worse than remembering less.
export function markSeen(profile, itemIds = [], cap = SEEN_CAP) {
  const p = migrateProfile(profile);
  const limit = Math.max(1, Math.min(SEEN_CAP, Math.trunc(Number(cap)) || SEEN_CAP));
  let seen = [...new Set([...itemIds, ...(p._meta.seen || [])])].slice(0, limit);
  while (seen.length > 1 && JSON.stringify(seen).length > SEEN_BYTES) {
    seen = seen.slice(0, Math.floor(seen.length * 0.9));
  }
  p._meta.seen = seen;
  return p;
}

// (r14) Per-user bridge impression counters — which bridges are doing this
// user's serving. Instrumentation only (nothing reads it yet); engagement
// attribution lives on user_events (payload.bridge), so win-rates are
// derivable without an event per impression. Counters cap at 100k to stay
// bounded in the profile JSON.
export function markBridgeImpressions(profile, bridgeCounts = {}) {
  const p = migrateProfile(profile);
  const stats = p._meta.bridgeStats || (p._meta.bridgeStats = {});
  for (const [bridge, n] of Object.entries(bridgeCounts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    stats[bridge] = Math.min(100_000, (stats[bridge] || 0) + n);
  }
  return p;
}

// (r19) SERVED vs EXAMINED.
//
// r16's lift is engagement share ÷ impression share, and until this round an
// "impression" meant a slot the server SENT — all 60 of them, whether or not
// the user ever scrolled past slot 12. That is position bias baked straight
// into the training signal: a bridge that fills deep slots accrues impressions
// nobody looked at, its lift is deflated, and tuning quietly moves weight away
// from it for a reason that has nothing to do with taste.
//
// The honest denominator is what the user actually LOOKED AT. The client
// already knows: an IntersectionObserver at 0.55 coverage has tracked card
// visibility since the dwell work, so this round reports those slots instead
// of modelling a position-decay curve. Real observation beats an assumed
// exponential — and a curve's constants would be exactly the kind of
// invented number the house does not ship.
//
// `bridgeServed` keeps the old serve counts as a diagnostic (and as the
// fallback denominator when no examination ever arrives — a client with JS
// disabled must still accrue evidence rather than none).
export function markBridgeServed(profile, bridgeCounts = {}) {
  const p = migrateProfile(profile);
  const served = p._meta.bridgeServed || (p._meta.bridgeServed = {});
  for (const [bridge, n] of Object.entries(bridgeCounts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    served[bridge] = Math.min(100_000, (served[bridge] || 0) + n);
  }
  return p;
}

/**
 * Record WHAT this serve was, so a later examination report can be attributed
 * from the server's own memory instead of the client's word. Bounded: one
 * serve at a time, ids only, replaced on the next page.
 *
 * (r24) The record also carries WHERE each item sat: its slot index and its
 * zone. Position is the largest confound in any engagement number — an item
 * at slot 0 is engaged with more than the same item at slot 40, for reasons
 * that have nothing to do with the item — and until now no logged event
 * carried it, so no round could ever de-bias its own data after the fact.
 *
 * It is recorded HERE, on the server, for the same reason `bridges` is: the
 * client is the one party with an interest in the answer. A reported slot is
 * a claim; a slot the server wrote down when it built the page is a fact.
 */
export function recordServe(profile, serveId, items = [], { pin = false } = {}) {
  const p = migrateProfile(profile);
  const bridges = {};
  const slots = {};
  const zones = {};
  items.forEach((it, index) => {
    if (!it || !it.id) return;
    const id = String(it.id);
    if (it._bridge) bridges[id] = String(it._bridge);
    // First occurrence wins: an id served twice in one slate (which the brand
    // cap and rotation make unlikely, but nothing forbids) keeps the position
    // the reader actually reached first.
    if (slots[id] === undefined) {
      slots[id] = index;
      if (it._zone) zones[id] = String(it._zone);
    }
  });
  // A pinned entry (the page's first load) survives the card bound: on a
  // full page the first re-chunk is the twelfth serve, and the sixty-card
  // first load — the top of the page, where a reader who acts is looking —
  // was the first thing the card bound evicted (a verifier's finding, 7 Sep).
  const entry = { id: String(serveId), bridges, slots, zones, reported: false, examined: [], ...(pin ? { pin: true } : {}) };
  // (6 Sep) A page is several serves now — the first load and every 24-item
  // chunk after it — and one pointer remembered only the newest, so the
  // examination beacon for the first serve found a stranger's id and every
  // card outside the latest chunk lost its slot context. A ring keeps recent
  // serves, bounded by CARDS (the rendered ceiling) rather than by entries, so
  // the first load is not the first thing evicted (a verifier's finding, 7
  // Sep), and by bytes like the seen ring; lastServe stays the newest for
  // older readers.
  // The two newest pinned entries stay pinned: a session legitimately has a
  // cover and a catalog in flight (the cover's twelve-card request has no
  // cursor either), and a third pin unpins the oldest.
  let pinsKept = pin ? 1 : 0;
  const rest = (Array.isArray(p._meta.serves) ? p._meta.serves : [])
    .filter((s) => s && s.id !== entry.id)
    .map((s) => {
      if (!s.pin) return s;
      pinsKept++;
      return pinsKept > 2 ? { ...s, pin: false } : s;
    });
  p._meta.serves = trimServeRing([entry, ...rest]);
  p._meta.lastServe = entry;
  return p;
}

/** How many recent serves a profile remembers for attribution and examination. */
export const SERVE_RING = SERVE_RING_MAX;
const SERVE_RING_BYTES = 64 * 1024;

function serveCards(s) { return s && s.slots ? Object.keys(s.slots).length : 0; }

/** Keep the newest serves while they fit the card, entry and byte budgets; always keep the newest. */
export function trimServeRing(ring) {
  const out = [];
  let cards = 0;
  let full = false;
  for (const s of ring) {
    if (!s) continue;
    if (out.length && !full && (out.length >= SERVE_RING_MAX || cards + serveCards(s) > SERVE_RING_CARDS)) full = true;
    // Past the card/entry bound only a pinned entry (the first load) survives.
    if (full && !s.pin) continue;
    out.push(s);
    cards += serveCards(s);
  }
  // The byte bound still applies to everything, oldest unpinned first.
  while (out.length > 1 && JSON.stringify(out).length > SERVE_RING_BYTES) {
    const idx = [...out].reverse().findIndex((s) => !s.pin);
    if (idx < 0) break;
    out.splice(out.length - 1 - idx, 1);
  }
  return out;
}

/** Every id any recorded serve has already had examined — the beacon counts one eye once. */
export function reportedIds(profile) {
  const meta = migrateProfile(profile)._meta || {};
  const out = new Set();
  const ring = Array.isArray(meta.serves) ? meta.serves : (meta.lastServe ? [meta.lastServe] : []);
  for (const s of ring) for (const id of (s && Array.isArray(s.examined)) ? s.examined : []) out.add(String(id));
  return out;
}

/** The recorded serve with this id, newest ring entry first, else lastServe; null if unknown. */
export function findServe(profile, serveId) {
  const meta = migrateProfile(profile)._meta || {};
  const id = String(serveId);
  const ring = Array.isArray(meta.serves) ? meta.serves : [];
  const hit = ring.find((s) => s && s.id === id);
  if (hit) return hit;
  return meta.lastServe && meta.lastServe.id === id ? meta.lastServe : null;
}

/** Zones the feed assembler can produce. Anything else is not from a feed. */
export const SERVE_ZONES = Object.freeze(["core", "discovery", "reach", "catalog"]);
const SERVE_ZONE_SET = new Set(SERVE_ZONES);
const MAX_SLOT = 999;

/**
 * What the server remembers about serving this item to this user, or null if
 * it does not remember serving it at all (an interaction from a modal, a
 * shared link, search, or simply a page ago). Null is a real answer and must
 * stay one — inventing a slot for an interaction that did not come from the
 * last feed would poison the very histogram this exists to enable.
 *
 * Extracted rather than inlined in the route so the invariant is testable
 * without a live serve.
 */
export function serveContextFor(profile, itemId) {
  const meta = migrateProfile(profile)._meta || {};
  if (!itemId) return null;
  const id = String(itemId);
  // Newest serve that holds the item wins; lastServe covers pre-ring profiles.
  const ring = Array.isArray(meta.serves) && meta.serves.length ? meta.serves : (meta.lastServe ? [meta.lastServe] : []);
  const last = ring.find((s) => s && ((s.slots && s.slots[id] !== undefined) || (s.bridges && s.bridges[id]) || (s.zones && s.zones[id])));
  if (!last) return null;
  const slot = last.slots ? last.slots[id] : undefined;
  const zone = last.zones ? last.zones[id] : undefined;
  const bridge = last.bridges ? last.bridges[id] : undefined;
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    // A serve recorded before r24 has bridges but no slots. Report the bridge
    // it does know and stay silent about position rather than guessing zero.
    return bridge || zone ? { slot: null, zone: SERVE_ZONE_SET.has(zone) ? zone : null, bridge: bridge || null, serveId: last.id } : null;
  }
  return {
    slot,
    zone: SERVE_ZONE_SET.has(zone) ? zone : null,
    bridge: bridge || null,
    serveId: last.id,
  };
}

/** Apply an examination report against the recorded serve. Returns the profile
 * unchanged when the serve is unknown, already reported, or reports nothing —
 * a replayed or forged beacon can never inflate the denominator. */
export function applyExaminationReport(profile, serveId, counts = {}, examinedIds = []) {
  const p = migrateProfile(profile);
  const serve = findServe(p, serveId);
  if (!serve || serve.reported) return p;
  const marked = markBridgeImpressions(p, counts);
  const id = String(serveId);
  // The ids this report counted ride on the entry, so a later report for
  // another serve that ALSO held them (a re-served card under a filter, the
  // fill pass) cannot count the same eye twice.
  const examined = [...new Set((Array.isArray(examinedIds) ? examinedIds : []).map(String))].slice(0, 200);
  const done = { ...serve, reported: true, examined };
  if (Array.isArray(marked._meta.serves)) {
    marked._meta.serves = marked._meta.serves.map((s) => (s && s.id === id ? done : s));
  }
  if (marked._meta.lastServe && marked._meta.lastServe.id === id) marked._meta.lastServe = done;
  return marked;
}

/** Examination coverage: examined impressions ÷ served impressions. Reported,
 * never tuned on — it is how we know whether the denominator is trustworthy. */
export function examinationCoverage(profile) {
  const meta = migrateProfile(profile)._meta || {};
  const sum = (o) => Object.values(o || {}).reduce((t, v) => t + (Number(v) || 0), 0);
  const served = sum(meta.bridgeServed);
  const examined = sum(meta.bridgeStats);
  if (!served) return { served: 0, examined, coverage: null };
  return { served, examined, coverage: Math.round((examined / served) * 1000) / 1000 };
}

// ---- Related items (Pinterest-style "more like this") -------------------------
// Graph neighbors first (people who saved this also saved...), then tag-similar
// catalog items to fill out the row when the graph is still sparse.

export function relatedItems(sourceItem, { edges, pool = CATALOG, limit = 8 } = {}) {
  const out = [];
  const seen = new Set([sourceItem.id]);
  const byId = new Map(pool.map((it) => [it.id, it]));

  const nbrs = edges && edges[sourceItem.id] ? edges[sourceItem.id] : {};
  const ranked = Object.entries(nbrs).sort((a, b) => b[1] - a[1]);
  for (const [id] of ranked) {
    const it = byId.get(id);
    if (it && !seen.has(id)) { out.push({ ...it, _via: "graph" }); seen.add(id); }
    if (out.length >= limit) return out;
  }
  const tagRanked = pool
    .filter((it) => !seen.has(it.id))
    .map((it) => ({
      item: it,
      score: Object.entries(it.tags || {}).reduce(
        (sum, [tag, weight]) => sum + (sourceItem.tags?.[tag] || 0) * (Number(weight) || 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2)
    .map((entry) => entry.item);
  for (const it of tagRanked) {
    if (!seen.has(it.id)) { out.push({ ...it, _via: "tags" }); seen.add(it.id); }
    if (out.length >= limit) break;
  }
  return out;
}

// Mean tag vector of a set of items (used to turn a board into taste).
export function itemsVector(items = []) {
  const vec = {};
  if (!items.length) return vec;
  for (const it of items) {
    for (const k in it.tags || {}) vec[k] = (vec[k] || 0) + it.tags[k];
  }
  for (const k in vec) vec[k] = Math.min(1, vec[k] / items.length);
  return vec;
}

// Ephemeral context for one serve: a craving, a prompt, or both. Neither is
// durable learning, so neither outranks the other — two overlays average into
// one rather than one silently winning. Returns null when there is no context,
// which buildFeed reads as "rank on stored taste alone".
export function overlayVector(...vectors) {
  const live = vectors.filter((vec) => vec && Object.keys(vec).length);
  if (!live.length) return null;
  if (live.length === 1) return live[0];
  const out = {};
  for (const vec of live) {
    for (const [tag, weight] of Object.entries(vec)) {
      out[tag] = (out[tag] || 0) + weight / live.length;
    }
  }
  return out;
}

// ---- Cold start ----------------------------------------------------------------

// The taste a free-text prompt evidences, as a sparse tag vector.
//
// This is the READ of a prompt, with no opinion about whether the caller is
// entitled to persist it. coldStart seeds a profile from it; /api/feed uses it
// as an ephemeral overlay and stores nothing (audit #9). Keeping one tokenizer
// means those two callers cannot come to disagree about what a prompt says.
export function promptVector(promptText = "") {
  const tokens = String(promptText)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // deduceProduct returns a DENSE vector — every tag key, most at 0. Strip the
  // zeros before this becomes a persisted profile (audit #4): a gibberish
  // first prompt would otherwise persist a full set of zero-valued keys that
  // the forget floor can never delete, so a key-PRESENCE gate (hasProfile)
  // reads it as a real profile forever — no coldStart re-seed on later real
  // prompts, board transfer halved, craving damped. Only evidenced tags
  // survive; a prompt the system cannot read yields an honest empty vector.
  const dense = deduceProduct(tokens);
  const vec = {};
  for (const [k, v] of Object.entries(dense)) if (v) vec[k] = v;
  return vec;
}

// Seed a feed from a text prompt. The profile here is DURABLE — /api/train
// persists it on the user's explicit "train the brain" action.
export function coldStart(promptText = "") {
  const profile = promptVector(promptText);
  const items = catalogByAffinity(profile, 8);
  return { profile, items };
}
