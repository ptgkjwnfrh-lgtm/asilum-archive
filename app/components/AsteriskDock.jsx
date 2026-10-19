"use client";

// app/components/AsteriskDock.jsx — ASTERISK's living form (owner decree,
// redesign/asterisk-hologram): an interactive 3D hologram entity built
// from exactly three layers —
//   1. the five-point asterisk core: blocky, dense, strongest glow (red);
//   2. a body of color: hot centre bleeding into the signal color, one
//      soft membrane giving the shell its edge;
//   3. the ASCII hologram shell: latitude rings + meridians drawn as
//      transparent character lines hugging the body, brightened by a
//      scanline that sweeps the orb,
// all under a classic sci-fi hologram treatment (scanline banding and
// brightness flutter, nothing else). Drag to spin it; it
// keeps drifting with inertia. Pure canvas, no libraries. Same form in
// both interfaces; colors come from tokens so both themes hold.
// prefers-reduced-motion: one static frame, no ambient loop (drag still
// re-renders, user-initiated). This entity also replaced BrainViz (the
// floating-word taste sphere) on /stats and /upload.
// Optional props: size (canvas px), words (state cycle), className.

import { useEffect, useRef, useState } from "react";

export default function AsteriskDock({
  size = 104,
  words = ["THINKING", "INDEXING", "CORRELATING", "SCANNING", "WEIGHING"],
  className = "os-dock",
}) {
  const canvasRef = useRef(null);
  const [state, setState] = useState(words[0]);
  useEffect(() => {
    const iv = setInterval(() => setState(words[Math.floor(Math.random() * words.length)]), 3400);
    return () => clearInterval(iv);
  }, [words]);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const x = cv.getContext("2d");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    // (audit #18) These three token reads used to happen INSIDE draw(), so
    // every frame forced three style flushes — 180 a second per dock, and
    // /stats and /upload mount a second one. The values only move when the
    // theme or the interface model changes, both of which are attributes on
    // documentElement, so read them once and let a MutationObserver say when
    // they are stale. Colors still come from tokens; nothing is hardcoded.
    let SIG, RED, OSD;
    const readTokens = () => {
      SIG = css("--sig");
      RED = css("--red");
      OSD = css("--osd") || "monospace";
    };
    readTokens();
    const themeWatch = new MutationObserver(() => { readTokens(); if (rm) draw(); });
    themeWatch.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "class"],
    });

    // ---- 3D line field: latitude rings + meridians as ASCII lines,
    // each point carrying its tangent so the glyph matches the line ----
    const shell = [];
    const LATS = 6;
    for (let i = 1; i <= LATS; i++) {
      const phi = (i / (LATS + 1)) * Math.PI;
      const r = Math.sin(phi);
      const y = Math.cos(phi);
      const n = Math.max(8, Math.round(r * 30));
      for (let j = 0; j < n; j++) {
        const th = (j / n) * Math.PI * 2;
        // tangent along the ring: d/dθ
        shell.push({
          x: Math.cos(th) * r, y, z: Math.sin(th) * r,
          tx: -Math.sin(th) * r, ty: 0, tz: Math.cos(th) * r,
        });
      }
    }
    for (let m = 0; m < 4; m++) {
      const lam = (m / 4) * Math.PI;
      for (let j = 0; j < 26; j++) {
        const phi = (j / 26) * Math.PI * 2;
        // meridian circle through the poles; tangent along d/dφ
        shell.push({
          x: Math.cos(lam) * Math.sin(phi), y: Math.cos(phi), z: Math.sin(lam) * Math.sin(phi),
          tx: Math.cos(lam) * Math.cos(phi), ty: -Math.sin(phi), tz: Math.sin(lam) * Math.cos(phi),
        });
      }
    }
    // five arms of the inner asterisk (object space, point up)
    const ARMS = [];
    for (let k = 0; k < 5; k++) {
      const a = ((-90 + k * 72) * Math.PI) / 180;
      ARMS.push([Math.cos(a), Math.sin(a)]);
    }

    let yaw = 0.7;
    let pitch = -0.3;
    let vyaw = 0.0055;
    let vpitch = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let hover = 0;
    let raf = 0;
    let t = 0;
    let paused = false;

    const rot = (p, sy, cy2, sp, cp) => {
      const x1 = p.x * cy2 + p.z * sy;
      const z1 = -p.x * sy + p.z * cy2;
      const y1 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      return [x1, y1, z2];
    };

    const draw = () => {
      const W = cv.width;
      const H = cv.height;
      const cx = W / 2;
      const cyM = H / 2;
      const R = W * 0.3;
      x.clearRect(0, 0, W, H);

      // hologram flutter: the whole projection breathes in brightness
      const flick = rm ? 1 : 0.78 + 0.22 * Math.abs(Math.sin(t * 9.1) * Math.sin(t * 3.7));
      const sy = Math.sin(yaw);
      const cy2 = Math.cos(yaw);
      const sp = Math.sin(pitch);
      const cp = Math.cos(pitch);
      x.textAlign = "center";
      x.textBaseline = "middle";

      // layer 3 — the ASCII lines: transparent dashes tracing the body's
      // latitude/meridian wireframe; a scanline sweeps the orb and
      // brightens the characters it crosses
      const DIRS = ["-", "\\", "|", "/"];
      const scanY = cyM - R * 1.15 + ((t * 55) % (R * 2.3));
      const drawPoint = (px2, py2, z, ang) => {
        const depth = (z + 1.3) / 2.6; // 0 back → 1 front
        const onScan = Math.abs(py2 - scanY) < Math.max(3, W * 0.03);
        const a = onScan
          ? (0.6 + depth * 0.4) * flick
          : (0.05 + depth * 0.2) * flick * (0.85 + hover * 0.15);
        const oct = ((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4;
        x.globalAlpha = Math.min(1, a);
        x.fillStyle = SIG;
        x.font = `${Math.max(5, W * 0.055 * (0.8 + depth * 0.35))}px ${OSD}`;
        x.fillText(DIRS[oct], px2, py2);
      };

      // back hemisphere first, inner asterisk, then front — so the glyph
      // reads as INSIDE the transparent shell
      const projected = [];
      for (const p of shell) {
        const [X1, Y1, Z1] = rot(p, sy, cy2, sp, cp);
        const [TX, TY] = rot({ x: p.tx, y: p.ty, z: p.tz }, sy, cy2, sp, cp);
        // screen-space tangent angle (y flips when projecting)
        projected.push([cx + X1 * R, cyM - Y1 * R, Z1, Math.atan2(-TY, TX)]);
      }
      for (const pr of projected) if (pr[2] < 0) drawPoint(...pr);

      // layer 2 — the body: hot centre bleeding into the signal color,
      // one soft membrane giving the shell its edge
      const br = R * (0.98 + Math.sin(t * 1.1) * 0.03);
      const body = x.createRadialGradient(cx - br * 0.18, cyM - br * 0.22, br * 0.05, cx, cyM, br);
      body.addColorStop(0, "rgba(255,255,255,0.95)");
      body.addColorStop(0.28, SIG);
      body.addColorStop(0.75, SIG);
      body.addColorStop(1, "rgba(0,0,0,0)");
      x.save();
      x.globalAlpha = (0.44 + hover * 0.08) * flick;
      x.fillStyle = body;
      x.beginPath();
      x.arc(cx, cyM, br, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = SIG;
      x.globalAlpha = 0.16 * flick;
      x.lineWidth = Math.max(1, W * 0.012);
      x.beginPath();
      x.ellipse(cx, cyM, br * 0.9, br * (0.88 + Math.sin(t * 0.5) * 0.04),
        Math.sin(t * 0.2) * 0.4, 0, Math.PI * 2);
      x.stroke();
      x.restore();

      // layer 1 — the five-point asterisk core: blocky, dense, thick —
      // square-capped triple pass, strongest glow on the entity; red,
      // the only accent voice; slow counter-rotation
      const aspin = -t * 0.35;
      const tips = ARMS.map(([ax, ay]) => {
        const p = { x: ax * Math.cos(aspin), y: -ay, z: ax * Math.sin(aspin) };
        return rot({ x: p.x * 0.5, y: p.y * 0.5, z: p.z * 0.5 }, sy, cy2, sp, cp);
      });
      const strokeArms = (width, alpha, blur) => {
        x.globalAlpha = alpha;
        x.lineWidth = width;
        x.shadowBlur = blur;
        x.beginPath();
        for (const [X1, Y1] of tips) {
          x.moveTo(cx, cyM);
          x.lineTo(cx + X1 * R, cyM - Y1 * R);
        }
        x.stroke();
      };
      x.save();
      x.strokeStyle = RED;
      x.shadowColor = RED;
      x.lineCap = "square";
      strokeArms(Math.max(3, W * 0.1), 0.28 * flick, W * 0.12); // halo pass
      strokeArms(Math.max(2, W * 0.055), (0.96 + hover * 0.04) * flick, W * 0.06); // blocky core
      x.restore();

      for (const pr of projected) if (pr[2] >= 0) drawPoint(...pr);
      x.globalAlpha = 1;

      // ---- hologram treatment: scanline banding, nothing else ----
      x.globalCompositeOperation = "destination-out";
      x.fillStyle = "rgba(0,0,0,0.32)";
      for (let yy = 0; yy < H; yy += 4) x.fillRect(0, yy, W, 1.5);
      x.globalCompositeOperation = "source-over";
    };

    const frame = () => {
      raf = 0;
      if (paused) return;
      t += 0.014;
      if (!dragging) {
        yaw += vyaw;
        pitch += vpitch;
        vyaw += (0.0055 - vyaw) * 0.01; // inertia settles back to idle drift
        vpitch *= 0.95;
        pitch = Math.max(-1.2, Math.min(1.2, pitch));
      }
      draw();
      raf = requestAnimationFrame(frame);
    };

    // ---- interaction: drag to spin, inertia on release ----
    const down = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (dragging) {
        const k = 1 / (cv.getBoundingClientRect().width || 1);
        vyaw = (e.clientX - lastX) * k * 4 * 0.06;
        vpitch = (e.clientY - lastY) * k * 4 * 0.06;
        yaw += (e.clientX - lastX) * k * 4;
        pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - lastY) * k * 4));
        lastX = e.clientX;
        lastY = e.clientY;
        if (rm) draw();
      }
    };
    const up = () => { dragging = false; };
    const enter = () => { hover = 1; };
    const leave = () => { hover = 0; };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerenter", enter);
    cv.addEventListener("pointerleave", leave);

    // (audit #18) The loop was mounted unconditionally in the shell and ran on
    // every route with no check of whether anything could see it. Scrolled out
    // of view, it kept drawing at 60fps. (Backgrounded TABS are already the
    // browser's job — it stops firing rAF — so this covers the case the
    // platform does not.) Resuming keeps `t` where it stopped, so the entity
    // picks up its drift rather than jumping.
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        const onScreen = entries.some((entry) => entry.isIntersecting);
        paused = !onScreen;
        if (!rm && onScreen && !raf) raf = requestAnimationFrame(frame);
      }, { threshold: 0 })
      : null;
    observer?.observe(cv);

    if (rm) draw();
    else frame();
    return () => {
      paused = true;
      observer?.disconnect();
      themeWatch.disconnect();
      cancelAnimationFrame(raf);
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerenter", enter);
      cv.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        aria-hidden="true"
        className="os-holo"
      />
      <div className="t">*ASTERISK<br /><b>{state}</b></div>
    </div>
  );
}
