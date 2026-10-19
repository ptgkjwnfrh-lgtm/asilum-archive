"use client";
// LIQUID GLASS, shared: the optics of the header strip (shell.js) and of the
// item detail (page.js) are one thing — a clear pane whose open edges bend
// what lies beneath it through an SVG displacement filter, with a whisper of
// gloss on top. This file owns the map drawing, the filter, and a hook that
// keeps any element's map in step with its size and carries the pointer's
// shine. The header keeps its own lamps and meniscus in shell.js.
import { useEffect, useRef } from "react";

// LIQUID GLASS, the optics. Only Chromium runs an SVG filter as a
// backdrop-filter (WebKit parses it and paints nothing; Gecko drops it), so
// the refraction is gated on the engine, not on CSS.supports — which is true
// everywhere and proves nothing.
export function canRefract() {
  if (typeof window === "undefined") return false;
  // the lab switch: <html data-lg-page="1"> or ?lgpage=1 takes the
  // page-side path (what Safari gets) in any engine, so it can be seen and
  // judged on a desktop
  if (document.documentElement.dataset.lgPage === "1") return false;
  try { if (new URLSearchParams(window.location.search).get("lgpage") === "1") return false; } catch { /* no URL */ }
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands)) return brands.some((b) => /chromium/i.test(b.brand || ""));
  return !!window.chrome; // Chrome, Edge, Brave, Arc, Opera — all Blink
}

// The displacement map: a picture of how far each pixel of the backdrop is
// pulled, red for x and green for y, 128 meaning none, blue held at 128 so
// the still middle is a pure grey. A SECOND, greyscale picture carries how
// much of the pane is bezel (the lens ring) rather than frost. Two pictures,
// not one: Chromium colour-manages a feImage into the display's space, and
// on a P3 screen a pixel of (128,128,0) comes back with blue near 0.2 — a
// weight carried in one colour channel next to two others leaked a ghost of
// the sharp lens through the whole frosted middle. Greys survive the
// conversion; only greys are trusted here. The bezel is the
// outer BEZEL px of the rounded rect (measured by a rounded-rect signed
// distance); its profile is Apple's squircle, y = (1 - (1 - t)^4)^(1/4), and
// the bend per point is Snell's law for glass (n = 1.5) on that slope,
// pointing INWARD along the surface normal so no pixel ever samples beyond
// the pane (Chromium's backdrop stops at the pane's edge). The very lip is
// eased to nothing so the edge itself stays clean, the way Apple's does.
export const BEZEL = 56; // lengthened twice (owner, 8 Sep: "more distortion", then "still too subtle, push it") — 24, then 44
const GLASS_N = 1.5;
function bendProfile(t) {
  // t: 0 at the edge, 1 at the inner end of the bezel
  if (t <= 0 || t >= 1) return 0;
  const u = 1 - t;
  const slope = (u * u * u) / Math.pow(1 - u * u * u * u, 0.75); // dy/dt of the squircle
  const theta = Math.atan(slope);
  const delta = theta - Math.asin(Math.sin(theta) / GLASS_N);
  const lip = Math.min(1, t / 0.12); // ease in over the outer 12% of the bezel
  return Math.tan(delta) * lip;
}
// `open` says which edges are real edges of the glass: an edge flush with
// the viewport (the strip's top, left and right) has nothing beyond it and
// does not lens; only the edges the page passes under do.
export function drawRefractionMap(node, weightNode, w, h, radius, open) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const cw = document.createElement("canvas");
  cw.width = w; cw.height = h;
  const ctxw = cw.getContext("2d");
  if (!ctx || !ctxw) return;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const imgw = ctxw.createImageData(w, h);
  const dw = imgw.data;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const o = open || { top: true, right: true, bottom: true, left: true };
  // normalise the profile so the strongest bend uses the full channel
  let peak = 0;
  for (let i = 1; i < 200; i++) peak = Math.max(peak, bendProfile(i / 200));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance to each OPEN edge (a closed edge is infinitely far)
      const dl = o.left ? x + 0.5 : Infinity, dr = o.right ? w - x - 0.5 : Infinity;
      const dt = o.top ? y + 0.5 : Infinity, db = o.bottom ? h - y - 0.5 : Infinity;
      const dx = Math.min(dl, dr), dy = Math.min(dt, db);
      const sx = dl <= dr ? -1 : 1, sy = dt <= db ? -1 : 1; // outward signs
      let nx = 0, ny = 0, inside; // outward normal, distance to the edge
      if (r > 0 && dx < r && dy < r) {
        // a rounded corner between two open edges: radial distance
        const cx = r - dx, cy = r - dy;
        const len = Math.hypot(cx, cy) || 1;
        nx = (cx / len) * sx; ny = (cy / len) * sy;
        inside = r - len;
      } else if (dx < dy) {
        nx = sx; inside = dx;
      } else {
        ny = sy; inside = dy;
      }
      let m = 0;
      if (inside >= 0 && inside < BEZEL) m = bendProfile(inside / BEZEL) / (peak || 1);
      // the bezel's weight: 1 at the lip, easing to 0 a little past the bend
      const bw = Math.max(0, Math.min(1, 1 - inside / (BEZEL * 1.35)));
      const i = (y * w + x) * 4;
      d[i] = Math.round(128 - nx * m * 127);      // pull inward along -normal
      d[i + 1] = Math.round(128 - ny * m * 127);
      d[i + 2] = 128;
      d[i + 3] = 255;
      const wt = Math.round(255 * bw * bw * (3 - 2 * bw)); // smoothstep, as a grey
      dw[i] = wt; dw[i + 1] = wt; dw[i + 2] = wt; dw[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctxw.putImageData(imgw, 0, 0);
  node.setAttribute("href", c.toDataURL("image/png"));
  weightNode.setAttribute("href", cw.toDataURL("image/png"));
}


// The filter, once per pane (each pane needs its own id: its map is its own
// size). Render it near the pane; it is 0×0 and paints nothing itself.
// The pull at the edge, R/G/B (glass disperses: red bends least, blue most).
// The header runs at 1; the popups at 0.5 (0.15 read as nothing at all).
export const PULL = [80, 86, 92];
// `prism` widens the gap between the three colours' pulls (owner, 18 Oct
// 2026: "rainbow refractive reactive liquid glass, cmon … I want it to look
// cool"): 0 is the 8 Sep fringe; 1 roughly triples it, so what passes under
// the bezel splits into red, green and blue — the rainbow is IN the
// refraction, not only painted on the rim.
export function LiquidGlassDefs({ id, mapRef, weightRef, strength = 1, prism = 0 }) {
  const [sr, sg, sb] = PULL.map((v, i) => (v * strength * (1 + prism * (i - 1) * 0.28)).toFixed(1));
  return (
    <svg className="glass-defs" aria-hidden="true" focusable="false">
    {/* THE OPTICS: the centre of the pane is CRYSTAL CLEAR (the backdrop
        untouched — the owner found any frost "oddly cloudy"); the
        bezel is a lens — the backdrop bent through the map, each
        colour a little differently (glass disperses: red bends least,
        blue most — the faint colour fringe on Apple's edges), only
        lightly softened — blended with the clear backdrop by the weight
        picture, a grey that says how much of each pixel is bezel. That is
        Apple's clear glass: a refracting rim around an untouched middle. */}
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      <feImage ref={mapRef} preserveAspectRatio="none" result="lgmap" />
      <feImage ref={weightRef} preserveAspectRatio="none" result="lgw" />
      {/* the lens chain, data-lens: restrictLens() confines these to the
          edge band when only one edge is open (the strip), so the clear
          middle costs nothing — the blur that used to follow them is gone
          for the same reason; the lens is crisp, as Apple's is. */}
      <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sr} xChannelSelector="R" yChannelSelector="G" result="bentR" />
      <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sg} xChannelSelector="R" yChannelSelector="G" result="bentG" />
      <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sb} xChannelSelector="R" yChannelSelector="G" result="bentB" />
      <feColorMatrix data-lens="1" in="bentR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chR" />
      <feColorMatrix data-lens="1" in="bentG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chG" />
      <feColorMatrix data-lens="1" in="bentB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chB" />
      <feComposite data-lens="1" in="chR" in2="chG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="chRG" />
      <feComposite data-lens="1" in="chRG" in2="chB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lens" />
      {/* lens × weight + clear × (1 − weight): the weight picture read
          into COLOUR at full alpha, and its complement, so the blend is
          plain arithmetic — no alpha mask, nothing premultiplied to
          darken the band. */}
      <feColorMatrix in="lgw" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="w" />
      <feColorMatrix in="lgw" type="matrix" values="-1 0 0 0 1  -1 0 0 0 1  -1 0 0 0 1  0 0 0 0 1" result="iw" />
      <feComposite data-lens="1" in="lens" in2="w" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lensW" />
      <feComposite in="SourceGraphic" in2="iw" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="frostW" />
      <feComposite in="lensW" in2="frostW" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
    </filter>
    </svg>
  );
}

// Confine the lens chain of a pane's filter to the band inside its one open
// edge (the strip: the bottom), in the pane's own pixels — the clear middle
// then costs nothing on every scroll frame. `band` null lifts it.
export function restrictLens(filterEl, band) {
  if (!filterEl) return;
  for (const n of filterEl.querySelectorAll("[data-lens]")) {
    if (!band) { n.removeAttribute("x"); n.removeAttribute("y"); n.removeAttribute("width"); n.removeAttribute("height"); continue; }
    n.setAttribute("x", "0");
    n.setAttribute("y", band.y.toFixed(1));
    n.setAttribute("width", band.width.toFixed(1));
    n.setAttribute("height", band.height.toFixed(1));
  }
}
// The band a strip's lens needs: the bezel plus its easing, at the bottom.
export function bottomBand(w, h) {
  const deep = Math.min(h, Math.ceil(BEZEL * 1.35) + 2);
  return { y: h - deep, width: w, height: deep };
}

// THE PAGE-SIDE BEND. Where there is no backdrop refraction — WebKit never
// runs an SVG filter as a backdrop-filter, and a Chromium without GPU
// compositing drops it too — the page itself is bent instead: every element
// matching `selector` that lies under one of the pane's OPEN edges gets its
// own SVG filter, the pane's map placed in that element's coordinates over a
// flat 128 grey, so what passes under the edge bends the way a backdrop
// would. Bounded: only the elements the edge crosses, each filtered within
// its own box; nothing on the rest of the page pays. place(rect) on every
// change of the pane or the scroll; dispose() takes it all back.
export function createPageBend({ id, el, selector, strength = 1, mapRef, open = null }) {
  const SVG = "http://www.w3.org/2000/svg";
  let svg = null;
  const bent = new Map(); // element -> filter node
  const o = open || { top: true, right: true, bottom: true, left: true };
  // How the map reaches the filter differs by engine, and each engine
  // renders only its own form. WebKit renders an element as NOTHING when its
  // CSS filter carries an feImage with a data (or file) href — "the words
  // delete themselves" on Safari, 8 Sep — but renders and bends when the
  // feImage points by id at an <image> ELEMENT in the svg that carries the
  // data URL (probed in Safari with eleven variants). Chromium is the
  // reverse: the element reference places nothing, the data href bends.
  const webkit = typeof navigator !== "undefined" && /Apple Computer/.test(navigator.vendor || "");
  const chain = (imgId) => {
    const [sr, sg, sb] = PULL.map((v) => (v * strength).toFixed(1));
    return `<feFlood flood-color="rgb(128,128,128)" result="flat"/>` +
      (webkit ? `<feImage href="#${imgId}" result="pane"/>` : `<feImage preserveAspectRatio="none" result="pane"/>`) +
      `<feComposite in="pane" in2="flat" operator="over" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sr}" xChannelSelector="R" yChannelSelector="G" result="bR"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sg}" xChannelSelector="R" yChannelSelector="G" result="bG"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sb}" xChannelSelector="R" yChannelSelector="G" result="bB"/>` +
      `<feColorMatrix in="bR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR"/>` +
      `<feColorMatrix in="bG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cG"/>` +
      `<feColorMatrix in="bB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cB"/>` +
      `<feComposite in="cR" in2="cG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="cRG"/>` +
      `<feComposite in="cRG" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>`;
  };
  let serial = 0;
  const crosses = (b, r) => {
    const d = BEZEL * 1.35;
    if (o.bottom && b.bottom > r.bottom - d && b.top < r.bottom) return true;
    if (o.top && b.top < r.top + d && b.bottom > r.top) return true;
    if (o.left && b.left < r.left + d && b.right > r.left) return true;
    if (o.right && b.right > r.right - d && b.left < r.right) return true;
    return false;
  };
  // What lies under the open edges, found by SAMPLING the bands with
  // elementsFromPoint rather than measuring every candidate on the page:
  // a point every STEP px along each open edge's band, the hit resolved to
  // the OUTERMOST element matching the selector (a card, never the column
  // that holds it, never the title inside it — one filter per thing), and
  // nothing larger than BIG is ever filtered (the columns of the catalog
  // are 9,000px tall; filtering one of those every scroll frame was the
  // glitch and the lag of 8 Sep).
  // BIG_AREA (9 Sep): WebKit rasterises the WHOLE filtered element through
  // three displacement passes on every scroll frame, and the owner's Safari
  // lagged once the page's big panes could bend — a 720×520 pane is 375k
  // pixels a frame. Under 260k px² an element bends; over it, it passes
  // under the edge unbent (the upload station's panes, the passport
  // document) — the words and rows inside them still do.
  const STEP = 40, BIG = 1600, BIG_AREA = 260000;
  const outermost = (hit) => {
    let node = hit && hit.closest ? hit.closest(selector) : null;
    while (node) {
      const up = node.parentElement && node.parentElement.closest(selector);
      if (!up) break;
      node = up;
    }
    return node;
  };
  const sample = (r) => {
    const found = new Set();
    const d = BEZEL * 1.35;
    const rows = [];
    if (o.bottom) rows.push([r.left, r.right, r.bottom - d * 0.5, "x"], [r.left, r.right, r.bottom - 3, "x"]);
    if (o.top) rows.push([r.left, r.right, r.top + d * 0.5, "x"], [r.left, r.right, r.top + 3, "x"]);
    if (o.left) rows.push([r.top, r.bottom, r.left + d * 0.5, "y"], [r.top, r.bottom, r.left + 3, "y"]);
    if (o.right) rows.push([r.top, r.bottom, r.right - d * 0.5, "y"], [r.top, r.bottom, r.right - 3, "y"]);
    const W = window.innerWidth, H = window.innerHeight;
    for (const [a, b, c, axis] of rows) {
      for (let t = a + STEP / 2; t < b; t += STEP) {
        const x = axis === "x" ? t : c, y = axis === "x" ? c : t;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        for (const hit of document.elementsFromPoint(x, y)) {
          if (el.contains(hit)) continue;
          const node = outermost(hit);
          if (node && !el.contains(node)) found.add(node);
        }
      }
    }
    return found;
  };
  const place = (r) => {
    const href = mapRef.current && mapRef.current.getAttribute("href");
    if (!href) return;
    if (!svg) {
      svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("class", "glass-defs");
      svg.setAttribute("aria-hidden", "true");
      document.body.appendChild(svg);
    }
    const under = new Set();
    for (const node of sample(r)) {
      const b = node.getBoundingClientRect();
      if (b.width === 0 || b.width > BIG || b.height > BIG || b.width * b.height > BIG_AREA) continue;
      if (!crosses(b, r)) continue;
      under.add(node);
      let f = bent.get(node);
      if (!f) {
        const n = serial++;
        let img = null;
        if (webkit) {
          img = document.createElementNS(SVG, "image");
          img.setAttribute("id", `${id}-m${n}`);
          img.setAttribute("preserveAspectRatio", "none");
          svg.appendChild(img);
        }
        f = document.createElementNS(SVG, "filter");
        f.setAttribute("id", `${id}-b${n}`);
        f.setAttribute("color-interpolation-filters", "sRGB");
        f.setAttribute("primitiveUnits", "userSpaceOnUse");
        f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
        f.innerHTML = chain(img ? img.getAttribute("id") : "");
        // the picture that carries the map: the <image> element (WebKit) or
        // the feImage itself (everything else) — both take x/y/width/height
        f.__img = img || f.querySelector("feImage");
        svg.appendChild(f);
        bent.set(node, f);
        node.style.filter = `url(#${f.getAttribute("id")})`;
      }
      const img = f.__img;
      if (img.getAttribute("href") !== href) img.setAttribute("href", href);
      img.setAttribute("x", (r.left - b.left).toFixed(1));
      img.setAttribute("y", (r.top - b.top).toFixed(1));
      img.setAttribute("width", r.width.toFixed(1));
      img.setAttribute("height", r.height.toFixed(1));
    }
    for (const [node, f] of bent) {
      if (under.has(node)) continue;
      node.style.removeProperty("filter"); if (f.__img !== f.querySelector("feImage")) f.__img.remove(); f.remove(); bent.delete(node);
    }
  };
  const dispose = () => {
    for (const [node] of bent) node.style.removeProperty("filter");
    bent.clear();
    if (svg) { svg.remove(); svg = null; }
  };
  return { place, dispose };
}

// Keep an element's refraction map in step with its size, mark it
// data-refract="1" with --lg-filter pointing at its filter where the engine
// bends backdrops (see canRefract) or bend the page under it where it does
// not (createPageBend), and carry the pointer's shine (--gx/--gy/--gs).
// `open` names the edges that lens (default all four; the header passes the
// edges flush with the viewport as closed). Returns the defs to render.
// `strength` scales the pull (the popups run at 0.5 of the header).
// `bend` is a selector: WHERE THERE IS NO BACKDROP REFRACTION (WebKit —
// Safari never runs an SVG filter as a backdrop-filter) the page itself is
// bent instead: every element matching `bend` that lies under the pane's
// edge gets its own SVG filter — the pane's map placed in that element's
// coordinates over a flat 128 grey — so what is under the edge bends the
// way a backdrop would. Bounded: only the elements under the pane, each
// filtered within its own box; nothing on the rest of the page pays.
export function useLiquidGlass(elRef, { id, active = true, open = null, strength = 1, bend = null, prism = 0 } = {}) {
  const mapRef = useRef(null);
  const weightRef = useRef(null);
  useEffect(() => {
    const el = elRef.current;
    if (!active || !el) return undefined;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const refract = canRefract();
    const pageBend = !refract && bend ? createPageBend({ id, el, selector: bend, strength, mapRef, open }) : null;
    let raf = 0;
    const fit = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      if (mapRef.current && weightRef.current && r.width > 0 && r.height > 0) {
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        drawRefractionMap(mapRef.current, weightRef.current, Math.round(r.width), Math.round(r.height), radius, open);
        if (refract) {
          el.style.setProperty("--lg-filter", `url(#${id})`);
          el.dataset.refract = "1";
        } else if (pageBend) {
          pageBend.place(r);
        }
      }
    };
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(fit); });
    ro.observe(el);
    fit();
    // the page can still scroll under the pane on a phone: re-place the bend
    // — on alternate frames (9 Sep, the owner's Safari lag): the map trails
    // the edge by at most one frame, and WebKit re-rasterises half as often
    let skip = false;
    const onScroll = () => { if (!pageBend || raf) return; skip = !skip; if (!skip) raf = requestAnimationFrame(fit); };
    if (pageBend) window.addEventListener("scroll", onScroll, { passive: true });
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${((e.clientX - r.left) / Math.max(1, r.width)) * 100}%`);
      el.style.setProperty("--gy", `${((e.clientY - r.top) / Math.max(1, r.height)) * 100}%`);
      el.style.setProperty("--gs", "1");
    };
    const onLeave = () => el.style.setProperty("--gs", "0");
    if (!still) {
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
    }
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (pageBend) pageBend.dispose();
    };
  }, [elRef, id, active, open, strength, bend]);
  return <LiquidGlassDefs id={id} mapRef={mapRef} weightRef={weightRef} strength={strength} prism={prism} />;
}

// ---- THE REACTIVE RAINBOW (owner, 18 Oct 2026: "the liquid glass isn't
// liquid enough — I want the OG reactive rainbow liquid glass you made for
// ASILUM"). The 8 Sep glass answered the hand: its bezel bent what passed
// beneath it, the pointer's shine slid across it and the lit word's lamp
// glided under it. This restores that answer on the V.2 fixtures, the deck
// and every popup: ONE listener set for the whole app (the pointer, the
// phone's tilt where the device shares it, the scroll), ONE rAF write per
// frame, and the writes are custom properties on the few glass elements
// themselves (`.lgrx`), never on <html> — a property set on the root
// re-styles the whole document every frame; on four small elements it
// re-styles four small subtrees. Nothing here reads layout: the pointer is
// read from the event, the tilt from the sensor, the scroll from scrollY.
//
//   --iris-a   the angle the rainbow rim's conic starts from: it turns
//              towards the pointer, leans with the phone and rolls with
//              the scroll, so the colours travel round the edge
//   --iris-x/y where the conic is centred: the light's position, from
//              the pointer or the tilt (a percentage of the element)
//   --tilt-x/y -1..1, the lean the sheen and the rim read
//
// The phone's tilt needs no prompt here: Android shares it; iOS shares it
// only once the passenger granted motion in a tap (askTilt in FloatView.jsx,
// the photograph that floats) — until then the pointer and the scroll drive
// it alone. prefers-reduced-motion: nothing listens, the rim stays still.
export const GLASS_REACTIVE = ".lgrx";
export function useGlassReactive() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const s = { px: 0.5, py: 0.25, tx: 0, ty: 0, base: null, gyro: false, scroll: 0, raf: 0, a: 200, ta: 200 };
    const W = () => window.innerWidth || 1, H = () => window.innerHeight || 1;
    const tick = () => {
      s.raf = 0;
      // the angle: towards the pointer from the middle of the screen, plus the
      // lean and the scroll, eased so the colours flow rather than jump
      const toward = (Math.atan2(s.py - 0.5, s.px - 0.5) * 180) / Math.PI;
      s.ta = 200 + toward * 0.6 + s.tx * 40 + s.scroll * 0.18;
      s.a += (s.ta - s.a) * 0.18;
      const ix = (50 + (s.px - 0.5) * 70 + s.tx * 30).toFixed(1) + "%";
      const iy = (50 + (s.py - 0.5) * 70 + s.ty * 30).toFixed(1) + "%";
      const a = s.a.toFixed(1) + "deg";
      for (const el of document.querySelectorAll(GLASS_REACTIVE)) {
        el.style.setProperty("--iris-a", a);
        el.style.setProperty("--iris-x", ix);
        el.style.setProperty("--iris-y", iy);
        el.style.setProperty("--tilt-x", s.tx.toFixed(3));
        el.style.setProperty("--tilt-y", s.ty.toFixed(3));
      }
      if (Math.abs(s.ta - s.a) > 0.2) s.raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!s.raf) s.raf = requestAnimationFrame(tick); };
    const onMove = (e) => { if (s.gyro) return; s.px = e.clientX / W(); s.py = e.clientY / H(); s.tx = (s.px - 0.5) * 2; s.ty = (s.py - 0.5) * 2; wake(); };
    const onScroll = () => { s.scroll = window.scrollY || 0; wake(); };
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (!s.base) s.base = { b: e.beta, g: e.gamma };
      s.gyro = true;
      s.tx = Math.max(-1, Math.min(1, (e.gamma - s.base.g) / 25));
      s.ty = Math.max(-1, Math.min(1, (e.beta - s.base.b) / 25));
      s.px = 0.5 + s.tx * 0.5; s.py = 0.5 + s.ty * 0.5;
      wake();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("deviceorientation", onOrient);
    wake();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("deviceorientation", onOrient);
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, []);
}
