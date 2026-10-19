"use client";

// app/components/ControlCenter.jsx — THE CENTRAL CONTROL DECK (V.2
// Blueprint, owner, 17 Oct 2026, Foundations "Screen map"; the 1 Oct brief
// §1 where the blueprint is silent). Centred at the bottom above the safe
// area, on every size. BASE mode: the five keys of lib/dock.js DECK —
// FEED · SEARCH · POST · MESSAGES · ACCOUNT — with POST as the round disc
// in the center. SEARCH mode: the scoped field takes the row with its scope
// printed as the placeholder (lib/dock.js SEARCH_SCOPES); the keys shrink
// to their glyphs but keep their 44px targets; the three search controls —
// PIECES · WIRE · ASTERISK — sit under the field; CLOSE returns to Base.
// On a phone the deck grows DOWNWARD into rows for search instead of
// squeezing one row. The ad ticker is a separate, stable-height part of the
// same dock (AdStrip below): a mode change never resizes it or resets it.
//
// Search mode opens on the Search key, and on entering Map, Likes or
// Messages — and never opens the keyboard by itself (no autoFocus on
// entry; focus only when the reader taps the field). Submitting a global
// search opens the results sheet over the root; a scoped search filters
// the surface it belongs to live and never widens on its own.
//
// The MESSAGES key IS the mail desk's own button when the desk is
// available (MailDesk.jsx renders it, with its counts and its panel); when
// the desk renders nothing — signed out, or messaging off — the fallback
// key beside it opens the honest MessagesSheet. CSS hides whichever is
// not needed (.cckey-mail:has(.maildesk) .ccfallback).
//
// THE POST DISC HAS TWO LIVES (blueprint 1.25, 1.26): with no popup up it
// opens Post Selection — the six types on the disc; while a popup is up it
// IS the session indicator, with the `01/10` counter, and a tap opens the
// session hub. A long hold on it opens the compact menu (New Session).
// Posting is unavailable inside a popup; the passenger closes it first.
//
// THE FEED KEY, TWICE (1.13): the first tap on the active tab dismisses the
// popup and reveals the tab where it was; the second refreshes the tab,
// which starts at the top (1.14).

import { useEffect, useRef, useState } from "react";
import { deckFor } from "../../lib/nav.js";
import { DECK, HOUSE_LINES, SEARCH_TOGGLES, scopeFor } from "../../lib/dock.js";
import { useDock, setMode, setQuery, setTyping, flipToggle, openSheet, closeSearch, closeSheet, toggleHub, newSession, openHub } from "../../lib/dockstate.js";
import { counter, activeSession } from "../../lib/sessions.js";
import { LONG_PRESS_MS } from "../../lib/disc.js";
import { haptic } from "../../lib/haptics.js";
import Icon from "./Icons.jsx";
import MailDesk from "./MailDesk.jsx";
import { usePlacements } from "./Placements.jsx";
import { useLiquidGlass } from "./LiquidGlass.jsx";
import { Lamp, blinkLamp } from "./Chevrons.jsx";

const ROTATE_MS = 7000;

/** The ad strip: Sponsored placements first, then this device's own
 *  promotion drafts (to their author, labelled DRAFT), then LISTED dated
 *  events from the places record — lib/placements.js is the law. With
 *  nothing eligible it carries the house lines (lib/dock.js HOUSE_LINES)
 *  under the ASILUM tag, never a blank and never an invented offer.
 *  Rotation pauses on hover, focus, reduced motion, and while the reader
 *  types; it is not announced. */
function AdStrip({ typing }) {
  const items = usePlacements();
  // THE STATUS LIGHTS (owner, 18 Oct 2026: blinking squares that turn off,
  // the CD tray's eject light): two red squares at the strip's end, dark at
  // rest; anything put in the bag or any purchase control's lamp makes them
  // blink and settle dark again
  const lightsRef = useRef(null);
  useEffect(() => {
    const on = () => blinkLamp(lightsRef.current, { quiet: true });
    window.addEventListener("asilum:lamp", on);
    window.addEventListener("asilum:bag", on);
    return () => { window.removeEventListener("asilum:lamp", on); window.removeEventListener("asilum:bag", on); };
  }, []);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  useEffect(() => {
    try { reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  }, []);
  const count = items && items.length ? items.length : HOUSE_LINES.length;
  useEffect(() => {
    if (count < 2 || paused || typing || reduced.current) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused, typing]);
  const cur = items && items.length ? items[i % items.length] : null;
  const step = (d) => { if (items && items.length) setI((n) => (n + d + items.length) % items.length); };
  return (
    <div className="adstrip" aria-label="ads and placements" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {/* the slot's name, in red, as the owner drew it (18 Oct 2026: "*ADs") */}
      <span className="adslot" aria-hidden="true">*ADs</span>
      {cur ? (
        <>
          <a className="adline" href={cur.href} aria-label={cur.label.toLowerCase() + " placement: " + cur.line}>
            <span className={"adtag " + cur.kind}>{cur.label}</span>
            <span className="adtext">{cur.line}</span>
          </a>
          {items.length > 1 && (
            <span className="adnav">
              <button className="adbtn" onClick={() => step(-1)} aria-label="previous placement"><Icon name="back" size={14} /></button>
              <span className="adcount" aria-hidden="true">{i % items.length + 1}/{items.length}</span>
              <button className="adbtn" onClick={() => step(1)} aria-label="next placement"><Icon name="back" size={14} className="flip" /></button>
            </span>
          )}
        </>
      ) : (
        <span className="adline notice" data-house="1">
          <span className="adtag asilum">ASILUM</span>
          <span className="adtext">{items === null ? "…" : HOUSE_LINES[i % HOUSE_LINES.length]}</span>
        </span>
      )}
      <span className="devlights" ref={lightsRef} aria-hidden="true"><Lamp /><Lamp /></span>
    </div>
  );
}

export default function ControlCenter({ kind, pathname }) {
  const dock = useDock();
  const routes = deckFor(kind);
  const feed = routes[0];
  const account = routes[routes.length - 1];
  const inSearch = dock.mode === "search";
  // the search popup (owner reference, 18 Oct 2026) holds its own field and the |A|; while it is up the deck keeps only its keys
  const searchPopupUp = !!(dock.sheet && dock.sheet.id === "search");
  const deckField = inSearch && !searchPopupUp;
  const scope = scopeFor({ pathname, sheet: dock.sheet && dock.sheet.id, likesTab: dock.likesTab });
  const fieldRef = useRef(null);
  // the OG liquid glass (slice 14): the deck's bezel bends the Feed scrolling beneath it
  const glassRef = useRef(null);
  const glass = useLiquidGlass(glassRef, { id: "lg-deck", strength: 1.1, prism: 1 });

  // entering Map puts the dock in search mode — no keyboard
  useEffect(() => {
    if (String(pathname || "").startsWith("/map")) setMode("search");
    else if (!dock.sheet) setMode("base");
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e) {
    e.preventDefault();
    const q = String(dock.q || "").trim();
    if (scope.id === "global") { if (q) openSheet("search"); return; }
    if (scope.id === "messages") {
      // the mail desk's own find, never the whole app
      window.dispatchEvent(new CustomEvent("asilum:dm-find", { detail: { q } }));
    }
    // map and likes scopes filter live through the dock state
  }

  function press(id) {
    if (id === "search") {
      setMode("search");
      // the search popup holds its own field (owner reference, 18 Oct 2026): the key opens it at once
      if (!dock.sheet || dock.sheet.id !== "search") openSheet("search");
      return;
    }
    if (id === "post") {
      if (popupUp) { haptic("press"); toggleHub(); return; }
      if (dock.sheet && (dock.sheet.id === "postselect" || dock.sheet.id === "post")) { closeSheet(); return; }
      openSheet("postselect");
      return;
    }
    if (id === "messages") { openSheet("messages"); return; }
  }

  const popupUp = !!dock.sheet || !!dock.hub.hubOpen;
  const active = activeSession(dock.hub);
  const sessionCount = popupUp && active ? counter(dock.hub, active.id) : "";
  const [menu, setMenu] = useState(false);
  const hold = useRef(null);
  function holdStart(e) {
    if (e.button) return;
    hold.current = { fired: false, t: setTimeout(() => { hold.current.fired = true; haptic("press"); setMenu(true); }, LONG_PRESS_MS) };
  }
  function holdEnd() {
    const h = hold.current; hold.current = null;
    if (!h) return;
    clearTimeout(h.t);
    if (!h.fired) press("post");
  }
  function holdCancel() { const h = hold.current; hold.current = null; if (h) clearTimeout(h.t); }

  function feedTap(e, dest) {
    if (dock.sheet || dock.hub.hubOpen) { e.preventDefault(); closeSheet(); return; }
    if ((pathname || "/") === dest.href && dest.href === "/") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("asilum:feed-refresh"));
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
  }

  const sheetIs = (id) => !!(dock.sheet && dock.sheet.id === id);

  function key(k) {
    if (k.kind === "route") {
      const dest = k.id === "feed" ? feed : account;
      const cur = dest.match(pathname || "/") && !dock.sheet;
      return (
        <a key={k.id} className={"tabl" + (cur ? " cur" : "")} href={dest.href} aria-current={cur ? "page" : undefined} onClick={k.id === "feed" ? (e) => feedTap(e, dest) : undefined}>
          <Icon name={dest.icon} size={22} />
          <span className="tbl">{dest.label}</span>
        </a>
      );
    }
    if (k.kind === "disc") {
      const cur = sheetIs("post") || sheetIs("postselect") || !!dock.hub.hubOpen;
      const indicator = popupUp;
      return (
        <span key={k.id} className="ccpostwrap">
          <button
            type="button"
            className={"tabl ccpost" + (cur ? " cur" : "") + (indicator ? " ccsessions" : "")}
            aria-label={indicator ? "sessions " + sessionCount : "post"}
            aria-pressed={cur}
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerLeave={holdCancel}
            onPointerCancel={holdCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="ccdisc">
              <Icon name={indicator ? "disc" : "post"} size={24} />
              {indicator && sessionCount ? <b className="cccount" aria-hidden="true">{sessionCount}</b> : null}
            </span>
            <span className="tbl">{indicator ? "SESSIONS" : k.label}</span>
          </button>
          {menu ? (
            <div className="ccmenu" role="menu" aria-label="session actions">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); haptic("confirm"); newSession(); }}>NEW SESSION</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); openHub(); }}>SESSIONS</button>
              <button type="button" role="menuitem" onClick={() => setMenu(false)}>CANCEL</button>
            </div>
          ) : null}
        </span>
      );
    }
    if (k.id === "messages") {
      return (
        <span key={k.id} className="cckey-mail">
          <MailDesk />
          <button type="button" className={"tabl ccfallback" + (sheetIs("messages") ? " cur" : "")} onClick={() => press("messages")} aria-label="messages">
            <Icon name="messages" size={22} /><span className="tbl">{k.label}</span>
          </button>
        </span>
      );
    }
    // search: a mode
    const cur = inSearch && !dock.sheet;
    return (
      <button key={k.id} type="button" className={"tabl" + (cur ? " cur" : "")} onClick={() => press("search")} aria-label="search" aria-pressed={cur}>
        <Icon name="search" size={22} /><span className="tbl">{k.label}</span>
      </button>
    );
  }

  return (
    <div ref={glassRef} className={"ccenter lgrx" + (inSearch ? " ccsearching" : "")} data-scope={scope.id} data-mode={inSearch ? "search" : "base"}>
      {glass}
      <nav className="tabbar" aria-label="control deck">
        {deckField && (
          <form className="ccsearch" role="search" onSubmit={submit}>
            <label className="ccfield">
              <Icon name="search" size={18} />
              <input
                ref={fieldRef}
                type="search"
                aria-label={scope.placeholder}
                placeholder={scope.placeholder}
                value={dock.q}
                onChange={(e) => { setQuery(e.target.value); setTyping(true); }}
                onBlur={() => setTyping(false)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
                enterKeyHint="search"
              />
              <span className="ccscope" aria-hidden="true">{scope.placeholder.replace(/^Search /, "").toUpperCase()}</span>
            </label>
            <button type="button" className="cckey ccclose" onClick={closeSearch} aria-label="close search"><Icon name="close" size={20} /><span>CLOSE</span></button>
          </form>
        )}
        <div className="ccrow">
          <div className="cctabs">
            {DECK.map((k) => key(k))}
          </div>
        </div>
        {deckField && scope.id === "global" && (
          <div className="cctoggles" role="group" aria-label="search controls">
            {SEARCH_TOGGLES.map((t) => (
              <button key={t.id} className={"cctog" + (dock.toggles[t.id] ? " on" : "")} aria-pressed={!!dock.toggles[t.id]} onClick={() => flipToggle(t.id)}>
                {t.id === "asterisk" ? <i className="red">*</i> : null}{t.label}
              </button>
            ))}
          </div>
        )}
        {inSearch && scope.wide && (
          <div className="cctoggles" role="group" aria-label="search scope">
            <span className="ccscopenote">searching {scope.placeholder.replace(/^Search /, "")}</span>
            <a className="cctog link" href={"/discover?q=" + encodeURIComponent(dock.q || "")}>SEARCH ALL ASILUM →</a>
          </div>
        )}
      </nav>
      <AdStrip typing={dock.typing} />
    </div>
  );
}
