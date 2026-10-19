// app/not-found.js — the 404 plate: a dead record, printed like an editorial
// page instead of an apology. Owner-directed (21 Aug), references supplied:
// the promo card's red rule + phosphor captions + glossy wordmark streak, a
// production-library sleeve's boxed red label + twin red squares, a halftone
// print portrait. Recreated in CSS on house tokens only — no copyrighted
// assets, both themes inherit through the variables.
//
// Server component on purpose: a 404 must render with nothing to fetch and
// nothing to hydrate. The one interaction — SEARCH THE TERMINAL — is a plain
// GET form into /discover?q=, which works before (and without) JavaScript.
// Next serves this for every unmatched URL and every notFound() call, with a
// real 404 status; robots noindex is belt over that suspender.

export const metadata = {
  title: "404 — RECORD NOT FOUND",
  robots: { index: false, follow: false },
};

// Rendered per request, not prerendered. A static 404 bakes the build-time
// path "/_not-found" into the shell's ROUTE readout, and every real miss then
// hydrates under its actual URL — a text mismatch React reports as error #418
// on an otherwise clean console. Dynamic rendering makes the server see the
// same pathname the client does. 404s are rare enough that the render cost is
// nothing, and the CDN caches nothing it shouldn't.
export const dynamic = "force-dynamic";

// The wayfinding row reuses the cover's subsystem vocabulary — same labels,
// same metas — so the dead end speaks the same names as the front door.
const DESTINATIONS = [
  { href: "/cover", label: "FRONT COVER", meta: "the landing edition" },
  { href: "/", label: "CATALOG", meta: "your curated edit" },
  { href: "/discover", label: "DISCOVER", meta: "the open index" },
  { href: "/hotlist", label: "THE HOTLIST", meta: "the booths and the ladder" },
];

export default function NotFound() {
  return (
    <div className="e4-plate">
      <div className="e4-rule" aria-hidden="true"><span /></div>
      <div className="e4-cap">
        <span className="e4-cap-l">PERSONALIZED FASHION TERMINAL</span>
        <span className="e4-cap-r">RETRIEVAL REPORT — PLATE 404</span>
      </div>

      <div className="e4-stage">
        <div className="e4-half" aria-hidden="true" />
        <p className="e4-margin" aria-hidden="true">FILED UNDER NOTHING — PAGE 404 OF ∞</p>
        <h1 className="e4-head">
          <span className="e4-mark">
            <span className="e4-star" aria-hidden="true">*</span>
            <span className="e4-numwrap">
              <span className="e4-ghost" aria-hidden="true">404</span>
              <span className="e4-num">404</span>
            </span>
          </span>
          <span className="e4-sub">record not found</span>
        </h1>
        <p className="e4-box">RETRIEVAL FAILED</p>
        <div className="e4-sq" aria-hidden="true"><i /><i /></div>
      </div>

      <div className="e4-mrz" aria-hidden="true">
        <div>
          <b>404</b><i>&lt;&lt;</i><b>RECORD</b><i>&lt;</i><b>NOT</b><i>&lt;</i><b>FOUND</b>
          <i>&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</i>
          <b className="e4-caret">▮</b>
        </div>
        <div>
          <b>ASILUM</b><i>&lt;&lt;</i><b>PERSONALIZED</b><i>&lt;</i><b>FASHION</b><i>&lt;</i><b>TERMINAL</b>
          <i>&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</i>
        </div>
      </div>

      <div className="e4-status">
        <p>STATUS — THE REQUESTED PLATE IS NOT IN THE ARCHIVE.</p>
        <p>RESHELVED, RENAMED, OR NEVER PRINTED. THE ASTERISK SYSTEM HAS NOTHING FILED AT THIS ADDRESS.</p>
      </div>

      <nav className="e4-ways" aria-label="Where to go instead">
        {DESTINATIONS.map((d) => (
          <a key={d.href} className="e4-dest" href={d.href}>
            <span className="e4-dest-go" aria-hidden="true">→</span>
            <b>{d.label}</b>
            <span className="e4-dest-meta">{d.meta}</span>
          </a>
        ))}
      </nav>

      <form className="e4-seek" action="/discover" method="get">
        <label htmlFor="e4-q" id="e4-q-label">SEARCH THE TERMINAL</label>
        {/* aria-labelledby repeats the htmlFor association because the a11y
            ratchet reads source statically and cannot follow htmlFor→id; both
            point at the same text, so nothing announces twice. */}
        <input
          id="e4-q"
          aria-labelledby="e4-q-label"
          name="q"
          type="search"
          placeholder="brand · piece · aesthetic"
          autoComplete="off"
        />
        <button className="btn" type="submit">GO</button>
      </form>

      <div className="e4-foot" aria-hidden="true">DISCOVERY - COMMERCE - COMMUNITY</div>
    </div>
  );
}
