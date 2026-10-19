// app/components/Icons.jsx — the control center's glyphs. One stroke
// weight, one grid, no fills: the restraint of the secondary hardware
// references (a TP-7's ●/▶/■, a HyperSat's engraved arrows) in the
// primary reference's deep-teal ink. Every glyph is decorative — the key
// that holds it carries the readable label, always (the brief: "every
// symbol that is not obvious needs a readable label").

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

const GLYPHS = {
  cover: <g {...P}><circle cx="12" cy="12" r="8.5" /><path d="M12 6.5v11M6.5 12h11M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" /></g>,
  feed: <g {...P}><rect x="4" y="4" width="6.5" height="6.5" rx="1.4" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" /></g>,
  map: <g {...P}><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></g>,
  account: <g {...P}><circle cx="12" cy="8.5" r="3.6" /><path d="M4.8 20c.9-3.9 3.7-6 7.2-6s6.3 2.1 7.2 6" /></g>,
  ledger: <g {...P}><rect x="4.5" y="4" width="15" height="16" rx="2" /><path d="M8 9h8M8 12.5h8M8 16h5" /></g>,
  heart: <g {...P}><path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" /></g>,
  search: <g {...P}><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></g>,
  messages: <g {...P}><path d="M20 4L3.5 10.6l7 2.4 2.4 7z" /><path d="M20 4l-9.5 9" /></g>,
  close: <g {...P}><path d="M6 6l12 12M18 6L6 18" /></g>,
  back: <g {...P}><path d="M14.5 5.5L8 12l6.5 6.5" /></g>,
  chevron: <g {...P}><path d="M6 9.5l6 6 6-6" /></g>,
  asterisk: <g {...P}><path d="M12 4v16M5.1 8l13.8 8M18.9 8L5.1 16" /></g>,
  stamp: <g {...P}><rect x="5" y="5" width="5.5" height="5.5" rx="1" /><rect x="13.5" y="5" width="5.5" height="5.5" rx="1" /><rect x="5" y="13.5" width="5.5" height="5.5" rx="1" /><rect x="13.5" y="13.5" width="5.5" height="5.5" rx="1" /></g>,
  link: <g {...P}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></g>,
  glasses: <g {...P}><circle cx="7.5" cy="13" r="3.5" /><circle cx="16.5" cy="13" r="3.5" /><path d="M11 13h2M4 12l2-5h2M20 12l-2-5h-2" /></g>,
  list: <g {...P}><path d="M5 7h14M5 12h14M5 17h10" /></g>,
  plus: <g {...P}><path d="M12 5v14M5 12h14" /></g>,
  minus: <g {...P}><path d="M5 12h14" /></g>,
  locate: <g {...P}><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></g>,
  bag: <g {...P}><path d="M5 8h14l-1.2 12H6.2z" /><path d="M8.8 8V6.8a3.2 3.2 0 0 1 6.4 0V8" /></g>,
  // V.2 fixtures (blueprint, 17 Oct 2026): the globe is the Passport Button,
  // the bell is NOTICES on the Info Dock, post is the center disc, disc is
  // the session dial's own glyph.
  globe: <g {...P}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" /></g>,
  bell: <g {...P}><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14z" /><path d="M10 20a2 2 0 0 0 4 0" /></g>,
  post: <g {...P}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></g>,
  disc: <g {...P}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></g>,
  // the Feed's post card and place card (owner's references, 18 Oct 2026):
  // the four outline actions — heart, the comment bubble, the hourglass
  // (STAMP, the one save) and the share arrow — the line-drawn venue mark
  // and the star the rating slot wears only when a real source fills it.
  comment: <g {...P}><path d="M5 6.5h14v9.5h-7.5L8 19.5V16H5z" /></g>,
  hourglass: <g {...P}><path d="M7 4h10M7 20h10M8 4c0 4 3.2 5.6 4 8-0.8 2.4-4 4-4 8M16 4c0 4-3.2 5.6-4 8 0.8 2.4 4 4 4 8" /></g>,
  share: <g {...P}><path d="M14 5l6 6-6 6" /><path d="M20 11H10.5A5.5 5.5 0 0 0 5 16.5V19" /></g>,
  venue: <g {...P}><path d="M4 20V11l4-3 4 3v9M12 20V8l4-3 4 3v12" /><path d="M8 8V5.5M16 5V3M4 20h16" /></g>,
  star: <g {...P}><path d="M12 3.8l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" /></g>,
};

export default function Icon({ name, size = 22, className = "" }) {
  const g = GLYPHS[name] || GLYPHS.asterisk;
  return (
    <svg className={"ic" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {g}
    </svg>
  );
}

export const ICON_NAMES = Object.freeze(Object.keys(GLYPHS));
