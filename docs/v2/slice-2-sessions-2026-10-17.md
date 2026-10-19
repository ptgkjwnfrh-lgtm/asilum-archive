# V.2 slice 2 — popups, the session hub, the Disc (17 October 2026)

**Authority:** the owner's V.2 Blueprint of 17 October 2026, chapter 1
(popups and the universal session hub, clauses 1.1–1.35) and chapter 2
(the Disc and tactility, 2.1–2.21). Row two of
`docs/v2/BLUEPRINT-GAP-2026-10-17.md`. Branch `v2/build`, on top of slice 1.

## What this slice ships

| Blueprint | Where | Status |
| --- | --- | --- |
| One popup over the root, ~60% height, a new one replaces the last and the previous stays in history (1.1) | `lib/sessions.js` (pure: sessions, stacks, MRU, counter, limit, undo, rename, previews, serialize), `lib/dockstate.js` (the popup is DERIVED from the hub), `app/components/SheetHost.jsx` | shipped |
| Gesture grammar (1.2): Back and swipe right restore; swipe down from the header dismisses; tap outside dismisses lightweight popups, never a checkout or an edit in progress | `SheetHost.jsx` SWIPE_DOWN / SWIPE_BACK / `heavy` in VIEWS | shipped |
| Dismissing keeps the session (1.3); sessions survive restarts (1.9) | `dockstate.js` `closeSheet` → `S.dismiss`; `asilum-sessions-v2` on this device, written only after it has been read | shipped on this device; cross-device sync (1.18, 1.19) needs a server store — the seam is `serialize` / `hydrate` |
| Ten sessions, MRU, the counter `01/10`, the manager at the eleventh, nothing closes on its own (1.4–1.8) | `lib/sessions.js` SESSION_LIMIT, `newSession` → `manager`, `app/components/SessionCarousel.jsx` | shipped |
| The carousel: glass panels in a spatial row, `×` on the focused panel, swipe up to close, UNDO (1.21–1.24) | `SessionCarousel.jsx`, `.sesspanel` CSS (`--k`, `--ak`) | shipped; UNDO lasts six seconds |
| The POST disc is the session indicator while a popup is up; long hold → compact menu (NEW SESSION, SESSIONS); posting unavailable inside a popup (1.25, 1.26, 1.29) | `app/components/ControlCenter.jsx` `popupUp`, `.cccount`, `.ccmenu` | shipped |
| FEED twice: dismiss, then refresh from the top (1.13, 1.14) | `ControlCenter.jsx` `feedTap`, `asilum:feed-refresh` event | shipped; the Feed listens for the event in slice 3 (today it scrolls to the top) |
| Fixtures shrink and go translucent under a popup (1.12) | `[data-popup] .fixture` | shipped |
| Sensitive previews hidden, previews static (1.34, 1.35) | `SENSITIVE_VIEWS`, `previewFor`, `asilum-session-previews` reveal | shipped; the reveal has no Settings row yet |
| THE DISC (2.1–2.10): drag, flick, momentum, magnetic snap ramping as it slows, ticks while slow, tap the centre or dwell one second, long hold, keyboard, per-interface Off with a slim slider | `lib/disc.js` (pure, tested), `app/components/Disc.jsx` | shipped |
| Post Selection: TRANSM · STILL · MOTION · BRDCST · LISTING · ECHO on the disc | `app/components/PostSelection.jsx` | TRANSM / STILL / MOTION / BRDCST open the one composer with a hint; LISTING and ECHO say `soon` (native storefront: slice 6; the one Feed: slice 3) |
| The session dial is the same Disc; rotating it moves the carousel and swiping the carousel turns it (2.6) | `SessionCarousel.jsx` `sel` shared by both | shipped |
| Haptics (2.20, 2.21): one On/Off, never a dependency | `lib/haptics.js`, Settings → APPEARANCE → Haptics | shipped; `navigator.vibrate` where the platform allows |

## What this slice deleted

- The dock's own sheet model (`sheet.stack` in `lib/dockstate.js`): the
  hub owns every popup now; nothing else keeps a stack.
- The slice-1 reading of POST (the disc opened the composer directly).

## Proposed defaults (reported, not decided)

- A new session is created blank and becomes the active one; the hub
  stays up (or opens) so the new panel is seen, and the next popup belongs
  to it.
- The hub opens from the deck's indicator (tap) and the compact menu
  (SESSIONS); with no popup up the POST disc is Post Selection, and a
  dismissed session is reached through the long hold.
- Disc sizes: 220px for Post Selection, 200px for the session dial; the
  dwell confirms only after a turn (the item the disc opened on is not
  auto-confirmed).

## Known gaps after this slice

- Cross-device session sync (1.18, 1.19) and the Passport Button as a
  popup (slice 1 note) wait for later slices.
- The composer's compact layout inside the popup is the 1 October
  composer; the blueprint's per-type forms arrive with the media slice.
- The sensitive-preview reveal (`asilum-session-previews`) has no Settings
  control yet.
