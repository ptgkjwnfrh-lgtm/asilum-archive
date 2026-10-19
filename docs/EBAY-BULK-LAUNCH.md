# eBay-first catalog launch

The owner wants substantial eBay clothing supply before recruiting stores in
person, followed by proxy shopping. Existing Browse search only retrieves one
page (at most 50 items). Repeated search calls are not a complete catalog mirror.

## What this change actually delivers

`npm run ebay:feed -- --status` reports configuration without network calls or
secret values. It does not claim that eBay has verified the entitlement.

`npm run ebay:feed -- --category 11450 --marketplace EBAY_US --scope ALL_ACTIVE --output /durable/ebay`

The worker downloads an approved Feed Beta category archive with sequential
byte ranges, checks range continuity, total length and revision consistency,
verifies gzip integrity, then atomically promotes an archive and manifest.
It streams to disk rather than loading the category into memory. Failed runs
remove partial files and can be restarted; byte-level resume is not implemented.
Completed runs have distinct directories and do not overwrite each other.

Daily new-listing files use `--scope NEWLY_LISTED --date YYYY-MM-DD`.
Default safety limits are 10 GiB compressed and 100 GiB expanded per file; a
larger file fails explicitly. The library options allow deliberate adjustments.
Run on durable worker storage, not a short-lived Vercel request.

The existing OAuth helper now caches separately for scope, environment and
credentials. Browse still defaults to its original scope; Feed requests
`https://api.ebay.com/oauth/api_scope/buy.item.feed`.

## The publisher (1 Oct 2026, owner brief §15 points 2–5)

`npm run ebay:publish -- --dir /durable/ebay/ebay-feed-XXXX [--limit N] [--dry]`

`lib/ingest/ebayFeedPublish.js` streams a staged `items.tsv.gz` (gunzip →
lines, never the file in memory), reads the documented Feed Beta columns by
name (`buy_feed_v1_beta_oas3.json`, Item and ItemSnapshot schemas; the
Title quoting rule; base64 `localizedAspects`), maps each row through the
catalog's one normalizer and writes in batches of 500 through a
STALE-GUARDED upsert (`lib/db/production/ebayFeed.js`, schema v56): a row is
written only when its observation is newer than the row's, or the same
moment with a `sellerItemRevision` that is not older. An older bootstrap
re-run after a daily file cannot roll a price back; the count of rows it
would have rolled back is reported as `rowsStale`.

Every file has a checkpoint keyed by the manifest's sha256
(`ebay_feed_checkpoints`): rows read, upserted, stale, rejected BY REASON,
and the last line. A killed run resumes; a finished file re-run is a
no-op; `--limit` bounds a run and leaves the checkpoint `running`.

**Not an AI path.** The mapper hands the normalizer `tags: {}` — no
`inferTags` over eBay text; it never calls `verifyProductColors`, never
fetches an image, never names a brand from a title (the `brand` column or
"Unknown"), never assigns an era. The typed `product_tags` it writes are
the source's own facts (brand, category, condition, material) through the
vocabulary. Rows therefore carry no aesthetic vector: they reach the
catalog lane and search, not the taste ranking. Whether eBay rows may ever
feed the recommender is the EPN Prohibited-AI-Uses question in
`docs/history/epn-terms-check-2026-08-22.md`, unchanged by this.

**Availability words stay apart**: AVAILABLE → `available`;
TEMPORARILY_UNAVAILABLE / UNAVAILABLE → `unavailable`; a snapshot's
ENDED → `ended`, DELETED → `removed`. Nothing here says `sold`.

**The worker (1 Oct 2026, point 4).** `npm run ebay:worker -- --output
/durable/ebay --category 11450 [--once | --loop --interval 60] [--dry]
[--status]` — `lib/ingest/ebayFeedWorker.js`. A pure planner reads a state
file on the durable host and says what is due: the bootstrap when none is
applied or it is over 7 days old; then the daily files the window still
serves (at most 4 per tick), in date order, applied once each; then the
hourly snapshots from the hour after the latest observation applied, at
most 6 per tick, never older than the feed's 7-day retention. A tick
stages and publishes each file and writes the state back after every one;
a 204 (nothing changed that hour / no new listings that day) is recorded
as empty; a failure stops the tick, is recorded with its message, and the
next tick retries the same file — the publisher's checkpoint makes that
idempotent. A daily date that fell out of the window before it was
applied is recorded as a GAP; the next bootstrap closes it. The steward's
`data.ebay-feed` check reads the checkpoints and the lag. Run it on a host
with disk and time (cron `--once` hourly, or `--loop`), never from a web
request. Nothing has run: the gates are not granted
(`docs/EBAY-FEED-ENTITLEMENT.md`).

**Catch-up (the plan the worker uses).** `--plan --since <bootstrap
Last-Modified>` lists the daily NEWLY_LISTED dates still fetchable (the
feed serves a daily file only 3–14 days after its date), the ones not yet
served, and the ones lost to the window — a gap the next bootstrap closes.
The stager now sends the daily `date` as `yyyyMMdd` on the wire (the first
cut sent `YYYY-MM-DD`) and can stage an hourly snapshot
(`feedScope: "SNAPSHOT"`, `snapshotHour: "YYYY-MM-DDTHH"`); the publisher
reads snapshot rows (`itemSnapshotDate`, `changeMetadata`). The worker above runs the plan.

**Verification:** `tests/ebay-feed-publish.test.js` — memory mode end to
end over a synthetic gzip TSV fixture; the SQL stale guard mirrors the
pure `observationWins` the tests pin. No live feed file has been read.

## Access needed

Configure production credentials securely, `EBAY_ENV=PRODUCTION`, the existing
`EBAY_PARTNERSHIP_APPROVED=1` attestation and **separate**
`EBAY_FEED_APPROVED=1` only after eBay grants the relevant entitlement.
These flags do not create permissions or authorize AI processing. No flags
or credentials were set by this change.

## Deliberate publication boundary

Downloaded data is **staged, not published**. No database rows are written, no
photos are fetched, and no tags, model training, embeddings or ASTERISK calls
are run. Current catalog normalization invokes tag inference and the shared
sync path invokes image-color analysis. Do not route large eBay feeds through
that path until the permitted processing is established. This change does not
claim to have resolved those permissions for the existing Browse path.

Next implementation gates, once actual access/schema are available:

1. Validate an actual authorized feed schema and variation identifiers. Reuse
   `normalizeEbayItem` / shared source identity where the processing is approved;
   never fabricate title-derived brands or missing availability.
2. Add a transactional, bounded publisher using existing `items`,
   `product_images`, source IDs and sync logs. Persist per-source checkpoints
   and prevent older files overwriting newer listings. Do not create a parallel
   public catalog or load every item into the existing in-memory seed array.
3. Apply daily catch-up from the bootstrap Last-Modified date, then hourly
   snapshots including ended items and changed variations. This downloader
   currently supports bootstrap and daily files, not snapshot processing.
4. Recheck availability before purchase handoff. Measure usable active items,
   refresh lag, gaps, removed inventory and API quota failures.
5. Keep proxy ordering disabled until an actual partner grants the necessary
   catalog/order access and the fees, warehouse and shipping flow are defined.

## Review and rollback

Declared test criteria: no network without attestations, correct file bytes,
scope/environment cache isolation, rejection of corrupt/partial/changing feeds,
and no promoted output after failure. Tests use synthetic gzip fixtures explicitly
as fixtures, never as catalog inventory. No live API, DB or proxy testing is
claimed. Disable the new worker by leaving EBAY_FEED_APPROVED unset; existing
Browse routes remain unchanged. No migration or production backfill occurs.

## Primary references checked October 1, 2026

- https://developer.ebay.com/api-docs/buy/buy-requirements.html
- https://developer.ebay.com/develop/guides/buy/inventory-discovery-and-refresh-guide
- https://developer.ebay.com/api-docs/buy/static/api-feed_beta.html
- https://www.ebay.co.jp/developer/api/feed_beta_api_buy/documentation
- https://github.com/eBay/FeedSDK
- https://partnernetwork.ebay.com/page/network-agreement

Bulk feeds cover eligible items in approved marketplaces/categories, not a
guarantee of every worldwide clothing listing.
