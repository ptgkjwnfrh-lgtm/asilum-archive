"use client";

// app/components/NoticesSheet.jsx — NOTICES, the bell's sheet (V.2
// Blueprint, owner, 17 Oct 2026, Foundations "Info Dock"). Reads the
// in-app notification outbox (`GET /api/notifications`, V.2 §5): sold
// likes today; offers, discounts, availability, score and BRDCST notices as
// those chapters land. Delivery is in-app only — the route says so and this
// sheet repeats it rather than implying push or email.
//
// Honest states, in order: signed out (notices need an account), loading,
// unavailable (the store could not answer), empty, the list. Opening the
// sheet marks what it shows as read, once, through the same route.

import { useEffect, useState } from "react";
import { authorizedFetch, getUid } from "../../lib/client.js";

function when(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
  } catch { return ""; }
}

export default function NoticesSheet() {
  const [state, setState] = useState({ status: "loading", notices: [], delivery: "" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = getUid();
      if (!uid || !uid.startsWith("sb-")) { setState({ status: "signed-out", notices: [], delivery: "" }); return; }
      try {
        const r = await authorizedFetch("/api/notifications?user=" + encodeURIComponent(uid), { cache: "no-store" });
        if (r.status === 401) { if (!cancelled) setState({ status: "signed-out", notices: [], delivery: "" }); return; }
        if (!r.ok) { if (!cancelled) setState({ status: "unavailable", notices: [], delivery: "" }); return; }
        const d = await r.json();
        const notices = Array.isArray(d.notifications) ? d.notifications : [];
        if (cancelled) return;
        setState({ status: "ok", notices, delivery: typeof d.delivery === "string" ? d.delivery : "" });
        const unread = notices.filter((n) => !n.readAt && !n.read_at).map((n) => n.id).filter(Boolean);
        if (unread.length) {
          authorizedFetch("/api/notifications", {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ user: uid, read: unread }),
          }).catch(() => {});
        }
      } catch { if (!cancelled) setState({ status: "unavailable", notices: [], delivery: "" }); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.status === "signed-out") {
    return <div className="pempty">Notices need an account.<br /><span style={{ fontSize: 12 }}>Sign in from ACCOUNT to keep them across devices.</span></div>;
  }
  if (state.status === "loading") return <div className="pempty">…</div>;
  if (state.status === "unavailable") return <div className="pempty">Notices are unavailable right now.</div>;
  if (!state.notices.length) {
    return <div className="pempty">Nothing yet.<br /><span style={{ fontSize: 12 }}>A liked piece that sells, an offer, a discount, an item back in stock — they land here.</span></div>;
  }
  return (
    <div className="notices">
      {state.notices.map((n) => (
        <div className={"noticerow" + (n.readAt || n.read_at ? "" : " unread")} key={n.id}>
          <span className="noticekind">{String(n.kind || "notice").replace(/-/g, " ").toUpperCase()}</span>
          <span className="noticebody">{n.body || n.subject || ""}</span>
          <span className="noticewhen">{when(n.createdAt || n.created_at)}</span>
        </div>
      ))}
      {state.delivery ? <div className="fine">{state.delivery}</div> : null}
    </div>
  );
}
