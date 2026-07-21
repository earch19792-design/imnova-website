-- A monitored listing can be registered manually and therefore have no
-- Seller OS publication package. Keep the no-promotion policy on the active
-- listing itself so a human-approved competitive price is safe for both
-- publication paths.

alter table public.ebay_active_listings
  add column if not exists controlled_risk_policy jsonb null;

alter table public.ebay_active_listings
  drop constraint if exists ebay_active_listings_controlled_risk_policy_check;

alter table public.ebay_active_listings
  add constraint ebay_active_listings_controlled_risk_policy_check check (
    controlled_risk_policy is null or (
      jsonb_typeof(controlled_risk_policy) = 'object'
      and controlled_risk_policy ->> 'version' =
        'ACTIVE_MARKET_CONTROLLED_RISK_10_PERCENT_V1'
      and controlled_risk_policy ->> 'status' in (
        'PENDING_PRICE_APPLY', 'ACTIVE'
      )
      and controlled_risk_policy ->> 'promotion' = 'DO_NOT_PROMOTE'
      and controlled_risk_policy ->> 'minimumNetMarginPercent' = '10'
      and controlled_risk_policy ->> 'finalHumanAuthorizationRequired' = 'true'
    )
  ) not valid;

alter table public.ebay_active_listings
  validate constraint ebay_active_listings_controlled_risk_policy_check;

comment on column public.ebay_active_listings.controlled_risk_policy is
  'Durable no-promotion policy for a human-approved active-market price, including manually registered listings.';

notify pgrst, 'reload schema';
