# eBay Pro Luna Portex First Scan Baseline V1

## Why

eBay Professional Seller Suite is not a production eBay operation yet. Current eBay Pro records are test/demo material and should not define the first real operating baseline for Luna Portex.

The next controlled Luna Portex scan should be treated as the first real scan for eBay Pro. This keeps IMNOVA Production protected as Core only, keeps eBay Pro in staging/lab, and avoids mixing demo data with the new baseline.

## Current state

- IMNOVA Production is operationally protected as Core only.
- eBay Pro is staging/lab-only.
- The Local VM/Lab remains documented for heavy testing and is not connected.
- Existing eBay Pro product/candidate/snapshot material can be treated as pre-baseline demo data.
- Physical database cleanup has not been applied.

## Desired state

- The first real Luna Portex scan creates a fresh eBay Pro baseline.
- Demo/test data remains safely ignored for first-scan decisions.
- Staging is the controlled environment for the first real scan.
- Lab/VM can be used later for heavy simulations with a separate test DB.
- Production remains untouched by eBay Pro scans.

## What counts as demo/pre-baseline data

Pre-baseline demo data includes records marked as `PRE_BASELINE_DEMO`, demo-mode records, test-data records, or any prior eBay Pro record created before the approved first real Luna Portex scan.

These records may remain in storage until a future approved cleanup, but they should not be used as first-scan truth.

## What counts as first real Luna Portex scan

The first real scan is the next approved staging/lab scan classified as `FIRST_REAL_LUNA_PORTEX_SCAN`.

It should establish fresh candidate, snapshot, and Seller OS baseline context for Luna Portex without inheriting demo conclusions.

## Production rule

Production is IMNOVA Core only. eBay Pro first-scan behavior is blocked in production.

## Staging rule

Staging is the official controlled environment for the first real Luna Portex scan. It may create the baseline later only through approved read/write implementation work, not in this loop.

## VM/Lab rule

The Local VM/Lab is reserved for future heavy scan simulations, fixtures, load testing, and worker processing with a separate test DB. It is not connected in this loop.

## WhatsApp rule

IMNOVA Core WhatsApp remains available for production Core use. eBay Pro WhatsApp seller alerts remain staging/lab-only and dry-run by default. There is no real WhatsApp delivery in this loop.

## Cleanup rule

No physical cleanup happens in this loop. Any later cleanup requires inventory, backup/export, rollback plan, manual review of unknown tables, and explicit approval.

## What this loop does

- Declares the Luna Portex first-scan baseline policy.
- Classifies current demo/test eBay Pro data as pre-baseline.
- Declares that the next Luna Portex scan should be `FIRST_REAL_LUNA_PORTEX_SCAN`.
- Adds a pure module and static tests for the baseline contract.

## What this loop does not do

- It does not touch production.
- It does not query Supabase live.
- It does not write to Supabase.
- It does not create migrations.
- It does not physically clean staging.
- It does not connect the VM/Lab.
- It does not call eBay.
- It does not create drafts or publish listings.
- It does not call OpenAI or generate images.
- It does not change WhatsApp templates or deliver WhatsApp alerts.

## Future physical cleanup plan

The safe cleanup path remains:

1. Run the read-only metadata inventory.
2. Classify tables and unknowns manually.
3. Export/backup candidate demo data.
4. Confirm no production runtime dependency.
5. Prepare rollback.
6. Request explicit approval.
7. Apply cleanup only in an approved maintenance window.
