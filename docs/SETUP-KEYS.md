# Key setup runbook — embeddings + catalog sources

Owner-only steps. Every value below is a SECRET: it goes into Vercel →
Project → Settings → Environment Variables (and `.env.local` for local dev),
never into code, chat, or a commit. After adding env vars, redeploy.

## 1. Embeddings v1 (semantic search recall)

Code is live and env-gated: with no key, nothing changes; with a key, search
gains a "semantic match" recall channel and the backfill script works.

**Recommended: Voyage AI** (purpose-built embeddings, generous free tier)
1. Create an account at https://dash.voyageai.com (owner action — accounts
   and payment details are yours alone).
2. Dashboard → API keys → Create key.
3. Set env vars:
   - `EMBEDDINGS_PROVIDER=voyage`
   - `EMBEDDINGS_API_KEY=<the key>`
   - optional `EMBEDDINGS_MODEL=voyage-3.5-lite` (the default)
   OpenAI works identically: `EMBEDDINGS_PROVIDER=openai` (default model
   `text-embedding-3-small`, key from https://platform.openai.com/api-keys).
4. Backfill the catalog once (local, with DATABASE_URL set so vectors persist):
   `EMBEDDINGS_PROVIDER=voyage EMBEDDINGS_API_KEY=... node scripts/embed-catalog.mjs`
   (use `~/.local/node-v20.18.1-darwin-arm64/bin/node`; idempotent; `--force`
   re-embeds after a model change).
5. Honesty note: embeddings retrieve, they do not generate — the /settings
   "no LLM produces content" statement remains true. If you ever want that
   statement to mention the retrieval provider, say the word.

## 2. eBay Browse API (live marketplace listings)

State 10 Sep 2026: Asilummagazine LLC exists; the adapter
(`lib/ingest/ebay.js`, `lib/ingest/adapters/ebayAdapter.js`) and the
account-deletion endpoint (`app/api/ebay/account-deletion/route.js`) are
built and tested. What remains is the owner's account, the keys, and one
ruling.

**⚖ Read first.** The eBay API License Agreement (read 10 Sep 2026,
developer.ebay.com/join/api-license-agreement) forbids using eBay Content
"to train algorithms, conduct machine learning, develop synthetic data sets,
train large learning models, and/or train artificial intelligence systems."
Ingested eBay listings take the seed pipeline — `inferTags()` into the
brain vector — and the taste profile learns from what people do with them.
Whether a deterministic tag-and-graph recommender is "training algorithms"
on eBay Content is counsel's question (the same one
`docs/history/epn-terms-check-2026-08-22.md` raised for EPN). Keying the adapter is
the owner's ruling that it is not, or that the risk is accepted.

Sequence (owner + agent):

1. **Owner** signs up at https://developer.ebay.com/signin (an eBay account
   for the LLC; the developer program asks for a legal name, address and a
   use case — "marketplace listing search and display with links out to
   eBay"). Account creation and sign-in are the owner's; nothing here is
   automated.
2. **Owner** creates an application keyset: My Account → Application Keys →
   Production. This yields an **App ID (Client ID)** and a **Cert ID
   (Client Secret)**. The Cert ID is the secret: reveal → clipboard → Vercel
   `EBAY_CLIENT_SECRET`, never through a transcript. The App ID is not a
   secret and can be pasted anywhere.
3. **Account deletion notifications** (the production gate). In the portal,
   Alerts & Notifications → Marketplace Account Deletion: enter the
   endpoint `https://www.asilummagazine.com/api/ebay/account-deletion` and
   a verification token. The token must ALREADY be live on Vercel as
   `EBAY_DELETION_VERIFICATION_TOKEN` (32–80 chars of letters, digits, `_`,
   `-`) with a redeploy done, because eBay sends the challenge the moment
   the form is saved. The agent generates the token, sets it on Vercel and
   hands the same value to whoever fills the portal form. (The opt-out path
   exists for developers that "do not store any eBay data" — ASILUM stores
   listings, so subscribe rather than claim the exemption.)
4. **Env on Vercel (production):** `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`,
   `EBAY_ENV=PRODUCTION`, `EBAY_PARTNERSHIP_APPROVED=1`,
   `EBAY_DELETION_VERIFICATION_TOKEN`; redeploy (an env var does nothing
   until a redeploy — trap 109).
5. **Sync** runs through `/api/admin` `sync.run { query, limit }` (needs
   `ADMIN_TOKEN`); the default query is "designer archive fashion", 48
   items; run it per house / era query to build the catalog. Rate guards
   exist (`EBAY_USER_MINUTE_LIMIT` / `EBAY_GLOBAL_MINUTE_LIMIT`); eBay's own
   default Browse limit is per-day per keyset (raise via the portal's
   application growth check when it binds).
6. **Affiliate links** (`X-EBAY-C-ENDUSERCTX: affiliateCampaignId=…`) are
   NOT sent — EPN enrolment is a separate programme with its own ⚖ (the
   22 Aug brief). Listings link out plain until that is ruled.

## 3. Shopify Storefront (brand/boutique catalogs)

1. On the store's admin: Settings → Apps and sales channels → Develop apps →
   create an app with Storefront API scopes (`unauthenticated_read_product_*`).
2. Set `SHOPIFY_STORE_DOMAIN=<store>.myshopify.com` and
   `SHOPIFY_STOREFRONT_TOKEN=<storefront access token>`.

## 4. Pinterest OAuth (board import)

1. https://developers.pinterest.com → create app → note client id/secret;
   add the deployed origin to allowed redirect URIs.
2. Set `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`.

Until each key lands, its surface stays an honest 503/coming-soon — that is
the contract, not a bug.

## 5. Stripe (real-money checkout — risk campaign phase L2)

State 18 Aug 2026: sandbox "ASILUM" exists (test mode); the engine is
built and verified end to end in test mode. `STRIPE_SECRET_KEY` (sk_test_) in
`.env.local` locally. Business verification in the Stripe dashboard is the
owner gate to LIVE keys — do not start it from a session.

Launch sequence (owner + agent, in order):
1. Owner completes "Verify your business" in the Stripe dashboard (live keys
   appear only after this).
2. Owner reveals + copies the LIVE secret key; it moves dashboard → clipboard
   → Vercel env var (`STRIPE_SECRET_KEY`), never through a transcript. While
   revealed on screen, do not screenshot.
3. Dashboard → Webhooks → add endpoint
   `https://www.asilummagazine.com/api/stripe/webhook`, events
   `checkout.session.completed` + `checkout.session.expired` +
   `payment_intent.succeeded` + `payment_intent.payment_failed` (the last
   two settle the §6 ticket-fee lane); its signing secret becomes
   `STRIPE_WEBHOOK_SECRET` in Vercel the same way.
3b. The PUBLISHABLE key (safe to be public — it ships in the client
   bundle): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — pk_test_ into
   `.env.local` for sandbox work, pk_live_ into Vercel at launch. Without
   it the checkout housing's card entry says so and stays idle (saved-card
   one-click and every server path work regardless).
4. `supabase/schema-v31-orders.sql` must be applied before the first real
   order (orders + append-only order_events).
5. Until phase L1 lands real inventory, every checkout refuses with 409 by
   construction — the honesty gate (`refusalReason` in lib/orders.js) only
   passes items with a live source URL, non-seed source, `available` status
   and a real price. No flag exists to bypass it; keep it that way.

PCI posture: SAQ-A — Stripe-hosted checkout page, card data never touches
ASILUM servers or this repo. The delegated-card architecture is permanently
refused (risk campaign §3).
