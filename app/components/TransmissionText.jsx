"use client";

// app/components/TransmissionText.jsx
// One transmission's body, with #hashtags and @mentions as live links
// (owner directive, 14 Aug 2026, backlog 3). Every surface that
// prints a transmission renders it through here — the wire floor, the
// permalink focus, the profile's POSTS tab, and /u/[handle] — so a tag
// behaves the same everywhere.
//
// The text is already sanitized server-side; this only SPLITS it. React
// escapes each segment, and no segment is ever rewritten, so a reader
// sees exactly the characters the author wrote.

import { segmentTransmission, hashtagHref, mentionHref } from "../../lib/posts/refs.js";

export default function TransmissionText({ text, className = "fposttext" }) {
  const segments = segmentTransmission(text);
  return (
    <p className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "hashtag") {
          return <a key={i} className="wtag" href={hashtagHref(seg.value)}>{seg.text}</a>;
        }
        if (seg.type === "mention") {
          return <a key={i} className="wmention" href={mentionHref(seg.value)}>{seg.text}</a>;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}
