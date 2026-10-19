"use client";

// app/components/TasteNetwork.jsx — FULL READ as a navigable taste network
// (V.2). Replaces the rotating asterisk on /stats: the ten tags as nodes on a
// ring around the reader, sized by the brain's reading, coloured by the kind
// of evidence behind them (manual / inferred / curated), joined by the
// curated affinity edges (lib/brain/tags.js) and by the reader's own lines
// to the centre. A skill tree, not a brain scan: a readable model of
// preferences, every node able to say why it is lit.
//
// Controls per node — KEEP, REDUCE, REMOVE, EXPLORE — go through
// /api/taste, which snapshots first so UNDO is always one press away. When
// guidance is paused the edits are kept and the ranking ignores them; the
// panel says so instead of hiding the controls.

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch, getUid, postJSON } from "../../lib/client.js";
import { TAGS } from "../../lib/brain/tags.js";

const W = 720, H = 520, CX = 360, CY = 262, RX = 292, RY = 196;
const KIND_LABEL = { manual: "MANUAL", inferred: "INFERRED", curated: "CURATED", none: "UNLIT" };

function nodePos(i, n) {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY };
}

export default function TasteNetwork({ onExplore }) {
  const [net, setNet] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // { op, tag } — the act UNDO refers to
  const reduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load() {
    authorizedFetch("/api/taste?user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setNet(d); setErr(""); })
      .catch(() => setErr("the network could not be read — sign in or answer the first-visit question and try again"));
  }
  useEffect(() => { load(); }, []);

  async function act(op, tag) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJSON("/api/taste", { user: getUid(), op, tag });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr((d && d.error) || "the change was refused"); return; }
      if (d && d.observed === false) { setErr(d.reason || "not observed"); return; }
      setNet((prev) => ({ ...(prev || {}), ...d }));
      setLast(op === "undo" ? null : { op, tag });
      setErr("");
      if (op === "explore" && onExplore) onExplore(tag);
    } finally { setBusy(false); }
  }

  const positions = useMemo(() => TAGS.map((t, i) => ({ tag: t, ...nodePos(i, TAGS.length) })), []);
  const posOf = (tag) => positions.find((p) => p.tag === tag);
  const nodes = net ? net.nodes : TAGS.map((tag) => ({ tag, weight: 0, kind: "none", saves: 0, evidence: [] }));
  const selected = sel ? nodes.find((n) => n.tag === sel) : null;
  const lit = nodes.filter((n) => n.kind !== "none").length;

  return (
    <div className="tnet">
      <div className="tnetgrid">
        <svg className="tnetsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="your taste network — ten tags around you, sized by the brain's reading">
          <defs>
            <radialGradient id="tnet-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--red)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--red)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} className="tnetring" />
          <ellipse cx={CX} cy={CY} rx={RX * 0.55} ry={RY * 0.55} className="tnetring faint" />
          {/* curated affinity — the editorial edges, faint */}
          {(net ? net.edges : []).filter((e) => e.w >= 0.5).map((e) => {
            const a = posOf(e.a), b = posOf(e.b);
            const hot = (sel && (e.a === sel || e.b === sel));
            return <path key={e.a + e.b} d={`M${a.x},${a.y} Q${CX},${CY} ${b.x},${b.y}`} className={"tnetedge" + (hot ? " hot" : "")} style={{ strokeOpacity: hot ? 0.9 : 0.12 + e.w * 0.18 }} />;
          })}
          {/* the reader's own lines: weight to the centre */}
          {nodes.filter((n) => Math.abs(n.weight) > 0.04).map((n) => {
            const p = posOf(n.tag);
            return <line key={"w" + n.tag} x1={CX} y1={CY} x2={p.x} y2={p.y} className={"tnetline " + n.kind + (n.weight < 0 ? " neg" : "")} style={{ strokeWidth: 0.6 + Math.min(1, Math.abs(n.weight)) * 3.2 }} />;
          })}
          <circle cx={CX} cy={CY} r={54} fill="url(#tnet-core)" />
          <circle cx={CX} cy={CY} r={16} className="tnetyou" />
          <text x={CX} y={CY + 34} className="tnetyoulbl" textAnchor="middle">YOU · {lit} LIT</text>
          {nodes.map((n) => {
            const p = posOf(n.tag);
            const r = 9 + Math.min(1, Math.abs(n.weight)) * 20;
            const isSel = sel === n.tag;
            const above = p.y < CY;
            return (
              <g key={n.tag} className={"tnetnode " + n.kind + (isSel ? " sel" : "")} tabIndex={0} role="button"
                 aria-pressed={isSel} aria-label={`${n.tag} — ${KIND_LABEL[n.kind]}${n.weight ? `, reading ${n.weight.toFixed(2)}` : ""}`}
                 onClick={() => setSel(isSel ? null : n.tag)}
                 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(isSel ? null : n.tag); } }}>
                {!reduced && n.kind === "manual" && <circle cx={p.x} cy={p.y} r={r + 6} className="tnetpulse" />}
                <circle cx={p.x} cy={p.y} r={r} className="tnetdot" />
                <text x={p.x} y={above ? p.y - r - 8 : p.y + r + 16} textAnchor="middle" className="tnetlbl">{n.tag}</text>
                {n.saves > 0 && <text x={p.x} y={above ? p.y - r - 20 : p.y + r + 28} textAnchor="middle" className="tnetsaves">{n.saves} SAVED</text>}
              </g>
            );
          })}
        </svg>
        <aside className="tnetpanel" aria-live="polite">
          {!selected ? (
            <>
              <div className="cclbl">THE NETWORK</div>
              <p className="tnetp">Solid lines are your own reading; faint curves are editorial neighbours. Choose a node to see its evidence and to keep, reduce, remove or explore it.</p>
              <ul className="tnetkey">
                <li><i className="k manual" /> MANUAL — you chose it</li>
                <li><i className="k inferred" /> INFERRED — from what you saved, opened and passed</li>
                <li><i className="k curated" /> CURATED — an editorial neighbour, not a claim about you</li>
              </ul>
              {net && net.guidanceEnabled === false && <p className="tnetp warn">guidance is paused — edits are kept; the ranking ignores them until you resume it in SETTINGS.</p>}
              <p className="tnetp faint">A preference in film, food or movement can share a trait with clothing — restraint, texture, pace — but it never rewrites this network on its own. Cross-medium links are yours to confirm in the Feed.</p>
            </>
          ) : (
            <>
              <div className="cclbl">{KIND_LABEL[selected.kind]}</div>
              <h3 className="tnetsel">{selected.tag}</h3>
              <div className="tnetreading">{selected.weight ? `READING ${selected.weight.toFixed(2)}` : "NO READING YET"}</div>
              <ul className="tnetev">
                {selected.evidence.length === 0 && <li>nothing yet — a save, an open or a KEEP lights it.</li>}
                {selected.evidence.map((e, i) => <li key={i}>{e.what}</li>)}
              </ul>
              <div className="tnetacts">
                <button className="txtbtn" disabled={busy} onClick={() => act("keep", selected.tag)}>KEEP</button>
                <button className="txtbtn" disabled={busy || !selected.weight} onClick={() => act("reduce", selected.tag)}>REDUCE</button>
                <button className="txtbtn warn" disabled={busy || selected.kind === "none"} onClick={() => act("remove", selected.tag)}>REMOVE</button>
                <button className="txtbtn" disabled={busy} onClick={() => act("explore", selected.tag)}>EXPLORE →</button>
              </div>
              {net && net.guidanceEnabled === false && <p className="tnetp warn">guidance is paused — this edit is kept, not ranked with.</p>}
            </>
          )}
          {(last || (net && net.undo)) && (
            <div className="tnetundo">
              {last ? `${last.op.toUpperCase()} · ${last.tag}` : "one change waiting"} · <button className="txtbtn" disabled={busy} onClick={() => act("undo")}>UNDO</button>
            </div>
          )}
          {err && <p className="tnetp warn">{err}</p>}
        </aside>
      </div>
    </div>
  );
}
