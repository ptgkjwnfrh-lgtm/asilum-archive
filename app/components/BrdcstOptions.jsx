"use client";

// app/components/BrdcstOptions.jsx — BRDCST OPTIONS (V.2 Blueprint, owner,
// 17 Oct 2026, FIG 13 "a BRDCST panel above the disc": 5.13–5.22; slice 8).
// The compact panel the composer shows once an event is attached: the
// distance slider from the 50-mile base, the compatibility slider, the
// duration presets, launch now or on a date, the ITEMIZED LIVE QUOTE from
// the same law the server bills with (lib/brdcst/index.js quote) and the
// FORECAST the server measured (a real audience count; results vary).
// Nothing here charges: the composer creates the campaign as a draft when
// the post publishes, and payment is a separate, explicit step.

import { useEffect, useMemo, useState } from "react";
import { quote, BASE_RADIUS_MI, MAX_RADIUS_MI, DURATIONS } from "../../lib/brdcst/index.js";
import { haptic } from "../../lib/haptics.js";

export const DEFAULT_TARGETING = Object.freeze({ radiusMi: BASE_RADIUS_MI, tasteBreadth: 0, durationDays: 7, scheduledStart: "" });

export const money = (cents) => `USD ${((Number(cents) || 0) / 100).toFixed(2)}`;

export default function BrdcstOptions({ value, onChange, eventId = null, tags = [], compact = false }) {
  const t = { ...DEFAULT_TARGETING, ...(value || {}) };
  const q = useMemo(() => quote(t), [t.radiusMi, t.tasteBreadth, t.durationDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const [forecast, setForecast] = useState(null);
  const [payment, setPayment] = useState(null);
  const set = (patch) => onChange({ ...t, ...patch });
  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ quote: "1", radiusMi: String(t.radiusMi), tasteBreadth: String(t.tasteBreadth), durationDays: String(t.durationDays) });
    if (eventId) qs.set("eventId", eventId);
    if (tags && tags.length) qs.set("tags", tags.join(","));
    const h = setTimeout(() => {
      fetch("/api/brdcst?" + qs.toString()).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) { setForecast(d.forecast || null); setPayment(d.payment || null); } }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [t.radiusMi, t.tasteBreadth, t.durationDays, eventId, (tags || []).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={"brdopts" + (compact ? " compact" : "")} role="group" aria-label="BRDCST options">
      <div className="cclbl">BRDCST OPTIONS · TASTE FIRST, DISTANCE SECOND</div>
      <label className="brdslider">
        <span>REACH <b>{t.radiusMi} MI</b>{t.radiusMi > BASE_RADIUS_MI ? <i> · +{t.radiusMi - BASE_RADIUS_MI} beyond the {BASE_RADIUS_MI}-mile base</i> : <i> · the base radius</i>}</span>
        <input type="range" min={BASE_RADIUS_MI} max={MAX_RADIUS_MI} step={10} value={t.radiusMi} onChange={(e) => { haptic("tick"); set({ radiusMi: Number(e.target.value) }); }} aria-label="reach in miles" />
      </label>
      <label className="brdslider">
        <span>TASTE <b>{t.tasteBreadth === 0 ? "MATCHED" : `+${Math.round(t.tasteBreadth * 100)}%`}</b><i> · {t.tasteBreadth === 0 ? "passports whose taste already points at this" : "reaching passports whose Passports align less closely"}</i></span>
        <input type="range" min={0} max={1} step={0.05} value={t.tasteBreadth} onChange={(e) => { haptic("tick"); set({ tasteBreadth: Number(e.target.value) }); }} aria-label="taste breadth" />
      </label>
      <div className="brddur seg" role="group" aria-label="duration">
        {DURATIONS.map((d) => (
          <button key={d} type="button" className={"chip clickable" + (t.durationDays === d ? " cur" : "")} aria-pressed={t.durationDays === d} onClick={() => { haptic("press"); set({ durationDays: d }); }}>{d} DAY{d === 1 ? "" : "S"}</button>
        ))}
      </div>
      <label className="brdstart">
        <span>START</span>
        <span className="seg">
          <button type="button" className={"chip clickable" + (!t.scheduledStart ? " cur" : "")} onClick={() => set({ scheduledStart: "" })}>NOW</button>
          <input type="date" aria-label="scheduled start" value={t.scheduledStart || ""} onChange={(e) => set({ scheduledStart: e.target.value })} />
        </span>
        <i>{t.scheduledStart ? "the duration begins on the day the campaign starts; pay whenever — paid after the start, only the remaining days are billed" : "launch the moment it is paid"}</i>
      </label>
      <dl className="brdquote" aria-label="itemized quote">
        {q.lines.filter((l) => l.cents != null).map((l) => (
          <div key={l.id}><dt>{l.label}</dt><dd>{l.perDayCents != null ? `${money(l.perDayCents)} / DAY · ` : ""}{money(l.cents)}</dd></div>
        ))}
        <div className="brdtotal"><dt>{q.days} DAY{q.days === 1 ? "" : "S"} · TOTAL</dt><dd>{money(q.totalCents)}</dd></div>
      </dl>
      <div className="brdforecast fine" aria-live="polite">
        {forecast === null ? "measuring the audience…" : (
          <>
            FORECAST · audience {forecast.audience.low}–{forecast.audience.high} ({forecast.audience.counted} passports matched inside the radius) · impressions at most {forecast.impressions.atMost} · {forecast.note}
          </>
        )}
        {payment ? <><br />PAYMENT · {payment}</> : null}
      </div>
    </div>
  );
}
