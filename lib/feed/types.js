// lib/feed/types.js — THE ONE FEED's card law (V.2 Blueprint, owner, 17 Oct
// 2026, Foundations: "one surface for discovery, publishing and commerce.
// There is no Wire"; "Screen map — FEED"; "Tetris packing"). Pure and
// isomorphic: the feed page and the tests read it, the server never needs
// it.
//
// THE TYPES. Every card in the Feed is one of eight: the six publishing
// types TRANSM · STILL · MOTION · BRDCST · LISTING · ECHO and the two
// discovery cards PLACE and SONG. A wire post derives its type from what
// it carries (lib/wire/compose.js kinds: transmission / post / video, the
// event attachment, the echo mark); a catalog piece is a LISTING; a row of
// the places record is a PLACE. SONG waits for a music catalog (owner
// decision, music APIs) and is never invented.
//
// TETRIS PACKING. Visual weight targets from the blueprint: MOTION and
// STILL about 70%, media plus BRDCST 75%, LISTING 45%, PLACE and SONG 20%,
// standalone BRDCST 10%. The packer turns the weight into a span: a card
// at or above FULL_AT takes the whole width and breaks the columns; a
// lighter card takes one column; the lightest keep their column but stay
// short (the component draws them compact). "No accidental gap larger
// than the side border" is the columns' job (lib/feed/rechunk.js
// placeInColumns balances by height); the span decides what the columns
// are asked to balance.
//
// ECHO. A story-style temporary post: 24 hours by default (blueprint 1709:
// "24 hours is the provisional default"), never shown live after expiry
// (Terms 5.4).

export const TYPES = Object.freeze(["TRANSM", "STILL", "MOTION", "BRDCST", "LISTING", "ECHO", "PLACE", "SONG"]);

export const WEIGHT = Object.freeze({
  MOTION: 0.7,
  STILL: 0.7,
  "MEDIA+BRDCST": 0.75,
  LISTING: 0.45,
  PLACE: 0.2,
  SONG: 0.2,
  BRDCST: 0.1,
  TRANSM: 0.3,
  ECHO: 0.2,
});

export const FULL_AT = 0.7;
export const ECHO_TTL_MS = 24 * 60 * 60 * 1000;

/** The post's type from what it carries. */
export function postType(post) {
  if (!post || typeof post !== "object") return "TRANSM";
  const a = post.attachments && typeof post.attachments === "object" ? post.attachments : {};
  if (a.echo) return "ECHO";
  if (post.postKind === "video" || a.video || (post.sample && post.video)) return "MOTION";
  const media = Array.isArray(a.media) ? a.media.length : 0;
  const hasImage = media > 0 || !!post.imageUrl || !!post.image;
  if (a.event && !hasImage) return "BRDCST";
  if (hasImage) return "STILL";
  return "TRANSM";
}

/** The weight a card asks for in the packing. A STILL that carries a
 *  BRDCST is the heaviest card there is (media plus BRDCST, 75%). */
export function weightOf(card) {
  if (!card) return WEIGHT.TRANSM;
  if (card.__post) {
    const t = postType(card.__post);
    const a = card.__post.attachments || {};
    if ((t === "STILL" || t === "MOTION") && a.event) return WEIGHT["MEDIA+BRDCST"];
    return WEIGHT[t];
  }
  if (card.__place) return WEIGHT.PLACE;
  if (card.__song) return WEIGHT.SONG;
  return WEIGHT.LISTING;
}

/** The span: "full" breaks the columns, "column" takes one, "compact" takes
 *  one and stays short. */
export function spanOf(card) {
  const w = weightOf(card);
  if (w >= FULL_AT) return "full";
  if (w <= 0.2) return "compact";
  return "column";
}

/** Tetris-pack a flat list into segments the page renders in order: a run
 *  of column cards becomes one masonry segment; a full-width card stands
 *  alone. A standalone BRDCST (10%) is full width but thin, so it is its
 *  own "strip" segment. */
export const MIN_RUN = 6;
export function packFeed(list) {
  const out = [];
  let run = [];
  let waiting = []; // full-width and strip cards held until the columns have a run behind them
  const flush = () => { if (run.length) { out.push({ kind: "grid", items: run }); run = []; } };
  const release = () => { for (const w of waiting) out.push(w); waiting = []; };
  for (const card of list || []) {
    const span = spanOf(card);
    const t = card && card.__post ? postType(card.__post) : null;
    // "No accidental gap larger than the side border": a full-width card that
    // broke the columns every three pieces left a card-sized hole beside a
    // lone column card (seen 18 Oct). A full card now waits until the run
    // behind it holds MIN_RUN column cards — enough for two or three columns
    // to balance — then the run flushes and the waiting cards follow in order.
    if (t === "BRDCST") { waiting.push({ kind: "strip", item: card }); }
    else if (span === "full") { waiting.push({ kind: "full", item: card }); }
    else run.push(card);
    if (waiting.length && run.length >= MIN_RUN) { flush(); release(); }
  }
  flush();
  release();
  return out;
}

/** Whether an ECHO is still live at `now`. A post without the echo mark
 *  is not an echo and this answers false. */
export function echoLive(post, now = Date.now()) {
  const e = post && post.attachments && post.attachments.echo;
  if (!e) return false;
  const until = Number(e.expiresAt);
  return Number.isFinite(until) && until > now;
}

/** The ECHO rail: live echoes grouped by author, most recent first within
 *  an author, authors ordered by their latest echo. */
export function echoRail(posts, now = Date.now()) {
  const by = new Map();
  for (const p of posts || []) {
    if (!echoLive(p, now)) continue;
    const key = p.handle || p.name || "?";
    if (!by.has(key)) by.set(key, { handle: key, name: p.name || key, echoes: [] });
    by.get(key).echoes.push(p);
  }
  const groups = [...by.values()];
  for (const g of groups) g.echoes.sort((a, b) => (b.at || 0) - (a.at || 0));
  groups.sort((a, b) => (b.echoes[0].at || 0) - (a.echoes[0].at || 0));
  return groups;
}

/** Braid posts into the pieces: one post after every third piece, the way
 *  the stream did, then the places at a lower rate (one after every
 *  ninth), so discovery cards stay the 20% weight the blueprint gives
 *  them. Echoes are not braided: they live on the rail. */
export function braid(pieces, posts, places = []) {
  const out = [];
  let pi = 0, qi = 0;
  const livePosts = (posts || []).filter((p) => postType(p) !== "ECHO");
  (pieces || []).forEach((it, i) => {
    out.push(it);
    if ((i + 1) % 3 === 0 && livePosts[pi]) { const x = livePosts[pi++]; out.push({ id: "post:" + (x.serverId ?? x.id), __post: x }); }
    if ((i + 1) % 9 === 0 && places[qi]) { const pl = places[qi++]; out.push({ id: "place:" + pl.id, __place: pl }); }
  });
  if ((pieces || []).length < 3) {
    for (const x of livePosts.slice(pi, pi + 2)) out.push({ id: "post:" + (x.serverId ?? x.id), __post: x });
    for (const pl of places.slice(qi, qi + 1)) out.push({ id: "place:" + pl.id, __place: pl });
  }
  return out;
}

// ---- the owner's 18 Oct references (slice 14) -----------------------------
// docs/v2/references/2026-10-18-feed/2.jpg–5.jpg are the Feed's layout rules:
// the BRDCST footer reads "BRDCST · OCTOBER 31st 10:30 pm · rule · *event ·
// chevron"; the piece popup reads "unverified / ♡ OFFER bag / brand: title /
// SIZE / 35.00 USD". These are the pure readings the components print.

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const ordinal = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? "th" : d % 10 === 1 ? "st" : d % 10 === 2 ? "nd" : d % 10 === 3 ? "rd" : "th");

/** One moment as the footer prints it: "OCTOBER 31st", with "10:30 pm" when
 *  the record carries a time. A date-only string ("2026-10-31") is read by
 *  its parts, never through the clock, so it does not drift a day by time
 *  zone; a full ISO instant is printed in the event's own zone (`tz`), or
 *  UTC when it names none. Unreadable → "". */
export function brdcstMoment(value, { tz = null } = {}) {
  if (!value) return "";
  const s = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const m = Number(dateOnly[2]), d = Number(dateOnly[3]);
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return "";
    return `${MONTHS[m - 1]} ${ordinal(d)}`;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(t));
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(t));
  }
  const get = (k) => (parts.find((p) => p.type === k) || {}).value || "";
  const m = Number(get("month")), d = Number(get("day"));
  const period = get("dayPeriod").toLowerCase().replace(/\./g, "");
  return `${MONTHS[m - 1]} ${ordinal(d)} ${get("hour")}:${get("minute")} ${period}`.trim();
}

/** The footer's date line for an event: the start, then "→ the end" when
 *  the end is a different moment. */
export function brdcstWhen(event) {
  if (!event) return "";
  const a = brdcstMoment(event.startsAt, { tz: event.tz });
  const b = event.endsAt && event.endsAt !== event.startsAt ? brdcstMoment(event.endsAt, { tz: event.tz }) : "";
  return b ? `${a} → ${b}` : a;
}

/** "Brand: title", as the reference prints it — a title that already begins
 *  with the brand (a demo record: "Visvim – chore coat") is not doubled. */
export function pieceName(item) {
  if (!item) return "";
  const brand = String(item.brand || "").trim(), title = String(item.title || "").trim();
  if (!brand) return title;
  if (!title) return brand;
  const rest = title.toLowerCase().startsWith(brand.toLowerCase()) ? title.slice(brand.length).replace(/^[\s:–—-]+/, "") : title;
  return rest ? `${brand}: ${rest}` : brand;
}

/** The piece popup's price line: "35.00 USD" — two decimals, the currency
 *  after. Null when the record carries no price. */
export function priceLine(item) {
  if (!item || item.price == null || item.price === "") return null;
  const n = Number(item.price);
  if (!Number.isFinite(n)) return `${item.price} ${item.currency || "USD"}`;
  return `${n.toFixed(2)} ${item.currency || "USD"}`;
}

/** What OFFER does on this piece (reference 5.jpg): "native" is the Storefront
 *  offer (slice 6); "wardrobe" is the DM-first Wardrobe offer (chapter 13,
 *  slice 11) on a piece whose owner takes offers; "none" leaves the word
 *  quiet — never a dead button — with the reason it is quiet. */
export function offerMode(item) {
  if (!item) return { mode: "none", reason: "no piece" };
  if (item.commerce_rail === "native") return { mode: "native", reason: "a 24-hour offer to the Storefront seller" };
  if (item.acceptOffers === true && item.ownerId) return { mode: "wardrobe", reason: "an offer starts with a message to the owner (13.4)" };
  if (item.acceptOffers === false && item.ownerId) return { mode: "none", reason: "the owner is not taking Wardrobe offers" };
  return { mode: "none", reason: "an external listing is bought at its source — OFFER is for native and Wardrobe pieces" };
}
