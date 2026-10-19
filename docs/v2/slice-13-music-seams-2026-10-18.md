# V.2 slice 13 — the music seams: Spotify and Apple Music (18 October 2026)

The last slice, as the owner ordered it ("apply to get Spotify and Apple Music
on my behalf but save that for last"; CONSTITUTION A6 (3)). ASILUM cannot
create a developer account or submit an application in the owner's name — a
service requires the account holder's own hand — so this slice builds the
whole seam and prepares both applications for the owner to submit. Schema v72
staged.

## What landed

| Piece | Where | Status |
| --- | --- | --- |
| Spotify: Authorization Code with PKCE, a signed ten-minute state bound to the passenger, the capability's scopes and nothing more, the token exchange and refresh bodies | `lib/connectors/oauth.js` | shipped (pure, tested) |
| Apple Music: the MusicKit developer token — an ES256 JWT signed with the Apple Developer key, six months at most | `lib/connectors/oauth.js appleDeveloperToken` | shipped (verified against a generated key in the battery) |
| The connection route: start (302 to Spotify when keyed; **503 requires-approval naming the prepared application when not**, never a redirect), the callback (exchange, seal, store, back to Settings), the Apple developer token for MusicKit JS, storing the user token, disconnect | `app/api/connect/oauth/route.js` | shipped; an account connects, a device cannot |
| Tokens sealed at rest (AES-256-GCM, a key derived from `DEVICE_COOKIE_SECRET`), one row per passenger and provider, erased and counted with the passenger's data | `lib/connectors/tokens.js`, `supabase/schema-v72-connector-tokens.sql`, `privacy.js` | shipped |
| The registry reads a stored connection as AVAILABLE for that account; Settings → Connections sends a DISCONNECTED music row through the real flow | `lib/connectors/index.js`, `/api/connect`, `ConnectionsRack.jsx` | shipped |
| The prepared applications | `docs/v2/applications/spotify-developer-application.md`, `docs/v2/applications/apple-music-developer-program.md` | **for the owner to submit** — every field answered, the owner's own fields marked OWNER |
| The env catalog | `.env.example` `SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY` | documented, unset |

## What stays as it was

- `taste-import` is **unsupported** and stays so: the Spotify Developer Policy
  forbids profiling from listening data (RIGHTS-REGISTER); the seam connects an
  account for display, playback and catalog search, never for ASTERISK.
- Apple Music's terms are **not yet examined**; `library-sync` stays
  requires-approval until the register records them (the application names the
  three things to read).
- The capabilities themselves stay `requires-approval` in the registry until
  the owner holds the approvals; flipping them to `env` is one line each, and
  the applications say when.

## Proof

`tests/connectors-oauth.test.js` (PKCE, the state, the URL and bodies, the
Apple token verified with the public key, the sealed store, the route's
refusals, the applications' presence); `npm test`, `npm run build` green.
