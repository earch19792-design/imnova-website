# Production DB eBay Table Audit + Cleanup Plan V1

## Why

IMNOVA Production is now protected operationally as IMNOVA Core, while eBay Professional Seller Suite is staging/lab-only. That runtime boundary does not prove the production database is physically clean. This audit maps local migrations and code references so a future cleanup can be planned without guessing.

This loop does not remove tables, does not apply SQL, does not query a live database and does not change production or staging.

## Current State

Static inspection found local migrations and code references for IMNOVA Core tables, community tables, product tables, Market Radar tables, eBay pipeline tables, price intelligence snapshots and active listing risk events.

The current repository still contains both Core and eBay Pro database history. That is expected for this phase.

## What Is Already Independent

- Production runtime blocks eBay Pro routes.
- eBay Pro has its own staging/lab module identity.
- `/admin/ebay-pro` is a lightweight hub.
- WhatsApp remains a shared controlled communication channel, with eBay Pro alerts declared staging/lab-only and dry-run by default.

## What Is Not Physically Separated Yet

- Production and staging database objects have not been physically separated.
- eBay Pro tables have not been archived or moved out of production.
- Local VM/Lab database has not been connected.
- No cleanup has been applied.

## Static Table Inventory Method

This audit used only local repository files:

- `supabase/migrations`.
- `app`.
- `components`.
- `lib`.
- `tools`.

The scan looked for table creation, view creation, table alterations and local code reads through Supabase table references. No live database was queried.

## Production Core Tables

Production Core should keep tables used for the real IMNOVA business:

- `products`.
- `product_states`.
- `public_products`.
- `product_images`.
- `distribution_locations`.
- `public_distribution_locations`.
- `strategic_niches`.
- `strategic_subniches`.
- `product_subniches`.
- `subscribers`.
- `communication_preferences`.
- `community_interest_areas`.
- `subscriber_area_interests`.
- `subscriber_interests`.
- `community_levels`.
- `community_referral_codes`.
- `community_referrals`.
- `community_points_ledger`.
- `community_member_status`.
- `community_vip_rewards`.
- `community_reward_redemptions`.
- `community_idea_votes`.
- `idea_lab_items`.
- `transparency_wall_items`.
- `notification_logs`, when used for IMNOVA Core WhatsApp and Core communications.

## eBay Pro Staging Tables

These objects appear to belong to eBay Pro and should be staging/lab-only unless a later review proves production needs a small summary:

- `market_radar_sources`.
- `market_radar_products`.
- `market_radar_snapshots`.
- `market_radar_events`.
- `market_radar_scores`.
- `market_radar_latest_snapshots`.
- `market_radar_latest_products`.
- `ebay_product_candidates`.
- `ebay_candidate_validations`.
- `ebay_profit_scenarios`.
- `ebay_compliance_checks`.
- `ebay_candidate_scores`.
- `ebay_candidate_decisions`.
- `ebay_listing_drafts`.
- `ebay_pipeline_audit_log`.
- `ebay_price_intelligence_snapshots`.
- `ebay_active_listing_risk_events`.

## Local VM/Lab Heavy Tables

High-volume or experimental data should live in the Local VM/Lab database in a future phase:

- Benchmark raw snapshots.
- Benchmark raw batches.
- Scanner raw outputs.
- Price intelligence raw batches.
- Worker run logs.
- Heavy fixture imports.
- Image experiment outputs.
- Historical radar raw snapshots.

## Shared Minimum Data

Only a minimal bridge should be shared between IMNOVA Core and eBay Pro:

- `product_id`.
- `slug`.
- Confirmed product facts.
- Product status summary.
- Stock summary.
- Safe cost summary, if approved.

Shared minimum data must not include PII, full community tables, subscriber records, WhatsApp logs, eBay raw snapshots or heavy listing payloads.

## Unknown/Manual Review Tables

These require manual classification before any cleanup decision:

- `trend_radar_signals`, because it may support broader IMNOVA trend intelligence.
- `social_signals`, because it may be general analytics or future eBay benchmark input.
- `community_surveys`.
- `survey_responses`.
- `notification_logs`, if mixed with future eBay Pro seller alerts.

## Cleanup Safety Checklist

No physical cleanup should happen until all of this is true:

- Production gate is merged and verified.
- Production tables are inventoried read-only.
- Candidate tables are exported/backed up.
- Production runtime is verified not to depend on candidate tables.
- Unknown tables are manually classified.
- Rollback script exists.
- User explicitly approves archive/removal.
- Work is scheduled in a production maintenance window if needed.

## Backup/Export Requirement

Every table proposed for archival or removal must be exported first. The export must be stored outside the production database and tied to the exact table list, timestamp and environment.

## Rollback Requirement

Any future cleanup must include a rollback plan that can restore archived tables or recreate required structure from the approved backup. The rollback must be reviewed before cleanup begins.

## Proposed Cleanup Phases

1. 132F-FAST Read-only production DB inventory.
2. 132G-FAST Cleanup migration draft, not applied.
3. 132H-FAST Approved cleanup/archival execution.
4. 132I-FAST VM Lab DB migration/seed plan.

## What Not To Delete

Do not remove Core product, community, subscriber, communication, store, public product, product state or Core WhatsApp communication tables without a separate Core review.

Do not remove ambiguous trend, social, survey or notification tables until they are classified manually.

Do not remove eBay Pro tables from production without backup, dependency verification, rollback and explicit approval.

## Next Loop

The next safe loop is `132F-FAST Read-only production DB inventory`. That loop should inventory actual production tables in read-only mode and compare them with this static classification before any cleanup plan is drafted.
