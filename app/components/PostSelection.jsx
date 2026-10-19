"use client";

// app/components/PostSelection.jsx — POST SELECTION on the disc (V.2
// Blueprint, owner, 17 Oct 2026: the six publishing types TRANSM · STILL ·
// MOTION · BRDCST · LISTING · ECHO on the same Disc the session dial uses;
// chapter 2 for the physics; clause 1.26: posting is unavailable inside a
// popup, so this opens only from the deck's Post disc). Turn to a type and
// tap the centre, or let it dwell, to enter the composer.
//
// Honesty: the composer (lib/wire/compose.js) derives transmission / post /
// video from what is attached, so TRANSM, STILL and MOTION all open it with
// a hint; BRDCST opens it on the event attachment; ECHO opens it marked
// temporary (24 hours). LISTING is the native storefront (blueprint
// chapter 7, a later slice): it says so with the house `soon` class and
// never pretends.

import { useState } from "react";
import { pushSheet } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";
import Disc from "./Disc.jsx";

export const POST_TYPES = Object.freeze([
  { id: "transm", label: "TRANSM", icon: "list", means: "text" },
  { id: "still", label: "STILL", icon: "stamp", means: "a photo" },
  { id: "motion", label: "MOTION", icon: "feed", means: "a video" },
  { id: "brdcst", label: "BRDCST", icon: "locate", means: "an event or a promotion" },
  { id: "listing", label: "LISTING", icon: "bag", means: "a product for sale" },
  { id: "echo", label: "ECHO", icon: "disc", means: "a temporary story" },
]);

const SOON = {
  listing: "LISTING arrives with the native storefront — SELL and DROP, the payment-page reservation, offers. Not this slice.",
};

export default function PostSelection() {
  const [i, setI] = useState(0);
  const [soon, setSoon] = useState(null);
  const cur = POST_TYPES[i];

  function choose(idx) {
    const t = POST_TYPES[idx];
    if (!t) return;
    if (SOON[t.id]) { setSoon(t.id); haptic("error"); return; }
    haptic("confirm");
    pushSheet("post", { kind: t.id, title: t.label });
  }

  return (
    <div className="postsel">
      <p className="deck">{cur.label.toLowerCase()} · {cur.means}</p>
      <Disc name="post" items={POST_TYPES.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))} index={i} onChange={(n) => { setI(n); setSoon(null); }} onSelect={choose} size={220} />
      {soon ? <p className="fine soon postsoon" role="status">{SOON[soon]}</p> : null}
    </div>
  );
}
