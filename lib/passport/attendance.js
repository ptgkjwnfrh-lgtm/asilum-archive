// lib/passport/attendance.js — SUBSTANTIATED ATTENDANCE (V.2 Blueprint, owner,
// 17 Oct 2026: 17.19 — "I was there" is a claim until evidence on record
// substantiates it; slice 12). PURE and client-safe.
//
//   THE CLAIM        a passenger says they attended a dated place from the
//                    registry (lib/places/registry.js). The claim is stored
//                    as a user record (kind "attendance", one per place) and
//                    reads CLAIMED until evidence supports it.
//   THE EVIDENCE     only what ASILUM already holds about this passenger:
//                      area     their coarse area during the event's window,
//                               within ATTEND_RADIUS_MI of the place
//                      upload   a Passport upload made during the window whose
//                               caption names the event or its city
//                      post     their own post during the window carrying the
//                               event as an attachment
//                    An attendance is SUBSTANTIATED by any one of these. No
//                    evidence → claimed, said plainly; nothing is inferred.
//   THE WINDOW       the event's dates with a day of slack either side — the
//                    registry dates are calendar days, not instants.
//   NEVER            a badge from a friend's word, a purchase of a ticket
//                    ASILUM did not sell, or a model's guess.

import { distanceMi } from "../brdcst/index.js";
import { DAY } from "../storefront/protection.js"; // one day — imported, not copied

export const ATTEND_RADIUS_MI = 30;
export const EVIDENCE_KINDS = Object.freeze(["area", "upload", "post"]);
export const ATTENDANCE_STATES = Object.freeze(["claimed", "substantiated"]);

/** The event's window as epoch ms: [start − 1 day, end + 1 day]. Null for an undated place. */
export function windowOf(place) {
  if (!place || !place.startsAt) return null;
  const start = Date.parse(place.startsAt + "T00:00:00Z");
  const end = Date.parse((place.endsAt || place.startsAt) + "T23:59:59Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: start - DAY, end: end + DAY };
}

const inWindow = (w, t) => !!w && Number.isFinite(t) && t >= w.start && t <= w.end;
const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);

/** Does a caption name the event? Two of the event's name words, or its city. */
export function captionNames(place, caption) {
  const c = words(caption);
  if (!c.length) return false;
  const city = place.city ? String(place.city).toLowerCase() : null;
  if (city && c.includes(city)) return true;
  const name = words(place.name).filter((x) => !["the", "and", "week", "fall", "winter", "spring", "summer"].includes(x));
  const hits = name.filter((x) => c.includes(x)).length;
  return hits >= Math.min(2, name.length);
}

/**
 * Evaluate a claim against what is on record.
 *   area:    { lat, lng, at } | null       (the passenger's coarse area read)
 *   uploads: [{ id, caption, createdAt }]
 *   posts:   [{ id, createdAt, attachments }]
 * Returns { status, evidence: [{ kind, ref, at, note }], reason }.
 */
export function substantiate({ place, area = null, uploads = [], posts = [] } = {}) {
  const w = windowOf(place);
  if (!place) return { status: "claimed", evidence: [], reason: "no such place on record" };
  if (!w) return { status: "claimed", evidence: [], reason: "an undated place cannot substantiate attendance" };
  const evidence = [];
  if (area && Number.isFinite(Number(area.lat)) && Number.isFinite(Number(area.lng))) {
    const at = typeof area.at === "number" ? area.at : Date.parse(area.at);
    const d = distanceMi({ lat: Number(area.lat), lng: Number(area.lng) }, { lat: place.lat, lng: place.lng });
    if (inWindow(w, at) && Number.isFinite(d) && d <= ATTEND_RADIUS_MI) evidence.push({ kind: "area", ref: null, at: new Date(at).toISOString(), note: `your area was ${Math.round(d)} mi from ${place.city || place.name} during the event` });
  }
  for (const u of uploads || []) {
    const at = typeof u.createdAt === "number" ? u.createdAt : Date.parse(u.createdAt || u.created_at);
    if (inWindow(w, at) && captionNames(place, u.caption)) evidence.push({ kind: "upload", ref: String(u.id), at: new Date(at).toISOString(), note: "a Passport upload captioned at the event, made during it" });
  }
  for (const p of posts || []) {
    const at = typeof p.createdAt === "number" ? p.createdAt : Date.parse(p.createdAt || p.created_at);
    const ev = p.attachments && p.attachments.event;
    const ids = [ev && ev.id, ...((p.attachments && Array.isArray(p.attachments.events) ? p.attachments.events : []).map((e) => e && e.id))].filter(Boolean);
    if (inWindow(w, at) && ids.includes(place.id)) evidence.push({ kind: "post", ref: String(p.id), at: new Date(at).toISOString(), note: "your own post during the event carried it" });
  }
  return { status: evidence.length ? "substantiated" : "claimed", evidence, reason: evidence.length ? null : "no evidence on record yet — an area read during the event, an upload captioned at it, or a post carrying it would substantiate this" };
}

/** The record payload for one attendance. */
export function attendanceRecord({ place, result, claimedAt = Date.now() } = {}) {
  return { eventId: place.id, name: place.name, city: place.city || null, startsAt: place.startsAt || null, endsAt: place.endsAt || null, claimedAt: new Date(claimedAt).toISOString(), status: result.status, evidence: result.evidence, reason: result.reason };
}

/** What a reader sees: the word and the count, never the evidence itself (the evidence is the passenger's). */
export function attendanceLine(record) {
  if (!record) return null;
  return record.status === "substantiated" ? `WENT · ${record.name} · substantiated` : `WENT · ${record.name} · claimed`;
}

export function attendanceSummary(records = []) {
  const s = { total: records.length, substantiated: 0, claimed: 0 };
  for (const r of records) { if (r.status === "substantiated") s.substantiated += 1; else s.claimed += 1; }
  return s;
}
