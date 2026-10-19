"use client";

// app/components/ConnectionsRack.jsx — EXTERNAL CONNECTIONS, each with its
// explicit state (V.2 brief §11): Available · Requires approval ·
// Unsupported · Disconnected · Syncing · Error — per CAPABILITY, because one
// provider is several answers (eBay Browse ≠ eBay purchase history). The
// registry is lib/connectors/index.js, read through GET /api/connect.
// Nothing here pretends to be connected: no OAuth flow exists yet, and the
// rack says so in words. "Never" lists what a connection would never be used
// for — a connection is not blanket permission to train ASTERISK.

import { useEffect, useState } from "react";
import { authorizedFetch, getUid } from "../../lib/client.js";

const WORD = {
  "available": "AVAILABLE", "requires-approval": "REQUIRES APPROVAL", "unsupported": "UNSUPPORTED",
  "disconnected": "DISCONNECTED", "syncing": "SYNCING", "error": "ERROR",
};

export default function ConnectionsRack() {
  const [reg, setReg] = useState(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    authorizedFetch("/api/connect?user=" + encodeURIComponent(getUid() || ""), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setReg(d && d.connectors ? d : { connectors: [], failed: true }); })
      .catch(() => { if (live) setReg({ connectors: [], failed: true }); });
    return () => { live = false; };
  }, []);

  async function attempt(platform, capability) {
    setNote("");
    // the music seams: a real redirect when the deployment is keyed (the route answers 503 with the prepared application otherwise)
    const c = reg && reg.connectors.find((x) => x.id === platform);
    if (c && c.flow && c.capabilities.find((x) => x.id === capability && x.state === "disconnected")) {
      window.location.assign(`${c.flow}&capability=${encodeURIComponent(capability)}&user=${encodeURIComponent(getUid() || "")}`);
      return;
    }
    try {
      const r = await authorizedFetch("/api/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: getUid(), platform, capability }) });
      const d = await r.json().catch(() => ({}));
      setNote(d.message || (r.ok ? "" : "that connection is not available."));
    } catch { setNote("that connection is not available."); }
  }

  if (reg === null) return <p className="fine">reading connections…</p>;
  if (reg.failed) return <p className="fine">connections could not be read right now.</p>;
  return (
    <div className="crack">
      <p className="fine">each connection lists what it can do here and what it would never be used for. Spotify and Apple Music connect for real once the deployment holds the owner's approved keys; until then their rows say REQUIRES APPROVAL, and nothing here pretends otherwise.</p>
      {note ? <p className="amemnote" role="status">{note}</p> : null}
      {reg.connectors.map((c) => (
        <section className="cconn" key={c.id} aria-label={c.label}>
          <div className="cconnhead"><b>{c.label}</b><span className="fine">{c.basis}</span></div>
          <ul className="ccaps">
            {c.capabilities.map((cap) => (
              <li key={cap.id} className={"ccap " + cap.state}>
                <span className="ccapname">{cap.id.replace(/-/g, " ")}</span>
                <span className="ccapstate" aria-label={`state: ${WORD[cap.state] || cap.state}`}>{WORD[cap.state] || cap.state.toUpperCase()}</span>
                <span className="ccapbasis">{cap.basis}{cap.trains ? " · may add to your taste record, with your stamp" : ""}</span>
                {cap.state === "available" || cap.state === "disconnected" ? (
                  <button type="button" className="wact" onClick={() => attempt(c.id, cap.id)}>{cap.state === "available" ? "USE" : "CONNECT"}</button>
                ) : null}
              </li>
            ))}
          </ul>
          {c.never && c.never.length ? <p className="fine">never: {c.never.join("; ")}.</p> : null}
        </section>
      ))}
    </div>
  );
}
