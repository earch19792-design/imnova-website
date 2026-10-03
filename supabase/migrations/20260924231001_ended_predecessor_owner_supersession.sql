-- An exact ended predecessor may still hold ACTIVE reverse/SKU authority.
-- On explicit OWNER confirmation, retire only that ended predecessor inside
-- the same transaction, preserving the transition event and old receipt.
do $migration$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.confirm_seller_os_listing_manual_identity_v1(text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$  v_case public.seller_os_listing_cases_v1%rowtype;
  v_active public.ebay_active_listings%rowtype;$old$;
  v_new := $new$  v_case public.seller_os_listing_cases_v1%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_ended record;$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'ENDED_PREDECESSOR_DECLARATION_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$  if exists (select 1 from public.seller_os_luna_linkage_decisions d
    where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
      and d.ebay_item_id=p_ebay_item_id)$old$;
  v_new := $new$  select count(*) into v_count
  from public.seller_os_listing_product_link_authorities_v1 a
  where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
    and a.lifecycle_state='ACTIVE' and a.ebay_item_id<>p_ebay_item_id
    and a.luna_product_id=p_luna_product_id
    and a.luna_variant_id=p_luna_variant_id and a.luna_sku=p_luna_sku
    and a.ebay_sku=p_official_custom_label
    and exists (select 1 from public.ebay_active_listings old
      where old.account_key=a.account_key and old.ebay_item_id=a.ebay_item_id
        and old.listing_status='ended')
    and not exists (select 1 from public.ebay_active_listings live
      where live.account_key=a.account_key and live.ebay_item_id=a.ebay_item_id
        and live.listing_status='active');
  if v_count>1 then
    raise exception 'LISTING_OWNER_ENDED_PREDECESSOR_AMBIGUOUS';
  end if;
  if v_count=1 then
    select a.authority_id,a.ebay_item_id into v_ended
    from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
      and a.lifecycle_state='ACTIVE' and a.ebay_item_id<>p_ebay_item_id
      and a.luna_product_id=p_luna_product_id
      and a.luna_variant_id=p_luna_variant_id and a.luna_sku=p_luna_sku
      and a.ebay_sku=p_official_custom_label
      and exists (select 1 from public.ebay_active_listings old
        where old.account_key=a.account_key and old.ebay_item_id=a.ebay_item_id
          and old.listing_status='ended')
      and not exists (select 1 from public.ebay_active_listings live
        where live.account_key=a.account_key and live.ebay_item_id=a.ebay_item_id
          and live.listing_status='active');
    perform public.transition_seller_os_listing_product_link_authority_v1(
      'UNLINK',p_account_key,v_ended.ebay_item_id,null,
      v_ended.authority_id,'OWNER',p_actor_user_id::text,
      'ENDED_PREDECESSOR_SUPERSEDED_BY_OWNER');
  end if;

  if exists (select 1 from public.seller_os_luna_linkage_decisions d
    where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
      and d.ebay_item_id=p_ebay_item_id)$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'ENDED_PREDECESSOR_TRANSITION_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);
end;
$migration$;
