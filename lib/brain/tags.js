// ASILUM brain — canonical aesthetic tags + affinity matrix.
// The 10 fixed tags every product and every user vector is expressed in.
export const TAGS = [
  'AVANT-GARDE', 'SEDUCTIVE', 'STATEMENT', 'TAILORED', 'ARCHIVAL',
  'MINIMAL', 'UTILITARIAN', 'STREETWEAR', 'GORP', 'INDEPENDENT',
];

// A zero vector keyed by every tag.
export function zeroVec() {
  const v = {};
  for (const t of TAGS) v[t] = 0;
  return v;
}

// TAG_AFFINITY: how strongly two aesthetics bleed into each other (0..1).
// Used for fuzzy scoring so a MINIMAL user still sees adjacent TAILORED items.
// Symmetric; self-affinity is implicitly 1.
export const TAG_AFFINITY = {
  'AVANT-GARDE': { STATEMENT: 0.7, ARCHIVAL: 0.6, INDEPENDENT: 0.5, SEDUCTIVE: 0.3 },
  'SEDUCTIVE':   { STATEMENT: 0.6, TAILORED: 0.5, 'AVANT-GARDE': 0.3 },
  'STATEMENT':   { 'AVANT-GARDE': 0.7, SEDUCTIVE: 0.6, STREETWEAR: 0.5, ARCHIVAL: 0.4 },
  'TAILORED':    { MINIMAL: 0.7, SEDUCTIVE: 0.5, ARCHIVAL: 0.4 },
  'ARCHIVAL':    { 'AVANT-GARDE': 0.6, MINIMAL: 0.5, TAILORED: 0.4, INDEPENDENT: 0.5 },
  'MINIMAL':     { TAILORED: 0.7, ARCHIVAL: 0.5, UTILITARIAN: 0.4 },
  'UTILITARIAN': { GORP: 0.7, STREETWEAR: 0.6, MINIMAL: 0.4 },
  'STREETWEAR':  { STATEMENT: 0.5, UTILITARIAN: 0.6, GORP: 0.5, INDEPENDENT: 0.4 },
  'GORP':        { UTILITARIAN: 0.7, STREETWEAR: 0.5 },
  'INDEPENDENT': { 'AVANT-GARDE': 0.5, ARCHIVAL: 0.5, STREETWEAR: 0.4 },
};

// Similarity between two tags including affinity bleed.
export function tagSim(a, b) {
  if (a === b) return 1;
  const row = TAG_AFFINITY[a];
  if (row && row[b] != null) return row[b];
  const row2 = TAG_AFFINITY[b];
  if (row2 && row2[a] != null) return row2[a];
  return 0;
}

// Expand a taste vector one hop through the affinity matrix: the aesthetics a
// user will PROBABLY like, adjacent to what they already like. Tags the user
// has already clearly rated (loved or rejected) are damped — a known taste is
// not a discovery.
export function expandTaste(taste, floor = 0.2) {
  const adj = {};
  for (const t of TAGS) {
    const tv = taste[t] || 0;
    if (tv < floor) continue;
    for (const c of TAGS) {
      if (c === t) continue;
      const a = tagSim(t, c);
      if (a > 0) adj[c] = (adj[c] || 0) + tv * a;
    }
  }
  for (const c in adj) {
    // Only damp what the user has STRONGLY demonstrated — halo residue on
    // adjacent tags must survive, or discovery collapses into 2-hop noise.
    const known = Math.abs(taste[c] || 0);
    adj[c] *= Math.max(0, 1 - Math.max(0, known - 0.45) * 1.8);
    if (adj[c] > 1) adj[c] = 1;
    if (!adj[c]) delete adj[c];
  }
  return adj;
}
