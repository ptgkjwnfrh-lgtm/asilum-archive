"use client";

// app/discover/page.js — DISCOVER.
// The full site inventory across every source. Asterisk may route search and
// exploration through the user's Passport, but the user can pause that layer.

import { useEffect, useState, useCallback, useRef } from "react";
import { confidenceBand } from "../../lib/asterisk/confidence.js";
import { getUid, postJSON, authorizedFetch, thumbFor, bagAdd, brainEnabled, aspectFor } from "../../lib/client.js";
import { isNativeItem, startNativeCheckout } from "../../lib/storefront/client.js";
import { followedBrands, setFollowBrand, isDemoItem, DEMO_LABEL } from "../../lib/social.js";
import { readConstraints, releaseConstraint } from "../../lib/search/constraints.js";
import TicketFlow from "../components/TicketFlow.jsx";
import { DiscoverRails } from "../components/DiscoverRails.jsx";
import { AsteriskGuidanceToggle } from "../components/AsteriskMemory.jsx";
import { ColorEvidenceLine, OriginLine, OriginSticker, ProductFitLine, useFitBrain } from "../components/ProductSignals.jsx";
import PageMast from "../components/PageMast.jsx";
import DiscoverTabs from "../components/DiscoverTabs.jsx";
import EntityOverview from "../components/EntityOverview.jsx";
import PlacesPanel from "../components/PlacesPanel.jsx";
import { findEntity } from "../../lib/entities/graph.js";

const TAGS = ["AVANT-GARDE", "SEDUCTIVE", "STATEMENT", "TAILORED", "ARCHIVAL",
  "MINIMAL", "UTILITARIAN", "STREETWEAR", "INDEPENDENT", "GORP"];
const PAGE = 48;

export default function DiscoverPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [sources, setSources] = useState([]);
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [buyNote, setBuyNote] = useState("");

  // Real checkout (18 Aug): only reachable from a server-stamped
  // purchasable item; refusals render the server's own words.
  async function startPurchase(item) {
    // NATIVE COMMERCE (slice 6): a Storefront listing opens Stripe's hosted
    // checkout through the one client (lib/storefront/client.js); the
    // server's words are shown on a refusal. External records keep their
    // ticket / source hand-off housing.
    if (isNativeItem(item)) {
      const r = await startNativeCheckout(item, { user: getUid() });
      if (!r.ok) setBuyNote(r.error);
      return;
    }
    window.location.href = "/checkout?item=" + encodeURIComponent(item.id);
  }
  const [baggedIds, setBaggedIds] = useState(() => new Set());
  const [favedIds, setFavedIds] = useState(() => new Set());
  const [searched, setSearched] = useState("");
  const [followed, setFollowed] = useState([]);
  const [sug, setSug] = useState([]);
  const [ticketItem, setTicketItem] = useState(null);
  const [reading, setReading] = useState(null);      // Asterisk's cultural read of the query
  const [assumption, setAssumption] = useState(null); // Passport influenced-assumption (r10)
  // What the engine says about this rack (Aug 21). Forwarded verbatim by
  // /api/discover; rendered in the existing note typography, never reworded.
  const [engineNote, setEngineNote] = useState(null);
  // What the sentence turned into. Never set by a control — see
  // lib/search/constraints.js.
  const [constraints, setConstraints] = useState([]);
  // V.2: DISCOVER's inner doors. "search" is this page; "places" and
  // "people" render their own panels and leave the racks alone.
  const [dtab, setDtab] = useState("search");
  // When a constrained sentence returns nothing, count the rack behind each
  // constraint alone — so the reader is TOLD which one binds and can release
  // it, never silently widened (lib/search/constraints.js).
  const [missCounts, setMissCounts] = useState(null);
  const [guideOn, setGuideOn] = useState(true);
  const fit = useFitBrain();
  const [activeInterp, setActiveInterp] = useState("");
  const interpRef = useRef(null);                     // active interpretation's tags
  const offsetRef = useRef(0);
  const bootedRef = useRef(false);
  const sugRef = useRef(null);
  const loadRequestRef = useRef({ id: 0, controller: null });
  const suggestRequestRef = useRef({ id: 0, controller: null });

  const load = useCallback(async (reset = true, qOverride = null) => {
    loadRequestRef.current.id++;
    loadRequestRef.current.controller?.abort();
    const requestId = loadRequestRef.current.id;
    const controller = new AbortController();
    loadRequestRef.current.controller = controller;
    setLoading(true);
    setLoadError("");
    if (reset) offsetRef.current = 0;
    const requestOffset = reset ? 0 : offsetRef.current;
    try {
      const qval = qOverride != null ? qOverride : q;
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(requestOffset) });
      if (interpRef.current && interpRef.current.length) {
        // An Asterisk interpretation is active: browse by its tag signals.
        qs.set("tags", interpRef.current.join("|"));
      } else if (qval.trim()) {
        qs.set("q", qval.trim());
        // The server also checks the saved preference; this query flag lets the
        // client request a general rack immediately after guidance is paused.
        qs.set("user", getUid());
        qs.set("brain", guideOn ? "1" : "0");
      }
      if (source) qs.set("source", source);
      if (tag) qs.set("tag", tag);
      if (sort) qs.set("sort", sort);
      const response = await authorizedFetch("/api/discover?" + qs.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("discover unavailable");
      const d = await response.json();
      if (requestId !== loadRequestRef.current.id) return;
      const nextItems = Array.isArray(d.items) ? d.items : [];
      setTotal(d.total || 0);
      setSources(Array.isArray(d.sources) ? d.sources : []);
      setItems((prev) => (reset ? nextItems : [...prev, ...nextItems]));
      offsetRef.current = requestOffset + nextItems.length;
      if (reset) {
        setSearched(qval.trim());
        setAssumption(d.assumption && d.assumption.applied ? d.assumption : null);
        setEngineNote(typeof d.note === "string" && d.note ? d.note : null);
        setConstraints(d.interpreted ? readConstraints(d.interpreted) : []);
      }
    } catch (error) {
      if (requestId === loadRequestRef.current.id && error?.name !== "AbortError") {
        setLoadError("the racks could not be opened — retry");
        if (reset) {
          setItems([]);
          setTotal(0);
          setSources([]);
        }
      }
    } finally {
      if (requestId === loadRequestRef.current.id) {
        loadRequestRef.current.controller = null;
        setLoading(false);
      }
    }
  }, [q, source, tag, sort, guideOn]);

  useEffect(() => { setFollowed(followedBrands()); }, []);
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "places") setDtab(t);
    } catch {}
  }, []);
  useEffect(() => {
    // the binding constraint: one release-query per releasable chip, limit 1
    let cancelled = false;
    if (loading || items.length > 0 || !searched || !constraints.some((c) => c.releasable)) { setMissCounts(null); return; }
    Promise.all(constraints.filter((c) => c.releasable).map(async (c) => {
      const next = releaseConstraint(searched, c);
      if (next === searched || !next.trim()) return { kind: c.kind, label: c.label, total: null };
      try {
        const qs = new URLSearchParams({ q: next, limit: "1", offset: "0", user: getUid(), brain: guideOn ? "1" : "0" });
        const r = await authorizedFetch("/api/discover?" + qs.toString());
        const d = r.ok ? await r.json() : null;
        return { kind: c.kind, label: c.label, total: d ? (d.total || 0) : null, next };
      } catch { return { kind: c.kind, label: c.label, total: null }; }
    })).then((rows) => { if (!cancelled) setMissCounts(rows); });
    return () => { cancelled = true; };
  }, [loading, items.length, searched, constraints, guideOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sync = () => setGuideOn(brainEnabled());
    sync();
    window.addEventListener("asilum:brain", sync);
    return () => window.removeEventListener("asilum:brain", sync);
  }, []);

  useEffect(() => () => {
    if (sugRef.current) clearTimeout(sugRef.current);
    loadRequestRef.current.id++;
    loadRequestRef.current.controller?.abort();
    suggestRequestRef.current.id++;
    suggestRequestRef.current.controller?.abort();
  }, []);

  // Ask Asterisk to READ the query (film / music / city / decade). Misses are
  // honest: entity null → no strip, standard search stands.
  useEffect(() => {
    if (!searched) { setReading(null); setActiveInterp(""); interpRef.current = null; return; }
    const controller = new AbortController();
    const user = guideOn ? "&user=" + encodeURIComponent(getUid() || "") : "";
    authorizedFetch("/api/interpret?q=" + encodeURIComponent(searched) + user, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const keep = d && (d.entity || (d.interpretation &&
          (["ambiguous", "composed"].includes(d.interpretation.method) || d.interpretation.flaggedForResearch)));
        if (!controller.signal.aborted) {
          setReading(keep ? d : null);
          setActiveInterp("");
          interpRef.current = null;
        }
      })
      .catch(() => { if (!controller.signal.aborted) setReading(null); });
    return () => controller.abort();
  }, [searched, guideOn]);

  function cancelSuggestions() {
    if (sugRef.current) clearTimeout(sugRef.current);
    suggestRequestRef.current.id++;
    suggestRequestRef.current.controller?.abort();
    suggestRequestRef.current.controller = null;
    setSug([]);
  }

  function queueSuggestions(value) {
    setQ(value);
    cancelSuggestions();
    if (value.trim().length < 2) return;
    const requestId = suggestRequestRef.current.id;
    sugRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestRequestRef.current.controller = controller;
      try {
        const response = await fetch(
          "/api/suggest?q=" + encodeURIComponent(value.trim()),
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("suggestions unavailable");
        const d = await response.json();
        if (requestId === suggestRequestRef.current.id) {
          setSug(Array.isArray(d.suggestions) ? d.suggestions : []);
        }
      } catch (error) {
        if (requestId === suggestRequestRef.current.id && error?.name !== "AbortError") {
          setSug([]);
        }
      } finally {
        if (requestId === suggestRequestRef.current.id) {
          suggestRequestRef.current.controller = null;
        }
      }
    }, 180);
  }

  function pickInterp(i) {
    interpRef.current = i.tags || [];
    setActiveInterp(i.id);
    load(true);
    // (r17) an applied reading is "this is what I meant" — tell the brain.
    // Fire-and-forget; the server resolves the reading's tags itself and
    // trains only when guidance is on.
    if (searched && i.id && i.id.includes("/")) {
      authorizedFetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: getUid(), query: searched, interpretationId: i.id, verdict: "meant" }),
      }).catch(() => {});
    }
  }
  function clearInterp() {
    interpRef.current = null;
    setActiveInterp("");
    load(true);
  }
  function submitSearch(qOverride = null) {
    // A new query must never inherit the prior query's interpretation tags.
    // Refs update synchronously, avoiding the state/effect race here.
    cancelSuggestions();
    interpRef.current = null;
    setActiveInterp("");
    setReading(null);
    load(true, qOverride);
  }

  // The designer whose rack you're looking at: the last-searched query,
  // matched against the brands actually returned. Exact match wins; a
  // partial match counts only when every result is that one brand.
  const matchedBrand = (() => {
    const qn = searched.toLowerCase();
    if (!qn) return "";
    const exact = items.find((it) => (it.brand || "").toLowerCase() === qn);
    if (exact) return exact.brand;
    const brands = [...new Set(items.map((it) => it.brand).filter(Boolean))];
    if (brands.length === 1 && brands[0].toLowerCase().includes(qn)) return brands[0];
    return "";
  })();

  function toggleFollowBrand() {
    const on = !followed.includes(matchedBrand);
    setFollowed(setFollowBrand(matchedBrand, on));
    if (on) {
      // Feed the follow into the moodboard brain. The lexicon doesn't map
      // designer names, so train on the designer's dominant tags — the same
      // path as typing words into the moodboard training station.
      const w = {};
      for (const it of items) {
        if (it.brand !== matchedBrand) continue;
        for (const [t, v] of Object.entries(it.tags || {})) w[t] = (w[t] || 0) + v;
      }
      const topTags = Object.entries(w)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t]) => t.toLowerCase());
      if (topTags.length) {
        postJSON("/api/train", { user: getUid(), prompt: topTags.join(" ") }).catch(() => {});
      }
    }
  }

  // Boot: honor ?q= from ticker/search links (brand lands pre-searched).
  useEffect(() => {
    const qq = new URLSearchParams(window.location.search).get("q") || "";
    if (qq) setQ(qq);
    load(true, qq);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter changes refetch — skip the mount run so it can't race the boot fetch.
  useEffect(() => {
    if (bootedRef.current) load(true);
    else bootedRef.current = true;
  }, [source, tag, sort, guideOn]); // eslint-disable-line react-hooks/exhaustive-deps

  function fav(it) {
    setFavedIds((p) => new Set(p).add(it.id));
    postJSON("/api/interaction", {
      user: getUid(), item: { id: it.id, tags: it.tags }, action: "favorite",
    }).catch(() => {});
  }
  function bag(it) {
    bagAdd(it);
    setBaggedIds((p) => new Set(p).add(it.id));
    postJSON("/api/interaction", {
      user: getUid(), item: { id: it.id, tags: it.tags }, action: "bag",
    }).catch(() => {});
  }

  const demoOnly = items.length > 0 && items.every(isDemoItem);
  const hasDemo = items.some(isDemoItem);
  const hasNative = items.some((item) => item.commerce_rail === "native_storefront");

  return (
    <div className="wrap">
      <PageMast word="DISCOVER" sub={dtab === "places" ? "AROUND YOU" : "SEARCH · THE OPEN INDEX"} />
      <DiscoverTabs current={dtab} />
      {dtab === "places" && (
        <>
          <p className="deck">what is happening in fashion near you and around the world — events and permanent places, sourced or plainly labelled fixtures.</p>
          <PlacesPanel />
        </>
      )}
      {dtab === "search" && (<>
      <p className="demoline" role="note">
        {demoOnly ? <><b>DEMO ARCHIVE</b> — these results are synthetic sample records with placeholder imagery, not inventory.</>
          : hasDemo ? <><b>MIXED OPEN INDEX</b> — native Storefront inventory appears beside clearly marked synthetic sample records.</>
            : hasNative ? <><b>NATIVE OPEN INDEX</b> — Storefront products use the shared catalog, bag and product detail.</>
              : <><b>OPEN INDEX</b> — every result names its source and availability.</>}
        {" "}{guideOn ? "The Asterisk system is using your Passport to route every search toward your style." : "The Asterisk system is paused, so results stay general."}{" "}{total ? total + " pieces." : ""}
      </p>
      <div className={"searchguide " + (guideOn ? "on" : "off")}>
        <b className="red">*</b> ASTERISK {guideOn ? "GUIDING" : "PAUSED"}
        <span>{guideOn ? "Passport-aware ranking is active" : "Your Passport is saved but not influencing results"}</span>
        <AsteriskGuidanceToggle compact className="fitbtn asearchtoggle" />
      </div>

      <div className="dhints">
        <span className="dhintlbl">✳ NATURAL LANGUAGE ACCEPTED —</span>
        {[
          "black wide leg trousers",
          "something like helmut lang but softer",
          "japanese minimalism from the early 2000s",
          "goretex but elegant",
        ].map((h) => (
          <button key={h} className="dhint" onMouseDown={() => { setQ(h); submitSearch(h); }}>
            » {h}
          </button>
        ))}
      </div>

      <div className="filters">
        <div className="sugwrap">
          <input aria-label="search a piece, feeling, place, film or era"
            type="text"
            placeholder="search a piece, feeling, place, film, era…"
            value={q}
            onChange={(e) => queueSuggestions(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
            onBlur={() => setTimeout(() => setSug([]), 180)}
            style={{ maxWidth: 280, textTransform: "none", fontWeight: 400 }}
          />
          {sug.length > 0 && (
            <div className="sugbox">
              {sug.map((s) => (
                <button
                  key={s.label}
                  className="sugopt"
                  onMouseDown={() => { setQ(s.label); submitSearch(s.label); }}
                >
                  <span className="red">*</span> {s.label}
                  <em>{s.why === "did you mean" ? "did you mean" : s.kind}</em>
                </button>
              ))}
            </div>
          )}
        </div>
        {matchedBrand && (
          <button
            className={"fitbtn" + (followed.includes(matchedBrand) ? " active" : "")}
            onClick={toggleFollowBrand}
          >
            {followed.includes(matchedBrand)
              ? `FOLLOWING ${matchedBrand} ✓`
              : `FOLLOW ${matchedBrand}`}
          </button>
        )}
        <select aria-label="filter by source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">all sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="sort order" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="">default order</option>
          <option value="new">newest</option>
          <option value="price-asc">price ↑</option>
          <option value="price-desc">price ↓</option>
        </select>
      </div>
      <div className="tagfilter">
        {TAGS.map((t) => (
          <button
            key={t}
            className={"chip clickable" + (tag === t ? " cur" : "")}
            onClick={() => setTag(tag === t ? "" : t)}
          >
            {t}
          </button>
        ))}
      </div>
      {reading && reading.entity && (
        <div className="aread">
          <div className="areadhead">
            <b className="red">*</b> ASTERISK READS: {reading.entity.name.toUpperCase()}
            <em> {reading.entity.kind}</em>
            {reading.interpretation && reading.interpretation.method !== "exact" ? (
              <em> · {reading.interpretation.method === "recovered" ? "recovered reading" : reading.interpretation.method}</em>
            ) : null}
            {reading.personalized ? <em> · ordered by your taste</em> : null}
          </div>
          <div className="areadpills">
            {reading.interpretations.map((i) => (
              <button key={i.id} className={"apill" + (activeInterp === i.id ? " cur" : "")}
                title={i.summary} onClick={() => pickInterp(i)}>
                {i.label}
              </button>
            ))}
            {activeInterp ? (
              <button className="apill clearpill" onClick={clearInterp}>× full results</button>
            ) : null}
          </div>
          {activeInterp ? (
            <div className="areadsum">
              {(reading.interpretations.find((i) => i.id === activeInterp) || {}).summary}
            </div>
          ) : null}
          {reading.interpretation && reading.interpretation.confidence.interpretation != null ? (
            <div className="areadnote">
              {/* A BAND, NOT A PERCENTAGE. confidenceBand() was written for
                  exactly this — "returns a phrase, never a bare percentage
                  pretending to be objective truth" — and had never been
                  rendered anywhere, while this line printed the percentage it
                  exists to prevent. 87% claims a precision the evidence does
                  not have; "plausible interpretation" is what is actually
                  known. Constitution A5. */}
              interpretation: <b>{confidenceBand(reading.interpretation.confidence.interpretation)}</b>
              {reading.interpretation.assumptions[0] ? ` — ${reading.interpretation.assumptions[0]}` : ""}
            </div>
          ) : null}
          {reading.entity.trend ? (
            <div className="areadnote">
              trend: <b>{reading.entity.trend.phase}</b> — {reading.entity.trend.note}
              {reading.entity.trend.lastReviewed ? ` (reviewed ${reading.entity.trend.lastReviewed})` : ""}
            </div>
          ) : null}
          {reading.entity.note ? <div className="areadnote">{reading.entity.note}</div> : null}
        </div>
      )}
      {reading && !reading.entity && reading.interpretation &&
        (["ambiguous", "composed", "lexical"].includes(reading.interpretation.method)) && (
        <div className="aread">
          <div className="areadhead">
            <b className="red">*</b> ASTERISK {reading.interpretation.method === "ambiguous" ? "ASKS: WHICH ONE?"
              : reading.interpretation.method === "composed" ? "READS: A COMPOSITION"
              : "READS: STYLE ATTRIBUTES"}
          </div>
          <div className="areadpills">
            {Object.keys(reading.interpretation.attributes?.tags || {}).length ? (
              <button
                className={"apill" + (activeInterp === "attribute-read" ? " cur" : "")}
                onClick={() => pickInterp({
                  id: "attribute-read",
                  tags: Object.keys(reading.interpretation.attributes.tags),
                })}
              >
                use best read
              </button>
            ) : null}
            {reading.interpretation.alternatives.map((a) => (
              <button key={a.feedbackId} className="apill"
                onClick={() => { setQ(a.name); submitSearch(a.name); }}>
                {a.name} <em>{a.kind}</em>
              </button>
            ))}
            {activeInterp === "attribute-read" ? (
              <button className="apill clearpill" onClick={clearInterp}>× full results</button>
            ) : null}
          </div>
          {reading.interpretation.assumptions[0] ? (
            <div className="areadnote">{reading.interpretation.assumptions[0]}</div>
          ) : null}
        </div>
      )}
      {reading && reading.interpretation && reading.interpretation.flaggedForResearch ? (
        <div className="areadnote">
          <b className="red">*</b> asterisk flagged this for research — answering with its best current reading
        </div>
      ) : null}
      {/* THE FILTERS NOBODY SET. Not a control that creates a constraint —
          the sentence already did that. This shows what it became and lets a
          reader take one back, by removing the words that made it and asking
          again. Absent entirely when the sentence carried none, because an
          empty row would advertise a filter mechanism that does not exist.
          docs/INVISIBLE-MACHINERY.md */}
      {searched && findEntity(searched) ? <EntityOverview entity={findEntity(searched)} compact onOpen={(next) => { window.location.href = "/discover?q=" + encodeURIComponent(next.name); }} /> : null}
      {constraints.length > 0 ? (
        <div className="readsback">
          {constraints.map((c, i) => (
            <span className={"readsback-c" + (c.releasable ? "" : " fixed")} key={c.kind + i}>
              {c.label}
              {c.releasable ? (
                <button
                  type="button"
                  aria-label={`search without ${c.label}`}
                  onClick={() => {
                    const next = releaseConstraint(q, c);
                    if (next !== q) { setQ(next); load(true, next); }
                  }}
                >×</button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {engineNote ? (
        <div className="areadnote">
          <b className="red">*</b> {engineNote}
        </div>
      ) : null}
      {assumption && !activeInterp ? (
        <div className="areadnote">
          <b className="red">*</b> passport assumption — narrowed to “{assumption.label || assumption.entity}” ({assumption.tags.join(" · ").toLowerCase()}); pick any reading above to override
        </div>
      ) : null}
      {!searched && !activeInterp && <DiscoverRails onPickTags={pickInterp} />}
      <hr className="rule" />

      {loading && items.length === 0 && <div className="empty">opening the racks…</div>}
      {!loading && loadError && items.length === 0 && (
        <div className="empty">
          {loadError}{" "}
          <button className="fitbtn" onClick={() => load(true)}>RETRY</button>
        </div>
      )}
      {!loading && !loadError && items.length === 0 && (
        <div className="empty">
          {constraints.length > 0 ? "nothing matches every constraint at once." : "nothing matches — loosen a filter."}
          {missCounts && missCounts.length > 0 && (
            <ul className="missrack" aria-label="which constraint binds">
              {missCounts.map((m) => (
                <li key={m.kind + m.label}>
                  without <b>{m.label}</b>: {m.total === null ? "could not count" : m.total === 0 ? "still nothing" : `${m.total} piece${m.total === 1 ? "" : "s"}`}
                  {m.total > 0 && m.next ? <button className="txtbtn" onClick={() => { setQ(m.next); load(true, m.next); }}>RELEASE IT →</button> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The whole card was one clickable div — reachable by mouse only, and it
          wrapped the Favorite/Bag/Buy buttons, so a nested control inside a
          link-shaped region. The title is now the single real control and
          carries the accessible name; the image and card keep their pointer
          affordance. (launch audit, Aug 16) */}
      {buyNote && <p className="pempty" role="status">{buyNote}</p>}
      <div className="grid">
        {items.map((it) => (
          <div
            className="card"
            key={it.id}
            style={{ cursor: "pointer" }}
            onClick={() => { window.location.href = "/?item=" + encodeURIComponent(it.id); }}
          >
            <div className="imgwrap" aria-hidden="true" style={{ aspectRatio: aspectFor(it.id) }}>
              <OriginSticker item={it} />
              <img src={it.img || thumbFor(it)} alt="" loading="lazy" />
            </div>
            <div className="body">
              <div className="brand2">{it.brand}</div>
              <a
                className="ttl"
                href={"/?item=" + encodeURIComponent(it.id)}
                onClick={(e) => e.stopPropagation()}
              >
                {it.title}
              </a>
              <div className="meta">
                {it.category ? <span className="cat">{it.category}</span> : null}
                {/* A demo record carries the demo flag instead of a source
                    label — it has no source to name. */}
                {isDemoItem(it)
                  ? <span className="srclabel demoflag">{DEMO_LABEL}</span>
                  : <span className="srclabel">{it.src}</span>}
              </div>
              <div className="tags">
                {Object.keys(it.tags || {}).slice(0, 3).map((t) => (
                  <span className="t" key={t}>{t}</span>
                ))}
              </div>
              <ColorEvidenceLine item={it} />
              <OriginLine item={it} />
              <ProductFitLine item={it} fit={fit} />
              {it.price ? <div className="price">{it.currency || "USD"} {it.price}</div> : null}
              <div className="cardacts" onClick={(e) => e.stopPropagation()}>
                <button className={favedIds.has(it.id) ? "on" : ""} onClick={() => fav(it)}>
                  {favedIds.has(it.id) ? "Faved ✓" : "Favorite"}
                </button>
                <button className={baggedIds.has(it.id) ? "on" : ""} onClick={() => bag(it)}>
                  {baggedIds.has(it.id) ? "In bag ✓" : "Add to bag"}
                </button>
                {/* DEMO MODE: no Buy on a record the gates answer 409 for.
                    Favorite and bag stay — they are taste signals about a
                    sample, which is exactly what a demo catalog is for.
                    purchasable (server-stamped, 18 Aug) → REAL Stripe
                    checkout; live-sourced but not purchasable → the ticket
                    assistant, as before. */}
                {it.purchasable ? (
                  <button className="buybtn" onClick={() => startPurchase(it)}>Buy ↗</button>
                ) : !isDemoItem(it) ? (
                  <button className="buybtn" onClick={() => setTicketItem(it)}>Buy</button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length < total && (
        <div className="controls" style={{ justifyContent: "center" }}>
          <button className="btn ghost" disabled={loading} onClick={() => load(false)}>
            {loading ? "loading…" : loadError ? "RETRY MORE" : `MORE (${total - items.length} left)`}
          </button>
        </div>
      )}

      {ticketItem && <TicketFlow item={ticketItem} onClose={() => setTicketItem(null)} />}
      </>)}
    </div>
  );
}
