# Luna Portex Staging Write Gate V1

## Why

The Luna Portex scan dry-run now produces local eBay Pro candidate previews. This loop adds the next gate: a local write plan for Staging that can be reviewed before any database write is enabled.

## Current State

- Production is Core-only, clean, and off-limits.
- Staging is reserved for eBay Pro.
- The VM/Lab remains documented but disconnected.
- The first Luna Portex scan flow is still local dry-run only.
- Seller messaging remains dry-run only.

## What The Gate Does

- Reads candidate previews from the existing local dry-run result.
- Blocks `PRE_BASELINE_DEMO` records.
- Blocks candidates without a title.
- Blocks candidates without estimated cost.
- Blocks candidates that are not `FIRST_REAL_LUNA_PORTEX_SCAN`.
- Blocks any Production target.
- Blocks Core, subscriber, notification, and community target tables.
- Produces a local write plan for Staging review.

## What The Gate Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect to the VM/Lab.
- It does not call marketplace, messaging, AI, scraper, or remote services.
- It does not create SQL or migrations.
- It does not read secrets or environment files.

## Allowed Staging Plan Tables

- `ebay_product_candidates`
- `ebay_candidate_scores`
- `ebay_candidate_validations`
- `ebay_profit_scenarios`

## Forbidden Targets

- `products`
- `subscribers`
- `notification_logs`
- community tables
- Production tables

## Out Of Stock Rule

Out-of-stock Luna Portex candidates may enter the write plan as review candidates, but they are not sell-ready.

## Approval Checklist

- Confirm Production remains off-limits.
- Confirm Staging write approval is explicit.
- Confirm candidate previews are `FIRST_REAL_LUNA_PORTEX_SCAN`.
- Confirm `PRE_BASELINE_DEMO` records are blocked.
- Confirm forbidden Core tables are not targeted.
- Confirm out-of-stock candidates require review.
- Confirm no persistence occurs in this loop.

## Next Step

After approval, a future loop can add a separate Staging-only persistence adapter behind this gate. That future adapter must remain disabled until explicit approval is given.
