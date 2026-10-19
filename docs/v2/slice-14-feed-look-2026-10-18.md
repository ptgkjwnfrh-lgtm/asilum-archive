# V.2 slice 14 — the Feed and the look, to the owner's references (18 October 2026)

**Authority:** the owner's instruction of 18 October 2026 and the references
committed at `docs/v2/references/2026-10-18-feed/` (2.jpg–6.jpg). Verbatim
intent: "you have the feed layout rules; I saw some shit that said the wire —
THE WIRE DOESN'T EXIST ANYMORE; these are the references; I want page
gradients too; on dark mode if there is a popup the background should be
darker, not a cloudy white; the liquid glass isn't liquid enough — I want the
OG reactive rainbow liquid glass you made for ASILUM; everything should be
rounded out too." Branch `v2/build`, six commits, one per instruction.

## What landed

| # | Commit | What | Where |
| --- | --- | --- | --- |
| 1 | `ef89b1c` | **The Feed to the references.** The post card: media fills a rounded card; handle, title and caption over it in white; four outline actions (heart = LIKE, comment bubble = soon, hourglass = STAMP, share arrow) and the author's circle. The BRDCST footer exactly as drawn: BRDCST · the date and time · a rule · \*event · chevron. The place card: venue mark, distance in miles, name, globe; it opens the map popup. The map popup's head (4.jpg): mark, distance, MAPS ↗, name, kind, description, globe, and a rating slot that draws ONLY from a named source. The piece card: the photograph, one quiet line, × to pass. The listing popup (5.jpg): "unverified" on the photograph only from the ledger; ♡ · OFFER · bag · hourglass; "Brand: title", SIZE, "35.00 USD" in Michroma. The deck's ad strip wears *ADs in red. | `app/components/PostCard.jsx`, `PlaceCard.jsx`, `MapSheet.jsx`, `ListingSheet.jsx`, `ControlCenter.jsx`, `app/page.js`, `lib/feed/types.js` (`brdcstMoment`, `brdcstWhen`, `priceLine`, `offerMode`, `pieceName`), `lib/places/registry.js` (`mapsUrl`, `placeRating`, `milesLabel`), `Icons.jsx` (comment, hourglass, share, venue, star) |
| 2 | `8751674` | **The Wire does not exist.** Every visible Wire word is the Feed now — the cover, the hotlist (THE HOTLIST), the profile, stats, a passenger's page, the business account, the taste network, analytics, the 404, the Likes sheet's POSTS tab, the deck's POSTS toggle and scope, the posting errors. Module and data names stay. | 15 files; guard in `tests/v2-shell.test.js` |
| 3 | `0477e80` | **Page gradients.** `--bg` stays the base; `--bg-grad` (both palettes) is what the page wears on `<html>`: a light from the top corner in the page's own tint, a faint counter-light, a gentle fall of the ground. Each destination tints it through `--page-tint` (the shell names the page in `data-page`). | `app/globals.css`, `app/shell.js` |
| 4 | `461527e` | **Dark popups deepen the page.** `--scrim` is a deep translucent black in dark (both the device's dark and the pinned dark) and the reference's 42% slate wash in light (unchanged). `--shade` is black in dark; the twelve shadows that mixed from the light ink now mix from it. | `app/globals.css` |
| 5 | `6a5fd8d` | **The OG reactive rainbow liquid glass.** The 8 Sep glass (`LiquidGlass.jsx`: the bezel's displacement map, R/G/B dispersed, the pointer's shine) on the Info Dock, the Passport Button, the deck and every popup; WebKit bends the cards under the popup's edges instead. One listener set (`useGlassReactive`) turns the rainbow rim with the pointer, the tilt and the scroll, writing only to the glass elements. The page bends under the popup again: the scrim is no longer a backdrop root; the page softens under its own filter. | `LiquidGlass.jsx`, `InfoDock.jsx`, `PassportButton.jsx`, `ControlCenter.jsx`, `SheetHost.jsx`, `shell.js`, `globals.css`; the float and the ticket flow portal to `<body>` (`ListingSheet.jsx`, `TicketFlow.jsx`, `dismiss.js`) |
| 6 | (this commit) | **Rounded everywhere.** `--radius-card`, `--radius-field`, `--radius-key`; a floor that rounds every button and field; cards, popups, the deck, keys, chips and stickers on the tokens; the underline-only (hairline) fields become rounded filled fields; card photographs rounded by default (`--ed-img-rad` ships 22). The phone popup header gives the title and its session count their room. | `app/globals.css`, `lib/uilab.js` |

## Honesty kept

- **No fake rating.** The reference's "4.6 (24K)" is a slot: `placeRating`
  returns a figure only from a named source with a count and a link; no row
  in the places record carries one, so nothing is drawn.
- **No dead OFFER.** `offerMode` makes OFFER real on a native Storefront
  listing and on a Wardrobe piece whose owner takes offers (DM first, 13.4);
  anywhere else the word is quiet with its reason.
- **"unverified" only from the ledger** — the verification badge's state,
  never inferred.
- **Distance only from this device's own centre** (the current area it shared
  this session, else the confirmed base city); otherwise a dash.
- **The comment bubble is `soon`** — comments are not built.

## Verified

- `npm run build` green before every commit; `npm test` green before every
  commit (1,854 pass, 0 fail, 92 skipped at commit 5).
- Each new assertion was run against the source reverted to the commit
  before it and failed there (the reviewer's check, A2).
- Seen in the memory preview (`asilum-v2-mem`, port 3482) at 375px and
  desktop, light and dark, popup up and down: the post card, the footer
  (its markup injected under a real card — no memory-mode post carries an
  event), the place card and its map popup, the piece card and the listing
  popup, the dark and light scrims (rgba(1,3,4,.74) / rgba(37,55,73,.42)),
  data-refract on all four glass surfaces and the rim angle following the
  pointer.

## Proposed defaults (reported, not decided)

- The per-destination tints: the Feed blue, the Passport the accent, the
  account the violet, the map between.
- The rim at 0.62 (dark) / 0.72 (light) opacity, 1.5px; the popup at 80%
  ground, the fixtures at 58%, the deck at 66%.
- The page under a popup blurs 5px (its own filter).
- The search popup's underline field stays: it is the 6.jpg reference.

## Known gaps

- The BRDCST footer's real data path was not seen in the browser: no
  memory-mode post carries an event. The markup is pinned by tests and the
  CSS was seen with the component's markup injected.
- The tilt was not exercised on a phone; it was read from the code path and
  the pointer path was seen.
- Safari's page-side bend under the popup was not seen (no WebKit here).
- The cover and hotlist pages still use some older square chrome off the
  shell; the floor rounds their buttons and fields, not every panel.

## Slice 14b — the device (18 October 2026, evening)

The owner, after the first pass: "rainbow refractive reactive liquid glass,
… I want it to look cool"; "pull from the og design language but
only some of it" (the 404 and title-card films); ">>>>>>" for expanding
descriptions; "blinking squares that turn off … like how you eject a disc";
"the og passport design should transfer over 90% accurately"; a double-click
float "reactive to movement" over "a fogged version of the feed"; "the soft
gradient of blue to white and green to black" and "the dark mode phosphorus
glow"; then "drop the magazine from everything, it's just ASILUM". Recorded as
CONSTITUTION A6 third addendum.

| What | Where |
| --- | --- |
| The lens splits colour (`prism`), an iridescent film turns with the hand, the fixtures and the deck drift, a rainbow bloom outside every rim | `LiquidGlass.jsx`, `globals.css` |
| The original ground (blue→white, green→black) and the dark phosphor glow in each word's own colour; the dark headline in the title card's chrome-to-mint | `globals.css` tokens; `tests/v2-shell.test.js` updated |
| `>>>>>>` load-in on expanding text: a tapped post caption, an opened BRDCST event, the map popup's description, the overview behind Read more, BEHIND THE PRODUCT and the valuation, the raised media caption | `Chevrons.jsx` (`ChevronText`), `lib/feed/chevrons.js` |
| Warning lights: a square lamp that blinks like an eject light and goes dark on bag, offer, buy and request purchase; the deck's pair of red status squares answers | `Chevrons.jsx` (`Lamp`, `blinkLamp`), `ListingSheet.jsx`, `ControlCenter.jsx` |
| A double tap on a Feed piece floats it as a glass card turning with the phone or cursor over the fogged Feed; the photograph float wears the same fog | `PieceFloat.jsx`, `FloatView.jsx` (`useTilt`), `app/page.js` |
| The passport document to its iteration-5 design (7db2b89): plus registration band, the 01, the photo slot's print lines and target, its own teal and phosphor, mono numbers, the microprint, the MRZ at the foot | `board/page.js`, `PassportSecurity.jsx`, `globals.css` |
| No "magazine": ASILUM never calls itself one in any visible string; the domain keeps its address until it moves | 12 files; `tests/brand-name.test.js` |

Deliberate departures from the 25 July passport: BASED IN and SAVED (real
data) where it printed SEX X and BOARDS; "PERSONALIZED FASHION TERMINAL" where
it printed the retired "fashion intelligence" name (copy law); ASILUM without
"MAG"; the glass and the OPEN MAP / STAMP PASSPORT buttons kept.

Not seen: the tilt on a real phone; Safari; the fog and the popup glass take
a moment to paint in the preview pane (a background tab), worth a look on a
phone.
