"use client";

// app/components/ListingSheet.jsx — THE LISTING POPUP (V.2 Blueprint,
// owner, 17 Oct 2026, Foundations: "LISTING opens as a floating popup over
// the softened Feed with a photo carousel, LIKE, OFFER, bag, sizes, price,
// three tags and the expander to everything behind the product"). It
// replaces the feed page's item modal (July–October): the same depth, in
// the session hub, so Back returns to it and the Feed keeps its place.
//
// THE TAGS (slice 4, lib/tagging/grammar.js): LEFT: RIGHT over the record
// and the typed rows ASTERISK's tagger wrote; three visible, all certain, a
// state that matters now (PRODUCT: SOLD) in the third slot; the + beside
// the third opens BEHIND THE PRODUCT — every other tag, then the
// provenance, the evidence lines, ASTERISK's why, the designers and the
// pieces it goes with. Tap a side to search it; long-press to pin it.
//
// THE LOOK (owner's reference of 18 Oct 2026, docs/v2/references/
// 2026-10-18-feed/5.jpg): "unverified" on the photograph — only when the
// verification ledger says so; beneath it ♡ · OFFER · bag; then
// "brand: title", "SIZE: XL (fit)" and "35.00 USD" in Michroma.
//
// Honesty: OFFER is real on a native Storefront listing (slice 6) and on a
// Wardrobe piece whose owner takes offers (DM first, chapter 13, slice 11);
// anywhere else the word is QUIET — a label with the reason, never a dead
// button (lib/feed/types.js offerMode). The purchase request is the real
// ticket flow; a demo record has no purchase control and says why; "view
// source" links the real listing.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "./dismiss.js";
import { fitPhrase } from "../../lib/brain/sizing.js";
import { thumbFor, aspectFor, safeExternalUrl, fitProfileForBrain } from "../../lib/client.js";
import { isDemoItem, DEMO_NOTE, followedBrands, setFollowBrand } from "../../lib/social.js";
import { favorite, pass, bag, share, opened } from "../../lib/feed/actions.js";
import { bagList } from "../../lib/client.js";
import { ColorEvidenceLine, OriginLine, useFitProfile } from "./ProductSignals.jsx";
import VerificationBadge from "./VerificationBadge.jsx";
import FloatView, { askTilt } from "./FloatView.jsx";
import SaveButton from "./SaveButton.jsx";
import TicketFlow from "./TicketFlow.jsx";
import AsteriskWhy from "./AsteriskWhy.jsx";
import Icon from "./Icons.jsx";
import { openSheet } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";
import { getUid } from "../../lib/client.js";
import { isNativeItem, startNativeCheckout } from "../../lib/storefront/client.js";
import { postJSON } from "../../lib/client.js";
import TagRow from "./TagChip.jsx";
import { Lamp, blinkLamp, ChevronText } from "./Chevrons.jsx";

/** Chapter 11 (slice 12): the valuation read — comparables ASILUM recorded, else rank × era in words, else the stake. Says which rung answered. */
function ValuationLine({ item }) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    if (!item || !item.id || isDemoItem(item)) { setV(null); return undefined; }
    fetch("/api/valuation?item=" + encodeURIComponent(item.id)).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setV(d && d.valuation ? d.valuation : null); }).catch(() => { if (live) setV(null); });
    return () => { live = false; };
  }, [item && item.id]);
  if (!v) return null;
  const rung = v.basis === "comparables" ? "COMPARABLES" : v.basis === "rank-era" ? "RANK × ERA" : "THE STAKE";
  return <p className="vline"><b>VALUATION · {rung} · {String(v.confidence).toUpperCase()}</b><ChevronText text={v.line} /></p>;
}
import { tagsFor, visibleTags } from "../../lib/tagging/grammar.js";
import { priceLine, offerMode, pieceName } from "../../lib/feed/types.js";

function eraLabel(era) {
  if (!era) return null;
  if (era.season && era.year) return era.season + " " + era.year;
  if (era.year) return String(era.year);
  if (era.decade) return era.decade;
  return null;
}

export default function ListingSheet({ item: given, id }) {
  const [item, setItem] = useState(given || null);
  const [rel, setRel] = useState([]);
  const [evidence, setEvidence] = useState(null);
  const [sameShot, setSameShot] = useState(null);
  const [typed, setTyped] = useState([]);
  const [badge, setBadge] = useState(null);
  const [behind, setBehind] = useState(false);
  const [float, setFloat] = useState(null);
  const [ticket, setTicket] = useState(false);
  const [notice, setNotice] = useState("");
  const [buying, setBuying] = useState(false);
  // NATIVE COMMERCE (slice 6): an OFFER on a native listing is real — a
  // 24-hour offer the seller accepts, declines or counters (7.20); a
  // reserved listing offers the waiting queue instead (7.10).
  const [offer, setOffer] = useState({ open: false, amount: "", state: "" });
  const [queue, setQueue] = useState(null);
  const [liked, setLiked] = useState(false);
  const [bagged, setBagged] = useState(false);
  const [slide, setSlide] = useState(0);
  const fit = useFitProfile();
  const fitBrain = fitProfileForBrain(fit);
  const openedRef = useRef(new Set());
  const itemId = item ? item.id : id;

  // the record, its neighbours and what could be seen — one request
  useEffect(() => {
    if (!itemId) return undefined;
    let live = true;
    setRel([]); setEvidence(null); setSameShot(null); setTyped([]); setBehind(false); setSlide(0);
    fetch("/api/related?item=" + encodeURIComponent(itemId) + "&limit=6").then((r) => r.json()).then((d) => {
      if (!live) return;
      if (d.item && !given) setItem(d.item);
      setRel(d.items || []); setEvidence(d.evidence || null); setSameShot(d.sameShot || null); setTyped(Array.isArray(d.typedTags) ? d.typedTags : []);
    }).catch(() => {});
    fetch("/api/verification/listing?ids=" + encodeURIComponent(itemId)).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setBadge(d && d.items && d.items[0] ? d.items[0].badge || null : null); }).catch(() => { if (live) setBadge(null); });
    try { setBagged(bagList().some((b) => b.id === itemId)); } catch {}
    return () => { live = false; };
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  // opening a record is a click the reader chose: it teaches, once per piece
  useEffect(() => {
    if (item && item.id && !openedRef.current.has(item.id)) { openedRef.current.add(item.id); opened(item); }
  }, [item && item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEscape(() => setFloat(null), !!float);

  if (!item) return <p className="deck">reading the listing…</p>;

  const images = Array.isArray(item.images) && item.images.length > 1 ? item.images : [item.img || thumbFor(item)];
  // the taste keys the STAMP inherits as evidence (identity, never state)
  const tags = Object.keys(item.tags || {});
  const { shown, behind: rest } = visibleTags(tagsFor(item, { typed, state: { verification: badge && badge.state !== "none" ? badge.state : null } }));
  const demo = isDemoItem(item);
  const following = followedBrands().includes(item.brand);
  const fitLine = fitPhrase(item.size, fitBrain);

  async function like() {
    haptic("press"); setLiked(true);
    const r = await favorite(item);
    if (!r || !r.ok) { setLiked(false); setNotice("could not record that — try again"); }
  }
  async function toBag() {
    haptic("press"); setBagged(true);
    await bag(item);
  }
  const native = isNativeItem(item);
  const offerable = offerMode(item);
  const reserved = native && Number.isSafeInteger(item.inventory_available) && item.inventory_available <= 0 && item.availability_status !== "sold";
  async function sendOffer() {
    const cents = Math.round(Number(offer.amount) * 100);
    if (!(cents > 0)) { setOffer((o) => ({ ...o, state: "a whole price, please" })); return; }
    setOffer((o) => ({ ...o, state: "sending…" }));
    try {
      const r = await postJSON("/api/storefront/offers", { user: getUid(), listingId: item.native_listing_id, variantId: item.default_variant_id || null, amountCents: cents });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setOffer((o) => ({ ...o, state: body.error || "the offer could not be sent" })); if (r.status === 401 || r.status === 403) openSheet("account", { title: "ACCOUNT" }); return; }
      setOffer({ open: false, amount: "", state: "" });
      setNotice(body.autoAccepted ? "offer accepted — your price holds at checkout for 24 hours" : "offer sent — the seller has 24 hours; you cannot withdraw it");
    } catch { setOffer((o) => ({ ...o, state: "the offer could not be sent" })); }
  }
  async function joinWait() {
    haptic("press");
    try {
      const r = await postJSON("/api/storefront/queue", { user: getUid(), listingId: item.native_listing_id, join: true });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice(body.error || "could not join the queue"); return; }
      setQueue(body);
      setNotice(`in the queue — ${body.position} of ${body.waiting}. a release is a courtesy alert, not a hold.`);
    } catch { setNotice("could not join the queue"); }
  }

  return (
    <div className="listing" data-id={item.id}>
      <div className="lstmedia">
        <button type="button" className="lstimg" aria-label="see the photograph alone" onClick={async () => { const tilt = await askTilt(); setFloat({ src: images[slide], aspect: aspectFor(item.id), tilt }); }}>
          <img src={images[slide]} alt="" style={{ aspectRatio: aspectFor(item.id) }} />
        </button>
        {images.length > 1 ? (
          <div className="lstdots" role="group" aria-label={images.length + " photographs"}>
            {images.map((src, i) => <button key={src + i} type="button" className={"lstdot" + (i === slide ? " cur" : "")} aria-label={"photograph " + (i + 1)} aria-pressed={i === slide} onClick={() => setSlide(i)} />)}
          </div>
        ) : null}
        {/* the ledger's word on the photograph (reference 5.jpg): "unverified" top-left only when the checks did not pass; CHECKED and PENDING keep the mark */}
        {badge && badge.state !== "none" ? <div className={"lstbadge " + badge.state}><VerificationBadge badge={badge} /></div> : null}
      </div>

      <div className="lstbody">
        {/* the three actions beneath the photograph, as drawn: the heart, the boxed OFFER, the bag — and the hourglass, the one save */}
        <div className="actions lstacts">
          <button type="button" className={"lstact" + (liked ? " on" : "")} onClick={like} aria-pressed={liked} aria-label="like" title="LIKE"><Icon name="heart" size={24} /></button>
          {offerable.mode === "native"
            ? <button type="button" className={"lstofferword" + (offer.open ? " on" : "")} aria-pressed={offer.open} title={offerable.reason} onClick={() => { haptic("press"); setOffer((o) => ({ ...o, open: !o.open })); }}>OFFER</button>
            : offerable.mode === "wardrobe"
              ? <button type="button" className="lstofferword" title={offerable.reason} onClick={() => { haptic("press"); setNotice("an offer starts with a message to the owner — the desk opens"); openSheet("messages", { title: "MESSAGES" }); }}>OFFER</button>
              : <span className="lstofferword quiet" title={offerable.reason} aria-label={"OFFER — " + offerable.reason}>OFFER</span>}
          <button type="button" className={"lstact" + (bagged ? " on" : "")} onClick={(e) => { blinkLamp(e); toBag(); }} aria-pressed={bagged} aria-label={bagged ? "in the bag" : "add to the bag"} title={bagged ? "IN BAG ✓" : "BAG"}><Icon name="bag" size={24} /><Lamp /></button>
          <SaveButton className="lstact lststamp" icon="hourglass" kind="piece" id={item.id} title={[item.brand, item.title].filter(Boolean).join(" — ")} image={item.img || ""} href={"/?item=" + encodeURIComponent(item.id)} meta={item.price ? `${item.currency || "USD"} ${item.price}` : ""} tags={tags} item={item} labels={["STAMP", "STAMPED ✓"]} />
        </div>
        <h3 className="lstttl">{item.brand ? <a className="lstbrand" href={"/discover?q=" + encodeURIComponent(item.brand)} title={"see " + item.brand + " on DISCOVER"}>{pieceName(item)}</a> : pieceName(item)}</h3>
        {(item.size && item.size.label) || fitLine ? (
          <span className="lstsize">{item.size && item.size.label ? "SIZE: " + item.size.label : "SIZE"}{fitLine ? <small> ({fitLine})</small> : null}</span>
        ) : null}
        {priceLine(item) ? <span className="lstprice">{priceLine(item)}</span> : null}
        <div className="meta">
          {item.category ? <span className="cat">{item.category}</span> : null}
          {eraLabel(item.era) ? <span className="era">{eraLabel(item.era)}</span> : null}
        </div>
        {offer.open && native ? (
          <form className="lstoffer" onSubmit={(e) => { e.preventDefault(); sendOffer(); }}>
            <label className="fine" htmlFor="lstoffer-amount">your offer, {item.currency || "USD"} — 24 hours for the seller to accept, decline or counter; it cannot be withdrawn</label>
            <div className="lstofferrow">
              <input id="lstoffer-amount" className="wcap" inputMode="decimal" value={offer.amount} onChange={(e) => setOffer((o) => ({ ...o, amount: e.target.value }))} aria-label="offer amount" />
              <button type="submit" className="buy" onClick={blinkLamp}><Lamp />send ✓</button>
            </div>
            {offer.state ? <span className="fine" role="status">{offer.state}</span> : null}
          </form>
        ) : null}
        <div className="pricerow lstbuy">
          {demo ? <span className="demoflag">{DEMO_NOTE}</span> : reserved ? (
            // 7.9–7.11: every unit is in someone's checkout; others can view, not buy — they wait
            <>
              <button type="button" className="buy" onClick={joinWait} disabled={!!queue}>{queue ? `in the queue · ${queue.position} of ${queue.waiting}` : "temporarily reserved — join the queue"}</button>
              <span className="fine">a release alerts everyone waiting; it stays first come, first served</span>
            </>
          ) : isNativeItem(item) ? (
            // NATIVE COMMERCE (slice 6): a Storefront listing buys HERE — Stripe's
            // hosted checkout through the one client, never the referral ticket.
            // The server stamps readiness; an unready seller is said, not faked.
            <>
              <button type="button" className={"buy" + (item.native_checkout_ready === true ? "" : " soon")} disabled={item.native_checkout_ready !== true || buying}
                title={item.native_checkout_ready === true ? "opens Stripe's secure checkout; the passenger fee is shown before payment" : "this seller's payment path is not enabled yet"}
                onClick={async (e) => { blinkLamp(e); setBuying(true); const r = await startNativeCheckout(item, { user: getUid() }); if (!r.ok) { setBuying(false); setNotice(r.error); if (r.status === 401) openSheet("account", { title: "ACCOUNT" }); } }}>
                <Lamp />{item.native_checkout_ready === true ? (buying ? "opening checkout…" : "buy ↗") : "checkout not enabled"}
              </button>
              <span className="fine">native storefront{item.storefront_name ? " · " + item.storefront_name : ""}{Number.isSafeInteger(item.inventory_available) ? ` · ${item.inventory_available} available` : ""}</span>
            </>
          ) : (
            <>
              <button type="button" className="buy" onClick={(e) => { blinkLamp(e); setTimeout(() => setTicket(true), 420); }}><Lamp />request purchase</button>
              {safeExternalUrl(item.url) ? <a className="buy" href={safeExternalUrl(item.url)} target="_blank" rel="noopener noreferrer">view source ↗</a> : null}
            </>
          )}
        </div>

        <TagRow tags={shown} size="popup" more={() => setBehind((b) => !b)} open={behind} empty="no tags yet — ASTERISK assigns them" />

        {behind ? (
          <div className="lstdepth" aria-label="behind the product">
            <ChevronText className="cclbl" text={"BEHIND THE PRODUCT" + (rest.length ? ` · ${rest.length} more ${rest.length === 1 ? "tag" : "tags"}` : "")} />
            {rest.length ? <TagRow tags={rest} size="popup" label="every other tag" /> : null}
            <ColorEvidenceLine item={item} detailed />
            {sameShot ? (
              <div className="shotline">
                <span aria-hidden="true">◦</span> {sameShot.note}
                <span className="shotline-row">
                  {sameShot.listings.map((l) => (
                    <button key={l.id} type="button" className="shotline-go" onClick={() => openSheet("listing", { id: l.id })}>
                      {l.currency && l.price != null ? `${l.currency} ${l.price}` : "see it"}{l.saving ? <b> · {l.currency || ""} {l.saving} less</b> : null}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
            {evidence ? (
              <div className="sawline">
                {evidence.observations.map((o) => <div className="sawline-said" key={o.id}><span aria-hidden="true">·</span> {o.said}</div>)}
                <div className="sawline-cover">
                  {evidence.checked} of {evidence.total} checks could run
                  {evidence.notChecked.length > 0 ? <span className="sawline-gap"> — {evidence.notChecked.map((n) => n.needs).join("; ")}</span> : null}
                </div>
              </div>
            ) : null}
            <OriginLine item={item} detailed />
            <ValuationLine item={item} />
            {item.designers && item.designers.length ? (
              <div className="designers">{item.designers.map((d) => <a className="dz" key={d} href={"/discover?q=" + encodeURIComponent(d)}>{d}</a>)}</div>
            ) : null}
            <AsteriskWhy item={item} onNotice={setNotice} />
            <div className="actions2">
              <button type="button" onClick={async () => { const ok = await share(item); setNotice(ok ? "item link copied — it carries its taste graph" : "could not share"); }}>share ↗</button>
              <button type="button" onClick={() => { window.location.href = "/stylist?anchor=" + encodeURIComponent(item.id); }}>style it ✂</button>
              <button type="button" onClick={() => { const on = !following; setFollowBrand(item.brand, on); setNotice(on ? `following ${item.brand} — their pieces land in FOLLOWING` : `unfollowed ${item.brand}`); }}>{following ? "following brand ✓" : "follow brand"}</button>
              <button type="button" className="pass" onClick={() => { pass(item); setNotice("passed — fewer like this"); }}>pass</button>
            </div>
            {rel.length ? (
              <div className="mrelwrap">
                <div className="mrelhead">goes with</div>
                <div className="mrel">
                  {rel.map((r) => (
                    <button key={r.id} type="button" className="mrelitem" onClick={() => openSheet("listing", { item: r })}>
                      <img src={r.img || thumbFor(r)} alt={r.title} />
                      <span>{r.brand}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {notice ? <p className="fine" role="status">{notice}</p> : null}
      </div>

      {/* the popup is a pane of glass (a backdrop filter), which would make it the
          containing block of anything fixed inside it: the photograph that
          floats and the ticket flow are full-screen, so they render on <body> */}
      {float ? createPortal(<FloatView src={float.src} aspect={float.aspect} tilt={float.tilt} onClose={() => setFloat(null)} />, document.body) : null}
      {ticket ? createPortal(<TicketFlow item={item} onClose={() => setTicket(false)} />, document.body) : null}
    </div>
  );
}
