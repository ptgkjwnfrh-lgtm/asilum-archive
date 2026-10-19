"use client";

// app/components/Placements.jsx — the ONE reading of placements the dock's
// strip and the Front Cover's block share (V.2 brief §1, 1 Oct 2026:
// "Reuse campaign IDs and event/venue IDs so this is one connected system,
// not duplicate advertising databases"). lib/placements.js is the law;
// this is the hook that feeds it the records — the dated rows of the
// places record and this device's Studio drafts — and the cover's block.
//
// The cover keeps the Hot List and the placements VISIBLY apart: different
// kicker, different rows, and a line saying a placement is bought while a
// booth is held — paid placement never implies an editorial ranking.

import { useEffect, useState } from "react";
import { tickerItems } from "../../lib/placements.js";
import { readDrafts } from "../../lib/studio/drafts.js";
import { getUid } from "../../lib/client.js";
import { discoveryCenter } from "../../lib/location.js";

export function usePlacements() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    const today = new Date().toISOString().slice(0, 10);
    // SPONSORED entries are live BRDCST campaigns in reach of THIS viewer
    // (V.2 chapter 5; slice 8): taste first, distance second, by the server
    const qs = new URLSearchParams({ ticker: "1" });
    const uid = getUid(); if (uid) qs.set("user", uid);
    const c = discoveryCenter(); if (c) { qs.set("lat", String(c.lat)); qs.set("lng", String(c.lng)); }
    Promise.all([
      fetch("/api/places?dated=1").then((r) => (r.ok ? r.json() : { places: [] })).catch(() => ({ places: [] })),
      fetch("/api/brdcst?" + qs.toString()).then((r) => (r.ok ? r.json() : { placements: [] })).catch(() => ({ placements: [] })),
    ]).then(([d, b]) => { if (live) setItems(tickerItems({ placements: b.placements || [], drafts: readDrafts(), places: d.places || [], today })); });
    return () => { live = false; };
  }, []);
  return items;
}

export default function PlacementsBlock() {
  const items = usePlacements();
  return (
    <section className="cvsponsored" aria-label="sponsored placements">
      <div className="cvkick">SPONSORED PLACEMENTS</div>
      <p className="cvnote">a business or event buys a placement here; it is labelled wherever it appears and buys nothing else — not a booth, not verification, not a ranking. the hotlist beside it is held, never bought.</p>
      {items === null ? (
        <p className="pempty" role="status">reading placements…</p>
      ) : items.length ? (
        <ul className="cvplacements">
          {items.map((it) => (
            <li key={it.id}>
              <span className={"adtag " + it.kind}>{it.label}</span>
              <a className="cvnearname" href={it.href}>{it.line}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pempty" role="status">no sponsored placements yet — a business requests one in its Studio.</p>
      )}
    </section>
  );
}
