// lib/feed/chevrons.js — the frame of text loading in from ">>>>>>" (owner,
// 18 Oct 2026; app/components/Chevrons.jsx draws it). Pure and isomorphic.

export const CHEVRON_RUN = 6;

/** The three parts of the frame at `n` characters revealed: what is shown,
 *  the chevrons standing in for the next characters (never more than the
 *  run, never past the end), what is still to come. Together they are always
 *  exactly as long as the text, so nothing reflows as it arrives. */
export function chevronFrame(text, n, run = CHEVRON_RUN) {
  const t = String(text ?? "");
  const shown = t.slice(0, Math.max(0, Math.floor(n) || 0));
  const k = Math.max(0, Math.min(run, t.length - shown.length));
  return { shown, chevrons: ">".repeat(k), rest: t.slice(shown.length + k) };
}
