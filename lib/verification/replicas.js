// lib/verification/replicas.js — THE REPLICA LIBRARY'S READER (V.2 Blueprint,
// "Hard gates against authenticating replicas"; slice 5). Pure.
//
// "ASTERISK keeps a pattern library of known replicas per house and model.
// One replica signal sets the item to Unverified regardless of other
// evidence and raises a fraud flag. Every replica an admin confirms is added
// to the library." The library is the admins' rows (lib/db/production/
// asterisk.js replica_patterns) and nothing else: it ships EMPTY, because a
// counterfeit signal nobody confirmed would be a guess dressed as a gate.
//
// A pattern is a plain phrase matched case-insensitively as a whole word
// sequence in the listing's words (title, description, alt) for a listing
// of that house. No regex from the operator: a phrase is what an admin
// confirmed, and a phrase cannot blow up the matcher.

const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The signals the library raises on one listing: [] when none. */
export function replicaSignals(item = {}, patterns = []) {
  const house = fold(item.brand);
  if (!house) return [];
  const words = " " + fold([item.title, item.description, item.alt].filter(Boolean).join(" ")) + " ";
  const out = [];
  for (const p of Array.isArray(patterns) ? patterns : []) {
    if (!p || fold(p.house) !== house) continue;
    const phrase = fold(p.pattern);
    if (!phrase) continue;
    if (words.includes(" " + phrase + " ")) out.push({ house: p.house, pattern: p.pattern, confirmedBy: p.confirmedBy || null, id: p.id || null });
  }
  return out;
}

/** The AI check a replica signal forces: a fail with the signal named. */
export function replicaCheck(signals = []) {
  if (!signals.length) return null;
  return {
    status: "fail", confidence: 1, model: "replica-library", version: "library",
    detail: `replica signal: ${signals.map((s) => `"${s.pattern}" (${s.house})`).join(", ")} — Unverified regardless of other evidence; fraud flag raised`,
    fraud: true,
  };
}
