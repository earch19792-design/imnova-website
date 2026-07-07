# Luna Portex Staging Write Execution Harness V1

## Why

LOOP 139 adds the execution harness that sits after the Luna Portex Staging write adapter. The harness prepares a controlled Staging-only execution plan, validates every payload boundary, and keeps all real writes blocked until a future approved loop.

## Current State

- Production is frozen, Core-only, and off-limits.
- eBay Pro work is reserved for PRE/Staging.
- LOOP 136 generates local Luna Portex scan dry-runs.
- LOOP 137 builds a Staging write gate plan.
- LOOP 138 converts approved write plan entries into dry-run payloads.
- LOOP 139 does not connect a real writer.

## What This Harness Does

- Accepts payload bundles from the LOOP 138 adapter.
- Validates that payloads target only eBay Pro Staging tables.
- Requires `dryRun: true`, `stagingOnly: true`, and `approvalRequired: true`.
- Requires a dedupe key for every payload.
- Blocks Production and forbidden table targets.
- Blocks execution plans above the candidate limit.
- Builds an in-memory execution plan.
- Simulates execution without persistence.
- Produces a summary report for review.
- Keeps future real execution behind explicit approval.

## What This Harness Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect to the VM/Lab.
- It does not call Supabase, eBay, OpenAI, WhatsApp, scraper, upload, or remote services.
- It does not create SQL or migrations.
- It does not read secrets or environment files.
- It does not create drafts or publish listings.

## Production Off-Limits

Production remains frozen and Core-only. Any Production target, Production table token, or Production write intent is blocked.

## Staging-Only Execution Boundary

The harness is a Staging-only planning layer. In this loop, Staging write execution remains disabled even if a test passes `approvalGranted: true`.

Required execution state:

- `approvalRequired: true`
- `simulatedExecutionOnly: true`
- `stagingWriteExecuted: false`
- `executionReadyForFutureApproval: true` only when every payload is valid

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

## Approval Gate

Future real execution must require explicit human approval and a loop that authorizes Staging writes. LOOP 139 only proves the execution plan can be validated and simulated.

## Simulated Execution Report

The dry-run report must include:

- eligible candidates
- blocked candidates
- payloads validated
- execution operations planned
- tables planned
- dedupe keys
- approval required
- simulated execution only
- Staging write executed status
- future approval readiness

## Definition Of Done Applied

This loop applies the eBay Pro Definition of Done V1: narrow objective, local tests, dry-run simulation, blocked cases, regressions, TypeScript validation, diff checks, no Production touch, no Staging write, no marketplace credential flow, no real WhatsApp, no Supabase write/SQL, no `.env*`, no secrets/dumps/images, numeric outputs, warnings, clean git status, human explanation, and exact next loop.

## Human Explanation Rule Applied

The final loop report must explain what was done, why it was done, what problem it solves, what it protected, what changed, what was not touched, how it moves eBay selling forward, and the next exact loop.

## Next Step

140 — Staging schema compatibility
