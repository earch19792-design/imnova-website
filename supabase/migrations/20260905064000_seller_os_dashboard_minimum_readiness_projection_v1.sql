-- Narrow minimum-readiness authority for the owner dashboard. These stored
-- generated fields retain the one-read/no-assessment payload contract while
-- preventing an older queue decision from overriding a current fail-closed
-- minimum readiness receipt.
alter table public.ebay_luna_opportunity_queue
  add column if not exists dashboard_minimum_readiness_current boolean
    generated always as (
      assessment #>> '{minimumTruthfulListingReadinessV1,contractVersion}'
        = 'MINIMUM_TRUTHFUL_LISTING_READINESS_V1'
      and assessment #>> '{minimumTruthfulListingReadinessV1,candidateKey}'
        = candidate_key
      and assessment #>> '{minimumTruthfulListingReadinessV1,opportunityId}'
        = id::text
    ) stored,
  add column if not exists dashboard_minimum_listing_ready boolean
    generated always as (
      assessment #>> '{minimumTruthfulListingReadinessV1,listingReady}'
        = 'true'
    ) stored,
  add column if not exists dashboard_minimum_market_test_ready boolean
    generated always as (
      assessment #>> '{minimumTruthfulListingReadinessV1,marketTestReady}'
        = 'true'
    ) stored;

comment on column
  public.ebay_luna_opportunity_queue.dashboard_minimum_readiness_current
  is 'Generated binding check for current minimum truthful readiness authority.';
comment on column
  public.ebay_luna_opportunity_queue.dashboard_minimum_listing_ready
  is 'Generated listing-ready value from minimum truthful readiness.';
comment on column
  public.ebay_luna_opportunity_queue.dashboard_minimum_market_test_ready
  is 'Generated market-test-ready value from minimum truthful readiness.';
