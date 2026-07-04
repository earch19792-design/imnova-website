# Luna Portex Staging Write Adapter V1

## Why

The staging write gate can now produce an approved write plan from Luna Portex dry-run previews. This adapter converts that plan into table-shaped payloads while still avoiding any database write.

## Current State

- Production is Core-only, clean, and off-limits.
- Staging is reserved for eBay Pro.
- The scan executor and write gate are local dry-run only.
- The VM/Lab remains disconnected.
- Seller messaging remains dry-run only.

## What This Adapter Does

- Accepts the Staging write gate plan.
- Uses only eligible planned write candidates.
- Builds local payloads for eBay Pro Staging tables.
- Adds stable dedupe keys for idempotency planning.
- Marks every payload as `stagingOnly`, `dryRun`, and `approvalRequired`.
- Prints a local report through the CLI harness.

## What This Adapter Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect to Supabase, VM/Lab, marketplace, messaging, AI, or remote services.
- It does not create SQL or migrations.
- It does not read secrets or environment files.

## Allowed Payload Tables

- `ebay_product_candidates`
- `ebay_candidate_scores`
- `ebay_candidate_validations`
- `ebay_profit_scenarios`

## Forbidden Tables

- `products`
- `subscribers`
- `notification_logs`
- community tables
- Production tables

## Dedupe Keys

Each eligible candidate receives a stable key using the local source scan type and source id:

`luna-portex:FIRST_REAL_LUNA_PORTEX_SCAN:<sourceId>`

The key is generated locally and is intended for future Staging idempotency checks.

## Approval Checklist

- Confirm Production remains off-limits.
- Confirm Staging write execution is explicitly approved.
- Confirm payloads target only eBay Pro Staging tables.
- Confirm dedupe keys are stable.
- Confirm dry-run flags are changed only in a future approved execution loop.
- Confirm no marketplace, messaging, AI, or VM side effects are enabled.

## Next Step

The next logical step is an approved Staging write execution harness that consumes these payloads and writes only to the allowed eBay Pro Staging tables. That step must remain disabled until explicit approval is given.
