#!/usr/bin/env node
// scripts/check-deferred-triggers.mjs
// Answers, in one command, the question two handovers have carried by hand:
// have the deferred optimisations become worth doing yet?
//
//   set -a; source .env.local; set +a
//   npm run triggers:check
//
// Keyed DB pool, PURE READS — no probes to clean.
//
// WHY THIS EXISTS. §"Deferred with a measurement, not a shrug" in the 16 August
// handover is the good kind of deferral: each item carries the number that made
// it not-worth-doing and the condition that would change the answer. What it
// did not carry is a way to CHECK those conditions. So the 17 August handover
// repeated "neither has triggered" while its own State section admitted the
// figures were "not re-measured today, carried from 16 August" — which is a
// claim about production made from a two-day-old reading. Both statements were
// true and neither was verified. That is the gap this closes.
//
// On 17 August the live answer was: largest board 6 items (unchanged), 915
// items against the 5,000 cap. Neither fired. The point is that the next
// session gets that answer in ten seconds instead of inheriting it.
//
// Exit 0 = nothing has triggered, or no database is configured.
// Exit 1 = at least one deferred item is now worth doing.

import { getPool } from "../lib/db/index.js";

// Each trigger names where its threshold came from. The distinction matters:
// an INHERITED threshold was measured and written down by the audit that
// deferred the work, and should not be moved without redoing that measurement.
// A CHOSEN one is this script's own reading of a vague condition, and is the
// one to argue with.
const TRIGGERS = [
  {
    id: "audit #13",
    what: "board-follow transfer — full copy vs tags-only",
    origin: "INHERITED",
    // 16 Aug: largest live board 6 items; 3 boards cost 26 ms full vs 22 ms
    // tags-only. The 4 ms only starts to matter once a board is large enough
    // for the copy to dominate, which "revisit when boards grow" is pointing at.
    // The threshold appears ONCE. It used to be written twice — a prose string
    // and a comparison — which is two places to change and one to forget; a
    // label reading "20" over a check testing 5 would look entirely correct.
    at: 20,
    describe: (at) => `largest board reaches ${at} items`,
    note: "the audit said only \"revisit when boards grow\", so 20 is CHOSEN — a"
      + " board over 3x today's largest. Argue with this number, not with the 4 ms.",
    async measure(pool) {
      const { rows } = await pool.query(
        `select coalesce(max(n), 0)::int as largest from (
           select count(*)::int as n from board_items group by board_id
         ) s`,
      );
      return { value: rows[0]?.largest ?? 0, unit: "items in the largest board", baseline: 6 };
    },
  },
  {
    id: "audit #16",
    what: "/api/discover sanitizing before slicing",
    origin: "INHERITED",
    // The audit priced this exactly: worth 2.8 ms today, ~15 ms at the cap,
    // against a real regression surface across every product path.
    at: 5000,
    describe: (at) => `the catalog reaches the ${at.toLocaleString()}-item listItems cap`,
    note: "the fix needs productSnapshot's field normalisation extracted and shared,"
      + " because filters run on SANITIZED values. Not a small change — that is why"
      + " it waits for the 15 ms rather than the 2.8 ms.",
    async measure(pool) {
      const { rows } = await pool.query(`select count(*)::int as n from items`);
      return { value: rows[0]?.n ?? 0, unit: "items in the catalog", showPct: true };
    },
  },
];

function pct(value, cap) {
  return cap ? ` (${Math.round((value / cap) * 100)}% of ${cap.toLocaleString()})` : "";
}

const pool = await getPool();
if (!pool) {
  console.log("no DATABASE_URL — nothing to measure.");
  console.log("  run: set -a; source .env.local; set +a");
  process.exit(0);
}

let fired = 0;
try {
  for (const t of TRIGGERS) {
    let result;
    try {
      result = await t.measure(pool);
    } catch (e) {
      // A trigger that cannot be measured must not read as a trigger that did
      // not fire. Those are different answers and only one of them is safe.
      console.log(`?? ${t.id} — COULD NOT MEASURE: ${e.message.slice(0, 80)}`);
      console.log(`   ${t.what}`);
      fired++;
      continue;
    }
    // One threshold, compared here and rendered from the same number, so the
    // label can never disagree with the comparison.
    const hasFired = result.value >= t.at;
    const share = result.showPct ? pct(result.value, t.at) : "";
    console.log(`${hasFired ? "!!" : "ok"} ${t.id} — ${result.value.toLocaleString()} ${result.unit}${share}`);
    console.log(`   ${t.what}`);
    console.log(`   trigger: ${t.describe(t.at)}${hasFired ? "  ← REACHED" : ""}`);
    if (result.baseline !== undefined && !hasFired) {
      console.log(`   baseline when deferred: ${result.baseline}`);
    }
    if (hasFired) {
      console.log(`   ${t.note}`);
      fired++;
    }
  }
} finally {
  await pool.end().catch(() => {});
}

console.log("");
if (fired === 0) {
  console.log(`nothing has triggered — all ${TRIGGERS.length} deferrals are still correctly deferred.`);
  process.exit(0);
}
console.log(`${fired} of ${TRIGGERS.length} deferred item(s) are now worth doing.`);
console.log('See §"Deferred with a measurement, not a shrug" in the 16 Aug 2026 notes (git history).');
process.exit(1);
