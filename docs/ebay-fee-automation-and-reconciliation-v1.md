# Fee automation and conservative bounds V1

This change connects the existing category resolver to the economics lane and the existing Fulfillment order ingestion path. It preserves the certified Shipping, Keyword, Quality and preview workflows. It does not enable eBay publication or advertising writes.

## Producer and handoff

Package creation or changes enqueue an exact account/package binding through a database trigger. Official publication readback attaches Item ID/SKU. The existing economics lane processes at most two pending pre-publication packages and its existing bounded fee jobs. Before publication, missing official context remains pending. LIVE fee jobs read official category/format, account subscription/performance, and the current official tariff page. Supported tariff structures can update their rates without a code deployment; unsupported or ambiguous structures remain pending. There is no global category fallback.

The new ledger stores immutable authorities. A compare-and-swap against the binding revision prevents a calculation in flight from restoring an authority invalidated by a newer package change. Current account/store/category/format and policy evidence are re-evaluated on existing economics runs. Category/format changes invalidate incompatible scenario evidence; a changed supported policy recalculates against still-valid scoped evidence. No new polling service or background worker exists.

Mayel reads the current authority and latest actual receipt through its normal bounded reads, respecting the existing Product Case time budget. A newer pending authority suppresses an older successful amount. The UI displays “Economía: esperando datos de la orden”; account-authority dependencies and individual components remain in Ver detalles. A normal subsequent Mayel request sees new evidence; no engineer reloads or repairs cached fee data. This is read-through handoff, not a new browser push or polling mechanism.

## Pre-sale safety

Base category authority, contingent order components, and actual post-sale fees are separate. Monetary unknowns are null. An official rate cap is not itself a complete monetary risk bound.

`CONSERVATIVE_SAFE_BOUND` requires current official evidence covering every eligible order within the exact account/item/category/currency/scenario. Coverage includes buyer tax, international applicability, currency conversion and tax on fees. The proven upper bound feeds the existing profit/margin and advertising ceiling guard. The guard still blocks insufficient margin or unproven costs. Three-, four- and five-percent simulations use test-specific floors, not a global operator policy.

A directed regression exposed the whole-amount tariff discontinuity: with a jewelry order basis between $4,900 and $5,200, 15% of $5,000 is a larger fee than 9% of $5,200. The existing resolver now considers thresholds inside a proven upper-bound range. Exact-scenario behavior is preserved.

## Actual fees

The existing `getOrders` normalizer retains official `totalMarketplaceFee` and `totalFeeBasisAmount`, with matching currency and without buyer PII. Ingestion stores these observed fields, then automatically attempts reconciliation before the sale-event deduplication exit. Reconciliation retries through existing ingestion behavior; no extra notification is sent.

For an eligible single-line, single-unit order, reconciliation binds exact account/Item ID/SKU to the most recent authority observed no later than the sale. Receipts are immutable and idempotent per official monetary revision. Future adjustments create a new receipt, never overwrite the original estimate. Comparison emits a delta only with a comparable, valid pre-sale estimate; otherwise it records observed actuals with comparison pending. A safe bound exceeded by observed fees is explicit.

Fulfillment's aggregate is labeled accrued marketplace fees, not an invented itemized Finances breakdown or a guarantee against later adjustments. A multi-item cart remains allocation-pending; its order aggregate is retained in the order snapshot and is never duplicated across its listings. Historical actual fees never replace current pre-sale authority.

## Official sources

- [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822): category tariffs, order fee, fee basis and contingent fees.
- [eBay international fee policy](https://export.ebay.com/en/fees-regulations-policies/seller-fees/international-fees/): regulatory operating fee scope; the supported eBay US listing is outside that marketplace scope.
- [Fulfillment official release notes](https://www.developer.ebay.com/api-docs/sell/fulfillment/release-notes-archive.html): official order aggregate fee and basis fields.

## Verification

Directed tests cover new-package handoff, category/subscription changes, pending buyer context, no implicit zeros, conservative coverage, tariff discontinuities, immutable/idempotent reconciliation, actual-versus-estimate deltas, Mayel read-through updates, existing runtime hooks, profit guard simulations, database triggers, concurrency and ACLs. Physical staging evidence and the final full-suite/deployment result are recorded separately after validation.

The canary remains Item ID `366650054490`, category `50692`. No new sale is fabricated to certify the automation. A fully covered monetary bound is not yet established for this real listing; advertising remains disabled.

## Physical closeout status, 9 September 2026

Implementation and contract validation passed. Operational closeout remains pending: fresh server-side fee acquisition returned HTTP 502 on both the new deployment and the previous certified deployment. The existing official Developer Analytics quota diagnostic reported Trading BLOCKED, remaining=0, with reset at 2026-09-10T07:00:00Z (01:00 Guatemala). No additional Trading certification probe is permitted while blocked. After a proven reset, allow at most one controlled acquisition for the same canary.

The real staging producer reused official evidence captured at 19:05:36–38 UTC. It persisted an immutable authority, repeated idempotently, and Mayel consumed it through a deployed HTTP 200 Product Case response. This demonstrates durable producer/handoff behavior; it does not substitute for a fresh Trading acquisition. Recalculation is capped to the original source freshness and cannot refresh source evidence by itself.

Eight components are classified. The real canary has five material amount/authority dependencies: total basis including buyer tax, exact category service metrics, international applicability, conversion, and tax on fees. The regulatory operating component is explicitly not applicable for the supported US listing. A complete official monetary bound is not proven. Profit, margin and maximum safe ad rate remain null; 3%, 4% and 5% are not approved for this canary. Complete conservative-bound fixtures do pass those simulations under explicit test policy floors; they are not real canary economics.

The operator additionally reported an empty Mayel selector. Its current-only GET hid all 23 last-certified listings after the official source became unavailable. The isolated selector repair reads stored authority and registry data, keeps historical browsing available and preserves current-LIVE action gates. Physical staging verification returned 20 and 3 listings with their titles, using four bounded database reads and zero eBay reads. It does not certify applying improvements to eBay.

The final evidence file records validation, deployment and trace IDs. No marketplace or Ads write was performed. The four-action menu and existing Ayuda / Manual PDF are preserved. Full end-to-end application of a listing improvement and advertising activation are not declared complete.
