"use client";

// app/components/Disc.jsx — THE DISC (V.2 Blueprint, owner, 17 Oct 2026,
// chapter 2). One rotary component, reused for Post Selection, the session
// dial, Wardrobe and Followers (2.2). It feels like a physical control:
// drag to turn, flick to spin, momentum and friction, magnetic snapping
// with a tick as it settles (2.1), tap the centre to confirm or let the
// centred item dwell for one second (2.3, 2.4, 2.5). Every disc can be
// turned off per interface, remembered on this device (2.7, 2.8); off, a
// slim slider stands in (2.10) and the arrows and keyboard still turn it.
//
// The physics live in lib/disc.js and are tested there; this file is the
// pointer, the frame loop and the drawing. Reduced motion drops momentum:
// the disc settles where the finger leaves it.
//
// Props:
//   name       the preference key (post, sessions, wardrobe, followers)
//   items      [{ id, label, icon? }]
//   index      the centred item (controlled)
//   onChange   the centred item moved (rotation, arrows, slider)
//   onSelect   the centred item was confirmed (tap or dwell)
//   onLongPress the centre was held — the compact menu (1.29)
//   center     { icon, label, badge } drawn in the middle
//   dwell      whether the one-second dwell confirms (default true)
//   size       px (default 220)

import { useEffect, useRef, useState } from "react";
import { angleFor, indexAt, delta, pointerAngle, stepMomentum, dwell as dwellClock, LONG_PRESS_MS, prefKey } from "../../lib/disc.js";
import { haptic } from "../../lib/haptics.js";
import Icon from "./Icons.jsx";

function readOff(name) {
  try { return typeof window !== "undefined" && window.localStorage.getItem(prefKey(name)) === "off"; } catch { return false; }
}

export default function Disc({ name = "disc", items = [], index = 0, onChange, onSelect, onLongPress, center = null, dwell = true, size = 220 }) {
  const n = items.length;
  const ref = useRef(null);
  const [angle, setAngle] = useState(() => angleFor(index, n));
  const [off, setOff] = useState(false);
  const [progress, setProgress] = useState(0);
  const drag = useRef(null);       // { last, lastT, velocity, moved }
  const raf = useRef(0);
  const dwellRef = useRef(null);
  const settledRef = useRef(true);
  const indexRef = useRef(index);
  const angleRef = useRef(angle);
  const reduced = useRef(false);
  const confirmedRef = useRef(index);
  const pressRef = useRef(null);

  useEffect(() => { setOff(readOff(name)); }, [name]);
  useEffect(() => {
    try { reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  }, []);

  // controlled from outside (the carousel was swiped): turn to the item
  useEffect(() => {
    if (drag.current || raf.current) return;
    indexRef.current = index;
    confirmedRef.current = index;
    const a = angleFor(index, n);
    angleRef.current = a;
    setAngle(a);
  }, [index, n]);

  function setCentred(i) {
    if (i === indexRef.current) return;
    indexRef.current = i;
    if (onChange) onChange(i);
  }
  function confirm(i) {
    confirmedRef.current = i;
    dwellRef.current = null;
    setProgress(0);
    if (onSelect) onSelect(i);
  }

  // the dwell clock (2.3, 2.5): ticks while settled on an unconfirmed item
  useEffect(() => {
    if (!dwell || n === 0) return undefined;
    let id = 0;
    const tick = () => {
      const now = performance.now();
      const i = indexRef.current;
      const settled = settledRef.current && !drag.current;
      const next = dwellClock(dwellRef.current, { index: i, settled: settled && i !== confirmedRef.current, now });
      dwellRef.current = next;
      setProgress(next.progress);
      if (next.fire) confirm(i);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [dwell, n]); // eslint-disable-line react-hooks/exhaustive-deps

  function centreOf() {
    const r = ref.current.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  function onPointerDown(e) {
    if (!ref.current || n === 0 || e.button) return;
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    const { cx, cy } = centreOf();
    drag.current = { last: pointerAngle(cx, cy, e.clientX, e.clientY), lastT: performance.now(), velocity: 0, moved: 0 };
    settledRef.current = false;
    ref.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d || !ref.current) return;
    const { cx, cy } = centreOf();
    const a = pointerAngle(cx, cy, e.clientX, e.clientY);
    const dd = delta(d.last, a);
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = d.velocity * 0.6 + (dd / dt) * 1000 * 0.4;
    d.last = a; d.lastT = now; d.moved += Math.abs(dd);
    const next = (angleRef.current + dd + 360) % 360;
    const before = indexAt(angleRef.current, n);
    angleRef.current = next;
    setAngle(next);
    const after = indexAt(next, n);
    if (after !== before) { haptic("tick"); setCentred(after); }
  }
  function onPointerUp(e) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try { ref.current.releasePointerCapture(e.pointerId); } catch {}
    if (d.moved < 4) { settledRef.current = true; return; } // a tap, handled by the centre button or ignored
    let st = { angle: angleRef.current, velocity: reduced.current ? 0 : d.velocity };
    let lastT = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(48, now - lastT); lastT = now;
      const next = stepMomentum(st, n, dt);
      st = { angle: next.angle, velocity: next.velocity };
      angleRef.current = next.angle;
      setAngle(next.angle);
      if (next.tick) haptic("tick");
      const i = indexAt(next.angle, n);
      setCentred(i);
      if (next.settled) { raf.current = 0; settledRef.current = true; return; }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }

  function turn(by) {
    const i = ((indexRef.current + by) % n + n) % n;
    const a = angleFor(i, n);
    angleRef.current = a; setAngle(a); settledRef.current = true;
    haptic("tick");
    setCentred(i);
  }

  // the centre: tap confirms (2.3); a long hold opens the compact menu (1.29)
  function centreDown(e) {
    if (e.button) return;
    e.stopPropagation(); // the centre is a button, not the start of a turn
    pressRef.current = { t: performance.now(), fired: false, timer: setTimeout(() => {
      pressRef.current.fired = true;
      haptic("press");
      if (onLongPress) onLongPress();
    }, LONG_PRESS_MS) };
  }
  function centreUp() {
    const p = pressRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pressRef.current = null;
    if (!p.fired) { haptic("press"); confirm(indexRef.current); }
  }
  function centreCancel() {
    const p = pressRef.current;
    if (p) { clearTimeout(p.timer); pressRef.current = null; }
  }

  function toggleOff() {
    const next = !off;
    setOff(next);
    try { window.localStorage.setItem(prefKey(name), next ? "off" : "on"); } catch {}
    haptic("toggle");
  }

  const cur = items[indexRef.current] || items[index] || null;
  const centre = center || (cur ? { icon: cur.icon, label: cur.label } : { icon: "disc", label: "" });
  const ring = 2 * Math.PI * 23; // the progress ring's circumference (r = 23)

  return (
    <div className={"discwrap" + (off ? " discoff" : "")} data-disc={name}>
      {off ? (
        <div className="discslider" role="group" aria-label={name + " selector"}>
          <button type="button" className="discarrow" aria-label="previous" onClick={() => turn(-1)}><Icon name="back" size={16} /></button>
          <input
            type="range" min={0} max={Math.max(0, n - 1)} value={Math.min(index, Math.max(0, n - 1))} aria-label={name}
            onChange={(e) => { const i = Number(e.target.value) || 0; indexRef.current = i; if (onChange) onChange(i); }}
          />
          <button type="button" className="discarrow" aria-label="next" onClick={() => turn(1)}><Icon name="back" size={16} className="flip" /></button>
          <button type="button" className="discgo" onClick={() => confirm(indexRef.current)}>OPEN</button>
        </div>
      ) : (
        <div
          ref={ref}
          className="disc"
          style={{ "--disc": size + "px" }}
          role="group"
          aria-label={name + " disc — turn to choose, tap the centre to open; arrow keys turn it too"}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); turn(-1); }
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); turn(1); }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); confirm(indexRef.current); }
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="discface" aria-hidden="true">
            <div className="discring" style={{ transform: `rotate(${-angle}deg)` }}>
              {items.map((it, i) => (
                <span key={it.id} className={"discslot" + (i === indexRef.current ? " sel" : "")} style={{ transform: `rotate(${angleFor(i, n)}deg) translateY(calc(var(--disc) / -2 + 22px))` }}>
                  <span className="discslotlbl" style={{ transform: `rotate(${angle - angleFor(i, n)}deg)` }}>{it.icon ? <Icon name={it.icon} size={14} /> : null}<i>{it.label}</i></span>
                </span>
              ))}
            </div>
            <span className="discmark" />
          </div>
          <button
            type="button"
            className="disccenter"
            aria-label={centre.label ? "open " + String(centre.label).toLowerCase() : "open"}
            onPointerDown={centreDown}
            onPointerUp={centreUp}
            onPointerLeave={centreCancel}
            onPointerCancel={centreCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <svg className="discprog" viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)} />
            </svg>
            {centre.icon ? <Icon name={centre.icon} size={22} /> : null}
            {centre.badge ? <b className="discbadge">{centre.badge}</b> : null}
            <span className="disccenterlbl">{centre.label}</span>
          </button>
        </div>
      )}
      <button type="button" className="disctoggle" aria-pressed={off} onClick={toggleOff} title={off ? "show the disc" : "hide the disc, swipe instead"}>
        <Icon name="disc" size={14} /><span>{off ? "DISC" : "SWIPE"}</span>
      </button>
    </div>
  );
}
