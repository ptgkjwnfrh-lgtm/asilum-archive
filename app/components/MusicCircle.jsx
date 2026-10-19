"use client";

// app/components/MusicCircle.jsx — THE MUSIC CIRCLE and its panel (V.2
// Blueprint, owner, 17 Oct 2026, 3.17–3.23, 4.2; slice 9). A contextual
// circle in the Info Dock while audio plays: it pulses while playing,
// stills when paused, shows a restrained loading state, takes the frame's
// colour, blends to the next over 120–250 ms, and fades out when playback
// ends — pausing alone never removes it. On Direct Messages the Info Dock
// hides and the circle stays, small, in the right corner (3.18, by CSS on
// `data-dm`). Tapping it opens the compact panel: title, by, play / pause,
// the shortcut back to the original media; nothing to skip to, and it says
// so. The panel collapses on a tap outside, on navigation, on idleness —
// and the music never stops because it closed (3.20).
//
// MusicHost is the hidden element the player plays through; it lives in
// the shell so the audio survives every popup and route.

import { useEffect, useRef, useState } from "react";
import { usePlayer, attachElement, toggleAudio, stopAudio } from "../../lib/music/player.js";
import { circleFor, panelFor, blendMs, panelAfter, PANEL_IDLE_MS } from "../../lib/music/index.js";
import { openSheet } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";
import Icon from "./Icons.jsx";

export function MusicHost() {
  const ref = useRef(null);
  useEffect(() => { attachElement(ref.current); return () => attachElement(null); }, []);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} className="musichost" playsInline preload="none" aria-hidden="true" tabIndex={-1} />;
}

export default function MusicCircle() {
  const player = usePlayer();
  const circle = circleFor(player);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(circle.visible);
  const panelRef = useRef(null);
  const idle = useRef(null);
  const blend = blendMs();

  // 3.23: the fade and contraction take the blend, then the space is reclaimed
  useEffect(() => {
    if (circle.visible) { setShown(true); return undefined; }
    setOpen(false);
    const t = setTimeout(() => setShown(false), blend);
    return () => clearTimeout(t);
  }, [circle.visible, blend]);
  // 3.20: outside, navigation, idleness
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(panelAfter("outside").open); };
    const nav = () => setOpen(panelAfter("navigate").open);
    const arm = () => { clearTimeout(idle.current); idle.current = setTimeout(() => setOpen(panelAfter("idle", { inUse: panelRef.current && panelRef.current.matches(":hover, :focus-within") }).open), PANEL_IDLE_MS); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("popstate", nav);
    arm();
    panelRef.current && panelRef.current.addEventListener("pointermove", arm);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("popstate", nav); clearTimeout(idle.current); };
  }, [open]);

  if (!shown) return null;
  const panel = panelFor(player);
  const color = circle.color || "var(--red)";
  return (
    <span className="musicwrap">
      <button
        type="button"
        className={"idkey musiccircle" + (circle.pulse ? " pulse" : "") + (circle.still ? " still" : "") + (circle.loading ? " loading" : "") + (circle.visible ? "" : " gone")}
        style={{ "--mc": color, "--mc-prev": player.previousColor || color, "--mc-blend": blend + "ms" }}
        aria-label={"music: " + (circle.pulse ? "playing" : circle.loading ? "loading" : "paused")}
        aria-expanded={open}
        title="MUSIC"
        onClick={() => { haptic("press"); setOpen((o) => !o); }}
      >
        <span className="mcdisc" aria-hidden="true"><span className="mcwave" /></span>
        <span className="idlabel">MUSIC</span>
      </button>
      {open && panel ? (
        <div ref={panelRef} className="musicpanel glasspane" role="dialog" aria-label="playback">
          <b className="mptitle">{panel.title}</b>
          {panel.by ? <span className="mpby">{panel.by}</span> : null}
          {panel.label ? <span className="fine">{panel.label}</span> : null}
          <div className="mprow">
            <button type="button" className="chip clickable" onClick={() => { haptic("press"); toggleAudio(); }} aria-pressed={panel.playing}>{panel.playing ? "PAUSE" : "PLAY"}</button>
            <button type="button" className="chip" disabled title={panel.skipNote || ""}>SKIP</button>
            {panel.back ? <button type="button" className="chip clickable" onClick={() => { setOpen(false); openSheet(panel.back.view, panel.back.props); }}>BACK TO THE MEDIA</button> : null}
            <button type="button" className="chip clickable" onClick={() => { haptic("press"); stopAudio(); }}>STOP</button>
          </div>
          {panel.skipNote ? <span className="fine">{panel.skipNote}</span> : null}
          <a className="fine mplink" href="/settings#connections">connect a streaming app <Icon name="chevron" size={12} /></a>
        </div>
      ) : null}
    </span>
  );
}
