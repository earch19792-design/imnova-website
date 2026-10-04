-- Use the existing canonical queue observation timestamp.
create or replace function public.ensure_seller_os_fast_listing_v1(p_account_key text,p_owner_user_id uuid,p_snapshot_id uuid,p_product_id text,p_variant_id text,p_sku text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_source public.luna_catalog_snapshot_variants_v1; v_case public.ebay_luna_opportunity_queue;
  v_key text; v_context public.seller_os_fast_listing_contexts_v1;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_key||':'||p_product_id||':'||p_variant_id||':'||p_sku,0));
  select * into strict v_source from public.luna_catalog_snapshot_variants_v1 where snapshot_id=p_snapshot_id
    and product_id=p_product_id and variant_id=p_variant_id and sku=p_sku;
  if not exists(select 1 from public.luna_catalog_snapshots_v1 where snapshot_id=p_snapshot_id and snapshot_status='COMPLETE') then
    raise exception 'FAST_LISTING_COMPLETE_SOURCE_REQUIRED'; end if;
  v_key:=public.seller_os_current_commercial_candidate_id_v1(p_account_key,'EBAY_US','LUNA_PORTEX',p_product_id,p_variant_id,p_sku);
  select * into v_case from public.ebay_luna_opportunity_queue where supplier_product_id=p_product_id and supplier_variant_id=p_variant_id
    and supplier_sku=p_sku order by (candidate_key=v_key) desc,first_detected_at,id limit 1;
  if v_case.id is null then
    insert into public.ebay_luna_opportunity_queue(candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,
      queue_status,decision,supplier_price,supplier_available,supplier_snapshot_at,assessment)
    values(v_key,p_product_id,p_variant_id,p_sku,v_source.title,'review','FAST_LISTING_RESEARCH_DRAFT',v_source.price,v_source.availability,v_source.observed_at,
      jsonb_build_object('productTruth',jsonb_build_object('lunaProductId',p_product_id,'lunaVariantId',p_variant_id,'supplierSku',p_sku,'title',v_source.title,
      'sourceUrl',v_source.canonical_url,'fieldTruthV1',v_source.field_truth_v1),'fastListingV1',jsonb_build_object('contractVersion','SELLER_OS_FAST_LISTING_V1',
      'sourceSnapshotId',p_snapshot_id,'marketplaceWrites',0,'publicationAuthorized',false)))
    on conflict(candidate_key) do nothing;
    select * into strict v_case from public.ebay_luna_opportunity_queue where candidate_key=v_key;
  end if;
  insert into public.seller_os_fast_listing_contexts_v1(account_key,opportunity_id,owner_user_id)
    values(p_account_key,v_case.id,p_owner_user_id) on conflict do nothing;
  select * into strict v_context from public.seller_os_fast_listing_contexts_v1 where account_key=p_account_key and opportunity_id=v_case.id;
  if v_context.owner_user_id<>p_owner_user_id then raise exception 'FAST_LISTING_OWNER_CONFLICT'; end if;
  return jsonb_build_object('context',to_jsonb(v_context),'opportunity',to_jsonb(v_case));
end $$;
