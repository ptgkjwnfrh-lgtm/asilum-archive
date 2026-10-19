"use client";

// app/components/ScoreSheet.jsx — THE PASSENGER SCORE POPUP (V.2 Blueprint
// 6.18; slice 7): overall score, verified review count, the star
// distribution, Buyer / Seller filters for the written reviews, one
// permanent response beneath each. Opened from Account and Passport only —
// never from a listing, an offer, a checkout or a message (6.27). Everything
// shown is /api/score's answer; "0.0 ★ · No reviews" until the first
// verified review (6.12). A neutral indicator marks confirmed conduct
// violations; the details stay private (6.19).

import { useEffect, useState } from "react";
import { authorizedFetch, getUid, postJSON } from "../../lib/client.js";
import { haptic } from "../../lib/haptics.js";
import { openSheet } from "../../lib/dockstate.js";

/** The one line on Account or Passport: the label, a tap opens the popup (6.18, 6.27). */
export function ScoreLine({ subject, name = null }) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    if (!subject) return undefined;
    let live = true;
    authorizedFetch(`/api/score?subject=${encodeURIComponent(subject)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setLabel(d ? d.label : false); }).catch(() => { if (live) setLabel(false); });
    return () => { live = false; };
  }, [subject]);
  if (!subject) return <span className="fine">—</span>;
  return (
    <button type="button" className="scoreline" onClick={() => { haptic("press"); openSheet("score", { subject, name, title: "PASSENGER SCORE" }); }} aria-label="open the Passenger Score">
      {label === null ? "…" : label === false ? "score unavailable" : label}<span aria-hidden="true"> →</span>
    </button>
  );
}

export default function ScoreSheet({ subject, name = null }) {
  const [role, setRole] = useState("");
  const [data, setData] = useState(null);
  const [reply, setReply] = useState({});
  const me = getUid();
  useEffect(() => {
    if (!subject) return undefined;
    let live = true;
    setData(null);
    authorizedFetch(`/api/score?subject=${encodeURIComponent(subject)}${role ? "&role=" + role : ""}&user=${encodeURIComponent(me || "")}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setData(d || false); }).catch(() => { if (live) setData(false); });
    return () => { live = false; };
  }, [subject, role, me]);
  async function respond(review) {
    const text = (reply[review.id] || "").trim();
    if (!text) return;
    haptic("press");
    const r = await postJSON("/api/score", { user: me, action: "respond", review: review.id, text });
    if (r.ok) { setReply({ ...reply, [review.id]: "" }); setRole((x) => x); setData(null); }
  }
  if (!subject) return <p className="deck">no passenger named.</p>;
  if (data === null) return <p className="deck">reading the score…</p>;
  if (data === false) return <p className="pempty" role="status">the score could not be read.</p>;
  const dist = data.distribution || {};
  const max = Math.max(1, ...Object.values(dist));
  return (
    <div className="scoresheet">
      <div className="scorehead">
        <b className="scorebig">{data.label}</b>
        <span className="fine">{name ? name + " · " : ""}{data.count} verified review{data.count === 1 ? "" : "s"}{data.conductIndicator ? " · ◦ conduct record" : ""}</span>
      </div>
      <div className="scoredist" role="img" aria-label={"star distribution: " + [5, 4, 3, 2, 1].map((s) => `${s} stars ${dist[s] || 0}`).join(", ")}>
        {[5, 4, 3, 2, 1].map((s) => (
          <div className="scorebar" key={s}><span>{s}★</span><i style={{ width: `${Math.round(((dist[s] || 0) / max) * 100)}%` }} /><small>{dist[s] || 0}</small></div>
        ))}
      </div>
      <div className="scorefilters" role="group" aria-label="review filter">
        {[["", "ALL"], ["buyer", "AS BUYER"], ["seller", "AS SELLER"]].map(([id, label]) => (
          <button type="button" key={id} className={"txtbtn" + (role === id ? " on" : "")} aria-pressed={role === id} onClick={() => { haptic("tick"); setRole(id); }}>{label}</button>
        ))}
      </div>
      {data.private ? <p className="fine">private to you: {data.private.belowFloor ? `${data.private.belowFloor} ★ accrued below the floor · ` : ""}escalation {data.private.escalation}</p> : null}
      {!(data.reviews || []).length ? <p className="pempty">no written reviews{role ? " in this role" : ""} yet.</p> : null}
      {(data.reviews || []).map((r) => (
        <article className="scorereview" key={r.id}>
          <div className="fine">{"★".repeat(Math.round(r.stars))} · reviewed as {r.role === "buyer" ? "a buyer" : "a seller"} · {String(r.at).slice(0, 10)}{r.revised ? " · revised" : ""}{r.refunded ? " · refunded order" : ""}</div>
          {r.text ? <p>{r.text}</p> : null}
          {r.response ? <p className="scoreresponse"><b>response</b> {r.response.text}</p> : subject === me ? (
            <div className="lstofferrow">
              <input className="wcap" value={reply[r.id] || ""} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} aria-label="your one permanent response" placeholder="one permanent response" />
              <button type="button" className="txtbtn" onClick={() => respond(r)}>RESPOND ✓</button>
            </div>
          ) : null}
        </article>
      ))}
      <p className="fine">one five-star score, from verified reviews on both sides; it lives here and on the Passport, never on a listing or at checkout.</p>
    </div>
  );
}
