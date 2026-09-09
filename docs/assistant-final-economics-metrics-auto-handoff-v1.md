# Mayel economics, metrics and automatic handoff

Task: SELLER_OS_ASSISTANT_FINAL_ECONOMICS_METRICS_AUTO_HANDOFF_CLOSEOUT_V1.
Base: dc89a7978d39ec2e191e7d5f45abba98b3ce8c7e. Dedicated preprod only.

Latest continuation: [official fee-context readback and remaining blockers](assistant-fee-context-closeout-v1.md), implementation `926f105d68fe5d745a9895a8781a0d9ec904376c`, 378/378 suite PASS. The evidence below is the earlier certified snapshot and retains its original timestamps.

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

Directed tests cover cold-to-warm transition, exact identity/window isolation, overlapping samples, fee completeness, promotion ceilings, stable envelope identity, stale evidence and official package linkage. SHA `8b8a2127d94908f4c99a873924b1d31acb53b9a9` passed 377/377 full-suite files, typecheck, lint, build, operational audit and targeted runtime security. Validation completed 2026-09-09T18:09:55.605Z. There are zero new regressions. The local build initially attempted with Node's default memory cap exhausted its heap; the existing certification runner completed successfully with its established memory configuration.

The four primary actions and existing [Ayuda / Manual](https://imnova-seller-os-preprod.vercel.app/manual-mayel-menu-v1.pdf) remain available. Mayel can select a listing and analyze it normally. “Obtener más datos” means there is not yet enough comparable sales evidence; “Requiere atención” identifies a missing or expired authority. Neither status authorizes an eBay change.

## Requested result

Contract/test results are distinguished from physical business certification. A hypothetical cost fixture passing the 3–5% simulation is not a successful economic canary on this real listing. New-publication auto binding is tested through the existing official-readback contract, but no new listing was published to claim a physical publication PASS.

```text
STATUS=BLOCKED_PRE_SALE_FEE_AUTHORITY
IMPLEMENTATION_SHA=8b8a2127d94908f4c99a873924b1d31acb53b9a9
EBAY_FEE_AUTHORITY_CERTIFIED=false
PRE_SALE_FEE_ESTIMATE_PROVEN=false
EBAY_FEES=UNPROVEN
PROFIT_BEFORE_ADS=UNPROVEN
MARGIN_BEFORE_ADS=UNPROVEN
MAX_SAFE_AD_RATE_PCT=UNPROVEN
METRICS_WARM_CANDIDATE_FOUND=false
METRICS_WARM_CANARY_PASS=NOT_APPLICABLE
METRICS_COLD_START_PASS=true
FUNNEL_DIAGNOSIS_STATUS=PENDING_REAL_SAMPLE
METRICS_AUTO_REEVALUATION_PATH_PASS=true
COMMERCIAL_ENVELOPE_PASS=PARTIAL_AUTHORITIES_PENDING
NEW_LISTING_AUTO_BOUND_TO_MAYEL=CONTRACT_PASS_PHYSICAL_NEW_PUBLICATION_NOT_EXECUTED
SHIPPING_AUTO_BOUND=true
FEE_AUTHORITY_AUTO_BOUND=false
KEYWORD_V2_1_AUTO_BOUND=true
METRICS_AUTO_ATTACHED=true
QUALITY_AUTO_ATTACHED=true
PROMOTION_SIMULATION_PASS=false
CODEX_RUNTIME_DEPENDENCY=false
OWNER_MANUAL_REPAIR_REQUIRED=false
FULL_SUITE_RESULT=377/377_PASS_TYPECHECK_LINT_BUILD_AUDIT_PASS
NEW_REGRESSION_COUNT=0
ASSISTANT_CLOSEOUT=false
SAFE_FOR_SELL_ONE_LIKE_THIS=false
SAFE_FOR_SINGLE_LISTING_PUBLICATION_CANARY=false
SAFE_FOR_EBAY_ADS_WRITE_CANARY=false
NEXT_ACTION=COMPLETE_OFFICIAL_ACCOUNT_CATEGORY_FEE_AUTHORITY_AND_PROVEN_PRE_SALE_BASIS_THEN_RUN_ECONOMIC_CANARY
```

`CODEX_RUNTIME_DEPENDENCY=false` and `OWNER_MANUAL_REPAIR_REQUIRED=false` describe the automatic read/binding paths, not a claim that the missing fee-authority producer is complete. Marketplace writes and Ads writes remain zero. `EBAY_ADS_WRITE_ENABLED=false` remains enforced. Policy controls are configurable, but no maximum safe advertising rate has been certified for the real canary, and the example 3–5% range is not authorization to spend.

Deployment readback: `dpl_qYRMoYnuycj5FGPMj5GkHySxUJeG` is READY in the dedicated preprod project with implementation SHA `8b8a2127d94908f4c99a873924b1d31acb53b9a9`. The deployed product-case envelope returned HTTP 200, trace `c94f3de7-fc81-45ba-9336-2f9cb068d4bb`, for the exact package/item. Its overall state is ESPERANDO_DATOS; it preserves proven package, SKU, product cost, Shipping, category, specifics, images and Keyword references while fee authority and post-sale evidence remain pending. The manual returned HTTP 200 and matches the certified PDF. No physical publication or Ads write was executed.
