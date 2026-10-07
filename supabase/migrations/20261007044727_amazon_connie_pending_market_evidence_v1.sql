-- SELLER_OS_AMAZON_CONNIE_PENDING_MARKET_EVIDENCE_V1
-- Keep pre-purchase Amazon evidence on the existing proposal-inbox authority.
-- Null amounts remain unknown; they are never converted to false zeroes.

alter table public.seller_os_amazon_contributor_sku_attribution_v1
  add column if not exists listing_price_usd numeric(12,2) null,
  add column if not exists listing_available_quantity integer null,
  add column if not exists listing_fulfillment_channel text null,
  add column if not exists featured_offer_state text null,
  add column if not exists featured_offer_price_usd numeric(12,2) null,
  add column if not exists featured_offer_listing_price_usd numeric(12,2) null,
  add column if not exists featured_offer_shipping_usd numeric(12,2) null,
  add column if not exists featured_offer_fulfillment_channel text null,
  add column if not exists featured_offer_count integer null,
  add column if not exists pricing_observed_at timestamptz null,
  add column if not exists pricing_authority text null,
  add column if not exists estimated_amazon_fees_usd numeric(12,2) null,
  add column if not exists fee_estimate_state text null,
  add column if not exists fee_estimate_observed_at timestamptz null,
  add column if not exists fee_estimate_price_usd numeric(12,2) null,
  add column if not exists fee_estimate_fulfillment_channel text null,
  add column if not exists fee_estimate_authority text null,
  add column if not exists demand_signal_state text null,
  add column if not exists display_group_rank integer null,
  add column if not exists display_group_title text null,
  add column if not exists classification_rank integer null,
  add column if not exists classification_title text null,
  add column if not exists catalog_observed_at timestamptz null,
  add column if not exists catalog_authority text null,
  add column if not exists seller_units_ordered_30d integer null,
  add column if not exists seller_sales_30d_state text null,
  add column if not exists seller_sales_window_start timestamptz null,
  add column if not exists seller_sales_window_end timestamptz null,
  add column if not exists seller_sales_authority text null,
  add column if not exists market_monthly_sold_estimate integer null,
  add column if not exists market_sales_rank_drops_30 integer null,
  add column if not exists market_sales_rank_drops_90 integer null,
  add column if not exists market_sales_rank_drops_180 integer null,
  add column if not exists market_demand_estimate_state text null,
  add column if not exists market_demand_estimate_method text null,
  add column if not exists market_demand_observed_at timestamptz null,
  add column if not exists market_demand_authority text null,
  add constraint seller_os_amazon_pending_listing_price_check check (
    listing_price_usd is null or listing_price_usd >= 0
  ),
  add constraint seller_os_amazon_pending_listing_quantity_check check (
    listing_available_quantity is null or listing_available_quantity >= 0
  ),
  add constraint seller_os_amazon_pending_listing_fulfillment_check check (
    listing_fulfillment_channel is null or
    listing_fulfillment_channel in ('FBA', 'FBM')
  ),
  add constraint seller_os_amazon_pending_featured_offer_state_check check (
    featured_offer_state is null or
    featured_offer_state in ('AVAILABLE', 'NO_FEATURED_OFFER', 'UNAVAILABLE')
  ),
  add constraint seller_os_amazon_pending_featured_offer_amounts_check check (
    (featured_offer_price_usd is null or featured_offer_price_usd >= 0) and
    (featured_offer_listing_price_usd is null or
      featured_offer_listing_price_usd >= 0) and
    (featured_offer_shipping_usd is null or featured_offer_shipping_usd >= 0)
  ),
  add constraint seller_os_amazon_pending_featured_offer_channel_check check (
    featured_offer_fulfillment_channel is null or
    featured_offer_fulfillment_channel in ('FBA', 'FBM')
  ),
  add constraint seller_os_amazon_pending_featured_offer_count_check check (
    featured_offer_count is null or featured_offer_count >= 0
  ),
  add constraint seller_os_amazon_pending_fee_state_check check (
    fee_estimate_state is null or
    fee_estimate_state in ('AVAILABLE', 'UNAVAILABLE')
  ),
  add constraint seller_os_amazon_pending_fee_amounts_check check (
    (estimated_amazon_fees_usd is null or estimated_amazon_fees_usd >= 0) and
    (fee_estimate_price_usd is null or fee_estimate_price_usd >= 0)
  ),
  add constraint seller_os_amazon_pending_fee_channel_check check (
    fee_estimate_fulfillment_channel is null or
    fee_estimate_fulfillment_channel in ('FBA', 'FBM')
  ),
  add constraint seller_os_amazon_pending_demand_state_check check (
    demand_signal_state is null or
    demand_signal_state in ('SUPPORTED', 'UNAVAILABLE')
  ),
  add constraint seller_os_amazon_pending_rank_check check (
    (display_group_rank is null or display_group_rank > 0) and
    (classification_rank is null or classification_rank > 0)
  ),
  add constraint seller_os_amazon_pending_sales_30d_check check (
    seller_units_ordered_30d is null or seller_units_ordered_30d >= 0
  ),
  add constraint seller_os_amazon_pending_sales_30d_state_check check (
    seller_sales_30d_state is null or
    seller_sales_30d_state in ('CONFIRMED', 'UNAVAILABLE')
  ),
  add constraint seller_os_amazon_pending_market_demand_counts_check check (
    (market_monthly_sold_estimate is null or
      market_monthly_sold_estimate >= 0) and
    (market_sales_rank_drops_30 is null or market_sales_rank_drops_30 >= 0) and
    (market_sales_rank_drops_90 is null or market_sales_rank_drops_90 >= 0) and
    (market_sales_rank_drops_180 is null or market_sales_rank_drops_180 >= 0)
  ),
  add constraint seller_os_amazon_pending_market_demand_state_check check (
    market_demand_estimate_state is null or
    market_demand_estimate_state in ('AVAILABLE', 'UNAVAILABLE')
  ),
  add constraint seller_os_amazon_pending_market_demand_method_check check (
    market_demand_estimate_method is null or market_demand_estimate_method in (
      'KEEPA_MONTHLY_SOLD', 'KEEPA_RANK_DROPS_PROXY', 'UNAVAILABLE'
    )
  );

comment on column public.seller_os_amazon_contributor_sku_attribution_v1.featured_offer_price_usd is
  'Current delivered Featured Offer (Buy Box) price from Product Pricing API. Null is unknown, never zero.';
comment on column public.seller_os_amazon_contributor_sku_attribution_v1.seller_units_ordered_30d is
  'Units ordered for this seller in the official 30-day Sales and Traffic report. This is not total marketplace ASIN sales.';
comment on column public.seller_os_amazon_contributor_sku_attribution_v1.market_monthly_sold_estimate is
  'Keepa market-level monthly sold estimate for the ASIN. Estimated evidence, never official seller units or guaranteed sales.';

revoke all on public.seller_os_amazon_contributor_sku_attribution_v1
  from public, anon, authenticated;
grant select, insert, update on
  public.seller_os_amazon_contributor_sku_attribution_v1 to service_role;

notify pgrst, 'reload schema';
