# Luna Portex First Real Mini Scan Automatic Foundation V1

## Why

LOOP 142 prepares the first real Luna Portex mini scan and the foundation for future automatic catalog scans. It follows the LOOP 141 Staging write path, but writes only product candidate base rows and does not create scores, validations, profit scenarios, eBay drafts, listings, WhatsApp alerts, or schedulers.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 141 completed the approved Staging write for 3 candidates.
- LOOP 142 can read a local mini catalog JSON, normalize up to 10 products, prepare `ebay_product_candidates` rows, and optionally execute a gated Staging write.

## Input Boundary

Real Luna Portex input must come from a local JSON file referenced by `LUNA_PORTEX_MINI_SCAN_INPUT` or `--input-file`. Real input files must not be committed. The repository includes only a sanitized fixture for tests and dry-runs.

## What This Scan Does

- Reads sanitized fixture data by default.
- Reads a local real input JSON when explicitly provided.
- Normalizes product identity, title, cost, stock, images, and source metadata.
- Classifies valid, incomplete, out-of-stock, needs-data, and warning candidates.
- Builds Staging candidate rows for `ebay_product_candidates`.
- Prepares automatic scan foundation metadata: `scanRunId`, snapshot model, diff model, change events, and future cadence.

## What This Scan Does Not Do

- It does not touch Production.
- It does not write by default.
- It does not write child score, validation, or profit scenario tables.
- It does not create eBay drafts or publish listings.
- It does not call eBay API, OAuth, WhatsApp, OpenAI, scrapers, uploads, or schedulers.
- It does not modify `.env*`.

## Staging Write Boundary

Execute mode is allowed only when all gates pass:

- `EBAY_PRO_TARGET_ENV=staging`
- `LUNA_PORTEX_MINI_SCAN_APPROVED=APPROVE_LOOP_142_FIRST_REAL_MINI_SCAN`
- `LUNA_PORTEX_MINI_SCAN_INPUT` points to an existing local JSON file
- `--execute-approved-staging-mini-scan`
- `SUPABASE_STAGING_URL` is set
- `SUPABASE_STAGING_SERVICE_ROLE_KEY` is set
- `EBAY_PRO_STAGING_PROJECT_REF` is set
- Supabase URL contains the expected project ref
- real Staging schema is compatible
- maximum 10 products
- only `ebay_product_candidates` is written
- candidate keys use the `luna-portex:first_real_mini_scan:` prefix

## Candidate Mapping

- `candidate_key`: `luna-portex:first_real_mini_scan:<supplierVariantId or supplierSku>`
- `supplier_variant_id`: required for write eligibility
- `title`: required for write eligibility
- `state`: `DETECTED`
- `blocked_reason`: `null`, `needs_data`, or `out_of_stock`
- `needs_data`: missing title, supplier variant, cost, stock, or image
- `source_payload`: sanitized source item and execution metadata
- `normalized_payload`: normalized fields, stock, cost, image count, source data class, scan run, and automatic scan markers

## Automatic Scan Foundation

LOOP 142 prepares:

- catalog snapshot model
- stock/cost diff model
- change event names
- future cadence contract

It does not create a scheduler. Future cadence is documented only:

- catalog snapshot: daily
- stock and cost watch: every 4 to 6 hours
- active listing stock guard: every 1 to 2 hours after LOOP 152

## Safety

Production stays off-limits. Staging write is gated and limited to `ebay_product_candidates`. Secrets are never printed. Real input files and image assets must not be committed.

## Next Step

143 — Benchmark Data Model + Direct Sourcing Signals + Pricing Psychology Inputs + Sold Price Intelligence
