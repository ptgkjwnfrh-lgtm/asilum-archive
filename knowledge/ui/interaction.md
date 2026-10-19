# Interaction grammar — V.2 (owner's blueprint, 17 October 2026)

The blueprint's chapter 1 (popups and sessions) and chapter 2 (the Disc
and tactility) are the law; what follows is the shipped reading.

## Popups (SheetHost.jsx, dockstate.js, sessions.js)
- One popup at a time, over the root, at about 60% of the height; it
  grows to the full height for the keyboard and long editing (EXPAND, and
  automatically when a field inside takes focus).
- A new popup REPLACES the one on screen; the previous one stays in the
  session's history. Back and a swipe right restore it. A swipe down from
  the header, Escape, CLOSE, or the FEED key dismiss it. A tap outside
  dismisses a lightweight popup only — never a checkout, never an edit in
  progress (`heavy` in the VIEWS table).
- Dismissing keeps the session. The FEED key twice: the first tap
  dismisses, the second refreshes the tab from the top.
- While a popup is up the fixtures shrink and go translucent
  (`[data-popup]` on the root). The page behind does not scroll.

## Sessions (the universal session hub)
- Up to ten preserved sessions, most recent first, each a chain of
  popups; the counter reads `01/10`. Opening a popup extends the active
  session; a new session is made from the deck's POST disc (long hold →
  NEW SESSION) or from the hub's dial.
- The deck's POST disc is the session indicator while a popup is up: it
  wears the counter and a tap opens the hub (the carousel). Posting is
  unavailable inside a popup.
- The carousel: glass panels in a spatial row, `×` on the focused panel,
  swipe up to close, UNDO for six seconds, rename from the dial's menu.
  Previews are static; sensitive views (messages, bag, checkout) are
  veiled unless the device reveals them. The eleventh session opens the
  manager instead of closing anything.
- Persistence is per device (`asilum-sessions-v2`); nothing is written
  before the stored hub has been read.

## The Disc (Disc.jsx, lib/disc.js)
- Drag to turn, flick to spin; momentum and friction; a magnetic snap
  that ramps as the disc slows; a tick (haptic + visual) at each item
  while slow. Tap the centre to confirm, or let an item dwell one second
  (the ring fills). A long hold on the centre opens the compact menu.
- Arrow keys turn it; Enter confirms. Reduced motion drops momentum.
- Every disc can be turned Off per interface (`asilum-disc-<name>`); Off
  swaps in a slim slider with arrows and OPEN.
- Rotating the session dial moves the carousel; swiping the carousel
  turns the dial.

## Tactility (lib/haptics.js)
- `tick`, `press`, `confirm`, `error`, `toggle` — short patterns through
  `navigator.vibrate`, behind one On/Off key (`asilum-haptics`, Settings).
  A device without a motor is not an error. Compact buttons depress 4%.

## The one Feed (app/page.js, lib/feed/types.js)
- There is no Wire. Posts are braided into the pieces (one after every
  third piece), PLACE cards after every ninth, live ECHOs on the rail
  above the stream. Eight card types: TRANSM · STILL · MOTION · BRDCST ·
  LISTING · ECHO · PLACE · SONG (SONG waits for a music catalog).
- Tetris packing by the blueprint's weights: STILL and MOTION (70%) take
  the full width and break the columns; LISTING (45%) and TRANSM take a
  column; PLACE (20%) is compact until opened; a standalone BRDCST (10%)
  is a strip. The wheel overlaps six pixels.
- A piece opens the LISTING popup (`ListingSheet.jsx`): carousel, LIKE,
  OFFER (`soon`), BAG, STAMP, sizes, price, three tags, BEHIND THE
  PRODUCT for the rest and the depth (origin, evidence, ASTERISK's why,
  goes-with). STILL and MOTION enlarge in the "media" popup with the
  caption on the media and its ink read from the photograph. PLACE
  expands in place. A BRDCST footer collapses to title and date.
- ECHO lives 1–24 hours; expired echoes are never served; the viewer is
  sequential, tap for next and previous, hold to pause.

## Still the law from before
- Suffix grammar on actions: "→" navigates in-app, "↗" leaves or
  publishes, "✓" confirms state. One glyph, right side.
- Coming-soon: class `soon` on any control whose feature isn't usable
  yet, saying what it waits for — never a dead button, never a fake
  success.
- Clickability must be visible: pills for buttons, dotted underlines for
  text links.
- Every username navigates to that user's page, everywhere.
- Item depth lives in the item modal; feed cards stay title/price/fit +
  Favorite/Bag only (owner decree, July 6).
