# SEO notes — 16 August 2026

What ASILUM tells crawlers, and — more importantly — **what it deliberately does
not tell them.** The launch audit listed canonical URLs, OpenGraph, JSON-LD and
per-route titles as outstanding. Three of those four are now shipped. The fourth
is refused on purpose, and this document is the reason.

## The constraint everything here follows

**The catalog began as a demo and now also carries native Storefront inventory.**
Synthetic sample records remain explicitly labeled and are never purchasable;
server-owned native listing, variant, inventory and payment-readiness fields
are the only path to checkout. The banners on `/`, `/discover` and `/stylist`
describe the actual mix returned rather than claiming the whole shelf is fake.

Search metadata is the same promise made to a machine. So the rule is: **a
crawler must not be told anything the page would not tell a person.**

## What shipped

- **`metadataBase`** on the root layout. Without it every relative canonical and
  `og:url` resolves relative and is worthless to a crawler.
- **A title template** — `%s · *ASILUM`. Before this, 13 of 17 routes inherited
  the root title, so every page in a search result read
  "*ASILUM — fashion intelligence OS" with no way to tell them apart.
- **Canonicals on every route.** Public routes point at themselves; so do the
  personal ones (see below).
- **OpenGraph on the four public destinations** — `/cover`, `/discover`,
  `/hotlist`, `/stylist` — with descriptions that distinguish native Storefront
  goods from synthetic sample records.
- **`noindex, nofollow` on the eight personal surfaces**: `/board`, `/profile`,
  `/settings`, `/orders`, `/asterisk`, `/upload`, `/stats`, `/admin`.
- **`/cover` added to the sitemap.** It is a public destination and was
  crawlable but unlisted.
- **`/upload` added to the robots disallow list.** It was `noindex` in metadata
  but absent from `robots.txt` — the two lists disagreed. `tests/seo.test.js`
  now fails if they drift apart again.

## Why personal routes carry noindex AND a robots.txt disallow

They do different jobs. **`robots.txt` is advisory and governs fetching** — a
well-behaved crawler will not request the page, but a URL discovered elsewhere
can still be indexed *without being fetched*, on the strength of inbound links
alone. **A meta `noindex` is what actually keeps it out**, and it is only seen
if the page is fetched. Belt and braces, deliberately.

Their canonicals are **self-referential, not inherited**. Left inherited, each
one pointed at `/` — telling a crawler "my content really lives at the homepage"
while also saying "do not index me". Two contradictory signals about one URL.

## What is deliberately NOT here

### Product JSON-LD — refused

Structured `Product` data is what puts a price, availability and rating into a
search result and Google Shopping. The shared catalog still contains synthetic
records, and the root/feed metadata cannot safely represent a particular native
offer. Emitting global `Product` markup would risk pushing invented prices or
availability into a shopping index. Product JSON-LD therefore stays absent
until a native product-detail route can emit it only from a current server quote.

`WebSite` or `Organization` JSON-LD would be honest and is a reasonable future
addition. **`Product` stays out until the catalog is real inventory.**

### og:image — shipped 17 August, rebuilt to the owner's comp

Held back until there was something real to serve: a card declaring an image it
cannot serve renders broken, and inventing a placeholder to satisfy a checklist
is the same failure in miniature. Both halves moved together —
`app/opengraph-image.js` draws a 1200×630 card and `twitter:card` is
`summary_large_image` — and the card was then **rebuilt against the owner's
reference comp** the same day.

**Generated, not committed.** A PNG in `public/` is a second copy of the design
language that nothing keeps in step, and this palette moved twice in two days for
contrast (#216 `--sig`, #218/#219 `--red` and `--p2`) — a committed binary would
have kept the old colours silently. The route draws from the token values in
`app/globals.css`, and `tests/opengraph-image.test.js` **reads that stylesheet**
and fails if the two drift. Same discipline as `tests/theme-contrast.test.js`.

**What the comp asked for, and what shipped:** the terminal grid, the phosphor
bloom bottom-left, the red block and rule, `PERSONALIZED FASHION TERMINAL` over a
chrome `*ASILUM` with a glowing red asterisk, a glowing green `magazine.com`, the
three-word strip, and the demo line — which the owner kept from the first version.

**Two deliberate departures, both worth stating:**

1. **The comp reads "COMMERECE".** A misspelling baked into every link preview is
   not a design decision. It ships as `COMMERCE`, and a test forbids the typo so
   nobody "restores" it to match the comp later.
2. **The comp's chrome is silver-blue and its `magazine.com` is a plain
   grotesque.** Neither exists in this palette or this type stack, and
   `asilum-ui` rules 2 and 3 are explicit — no further accent colours, ever, and
   colours only through tokens. So the chrome is banded from `--ink` and `--grey`
   (the metallic read, in the phosphor palette) and `magazine.com` is set in
   OSD/VT323, which is exactly what `.wordmark em` already uses for the word
   MAGAZINE on every page. The comp's *intent*, in the house's own materials.

**Type — the real brand faces.** Satori reads TTF/OTF/WOFF but **not WOFF2**, and
`public/fonts` shipped only WOFF2, so the first version used the generator's
built-in face. All three faces are **SIL OFL** and Google publishes them as TTF,
so the TTFs now sit beside the WOFF2s with their licence texts. The WOFF2s stay —
they are what the browser loads; the TTFs exist for the build.

| Card element | Face | Follows |
|---|---|---|
| kicker, `*ASILUM` wordmark, strip | Michroma | `--mich` — `.headline`, `.wordmark`, `.snav`, `.mq` |
| `magazine.com` | VT323 | `--osd` — `.wordmark em`, the MAGAZINE line |
| the demo line | Share Tech Mono | `--helv` — the body voice |

Each face ships **one weight**, so there is no `fontWeight` anywhere: asking for
700 makes Satori synthesise a face the site never shows. A test reads `--mich`,
`--helv` and `--osd` out of the stylesheet, so repointing a token without touching
the card goes red. Another checks the four-byte sfnt signature, because a `.woff2`
renamed `.ttf` fails at build with an opaque Satori error.

**What Satori would not paint, learned by looking.** An SVG data-URI tile for the
grid and a `radial-gradient` for the bloom both produced **byte-identical PNGs**
when their values were changed — which is what a not-rendered element looks like.
Both are primitives now: the grid is positioned hairlines, the bloom is a blurred
`box-shadow`. The emitter for a bloom must be **tiny**, because a box-shadow
paints outside its element and the first version's 380×300 boxes printed two dark
discs where their own bodies sat.

**Verified as an artifact, not just as source:** served from a running server it
returns `content-type: image/png`, a valid PNG signature, and 1200×630 read out of
the IHDR chunk. Next emits `og:image`, `:type`, `:width`, `:height` and `:alt`
absolutely, through `metadataBase`.

### The name is "*ASILUM"

Owner directive, 17 August: **the word magazine is never dropped.** It was being
dropped in fourteen metadata strings — the title template, every segment layout's
title and `siteName`, the piece page, the og and twitter titles — while the shell
wordmark had it right the whole time. That is exactly why it survived: the name
looked correct on every page and was wrong in every browser tab, every search
result and every shared link. `tests/brand-name.test.js` is the rule, executable,
and it applies to any new page without anyone remembering it.

**Per-route cards are deliberately not built.** One card for the site is honest;
twelve near-identical ones are churn. `/piece/<id>` is the only route with a real
case for its own card, and it is `noindex` demo inventory — see §"Built —
option (a)".

## Open, and not decided here

- **Apex vs. www — the code half is SETTLED (17 August); one owner step is left.**
  See §"One canonical host" below.
- **Stable product URLs — investigated 17 August. It is an owner decision, and
  smaller than it sounds.** Details below.

---

## One canonical host — ruling 7, 17 August

**The apex was serving a complete, indexable copy of the site.** `A @ ->
76.76.21.21` points `asilummagazine.com` at the same Vercel project, and only
`asilum.vercel.app` was redirected. So two hosts served every page, and every
canonical on both named `www`. Google honours a canonical, so nothing was
*broken* — but the redirect rule's own comment already claimed "One canonical
host", and that claim was true of the alias and quietly false of the apex.

**What changed.**

1. **`lib/site.js` is the only place the origin appears.** It was hardcoded in
   nine: `app/layout.js` twice, four segment layouts, `sitemap.js`, `robots.js`,
   `piece/[id]/page.js`. That is why this ruling was expensive to settle — a
   nine-file sweep in which one missed file *is* an inconsistent canonical. It is
   one constant now, overridable with `SITE_ORIGIN` for a fork or staging domain.
2. **The apex redirects to `www`**, permanently, by the same mechanism already
   proven on the alias. Preview deployments are deliberately untouched.

**The emitted output is byte-identical** — `robots.txt`, `sitemap.xml` and the
`/cover` canonical and `og:url` were compared before and after.

### Verified by request, not by reading the docs

A `has` host value is matched **exactly**. That mattered enough to test against a
running server with `Host` headers, because a suffix match would send `www` to
`www` forever and take the site down:

| `Host:` | Result |
|---|---|
| `asilummagazine.com` | `308 → https://www.asilummagazine.com/discover?q=coat` — **query preserved** |
| `www.asilummagazine.com` | `200` — no loop |
| `asilum.vercel.app` | `308 →` www |
| `asilum-git-fix-x.vercel.app` | `200` — previews stay reachable |
| `notasilummagazine.com` | `200` — no suffix matching either |

`tests/canonical-host.test.js` holds all of it, and the self-redirect filter is
its own test: deleting that filter reddens three assertions.

### Auth is safe, and slightly better

Password reset uses `redirectTo: window.location.origin + "/profile?reset=1"`, so
once a visitor lands on `www` the origin they send **is** `www` — the flow gets
*more* consistent, not less. An older link naming the apex still works: the 308
preserves path and query (measured above), and the token exchange happens on
`supabase.co`, not here. Both origins remain allow-listed in Supabase.

### The one owner step left

**Supabase → Authentication → URL Configuration → Site URL is still the apex**
(`https://asilummagazine.com`). It is a dashboard field — an agent cannot change
it — and it is what `{{ .SiteURL }}` resolves to in every auth email. Set it to
`https://www.asilummagazine.com` and ruling 7 is closed.

If instead ASILUM should *be* the apex, do not edit nine files: change
`SITE_ORIGIN` in `lib/site.js`. The redirect list inverts itself — `www` starts
handing traffic to the apex — and a test proves that flip rather than assuming it.

---

## Stable product URLs: what is actually true (17 August)

The audit lists this as outstanding. Investigated, and it needs a ruling rather
than an implementation, for three reasons.

### 1. The share URL already works — verified, not assumed

`shareItem()` copies `/?item=<id>`, and that link **does** restore the piece:
loading `/?item=syn-0911` cold opens the item dialog on *Y/Project — slip dress*
and posts the notice "showing pieces connected to a shared item". The handler
lives at `app/page.js:324`. So sharing is not broken, and the URL is stable in
the sense that matters to a person: it survives being pasted.

What the audit wants is a **path** (`/piece/<id>`) rather than a query parameter.

### 2. The SEO argument for a path is currently inverted

A path-based product URL exists to be **canonicalised and indexed**. Every
product here is synthetic, and this document already refuses to court indexing
for sample data. **Building indexable product pages for fabricated products
would undo the decision above.** Any such route has to ship `noindex` while the
catalog is a demo — at which point the SEO benefit is nil and the remaining
benefit is a tidier URL.

The argument turns around the day the catalog holds real inventory. Not before.

### 3. It collides with an owner decree

`asilum-ui` rule 8: **"item depth belongs to the item modal (owner decree)."** A
per-product *page* is item depth living somewhere else. Two shapes respect the
decree, and picking between them is the owner's call:

- **(a) Deep link only.** `/piece/<id>` server-renders nothing but metadata and
  hands off to the catalog with the modal open. Depth stays in the modal, the URL
  gets tidier, and a shared link can finally carry the piece's own preview.
- **(b) A real page.** `/piece/<id>` renders the depth itself. Cleaner for
  crawlers and for a future real catalog — and a direct contradiction of rule 8
  until the owner amends it.

### The one genuine gap, and why it is not a quick fix

**A shared piece link previews as the generic site card.** Paste
`/?item=syn-0911` into any social surface and the preview reads
"*ASILUM — fashion intelligence OS" with `og:url` pointing at the homepage —
not the piece. That is a real shortcoming of a share button whose notice claims
the link "carries its taste graph".

Fixing it needs per-request metadata, and **`app/page.js` is a client component**
(`"use client"` on line 1), so it cannot export `generateMetadata`, and a segment
layout never receives `searchParams`. So this is not a metadata addition — it
requires either option (a) above or converting the catalog to a server component
wrapper around a client child.

**Recommendation:** option (a). It is the smallest change that respects rule 8,
tidies the URL, and closes the link-preview gap — and it keeps `noindex` honest
while the catalog is synthetic.

### Built — option (a), on the owner's ruling

`/piece/<id>` (`app/piece/[id]/page.js`) is a **server** component, which is the
whole point: it can export `generateMetadata`, and `/?item=<id>` never could.

- **Per-piece preview.** `/piece/syn-0911` serves
  `<title>Y/Project — slip dress · *ASILUM</title>`, a matching `og:title` and
  `og:url`, and a self-referential canonical.
- **The demo warning travels with the card.** The description reads
  *"dresses · 2020s. A synthetic sample record — not real inventory, not for
  sale."* A preview is a claim made to someone who has not seen the page, so it
  carries the same warning the catalog shows in its banner.
- **`noindex`, and NOT robots-disallowed.** Deliberate, and the two are different
  jobs: `noindex` keeps a synthetic product out of search results, while leaving
  the path crawlable is what lets a scraper fetch the page and read the card. A
  disallow would break the exact preview the route was built to fix.
- **Rule 8 intact.** The page renders a name, the honest description and a link —
  nothing else. It hands off to `/?item=<id>` and the modal opens there as
  always. `tests/piece-url.test.js` fails if `price`, `Favorite`, `Bag`,
  `related` or a thumbnail ever appear on it.
- **No link rot.** `shareItem()` now emits `/piece/<id>`, and the old
  `/?item=<id>` handler stays exactly as it was, so links already shared keep
  working.
- **A no-JavaScript reader still gets something true:** the piece's name, the
  demo note, and a real link into the catalog.

Verified running: the crawler view by reading the served tags, and the human path
by loading `/piece/syn-0911` and watching it land on `/?item=syn-0911` with the
dialog open on the right piece. The hand-off uses `router.replace`, so Back from
the catalog does not bounce forward again.
---

## Getting indexed (21 Aug 2026) — why the site is invisible on Google/Yahoo, and the three steps out

**Diagnosis, proven from this session:** the app's SEO surface is complete and
correct — a browser gets `/robots.txt` 200 (allow, canonical www sitemap
pointer) and `/sitemap.xml` 200 (8 public URLs) — but **production answers
HTTP 429 to every non-browser client**: `curl` presenting as Googlebot and as
bingbot got 429 on robots.txt, sitemap.xml, and the homepage alike. That is
the Vercel challenge ("checkpoint") that has been blocking `curl` since
mid-August; it also blocks crawlers, and a crawler that cannot read
robots.txt indexes nothing. Observed consequences: **Bing holds zero pages**
(and Yahoo *is* Bing's index, so Yahoo finds nothing), **DuckDuckGo holds
exactly one stale homepage snapshot** whose description still reads
"…reads your taste across six bridges…" — pre-copy-law copy, so nothing has
been recrawled since at least 16 Aug. Google was not reachable from the
verification pane; the owner reports zero there too. The domain is also new
and had never been submitted to either console — even without the wall,
discovery would have been slow.

**Step 1 — drop the wall (owner, Vercel dashboard, ~2 min). THE UNBLOCKER;
nothing else matters until this is done.** Vercel → team `asilum-magazine` →
project `asilum` → **Firewall** → turn **Attack Challenge Mode OFF**.
Challenge mode challenges *all* traffic (Vercel's own docs warn it harms SEO
and is meant only for active attacks). If bot defense is still wanted, use
the **Bot Protection managed ruleset** instead — it exempts verified search
engine bots. Re-test afterwards from any terminal:

    curl -s -o /dev/null -w "%{http_code}\n" -A "Googlebot" https://www.asilummagazine.com/robots.txt

expect `200` (it is `429` today).

**Step 2 — Google Search Console (owner, ~5 min).**
search.google.com/search-console → Add property → **URL prefix** →
`https://www.asilummagazine.com` → choose the **HTML tag** method → copy the
`content="…"` value → paste it into Vercel env as `GOOGLE_SITE_VERIFICATION`
→ redeploy → back in Search Console press **Verify** (the tag renders from
`app/layout.js`, env-gated). Then **Sitemaps** → submit `sitemap.xml`, and
**URL Inspection** on `https://www.asilummagazine.com/` → **Request
indexing**.

**Step 3 — Bing Webmaster Tools, which also covers Yahoo and DuckDuckGo
(owner, ~2 min).** www.bing.com/webmasters → sign in → **Import from Google
Search Console** (one click, reuses step 2) — or the meta-tag method via the
`BING_SITE_VERIFICATION` env var. Submit the sitemap there as well.

**Expectations, honestly:** after the wall drops and the sitemaps are
submitted, first Google results typically land in a few days for a fresh
domain (Bing similar); "asilum magazine" as a query resolves once the
homepage is indexed — the title and og tags already carry the name. The
stale DuckDuckGo snippet (bridge-language description) heals itself on the
first recrawl; no action needed.

**Shipped alongside this note:** `/checkout` joined the robots disallow list
*and* gained the noindex segment layout (it was born in #307 after the SEO
round and had neither — a per-buyer payment surface is not search material);
env-gated `verification` metadata in `app/layout.js`; both env names in
`.env.example`.
