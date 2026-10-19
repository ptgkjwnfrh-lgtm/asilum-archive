"use client";

// app/components/PersonOverview.jsx — the sourced overview panel (V.2).
// A knowledge-panel's speed in ASILUM's voice: image with its credit, role,
// a short sourced description, the facts each with their source, why the
// overview exists, last updated, a correction path, and SAVE / FOLLOW.
// Nothing here is inferred about the person.

import { useId, useState } from "react";
import SaveButton from "./SaveButton.jsx";
import { ChevronText } from "./Chevrons.jsx";
import ModelTag from "./ModelTag.jsx";
import { OVERVIEW_ELIGIBILITY } from "../../lib/people/overviews.js";
import { setFollowBrand, followedBrands } from "../../lib/social.js";
import "./person-overview.css";

export default function PersonOverview({ person, compact = false }) {
  if (!person) return null;
  return <OverviewCard key={person.id} person={person} compact={compact} />;
}

// Presentation stays independent of the sourced person record. Claude owns
// the record/API; Codex owns this card and its expanded reading experience.
function OverviewCard({ person, compact }) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(!compact);
  const [why, setWhy] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [note, setNote] = useState("");
  const [following, setFollowing] = useState(() => { try { return followedBrands().includes(person.name); } catch { return false; } });
  const [correctionStatus, setCorrectionStatus] = useState("");
  const portraitMask = person.id === "olivier-rousteing"
    ? "polygon(34% 18%,34% 13%,37% 10%,44% 8%,51% 8%,54% 11%,54% 14%,57% 18%,55% 19%,54% 23%,50% 25%,49% 29%,39% 29%,37% 24%,35% 20%)"
    : null;
  function toggleFollow() {
    const next = !following;
    setFollowing(next);
    try { setFollowBrand(person.name, next); } catch {}
  }
  function sendCorrection(e) {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      const key = "asilum-corrections";
      const list = JSON.parse(window.localStorage.getItem(key) || "[]");
      list.unshift({ kind: "overview", id: person.id, note: note.trim().slice(0, 600), at: new Date().toISOString() });
      window.localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
    } catch {
      setCorrectionStatus("This correction could not be saved on this device. Please try again.");
      return;
    }
    setCorrectionStatus("Correction saved on this device.");
    setNote(""); setCorrect(false);
  }
  return (
    <section className={"pov pov-editorial" + (compact ? " compact" : "") + (expanded ? " is-expanded" : "")} aria-label={"overview: " + person.name}>
      <div className="povflow">
      <figure className="povimg">
        <button type="button" className="povportrait" aria-label={(expanded ? "Collapse" : "Read") + " overview of " + person.name} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
          {person.image ? <img src={person.image} alt={person.imageCredit?.alt || person.name} loading="lazy" /> : <span className="povmono">{person.name.slice(0, 1)}</span>}
          <span className="povmasthead" aria-hidden="true"><b>*</b>ASILUM<br /><span>OVERVIEW</span></span>
          {person.image && portraitMask && <img className="povcutout" src={person.image} style={{clipPath: portraitMask}} alt="" aria-hidden="true" loading="lazy" />}
        </button>
        {person.imageCredit && <a className="povcredit" href={person.imageCredit.url} target="_blank" rel="noreferrer">{person.imageCredit.credit} · {person.imageCredit.license}</a>}
      </figure>
      <div className="povbody">
        <div className="povkick">THE PEOPLE BEHIND THE CLOTHES</div>
        <h2 className="povname"><button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>{person.name}</button></h2>
        <div className="povrole">{person.role}</div>
        <ChevronText as="p" className="povsum" text={person.summary} />
        <button className="txtbtn povread" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>{expanded ? "Read less −" : "Read overview +"}</button>
        <div id={detailsId} hidden={!expanded} className="povdetails">
          <ul className="povfacts">
            {(person.facts || []).map((f) => {
              const s = person.sources[f.source];
              return (
                <li key={f.claim}>
                  {f.claim}
                  {s && <a href={s.url} target="_blank" rel="noreferrer"> — {s.publisher} ↗</a>}
                </li>
              );
            })}
          </ul>
        <p className="povaffiliation">{person.notAffiliated}</p>
        </div>
      </div>
      </div>
      <div className="povfooter" hidden={!expanded}>
        <div className="povmeta">
          UPDATED {person.lastUpdated} · <button className="txtbtn" aria-expanded={why} onClick={() => setWhy((v) => !v)}>About this overview</button> · <button className="txtbtn" aria-expanded={correct} onClick={() => setCorrect((v) => !v)}>Suggest a correction</button>
        </div>
        {why && (
          <p className="povwhy">
            {person.basis.startsWith("designer")
              ? `Designers qualify through ${OVERVIEW_ELIGIBILITY.designers.rule}.`
              : `Creators qualify at ${OVERVIEW_ELIGIBILITY.creators.rule}; missing history reads "not yet verified".`}
            {" "}{person.notAffiliated}
          </p>
        )}
        {correctionStatus && <p role="status" className="povwhy">{correctionStatus}</p>}
        {correct && (
          <form className="povcorrect" onSubmit={sendCorrection}>
            <label id={"povlbl-" + person.id} htmlFor={"povnote-" + person.id} className="cclbl">WHAT IS WRONG, AND YOUR SOURCE</label>
            <textarea id={"povnote-" + person.id} aria-labelledby={"povlbl-" + person.id} rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="the claim, the correction, a link" />
            <div className="povcorrectrow">
              <ModelTag kind="device">QUEUED ON THIS DEVICE — the desk is not staffed yet</ModelTag>
              <button className="txtbtn" type="submit" disabled={!note.trim()}>QUEUE</button>
            </div>
          </form>
        )}
        <div className="povacts">
          <SaveButton kind="person" id={person.id} title={person.name} image={person.image} href={"/discover?q=" + encodeURIComponent(person.name)} meta={person.role} tags={person.tags} />
          <button className={"followbtn" + (following ? " on" : "")} aria-pressed={following} onClick={toggleFollow}>{following ? "FOLLOWING" : "FOLLOW"}</button>
          <a className="txtbtn" href={"/discover?q=" + encodeURIComponent(person.name)}>PIECES CREDITED →</a>
        </div>
      </div>
    </section>
  );
}
