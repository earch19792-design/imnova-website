# Luna Portex Staging Schema Compatibility V1

## Why

LOOP 140 validates that Luna Portex Staging write payloads match the expected eBay Pro Staging table shape before any real write can be considered. This adds a schema compatibility layer between the execution harness and future approved Staging writes.

## Current State

- Production remains frozen and Core-only.
- eBay Pro work continues in PRE/Staging.
- LOOP 136 produces local Luna Portex scan previews.
- LOOP 137 builds the Staging write gate plan.
- LOOP 138 builds dry-run payloads.
- LOOP 139 simulates execution and keeps writes blocked.
- LOOP 140 checks schema compatibility using a local snapshot fixture and prepared read-only SQL.

## What This Compatibility Layer Does

- Builds the expected schema contract for the four allowed eBay Pro Staging tables.
- Normalizes a local schema snapshot.
- Validates payload rows against required columns.
- Blocks forbidden table targets.
- Blocks payloads missing `dryRun`, `stagingOnly`, `approvalRequired`, or `dedupeKey`.
- Reports missing required columns.
- Reports warnings for extra snapshot columns and column types that are not verifiable in the local dry-run.
- Confirms that real schema inspection is still not executed in this loop.

## What This Compatibility Layer Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect to Staging DB.
- It does not connect to the VM/Lab.
- It does not call Supabase, eBay, OpenAI, WhatsApp, scraper, upload, or remote services.
- It does not create SQL migrations.
- It does not read secrets or environment files.
- It does not create drafts or publish listings.

## Production Off-Limits

Production remains out of scope. Any Production target or table token is blocked before compatibility can pass.

## Staging-Only Schema Boundary

The SQL file for this loop is inspection-only and prepared for a future human-approved read. LOOP 140 does not execute it. Compatibility is evaluated against the local schema snapshot fixture only.

Required state:

- `stagingWriteExecuted: false`
- `readOnlyInspectionRequiredBeforeRealWrite: true`
- `realSchemaInspectionExecutedInThisLoop: false`
- `approvalRequiredBeforeWrite: true`

## Allowed Tables

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

## Read-Only SQL

The prepared SQL reads only from `information_schema.columns` and filters to the four allowed eBay Pro Staging tables. It does not contain write, DDL, transaction, or migration statements.

## Dry-Run Report

The dry-run report includes eligible candidates, blocked candidates, payload tables checked, payloads checked, schema tables checked, compatibility status, incompatible tables, missing required columns, warnings, read-only SQL prepared status, real inspection status, Staging write status, and approval requirement.

## Definition Of Done Applied

This loop applies the eBay Pro Definition of Done V1: narrow objective, tests, dry-run simulation, blocked and incomplete cases, regressions, TypeScript validation, diff checks, no Production touch, no Staging write, no external integrations, no Supabase write/SQL execution, no `.env*`, no secrets/dumps/images, numeric outputs, warnings, clean git status, human explanation, and exact next loop.

## Human Explanation Rule Applied

The final report must explain what was done, why it was done, what problem it solves, what it protected, what changed, what was not touched, how it moves eBay selling forward, and the next exact loop.

## Next Step

141 — Approved Staging Write de 3 candidatos
