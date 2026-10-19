"use client";

// app/components/BehindUploads.jsx — BEHIND THE UPLOAD (V.2 Blueprint,
// owner, 17 Oct 2026, 17.2–17.5; slice 10c). Under the Passport's upload
// station: every manual upload with its editable caption and a BEHIND THE
// UPLOAD control that opens the tags gathered from it — correctable, one
// tap removes a tag. The latest explicit caption overrides any conflicting
// ASTERISK assumption (17.2); deleting an upload removes only its evidence
// and recalculates the taste it alone supported (17.4); every upload starts
// with equal importance and no inferred identity-anchor badge appears here
// (17.3, 17.5) — anchors are the Passport's own onboarding, designated by
// the passenger.

import { useEffect, useState } from "react";
import { authorizedFetch, sendJSON } from "../../lib/client.js";
import { haptic } from "../../lib/haptics.js";

export default function BehindUploads({ uid }) {
  const [uploads, setUploads] = useState(null);
  const [open, setOpen] = useState(null);
  const [captions, setCaptions] = useState({});
  const [note, setNote] = useState("");
  const load = () => authorizedFetch("/api/moodboard?user=" + encodeURIComponent(uid)).then((r) => (r.ok ? r.json() : null)).then((d) => setUploads(d ? (d.uploads || []).filter((u) => u.source === "image-upload") : false)).catch(() => setUploads(false));
  useEffect(() => { if (uid) load(); else setUploads(false); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const on = () => { if (uid) load(); }; window.addEventListener("asilum:upload", on); return () => window.removeEventListener("asilum:upload", on); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function patch(id, body) {
    const res = await sendJSON("/api/moodboard", "PATCH", { user: uid, id, ...body });
    const d = await res.json().catch(() => null);
    if (!res.ok) { haptic("error"); setNote((d && d.error) || "that did not save"); return; }
    haptic("confirm"); setNote(body.caption != null ? "caption saved — it overrides what was assumed" : "tag removed");
    load();
  }
  async function remove(id) {
    const res = await authorizedFetch("/api/moodboard?user=" + encodeURIComponent(uid) + "&id=" + encodeURIComponent(id), { method: "DELETE" });
    const d = await res.json().catch(() => null);
    if (!res.ok) { setNote((d && d.error) || "could not delete"); return; }
    haptic("confirm"); setNote(d && d.recalculated ? `deleted — ${d.recalculated.length} taste edge${d.recalculated.length === 1 ? "" : "s"} it alone supported recalculated` : "deleted");
    load();
  }
  if (uploads === null || uploads === false || !uploads.length) return null;
  return (
    <div className="behind" aria-label="your uploads">
      <div className="cclbl">YOUR UPLOADS · {uploads.length} · EQUAL WEIGHT TO START</div>
      <ul className="behindlist">
        {uploads.map((u) => {
          const tags = (u.tags || []).filter((t) => t && t.tag);
          const isOpen = open === u.id;
          return (
            <li key={u.id} className={"behinditem" + (isOpen ? " open" : "")}>
              <div className="behindrow">
                <input className="behindcap" type="text" maxLength={400} placeholder="a caption — what you like about it" value={captions[u.id] ?? (u.caption || "")} onChange={(e) => setCaptions({ ...captions, [u.id]: e.target.value })} onBlur={() => { const v = (captions[u.id] ?? "").trim(); if (captions[u.id] != null && v !== (u.caption || "")) patch(u.id, { caption: v }); }} aria-label="caption" />
                <button type="button" className="txtbtn" aria-expanded={isOpen} onClick={() => { haptic("press"); setOpen(isOpen ? null : u.id); }}>BEHIND THE UPLOAD {isOpen ? "−" : "+"}</button>
              </div>
              {isOpen ? (
                <div className="behindtags">
                  <span className="fine">{u.analyzedBy === "palette-v0" ? "read from its palette and its filename words" : u.analyzedBy === "filename" ? "read from its filename words" : "read by " + (u.analyzedBy || "nothing")}{u.caption ? " · the caption overrides a conflicting assumption" : ""}. a tag is correctable; nothing here is an identity anchor.</span>
                  {tags.length ? (
                    <ul className="behindtaglist">
                      {tags.map((t) => (
                        <li key={t.tag + t.tag_type}>
                          <span className={"tagchip " + (t.tag_type === "caption" ? "caption" : "")}>{String(t.tag).toUpperCase()}<i>{t.tag_type === "caption" ? " · yours" : ` · ${Math.round((t.confidence || 0) * 100)}%`}</i></span>
                          <button type="button" className="txtbtn" onClick={() => patch(u.id, { removeTag: t.tag, tagType: t.tag_type })}>REMOVE</button>
                        </li>
                      ))}
                    </ul>
                  ) : <span className="fine">no tag was gathered from it.</span>}
                  <button type="button" className="txtbtn" onClick={() => remove(u.id)}>DELETE THE UPLOAD</button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {note ? <p className="fine">{note}</p> : null}
    </div>
  );
}
