# V.2 slice 9 — media: the MOTION housing, the music circle, captions (17 October 2026)

The ninth vertical slice of the V.2 build (`docs/v2/BLUEPRINT-GAP-2026-10-17.md`,
"Build order" 9: "Media: video housing, music, captions — needs the media
worker"): chapter 3 "Video playback and persistent music controls" 3.1–3.24,
chapter 4 "Music integration and discovery" 4.1–4.18 as a seam, 17.2 where a
caption binds media. Tenth commit on `v2/build`, PR #484.

## What the media worker honestly is on this stack

There is no transcoder here — no ffmpeg in the dependencies, no encoding
service, a serverless request body far smaller than one video — so a
"pipeline that turns any recording into a ladder of renditions" would be a
fake player over nothing. The worker that exists is three real things, all
in `lib/media/index.js` (pure) and `lib/media/worker.js` (server):

1. **A probe of the container's own header.** ISOBMFF boxes (`ftyp`, `moov`
   → `mvhd`, `trak` → `tkhd` matrix for rotation, `mdhd`, `hdlr`, `stsd`) or
   EBML elements (`Info` → `TimecodeScale`, `Duration`; `Tracks` → `CodecID`,
   `PixelWidth`/`PixelHeight`), read from the SERVER's copy by Range
   (head 2 MB, the tail when the index sits after the data). Nothing the
   client said about the file is used.
2. **Admission against declared limits** (`MOTION` in `lib/media/index.js`,
   the owner's to ratify): H.264 in MP4 or VP8/VP9 in WebM — what every
   browser decodes natively — 1 s to 3 minutes, an edge up to 3840, up to
   100 MB. Everything else is refused BY NAME and the object is deleted: an
   HEVC recording (a phone's default) is told to export as H.264; a WebM
   with no declared length (a live recording) is told to re-export. Never
   converted.
3. **Storage through the Wire's own bucket** (`lib/wire/media.js`): a signed
   direct upload (`POST /object/upload/sign`), `x-upsert: false`, under
   `WIRE_VIDEO_ENABLED=1` on top of `WIRE_UPLOADS_ENABLED=1` and storage.

One rendition, then: what the author uploaded is what plays. The quality
choice (3.6) is stored and the housing says `QUALITY_NOTE` beside it
instead of drawing a ladder over nothing.

## What landed

| Blueprint | Where | Status |
| --- | --- | --- |
| The full-screen housing: play / pause, seeking, ±10 s, settings; tap to reveal, auto-hide after inactivity, kept while in use; double-tap the sides to seek; swipe down exits (3.1–3.2) | `app/components/MotionHousing.jsx` inside the "media" popup (`MediaFloat.jsx`); `CONTROLS_HIDE_MS`, `SEEK_STEP_S`; the keyboard: space, the arrows, C, M | shipped |
| Fixtures extremely compact and translucent while the controls show (3.1) | `data-media` on `<html>`; `[data-media] .fixture, .ccenter` | shipped |
| Adaptive autoplay in the Feed: the most visible plays, others pause; audio follows the preference; reduced motion, data saver, Low Power limit it (3.3) | `lib/media/index.js` `autoplayPolicy`, `mostVisible`; `lib/media/feedplay.js` (one IntersectionObserver); `WireCard.jsx MotionMedia` | shipped. Low Power Mode is not readable on the web: `lowPower: null`, and null never counts as a limit |
| Pause behind a popup, resume from the exact timestamp (3.4); Feed autoplay pauses on leaving; PiP where supported (3.5) | `feedplay.js positions`, the housing's unmount; `data-popup` pauses the Feed; `requestPictureInPicture` / `webkitSetPresentationMode`, feature-detected | shipped |
| Quality: adaptive / highest / lowest in Settings and the housing (3.6) | `QUALITIES`, the `quality` preference | shipped as a stored choice with `QUALITY_NOTE` — one rendition |
| Speed 0.5× … 2× (3.7) | `SPEEDS` | shipped |
| Captions: creator-provided WebVTT, a CC toggle in the housing, size and background opacity, automatic during muted autoplay, the preference synced across devices, the language matched to the passenger's (3.8–3.11) | `parseVtt`, `validateCaptionTracks`, `captionsShown`, `pickCaptionTrack`, `captionAppearance`; tracks on `motion_assets.captions`, served at `GET /api/editorial/motion?captions=<id>&lang=`; the preferences in `user_records` kind `media` (v67) via `lib/media/preferences.js` | shipped. **Automatic transcription, translation and music identification are `notImplemented`** (`transcription()`, `translation()`, `musicIdentification()`): no paid AI, no invented lyrics, artists or titles (3.12) — a surface says so |
| Identified music, the track label (3.13) | — | not drawn: nothing identifies music, so no label exists |
| Visuals pause, audio continues (3.14); single active audio source (3.15); preserve the choice on closing (3.16) | KEEP AUDIO in the housing → `lib/music/player.js takeAudio`; `claimAudio`; `asilum:audio-claimed` pauses the housing | shipped for a MOTION's own soundtrack (the only audio ASILUM has) |
| The music circle in the Info Dock; stays on Direct Messages, small, in the right corner (3.17–3.18) | `app/components/MusicCircle.jsx` in `InfoDock.jsx`; `data-dm` from `MailDesk.jsx` | shipped; the circle is contextual — present only while a source exists |
| The panel: track, by, play / pause, skip, back to the media; adaptive dismissal; music never stops because it closed (3.19–3.20) | `panelFor`, `panelAfter`, `PANEL_IDLE_MS` | shipped; SKIP is disabled with "nothing queued after it" |
| The circle's colour from the cover / the frame, the pulse, the still, the loading state; 120–250 ms blends; fade and contraction on end (3.21–3.23) | `dominantColor`, `blendMs`, `circleFor`; CSS `--mc`, `--mc-blend` | shipped |
| Audio interruptions under OS policy (3.24) | the browser's own media session | left to the platform |
| Music integration (4.1–4.18): connect a service, like-sync, catalog search, Wardrobe Music | `lib/connectors/index.js`: Spotify gains `playback` and `catalog-search` (requires-approval); **Apple Music** added with `playback`, `library-sync`, `catalog-search` all requires-approval — MusicKit's terms are NOT YET EXAMINED by the rights register; `lib/music/index.js musicAvailability`; Settings lists both states; the panel's "connect a streaming app" leads there (4.2) | a seam with honest unavailable states: no OAuth, no catalog, no sync; `catalog`, `likeSync`, `wardrobeMusic` are `notImplemented` |
| The composer's VIDEO: preflight on the device (mime, bytes, the browser's own duration), begin, the signed PUT, verify, the poster frame drawn on the device and uploaded as a Wire image, `.vtt` captions per language | `WireComposer.jsx addVideo`, `addCaptions`; `lib/wire/draft.js setVideo`; `lib/wire/compose.js` accepts an ADMITTED asset (`validateVideoAttachment`), refuses a path or a link (`video-unadmitted`), images beside a video, a pending or refused upload; `/api/editorial` resolves the row (the author's, ready) and stores the worker's facts, never the body's | shipped; off, the button says why |
| The on-media caption's ink on video (slice 3's `captionInk`) | the housing samples the frame's lower third on load, seek, pause and every 2 s | shipped |
| The one sample MOTION | `public/model/motion-test-pattern.mp4` + `.vtt`, generated by `scripts/make-motion-sample.swift` (AVFoundation, macOS): H.264 with an AAC test tone, 320×180, 6 s, 46 KB, fast start; `SAMPLE_MOTION`, `sample-w8` | labelled GENERATED TEST PATTERN on every surface — the same kind of artefact as the gradient covers, never a film |
| Schema | `supabase/schema-v67-media.sql` — `motion_assets`; `user_records.kind` gains `media` | STAGED with v62–v66 |

## Decisions recorded (the owner may overrule)

1. **No transcoder is a limit, not a to-do.** The worker refuses by name
   rather than queueing a conversion nobody runs. An HEVC phone recording is
   the loudest consequence: the sentence tells the author to export "Most
   Compatible". A transcoder (ffmpeg on a worker, or a service) would lift
   it; nothing else in this slice would change.
2. **The limits** (`MOTION`: 3 minutes, 100 MB, 3840 px) are declared
   placeholders; the blueprint names no figure.
3. **The music circle carries a post's own audio.** Chapter 3's persistent
   controls were built over the one audio source that exists; a song joins
   as a second source kind when a catalog or a provider does.
4. **Apple Music is listed as requires-approval, not unsupported**, because
   nothing forbids it that we have read — the register has not examined
   MusicKit's terms. Spotify's catalog search and playback ride the same
   approved app the display link needs.
5. **Feed autoplay is muted by default** and the preference is the
   passenger's (3.3); a MOTION opened in its housing plays with sound where
   the browser allows, muted with an UNMUTE control where it does not.

## Honest gaps

- The direct-upload path is built against Supabase Storage's signed-upload
  endpoint and is untested against a live bucket in this session (no
  storage in memory mode); the probe is tested over a synthetic MP4, a
  synthetic WebM and the real generated clip.
- 3.13's music discovery subtab and 4.x's Wardrobe Music do not exist:
  there is no song to open.
- The echo viewer does not play video; an echo with a video is refused
  with that sentence.
- 3.18 is CSS on the mail desk's open state; a dedicated DM route would
  carry the same attribute.
- Low Power Mode is unreadable on the web; the policy says so.

## Measured

- `npm test`: 1,904 tests, 1,814 pass, 0 fail, 90 skipped. New:
  `tests/media.test.js` (11 tests: the probe over a synthetic MP4 — head and
  tail — a synthetic WebM and the generated sample; admission by name; the
  autoplay, caption and audio laws; the circle; the composition; the store;
  the routes; the autoplay store's initial state), `tests/helpers/media-scenario.mjs` with its mem/pg
  differential in `tests/postgres-integration.test.js` (CI only). The
  battery fails 4 of 10 with the law reverted (admission admits every codec
  and length, the Feed plays an invisible card, captions never auto-show, a
  claim pauses nothing, the circle vanishes on pause) and passes restored.
- `npm run build`: green. `npm run v2:check`: PASS (G1–G7, latency p95 26
  ms, chunk laws). `node
  scripts/v2-fixtures.mjs` writes `docs/v2/fixtures/media.json` (the gate
  and the law, a device refused, the probe and verdict over the sample, the
  captions as text/vtt, the owner's list).
- Browser, the `asilum-v2-mem` launch config (a TRUE memory-mode server —
  `DATABASE_URL=` set empty), desktop and 375 px, dark and light, a fresh
  tab each time so the console was its own: the sample MOTION card autoplays
  muted with the creator's captions showing; it is PAUSED beneath a popup —
  including the popup a restored session mounts before the card exists
  (found and fixed: the autoplay store now reads `data-popup` and the
  visibility at install) — and plays again once the popup closes; the
  housing opens with sound where the clip has it (none here), the controls
  reveal on a tap and hide after 2.5 s, CC ON renders the cue above the
  collapsed on-media caption, the speed menu shows 0.5×–2×, the quality
  menu says "one rendition … 320×180 · avc1", space / the arrows work on
  the focused video, the fixtures shrink to 22 % while the controls show; a
  phone gets one row of glyphs and keeps the film's height. Settings' MEDIA
  section stores the caption size (localStorage, mirrored only for an
  account) and lists Spotify and Apple Music as REQUIRES APPROVAL; the
  composer's VIDEO reads OFF with "wire images are not enabled on this
  deployment — no transcoder …". Console: no errors in any pass. The
  popup header's SHRINK / EXPAND word collided with the session counter
  beside a six-letter title at every width (pre-existing on LISTING too);
  the word is now screen-reader-only. Later the same day, with the sample
  carrying a generated test tone: KEEP AUDIO pauses the housing, the circle
  appears in the Info Dock pulsing in the frame's colour, the hidden host
  plays the same source from the same second; with the popup closed the
  panel reads the title, the author, "the post's own audio · no song
  identified", PAUSE stills the circle, SKIP is disabled with "nothing queued
  after it", STOP removes the circle and clears the host; when the tone ends
  on its own the circle fades out (3.23). Not exercised here: a real upload
  (no storage in memory mode), 3.18 on a signed-in mail desk.
