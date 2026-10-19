// app/opengraph-image.js — the social card, GENERATED, not committed.
//
// V.2 (owner's blueprint, 17 Oct 2026): the card follows the new look. No
// terminal grid, no phosphor bloom, no floating frames — the ground is the
// dark theme's black, the accent block is the phosphorus green, the wordmark
// is Michroma, "magazine.com" and the demo line are Inter. Everything below
// this paragraph about the 17 August comp is the history of the layout,
// which is kept; only the materials changed.
//
// Rebuilt 17 August against the owner's reference comp. What that comp asked
// for and what shipped:
//   terminal grid + phosphor bloom      -> SVG data-URI grid + radial --sig glow
//   red block and rule across the top   -> kept, --red
//   kicker over the wordmark            -> "PERSONALIZED FASHION TERMINAL"
//   chrome *ASILUM, glowing red asterisk-> gradient clipped to text, --red glow
//   green glowing "magazine.com"        -> --sig in Inter (V.2), tracked, no glow
//   three-word strip                    -> DISCOVERY · COMMERCE · COMMUNITY
//   the demo line                       -> kept verbatim
//
// TWO DELIBERATE DEPARTURES FROM THE COMP, both worth saying out loud:
//   1. The comp reads "COMMERECE". Shipping a misspelling into every link
//      preview is not a design choice, so it is COMMERCE here.
//   2. The comp's chrome is a silver-blue, and its "magazine.com" is a plain
//      grotesque. Neither exists in this palette or this type stack, and
//      asilum-ui rule 2/3 is explicit: no further accent colours, ever, and
//      colours only through tokens. So the chrome is built from --ink and
//      --grey — the same metallic banding read in the phosphor palette — and
//      "magazine.com" is set in STM, the main font. It was VT323 for one day —
//      the site's old OSD face — until the owner retired that face entirely
//      ("get rid of the digi cam font"). The comp's INTENT is matched with the
//      house's own materials rather than importing new ones.
//
// THE NAME IS "*ASILUM" — the word magazine is retired (owner, 17 Oct 2026;
// directive, 17 August). It was being dropped in fourteen metadata strings —
// title template, siteName, og/twitter titles — while the shell wordmark had it
// right all along. tests/brand-name.test.js is that rule, executable.
//
// WHY A GENERATED ROUTE RATHER THAN A COMMITTED PNG. A binary in the repo is a
// second copy of the design language that nothing keeps in step — the palette
// moved twice in two days for contrast (#218/#219 --red, #216 --sig) and a PNG
// would have kept the old colours silently. tests/opengraph-image.test.js reads
// app/globals.css and fails if the card and the stylesheet disagree.
//
// TYPE: Satori reads TTF/OTF/WOFF but NOT WOFF2, and public/fonts shipped only
// WOFF2. Both faces are SIL OFL and Google publishes TTFs, so the TTFs sit
// beside the WOFF2s with their licences. The WOFF2s stay — the browser loads
// those. Hierarchy is read off globals.css, not invented:
//   Michroma  --mich  .headline/.wordmark/.snav/.mq  -> kicker, wordmark, strip
//   STM       --helv  the body voice, and now the ONLY other face
//                      -> "magazine.com" and the demo line
// No fontWeight anywhere: each face ships ONE weight, and asking for 700 makes
// Satori synthesise something the site never shows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Read at module scope: /opengraph-image prerenders as a STATIC route (○ in the
// build output), so this happens at build time and there is no serverless
// file-tracing question to get wrong.
const FONT_DIR = join(process.cwd(), "public", "fonts");
const MICHROMA = readFileSync(join(FONT_DIR, "michroma.ttf"));
const INTER = readFileSync(join(FONT_DIR, "inter.ttf"));

export const alt =
  "*ASILUM — personalized fashion terminal. Native Storefronts and a labeled demo archive.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Literal token values, because Satori resolves no CSS variables and reads no
// stylesheet. asilum-ui rule 3 says colours only through tokens; this is the
// closest a build-time image can get, so THESE ARE ASSERTED AGAINST
// app/globals.css BY TEST. Do not edit one without the other, and do not "tidy"
// them into a shared object the test cannot read.
const BG = "#070b0c";    // --bg
const INK = "#e8eff1";   // --ink
const RED = "#8cf0a6";   // --red (the accent: phosphorus green in the dark theme)
const SIG = "#6e9cff";   // --sig
const GREY = "#8a9ba3";  // --grey
const FAINT = "#2a3a41"; // --faint

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: BG,
          fontFamily: "Inter",
        }}
      >
        {/* V.2: one flat ground. The grid, the bloom and the frames of the
            phosphor card are retired with the CRT language. */}
        {/* --- the card --- */}
        <div
          style={{
            position: "relative", width: "100%", height: "100%",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            padding: "56px 72px 60px",
          }}
        >
          {/* red block + rule, straight from the comp */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 118, height: 14, background: RED }} />
              <div style={{ display: "flex", flex: 1, height: 2, background: RED, opacity: 0.85 }} />
            </div>
            <div style={{ display: "flex", marginTop: 26, fontFamily: "Michroma", fontSize: 25, letterSpacing: 9, color: GREY }}>
              PERSONALIZED FASHION TERMINAL
            </div>
          </div>

          {/* The wordmark. The asterisk sits LEFT of the word and is --red with a
              glow — that placement is the identity on every headline. ASILUM is
              chrome: a gradient clipped to the glyphs, banded --ink -> --grey so
              the metallic read comes out of the palette, not out of a new one. */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: -18 }}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <div
                style={{
                  display: "flex", fontFamily: "Michroma", fontSize: 112, lineHeight: 1,
                  color: RED,
                }}
              >
                *
              </div>
              <div
                style={{
                  display: "flex", fontFamily: "Michroma", fontSize: 112, lineHeight: 1, letterSpacing: 8,
                  backgroundImage: `linear-gradient(180deg, ${INK} 0%, ${GREY} 42%, ${INK} 54%, ${GREY} 100%)`,
                  backgroundClip: "text", color: "transparent",
                }}
              >
                ASILUM
              </div>
            </div>
            {/* magazine.com — never dropped (owner directive). In Inter, the
                body face (V.2); --sig, tracked like the .wordmark em line it
                stands in for. No glow: the blueprint has none. */}
            <div
              style={{
                display: "flex", justifyContent: "flex-end", width: 830, marginTop: -14,
                fontFamily: "Inter", fontSize: 62, letterSpacing: 2, color: SIG,
              }}
            >
              asilum.com
            </div>
          </div>

          {/* the strip, then the honest line the catalog banner also carries */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: "Michroma", fontSize: 27, letterSpacing: 6, color: GREY }}>
              DISCOVERY · COMMERCE · COMMUNITY
            </div>
            <div style={{ display: "flex", height: 1, marginTop: 22, background: FAINT, opacity: 0.7 }} />
            <div style={{ display: "flex", marginTop: 18, fontSize: 22, letterSpacing: 3, color: GREY }}>
              NATIVE STOREFRONTS + LABELED DEMO ARCHIVE
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Michroma", data: MICHROMA, style: "normal", weight: 400 },
        { name: "Inter", data: INTER, style: "normal", weight: 400 },
      ],
    }
  );
}
