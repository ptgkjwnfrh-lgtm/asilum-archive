"use client";
// Asterisk memory surface (contract ADR-001 v2).
// MemorySections = the shared section renderer /asterisk uses, so the read
// and the controls show the SAME contract. The shell drawer that used to
// share it was removed 23 Aug (owner order); /asterisk is now the whole
// surface, and it always was the superset.
// All data comes from GET /api/asterisk/memory — a read facade over the
// existing stores; writes are display visibility and Asterisk guidance.

import AMark from "./AMark.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  authorizedFetch, postJSON, getUid, brainEnabled, setBrainEnabled,
} from "../../lib/client.js";

/**
 * Load and mutate the reader's ASTERISK memory while the surface is open.
 *
 * Fetches only when `open` — memory is a personal record and there is no
 * reason to read it for a panel nobody has opened. `saving` guards against
 * overlapping writes, so a fast double-toggle cannot land out of order.
 *
 * Returns the memory, an error string, and the mutators the panel binds to.
 */
export function useAsteriskMemory(open) {
  const [memory, setMemory] = useState(null);
  const [err, setErr] = useState("");
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);

  const reload = useCallback(() => {
    setMemory(null);
    setErr("");
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const identityChanged = () => {
      reload();
    };
    window.addEventListener("asilum:identity", identityChanged);
    return () => window.removeEventListener("asilum:identity", identityChanged);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      try {
        setErr("");
        const res = await authorizedFetch(`/api/asterisk/memory?user=${encodeURIComponent(getUid() || "")}`);
        const data = await res.json();
        if (dead) return;
        if (!res.ok) { setErr(data.error || "memory unavailable"); return; }
        setMemory(data.memory);
        const serverGuidance = data.memory?.preferences?.guidanceEnabled !== false;
        if (brainEnabled() !== serverGuidance) setBrainEnabled(serverGuidance);
      } catch {
        if (!dead) setErr("memory unavailable");
      }
    })();
    return () => { dead = true; };
  }, [open, revision]);

  async function setHidden(hiddenSections) {
    if (saving.current) return;
    saving.current = true;
    try {
      const res = await postJSON("/api/asterisk/memory", { user: getUid(), hiddenSections });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not save memory display settings");
      setMemory((current) => current
        ? { ...current, preferences: data.preferences }
        : current);
      setErr("");
    } catch (error) {
      setErr(error.message || "could not save memory display settings");
    } finally {
      saving.current = false;
    }
  }

  async function setGuidanceEnabled(guidanceEnabled) {
    if (saving.current || typeof guidanceEnabled !== "boolean") return false;
    saving.current = true;
    try {
      const res = await postJSON("/api/asterisk/memory", {
        user: getUid(), guidanceEnabled,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not update Asterisk guidance");
      setMemory((current) => current
        ? { ...current, preferences: data.preferences }
        : current);
      setBrainEnabled(data.preferences.guidanceEnabled !== false);
      setErr("");
      return true;
    } catch (error) {
      setErr(error.message || "could not update Asterisk guidance");
      return false;
    } finally {
      saving.current = false;
    }
  }
  return { memory, err, setHidden, setGuidanceEnabled, reload };
}

// Small, reusable version of the same durable guidance control. Search uses
// this directly so changing routes never requires a trip to the control room.
export function AsteriskGuidanceToggle({ compact = false, className = "" }) {
  const [on, setOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setOn(brainEnabled());
    sync();
    window.addEventListener("asilum:brain", sync);
    return () => window.removeEventListener("asilum:brain", sync);
  }, []);

  async function toggle() {
    if (saving) return;
    const next = !on;
    setSaving(true);
    setError("");
    try {
      const res = await postJSON("/api/asterisk/memory", {
        user: getUid(), guidanceEnabled: next,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not update Asterisk guidance");
      setBrainEnabled(data.preferences?.guidanceEnabled !== false);
    } catch (cause) {
      setError(cause.message || "could not update Asterisk guidance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`${className}${on ? " active" : ""}`.trim()}
      aria-label={`Turn Asterisk guidance ${on ? "off" : "on"}`}
      aria-pressed={on}
      disabled={saving}
      title={error || (on
        ? "Pause Passport-aware ranking"
        : "Turn on Passport-aware ranking")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <AMark label="|A|" /> {compact ? "" : "ASTERISK — "}{saving ? "…" : on ? "PAUSE" : "TURN ON"}
    </button>
  );
}

function Row({ label, children }) {
  return (
    <div className="amemrow">
      <span className="amemlbl">{label}</span>
      <span className="amemval">{children}</span>
    </div>
  );
}

/** The shared section renderer, used by BOTH the /asterisk page and the dock
 *  panel — one component so the two views cannot drift into showing a person
 *  different accounts of what is remembered about them. */
export function MemorySections({ memory, setHidden, full = false }) {
  if (!memory) return null;
  const hidden = new Set(memory.preferences?.hiddenSections || []);
  const toggle = (id) => {
    const next = new Set(hidden);
    next.has(id) ? next.delete(id) : next.add(id);
    setHidden([...next]);
  };
  const Section = ({ id, title, children }) => (
    <div className="amemsec">
      <div className="amemhead">
        <b className="red">*</b> {title}
        <button className="amemhide" onClick={() => toggle(id)}>
          {hidden.has(id) ? "SHOW" : "HIDE"}
        </button>
      </div>
      {!hidden.has(id) && <div className="amembody">{children}</div>}
    </div>
  );
  const ex = memory.explicit, inf = memory.inferred, gl = memory.global, un = memory.uncertainty;
  return (
    <>
      <Section id="explicit" title="PASSPORT STAMPS">
        <Row label="CORRECTIONS">
          {ex.corrections.length
            ? ex.corrections.slice(0, full ? 20 : 5).map((c) => (
                <em key={c.id}>{c.code}{c.brand ? ` · ${c.brand}` : ""}</em>
              ))
            : "none yet — every ✳ WHY THIS panel takes them"}
        </Row>
        <Row label="FOLLOWING">
          {ex.follows.length
            ? ex.follows.slice(0, full ? 50 : 6).map((f) => <em key={f.kind + f.target}>{f.target}</em>)
            : "no brands or people yet"}
        </Row>
        <Row label="FIT PROFILE">{ex.measurements.set ? "set — values stay in profile" : "not set"}</Row>
        <Row label="CRAVING">per-request dial — never stored</Row>
      </Section>
      <Section id="inferred" title="YOUR STYLE ROUTE">
        <Row label="LEANS">
          {inf.dominantAesthetics.length
            ? inf.dominantAesthetics.map((t) => <em key={t.tag}>{t.tag}</em>)
            : "no read yet"}
        </Row>
        <Row label="AVOIDS">
          {inf.avoidedTags.length ? inf.avoidedTags.map((t) => <em key={t.tag}>{t.tag}</em>) : "nothing"}
        </Row>
        {full && inf.recentlyForgotten.length > 0 && (
          <Row label="FADING">{inf.recentlyForgotten.map((t, i) => <em key={i}>{String(t.tag ?? t)}</em>)}</Row>
        )}
        <Row label="SIGNALS">{inf.signalCount} on record</Row>
        {full && inf.tasteSummary && <div className="amemnote">{inf.tasteSummary}</div>}
      </Section>
      <Section id="global" title="WHAT THE ASTERISK SYSTEM LEARNED">
        <Row label="NEW KNOWLEDGE">
          {gl.recentlyLearned.length
            ? gl.recentlyLearned.map((f, i) => (
                <em key={i}>{f.entityId} · {f.sourceCount} source{f.sourceCount === 1 ? "" : "s"}</em>
              ))
            : "nothing new since the last research batch"}
        </Row>
        <Row label="TREND REVIEW DUE">{gl.trendReviewDue}</Row>
      </Section>
      <Section id="uncertainty" title="WHERE WE'RE UNSURE">
        {un.lowSignal && <div className="amemnote">Low signal — readings stay tentative until you train more.</div>}
        {un.openQuestions.length
          ? un.openQuestions.map((q) => (
              <div className="amemrow" key={q.id}>
                <span className="amemval">{q.question}</span>
                <a className="amemgo" href={q.action}>GO</a>
              </div>
            ))
          : <div className="amemnote">No open questions.</div>}
      </Section>
    </>
  );
}
