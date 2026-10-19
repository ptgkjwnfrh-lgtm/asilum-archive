# Apple Music (MusicKit) — the prepared application (owner submits)

Prepared 18 October 2026 under CONSTITUTION A6 (3). Apple Music has no OAuth:
ASILUM signs a **developer token** with an Apple Developer key, and the
passenger grants a **user token** in MusicKit JS on the device. Both need the
owner's Apple Developer Program membership, which only the owner can hold.
Nothing below has been submitted.

## Where

1. **Apple Developer Program** membership (**OWNER**): https://developer.apple.com/programs/enroll/
   — an individual or an organization (an organization needs a D-U-N-S
   number); the annual fee is Apple's, paid by the account holder.
2. **Certificates, Identifiers & Profiles → Identifiers → Media IDs**: register
   a Media ID for ASILUM:

| Field | Prepared answer |
| --- | --- |
| Description | `ASILUM` |
| Identifier | `music.app.asilum` (reverse-DNS; **OWNER** confirms the domain) |
| Enable | MusicKit |

3. **Keys → +**: create a key named `ASILUM MusicKit`, enable **Media
   Services (MusicKit, …)**, choose the Media ID above, **Download** the `.p8`
   once (Apple does not offer it again) and note the **Key ID**. The **Team
   ID** is on the membership page.
4. Put the three into the deployment's environment (dashboard → Copy →
   `pbpaste` → the env file; never through chat): `APPLE_MUSIC_TEAM_ID`,
   `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` (the `.p8` contents with
   `\n` for the line breaks, or the file's text).

## Terms to examine before the first passenger connects

The rights register marks MusicKit's terms **NOT YET EXAMINED** (`docs/v2/
BLUEPRINT-GAP §4`; the registry row's `basis`). Before `library-sync` is
offered, read and record in RIGHTS-REGISTER:

- Apple Media Services Terms and the MusicKit identity guidelines (attribution,
  the Apple Music badge, no stripping of previews);
- what a user token permits: library reads and writes on the passenger's own
  account only, for the features they turned on (liking to the library, 4.1;
  the optional import, 4.10);
- that ASILUM will not profile taste from a library without a written
  agreement (the registry's `never`).

## What is already built (the seam)

- `lib/connectors/oauth.js appleDeveloperToken` — the ES256 JWT (`iss` = team
  id, `kid` = key id, six months at most, Apple's cap).
- `app/api/connect/oauth/route.js?platform=apple-music` — returns a developer
  token for MusicKit JS when the three vars are set, **503 requires-approval**
  with this document's path otherwise; `POST` stores the passenger's user token
  sealed (`lib/connectors/tokens.js`, schema v72) once MusicKit JS hands it
  back.
- Settings → Connections shows the state per capability.

## After enrollment

1. Set the three env vars; redeploy; `GET /api/connect` must report
   `apple-music.configured: true`.
2. `GET /api/connect/oauth?platform=apple-music` returns a token whose payload
   decodes to the team id; the MusicKit JS `configure` call takes it.
3. Flip `playback` / `catalog-search` to `env` in `lib/connectors/index.js`
   only after the terms are recorded in RIGHTS-REGISTER.
