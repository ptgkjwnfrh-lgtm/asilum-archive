"use client";

// app/components/OfflineRow.jsx — the offline queue in Settings (V.2 chapter
// 1 "offline-first, queued actions"; slice 10d): how many writes wait on this
// device, and SEND NOW. The count is the queue's own (lib/outbox.js); nothing
// here pretends a queued write has landed.

import { useEffect, useState } from "react";
import { readOutbox, OUTBOX_EVENT } from "../../lib/outbox.js";
import { flushOfflineQueue } from "../../lib/client.js";

export default function OfflineRow() {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => {
    const sync = () => setCount(readOutbox().length);
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    window.addEventListener("online", sync);
    return () => { window.removeEventListener(OUTBOX_EVENT, sync); window.removeEventListener("online", sync); };
  }, []);
  return (
    <div className="rkrow">
      <div className="rkname">Offline actions</div>
      <div className="rkctl">
        <span className="rkmono">{count === 0 ? "NONE WAITING" : `${count} WAITING`}</span>
        {count > 0 ? <button className="fitbtn" onClick={() => flushOfflineQueue().then((r) => { setCount(r.kept); setNote(`${r.sent} sent${r.dropped ? `, ${r.dropped} refused by the server and dropped` : ""}${r.kept ? `, ${r.kept} still waiting` : ""}`); })}>SEND NOW</button> : null}
      </div>
      <div className="rkdesc">a like, a pass, a follow made while the device was offline waits here and is sent in order when the connection returns. {note}</div>
    </div>
  );
}
