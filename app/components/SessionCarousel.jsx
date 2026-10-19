"use client";

// app/components/SessionCarousel.jsx — THE SESSION HUB's face (V.2
// Blueprint, owner, 17 Oct 2026, clauses 1.4–1.8, 1.21–1.25, 1.29–1.35).
// Up to ten preserved sessions as overlapping glass panels in a spatial
// carousel, a floating `01/10` counter on the right, a `×` on the focused
// panel and swipe-up to close with Undo, and the session dial beneath —
// the same Disc as Post Selection, labelled, with the central `+` that
// needs a long hold to open its compact menu (New Session, Rename, Close).
// Rotating the disc moves the carousel; swiping the carousel turns the disc
// (2.6). Previews are static (1.35) and sensitive ones are hidden (1.34).
//
// Opened from the deck's session indicator (the Post disc, while a popup is
// up) and rendered by SheetHost as the "sessions" view.

import { useEffect, useRef, useState } from "react";
import { useDock, switchSession, closeSession, undoClose, clearUndo, newSession, renameSession, closeManager, previewsRevealed } from "../../lib/dockstate.js";
import { ordered, counter, previewFor, isFull, SESSION_LIMIT } from "../../lib/sessions.js";
import { haptic } from "../../lib/haptics.js";
import Disc from "./Disc.jsx";
import Icon from "./Icons.jsx";

const UNDO_MS = 6000;

export default function SessionCarousel() {
  const dock = useDock();
  const hub = dock.hub;
  const list = ordered(hub);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(null); // session id
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const swipe = useRef(null);

  useEffect(() => { setReveal(previewsRevealed()); }, []);
  // the active session is focused when the hub opens
  useEffect(() => {
    const i = list.findIndex((s) => s.id === hub.activeId);
    setSel(i < 0 ? 0 : i);
  }, [hub.hubOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel > list.length - 1) setSel(Math.max(0, list.length - 1)); }, [list.length, sel]);
  // the undo offer expires on its own
  useEffect(() => {
    if (!hub.undo) return undefined;
    const t = setTimeout(() => clearUndo(), UNDO_MS);
    return () => clearTimeout(t);
  }, [hub.undo]);

  const focused = list[sel] || null;

  function open(i) {
    const s = list[i];
    if (!s) return;
    haptic("confirm");
    switchSession(s.id);
  }
  function close(s) {
    if (!s) return;
    haptic("press");
    closeSession(s.id);
    setMenu(false);
  }

  // swipe on the focused panel: up closes (1.24); left/right turn (2.6)
  function panelDown(e) { swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }
  function panelUp(e, i) {
    const sw = swipe.current; swipe.current = null;
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (dy < -60 && Math.abs(dx) < 50) { close(list[i]); return; }
    if (Math.abs(dx) > 40 && Math.abs(dy) < 40) { setSel((s) => Math.max(0, Math.min(list.length - 1, s + (dx < 0 ? 1 : -1)))); haptic("tick"); return; }
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { if (i === sel) open(i); else setSel(i); }
  }

  const items = list.map((s) => { const p = previewFor(s, { revealSensitive: reveal }); return { id: s.id, label: p.title, icon: p.icon }; });

  return (
    <div className="hub" data-full={isFull(hub) ? "1" : "0"}>
      {hub.manager ? (
        <div className="hubnote" role="status">
          <b>{SESSION_LIMIT} of {SESSION_LIMIT}.</b> Close a session to start another — nothing closes on its own.
          <button type="button" className="txtbtn" onClick={closeManager}>OK</button>
        </div>
      ) : null}

      {list.length === 0 ? (
        <div className="hubempty">
          <p>No sessions yet.</p>
          <button type="button" className="btn ghost" onClick={() => { haptic("confirm"); newSession(); }}>NEW SESSION</button>
        </div>
      ) : (
        <div className="hubstage">
          <div className="hubpanels" aria-label="saved sessions" role="list">
            {list.map((s, i) => {
              const p = previewFor(s, { revealSensitive: reveal });
              const k = i - sel;
              if (Math.abs(k) > 3) return null;
              return (
                <div
                  key={s.id}
                  role="listitem"
                  className={"sesspanel" + (k === 0 ? " sel" : "") + (p.hidden ? " hidden" : "")}
                  style={{ "--k": k, "--ak": Math.abs(k) }}
                  aria-current={k === 0 ? "true" : undefined}
                  onPointerDown={panelDown}
                  onPointerUp={(e) => panelUp(e, i)}
                >
                  <div className="sessthumb" aria-hidden="true">
                    <Icon name={p.icon} size={28} />
                    {p.hidden ? <span className="sessveil">PRIVATE</span> : null}
                  </div>
                  <div className="sesstitle">{renaming === s.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); renameSession(s.id, draft); setRenaming(null); }}>
                      <input autoFocus aria-label="session name" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onBlur={() => { renameSession(s.id, draft); setRenaming(null); }} />
                    </form>
                  ) : <b>{p.title}</b>}
                  </div>
                  <div className="sessmeta">{s.origin.toUpperCase()} · {p.depth} {p.depth === 1 ? "VIEW" : "VIEWS"}</div>
                  {k === 0 ? (
                    <button type="button" className="sessx" aria-label={"close session " + p.title.toLowerCase()} onClick={(e) => { e.stopPropagation(); close(s); }}>×</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="hubcounter" aria-live="polite">{focused ? counter(hub, focused.id) : ""}</div>
        </div>
      )}

      {hub.undo ? (
        <div className="hubundo" role="status">
          <span>Session closed.</span>
          <button type="button" className="txtbtn" onClick={() => { haptic("confirm"); undoClose(); }}>UNDO</button>
        </div>
      ) : null}

      <div className="hubdial">
        <Disc
          name="sessions"
          items={items}
          index={sel}
          onChange={(i) => setSel(i)}
          onSelect={(i) => open(i)}
          onLongPress={() => { setMenu(true); }}
          center={{ icon: "plus", label: focused ? "OPEN" : "NEW", badge: focused ? counter(hub, focused.id) : null }}
          size={200}
        />
        {menu ? (
          <div className="hubmenu" role="menu" aria-label="session actions">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); haptic("confirm"); newSession(); }} disabled={isFull(hub)}>NEW SESSION</button>
            {focused ? <button type="button" role="menuitem" onClick={() => { setMenu(false); setDraft(previewFor(focused).title); setRenaming(focused.id); }}>RENAME</button> : null}
            {focused ? <button type="button" role="menuitem" onClick={() => close(focused)}>CLOSE SESSION</button> : null}
            <button type="button" role="menuitem" onClick={() => setMenu(false)}>CANCEL</button>
          </div>
        ) : null}
        <p className="fine hubhint">hold <b>+</b> for a new session · swipe a session up to close it · tap outside to return</p>
      </div>
    </div>
  );
}
