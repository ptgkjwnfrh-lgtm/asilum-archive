"use client";
// app/components/AttendanceBlock.jsx — WHERE YOU WENT (V.2 17.19; slice 12):
// the passenger's attendance records on the Passport, each CLAIMED or
// SUBSTANTIATED by the server's reading of what is on record. Withdraw with one
// tap. The evidence itself stays the passenger's; a reader sees the word.

import { useEffect, useState } from "react";
import { authorizedFetch, sendJSON, getUid } from "../../lib/client.js";
import { attendanceLine } from "../../lib/passport/attendance.js";

export default function AttendanceBlock({ uid }) {
  const [rows, setRows] = useState(null);
  const load = () => authorizedFetch("/api/passport/attendance?user=" + encodeURIComponent(uid || getUid() || "")).then((r) => (r.ok ? r.json() : null)).then((d) => setRows(d && Array.isArray(d.records) ? d.records : [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function withdraw(eventId) {
    await sendJSON("DELETE", "/api/passport/attendance", { user: uid || getUid(), eventId }).catch(() => null);
    load();
  }
  if (!rows || !rows.length) return null;
  return (
    <div className="bdatt" aria-label="where you went">
      <b>WHERE YOU WENT · {rows.length}</b>
      {rows.map((r) => (
        <div key={r.eventId}>
          <span>{attendanceLine(r)}</span>
          {r.status === "claimed" ? <span className="sub"> — {r.reason}</span> : null}
          {" "}<button type="button" className="txtbtn" onClick={() => withdraw(r.eventId)}>WITHDRAW</button>
        </div>
      ))}
    </div>
  );
}
