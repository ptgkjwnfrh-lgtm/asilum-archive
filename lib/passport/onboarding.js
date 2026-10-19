// lib/passport/onboarding.js — THE PASSPORT'S ONBOARDING AND IDENTITY
// ANCHORS (V.2 Blueprint, owner, 17 Oct 2026: 14.2–14.3, 14.11; owner
// ruling 18 Oct 2026, CONSTITUTION A6 (7); slice 10c). PURE and client-safe.
//
//   THE QUESTIONS (14.11)   on first opening, a roughly five-minute adaptive
//                           autobiographical experience of five to seven
//                           high-information questions: who 12-year-old you
//                           listened to on the bus, who got you through your
//                           first serious breakup, your first big purchase
//                           with your first paycheck, your favorite piece in
//                           your closet. Free text or era-relevant
//                           suggestions; the birthday sets the year you were
//                           12 and suggests ten artists from then. Later
//                           questions adapt to earlier answers. Skip, edit
//                           and resume always work; the breakup question
//                           allows "doesn't apply"; no personal event is
//                           ever assumed.
//   THE SUGGESTIONS (A6 (7)) the birthday, the home town and — when given —
//                           the background pick ten artists from a CURATED
//                           COHORT REGISTER (cohorts.data.json: hand-entered
//                           cultural knowledge with its provenance stated).
//                           A suggestion is never an answer: the passenger
//                           confirms or writes their own, and nothing is
//                           inferred from the register alone.
//   THE ANCHORS (14.2–14.3) an answer becomes an identity anchor: the
//                           passenger's words and the tags they carry, in the
//                           explicit class that never decays (lib/brain/
//                           memory.js _meta.manual). Only the passenger
//                           designates or removes one; ASTERISK never
//                           auto-promotes.

import { lexiconVector } from "../brain/lexicon.js";
import { yearAtAge } from "../identity/commerce.js";
import COHORTS from "./cohorts.data.json" with { type: "json" };

export const SUGGESTIONS = 10;
export const ANCHOR_WEIGHT = 0.6;
export const COHORT_PROVENANCE = Object.freeze({
  method: "hand-entered cultural register: who a twelve-year-old in that year, place and background would plausibly have heard on the bus — chart presence and scene, not a survey",
  standard: "a row names an artist, the years they were on the bus, the regions and backgrounds they reached, a genre and the taste tags that scene carries; every suggestion is confirmed or corrected by the passenger before it counts",
  entries: COHORTS.artists.length,
  lastChecked: COHORTS.lastChecked,
});

/** The coarse region of a home town, from its country or its name; "global" when unknown. */
export function regionOf(hometown) {
  if (!hometown) return "global";
  const c = String(hometown.country || "").toLowerCase();
  const n = String(hometown.name || "").toLowerCase();
  const has = (...xs) => xs.some((x) => c.includes(x) || n.includes(x));
  if (has("united states", "usa", "u.s.")) {
    if (has("georgia", "atlanta", "texas", "houston", "dallas", "florida", "miami", "louisiana", "new orleans", "tennessee", "memphis", "nashville", "carolina", "virginia", "maryland", "dc", "washington, dc", "alabama", "mississippi")) return "us-south";
    if (has("new york", "nyc", "brooklyn", "bronx", "queens", "jersey", "philadelphia", "boston", "massachusetts", "connecticut", "pennsylvania")) return "us-northeast";
    if (has("california", "los angeles", "la,", "oakland", "bay area", "san francisco", "seattle", "portland", "arizona", "phoenix", "las vegas", "nevada", "colorado", "denver")) return "us-west";
    if (has("chicago", "illinois", "detroit", "michigan", "ohio", "cleveland", "minnesota", "minneapolis", "wisconsin", "missouri", "st. louis", "kansas", "indiana")) return "us-midwest";
    return "us";
  }
  if (has("united kingdom", "uk", "england", "london", "manchester", "birmingham", "scotland", "glasgow", "wales", "ireland", "dublin")) return "uk";
  if (has("jamaica", "trinidad", "barbados", "bahamas", "haiti", "dominican", "puerto rico", "cuba", "caribbean")) return "caribbean";
  if (has("mexico", "brazil", "brasil", "argentina", "colombia", "chile", "peru", "venezuela")) return "latin-america";
  if (has("nigeria", "lagos", "ghana", "accra", "south africa", "johannesburg", "cape town", "kenya", "nairobi", "senegal", "ethiopia")) return "africa";
  if (has("japan", "tokyo", "korea", "seoul", "china", "shanghai", "beijing", "hong kong", "taiwan")) return "east-asia";
  if (has("india", "mumbai", "delhi", "pakistan", "karachi", "bangladesh", "sri lanka")) return "south-asia";
  if (has("australia", "sydney", "melbourne", "new zealand")) return "australia";
  if (has("france", "paris", "germany", "berlin", "italy", "milan", "spain", "madrid", "netherlands", "amsterdam", "sweden", "stockholm", "czech", "prague", "poland", "portugal", "belgium", "denmark", "norway")) return "europe";
  return "global";
}

/** Ten artists for a cohort: the year first, then the region, then the background; deterministic. */
export function cohortArtists({ year, region = "global", background = null, limit = SUGGESTIONS } = {}) {
  const y = Number(year);
  if (!Number.isFinite(y)) return [];
  const bg = background ? String(background).toLowerCase() : null;
  const scored = COHORTS.artists.map((a) => {
    const inYears = y >= a.years[0] && y <= a.years[1];
    const near = !inYears && (Math.abs(y - a.years[0]) <= 2 || Math.abs(y - a.years[1]) <= 2);
    if (!inYears && !near) return null;
    let score = inYears ? 4 : 1;
    if (a.regions.includes(region)) score += 3;
    else if (a.regions.includes("global") || (region.startsWith("us-") && a.regions.includes("us"))) score += 1;
    if (bg && a.backgrounds.some((b) => b === "any" ? false : bg.includes(b.toLowerCase()))) score += 2;
    return { ...a, score };
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score || a.years[0] - b.years[0] || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ score, ...a }) => ({ ...a, suggested: true }));
}

const ERA_PURCHASES = [
  { to: 1999, items: ["a Walkman or Discman", "a pair of Jordans", "a leather jacket", "a skateboard", "a camera"] },
  { to: 2007, items: ["an iPod", "a pair of Air Force 1s", "a Razr phone", "a varsity jacket", "a mixtape run"] },
  { to: 2014, items: ["an iPhone", "a pair of Yeezys or Jordans", "a Supreme box logo", "a MacBook", "a vintage camera"] },
  { to: 2030, items: ["a pair of Rick Owens or New Balance", "a film camera", "a vintage band tee", "a bike", "a tattoo"] },
];
const ERA_SCREENS = [
  { to: 1999, items: ["Clueless", "The Matrix", "Friends", "Scream", "Boyz n the Hood"] },
  { to: 2007, items: ["Mean Girls", "The O.C.", "Napoleon Dynamite", "Lost", "City of God"] },
  { to: 2014, items: ["Skins", "Breaking Bad", "Mean Girls", "The Hunger Games", "Drive"] },
  { to: 2030, items: ["Euphoria", "Stranger Things", "Parasite", "Succession", "Atlanta"] },
];
const eraList = (table, year) => (table.find((r) => year <= r.to) || table[table.length - 1]).items;

export const QUESTIONS = Object.freeze([
  { id: "bus", kind: "artist", prompt: (c) => `who was 12-year-old you listening to on the bus ride to school${c.yearAt12 ? ` — ${c.yearAt12}` : ""}?`, skippable: true, na: false },
  { id: "breakup", kind: "artist", prompt: () => "who got you through your first serious breakup?", skippable: true, na: true, naLabel: "doesn't apply" },
  { id: "paycheck", kind: "object", prompt: () => "your first big purchase with your first paycheck?", skippable: true, na: false },
  { id: "closet", kind: "piece", prompt: () => "your favorite piece in your closet right now?", skippable: true, na: false },
  { id: "afterschool", kind: "place", prompt: (c) => `the shop or corner you went to after school${c.hometown ? ` in ${c.hometown}` : ""}?`, skippable: true, na: false },
  { id: "screen", kind: "screen", prompt: (c) => `the film or show everyone in your year quoted${c.yearAt15 ? ` — around ${c.yearAt15}` : ""}?`, skippable: true, na: false },
  { id: "sunday", kind: "free", prompt: () => "what was on the table at home on a Sunday?", skippable: true, na: false },
]);

/**
 * The questions for one passenger, in order, each with its prompt filled and
 * its suggestions. `answers` (id → anchor or skip) lets later questions adapt:
 * a bus answer with a genre narrows the breakup suggestions to that scene's
 * neighbours; a hip-hop bus answer leans the screen suggestions that way.
 */
export function questionsFor({ birthDate = null, hometown = null, ethnicity = null, answers = {} } = {}) {
  const yearAt12 = yearAtAge(birthDate, 12), yearAt15 = yearAtAge(birthDate, 15), yearAt18 = yearAtAge(birthDate, 18);
  const region = regionOf(hometown);
  const ctx = { yearAt12, yearAt15, hometown: hometown ? hometown.name : null };
  const busGenre = answers.bus && answers.bus.genre ? answers.bus.genre : null;
  return QUESTIONS.map((q) => {
    let suggestions = [];
    if (q.id === "bus") suggestions = cohortArtists({ year: yearAt12, region, background: ethnicity });
    else if (q.id === "breakup") {
      const pool = cohortArtists({ year: yearAt18 || yearAt15, region, background: ethnicity, limit: 30 });
      suggestions = (busGenre ? [...pool.filter((a) => a.genre === busGenre), ...pool.filter((a) => a.genre !== busGenre)] : pool).slice(0, SUGGESTIONS);
    } else if (q.id === "paycheck") suggestions = (yearAt18 ? eraList(ERA_PURCHASES, yearAt18) : ERA_PURCHASES[ERA_PURCHASES.length - 1].items).map((name) => ({ name, suggested: true }));
    else if (q.id === "screen") suggestions = (yearAt15 ? eraList(ERA_SCREENS, yearAt15) : ERA_SCREENS[ERA_SCREENS.length - 1].items).map((name) => ({ name, suggested: true }));
    const a = answers[q.id] || null;
    return { id: q.id, kind: q.kind, prompt: q.prompt(ctx), skippable: q.skippable, na: q.na, naLabel: q.naLabel || null, suggestions, answer: a && !a.skipped ? a : null, skipped: !!(a && a.skipped), suggestionsFrom: q.kind === "artist" ? "cohort register" : suggestions.length ? "era" : "free text" };
  });
}

/** Progress: answered, skipped, remaining; done when nothing remains (every question answered or skipped). */
export function progress(questions = []) {
  const answered = questions.filter((q) => q.answer).length;
  const skipped = questions.filter((q) => q.skipped).length;
  return { answered, skipped, remaining: questions.length - answered - skipped, total: questions.length, done: answered + skipped >= questions.length, minutes: 5 };
}

/** The tags an answer carries: a register artist's own tags, else the lexicon's reading of the words. Never empty-handed: an unreadable answer still anchors its words. */
export function tagsForAnswer({ text = "", suggestion = null } = {}) {
  const out = {};
  if (suggestion && suggestion.tags) for (const t of suggestion.tags) out[String(t).toUpperCase()] = ANCHOR_WEIGHT;
  const words = String(text || "").toLowerCase().split(/[^a-z0-9&'-]+/).filter(Boolean);
  for (const w of words) {
    const v = lexiconVector(w);
    for (const [t, wgt] of Object.entries(v || {})) out[t] = Math.max(out[t] || 0, Math.min(1, Number(wgt) * ANCHOR_WEIGHT));
  }
  // the whole phrase too (two-word lexicon keys)
  for (let i = 0; i + 1 < words.length; i++) {
    const v = lexiconVector(words[i] + " " + words[i + 1]);
    for (const [t, wgt] of Object.entries(v || {})) out[t] = Math.max(out[t] || 0, Math.min(1, Number(wgt) * ANCHOR_WEIGHT));
  }
  return out;
}

/** An anchor from an answer (14.3): the passenger's words, the tags, the provenance; `na` is a real answer ("doesn't apply") that anchors nothing. */
export function anchorFromAnswer({ questionId, text = "", suggestion = null, na = false, now = Date.now() } = {}) {
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q) return { ok: false, reason: "not one of the Passport's questions" };
  if (na) {
    if (!q.na) return { ok: false, reason: "that question has no \"doesn't apply\"" };
    return { ok: true, anchor: { questionId, text: null, na: true, tags: {}, genre: null, suggested: false, designatedAt: new Date(now).toISOString() } };
  }
  const t = String(text || "").trim().slice(0, 160);
  if (!t) return { ok: false, reason: "an answer needs words — or skip the question" };
  // the register's own row carries the tags; a bare { name } from the client is a pointer, not the row
  const inRegister = COHORTS.artists.find((a) => a.name.toLowerCase() === t.toLowerCase()) || null;
  const hit = suggestion && suggestion.name && suggestion.name.toLowerCase() === t.toLowerCase() && suggestion.tags ? suggestion : null;
  const register = inRegister || hit;
  return { ok: true, anchor: { questionId, text: t, na: false, tags: tagsForAnswer({ text: t, suggestion: register }), genre: register ? register.genre : null, suggested: !!register, designatedAt: new Date(now).toISOString() } };
}

/** The manual (explicit) tag map from a set of anchors: the max weight per tag; what the profile's _meta.manual carries. */
export function manualFromAnchors(anchors = []) {
  const out = {};
  for (const a of anchors) for (const [t, w] of Object.entries(a && a.tags ? a.tags : {})) out[t] = Math.max(out[t] || 0, Number(w) || 0);
  return out;
}
