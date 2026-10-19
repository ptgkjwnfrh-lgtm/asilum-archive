"use client";

// app/components/SearchSheet.jsx — THE SEARCH POPUP, cut to the owner's
// primary reference (18 Oct 2026, the search popup picture; V.2 chapter 16).
// The popup holds its own field: "Find your next connection." in Michroma,
// the deck line in the description face (Share Tech Mono), the field with a
// hairline under it, the tabs ALL · PEOPLE · PIECES · POSTS · PLACES with the
// active one in red, then the ASILUM OVERVIEW card for a recognized person,
// the DESIGNER: HOUSE query rows the career registry knows (each a search,
// with the ↗), and the results by tab: pieces (/api/discover, every
// constraint kept, the Passport's order when ASTERISK is on), posts (the
// editorial endpoint), places (the map's register). "Search all ASILUM"
// leads to the full /discover page with the same query. The deck's field
// and this one are the same query (lib/dockstate.js setQuery).

import { useEffect, useRef, useState } from "react";
import { useDock, pushSheet, unpinTag, setQuery, flipToggle } from "../../lib/dockstate.js";
import AMark from "./AMark.jsx";
import { TagChip } from "./TagChip.jsx";
import { authorizedFetch, getUid, thumbFor } from "../../lib/client.js";
import { fetchPosts } from "../../lib/social.js";
import { findEntity } from "../../lib/entities/graph.js";
import { isDemoItem, DEMO_LABEL } from "../../lib/social.js";
import { haptic } from "../../lib/haptics.js";
import Icon from "./Icons.jsx";
import SaveButton from "./SaveButton.jsx";
import ModelTag from "./ModelTag.jsx";
import OverviewPreview from "./OverviewPreview.jsx";

const PIECES = 12, POSTS = 8, PLACES = 6;
export const SEARCH_TABS = Object.freeze([["all", "All"], ["people", "People"], ["pieces", "Pieces"], ["posts", "Posts"], ["places", "Places"]]);

/** The filter chips a long-press pinned; a tap unpins. */
function PinnedRow({ pins }) {
  return (
    <div className="tagrow popup pins" role="list" aria-label="pinned filters">
      {pins.map((p) => <span role="listitem" key={p.key}><TagChip tag={{ ...p, family: "pin" }} pinned onUnpin={unpinTag} /></span>)}
    </div>
  );
}

/** A DESIGNER: HOUSE row from the career registry — a query, never a fact invented here. */
function QueryRow({ text, onPick }) {
  return (
    <li className="srchq">
      <button type="button" className="srchqbtn" onClick={() => { haptic("press"); onPick(text); }}>
        <Icon name="search" size={18} />
        <span className="srchqtext">{text}</span>
        <span className="srchqgo" aria-hidden="true">↗</span>
      </button>
    </li>
  );
}

export default function SearchSheet() {
  const dock = useDock();
  const q = String(dock.q || "").trim();
  const { pieces: wantPieces, wire: wantPosts, asterisk } = dock.toggles;
  const pins = dock.pins || [];
  const pinKey = pins.map((p) => p.key).join("|");
  const [tab, setTab] = useState("all");
  const [res, setRes] = useState({ q: "", items: [], total: 0, posts: [], places: [], related: [], person: null, note: null, loading: false, error: "" });
  const fieldRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => fieldRef.current && fieldRef.current.focus(), 60); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (!q) { setRes({ q: "", items: [], total: 0, posts: [], places: [], related: [], person: null, note: null, loading: false, error: "" }); return undefined; }
    let live = true;
    setRes((r) => ({ ...r, q, loading: true, error: "" }));
    const h = setTimeout(async () => {
      const out = { q, items: [], total: 0, posts: [], places: [], related: [], person: null, note: null, loading: false, error: "" };
      try {
        const qs = new URLSearchParams({ q, limit: String(PIECES) });
        if (pins.length) qs.set("pins", pins.map((p) => p.text).join("|"));
        if (asterisk) { qs.set("brain", "1"); const uid = getUid(); if (uid) qs.set("user", uid); }
        const r = await authorizedFetch("/api/discover?" + qs.toString());
        if (r.ok) {
          const d = await r.json();
          if (wantPieces) { out.items = d.items || []; out.total = d.total || out.items.length; }
          out.related = Array.isArray(d.related) ? d.related : [];
          // the server's overview (the career registry, a prefix allowed): the contract Entity → the preview's person
          if (d.overview && d.overview.name) {
            const srcs = Object.fromEntries((d.overview.sources || []).map((x) => [x.id, { url: x.url, publisher: x.publisher }]));
            const first = (d.overview.sources || [])[0];
            out.person = { id: d.overview.id, name: d.overview.name, summary: d.overview.overview && d.overview.overview.summary ? d.overview.overview.summary.text : "", image: d.overview.image || null, sources: srcs, facts: first ? [{ source: first.id }] : [], registry: true, brdcst: Array.isArray(d.overview.brdcst) ? d.overview.brdcst : [] };
          }
          out.note = d.note || d.engineNote || null;
        } else out.error = "the index did not answer";
        if (wantPosts) {
          const w = await fetchPosts("user", 60);
          const needle = q.toLowerCase();
          out.posts = (w.posts || []).filter((p) => [p.title, p.text, p.name, p.handle, ...(p.tags || [])].join(" ").toLowerCase().includes(needle)).slice(0, POSTS);
        }
        const pl = await fetch("/api/places").then((x) => (x.ok ? x.json() : { places: [] })).catch(() => ({ places: [] }));
        const needle = q.toLowerCase();
        out.places = (pl.places || []).filter((p) => [p.name, p.city, p.kind, p.organizer, ...(p.tags || [])].join(" ").toLowerCase().includes(needle)).slice(0, PLACES);
      } catch { out.error = "search is unavailable right now"; }
      if (live) setRes(out);
    }, 180);
    return () => { live = false; clearTimeout(h); };
  }, [q, wantPieces, wantPosts, asterisk, pinKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // an entity overview is eligible regardless of the content toggles (brief, decision 4):
  // the server's (the career registry, three letters enough) first, the client graph's houses and spots after
  const overview = q ? (res.person || findEntity(q)) : null;
  const show = (k) => tab === "all" || tab === k;
  const pick = (text) => { setQuery(text); setTab("all"); };
  const rows = res.related.map((r) => (r.designer && r.house ? `${r.designer}: ${r.house}` : r.queryText || "")).filter(Boolean);
  const queryRows = [...new Set(rows)].slice(0, 6);

  return (
    <div className="srch srchref">
      <h2 className="srchhead">Find your next connection.</h2>
      <p className="srchdeck">People, pieces, places and ideas — one search.</p>
      <label className="srchfield">
        <Icon name="search" size={22} />
        <input ref={fieldRef} type="search" value={dock.q} placeholder="Search ASILUM" aria-label="Search ASILUM" onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        <button type="button" className={"srchamark" + (asterisk ? " on" : "")} aria-pressed={!!asterisk} onClick={() => { haptic("toggle"); flipToggle("asterisk"); }} title={asterisk ? "ASTERISK reads your Passport — tap to search without it" : "tap to let ASTERISK read your Passport"}>
          <AMark className={asterisk ? "on" : ""} label={asterisk ? "ASTERISK on" : "ASTERISK off"} />
        </button>
      </label>
      <div className="srchtabs" role="tablist" aria-label="what to search">
        {SEARCH_TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" className={"srchtab" + (tab === id ? " cur" : "")} aria-selected={tab === id} onClick={() => { haptic("tick"); setTab(id); }}>{label}</button>
        ))}
      </div>
      {pins.length ? <PinnedRow pins={pins} /> : null}

      {!q && <p className="srchfine">Handles, pieces, places, eras, a feeling. Nothing is searched until you type.</p>}

      {q && show("people") && overview && (
        <>
          <OverviewPreview person={overview} onOpen={() => pushSheet("overview", { entity: overview, title: overview.name.toUpperCase() })} />
          {/* 16.3: the BRDCSTs in reach that name this entity, one line each, under the overview */}
          {overview.brdcst && overview.brdcst.length ? (
            <ul className="srchbrdcst" aria-label="broadcasts in your reach">
              {overview.brdcst.slice(0, 3).map((b) => <li key={b.id}><a href={b.href}>{b.line} →</a></li>)}
            </ul>
          ) : null}
        </>
      )}
      {q && show("people") && queryRows.length > 0 && (
        <ul className="srchqs" aria-label="searches the registry knows">
          {queryRows.map((t) => <QueryRow key={t} text={t} onPick={pick} />)}
        </ul>
      )}
      {q && !res.loading && !overview && !queryRows.length && (tab === "people" || (tab === "all" && !res.items.length && !res.posts.length && !res.places.length)) && <p className="srchfine" role="status">{tab === "people" ? "no person on record reads that way." : "nothing on record reads that way yet — keep typing, or search all ASILUM."}</p>}

      {q && res.loading && <p className="srchfine" role="status">reading…</p>}
      {q && res.error && <p className="srchfine" role="status">{res.error}</p>}
      {q && wantPieces && res.note && typeof res.note === "string" && tab === "pieces" && <p className="srchfine">{res.note}</p>}

      {q && wantPieces && !res.loading && show("pieces") && (tab === "pieces" || res.items.length > 0) && (
        <section className="srchsec" aria-label="pieces">
          <div className="srchlbl">PIECES {res.total ? `· ${res.total}` : ""}</div>
          {res.items.length ? (
            <ul className="srchgrid">
              {res.items.map((it) => (
                <li key={it.id} className="srchcard" data-id={it.id}>
                  <a className="srchimg" href={"/?item=" + encodeURIComponent(it.id)} aria-label={it.title}>
                    <img src={it.img || thumbFor(it)} alt="" loading="lazy" />
                  </a>
                  <div className="srchbody">
                    <span className="brand2">{it.brand}</span>
                    <a className="ttl" href={"/?item=" + encodeURIComponent(it.id)}>{it.title}</a>
                    <span className="likemeta">{isDemoItem(it) ? DEMO_LABEL : it.src}{it.price ? ` · ${it.currency || "USD"} ${it.price}` : ""}</span>
                    <SaveButton kind="piece" id={it.id} title={it.title} image={it.img || thumbFor(it)} href={"/?item=" + encodeURIComponent(it.id)} meta={it.brand} tags={Object.keys(it.tags || {})} item={it} className="savew" />
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="srchfine" role="status">no pieces read that way.</p>}
        </section>
      )}

      {q && wantPosts && !res.loading && show("posts") && (tab === "posts" || res.posts.length > 0) && (
        <section className="srchsec" aria-label="posts">
          <div className="srchlbl">POSTS</div>
          {res.posts.length ? (
            <ul className="likelist">
              {res.posts.map((p) => (
                <li key={p.id} className="likerow" data-id={p.id}>
                  {p.imageUrl ? <img className="likeimg" src={p.imageUrl} alt="" loading="lazy" /> : <span className="likeimg blank" aria-hidden="true" />}
                  <div className="likebody">
                    <a className="liketitle" href={p.serverId != null ? "/?post=" + encodeURIComponent(p.serverId) : "/"}>{p.title || (p.text || "").slice(0, 80)}</a>
                    <span className="likemeta">{p.name || p.handle}{p.sample ? " · SAMPLE" : ""}</span>
                  </div>
                  {p.sample ? <ModelTag kind="sample">SAMPLE</ModelTag> : null}
                </li>
              ))}
            </ul>
          ) : <p className="srchfine" role="status">no posts match that.</p>}
        </section>
      )}

      {q && !res.loading && show("places") && (tab === "places" || res.places.length > 0) && (
        <section className="srchsec" aria-label="places">
          <div className="srchlbl">PLACES</div>
          {res.places.length ? (
            <ul className="srchqs">
              {res.places.map((p) => (
                <li key={p.id} className="srchq">
                  <a className="srchqbtn" href={"/map?pin=" + encodeURIComponent(p.id)}>
                    <Icon name="map" size={18} />
                    <span className="srchqtext">{p.name}<span className="srchqmeta"> · {String(p.kind || "").toUpperCase()} · {p.city}{p.sample ? " · SAMPLE FIXTURE" : ""}</span></span>
                    <span className="srchqgo" aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="srchfine" role="status">no place on the map reads that way.</p>}
        </section>
      )}

      {q && <a className="srchall" href={"/discover?q=" + encodeURIComponent(q)}>SEARCH ALL ASILUM →</a>}
    </div>
  );
}
