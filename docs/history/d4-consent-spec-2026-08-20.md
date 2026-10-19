# D4 — the first-visit consent moment (spec for approval)

**Ruled by the owner 20 Aug 2026: option (b).** Observation — the Asterisk
system reading dwell, saves, skips, and impressions into a Passport —
starts only after the reader answers a consent moment on first visit.
(Risk campaign §8 D4, annotated RULED; recommendation was (b) for
EU-safety and F65 optics; counsel still confirms per OWNER-DECISIONS #1's
region ruling.)

**Status: ✅ BUILT (owner order "build p2-p4 and the consent moment",
20 Aug 2026, same night).** Shipped exactly to this spec's behavior
contract: server-enforced UNANSWERED = UNOBSERVED (interaction /
impressions / feed serve-memory / train / moodboard all gated through
`lib/consent.js`), GENERAL ≡ the settings pause's long-standing split
(explicit acts teach, passive dwell does not), the shell-mounted moment
(`app/components/ConsentMoment.jsx` — answered, never dismissed,
focus-trapped, reduced-motion aware), Settings-toggle continuity both
directions, terms + privacy v1.2 sentences. **VOICE PASS DONE (owner,
same night):** the moment carries the owner's words — "learns quietly in
the background… what you buy… along with the *STAMPS you choose to
upload to your *PASSPORT", the WILL-NEVER-sell promise, "seek *ASILUM or
disappear into the catalog." (owner refinement: the star rides the
bolded ASILUM), and the closer — set in the house's
lowercase prose with the owner's emphasis kept exactly, pinned by
tests/consent.test.js. Same order renamed the Passport's upload button
to "STAMP YOUR PASSPORT" (star-less by the owner's refinement; the
*STAMPS coinage stays in the moment's copy).

---

## Behavior contract

1. **Unanswered = unobserved.** A device with no consent record gets no
   observation writes: no impressions persisted, no interaction-derived
   profile mutation. The feed serves in the existing general-results mode
   (the brain-paused state that already exists) until the moment is
   answered.
2. **Shell-mounted, once — and NEVER over the front cover** (owner
   refinement, 20 Aug: the magazine's face stays clean). Desktop entry
   lands on `/cover` untouched; the first click into the CATALOG — or any
   other page — raises the question. Mobile lands on the catalog directly
   and sees it on open. Deep links to any non-cover page see it too. It
   renders once and never again after an answer.
3. **Two answers, both first-class.**
   - **OBSERVE** → observation on: the existing default machinery,
     unchanged.
   - **GENERAL ONLY** → exactly the existing Settings pause state
     (`asilum-brain-off` parity) — general results, taste record idle.
   Both are reversible any time in Settings, which already carries the
   toggle and honest copy ("paused = general results…").
4. **No trap.** The reader can keep browsing without answering (navigate,
   scroll behind it on re-offer) — but unanswered stays unobserved, so
   ignoring the moment is safe by construction, and it re-offers on the
   next visit until answered.
5. **Server-enforced, not client-polite.** Consent state lives where the
   server can see it (device cookie + `profile._meta.consent = {choice,
   at, version}`). Every observation write path checks it; client-side
   emission gating is a courtesy, not the enforcement. Responses on
   dropped observation say so explicitly (`observed: false`) — no silent
   pretending.
6. **Signed-in continuity.** sb- adoption carries the device's consent
   state; a signed-in user's choice follows their profile.

## Copy (DRAFT — owner voice pass required; copy-law: Asterisk-system
language only, bridge names never public)

> **\*THE ASTERISK SYSTEM**
> This terminal learns by observing — what you linger on, what you save,
> what you skip. It builds a Passport for this device. Nothing is sold to
> anyone. Watch, or browse general?
>
> [ OBSERVE ME ]   [ GENERAL ONLY ]
> <small>change anytime in SETTINGS · how it works → /terms</small>

## Design + a11y notes (for the owner-directed UI round)

- Phosphor-styled interstitial card over the shell; boot sweep completes
  first (the moment must not fight the landing motion).
- Focus-trapped dialog with the two buttons; **no click-away dismissal**
  (a consent moment is answered, not dismissed) — it therefore does NOT
  join the `useOverlayDismiss` five; Esc/blur leaves it unanswered =
  unobserved, which is the safe state.
- Screen-reader order: title → body → buttons; the AT ghost-click guard
  lesson (trap 21) applies to whatever control opens Settings from it.

## Known traps to design around (from the handovers)

- The feed's observation writes fire on view — the server-side consent
  check must sit in the write path itself, not in page code.
- Shell loses a Suspense-commit race on hard loads (19 Aug trap) — the
  consent flag must resolve before observation batching starts, not
  before paint.
- Script-opened tabs inherit `sessionStorage`; consent must live in the
  device cookie/profile, never sessionStorage.
- `innerWidth = 0` in unlaid-out tabs — nothing about consent may depend
  on layout.

## Build checklist (post-approval, owner-directed UI round)

- [ ] Server: consent gate in every observation write path (impressions,
      interaction-derived mutation), mem + pg parity.
- [ ] Client: the moment component (shell), emission gating, Settings
      continuity both directions.
- [ ] Tests: no-consent device → zero observation rows; OBSERVE → rows
      resume; GENERAL ONLY ≡ existing pause; copy-law test extended to
      the new copy; a11y pass.
- [ ] `/terms` sentence naming the consent moment (same Gate 3 owner UI
      round that publishes the refund policy).
- [ ] ⚖ Counsel confirm per launch regions (OWNER-DECISIONS #1).
