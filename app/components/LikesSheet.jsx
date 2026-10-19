"use client";

// app/components/LikesSheet.jsx — LIKES (V.2 brief, owner, 1 Oct 2026, §5).
// Top subtabs: Pieces | Wire | Sold. The one save (lib/save.js) is the
// record: Pieces lists saved pieces, Wire lists saved posts. Sold keeps the
// likes whose listing later had a CONFIRMED sold status, with the listing
// snapshot and the sold date — a status that only a ListingStatus service
// with provider adapters can set (brief §13), which does not exist yet. So
// Sold shows that honestly as an unavailable state, and the Pieces tab
// cannot exclude sold listings it has no way to know about: it says so.
//
// Each subtab searches within itself through the dock's scoped field
// (scope likes-pieces / likes-wire / likes-sold; lib/dock.js) — exact
// substring over title, meta and tags, never an invented match. Each
// subtab's query is its own (lib/dockstate.js keeps one query per sheet
// life; the subtab change clears it so a Wire query never leaks into Sold).

import VerificationBadge from "./VerificationBadge.jsx";
import { useEffect, useMemo, useState } from "react";
import { listSaves, unsave } from "../../lib/save.js";
import { useDock, setLikesTab, setQuery } from "../../lib/dockstate.js";
import { getUid, authorizedFetch } from "../../lib/client.js";
import ModelTag from "./ModelTag.jsx";

const STATUS_WORD = { available: "AVAILABLE", sold: "SOLD", ended: "ENDED", removed: "REMOVED", unavailable: "UNAVAILABLE", price_changed: "PRICE CHANGED", source_unavailable: "SOURCE DOWN", unknown: "" };

const TABS = [["pieces", "PIECES"], ["wire", "POSTS"], ["sold", "SOLD"]];

function matches(rec, q) {
  if (!q) return true;
  const hay = [rec.title, rec.meta, ...(rec.tags || [])].join(" ").toLowerCase();
  return hay.includes(q);
}

export default function LikesSheet() {
  const dock = useDock();
  const tab = dock.likesTab;
  const [saves, setSaves] = useState([]);
  const [tick, setTick] = useState(0);
  const q = String(dock.q || "").trim().toLowerCase();

  // the LISTING STATUS of every saved piece (V.2 brief §5): read from the
  // server by id — a saved piece's status is the listing's, checked by the
  // ListingStatus service; the Sold tab is the saves whose listing has a
  // CONFIRMED sold status, with the sold date from the status event.
  const [status, setStatus] = useState({});
  useEffect(() => {
    const kind = tab === "wire" ? "post" : "piece";
    setSaves(listSaves(kind));
  }, [tab, tick]);
  useEffect(() => {
    if (tab === "wire") return undefined;
    const ids = saves.map((r) => r.id).slice(0, 60);
    if (!ids.length) { setStatus({}); return undefined; }
    let live = true;
    fetch("/api/items?ids=" + encodeURIComponent(ids.join(","))).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }))
      .then((d) => { if (!live) return; const map = {}; for (const it of d.items || []) map[it.id] = it; setStatus(map); });
    return () => { live = false; };
  }, [saves, tab]);
  // opening SOLD reads the notices for these listings as read
  useEffect(() => {
    if (tab !== "sold") return;
    const uid = getUid();
    if (!uid) return;
    authorizedFetch("/api/notifications?user=" + encodeURIComponent(uid) + "&unread=1").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const ids = (d && d.notifications || []).filter((n) => n.kind === "liked-sold").map((n) => n.id);
      if (ids.length) authorizedFetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: uid, read: ids }) }).catch(() => {});
    }).catch(() => {});
  }, [tab]);

  const statusOf = (r) => (status[r.id] && status[r.id].availability_status) || "unknown";
  const rows = useMemo(() => saves.filter((r) => matches(r, q)).filter((r) => {
    if (tab === "sold") return statusOf(r) === "sold";
    if (tab === "pieces") return statusOf(r) !== "sold";   // a confirmed sale leaves Pieces for Sold
    return true;
  }), [saves, q, tab, status]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(next) { setLikesTab(next); setQuery(""); }
  async function drop(rec) { await unsave(rec.kind, rec.id); setTick((t) => t + 1); }

  return (
    <div className="likes">
      <div className="seg likestabs" role="tablist" aria-label="likes">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" className={"tab" + (tab === id ? " cur" : "")} aria-selected={tab === id} onClick={() => pick(id)}>{label}</button>
        ))}
      </div>

      {tab === "sold" && !rows.length ? (
        <div className="sheetnote" role="status">
          <p className="deck">Nothing you kept has a confirmed sale yet.</p>
          <p className="fine">A like moves here only when its listing has a <b>confirmed</b> sold status from the marketplace it came from — the ListingStatus service re-checks kept listings on its schedule. A listing that merely disappeared reads REMOVED, never sold. You are told once, in-app, when one sells; the switch is in SETTINGS.</p>
        </div>
      ) : (
        <>
          {tab === "pieces" && saves.length > 0 && (
            <p className="fine likesfine">status is the listing's, as last checked by the marketplace adapter; ENDED, REMOVED and UNAVAILABLE stay here — only a confirmed sale moves to SOLD.</p>
          )}
          {q && <p className="fine likesfine" role="status">{rows.length} of {saves.length} match “{dock.q}”</p>}
          {rows.length ? (
            <ul className="likelist">
              {rows.map((r) => (
                <li key={r.kind + ":" + r.id} className="likerow" data-id={r.id}>
                  {r.image ? <img className="likeimg" src={r.image} alt="" loading="lazy" /> : <span className="likeimg blank" aria-hidden="true" />}
                  <div className="likebody">
                    <a className="liketitle" href={r.href || "#"}>{r.title}</a>
                    {r.meta ? <span className="likemeta">{r.meta}</span> : null}
                    {r.tags && r.tags.length ? <span className="likemeta">{r.tags.slice(0, 3).join(" · ")}</span> : null}
                    {tab !== "wire" && status[r.id] && status[r.id].verification ? <VerificationBadge badge={status[r.id].verification} compact /> : null}
                    {tab !== "wire" && status[r.id] && !status[r.id].missing ? (
                      <span className={"likestatus " + statusOf(r)}>
                        {STATUS_WORD[statusOf(r)] || ""}
                        {status[r.id].statusEvent && status[r.id].statusEvent.toStatus === "sold" ? ` · sold ${status[r.id].statusEvent.observedAt.slice(0, 10)} · ${status[r.id].statusEvent.provider}` : ""}
                        {status[r.id].lastCheckedAt ? ` · checked ${status[r.id].lastCheckedAt.slice(0, 10)}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <button className="txtbtn" onClick={() => drop(r)} aria-label={"remove " + r.title + " from likes"}>REMOVE</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pempty" role="status">
              {q ? "nothing in your " + (tab === "wire" ? "liked posts" : "liked pieces") + " matches that."
                : tab === "wire" ? "no liked posts yet — STAMP on a post keeps it here." : "no liked pieces yet — SAVE on a piece keeps it here."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
