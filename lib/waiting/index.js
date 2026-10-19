// lib/waiting/index.js — WHAT A PERSON IS WAITING FOR, and noticing when it
// arrives.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// The competitor's version is a Discord you join and a webhook that pings you.
// That is a NOTIFICATION PRODUCT: the person configures an alert, names a
// brand, sets a price ceiling, and maintains it forever.
//
// ASILUM already knows. A person searched for something and got nothing back —
// we logged it, with the query and the date. That is not an inference about
// their taste, it is a RECORD OF THEM ASKING. When inventory arrives that
// answers the question, the terminal says so.
//
// No alert to configure. No brand list to maintain. No channel to join.
// docs/INVISIBLE-MACHINERY.md.
//
// ── WHY AN EMPTY SEARCH IS THE ONLY HONEST SIGNAL ───────────────────────────
//
// ASTERISK may only reason from what it can point at (docs/README.md §0).
// Consider the alternatives and why each is a guess:
//
//   a taste profile   says what you tend to like, NOT that you wanted a
//                     specific thing and could not have it
//   board saves       are things you found. A want is a thing you did not
//   dwell time        is attention, which is not desire
//
// An empty search is different in kind: the person typed the words, we
// answered "nothing", and both halves are in the log. When we can finally
// answer, telling them is not marketing — it is closing a loop they opened.
//
// ── AND IT IS THEIR OWN RECORD ──────────────────────────────────────────────
//
// First-party throughout. One person's searches, read to serve that same
// person, already visible to them in the §6 export, never aggregated across
// readers. The privacy-respecting version is also the only one with evidence
// behind it — which keeps being true and is worth noticing.

import { listEmptySearches } from "../db/production.js";
import { searchProducts } from "../search/index.js";

/** A want older than this is probably a mood that passed. */
const WANT_WINDOW_DAYS = 120;

/**
 * What this person asked for and did not get.
 *
 * Returns `[{ query, at, asked }]`, most recent first. `asked` is how many
 * times they tried — a question asked three times is a want; asked once, it
 * may have been idle curiosity, and the caller can weigh that.
 *
 * Never throws: waiting is an extra on top of surfaces that must work anyway.
 */
export async function wantsFor(userId, { sinceDays = WANT_WINDOW_DAYS, limit = 40 } = {}) {
  if (!userId) return [];
  try {
    return await listEmptySearches(userId, { sinceDays, limit });
  } catch {
    return [];
  }
}

/**
 * Which pieces answer that want — by ASKING THE SEARCH AGAIN.
 *
 * Not a similarity score, not a re-implementation: the literal question is
 * put to the literal engine, and "answered" means THE SEARCH THAT RETURNED
 * NOTHING WOULD NOW RETURN SOMETHING. Nothing else is a defensible definition,
 * because the want was recorded precisely when that search served zero.
 *
 * THE FIRST VERSION OF THIS WAS WRONG and the numbers said so. It ranked the
 * pool by hand and kept anything scoring above a floor, which returned 170
 * "answers" for "black wool coat" — every one of them a `category browse`
 * fallback, none of them a match, and the top result a varsity jacket. The
 * real engine serves ZERO for that query. A hand-rolled matcher drifts from
 * search, and then a person is told their want was answered by a piece the
 * search page refuses to show them.
 *
 * `log: false` because replaying somebody's old query is not somebody
 * searching — see the option in lib/search/index.js.
 *
 * Returns [] on any failure. A weak match is worse than silence: it teaches a
 * person to ignore the thing.
 */
export async function answeredBy(want, { limit = 4 } = {}) {
  if (!want?.query) return [];
  try {
    const served = await searchProducts(want.query, { limit, log: false });
    // `results`, not `items`. Reading the wrong key here made every want look
    // unanswered — silent for the wrong reason, and indistinguishable from
    // working. A feature whose failure mode is silence needs a positive test,
    // which tests/waiting.test.js now has.
    return served?.results || [];
  } catch {
    return [];
  }
}

/**
 * Everything now answerable for one person: `[{ want, items }]`.
 *
 * ONLY WANTS WITH ANSWERS APPEAR. A want with nothing against it is omitted
 * entirely rather than returned empty — the caller must never be able to
 * render "still nothing for: rick owens ring boots", which would be a
 * notification about our own failure and the empty state the third law
 * forbids.
 */
export async function whatArrived(userId, { max = 6 } = {}) {
  const wants = await wantsFor(userId);
  if (!wants.length) return [];
  const out = [];
  for (const want of wants) {
    const items = await answeredBy(want);
    if (items.length) out.push({ want, items });
    if (out.length >= max) break;
  }
  return out;
}

// ---- delivery -------------------------------------------------------------
//
// The engine above is the product; a channel is where it comes out. They are
// separated so that adding Discord, or email, or a push, is registering an
// adapter — not rebuilding what "waiting" means.
//
// THE OWNER ASKED FOR DISCORD, and it belongs here as ONE CHANNEL rather than
// as the product. The objection recorded in the roadmap was to Discord being
// the destination a person has to go to; as an output among others it is
// ordinary, and it is declared below.

/**
 * Where an answered want can be delivered.
 *
 * `send: null` is DECLARED BUT UNBUILT — reported honestly, and the extension
 * point. Adding one is writing one function; the engine does not change.
 */
export const CHANNELS = [
  {
    id: "on-platform",
    needs: null,
    // BUILT. The default and the one that needs no permission, no address and
    // no third party: it is already their feed. See app/page.js.
    built: true,
  },
  {
    id: "weekly-digest",
    needs: "SENDGRID_API_KEY and a verified sender — lib/notify.js",
    // The competitor sends 50 finds every Sunday whether or not anything
    // happened. This sends what ARRIVED, and if nothing arrived IT DOES NOT
    // SEND — a weekly mail saying "nothing this week" is the empty state that
    // gives the whole trick away.
    built: false,
  },
  {
    id: "discord",
    needs: "a per-reader webhook URL they supply, and a rate ceiling",
    // Owner request. One channel among others, never the destination.
    // A webhook URL is a secret that grants posting to someone's server, so it
    // is stored per reader and never shared or logged.
    built: false,
  },
  {
    id: "push",
    needs: "a web-push subscription and a VAPID key pair",
    built: false,
  },
];

/** Which channels can actually deliver today, and what the others await. */
export function channelStatus() {
  return CHANNELS.map(({ id, built, needs }) => ({ id, built, needs: built ? null : needs }));
}
