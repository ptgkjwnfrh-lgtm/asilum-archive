"use client";

// app/components/AddStamp.jsx — ADD STAMP (V.2 brief §11): the one housing
// at the bottom of the personal Passport for everything a passenger may
// stamp into their taste record — a public place or event, an artist, a
// designer or house, a passenger. Images and Wire posts are stamped where
// they are seen (the upload station, the save on a card) and listed here.
//
// Three rules, all visible:
//   SHOW WHAT WILL BE ADDED before confirmation — a preview card, then CONFIRM.
//   UNDO — the stamp just made can be removed in one tap, and every stamp is
//   removable from the Collection list.
//   STAMPING A PASSENGER means adding their PUBLIC taste influence (a follow
//   of their public room, blended into the feed like a followed board). It
//   is not their location and not any private data; the preview says so.
//
// Artists come from ASILUM's own curated table (lib/music-mapping) — the
// Spotify manual-only path; no provider is consulted. Designers and houses
// come from the entity graph (lib/entities/graph.js). Places from the
// places registry. Passengers from their published room by handle.

import { useEffect, useMemo, useState } from "react";
import { saveObject, unsave, isSaved } from "../../lib/save.js";
import { listArtists } from "../../lib/music-mapping/index.js";
import { findEntity } from "../../lib/entities/graph.js";
import { listPlaces } from "../../lib/places/registry.js";
import { setFollowUser } from "../../lib/social.js";
import { authorizedFetch, getUid } from "../../lib/client.js";

const KINDS = [
  { id: "place", label: "PLACE · EVENT", hint: "a public venue or event from the map" },
  { id: "artist", label: "ARTIST", hint: "from ASILUM's own table — nothing is read from a music service" },
  { id: "designer", label: "DESIGNER · HOUSE", hint: "from the entity graph" },
  { id: "person", label: "PASSENGER", hint: "their public taste influence — never a location, never private data" },
];

function Preview({ kind, pick }) {
  if (!pick) return null;
  return (
    <div className="stamppreview" role="group" aria-label="what will be added">
      <span className="stamppreview-kind">{kind === "person" ? "PASSENGER" : kind.toUpperCase()}</span>
      <b>{pick.title}</b>
      {pick.meta ? <span className="fine">{pick.meta}</span> : null}
      {kind === "person" ? <span className="fine">stamping a passenger adds their public taste influence to your record (a follow of their room). it does not share their location or anything private.</span> : null}
      {kind === "artist" ? <span className="fine">this uses ASILUM's own artist → taste table; no listening data is read anywhere.</span> : null}
    </div>
  );
}

export default function AddStamp({ onStamped }) {
  const [kind, setKind] = useState("place");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const [person, setPerson] = useState(null);     // the resolved public room for a passenger
  const [last, setLast] = useState(null);         // the stamp just made, for UNDO
  const [note, setNote] = useState("");

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (kind === "place") return listPlaces({}).filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 8)
      .map((p) => ({ id: p.id, title: p.name, meta: [p.kind, p.city || p.region || ""].filter(Boolean).join(" · "), href: "/map", tags: [] }));
    if (kind === "artist") return listArtists().filter((a) => !needle || a.name.includes(needle)).slice(0, 8)
      .map((a) => ({ id: a.id, title: a.name, meta: a.descriptors.slice(0, 4).join(" · "), href: "", tags: Object.keys(a.tags) }));
    if (kind === "designer") {
      if (needle.length < 2) return [];
      const e = findEntity(needle);   // the entity itself, or null (never two)
      return e && (e.type === "designer" || e.type === "house") ? [{ id: e.id, title: e.name, meta: e.type, href: "/discover?entity=" + encodeURIComponent(e.id), tags: [], entityKind: e.type }] : [];
    }
    return [];
  }, [kind, q]);

  // a passenger resolves through their PUBLIC room, by handle
  useEffect(() => {
    if (kind !== "person") { setPerson(null); return undefined; }
    const handle = q.trim().toLowerCase().replace(/^[*@]/, "");
    if (!/^[a-z0-9-]{3,24}$/.test(handle)) { setPerson(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await authorizedFetch("/api/profile/room?handle=" + encodeURIComponent(handle) + "&user=" + encodeURIComponent(getUid() || ""), { cache: "no-store" });
        if (!r.ok) { if (live) setPerson(null); return; }
        const d = await r.json();
        if (live) setPerson(d && (d.room || d.handle || d.published) ? { id: handle, title: handle, meta: "a published passenger", href: "/u/" + encodeURIComponent(handle), tags: [] } : null);
      } catch { if (live) setPerson(null); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [kind, q]);

  async function confirm() {
    if (!pick) return;
    setNote("");
    const saveKind = kind === "designer" ? (pick.entityKind === "house" ? "house" : "designer") : kind;
    try {
      await saveObject({ kind: saveKind, id: pick.id, title: pick.title, href: pick.href, meta: pick.meta, tags: pick.tags });
      if (kind === "person") setFollowUser(pick.id, true);
      setLast({ kind: saveKind, id: pick.id, title: pick.title, person: kind === "person" });
      setPick(null); setQ("");
      setNote(`stamped: ${pick.title}.`);
      if (onStamped) onStamped();
    } catch (e) { setNote(String(e && e.message || "that could not be stamped.")); }
  }

  async function undo() {
    if (!last) return;
    try {
      await unsave(last.kind, last.id);
      if (last.person) setFollowUser(last.id, false);
      setNote(`removed: ${last.title}.`);
      setLast(null);
      if (onStamped) onStamped();
    } catch { setNote("that could not be removed."); }
  }

  const candidates = kind === "person" ? (person ? [person] : []) : options;

  return (
    <section className="addstamp card" aria-label="add a stamp">
      <div className="psub">ADD STAMP</div>
      <div className="stampkinds" role="tablist" aria-label="what to stamp">
        {KINDS.map((k) => (
          <button key={k.id} role="tab" type="button" aria-selected={kind === k.id} className={"tab" + (kind === k.id ? " cur" : "")}
            onClick={() => { setKind(k.id); setPick(null); setQ(""); setNote(""); }}>{k.label}</button>
        ))}
      </div>
      <p className="fine">{KINDS.find((k) => k.id === kind).hint}. images are stamped at the upload station; posts from their card in the Feed.</p>
      <input
        type="search"
        aria-label={kind === "person" ? "a passenger's handle" : "find something to stamp"}
        placeholder={kind === "person" ? "handle…" : "find…"}
        value={q}
        onChange={(e) => { setQ(e.target.value); setPick(null); }}
      />
      {candidates.length ? (
        <ul className="stampfound">
          {candidates.map((c) => (
            <li key={c.id}>
              <button type="button" aria-pressed={pick && pick.id === c.id} onClick={() => setPick(c)} disabled={isSaved(kind === "designer" ? (c.entityKind === "house" ? "house" : "designer") : kind, c.id)}>
                <b>{c.title}</b>{c.meta ? <span className="fine"> · {c.meta}</span> : null}{isSaved(kind === "designer" ? (c.entityKind === "house" ? "house" : "designer") : kind, c.id) ? <em> · stamped</em> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 ? <p className="fine">nothing by that name here.</p> : null}
      <Preview kind={kind} pick={pick} />
      <div className="stampacts">
        {pick ? <button type="button" className="btn" onClick={confirm}>CONFIRM STAMP</button> : null}
        {pick ? <button type="button" className="btn ghost" onClick={() => setPick(null)}>CANCEL</button> : null}
        {last ? <button type="button" className="btn ghost" onClick={undo}>UNDO · {last.title}</button> : null}
      </div>
      {note ? <p className="amemnote" role="status" aria-live="polite">{note}</p> : null}
    </section>
  );
}
