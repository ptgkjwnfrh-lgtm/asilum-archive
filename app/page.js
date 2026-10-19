"use client";

// app/page.js — CATALOG (home).
// Straight clothing (owner order, Aug 12; POST folded into THE WIRE at
// /hotlist by the Aug 13 overhaul — all user posts live there now):
// mode row, one collapsed craving line, filters, then the masonry
// immediately. Cards stay minimal — name, price, fit estimate,
// FAVORITE / ADD TO BAG — everything else lives in the detail view.
// First visit offers a buyer-history scan; the brain underneath is
// unchanged: dwell, skips, zones, graph, rotation.

import { useEffect, useState, useCallback, useRef } from "react";
import Notice from "./components/Notice.jsx";
import { useOverlayDismiss } from "./components/dismiss.js";
import { fitPhrase } from "../lib/brain/sizing.js";
import { planRechunk, idsBelowFold, applyRechunk, placeInColumns, RECHUNK_AFTER, SERVE_RING_MAX, MAX_RENDERED, CHUNK, CHUNK_MIN } from "../lib/feed/rechunk.js";
import {
  getUid, postJSON, authorizedFetch, thumbFor,
  fitProfileForBrain, brainEnabled, claimRequest, watchRequest, aspectFor, beaconJSON } from "../lib/client.js";
import {
  observationOn, followedBrands, isDemoItem, DEMO_LABEL,
} from "../lib/social.js";
import { OriginSticker, useFitProfile } from "./components/ProductSignals.jsx";
import { openSheet } from "../lib/dockstate.js";
import { braid, packFeed, echoRail, pieceName } from "../lib/feed/types.js";
import { PIECE_EVENT } from "../lib/feed/actions.js";
import { EchoRail } from "./components/EchoRail.jsx";
import PlaceCard from "./components/PlaceCard.jsx";
import PageMast from "./components/PageMast.jsx";
import Wordmark from "./components/Wordmark.jsx";
import PostCard from "./components/PostCard.jsx";
import PieceFloat from "./components/PieceFloat.jsx";
import { createPortal } from "react-dom";
import TagRow from "./components/TagChip.jsx";
import { STOREFRONT_CATEGORIES } from "../lib/storefront/contracts.js";
import { tagsFor, visibleTags } from "../lib/tagging/grammar.js";
import { SAMPLE_POSTS } from "../lib/model/media.js";
import { saveView, readView, restoreAnchor, newAbove, currentAnchor, settleAnchor } from "../lib/viewstate.js";
import { fetchPosts, fetchEngagement, toggleEngagement, fetchPost } from "../lib/social.js";

const DWELL_FLUSH_MS = 5000;
const DWELL_MIN_MS = 2000;
// (6 Sep) the feed is served in CHUNKS. The first load fills the folio; every
// chunk after it is smaller so the ranking re-reads the taste sooner, and the
// catalog lane inside each chunk continues from the server's cursor.

// After RECHUNK_AFTER deliberate actions (favourite, bag, share, skip, hide)
// the cards the reader has not reached — below the fold, never examined — are
// regenerated from the taste as it now stands (lib/feed/rechunk.js).
// A card within one full screen below the viewport counts as reached: a card
// the reader was just looking at, or is about to, must never be the one a
// re-chunk replaces (the examined set alone cannot promise that — a card that
// was only half visible is never marked examined).
const RECHUNK_FOLD_MARGIN = () => (typeof window === "undefined" ? 900 : window.innerHeight);

// The departments the filter offers: the garment catalog's eight, then the
// native Storefront's categories (slice 6) — a jewelry or furniture listing
// is filterable where it lives, in the one Feed.
const CATEGORIES = ["tops", "bottoms", "outerwear", "tailoring", "dresses", "knitwear", "footwear", "accessories",
  ...STOREFRONT_CATEGORIES.map((c) => c.id).filter((c) => c !== "clothing")];
const PLATFORMS = ["ebay", "pinterest", "shopify"];



// (Removed Aug 12 at the owner's word — "get rid of a lot of the excess
// header stuff": the FollowMorse strip, THE SLIDE, LIVE OBSERVATION, and
// WHO TO FOLLOW cubes no longer ride above the racks. The observation
// PRIVACY GATE inside the dwell flusher below is separate and stays.)

// The catalog's hairline field (magazine treatment, owner order Aug 13):

export default function Home() {
  const [epsilon, setEpsilon] = useState(false);
  const [epsilonAuto, setEpsilonAuto] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [guideOn, setGuideOn] = useState(true);
  const fit = useFitProfile();
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ category: "", maxPrice: "", fitsMe: false });
  const [cravingDraft, setCravingDraft] = useState({ text: "", occasion: "", mood: "", novelty: "discovery" });
  const [craving, setCraving] = useState({ text: "", occasion: "", mood: "", novelty: "discovery" });
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectNote, setConnectNote] = useState("");
  const [connecting, setConnecting] = useState("");
  const [tab, setTab] = useState("curated");       // catalog mode: curated | following | new
  const [tabItems, setTabItems] = useState(null);  // following / what's-new items
  const [cravingOpen, setCravingOpen] = useState(false);
  const [stamp, setStamp] = useState("");
  const promptRef = useRef("");
  const boardParamRef = useRef("");
  const uidRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const feedGenRef = useRef(0);
  const sentinelRef = useRef(null);

  const fitBrain = fitProfileForBrain(fit);

  // The folio's edition date — set on mount like the cover's masthead.
  useEffect(() => {
    setStamp(new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).toUpperCase());
  }, []);

  // ---- Dwell tracking ----
  const dwellRef = useRef({ vis: new Map(), sent: new Set() });
  // (r19) Which slots of the current serve the user actually looked at. The
  // tuning denominator used to be every slot the server sent — position bias
  // straight into the training signal. We report ids only; the server knows
  // which bridge each was.
  // (6 Sep) one record PER SERVE — the first load and every chunk after it —
  // each reported once against its own id. Newest first, bounded like the
  // server's ring. `examinedAllRef` is the union, for the re-chunk plan.
  const servesRef = useRef([]);
  const examinedAllRef = useRef(new Set());
  const noteServe = (data, ids) => {
    if (!data || !data.serveId) return;
    servesRef.current = [
      // A record born while observation is off is silent from the start —
      // not from the next five-second tick.
      { id: data.serveId, ids: new Set(ids), examined: new Set(), sent: !observationOn(), settled: 0 },
      ...servesRef.current.filter((s) => s.id !== data.serveId),
    ].slice(0, SERVE_RING_MAX);
  };
  // Post every unsent examination record once. A record is marked sent
  // before the request so a tick cannot post it twice; a network failure
  // unmarks it for the next tick. A refused request (429, 503, or a 401 from
  // a bearer that expired while the tab idled) stays sent —
  // that serve's denominator is simply under-counted; nothing falls back.
  const SETTLE_IDLE_TICKS = 6; // ~30 s: a reader who stopped mid-serve still reports
  const flushBeacons = (user, { immediate = false, final = false } = {}) => {
    for (const serve of servesRef.current) {
      if (serve.sent || !serve.examined.size) continue;
      // A serve is reported ONCE (the server refuses a second report as a
      // duplicate), so it is reported when the reader has LEFT it: its
      // examined set has stopped growing AND none of its cards is on screen
      // (the dwell map knows), or it has sat unchanged for a while. Reporting
      // at the first tick reported one viewport of a sixty-card page; a
      // reader who pauses on each viewport would lose most of the rest.
      // `immediate` (pagehide) and `final` (the page is being replaced) send
      // whatever there is.
      if (!immediate && !final) {
        if (serve.examined.size !== serve.settled) { serve.settled = serve.examined.size; serve.idle = 0; continue; }
        serve.idle = (serve.idle || 0) + 1;
        const vis = dwellRef.current.vis;
        let onScreen = false;
        for (const id of serve.ids) { const rec = vis.get(id); if (rec && rec.start != null) { onScreen = true; break; } }
        if (onScreen && serve.idle < SETTLE_IDLE_TICKS) continue;
      }
      serve.sent = true;
      const body = { user, serveId: serve.id, examined: [...serve.examined] };
      // keepalive: a full-page navigation (every destination is a plain link)
      // aborts an ordinary fetch; this one is allowed to finish. On pagehide
      // the request must be ISSUED before the document goes — no awaiting the
      // auth chain — so it goes out synchronously with the last known headers.
      const req = immediate ? beaconJSON("/api/impressions", body) : postJSON("/api/impressions", body, { keepalive: true });
      req.catch(() => { serve.sent = false; });
    }
  };
  const itemsRef = useRef([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const gridCols = useColumnCount();
  // Column memories per list, kept across tab round-trips.
  const curatedColsRef = useRef({ count: 0, map: new Map() });
  const followingColsRef = useRef({ count: 0, map: new Map() });
  const newColsRef = useRef({ count: 0, map: new Map() });
  // A card's height in column widths: the tile aspect plus the caption.
  const cardWeight = useCallback((it) => {
    const [w, h] = String(aspectFor(it.id)).split("/").map((x) => Number(x));
    return (Number.isFinite(w) && Number.isFinite(h) && w > 0 ? h / w : 1.2) + 0.45;
  }, []);
  // ---- THE POSTS of the one Feed (V.2 Blueprint, 17 Oct 2026), read from
  // the editorial route and braided into the pieces below.
  const [posts, setPosts] = useState(null);
  const [engagement, setEngagement] = useState({});
  // THE ONE FEED (V.2 Blueprint, 17 Oct 2026: "There is no Wire"). The
  // posts are braided into the pieces (lib/feed/types.js braid), the places
  // record's upcoming rows ride along as PLACE cards, and live ECHOs sit on
  // the rail above the stream. Sample editorial fills a thin stream and is
  // credited as such; it never pretends to be a passenger.
  const [places, setPlaces] = useState([]);
  useEffect(() => {
    fetch("/api/places").then((r) => (r.ok ? r.json() : null))
      .then((d) => setPlaces(d && Array.isArray(d.places) ? d.places.slice(0, 6) : [])).catch(() => setPlaces([]));
  }, []);

  // FEED PARKING (V.2 brief §2, lib/viewstate.js). The surface's key is the
  // viewer, the route and the mode. Leaving —
  // opening a detail, the page hiding, a navigation — PARKS the anchor card,
  // its offset, the served order and the cards themselves. Coming back
  // paints the parked cards first, restores the anchor, then fetches fresh:
  // the anchor (or its nearest surviving neighbour) is re-found in the fresh
  // order and the viewport stays on it; whatever the fresh order placed
  // above it is counted and offered as "N new pieces ↑", never scrolled
  // into. A parked record that cannot be read is simply absent.
  const parkedRef = useRef(null);          // the record read on mount, consumed by the first load
  const parkedOnceRef = useRef(false);
  const [newAboveCount, setNewAboveCount] = useState(0);
  const PARK_CARDS = 120;
  const viewKey = useCallback(() => ({ viewer: uidRef.current || "anon", route: "/", subtab: "feed", filters: { tab } }), [tab]);
  const park = useCallback(() => {
    if (typeof window === "undefined" || !itemsRef.current.length) return;
    const { anchor, offset, y } = currentAnchor(null, ".card[data-id]");
    const order = itemsRef.current.map((x) => x.id);
    saveView(viewKey(), { anchor, offset, y, order, extra: { items: itemsRef.current.slice(0, PARK_CARDS) } });
  }, [viewKey]);
  useEffect(() => {
    const onHide = () => park();
    const onVis = () => { if (document.visibilityState === "hidden") park(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onVis); };
  }, [park]);
  // what the parked record says, applied once the fresh feed has landed
  const restoreFromPark = useCallback((freshItems) => {
    const record = parkedRef.current;
    parkedRef.current = null;
    if (!record) return;
    const ids = freshItems.map((x) => x.id);
    const anchor = restoreAnchor(record, ids);
    const above = newAbove(record, ids);
    setNewAboveCount(above.length);
    // the anchor, or its nearest survivor, kept in place while images and
    // fonts settle; with nothing of the old order left, the parked pixel
    // position is the honest fallback
    settleAnchor({ anchor, offset: record.offset, y: record.y }, null, ".card[data-id]");
  }, []);

  const [pinned, setPinned] = useState(null); // ?post=<id>
  const loadPosts = useCallback(() => {
    fetchPosts("user")
      .then((w) => {
        setPosts(w.posts || []);
        const ids = (w.posts || []).map((x) => x.serverId).filter((v) => v != null);
        if (ids.length) fetchEngagement(ids).then((e) => setEngagement((prev) => ({ ...prev, ...e }))).catch(() => {});
      })
      .catch(() => setPosts([]));
  }, []);
  useEffect(() => { loadPosts(); }, [loadPosts]);
  function engage(p, kind) {
    const now = engagement[String(p.serverId)];
    const on = !(kind === "like" ? now?.youLike : now?.youSave);
    toggleEngagement(p.serverId, kind, on).then((r) => { if (r.ok) setEngagement((prev) => ({ ...prev, [String(p.serverId)]: r.counts })); }).catch(() => {});
  }
  const streamPosts = (posts || []).length >= 3 ? (posts || []) : [...(posts || []), ...SAMPLE_POSTS];
  const rail = echoRail(posts || []);
  const braidCache = useRef(new WeakMap());
  function feedList(list) {
    if (!list) return list;
    const hit = braidCache.current.get(list);
    if (hit && hit.posts === posts && hit.places === places) return hit.out;
    const out = braid(list, streamPosts, places);
    braidCache.current.set(list, { posts, places, out });
    return out;
  }
  const weightOf = useCallback((it) => (it.__post ? ((it.__post.image || it.__post.imageUrl) ? 1.95 : 0.85) : it.__place ? 0.5 : cardWeight(it)), [cardWeight]);
  // Which tab is on screen, for handlers that resolve after a switch.
  const tabRef = useRef("curated");
  useEffect(() => { tabRef.current = tab; }, [tab]);
  // The brain switch reloads the feed when it is TOGGLED (the event), not
  // when this mirror first reads it on mount — a paused reader used to pay a
  // second cold-load request for the mirror catching up.
  const loadFeedRef = useRef(null);
  useEffect(() => {
    const sync = (e) => { setGuideOn(brainEnabled()); if (e && loadFeedRef.current) loadFeedRef.current(); };
    sync();
    window.addEventListener("asilum:brain", sync);
    return () => window.removeEventListener("asilum:brain", sync);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const d = dwellRef.current;
    const obs = new IntersectionObserver((entries) => {
      const now = performance.now();
      for (const en of entries) {
        const id = en.target.getAttribute("data-id");
        if (!id) continue;
        const rec = d.vis.get(id) || { start: null, total: 0 };
        if (en.isIntersecting) {
          if (rec.start == null) rec.start = now;
          examinedAllRef.current.add(id);
          const owner = servesRef.current.find((s) => s.ids.has(id));
          if (owner) owner.examined.add(id);
        } else if (rec.start != null) {
          rec.total += now - rec.start;
          rec.start = null;
        }
        d.vis.set(id, rec);
      }
    }, { threshold: 0.55 });
    document.querySelectorAll(".card[data-id]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // (The POST sub-view is gone — owner overhaul, Aug 13 — so the card
    // nodes only remount when `items` changes.)
  }, [items]);

  function dwellMsFor(id) {
    const rec = dwellRef.current.vis.get(id);
    if (!rec) return 0;
    let t = rec.total;
    if (rec.start != null) t += performance.now() - rec.start;
    return Math.round(t);
  }

  useEffect(() => {
    const iv = setInterval(() => {
      const user = uidRef.current;
      if (!user) return;
      const d = dwellRef.current;
      // WHAT WAS WRONG (Aug 8, codebase audit). The ON-DEVICE TASTE OBSERVATION
      // switch in Settings was decorative. observationOn() was read in exactly
      // two places — to render this module and to render the toggle itself —
      // and NOTHING gated the sends below. Turning it OFF hid a panel while
      // dwell events and examination reports kept flowing to the server, under
      // settings copy promising "the brain only learns from explicit actions".
      // A privacy control that controls nothing is worse than no control.
      //
      // Dwell and examination are both PASSIVE attention signals, so both are
      // gated. Explicit actions (favourite, bag, share, skip) are unaffected,
      // which is exactly what the copy promises. Pending records are consumed
      // rather than left queued, so turning observation back on never flushes
      // a backlog collected while it was off.
      //
      // HONEST LIMIT: this is a client-side control. It genuinely stops this
      // client sending, and the r19 path treats a missing examination report
      // as an under-counted denominator for that serve (there is no fallback
      // to served counts under the default flag). It is not a server-enforced consent
      // record; a modified client could still post. Making it server-side
      // wants asterisk_memory_preferences and its own round.
      if (!observationOn()) {
        for (const [id, rec] of d.vis) {
          const t = rec.total + (rec.start != null ? performance.now() - rec.start : 0);
          if (t >= DWELL_MIN_MS) d.sent.add(id);
        }
        for (const s of servesRef.current) s.sent = true;
        return;
      }
      const now = performance.now();
      const events = [];
      for (const [id, rec] of d.vis) {
        if (d.sent.has(id)) continue;
        const t = rec.total + (rec.start != null ? now - rec.start : 0);
        if (t < DWELL_MIN_MS) continue;
        const item = itemsRef.current.find((x) => x.id === id);
        if (!item) continue;
        events.push({ item: { id: item.id, tags: item.tags, _bridge: item._bridge }, action: "dwell", dwellMs: Math.round(t) });
        d.sent.add(id);
      }
      if (events.length) {
        // D4 courtesy gate: passive dwell rides only under OBSERVE — the
        // server refuses it anyway; this just saves the wire.
        let consent = null;
        try { consent = window.localStorage.getItem("asilum-consent"); } catch {}
        if (consent === "observe") {
          postJSON("/api/interaction", { user, events }).catch(() => {});
        }
      }
      // (r19) one examination report per serve, sent once the page has
      // settled.
      flushBeacons(user);
    }, DWELL_FLUSH_MS);
    // The page is leaving (a link, a close): report what was examined now.
    const onHide = () => { const user = uidRef.current; if (user && observationOn()) flushBeacons(user, { immediate: true }); };
    window.addEventListener("pagehide", onHide);
    return () => { clearInterval(iv); window.removeEventListener("pagehide", onHide); };
  }, []);

  // ---- Feed ----
  // The catalog lane's position, as the server last reported it. Null means
  // "from the top"; a reload resets it; an exhausted lane keeps its cursor so
  // the next chunk says so instead of wrapping.
  const cursorRef = useRef(null);
  const cursorKeyRef = useRef("");
  // After a refused reload, the earliest moment a scroll may retry it.
  const retryAtRef = useRef(0);
  const actionsSinceChunkRef = useRef(0);
  // A reload in flight: appends and re-chunks wait for it rather than racing
  // it (a plan made against the old list must never be applied to the new).
  const reloadingRef = useRef(false);
  // The current re-chunk closure, so an action that resolves after a filter
  // change re-chunks with the NEW filters, not the ones it was born under.
  const rechunkRef = useRef(null);

  const feedQS = useCallback((user, { limit, cursor } = {}) => {
    const qs = new URLSearchParams({ user, epsilon: epsilon ? "1" : "0", q: promptRef.current });
    if (limit) qs.set("limit", String(limit));
    if (cursor) qs.set("cursor", cursor);
    if (boardParamRef.current) qs.set("board", boardParamRef.current);
    if (filters.category) qs.set("category", filters.category);
    if (filters.maxPrice) qs.set("maxPrice", filters.maxPrice);
    if (filters.fitsMe && fit.usualSize) qs.set("fit", fit.usualSize);
    if (craving.text) qs.set("craving", craving.text);
    if (craving.occasion) qs.set("occasion", craving.occasion);
    if (craving.mood) qs.set("mood", craving.mood);
    if (craving.novelty) qs.set("novelty", craving.novelty);
    return qs;
  }, [epsilon, filters, fit.usualSize, craving]);

  const loadFeed = useCallback(async (user = uidRef.current) => {
    if (!user) return;
    // the parked record for THIS surface, read once, before the first fetch
    if (parkedRef.current === null && !parkedOnceRef.current) {
      parkedOnceRef.current = true;
      const record = readView({ viewer: user, route: "/", subtab: "feed", filters: { tab } });
      if (record && Array.isArray(record.order) && record.order.length) {
        parkedRef.current = record;
        const parkedItems = record.extra && Array.isArray(record.extra.items) ? record.extra.items : [];
        if (parkedItems.length && !itemsRef.current.length) {
          setItems(parkedItems);
          settleAnchor(record, null, ".card[data-id]");
        }
      }
    }
    // A reload claims a new feed generation: a slower older response (e.g. a
    // pending personalized feed after a craving/filter change) must never
    // overwrite the feed a newer request owns.
    const isCurrent = claimRequest(feedGenRef);
    setLoading(true);
    reloadingRef.current = true;
    // What was examined on the page being replaced is reported now, not lost
    // to the reset below.
    if (observationOn()) flushBeacons(user, { final: true });
    const previousCursor = cursorRef.current;
    const previousKey = cursorKeyRef.current;
    cursorRef.current = null;
    // A cursor belongs to the filter set it was made under: a listing key
    // from one category sent with another can sit past that listing's end
    // and kill the lane for the session.
    cursorKeyRef.current = feedQS(user).toString();
    actionsSinceChunkRef.current = 0;
    try {
      const res = await authorizedFetch("/api/feed?" + feedQS(user).toString());
      const data = await res.json();
      if (!isCurrent()) return;
      // A refused reload (rate limit, outage) keeps the feed it has — and its
      // cursor — rather than replacing it with "nothing matches", and says so.
      if (!res.ok || !Array.isArray(data.items)) {
        cursorRef.current = previousCursor;
        cursorKeyRef.current = previousKey;
        retryAtRef.current = Date.now() + 1000 * (Number(res.headers.get("Retry-After")) || 10);
        setNotice(res.status === 429 ? "the feed is busy — kept what you had" : "could not refresh the feed — kept what you had");
        return;
      }
      setItems(data.items || []);
      restoreFromPark(data.items || []);
      cursorRef.current = data.chunk?.catalog?.nextCursor || null;
      setEpsilonAuto(!!data.epsilonAuto);
      // V.2 14.9 (slice 10c): the Info Dock shows |A| while exploration is active
      try { window.dispatchEvent(new CustomEvent("asilum:exploration", { detail: data.exploration || { active: !!data.epsilonActive, auto: !!data.epsilonAuto, off: false } })); } catch {}
      if (data.boardSeeded) setNotice("feed seeded from a moodboard you follow or opened");
      else if (data.craving) setNotice("current craving applied — your long-term taste was not rewritten");
      dwellRef.current = { vis: new Map(), sent: new Set() };
      // (r19) a new serve: report examined slots against THIS id, once.
      servesRef.current = [];
      examinedAllRef.current = new Set();
      noteServe(data, (data.items || []).map((x) => x.id));
    } catch (e) {
      console.error(e);
    } finally {
      if (isCurrent()) { setLoading(false); reloadingRef.current = false; }
    }
  }, [feedQS]);

  function applyCraving() {
    setTab("curated");
    setCravingOpen(false);
    setCraving({ ...cravingDraft, text: cravingDraft.text.trim().slice(0, 240) });
  }

  function clearCraving() {
    const empty = { text: "", occasion: "", mood: "", novelty: "discovery" };
    setCravingDraft(empty);
    setCraving(empty);
  }

  const loadMore = useCallback(async () => {
    const user = uidRef.current;
    if (!user) return;
    if (loadingMoreRef.current || reloadingRef.current) { wantMoreRef.current = true; return; }
    // The cursor's filter key differs from the current filters only when the
    // last reload was refused: the page shows old-filter cards under new
    // chips (or nothing at all). A scroll then retries the reload — no
    // sooner than the server's Retry-After — rather than appending a page
    // that matches neither. Checked before the empty/ceiling returns so an
    // empty or full page can recover too.
    if (cursorKeyRef.current !== feedQS(user).toString()) {
      if (Date.now() >= retryAtRef.current) loadFeed(user);
      return;
    }
    if (itemsRef.current.length === 0 || itemsRef.current.length >= MAX_RENDERED) return;
    // Ask for what can still render: a served card that never renders is
    // struck from the reader's listing walk unseen.
    const room = Math.min(CHUNK, MAX_RENDERED - itemsRef.current.length);
    loadingMoreRef.current = true;
    // Appends observe the feed generation without claiming it: a page fetched
    // for a feed that has since reloaded must be dropped, not appended.
    const isCurrent = watchRequest(feedGenRef);
    actionsSinceChunkRef.current = 0;
    try {
      const sameFilters = cursorKeyRef.current === feedQS(user).toString();
      const qs = feedQS(user, { limit: Math.max(CHUNK_MIN, room), cursor: sameFilters ? cursorRef.current : null });
      const res = await authorizedFetch("/api/feed?" + qs.toString());
      const data = await res.json();
      if (!isCurrent()) return;
      if (data.chunk?.catalog?.nextCursor) cursorRef.current = data.chunk.catalog.nextCursor;
      if (data.items && data.items.length) {
        noteServe(data, data.items.map((x) => x.id));
        setItems((prev) => {
          const have = new Set(prev.map((x) => x.id));
          return [...prev, ...data.items.filter((x) => !have.has(x.id))].slice(0, MAX_RENDERED);
        });
      }
    } catch (e) { console.error(e); }
    finally { loadingMoreRef.current = false; }
  }, [feedQS, loadFeed]);
  useEffect(() => { loadFeedRef.current = loadFeed; }, [loadFeed]);

  // A deliberate action moved the taste; once enough of them have landed, the
  // part of the feed the reader has NOT reached is rebuilt from the taste as it
  // now stands. Nothing on or above the screen moves: only cards entirely
  // below the fold that were never examined are replaced (the grid flows
  // column-major, so list position says nothing about reach — geometry does),
  // and only when enough of them exist to be worth it — otherwise the next
  // scroll fetches a fresh chunk anyway, since every chunk is built at request
  // time.
  // A scroll that reached the sentinel while a chunk was in flight is
  // remembered and served when that chunk lands: an in-place re-chunk does
  // not move the sentinel, so the observer would never fire again.
  const wantMoreRef = useRef(false);
  const rechunk = useCallback(async () => {
    const user = uidRef.current;
    if (!user || typeof document === "undefined") return;
    // The plan reads the curated grid's geometry; on another tab the DOM is
    // that tab's, and the curated list must not be rearranged unseen.
    if (tabRef.current !== "curated") return;
    if (loadingMoreRef.current || reloadingRef.current) return;
    // A favourite's "more like this" cards count as reached — they are the
    // reader's own ask — for the gate, the request size AND the placement.
    const reached = () => new Set([
      ...examinedAllRef.current,
      ...itemsRef.current.filter((x) => x && x._via).map((x) => String(x.id)),
    ]);
    const plan = planRechunk(
      itemsRef.current,
      reached(),
      idsBelowFold(document, window.innerHeight, RECHUNK_FOLD_MARGIN()),
    );
    if (!plan) return;
    loadingMoreRef.current = true;
    actionsSinceChunkRef.current = 0;
    const isCurrent = watchRequest(feedGenRef);
    try {
      // Every chunk is ranked on the taste as it stands and skips what the
      // cursor says was served, so a re-chunk is an ordinary chunk request.
      const sameFilters = cursorKeyRef.current === feedQS(user).toString();
      // Sized to what can render: the planned replacements plus any room under
      // the ceiling, never the full chunk for its own sake.
      const room = Math.max(0, MAX_RENDERED - itemsRef.current.length);
      const want = Math.max(CHUNK_MIN, Math.min(CHUNK, plan.dropped.length + room));
      const qs = feedQS(user, { limit: want, cursor: sameFilters ? cursorRef.current : null });
      const res = await authorizedFetch("/api/feed?" + qs.toString());
      const data = await res.json();
      if (!isCurrent()) return;
      if (data.chunk?.catalog?.nextCursor) cursorRef.current = data.chunk.catalog.nextCursor;
      if (data.items && data.items.length) {
        noteServe(data, data.items.map((x) => x.id));
        // Replace the planned cards IN PLACE and only those: anything that
        // arrived or left while the chunk was in flight keeps its place. The
        // plan is re-checked against the geometry NOW — the reader may have
        // scrolled a screen while the chunk was in flight — so a card that
        // came into view since is kept.
        const belowNow = idsBelowFold(document, window.innerHeight, RECHUNK_FOLD_MARGIN());
        setItems((prev) => {
          // Re-plan against the live list and the geometry NOW, with no
          // minimum: the chunk is already served, so whatever can be placed
          // replaces something rather than being discarded at the ceiling.
          const fresh = planRechunk(prev, reached(), belowNow, 0);
          const dropped = fresh ? fresh.dropped.slice(0, data.items.length) : [];
          return applyRechunk(prev, dropped, data.items, { max: MAX_RENDERED });
        });
      }
    } catch (e) { console.error(e); }
    finally {
      loadingMoreRef.current = false;
      if (wantMoreRef.current) { wantMoreRef.current = false; loadMore(); }
    }
  }, [feedQS, loadMore]);
  useEffect(() => { rechunkRef.current = rechunk; }, [rechunk]);

  function noteDeliberateAction() {
    actionsSinceChunkRef.current += 1;
    if (actionsSinceChunkRef.current >= RECHUNK_AFTER && rechunkRef.current) rechunkRef.current();
  }

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !sentinelRef.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "700px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
    // The sentinel node is mounted only on the curated tab, so the observer
    // is re-attached when the reader comes back to it (it used to be dead
    // after a tab round-trip — a verifier's finding, 7 Sep).
  }, [loadMore, tab]);

  // ---- Boot: identity, search hand-off, shared links, first-visit connect ----
  useEffect(() => {
    const user = getUid();
    uidRef.current = user;
    const sp = new URLSearchParams(window.location.search);
    boardParamRef.current = sp.get("board") || "";
    const q = sp.get("q") || "";
    const sharedItem = sp.get("item");
    const pinnedId = sp.get("post");
    if (pinnedId) fetchPost(pinnedId).then((pp) => { if (pp) setPinned(pp); }).catch(() => {});
    const onboarded = (() => {
      try { return !!window.localStorage.getItem("asilum-onboarded"); } catch { return true; }
    })();
    // V.2 (owner brief, 17 Sep): no sheet before the first reward. The
    // connect sheet is reachable from the Passport's imports line instead;
    // the device is marked onboarded so nothing else waits on it.
    if (!onboarded) { try { window.localStorage.setItem("asilum-onboarded", "1"); } catch {} }
    void sharedItem;

    const boot = async () => {
      if (q) {
        promptRef.current = q;
        setNotice(`The Asterisk system is routing this edit toward “${q}” without rewriting your Passport`);
      }
      await loadFeed(user);
      if (sharedItem) {
        fetch("/api/related?item=" + encodeURIComponent(sharedItem) + "&limit=6")
          .then((r) => r.json())
          .then((d) => {
            if (d.item) openSheet("listing", { item: d.item, title: "LISTING" });
            if (d.items && d.items.length) {
              setNotice("showing pieces connected to a shared item");
              setItems((prev) => {
                const have = new Set(d.items.map((x) => x.id));
                return [...d.items, ...prev.filter((x) => !have.has(x.id))];
              });
            }
          })
          .catch(() => {});
      }
    };
    boot();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reloads on a change of filters, craving, epsilon, guidance or fit size —
  // not on mount, where the boot effect has already loaded (a cold load used
  // to make two requests, the first discarded, both recorded as served).
  const reloadPrimedRef = useRef(false);
  useEffect(() => {
    if (!reloadPrimedRef.current) { reloadPrimedRef.current = true; return; }
    if (uidRef.current) loadFeed();
    // The fit size matters only while the FITS ME filter is on.
  }, [filters, epsilon, craving, filters.fitsMe ? fit.usualSize : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  function markOnboarded() {
    try {
      window.localStorage.setItem("asilum-onboarded", "1");
      // The account popup waits behind the first-visit sheet; let it know.
      window.dispatchEvent(new CustomEvent("asilum:onboarded"));
    } catch {}
  }

  // ---- Catalog modes ----
  // Following: pieces from brands you follow + boards you follow (posts from
  // people live on the POST sub-page now). What's New: the freshest inventory
  // across the affiliated sites, source-labeled.
  async function switchTab(next) {
    setTab(next);
    if (next === "curated") return;
    setTabItems(null);
    try {
      if (next === "new") {
        const d = await fetch("/api/discover?sort=new&limit=48").then((r) => r.json());
        setTabItems(d.items || []);
      } else if (next === "following") {
        const seen = new Set();
        const pool = [];
        // pieces from followed brands
        const brands = followedBrands();
        if (brands.length) {
          const d = await fetch("/api/discover?brands=" + encodeURIComponent(brands.join("|")) + "&limit=48")
            .then((r) => r.json());
          for (const it of d.items || []) {
            if (!seen.has(it.id)) { seen.add(it.id); pool.push(it); }
          }
        }
        // pieces from followed moodboards
        const prof = await authorizedFetch("/api/profile?user=" + encodeURIComponent(uidRef.current))
          .then((r) => (r.ok ? r.json() : null));
        const follows = (prof?.profile && prof.profile._meta && prof.profile._meta.follows) || [];
        const boards = await Promise.all(
          follows.map((id) => fetch("/api/boards?id=" + encodeURIComponent(id))
            .then((r) => (r.ok ? r.json() : null)).catch(() => null))
        );
        for (const b of boards) {
          for (const it of (b && b.board && b.board.items) || []) {
            if (!seen.has(it.id)) { seen.add(it.id); pool.push(it); }
          }
        }
        setTabItems(pool);
      }
    } catch { setTabItems([]); }
  }

  // (The POST sub-page moved to THE WIRE — owner overhaul, Aug 13: all
  // user posts live at /hotlist now; this page is straight clothing.)

  async function connect(platform) {
    if (connecting) return;
    setConnecting(platform);
    try {
      const res = await postJSON("/api/connect", { user: uidRef.current, platform });
      const d = await res.json().catch(() => null);
      setConnectNote((d && d.message) || `${platform} linking is coming soon — teach the feed with the moodboard instead`);
    } catch (e) { console.error(e); }
    setConnecting("");
  }

  function useMoodboardInstead() {
    markOnboarded();
    setConnectOpen(false);
    setNotice("no account connected — favorite pieces, build your moodboard, and follow boards to teach the feed");
    loadFeed();
  }

  // ---- Signals ----
  // "More like this" after a favourite. It used to SPLICE four cards into the
  // list after the favourited one; under index-bucketed columns a splice
  // re-buckets every card after it (the same shift a re-chunk avoids), so
  // the related pieces now REPLACE the next cards after the favourite that
  // are below the fold and never examined — same count, same geometry, the
  // reader finds them where the feed continues. With nothing replaceable
  // (end of the list, everything seen) they append.
  function insertRelatedAfter(afterId, newItems, cap = 4) {
    // Only for a favourite made ON the curated page: elsewhere the geometry
    // read below is another tab's, and the curated list must not change
    // unseen. A favourite on a card that is not in the list (the modal's
    // related strip) adds nothing either.
    if (tabRef.current !== "curated") return;
    const below = typeof document === "undefined" ? new Set() : idsBelowFold(document, window.innerHeight, RECHUNK_FOLD_MARGIN());
    setItems((prev) => {
      const have = new Set(prev.map((x) => x.id));
      const add = newItems.filter((x) => !have.has(x.id)).slice(0, cap);
      if (!add.length) return prev;
      const idx = prev.findIndex((x) => x.id === afterId);
      if (idx < 0) return prev;
      const dropped = [];
      for (let k = Math.max(0, idx + 1); k < prev.length && dropped.length < add.length; k++) {
        const id = prev[k].id;
        if (below.has(id) && !examinedAllRef.current.has(id)) dropped.push(id);
      }
      return applyRechunk(prev, dropped, add, { max: MAX_RENDERED });
    });
  }

  async function moreLikeThis(item) {
    try {
      const res = await fetch("/api/related?item=" + encodeURIComponent(item.id) + "&limit=8");
      const data = await res.json();
      if (data.items) insertRelatedAfter(item.id, data.items, 4);
    } catch (e) { console.error(e); }
  }

  async function react(item, action) {
    const dwellMs = dwellMsFor(item.id);
    if (action === "hide" || action === "skip") {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }
    try {
      const res = await postJSON("/api/interaction", { user: uidRef.current, item, action, dwellMs });
      if (action === "favorite") moreLikeThis(item);
      // The profile has the action now — only if the server took it — and
      // the next chunk can read it.
      if (res && res.ok && action !== "dwell") noteDeliberateAction();
    } catch (e) { console.error(e); }
  }

  // Opening a record parks the feed and opens THE LISTING POPUP in the
  // session hub (ListingSheet.jsx; blueprint: "LISTING opens as a floating
  // popup over the softened Feed"). The popup records the open, once.
  function openModal(item) {
    park();
    openSheet("listing", { item, title: "LISTING" });
  }
  // A DOUBLE TAP lifts a piece out to float over the fogged Feed (owner, 18
  // Oct 2026; PieceFloat.jsx). One tap still opens the LISTING popup.
  const [floatItem, setFloatItem] = useState(null);
  // what the popup did to a piece (lib/feed/actions.js): a pass leaves the
  // stream, a favourite pulls its neighbours in
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!d.id) return;
      if (d.action === "skip" || d.action === "hide") setItems((prev) => prev.filter((x) => x.id !== d.id));
      if (d.action === "favorite" && d.ok) { const it = itemsRef.current.find((x) => x.id === d.id); if (it) moreLikeThis(it); }
    };
    window.addEventListener(PIECE_EVENT, on);
    return () => window.removeEventListener(PIECE_EVENT, on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // THE FEED KEY, TWICE (blueprint 1.13, 1.14): the deck's second tap asks
  // for a fresh window, which starts at the top
  useEffect(() => {
    const on = () => { if (uidRef.current) loadFeed(); };
    window.addEventListener("asilum:feed-refresh", on);
    return () => window.removeEventListener("asilum:feed-refresh", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // THE STREAM: Tetris-packed (lib/feed/types.js packFeed). A run of column
  // cards is one masonry segment; a STILL or MOTION stands full width; a
  // standalone BRDCST is a thin strip. The wheel overlaps slightly (CSS).
  function renderCard(it) {
    if (it.__post) return <PostCard key={it.id} post={it.__post} engagement={engagement} onEngage={engage} />;
    if (it.__place) return <PlaceCard key={it.id} place={it.__place} />;
    return (
      <FragmentCard
        key={it.id}
        it={it}
        fitLine={fitPhrase(it.size, fitBrain)}
        onOpen={() => openModal(it)}
        onFloat={() => setFloatItem(it)}
        onPass={() => react(it, "skip")}
      />
    );
  }
  function Stream({ list, memo }) {
    const segs = packFeed(feedList(list));
    return (
      <div className="feedwheel">
        {segs.map((seg, i) => seg.kind === "grid"
          ? <Columns key={"g" + i} count={gridCols} items={seg.items} memo={memo} weight={weightOf} render={renderCard} />
          : <div key={seg.item.id} className={seg.kind === "full" ? "feedfull" : "feedstrip"}>{renderCard(seg.item)}</div>)}
      </div>
    );
  }

  const cravingActive =
    craving.text || craving.occasion || craving.mood || craving.novelty !== "discovery";

  // Real zone composition of the loaded pass — printed as gutter
  // marginalia (magazine treatment, owner order Aug 13; every value is
  // real state).
  const zones = items.reduce(
    (z, it) => {
      // A related piece (after a favourite, or a shared link's neighbours) is
      // neither zone nor core.
      z[it._via ? "related" : it._zone === "reach" ? "reach" : it._zone === "discovery" ? "discovery" : it._zone === "catalog" ? "catalog" : "core"] += 1;
      return z;
    },
    { core: 0, discovery: 0, reach: 0, catalog: 0, related: 0 },
  );

  return (
    <div className="wrap ctr">
      <header className="cthead">
        <div className="feedmark"><Wordmark /></div>
        <PageMast word="THE FEED" sub="DISCOVERY · PUBLISHING · COMMERCE" />
        {stamp && (
          <div className="ctmeta">
            LIVE EDIT · {stamp}
            {items.length > 0 && (
              <span>{items.length} PIECES THIS PASS</span>
            )}
          </div>
        )}
      </header>
      {/* DEMO MODE banner (owner ruling, Aug 16). Deliberately in normal flow
          directly under the masthead rather than inside `.cthead`, which is a
          laid-out row — dropped in there it fought the headline for the same
          space. A per-card DEMO flag tells you about one record; only a
          page-level statement tells you the whole shelf is sample data. */}
      <p className="demoline" role="note">
        <b>DEMO CATALOG</b> — the pieces are synthetic sample records with placeholder imagery; nothing here is real inventory or for sale. taste learning is genuine; the clothes are not. sample editorial is credited.
        {" "}{guideOn ? "The Asterisk system routed this edit through your Passport." : "The Asterisk system is paused — a general edit."}
      </p>

      {notice && <Notice variant="banner" onDismiss={() => setNotice("")}>{notice}</Notice>}
      {floatItem && typeof document !== "undefined" ? createPortal(<PieceFloat item={floatItem} onClose={() => setFloatItem(null)} />, document.body) : null}

      <>
          {items.length > 0 && (
            <span className="cvside ctside" aria-hidden="true">
              ZONES — CORE {zones.core} · DISCOVERY {zones.discovery} · FAR REACH {zones.reach} · CATALOG {zones.catalog}{zones.related ? ` · RELATED ${zones.related}` : ""}
            </span>
          )}
          <span className="cvside cvsider ctsider" aria-hidden="true">
            ASTERISK — {guideOn ? "GUIDING" : "PAUSED"}
          </span>
          <EchoRail groups={rail} />
          <div className="fmodes seg">
            {[["curated", "FOR YOU"], ["following", "FOLLOWING"], ["new", "WHAT'S NEW"]].map(([k, label]) => (
              <button key={k} className={"fmode" + (tab === k ? " cur" : "")} onClick={() => switchTab(k)}>
                {label}
              </button>
            ))}
            <button className="fmode cravtoggle" onClick={() => setCravingOpen((o) => !o)}>
              CURRENT CRAVING {cravingActive ? "· ON" : ""} {cravingOpen ? "−" : "+"}
            </button>
            {cravingActive && (
              <button className="txtbtn" onClick={clearCraving}>CLEAR CRAVING</button>
            )}
          </div>
          {pinned && (
            <section className="wfocus" aria-label="pinned transmission">
              <div className="cclbl">PINNED TRANSMISSION · <a className="txtbtn" href="/">BACK TO THE STREAM</a></div>
              <PostCard post={pinned} engagement={engagement} onEngage={engage} />
            </section>
          )}

          {cravingOpen && (
            <section className="cravingline" aria-label="current craving">
              <p className="cravnote">tell the tollbooth what this moment needs. it steers this feed without changing your permanent taste.</p>
              <div className="cravinggrid">
                <input aria-label="what you are looking for"
                  type="text"
                  maxLength={240}
                  placeholder="dark dinner look, clean but strange, airport armor…"
                  value={cravingDraft.text}
                  onChange={(e) => setCravingDraft((c) => ({ ...c, text: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && applyCraving()}
                />
                <select aria-label="occasion" value={cravingDraft.occasion} onChange={(e) => setCravingDraft((c) => ({ ...c, occasion: e.target.value }))}>
                  <option value="">any occasion</option>
                  <option value="everyday">everyday</option><option value="work">work</option>
                  <option value="date">date</option><option value="night">night</option>
                  <option value="event">event</option><option value="travel">travel</option>
                  <option value="outdoors">outdoors</option>
                </select>
                <select aria-label="mood" value={cravingDraft.mood} onChange={(e) => setCravingDraft((c) => ({ ...c, mood: e.target.value }))}>
                  <option value="">any mood</option>
                  <option value="quiet">quiet</option><option value="sharp">sharp</option>
                  <option value="romantic">romantic</option><option value="experimental">experimental</option>
                  <option value="nostalgic">nostalgic</option><option value="practical">practical</option>
                </select>
                <select aria-label="novelty" value={cravingDraft.novelty} onChange={(e) => setCravingDraft((c) => ({ ...c, novelty: e.target.value }))}>
                  <option value="safe">safe bet</option><option value="discovery">discovery</option>
                  <option value="wildcard">wildcard</option>
                </select>
                <button className="btn" onClick={applyCraving}>POINT THE WAY</button>
              </div>
            </section>
          )}

          <div className="filters">
            <select aria-label="filter by category"
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">all categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input aria-label="maximum price"
              type="number"
              placeholder="max price"
              value={filters.maxPrice}
              onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
            />
            <label className="toggle" title={fit.usualSize ? "" : "set your size in PROFILE first"}>
              <input
                type="checkbox"
                disabled={!fit.usualSize}
                checked={filters.fitsMe}
                onChange={(e) => setFilters((f) => ({ ...f, fitsMe: e.target.checked }))}
              />
              fits me
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={epsilon}
                onChange={(e) => setEpsilon(e.target.checked)}
              />
              epsilon
            </label>
          </div>

          {epsilonAuto && (
            <Notice variant="banner">trying something different — you seemed in a rut</Notice>
          )}

          <div className="streamlayout withrail"><div className="streamfeed">
          {tab === "curated" && (
            <>
              {loading && <div className="empty">thinking…</div>}
              {!loading && items.length === 0 && (
                <div className="empty">Nothing matches — loosen the filters or search a mood.</div>
              )}
              {newAboveCount > 0 && (
                <button className="newabove" onClick={() => { setNewAboveCount(0); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  {newAboveCount} new {newAboveCount === 1 ? "piece" : "pieces"} above ↑
                </button>
              )}
              <Stream list={items} memo={curatedColsRef} />
              <div ref={sentinelRef} className="sentinel" />
            </>
          )}

          {tab === "following" && (
            <>
              {!tabItems && <div className="empty">reading who and what you follow…</div>}
              {tabItems && tabItems.length === 0 && (
                <div className="empty">
                  nothing here yet — follow brands (from any piece) and moodboards
                  (open a shared board and hit FOLLOW) to build this rack.
                  posts from people live on the POST page.
                </div>
              )}
              {tabItems && tabItems.length > 0 && (
                <Stream list={tabItems} memo={followingColsRef} />
              )}
            </>
          )}

          {tab === "new" && (
            <>
              {/* "just in from the affiliated sites" claimed a live feed from
                  partners that does not exist. Newest-first is true; where the
                  records come from is not. */}
              <p className="deck">newest sample records first.</p>
              {!tabItems && <div className="empty">pulling the fresh racks…</div>}
              {tabItems && (
                <Stream list={tabItems} memo={newColsRef} />
              )}
            </>
          )}
          </div></div>
        </>

      {/* ---- First visit: buyer-history scan (always escapable) ---- */}
      {connectOpen && (
        <div className="overlay" onClick={dismissConnectSheet}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <button className="mclose" onClick={useMoodboardInstead}>×</button>
            <h2>Your taste, pre-loaded<span style={{ color: "var(--red)" }}>.</span></h2>
            <p className="deck">
              coming soon: connect an authorized source account and import only
              the data you permit to help shape your feed.
            </p>
            <div className="connectrow">
              {PLATFORMS.map((p) => (
                <button key={p} className="platform soon" disabled={!!connecting} onClick={() => connect(p)}>
                  {connecting === p ? "checking setup…" : p}
                </button>
              ))}
            </div>
            {connectNote && <p className="deck" style={{ color: "var(--red)" }}>{connectNote}</p>}
            <div className="orline">OR</div>
            <p className="deck">
              start cold: favorite what you love, build a moodboard, and follow
              boards whose taste you trust — the feed learns from all of it.
            </p>
            <button className="btn wide" onClick={useMoodboardInstead}>
              start with the moodboard + following
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// One masonry cell: the minimal listing card. (The synthetic community post
// tiles that used to smoosh in after every 7th card are gone — Aug 12,
// owner order: the catalog is pieces of clothing only; real posts live on
// the POST sub-page.)
// How many columns the catalog grid shows. The old multicol rule was
// `columns: <cols> <min width>` — at most --ed-grid-cols columns, each at
// least --ed-grid-colw wide — so a narrow desktop window dropped to fewer
// columns. The same contract, computed: the UI lab's variables (it announces
// a change as `asilum:edition`), the grid's own width, two on a phone.
function useColumnCount() {
  const [count, setCount] = useState(4);
  useEffect(() => {
    // The same breakpoint as the stylesheet's mobile rules (globals.css).
    const mq = window.matchMedia("(max-width: 760px)");
    const sync = () => {
      if (mq.matches) { setCount(2); return; }
      const css = getComputedStyle(document.documentElement);
      const cols = parseInt(css.getPropertyValue("--ed-grid-cols"), 10);
      const colw = parseInt(css.getPropertyValue("--ed-grid-colw"), 10);
      const gap = parseInt(css.getPropertyValue("--ed-grid-gap"), 10);
      const want = Number.isFinite(cols) && cols > 0 ? cols : 4;
      const minW = Number.isFinite(colw) && colw > 0 ? colw : 240;
      const g = Number.isFinite(gap) && gap >= 0 ? gap : 20;
      const grid = document.querySelector(".grid.gcols");
      const width = grid ? grid.clientWidth : window.innerWidth;
      const fit = Math.max(1, Math.floor((width + g) / (minW + g)));
      setCount(Math.max(1, Math.min(want, fit)));
    };
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("asilum:edition", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("asilum:edition", sync);
    };
  }, []);
  return count;
}

// Explicit columns with a memory: a card keeps the column it was first
// placed in, a newcomer takes the shortest, and cards keep list order within
// a column — so a replacement lands where the replaced card stood and a
// removal (PASS) shortens only its own column (lib/feed/rechunk.js
// placeInColumns; see .grid.gcols in globals.css).
// `memo` is the page's map for this list (it must outlive a tab round-trip,
// or every card re-buckets when the reader comes back); `weight` says how tall
// a card is so columns balance by height.
function Columns({ items, count, render, children, memo, weight }) {
  const n = Math.max(1, count);
  const fallbackRef = useRef({ count: n, map: new Map() });
  const store = memo || fallbackRef;
  if (store.current.count !== n) store.current = { count: n, map: new Map() };
  const cols = placeInColumns(items, n, store.current.map, weight);
  return (
    <div className="grid gcols">
      {cols.map((col, c) => <div className="gcol" key={c}>{col.map(render)}</div>)}
      {children}
    </div>
  );
}

// the window inside which a second tap makes a double tap — a mouse's
// dblclick and a finger's double tap alike (iOS does not fire dblclick)
const DOUBLE_TAP_MS = 280;
function FragmentCard({ it, fitLine, onOpen, onPass, onFloat }) {
  const tap = useRef({ at: 0, timer: 0 });
  useEffect(() => () => clearTimeout(tap.current.timer), []);
  // one tap opens the listing a beat later; a second tap inside the window
  // cancels that and floats the piece instead
  function onPhoto() {
    const now = Date.now();
    if (onFloat && now - tap.current.at < DOUBLE_TAP_MS) {
      clearTimeout(tap.current.timer);
      tap.current.at = 0;
      onFloat();
      return;
    }
    tap.current.at = now;
    clearTimeout(tap.current.timer);
    tap.current.timer = setTimeout(() => { tap.current.at = 0; onOpen(); }, onFloat ? DOUBLE_TAP_MS : 0);
  }
  // THE PIECE CARD (owner's reference of 18 Oct 2026, 2.jpg): the photograph
  // fills a rounded card; one quiet line beneath carries the name and the
  // price; the small × at the corner is PASS. Favourite and bag live in the
  // LISTING popup the card opens. ONE ACCESSIBLE NAME PER CARD (launch
  // audit, Aug 16): the title is the real control; the image is
  // presentational and keeps its pointer affordance.
  return (
    <div className={"card piece" + (it._zone === "reach" ? " reach" : "")} data-id={it.id}>
      <div className="imgwrap" onClick={onPhoto} aria-hidden="true" title="double-tap to float it" style={{ aspectRatio: aspectFor(it.id) }}>
        <OriginSticker item={it} />
        <img src={it.img || thumbFor(it)} alt="" loading="lazy" />
      </div>
      {/* (7 Sep) the brief's third verb — a reader can pass on a piece
          without opening it. Same signal the modal's Skip sends. */}
      {onPass && <button type="button" className="piecepass" onClick={onPass} aria-label={"pass on " + (it.title || "this piece")} title="PASS">×</button>}
      <div className="pieceline">
        <button type="button" className="ttl" onClick={onOpen}>{pieceName(it)}</button>
        {it.price ? <span className="price">{it.currency || "USD"} {it.price}</span> : null}
      </div>
      {/* A demo record says so, and says nothing else about provenance: no
          source, no "just in". Both would be claims it cannot support. */}
      {isDemoItem(it)
        ? <div className="fitline demoflag"><b>{DEMO_LABEL}</b> · sample data, not for sale</div>
        : it.src ? <div className="fitline"><b className="red">{it.src}</b> · just in</div> : null}
      {fitLine ? <div className="fitline">{fitLine}</div> : null}
      {/* the Feed card shows the same first three as the listing (slice 4) */}
      <TagRow tags={visibleTags(tagsFor(it)).shown} size="card" />
    </div>
  );
}

