-- PRODUCTION_EBAY_PRO_DATA_CLEANUP_DRAFT_V1
-- DRAFT ONLY
-- PRODUCTION ONLY
-- DO NOT RUN WITHOUT BACKUP
-- DO NOT RUN WITHOUT USER APPROVAL
-- DEFAULT ROLLBACK
-- NO TABLE OR VIEW REMOVAL
-- DATA CLEANUP ONLY
-- This draft keeps schemas, tables, and views in place for compatibility.

BEGIN;

TRUNCATE TABLE
  public.ebay_active_listing_risk_events,
  public.ebay_active_listings,
  public.ebay_candidate_decisions,
  public.ebay_candidate_scores,
  public.ebay_candidate_validations,
  public.ebay_compliance_checks,
  public.ebay_listing_drafts,
  public.ebay_pipeline_audit_log,
  public.ebay_price_intelligence_snapshots,
  public.ebay_product_candidates,
  public.ebay_profit_scenarios,
  public.market_radar_events,
  public.market_radar_products,
  public.market_radar_scores,
  public.market_radar_snapshots,
  public.market_radar_sources
RESTART IDENTITY;

ROLLBACK;
