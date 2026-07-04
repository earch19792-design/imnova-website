# First Real Luna Portex Scan Plan V1

## Current state

Production is Core-only and clean. The Production eBay Pro / Market Radar cleanup was final verified, and the target Production tables are documented with exact rows of 0. eBay Pro remains blocked in Production and available only for Staging/Lab planning.

Staging is reserved for eBay Pro as the controlled first-scan environment. VM/Lab has a connection contract and dry-run harness, but it remains not connected.

## Production status: Core-only, cleaned, off-limits

Production must remain off-limits for the first real Luna Portex scan. It must not run scan jobs, receive raw scan output, receive heavy Market Radar data, create real listing drafts, publish listings, or connect to VM/Lab.

## Staging role: eBay Pro controlled first scan

Staging is the control plane for the first real Luna Portex scan. It can hold scan planning state, review state, candidate summary state, dry-run seller alert previews, and operator approval state.

This loop does not write to Staging. It only defines the dry-run gate that must pass before any future write path is enabled.

## VM/Lab role: future heavy processing, not connected yet

VM/Lab is reserved for future heavy scan processing, benchmark experiments, worker runs, large fixtures, and raw scan simulations. It is not connected in this loop.

## First scan definition

The first real Luna Portex scan is `FIRST_REAL_LUNA_PORTEX_SCAN`. It must use the Luna Portex catalog, start from a fresh baseline, exclude demo and pre-baseline data, and require operator approval before execution.

## Pre-baseline demo data exclusion

Existing demo, test, and pre-baseline records are classified as `PRE_BASELINE_DEMO`. They must not be mixed into the first real scan result, candidate evaluation, or baseline summary.

## Staging dry-run gate

The staging dry-run gate is required before any future scan write path. The gate confirms that write paths are disabled, external calls are disabled, demo data is excluded, dry-run mode is active, Production is off-limits, and operator approval is pending.

## Scan limits

- No Production writes.
- No Staging writes in this loop.
- No marketplace API calls.
- No authorization flows.
- No real listing drafts.
- No publication actions.
- No scraper execution.
- No image generation or uploads.
- No VM/Lab connection.

## Required approval checklist

- Confirm Production remains Core-only and off-limits.
- Confirm Production eBay Pro target tables remain exactRows zero.
- Confirm Staging is the eBay Pro controlled environment.
- Confirm staging dry-run gate passes before any write path.
- Confirm demo and pre-baseline records are excluded.
- Confirm scan mode is `FIRST_REAL_LUNA_PORTEX_SCAN`.
- Confirm WhatsApp seller alerts remain dry-run.
- Confirm VM/Lab remains not connected in this loop.
- Require operator approval before the first real scan.

## WhatsApp dry-run rule

Seller alerts remain dry-run by default. This loop performs no real messaging and does not change message templates.

## What this loop does

This loop documents the first real Luna Portex scan plan, creates a static fixture, adds a pure planning module, and adds static tests for the staging dry-run gate.

## What this loop does not do

This loop does not execute a scan, write to Staging, touch Production, connect VM/Lab, call external services, create SQL, run migrations, create drafts, publish listings, upload files, scrape data, or modify environment files.

## Next implementation steps

1. Review and approve the first real scan checklist.
2. Add a future staging-only dry-run command that validates inputs without writes.
3. Add operator approval capture before enabling any scan write path.
4. Keep VM/Lab disconnected until the lab connection plan is separately approved.
5. Execute the first real Luna Portex scan only after dry-run and approval gates pass.
