"use client";

// app/components/Onboarding.jsx — THE PASSPORT'S ONBOARDING (V.2 Blueprint,
// owner, 17 Oct 2026, 14.11; A6 (7); slice 10c). A popup over the Passport
// on first opening: five to seven autobiographical questions, one at a
// time, era-relevant suggestions from the birthday, the home town and the
// background, free text always, skip always, "doesn't apply" where the law
// allows it, edit and resume always. Every answer is an identity anchor the
// passenger designated; nothing here infers one.

import { useEffect, useState } from "react";
import { getUid, authorizedFetch, postJSON } from "../../lib/client.js";
import { haptic } from "../../lib/haptics.js";
import { closeSheet } from "../../lib/dockstate.js";

export const ONBOARDING_SEEN_KEY = "asilum-onboarding-seen";

export default function Onboarding() {
  const [data, setData] = useState(null);
  const [i, setI] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const uid = getUid() || "";
  const load = () => authorizedFetch("/api/passport/onboarding?user=" + encodeURIComponent(uid)).then((r) => (r.ok ? r.json() : null)).then((d) => {
    setData(d || false);
    if (d && d.questions) { const first = d.questions.findIndex((q) => !q.answer && !q.skipped); setI(first < 0 ? 0 : first); }
  }).catch(() => setData(false));
  useEffect(() => { if (uid) load(); else setData(false); try { window.localStorage.setItem(ONBOARDING_SEEN_KEY, new Date().toISOString()); } catch {} }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(body) {
    setBusy(true); setNote("");
    try {
      const res = await postJSON("/api/passport/onboarding", { user: uid, ...body });
      const d = await res.json().catch(() => null);
      if (!res.ok) { haptic("error"); setNote((d && d.error) || "that was not recorded"); return; }
      haptic("confirm");
      setData((cur) => ({ ...cur, questions: d.questions, progress: d.progress, anchors: d.anchors }));
      setText("");
      const next = d.questions.findIndex((q, j) => j > i && !q.answer && !q.skipped);
      if (next >= 0) setI(next); else if (d.progress.done) setI(d.questions.length);
    } catch { setNote("the Passport could not be reached"); } finally { setBusy(false); }
  }
  if (data === null) return <div className="onboard"><p className="fine">opening the Passport…</p></div>;
  if (data === false) return <div className="onboard"><p className="fine">the Passport could not be read — sign in or try again.</p></div>;
  const qs = data.questions;
  const p = data.progress;
  if (i >= qs.length || (p.done && i >= qs.length)) {
    return (
      <div className="onboard">
        <div className="cclbl">PASSPORT · {p.answered} ANCHOR{p.answered === 1 ? "" : "S"} · {p.skipped} SKIPPED</div>
        <h3 className="onbq">that is the Passport's first page.</h3>
        <p className="fine">these are identity anchors: they never fade, and only you add or remove them. {data.identity.account ? "" : "they ride on this device and move to your account when you sign in."}</p>
        <ul className="onbanchors">
          {qs.map((q, j) => (
            <li key={q.id}>
              <span className="cclbl">{q.prompt}</span>
              <b>{q.answer ? (q.answer.na ? "doesn't apply" : q.answer.text) : q.skipped ? "skipped" : "—"}</b>
              <span className="onbacts"><button className="txtbtn" onClick={() => { setI(j); setText(q.answer && q.answer.text ? q.answer.text : ""); }}>EDIT</button>{q.answer ? <button className="txtbtn" disabled={busy} onClick={() => act({ action: "remove", questionId: q.id })}>REMOVE</button> : null}</span>
            </li>
          ))}
        </ul>
        <div className="stacts"><button className="btn" onClick={() => closeSheet()}>TO THE FEED →</button></div>
        {note ? <p className="fine">{note}</p> : null}
      </div>
    );
  }
  const q = qs[i];
  return (
    <div className="onboard">
      <div className="cclbl">PASSPORT · {i + 1} OF {qs.length} · ABOUT FIVE MINUTES · {p.answered} ANCHOR{p.answered === 1 ? "" : "S"}</div>
      <h3 className="onbq">{q.prompt}</h3>
      {q.suggestions.length ? (
        <div className="onbsug seg" role="group" aria-label="suggestions">
          {q.suggestions.map((s) => (
            <button key={s.name} type="button" className={"chip clickable" + (text.toLowerCase() === s.name.toLowerCase() ? " cur" : "")} disabled={busy} onClick={() => { haptic("tick"); setText(s.name); }}>{s.name}</button>
          ))}
          <span className="fine">{q.suggestionsFrom === "cohort register" ? `ten from ${data.identity.yearAt12 ? "the year you were twelve" : "the register"}${data.identity.hometown ? ", near " + data.identity.hometown : ""}${data.identity.background ? ", for your background" : ""} — a suggestion, never an answer` : "era suggestions — or your own words"}</span>
        </div>
      ) : null}
      <input className="onbinput" type="text" maxLength={160} value={text} placeholder={q.kind === "artist" ? "an artist, a band, a DJ…" : "your own words"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) act({ action: "answer", questionId: q.id, text: text.trim(), suggestion: q.suggestions.find((s) => s.name.toLowerCase() === text.trim().toLowerCase()) || null }); }} aria-label={q.prompt} />
      <div className="stacts">
        <button className="btn" disabled={busy || !text.trim()} onClick={() => act({ action: "answer", questionId: q.id, text: text.trim(), suggestion: q.suggestions.find((s) => s.name.toLowerCase() === text.trim().toLowerCase()) || null })}>ANCHOR IT ✓</button>
        {q.na ? <button className="txtbtn" disabled={busy} onClick={() => act({ action: "answer", questionId: q.id, na: true })}>{q.naLabel.toUpperCase()}</button> : null}
        {q.skippable ? <button className="txtbtn" disabled={busy} onClick={() => act({ action: "skip", questionId: q.id })}>SKIP</button> : null}
        {i > 0 ? <button className="txtbtn" onClick={() => setI(i - 1)}>← BACK</button> : null}
        <button className="txtbtn" onClick={() => closeSheet()}>LATER</button>
      </div>
      <p className="fine">no event is assumed. skip, edit and resume always work; the Passport keeps your place.{note ? " " + note : ""}</p>
    </div>
  );
}
