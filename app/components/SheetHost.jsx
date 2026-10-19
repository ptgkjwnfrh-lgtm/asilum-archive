"use client";

// app/components/SheetHost.jsx — THE POPUP (V.2 Blueprint, owner, 17 Oct
// 2026, chapter 1; the 1 Oct brief decision 2 where the blueprint is
// silent). Secondary surfaces open at about 60% of the available height
// over the root, which stays visible behind the scrim. One popup is on
// screen at a time; a new one replaces it and the previous stays in the
// session's history (1.1). The gesture grammar (1.2): Back and a swipe
// right restore the previous popup; a swipe down from the header dismisses;
// tapping outside dismisses lightweight popups and never a checkout or an
// edit in progress. Dismissing keeps the session (1.3). It grows to the
// full height for the keyboard, large text and long editing (EXPAND, and
// automatically when a field inside it takes focus). Escape closes it
// (components/dismiss.js); focus is trapped while it is open. While a popup
// is up the fixtures shrink and go translucent (1.12) — `data-popup` on the
// root does that in CSS.
//
// The host knows nothing about what a popup shows: it renders the view the
// hub names (lib/dockstate.js, lib/sessions.js) from the table below. The
// session carousel is the "sessions" view, opened from the deck's session
// indicator.

import { useEffect, useRef, useState } from "react";
import { useDock, closeSheet, backSheet, closeHub, hydrateHub } from "../../lib/dockstate.js";
import { counter } from "../../lib/sessions.js";
import { useEscape, useFocusTrap } from "./dismiss.js";
import { watchOfflineQueue } from "../../lib/client.js";
import { useLiquidGlass } from "./LiquidGlass.jsx";
import Icon from "./Icons.jsx";
import LikesSheet from "./LikesSheet.jsx";
import SearchSheet from "./SearchSheet.jsx";
import MessagesSheet from "./MessagesSheet.jsx";
import OverviewSheet from "./OverviewSheet.jsx";
import BagSheet from "./BagSheet.jsx";
import NoticesSheet from "./NoticesSheet.jsx";
import PostComposer from "./PostComposer.jsx";
import SessionCarousel from "./SessionCarousel.jsx";
import PostSelection from "./PostSelection.jsx";
import ListingSheet from "./ListingSheet.jsx";
import MediaFloat from "./MediaFloat.jsx";
import EchoViewer from "./EchoRail.jsx";
import ScoreSheet from "./ScoreSheet.jsx";
import Onboarding from "./Onboarding.jsx";
import MapSheet from "./MapSheet.jsx";

const VIEWS = {
  likes: { title: "LIKES", render: (p) => <LikesSheet {...p} /> },
  search: { title: "SEARCH", render: (p) => <SearchSheet {...p} />, roomy: true },
  messages: { title: "MESSAGES", render: (p) => <MessagesSheet {...p} /> },
  overview: { title: "OVERVIEW", render: (p) => <OverviewSheet {...p} /> },
  bag: { title: "BAG", render: (p) => <BagSheet {...p} /> },
  notices: { title: "NOTICES", render: (p) => <NoticesSheet {...p} /> },
  post: { title: "POST", render: (p) => <PostComposer compact {...p} />, heavy: true },
  postselect: { title: "POST", render: (p) => <PostSelection {...p} />, roomy: true },
  sessions: { title: "SESSIONS", render: (p) => <SessionCarousel {...p} />, roomy: true },
  // THE ONE FEED (slice 3): the LISTING popup over the softened Feed; STILL
  // and MOTION enlarged with the caption on the media; the ECHO viewer
  listing: { title: "LISTING", render: (p) => <ListingSheet {...p} />, roomy: true },
  media: { title: "STILL", render: (p) => <MediaFloat {...p} />, tall: true },
  echo: { title: "ECHO", render: (p) => <EchoViewer {...p} />, tall: true },
  // a payment page is never dismissed by a tap outside (1.2); the route
  // itself arrives with native commerce
  checkout: { title: "CHECKOUT", render: () => null, heavy: true },
  // the Passenger Score popup (slice 7, 6.18), from Account and Passport only
  score: { title: "PASSENGER SCORE", render: (p) => <ScoreSheet {...p} /> },
  // the Passport's onboarding (14.11, slice 10c): five to seven questions on first opening; an edit in progress is heavy
  onboarding: { title: "PASSPORT", render: (p) => <Onboarding {...p} />, heavy: true },
  // the map above a post (5.5, slice 12): a BRDCST's event pinned, the ring around it
  map: { title: "MAP", render: (p) => <MapSheet {...p} />, roomy: true },
};

const SWIPE_DOWN = 70;
const SWIPE_BACK = 80;

export default function SheetHost() {
  const dock = useDock();
  useEffect(() => { watchOfflineQueue(); }, []);
  const ref = useRef(null);
  const [tall, setTall] = useState(false);
  const hubOpen = !!dock.hub.hubOpen;
  const popup = dock.sheet;
  const open = hubOpen || !!popup;
  const top = hubOpen ? { view: "sessions", props: {} } : popup ? popup.top : null;
  const view = top ? VIEWS[top.view] : null;
  const hasBack = !hubOpen && !!popup && popup.stack.length > 1;
  const headSwipe = useRef(null);
  const bodySwipe = useRef(null);

  useEffect(() => { hydrateHub(); }, []);

  const dismiss = () => (hubOpen ? closeHub() : closeSheet());
  useEscape(() => (hasBack ? backSheet() : dismiss()), open);
  useFocusTrap(ref, open);
  // THE OG LIQUID GLASS (8 Sep: the item detail in the same glass, the page
  // bending under it — 8073a74, 7a6abe5, 19a7bd6; slice 14 restores it on
  // every popup): all four edges lens what lies beneath at half the deck's
  // pull; where the engine cannot bend a backdrop (WebKit) the cards under
  // the edges bend instead. The page is lowered and softened by its own
  // filter while a popup is up ([data-popup] .main), never by a backdrop
  // blur on the scrim — that would make the scrim a backdrop root and leave
  // the popup only a flat colour to bend.
  const glass = useLiquidGlass(ref, { id: "lg-popup", strength: 0.8, prism: 1, active: open, bend: ".card" });

  // a new popup opens at its initial height; a field taking focus inside it
  // lifts it to the full height so the keyboard never covers the input
  useEffect(() => { setTall(!!(top && VIEWS[top.view] && VIEWS[top.view].tall)); }, [popup && popup.sessionId, top && top.view]);
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const node = ref.current;
    const onFocus = (e) => { if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTall(true); };
    node.addEventListener("focusin", onFocus);
    return () => node.removeEventListener("focusin", onFocus);
  }, [open]);

  // the page behind is inert while a popup is up: no scroll-through; the
  // fixtures shrink and go translucent (1.12)
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!open) { delete document.documentElement.dataset.popup; return undefined; }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.popup = "1";
    return () => { document.body.style.overflow = prev; delete document.documentElement.dataset.popup; };
  }, [open]);

  if (!open || !view) return null;
  const title = top.props && top.props.title ? top.props.title : view.title;
  const lightweight = !view.heavy;
  const sessionCount = hubOpen || !popup ? "" : counter(dock.hub, popup.sessionId);

  // swipe down from the header dismisses; swipe right on the body goes back
  function headDown(e) { headSwipe.current = { y: e.clientY }; }
  function headUp(e) {
    const s = headSwipe.current; headSwipe.current = null;
    if (s && e.clientY - s.y > SWIPE_DOWN) dismiss();
  }
  function bodyDown(e) { bodySwipe.current = { x: e.clientX, y: e.clientY }; }
  function bodyUp(e) {
    const s = bodySwipe.current; bodySwipe.current = null;
    if (!s || !hasBack) return;
    if (e.clientX - s.x > SWIPE_BACK && Math.abs(e.clientY - s.y) < 40) backSheet();
  }

  return (
    <div className="sheetscrim" onMouseDown={(e) => { if (e.target === e.currentTarget && lightweight) dismiss(); }}>
      <section ref={ref} className={"sheet lgrx" + (tall ? " tall" : "") + (view.roomy ? " roomy" : "") + (hubOpen ? " hubsheet" : "")} role="dialog" aria-modal="true" aria-label={title}>
        {glass}
        <header className={"sheethead" + (hasBack ? " hasback" : "")} onPointerDown={headDown} onPointerUp={headUp}>
          {hasBack ? (
            <button className="sheetbtn" onClick={backSheet} aria-label="back"><Icon name="back" size={20} /><span>BACK</span></button>
          ) : <span className="sheetgrip" aria-hidden="true" />}
          <h2 className="sheettitle">{title}{sessionCount ? <small className="sheetcount" aria-label={"session " + sessionCount}>{sessionCount}</small> : null}</h2>
          <div className="sheetacts">
            {!hubOpen ? (
              <button className="sheetbtn" onClick={() => setTall((t) => !t)} aria-label={tall ? "shrink the popup" : "expand the popup"} aria-pressed={tall}>
                <Icon name={tall ? "minus" : "plus"} size={20} /><span>{tall ? "SHRINK" : "EXPAND"}</span>
              </button>
            ) : null}
            <button className="sheetbtn" onClick={dismiss} aria-label="close"><Icon name="close" size={20} /><span>CLOSE</span></button>
          </div>
        </header>
        <div className="sheetbody" onPointerDown={bodyDown} onPointerUp={bodyUp}>{view.render(top.props || {})}</div>
      </section>
    </div>
  );
}
