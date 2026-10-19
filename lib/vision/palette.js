// lib/vision/palette.js
// Palette v0 — the moodboard's first REAL sight. Pure color statistics over
// image pixels: dominant swatches, brightness/saturation, and a curated
// color→aesthetic-tag mapping in the shared tag space (lib/brain/tags.js).
// HONEST LIMITS (carried in every result's `via`): colors only — no object,
// texture, silhouette, or garment recognition; that arrives with a real
// vision provider. But color IS taste signal:
// a non-fashion image legitimately influences clothing recommendations
// through palette and mood — exactly the Alpha Brain spec.
// Pure module: no imports beyond the taxonomy; safe on client and server.

// Reference swatches for the COLORS taxonomy (lib/fashion-taxonomy).
const REF_COLORS = {
  black: [18, 18, 22], white: [245, 245, 242], grey: [128, 128, 132],
  cream: [232, 222, 200], beige: [205, 190, 160], tan: [166, 124, 82],
  brown: [92, 64, 44], navy: [28, 38, 68],
  olive: [88, 94, 58], burgundy: [92, 26, 38], red: [190, 32, 38],
  blue: [60, 90, 170], green: [52, 110, 70], pink: [228, 160, 180],
  yellow: [225, 190, 45], orange: [220, 105, 35], purple: [112, 65, 145],
  silver: [190, 192, 200], gold: [198, 160, 80],
};

// Curated color → tag/mood seeds (same spirit as lib/music-mapping tables).
// Weights deliberately conservative (max ~0.35): color is a REAL taste hint
// but a weak one, and the culturally subjective pairings (pink→SEDUCTIVE,
// black→AVANT-GARDE) are capped lower still at ~0.25 per the review of #13.
const COLOR_TAGS = {
  black:    { tags: { "AVANT-GARDE": 0.25, MINIMAL: 0.3, TAILORED: 0.2 }, moods: ["nocturnal", "severe"] },
  white:    { tags: { MINIMAL: 0.35, TAILORED: 0.2 }, moods: ["clinical", "soft"] },
  grey:     { tags: { MINIMAL: 0.3, TAILORED: 0.25, UTILITARIAN: 0.15 }, moods: ["industrial"] },
  cream:    { tags: { ARCHIVAL: 0.3, MINIMAL: 0.25, TAILORED: 0.15 }, moods: ["romantic", "soft"] },
  brown:    { tags: { ARCHIVAL: 0.3, GORP: 0.25, UTILITARIAN: 0.15 }, moods: ["raw"] },
  navy:     { tags: { TAILORED: 0.35, ARCHIVAL: 0.15, MINIMAL: 0.15 }, moods: ["polished"] },
  olive:    { tags: { GORP: 0.35, UTILITARIAN: 0.3 }, moods: ["raw"] },
  burgundy: { tags: { SEDUCTIVE: 0.3, ARCHIVAL: 0.25 }, moods: ["moody", "romantic"] },
  red:      { tags: { STATEMENT: 0.35, SEDUCTIVE: 0.2 }, moods: ["playful"] },
  blue:     { tags: { STREETWEAR: 0.25, UTILITARIAN: 0.2, MINIMAL: 0.15 }, moods: [] },
  green:    { tags: { GORP: 0.3, UTILITARIAN: 0.15, INDEPENDENT: 0.15 }, moods: [] },
  pink:     { tags: { SEDUCTIVE: 0.25, STATEMENT: 0.25 }, moods: ["playful", "romantic"] },
  silver:   { tags: { "AVANT-GARDE": 0.3, STATEMENT: 0.2, MINIMAL: 0.15 }, moods: ["industrial", "ethereal"] },
  gold:     { tags: { STATEMENT: 0.3, SEDUCTIVE: 0.2, ARCHIVAL: 0.15 }, moods: ["polished"] },
};

const hex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

/** The nearest named colour to an RGB triple, by squared Euclidean distance.
 *  Always returns a name — there is no "no match", because every pixel is some
 *  colour. Approximate by design: this feeds colour EVIDENCE, which is
 *  corroborated across several images before anything is claimed. */
export function nearestColor(rgb) {
  let best = "grey", bestD = Infinity;
  for (const [name, ref] of Object.entries(REF_COLORS)) {
    const d = (rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2 + (rgb[2] - ref[2]) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

// Dominant swatches from a flat RGBA pixel array (canvas getImageData.data).
// 4-bit-per-channel quantization → top-k bins by coverage, averaged back to
// true colors. Transparent pixels are skipped.
export function dominantPalette(rgba, k = 5) {
  const bins = new Map(); // key -> { n, r, g, b }
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2];
    bins.set(key, b);
  }
  const total = [...bins.values()].reduce((s, b) => s + b.n, 0);
  if (!total) return [];
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, k)
    .map((b) => {
      const rgb = [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)];
      return { rgb, hex: hex(rgb), name: nearestColor(rgb), weight: +(b.n / total).toFixed(4) };
    });
}

// Composition statistics (asterisk-boost r1, palette v0.5): REAL math over
// the sampled pixel grid — luminance contrast, edge density (mean absolute
// neighbor gradient), and hue spread (circular variance of chromatic hues).
// Needs the sample width to see the grid as 2D; returns null without it.
// These are texture-LEVEL statistics — still no object, silhouette, or
// garment recognition (that stays a gated lib/vision contract).
export function compositionStats(rgba, width) {
  const w = width | 0;
  const n = Math.floor(rgba.length / 4);
  const h = w > 0 ? Math.floor(n / w) : 0;
  if (w < 2 || h < 2) return null;
  const L = new Float32Array(w * h);
  const hues = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
      L[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d > 0.06 && mx > 0.12) {
        let hd;
        if (mx === r) hd = ((g - b) / d + 6) % 6;
        else if (mx === g) hd = (b - r) / d + 2;
        else hd = (r - g) / d + 4;
        hues.push(hd * 60);
      }
    }
  }
  let mean = 0;
  for (let i = 0; i < w * h; i++) mean += L[i];
  mean /= w * h;
  let variance = 0;
  for (let i = 0; i < w * h; i++) variance += (L[i] - mean) ** 2;
  const contrast = Math.sqrt(variance / (w * h));
  let e = 0, ec = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) { e += Math.abs(L[y * w + x + 1] - L[y * w + x]); ec++; }
      if (y + 1 < h) { e += Math.abs(L[(y + 1) * w + x] - L[y * w + x]); ec++; }
    }
  }
  const edges = ec ? e / ec : 0;
  let hueSpread = 0;
  if (hues.length >= 8) {
    let sx = 0, sy = 0;
    for (const hd of hues) {
      sx += Math.cos((hd * Math.PI) / 180);
      sy += Math.sin((hd * Math.PI) / 180);
    }
    hueSpread = 1 - Math.hypot(sx, sy) / hues.length; // 0 tonal → 1 scattered
  }
  return {
    contrast: +contrast.toFixed(3),
    edges: +edges.toFixed(3),
    hueSpread: +hueSpread.toFixed(3),
    chromatic: +(hues.length / (w * h)).toFixed(3),
  };
}

// Composition → conservative tag hints. Thresholds are editorial judgements
// over the 48px sampling grid; every weight is capped BELOW the color caps
// (≤0.2) because texture statistics are weaker evidence than color.
function compositionTags(comp) {
  const tags = {};
  const words = [];
  if (!comp) return { tags, words };
  const busy = comp.edges > 0.09;
  const flat = comp.edges < 0.03 && comp.contrast < 0.12;
  if (busy) {
    tags.STATEMENT = 0.15;
    tags.STREETWEAR = 0.1;
    words.push("graphic");
  } else if (flat) {
    tags.MINIMAL = 0.15;
    words.push("clean");
  }
  if (comp.contrast > 0.3) {
    tags.STATEMENT = Math.max(tags.STATEMENT || 0, 0.1);
    tags["AVANT-GARDE"] = 0.08;
  }
  if (comp.hueSpread > 0.55 && comp.chromatic > 0.25) {
    tags.STATEMENT = Math.max(tags.STATEMENT || 0, 0.12);
    tags.INDEPENDENT = 0.08;
  } else if (comp.hueSpread < 0.15 && comp.chromatic > 0.15) {
    tags.MINIMAL = Math.max(tags.MINIMAL || 0, 0.12);
    tags.TAILORED = 0.08;
    words.push("tonal");
  }
  if (comp.chromatic < 0.05) words.push("monochrome");
  return { tags, words };
}

// Full v0 analysis: swatches, luminance/saturation stats, aggregated tag
// weights in the shared space, mood words, and lexicon-trainable words.
// Pass the sampling width to unlock composition statistics (v0.5).
export function analyzePalette(rgba, k = 5, width = 0) {
  const palette = dominantPalette(rgba, k);
  if (!palette.length) return null;

  let lum = 0, sat = 0;
  for (const s of palette) {
    const [r, g, b] = s.rgb.map((c) => c / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum += s.weight * (0.2126 * r + 0.7152 * g + 0.0722 * b);
    sat += s.weight * (mx === 0 ? 0 : (mx - mn) / mx);
  }
  const wTotal = palette.reduce((s, p) => s + p.weight, 0) || 1;
  const stats = { brightness: +(lum / wTotal).toFixed(3), saturation: +(sat / wTotal).toFixed(3) };

  const tags = {};
  const moods = new Set();
  for (const s of palette) {
    const m = COLOR_TAGS[s.name];
    if (!m) continue;
    for (const [t, w] of Object.entries(m.tags)) tags[t] = +((tags[t] || 0) + w * s.weight).toFixed(3);
    if (s.weight >= 0.12) for (const mood of m.moods) moods.add(mood);
  }
  if (stats.brightness < 0.25) moods.add("nocturnal");
  if (stats.saturation < 0.12) moods.add("muted");

  // v0.5: composition statistics when the caller tells us the grid width.
  const comp = width >= 2 ? compositionStats(rgba, width) : null;
  const compRead = compositionTags(comp);
  for (const [t, w] of Object.entries(compRead.tags)) {
    tags[t] = +((tags[t] || 0) + w).toFixed(3);
  }
  if (comp) stats.composition = comp;

  // Words the live lexicon can train on: tag names + dominant color names
  // + decisive composition words (all present in lib/brain/lexicon).
  const words = [
    ...Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([t]) => t.toLowerCase().replace(/-/g, " ")),
    ...palette.slice(0, 3).map((s) => s.name),
    ...compRead.words,
  ];

  return {
    palette: palette.map(({ hex: h, name, weight }) => ({ hex: h, name, weight })),
    stats, tags, moods: [...moods], words,
    via: comp
      ? "palette v0.5 — color + composition statistics (contrast/edges/hue spread); no object or garment recognition"
      : "palette v0 — color statistics only; no object/texture/silhouette recognition",
  };
}

// SERVER-SIDE derivation from untrusted client swatches ({hex, weight} only —
// names and tag weights are NEVER accepted from the wire). Validation is
// atomic: any malformed entry, non-positive/overweight value, or total > 1.02
// rejects the whole payload (returns null → caller 400s). Canonical color
// names and shared-TAGS weights are recomputed here from the hex values.
export function paletteFromSwatches(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) return null;
  const palette = [];
  let total = 0;
  for (const s of input) {
    if (!s || typeof s !== "object") return null;
    const h = String(s.hex || "");
    if (!/^#[0-9a-f]{6}$/i.test(h)) return null;
    if (typeof s.weight !== "number" || !Number.isFinite(s.weight) || s.weight <= 0 || s.weight > 1) return null;
    const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    total += s.weight;
    palette.push({ hex: h.toLowerCase(), name: nearestColor(rgb), weight: +s.weight.toFixed(4) });
  }
  if (total > 1.02) return null;
  const tags = {};
  for (const s of palette) {
    const m = COLOR_TAGS[s.name];
    if (!m) continue;
    for (const [t, w] of Object.entries(m.tags)) tags[t] = +((tags[t] || 0) + w * s.weight).toFixed(3);
  }
  return { palette, tags };
}

// Merge several analyses (one per uploaded image) into one swatch list and
// one aggregated tag map — weights averaged across images.
export function mergePalettes(analyses = []) {
  const n = analyses.length;
  if (!n) return { palette: [], tags: {} };
  const byName = new Map();
  const tags = {};
  for (const a of analyses) {
    for (const s of a.palette) {
      const cur = byName.get(s.name) || { hex: s.hex, name: s.name, weight: 0 };
      cur.weight += s.weight / n;
      byName.set(s.name, cur);
    }
    for (const [t, w] of Object.entries(a.tags)) tags[t] = +((tags[t] || 0) + w / n).toFixed(3);
  }
  const palette = [...byName.values()]
    .map((s) => ({ ...s, weight: +s.weight.toFixed(4) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);
  return { palette, tags };
}
