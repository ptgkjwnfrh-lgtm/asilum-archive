"use client";

// app/components/EntityOverview.jsx — the ASILUM OVERVIEW for any entity in
// the graph (V.2 brief §9): a designer (PersonOverview's card, plus the
// houses in chronological order as scrollable labelled chips with role and
// dates), a house (name, origin as editorial knowledge or sourced fact,
// the designers who worked there in order, linking back), a spot (public
// name, type, locality, sourced description, the official page, the map),
// an artist or a passenger (the honest metadata card). What a record cannot
// cite it does not say: `missing` is printed as "no approved … yet", never
// filled with prose.
//
// STAMP (the brief: "Stamp adds the entity/era to the user's editable taste
// record and confirms the exact effect") — on a designer or a house: the
// one save (kind person/place) + FOLLOW the brand, which the existing
// follow law routes to /api/train on the brand's tags. The confirmation
// says exactly that and nothing more.

import { ChevronText } from "./Chevrons.jsx";
import { useState } from "react";
import PersonOverview from "./PersonOverview.jsx";
import SaveButton from "./SaveButton.jsx";
import ModelTag from "./ModelTag.jsx";
import { overviewFor, chronologyFor } from "../../lib/entities/graph.js";
import { overviewById } from "../../lib/people/overviews.js";
import { setFollowBrand, followedBrands } from "../../lib/social.js";

const span = (c) => `${c.start || "?"} – ${c.end || "now"}`;

function Chips({ items, label, onOpen }) {
  if (!items.length) return null;
  return (
    <div className="eochips" role="group" aria-label={label}>
      <span className="cclbl">{label}</span>
      <div className="eochiprow">
        {items.map((c, i) => {
          const e = c.house || c.designer;
          return (
            <button key={e.id + i} className="eochip" onClick={() => onOpen && onOpen(e)}>
              <b>{e.name}</b>
              <span>{c.role} · {span(c)}</span>
              {c.source ? <i>{c.source.publisher}</i> : <i>unsourced</i>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stamp({ entity, brand, effect }) {
  const [on, setOn] = useState(() => { try { return followedBrands().includes(brand); } catch { return false; } });
  const [said, setSaid] = useState("");
  function stamp() {
    const next = !on; setOn(next);
    try { setFollowBrand(brand, next); } catch {}
    setSaid(next ? effect : "unstamped — the follow is removed; the save stays until you remove it in your Passport");
  }
  return (
    <div className="eostamp">
      <SaveButton kind={entity.type === "spot" ? "place" : "person"} id={entity.id} title={entity.name} href={"/discover?q=" + encodeURIComponent(entity.name)} meta={entity.type.toUpperCase()} tags={entity.tags || []} />
      <button className={"followbtn" + (on ? " on" : "")} aria-pressed={on} onClick={stamp}>{on ? "STAMPED" : "STAMP"}</button>
      {said ? <p className="fine" role="status">{said}</p> : null}
    </div>
  );
}

export default function EntityOverview({ entity, compact = false, onOpen }) {
  const o = overviewFor(entity);
  if (!o) return null;
  const sources = o.sources || [];
  const missing = (o.missing || []).length ? <p className="eomissing">no approved {o.missing.join(", ")} yet — a link is shown where one exists; nothing is written to fill the space.</p> : null;

  if (o.type === "designer") {
    const person = overviewById(o.id);
    return (
      <div className="eo eo-designer">
        {person ? <PersonOverview person={person} compact={compact} /> : null}
        <Chips items={chronologyFor(o.id)} label="HOUSES, IN ORDER" onOpen={onOpen} />
        {o.quote ? <blockquote className="eoquote">“{o.quote.text}” <cite>— {o.quote.source && o.quote.source.publisher}</cite></blockquote> : null}
        {missing}
        <Stamp entity={o} brand={o.name} effect={`stamped: ${o.name} is saved to your Passport and followed — a follow trains your taste on the house's tags and lifts their pieces in FOLLOWING. nothing else changes.`} />
      </div>
    );
  }
  if (o.type === "house") {
    return (
      <section className="eo eo-house" aria-label={"overview: " + o.name}>
        <div className="povkick">THE HOUSE</div>
        <h2 className="eoname">{o.name}</h2>
        <p className="eoorigin">{o.origin || "origin not recorded"}{o.basis ? ` — ${o.basis}` : ""}</p>
        {o.editorialNote ? <p className="fine">{o.editorialNote} <ModelTag kind="device">EDITORIAL</ModelTag></p> : o.basisSource ? <p className="fine">basis: <a href={o.basisSource.url} target="_blank" rel="noreferrer">{o.basisSource.publisher} ↗</a></p> : null}
        <Chips items={o.designers} label="DESIGNERS WHO WORKED HERE, IN ORDER" onOpen={onOpen} />
        {missing}
        <Stamp entity={o} brand={o.name} effect={`stamped: ${o.name} is saved to your Passport and followed — a follow trains your taste on the house's tags and lifts its pieces in FOLLOWING. nothing else changes.`} />
        <a className="txtbtn" href={"/discover?q=" + encodeURIComponent(o.name)}>PIECES FROM {o.name.toUpperCase()} →</a>
      </section>
    );
  }
  if (o.type === "spot") {
    return (
      <section className="eo eo-spot" aria-label={"overview: " + o.name}>
        <div className="povkick">THE SPOT · {String(o.kind || "").toUpperCase()}</div>
        <h2 className="eoname">{o.name}</h2>
        <p className="eoorigin">{o.locality}{o.address ? ` · ${o.address}` : ""}</p>
        {o.description ? <ChevronText as="p" className="povsum" text={o.description} /> : null}
        {missing}
        <div className="eolinks">
          {o.sourceUrl ? <a className="txtbtn" href={o.sourceUrl} target="_blank" rel="noreferrer">OFFICIAL PAGE ↗</a> : null}
          <a className="txtbtn" href={"/map?pin=" + encodeURIComponent(o.placeId)}>ON THE MAP →</a>
        </div>
        {o.lastChecked ? <p className="fine">checked {o.lastChecked} · venue facts are separate from any paid placement</p> : null}
        <Stamp entity={o} brand={o.name} effect={`stamped: ${o.name} is saved to your Passport's places.`} />
      </section>
    );
  }
  if (o.type === "passenger") {
    return (
      <section className="eo eo-passenger" aria-label={"overview: " + o.name}>
        <div className="povkick">THE PASSENGER</div>
        <h2 className="eoname">{o.name}</h2>
        <p className="fine">NOT YET VERIFIED — {o.eligibility.rule}. {o.eligibility.state}</p>
        {missing}
      </section>
    );
  }
  return (
    <section className="eo" aria-label={"overview: " + o.name}>
      <div className="povkick">THE {String(o.type).toUpperCase()}</div>
      <h2 className="eoname">{o.name}</h2>
      {missing}
      {sources.length ? <ul className="eosources">{sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.publisher} ↗</a></li>)}</ul> : null}
    </section>
  );
}
