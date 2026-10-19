# Research and implementation resources

Curated September 19, 2026. These are primary papers, official repositories, and official provider documentation. They support an engineering direction; they do not establish ASILUM performance, data licenses, provider approval, or production configuration. Prefer the repo's existing implementation when it already satisfies the requirement. Validate provider details at implementation time.

## Read first for ASTERISK

| Resource | What to use | Boundary |
|---|---|---|
| [Google: Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/) | Separate candidate generation from ranking; evaluate each stage. | An architectural pattern, not a reason to copy YouTube's objective or scale. |
| [MIND: Multi-Interest Network](https://arxiv.org/abs/1904.08030) | Preserve several user interests and select context-relevant candidates. | Start with bounded existing-store contexts; training a new network is later work. |
| [SASRec](https://arxiv.org/abs/1808.09781) | Session sequence and recency as different evidence from permanent taste. | Sparse histories do not justify confident sequence inference. |
| [PinSage](https://arxiv.org/abs/1806.01973) | Item and engagement neighborhoods for discovery. | Avoid unbounded transitive guesses; retain source and consent boundaries. |
| [CLIP](https://arxiv.org/abs/2103.00020) | Evaluate aligned image/text retrieval. | Similar appearance does not prove designer, season, authenticity, or fit. |
| [FashionCLIP, official project](https://github.com/patrickjohncyh/fashion-clip) | Benchmark fashion-specific embeddings against current/general embeddings. | Code, weights, and training data have distinct rights; inspect each before use. |
| [Schnabel et al.: Recommendations as Treatments](https://proceedings.mlr.press/v48/schnabel16.html) | Account for exposure/selection bias when evaluating recommendations. | Unseen items and skips are not clean negative labels. |
| [Li et al.: Contextual-Bandit News Recommendation](https://arxiv.org/abs/1003.0146) | Bounded exploration and logged-policy evaluation. | Do not ship adaptive exploration before reliable impression attribution. |
| [Vowpal Wabbit contextual bandit tutorial](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html) | Practical action probabilities, feedback, and offline experiments. | Research sandbox first; no new production service solely to meet Sunday. |

## Retrieval and model orchestration

| Resource | Apply to ASILUM |
|---|---|
| [pgvector, official repository](https://github.com/pgvector/pgvector) | Add vector retrieval only if needed; study filtered ANN recall and iterative scans. Keep hard filters and measure recall against exact search. PostgreSQL full-text search is not automatically BM25. |
| [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) | Keep archive chunks tied to their designer, house, collection, and source; evaluate lexical plus semantic retrieval. |
| [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Prefer bounded, testable workflows. Use tools for exact data, with explicit stopping and fallback conditions. |
| [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | Validate extraction/enrichment schemas. Schema compliance is not factual verification; require citations and deterministic validation. No paid calls activated by this reading list. |

## Fashion evidence and rights

| Source | Intended use | Required care |
|---|---|---|
| [Vogue Runway](https://www.vogue.com/fashion-shows) | Find specific reviews and profiles for the owner-required Vogue overview summaries. | Cite exact supporting pages; summarize originally. Access is not a blanket image, scraping, or training license. |
| [The Met Open Access repository](https://github.com/metmuseum/openaccess) | Object metadata and eligible open images for verified historical context. | Check each object's public-domain/image status; do not apply one license to every asset. |
| [The Met Costume Institute collection](https://www.metmuseum.org/art/collection/search?department=The+Costume+Institute) | Object-level designer, date, material, and collection provenance. | Museum holdings are historical evidence, not live inventory or guaranteed item attribution. |
| [V&A fashion collection](https://www.vam.ac.uk/collections/fashion) | Cross-check fashion history and object context. | Respect record/image permissions. It supplements facts; it does not replace the requested Vogue overview source. |

Use official house archives and dated appointment announcements for career relationships, exact authorized merchant listings for item facts, and merchant-specific size charts for estimates. Record the exact page supporting each assertion. Do not silently copy the user's example sequence as a researched full chronology. Do not infer individual garment attribution solely from the creative director's tenure.

## Production services

| Official documentation | Implementation use |
|---|---|
| [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | Review participant/owner isolation and private body/profile data. Test negative access, not just successful reads. |
| [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) | Authorize private Broadcast/Presence channels if using them. The authorization mechanism is not durable DM storage or a substitute for app membership checks. |
| [Stripe webhooks](https://docs.stripe.com/webhooks) | Signed server events, asynchronous outcomes, retry handling, and reconciliation. Browser redirects are not payment evidence. |
| [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) | Stable retry keys and safe duplicate handling; align with existing order/event ledger semantics. |
| [Shopify Storefront Cart](https://shopify.dev/docs/api/storefront/latest/objects/Cart) | Authorized merchant carts and checkout handoff. Access is per integration; this is not a universal multi-merchant checkout. |
| [eBay Browse getItem](https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem) | Authorized current listing details, variants, and outbound source data where available. Verify scopes and program rules before enabling. |
| [Pinterest API introduction](https://developers.pinterest.com/docs/api/v5/introduction/) | Assess approved account/pin access for voluntary connections. | 
| [OWASP Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/) | Cases for authorization, session handling, input validation, uploads, and business-logic tests. |
| [NIST: SI units, length](https://www.nist.gov/pml/owm/si-units-length) | Consistent unit conversion foundations. It does not supply garment-specific size or ease standards. |

Pinterest endpoint availability/approved scopes were not established by the introduction page; treat that connection as a dependency until verified. Do not assume provider credentials, quotas, catalog rights, webhook secrets, or OAuth approval are present because documentation exists. All secrets stay in the authorized secret store, never this repo or an issue.

## Evaluation work to borrow, not just reading

Create a small, reviewed test set for exact entity pairs, misspellings, hard exclusions, null measurements, uncertain item provenance, multiple simultaneous tastes, and reason-specific corrections. Compare existing versus proposed behavior with fixed inputs, deterministic seeds where applicable, and declared thresholds. Include sparse-history/new-user cases. Retain failing examples as regression tests. Measure live engagement only after consented impression logging is trustworthy; do not report offline relevance as a live conversion lift.
