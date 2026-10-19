"use client";

// app/components/PlaceCard.jsx — THE PLACE CARD (V.2 Blueprint, owner, 17
// Oct 2026, Foundations: PLACE at 20% weight; the owner's reference of 18
// Oct 2026, docs/v2/references/2026-10-18-feed/2.jpg: a rounded card with a
// line-drawn venue mark, the distance "305 mi" large at the right, the name
// beneath, a small globe in the corner). A tap opens the `map` popup
// (MapSheet.jsx, 5.5) with the place pinned — the description, the MAPS ↗
// link and the organizer live there; the card itself stays compact.
//
// Honesty: the distance is printed only when this device has a discovery
// centre (lib/location.js — the current area it shared this session, else
// the confirmed base city), read after mount so the server and the first
// paint agree; a sample fixture says SAMPLE FIXTURE; a rating is never
// drawn here (lib/places/registry.js placeRating draws one in the popup
// only when a real source holds it).

import { useEffect, useState } from "react";
import { haptic } from "../../lib/haptics.js";
import { openSheet } from "../../lib/dockstate.js";
import { discoveryCenter } from "../../lib/location.js";
import { distanceMi } from "../../lib/brdcst/index.js";
import { milesLabel } from "../../lib/places/registry.js";
import Icon from "./Icons.jsx";

export default function PlaceCard({ place: p }) {
  const [miles, setMiles] = useState(null);
  useEffect(() => {
    const read = () => { const c = discoveryCenter(); setMiles(c ? distanceMi(c, p) : null); };
    read();
    window.addEventListener("asilum:location", read);
    return () => window.removeEventListener("asilum:location", read);
  }, [p]);
  const when = p.dated && p.startsAt ? p.startsAt + (p.endsAt && p.endsAt !== p.startsAt ? " → " + p.endsAt : "") : null;
  const label = milesLabel(miles);
  return (
    <article className="card placecard" data-id={"place:" + p.id} data-type="PLACE" aria-label={"place: " + p.name}>
      <button type="button" className="placeopen" onClick={() => { haptic("press"); openSheet("map", { pin: p.id, title: "MAP" }); }} aria-label={"open the map for " + p.name}>
        <span className="placeicon" aria-hidden="true"><Icon name="venue" size={34} /></span>
        {label ? <span className="placedist">{label}</span> : <span className="placedist quiet" title="the distance appears once a base city or your current area is shared on the map">—</span>}
        <b className="placename">{p.name}</b>
        <span className="placemeta">{String(p.kind || "").toUpperCase()}{p.city ? " · " + p.city : ""}{when ? " · " + when : ""}{p.sample ? " · SAMPLE FIXTURE" : ""}</span>
        <span className="placeglobe" aria-hidden="true"><Icon name="globe" size={18} /></span>
      </button>
    </article>
  );
}
