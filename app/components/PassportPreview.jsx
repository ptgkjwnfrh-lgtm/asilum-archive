"use client";

// app/components/PassportPreview.jsx — the bearer's passport, in preview
// (owner, 9 Sep evening: "in the about me there should be a preview of the
// user's passport"). A miniature of the /board document — the security
// strip, the nation line, the bearer photo, the data page's key fields, the
// machine zone, the Paris hologram beneath — drawn from the SAME real state
// the document reads (lib/passport/document.js builds the strings for
// both), and a link to the document itself. Nothing is staged: no photo
// shows the empty frame, no account shows UNISSUED in the zone, no taste
// shows UNCHARTED.

import { useEffect, useState } from "react";
import { authorizedFetch, getUid } from "../../lib/client.js";
import { getProfileInfo } from "../../lib/social.js";
import { vizState } from "../../lib/brain/memory.js";
import { tasteClass } from "../../lib/brain/taste-class.js";
import { convictionsOf, mrzLines, sinceDisplay } from "../../lib/passport/document.js";
import ParisMap, { useParisRoads } from "./ParisMap.jsx";

// UV tinting of a machine-zone line: data runs glow green, chevron filler
// reads as the red thread. Shared with the document on /board.
export function MrzTint({ line }) {
  return line.split(/(<+)/).map((seg, i) =>
    seg.startsWith("<") ? <i key={i}>{seg}</i> : seg && <b key={i}>{seg}</b>);
}

export default function PassportPreview() {
  const map = useParisRoads();
  const [uid, setUid] = useState(null);
  const [info, setInfo] = useState({ name: "", handle: "" });
  const [since, setSince] = useState("");
  const [photo, setPhoto] = useState(null);
  const [boards, setBoards] = useState([]);
  const [weights, setWeights] = useState(null);
  const [tickets, setTickets] = useState(0);
  const [area, setArea] = useState(0);

  useEffect(() => {
    const user = getUid() || "";
    setUid(user || null);
    setInfo(getProfileInfo());
    setArea(new Date().getTimezoneOffset());
    try {
      setSince(window.localStorage.getItem("asilum-member-since") || "");
      setPhoto(window.localStorage.getItem("asilum-pp-photo") || null);
    } catch {}
    const q = "?user=" + encodeURIComponent(user);
    authorizedFetch("/api/boards" + q)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setBoards(d.boards || []); })
      .catch(() => {});
    authorizedFetch("/api/profile" + q)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setWeights(vizState(d.profile).weights); })
      .catch(() => {});
    authorizedFetch("/api/tickets" + q)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTickets(Array.isArray(d.tickets) ? d.tickets.length : 0); })
      .catch(() => {});
  }, []);

  const conv = convictionsOf(weights);
  const pinCount = boards.reduce((s, b) => s + ((b.items && b.items.length) || 0), 0);
  const mrz = mrzLines({ uid, name: info.name, since, pinCount, ticketCount: tickets, areaCode: area });

  return (
    <a className="ppmini" href="/board" aria-label="open your passport">
      {map && (
        <div className="ppholo" aria-hidden="true">
          <div className="ppholo-a"><ParisMap map={map} /></div>
          <div className="ppholo-b"><ParisMap map={map} hot /></div>
        </div>
      )}
      <div className="ppsec"><span className="ppnum">№ AS·{String(boards.length).padStart(2, "0")}·{String(conv.length).padStart(2, "0")}</span></div>
      <div className="ppnation">ASILUM <b>*</b> FASHION PASSPORT</div>
      <div className="ppminibody">
        <span className="ppphoto ppminiphoto" aria-hidden="true">
          {photo ? <img src={photo} alt="" /> : <span className="ppphotoempty">◉</span>}
        </span>
        <dl className="ppid ppminiid">
          <div className="sp3"><dt>USERNAME</dt><dd>{(info.name || "UNNAMED READER").toUpperCase()} <span className="ppmono">{info.handle}</span></dd></div>
          <div className="sp3"><dt>ACCOUNT NO</dt><dd className="ppmono">{uid || "—"}</dd></div>
          <div><dt>MEMBER SINCE</dt><dd>{sinceDisplay(since)}</dd></div>
          <div><dt>CLASS</dt><dd>{uid && uid.startsWith("sb-") ? "AUTHENTICATED" : "DEVICE IDENT"}</dd></div>
          <div className="sp3"><dt>TASTE CLASS</dt><dd><span className="red">*</span> {tasteClass(conv)}</dd></div>
          <div><dt>BOARDS</dt><dd>{boards.length}</dd></div>
          <div><dt>CONVICTIONS</dt><dd>{conv.length} ACTIVE</dd></div>
        </dl>
      </div>
      <div className="ppmrz ppminimrz"><MrzTint line={mrz.top} /><br /><MrzTint line={mrz.bottom} /></div>
      <span className="ppminiopen">OPEN THE PASSPORT →</span>
    </a>
  );
}
