// lib/passport/evidence.js — UPLOAD EVIDENCE (V.2 Blueprint, owner, 17 Oct
// 2026, 17.2–17.5; slice 10c). PURE and client-safe.
//
//   CAPTIONS (17.2)   every upload may carry an optional, editable caption;
//                     the latest explicit caption overrides any conflicting
//                     ASTERISK assumption — for the same tag the caption's
//                     reading replaces the assumed one; uncontested
//                     assumptions stay, marked as what they are.
//   DELETION (17.4)   removing an upload removes attributable evidence and
//                     recalculates affected taste edges, preserving
//                     independently supported interests: a tag another
//                     upload still carries, or an identity anchor the
//                     passenger designated, is never touched; a tag this
//                     upload alone supported comes down by the weight it
//                     gave.
//   EQUAL WEIGHT (17.5)  every upload's tags are bounded to [0, 1]; nothing
//                     is important by default and no upload outranks another
//                     by age or order.

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** The caption's tag map ({TAG: weight}) laid over the assumed tag rows ([{tag, tag_type, confidence}]). */
export function captionOverride(assumed = [], captionTags = {}) {
  const caption = new Map(Object.entries(captionTags || {}).filter(([, w]) => clamp(w) > 0).map(([t, w]) => [String(t).toLowerCase(), clamp(w)]));
  const out = [];
  for (const row of assumed || []) {
    if (!row || !row.tag) continue;
    const key = String(row.tag).toLowerCase();
    if (row.tag_type === "caption") continue; // the previous caption's rows are replaced wholesale
    if (caption.has(key)) continue;            // the caption says otherwise for this tag
    out.push({ tag: key, tag_type: row.tag_type || "aesthetic", confidence: clamp(row.confidence) });
  }
  for (const [tag, confidence] of caption) out.push({ tag, tag_type: "caption", confidence });
  return out.slice(0, 40);
}

/** The upload's evidence as a {TAG: weight} map from its rows. */
export function evidenceOf(rows = []) {
  const out = {};
  for (const r of rows || []) if (r && r.tag) out[String(r.tag).toUpperCase()] = Math.max(out[String(r.tag).toUpperCase()] || 0, clamp(r.confidence));
  return out;
}

/**
 * The profile after one upload's evidence leaves (17.4). `profile` is
 * { long, manual }, `gone` the deleted upload's {TAG: weight}, `others` the
 * remaining uploads' maps. Returns { long, recalculated }.
 */
export function evidenceAfterDeletion(profile = {}, gone = {}, others = []) {
  const long = { ...(profile.long || {}) };
  const manual = profile.manual || {};
  const supported = new Set();
  for (const m of others || []) for (const t of Object.keys(m || {})) if (clamp(m[t]) > 0) supported.add(t.toUpperCase());
  const recalculated = [];
  for (const [t, w] of Object.entries(gone || {})) {
    const tag = t.toUpperCase();
    if (manual[tag] != null || supported.has(tag)) continue;
    if (!(tag in long)) continue;
    long[tag] = Math.max(0, Math.round((long[tag] - clamp(w)) * 1000) / 1000);
    recalculated.push(tag);
  }
  return { long, recalculated };
}
