# ASILUM AI Foundation (Day 9) — the mini-GPT seam

The production-ready layer where a real model (OpenAI / Anthropic / Gemini /
local / custom fashion model) plugs into the Mood Board and Stylist WITHOUT
rewriting the app. **No model is connected today. Nothing fakes one.**

## What is REAL right now
- **Local fashion interpreter** (`lib/ai/localFashionInterpreter.js`): rule-based
  analysis of every mood-board upload — lexicon words from captions/notes/
  filenames, palette-v0 color statistics, taxonomy matching for silhouettes/
  fabrics/eras/moods. Humble by design (confidence caps at 0.6, summaries say
  "colors and words only").
- **Mood-board analysis records** (`mood_board_analysis`): every pass persisted
  with `analysis_source: "local-rules"` — items can be RE-analyzed when a
  model arrives.
- **User style profiles** (`user_style_profiles`, `lib/ai/styleProfile.js`):
  deterministic aggregation of mood-board tags + analyses, the live brain
  taste vector, saved board items, and stylist feedback (rejections feed
  `avoided_tags`). Auto-rebuilt on upload and when stale (>10 min).
- **Stylist reasoning engine** (`lib/ai/stylistReasoningEngine.js`): real
  tag-based outfits via the live slot/coherence engine (`lib/brain/stylist`),
  filtered to AVAILABLE, visible, budget-fitting, non-excluded products;
  scored against the style profile; persisted with color/silhouette/aesthetic
  reasoning and warnings.
- **Feedback loop** (`stylist_feedback`): like/save/reject/purchase per outfit
  (ownership-checked); rejections push matched tags into `avoided_tags`.
- **Model event log** (`ai_model_events`): every future model call/failure
  audited; adapter writes it automatically.

## What is DISABLED until a key + flags exist
- The **anthropic** provider in `lib/ai/adapter.js` is IMPLEMENTED (Day 10 —
  Asterisk AI) but fully flag-gated: no key, no flags, no calls, no fake
  output. openai/gemini/local remain deliberate `not implemented` throws.
- Model-written taste summaries, image understanding beyond color, designer
  reference detection, model-built outfits.

See `docs/ASTERISK-AI.md` for the full Asterisk AI architecture (ontology,
dual tagging, learned facts, moderation).

## How to enable AI (safely)
1. Provider function exists for anthropic; others need a reviewed PR first.
2. Set env (server-only, never NEXT_PUBLIC): `AI_FEATURES_ENABLED=true`,
   `AI_PROVIDER=anthropic`, `AI_MODEL_NAME=…`, `AI_API_KEY=…`, plus
   `AI_MOOD_BOARD_ENABLED=true`, `AI_STYLIST_ENABLED=true`, and/or
   `AI_TAG_AUDIT_ENABLED=true`.
3. That's it — `analyzeMoodBoardItem` and `generateStylistOutfits` already
   route through `runModel()`, validate output (`lib/ai/validate.js` — shape
   check, tag normalization, **product ids restricted to the real candidate
   set**), log to `ai_model_events`, and fall back to local rules on any
   failure. Keys never reach the client (no NEXT_PUBLIC, no client imports).

## Map
| Piece | File |
|---|---|
| Config/gating | `lib/ai/config.js` (all flags default off; app never crashes without them) |
| Adapter seam | `lib/ai/adapter.js` (`runModel`) |
| Prompt versions | `lib/ai/promptVersions.js` (V1 templates demand strict JSON) |
| Output validation | `lib/ai/validate.js` |
| Local fallback | `lib/ai/localFashionInterpreter.js` |
| Mood Board service | `lib/ai/moodBoardAnalyzer.js` |
| Style profile service | `lib/ai/styleProfile.js` |
| Stylist service | `lib/ai/stylistReasoningEngine.js` |
| DB CRUD | `lib/db/production.js` (AI-foundation section) |
| Schema | `supabase/schema-v3-ai.sql` (applied; 29 public tables) |
| Routes | `POST/GET /api/style-profile`, `POST /api/stylist` (request + feedback), `/api/moodboard` (analysis wired in) |
| Admin inspect | `/api/admin` actions: `ai.events`, `ai.analyses`, `ai.profile`, `ai.config`, `stylist.feedback` (needs `ADMIN_TOKEN`) |

## Tables added (schema-v3)
`mood_board_analysis`, `user_style_profiles`, `stylist_requests`,
`stylist_feedback`, `ai_model_events`; `stylist_outfits` extended
(request link, name/summary, matched_tags, three reasoning fields, model
columns); `mood_board_uploads` extended (`user_notes`, `source_url`,
`updated_at`). `mood_board_uploads` doubles as `mood_board_items` — the typed
tags array (`tag_type`: manual/aesthetic/palette/color/silhouette/fabric/
mood/era/designer-ref/…) covers the per-type tag columns.

## Notes
- Identity: every new route resolves the user from proof (`resolveRequestUser`),
  same as the rest of the app since #12.
- All new UI-facing behavior is backend-only; zero UI changes.
- Error posture: services return `{ok:false, error}` — routes map to honest
  HTTP codes; upload analysis failures write a `failed` analysis row and never
  break the upload.
