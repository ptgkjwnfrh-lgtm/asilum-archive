"use client";

// app/components/AsteriskWhy.jsx — ASTERISK's "why this" panel (Day 11),
// moved out of the feed page with V.2 slice 3 so the LISTING popup
// (ListingSheet.jsx) can carry it: the honest explanation for a piece and
// the structured corrections that actually train the profile (negative
// codes feed avoided tags; wrong-* codes file data reports).

import { useEffect, useState } from "react";
import { confidenceBand } from "../../lib/asterisk/confidence.js";
import { getUid, postJSON, authorizedFetch } from "../../lib/client.js";

export const ASTERISK_CORRECTION_CHIPS = [
  ["not-my-style", "not my style"],
  ["more-like-this", "more like this"],
  ["wrong-color", "wrong color"],
  ["already-own", "already own"],
];

export default function AsteriskWhy({ item, onNotice }) {
  const [why, setWhy] = useState(null);
  const [sent, setSent] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setWhy(null);
    setSent(null);
    authorizedFetch(
      "/api/why?item=" + encodeURIComponent(item.id) + "&user=" + encodeURIComponent(getUid() || ""),
      { signal: controller.signal }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.explanation) setWhy(d.explanation); })
      .catch(() => {});
    return () => controller.abort();
  }, [item.id]);

  async function correct(code) {
    setSent(code);
    try {
      const response = await postJSON("/api/why", { user: getUid(), productId: item.id, code });
      if (!response.ok) throw new Error("correction rejected");
      const result = await response.json();
      if (onNotice) onNotice(result.duplicate
        ? "already noted — no duplicate signal was added"
        : result.profileUpdated === false
          ? "saved — your feed adjusted; stylist profile refresh is pending"
          : code === "more-like-this"
            ? "noted — asterisk leans in"
            : code.startsWith("wrong")
              ? "reported — a moderator will check this listing"
              : "noted — asterisk adjusts your profile");
    } catch {
      setSent(null);
      if (onNotice) onNotice("correction could not be saved — try again");
    }
  }
  if (!why) return null;
  return (
    <div className="awhy">
      <div className="awhyhead"><b className="red">*</b> ASTERISK — WHY THIS</div>
      <div className="awhysum">
        {why.summary}
        {/* A BAND, NOT A PERCENTAGE — constitution A5. */}
        {why.tasteMatch > 0 ? " · " + confidenceBand(why.tasteMatch) : ""}
      </div>
      {(why.warnings || []).map((w) => <div className="awhywarn" key={w}>{w}</div>)}
      {why.uncertainty ? <div className="awhywarn">{why.uncertainty}</div> : null}
      <div className="awhychips">
        {ASTERISK_CORRECTION_CHIPS.map(([code, label]) => (
          <button key={code} className={"achip" + (sent === code ? " on" : "")}
            disabled={!!sent} onClick={() => correct(code)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
