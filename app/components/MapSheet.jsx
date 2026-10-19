"use client";
// app/components/MapSheet.jsx — THE MAP POPUP (V.2 5.5; slice 12; the owner's
// reference of 18 Oct 2026, docs/v2/references/2026-10-18-feed/4.jpg): a
// BRDCST's event or a place card opens the Passport Map above the Feed as a
// popup, never a page away. The head is the reference's: the venue mark, the
// distance and a MAPS ↗ pill at the right, the name, the kind, the rating
// slot, the description, the globe. The pinned place is the registry's row;
// the ring is 30 km around it; the other registry places inside the ring
// ride along. "I WAS THERE" files an attendance claim (17.19) with the
// browser's coarse area if one is on hand — the server decides whether the
// record substantiates it.
//
// Honesty: the rating is drawn ONLY when the record carries one from a named
// source (lib/places/registry.js placeRating) — no row does today, so the
// slot stays empty rather than showing a figure; the distance only with a
// discovery centre on this device; MAPS ↗ is a plain external link to the
// place's own coordinates.

import { useEffect, useState } from "react";
import FashionMap from "./FashionMap.jsx";
import Icon from "./Icons.jsx";
import { ChevronText } from "./Chevrons.jsx";
import { listPlaces, mapsUrl, placeRating, milesLabel } from "../../lib/places/registry.js";
import { getCurrentArea, discoveryCenter } from "../../lib/location.js";
import { distanceMi } from "../../lib/brdcst/index.js";
import { postJSON, getUid } from "../../lib/client.js";
import { haptic } from "../../lib/haptics.js";

export default function MapSheet({ pin = null }) {
  const place = pin ? listPlaces().find((p) => p.id === pin) || null : null;
  const [sel, setSel] = useState(pin);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [miles, setMiles] = useState(null);
  useEffect(() => { setSel(pin); }, [pin]);
  useEffect(() => {
    if (!place) return undefined;
    const read = () => { const c = discoveryCenter(); setMiles(c ? distanceMi(c, place) : null); };
    read();
    window.addEventListener("asilum:location", read);
    return () => window.removeEventListener("asilum:location", read);
  }, [place]);
  if (!place) return <p className="srchfine" role="status">no place on record for this pin.</p>;
  const center = { lat: place.lat, lng: place.lng };
  const near = listPlaces({ near: { lat: place.lat, lng: place.lng, km: 30 } });
  const places = near.some((p) => p.id === place.id) ? near : [place, ...near];
  const started = place.startsAt ? Date.parse(place.startsAt + "T00:00:00Z") - 86_400_000 <= Date.now() : false;
  const rating = placeRating(place);
  const maps = mapsUrl(place);
  const dist = milesLabel(miles);
  async function wasThere() {
    if (busy) return;
    setBusy(true); setNote("");
    haptic("press");
    const area = getCurrentArea();
    const res = await postJSON("/api/passport/attendance", { user: getUid(), eventId: place.id, area: area && Number.isFinite(area.lat) ? { lat: area.lat, lng: area.lng, at: area.at || Date.now() } : null }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { setNote((d && d.error) || "the claim did not save"); return; }
    setNote(d.record.status === "substantiated" ? `WENT · substantiated — ${d.record.evidence[0].note}` : `WENT · claimed — ${d.record.reason}`);
  }
  return (
    <div className="mapsheet">
      <header className="placehead">
        <span className="placeicon" aria-hidden="true"><Icon name="venue" size={44} /></span>
        <span className="placeheadright">
          {dist ? <span className="placedist">{dist}</span> : null}
          {maps ? <a className="mapspill" href={maps} target="_blank" rel="noopener noreferrer">MAPS ↗</a> : null}
        </span>
        <b className="placename">{place.name}</b>
        <span className="placekind">{String(place.kind || "")}{place.sample ? " · sample fixture" : ""}</span>
        {rating ? (
          <a className="placerating" href={rating.url} target="_blank" rel="noopener noreferrer" title={"rating from " + rating.source}>
            <Icon name="star" size={16} /> {rating.value.toFixed(1)} <small>({rating.count >= 1000 ? Math.round(rating.count / 1000) + "K" : rating.count})</small>
          </a>
        ) : null}
        <span className="placeglobe" aria-hidden="true"><Icon name="globe" size={20} /></span>
      </header>
      <div className="placedesc">
        <span className="placedesclbl">Description</span>
        {place.organizer ? <ChevronText as="p" text={place.organizer} /> : null}
        {place.note ? <ChevronText as="p" className="fine" text={place.note} /> : null}
        <span className="fine">{[place.city, place.startsAt ? place.startsAt + (place.endsAt && place.endsAt !== place.startsAt ? " → " + place.endsAt : "") : null, place.admission ? "admission · " + place.admission : null].filter(Boolean).join(" · ")}</span>
        {place.address ? <span className="fine">{place.address}</span> : null}
      </div>
      <FashionMap mode="local" center={center} km={30} places={places} selectedId={sel} onSelect={setSel} label={place.city || place.name} />
      <div className="mapsheetacts">
        <a className="txtbtn" href={"/map?pin=" + encodeURIComponent(place.id)}>THE FULL MAP →</a>
        {place.sourceUrl ? <a className="txtbtn" href={place.sourceUrl} target="_blank" rel="noopener noreferrer">THE ORGANIZER ↗</a> : <span className="fine">no public listing to link</span>}
        {place.dated && !place.sample && started ? <button type="button" className="txtbtn" disabled={busy} onClick={wasThere}>I WAS THERE ✓</button> : null}
      </div>
      {note ? <p className="fine" role="status">{note}</p> : null}
    </div>
  );
}
