-- ebay_active_listings intentionally stores multiple official observation
-- sources for one physical Item ID. Batch deltas therefore count distinct
-- active eBay Item IDs, not registry rows.
create or replace function
  public.get_autonomous_stocking_active_listing_count_v1(
    p_account_key text
  )
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count bigint;
begin
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null then
    raise exception 'AUTONOMOUS_STOCKING_ACTIVE_COUNT_INVALID';
  end if;
  select count(distinct listing.ebay_item_id) into v_count
  from public.ebay_active_listings listing
  where listing.account_key = trim(p_account_key)
    and listing.listing_status = 'active';
  return coalesce(v_count, 0);
end;
$$;

revoke all on function
  public.get_autonomous_stocking_active_listing_count_v1(text)
  from public, anon, authenticated;
grant execute on function
  public.get_autonomous_stocking_active_listing_count_v1(text)
  to service_role;

notify pgrst, 'reload schema';
