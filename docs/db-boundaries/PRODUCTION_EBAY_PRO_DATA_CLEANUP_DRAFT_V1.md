# Production eBay Pro Data Cleanup Draft V1

## Why

Production is already protected operationally as IMNOVA Core only, and eBay Pro is blocked there. The production metadata inventory still shows eBay Pro and Market Radar data, mostly from demo/test work. This draft prepares a controlled production-only data cleanup plan without executing it.

## Current production inventory

The production inventory found eBay Pro and Market Radar tables still present with data. Staging must keep eBay Pro. Production should retain table compatibility for now while removing demo/heavy rows only after backup and explicit approval.

## Main heavy table

`market_radar_snapshots` is the main production weight:

- Estimated rows: 139,283
- Total size: 283 MB

## Cleanup target tables

The draft targets only eBay Pro and Market Radar data tables:

- `public.ebay_active_listing_risk_events`
- `public.ebay_active_listings`
- `public.ebay_candidate_decisions`
- `public.ebay_candidate_scores`
- `public.ebay_candidate_validations`
- `public.ebay_compliance_checks`
- `public.ebay_listing_drafts`
- `public.ebay_pipeline_audit_log`
- `public.ebay_price_intelligence_snapshots`
- `public.ebay_product_candidates`
- `public.ebay_profit_scenarios`
- `public.market_radar_events`
- `public.market_radar_products`
- `public.market_radar_scores`
- `public.market_radar_snapshots`
- `public.market_radar_sources`

## Tables explicitly not touched

The draft does not target IMNOVA Core, community, WhatsApp Core, store, or shared public product tables. This includes:

- `products`
- `product_states`
- `product_images`
- `subscribers`
- `subscriber_interests`
- `subscriber_area_interests`
- `communication_preferences`
- `notification_logs`
- `community_*`
- `survey_responses`
- `social_signals`
- `trend_radar_signals`
- `idea_lab_items`
- `strategic_niches`
- `strategic_subniches`
- `distribution_locations`
- `public_products`
- `public_distribution_locations`

## Why tables are truncated instead of removed

The draft keeps table definitions in place for runtime compatibility and rollback planning. It only prepares row cleanup for eBay Pro/Market Radar data tables.

## Why views are not removed

`market_radar_latest_products` and `market_radar_latest_snapshots` are views and are not included in the draft. Keeping views avoids schema-level changes while production remains operationally protected.

## Backup requirement

Backup/export is required before any execution. The backup must cover every target table and be stored outside the production cleanup session.

## User approval requirement

Explicit user approval is required before executing the draft. The presence of this file is not approval to run it.

## Rollback-by-default rule

The SQL draft ends with `ROLLBACK` by default. Any future execution must be reviewed line by line, backed up, and explicitly approved before changing the default behavior.

## Staging must not be cleaned

Staging must not be cleaned by this draft. Staging remains the controlled home for eBay Pro and the Luna Portex first real scan baseline.

## VM/Lab future responsibility

The Local VM/Lab remains the future home for heavy processing, larger fixtures, scan simulations, and worker experiments. It is not connected in this loop.

## Execution checklist

1. Confirm production isolation gate is merged.
2. Confirm the target database is Production, not Staging.
3. Export/backup all target tables.
4. Verify backup restore path.
5. Confirm no IMNOVA Core table is targeted.
6. Confirm no view is targeted.
7. Confirm Staging is untouched.
8. Get explicit user approval.
9. Run only during an approved maintenance window.
10. Verify target tables are empty and Core tables still have expected data.

## Post-cleanup verification

After any future approved execution, verify:

- eBay Pro target tables are empty.
- IMNOVA Core tables still contain expected data.
- WhatsApp Core records and notification history remain untouched.
- Staging still contains eBay Pro data.
- Production admin/core routes still work.

## What this loop does

- Adds a production-only cleanup SQL draft.
- Keeps the SQL rollback-first.
- Documents backup, approval, and staging safety gates.
- Adds a fixture and tests for cleanup safety.

## What this loop does not do

- It does not execute SQL.
- It does not query a live database.
- It does not clean Production.
- It does not clean Staging.
- It does not remove tables or views.
- It does not create a migration.
- It does not touch Supabase remotely.
- It does not connect the VM/Lab.
- It does not call eBay, OpenAI, WhatsApp, scrapers, downloads, or image tools.
