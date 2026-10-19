// app/title-card/page.js — the magazine's title card (owner-directed, 21 Aug;
// revised same day: "make it appear more like the 404 screen"). The card now
// speaks the 404 plate's exact language — red rule and block, the caption
// pair, halftone print field, clean metal wordmark, twin red squares, machine
// zone, translucent status band, centered house line — and the glitch lives
// in ONE place, by owner order: the drifting motion-blur shadow behind the
// wordmark. The face never glitches; the shadow drifts and, in short bursts,
// tears into displaced slices of house red and phosphor.
//
// A brand artifact, not a destination: noindex + self-canonical but CRAWLABLE
// (the /piece precedent — a social scraper must be able to fetch a card whose
// whole job is being shown around). Not in the sitemap, not in the nav.
// Server component: nothing to fetch, nothing to hydrate; the motion is CSS
// and stops under prefers-reduced-motion (the shadow stays, still).
//
// The wordmark is written in pieces (star element + ASILUM + the address
// line), the og-image's own pattern; the h1's aria-label reads the full name
// as one string, and every visual layer under it is aria-hidden so a screen
// reader hears the name once, unglitched. Plate classes (e4-*) are shared
// with the 404 on purpose — the owner asked for the same screen language,
// and one vocabulary beats two copies drifting apart.

export const metadata = {
  title: "TITLE CARD",
  robots: { index: false, follow: false },
  alternates: { canonical: "/title-card" },
};

export default function TitleCardPage() {
  return (
    <div className="tc-plate">
      <div className="tc-frame">
        <div className="e4-rule" aria-hidden="true"><span /></div>
        <div className="e4-cap">
          <span className="e4-cap-l">PERSONALIZED FASHION TERMINAL</span>
          <span className="e4-cap-r">TITLE CARD</span>
        </div>

        <div className="tc-stage">
          <div className="e4-half" aria-hidden="true" />
          <h1 className="tc-word" aria-label="*ASILUM — personalized fashion terminal">
            <span className="tc-mark" aria-hidden="true">
              <span className="tc-star">*</span>
              <span className="tc-wrap">
                <span className="tc-streak">ASILUM</span>
                <span className="tc-burst tc-burst-p">ASILUM</span>
                <span className="tc-burst tc-burst-g">ASILUM</span>
                <span className="tc-face">ASILUM</span>
              </span>
            </span>
            <span className="tc-mag" aria-hidden="true">asilum.com</span>
          </h1>
          <div className="e4-sq" aria-hidden="true"><i /><i /></div>
        </div>

        <div className="e4-mrz" aria-hidden="true">
          <div>
            <b>TITLE</b><i>&lt;</i><b>CARD</b><i>&lt;&lt;</i><b>ASILUM</b>
            <i>&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</i>
            <b className="e4-caret">▮</b>
          </div>
          <div>
            <b>PERSONALIZED</b><i>&lt;</i><b>FASHION</b><i>&lt;</i><b>TERMINAL</b>
            <i>&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</i>
          </div>
        </div>

        <div className="e4-status">
          <p>A DEMO ARCHIVE OF SYNTHETIC SAMPLE RECORDS</p>
        </div>

        <div className="e4-foot" aria-hidden="true">DISCOVERY - COMMERCE - COMMUNITY</div>
      </div>
    </div>
  );
}
