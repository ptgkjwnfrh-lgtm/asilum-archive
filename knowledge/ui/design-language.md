# Design language — V.2 (owner's blueprint, 17 October 2026)

> **This section supersedes everything below it where they differ.** The
> rest of this file is the July–September record, kept for the reasoning
> behind rules that survived; the V.2 slices (`docs/v2/slice-*.md`) and
> `docs/engineering/ui.md` are the current law.

- **No header.** Three fixtures: the Info Dock (top left: LIKES · BAG ·
  NOTICES), the Passport Button (top right: the globe) and the Central
  Control Deck (bottom: FEED · SEARCH · POST disc · MESSAGES · ACCOUNT).
  The wordmark lives on the Feed's masthead; the house lines run in the
  deck's ad strip.
- **Palette.** Light: white paper, `#1d5fd6` blue ink, teal `--sig` for
  links, a green-teal `--red` accent. Dark: `#070b0c` paper, `#6e9cff`
  links, `#8cf0a6` accent. Token NAMES are unchanged so the rules keep
  working; the values are the blueprint's. No CRT: scanline, grid, glow
  and wash tokens are neutral. Theme follows the device unless pinned.
- **Type.** Michroma (`--mich`) for labels, keys and headings; Inter
  (`--helv`) for reading. Share Tech Mono is retired.
- **Rainbow Liquid Glass, restrained.** A one-pixel conic rim on the
  fixtures (`--iris`); reduced-transparency drops the blur.
- **Popups, sessions, the Disc, haptics:** `knowledge/ui/interaction.md`.
- **What is gone** (and must stay gone — `tests/v2-shell.test.js`): the
  top header and its ticker, the destination row, the ORB HUB / MODULE
  RAIL interfaces (`data-model`), the account / bag / search panels, the
  CRT chrome (`.os-crt`, `.os-blob`, `.os-plus`, `.os-frame`,
  `.os-status`), the thumb bar.

---

# Design language — Fashion Intelligence OS

ASILUM is not an e-commerce site, a Pinterest clone, or a SaaS dashboard.
It is a **fashion intelligence operating system**: an alternate 1998–2005
future where OS, instrument, passport, and magazine evolved together. The
user navigates a living archive; the interface visibly studies them back.

Reference constellation (interaction principles, never assets): Winamp,
IBM AudioStation, early Xbox dashboard, PS2-era system software, Resident
Evil status screens, passports/visa security printing, GPS/military
navigation, medical monitors, ambient-electronica sleeve design (Aphex
Twin, Gen X Soft Club), early-2000s video tooling. Gen X Soft Club softens
the machine: curves, haze, milky glass — atmosphere over nostalgia.

## Law
- Information density over whitespace; dividers, labels, metadata,
  timestamps ARE the decoration. Every character of text is a real datum.
- RED (--red) is the only accent voice: activity, alert, recording,
  selection, the ASTERISK identity. No second accent, ever.
- Palettes (tokens in globals.css): phosphor dark NATIVE (blacks, phosphor
  greens, purple, red) / ice light (near-white, BLUE ink, teal, red).
  Legacy token names (--ink/--paper/--line/--grey/--faint) carry OS values.
  Owner order, 8 Sep 2026: on ice the ink is a blue (#1c3fae, 7.5:1) that
  GLOWS (--glow-ink), and every control that fills with the ink carries the
  same glow around the fill (--glow-box-ink; `none` on phosphor). The hazes
  gained a little colour: dark breathes fuchsia with softer purples and
  blues, ice carries faded pinks and yellows (blobs + --backlight).
- Layered depth: backlight → grid → haze blobs → content → glow →
  scanline glass. Subtlety threshold: never reduce readability. Scan lines
  ship at 0.315 (30% under the August 0.45 — owner order, 8 Sep).
- Seven destinations in a row directly under the top ticker (owner order,
  Aug 12 2026 — the left sidebar is GONE; header strip is thick enough that
  the wordmark keeps full size): FRONT COVER, CATALOG, THE WIRE (renamed
  from EDITORIAL by owner decree, Aug 13), PASSPORT, DISCOVER, PROFILE,
  SETTINGS. New features must answer "which subsystem do I belong to?" —
  the destination list only changes by owner decree.
- Header (`.tophead` in shell.js): thbar (wordmark + ticker + big
  SEARCH/BAG/SIGN-IN with symbols on search and bag) over the destination
  row (ASTERISK drawer trigger, seven buttons, compact dock). The pane is
  LIQUID GLASS (owner order, 8 Sep, "exactly like Apple's"; fifth pass):
  a clean STRIP across the whole top — flush, square, no float, no radius
  (the owner: "not a bubble at all"); 62px bar + 46px destination row + 6
  = --head-h 114px (was 64 + 48 + a 10px float = 128, then 98, then 106
  — taller twice on the owner's word; the header's words are bolder by a
  0.4px text-stroke on the Michroma labels, 0.3 on the ticker, weight 800
  on the big buttons, 600 on the meta — Michroma has one weight; the divider and the
  buttons moved up, the whole header smaller; the os-frame ornament now
  starts below it). A near-clear pane (--glass, 0.03 dark / 0.12 ice)
  over a CRYSTAL-CLEAR centre (no blur at all — the owner found any frost "oddly cloudy"; the
  backdrop is only saturated 160%) and a REFRACTING BEZEL — in Chromium the backdrop passes through an
  SVG filter (#lg-refract, shell.js) fed by TWO pictures drawn from the
  pane's own size and corner radius (rounded-rect distance, Apple's
  squircle bezel profile, Snell's law at n=1.5): a displacement map (R = x,
  G = y, blue held at 128) and a separate GREYSCALE weight picture saying
  how much of each pixel is bezel. Two, because Chromium colour-manages a
  feImage into the display's space and on a P3 screen (128,128,0) reads
  back with blue near 0.2 — a weight in one colour channel leaked a ghost
  of the sharp lens through the whole frosted middle; greys survive. The
  outer 56px of every OPEN edge bends what scrolls beneath it (an edge
  flush with the viewport has nothing beyond it and does not lens — for
  the strip only the bottom edge does), each colour a little differently
  (R/G/B displaced at 80/86/92 — the fringe on Apple's edges, "slightly
  more rainbow" on the owner's word; 24px at 50/56/62 then 44 at 58/64/70
  were both "too subtle", a 16-wide spread at 56 was too much, 4 a hint).
  The lens chain is CONFINED to the bottom band (restrictLens; primitive
  subregions in the strip's own pixels) and has no blur, so the clear
  middle costs nothing on a scroll frame. WHERE THE ENGINE CANNOT BEND A
  BACKDROP — Safari, or a Chromium without GPU compositing: the owner's
  recording of 8 Sep showed the cover letters passing under the strip
  untouched and the whole page lagging — the PAGE BENDS INSTEAD
  (createPageBend, LiquidGlass.jsx): what passes under the strip's bottom
  edge (cards, cover letters, headlines, rows) takes the strip's map in
  its own coordinates, re-placed every scroll frame, removed when it
  leaves. Found by SAMPLING the band with elementsFromPoint every 40px,
  each hit resolved to the OUTERMOST match of the selector, and nothing
  over 1600px on a side ever filtered — the first cut matched `.grid > *`,
  i.e. the catalog's 9,000px columns, and re-filtered four of them plus
  the cards inside every scroll frame: the "glitching and bugging" of 8
  Sep. Both paths now hold 16.7ms a frame in Chrome. `?lgpage=1` or `<html data-lg-page="1">` forces
  that path in any engine — proven in Chrome: the FRONT COVER letters bend
  and fringe under the strip with no backdrop filter at all, blended with the untouched backdrop by plain arithmetic (lens ×
  w + clear × (1 − w)), never an alpha mask; other engines get the
  saturation alone, no bezel. The edge is UNSEEN (the owner: "I shouldn't
  be able to see the bezel, it should still cause the distortion"): no
  lip, no band — a whisper of light on the bottom edge (Fresnel, 0.05)
  and a 7px edge zone (::after, blurred) that only REFLECTS what is near
  it: the white of the pointer and the colour of the lit word's lamp. The
  GLOSS is ever so slight and real (--glass-sheen): a thin specular along
  the top where the sheet meets the light, one soft diagonal reflection
  band (a window in the glass), a faint Fresnel at the bottom — never a
  wash. The words float and their glow is a LIGHT UNDER
  THE WATER: .glass-light, a sibling beneath the pane kept to its rect,
  carries lamps that are each three lights (a small near-white core, the
  coloured halo, a wide faint spill — a glow stick in water, never a flat
  blob; the layer blurs itself 14px since the clear pane no longer
  diffuses it; every cursor-driven light was DILUTED to roughly a third
  on the owner's word, 8 Sep: "there's simply too much"): the current destination's (--cx/--cy/--cs), the hovered word's
  gliding between words (--lx/--ly/--ls; the wordmark's lamp is red) and
  the pointer's trace (--gx/--gy/--gs); the pane blurs and bends them.
  These properties are registered (so they transition) AND inherited —
  a pseudo-element reads a custom property only when it is declared to
  inherit, and the pane's ::before/::after need them. The pointer's shine
  on the glass is a tight specular core (96×36, set 6px up-left of the
  cursor, towards the light) inside a faint wide sheen; both fade on leave
  (--gs). THE MENISCUS (owner order, 8 Sep: "the words refracting on the
  liquid surface when I hover — an extremely subtle detail"): the hovered
  word is seen through a shallow dome the cursor pulls in the surface
  (#lg-ripple, shell.js; Chromium only, like the bezel). Rays through a
  dome bend towards its centre, so the map pulls each sample towards the
  middle linearly (a spherical cap's slope grows with radius), eased to
  nothing at the rim; R/G/B pulled 3.2/3.7/4.2px at full strength (2.0 was
  invisible, 5.0 obvious) so the glyph edges disperse a hair. The dome is
  a 64px picture drawn once, placed in the word's own user space by
  feImage x/y and trailing the pointer with lag; the pull ramps in on
  enter and dies down on leave (data-ripple comes off at the end), all
  from one rAF loop that stops when settled. Flat 128 grey outside the
  dome (feFlood) — colour management leaves greys alone. The pane deepens
  once the page scrolls under it (data-glass="deep"). Reduced motion keeps
  pane, lamps and refraction, drops the glide, the pointer shine and the
  meniscus. THE ITEM DETAIL IS THE SAME GLASS (owner, 8 Sep): `.modal.lg`
  — a 22px-radius pane over the dimmed page, all four edges lensing
  (LiquidGlass.jsx, its own filter #lg-item, at 0.5 of the header's pull —
  the owner asked for 0.15, then saw "no rainbow warp at all"; 0.5 is the
  first setting that reads), the same gloss; the pane does not scroll,
  `.mscroll` does inside it. THE LEGIBILITY TRICK (owner, 8 Sep): the page
  is lowered ONLY where the popup takes up space — the scrim is clear and
  sharp (`.overlay:has(> .modal.lg)`), the pane carries the darkening
  (75%, both themes; the owner's 40% left the catalog's words as bright as
  the record's own — illegible in the recording), the picture stands on
  paper. WHERE THERE IS NO BACKDROP
  REFRACTION (Safari — WebKit never runs an SVG filter as a
  backdrop-filter) the page itself bends: every `.card`/`.cvlook`/
  `.mrelitem` lying under the pane's edge gets its own SVG filter with
  the pane's map placed in that element's coordinates over a flat 128
  grey (`bend` in useLiquidGlass; re-placed on scroll; removed on close).
  Bounded to the elements the edge crosses, each filtered within its own
  box. `<html data-lg-page="1">` forces that path in any engine so it can
  be judged on a desktop — proven in Chrome: at 6× the card text under the
  edge shreds into colour bands, at 0.15 it carried a fringe too faint to
  be seen as one; 0.5 reads. (Found on the way: `.ctr >
  *` had been turning every overlay rendered in the centred column
  relative, so the item detail opened inline wherever the page was
  scrolled — an overlay is fixed now wherever it is rendered.) Tap the
  photograph and it FLOATS (FloatView.jsx, the owner's Spotify reference):
  black space, the picture as a rounded card that tilts with the phone —
  the pose you opened it in is flat, and the card stays put in the world
  as the phone moves — or with the cursor where there is no gyroscope; a
  shadow sliding the other way, a glare crossing its face, a halo of its
  own colour behind. iOS asks before sharing motion and only inside the
  tap, so `askTilt` runs in the click that opens it. Reduced motion: the
  card, still. Theme toggle
  lives in SETTINGS only; the default follows the device preference
  (prefers-color-scheme) until the owner pins a theme.
- Aug 12 reference language (owner pictures: Gen X Soft Club, Aphex SAW
  poster, ambient-era CD print, State 3.0 stills): really THIN lines that
  are NOT uniform as put-together excess detail; text allowed to float in
  space; small white outline squares/hairlines slightly bordering the page
  (`.os-frame`). Background grid: big cells, very transparent lines.
- Aug 12 round 2 (owner pictures: Rag & Bone Denim '23 campaign, Helmut
  Lang ad archive): BOLD FLOATING TEXT — oversized stacked headline blocks
  sitting directly on the page ground; GREATLY limit bubbles — content
  floats, borders are the exception not the default; UNORTHODOX image
  placement — overlaps, off-grid collage, film-strip thumbnail columns,
  type crossing images. NO rotated/slanted images (owner ban, Aug 12);
  outfit strips may be uniform and organized.
- Aug 13 round 3 (owner pictures: State 3.0 stills, Warp/Red Snapper
  track-credit sleeve, LTJ Bukem Progression Sessions ad, Rag & Bone
  again — "this is supposed to feel like a magazine"):
  - THICK FLOATING FRAMES (`.tdrf` + variants): heavy rectangles
    (5–9px, `--ink`) floating over an outfit grouping to frame a
    HIGHLIGHT piece plus some empty air; they may overlap each other
    (State 3.0's double frame) and overlap neighbouring pieces. A frame
    marks a TRUE highlight only — the strip's lead piece on the cover,
    the anchor piece or an owned wardrobe piece in the stylist.
  - HAIRLINE FIELD (`.cvlines`): hand-placed horizontal AND vertical
    contrast lines behind the content (owner order, Aug 13 — diagonals
    were tried the same day and swapped for verticals; nothing in the
    field takes an angle, and images still never rotate) — a few thick
    (3–6px), most 1px; a few visible (0.12–0.30 opacity), most barely
    there (0.04–0.10). Deterministic (no render-time random),
    pointer-events none, always behind content, never reducing
    readability.
  - MAGAZINE MARGINALIA: small side text everywhere a magazine would
    carry it — gutter verticals, Warp-style credit stacks (micro label
    over value: `.cclbl`/`.ccval`), ledger folios, a bottom colophon.
    EVERY value printed is real state (system ledger counters, item
    ids, feed ranks, source labels) — marginalia is never lorem, never
    invented.
  - DENSITY OVER UNIFORMITY: the front cover is FULL — contact-sheet
    film strip beside the hero (next real feed picks), staggered column
    baselines that deliberately do not align, one pull-quote-scale
    transmission on the wire, non-uniform heavy-bar pairs opening
    sections. Follow floating text (no borders, no bubbles) harder,
    not less.
- Clickable words are painted the logo gradient's teal (--sig) with a glow
  and a slight horizontal motion blur — never black/ink (owner: "it's
  ugly"). Red-law elements (buy/home/reset) keep red with the same
  treatment. One grouped rule at the end of globals.css.
- CATALOG (/) lands straight on clothing (owner order, Aug 12; the POST
  sub-page folded into THE WIRE by the Aug 13 overhaul): floating mode
  row (curated/following/new), one collapsed CURRENT CRAVING line,
  filters, masonry immediately. The page carries the magazine furniture
  (owner order, Aug 13) at ZERO height cost — the pieces keep the
  floor: a hairline field pinned to the first stretch, a live folio
  beside the headline (date + pieces-this-pass), and gutter verticals
  printing the pass's real zone composition and the Asterisk state. The
  old header cubes (live observation, who to follow, the slide), the
  morse strip, and the synthetic post tiles are gone from the page.
- THE WIRE (/hotlist; owner overhaul Aug 13, renamed from EDITORIAL) is
  where ALL user posts live, and where the hotlist stands.
  - THE POSTING LAW (owner order, Aug 13): three ways to post —
    TRANSMISSIONS (text ≤5000 chars; the caption IS the header, ≤200,
    stored as the post's title), IMAGES (up to SIX in one carousel,
    caption allowed), VIDEO (one, capped 3:00, caption allowed). Images
    and video wait on the real media pipeline (storage/moderation/
    playback) and are honest coming-soon modes until it exists — no
    fake uploads, ever. The composer's three modes state the caps.
  - THE HOTLIST LAW (owner order, Aug 13): the hotlist is TEN BOOTH
    SLOTS held for independent Shopify-based brands. A PASSPORT account
    becomes a BUSINESS account by verifying itself, connecting its
    Shopify, and connecting its personal website; ONLY business
    accounts get a chance at a booth. The old engagement-ranking rows
    are retired from this surface.
  - THE UPGRADE PROCESS (built Aug 13, same day): live end to end. A
    signed-in account applies on PROFILE → ACCOUNT (brand name +
    your-shop.myshopify.com + https website + statement); the
    submission opens a REAL brand_cases verification case (Feature G
    machinery — enforced status machine, https evidence, append-only
    events, no machine path to business) and a HUMAN decides it via
    the admin desk (area=business, business.approve / business.reject
    — a rejection carries a note the applicant reads). Account state
    lives in business_accounts (schema v26); booths fill in
    verification order (first verified, first booth), holders show
    brand + external site link (quiet voice, outside the teal rule),
    open slots stay honestly OPEN, and every count (folio, gutter,
    colophon, cover mirror) is the live roster. The Shopify OAuth
    token exchange is the ONE part still gated on the commerce
    pipeline's keys — today the storefront domain is reviewed
    evidence, and every surface says so.
  - THE IDENTITY CHAIN (owner order, Aug 13): every byline is a link —
    your own to /profile, anyone else's to /u/[handle]; a server post's
    timestamp is its permalink (/hotlist?post=<id> pins the single
    transmission with a back link; device-only copies get no permalink
    until the server holds them). /u/[handle] resolves on server truth:
    published ROOM → the room + their transmissions; no room but posts →
    an honest reader page ("hasn't published a room"); neither → NOT
    FOUND. The profile's POSTS tab reads the identity's durable server
    posts (?mine=1, filtered by author_id server-side, never exposed)
    merged with device copies the server doesn't show yet — labeled
    "pending or held", never dressed as published.
  - THE TRANSMISSION LIFECYCLE (owner directive, Aug 14 — backlog 1 of
    14 Aug 2026): the author — and only the author, verified
    server-side and bound in the WHERE clause — may EDIT or DELETE
    their transmission from the floor. The controls are tiny wire
    furniture (.wctl, in the teal rule) shown only on posts the
    ?mine=1 server truth claims — never on the local text-match
    heuristic, which stays what it was: the "you" chip. DELETE is a
    two-tap: the armed state reads SURE? DELETE and swaps the whole
    signal to red (.wctl.warn — never red text in a teal blur). EDIT
    opens the composer's own fields inline (.wedit, prefilled; the
    fields ARE the transmission — saving writes exactly what they
    hold, an emptied caption clears the caption). An edited
    transmission carries "· edited <age>" (.wedited, quiet grey — an
    honesty label, not a control) on every surface that prints a
    byline: floor, permalink focus, profile POSTS, /u/[handle].
    Deletion is SOFT server-side (moderation_status='deleted', the row
    survives as record) and the permalink answers HTTP 404 with the
    honest absent message from that moment. Edits re-run the same
    sanitize + screen as fresh posts — a flagged edit parks the
    transmission under review and says so in the same words.
  - WIRE ENGAGEMENT — LIKES + SAVES (owner directive, Aug 14 — backlog 2
    of 14 Aug 2026): two counters per transmission, and both
    count PEOPLE, not events. The ledger's key is (post, person, kind),
    so pressing LIKE in a loop or from ten tabs moves the counter once;
    only another human moves it again (the v22/v23 anti-manipulation
    law). Counts are computed on read from that ledger — there is no
    denormalized counter that could drift from its evidence, which is
    the fabricated number the constitution forbids. A transmission
    nobody has touched prints NO number at all (the word LIKE alone,
    never "LIKE 0"), and an unreachable server shows no counts rather
    than zeros. Resting state rides the teal clickable rule (.weng);
    the engaged state is the full red signal, the house's "this is
    yours" voice. Buttons are their own class — .wact belongs to the
    WARDROBE tab and must not be borrowed. Engagement is refused on any
    transmission the wire will not show (retired, held, absent), with
    the same 404 the lifecycle verbs answer — it never reveals whether
    a hidden transmission exists.
  - HASHTAGS + @MENTIONS (owner directive, Aug 14 — backlog 3 of
    14 Aug 2026): every surface that prints a transmission
    renders it through ONE component (TransmissionText), so a tag
    behaves the same on the floor, the permalink, the cover wire, the
    profile's POSTS tab and /u/[handle]. Parsing happens AFTER the
    sanitizer (never before — the sanitizer rewrites the string, so
    offsets taken from raw text land in the wrong places) and only
    SPLITS it: concatenating the rendered segments reproduces the
    stored text exactly, because a renderer that drops a character is
    rewriting someone's transmission. #tag hands off to search
    (/discover?q=, lowercased) and keeps the author's capitalization on
    screen; @mention lands on /u/<handle>, which answers NOT FOUND
    honestly when nobody holds it. A ref must sit at a word boundary
    (C#, emails and url anchors are never refs) and a mention is linked
    only if the handle COULD exist — RESERVED_HANDLES stay plain text,
    since linking one promises a page that can never load. Refs are
    clickable words in running text: the teal rule and nothing else —
    no chips, no boxes, no weight change. Extracted hashtags are stored
    on the row (tags jsonb) and RE-extracted on edit, so a deleted tag
    really leaves; mentions are not stored, because nothing reads them
    yet. NOTE: the handle vocabulary lives in lib/profile/handles.js —
    rooms.js reaches the database, so a client import of it ships `pg`
    to the browser and fails the build.
- THE DESK (/admin — owner directive, Aug 14, backlog 4 of
  14 Aug 2026) is the operator surface for /api/admin, which had
  been complete for weeks with no way to reach it (a business
  application could only be decided with curl). It wears the SETTINGS
  RACK's own vocabulary — .rkmod/.rkhead/.rkrow/.rkled, numbered
  modules, engraved labels — reused rather than reinvented; only the
  panel switcher (.desknav) and the wider inputs are new. Four panels:
  01 BOOTH APPLICATIONS (approve/reject; a rejection cannot be sent
  without the note the applicant reads), 02 MODERATION QUEUE (resolve /
  dismiss, recorded under the server-configured operator name), 03 BRAND
  CASES (read-only — the ledger moves through its own enforced
  transitions), 04 SUBSTRATE (row counts + every gated source naming the
  exact env vars it waits on). GATE: ADMIN_TOKEN is pasted at the desk
  and held in sessionStorage ONLY — never localStorage, never a cookie,
  never the URL; it dies with the tab and LOCK DESK clears it now. The
  permission model is unchanged: the server decides every request, a bad
  token relocks the desk, and an unset ADMIN_TOKEN leaves it dark and
  says so. /admin is disallowed in robots.js (keep that list in step).
  - THE FOR-YOU HUB (owner, 9 Sep evening: "the same format as twitter —
    videos, pictures and transmissions all live in one hub, and the
    hotlist lives in a liquid glass strip to the side"): the masthead reads
    THE WIRE / FOR YOU; under the deck a two-column layout. THE FEED (left,
    up to 760px): the permalink focus and the composer as glass panes
    (GlassPane.jsx), then every post as a CARD — avatar · handle · time
    (the permalink) · the caption header · the text · the action row
    (LIKE / SAVE, EDIT / DELETE for the author). The cards are the
    header's pill glass, NOT refracting panes: sixty lensing panes in one
    column would be a scroll cost. Pictures and video take the same card
    the day the media pipeline lands; the composer's IMAGES / VIDEO modes
    stay honestly coming-soon. THE RAIL (right, 300–380px): THE HOTLIST's
    ten booths in their own glass pane (compact rows, the same links and
    the same booth-visit attribution, the APPLY line), then WHO TO FOLLOW
    (pane), ASILUM MAGAZINE (pane), AD SPACE (two dashed slots stacked),
    THE READING ROOM (quietest, no pane), REPORT AN IMPERSONATION (pane).
    Under 960px the rail stacks beneath the feed. The old page order —
    masthead + live folio → composer → the floor → WHO TO FOLLOW → THE
    HOTLIST → ASILUM MAGAZINE → AD SPACE → EXTERNAL DISPATCHES — survives
    as the reading order of feed-then-rail.
    The graded descent by TYPE SCALE survives (.elmast masthead;
    .elh2 21px → .elh5 9.5px grey), as does the magazine furniture at
    zero height cost (field, folio, gutters, colophon of live
    counters).
- PROFILE is standard social format (owner order, Aug 12: Grailed ×
  Twitter × MySpace, legibility first), REBUILT IN LIQUID GLASS on 9 Sep
  (owner: "the account page looks a little empty — instagram mixed with
  myspace mixed with grailed"; every pane is GlassPane.jsx, the shared
  `.lgpane` recipe of the passport's pane): the IDENTITY PANE (Instagram —
  banner, the avatar over its edge, name in Michroma / handle / bio, the
  counts as big numbers: posts / following / brands, FOLLOWERS "—" because
  nothing measures it) → a two-column layout: THE RAIL (MySpace — ONE pane,
  01 ABOUT ME: the bio, THE PASSPORT IN PREVIEW, then handle / member since
  / pieces in the closet / a room link. The owner cut the TOP HOUSES,
  PEOPLE and FIT ON FILE panes the same evening: "remove the left side bars
  and just leave the about me, and in the about me there should be a
  preview of the user's passport". The preview is PassportPreview.jsx — a
  miniature of the /board document in the document's own classes (strip,
  nation line, photo, the data page's key fields, the machine zone, the
  Paris hologram beneath) drawn from the SAME real state, the strings built
  by lib/passport/document.js for both surfaces so they can never disagree;
  one link to /board) and THE SHEET — ONE tab row (Michroma
  words, the current one red) over a glass pane holding everything: POSTS
  as a square grid (a server post's square is its permalink; a device-only
  copy is labeled pending or held) / CLOSET (Grailed — the bag's history as
  a grid of pieces with picture, title, house and source, the colour /
  origin / fit lines, price; the ORDERS link below) / BRANDS / WARDROBE /
  ROOM (the MySpace personality editor) / SIZING / ACCOUNT (sign-in,
  connections, follows, people search; /profile#access opens it). Controls
  inside a pane are the header's pill glass.
- SETTINGS is the rack (owner order, Aug 12: old music-making software):
  numbered hardware modules — 01 APPEARANCE / 02 ASTERISK / 03 IDENTITY /
  04 DATA / 05 LEGAL — heavy top rule + hairline channel rows, engraved
  Michroma labels, OSD module numbers, decorative screws, and LEDs that
  reflect ONLY real state (guidance, observation). ASTERISK's controls
  (guidance toggle, observation, model reset, dashboard + control-room
  links) live on module 02; identity still has one home on PROFILE and
  module 03 just points there.
- Feed cards are Grailed-cut: square floating images (no border, no card
  box, no hover bubble; radius 0 unless the owner tunes --ed-img-rad),
  tile aspects vary per item over the shared 8-ratio table in
  lib/client.js (aspectFor — the ONE aspect source for every grid). The
  red reach frame and ◉ INSPECT badge survive.
- Two user-switchable interfaces (Settings → Appearance, localStorage
  asilum-model): 01 MODULE RAIL (instrument stack) / 02 ORB HUB (pill nav,
  softer surfaces, [data-model="02"] variants — rebased onto the top-nav
  shell). Structure changes; palette follows the theme system.

## Passport UV page (redesign/passport-uv, owner inspo: Swiss passport under UV)
The PASSPORT document on /board renders as a page under blacklight —
`app/components/PassportSecurity.jsx` + the `.ppuv/.ppterrain/.pv*` layer in
globals.css. Header: registration crosses, plus-pattern ridge, "01" numeral
(hidden ≤760px), nation line "ASILUM MAGAZINE * FASHION PASSPORT" (doubled glow), trilingual
type "PASSPORT · パスポート · PASSEPORT" above the photo, *ASILUM microprint.
Hologram (owner iteration 5): REAL PARIS — actual OpenStreetMap road
geometry rendered full-bleed across the document. Data pipeline:
scripts/fetch-paris-roads.py → public/paris-roads.json (~525 KiB; © OSM
contributors ODbL — credit rendered in the map window). Layers: major
roads 14 km radius, secondary 14 km, full street core 4.6 km, building
footprints 1.2 km as very thin NON-glowing outlines. Every road traced as
a line; NO street names. 215 red text-style asterisks mark intersections
where >= 5 road arms genuinely meet, computed from the road graph
(junction clustering collapses roundabout plazas like l'Étoile to one
star). Two masked copies (.ppholo): over the data page glow-FREE at ~0.13
opacity; the lower window full opacity + heavy glow. Document proportions
lock to a U.S. passport data page (aspect 125/88 ≥900px): photo 148×186
centred on the left edge under a four-language stack (PASSPORT /
パスポート / REISEPASS / PASSEPORT), three-column field grid; the MRZ sits ON THE DIVIDER between the data page and the map window (dashed above+below, 21px OSD, letter-spacing stretched to span the full width) and encodes REAL counters: P### pins linked (items across the bearer's boards), B### purchases raised (tickets), A### device area code in time (UTC offset minutes), plus the account number. Microprint at the very bottom edge. Registration marks on the top strip are six-armed asterisks (same placements as the old pluses); no page numeral. Re-run the fetch script to refresh the
map; the component only reads the JSON. Data page is U.S.-style and REAL only: username from
the bearer's profile, TASTE CLASS = ASTERISK's one-word read of the
conviction weights (lib/brain/taste-class.js — 12 classes: DARK, STREET,
ACTIVE, PREPPY, PROFESSIONAL, MINIMALIST, ROMANTIC, AVANT, ARCHIVIST,
UNDERGROUND, TECHNICAL, OPULENT; UNCLASSIFIED when no signal), SEX X (never collected — never invent), COUNTRY OF
ORIGIN = device locale region, MEMBER SINCE stamped once locally
(asilum-member-since, local-time anchored), ACCOUNT NO = the database uid,
which the TD3 machine zone also encodes (document + personal number
fields); summit marker = top conviction. MRZ data runs glow green,
chevron filler red; MRZ scrollbar hidden but scrollable.

## UPLOAD — teach Asterisk (redesign/upload-station)
/upload is the passport's training annex, riding under PASSPORT in the nav
(sub-link UPLOAD ⇪). Reached from the document itself: the UPLOAD TO
MOODBOARD button at the passport's foot warps the live Paris hologram out
of the page (.ppwarp clones the .ppholo-b SVG and expands it from the
terrain rect to the full viewport, 600ms, reduced-motion skips straight to
navigation) (1s, soft settle) before routing — and /upload KEEPS that map as its
page background (.gxmap via shared app/components/ParisMap.jsx, which
PassportSecurity also imports), so the hand-off reads as one continuous
surface. The page is the OS's one Gen X Soft Club surface (design law:
curves, haze, milky glass) — .gx-scoped only, the instrument skin
elsewhere untouched. The warp starts as an EXACT overlay of the
document's own map (same box, same scale), grows the frame to the
viewport while a base veil + the landing gradient fade in and the map
settles to 0.5 opacity — pixel-continuous at BOTH ends; heavy glow
filters are suspended during motion for cleanliness. Layout: do-column + watching rail. Main column: 01 THE WALL —
a Pinterest-style moodboard (drop pieces/fit pics/vibe images → on-device
tiles in localStorage asilum-upload-board, palette v0 + filename-word
training per batch) / 02 YOUR PEOPLE & PLACES — favorite celebrities,
cities, movies, singers (localStorage asilum-favorites; every name is a
real mood_board_uploads record; singers hit the curated music map and
train on descriptors WITH a told readback; unmapped names are honestly
"on your record") / 03 DESIGNERS & LEANINGS — designer input uses the
real brand path (search match → follow via setFollowBrand → train on the
brand's dominant tags, same as DISCOVER) plus lean-toward style words and
the ten canonical chips. ASTERISK LIVES ONLY HERE (owner decree July 27): the passport page
carries NO asterisk instrumentation — no analysis bus, no guidance
toggle, no brain band; /board keeps the document + STAMP THE PASSPORT
composer (which now hosts the floating plug-in pills:
Pinterest/Spotify/Apple Music/Letterboxd, .soon-skinned honest
coming-soon controls with a gentle idle float) + the moodboard viewer. The sticky right rail is ASTERISK's home on the page: the living dock form (shared
app/components/AsteriskDock.jsx, extracted from the shell; upload cycles
LISTENING/LEARNING/…) above the BrainViz word-sphere, the live conviction readback, the
session heard-log, RECENTLY FORGOTTEN, and the two-step Reset Brain
(full-amnesia) control — all relocated from /board. All signals are real training; nothing simulated.

**THE STATION IN LIQUID GLASS (owner order, 9 Sep 2026).** /upload speaks
the FRONT COVER's language now: a bold Michroma masthead (`*UPLOAD` /
`STATION`, `--ed-fs-gxmast`) with the cover's right-hand meta block and a
ledger line whose counts are the device's real state (pins, names, houses
followed, cities bought from); a hairline field behind the content
(.gxlines, hand-placed, deterministic); numbered kickers (a big faint
numeral + a Michroma kicker + a note); Warp-sleeve credit stacks through the
shared .cclbl/.ccval; gutter marginalia on the rail; a colophon. A STATION
INDEX under the masthead — four pills of the header's glass — jumps to the
sections (01 THE WALL / 02 PEOPLE & PLACES / 03 DESIGNERS & LEANINGS /
04 THE GLOBE). Every card is the passport's pane (`.gxcard.lg`, one
`useLiquidGlass` per card at strength 0.5, its own filter id): no border,
55% tint, the edges lensing in Chromium, the gloss and the pointer's shine;
the inputs, buttons and chips are the header's pill glass rather than
filled boxes. No page-side bend on these cards: what lies under them is the
fixed Paris map, and filtering a viewport-sized SVG per card per frame is
the glitch of trap 151 — Safari gets the pane without the bend.
THE ASTERISK DOCK IS GONE FROM THE RAIL. In its place THE PURCHASE GLOBE
(app/components/PurchaseGlobe.jsx): a wireframe earth as A HOLOGRAM OF
GLOWING LINES (9 Sep, later the same day — the owner: "get rid of the ASCII
structure … a Star Wars hologram made of glowing lines"; the first cut was
a cage of `- / | \` glyph chains after the Codec's GPS globe) — latitude
rings every 22.5° and twelve meridians as stroked polylines, each a pale
hot core (--ink) inside a soft bloom of the signal colour (three stroke
passes per depth bucket, no canvas shadowBlur — trap 158), the far
hemisphere dimmed to a see-through cage, a faint rim, a faint polar axis,
the Codec's centre reticle drawn as a ring and a pointer — under the
projector's treatment: a flutter, a slow band of light rolling down the
picture (source-atop, so it lights only the lines), the odd horizontal tear
where two or three slices slip sideways for a few frames with a brightness
dropout, and the dock's scanline banding. Markers are drawn discs in a red
bloom (near side) and dim rings (far side). Drag to spin, inertia on
release, arrow keys turn it, off-screen it pauses, reduced motion gives one
still frame. Sized by `--ed-gx-globe` (250px). MARKERS: one per city a
piece on the bearer's record came from — `/api/orders?places=1` reads the
caller's PAID sale orders and purchase tickets reported bought/kept/returned,
each piece's house → its city through lib/asterisk/houses.js → a coordinate
from lib/asterisk/places.js (curated, provenance-stamped, one row per city
the origin record names; tests/purchase-places.test.js holds the two files
together). The front-most marker is named on the canvas and the readout
prints its fix in D.MM.SS (LAT 35.40.48N · LONG 139.41.24E); a house the
record cannot place is listed as NOT PLACED, never guessed; nothing bought
reads NO FIX — the globe still turns. Below it the cities as numbered rows,
then the credit stack (RECORD No. / PIECES PLACED / CONVICTIONS HELD), then
the conviction readback, heard-log, RECENTLY FORGOTTEN, the links (now with
ORDERS →) and the Reset Brain control, unchanged.

**Same day, the owner's second round.** The map settles to 0.4 (first 45%
less, then "settle at 40%"); the station index is GONE ("they make no
sense"); a solid 7px rule (.gxthick) under the masthead and two more thick
hairlines + two verticals in the field. **THE MASTHEAD IS EVERYWHERE:** the
shared `.headline` is set like the cover's masthead (Michroma 700, fluid
38–84px via `--ed-fs-headline`, tracking 0.02em, line 0.94, uppercase) and
the eight destinations render it through `app/components/PageMast.jsx`
with a faint second line (`.headsub`) — the cover's own words for that
subsystem (YOUR CURATED EDIT / POSTS + THE HOTLIST / TRAIN THE BRAIN / THE
OPEN INDEX / CONTROL PANEL / TONIGHT'S LOOKS / FULL READ); ORDERS has none.
**ICE IS A COOL SKY-TEAL** (owner: "the opposite of the phosphorus green is
this scary dark negative blue — a cool tealish sky blue"): --ink #007896,
--sig #0078a3, --p2 #0a74bb, every glow/lamp/line/shadow re-tinted to the
same hue. The AA law (Aug 16; tests/theme-contrast.test.js) caps lightness
near 0.32 at this hue — a pastel sky cannot pass it; relaxing the law is the
owner's call. **THE PLUS FIELD** (.os-plus in shell.js): a fixed layer
carrying a holographic sweep in the theme's own hues (--holo: dark = green/
blue/purple/red/fuchsia; ice = sky-teal/pink/yellow/blue/peach) seen only
through a mask of small pluses (--plus, an 8/11/15px plus at 64/89/118px
tilings, offset so it reads scattered), opacity `--ed-plus-op` 0.05 —
"hardly visible" by order. Static.
**Softened the same day** (owner: "a softer blue — ice shouldn't feel so
negative, it should feel soft and icy and frosted; selected buttons shouldn't
turn dark"): the ice accents came DOWN in saturation rather than up in
lightness — a desaturated slate-sky at hue 205: --ink #3c759d, --sig
#3075a6, --p2 #3f73a6 (all ≥4.5:1 on --bg, the AA law kept). A selected,
filled or hovered control on ice is FROSTED — pale sky fill, blue text, the
ink glow (the grouped `[data-theme="light"]` rule at the end of globals.css
over every `background: var(--ink)` state) — never a dark block. The plus
field is two tilings (96/137px), not three.
**Then THE CYAN GLASS WORLD** (owner, 9 Sep, three references: a Y2K
chrome figure in aqua light, a Tron cyan glow, the VAIO store of clear cyan
glass — "don't fully remove the slight accents of purple and pink"): ice is
a cool cyan-white ground (`--bg` #e6f4fa) with CYAN glass tints (`--glass`,
`--glass-pill`, `--glass-shadow`), cyan lamps, a brighter cyan glow on every
lit word and frosted control (rgba 0,190,235), chrome sheens kept white; the
ink and the signal are the passing cyans (#0c7795 / #0d779e), the secondary
accent a soft PURPLE (#805ac1, 4.50:1) so the purple voice stays; the wash
is two aqua hazes plus a faint pink and a faint purple, the blobs aqua /
pink / purple / aqua, the plus sweep cyan-aqua-pink-purple, the vignette
cyan. The AA law is kept throughout.
**Ice: the header's words are just words** (owner, 9 Sep, from a Safari
recording where a hovered word grew a dark grey pill): in ice a hovered or
current header word has NO pill and NO glow, the lamps under the glass are
off (`.glass-light` hidden), no pointer shine or rim catch on the pane, no
meniscus; the current destination keeps its red LED and red bar; the
frosted selected controls carry no glow. Phosphor keeps all of it — every
rule sits under `[data-theme="light"]` (the grouped block at the end of
globals.css). "DO NOT CHANGE DARK MODE."
Then "give the same header bar treatment to dark mode" (same day): the
block is theme-agnostic now — no pill on a hovered or current header word,
`.glass-light` hidden, pane spot / rim catch / lamp-hot transparent, the
meniscus off, in BOTH themes; the current destination keeps its red LED and
red bar. On phosphor a word's resting light (the teal law's smear, now the
token `--word-smear`) stays and a hover changes nothing; on ice the header's
words carry no glow at all.
**Safari, 9 Sep (owner: "no liquid glass rainbow or bezel warp, and it's
laggy").** WHAT SAFARI CAN SHOW: never the header's own bezel (WebKit runs
no SVG filter as a backdrop-filter — trap 150); only the PAGE-SIDE BEND,
where content passes under the strip's bottom edge while scrolling. The
bend's selector now reaches the new pages (`.headsub`, `.gxmastblock`,
`.gxthick`, `.gxhead`, `.gxfoot`, `.rkhead`, `.rkrow`, `.pfsec`, `.otfrow`,
`.ppsec`, `.demobanner`); an element over 260k px² (`BIG_AREA`) passes
unbent (WebKit re-rasterises the whole element through three displacement
passes per placement), and placement runs on alternate scroll frames. THE
LAG WAS THE GLOBE: a canvas shadowBlur on each of ~700 glyphs cost /upload
37ms a frame at idle (16.7 elsewhere) — the cage draws with alpha alone
now, at half rate (a drag draws every frame), and /upload idles at 17.9 /
scrolls at 18.9 in Chrome. Safari itself unmeasured. The hologram of lines
that replaced the glyph cage the same day draws in 0.11 ms against the
cage's 0.47 (200 draws of the 500px bitmap, headless Chrome, both themes).

THE PASSPORT → /UPLOAD BUILD LANDS SOLID (9 Sep): the roads still assemble
chunk by chunk from the document's edges in 90 ms pulses, but a fresh
major/secondary chunk now lands as a HOT SOLID STROKE — the same polyline,
a hair wider at full alpha on the transient canvas (`.ppbuild-hot`, which
wears the roads' glow) for 80 ms before it settles into its layer. The
ASCII dashes on the scanline grid are gone (app/components/roadBuilder.js).
The red `*` stars are the brand's asterisks, not ASCII structure — kept.


## The header on phosphor: words, always lit (9 September evening)

Owner: "on dark phosphorus instead of each button lighting up when I hover
over it, all the buttons should be reduced to only the words and they
should all always glow." Dark only — ice keeps the 9 Sep words-without-glow
treatment. The destination row carries no icons, no LEDs, no meta line;
SEARCH / BAG / SIGN IN drop their glyphs; the sub-pills (ORDERS →, STATS →)
are plain Michroma words; every word carries the full `--glow` at rest and a
hover changes nothing; ORB HUB's pills are transparent behind the words. The
current destination is the one word in RED with the red glow — the tab
rule's own marker (`.tab.cur`), the red law's "you are here" — so the red
bar and LED are gone with the icons. The block sits at the END of
globals.css under `:root:not([data-theme="light"])`.

## The words are the buttons — every button, every page, both themes (10 September, MODEL)

Owner: "the header buttons should all match. take away the little symbols,
only keep the word; however when I hover over the word the little
description should appear. I want the spacing to match ice light. all the
buttons in every tab should be treated with the same (font glows, only the
words are the buttons) rule." Built as a model on `ui/words-are-the-buttons`;
the owner judges.

**The law.** A button is a WORD in the signal colour carrying the site's
word smear — no pill, no border, no fill, no glyph, no LED. Hover: the word
brightens to the ink and keeps its light. Selected / current / on
(`.active`, `.on`, `.cur`, `aria-pressed`): the word is RED with the red
smear (`--word-smear-r`) — the tab rule's "you are here". Disabled: grey,
unlit. The red-law words (BUY, HOME, coming-soon `.soon`, the clear pill)
stay red. Ice runs the same rule through its own tokens (the blue smear).

**The header, both themes.** The seven destinations, SEARCH / BAG / SIGN
IN, MAIL and the sub-words (ORDERS →, STATS →) share one voice: Michroma at
the destination size, the 0.4px stroke, `--sig` with the full `--glow` on
phosphor and NO glow on ice (the owner's ruling from the Safari recording).
Icons, LEDs, the red bar and the corner glyphs are gone in both themes; the
current destination is the one red word. **The spacing is ice's**: 26px of
padding a side puts the words where ice's icon + LED + word sat, a ~56px
word-to-word gap at 1440 (measured: FRONT COVER 204/177 against ice's
197/179 before). **The description** (`.nmeta` — LIVE EDITION, OPEN INDEX…)
rises under the hovered word: absolutely positioned, out of the flow, 7.5px
grey, fading in over 180 ms; the compression rules' `display: none` is
outranked so it appears at every desktop width; it is off under 760px.
The 9 Sep evening PHOSPHOR block was retired (its comment stays in place).

**Everywhere else** one `[data-theme] :is(…)` list at the END of globals.css
names every button family (`.btn` and its ghost/active/wide/soon, `.fitbtn`,
`.followbtn`, `.platform`, `.chip.clickable`, `.outcomes button`,
`.unitpick button`, `.achip`, `.apill`, `.wchip`, `.gxbtn`, `.gxchip`,
`.ppupl`, `.ppupload`, `.dhint`, `.mailmore`, the tab strip, the card and
post action rows, the text buttons…) and strips the box — `:is()` takes the
specificity of `.btn.ghost.active`, so the list outranks the frost rule of
ice, the glass-pill rule of `.lgpane`, and the ink-glow box rule by cascade
order. The segmented rows (unit picker, card actions, tabs) lose their
dividers with the boxes. Verified by a computed-style probe over ten pages
in both themes: no button outside the header keeps a background, a visible
border or a shadow (the passport photo frame, the passport preview tile
and the drop zone are not buttons and keep theirs).

## Copy law (17 August, owner directives)

- **The app is a PERSONALIZED FASHION TERMINAL.** "Fashion intelligence OS" is
  retired everywhere a reader can see it.
- **The engine is "The Asterisk system"** in prose. Chrome labels that name the
  destination or the control — the `/asterisk` route, "ASTERISK GUIDING",
  "ASTERISK CONTROL ROOM", the compact toggle — keep the bare word on purpose.
- **No public mention of the learning bridges.** Six of them run the ranking and
  `lib/brain` names them freely; nothing a reader sees may. They had reached the
  site description, the feed's routing line, the top ticker and a status chip.
- **The ticker, with nothing followed**, carries three house lines: "ARE YOU
  SEEKING A S I L U M", "DISCOVERY - COMMERCE - COMMUNITY", "DISCOVER FROM
  ARCHIVES ACROSS THE WORLD". The spacing in "A S I L U M" is deliberate. A
  followed brand or reader still wins the ticker.

`tests/copy-law.test.js` enforces all four.

**Verified against the rendered HTML, not just the source (17 Aug).** All fifteen
destinations were fetched from a running server and their markup checked: every
one returns 200, and not one contains the word "bridges", the phrase "fashion
intelligence", or a bare `Asterisk <verb>`. The unit test reads source files; this
checked what a reader is actually served, which is the claim that matters.
