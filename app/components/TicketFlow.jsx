"use client";

// app/components/TicketFlow.jsx — the third-party purchase-assistant flow.
// Buy/Request → ticket created → availability + price shown → REQUIRED
// disclaimer consent → checkout continues on the ORIGINAL source site.
// ASILUM never fulfills; the source platform confirms/ships/tracks/returns.

import { useEffect, useRef, useState } from "react";
import { getUid, postJSON, sendJSON } from "../../lib/client.js";
import { useOverlayDismiss, useFocusTrap } from "./dismiss.js";

export default function TicketFlow({ item, onClose }) {
  const [state, setState] = useState("creating"); // creating|consent|done|unavailable|error
  const dismissOverlay = useOverlayDismiss(onClose); // mounts when open — AT ghost-click guarded
  // it renders on <body> above the listing popup (slice 14): its own dialog, its own trap
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);
  const [ticket, setTicket] = useState(null);
  const [disclaimer, setDisclaimer] = useState(null);
  const [checked, setChecked] = useState(false);
  const [continueUrl, setContinueUrl] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await postJSON("/api/tickets", { user: getUid(), itemId: item.id });
        const d = await res.json();
        if (dead) return;
        if (!res.ok) { setErr(d.error || "ticket creation failed"); setState("error"); return; }
        setTicket(d.ticket);
        setDisclaimer(d.disclaimer);
        setState(d.ticket.status === "unavailable" ? "unavailable" : "consent");
      } catch {
        if (!dead) { setErr("ticket creation failed — try again"); setState("error"); }
      }
    })();
    return () => { dead = true; };
  }, [item.id]);

  async function consent() {
    if (!checked || !ticket) return;
    try {
      const res = await sendJSON("PATCH", "/api/tickets", {
        id: ticket.id, user: getUid(), action: "consent", consent: true,
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "consent failed"); setState("error"); return; }
      setTicket(d.ticket);
      setContinueUrl(d.continueUrl);
      setState("done");
      if (d.continueUrl) window.open(d.continueUrl, "_blank", "noopener");
    } catch {
      setErr("consent failed — try again");
      setState("error");
    }
  }

  const price = ticket?.currentPriceChecked ?? ticket?.itemPriceAtRequest ?? item.price;

  return (
    <div className="overlay" onClick={dismissOverlay}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-label="purchase request" style={{ maxWidth: 520, display: "block" }} onClick={(e) => e.stopPropagation()}>
        <button className="mclose" onClick={onClose}>×</button>
        <div className="mbody" style={{ padding: "22px 20px" }}>
          <div className="ttl"><span className="red">*</span>PURCHASE REQUEST</div>
          <div className="brand2">{item.title}</div>

          {state === "creating" && <div className="empty">opening a ticket — checking the source…</div>}

          {state === "unavailable" && (
            <>
              <div className="why">this piece is no longer available at the source — the ticket is filed as unavailable.</div>
              <button className="btn wide" onClick={onClose}>BACK TO THE RACK</button>
            </>
          )}

          {state === "consent" && ticket && (
            <>
              <div className="meta">
                <span className="cat">ticket #{ticket.id}</span>
                <span>{ticket.availabilityStatus}</span>
                {price ? <span>· {item.currency || "USD"} {price}</span> : null}
                <span>· via {ticket.sourceName}</span>
              </div>
              <div className="why" style={{ fontSize: 12, lineHeight: 1.55 }}>{disclaimer?.text}</div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11, lineHeight: 1.5, cursor: "pointer" }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
                <span>{disclaimer?.checkbox}</span>
              </label>
              <button className="btn wide" disabled={!checked} style={!checked ? { opacity: 0.4, cursor: "not-allowed" } : null} onClick={consent}>
                CONTINUE TO SOURCE CHECKOUT
              </button>
            </>
          )}

          {state === "done" && (
            <>
              <div className="why">
                ticket <b>#{ticket?.id}</b> is live.{" "}
                checkout continues on the source site (opened in a new tab) — confirmation, tracking, and returns come from them.
              </div>
              <div className="meta"><span className="cat">{ticket?.status}</span></div>
              <a className="buy" href="/orders">SEE YOUR TICKETS →</a>
            </>
          )}

          {state === "error" && (
            <>
              <div className="why red">{err}</div>
              <button className="btn wide" onClick={onClose}>CLOSE</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
