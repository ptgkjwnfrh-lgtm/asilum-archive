"use client";

// app/components/InfoDock.jsx — THE INFO DOCK (V.2 Blueprint, owner, 17 Oct
// 2026, Foundations "Screen map" and the fixtures sketch, Figure 19). The
// top-left fixture on every page but Direct Messages: LIKES, BAG and the
// bell (NOTICES), each opening its sheet over the root. The music circle
// joins it while audio plays (slice 9, 3.17: contextual — MusicCircle.jsx);
// the |A| exploration indicator (14.9, slice 10c) appears while Exploration
// Active is on; a tap turns exploration off, and off beats reactivation.
//
// It is a fixture, not navigation: nothing here is a route. The utilities
// are data in lib/dock.js so the tests read the same table. The glyphs are
// the three everyone knows; the readable label rides with each key for
// assistive technology and as a tooltip, and the fixture stays compact — the
// blueprint's priority is to spend as little real estate as possible.

import { useEffect, useRef, useState } from "react";
import { useLiquidGlass } from "./LiquidGlass.jsx";
import { bagList } from "../../lib/client.js";
import { UTILITIES } from "../../lib/dock.js";
import { useDock, openSheet, closeSheet } from "../../lib/dockstate.js";
import Icon from "./Icons.jsx";
import MusicCircle from "./MusicCircle.jsx";
import AMark from "./AMark.jsx";
import { getUid, postJSON } from "../../lib/client.js";

export default function InfoDock() {
  const dock = useDock();
  // the OG liquid glass (slice 14): the bezel bends what passes beneath, the rim's rainbow answers the hand
  const glassRef = useRef(null);
  const glass = useLiquidGlass(glassRef, { id: "lg-infodock", strength: 1.1, prism: 1 });
  const [bagCount, setBagCount] = useState(0);
  const [exploration, setExploration] = useState(null); // { active, auto, off, step, ratio }
  useEffect(() => {
    const on = (e) => setExploration(e.detail || null);
    window.addEventListener("asilum:exploration", on);
    return () => window.removeEventListener("asilum:exploration", on);
  }, []);
  async function stopExploring() {
    try {
      const res = await postJSON("/api/asterisk/memory", { user: getUid(), explorationOff: true });
      if (res.ok) { setExploration((x) => ({ ...(x || {}), active: false, off: true })); window.dispatchEvent(new CustomEvent("asilum:feed-refresh")); }
    } catch {}
  }
  useEffect(() => {
    const sync = () => setBagCount(bagList().length);
    sync();
    window.addEventListener("asilum:bag", sync);
    return () => window.removeEventListener("asilum:bag", sync);
  }, []);

  function tap(id) {
    if (dock.sheet && dock.sheet.id === id) { closeSheet(); return; }
    openSheet(id);
  }

  return (
    <div ref={glassRef} className="infodock fixture lgrx" role="group" aria-label="info dock">
      {glass}
      {UTILITIES.map((u) => {
        const cur = !!(dock.sheet && dock.sheet.id === u.id);
        return (
          <button
            key={u.id}
            type="button"
            className={"idkey" + (cur ? " cur" : "")}
            onClick={() => tap(u.id)}
            aria-label={u.label.toLowerCase()}
            aria-pressed={cur}
            title={u.label}
          >
            <Icon name={u.icon} size={20} />
            {u.id === "bag" && bagCount > 0 ? <span className="idcount" aria-hidden="true">{bagCount > 99 ? "99+" : bagCount}</span> : null}
            <span className="idlabel">{u.label}</span>
          </button>
        );
      })}
      {exploration && exploration.active ? (
        <button type="button" className="idkey idexplore" onClick={stopExploring} aria-label="exploration active — tap to turn it off" title={`Exploration Active${exploration.ratio ? ` · about ${exploration.ratio}:1 unfamiliar to familiar` : ""} — tap to turn it off`}>
          <AMark className="on" label="|A|" />
          <span className="idlabel">EXPLORING</span>
        </button>
      ) : null}
      <MusicCircle />
    </div>
  );
}
