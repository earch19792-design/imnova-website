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

Any Production target is blocked. Execute mode requires `EBAY_PRO_TARGET_ENV=staging` and rejects URLs that look like Production or do not carry a Staging signal.

## Staging-Only Write Boundary

The only permitted write target is Supabase Staging, and only for LOOP 141 when all gates pass:

- `EBAY_PRO_TARGET_ENV=staging`
- `EBAY_PRO_STAGING_WRITE_APPROVED=APPROVE_LOOP_141_STAGING_WRITE_3_CANDIDATES`
- `--execute-approved-staging-write`
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

Dry-run mode is the default and never connects to DB. Execute mode reads existing Staging env vars only after the explicit CLI flag is present. If Staging env vars are missing, the executor does not write and reports the missing env names without printing values.

## Preflight Schema Check

LOOP 141 requires the LOOP 140 compatibility contract and a real read-only Staging preflight before write execution. Missing required payload columns block the write. Optional columns such as source metadata, `listableInEbay`, and `publishable` can be skipped with warnings if the real table does not expose them.

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
