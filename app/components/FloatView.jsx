"use client";
// THE FLOAT (owner order, 8 Sep, with a Spotify recording): tap the
// photograph in the item detail and it floats alone over the fogged page (owner, 18 Oct 2026: "the background should be a fogged version of the feed"; it was black space) — a
// rounded card that tilts with the phone (deviceorientation) or, where there
// is no gyroscope, with the cursor; a soft shadow beneath it that slides the
// other way, a glare crossing its face, a faint halo of its own colour behind.
// The pose you opened it in is flat: the card stays put in the world as the
// phone moves, so relative to the screen it turns the other way. Tap
// anywhere, ×, or Escape to come back. Reduced motion: the card, still.
import { useEffect, useRef } from "react";
import { useEscape, useFocusTrap } from "./dismiss.js";

// iOS shares motion only after asking, and only answers inside the tap that
// asks — call this from the click that opens the float, before opening it.
export async function askTilt() {
  try {
    const D = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
    if (!D) return false;
    if (typeof D.requestPermission === "function") return (await D.requestPermission()) === "granted";
    return true;
  } catch {
    return false;
  }
}

const MAX = 16; // degrees of tilt either way

/**
 * THE TILT, shared (8 Sep; slice 14 lends it to the floating listing): the
 * card turns with the phone (deviceorientation, once askTilt was granted in
 * a tap) or, where there is no gyroscope, with the cursor; the pose it opened
 * in is flat; the glare and the shadow slide. Writes --rx/--ry/--gx/--gy/
 * --sx/--sy on the card; the halo follows. Reduced motion: still.
 */
export function useTilt(cardRef, haloRef = null, tilt = true) {
  useEffect(() => {
    const card = cardRef.current;
    const halo = haloRef ? haloRef.current : null;
    if (!card) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const s = { rx: 0, ry: 0, tx: 0, ty: 0, raf: 0, base: null, gyro: false };
    const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));
    const tick = () => {
      s.raf = 0;
      s.rx += (s.tx - s.rx) * 0.12;
      s.ry += (s.ty - s.ry) * 0.12;
      const t = `rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg)`;
      card.style.setProperty("--rx", `${s.rx.toFixed(2)}deg`);
      card.style.setProperty("--ry", `${s.ry.toFixed(2)}deg`);
      card.style.setProperty("--gx", `${(50 - s.ry * 2.6).toFixed(1)}%`); // the glare slides across
      card.style.setProperty("--gy", `${(50 + s.rx * 2.6).toFixed(1)}%`);
      card.style.setProperty("--sx", `${(-s.ry * 1.6).toFixed(1)}px`);   // the shadow slides the other way
      card.style.setProperty("--sy", `${(40 + s.rx * 1.6).toFixed(1)}px`);
      if (halo) halo.style.transform = `${t} scale(1.12)`;
      if (Math.abs(s.tx - s.rx) > 0.03 || Math.abs(s.ty - s.ry) > 0.03) s.raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!s.raf) s.raf = requestAnimationFrame(tick); };
    // the cursor, where there is no gyroscope: the card faces it
    const onMove = (e) => {
      if (s.gyro) return;
      s.ty = clamp((e.clientX / window.innerWidth - 0.5) * 2 * MAX);
      s.tx = clamp(-(e.clientY / window.innerHeight - 0.5) * 2 * MAX);
      wake();
    };
    const onLeave = () => { if (s.gyro) return; s.tx = 0; s.ty = 0; wake(); };
    // the phone: beta tips front-back, gamma left-right; landscape swaps them
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = (window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
      let b = e.beta, g = e.gamma;
      if (angle === 90) { const t = b; b = -g; g = t; } else if (angle === -90 || angle === 270) { const t = b; b = g; g = -t; }
      if (!s.base) s.base = { b, g };
      s.gyro = true;
      s.tx = clamp(-(b - s.base.b) * 0.55);
      s.ty = clamp(-(g - s.base.g) * 0.55);
      wake();
    };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    if (tilt) window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient);
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, [tilt]);
}

export default function FloatView({ src, aspect, tilt = true, onClose }) {
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const haloRef = useRef(null);
  const closeRef = useRef(null);
  useEscape(onClose, true);
  // aria-modal says the page behind is inert; the trap makes it so
  useFocusTrap(layerRef, true);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useTilt(cardRef, haloRef, tilt);
  // the card's width: inside 86vw and 560px, and inside 72vh at its own ratio
  const [aw, ah] = String(aspect || "3/4").split("/").map((x) => Number(x));
  const ar = aw > 0 && ah > 0 ? aw / ah : 0.75;
  const width = `min(86vw, 560px, calc(72vh * ${ar.toFixed(4)}))`;
  return (
    <div className="float" ref={layerRef} role="dialog" aria-modal="true" aria-label="the photograph, alone" tabIndex={-1}>
      {/* tap anywhere to come back: the space behind and the card are both
          real buttons, so the keyboard has the same way out as a thumb */}
      <button type="button" className="floatscrim" aria-label="back to the item" onClick={onClose} tabIndex={-1} />
      <button ref={closeRef} className="floatclose" aria-label="back to the item" onClick={onClose}>×</button>
      <div className="floathalo" ref={haloRef} style={{ width }} aria-hidden="true">
        <img src={src} alt="" style={{ aspectRatio: aspect }} />
      </div>
      <button type="button" className="floatcard" ref={cardRef} style={{ width }} aria-label="back to the item" onClick={onClose}>
        <img src={src} alt="" style={{ aspectRatio: aspect }} />
      </button>
    </div>
  );
}
