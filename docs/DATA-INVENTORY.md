# Data Inventory, Purposes & Retention Draft

Constitution v2 §6 binds this register; the retention column remains the
retention matrix and stays DRAFT until owner decision 10 (search_logs is
the one class where inaction accrues risk — unbounded today).

Phase 0 register of every personal-data class the system holds today plus
the classes the roadmap adds. Retention values marked DRAFT are engineering
proposals — final periods are owner decision #10 with counsel.

## Held today

| Data class | Store | Purpose | Access | Retention (DRAFT) | User controls today |
|---|---|---|---|---|---|
| Pseudonymous device identity `u-<uuid>` | HMAC cookie + `profiles`/`user_events` | recommendations | server-only resolution | life of profile; deleted via privacy delete | `/api/privacy` delete |
| Account identity `sb-<uuid>` | Supabase Auth + adoption records | login, taste continuity | server-verified bearer | account lifetime | sign-out; deletion flow TBD (gap) |
| Taste profile (tag weights, two-timescale) | `profiles`, `user_style_profiles` | ranking, stylist | server-only | active + decay (6-day half-life); privacy delete | reset brain, privacy delete, corrections |
| Canonical behavior events (20 types) | `user_events` | learning history | server-only | DRAFT: 24 months → aggregate | privacy delete |
| Interactions log | `interactions` | orders view, graph | server-only | DRAFT: 24 months | privacy delete |
| Search queries (+uid when proven) | `search_logs` | search quality | server-only | DRAFT: 90 days raw → aggregate | none yet (gap: retention notice) |
| Corrections | `user_corrections` | personal retraining, moderation | server-only | account lifetime | visible via /api/why history |
| Measurements (body) | v12 measurements store | first-party fit ONLY — never external (invariant) | server-only, never in model payloads | until user clears | `/api/measurements` PUT/clear |
| Wardrobe items + garment photos | `wardrobe_items` + private Supabase Storage | owned-piece styling and color statistics | owner-only server routes; 5-minute signed URLs | until piece or personalization deletion | per-upload consent; erase photo/piece; privacy delete |
| Profile room (handle, theme, statement, anthem picks) | `profile_rooms`/`profile_modules` (account-uuid keyed, ADR-002) | user-authored public profile page | server-only; PUBLIC once published + moderation-visible | account lifetime | publish/unpublish, edit, privacy delete; statement screen → human review |
| Brand cases (opener id, evidence URLs, transition ledger) | `brand_cases`/`brand_case_events` | trust & impersonation adjudication | operator-only (admin token) | operational record — NOT purged by privacy delete (trust/audit basis; counsel to confirm period) | none (operator data; reporter ids appear as opener/actor) |
| Moodboard uploads (filenames, palette swatches — NO image bytes today) | `mood_board_uploads` | taste training | owner-scoped | DRAFT: account lifetime | reset/delete via privacy delete |
| Purchase tickets + user-reported outcomes | `purchase_tickets` | purchase assistance | server-only | DRAFT: 36 months | consent-gated creation |
| Native Storefront public content (name, description, public media, product facts) | `storefronts`, native listing/variant projection in shared `items` catalog | seller-authored public catalog | owner-write through authenticated server routes; allowlisted public read only while published | DRAFT: account lifetime; archive/unpublish immediately on owner action, retain audit snapshot with orders | Profile → Storefront edit/pause/archive |
| Native commerce and inventory audit (orders/units, inventory reservations, payment attempts/provider references, webhook inbox) | `orders` extensions + Storefront commerce tables (v62) | fulfilment, double-sale prevention, refund/dispute/reconciliation | buyer/seller-scoped server routes; provider/KYC/account ids never public | financial/transaction record — NOT purged by personalization delete; counsel to set statutory period | order/refund controls; retained status disclosed by privacy delete |
| One-time Storefront fee entitlement, reservations, immutable collections/reversals | `storefront_fee_accounts`, `storefront_fee_reservations`, `storefront_fee_events` | prove the $30 is collected once from eligible seller proceeds and carry remainder without negative payout | seller earnings view + operator reconciliation; reservations labelled provisional | financial/audit record — NOT purged or reset by rename/device/pause; counsel to set period | Storefront → Earnings shows target/collected/reserved/outstanding |
| Observation consent record (choice, timestamp, version) | `asilum-consent` HttpOnly cookie + `profile._meta.consent` | D4 enforcement: unanswered = unobserved; GENERAL = explicit-only learning | server-read on every observation write path | cookie 1 year; profile record for profile lifetime | the first-visit moment; SETTINGS observation toggle (both directions) |
| Buyer vault: name, address, Stripe customer/payment-method REFERENCES + card brand/last4 (never a card number — Stripe holds the card) | `buyer_vault.buyer_profiles` — own schema, apart from `public` (v35) | one-time entry at first purchase; saved-card one-press checkout | server-only; TWO doors by law (SETTINGS + first purchase), import graph enforced by `tests/vault-access.test.js` | DRAFT: until the user forgets it (SETTINGS or privacy delete); order/ticket ledgers retained as transaction records | SETTINGS → PURCHASE INFO: edit, remove card, forget everything; `/api/privacy` delete erases the vault too |
| Rate-limit subjects | `api_rate_limits` — a MIX: signed device identities (sha-256) and, only where `TRUSTED_EDGE_IP_HEADER` is configured, IP-derived values (keyed HMAC with rotatable `RATE_LIMIT_SUBJECT_SALT`, IPv6 truncated to /64) | abuse control | server-only | rate-limit window + 2-day sweep | n/a — unlinkable to a subject record and expired within 2 days (NOT because "hashed": an unsalted digest of an IPv4 address is reversible by enumerating 2^32) |
| AI model audit events | `ai_model_events` | honesty/audit | admin-only | DRAFT: 12 months | n/a |
| Direct messages: conversations, both sides' message bodies, per-side folder/read position/mute/media-consent | `dm_conversations`, `dm_participants`, `dm_messages`, `dm_reactions` (account-uuid keyed, ADR-002) | private messaging between two signed-in accounts | server-only; readable only by the two participants (membership predicate on every read, laws in triggers) | **⚖ NOT purged by privacy delete** — a message is also the other person's record of a conversation they were in, so erasing one side's copy destroys somebody else's history. Retention period undecided (OWNER-DECISIONS #10) | per-message **unsend** by its sender (immediate, no window); accept/decline a request; mute; **export via `/api/privacy` GET** — owner ruling 23 Aug: two people should have records |
| Messaging safety state: who you blocked and why | `dm_blocks` | enforcing law 1 (a block stops delivery both directions) at every write and at discovery | server-only | **NOT purged by privacy delete** — erasing it would silently reopen a door the person closed | BLOCKED list on the mail desk with an unblock control (by handle or conversation); included in the export |
| Messaging settings: door open/closed, activity signals | `dm_settings` | law 2 (a passport may close its DMs; a business may not) and law 5 (reciprocal signals) | server-only | **NOT purged by privacy delete** — both switches DEFAULT TO OPEN, so erasing the row is not neutral: it reopens what was closed | the two controls on the mail desk; included in the export |
| Typing presence | `dm_typing` | the typing indicator | server-only; refused entirely on an unaccepted or blocked conversation (v44/v46 triggers) | expires in **six seconds**; swept after one minute; deleted outright when a block is made | the activity-signals switch turns emitting AND seeing off; NOT exported — it says nothing about what was said and is gone before an export could read it |

> **IP classification (2026-08-06).** An IP address is personal data under
> GDPR, and a keyed hash of one is **pseudonymous, not anonymous**. IP-derived
> subjects exist only when a deployment names a trusted edge header; a verified
> device short-circuits before any IP is read, so the overwhelming majority of
> requests never touch one. The value never leaves the deriving function: never
> in a response, never in `user_events`/`popularity`/`edges`/either contributor
> ledger, never joined to a device or account, and never logged — including the
> fail-open log line, which carries the scope and error class only.

| Research facts / culture proposals | `learned_facts` | knowledge pipeline | admin-only | permanent (audited lifecycle) | n/a (not personal data; sources public) |

## Added by roadmap (consent & notice requirements)

| New class | Feature | Notice/consent gate before collection |
|---|---|---|
| Unknown-query samples (normalized) | A | retention notice at search; abuse screening; DRAFT 180 days |
| Interpretation feedback | A | in-flow (explicit action); follows device-to-account adoption; removed by privacy delete |
| Learning notifications | A | in-app only; user can disable |
| Memory visibility preferences | B | explicit settings |
| Wear events | C | explicit opt-in |
| Rail preferences | D | implicit UI state (non-sensitive) |
| Profile themes/media | E | moderated public content notice |
| Messages + attachments | F | full policy stack (blocked until owner decisions #2/#3 + counsel) |
| Brand verification evidence | G | business-context notice; private evidence bucket; legal-process disclosure rules |
| Security telemetry (IP-derived) | G | keyed-hash/truncate; DRAFT 90 days; access-restricted |

## Consent matrix (summary)

- **Implicit in product use**: taste events, searches (with published
  retention), rate-limit subjects including IP-derived keyed hashes.
- **Explicit per-feature consent**: measurements (exists), AI stylist/
  moodboard external-model use (`aiConsent`, exists), wardrobe photo
  upload (new), source connections (new), messaging (new).
- **Never collected**: face/biometric data from uploads; sensitive-trait
  inferences (health/religion/sexuality/ethnicity/politics) from taste
  behavior — prohibited by invariant, restated here.

## Gaps flagged for counsel / owner

1. No public Privacy Policy / ToS / AI-transparency notice yet (EU AI
   transparency obligations effective 2026-08-02).
2. Account deletion (auth-level) flow incomplete vs personalization delete.
3. `search_logs` retention is unbounded today — needs the DRAFT cap + a
   cleanup job once the owner sets periods.
4. DMCA designated-agent registration (before any user-media surface goes
   public — Feature C/E).
