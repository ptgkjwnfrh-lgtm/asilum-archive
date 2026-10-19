# Spotify for Developers — the prepared application (owner submits)

Prepared 18 October 2026 under CONSTITUTION A6 (3): ASILUM prepares, the
owner's hand signs what Spotify requires of the account holder. Nothing below
has been submitted. Where a field needs the owner's own identity (the Spotify
account, the legal entity, a phone number), it is marked **OWNER**.

## Where

1. Sign in at https://developer.spotify.com/dashboard with the Spotify account
   that will own the app (**OWNER** — a personal or a brand account; the
   dashboard requires accepting the Developer Terms, which only the account
   holder may do).
2. **Create app**. The form fields and ASILUM's prepared answers:

| Field | Prepared answer |
| --- | --- |
| App name | `ASILUM` |
| App description | `ASILUM is a fashion search and taste Passport. The Spotify connection lets a passenger show a song or artist on their public Passport room ("display/link"), attach catalog music to a post, and play it inside ASILUM on a Premium account through the Web Playback SDK. ASILUM does not read listening history and does not profile or train on Spotify data.` |
| Website | `https://asilum.app` (**OWNER** — the production origin, `SITE_ORIGIN`) |
| Redirect URIs | `https://asilum.app/api/connect/oauth` and, for a preview, `http://127.0.0.1:3482/api/connect/oauth` (Spotify rejects `localhost`; use the loopback IP) |
| Which API/SDKs are you planning to use? | Web API, Web Playback SDK |
| Commercial / non-commercial | Commercial (ASILUM charges a passenger fee on purchases; the music feature itself is free to the passenger) |

3. In the app's **Settings**, copy the **Client ID** and the **Client secret**
   into the deployment's environment as `SPOTIFY_CLIENT_ID` and
   `SPOTIFY_CLIENT_SECRET` (dashboard → Copy → `pbpaste` → the env file; never
   through chat, per `.claude/skills/database-safety`). Set `SITE_ORIGIN`.

## Development mode and the extension request

A new app runs in **Development mode**: up to 25 named Spotify users may
connect. To open it to every passenger the app needs an **Extended Quota Mode**
request from the dashboard, which asks for:

- the app's purpose (use the description above);
- screenshots of where Spotify content appears (the Passport room's anthem
  line, a post's music attachment, the player);
- confirmation of the Developer Policy. ASILUM's position, to be stated as is:
  no analysis, profiling or machine-learning use of Spotify content
  (`taste-import` is marked **unsupported** in `lib/connectors/index.js`;
  RIGHTS-REGISTER row "Spotify"); Spotify content is shown with attribution and
  the Spotify mark; no ad targeting; playback only through the official SDK.

## What ASILUM asks of the passenger (scopes)

| Capability | Scopes | Why |
| --- | --- | --- |
| display-link | `user-read-private` | to show the connected account's display name on the Passport room |
| playback | `streaming`, `user-read-playback-state` | the Web Playback SDK on a Premium account (4.13) |
| catalog-search | none (client credentials) | attaching catalog music to a post (4.14) |

The approved app's scopes must match these exactly; the connect route sends the
capability's scopes and nothing more.

## What is already built (the seam)

- `lib/connectors/oauth.js` — PKCE, signed state, the authorize URL, the token
  exchange and refresh request bodies.
- `app/api/connect/oauth/route.js` — `?platform=spotify` starts the flow when
  the keys are set (302 to Spotify) and answers **503 requires-approval** with
  this document's path when they are not; the callback exchanges the code and
  stores the tokens sealed (`lib/connectors/tokens.js`, schema v72).
- Settings → Connections shows the state per capability and CONNECT when the
  deployment is keyed and the account is not yet connected.

## After approval

1. Set the two env vars and `SITE_ORIGIN`; redeploy.
2. `GET /api/connect` must report `spotify.configured: true`.
3. Connect the owner's own account first from Settings; the row in
   `connector_tokens` proves the exchange.
4. Only then flip the capabilities that need a connection from
   `requires-approval` to `env` in the registry (one line each in
   `lib/connectors/index.js`) — with the dashboard approval in hand.
