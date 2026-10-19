// lib/site.js — THE canonical origin, in one place.
//
// Why this file exists (owner ruling 7, 17 August). The origin was hardcoded in
// nine places: app/layout.js twice, four segment layouts, app/sitemap.js,
// app/robots.js and app/piece/[id]/page.js. Ruling 7 asks whether ASILUM is the
// apex or `www`, and while that was pending, "settling it" meant a nine-file
// sweep in which one missed file is an inconsistent canonical — the exact drift
// the ruling is about. It is one constant now, so the ruling is one line.
//
// WHAT IS ALREADY DECIDED, and it was decided in code rather than written down:
// every canonical, the sitemap, robots.txt, metadataBase, and the permanent
// redirect in next.config.mjs all say `www`, and that redirect's own comment
// states the principle — "One canonical host." So the code half of ruling 7 has
// an answer and this file records it.
//
// WHAT IS STILL OPEN and cannot be closed from here: Supabase's **Site URL** is
// the apex (`https://asilummagazine.com`), and that is a dashboard field. It is
// what `{{ .SiteURL }}` resolves to in every auth email. Both origins are
// allow-listed so nothing is broken. To finish ruling 7 the owner changes that
// one field to match this constant — or, if they'd rather ASILUM be the apex,
// they change SITE_ORIGIN here instead and the whole app follows, including the
// redirect below, which then needs its direction reversed.
//
// Deliberately NOT read from NEXT_PUBLIC_*: a canonical URL that varies per
// deployment is how two hosts end up claiming the same page. SITE_ORIGIN is an
// override for a fork or a staging domain, not a per-environment knob, and it is
// server-side only — nothing here reaches the browser bundle.

// THE NEXT ORIGIN (owner, 17 Oct 2026): www.asilum.com, once the owner has
// bought the domain and attached it to the Vercel project. The switch is
// SITE_ORIGIN=https://www.asilum.com in the deployment's environment (or
// this default, in one commit, with tests/seo.test.js and
// tests/canonical-host.test.js following); REDIRECT_HOSTS below already
// names the asilummagazine hosts, so the moment SITE_HOST changes they hand
// their traffic to the new one. Nothing here flips before the DNS is live.
// No trailing slash, ever: every caller appends a path beginning with "/".
export const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://www.asilummagazine.com")
  .replace(/\/+$/, "");

export const SITE_HOST = new URL(SITE_ORIGIN).host;

// Hosts that serve an identical copy of the site and must hand their traffic to
// SITE_HOST. Both are real: `asilum.vercel.app` is Vercel's production alias,
// and the apex is a live A record (76.76.21.21) pointing at the same project, so
// each was serving a fully indexable duplicate whose canonicals named www.
//
// SITE_HOST IS NEVER IN THIS LIST — a host redirecting to itself is an infinite
// loop that takes the whole site down, so the filter below is load-bearing and
// tests/canonical-host.test.js pins it. Preview deployments (`asilum-git-*`,
// per-PR URLs) are deliberately absent: Vercel already noindexes them and they
// must stay reachable for review.
export const REDIRECT_HOSTS = [
  "asilum.vercel.app",
  "asilummagazine.com",
  "www.asilummagazine.com",
].filter((host) => host !== SITE_HOST);

// Absolute URL for a path. Takes "/" and "/discover" alike, and refuses to
// build the "https://host//path" that a naive concatenation produces.
export function siteUrl(path = "/") {
  const p = String(path || "/");
  return SITE_ORIGIN + (p.startsWith("/") ? p : "/" + p);
}
