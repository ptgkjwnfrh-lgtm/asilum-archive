// lib/places/registry.js — THE LOCAL AND GLOBAL FASHION MAP's record (V.2).
//
// A curated reference table in the same class as lib/asterisk/houses.js and
// lib/asterisk/places.js: hand-entered, provenance stated, holes reported
// rather than filled. Two rows are REAL and link to their own source; every
// other row is a plainly labelled SAMPLE fixture (sample: true) that exists
// so the map, the filters and the cards can be exercised before a directory
// exists. A sample never claims a venue, a date or a ticket — its card says
// "fictional fixture" and its pin is dashed.
//
// Every row carries the provenance the brief demands of a place or event:
// name, kind, organizer, public address, coordinates, timezone, dates,
// admission, price, official source, image status, last-checked, a
// correction path, and a status. Permanent PLACES (shops) and dated EVENTS
// are different rows, told apart by `dated`.
//
// Isomorphic: plain data + pure functions, safe in the client bundle.

export const PLACES_PROVENANCE = Object.freeze({
  compiledOn: "2026-09-17",
  method: "hand-entered; three sourced rows, the rest labelled fixtures",
  standard: "a row with sample:true is fictional and says so on every surface; a row without it links to its own official source and carries a lastChecked date",
  correction: "corrections are recorded through the Studio's correction request (device-local until the desk is staffed)",
});

export const PLACE_KINDS = Object.freeze([
  "runway", "pop-up", "consignment", "thrift", "shop", "exhibition", "creator",
]);

export const PLACE_STATUSES = Object.freeze([
  "upcoming", "invitation-only", "rsvp-required", "sold-out", "postponed", "canceled", "ended", "open",
]);

// Base cities the location control offers. Coordinates are city centres to
// about 0.01°, which is all a base city needs; nothing finer is ever stored.
export const CITIES = Object.freeze({
  "Bowie, Maryland": { lat: 38.9428, lng: -76.7302, country: "United States", region: "DMV", tz: "America/New_York" },
  "Washington, DC": { lat: 38.9072, lng: -77.0369, country: "United States", region: "DMV", tz: "America/New_York" },
  "New York": { lat: 40.7128, lng: -74.006, country: "United States", region: "New York", tz: "America/New_York" },
  "Los Angeles": { lat: 34.0522, lng: -118.2437, country: "United States", region: "Los Angeles", tz: "America/Los_Angeles" },
  "London": { lat: 51.5072, lng: -0.1276, country: "United Kingdom", region: "London", tz: "Europe/London" },
  "Paris": { lat: 48.8566, lng: 2.3522, country: "France", region: "Paris", tz: "Europe/Paris" },
  "Tokyo": { lat: 35.6762, lng: 139.6503, country: "Japan", region: "Tokyo", tz: "Asia/Tokyo" },
  "Seoul": { lat: 37.5665, lng: 126.978, country: "South Korea", region: "Seoul", tz: "Asia/Seoul" },
});

export const PLACES = Object.freeze([
  {
    id: "pgc-fashion-week-2026",
    kind: "runway", dated: true, sample: false,
    name: "Prince George’s County Fashion Week",
    organizer: "Prince George’s County Economic Development Corporation (listing)",
    city: "New Carrollton, Maryland", region: "DMV", country: "United States",
    address: "Metro Points Hotel · 8500 Annapolis Road, New Carrollton, MD",
    lat: 38.9605, lng: -76.8701, tz: "America/New_York",
    startsAt: "2026-09-23", endsAt: "2026-09-25",
    admission: "see organizer", price: null,
    sourceUrl: "https://www.pgcedc.com/events-calendar/2026/8/24/prince-georges-county-fashion-week",
    imageStatus: "none — no authorized image",
    lastChecked: "2026-09-17",
    status: "upcoming",
    note: "A public listing. ASILUM has no partnership, sponsorship or access here; the pin is the venue's public address.",
    tags: ["INDEPENDENT", "STATEMENT"],
  },
  {
    id: "pfw-menswear-fw-2027",
    kind: "runway", dated: true, sample: false,
    name: "Paris Fashion Week® Menswear Fall/Winter 2027-2028",
    organizer: "FHCM — Fédération de la Haute Couture et de la Mode (official calendar)",
    city: "Paris", region: "Paris", country: "France",
    address: "venues across Paris — the official calendar names each show's",
    lat: 48.8566, lng: 2.3522, tz: "Europe/Paris",
    startsAt: "2027-01-19", endsAt: "2027-01-24",
    admission: "by invitation — the calendar is public", price: null,
    sourceUrl: "https://www.fhcm.paris/en/next-dates",
    imageStatus: "none — no authorized image",
    lastChecked: "2026-10-17",
    status: "upcoming",
    note: "The federation's published dates (\"Menswear Fall/Winter 2027-2028 from Tuesday, January 19th to Sunday, January 24th 2027\"). ASILUM has no partnership, sponsorship or access here; the pin is the city, the venues are the calendar's.",
    tags: ["TAILORED", "STATEMENT"],
  },
  {
    id: "palais-galliera",
    kind: "exhibition", dated: false, sample: false,
    name: "Palais Galliera",
    organizer: "Paris Musées",
    city: "Paris", region: "Paris", country: "France",
    address: "10 avenue Pierre 1er de Serbie · 75116 Paris",
    lat: 48.8656, lng: 2.2967, tz: "Europe/Paris",
    startsAt: null, endsAt: null,
    admission: "see museum", price: null,
    sourceUrl: "https://www.palaisgalliera.paris.fr/en",
    imageStatus: "none — no authorized image",
    lastChecked: "2026-09-17",
    status: "open",
    note: "The city of Paris's fashion museum. A venue record, not a booking.",
    tags: ["ARCHIVAL", "TAILORED"],
  },
  {
    id: "sample-sunday-archive",
    kind: "pop-up", dated: true, sample: true,
    name: "The Sunday Archive",
    organizer: "fictional fixture",
    city: "Hyattsville, Maryland", region: "DMV", country: "United States",
    address: "Hyattsville area · illustrative location",
    lat: 38.943, lng: -76.942, tz: "America/New_York",
    startsAt: "2026-09-27", endsAt: "2026-09-27",
    admission: "free", price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "upcoming",
    note: "A fictional independent designer pop-up showing how an event would appear near a base city. No real event, venue or tickets.",
    tags: ["ARCHIVAL", "INDEPENDENT"],
  },
  {
    id: "sample-second-life-studio",
    kind: "consignment", dated: false, sample: true,
    name: "Second Life Studio",
    organizer: "fictional fixture",
    city: "Bowie, Maryland", region: "DMV", country: "United States",
    address: "Bowie area · illustrative location",
    lat: 38.927, lng: -76.81, tz: "America/New_York",
    startsAt: null, endsAt: null, admission: null, price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "open",
    note: "A fictional consignment store used to demonstrate the local directory. Do not travel to this pin.",
    tags: ["ARCHIVAL", "MINIMAL"],
  },
  {
    id: "sample-rewear-library",
    kind: "thrift", dated: false, sample: true,
    name: "The Rewear Library",
    organizer: "fictional fixture",
    city: "Washington, DC", region: "DMV", country: "United States",
    address: "Washington area · illustrative location",
    lat: 38.905, lng: -77.024, tz: "America/New_York",
    startsAt: null, endsAt: null, admission: null, price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "open",
    note: "A sample thrift listing. A production directory verifies the address and source before publication.",
    tags: ["STREETWEAR", "UTILITARIAN"],
  },
  {
    id: "sample-last-lace",
    kind: "shop", dated: false, sample: true,
    name: "Last Lace Footwear",
    organizer: "fictional fixture",
    city: "College Park, Maryland", region: "DMV", country: "United States",
    address: "College Park area · illustrative location",
    lat: 38.9897, lng: -76.9378, tz: "America/New_York",
    startsAt: null, endsAt: null, admission: null, price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "open",
    note: "A sample footwear shop so the KIND filter has something to filter. Fictional.",
    tags: ["GORP", "STREETWEAR"],
  },
  {
    id: "sample-independent-forms",
    kind: "pop-up", dated: true, sample: true,
    name: "Independent Forms",
    organizer: "fictional fixture",
    city: "New York", region: "New York", country: "United States",
    address: "Lower Manhattan · illustrative location",
    lat: 40.721, lng: -73.999, tz: "America/New_York",
    startsAt: "2026-10-03", endsAt: "2026-10-04",
    admission: "rsvp", price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "rsvp-required",
    note: "A sample international pop-up to demonstrate discovery across cities. No actual event is advertised.",
    tags: ["INDEPENDENT", "AVANT-GARDE"],
  },
  {
    id: "sample-tokyo-archive-room",
    kind: "consignment", dated: false, sample: true,
    name: "Tokyo Archive Room",
    organizer: "fictional fixture",
    city: "Tokyo", region: "Tokyo", country: "Japan",
    address: "Harajuku area · illustrative location",
    lat: 35.668, lng: 139.705, tz: "Asia/Tokyo",
    startsAt: null, endsAt: null, admission: null, price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "open",
    note: "A fictional archive store demonstrating global map browsing. Do not travel to this pin.",
    tags: ["ARCHIVAL", "STREETWEAR"],
  },
  {
    id: "sample-studio-noor",
    kind: "creator", dated: false, sample: true,
    name: "Studio Noor",
    organizer: "fictional fixture",
    city: "New York", region: "New York", country: "United States",
    address: "Manhattan, New York · city area only",
    lat: 40.748, lng: -73.985, tz: "America/New_York",
    startsAt: null, endsAt: null, admission: null, price: null,
    sourceUrl: null, imageStatus: "none", lastChecked: "2026-09-17",
    status: "open",
    note: "A fictional creator who opted to share a general city area. A creator pin is a coarse city-area marker by consent — never live movement, a home or a street.",
    tags: ["MINIMAL", "TAILORED"],
  },
]);

const R = 6371;
export function distanceKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Filter the register. Every argument optional; `near` = {lat,lng,km}. */
export function listPlaces({ kind = null, dated = null, sample = null, region = null, near = null, from = null } = {}) {
  let rows = PLACES.slice();
  if (kind) rows = rows.filter((p) => p.kind === kind);
  if (dated !== null) rows = rows.filter((p) => !!p.dated === !!dated);
  if (sample !== null) rows = rows.filter((p) => !!p.sample === !!sample);
  if (region) rows = rows.filter((p) => p.region === region);
  if (from) rows = rows.filter((p) => !p.dated || !p.endsAt || p.endsAt >= from);
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    const km = Number.isFinite(near.km) ? near.km : 50;
    rows = rows
      .map((p) => ({ ...p, distanceKm: +distanceKm(near, p).toFixed(1) }))
      .filter((p) => p.distanceKm <= km)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
  return rows;
}

/** The coverage report the steward's instruments expect of a curated table:
 *  how many rows are sourced, how many are fixtures, which fields are holes. */
export function placesCoverage() {
  const sourced = PLACES.filter((p) => !p.sample);
  const holes = [];
  for (const p of PLACES) {
    if (!p.sample && !p.sourceUrl) holes.push(p.id + ": no source");
    if (!p.sample && !p.lastChecked) holes.push(p.id + ": never checked");
    if (!PLACE_KINDS.includes(p.kind)) holes.push(p.id + ": unknown kind " + p.kind);
    if (!PLACE_STATUSES.includes(p.status)) holes.push(p.id + ": unknown status " + p.status);
  }
  return { total: PLACES.length, sourced: sourced.length, fixtures: PLACES.length - sourced.length, holes };
}

// ---- the place card and the map popup (owner's references, 18 Oct 2026) ----

/** A public maps link for the place's own coordinates — a plain external
 *  link (MAPS ↗), no partnership, no key. Null without coordinates. */
export function mapsUrl(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  const q = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** The rating a surface may draw: ONLY when the record carries one from a
 *  named source with a count and a link — a figure without a source is
 *  never printed (the reference's "4.6 (24K)" is the slot, not a value).
 *  Null otherwise; no row in PLACES carries one today. */
export function placeRating(place) {
  const r = place && place.rating;
  if (!r || typeof r !== "object") return null;
  const value = Number(r.value), count = Number(r.count);
  if (!Number.isFinite(value) || value < 0 || value > 5) return null;
  if (!Number.isInteger(count) || count < 1) return null;
  if (!r.source || typeof r.source !== "string" || !/^https?:\/\//.test(String(r.url || ""))) return null;
  return { value: Math.round(value * 10) / 10, count, source: r.source, url: r.url };
}

/** "305 mi" — a whole number of miles, "under a mile" below one. */
export function milesLabel(mi) {
  if (!Number.isFinite(mi) || mi < 0) return "";
  return mi < 1 ? "under a mile" : `${Math.round(mi)} mi`;
}
