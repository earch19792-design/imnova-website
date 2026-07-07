# Luna Portex Approved Staging Write 3 Candidates V1

## Why

LOOP 141 creates the first controlled Staging write path for eBay Pro candidate data. The goal is to move from local-only execution planning to an approved Staging-only write, while preserving Production isolation and every approval boundary established in PRE-139 through LOOP 140.

## Current State

- Production remains frozen and Core-only.
- eBay Pro work continues only in PRE/Staging.
- LOOP 139 prepared the execution harness without DB writes.
- LOOP 140 validated payload/schema compatibility with a local snapshot and a read-only SQL inspection file.
- LOOP 141 allows a controlled Supabase Staging write only when explicit runtime flags and Staging env vars are present.

## What This Executor Does

- Builds the Luna Portex scan, gate, adapter, harness, and schema compatibility flow.
- Creates an approved write plan for exactly 3 candidate dedupe keys and 12 payload operations.
- Keeps dry-run mode as the default.
- Requires explicit execute-mode flags before any real Staging write.
- Uses idempotency/dedupe keys before writing.
- Prepares post-write verification for row counts, duplicates, conflicts, and source run identity.

## What This Executor Does Not Do

- It does not touch Production.
- It does not write by default.
- It does not create eBay drafts.
- It does not publish listings.
- It does not call eBay API, OAuth, OpenAI, or WhatsApp.
- It does not create or modify `.env*` files.
- It does not run migrations or push/pull DB schema.

## Production Off-Limits

Any Production target is blocked. Execute mode requires `EBAY_PRO_TARGET_ENV=staging`, rejects URLs that look like Production, and confirms the Staging project through the non-secret `EBAY_PRO_STAGING_PROJECT_REF` value. The executor must verify that `SUPABASE_STAGING_URL` contains that project ref before any connection.

## Staging-Only Write Boundary

The only permitted write target is Supabase Staging, and only for LOOP 141 when all gates pass:

- `EBAY_PRO_TARGET_ENV=staging`
- `EBAY_PRO_STAGING_WRITE_APPROVED=APPROVE_LOOP_141_STAGING_WRITE_3_CANDIDATES`
- `EBAY_PRO_STAGING_PROJECT_REF` set to the expected non-secret Staging project ref
- `--execute-approved-staging-write`
- `SUPABASE_STAGING_URL` contains the expected Staging project ref
- `SUPABASE_STAGING_URL` is not marked as Production
- compatible real Staging schema
- no idempotency conflicts
- maximum 3 candidate dedupe keys
- maximum 12 operations

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
- production tables
- any table outside the four allowed eBay Pro Staging tables

## Approval Gate

Dry-run mode is the default and never connects to DB. Execute mode reads existing Staging env vars only after the explicit CLI flag is present. If Staging env vars are missing, the executor does not write and reports the missing env names without printing values. URL confirmation is sanitized: the executor reports only whether the project ref check passed or failed, never the full Supabase URL or service role key.

## Preflight Schema Check

LOOP 141 requires the LOOP 140 compatibility contract and a real read-only Staging preflight before write execution. Missing required payload columns block the write. Optional columns such as source metadata, `listableInEbay`, and `publishable` can be skipped with warnings if the real table does not expose them.

## Real Staging Schema Mapping

LOOP 141 writes to the existing Staging schema only. It does not add columns, create migrations, or require schema changes.

For `ebay_product_candidates`:

- `candidate_key` is the product candidate dedupe key.
- `candidate_key` is set from the Luna Portex `dedupeKey`.
- `supplier_variant_id` and `title` are required before insert/update.
- `source_payload` stores the original adapter payload plus internal execution metadata.
- `normalized_payload` stores normalized candidate fields plus internal execution metadata.
- `state` uses the real-schema-safe value `DETECTED` for LOOP 141.
- `needs_data` defaults to an empty array for the controlled LOOP 141 write.
- `idempotency_key` is not required for `ebay_product_candidates`.
- `candidate_id` is not written to `ebay_product_candidates`.
- The base candidate row is locally validated before insert/update.
- Missing `candidate_key`, `supplier_variant_id`, `title`, `source_payload`, `normalized_payload`, `state`, or `needs_data` blocks the row before Supabase insert/update.
- The base candidate row writes only existing product candidate columns.

State constraint handling:

- `DETECTED` is the safe base state for product candidate writes in LOOP 141.
- `REVIEW_PENDING` must not be written to `ebay_product_candidates.state` unless the real constraint explicitly allows it.
- Review status is preserved in `blocked_reason`, JSONB metadata, and child validation rows.
- If state constraint details need manual inspection, use read-only SQL only:

```sql
select
  conname,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid = 'public.ebay_product_candidates'::regclass
  and conname = 'ebay_product_candidates_state_check';
```

For child tables:

- `ebay_candidate_scores`, `ebay_candidate_validations`, and `ebay_profit_scenarios` use `idempotency_key`.
- `candidate_id` is resolved after the product candidate row is selected, inserted, or updated.
- Child rows are not written until exactly one product candidate `id` is available for each `candidate_key`.
- If the product candidate base write fails, child writes are skipped with `candidate base write failed; child writes skipped`.
- Duplicate `candidate_key` or duplicate child `idempotency_key` rows abort the write as conflicts.

Internal metadata:

- `sourceDataClass`, `sourceRunId`, `executionRunId`, `listableInEbay`, `publishable`, and internal dry-run flags are not written as direct columns unless the schema provides dedicated columns.
- Those values are stored inside JSONB payload fields such as `source_payload`, `normalized_payload`, `score_payload`, and `assumptions`.

Safe Supabase error reporting:

- Supabase errors are sanitized before reporting.
- Reports include only `table`, `operation`, `code`, `message`, `details`, `hint`, and `attemptedColumns`.
- Reports must not include the Supabase URL, service role key, headers, or full payload body.

## Post-Write Verification

After any real Staging write, the executor verifies:

- rows by allowed table for the expected dedupe keys
- no duplicate dedupe keys per table
- no idempotency conflicts
- expected `sourceRunId` or `executionRunId` when supported
- `stagingWriteExecuted: true` only after a real Staging upsert succeeds

## Definition Of Done Applied

LOOP 141 has its own fixture, pure plan module, gated CLI, tests, dry-run, prior-loop regressions, TypeScript check, diff checks, and safety greps. The only permitted real write is the explicitly approved Supabase Staging write for the three Luna Portex candidates.

## Human Explanation Rule Applied

The final loop report must explain what was done, why it was done, what problem it solves, what it protected, what changed, what was not touched, how it moves eBay selling forward, and the exact next route step.

## Next Step

142 — First Real Luna Portex Mini Scan + Automatic Scan Foundation
