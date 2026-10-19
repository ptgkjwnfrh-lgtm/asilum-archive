"use client";

// app/components/PieceFloat.jsx — A PIECE, FLOATING (owner, 18 Oct 2026: "if
// you double click a product listing it should appear in like a popup
// floating in space that is reactive to movement but the background should
// be a fogged version of the feed"). A double tap or double click on a piece
// card in the Feed lifts it out: the Feed stays where it was behind a fog
// (its own blur and a haze, not a black field), and the piece hangs in the
// middle as a card of the liquid glass — the photograph, "Brand: title",
// SIZE and the price line, ♡ · OFFER · bag — turning with the phone or the
// cursor (FloatView.jsx useTilt) with the rainbow rim answering the hand.
//
// It is a float, not a second popup: OPEN LISTING → hands over to the
// LISTING popup (the one hub), OFFER opens the listing where the offer lives,
// and a tap on the fog, ×, or Escape puts the piece back. Reduced motion:
// the card holds still.

import { useEffect, useRef, useState } from "react";
import { useEscape, useFocusTrap } from "./dismiss.js";
import { useTilt } from "./FloatView.jsx";
import { useLiquidGlass } from "./LiquidGlass.jsx";
import { Lamp, blinkLamp } from "./Chevrons.jsx";
import Icon from "./Icons.jsx";
import { thumbFor, aspectFor } from "../../lib/client.js";
import { pieceName, priceLine, offerMode } from "../../lib/feed/types.js";
import { favorite, bag } from "../../lib/feed/actions.js";
import { isDemoItem, DEMO_LABEL } from "../../lib/social.js";
import { openSheet } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";

export default function PieceFloat({ item, onClose }) {
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const closeRef = useRef(null);
  const [liked, setLiked] = useState(false);
  const [bagged, setBagged] = useState(false);
  useEscape(onClose, true);
  useFocusTrap(layerRef, true);
  useTilt(cardRef, null, true);
  const glass = useLiquidGlass(cardRef, { id: "lg-piecefloat", strength: 0.8, prism: 1 });
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.float = "1";
    return () => { document.body.style.overflow = prev; delete document.documentElement.dataset.float; };
  }, []);
  if (!item) return null;
  const offer = offerMode(item);
  const price = priceLine(item);
  function openListing() { haptic("press"); onClose(); openSheet("listing", { item, title: "LISTING" }); }
  return (
    <div className="pfloat" ref={layerRef} role="dialog" aria-modal="true" aria-label={"the piece, floating: " + pieceName(item)}>
      <button type="button" className="pfloatfog" aria-label="back to the feed" tabIndex={-1} onClick={onClose} />
      <button ref={closeRef} type="button" className="floatclose pfloatclose" aria-label="back to the feed" onClick={onClose}>×</button>
      <div className="pfloatcard lgrx" ref={cardRef}>
        {glass}
        <button type="button" className="pfloatimg" onClick={openListing} aria-label={"open the listing: " + pieceName(item)} style={{ aspectRatio: aspectFor(item.id) }}>
          <img src={item.img || thumbFor(item)} alt="" />
          {isDemoItem(item) ? <span className="pfloatdemo">{DEMO_LABEL}</span> : null}
        </button>
        <div className="pfloatacts">
          <button type="button" className={"lstact" + (liked ? " on" : "")} aria-pressed={liked} aria-label="like" title="LIKE" onClick={async () => { haptic("press"); setLiked(true); const r = await favorite(item); if (!r || !r.ok) setLiked(false); }}><Icon name="heart" size={24} /></button>
          {offer.mode === "none"
            ? <span className="lstofferword quiet" title={offer.reason} aria-label={"OFFER — " + offer.reason}>OFFER</span>
            : <button type="button" className="lstofferword" title={offer.reason} onClick={openListing}>OFFER</button>}
          <button type="button" className={"lstact" + (bagged ? " on" : "")} aria-pressed={bagged} aria-label={bagged ? "in the bag" : "add to the bag"} title={bagged ? "IN BAG ✓" : "BAG"} onClick={(e) => { blinkLamp(e); setBagged(true); bag(item); }}><Icon name="bag" size={24} /><Lamp /></button>
        </div>
        <h3 className="lstttl">{pieceName(item)}</h3>
        {item.size && item.size.label ? <span className="lstsize">SIZE: {item.size.label}</span> : null}
        {price ? <span className="lstprice">{price}</span> : null}
        <button type="button" className="txtbtn pfloatopen" onClick={openListing}>OPEN LISTING →</button>
      </div>
    </div>
  );
}
