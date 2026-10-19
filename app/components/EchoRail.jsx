"use client";

// app/components/EchoRail.jsx — THE ECHO RAIL and THE ECHO VIEWER (V.2
// Blueprint, owner, 17 Oct 2026: "ECHO is a story-style temporary viewer
// reached from a nested horizontal carousel. Expiry defaults to 24 hours";
// component inventory: "ECHO viewer (sequential, tap and hold)").
//
// The rail is the Feed's nested horizontal carousel: one ring per
// passenger with a live echo, newest first (lib/feed/types.js echoRail).
// A tap opens the viewer as a popup in the session hub (the "echo" view,
// tall), which reads that passenger's posts and keeps only the live
// echoes: tap the right half for the next, the left for the previous,
// hold to pause the clock. Expired echoes are never shown (Terms 5.4).

import { useEffect, useRef, useState } from "react";
import { fetchPostsByHandle } from "../../lib/social.js";
import { echoLive } from "../../lib/feed/types.js";
import { openSheet } from "../../lib/dockstate.js";
import { Avatar } from "./UserBits.jsx";
import TransmissionText from "./TransmissionText.jsx";
import { haptic } from "../../lib/haptics.js";

export const ECHO_STEP_MS = 5000;

export function EchoRail({ groups }) {
  if (!groups || !groups.length) return null;
  return (
    <div className="echorail" role="list" aria-label="echoes — temporary posts">
      {groups.map((g) => (
        <button key={g.handle} type="button" role="listitem" className="echoring" onClick={() => { haptic("press"); openSheet("echo", { handle: g.handle, title: "ECHO" }); }} aria-label={"echoes from " + g.name + ", " + g.echoes.length}>
          <span className="echoringface"><Avatar name={g.name} /></span>
          <span className="echoname">{g.name}</span>
          <span className="echocount" aria-hidden="true">{g.echoes.length}</span>
        </button>
      ))}
    </div>
  );
}

export default function EchoViewer({ handle, echoes: given = null }) {
  const [list, setList] = useState(given);
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const startRef = useRef(0);
  const pausedAt = useRef(0);

  useEffect(() => {
    if (given) return undefined;
    let live = true;
    fetchPostsByHandle(handle).then((r) => { if (live) setList((r.posts || []).filter((p) => echoLive(p)).sort((a, b) => (a.at || 0) - (b.at || 0))); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [handle, given]);

  // the clock: one echo at a time, paused while held
  useEffect(() => {
    if (!list || !list.length) return undefined;
    startRef.current = performance.now();
    let raf = 0;
    const tick = () => {
      if (held) { raf = requestAnimationFrame(tick); return; }
      const p = Math.min(1, (performance.now() - startRef.current) / ECHO_STEP_MS);
      setProgress(p);
      if (p >= 1) { setI((n) => Math.min(list.length - 1, n + 1)); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, held, list]);
  // holding shifts the clock's start so progress resumes where it paused
  function hold(on) {
    if (on) { pausedAt.current = performance.now(); setHeld(true); }
    else { startRef.current += performance.now() - pausedAt.current; setHeld(false); }
  }

  if (list === null) return <p className="deck">reading the echoes…</p>;
  if (!list.length) return <p className="deck">no live echoes from {handle} — an echo lasts a day.</p>;
  const cur = list[Math.min(i, list.length - 1)];
  const a = cur.attachments || {};
  const img = (Array.isArray(a.media) && a.media[0] && a.media[0].url) || cur.imageUrl || "";
  const left = Math.max(0, Number(a.echo && a.echo.expiresAt) - Date.now());
  const hoursLeft = Math.ceil(left / 3_600_000);

  return (
    <div className="echoview" data-handle={handle}>
      <div className="echobars" aria-hidden="true">
        {list.map((p, n) => <span key={p.id} className={"echobar" + (n < i ? " done" : n === i ? " cur" : "")} style={n === i ? { "--p": progress } : undefined} />)}
      </div>
      <div className="echohead">
        <Avatar name={cur.name || handle} /><b>{cur.name || handle}</b>
        <span className="fine">{hoursLeft <= 1 ? "under an hour left" : hoursLeft + "h left"}</span>
      </div>
      <div
        className="echostage"
        onPointerDown={() => hold(true)}
        onPointerUp={(e) => { hold(false); const r = e.currentTarget.getBoundingClientRect(); const right = e.clientX - r.left > r.width / 2; haptic("tick"); setI((n) => right ? Math.min(list.length - 1, n + 1) : Math.max(0, n - 1)); }}
        onPointerCancel={() => hold(false)}
        onPointerLeave={() => held && hold(false)}
        role="group"
        aria-label={"echo " + (i + 1) + " of " + list.length + " — tap the right half for the next, the left for the previous, hold to pause"}
      >
        {img ? <img src={img} alt={(a.media && a.media[0] && a.media[0].alt) || a.alt || ""} /> : null}
        <div className={"echotext" + (img ? " onmedia" : "")}>
          {cur.title ? <b>{cur.title}</b> : null}
          <TransmissionText text={cur.text} />
        </div>
      </div>
      <div className="echonav" role="group" aria-label="echo navigation">
        <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>PREVIOUS</button>
        <span className="fine">{i + 1}/{list.length}</span>
        <button type="button" onClick={() => setI((n) => Math.min(list.length - 1, n + 1))} disabled={i >= list.length - 1}>NEXT</button>
      </div>
    </div>
  );
}
