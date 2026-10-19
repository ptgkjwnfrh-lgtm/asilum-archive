# ASILUM — test coverage audit (16 August 2026)

**The question:** *what has no test at all?*

This is deliberately not the question `docs/history/audit-tests-supabase-2026-08-15.md`
asked. That audit read the existing tests and asked whether their assertions
could fail — it found three real defects and confirmed the suite was honest
about what it covers. It could not, by construction, say anything about code no
test ever touches. 580 passing tests say nothing about the parts of the system
they never reach.

**State audited:** `main = d1fe071`. 111 modules under `lib/`, 37 API routes,
77 test files.

---

## Method, and what it cannot tell you

Purely static. Nothing was executed; no code was changed to produce this.

For every module under `lib/` and every `app/api/**/route.js`, the audit asks
whether any file under `tests/` reaches it — by static import, dynamic import,
or (for routes) by naming its path. Then, for modules tests *do* import, which
exported symbols are never named anywhere in `tests/`.

**A named symbol is not proof of a test.** A symbol can be mentioned in a
comment, or imported and never asserted on. So every number here is a **floor**:
a symbol never mentioned in `tests/` cannot possibly be covered, but one that is
mentioned is not thereby covered. Read the counts as "at least this much is
missing", never as "the rest is fine".

Two claims below were checked by hand rather than trusted from the scan, because
the scan's import matcher missed relative `./x.js` imports and produced false
"unused" verdicts. Those corrections are marked.

---

## ▶ FINDING 1 — Not one API route handler is ever invoked. 0 of 37.

This is the headline and it is not a matter of degree.

- **No test file imports a route module.** Zero occurrences of an import
  resolving to `app/api/**/route.js`.
- **No test file calls a route handler.** Zero invocations of `GET(`, `POST(`,
  `PATCH(`, `PUT(`, `DELETE(` against a `Request`.
- **Six test files read route source as *text*** and assert against it with
  regexes — `perf-read-paths`, `analytics-honesty`, `recommendation-exclusions`,
  `observation-honesty`, `sign-out-notice`, `prompt-overlay`.
- **24 of 37 routes are not mentioned even as a string.**

So the entire HTTP surface — request parsing, identity gating, status codes,
error shapes, the `{ok:false, error}` → honest-HTTP-code mapping that
`ASTERISK-AI.md` §14 describes as a contract — is verified by reading the source
code as a string, or not at all.

This matters more than the raw count because of a trap this project already hit.
the 15 Aug 2026 notes records a structural guard whose regex matched an
unrelated `neighbors:` fifteen lines away, so it stayed green with the fix
reverted. Source-as-text assertions fail in exactly that direction: they pass
when they should fail. A route test that invokes the handler cannot.

The 24 unmentioned routes, with their verbs:

| Route | Verbs | loc |
|---|---|---|
| `/api/admin` | GET, POST | 375 |
| `/api/editorial` | GET, POST, PATCH, DELETE | 235 |
| `/api/profile/room` | GET, POST | 202 |
| `/api/tickets` | — | 192 |
| `/api/boards` | GET, POST, DELETE, PATCH | 171 |
| `/api/moodboard` | POST, GET | 152 |
| `/api/wardrobe/photo` | POST, DELETE | 151 |
| `/api/business` | GET, POST | 125 |
| `/api/wardrobe` | GET, POST, PATCH, DELETE | 108 |
| `/api/privacy` | GET, DELETE | 92 |
| `/api/search` | GET | 88 |
| `/api/stylist` | POST | 87 |
| `/api/editorial/engage` | GET, POST | 74 |
| `/api/follow` | — | 71 |
| `/api/why` | — | 69 |
| `/api/asterisk/memory` | — | 68 |
| `/api/ebay` | GET | 61 |
| `/api/discover/rails` | GET, POST | 61 |
| `/api/measurements` | — | 52 |
| `/api/connect` | POST | 49 |
| `/api/ingest` | POST | 47 |
| `/api/suggest` | GET | 46 |
| `/api/style-profile` | — | 44 |
| `/api/reset` | POST | 30 |

`/api/admin` is the largest and the most consequential: it is the only writer of
moderation decisions and `ADMIN_TOKEN` is its only gate. `/api/privacy` carries
the §18 delete/export obligations. Neither is exercised.

## ▶ FINDING 2 — 34 of 111 `lib/` modules are never imported by any test

Of those, **28 are live** — imported by `app/` or by other `lib/` modules. The
rest are unreferenced and are a different conversation (see Finding 4).

The ones that stand out, by consequence rather than size:

| Module | loc | Why it matters |
|---|---|---|
| `lib/ai/contract.js` | 25 | **10 importers.** This is the honesty contract — `ARCHITECTURE-MAP` calls it the thing that makes "fake AI structurally impossible". `notImplemented`, `mockMarked` and `real` are never named in any test. The guarantee the whole AI seam rests on is itself unverified. |
| `lib/ai/validate.js` | 107 | Validates **untrusted model output** — `validateTagAuditOutput` is what stops a model claiming `confirmed`/`verified`, per §8. Never directly tested. |
| `lib/social.js` | 373 | **16 importers, all from `app/`.** The client-side wire/post layer. |
| `lib/vision/palette.js` | 273 | 5 importers from `app/`. The Aug-14 audit already found a real defect here — the `/upload` palette trained on a top-left **corner crop** rather than a downsample. That bug shipped because nothing tested this file, and nothing still does. |
| `lib/ai/styleProfile.js` | 117 | 7 importers, 3 from `app/`. |
| `lib/asterisk/tagAudit.js` | 167 | `auditProductTags` — the dual-tagging entry point in §7. |
| `lib/uilab.js` | 176 | Parses and applies persisted overrides, including `sanitizeImport`. |
| `lib/ai/adapter.js` | 138 | `runModel` — the single seam every provider call goes through. |

`lib/vision/palette.js` is the strongest argument in this document. The gap is
not hypothetical there; it has already cost one shipped defect.

## ▶ FINDING 3 — 209 of 599 exported symbols in *imported* modules are never named

These are modules tests do reach, with exports they never mention. Worst offenders:

| Module | never named / total |
|---|---|
| `lib/db/production.js` | 46 / 111 |
| `lib/client.js` | 22 / 27 |
| `lib/db/index.js` | 21 / 51 |
| `lib/embeddings/index.js` | 7 / 10 |
| `lib/profile/rooms.js` | 7 / 16 |
| `lib/vision/embed.js` | 6 / 16 |
| `lib/ai/stylistReasoningEngine.js` | 5 / 9 |
| `lib/identity.js` | 5 / 6 |
| `lib/ingest/ebay.js` | 5 / 6 |
| `lib/wardrobe/photos.js` | 5 / 12 |

`lib/identity.js` deserves its own line: **`resolveRequestUser` is never named in
any test.** `asilum-architecture` states it runs on every gated route and that a
client-claimed uid must never be trusted. That rule has no executable check.

`lib/client.js` at 22/27 is partly explicable — it is browser-side and the suite
is node — but it is also where `getUid`/`setUid` live, which is identity.

## ▶ FINDING 4 — three modules nothing imports at all

Verified by hand; the scan's first pass was wrong about several others.

| Module | loc | Status |
|---|---|---|
| `lib/ai/search-adapter.js` | 31 | Referenced only in **comments** in `lib/search/index.js`. Never imported. |
| `lib/mock-data/index.js` | 16 | Referenced only in a comment in `lib/ai/index.js`. |
| `lib/visual-personalization/index.js` | 50 | Referenced only in comments in `lib/connectors`, `lib/feed`, `lib/ai/index.js`. |

`lib/embeddings/provider.js` looked unreferenced too but is **not** — it is
imported by `scripts/embed-catalog.mjs`. Embedding vectors are generated
offline by that script and read from the `embeddings` table at runtime, so a
build-time-only module is correct here, not dead.

These three are documented-as-future surfaces, consistent with the honesty
contract, so this is not an accusation of dead code — but they are counted in no
coverage denominator and should not flatter one.

**Corrections to the scan, recorded so nobody re-derives them:** the matcher
missed relative `./x.js` imports and initially reported `localFashionInterpreter.js`,
`cultureSchema.js` and `ingest/adapters/types.js` as unreferenced. All three are
live (`moodBoardAnalyzer.js`, `research.js`/`culture.js`, and `adapters/index.js`
respectively).

## ✅ What is clean

- **The unbounded-regex trap is not still open.** Every remaining `[\s\S]*?` in
  `tests/` is inside a comment-stripping helper, which is a bounded and correct
  use. The one dangerous instance was fixed and is recorded in a comment at
  `tests/perf-read-paths.test.js:215`.
- **`mem-pg-parity` gains profiles coverage.** On the audited `main` it covers
  only tickets and wardrobe — a real hole, given law 4 says mem and Postgres are
  one system with two implementations and mem is the one being exercised. The
  audit #12 residual work adds a taste-vector parity test; that lands with
  PR #203, not on the state audited here.
- The previous audit's conclusions still hold: RLS and a primary key on every
  table, all skips legitimate, no test without an assertion.

---

## Recommended order

Ranked by consequence per unit of work, not by size.

1. **A route-invocation harness.** One helper that builds a `Request`, calls the
   handler, and asserts status and body shape. Until it exists, every route test
   will keep being a regex over source. Start with `/api/admin` (moderation
   writes, `ADMIN_TOKEN` the only gate) and `/api/privacy` (§18 delete/export).
2. **`lib/ai/contract.js`.** Twenty-five lines. The claim "fake AI is
   structurally impossible" should cost about an hour to make executable, and it
   is the foundation the rest of the AI seam is argued from.
3. **`lib/vision/palette.js`.** The only file here with a *proven* history of
   shipping a defect into production under no test.
4. **`resolveRequestUser`.** One test that a client-claimed uid is not honoured
   would pin a stated architectural invariant.
5. **`lib/ai/validate.js`.** Model output is untrusted input; the validator that
   enforces the certainty vocabulary should be the least trusting code in the
   repo and is currently the least checked.

Items 2–5 are ordinary unit tests. Item 1 is the one that changes the shape of
the suite, and everything about the HTTP surface stays guesswork until it lands.

## Scope

Deliberately not covered: `app/` components and pages (a different discipline —
the suite is node, not a browser renderer), and whether existing assertions are
*strong*, which the Aug-15 audit already answered for the tests that exist.
