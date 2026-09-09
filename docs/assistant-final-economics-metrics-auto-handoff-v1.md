# Mayel economics, metrics and automatic handoff

Task: SELLER_OS_ASSISTANT_FINAL_ECONOMICS_METRICS_AUTO_HANDOFF_CLOSEOUT_V1.
Base: dc89a7978d39ec2e191e7d5f45abba98b3ce8c7e. Dedicated preprod only.

The automatic readers and cold-start behavior are implemented. Commercial closeout remains blocked by incomplete pre-sale fee authority. An unproven fee is not zero, and neither profit nor an allowed advertising rate is certified for the real listing.

## Verified real evidence

The bounded readback is in `assistant-final-economics-metrics-auto-handoff-v1-readback.json`. The canary is item 366650054490, SKU IMNOVAA59C2C921CDD4975ADD29540657D8A60. Its exact durable package resolves automatically to a59c2c92-1cdd-4975-add2-9540657d8a60; the unchanged Keyword V2.1 consumer returns ACCEPTED. The existing secure preprod Assistant relay returned HTTP 200, trace 0340bb52-1b93-4b30-969e-47e863fd4dbc, with metrics and Quality import e40ff605-520b-4592-bec9-c63412ad54ea.

Price is 18.74 USD, product cost 1.79 USD, and the preserved Shipping authority is 6.99 USD, captured 2026-09-09T17:40:47.783Z and fresh until 23:40:47.783Z. These amounts have separate freshness boundaries in the readback; they are not renewed by this report. No Shipping capture, job change, regeneration, or historical-row mutation occurred.

The 23 current LIVE listings inspected have zero transactions in their current 30-day observations. The selected listing has no sufficient 7D or 30D sample. Repeated captures of the same reporting period are not added together. This is valid cold start, with FUNNEL_DIAGNOSIS_STATUS=PENDING_REAL_SAMPLE, not a failed funnel diagnosis or a fabricated warm PASS.

## Fee authority boundary

Existing `EXPECTED_EBAY_FEE` evidence for category 50692 is SOURCE_UNAVAILABLE with no amount. Its previous resolver only certifies another category. The new Mayel consumer requires exact account, marketplace, Item ID, category, store/account context, source/version/freshness, complete components, and a demonstrated fee basis. It accepts PRE_SALE_FEE_ESTIMATE separately from ACTUAL_POST_SALE_FEE. Historical actual fees cannot silently activate the current estimate.

The official [selling fee policy](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) makes fees dependent on category and seller context; its sale basis includes buyer shipping, handling and buyer tax. Account performance, international/currency charges, regulatory charges and taxes on fees need applicability evidence. The current evidence does not supply all of these inputs or a demonstrated upper bound. A published base rate alone cannot certify the requested promotion ceiling.

The official [Trading fee documentation](https://www.developer.ebay.com/api-docs/user-guides/static/trading-user-guide/fees.html) explains that listing verification is not the full selling cost. The [Inventory expected-fee operation](https://developer.ebay.com/api-docs/sell/static/inventory/expected-listing-fees.html) concerns unpublished offers and groups listing fees by marketplace; it is not evidence of a complete current final-value fee for this LIVE canary. No offers were created to invoke it.

The concrete remaining work is an official account/category fee-authority producer and a demonstrated buyer-dependent fee-basis scenario or upper bound. The consumer is ready, but a producer has not been certified. This is an implementation/evidence blocker, not a request to reconfirm the already durable OWNER variable-cost policy.

## Automatic behavior

`SELLER_OS_ASSISTANT_METRICS_COLD_START_V1` reads existing per-item snapshots on each normal Mayel analysis. It compares one current period with one independent prior period for the same account/item and exact requested window. The declared sample rule uses 95% Wilson intervals and a relative half-width at most 25%, plus a count precision check. These are evidence-precision gates, not universal CTR/conversion targets. Overlapping intervals remain inconclusive; healthy/low classification requires separation. A future sufficient independent sample can change TEST without code changes or Codex intervention.

The promotion response for TEST remains BLOCKED_EVIDENCE even when a unit-economics simulation is mathematically possible. No statistically unsupported optimization is introduced. The existing simulation, receipt and image gates remain in place.

`SELLER_OS_LISTING_COMMERCIAL_ENVELOPE_V1` is an on-read projection over durable packages and official publication/manual-link receipts, not a second mutable ledger. The existing product-case reader provides the pre-publication projection; the revenue reader resolves its exact package automatically after official readback. It attaches existing economics, Keyword V2.1, metrics and Quality references. Missing/awaiting components remain PENDING; stale values retain provenance. The UI adds only “Datos del listing” and its friendly state, with technical evidence in “Ver detalles”.

This does not certify that every component is PROVEN: the current fees remain NEEDS_EVIDENCE, actual sale fees remain pending, and image authorization remains subject to the preserved source resolver. Creating a new listing or a physical publication canary is outside this run. Complete auto-handoff certification remains conditional on the unresolved authorities and deployment readback.

No new pollers, background workers, global scans, exact counts, select-star queries or marketplace writes were added. Reads are bounded per selection (maximum 20) and per authority; the real binding/metrics/economics check used nine database reads. No Ads API write contract is enabled.

## Validation and operator help

Directed tests cover cold-to-warm transition, exact identity/window isolation, overlapping samples, fee completeness, promotion ceilings, stable envelope identity, stale evidence and official package linkage. Full-suite and deployment results will be appended after verification.

The four primary actions and existing [Ayuda / Manual](https://imnova-seller-os-preprod.vercel.app/manual-mayel-menu-v1.pdf) remain available. Mayel can select a listing and analyze it normally. “Obtener más datos” means there is not yet enough comparable sales evidence; “Requiere atención” identifies a missing or expired authority. Neither status authorizes an eBay change.
