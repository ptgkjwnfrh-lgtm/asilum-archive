"use client";

// app/components/PurchaseGlobe.jsx — THE PURCHASE GLOBE (owner order, 9 Sep:
// "replace the asterisk figure with a globe that shows all the places users
// have bought clothes from — all ASCII with lines, 3D, moveable"; then,
// the same day: "get rid of the ASCII structure … make the globe look like
// a Star Wars hologram made of glowing lines").
//
// The drawing lives in lib/globe.js (pure canvas, no React) so it can be
// judged with any list of cities outside the app; this component wires it
// to the page: the tokens (colours from CSS custom properties, refreshed on
// a theme or interface change), the size (CSS, --ed-gx-globe — the bitmap
// follows at 2×), the loop (paused off-screen; one still frame under
// prefers-reduced-motion, a drag still re-renders), and the Codec readout
// under the canvas: the front-most marker's fix in D.MM.SS, the count.
//
// WHAT IS PLOTTED, AND ONLY THAT: `places` from /api/orders?places=1 — the
// houses' cities behind the bearer's PAID orders and BOUGHT tickets
// (lib/asterisk/places.js). No purchase, no marker: the globe still turns,
// and the readout says the fix is empty. Nothing is staged.

import { useEffect, useRef, useState } from "react";
import { createGlobe, dms } from "../../lib/globe.js";

export default function PurchaseGlobe({ places = [], className = "" }) {
  const canvasRef = useRef(null);
  const globeRef = useRef(null);
  const [front, setFront] = useState(null); // the marker nearest the viewer

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    // tokens, read once per change; a theme or interface change on <html>
    // refreshes them (three style flushes a frame was audit #18's lesson)
    const tokens = () => ({
      sig: css("--sig"), red: css("--red"), ink: css("--ink"),
      font: css("--osd") || css("--helv") || "monospace",
    });
    const globe = createGlobe(cv, { tokens, reducedMotion: rm, onFront: (p) => setFront(p) });
    globeRef.current = globe;
    globe.setPlaces(places);
    const themeWatch = new MutationObserver(() => globe.refreshTokens());
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const ro = new ResizeObserver(() => globe.fit());
    ro.observe(cv);
    globe.fit();
    // scrolled out of view, it stops drawing; back in view, it picks up
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) globe.start(); else globe.stop();
      }, { threshold: 0 })
      : null;
    if (observer) observer.observe(cv); else globe.start();
    return () => {
      observer?.disconnect();
      ro.disconnect();
      themeWatch.disconnect();
      globe.dispose();
      globeRef.current = null;
    };
    // the places list is pushed through setPlaces below, not by remounting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { globeRef.current?.setPlaces(places); }, [places]);

  const cities = places.length;
  const pieces = places.reduce((n, p) => n + (p.count || 0), 0);
  return (
    <div className={"gxglobe " + className}>
      <canvas
        ref={canvasRef}
        width={500}
        height={500}
        className="gxglobecv"
        tabIndex={0}
        role="img"
        aria-label={cities
          ? `purchase globe: ${pieces} piece${pieces === 1 ? "" : "s"} from ${cities} cit${cities === 1 ? "y" : "ies"} — ${places.map((p) => p.city).join(", ")}. drag or use the arrow keys to turn it.`
          : "purchase globe: no purchase on the record yet. drag or use the arrow keys to turn it."}
      />
      <div className="gxgps" aria-hidden="true">
        <span className="gxgpsl">GLOBAL POSITIONING · PURCHASE RECORD</span>
        {front ? (
          <span className="gxgpsfix">
            LAT&nbsp;{dms(front.lat)}{front.lat < 0 ? "S" : "N"}&nbsp;·&nbsp;LONG&nbsp;{dms(front.lon)}{front.lon < 0 ? "W" : "E"}
          </span>
        ) : (
          <span className="gxgpsfix">NO FIX — NOTHING BOUGHT YET</span>
        )}
        <span className="gxgpss">
          {cities
            ? `${pieces} PIECE${pieces === 1 ? "" : "S"} · ${cities} CIT${cities === 1 ? "Y" : "IES"} · ALL GREEN`
            : "THE GLOBE FILLS WITH THE HOUSES' CITIES AS YOU BUY"}
        </span>
      </div>
    </div>
  );
}
