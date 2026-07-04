# Production eBay Pro Cleanup Execution Record V1

## Why

Production was already protected operationally as IMNOVA Core only, with eBay Pro blocked in production and allowed only in staging/lab. A manual production cleanup was later executed to remove demo/heavy eBay Pro and Market Radar data from Production while preserving schema compatibility.

This record captures sanitized evidence only. It does not query a live database, execute SQL, move backup files, or store secrets.

## What was cleaned

The manual cleanup targeted eBay Pro and Market Radar data tables in Production. Metadata inventory after cleanup reports `estimated_rows = 0` for all target tables.

The main heavy table was `market_radar_snapshots`.

## What was not cleaned

The cleanup did not touch:

- Staging
- IMNOVA Core tables
- Products
- Subscribers
- Community tables
- Notification logs
- WhatsApp Core data
- Store/public product data
- VM/Lab data

## Backup confirmation

A manual backup was confirmed before cleanup:

- Backup file name: `imnova-production-ebay-pro-before-cleanup.dump`
- Backup size: 60 MB
- Storage: local outside the repo
- Committed to repo: no

No connection strings, passwords, tokens, or secrets are recorded here.

## Dry run confirmation

A dry run using rollback was executed manually before the cleanup. This loop does not execute that dry run again.

## Production cleanup execution

The production cleanup was executed manually before this record loop. This loop only records the result.

## Post-cleanup metadata inventory

Post-cleanup verification type: `metadata_inventory_estimated_rows`.

The metadata inventory reports all target tables at `estimated_rows = 0`. This is metadata inventory evidence, not an exact `COUNT(*)` verification.

## Before vs after

Main heavy table before cleanup:

- `market_radar_snapshots`
- Estimated rows: 139,283
- Total size: 283 MB

Main heavy table after cleanup:

- `market_radar_snapshots`
- Estimated rows: 0
- Total size: 56 kB

## Staging status

Staging was not touched. Staging remains the controlled environment for eBay Pro and the Luna Portex first real scan baseline.

## Schema status

Schema was preserved:

- Tables preserved
- Views preserved
- No table removal
- No view removal

## Safety status

- Backup confirmed by the user.
- Dump file remains outside the repo.
- No secret is recorded in the repo.
- No live DB query happens in this loop.
- No SQL execution happens in this loop.
- No Supabase write happens in this loop.
- No VM connection happens in this loop.

## What this loop records

- Backup confirmation.
- Manual production cleanup execution status.
- Sanitized before/after metadata.
- Staging untouched status.
- Schema preserved status.
- Exact count verification not documented.

## What this loop does not do

- It does not query Production.
- It does not query Staging.
- It does not execute SQL.
- It does not move or copy backup files.
- It does not commit dump files.
- It does not expose connection strings or secrets.
- It does not connect the VM/Lab.
- It does not call eBay, OpenAI, WhatsApp, scrapers, downloads, or image tools.

## Next steps

Options for a later loop:

1. Run exact count verification if explicit approval is given.
2. Continue staging/lab first scan preparation for Luna Portex.
3. Prepare VM/Lab heavy-processing setup with a separate test database.
