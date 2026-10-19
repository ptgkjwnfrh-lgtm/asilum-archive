# How it is made — the background, the liquid glass, the passport

*Written 19 September 2026 against branch `ui/live-launch-v2`. Every excerpt
below is the shipped code, quoted from the file it names; line numbers are
approximate and the file is the authority. Read this next to
`app/globals.css`, `app/shell.js`, `app/components/LiquidGlass.jsx`,
`app/components/PassportSecurity.jsx`, `app/components/ParisMap.jsx`,
`app/components/roadBuilder.js`, `lib/passport/document.js`,
`lib/roads/overpass.js` and `app/board/page.js`.*

The stack is Next.js (App Router) with React 18 and plain JavaScript. There is
one stylesheet, `app/globals.css`, and every colour, size and glow is a CSS
custom property ("token") on `:root` for phosphor dark and on
`[data-theme="light"]` for ice light. The three systems below are built from
ordinary CSS, SVG filters, `<canvas>` and a few hundred lines of DOM code —
no animation library, no map library, no WebGL.

---

## Part 1 — The background

### 1.1 The layer stack, bottom to top

Everything a page sits on is a fixed, pointer-transparent layer. The shell
(`app/shell.js`) mounts them in this order, and `z-index` decides the paint
order:

| z | Element | What it is |
| --- | --- | --- |
| — | `html, body` background | the ground: the backlight, the grid, the base colour |
| 0 | `body::before` | the colour wash (three soft radial gradients) |
| 0 | `.os-blob.b1…b4` | four drifting haze blobs, blurred 70px |
| 0 | `.os-plus` | the holographic plus field at 5% |
| auto | `.main` and the page | the content |
| 40 | `.os-frame` | the hairline frame and corner squares |
| 44 | `.glass-light` | the lamps under the header (Part 2) |
| 45 | `.tophead` | the header pane (Part 2) |
| 200 | `.os-crt` | scanlines, vignette, the rolling bar |

The JSX in the shell is exactly this:

```jsx
<div className="shell">
  <a className="skiplink" href="#main">skip to content</a>
  <div className="os-blob b1" aria-hidden="true" />
  <div className="os-blob b2" aria-hidden="true" />
  <div className="os-blob b3" aria-hidden="true" />
  <div className="os-blob b4" aria-hidden="true" />
  <div className="os-plus" aria-hidden="true" />
  <div className="os-frame" aria-hidden="true"><i /><i /><i /><i /></div>
  <div className="glass-light" ref={lightRef} aria-hidden="true" />
  <LiquidGlassDefs id="lg-refract" mapRef={mapRef} weightRef={weightRef} />
  <header className="tophead" ref={headRef}>…</header>
  <main id="main" className="main">{children}</main>
  <OsStatus … />
  <div className="os-crt" aria-hidden="true"><div className="os-roll" /></div>
</div>
```

### 1.2 The ground: backlight, grid, base

`html, body` carry four stacked backgrounds. The first is a radial "backlight"
that brightens the middle of the screen; the second and third are 1px lines
repeated every 140px in both directions (the grid); the fourth is the flat
base colour. `background-attachment: fixed` keeps the grid still while the
page scrolls.

```css
html, body {
  background:
    var(--backlight),
    linear-gradient(var(--grid-ln) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-ln) 1px, transparent 1px),
    var(--bg);
  background-size: 100% 100%, var(--ed-grid-cell, 140px) var(--ed-grid-cell, 140px),
                   var(--ed-grid-cell, 140px) var(--ed-grid-cell, 140px), 100% 100%;
  background-attachment: fixed;
  color: var(--ink);
  font-family: var(--helv);
  text-shadow: var(--glow-ink);
}
```

with these tokens on phosphor dark:

```css
--bg: #070b10;
--grid-ln: rgba(120, 255, 190, 0.012);   /* the grid is 1.2% green on black */
--backlight: radial-gradient(ellipse 75% 62% at 50% 44%, rgba(150, 235, 210, 0.07), transparent 68%);
--ink: #d4ffe8;  --sig: #46ff96;  --red: #ff3838;  --p2: #b088ff;
--glow-ink: 0 0 5px rgba(212, 255, 232, 0.28);
```

`--ed-grid-cell` is one of the "editor" tokens: the design console
(`lib/uilab.js`) writes an override inline on `<html>`, and the `var(--ed-x,
fallback)` form means the shipped value is the fallback.

### 1.3 The colour wash

The wash is its own fixed layer on `body::before`, deliberately separate
from the ground. It used to be a second and third gradient inside
`--backlight`, and it inherited the grid's 140px `background-size` and tiled
into a checkerboard. One fixed pseudo-element, never tiled:

```css
--wash:
  radial-gradient(ellipse 62% 54% at 78% 16%, rgba(235, 70, 200, 0.05), transparent 70%),   /* fuchsia, top right */
  radial-gradient(ellipse 58% 50% at 16% 84%, rgba(120, 110, 255, 0.055), transparent 70%), /* soft purple, bottom left */
  radial-gradient(ellipse 48% 42% at 52% 60%, rgba(90, 140, 255, 0.035), transparent 72%);  /* soft blue, centre */
body::before { content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none; background: var(--wash); }
```

### 1.4 The haze blobs

Four circles, blurred to nothing, each drifting on its own slow loop. The
motion is a single `transform` keyframe per blob, so it costs the compositor
only:

```css
.os-blob { position: fixed; border-radius: 50%; filter: blur(70px); pointer-events: none; z-index: 0; opacity: var(--ed-blob-op, 1); }
.os-blob.b1 { width: 44vw; height: 38vh; left: -8vw; top: -6vh; background: rgba(90, 130, 255, 0.08);  animation: osdrift1 46s ease-in-out infinite alternate; }
.os-blob.b2 { width: 36vw; height: 42vh; right: -6vw; top: 12vh; background: rgba(255, 70, 200, 0.06);  animation: osdrift2 58s ease-in-out infinite alternate; }
.os-blob.b3 { width: 30vw; height: 30vh; left: 24vw; bottom: -10vh; background: rgba(160, 110, 255, 0.08); animation: osdrift1 52s ease-in-out infinite alternate-reverse; }
.os-blob.b4 { width: 22vw; height: 22vh; right: 18vw; bottom: 6vh; background: rgba(215, 95, 255, 0.04); animation: osdrift2 40s ease-in-out infinite alternate-reverse; }
@keyframes osdrift1 { to { transform: translate(6vw, 4vh) scale(1.15); } }
@keyframes osdrift2 { to { transform: translate(-5vw, -3vh) scale(0.9); } }
```

Ice light swaps only the colours (cyan, pink, peach, pale yellow) and raises
the opacity by 30%:

```css
[data-theme="light"] .os-blob { opacity: calc(var(--ed-blob-op, 1) * 1.3); }
[data-theme="light"] .os-blob.b1 { background: rgba(80, 210, 245, 0.16); }
```

### 1.5 The plus field

A holographic gradient seen only through a mask of tiny plus signs. The plus
is one SVG data URL, drawn in a 56-unit tile; the mask repeats it at two
different pitches and offsets so the field reads scattered, not gridded.
Nothing animates.

```css
--plus: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'%3E%3Cpath d='M27.4 24.5h1.2v2.9h2.9v1.2h-2.9v2.9h-1.2v-2.9h-2.9v-1.2h2.9z' fill='%23000'/%3E%3C/svg%3E");
--holo: linear-gradient(118deg, #46ff96 0%, #5a8cff 22%, #b088ff 44%, #ff3838 62%, #eb46c8 80%, #46ff96 100%);

.os-plus { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  opacity: calc(var(--ed-plus-op, 0.05) * var(--plus-k, 0.75));   /* 5%; phosphor takes 75% of it */
  background: var(--holo);
  mask-image: var(--plus), var(--plus);
  mask-size: 96px 96px, 137px 137px;
  mask-position: 0 0, 41px 63px;
  mask-repeat: repeat; }
```

The trick is that the gradient is the only thing painted; the mask keeps
only the plus shapes, so each plus takes the hue under it.

### 1.6 The frame

Thin hairlines and small outline squares just inside the viewport, under the
header and every panel, over the page. Decoration; `pointer-events: none`.

```css
.os-frame { position: fixed; inset: 0; top: var(--head-h); pointer-events: none; z-index: 40; }
.os-frame::before { content: ""; position: absolute; inset: 7px; border: 1px solid color-mix(in srgb, var(--ink) 13%, transparent); }
.os-frame::after  { content: ""; position: absolute; top: 12px; left: 12px; bottom: 12px; width: 34%;
  border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); border-right: none; }
.os-frame i:nth-child(1) { right: 22px; top: 18px; width: 9px; height: 9px; border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent); }
```

### 1.7 The glass over everything: scanlines and the roll

The topmost layer is the "looking through a CRT" pass: a 2px-on/2px-off
repeating gradient at 31.5% opacity, an inset vignette with an 18px radius,
and a 16vh bar of light rolling top to bottom every nine seconds.

```css
.os-crt { position: fixed; inset: 0; pointer-events: none; z-index: 200; }
.os-crt::before { content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 2px, var(--scan) 2px 4px);
  opacity: var(--ed-scan-op, 0.315); }
.os-crt::after  { content: ""; position: absolute; inset: 0; border-radius: 18px;
  box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.42), inset 0 0 8px rgba(0, 0, 0, 0.3); }
.os-roll { position: absolute; left: 0; right: 0; height: 16vh;
  background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.045), transparent);
  opacity: var(--ed-roll-op, 0.2);
  animation: osroll var(--ed-roll-dur, 9s) linear infinite; }
@keyframes osroll { from { top: -18vh; } to { top: 104vh; } }
```

`--scan` is `rgba(2, 8, 6, 0.11)` on dark; ice light tints the vignette
cyan instead of black.

### 1.8 Theme switching

The theme is an attribute on `<html>`. A pre-paint script in
`app/layout.js` reads `localStorage["asilum-theme"]` and sets
`document.documentElement.dataset.theme` before the first frame, so there is
no flash. The shell keeps an unpinned session in step with the OS:

```js
const mq = window.matchMedia("(prefers-color-scheme: light)");
const followDevice = () => {
  let stored = null;
  try { stored = window.localStorage.getItem("asilum-theme"); } catch {}
  if (stored !== "dark" && stored !== "light") {
    document.documentElement.dataset.theme = mq.matches ? "light" : "dark";
  }
};
mq.addEventListener("change", followDevice);
```

Every rule above reads tokens, so switching the attribute repaints the whole
stack in the other palette.

### 1.9 Reduced motion

Every animated layer has a `@media (prefers-reduced-motion: reduce)` rule
that either sets `animation: none` (the roll, the blobs, the road build) or
drops to one static frame (the hologram dock, the taste-network pulse). The
plus field and the frame never move.

---

## Part 2 — The liquid glass

The glass is one primitive in `app/components/LiquidGlass.jsx`, used by
three surfaces: the header strip (`.tophead` in `app/shell.js`), the item
detail (`.modal.lg` in `app/page.js`) and every page pane (`GlassPane.jsx`,
which wraps `useLiquidGlass`). The header adds two things of its own: the
lamps and the meniscus.

### 2.1 What "glass" means here

A pane of nearly clear glass. Almost no fill (`--glass: rgba(255,255,255,0.03)`).
The centre is crystal clear: no blur, only `saturate(160%)` on the backdrop.
The outer 56px of every OPEN edge is a lens: the backdrop under it is bent
inward, red a little less than green, green less than blue, the way real
glass disperses. The edge itself is unseen: no border, no band, a whisper of
Fresnel light on the bottom lip and a 7px zone that only reflects what is
near it (the pointer's white, the lit word's colour).

```css
.tophead {
  position: fixed; top: 0; left: 0; right: 0; z-index: 45;
  background: var(--glass);
  backdrop-filter: saturate(160%);                 /* clear middle */
  box-shadow: var(--glass-shadow), var(--glass-lip);
  isolation: isolate;
}
.tophead[data-refract="1"] {
  backdrop-filter: url(#lg-refract) saturate(160%); /* Chromium: the lens */
}
```

### 2.2 Which engine bends a backdrop

Only Chromium runs an SVG filter as a `backdrop-filter`. WebKit parses it and
paints nothing; Gecko drops it. So the refraction is gated on the engine,
not on `CSS.supports`, which is true everywhere and proves nothing:

```js
export function canRefract() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.lgPage === "1") return false;         // lab switch
  try { if (new URLSearchParams(window.location.search).get("lgpage") === "1") return false; } catch {}
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands)) return brands.some((b) => /chromium/i.test(b.brand || ""));
  return !!window.chrome;
}
```

Where it returns false the PAGE bends instead (2.7).

### 2.3 The displacement map: drawing how far each pixel is pulled

An SVG `feDisplacementMap` moves each pixel of its input by an amount read
from a second image: the red channel is the x offset, green is y, and 128
means "no movement". `drawRefractionMap` paints that image on a canvas the
exact size of the pane, one pixel at a time.

The bezel profile is Apple's squircle, `y = (1 − (1 − t)^4)^(1/4)`, and the
bend at each point is Snell's law for glass (n = 1.5) on that slope. The very
lip eases in over the outer 12% so the edge stays clean.

```js
export const BEZEL = 56;
const GLASS_N = 1.5;
function bendProfile(t) {                  // t: 0 at the edge, 1 at the inner end of the bezel
  if (t <= 0 || t >= 1) return 0;
  const u = 1 - t;
  const slope = (u * u * u) / Math.pow(1 - u * u * u * u, 0.75);   // dy/dt of the squircle
  const theta = Math.atan(slope);
  const delta = theta - Math.asin(Math.sin(theta) / GLASS_N);      // refraction angle
  const lip = Math.min(1, t / 0.12);
  return Math.tan(delta) * lip;
}
```

For every pixel the function finds the nearest OPEN edge (a closed edge, one
flush with the viewport, counts as infinitely far), computes the outward
normal, and writes the pull inward along that normal. A second canvas — the
weight picture — records how much of each pixel is bezel, as a grey:

```js
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const dl = o.left ? x + 0.5 : Infinity, dr = o.right ? w - x - 0.5 : Infinity;
  const dt = o.top ? y + 0.5 : Infinity, db = o.bottom ? h - y - 0.5 : Infinity;
  const dx = Math.min(dl, dr), dy = Math.min(dt, db);
  const sx = dl <= dr ? -1 : 1, sy = dt <= db ? -1 : 1;              // outward signs
  let nx = 0, ny = 0, inside;
  if (r > 0 && dx < r && dy < r) {                                     // a rounded corner
    const cx = r - dx, cy = r - dy, len = Math.hypot(cx, cy) || 1;
    nx = (cx / len) * sx; ny = (cy / len) * sy; inside = r - len;
  } else if (dx < dy) { nx = sx; inside = dx; } else { ny = sy; inside = dy; }
  let m = 0;
  if (inside >= 0 && inside < BEZEL) m = bendProfile(inside / BEZEL) / peak;
  const bw = Math.max(0, Math.min(1, 1 - inside / (BEZEL * 1.35)));   // bezel weight
  const i = (y * w + x) * 4;
  d[i] = Math.round(128 - nx * m * 127);   // R = x pull, inward
  d[i + 1] = Math.round(128 - ny * m * 127); // G = y pull
  d[i + 2] = 128; d[i + 3] = 255;           // B held at 128: pure grey where still
  const wt = Math.round(255 * bw * bw * (3 - 2 * bw));                 // smoothstep, as a grey
  dw[i] = dw[i + 1] = dw[i + 2] = wt; dw[i + 3] = 255;
}
node.setAttribute("href", c.toDataURL("image/png"));        // the map
weightNode.setAttribute("href", cw.toDataURL("image/png")); // the weight
```

Why two pictures and not one with the weight in the blue channel: Chromium
colour-manages an `feImage` into the display's space, and on a P3 screen a
pixel of (128, 128, 0) came back with blue near 0.2, leaking a ghost of the
sharp lens across the whole clear middle. Greys survive the conversion.
Only greys are trusted.

### 2.4 The filter chain

`LiquidGlassDefs` renders a 0×0 `<svg>` holding one `<filter>` per pane.
Three displacement maps bend the backdrop by three slightly different
amounts (red 80, green 86, blue 92 at strength 1), each is reduced to its own
channel, the three are added back into one "lens" image, and the lens is
blended with the untouched backdrop by the weight picture using plain
arithmetic: `lens × w + clear × (1 − w)`.

```jsx
export const PULL = [80, 86, 92];
<filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
  <feImage ref={mapRef} preserveAspectRatio="none" result="lgmap" />
  <feImage ref={weightRef} preserveAspectRatio="none" result="lgw" />
  <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sr} xChannelSelector="R" yChannelSelector="G" result="bentR" />
  <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sg} … result="bentG" />
  <feDisplacementMap data-lens="1" in="SourceGraphic" in2="lgmap" scale={sb} … result="bentB" />
  <feColorMatrix data-lens="1" in="bentR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chR" />
  <feColorMatrix data-lens="1" in="bentG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chG" />
  <feColorMatrix data-lens="1" in="bentB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chB" />
  <feComposite data-lens="1" in="chR" in2="chG" operator="arithmetic" k2="1" k3="1" result="chRG" />
  <feComposite data-lens="1" in="chRG" in2="chB" operator="arithmetic" k2="1" k3="1" result="lens" />
  <feColorMatrix in="lgw" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="w" />
  <feColorMatrix in="lgw" type="matrix" values="-1 0 0 0 1  -1 0 0 0 1  -1 0 0 0 1  0 0 0 0 1" result="iw" />
  <feComposite data-lens="1" in="lens" in2="w" operator="arithmetic" k1="1" result="lensW" />
  <feComposite in="SourceGraphic" in2="iw" operator="arithmetic" k1="1" result="frostW" />
  <feComposite in="lensW" in2="frostW" operator="arithmetic" k2="1" k3="1" />
</filter>
```

The `feComposite operator="arithmetic"` formula is `k1·i1·i2 + k2·i1 +
k3·i2 + k4`, so `k1=1` multiplies the two inputs (lens × weight) and
`k2=1, k3=1` adds them. No alpha mask is involved anywhere, which is why the
band never darkens.

### 2.5 The strip pays only for its edge

The header has one open edge, the bottom. `restrictLens` sets `x/y/width/
height` on every primitive tagged `data-lens` so the lens chain runs only in
the bottom band (the bezel plus its easing), and the clear middle costs
nothing on a scroll frame:

```js
export function restrictLens(filterEl, band) {
  for (const n of filterEl.querySelectorAll("[data-lens]")) {
    n.setAttribute("x", "0"); n.setAttribute("y", band.y.toFixed(1));
    n.setAttribute("width", band.width.toFixed(1)); n.setAttribute("height", band.height.toFixed(1));
  }
}
export function bottomBand(w, h) {
  const deep = Math.min(h, Math.ceil(BEZEL * 1.35) + 2);
  return { y: h - deep, width: w, height: deep };
}
```

In the shell, the map is redrawn only when the pane's size changes (a
`ResizeObserver`), never on scroll:

```js
const STRIP_OPEN = { top: false, left: false, right: false, bottom: true };
const fit = () => {
  const r = el.getBoundingClientRect();
  light.style.top = `${r.top}px`; light.style.left = `${r.left}px`;      // the lamp layer follows the pane
  light.style.width = `${r.width}px`; light.style.height = `${r.height}px`;
  const w = Math.round(r.width), h = Math.round(r.height);
  if (`${w}x${h}` !== lastSize) {
    drawRefractionMap(mapRef.current, weightRef.current, w, h, radius, STRIP_OPEN);
    restrictLens(document.getElementById("lg-refract"), bottomBand(w, h));
  }
  if (refract) el.dataset.refract = "1"; else pageBend.place(r);
  placeCurrent();
};
new ResizeObserver(() => requestAnimationFrame(fit)).observe(el);
```

Setting `data-refract="1"` is what switches the CSS from
`saturate(160%)` to `url(#lg-refract) saturate(160%)`.

### 2.6 The gloss, the edge, the pointer's shine

All of it is CSS on two pseudo-elements, driven by custom properties the
shell writes on pointer move (`--gx/--gy` = where the pointer is as a
percentage of the pane, `--gs` = 1 while it is over the pane, 0 after it
leaves, transitioned over 0.5s).

`::before` is the gloss: a thin specular along the top where the sheet meets
the light, one diagonal reflection band (a window in the glass), a faint
Fresnel at the bottom, plus the pointer's tight specular core set 6px up and
left of the cursor and a faint wide sheen around it:

```css
--glass-sheen:
  linear-gradient(180deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.02) 3px, rgba(255,255,255,0) 16px),
  linear-gradient(104deg, rgba(255,255,255,0) 36%, rgba(255,255,255,0.025) 45%, rgba(255,255,255,0.045) 50%, rgba(255,255,255,0.02) 56%, rgba(255,255,255,0) 65%),
  linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0) 8px);
.tophead::before {
  background:
    radial-gradient(96px 36px at calc(var(--gx, 50%) - 6px) calc(var(--gy, 40%) - 6px),
      color-mix(in srgb, var(--glass-spot) calc(var(--gs, 0) * 100%), transparent), … transparent 72%),
    radial-gradient(460px 220px at var(--gx, 50%) var(--gy, 40%), color-mix(in srgb, var(--glass-spot-wide) calc(var(--gs, 0) * 100%), transparent), transparent 70%),
    var(--glass-sheen);
}
```

`::after` is the edge: a 7px ring made with a padding-box XOR mask, blurred
3px, carrying only the pointer's white and the lit word's lamp colour:

```css
.tophead::after {
  padding: 7px;
  background:
    radial-gradient(300px 150px at var(--gx, 50%) var(--gy, 50%), color-mix(in srgb, var(--glass-rim-catch) calc(var(--gs, 0) * 100%), transparent), transparent 70%),
    radial-gradient(260px 130px at var(--lx) var(--ly), color-mix(in srgb, var(--lamp-hot) calc(var(--ls) * 30%), transparent), transparent 70%),
    var(--glass-rim);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  filter: blur(3px);
}
```

`color-mix(in srgb, X calc(var(--gs) * 100%), transparent)` is how a
gradient fades with a number: at `--gs: 0` the colour is 0% X, i.e. fully
transparent.

### 2.7 The lamps: a light under the water

The words in the header do not glow on the pane; the light comes from
beneath it. `.glass-light` is a sibling one layer BELOW the pane, kept to the
pane's rect, blurred 14px, carrying three lamps, each made of three radial
gradients (a near-white core, a coloured halo, a wide faint spill — a glow
stick in water):

```css
.glass-light {
  position: fixed; z-index: 44; pointer-events: none; overflow: hidden;
  filter: blur(14px);
  background:
    radial-gradient(90px 38px at var(--gx, 50%) var(--gy, 50%), color-mix(in srgb, var(--lamp-pointer) calc(var(--gs) * 100%), transparent), transparent 70%),   /* the pointer */
    radial-gradient(48px 18px  at var(--lx) var(--ly), color-mix(in srgb, var(--lamp-core) calc(var(--ls) * 100%), transparent), transparent 70%),               /* hovered word: core */
    radial-gradient(150px 56px at var(--lx) var(--ly), color-mix(in srgb, var(--lamp-hot)  calc(var(--ls) * 100%), transparent), transparent 70%),               /* halo */
    radial-gradient(320px 130px at var(--lx) var(--ly), color-mix(in srgb, var(--lamp-hot)  calc(var(--ls) * 12%),  transparent), transparent 70%),              /* spill */
    radial-gradient(44px 16px  at var(--cx) var(--cy), color-mix(in srgb, var(--lamp-core) calc(var(--cs) * 50%),  transparent), transparent 70%),               /* current destination */
    radial-gradient(140px 52px at var(--cx) var(--cy), color-mix(in srgb, var(--lamp)      calc(var(--cs) * 100%), transparent), transparent 70%),
    radial-gradient(300px 120px at var(--cx) var(--cy), color-mix(in srgb, var(--lamp)      calc(var(--cs) * 12%),  transparent), transparent 70%);
  transition: --lx 0.55s cubic-bezier(0.2, 0.8, 0.2, 1), --ly 0.55s …, --ls 0.45s ease, --cx 0.7s …, --cs 0.6s ease, --gs 0.5s ease;
}
```

Custom properties can only transition if they are registered with
`@property` (so the browser knows they are lengths/percentages/numbers) and
declared `inherits: true` (so a `::before` can read them). The shell writes
`--lx/--ly/--ls` when the pointer enters a word, and `--cx/--cy/--cs` for
the current destination:

```js
const centreOf = (node) => {
  const r = el.getBoundingClientRect(), b = node.getBoundingClientRect();
  return { x: `${((b.left + b.width / 2 - r.left) / r.width) * 100}%`,
           y: `${((b.top + b.height / 2 - r.top) / r.height) * 100}%` };
};
const onOver = (e) => {
  const word = e.target.closest && e.target.closest("a, button");
  if (!word || !el.contains(word) || word === lit) return;
  lit = word;
  domeOn(word, e);
  const c = centreOf(word);
  for (const n of [el, light]) {
    n.dataset.lamp = word.classList.contains("wordmark") ? "red" : "";   // the wordmark's lamp is red
    n.style.setProperty("--lx", c.x); n.style.setProperty("--ly", c.y); n.style.setProperty("--ls", "1");
  }
};
```

Because `--lx` transitions over 0.55s, the lamp GLIDES from word to word.
The pane above it is nearly clear, so what you see is the lamp itself,
blurred by its own layer and bent by the pane's bezel at the bottom.

### 2.8 The meniscus

When the pointer rests on a header word, the word is seen through a shallow
dome the cursor pulls in the surface. It is a second, tiny filter
(`#lg-ripple` in the shell) applied to the word alone, Chromium only:

```jsx
<filter id="lg-ripple" colorInterpolationFilters="sRGB" primitiveUnits="userSpaceOnUse" x="-12%" y="-50%" width="124%" height="200%">
  <feFlood floodColor="rgb(128,128,128)" result="flat" />                      /* no pull outside the dome */
  <feImage ref={domeRef} x="0" y="0" width={DOME} height={DOME} preserveAspectRatio="none" result="dome" />
  <feComposite in="dome" in2="flat" operator="over" result="rmap" />
  <feDisplacementMap in="SourceGraphic" in2="rmap" scale="0" xChannelSelector="R" yChannelSelector="G" result="dR" />
  <feDisplacementMap … result="dG" /> <feDisplacementMap … result="dB" />
  … three channel matrices and two arithmetic composites, as in 2.4 …
</filter>
```

The dome picture is drawn once on a 64px canvas: rays through a dome bend
towards its centre, so each sample is pulled towards the middle, linearly
(a spherical cap's slope grows with radius), eased to nothing at the rim:

```js
const DOME = 72;
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r = Math.hypot(dx, dy);
  const t = r >= 1 ? 0 : r <= 0.55 ? 1 : 1 - ((r - 0.55) / 0.45) ** 2 * (3 - 2 * ((r - 0.55) / 0.45));
  const i = (y * n + x) * 4;
  d[i] = Math.round(128 - dx * t * 127); d[i + 1] = Math.round(128 - dy * t * 127); d[i + 2] = 128; d[i + 3] = r >= 1 ? 0 : 255;
}
const DOME_SCALES = [3.2, 3.7, 4.2];   // px of pull, R/G/B — 2.0 was invisible, 5.0 obvious
```

One `requestAnimationFrame` loop moves the dome towards the pointer with lag
(`x += (tx − x) · 0.22`) and ramps its strength in on enter and out on
leave, then stops when settled. The pull is written by setting `scale` on
the three displacement maps; the dome's place by setting `x/y` on the
`feImage`, in the word's own user space.

### 2.9 The page-side bend: where the engine cannot bend a backdrop

Safari never runs an SVG filter as a backdrop-filter. There, the PAGE bends
instead: every element under the pane's open edge gets its own SVG filter,
with the pane's map placed in that element's coordinates over a flat 128
grey. `createPageBend` finds what lies under the edge by SAMPLING the band
with `elementsFromPoint` every 40px (never by measuring every candidate),
resolves each hit to the outermost element matching the selector, and skips
anything over 1600px on a side or 260k px² in area — the first cut matched
the catalog's 9,000px columns and re-filtered them every scroll frame, which
was the glitch and the lag of 8 September:

```js
const STEP = 40, BIG = 1600, BIG_AREA = 260000;
const sample = (r) => {
  const found = new Set(), d = BEZEL * 1.35, rows = [];
  if (o.bottom) rows.push([r.left, r.right, r.bottom - d * 0.5, "x"], [r.left, r.right, r.bottom - 3, "x"]);
  for (const [a, b, c, axis] of rows)
    for (let t = a + STEP / 2; t < b; t += STEP) {
      const x = axis === "x" ? t : c, y = axis === "x" ? c : t;
      for (const hit of document.elementsFromPoint(x, y)) {
        if (el.contains(hit)) continue;
        const node = outermost(hit);
        if (node && !el.contains(node)) found.add(node);
      }
    }
  return found;
};
```

WebKit renders an element as NOTHING when its CSS filter carries an
`feImage` with a data href, but bends when the `feImage` points by id at an
`<image>` element in the SVG that carries the data URL. Chromium is the
reverse. The chain is emitted in both forms:

```js
const webkit = /Apple Computer/.test(navigator.vendor || "");
const chain = (imgId) => `<feFlood flood-color="rgb(128,128,128)" result="flat"/>` +
  (webkit ? `<feImage href="#${imgId}" result="pane"/>` : `<feImage preserveAspectRatio="none" result="pane"/>`) +
  `<feComposite in="pane" in2="flat" operator="over" result="map"/>` + …displacement, matrices, composites…;
```

and on every scroll the map image is re-placed at `(paneLeft − elementLeft,
paneTop − elementTop)` for each bent element, on alternate frames only,
because WebKit re-rasterises the whole filtered element through three
displacement passes per placement.

### 2.10 The hook, and the page panes

`useLiquidGlass(elRef, { id, open, strength, bend })` ties it together for
any element: a `ResizeObserver` redraws the map on size change, sets
`--lg-filter` and `data-refract="1"` where the engine bends backdrops (or
places the page bend where it does not), and writes the pointer's `--gx/
--gy/--gs`. It returns the `<LiquidGlassDefs>` element for the caller to
render. `GlassPane.jsx` is the page-level wrapper:

```jsx
export default function GlassPane({ glass, className = "", strength = 0.5, as: Tag = "section", children, ...rest }) {
  const ref = useRef(null);
  const defs = useLiquidGlass(ref, { id: glass, strength });   // no page bend: trap 151
  return <Tag ref={ref} className={"lgpane lg " + className} {...rest}>{defs}{children}</Tag>;
}
```

`glass` must be unique on the page because it is the filter's id and the
map is that pane's own size. Page panes run at half the header's pull
(`strength: 0.5`) and carry a 55% tint so text on them reads:

```css
.lgpane { position: relative; z-index: 1; border-radius: 22px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: saturate(160%); box-shadow: var(--glass-shadow), var(--glass-lip); isolation: isolate; }
.lgpane[data-refract="1"] { backdrop-filter: var(--lg-filter) saturate(160%); }
```

### 2.11 Reduced motion

Keeps the pane, the lamps and the refraction; drops the glide (the lamp
transitions shorten to 0.3s), the pointer shine (`::before` falls back to the
static sheen) and the meniscus (`domeOn` returns early when `still` is true).

---

## Part 3 — The passport

### 3.1 The page around the document

`app/board/page.js` is the Passport: a client component that renders the
document, then the two buttons (OPEN MAP, STAMP PASSPORT), then a segmented
row of four tabs (COLLECTION, FULL READ, PLACES, STUDIO). Everything on the
document is real state:

```js
const [uid, setUid] = useState(null);            // the account number (u-… device or sb-… account)
const [boards, setBoards] = useState([]);        // moodboards → pin count
const [viz, setViz] = useState(null);            // the brain's reading → convictions, taste class
const [pinfo, setPinfo] = useState({ name, handle, since, origin, area });
const [ticketCount, setTicketCount] = useState(0);
const [loc, setLoc] = useState(null);            // the confirmed base city (lib/location.js)
```

`since` is stamped once on the device's first passport view and never
faked; `origin` is the device locale's region; `area` is the UTC offset in
minutes (the machine zone's "area code").

### 3.2 The document's DOM, layer by layer

```jsx
<div className="ppdoc lg" ref={ppRef} aria-label="passport document">
  {ppGlass}                                                   {/* the glass filter defs (2.10) */}
  <div className="ppsec"><span className="ppnum">№ AS·{boards}·{convictions}</span></div>   {/* security band */}
  <div className="ppnation">ASILUM MAGAZINE <b>*</b> FASHION PASSPORT</div>                 {/* nation line */}
  <div className="ppbody">
    <div className="ppphotocol">
      <span className="ppquad"><b>PASSPORT</b><span>パスポート</span><span>REISEPASS</span><span>PASSEPORT</span></span>
      <button className="ppphoto">…bearer photo (device-local)…</button>
    </div>
    <dl className="ppid">…TYPE · CODE · ACCOUNT NO · USERNAME · CLASS · MEMBER SINCE · BASED IN · COUNTRY OF ORIGIN · TASTE CLASS · AUTHORITY · SAVED · CONVICTIONS…</dl>
  </div>
  <div className="ppmrz">{mrzTint(mrzTop)}<br />{mrzTint(mrzBot)}</div>          {/* the machine zone */}
  <PassportSecurity topTag=… topWeight=… map={docMap} />                        {/* hologram, UV, terrain, microprint */}
  <div className="ppdocacts"><button className="ppbtn">OPEN MAP</button><button className="ppbtn primary">STAMP PASSPORT</button></div>
</div>
```

The stacking inside the document:

| z | Element | Role |
| --- | --- | --- |
| 0 | `.ppholo` (two copies of the map) | the hologram, spanning the whole document |
| 1 | `.ppuv` | registration asterisks over the header |
| 2 | `.ppnation`, `.ppbody`, `.ppmrz`, `.ppmicro`, `.ppterrain` | the printed page, over the hologram |
| 3 | `.ppdocacts` | the two buttons |

The document keeps U.S. data-page proportions, 125 × 88 mm, at 900px and
above:

```css
.ppdoc { position: relative; max-width: 980px; margin: 0 auto 18px; display: flex; flex-direction: column;
  border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--bg2); }
@media (min-width: 900px) { .ppdoc { aspect-ratio: 125 / 88; } }
```

and it is a glass pane: `useLiquidGlass(ppRef, { id: "lg-passport",
strength: 0.5, bend: ".ppwash-under" })` — the same optics as the header,
so its four edges lens whatever is under them.

### 3.3 The security band and the nation line

The band at the top is a repeating SVG of two small crosses at 25% opacity
with a horizontal holographic sweep on top:

```css
.ppsec { height: 30px; border-bottom: 1px solid var(--line);
  background-image: url("data:image/svg+xml,…two crosses, stroke #77ffbb, opacity 0.25…"); }
.ppsec::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(150,90,255,0.14) 30%, rgba(60,220,140,0.12) 55%, rgba(70,150,255,0.12) 75%, transparent); }
.ppnation { font-family: var(--mich); font-size: 13.5px; letter-spacing: 0.34em; text-align: center;
  background: color-mix(in srgb, var(--bg3) 68%, transparent); text-shadow: var(--glow), var(--glow); }
.ppnation b { color: var(--red); text-shadow: var(--glow-r), var(--glow-r); }
```

### 3.4 The data page

`.ppid` is a `<dl>` on a three-column grid; wide fields span two or three
columns (`.sp2`, `.sp3`). Each `<dt>` carries a second-language caption in
an `<em>`, the way a real data page does:

```jsx
<div><dt>TYPE<em>/ Type</em></dt><dd>P</dd></div>
<div><dt>ACCOUNT NO<em>/ № de compte</em></dt><dd className="ppmono">{uid}</dd></div>
<div className="sp3"><dt>CLASS<em>/ Classe</em></dt><dd>{uid.startsWith("sb-") ? "AUTHENTICATED ACCOUNT" : "DEVICE IDENT"}</dd></div>
<div><dt>TASTE CLASS<em>/ Classe de goût</em></dt><dd><span className="red">*</span> {tasteClass(convictions())}</dd></div>
```

```css
.ppid { display: grid; grid-template-columns: 0.9fr 0.9fr 1.6fr; gap: 9px 20px; padding: 12px 16px; }
.ppid dt { font-size: 9px; letter-spacing: 0.16em; color: var(--grey); }
.ppid dd { margin: 3px 0 0; font-size: 13px; letter-spacing: 0.05em; color: var(--ink); }
```

The photo under UV is a duotone with a halftone scan drawn by a
pseudo-element:

```css
.ppphoto img { filter: saturate(0.55) contrast(1.12) brightness(0.96); }
.ppphoto::after { content: ""; position: absolute; inset: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--p2) 22%, transparent), color-mix(in srgb, var(--sig) 16%, transparent)),
    repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.16) 2px 3px); }
```

`convictionsOf(weights)` and `tasteClass()` derive the two taste fields from
the brain's reading (`vizState(profile).weights`, long-term × 0.6 + session
× 0.4):

```js
export function convictionsOf(weights) {
  return Object.entries(weights)
    .filter(([, w]) => Math.abs(w) > 0.01)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 10);
}
```

### 3.5 The machine zone (MRZ)

Two 52-character lines in the style of a TD3 passport, built in
`lib/passport/document.js` so the document and its preview on the profile
can never disagree. The account number is encoded for real; so are three
counters: P = pins, B = purchase tickets, A = the UTC offset.

```js
export function mrzLines({ uid, name, since, pinCount = 0, ticketCount = 0, areaCode = 0 }) {
  const mrzId = (uid || "UNISSUED").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const mrzName = (name || "UNNAMED READER").replace(/[^a-z0-9 ]/gi, "").trim().toUpperCase().replace(/ +/g, "<");
  const d = sinceDate(since);
  const sinceMrz = d ? `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}` : "000000";
  const pad3 = (n) => String(Math.min(999, Math.abs(n))).padStart(3, "0");
  const top = ("P<ASM" + mrzName + "<<FASHION<MEMBER").padEnd(52, "<").slice(0, 52);
  const bottom = (mrzId.slice(0, 9).padEnd(9, "<") + "0ASM" + sinceMrz + "0X<" +
    "P" + pad3(pinCount) + "B" + pad3(ticketCount) + "A" + pad3(areaCode) + "<<" + mrzId.slice(9, 21)).padEnd(52, "<").slice(0, 52);
  return { top, bottom };
}
```

`MrzTint` splits each line on runs of `<` so the data glows green and the
filler reads as the red thread:

```jsx
export function MrzTint({ line }) {
  return line.split(/(<+)/).map((seg, i) => seg.startsWith("<") ? <i key={i}>{seg}</i> : seg && <b key={i}>{seg}</b>);
}
```

```css
.ppmrz { font-family: var(--helv); font-size: 17px; letter-spacing: 0.46em; white-space: nowrap; overflow-x: hidden;
  border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
.ppmrz b { color: var(--sig); text-shadow: var(--glow); }
.ppmrz i { font-style: normal; color: var(--red); opacity: 0.75; text-shadow: var(--glow-r); }
```

The font size was measured, not eyeballed: the same string at 18px measured
1043px inside a 978px box and the tail of the line — the account number —
was being clipped.

### 3.6 The hologram: the map, drawn twice

`PassportSecurity.jsx` renders the street map as two stacked copies of the
same SVG, each masked differently: A is everywhere, dimmed towards the data
page, no glow; B is masked to the lower window at full opacity with heavy
glow. The printed page sits between them and the reader.

```jsx
{map && (
  <div className="ppholo" aria-hidden="true">
    <div className="ppholo-a"><ParisMap map={map} /></div>
    <div className="ppholo-b"><ParisMap map={map} hot /></div>
  </div>
)}
```

```css
.ppholo { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.ppholo-a { mask-image: linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.14) 44%, #000 68%); }
.ppholo-b { mask-image: linear-gradient(180deg, transparent 0%, transparent 52%, #000 74%); }
.pvrd-minor  { stroke: var(--sig); stroke-width: 0.55; opacity: 0.6; }
.pvrd-second { stroke: var(--sig); stroke-width: 0.9;  opacity: 0.8; }
.pvrd-major  { stroke: var(--sig); stroke-width: 1.4;  opacity: 0.95; }
.pvroads-hot { filter: drop-shadow(0 0 4px var(--sig)) drop-shadow(0 0 12px var(--sig)); }
.pvstars text { fill: var(--red); font-family: var(--helv); font-size: 15px; }
.pvstars-hot  { filter: drop-shadow(0 0 5px var(--red)) drop-shadow(0 0 13px var(--red)); }
```

The renderer is tiny. The map document holds three road tiers as SVG path
strings, the buildings as one path, and the junction stars as `[x, y]`
pairs, all already projected into a 1420 × 1000 frame:

```jsx
export default function ParisMap({ map, hot }) {
  return (
    <svg viewBox={`0 0 ${map.w} ${map.h}`} preserveAspectRatio="xMidYMid slice">
      <path className="pvbld" d={map.buildings} />
      <g className={hot ? "pvroads pvroads-hot" : "pvroads"}>
        <path className="pvrd-minor" d={map.minor} />
        <path className="pvrd-second" d={map.secondary} />
        <path className="pvrd-major" d={map.major} />
      </g>
      <g className={hot ? "pvstars pvstars-hot" : "pvstars"}>
        {map.stars.map(([x, y], i) => <text key={i} x={x} y={y + 5} textAnchor="middle">*</text>)}
      </g>
    </svg>
  );
}
```

The glow is `drop-shadow` on the GROUP, applied once per layer on the GPU —
never a canvas `shadowBlur`, which was the lag the owner saw on 9 September.

### 3.7 Where the map comes from

**Paris**, the original: `public/paris-roads.json` (843 KB), built once by
`scripts/fetch-paris-roads.py` from the Overpass API (OpenStreetMap, ODbL).
The script fetches motorway/trunk/primary roads within 31 km, secondary
within 22 km, the core streets within 4.6 km with node references, and
buildings within 1.2 km; projects every point with a simple equirectangular
projection at 15.5 m per pixel; simplifies each way with Douglas–Peucker;
and computes the junction stars as clusters (about 60 m) of nodes where
five or more road arms meet — 215 of them, l'Étoile included.

```py
CENTER = (48.8566, 2.3522); W, H = 1420, 1000; M_PER_PX = 15.5
KX = math.cos(math.radians(LAT0)) * 111320.0; KY = 110574.0
def project(lat, lon):
    return ((lon - LON0) * KX / M_PER_PX + W / 2, -(lat - LAT0) * KY / M_PER_PX + H / 2)
```

**The reader's own streets** (V.2): `lib/roads/overpass.js` is that script
ported to the server. `/api/roads?lat&lng` rounds the centre to two
decimals (about a kilometre, so nearby readers share one document), sends
ONE Overpass query around it, converts the result into exactly the Paris
shape, and caches it for a day:

```js
const q = `(way["highway"~"^(motorway|trunk|primary)$"](around:9000,${lat},${lng});` +
  `way["highway"="secondary"](around:6000,${lat},${lng});` +
  `way["highway"~"^(tertiary|unclassified|residential|living_street|pedestrian)$"](around:2600,${lat},${lng}););out geom qt;`;
```

```js
export function projector(lat0, lon0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110574;
  return (lat, lon) => [((lon - lon0) * kx) / M_PER_PX + W / 2, (-(lat - lat0) * ky) / M_PER_PX + H / 2];
}
export function convertElements(elements, centre) {
  const project = projector(centre.lat, centre.lng);
  const ways = elements.filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length > 1);
  const major = [], second = [], minor = [], use = new Map();
  for (const w of ways) {
    const hw = (w.tags && w.tags.highway) || "";
    if (WIDE.has(hw)) major.push(w.geometry); else if (hw === "secondary") second.push(w.geometry); else minor.push(w.geometry);
    for (const n of w.nodes) use.set(n, (use.get(n) || 0) + 1);        // how many ways pass through each node
  }
  // stars: nodes on three or more ways, clustered to ~60 m
  …
  const mj = pathOf(major, project, 1.6), sd = pathOf(second, project, 1.4), mn = pathOf(minor, project, 1.0);
  return { w: W, h: H, major: mj.d, secondary: sd.d, minor: mn.d, buildings: "", stars, centre, attribution: "© OpenStreetMap contributors · ODbL" };
}
```

`pathOf` clips each way to the frame, simplifies it (iterative
Douglas–Peucker with the tier's epsilon), and writes `M x y L x y L x y…`.
For Bowie, Maryland the whole document is 27 KB: 1,235 ways, 147 stars.

The client hook `useRoads(centre)` in `ParisMap.jsx` fetches that document
once per centre and falls back to Paris until a centre exists or when the
streets cannot be read; the passport passes the result to
`PassportSecurity` as `map`. The centre is the confirmed base city from
`lib/location.js`, first suggested by `/api/geo` (the edge's own
`x-vercel-ip-latitude/longitude` headers), then the browser's location,
then a picker.

### 3.8 The UV layer, the terrain window, the microprint

Over the header, fifteen registration asterisks — five-point glyphs drawn as
five arms from a centre — in three tones:

```jsx
function Ast({ x, y, s = 5, tone = "s" }) {
  const arms = [];
  for (let k = 0; k < 5; k++) {
    const a = ((-90 + k * 72) * Math.PI) / 180;
    arms.push(`M ${x} ${y} L ${(x + Math.cos(a) * s).toFixed(1)} ${(y + Math.sin(a) * s).toFixed(1)}`);
  }
  return <path className={"pvplus pv-" + tone} d={arms.join(" ")} />;
}
```

The terrain window (`.ppterrain`, `flex: 1`, min 210px) is the open area
below the MRZ where hologram copy B burns through at full strength. It only
frames the map and holds two labels: the summit annotation, which is real
state (the bearer's strongest conviction and its weight), and the ODbL
credit:

```jsx
<div className="ppterrain" aria-hidden="true">
  <span className="ppsummit">▲ {topTag ? `${Math.round(Math.abs(topWeight) * 100)} ${topTag}` : "UNCHARTED"}</span>
  <span className="pposm">{map ? "YOUR STREETS · MAP DATA © OPENSTREETMAP" : "READING YOUR STREETS…"}</span>
</div>
```

The microprint is one string repeated 24 times at 6.5px in purple, the way
security print reads at a glance and not up close:

```jsx
<div className="ppmicro" aria-hidden="true">{("*ASILUM MAGAZINE · PERSONALIZED FASHION TERMINAL · ").repeat(24)}</div>
```

### 3.9 STAMP PASSPORT: the road build

Pressing STAMP PASSPORT does not simply navigate. `roadBuilder.js` takes a
still of exactly the passport's own map (reading the rendered SVG's real
`getScreenCTM()` so the overlay lands pixel-for-pixel), then over 1.5
seconds assembles the full-viewport city around it, chunk by chunk, nearest
the document first, each fresh chunk landing as a hot solid stroke for 80 ms
before it settles into its layer — and then hands off to `/upload`, whose
background is the same map at the same scale, so the two pages read as one
surface.

```js
const DURATION = 1500, STILL_MS = 150, HOT_MS = 80, HOT_EXTRA = 0.5;
const LAYERS = {
  buildings: { width: 0.35, alpha: 0.5,  hot: false },
  minor:     { width: 0.55, alpha: 0.6,  hot: false },
  secondary: { width: 0.9,  alpha: 0.8,  hot: true },
  major:     { width: 1.4,  alpha: 0.95, hot: true },
};
```

The path strings are parsed once (`primeRoads`, cached while the reader
looks at the document) into polylines, each polyline split into runs of 3
to 9 segments, and every run becomes a timed event by its distance from the
document's box:

```js
const distToDoc = (p) => {
  const dx = Math.max(rl - p[0], 0, p[0] - rr), dy = Math.max(rt - p[1], 0, p[1] - rb);
  return Math.hypot(dx, dy);
};
events.push({ t: STILL_MS + (pts.d / maxD) * 680 + Math.random() * 180 + ROAD_DELAY[key], layer: key, pts: run });
events.sort((a, b) => a.t - b.t);
```

Drawing is one canvas per persistent layer plus one transient canvas for the
hot pulses, one batched `stroke()` per layer per frame, and NO canvas
shadows — the glow is a CSS `filter: drop-shadow` on the canvas elements,
applied by the GPU once per frame:

```js
function strokeBatch(g, list, width, alpha, color) {
  g.beginPath();
  for (const e of list) { g.moveTo(X(e.pts[0]), Y(e.pts[0])); for (let i = 1; i < e.pts.length; i++) g.lineTo(X(e.pts[i]), Y(e.pts[i])); }
  g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.globalAlpha = 1;
  list.length = 0;
}
```

Reduced motion skips the build and routes straight to `/upload`.

### 3.10 The preview on the profile

`PassportPreview.jsx` renders a miniature of the same document on the
profile's ABOUT ME. It reads the same stores (`getProfileInfo`, boards,
`/api/profile`, tickets) and calls the same `mrzLines` and
`convictionsOf`, so the two can never disagree about what the bearer's
passport says.

---

## Appendix — the tokens the three systems share

| Token | Phosphor dark | Ice light | Used by |
| --- | --- | --- | --- |
| `--bg` | `#070b10` | `#e6f4fa` | ground, panes |
| `--ink` | `#d4ffe8` | `#0c7795` | text, frame hairlines |
| `--sig` | `#46ff96` | `#0d779e` | roads, lamps, glow |
| `--red` | `#ff3838` | `#cc2219` | stars, asterisk, MRZ filler |
| `--p2` | `#b088ff` | `#805ac1` | microprint, curated edges |
| `--glow` | `0 0 7px rgba(70,255,150,0.5), 0 0 20px rgba(70,255,150,0.16)` | none | words, MRZ data |
| `--glass` | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.12)` | the pane's fill |
| `--scan` | `rgba(2,8,6,0.11)` | cyan-tinted | scanlines |
