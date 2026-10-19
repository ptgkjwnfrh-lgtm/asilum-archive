// lib/valuation/comparables.js — THE VALUATION HIERARCHY (V.2 Blueprint, owner,
// 17 Oct 2026, chapter 11: comparables first, then era and house rank, with a
// confidence and an honest fallback; slice 12). PURE and client-safe.
//
//   1. COMPARABLES   paid sales ASILUM itself recorded of the same brand and
//                    garment, compatible era and condition. Silent below
//                    COMPARABLES_MIN (ROADMAP §4.6): fewer than three sales is
//                    an anecdote, not a market. With enough, the read is the
//                    median with the middle half as the band; confidence rises
//                    with the count and falls with the spread.
//   2. RANK × ERA    with no comparables, the house's standing in the register
//                    (lib/asterisk/houses.js: a maison older than fifty years,
//                    a house on record, or a label the register does not know)
//                    and the piece's era (archive / modern / current) say WHAT
//                    carries the price — in words, with no number, confidence
//                    low. ASILUM does not invent a figure it cannot source.
//   3. FALLBACK      the provenance stake (lib/provenance.js stakeOf): how much
//                    of the price rests on an unverified name.
//
// Every read carries `basis`, `confidence` and `n`, and the UI says which rung
// answered. Nothing here calls a model or a paid API.

import { stakeOf } from "../provenance.js";
import { houseOrigin } from "../asterisk/houses.js";

export const COMPARABLES_MIN = 3;
export const BASES = Object.freeze(["comparables", "rank-era", "stake"]);
export const CONFIDENCES = Object.freeze(["high", "medium", "low"]);
export const MAISON_AGE_YEARS = 50;

const norm = (s) => String(s || "").trim().toLowerCase();
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** archive (< 2000) / modern (2000–2015) / current (2016+) / unknown. */
export function eraBand(era, nowYear = new Date().getUTCFullYear()) {
  const y = era && Number.isInteger(Number(era.year)) ? Number(era.year) : null;
  if (y == null) {
    const d = era && era.decade ? Number(String(era.decade).replace(/\D/g, "").slice(0, 4)) : null;
    if (d && d < 2000) return "archive";
    if (d && d < 2016) return "modern";
    return "unknown";
  }
  if (y < 2000) return "archive";
  if (y < 2016) return "modern";
  return y <= nowYear + 1 ? "current" : "unknown";
}

/** maison / house / label, from the register alone. */
export function houseRank(brand, nowYear = new Date().getUTCFullYear()) {
  const row = houseOrigin(brand);
  if (!row) return { rank: "label", basis: "not in the house register", foundedIn: null };
  const f = Number(row.foundedIn);
  if (Number.isInteger(f) && nowYear - f >= MAISON_AGE_YEARS) return { rank: "maison", basis: `founded ${f}, on the register`, foundedIn: f };
  return { rank: "house", basis: Number.isInteger(f) ? `founded ${f}, on the register` : "on the register", foundedIn: Number.isInteger(f) ? f : null };
}

const compatible = (a, b) => !a || !b || a === "unknown" || b === "unknown" || a === b;

/**
 * The comparables for a subject from a sales history.
 *   subject: { brand, category, era, condition }
 *   history: [{ brand, category, era, condition, amountCents, paidAt }]
 */
export function comparables(subject = {}, history = []) {
  const brand = norm(subject.brand), category = norm(subject.category);
  const band = eraBand(subject.era), cond = norm(subject.condition) || "unknown";
  const rows = (history || []).filter((h) => norm(h.brand) === brand && brand && norm(h.category) === category && category && compatible(band, eraBand(h.era)) && compatible(cond, norm(h.condition) || "unknown") && int(h.amountCents) > 0);
  const n = rows.length;
  if (n < COMPARABLES_MIN) return { n, silent: true, reason: n === 0 ? "no recorded sale of this brand and garment" : `${n} recorded sale${n === 1 ? "" : "s"} — fewer than ${COMPARABLES_MIN} is an anecdote, not a market` };
  const v = rows.map((r) => int(r.amountCents)).sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  const median = q(0.5), low = q(0.25), high = q(0.75);
  const spread = median > 0 ? (high - low) / median : 1;
  const confidence = n >= 8 && spread <= 0.35 ? "high" : n >= 3 && spread <= 0.75 ? "medium" : "low";
  return { n, silent: false, medianCents: median, lowCents: low, highCents: high, spread: Math.round(spread * 100) / 100, confidence, newest: rows.map((r) => r.paidAt).filter(Boolean).sort().pop() || null };
}

/** The hierarchy, top rung first. */
export function valuationOf(item = {}, history = []) {
  const comps = comparables({ brand: item.brand, category: item.category, era: item.era, condition: item.condition }, history);
  const rank = houseRank(item.brand);
  const era = eraBand(item.era);
  const stake = stakeOf(item);
  if (!comps.silent) {
    return { basis: "comparables", confidence: comps.confidence, n: comps.n, medianCents: comps.medianCents, bandCents: [comps.lowCents, comps.highCents], rank: rank.rank, era, stake: stake.level, line: `${comps.n} ASILUM sales of this brand and garment: USD ${(comps.medianCents / 100).toFixed(0)} typical, ${(comps.lowCents / 100).toFixed(0)}–${(comps.highCents / 100).toFixed(0)} the middle half · ${comps.confidence} confidence`, note: "from sales ASILUM itself recorded; never a model's guess" };
  }
  if (rank.rank !== "label" || era !== "unknown") {
    const what = rank.rank === "maison" ? "a maison" : rank.rank === "house" ? "a house on record" : "a label the register does not know";
    const when = era === "archive" ? "an archive piece" : era === "modern" ? "a modern piece" : era === "current" ? "a current piece" : "a piece of unknown era";
    return { basis: "rank-era", confidence: "low", n: comps.n, medianCents: null, bandCents: null, rank: rank.rank, era, stake: stake.level, line: `${when} from ${what}${rank.foundedIn ? ` (founded ${rank.foundedIn})` : ""} — ${rank.rank === "maison" && era === "archive" ? "the name and the era carry the price" : rank.rank === "label" ? "the piece carries its own price" : "the name carries part of the price"}; no comparables on record (${comps.reason})`, note: "no figure: ASILUM does not invent a valuation it cannot source" };
  }
  return { basis: "stake", confidence: "low", n: comps.n, medianCents: null, bandCents: null, rank: rank.rank, era, stake: stake.level, line: stake.why, note: comps.reason };
}
