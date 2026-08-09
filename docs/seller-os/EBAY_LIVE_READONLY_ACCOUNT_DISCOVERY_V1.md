# eBay Live Read-Only Account + Discovery V1

Status: account binding and the base Trading reader were certified by
sanitized human Preview runs. At the `b52fb32` checkpoint, `GetUser` and a
one-page `GetMyeBaySelling` read reported and parsed 26 active Items;
item-level `GetItem` certified 11 as `EBAY_US` and the temporal reserve left 15
as `BUDGET_EXHAUSTED`. Analytics read the 11 certified IDs, Inventory OAuth
returned the safe category `INVALID_SCOPE`, and every write counter remained
zero. The bounded scheduling correction described here still requires one
human Preview retest on its exact commit.

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
   → Trading GetItem for item-level marketplace certification
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
| `GetItem` | POST | `/ws/api.dll` | Certify `Item.Site` for each unique seller-wide Item. |

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

For a non-2xx OAuth response, the coordinator reads the error body only in
memory and emits one allowlisted category: `INVALID_SCOPE`, `INVALID_GRANT`,
`INVALID_CLIENT`, `INVALID_REQUEST`, `UNSUPPORTED_GRANT_TYPE`, or
`OAUTH_ERROR_UNCLASSIFIED`. It never returns the raw body or
`error_description`; the sanitized call ledger retains only the HTTP status.

## Listing discovery and reconciliation

The seller-wide source is `GetMyeBaySelling.ActiveList`, requested with 200
entries per page, `HideVariations=false` and no notes. All pages must finish.
The result is reconciled response-locally against:

1. Inventory API records/offers;
2. the existing Managed Listing Registry SELECT result.

Inventory is not universal: eBay documents that listings created in Seller Hub
or through Trading do not automatically appear in Inventory API. Therefore an
Inventory zero never means the seller has zero active listings. A successful
Inventory read and an exact missing offer are projected as
`NOT_REPRESENTED`/an expected model gap; `SOURCE_UNAVAILABLE` is reserved for a
reader that could not be performed. Capability, source-read completeness and
listing representation are separate dimensions.

Fresh `GetMyeBaySelling.ActiveList` is authoritative for current live
existence. Its `liveEnumeration` dimension cannot be `COMPLETE` when a page
fails, pagination metadata contradicts itself, the reported/parsed Item count
does not reconcile, pagination is unproven, or the 25,000-entry limit is
reached. Marketplace certification, Inventory representation, registry
coverage, historical evidence freshness and Analytics remain independent
dimensions. The aggregate account coverage may remain `PARTIAL` while fresh
Trading live existence is `COMPLETE`; that does not turn a current live listing
into `NOT_LIVE` or `LISTING_DISCOVERY_INCOMPLETE`.
The live Item cardinality is therefore labeled as an observed count. It is an
authoritative seller-wide total only when `liveEnumeration=COMPLETE`; under
`PARTIAL` it is a lower-bound observation, never an inferred total or zero.

A live listing absent from a complete registry read stays visible as an
unregistered discovery blocker; it is not silently omitted or persisted. If
the registry read is unavailable, truncated, invalid, future-dated or stale,
absence is `UNPROVEN` and only the account-level source/reconciliation issue is
emitted. Registry reconciliation uses the exact Item/SKU/variation identity;
an Item-only match cannot close a variation gap. Historical registry or
identity evidence may be shown as stale, but cannot negate fresh Trading live
existence.
`GetMyeBaySelling` remains the seller-wide enumeration authority. Because its
ActiveList contract does not guarantee `Item.Site`, the coordinator preserves
all parsed Item identities and calls allowlisted `GetItem` exactly once per
unique Item scheduled in the pass. Only an exact `GetItem` Item ID match with
one explicit recognized `Item.Site=US` may enter the `EBAY_US` projection. A
seller-wide `Item.Site`, when present, is only a conflict cross-check; it never
substitutes for `GetItem`. Duplicate/conflicting fields and values outside the
documented `SiteCodeType` remain unproven. Certified non-US Items are counted
but excluded; missing Site, Ack/transport failure, Item ID mismatch, or budget
exhaustion remain separate partial-coverage states. `GetUser.Site`
certifies only the account registration site and is never used as an Item
marketplace fallback. Ambiguous
variation identities suppress durable supplier/product linkage and stock
signals for that evidence rather than borrowing a null or shared mapping.

Marketplace counters are Item-grain and keep reported, parsed, US-certified,
non-US-certified, unresolved, error, Item-ID-mismatch, budget-exhausted and
represented counts separate. Every parsed unique Item belongs to exactly one
of the six terminal certification buckets, so the partition is conserved and
non-overlapping. They are nullable before seller-wide evidence exists. A zero
is authoritative only when complete seller-wide pagination explicitly reports
zero; `reported > 0` with `represented = 0` is never displayed as zero active
listings.

Response-local listing alerts require fresh current Trading presence and exact
US marketplace certification. Account-global pagination, Inventory, registry
or historical-evidence failures produce one account-grain coverage candidate;
they are not multiplied across every stored listing. Stored-only rows remain
visible for diagnosis but cannot inherit current live presence or operational
alerts from their historical source label.

The request has a fail-closed 24-second/60-call aggregate budget inside the
30-second route ceiling. Each call has a 7.5-second timeout. Item-level
verification uses deterministic batches of at most four concurrent unique
Item IDs, a hard 32-Item cap, and reserves nine calls plus six seconds for
downstream readers. These limits are not expanded. IDs above the hard cap or a
batch that cannot preserve the reserve remain `BUDGET_EXHAUSTED`. Evidence
obtained before a later page/chunk failure is retained as `PARTIAL`; it is never
discarded or promoted to complete. A US account certification requires live
identity binding and `GetUser.Site=US`; listing marketplace certification
remains independent and Item-grain.

## Truthful evidence behavior

- Item traffic remains Item-grain; it is not promoted to a variation.
- Analytics certification requires every requested metric column and one
  explicit, parseable metric cell per column plus one unambiguous row per
  returned Item grain.
- Analytics exposes requested, represented and missing Item counts plus an
  explicit `COMPLETE | PARTIAL | UNPROVEN` coverage status. Marketplace-partial
  discovery forces seller-wide Analytics coverage to remain `PARTIAL`.
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

This matrix describes the implemented source contract and an archived sanitized
2026-08-08 runtime checkpoint. Its numeric checkpoint is historical evidence,
not current-run truth; the monitor always recomputes counters from the present
bounded read.

| Canonical dashboard field | Data source | Live available? | Grain | Window | Freshness | Completeness | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| eBay account | Trading `GetUser` + configured fingerprint | YES | Account | Request | Observed 2026-08-08 | COMPLETE | Binding certified in the prior human Preview run |
| Marketplace | `GetUser.Site` for registration; `GetItem.Site` per listing | PARTIAL | Account/Item | Request | Evidence timestamp | PARTIAL | 11 certified, 15 budget-exhausted at latest human checkpoint |
| Last synchronization | Per-reader call plus source observation | PARTIAL | Reader | Per call | Request time | PARTIAL | Optional readers unavailable |
| Data coverage | `GetMyeBaySelling` + `GetItem` + Inventory + Managed Registry | PARTIAL | Account | Active inventory at read time | Request time | PARTIAL | 26 reported; 11 live US-certified; 15 budget-exhausted |
| eBay Analytics | Analytics `traffic_report` | PARTIAL | Item | Closed trailing 30 UTC days | Source update time | PARTIAL | 11 certified Item IDs represented; seller-wide marketplace coverage partial |
| Luna Portex | Existing latest-variant/source-health SELECTs | PARTIAL | Component | Latest stored snapshot | Stored timestamp | PARTIAL | Exact link, heartbeat, parser or freshness may block |
| Active listings | `GetMyeBaySelling.ActiveList` + `GetItem.Site` | PARTIAL | Item/variation | Active at read time | Request time | PARTIAL | 26 reported; 11 live US-certified; 15 budget-exhausted |
| Critical actions | Pure blocker/alert projection | PARTIAL | Listing/component | Evidence episode | Evidence dependent | PARTIAL | Informational only; never dispatches |
| Stock risk | Luna/product truth + exact registry link | PARTIAL | Listing component | Latest stored snapshot | Evidence dependent | PARTIAL | Composition/shared allocation/link may be absent |
| Impressions | `TOTAL_IMPRESSION_TOTAL` | PARTIAL | Item | Closed 30-day UTC report | Source update time | PARTIAL | 11 live certified Item IDs at latest checkpoint |
| Total listing views | `LISTING_VIEWS_TOTAL` | PARTIAL | Item | Closed 30-day UTC report | Source update time | PARTIAL | 11 live certified Item IDs; includes the total metric reported by eBay |
| Average/report CTR | `CLICK_THROUGH_RATE` raw | PARTIAL | Item | Same report window | Source update time | PARTIAL | Only the certified live subset was requested |
| Calculated CTR | Search views / search impressions | PARTIAL | Item | Same report window | Source update time | PARTIAL | Compatible inputs required per Item/window |
| Orders | Fulfillment `getOrders` | NO | Order/order line | Trailing 30 days | UNKNOWN | UNPROVEN | Dedicated token/scope unavailable |
| Net profit | Seller OS economics | NO | Listing | Unavailable | UNKNOWN | UNPROVEN | Fees, shipping, costs and currency incomplete |
| Listings by state | Seller-wide discovery | PARTIAL | Item | Active at read time | Request time | PARTIAL | 15 marketplace certifications budget-exhausted |
| Distribution by type | Explicit Trading fields | PARTIAL | Item/variation | Active at read time | Request time | PARTIAL | Only the live US-certified subset; type is never inferred |
| Listing table identity/state/title/SKU | Trading + exact stored links | PARTIAL | Item/variation | Per observation | Evidence dependent | PARTIAL | Only US-certified Items may be represented |
| Listing table price/quantity | Explicit Trading fields | PARTIAL | Item/variation | Active at read time | Request time | PARTIAL | Only the 11 live US-certified Items were response-local |
| Product Case link | Future persistent Product Case repository | NO | Listing | Versioned lookup | UNKNOWN | UNPROVEN | Persistence intentionally paused |
| Critical alerts | Pure deterministic candidates | PARTIAL | Listing/component | Evidence episode | Evidence dependent | PARTIAL | Candidate-only; dispatch flags false |
| Priority action plan | Informational next-action projection | PARTIAL | Listing | Current evidence | Evidence dependent | PARTIAL | Human review only |
| Next reviews | Evidence freshness/blockers | PARTIAL | Listing/source | Per evidence | Evidence dependent | PARTIAL | No scheduler/outbox action |
| Experiments | Future authoritative Experiment Registry | NO | Listing/experiment | Experiment lifecycle | UNKNOWN | UNPROVEN | Registry unavailable |
| Learning | Existing Learning Registry SELECT | PARTIAL | Category/model | Stored model run | Stored timestamp | PARTIAL | Eligibility/evidence status may block |
| Data quality | Reader/coverage/semantic gates | YES | Account/listing | Current response | Request time | COMPLETE for emitted issues | Independent from recommendations |
| Timeline/audit | Sanitized evidence references | PARTIAL | Account/listing | Available evidence | Evidence dependent | PARTIAL | No raw payloads or buyer PII |

## Archived local certification checkpoint

The protected Preview runtime supplied the existing credentials without export.
A legitimate human Supabase-admin refresh certified the seller binding,
`GetUser`, base scope and one complete `GetMyeBaySelling` page. Of 26 reported
and parsed Items, 11 were response-local US-certified and 15 remained
`BUDGET_EXHAUSTED`. Analytics read the 11 certified IDs and remained `PARTIAL`.
Inventory OAuth returned sanitized `INVALID_SCOPE`; Orders remained unavailable
without the dedicated credential. No access token, refresh token, header,
cookie or raw payload was returned or persisted.

## Inventory OAuth reauthorization readiness

The existing Production app is reusable; the monitor refresh path uses
`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` and `EBAY_SELLER_REFRESH_TOKEN`. The
existing account-policy OAuth helper and its historical centralized copy use
the same generic app, but are not directly reusable for this monitor: their
branch guard targets another Preview, their refresh-token sink is Supabase
Vault rather than the monitor environment variable, and their scope bundle
omits `sell.analytics.readonly`. The Commercial Monitor minimum for a future
separately authorized human consent is the base, `sell.inventory.readonly` and
`sell.analytics.readonly` scope set. Because `EBAY_SELLER_REFRESH_TOKEN` is
shared as an account-policy fallback, replacing it must also preserve the
existing `sell.account.readonly` capability or first introduce an explicitly
approved separate-token contract. Fulfillment must not be added. This document
does not authorize launching consent, persisting a token, or changing Vercel.

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
- [GetItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/getitem.html)
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
