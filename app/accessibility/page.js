// app/accessibility/page.js — ACCESSIBILITY STATEMENT.
// ADA Title III alignment, WCAG 2.1 AA target. Claims here must track what
// the site actually does — known limitations are listed honestly rather
// than papered over. Version 1.0 — drafted 2026-07-19.

export const metadata = {
  title: "*ASILUM — accessibility",
  description: "ASILUM's accessibility commitment, measures, and contact.",
};

export default function AccessibilityPage() {
  return (
    <div className="wrap">
      <h1 className="headline"><span className="red">*</span>ACCESSIBILITY</h1>
      <p className="deck">
        ASILUM is for everyone. version 1.0 — july 19, 2026.
      </p>

      <h2 className="statshead">OUR COMMITMENT</h2>
      <p className="legal">
        ASILUM is committed to making asilummagazine.com accessible
        to people with disabilities, consistent with the americans with
        disabilities act (ada). our target standard is the web content
        accessibility guidelines (wcag) 2.1, level aa, and accessibility
        checks are part of our engineering release gates.
      </p>

      <h2 className="statshead">MEASURES IN PLACE</h2>
      <p className="legal">
        semantic html structure with proper headings and landmarks; a
        skip-to-content link for keyboard and screen-reader users; full
        keyboard operability of navigation and controls; visible focus;
        text alternatives on imagery, including our generated product
        placeholders; a high-contrast palette in both themes (phosphor
        greens on near-black, or dark teal on near-white, with red reserved
        for alerts and identity); motion that respects your system&apos;s
        &quot;reduce motion&quot; setting — animations, marquees, and
        tickers stop when your device asks them to; and forms with
        real labels and explicit confirmation steps for destructive actions.
      </p>

      <h2 className="statshead">KNOWN LIMITATIONS</h2>
      <p className="legal">
        we are honest about gaps while we close them: the moving ticker is
        part of ASILUM&apos;s visual identity and,
        outside reduced-motion mode, remains animated; some data-dense
        surfaces (the stats room, the stylist grid) are still being tuned for
        screen-reader flow; and third-party merchant pages we link to are
        outside our control. accessibility review is a standing item in our
        release checklist, and these gaps are on the roadmap.
      </p>

      <h2 className="statshead">COMPATIBILITY</h2>
      <p className="legal">
        the site is built to work with current versions of chrome, firefox,
        safari, and edge, and browser zoom up to 200%. voiceover is tested by
        a person; nvda and jaws are built for but not yet hand-verified —
        tell us if anything reads wrong there.
      </p>

      <h2 className="statshead">FEEDBACK</h2>
      <p className="legal">
        if any part of ASILUM is hard to use with assistive technology, tell
        us:{" "}
        <a href="mailto:legal@asilummagazine.com">legal@asilummagazine.com</a>{" "}
        with &quot;accessibility&quot; in the subject. we aim to respond
        within five business days, and reports go straight into the
        engineering queue.
      </p>
    </div>
  );
}
