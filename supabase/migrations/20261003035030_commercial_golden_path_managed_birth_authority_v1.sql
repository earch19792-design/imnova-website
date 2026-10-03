-- Existing StockGuard authority is SELECT-only for service_role. Keep that boundary; grant only this checked atomic RPC.
create or replace function public.seller_os_golden_enroll_v1(p_account_key text,p_owner_user_id uuid,p_package_receipt_id uuid,p_receipt_id uuid,p_digest text,p_payload jsonb,p_authority jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_package jsonb; v_case_id uuid; v_item text:=p_payload->>'itemId';
  v_key jsonb; v_authority_id text:=p_authority->>'authority_id'; v_existing public.seller_os_golden_managed_listings_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1() then raise exception 'GOLDEN_ENROLL_SERVICE_ROLE_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-link-authority-v1:account:'||p_account_key,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_key||':'||v_item,0));
  select payload into v_package from public.seller_os_golden_path_receipts_v1 where receipt_id=p_package_receipt_id and account_key=p_account_key and owner_user_id=p_owner_user_id and kind='DRAFT';
  v_key:=v_package->'candidate';
  if v_package is null or v_package->>'state' is distinct from 'DRAFT_ONLY' or (v_package->>'published')::boolean is distinct from false
    or p_payload->>'status' is distinct from 'LIVE_VERIFIED' or p_payload->>'source' is distinct from 'EBAY_TRADING_GET_ITEM_READONLY'
    or p_payload->>'ownership' is distinct from 'verified' or p_payload->>'listingStatus' is distinct from 'Active'
    or p_payload->>'marketplaceSite' is distinct from 'US' or p_payload->>'sku' is distinct from v_key->>'supplierSku'
    or p_payload->>'observedAt' is null
    or (p_payload->>'observedAt')::timestamptz > now()
    or (p_payload->>'observedAt')::timestamptz < now()-interval '5 minutes'
    or p_authority->>'account_key' is distinct from p_account_key or p_authority->>'ebay_item_id' is distinct from v_item
    or p_authority->>'luna_product_id' is distinct from v_key->>'productId'
    or p_authority->>'luna_variant_id' is distinct from v_key->>'variantId'
    or p_authority->>'luna_sku' is distinct from v_key->>'supplierSku'
    or (p_authority->>'supplier_quantity_required')::integer is distinct from (v_key->>'supplierQuantity')::integer
    then raise exception 'GOLDEN_ENROLL_OFFICIAL_BINDING_REQUIRED'; end if;
  if not exists(select 1 from public.luna_catalog_snapshot_variants_v1 v join public.luna_catalog_snapshots_v1 s using(snapshot_id)
    where s.snapshot_status='COMPLETE' and v.product_id=v_key->>'productId' and v.variant_id=v_key->>'variantId' and v.sku=v_key->>'supplierSku'
    and v.source_fingerprint=p_authority->>'source_fingerprint' and v.preflight_status='PREFLIGHT_PASS'
    and s.snapshot_id=(select snapshot_id from public.luna_catalog_snapshots_v1 where snapshot_status='COMPLETE' order by snapshot_completed_at desc limit 1)) then
    raise exception 'GOLDEN_ENROLL_CURRENT_LUNA_BINDING_REQUIRED'; end if;
  select * into v_existing from public.seller_os_golden_managed_listings_v1 where account_key=p_account_key and ebay_item_id=v_item;
  if found then
    if v_existing.package_receipt_id<>p_package_receipt_id then raise exception 'GOLDEN_ENROLL_PACKAGE_CONFLICT'; end if;
    return to_jsonb(v_existing);
  end if;
  insert into public.seller_os_listing_product_link_authorities_v1(
    authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,seller_os_product_id,luna_product_id,luna_variant_id,luna_sku,supplier_quantity_required,evidence_maximum_age_seconds,components,identity_key,linkage_id,source_decision_id,lifecycle_state,transition_reason_code,actor_type,actor_reference,identity_preflight_status,source_fingerprint,activated_at)
  values(v_authority_id,p_account_key,'EBAY_US',v_item,v_key->>'supplierSku',(p_authority->>'seller_os_product_id')::uuid,v_key->>'productId',v_key->>'variantId',v_key->>'supplierSku',(v_key->>'supplierQuantity')::integer,21600,p_authority->'components',p_authority->>'identity_key',p_authority->>'linkage_id',p_authority->>'source_decision_id','ACTIVE','GOLDEN_PATH_MANUAL_LIVE_VERIFIED','OWNER','OWNER:'||p_owner_user_id::text,'PREFLIGHT_PASS',p_authority->>'source_fingerprint',now());
  insert into public.seller_os_listing_product_link_events_v1(event_id,authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,identity_key,from_state,to_state,reason_code,actor_type,actor_reference,previous_authority_id,authority_snapshot,occurred_at)
  select 'listing-link-event-v1:sha256:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_authority_id||':'||p_receipt_id::text,'UTF8')),'hex'),a.authority_id,p_account_key,'EBAY_US',v_item,a.ebay_sku,a.identity_key,null,'ACTIVE','GOLDEN_PATH_MANUAL_LIVE_VERIFIED','OWNER','OWNER:'||p_owner_user_id::text,null,to_jsonb(a),now() from public.seller_os_listing_product_link_authorities_v1 a where a.authority_id=v_authority_id;
  insert into public.seller_os_listing_cases_v1(account_key,marketplace_id,ebay_item_id,ebay_custom_label,supplier_sku,luna_product_id,luna_variant_id,origin,listing_status,identity_status,stockguard_link_status,stockguard_authority_id,identity_source,ebay_observed_at)
  values(p_account_key,'EBAY_US',v_item,v_key->>'supplierSku',v_key->>'supplierSku',v_key->>'productId',v_key->>'variantId','MANUAL_EBAY','ACTIVE','LINKED_EXACT','LINKED_MONITOR_ONLY',v_authority_id,'COMMERCIAL_GOLDEN_PATH_MANUAL_LIVE_READBACK',(p_payload->>'observedAt')::timestamptz)
  on conflict(account_key,marketplace_id,ebay_item_id) do update set ebay_custom_label=excluded.ebay_custom_label,supplier_sku=excluded.supplier_sku,luna_product_id=excluded.luna_product_id,luna_variant_id=excluded.luna_variant_id,listing_status='ACTIVE',identity_status='LINKED_EXACT',stockguard_link_status='LINKED_MONITOR_ONLY',stockguard_authority_id=excluded.stockguard_authority_id,identity_source=excluded.identity_source,ebay_observed_at=excluded.ebay_observed_at,reconciled_at=now()
  where public.seller_os_listing_cases_v1.identity_status in ('MISSING_LUNA_IDENTITY','LINKABLE_EXACT','NEEDS_OWNER_REVIEW')
  returning case_id into v_case_id;
  if v_case_id is null then raise exception 'GOLDEN_ENROLL_EXISTING_CASE_CONFLICT'; end if;
  insert into public.seller_os_golden_path_receipts_v1(receipt_id,account_key,owner_user_id,kind,evidence_digest,payload)
  values(p_receipt_id,p_account_key,p_owner_user_id,'RECONCILIATION',p_digest,p_payload);
  insert into public.seller_os_golden_managed_listings_v1(account_key,ebay_item_id,package_receipt_id,reconciliation_receipt_id,case_id,authority_id,supplier_sku,product_id,variant_id,supplier_quantity,official_live_observed_at,stockguard_enrolled,analytics_enrolled)
  values(p_account_key,v_item,p_package_receipt_id,p_receipt_id,v_case_id,v_authority_id,v_key->>'supplierSku',v_key->>'productId',v_key->>'variantId',(v_key->>'supplierQuantity')::integer,(p_payload->>'observedAt')::timestamptz,true,true);
  select * into v_existing from public.seller_os_golden_managed_listings_v1 where account_key=p_account_key and ebay_item_id=v_item;
  return to_jsonb(v_existing);
end; $$;
revoke all on function public.seller_os_golden_enroll_v1(text,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_golden_enroll_v1(text,uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
