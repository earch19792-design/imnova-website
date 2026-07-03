# Read-Only Production/Staging DB Inventory V1

## Why

Production is now protected operationally as IMNOVA Core only, while eBay Pro is staging/lab-only. Before any physical database cleanup, we need a read-only metadata inventory of Production and Staging to confirm which tables exist and how they should be classified.

This loop does not remove data, does not apply migrations and does not inspect business rows.

## What Is Already Independent

- Production blocks eBay Pro routes.
- eBay Pro has a staging/lab module identity.
- WhatsApp Core remains available in production.
- eBay Pro WhatsApp alerts are staging/lab-only and dry-run by default.
- The previous cleanup plan created static categories and a safety checklist.

## What This Inventory Checks

The inventory checks only metadata:

- Public table names.
- Table type.
- Estimated row count from PostgreSQL metadata.
- Approximate relation size from PostgreSQL metadata.

It does not inspect customer data, subscriber data, product rows, community rows, WhatsApp logs or eBay candidate rows.

## Read-Only Metadata-Only Method

Use `tools/sql/read-only-db-inventory-v1.sql`.

The SQL is scoped to:

- `pg_stat_user_tables`.
- `information_schema.tables`.
- `BEGIN READ ONLY`.

The SQL does not use broad row selection, business table scans, data mutation, schema changes or direct reads from business tables.

## Production Expected State

Production should be IMNOVA Core only:

- Products.
- Product states.
- Store/public product surfaces.
- Community and subscribers.
- Campaigns and general analytics.
- Core WhatsApp/notification infrastructure.

Production should not require eBay Pro heavy tables after operational isolation is complete.

## Staging Expected State

Staging is the controlled environment for eBay Pro:

- Market Radar eBay.
- eBay Seller OS.
- eBay Listing.
- Candidate and price intelligence dry-runs.
- Limited snapshots and summaries.
- Listing package dry-runs.

Staging can contain eBay Pro tables, but should still avoid unbounded heavy datasets.

## VM/Lab Expected State

The Local VM/Lab is the future home for heavy datasets:

- Large benchmark raw data.
- Heavy scanner outputs.
- Worker logs.
- Historical raw snapshots.
- Experimental image outputs.

The VM/Lab is not connected in this loop.

## How To Run Manually In Supabase SQL Editor

1. Open the intended Supabase project manually.
2. Confirm whether the target is Production or Staging before running anything.
3. Paste only `tools/sql/read-only-db-inventory-v1.sql`.
4. Confirm the script starts with `BEGIN READ ONLY`.
5. Run once.
6. Export only sanitized metadata: table name, environment, classification category and size bucket.
7. Do not export business rows, customer records, subscriber records or raw dumps.

## How To Run Only With A Read-Only Connection

Only run automated inventory if all of this is true:

- The connection is explicitly read-only.
- The environment is clearly identified as Production or Staging.
- No connection string or secret will be printed.
- The output will be sanitized before storage.
- The command will run only the metadata SQL file.

If any condition is unclear, do not execute a live inventory.

## What Not To Do

- Do not inspect business rows.
- Do not run data mutations.
- Do not run schema changes.
- Do not run database push or pull.
- Do not export raw database output.
- Do not commit connection strings, credentials, dumps or PII.
- Do not clean tables from Production based only on static assumptions.

## Sanitized Result Format

If live metadata inventory is executed later, commit only a sanitized summary:

```json
{
  "environment": "production",
  "tableName": "example_table",
  "category": "UNKNOWN_MANUAL_REVIEW",
  "sizeBucket": "unknown"
}
```

Allowed size buckets:

- `empty`.
- `small`.
- `medium`.
- `large`.
- `unknown`.

Do not commit exact business data or raw database output.

## Cleanup Decision Rules

No table can be removed or archived until:

- Production metadata inventory is complete.
- Staging metadata inventory is complete.
- Table category is reviewed.
- Unknown tables are manually classified.
- Backup/export exists.
- Rollback plan exists.
- User explicitly approves the cleanup.

## Next Phase

After this runbook, the next phase is a controlled read-only inventory execution. If no safe read-only connection is available, the SQL should be run manually in Supabase SQL Editor and only sanitized results should be brought back for review.
