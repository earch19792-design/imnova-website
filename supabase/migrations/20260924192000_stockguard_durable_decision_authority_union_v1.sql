-- Extend the existing StockGuard write guard to exact, durable OWNER decisions.
-- Historical receipts and authority rows are untouched. Custom Label is only
-- checked for consistency with the official listing; it never selects Luna.
create or replace function public.stockguard_approved_decision_authority_v1(
  p_account_key text, p_ebay_item_id text, p_linkage_id text)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $function$
declare
  v_decision public.seller_os_luna_linkage_decisions%rowtype;
  v_component jsonb;
begin
  -- An explicit authority lifecycle transition always supersedes an older
  -- decision, including UNLINKED and INVALIDATED.
  if exists (
    select 1 from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
      and a.ebay_item_id=p_ebay_item_id
  ) or exists (
    select 1 from public.seller_os_listing_identity_quarantines_v1 q
    where q.account_key=p_account_key and q.marketplace_id='EBAY_US'
      and q.ebay_item_id=p_ebay_item_id and q.quarantine_state='ACTIVE'
  ) then return false; end if;

  select d.* into v_decision
  from public.seller_os_luna_linkage_decisions d
  where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
    and d.ebay_item_id=p_ebay_item_id
  order by d.decision_version desc,d.decision_at desc
  limit 1;
  if not found or v_decision.decision<>'APPROVE_EXACT_LINKAGE'
    or v_decision.linkage_id<>p_linkage_id
    or coalesce(v_decision.luna_product_id !~ '^[0-9]{1,30}$',true)
    or coalesce(v_decision.luna_variant_id !~ '^[0-9]{1,30}$',true)
    or nullif(v_decision.luna_sku,'') is null
    or jsonb_typeof(v_decision.components) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(v_decision.components)<>1 then return false; end if;
  v_component:=v_decision.components->0;
  if v_component->>'lunaProductId' is distinct from v_decision.luna_product_id
    or v_component->>'lunaVariantId' is distinct from v_decision.luna_variant_id
    or v_component->>'lunaSku' is distinct from v_decision.luna_sku
    or v_component->>'exactProductIdentity' is distinct from 'true'
    or v_component->>'exactVariantIdentity' is distinct from 'true'
    or v_component->>'exactSupplierSku' is distinct from 'true'
    or v_component->>'structuredVariantAttributesComplete' is distinct from 'true'
    or v_component->>'identityConflict' is distinct from 'false'
    or not exists (
      select 1 from public.ebay_active_listings listing
      where listing.account_key=p_account_key
        and listing.ebay_item_id=p_ebay_item_id
        and listing.listing_status='active'
        and listing.ebay_sku=v_decision.ebay_sku
    ) then return false; end if;

  if exists (
    select 1 from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
      and a.ebay_item_id<>p_ebay_item_id and a.lifecycle_state='ACTIVE'
      and a.luna_product_id=v_decision.luna_product_id
      and a.luna_variant_id=v_decision.luna_variant_id
      and a.luna_sku=v_decision.luna_sku
  ) or exists (
    select 1 from public.seller_os_luna_linkage_decisions other
    join public.ebay_active_listings listing
      on listing.account_key=other.account_key
      and listing.ebay_item_id=other.ebay_item_id
      and listing.listing_status='active'
      and listing.ebay_sku=other.ebay_sku
    where other.account_key=p_account_key and other.marketplace_id='EBAY_US'
      and other.ebay_item_id<>p_ebay_item_id
      and other.luna_product_id=v_decision.luna_product_id
      and other.luna_variant_id=v_decision.luna_variant_id
      and other.luna_sku=v_decision.luna_sku
      and other.decision='APPROVE_EXACT_LINKAGE'
      and not exists (
        select 1 from public.seller_os_luna_linkage_decisions newer
        where newer.account_key=other.account_key
          and newer.marketplace_id=other.marketplace_id
          and newer.ebay_item_id=other.ebay_item_id
          and newer.decision_version>other.decision_version
      )
  ) then return false; end if;
  return true;
end;
$function$;

revoke all on function public.stockguard_approved_decision_authority_v1(
  text,text,text) from public,anon,authenticated,service_role;

create or replace function public.guard_seller_os_luna_stock_job_authority_p0()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $function$
begin
  if not exists (
    select 1 from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=new.account_key and a.marketplace_id='EBAY_US'
      and a.ebay_item_id=new.ebay_item_id and a.linkage_id=new.linkage_id
      and a.lifecycle_state='ACTIVE'
  ) and not public.stockguard_approved_decision_authority_v1(
    new.account_key,new.ebay_item_id,new.linkage_id)
    or exists (
      select 1 from public.seller_os_listing_identity_quarantines_v1 q
      where q.account_key=new.account_key and q.marketplace_id='EBAY_US'
        and q.ebay_item_id=new.ebay_item_id and q.quarantine_state='ACTIVE'
    ) then
    raise exception 'STOCKGUARD_CANONICAL_DURABLE_LINK_AUTHORITY_REQUIRED';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_seller_os_luna_stock_job_authority_p0()
  from public,anon,authenticated,service_role;
