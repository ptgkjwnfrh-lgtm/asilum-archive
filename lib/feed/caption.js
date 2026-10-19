// lib/feed/caption.js — the on-media caption's ink (V.2 Blueprint, owner,
// 17 Oct 2026: "caption text flips between black, gray and white to stay
// legible"). Pure: a relative luminance in 0–1 goes in, one of three inks
// comes out. The component measures the lower third of the photograph,
// where the caption sits, and the scrim under the caption keeps the
// middle band readable either way.

export const INKS = Object.freeze(["black", "gray", "white"]);

/** Bright media takes black ink; dark media takes white; the middle takes
 *  gray on the scrim. Thresholds sit so the three bands are stable to a
 *  small change in the measured value. */
export function captionInk(luma) {
  const l = Number(luma);
  if (!Number.isFinite(l)) return "white";
  if (l >= 0.72) return "black";
  if (l >= 0.42) return "gray";
  return "white";
}
