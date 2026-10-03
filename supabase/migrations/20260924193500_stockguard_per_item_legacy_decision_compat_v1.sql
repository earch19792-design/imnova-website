-- A supplier tuple may have separately approved durable Item ID receipts.
-- Keep the exact per-item gate; do not treat a second independently proven
-- listing as an identity contradiction merely because both use one source.
create or replace function public.stockguard_approved_decision_authority_v1(
  p_account_key text, p_ebay_item_id text, p_linkage_id text)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $function$
declare
  v_decision public.seller_os_luna_linkage_decisions%rowtype;
  v_component jsonb;
begin
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
  return true;
end;
$function$;

revoke all on function public.stockguard_approved_decision_authority_v1(
  text,text,text) from public,anon,authenticated,service_role;
