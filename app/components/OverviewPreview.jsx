"use client";

// app/components/OverviewPreview.jsx — the ASILUM OVERVIEW card in search,
// cut to the primary reference (IMG_0999, V.2 brief, 1 Oct 2026): the
// portrait at the left with the lettering *ASILUM OVERVIEW behind its
// shoulder and a soft fade at its lower edge; the name, the SUMMARY FROM
// <source ↗> line, a compressed readable summary, and READ MORE. On a
// narrow screen the portrait and the text stack. Everything printed comes
// from the sourced record (lib/people/overviews.js) — the reference's own
// sample biography is a picture, not a fact.

import Icon from "./Icons.jsx";

import { overviewFor } from "../../lib/entities/graph.js";

/** The compressed preview of ANY entity (V.2 brief §9): a designer with
 *  the portrait, a house or a spot with its one line. `person` may be an
 *  entity from lib/entities/graph.js or a legacy overview record. */
export default function OverviewPreview({ person, onOpen }) {
  if (!person) return null;
  const o = person.type ? overviewFor(person) : null;
  if (o && o.type !== "designer") {
    const line = o.type === "house" ? `${o.origin || ""}${o.basis ? " — " + o.basis : ""}` : o.type === "spot" ? `${String(o.kind || "").toUpperCase()} · ${o.locality}` : "";
    const src = o.sources && o.sources[0];
    return (
      <article className="ovp ovp-line" aria-label={"ASILUM overview: " + o.name}>
        <div className="ovpbody">
          <p className="ovpsrc">{String(o.type).toUpperCase()}{src ? <> · {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{String(src.publisher).toUpperCase()} ↗</a> : String(src.publisher).toUpperCase()}</> : null}</p>
          <h3 className="ovpname">{o.name}</h3>
          <p className="ovptext">{line}</p>
          <button className="ovpmore" onClick={onOpen}>Open overview <Icon name="chevron" size={16} /></button>
        </div>
      </article>
    );
  }
  const src = person.sources && person.facts && person.facts[0] ? person.sources[person.facts[0].source] : (o && o.sources && o.sources[0]) || null;
  const image = person.image ? { src: person.image, alt: (person.imageCredit && person.imageCredit.alt) || person.name } : null;
  if (!person.summary && o && o.intro) person = { ...person, summary: o.intro.text };
  return (
    <article className={"ovp" + (image ? "" : " ovp-noimage")} aria-label={"ASILUM overview: " + person.name}>
      {image ? (
        <div className="ovpport">
          <span className="ovpletter" aria-hidden="true"><i>*</i>ASILUM<br />OVERVIEW</span>
          <img className="ovpimg" src={image.src} alt={image.alt} loading="lazy" />
        </div>
      ) : null}
      <div className="ovpbody">
        {!image ? <span className="ovpkick" aria-hidden="true"><i>*</i>ASILUM OVERVIEW</span> : null}
        <h3 className="ovpname">{person.name}</h3>
        <p className="ovpsrc">
          SUMMARY FROM {src ? <a href={src.url} target="_blank" rel="noreferrer">{src.publisher.toUpperCase()} ↗</a> : <span>ASILUM</span>}
        </p>
        <p className="ovptext">{person.summary}</p>
        <button className="ovpmore" onClick={onOpen}>Read more <Icon name="chevron" size={16} /></button>
      </div>
    </article>
  );
}
