"use client";

// app/components/TagChip.jsx — a tag on screen (V.2 Blueprint, owner, 17 Oct
// 2026, Part I "Tag grammar" and its Typesetting; slice 4). The law lives in
// lib/tagging/grammar.js; this only draws it.
//
//   LEFT: RIGHT on a Liquid Glass chip with the fine border and the card
//   radius. Michroma, uppercase, 10–12 px on cards, 12–14 px in popups,
//   letter-spacing 0.06 em; the colon is the only punctuation and is
//   followed by one space. A tag never truncates: it wraps once, after the
//   colon, with the right side indented under the left (a hanging indent).
//
//   Tap the left side and Search runs that attribute (every SAINT LAURENT);
//   tap the right side and Search runs that category (every BOMBER JACKET).
//   Long-press pins the tag as a filter chip on the current Search. A
//   state tag's value crossfades in place when it changes (the chip is
//   keyed by its KEY, the value by its VALUE), never with a layout shift.
//
//   Three sit in one row when they fit, otherwise wrap into a tight column;
//   the expander is a small + at the end of the row, beside the third tag.

import { useRef } from "react";
import { formatTag, tagQueries, URGENT_STATE } from "../../lib/tagging/grammar.js";
import { setQuery, openSheet, pinTag, unpinTag } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";
import { LONG_PRESS_MS } from "../../lib/disc.js"; // the one long-press clock (the deck, the Disc, a tag)

/** Run a query in the SEARCH popup — the deck's own path. */
export function runSearch(q) {
  haptic("press");
  setQuery(q);
  openSheet("search", { title: "SEARCH" });
}

export function TagChip({ tag, pinned = false, onUnpin }) {
  const hold = useRef(null);
  const queries = tagQueries(tag);
  const urgent = tag.family === "state" && URGENT_STATE.has(tag.left);
  const cls = "tag " + tag.family + (urgent ? " urgent" : "") + (pinned ? " pinned" : "");

  if (pinned) {
    return (
      <span className={cls} data-key={tag.key || tag.text}>
        <button type="button" className="tx" onClick={() => { haptic("toggle"); (onUnpin || unpinTag)(tag.key); }} aria-label={"unpin " + (tag.text || formatTag(tag))} title="unpin this filter">
          <span className="tl">{tag.left}:</span>{" "}<span className="tr">{tag.right || ""}</span><span className="tun" aria-hidden="true">×</span>
        </button>
      </span>
    );
  }

  function down(e) {
    if (e.button) return;
    hold.current = { fired: false, t: setTimeout(() => { hold.current.fired = true; haptic("confirm"); pinTag(tag); }, LONG_PRESS_MS) };
  }
  function up() { const h = hold.current; if (h) clearTimeout(h.t); }
  function cancel() { const h = hold.current; hold.current = null; if (h) clearTimeout(h.t); }
  const go = (q) => (e) => {
    const h = hold.current; hold.current = null;
    if (h && h.fired) { e.preventDefault(); return; } // the long-press already acted
    runSearch(q);
  };

  return (
    <span className={cls} data-key={tag.key} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" className="tl" onPointerDown={down} onPointerUp={up} onPointerLeave={cancel} onPointerCancel={cancel} onClick={go(queries.left)} aria-label={"search " + tag.left} title={"every " + tag.left}>{tag.left}:</button>
      {" "}
      <button type="button" className="tr" key={tag.right} onPointerDown={down} onPointerUp={up} onPointerLeave={cancel} onPointerCancel={cancel} onClick={go(queries.right)} aria-label={"search " + tag.right} title={"every " + tag.right}>{tag.right}</button>
    </span>
  );
}

/**
 * A row of tags. `size` is "card" (10 px) or "popup" (12 px). `more` draws
 * the + expander at the end of the row (the listing's BEHIND THE PRODUCT);
 * `open` flips it to −.
 */
export default function TagRow({ tags = [], size = "card", more = null, open = false, label = "tags", empty = null }) {
  if (!tags.length && !more && !empty) return null;
  return (
    <div className={"tagrow " + size} role="list" aria-label={label}>
      {tags.map((t) => <span role="listitem" key={t.key}><TagChip tag={t} /></span>)}
      {!tags.length && empty ? <span className="fine">{empty}</span> : null}
      {more ? (
        <button type="button" className="tagmore" aria-expanded={open} aria-label={open ? "close behind the product" : "open behind the product"} title="BEHIND THE PRODUCT" onClick={() => { haptic("press"); more(); }}>{open ? "−" : "+"}</button>
      ) : null}
    </div>
  );
}
