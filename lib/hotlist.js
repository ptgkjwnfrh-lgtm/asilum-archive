// lib/hotlist.js
// The hotlist program's laws in one home (P2–P4, owner build order 20 Aug
// 2026; ruling record docs/history/hotlist-program-spec-2026-08-20.md). SERVER-ONLY.
//
// - Rent and commission are constants HERE (the #271 copied-constants law):
//   $150/month, 15% of item price on hotlist-ATTRIBUTED completed orders.
// - Attribution: a booth visit through THE WIRE inside the window, for a
//   business enrolled in the program. No visit record, no attribution —
//   and no attribution, no 15% (the precondition the owner set).
// - Placement (P4): a paid booth reaches ONLY passports whose taste
//   already points at its work. The floor is 0.15 tag-space cosine — the
//   same "thread of familiarity" line the brain's discovery slots use
//   (DISCOVERY_FLOOR in lib/brain/bridges.js); below it a booth simply
//   does not render, rent notwithstanding. Rent buys qualified placement,
//   not impressions.

import { getBusinessBySourceName, listPaidBooths } from "./db/production.js";
import { hasRecentBoothVisit } from "./db/booths.js";
import { listItems, getProfile } from "./db/index.js";

export const HOTLIST_RENT_CENTS = 15000;        // $150/month, monthly cycles
export const HOTLIST_COMMISSION_RATE = 0.15;    // attributed-only, per ruling
export const ATTRIBUTION_WINDOW_DAYS = 7;       // approved with the build order
export const BOOTH_MATCH_FLOOR = 0.15;          // the discovery-threshold precedent

// Cosine over tag-weight maps — the alpha bridge's arithmetic, kept pure
// and tiny here so placement is auditable in one screen.
export function tagCosine(a = {}, b = {}) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(a)) {
    const w = Number(v) || 0;
    na += w * w;
    const o = Number(b[k]) || 0;
    dot += w * o;
  }
  for (const v of Object.values(b)) {
    const w = Number(v) || 0;
    nb += w * w;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// The attribution stamp, computed at ORDER CREATION: the item's source is
// an enrolled program member AND this buyer reached its booth inside the
// window. Membership (not rent currency) gates the stamp — the ledger
// records facts; whether a lapsed-rent month's attributed order is
// commissioned is the agreement's question, answered by a human on the
// statement.
export async function attributionFor(user, item) {
  try {
    const source = item && item.source_name;
    if (!user || !source) return null;
    const business = await getBusinessBySourceName(source);
    if (!business || !business.hotlistMember) return null;
    const visited = await hasRecentBoothVisit(user, source, ATTRIBUTION_WINDOW_DAYS);
    return visited ? source : null;
  } catch {
    return null; // attribution is additive evidence — it never blocks a sale
  }
}

// A booth's taste profile: the weighted mean of its pieces' tags. Cached
// briefly — placement is a hot read, the catalog moves slowly.
const boothTagCache = new Map(); // sourceName -> { tags, at }
const BOOTH_TAG_TTL_MS = 5 * 60 * 1000;

/** A booth's taste profile — the weighted mean of its pieces' tags.
 *  Cached for five minutes: placement is a hot read and the catalog moves
 *  slowly, so a stale profile costs relevance, never correctness. */
export async function boothTagProfile(sourceName) {
  const cached = boothTagCache.get(sourceName);
  if (cached && Date.now() - cached.at < BOOTH_TAG_TTL_MS) return cached.tags;
  const items = await listItems(1000);
  const tags = {};
  let count = 0;
  for (const item of items) {
    if ((item.source_name || item.source) !== sourceName) continue;
    count += 1;
    for (const [tag, w] of Object.entries(item.tags || {})) {
      tags[tag] = (tags[tag] || 0) + (Number(w) || 0);
    }
  }
  if (count) for (const tag of Object.keys(tags)) tags[tag] /= count;
  boothTagCache.set(sourceName, { tags, at: Date.now() });
  return tags;
}

function passportTags(profile) {
  if (!profile) return {};
  const merged = { ...(profile.long || {}) };
  for (const [tag, w] of Object.entries(profile.session || {})) {
    merged[tag] = (merged[tag] || 0) + (Number(w) || 0) * 0.5;
  }
  // Flat profiles from before the two-timescale migration read as-is.
  if (!profile.long && !profile.session) return { ...profile };
  return merged;
}

// P4 — the placement gate. Paid, current, inventory-linked booths whose
// taste clears the floor against THIS passport; a cold passport (no taste
// yet) matches nothing, because "statistically a likely sale" cannot be
// claimed about nobody.
export async function paidBoothsForViewer(userId) {
  const booths = await listPaidBooths();
  if (!booths.length) return [];
  const profile = await getProfile(userId).catch(() => null);
  const taste = passportTags(profile);
  if (!Object.keys(taste).length) return [];
  const out = [];
  for (const booth of booths) {
    const tags = await boothTagProfile(booth.sourceName);
    const sim = tagCosine(taste, tags);
    if (sim >= BOOTH_MATCH_FLOOR) {
      out.push({
        brandName: booth.brandName,
        websiteUrl: booth.websiteUrl,
        sourceName: booth.sourceName,
        match: Math.round(sim * 100) / 100,
      });
    }
  }
  out.sort((a, b) => b.match - a.match);
  return out;
}
