// app/components/Wordmark.jsx — THE WORDMARK. It left the shell's header
// when the header left (V.2 Blueprint, owner, 17 Oct 2026: the top fixtures
// are the Info Dock and the Passport Button, nothing else) and lives on as
// the mark the Feed's masthead prints.
//
// THE NAME IS "*ASILUM" (owner, 17 Oct 2026: "when they type it in I just
// want it to look like *ASILUM"; "no more lower case i"). The MAGAZINE and
// FASHION TERMINAL lines of the August lockup are retired with the word:
// the asterisk and the six capitals are the whole mark, everywhere —
// browser tab, social card, order mail, this component.
// tests/brand-name.test.js enforces it.

export default function Wordmark({ href = "/" }) {
  return (
    <a className="wordmark" href={href} title="the feed" aria-label="*ASILUM — the feed">
      <i>*</i>ASILUM
    </a>
  );
}
