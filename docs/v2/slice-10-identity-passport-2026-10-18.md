# V.2 slice 10 — rulings, identity, the Passport's onboarding, friends and the offline queue (18 October 2026)

The tenth slice of the V.2 build (PR #484, `v2/build`), in four commits under
the owner's 18 October ruling (CONSTITUTION §10 Amendment A6; `docs/
OWNER-DECISIONS.md` §12): "anything that is law and not set in motion should
be built in this session, do the identity work as well."

| Part | Commit | What landed |
| --- | --- | --- |
| 10a rulings | `a8b8a22` | The **passenger fee** — USD 1 + 1.5% on every purchase (`lib/orders.js passengerFeeCents`, `ticketFeeCents`) — replaces the 1% founders fee everywhere it was named; the **USD 30 activation applies to DROP only** (`lib/storefront/fees.js ACTIVATION_APPLIES_TO`, `activationOwedCents`), SELL pays only the processor's fees; the **\|A\|** is a box with the letter A (`app/components/AMark.jsx`) and the friend asterisk is a plain typographic mark |
| 10b identity | `ec5ba64` | Schema v68 (`account_identity`, `account_devices`, `verification_appeals`); `lib/identity/commerce.js` (18+ to buy, sell, drop or gift — Terms 2.2; the home town and an optional, explained, erasable ethnicity with consent; `yearAtAge`); `lib/identity.js resolveRequestIdentity` (the assurance level from the JWT, confirmed email/phone, a known device, the birth date); `lib/identity/gate.js` on BRDCST, Credit, checkout, the ticket fee and the storefront routes; `TwoFactor.jsx` (Supabase MFA TOTP); AccountSignup collects the birth date, home town and ethnicity; a verification downgrade is noticed and appealable (12.9); the score resets on deletion with reviews anonymized (6.31); purge and export carry the new rows; the identity scenario runs on both backends |
| 10c the Passport | `da3ad27`, `23a83e1` | Schema v69; `lib/passport/onboarding.js` — seven autobiographical questions in a popup on first opening ("who was 12-year-old you listening to on the bus ride to school"), ten suggestions from a hand-entered cohort register (`lib/passport/cohorts.data.json`, ~120 artists with years, regions and backgrounds) picked by the birthday, the home town and the optional background, free text and skip always; an answer is an **identity anchor** only the passenger designates or removes, its tags in the profile's explicit class that never fades (14.2–14.3, 14.11); **Exploration Active** ramps toward 2:1 and the \|A\| in the Info Dock turns it off, off beating reactivation (14.8–14.10); every upload carries an editable caption whose reading overrides a conflicting assumption (17.2); **BEHIND THE UPLOAD** opens the gathered tags, each correctable (17.3); deleting an upload recalculates only what it alone supported (17.4) |
| 10d friends and offline | `bbf0379` | A mutual follow makes two passengers friends; a friend's name carries a plain Michroma `*` relative to the viewer, from the follows table both directions, gone on unfollow or block, unfakeable since a handle cannot begin with `*`; writes that opt in (interactions, follows) queue on the device offline (`lib/outbox.js`) and replay in order when the connection returns, told as queued never as landed, with the count and SEND NOW in Settings |
| the look | `0cefc10`, `c0c17e3` | No hairline fields and no scanline layer anywhere (Foundations: no CRT); a full-width card waits for a balanced run of six; the search popup to the owner's reference — "Find your next connection." in Michroma, Share Tech Mono as the description face, the field with the \|A\| toggle inside the popup, ALL · PEOPLE · PIECES · POSTS · PLACES with the active tab in red, the ASILUM OVERVIEW card and the DESIGNER: HOUSE rows; the light palette is the reference's |

## Decisions recorded (the owner may overrule)

1. **Ethnicity is optional, explained and erasable**, used only to pick the
   onboarding's suggestions and never shown; consent is a column, not a
   checkbox remembered in the client.
2. **An anchor never fades** — it sits in the profile's explicit class; the
   taste it supports decays like any other evidence only once the anchor is
   removed.
3. **The 18+ gate reads the birth date the account gave**; a device cannot
   transact at all. A gift is a transfer of a thing and is gated like a sale.

## Proof

`tests/identity-commerce.test.js`, `tests/passport-onboarding.test.js`,
`tests/behind-the-upload.test.js`, `tests/friends-and-outbox.test.js`,
`tests/helpers/identity-scenario.mjs` (mem/pg differential in
`tests/postgres-integration.test.js`); `npm test`, `npm run build` and
`npm run v2:check` green at each commit.
