"use client";

// app/components/ConsentMoment.jsx — D4's first-visit consent moment
// (ruled 20 Aug 2026; spec docs/d4-consent-spec-2026-08-20.md). Shell-
// mounted so it covers both landing laws and every deep link; renders
// while the device is UNANSWERED — or its state is UNKNOWABLE (fail-open,
// 20 Aug) — and unanswered = unobserved is enforced server-side, so
// ignoring it is safe by construction. A consent moment is
// ANSWERED, never dismissed — no click-away, no Escape, deliberately not
// one of useOverlayDismiss's overlays. Copy is the spec's draft; the
// owner's voice pass stands open.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getUid, postJSON } from "../../lib/client.js";
import { setObservation } from "../../lib/social.js";
import { useFocusTrap } from "./dismiss.js";

export default function ConsentMoment() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef(null);
  const boxRef = useRef(null);
  const settledRef = useRef(false); // answered (any session) — stop re-asking the server
  const pathname = usePathname();
  // The magazine's face stays clean (owner order, 20 Aug): the moment never
  // covers the FRONT COVER. Desktop entry lands on /cover untouched; the
  // first click into the CATALOG (or any other page) raises the question.
  // Mobile lands on the catalog directly and sees it on open. Unanswered
  // stays unobserved throughout — the cover writes nothing either way.
  const onCover = (pathname || "").startsWith("/cover");

  useEffect(() => {
    if (onCover || settledRef.current) return undefined;
    let dead = false;
    // A beat after arrival: the boot sweep lands first, then the question.
    const t = setTimeout(async () => {
      // FAIL-OPEN (the 20 Aug desktop bug): only a positively read answer
      // keeps the question down. A non-OK response (edge challenge, 500),
      // a network error, or an un-JSON body is UNKNOWABLE state — ASK.
      // Re-asking an answered device is harmless; never asking is the bug.
      let answered = false;
      try {
        const res = await fetch("/api/consent", { cache: "no-store" });
        const d = res.ok ? await res.json().catch(() => ({})) : {};
        answered = d.state === "observe" || d.state === "general";
      } catch { /* unknowable — the question rises */ }
      if (dead) return;
      if (answered) settledRef.current = true; // answered — never ask again this visit
      else setShow(true);
    }, 700);
    return () => { dead = true; clearTimeout(t); };
  }, [onCover]);

  // The house trap (components/dismiss.js): keeps Tab inside the dialog and
  // gives focus back on unmount — aria-modal's promise, made true.
  useFocusTrap(boxRef, show);

  useEffect(() => {
    if (show && firstRef.current) firstRef.current.focus();
  }, [show]);

  async function answer(choice) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await postJSON("/api/consent", { user: getUid(), choice });
      if (!res.ok) throw new Error("refused");
      try { window.localStorage.setItem("asilum-consent", choice); } catch {}
      setObservation(choice === "observe");
      settledRef.current = true;
      setShow(false);
    } catch {
      setBusy(false); // still unanswered, still unobserved; the moment stays
    }
  }

  if (!show || onCover) return null;
  // DOM hooks carry HOUSE vocabulary only — never consent/cookie/banner
  // tokens. Blockers' cosmetic filter lists and Safari's element-hiding
  // hunt those words in class and id names, and a silently hidden question
  // is the desktop bug all over again, beyond fail-open's reach.
  return (
    <div className="moment-veil" role="presentation">
      <div
        className="asterisk-moment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="moment-title"
        aria-describedby="moment-body"
        ref={boxRef}
      >
        <div className="moment-title" id="moment-title">
          <span className="red">*</span>THE ASTERISK SYSTEM
        </div>
        <div className="moment-body" id="moment-body">
          {/* The owner's voice pass, 20 Aug 2026 — their words, the house's
              lowercase prose, their emphasis kept exactly. */}
          <p>
            this terminal learns quietly in the background. what you linger
            on. what you save. what you skip. what you buy. along with the{" "}
            <b><span className="red">*</span>STAMPS</b> you choose to upload
            to your <b><span className="red">*</span>PASSPORT</b>. it
            observes for one reason: to make your shopping &amp; discovery
            experience feel more like yours every time you return.
          </p>
          <p>
            <span className="red">*</span>ASILUM <b>WILL NEVER</b>{" "}
            sell your information. once you have a{" "}
            <b><span className="red">*</span>PASSPORT</b>, your style, taste
            and content stay protected.
          </p>
          <p className="moment-seek">
            seek <b><span className="red">*</span>ASILUM</b> or disappear into the catalog.
          </p>
          <p className="moment-close">
            Your <span className="red">*</span>PASSPORT. Your taste. Your
            choice. ;)
          </p>
        </div>
        <div className="moment-actions">
          <button ref={firstRef} className="btn" disabled={busy} onClick={() => answer("observe")}>
            OBSERVE ME ✓
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => answer("general")}>
            GENERAL ONLY ✓
          </button>
        </div>
        <p className="moment-fine">
          change anytime in <a href="/settings">SETTINGS</a> · the fine print
          → <a href="/terms">TERMS</a>. until you answer, the Asterisk system
          does not watch.
        </p>
      </div>
    </div>
  );
}
