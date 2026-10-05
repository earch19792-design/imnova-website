-- TEO stores read-only seller analytics independently from the Preview-only
-- category-ranking experiment. The TEO source still requires an originally
-- verified listing identity from the connected seller account, while the
-- category source retains its strict 36-hour reverification gate.

alter table public.ebay_listing_performance_snapshots
  drop constraint ebay_listing_performance_source_check;

alter table public.ebay_listing_performance_snapshots
  add constraint ebay_listing_performance_source_check check (source in (
    'EBAY_SELL_ANALYTICS_READONLY',
    'EBAY_SELL_ANALYTICS_READONLY_TEO_OWNER_MANUAL'
  ));

create or replace function public.assert_ebay_own_listing_performance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.ebay_manual_listing_links%rowtype;
begin
  if new.source not in (
      'EBAY_SELL_ANALYTICS_READONLY',
      'EBAY_SELL_ANALYTICS_READONLY_TEO_OWNER_MANUAL'
    ) or new.report_dimension is distinct from 'LISTING' then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_OFFICIAL_LISTING_SOURCE_REQUIRED';
  end if;

  if new.observed_at is null
    or new.report_date_from is null
    or new.report_date_to is null then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_WINDOW_REQUIRED';
  end if;

  select * into v_link
  from public.ebay_manual_listing_links
  where id = new.manual_listing_link_id
    and verification_status = 'verified'
    and verification_method in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY'
    )
    and connector_listing_id is not null
    and verified_at is not null
    and last_verification_at <= new.observed_at + interval '5 minutes'
    and (
      new.source = 'EBAY_SELL_ANALYTICS_READONLY_TEO_OWNER_MANUAL'
      or last_verification_at >= new.observed_at - interval '36 hours'
    )
  for key share;

  if not found then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_VERIFIED_OWN_LINK_REQUIRED';
  end if;

  if new.ebay_item_id is distinct from v_link.ebay_item_id then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_LISTING_DIMENSION_MISMATCH';
  end if;

  if new.observed_at < v_link.verified_at then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_PRECEDES_LINK_VERIFICATION';
  end if;

  if (new.report_date_from::timestamp at time zone 'UTC') <
      v_link.verified_at then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_WINDOW_PRECEDES_LINK_VERIFICATION';
  end if;

  new.opportunity_id := v_link.opportunity_id;
  new.account_key := v_link.account_key;
  new.marketplace_id := v_link.marketplace_id;
  new.ebay_item_id := v_link.ebay_item_id;
  new.candidate_key := v_link.candidate_key;
  new.category_id := case
    when v_link.verification_method = 'EBAY_TRADING_GET_ITEM_READONLY'
      and v_link.safe_defaults->>'categoryId' ~ '^[0-9]{1,20}$'
      then v_link.safe_defaults->>'categoryId'
    else v_link.predicted_category_id
  end;
  new.predicted_opportunity_score := v_link.predicted_opportunity_score;
  new.predicted_engine_version := v_link.predicted_engine_version;
  new.prediction_source := v_link.prediction_source;
  new.link_verified_at := v_link.verified_at;
  new.window_days := (new.report_date_to - new.report_date_from) + 1;
  new.listing_age_days := floor(
    extract(epoch from (new.observed_at - v_link.verified_at)) / 86400
  )::integer;
  return new;
end;
$$;

revoke all on function
  public.assert_ebay_own_listing_performance_snapshot()
  from public, anon, authenticated;
grant execute on function
  public.assert_ebay_own_listing_performance_snapshot()
  to service_role;

comment on function public.assert_ebay_own_listing_performance_snapshot() is
  'Verifies official own-listing analytics. Category learning requires a fresh readback; isolated TEO owner-manual memory accepts an existing verified identity.';
