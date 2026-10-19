"use client";

// app/components/VerificationBadge.jsx — THE CARD'S ASTERISK (V.2 brief §12).
//
// It means "ASILUM's listing checks completed" and nothing more: not
// counterfeit-proof authentication, not stock. The tooltip and the screen-
// reader label say so; a tap opens the plain-language breakdown — source
// checks, AI checks, human review if performed, last checked, limitations.
// PENDING draws a hollow mark; UNVERIFIED (slice 5: failed on positive
// evidence, a replica signal, or 72 hours unanswered) draws a struck mark
// with its reason — "Unverified is not a punishment: the item stays
// listed"; no badge draws nothing (a card without the asterisk is the
// ordinary case, never an accusation — absence of proof is not evidence,
// 12.6). Confidence, the fraud flag and the queue never reach this
// component: passengers never see the machinery.
//
// `badge` is the object /api/items (or /api/verification/listing) returns
// for the listing — computed on the server from the ledger and the listing's
// CURRENT evidence version, so a changed listing never keeps an old mark.

import { useState } from "react";

const WORD = { pass: "passed", fail: "failed", flag: "uncertain", missing: "not possible", none: "not performed" };
const when = (iso) => (iso ? new Date(iso).toLocaleDateString() : "—");

export default function VerificationBadge({ badge, compact = false }) {
  const [open, setOpen] = useState(false);
  if (!badge || badge.state === "none") return null;
  const verified = badge.state === "verified";
  const unverified = badge.state === "unverified";
  const label = verified
    ? "ASILUM listing checks completed — not an authentication guarantee"
    : unverified ? "listing checks did not pass — unverified, still listed"
    : "listing checks pending review";
  return (
    <span className={"vbadge" + (verified ? " ok" : unverified ? " unverified" : " pending") + (open ? " open" : "")}>
      <button
        type="button"
        className="vbadgemark"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">*</span>
        {!compact ? <small>{verified ? "CHECKED" : unverified ? "UNVERIFIED" : "PENDING"}</small> : null}
      </button>
      {open ? (
        <span className="vbadgesheet" role="region" aria-label="what this mark means">
          <b>{verified ? "ASILUM listing checks completed." : unverified ? "ASILUM listing checks did not pass — the piece stays listed on its own terms." : "ASILUM listing checks pending."}</b>
          <span>{badge.reason}</span>
          {badge.checks ? (
            <ul>
              <li>source check — {WORD[badge.checks.source.status] || badge.checks.source.status}{badge.checks.source.detail ? ` (${badge.checks.source.detail})` : ""}</li>
              <li>details vs. words — {WORD[badge.checks.ai.status] || badge.checks.ai.status}{badge.checks.ai.model ? `, by ${badge.checks.ai.model === "local-rules" ? "local rules, model off" : badge.checks.ai.model}` : ""}{badge.checks.ai.detail ? ` (${badge.checks.ai.detail})` : ""}</li>
              <li>human review — {badge.checks.human.status === "none" ? "not performed" : `${WORD[badge.checks.human.status]}${badge.checks.human.reviewer ? ` by ${badge.checks.human.reviewer}` : ""} on ${when(badge.checks.human.at)}`}</li>
              <li>last checked {when(badge.lastCheckedAt)} · valid until {when(badge.expiresAt)}</li>
            </ul>
          ) : null}
          <em>limits: {(badge.limitations || []).join("; ")}.</em>
        </span>
      ) : null}
    </span>
  );
}
