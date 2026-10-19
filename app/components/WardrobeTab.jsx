"use client";
// Profile → WARDROBE tab (Feature C, Phase 3a). Pieces you actually own:
// manual adds here, catalog pieces marked owned, and "bought" ticket
// promotions from /orders. Private in this version — no sharing surface exists
// (owner decision #4 pending). The stylist builds looks around these.

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch, postJSON, sendJSON, getUid } from "../../lib/client.js";
import { dominantPalette } from "../../lib/vision/palette.js";
import { PHOTO_MAX_BYTES } from "../../lib/wardrobe/photo-contract.js";
// STAGE C (V.2 brief §8): gifting — a pending digital transfer the recipient
// must accept. The words both parties see live in one place.
import { TRANSFER_DISCLAIMER, provenanceLabel } from "../../lib/wardrobe/gifts.js";
// V.2 §8: the closet — Cover Flow / grid / list with a direct lookup
import WardrobeFlow from "./WardrobeFlow.jsx";

const CATEGORIES = ["", "outerwear", "tops", "knitwear", "tailoring", "bottoms", "footwear", "accessories", "dresses"];

// Client-side photo prep (Phase 3b): canvas re-encode to JPEG ≤1024px —
// EXIF/GPS metadata never leaves the browser — plus the same 48px palette-v0
// color walk the moodboard uses. No face or biometric analysis exists.
async function decodePhoto(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image could not be decoded"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function prepPhoto(file) {
  const bmp = await decodePhoto(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const small = document.createElement("canvas");
  small.width = 48; small.height = 48;
  const smallContext = small.getContext("2d");
  if (!smallContext) throw new Error("canvas unavailable");
  smallContext.drawImage(bmp, 0, 0, 48, 48);
  if (bmp.close) bmp.close();
  const swatches = (dominantPalette(smallContext.getImageData(0, 0, 48, 48).data) || [])
    .map((s) => ({ hex: s.hex, weight: s.weight }));
  let blob = null;
  for (const quality of [0.85, 0.72, 0.6]) {
    blob = await encodeJpeg(canvas, quality);
    if (blob && blob.size <= PHOTO_MAX_BYTES) break;
  }
  if (!blob || blob.size > PHOTO_MAX_BYTES) throw new Error("photo could not fit the private-storage limit");
  return { blob, swatches };
}

/** The reader's own wardrobe: what they own, add and retire.
 *  Photos are PRIVATE — processed down to the storage limit on-device before
 *  upload, and never part of the public catalog. */
export function WardrobeTab() {
  const [items, setItems] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [form, setForm] = useState({ title: "", brand: "", category: "", sizeLabel: "" });
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [uploads, setUploads] = useState({ available: false });
  const [photoConsent, setPhotoConsent] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(null);
  const fileInputs = useRef({});
  // STAGE C: gifts. `gifts` = the four lists from the server; `gifting` =
  // { id, handle, confirmed } for the one card being offered.
  const [gifts, setGifts] = useState(null);
  const [woffers, setWoffers] = useState(null);
  const loadWoffers = () => authorizedFetch("/api/wardrobe/offers?user=" + encodeURIComponent(getUid() || "")).then((r) => (r.ok ? r.json() : null)).then((d) => setWoffers(d || null)).catch(() => setWoffers(null));
  useEffect(() => { loadWoffers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function toggleOffers(piece) {
    const res = await postJSON("/api/wardrobe/offers", { user: getUid(), action: "accept_offers", itemId: piece.id, on: !piece.acceptOffers });
    const d = await res.json().catch(() => null);
    setNotice(res.ok ? (d.piece.acceptOffers ? "Wardrobe offers on — a buyer who messages you may offer; one negotiation at a time" : `Wardrobe offers off${d.cancelled.length ? ` — ${d.cancelled.length} active negotiation${d.cancelled.length === 1 ? "" : "s"} cancelled` : ""}`) : (d && d.error) || "that did not save");
    refresh(showRetired); loadWoffers();
  }
  async function decideOffer(id, decision) {
    const res = await postJSON("/api/wardrobe/offers", { user: getUid(), action: "respond", id, decision });
    const d = await res.json().catch(() => null);
    setNotice(res.ok ? (decision === "accept" ? "accepted — the buyer has 24 hours to pay; the piece leaves Search meanwhile" : "declined — the piece rests 14 days") : (d && d.error) || "that did not go through");
    loadWoffers();
  }
  async function payOffer(id) {
    const res = await postJSON("/api/wardrobe/offers", { user: getUid(), action: "checkout", id });
    const d = await res.json().catch(() => null);
    if (res.ok && d && d.url) { window.location.assign(d.url); return; }
    setNotice((d && (d.error || d.reason)) || "checkout is not open here");
    loadWoffers();
  }
  async function cancelSale(id) {
    const res = await postJSON("/api/wardrobe/offers", { user: getUid(), action: "cancel_sale", id });
    const d = await res.json().catch(() => null);
    setNotice(res.ok ? "cancelled before handoff — the buyer is refunded in full, the piece rests 14 days, no penalty" : (d && d.error) || "too late to cancel");
    loadWoffers();
  }
  // the closet view and the piece in hand (V.2 §8)
  const [view, setView] = useState("flow");
  const [selectedId, setSelectedId] = useState(null);
  const [gifting, setGifting] = useState(null);
  const signedIn = Boolean((getUid() || "").startsWith("sb-"));

  const refreshGifts = useCallback(async () => {
    if (!(getUid() || "").startsWith("sb-")) { setGifts(null); return; }
    try {
      const res = await authorizedFetch(`/api/wardrobe/gifts?user=${encodeURIComponent(getUid() || "")}`);
      if (!res.ok) { setGifts(null); return; }
      setGifts(await res.json());
    } catch { setGifts(null); }
  }, []);
  useEffect(() => { refreshGifts(); }, [refreshGifts]);

  async function giftAct(payload) {
    const res = await postJSON("/api/wardrobe/gifts", { user: getUid(), ...payload }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setNotice(data.message || data.error || "that did not work."); return null; }
    return data;
  }
  async function previewGift() {
    if (!gifting?.handle.trim()) return;
    const r = await giftAct({ op: "preview", toHandle: gifting.handle.trim() });
    if (r?.handle) setGifting({ ...gifting, handle: r.handle, confirmed: true });
  }
  async function offerGift() {
    if (!gifting?.confirmed) return;
    const key = "g" + Math.abs(Date.now() ^ (gifting.handle.length * 2654435761)).toString(36) + String(gifting.id).slice(0, 8);
    const r = await giftAct({ op: "offer", id: gifting.id, toHandle: gifting.handle, idempotencyKey: key });
    if (r?.ok) { setGifting(null); setNotice(`offered to ${r.transfer.toHandle}. ${TRANSFER_DISCLAIMER}`); refreshGifts(); }
  }
  async function decideGift(op, transferId) {
    const r = await giftAct({ op, transferId });
    if (r?.ok) { setNotice(op === "accept" ? `it is in your wardrobe now. ${TRANSFER_DISCLAIMER}` : op === "decline" ? "declined — nothing changed." : "offer withdrawn."); refresh(); refreshGifts(); }
    else { refresh(); refreshGifts(); }
  }

  const refresh = useCallback(async (includeRetired = showRetired) => {
    try {
      const res = await authorizedFetch(
        `/api/wardrobe?user=${encodeURIComponent(getUid() || "")}&status=${includeRetired ? "all" : "active"}`);
      const data = await res.json();
      if (!res.ok) { setNotice(data.error || "wardrobe unavailable"); setItems([]); return; }
      setItems(data.items || []);
      setUploads(data.uploads || { available: false });
    } catch { setNotice("wardrobe unavailable"); setItems([]); }
  }, [showRetired]);
  useEffect(() => {
    refresh();
    const identityChanged = () => { setPendingDelete(null); setPhotoConsent(false); setGifting(null); refresh(); refreshGifts(); };
    window.addEventListener("asilum:identity", identityChanged);
    return () => window.removeEventListener("asilum:identity", identityChanged);
  }, [refresh, refreshGifts]);

  async function addManual(e) {
    e.preventDefault();
    if (!form.title.trim()) { setNotice("give the piece a name"); return; }
    const res = await postJSON("/api/wardrobe", {
      user: getUid(), source: "manual",
      title: form.title, brand: form.brand || undefined,
      category: form.category || undefined, sizeLabel: form.sizeLabel || undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice(data.error || "could not add the piece"); return; }
    setForm({ title: "", brand: "", category: "", sizeLabel: "" });
    setNotice("added — the stylist can build looks around it now");
    refresh();
  }

  async function setStatus(piece, status) {
    const res = await sendJSON("PATCH", "/api/wardrobe", { user: getUid(), id: piece.id, status }).catch(() => null);
    if (res?.ok) refresh();
    else setNotice("could not update the piece");
  }
  async function remove(piece) {
    const res = await sendJSON("DELETE", "/api/wardrobe", { user: getUid(), id: piece.id }).catch(() => null);
    if (res?.ok) { setPendingDelete(null); setNotice("record removed"); refresh(); }
    else setNotice("could not remove the piece");
  }

  async function uploadPhoto(piece, file) {
    if (!file || !photoConsent || !uploads.available) return;
    setBusyPhoto(piece.id);
    setNotice("");
    try {
      const { blob, swatches } = await prepPhoto(file);
      if (!blob) throw new Error("could not encode the photo");
      const form = new FormData();
      form.set("user", getUid() || "");
      form.set("id", piece.id);
      form.set("consent", uploads.consentVersion);
      if (swatches.length) form.set("palette", JSON.stringify(swatches));
      form.set("photo", blob, "wardrobe.jpg");
      const res = await authorizedFetch("/api/wardrobe/photo", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data.error || "photo upload failed"); return; }
      setPhotoConsent(false);
      setNotice(data.item.colorsSet
        ? "photo stored privately — its colors now describe the piece"
        : "photo stored privately");
      refresh();
    } catch {
      setNotice("photo upload failed");
    } finally { setBusyPhoto(null); }
  }

  async function removePhoto(piece) {
    setBusyPhoto(piece.id);
    try {
      const res = await sendJSON("DELETE", "/api/wardrobe/photo", { user: getUid(), id: piece.id }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) { setNotice("photo erased"); refresh(); }
      else setNotice(data.error || "could not erase the photo");
    } finally {
      setBusyPhoto(null);
    }
  }

  const visible = (items || []).filter((piece) => showRetired || piece.status === "active");
  // in the FLOW and GRID views the detail row below is the selected piece's; LIST shows every row
  const rows = view === "list" ? visible : visible.filter((piece) => String(piece.id) === String(selectedId)).slice(0, 1);

  return (
    <div className="wtab">
      <div className="amemnote">
        Only what you tell us you own lives here — bag and favorites never do.
        Private in this version. Garment photos use private storage and can be
        erased independently or with the piece.
      </div>
      <form className="wadd" onSubmit={addManual}>
        <input aria-label="the piece"
          placeholder="the piece — e.g. black double-rider leather jacket"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          maxLength={200}
        />
        <input aria-label="brand (optional)"
          placeholder="brand (optional)"
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
          maxLength={120}
          style={{ maxWidth: 160 }}
        />
        <select aria-label="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c || "category?"}</option>)}
        </select>
        <input aria-label="size"
          placeholder="size"
          value={form.sizeLabel}
          onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })}
          maxLength={40}
          style={{ maxWidth: 70 }}
        />
        <button className="btn" type="submit">I OWN THIS</button>
      </form>
      {uploads.available && (
        <label className="wconsent">
          <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
          <span>
            I consent to storing garment photos in ASILUM's private storage
            (color statistics only — never face or biometric analysis; erased
            with the piece or my data). Version {uploads.consentVersion}.
          </span>
        </label>
      )}
      {notice && <div className="amemnote">{notice}</div>}
      {/* V.2 chapter 13 (slice 11): private-sale negotiations on my pieces — one at a time, DM first,
          24 hours exclusive on acceptance, ownership on the carrier's delivery. */}
      {woffers && woffers.asOwner.length ? (
        <div className="wgifts">
          <div className="psub">OFFERS ON YOUR PIECES · {woffers.asOwner.length}</div>
          {woffers.asOwner.map((o) => (
            <div className="wrow wgift" key={o.id}>
              <span className="wgiftline"><b>USD {(o.amountCents / 100).toFixed(2)}</b> · piece {o.itemId} · {String(o.stateNow).toUpperCase()}{o.exclusiveUntil ? ` · exclusive until ${String(o.exclusiveUntil).slice(0, 16).replace("T", " ")}` : ""}</span>
              {o.stateNow === "open" ? <><button className="wact" onClick={() => decideOffer(o.id, "accept")}>ACCEPT</button><button className="wact" onClick={() => decideOffer(o.id, "decline")}>DECLINE</button></> : null}
              {o.stateNow === "paid" ? <button className="wact" onClick={() => cancelSale(o.id)}>CANCEL BEFORE HANDOFF</button> : null}
            </div>
          ))}
        </div>
      ) : null}
      {woffers && woffers.asBuyer.length ? (
        <div className="wgifts">
          <div className="psub">WARDROBE OFFERS YOU MADE · {woffers.asBuyer.length}</div>
          {woffers.asBuyer.map((o) => (
            <div className="wrow wgift" key={o.id}>
              <span className="wgiftline"><b>USD {(o.amountCents / 100).toFixed(2)}</b> · {String(o.stateNow).toUpperCase()}{o.exclusiveUntil ? ` · yours until ${String(o.exclusiveUntil).slice(0, 16).replace("T", " ")}` : ""}</span>
              {o.stateNow === "accepted" ? <button className="wact" onClick={() => payOffer(o.id)}>PAY NOW →</button> : null}
            </div>
          ))}
        </div>
      ) : null}
      {/* STAGE C (brief §8): offers waiting on me, and offers I made. */}
      {gifts && gifts.incoming.length ? (
        <div className="wgifts">
          <div className="psub">OFFERED TO YOU · {gifts.incoming.length}</div>
          {gifts.incoming.map((t) => (
            <div className="wrow wgift" key={t.id}>
              <div className="winfo">
                <div className="wttl">{t.item.title}</div>
                <div className="wmeta">{[t.item.brand, t.item.category, t.item.sizeLabel, `from ${t.fromHandle || "a passenger"}`].filter(Boolean).join(" · ")}{t.note ? ` · “${t.note}”` : ""}</div>
                <div className="wdisclaimer">{TRANSFER_DISCLAIMER}</div>
              </div>
              <button className="wact" onClick={() => decideGift("accept", t.id)}>ACCEPT</button>
              <button className="wact" onClick={() => decideGift("decline", t.id)}>DECLINE</button>
            </div>
          ))}
        </div>
      ) : null}
      {gifts && gifts.outgoing.length ? (
        <div className="wgifts">
          <div className="psub">OFFERED BY YOU · {gifts.outgoing.length}</div>
          {gifts.outgoing.map((t) => (
            <div className="wrow wgift" key={t.id}>
              <div className="winfo">
                <div className="wttl">{t.item.title}</div>
                <div className="wmeta">to {t.toHandle} · waiting for them to accept · until {new Date(t.expiresAt).toLocaleDateString()}</div>
                <div className="wdisclaimer">{TRANSFER_DISCLAIMER}</div>
              </div>
              <button className="wact" onClick={() => decideGift("cancel", t.id)}>WITHDRAW</button>
            </div>
          ))}
        </div>
      ) : null}
      {items === null && <div className="pempty">reading your wardrobe…</div>}
      {items !== null && visible.length > 0 ? (
        <WardrobeFlow items={visible} selectedId={selectedId} onSelect={setSelectedId} view={view} onView={setView} />
      ) : null}
      {items !== null && visible.length === 0 && (
        <div className="pempty">
          nothing here yet — add a piece above, or report a purchase ticket as
          {" "}<b>bought</b> on ORDERS &amp; TICKETS and promote it.
        </div>
      )}
      {rows.map((piece) => (
        <div className="wrow" key={piece.id}>
          {piece.photoUrl ? <img className="wthumb" src={piece.photoUrl} alt={piece.title} /> : null}
          <div className="winfo">
            <div className="wttl">{piece.title}{piece.status === "retired" ? <em> · retired</em> : null}</div>
            <div className="wmeta">
              {[piece.brand, piece.category, piece.sizeLabel, provenanceLabel(piece)].filter(Boolean).join(" · ")}
            </div>
            {gifting && gifting.id === piece.id ? (
              <div className="wgiftform">
                {!gifting.confirmed ? (
                  <>
                    <input aria-label="gift to — a passenger's handle" placeholder="to — a passenger's handle" value={gifting.handle}
                      onChange={(e) => setGifting({ ...gifting, handle: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); previewGift(); } }} />
                    <button className="wact" disabled={!gifting.handle.trim()} onClick={previewGift}>FIND</button>
                    <button className="wact" onClick={() => setGifting(null)}>CANCEL</button>
                  </>
                ) : (
                  <>
                    <span className="wmeta">give <b>{piece.title}</b> to <b>{gifting.handle}</b>? they must accept; until then nothing moves. you keep your purchase record and lose the card.</span>
                    <span className="wdisclaimer">{TRANSFER_DISCLAIMER}</span>
                    <button className="wact" onClick={offerGift}>CONFIRM GIFT</button>
                    <button className="wact" onClick={() => setGifting(null)}>CANCEL</button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <a className="amemgo" href={`/stylist?anchor=wardrobe:${piece.id}`}>STYLE IT</a>
          {signedIn && piece.status === "active" && !(gifting && gifting.id === piece.id) && !(gifts && gifts.outgoing.some((t) => t.itemId === piece.id)) ? (
            <>
              <button className="wact" aria-label={`Gift ${piece.title}`} onClick={() => { setGifting({ id: piece.id, handle: "", confirmed: false }); setNotice(""); }}>GIFT</button>
              <button className={"wact" + (piece.acceptOffers ? " on" : "")} aria-pressed={!!piece.acceptOffers} aria-label={`Accept Wardrobe offers on ${piece.title}`} onClick={() => toggleOffers(piece)}>OFFERS {piece.acceptOffers ? "ON" : "OFF"}</button>
            </>
          ) : null}
          {uploads.available ? (
            <>
              <input aria-label="upload a photo of this piece"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                ref={(el) => { fileInputs.current[piece.id] = el; }}
                onChange={(e) => { uploadPhoto(piece, e.target.files?.[0]); e.target.value = ""; }}
              />
              <button
                className="wact"
                disabled={!photoConsent || busyPhoto !== null}
                title={photoConsent ? "" : "tick the consent box first"}
                onClick={() => fileInputs.current[piece.id]?.click()}
              >
                {busyPhoto === piece.id ? "STORING…" : piece.photoPath ? "REPLACE PHOTO" : "ADD PHOTO"}
              </button>
            </>
          ) : null}
          {piece.photoPath ? (
            <button className="wact" disabled={busyPhoto !== null} onClick={() => removePhoto(piece)}>
              {busyPhoto === piece.id ? "ERASING…" : "ERASE PHOTO"}
            </button>
          ) : null}
          {piece.status === "active"
            ? <button className="wact" onClick={() => setStatus(piece, "retired")}>RETIRE</button>
            : <button className="wact" onClick={() => setStatus(piece, "active")}>RESTORE</button>}
          {pendingDelete === piece.id ? (
            <>
              <button className="wact" onClick={() => setPendingDelete(null)}>CANCEL</button>
              <button className="wact" onClick={() => remove(piece)}>CONFIRM REMOVE</button>
            </>
          ) : (
            <button className="wact" aria-label={`Remove ${piece.title}`} onClick={() => setPendingDelete(piece.id)}>REMOVE</button>
          )}
        </div>
      ))}
      {gifts && gifts.given.length ? (
        <div className="wgifts">
          <div className="psub">GIVEN · {gifts.given.length}</div>
          {gifts.given.map((t) => (
            <div className="wrow wgift" key={t.id}>
              <div className="winfo">
                <div className="wttl">{t.item.title}</div>
                <div className="wmeta">to {t.toHandle} · {t.decidedAt ? new Date(t.decidedAt).toLocaleDateString() : ""} · your receipt stays with you</div>
                <div className="wdisclaimer">{TRANSFER_DISCLAIMER}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <button className="wact wtoggle" onClick={() => { setShowRetired(!showRetired); refresh(!showRetired); }}>
        {showRetired ? "HIDE RETIRED" : "SHOW RETIRED"}
      </button>
    </div>
  );
}
