# eBay Buy API production access + Feed entitlement — the application packet

**Why this file exists (1 Oct 2026).** The bulk feed path is built end to
end (`docs/EBAY-BULK-LAUNCH.md`): stager, publisher, worker, steward check.
Every one of them refuses to run until four attestations are true, and two
of those are eBay's to grant, not ours to set. The steps below need the
owner's eBay sign-in (OAuth is the owner's — see the standing rule), so
this packet does everything around that: the sequence, the exact text to
paste, what each form asks, and how to verify each step landed. Nothing in
this file is partnership evidence; the links are where eBay states the
requirements, checked 1 Oct 2026.

## The four gates, and who sets each

| Gate | Env var | Who | Evidence it is true |
| --- | --- | --- | --- |
| Production keyset | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`, `EBAY_ENV=PRODUCTION` | owner pastes (secret) | already in `.env.local` since 10 Sep (first light ran on production) |
| Buy API production approval | `EBAY_PARTNERSHIP_APPROVED=1` | owner, AFTER eBay's email | the EPN approval email + the Developer Support ticket closed as "enabled" |
| Feed entitlement | `EBAY_FEED_APPROVED=1` | owner, AFTER eBay grants Feed | Feed Beta access shows in the keyset's API access list; `GET /buy/feed/v1_beta/item?...` answers 200/206, not 403 |
| Publication (this repo) | none — `npm run ebay:publish` / `ebay:worker` | operator | checkpoints in `ebay_feed_checkpoints`; the steward's `data.ebay-feed` |

Never set a flag to make a check pass. `npm run ebay:feed -- --status`
reports the local configuration only and says so.

## Step 1 — eBay Partner Network (EPN) account

- https://partnernetwork.ebay.com → Join. Business name **ASILUM**, the
  production site `https://www.asilummagazine.com`, category
  "Fashion / Apparel", traffic source "owned website / app".
- Accept the Network Agreement. **Read §"Prohibited AI Uses" before
  accepting** — it is the clause `docs/epn-terms-check-2026-08-22.md`
  flags: eBay Data may not improve a recommender or be exposed to a
  foundation model without written approval. The feed publisher is built
  so that no eBay text or image enters tag inference, colour analysis,
  embeddings or any model (`tags: {}`); the Browse path on `main` still
  does (`lib/ingest/adapters/ebayAdapter.js` header) — that is the open
  ruling, not this packet's to make.
- Verify: EPN dashboard shows an approved publisher account and a
  **Campaign ID**. Note the Campaign ID — the feed's `itemAffiliateWebUrl`
  carries it, and the publisher stores that URL as the piece's link.

## Step 2 — the Buy API application (through EPN)

Where: EPN → Tools → "eBay Buy API application" (the form eBay names in
https://developer.ebay.com/api-docs/buy/buy-requirements.html).

Paste-ready answers (edit the bracketed parts only):

> **Application name:** ASILUM
> **Developer account:** [the eBay developer username that owns the keyset]
> **Website:** https://www.asilummagazine.com
> **Description:** ASILUM is a fashion discovery magazine and catalog. It
> lists clothing and footwear from eBay sellers alongside editorial and
> designer references, shows each listing with its seller, condition,
> price in the original currency and the eBay item page, and sends the
> buyer to eBay to complete the purchase. Checkout, payment, shipping and
> returns stay with eBay and the seller.
> **APIs requested:** Browse API (item summary search, item detail, for
> listing display and availability re-checks); **Feed API Beta — Item,
> Item Group and Item Snapshot feeds for category 11450 (Clothing, Shoes &
> Accessories), marketplace EBAY_US** — for a bounded daily catalog mirror
> with hourly availability updates. No Order API, no checkout scopes.
> **Affiliate tracking:** implemented — every outbound link is the
> `itemAffiliateWebUrl` from the feed (or the Browse `itemAffiliateWebUrl`
> with the EPN Campaign ID [ID]) and no link bypasses it.
> **Data use:** display and search within ASILUM; refreshed from the feed's
> daily and hourly files; a listing that ends or becomes unavailable is
> marked so from the feed, never guessed. eBay data is not used to train
> or improve any model and is not sent to a third-party AI service.
> **Storage:** listing records are kept while active and marked ended or
> removed when the feed says so; images are referenced by eBay's URLs,
> never copied or altered (`imageAlteringProhibited` is honoured).
> **Expected volume:** category 11450 bootstrap weekly, one daily file per
> day, up to 24 snapshot files per day; Browse calls under [N]/day.
> **Sandbox:** the application is reviewable at
> [preview URL] with `EBAY_ENV=SANDBOX` (set `EBAY_ENV` to `SANDBOX` on a
> preview deployment before submitting; the reviewer must see a working
> app).

Verify: the EPN approval email (within 10 business days per eBay). Keep
it — step 3 wants it attached.

## Step 3 — the Developer Support ticket

Where: https://developer.ebay.com/my/support → new ticket, "Buy APIs
production access".

> Subject: Buy API production access + Feed API Beta entitlement — ASILUM
> magazine
> Body: EPN approval attached (date, campaign ID [ID]). Keyset: [App ID /
> client ID — never the secret]. Requesting production enablement for the
> Browse API and the Feed API Beta (Item, Item Group, Item Snapshot) for
> category 11450 on EBAY_US. Affiliate tracking is implemented on every
> outbound link. The application is reviewable at [preview URL].

eBay may ask for changes; answer in the ticket. When they return
contracts, sign and return them; production access is enabled after that.

Verify: in https://developer.ebay.com/my/keys the production keyset lists
the Buy APIs; a `client_credentials` token with scope
`https://api.ebay.com/oauth/api_scope/buy.item.feed` is issued (a 400
`invalid_scope` means Feed is not yet granted).

## Step 4 — flip the two flags (owner paste), then verify

On the worker host's `.env.local` (and nowhere a browser can read):
`EBAY_PARTNERSHIP_APPROVED=1` and `EBAY_FEED_APPROVED=1`.

Then, in order:

1. `npm run ebay:feed -- --status` → `ready: true`.
2. `npm run ebay:worker -- --output /durable/ebay --category 11450 --dry`
   → the plan says `bootstrap: true`.
3. `npm run ebay:feed -- --category 11450 --marketplace EBAY_US --scope ALL_ACTIVE --output /durable/ebay`
   → a directory with `items.tsv.gz` and `manifest.json` (`lastModified`
   set). **Open the file's header row and compare it with the column
   names the mapper reads** (`lib/ingest/ebayFeedPublish.js`
   `REQUIRED`); the parser folds case but a renamed column shows as
   `header lacks …`.
4. `npm run ebay:publish -- --dir <that directory> --limit 500 --dry` →
   rejections by reason; then without `--dry`.
5. `npm run steward` → `data.ebay-feed` reads the counters.
6. Schedule `npm run ebay:worker -- --output /durable/ebay --category 11450 --once`
   hourly on the durable host (cron), or run it with `--loop --interval 60`.

## What this does not do

It does not grant anything. Until eBay's email and the Feed scope token
exist, the flags stay `0`, the worker refuses to run, and the steward's
`data.ebay-feed` reports "no feed rows yet" as a note, not a failure.
