# Market Radar Adaptive Batch Timeout Recovery V1

## Problem

Market Radar could fetch Luna Portex successfully and still fail while persisting products, snapshots, events or scores with PostgreSQL error `57014: canceling statement due to statement timeout`. Historical lookup timeouts already had degraded fallbacks, but critical writes used fixed batches and aborted the whole scan without identifying the failing stage.

## Recovery model

Critical writes now start with bounded batches:

- Products: 25.
- Snapshots: 50.
- Events: 50.
- Scores: 50.

When PostgreSQL times out, the affected batch is split in half and retried. Splitting continues until the batch succeeds or reaches five rows. A timeout at the minimum size fails safely with an attributed stage:

- `PRODUCT_UPSERT_TIMEOUT`
- `SNAPSHOT_INSERT_TIMEOUT`
- `EVENT_UPSERT_TIMEOUT`
- `SCORE_UPSERT_TIMEOUT`

Non-timeout failures also preserve their stage with the suffix `_FAILED`.

## Coverage report

A successful response now reports:

- `catalogProductsFetched`
- `uniqueProductsFetched`
- `productsUpserted`
- `productsWithSnapshots`
- `scoredProducts`
- `failedBatchCount`
- `adaptiveRetryCount`
- `scanCompletenessPercent`
- `scanStatus: COMPLETE | PARTIAL | FAILED`

The Market Radar UI shows these values after a scan. `last_success_at` is updated only after all required write stages finish. If a stage ultimately fails, `last_error` includes the stage and adaptive retry telemetry.

## Interpretation

`COMPLETE` means every unique fetched product was saved, received at least one snapshot and received a score. `PARTIAL` means the request completed but one or more products did not reach every required stage. Numeric inventory hydration remains a separate coverage measure and is not invented by this fix.

## Safety boundaries

- No Production operation was executed by this implementation.
- No scan is run by tests.
- No eBay API or eBay write.
- No draft, offer, listing or publication.
- No Supabase schema or timeout setting change.
- No secrets, tokens or `.env` changes.
- Existing Market Radar tables and idempotency keys are preserved.
