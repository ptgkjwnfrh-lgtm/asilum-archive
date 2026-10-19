# V.2 integration contracts, proposal v0.1

Status: proposed September 19, 2026. This file defines information and behavior, not a mandate to create duplicate routes. Adapt existing endpoints additively where possible. Preserve current clients until both sides have migrated. The backend supplies server adapters and validators; the UI supplies client adapters and presentation. Resolve names in the coordination issue.

## Common behavior

Return a version, request ID, and typed outcome. Distinguish successful empty results from unavailable services, unauthorized access, validation failure, stale cursor, and rate limits. Preserve appropriate HTTP status codes. Suggested error shape: `{error:{code,message,retryable},requestId}`. Do not return internal traces, secrets, raw body measurements, private messages, or full user history in public diagnostics. Server time is authoritative; UI optimistic state is pending until acknowledged.

## Search and overview DTOs

```ts
type Source = {
  id: string; url: string; publisher: string;
  retrievedAt: string; publishedAt?: string;
};
type Claim = { text: string; sourceIds: string[] };
type Entity = {
  id: string; kind: 'designer' | 'house'; name: string; aliases: string[];
  overview: { summary: Claim; paragraphs: Claim[]; updatedAt: string } | null;
  image: { url: string; alt: string; credit: string; rights: string } | null;
  sources: Source[];
  // House founder, country, founding year and design language are sourced claims.
  facts: { key: string; claim: Claim }[];
};
type CareerEdge = {
  id: string; designerId: string; houseId: string; role: string;
  start: string | null; end: string | null;
  datePrecision: 'day' | 'month' | 'year' | 'unknown';
  sourceIds: string[]; sourceCatalog: Source[];
  queryText: string; // e.g. TOM FORD: GUCCI, safe to encode into ?q=
  matchingItemCount: number | null;
};
type SearchPage = {
  contractVersion: 1; requestId: string;
  query: { text: string; designerId?: string; houseId?: string };
  // Reuse the existing interpreted constraints and product DTOs via adapters.
  interpreted: unknown; results: ExistingProductDTO[];
  overview: Entity | null; related: CareerEdge[];
  nextCursor: string | null; snapshotId: string;
  total: number | null; totalIsExact: boolean;
  candidatesTruncated: boolean;
};
```

These illustrative TypeScript names are not imports or implemented declarations. Actual fixtures must validate against the agreed runtime schema. An overview is nullable when evidence is missing. Return full prose; the UI clamps to four visual lines and owns expansion. Career edges are independent of item availability and sort by known start date, with a deterministic unknown-date policy. Separate historical house names/aliases from canonical IDs. Never manufacture garment attribution from a career date alone.

For pair queries, return both canonical entities/IDs so quick selections and headings cannot disagree. Existing product cards remain the item contract; add minimal explicit designer attribution/provenance metadata rather than replacing the entire DTO. Apply current explicit constraints to every returned carousel, including exploration. A designer's complete career registry and an inventory-backed quick filter are different concepts and both must be identifiable.

## Learning events

Extend the existing event path rather than making a second analytics store. Suggested fields: `eventId`, authenticated subject resolved on server, `impressionId`, `itemId`, `contextId`, `action`, `reason`, `scope`, `occurredAt`, `policyVersion`, `undoOf`. Reasons include price, fit, finish, silhouette, wrong attribution, and not interested; scope distinguishes this item/session/ongoing preference. Validate reason/action compatibility and deduplicate retries.

Recommendation responses can add `reasonCodes`, `evidenceRefs`, `confidenceBand`, and `policyVersion`. These fields explain the selection without exposing raw internal reasoning. Private evidence references must never resolve through another user's request. Preserve existing explicit-vs-inferred memory boundaries and erasure/adoption behavior.

## Fit

Keep the current fitAssessment fields through an adapter. Add a typed evidence result: `unknown | estimated | measured`, supported dimension comparisons, `missingDimensions`, relevant source references, and a confidence band. Null never becomes zero. A measurement value includes unit, body/garment/chart origin, flat/circumference method, and evidence. “Measured” identifies evidence quality, not guaranteed fit. Client text must not promise more than the backend compared.

## DM

Retain current routes and operation names. Return stable message ID, thread ID, server sequence/timestamp, client retry ID, cursor, and authoritative delivery/request status where supported. Identity is derived from the session, never a client-supplied user ID. A retry cannot create a second message. Cursor tie-breakers must handle identical timestamps. Block/consent changes are rechecked at write time. The UI maps pending/sent/failed states and paginates the durable thread; realtime only prompts reconciliation.

## Purchase hub

Provide a read facade that returns stable record IDs, `kind: payment_order | source_ticket`, merchant, item/variant, currency, separate payment/fee/merchant/outcome state, source of the outcome, timestamps, and allowed next actions. Existing state machines stay authoritative. An unavailable provider does not convert a pending order to paid, cancelled, or refunded. Amounts remain integer minor units. Actions validate current ownership and server state; a UI button cannot authorize a refund or purchase by itself.

Provider confirmation, user report, and unknown must remain separate. Never count a saved bag or paid ASILUM fee as a verified garment purchase. Handle partial/cross-lane outcomes explicitly. The backend proposes the smallest existing-route extension and a representative fixture for each state; the UI renders it without guessing.

## Map, uploads, and connections

Return consent-scoped user locations, sourced store/event coordinates, stable IDs, display names, validity windows, and pagination/viewport bounds. No private coordinates in anonymous responses. Upload responses identify durable vs device-only persistence, authorization, processing state, and failure. Connection responses identify the actual provider, granted capabilities, expiry/disconnection state, and availability. A configured client button is not a connected account.

## Contract acceptance cases

- `TOM FORD: GUCCI` resolves both entities and cannot return unrelated Gucci or unrelated Tom Ford stock.
- A designer's verified house stays listed at zero inventory; a house's designers sort by dated relationships, not item counts.
- No new stock or rank update creates duplicate/omitted items within one valid search snapshot.
- Missing measurements survive normalize/display/save as missing; chart estimates cannot self-label as measured.
- Search/provider failure is distinguishable from zero results.
- DM retry, block race, and nonparticipant access have tested outcomes.
- A fee payment and merchant garment purchase cannot share a misleading “purchased” state.
- New data tables and event fields participate in authorized export/deletion and identity adoption.

The backend posts the actual exported types, endpoint mappings, state fixtures, test evidence, and any required amendments; the UI confirms integration against those exact contracts.
