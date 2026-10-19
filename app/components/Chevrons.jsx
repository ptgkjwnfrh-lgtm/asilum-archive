"use client";

// app/components/Chevrons.jsx — THE DEVICE'S OWN LANGUAGE, a little of it
// (owner, 18 Oct 2026: "pull from the og design language but only some of it
// — I just want a couple of '>>>>>>' used like when people expand a
// compacted description some of the text should load in from '>>>>>>' …
// some blinking squares that turn off … like when you buy something there
// should be a blinking square like how you eject a disc from a cd player and
// there's a warning light … I want the app to feel like a physical device").
// The references are the owner's 404 and title-card films: MRZ lines run out
// in red chevrons, a green block cursor blinks, two red squares blink and
// settle.
//
//   <ChevronText text="…" />   the text loads in behind a run of ">>>>>>"
//                              sweeping left to right; the not-yet text keeps
//                              its place (transparent), so nothing reflows
//                              as it arrives. Plays once on mount, again when
//                              `play` changes. The full text is the
//                              accessible name from the first frame.
//   <Lamp />                   one square warning light, off at rest.
//   blinkLamp(eventOrEl)       blinks the lamp inside the pressed control
//                              like a CD tray's eject light — on, off, on,
//                              off — then it goes dark.
//   <MrzLine text="…" />       an MRZ-style line: words joined by "<", run
//                              out with "<<<<" to the width, a block cursor
//                              blinking at the end.
//
// prefers-reduced-motion: the text is simply there, the lamp lights once and
// goes dark without blinking, the cursor holds still.

import { useEffect, useRef } from "react";
import { haptic } from "../../lib/haptics.js";
import { chevronFrame, CHEVRON_RUN as RUN } from "../../lib/feed/chevrons.js";

export { chevronFrame };

const STEP_MS = 14;       // per character
const MAX_MS = 900;       // a long description never takes longer than this

const still = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;


export function ChevronText({ text, as: Tag = "span", className = "", play = 0 }) {
  const shownRef = useRef(null);
  const chevRef = useRef(null);
  const restRef = useRef(null);
  const t = String(text || "");
  useEffect(() => {
    const s = shownRef.current, c = chevRef.current, r = restRef.current;
    if (!s || !c || !r) return undefined;
    const paint = (n) => { const f = chevronFrame(t, n); s.textContent = f.shown; c.textContent = f.chevrons; r.textContent = f.rest; };
    if (still() || !t) { paint(t.length); return undefined; }
    const per = Math.min(STEP_MS, MAX_MS / Math.max(1, t.length + RUN));
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const n = Math.floor((now - start) / per) - RUN;
      paint(n);
      if (n < t.length) raf = requestAnimationFrame(tick);
    };
    paint(-RUN);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t, play]);
  return (
    <Tag className={"chevtext " + className} aria-label={t}>
      <span ref={shownRef} aria-hidden="true" />
      <span ref={chevRef} className="chevrun" aria-hidden="true" />
      <span ref={restRef} className="chevrest" aria-hidden="true">{t}</span>
    </Tag>
  );
}

/** One square warning light; dark at rest. Put it inside the control it reports on. */
export function Lamp({ className = "" }) {
  return <span className={"lamp " + className} aria-hidden="true" />;
}

/** Blink the lamp inside the control that was pressed (an event or an element), then let it go dark. */
export function blinkLamp(target, { quiet = false } = {}) {
  const el = target && target.currentTarget ? target.currentTarget : target;
  const lamps = el && el.querySelectorAll ? [...el.querySelectorAll(".lamp")] : [];
  if (!lamps.length) return;
  for (const lamp of lamps) {
    lamp.removeAttribute("data-blink");
    // restart the animation even when pressed twice in a row
    void lamp.offsetWidth;
    lamp.setAttribute("data-blink", still() ? "once" : "eject");
    clearTimeout(lamp.__off);
    lamp.__off = setTimeout(() => lamp.removeAttribute("data-blink"), 1900);
  }
  if (!quiet) haptic("press");
  // the deck's status lights answer every lamp (the device reporting)
  try { if (!el.closest || !el.closest(".devlights")) window.dispatchEvent(new CustomEvent("asilum:lamp")); } catch {}
}

/** An MRZ-style line: words joined by "<", run out with "<", a blinking block cursor at the end. */
export function MrzLine({ words = [], width = 44, cursor = false }) {
  const body = words.map((w) => String(w).toUpperCase().replace(/[^A-Z0-9*]+/g, "<")).join("<<");
  const fill = Math.max(4, width - body.length);
  const parts = body.split(/(<+)/);
  return (
    <span className="mrzline" aria-hidden="true">
      {parts.map((p, i) => (p.startsWith("<") ? <i key={i}>{p}</i> : <b key={i}>{p}</b>))}
      <i>{"<".repeat(fill)}</i>
      {cursor ? <span className="mrzcursor" /> : null}
    </span>
  );
}
