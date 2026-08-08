# Commercial Monitor Read-Only Foundation V1

- Status: implemented locally; not approved for merge or deployment
- Date: 2026-08-08
- Foundation branch: `feature/seller-os-canonical-integration-foundation-v1`
- Starting commit: `b43cf5b8b20afa48cd48bc1752450d2bf90f864f`
- Canonical parent: `ffb2eed1dbf9e41e42ab5343b1a595d69cb15f8b`
- Product Case state: `PAUSED_FOR_MONITORING_MILESTONE`

## Scope and containment

The canonical surface is `/admin/ebay/monitor`. It calls only the authenticated,
GET-only `/api/admin/ebay/monitor` route. The route reads stored, sanitized Seller
OS evidence through a SELECT-only repository and returns the
`COMMERCIAL_MONITOR_GET_V1` DTO. It does not call live collectors because the
existing collectors persist generations, runs, snapshots, events, or delivery
state.

```text
/admin/ebay/monitor
-> GET /api/admin/ebay/monitor
-> admin authentication + environment boundary
-> Commercial Monitor read-only projection service
-> SELECT-only stored-evidence repository
-> registry / identity / snapshots / orders / Luna source health / learning
```

The canonical graph contains no marketplace writer, improvement action, listing
revision, inventory update, fulfillment action, buyer-message sender, alert
dispatcher, WhatsApp adapter, scraping runner, or outbox mutation. Alert candidates
exist only in the response and hard-code all delivery capabilities to `false`.

The older `/api/admin/ebay/commercial-monitor` route and its panel remain legacy
code outside this graph. They have not been deleted because unrelated legacy
capabilities are outside this scope. They must not be remounted or imported by the
canonical monitor, and their directly addressable mutation surface remains a
promotion blocker requiring a separate retirement/authorization decision.

## Reuse matrix

| Disposition | Existing source | Decision |
| --- | --- | --- |
| `REUSE_AS_IS` | Seller account scope, admin authentication, Production environment boundary | Retain identity binding, authentication-first routing, and Production isolation. |
| `REUSE_AS_IS` | `ebay_active_listings`, identity-verification state, commercial snapshots, sanitized order rows, latest Luna variants/sources, category learning rows | Read through a new SELECT-only repository; never invoke their mutating runners. |
| `REUSE_AS_IS` | Stable SHA-256 event-key and private-buyer-data guard concepts | Keep deterministic response-local alerts and fail closed on buyer PII. |
| `REUSE_WITH_ADAPTER` | PR #256 commercial analytics reconciliation | Reuse explicit evidence, nullable metrics, `INSUFFICIENT_EVIDENCE`, and `syntheticFallbackUsed: false`; whitelist caller fields and never accept a synthetic fallback. |
| `REUSE_WITH_ADAPTER` | Managed Listing Registry and manual/identity discovery evidence | Preserve Item ID, offer/SKU/custom-label identity and provenance; expose partial/unproven universal coverage and freshness instead of invoking sync. |
| `REUSE_WITH_ADAPTER` | Commercial listing snapshots and order snapshots | Require source, reporting-window, freshness, grain, currency, and completeness proof before projecting numeric values. Stored paid-order evidence is bounded by freshness. |
| `REUSE_WITH_ADAPTER` | Luna latest-variant and source records | Require exact product + variant + SKU identity, unique evidence, fresh capture, and a complete, non-superseded targeted-monitor heartbeat that covered an active, unchanged mapping. Missing or ambiguous proof remains unknown/conflicted. |
| `REUSE_WITH_ADAPTER` | Category performance learning | Preserve eligibility, lifecycle, evidence, and completeness; `COLLECTING` is partial and default zero is not completed learning. |
| `REFACTOR_BEFORE_REUSE` | Active-listing Inventory reader/sync | Separate its paginated GET collector from registry-generation writes before live monitor use. Stored evidence is the only V1 input. |
| `REFACTOR_BEFORE_REUSE` | Watch-count reader | Missing `WatchCount` must remain unavailable; only an explicit authoritative zero may be zero. |
| `REFACTOR_BEFORE_REUSE` | Existing traffic summary and snapshot writer | Preserve row applicability and the reported-versus-calculated CTR origin; do not sum non-applicable rows or infer a formula that storage cannot prove. |
| `REFACTOR_BEFORE_REUSE` | Existing Commercial Monitor SELECT logic | Split reads from the service that also writes runs, events, outbox, fulfillment and dispatch state. The new repository performs that physical split. |
| `DO_NOT_REUSE` | Legacy mutable Commercial Monitor route/panel/service in the canonical graph | They import or expose improvement, persistence, outbox, fulfillment, competitor, or WhatsApp behavior. |
| `DO_NOT_REUSE` | Targeted Luna monitor and active-listing sync runners | They write snapshots/events or registry generations. |
| `DO_NOT_REUSE` | Title-derived pack quantity and default economics | No authoritative BOM/shared-allocation proof exists; optimistic composition/capacity/economics is forbidden. |
| `DO_NOT_REUSE` | Traffic summary totals and watcher fallback zero | They collapse missing/non-applicable evidence into a plausible zero. |
| `DO_NOT_REUSE` | Proposal/event history as an experiment registry | No authoritative runtime experiment registry exists on this base. |
| `DO_NOT_REUSE` | PR #257 browser/session Product Case state | It is not a persistent Product Case repository and cannot prove a listing link. |
| `DO_NOT_REUSE` | Delivery outbox, dispatcher, Meta/WhatsApp and recipient/provider fields | The monitor produces candidates, never delivery attempts. |

## Truth and coverage contract

Each numeric observation carries availability, completeness, source operation,
evidence reference, timestamp, account and listing identity, measurement grain,
reporting window, freshness, limitation code, unit/currency, and explicit-zero
authority. `UNAVAILABLE`, `UNKNOWN`, `ERROR`, `MISSING`, and
`INSUFFICIENT_EVIDENCE` require a null value. `PARTIAL` remains partial. A numeric
zero is accepted only when the authoritative stored evidence explicitly reports
zero.

Traffic remains Item grain and is not projected to a variation. Reported and
calculated CTR are separate observations. Economics remains unavailable until all
price, fees, promoted fees, shipping, composition cost, currency, formula version,
and input evidence are authoritative.

Listing price and watcher count require an allowlisted authoritative source plus a
valid capture timestamp. Stored Analytics windows cannot end after their capture,
and explicit synthetic/fixture markers fail closed. Open paid/unfulfilled order
aggregates stay `PARTIAL`, validate both order and line provenance/freshness, expose
formula inputs, and inherit freshness from their oldest indispensable input.

Registry rows and identity-verification records do not prove universal account
discovery. V1 reports coverage as `PARTIAL` or `UNPROVEN`; stale discovery is an
explicit blocker. Live Inventory discovery is intentionally not invoked because
its current implementation writes a registry generation.

## Product Case, composition, stock and experiments

No authoritative persistent Product Case repository exists on the canonical base.
The V1 adapter therefore returns `UNPROVEN` and
`PRODUCT_CASE_LINK_UNPROVEN` for every listing. The contract supports
`AVAILABLE`, `MISSING`, and `UNPROVEN` for future authoritative adapters, but this
monitor creates no placeholder and changes no Product Case checkpoint.

No versioned BOM/shared-allocation registry exists. Composition and bundle capacity
remain unproven. Stock can become `OUT_OF_STOCK_SIGNAL` only from unique exact,
fresh, referenced evidence plus a complete targeted Luna heartbeat that observed
the active listing after its current mapping was established, with explicit
`available=false`.
Boolean unavailability does not fabricate numeric quantity zero. Stale, missing,
ambiguous, parser-broken, or source-unhealthy evidence remains distinct.

No authoritative experiment registry exists on this base, so experiment state is
`UNPROVEN`. The discriminated contract is ready to consume an authoritative
`RUNNING` state, which yields `COMMERCIAL_ACTION=NO_TOCAR` and preserves frozen
variables without changing the experiment.

## Known gaps and promotion blockers

- Universal listing discovery is unproven until the Inventory GET collector is
  physically separated from its write-side registry sync.
- Product Case links cannot be proved available or missing until Persistent Product
  Case Foundation V1 supplies an authoritative read repository.
- Composition, shared allocation, and bundle capacity lack a versioned BOM graph.
- Full sales history, external views, fees, promoted fees, shipping and current
  economics lack complete authoritative input provenance.
- An authoritative experiment registry is absent.
- The legacy mutable Commercial Monitor endpoint remains addressable outside the
  canonical dependency graph and must be retired or separately constrained before
  promotion.
- Browser-based visual verification requires a browser harness not present in this
  worktree; source, type, test, and build verification do not substitute for a
  screenshot review.

These gaps are represented as data-quality issues and blockers. None is filled by
fixtures, inferred identifiers, default quantities, synthetic marketplace data, or
runtime writes.
