# eBay Live Read-Only Account + Discovery V1

Status: local foundation implemented; live certification requires a valid,
server-side account binding and OAuth context. This document does not certify a
specific seller account or claim that any eBay request succeeded.

## Decision

The canonical Commercial Monitor may obtain live seller evidence only through
the following dependency graph:

```text
/admin/ebay/monitor
→ GET /api/admin/ebay/monitor
→ Admin authentication
→ Production boundary
→ eBay live read-only coordinator
   → OAuth refresh grant (ephemeral access token only)
   → Trading GetUser
   → Trading GetMyeBaySelling ActiveList
   → Inventory inventory_item + offer GETs
   → Analytics traffic_report GET
   → Fulfillment order GET
→ existing Supabase SELECT-only repository
→ response-local reconciliation
→ sanitized Commercial Monitor DTO
```

The coordinator never imports the legacy Commercial Monitor service, active
listing sync, registry writers, listing publishers/revisers, fulfillment
actions, outbox/dispatch or WhatsApp modules. It performs no persistence.

## Trading allowlist

Trading uses HTTPS `POST` as its XML transport. A POST is permitted only when
all of method, production origin, exact path and exact call name match:

| Operation | HTTP | Path | Purpose |
| --- | --- | --- | --- |
| `GetUser` | POST | `/ws/api.dll` | Bind the token to the configured seller identity. |
| `GetMyeBaySelling` | POST | `/ws/api.dll` | Enumerate the authenticated seller's ActiveList with pagination and variations. |

No prefix or generic `Get*` rule exists. The declared operation, exact HTTP
header and XML request root must all agree. Mutable Trading calls are rejected
before network execution, and redirects are rejected.

## Reader inventory and reuse disposition

| Reader / module | Operation and scope | Grain | Runtime | Side effects | Disposition |
| --- | --- | --- | --- | --- | --- |
| `ebay-seller-account-scope.ts` | Local expected alias/User ID/fingerprint binding | Account | Config | None | `REUSE_AS_IS`; configuration is not certification. |
| `ebay-manual-listing-trading-readonly.ts` | OAuth refresh; Trading `GetUser`/`GetItem`; base scope | Account / known Item | Live | Access token in memory only | `REUSE_WITH_ADAPTER`; known-ID verification, not discovery. |
| `ebay-commercial-monitor-live-readonly.ts` | Exact allowlist above plus REST GET readers | Account / Item / order line | Live | None | New canonical bounded coordinator; all projections remain response-local. |
| `ebay-seller-traffic-report.ts` | Analytics traffic report request/row normalization | Item / window | Live adapter | None | `REUSE_WITH_ADAPTER`; canonical monitor consumes nullable rows, never the zero-coercing legacy summary. |
| `ebay-commercial-analytics-domain.ts` | Reconciliation and freshness | Item / window | In-memory | None | `REUSE_AS_IS`. |
| `commercial-monitor-readonly-repository.ts` | Existing registry/snapshot/Luna/order/learning SELECTs | Account / Item / component / order | Stored | SELECT only | `REUSE_AS_IS`. |
| `ebay-active-listing-readonly-sync.ts` | Inventory GETs followed by registry RPC writes | SKU / offer | Live + persisted | DB mutations | `REFACTOR_BEFORE_REUSE`; never imported by canonical monitor. |
| `ebay-commercial-readers.ts` | Analytics, Orders and Trading readers in a broad module | Multiple | Live | Reads only, but broad coupling | `REFACTOR_BEFORE_REUSE`; narrow behavior was adapted without importing the module. |
| `ebay-commercial-monitor-service.ts` | Legacy monitor | Multiple | Mixed | DB/outbox/dispatch writes | `DO_NOT_REUSE`. |
| seller runtime and winning-listing runners | Fixtures/Browse/comparable market evidence | Simulation / market | Non-seller or fixture | Varies | `DO_NOT_REUSE` as seller evidence. |

No `13_MASTER_STRATEGY_REGISTRY` file exists in the available Git history. The
historical sandbox OAuth and runtime read-only branches are ancestors of the
canonical staging base and remain reference checkpoints, not integration bases.

## OAuth and scope contract

Tokens and credentials remain server-side. A refresh grant may mint an access
token only in memory; the coordinator does not return, log, persist or rotate a
refresh token or access token.

| Scope | Required reader | Classification before successful live proof |
| --- | --- | --- |
| `https://api.ebay.com/oauth/api_scope` | Trading `GetUser` and `GetMyeBaySelling` | `READ_REQUIRED`; the scope is write-capable, so successful use also carries `WRITE_CAPABLE_BUT_NOT_USED`. |
| `.../sell.inventory.readonly` | Inventory item and offer GETs | `READ_REQUIRED`. |
| `.../sell.analytics.readonly` | traffic report GET | `READ_REQUIRED`. |
| `.../sell.fulfillment.readonly` | order GET | `READ_REQUIRED`. |

Runtime output always preserves `READ_REQUIRED` and adds `READ_AVAILABLE` only
after the scope is returned by OAuth or the corresponding authenticated reader
succeeds. `MISSING` is emitted only when an OAuth response explicitly returns
its scope list and omits the requested scope. Timeout, network error,
scope-list omission and source-format failure do not prove a scope is missing;
they remain limitations with the grant unproven. Configuration presence alone
is insufficient. Fulfillment additionally requires the
dedicated `EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN`; it never falls back to the
general seller refresh token.

## Listing discovery and reconciliation

The seller-wide source is `GetMyeBaySelling.ActiveList`, requested with 200
entries per page, `HideVariations=false` and no notes. All pages must finish.
The result is reconciled response-locally against:

1. Inventory API records/offers;
2. the existing Managed Listing Registry SELECT result.

Inventory is not universal: eBay documents that listings created in Seller Hub
or through Trading do not automatically appear in Inventory API. Therefore an
Inventory zero never means the seller has zero active listings.

Discovery cannot be `COMPLETE` when a page fails, pagination metadata
contradicts itself, variation identity is ambiguous, pagination is unproven, the
25,000-entry `GetMyeBaySelling` limit is reached, Inventory/registry comparison
is unavailable, or a difference remains unexplained. A live listing absent
from the registry stays visible as an unregistered discovery blocker; it is not
silently omitted or persisted. Registry reconciliation uses the exact
Item/SKU/variation identity; an Item-only match cannot close a variation gap.
Listings whose returned marketplace is absent or not US remain only as an
explicit coverage gap and are never projected under `EBAY_US`. Ambiguous
variation identities suppress durable supplier/product linkage and stock
signals for that evidence rather than borrowing a null or shared mapping.

The request has a fail-closed 24-second/60-call aggregate budget inside the
30-second route ceiling. Evidence obtained before a later page/chunk failure is
retained as `PARTIAL`; it is never discarded or promoted to complete. A US
account certification also requires live identity binding plus marketplace
evidence from `GetUser.Site` or returned US listing evidence.

## Truthful evidence behavior

- Item traffic remains Item-grain; it is not promoted to a variation.
- Analytics certification requires every requested metric column and one
  explicit, parseable metric cell per column plus one unambiguous row per
  returned Item grain.
- Missing, `applicable=false` or applicability-unknown Analytics cells remain
  unavailable; they never become zero.
- Reported CTR/conversion retain the raw eBay API rate unit; calculated CTR is
  an explicit percentage. They are never silently normalized into each other.
- Calculated CTR requires compatible search-result views and impressions from
  the same Item and reporting window, with explicit formula/input provenance.
- Source freshness uses the report's update timestamp; collection time remains
  separate provenance and cannot make a stale report fresh.
- Low-CTR alert candidates use only the compatible-input calculated percentage;
  the raw reported rate is never compared with a percentage threshold.
- A zero is accepted only when eBay explicitly reports the applicable cell.
- Orders are a sanitized, checkout-complete and bounded operational window,
  not complete lifetime sales.
- Fulfillment continuation links must preserve the exact requested date filter,
  page limit and monotonic offset. Rows outside the declared window are
  discarded and force `PARTIAL` rather than widening the evidence silently.
- Cancelled/refunded/unpaid orders are excluded; missing quantity is excluded,
  never defaulted to zero.
- Buyer identity, contact, address, checkout notes, payment details and raw
  payloads are discarded before projection.
- Fees, shipping and net economics remain unavailable without complete inputs.
- Luna remains product/supplier evidence only; it never validates demand.

## Canonical dashboard source matrix

This matrix describes the implemented source contract and the current local
checkpoint. Because no safe local OAuth context exists, no field is marked
`YES` from live eBay evidence in this gate.

| Canonical dashboard field | Data source | Live available? | Grain | Window | Freshness | Completeness | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| eBay account | Trading `GetUser` + configured fingerprint | NO | Account | Request | UNKNOWN | UNPROVEN | `LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE` |
| Marketplace | `GetUser.Site` or returned US listing evidence | NO | Account/Item | Request | UNKNOWN | UNPROVEN | `EBAY_US_MARKETPLACE_BINDING_UNPROVEN` |
| Last synchronization | Per-reader call plus source observation | NO | Reader | Per call | UNKNOWN | UNPROVEN | No authenticated call |
| Data coverage | `GetMyeBaySelling` + Inventory + Managed Registry | NO | Account | Active inventory at read time | UNKNOWN | UNPROVEN | OAuth, pagination and reconciliation unproved |
| eBay Analytics | Analytics `traffic_report` | NO | Item | Closed trailing 30 UTC days | UNKNOWN | UNPROVEN | Scope and live report unavailable |
| Luna Portex | Existing latest-variant/source-health SELECTs | PARTIAL | Component | Latest stored snapshot | Stored timestamp | PARTIAL | Exact link, heartbeat, parser or freshness may block |
| Active listings | `GetMyeBaySelling.ActiveList` | NO | Item/variation | Active at read time | UNKNOWN | UNPROVEN | Seller-wide call not executed |
| Critical actions | Pure blocker/alert projection | PARTIAL | Listing/component | Evidence episode | Evidence dependent | PARTIAL | Informational only; never dispatches |
| Stock risk | Luna/product truth + exact registry link | PARTIAL | Listing component | Latest stored snapshot | Evidence dependent | PARTIAL | Composition/shared allocation/link may be absent |
| Impressions | `TOTAL_IMPRESSION_TOTAL` | NO | Item | Closed 30-day UTC report | Source update time | UNPROVEN | Analytics not called |
| eBay views | `LISTING_VIEWS_TOTAL - LISTING_VIEWS_SOURCE_OFF_EBAY` | NO | Item | Closed 30-day UTC report | Source update time | UNPROVEN | Both compatible inputs required; total is never mislabeled as eBay-only |
| Average/report CTR | `CLICK_THROUGH_RATE` raw | NO | Item | Same report window | Source update time | UNPROVEN | Unit and live row unavailable |
| Calculated CTR | Search views / search impressions | NO | Item | Same report window | Source update time | UNPROVEN | Compatible inputs unavailable |
| Orders | Fulfillment `getOrders` | NO | Order/order line | Trailing 30 days | UNKNOWN | UNPROVEN | Dedicated token/scope unavailable |
| Net profit | Seller OS economics | NO | Listing | Unavailable | UNKNOWN | UNPROVEN | Fees, shipping, costs and currency incomplete |
| Listings by state | Seller-wide discovery | NO | Item | Active at read time | UNKNOWN | UNPROVEN | Coverage gap cannot display zero |
| Distribution by type | Explicit Trading fields | NO | Item/variation | Active at read time | UNKNOWN | UNPROVEN | Listing evidence unavailable; type never inferred |
| Listing table identity/state/title/SKU | Trading + exact stored links | PARTIAL | Item/variation | Per observation | Evidence dependent | PARTIAL | Live identity unavailable; stored coverage may exist |
| Listing table price/quantity | Explicit Trading fields | NO | Item/variation | Active at read time | UNKNOWN | UNPROVEN | Live listing call not executed |
| Product Case link | Future persistent Product Case repository | NO | Listing | Versioned lookup | UNKNOWN | UNPROVEN | Persistence intentionally paused |
| Critical alerts | Pure deterministic candidates | PARTIAL | Listing/component | Evidence episode | Evidence dependent | PARTIAL | Candidate-only; dispatch flags false |
| Priority action plan | Informational next-action projection | PARTIAL | Listing | Current evidence | Evidence dependent | PARTIAL | Human review only |
| Next reviews | Evidence freshness/blockers | PARTIAL | Listing/source | Per evidence | Evidence dependent | PARTIAL | No scheduler/outbox action |
| Experiments | Future authoritative Experiment Registry | NO | Listing/experiment | Experiment lifecycle | UNKNOWN | UNPROVEN | Registry unavailable |
| Learning | Existing Learning Registry SELECT | PARTIAL | Category/model | Stored model run | Stored timestamp | PARTIAL | Eligibility/evidence status may block |
| Data quality | Reader/coverage/semantic gates | YES | Account/listing | Current response | Request time | COMPLETE for emitted issues | Independent from recommendations |
| Timeline/audit | Sanitized evidence references | PARTIAL | Account/listing | Available evidence | Evidence dependent | PARTIAL | No raw payloads or buyer PII |

## Local certification checkpoint

At the time this foundation was authored, the isolated worktree had no safe
local eBay authentication context or authenticated Admin session. No live eBay
call was made. Account scope, token freshness and granted scopes therefore
remain unproven until credentials are provisioned ephemerally server-side under
a separate authorization gate. Cached metadata from excluded worktrees is not
an authorized credential source and is never copied or loaded.

## Refresh and containment

`Actualizar datos` repeats the same authenticated internal `GET`. That request
may invoke only the allowlisted readers above and the existing SELECT-only
repository. It cannot call internal POST/PUT/PATCH/DELETE routes, persist a
snapshot, update a listing, write fulfillment, create an outbox record or
dispatch WhatsApp.

The legacy mutable endpoint `/api/admin/ebay/commercial-monitor` remains a
separate historical surface. It is not imported, linked, fetched or used as a
fallback by the canonical monitor. Its retirement/containment is still required
before merge.

## Official source references

- [GetMyeBaySelling](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBaySelling.html)
- [GetMyeBaySelling ActiveList guide](https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/my-ebay-selling.html)
- [GetSellerList](https://developer.ebay.com/devzone/XML/docs/Reference/ebay/GetSellerList.html)
- [Inventory getInventoryItems](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/getInventoryItems)
- [Inventory getOffers](https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/getOffers)
- [Inventory migration limitation](https://developer.ebay.com/support/kb-article?KBid=5276)
- [Analytics traffic report](https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport)
- [Fulfillment getOrders](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders)
- [OAuth authorization](https://developer.ebay.com/develop/guides-v2/authorization)

## Product Case invariant

```text
PRODUCT_CASE_STATUS = PAUSED_FOR_MONITORING_MILESTONE
PRODUCT_CASE_RESET = false
PRODUCT_CASE_RESUME_POLICY = RESUME_FROM_LAST_VERIFIED_GATE
MANUAL_GOLDEN_PATH_V1 = PRESERVE
PERSISTENT_PRODUCT_CASE_FOUNDATION_IMPLEMENTED = false
```
