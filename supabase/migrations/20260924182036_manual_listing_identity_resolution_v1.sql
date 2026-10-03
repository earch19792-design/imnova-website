-- OWNER-selected Luna identity for current LIVE listings whose deterministic
-- resolver has no unique answer. Custom Label is recorded as evidence only.
create or replace function public.confirm_seller_os_listing_manual_identity_v1(
  p_account_key text,
  p_ebay_item_id text,
  p_opportunity_id uuid,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_luna_sku text,
  p_official_observed_at timestamptz,
  p_official_title text,
  p_official_custom_label text,
  p_official_quantity integer,
  p_official_price numeric,
  p_official_currency text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_sweep public.seller_os_listing_registry_sweeps_v1%rowtype;
  v_case public.seller_os_listing_cases_v1%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_snapshot record;
  v_market_product_id uuid;
  v_count integer;
  v_hash text;
  v_linkage_id text;
  v_review_set_id text;
  v_candidate_id text;
  v_decision_id text;
  v_evidence_at timestamptz;
  v_components jsonb;
  v_evidence_references text[];
  v_provenance jsonb := jsonb_build_object(
    'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
    'sourceStatus', 'AVAILABLE',
    'acquisitionMethod', 'OWNER_SELECTED_CURRENT_LUNA_IDENTITY');
  v_lineage jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_account_key is null or length(p_account_key) not between 3 and 200
    or p_ebay_item_id !~ '^[0-9]{9,20}$'
    or p_opportunity_id is null
    or p_luna_product_id !~ '^[0-9]{1,30}$'
    or p_luna_variant_id !~ '^[0-9]{1,30}$'
    or p_luna_sku is null or length(p_luna_sku) not between 1 and 120
    or p_official_observed_at is null
    or p_official_observed_at > v_now + interval '1 minute'
    or p_official_observed_at < v_now - interval '5 minutes'
    or p_official_title is null or length(p_official_title) not between 1 and 350
    or p_official_quantity is null or p_official_quantity < 0
    or p_official_price is null or p_official_price <= 0
    or p_official_currency !~ '^[A-Z]{3}$'
    or p_actor_user_id is null then
    raise exception 'LISTING_OWNER_MANUAL_IDENTITY_INPUT_INVALID';
  end if;
  if not exists (select 1 from auth.users actor where actor.id=p_actor_user_id
    and (actor.raw_app_meta_data->>'is_admin'='true'
      or actor.raw_app_meta_data->>'role'='admin')) then
    raise exception 'LISTING_OWNER_ADMIN_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_key || ':EBAY_US:' || p_ebay_item_id, 0));

  select * into v_sweep from public.seller_os_listing_registry_sweeps_v1 s
  where s.account_key=p_account_key and s.marketplace_id='EBAY_US'
    and s.status='COMPLETE'
  order by s.completed_at desc limit 1;
  if not found or v_sweep.official_observed_at < v_now - interval '20 minutes'
    or v_sweep.official_observed_at > v_now + interval '1 minute'
    or v_sweep.reconciled_item_count <> v_sweep.official_live_item_count then
    raise exception 'LISTING_OWNER_CURRENT_OFFICIAL_SWEEP_REQUIRED';
  end if;
  select * into v_case from public.seller_os_listing_cases_v1 c
  where c.account_key=p_account_key and c.marketplace_id='EBAY_US'
    and c.ebay_item_id=p_ebay_item_id
    and c.last_reconciled_sweep_id=v_sweep.sweep_id
  for update;
  if not found or v_case.listing_status <> 'ACTIVE'
    or v_case.ebay_observed_at is distinct from v_sweep.official_observed_at then
    raise exception 'LISTING_OWNER_CURRENT_ACTIVE_CASE_REQUIRED';
  end if;
  select * into v_active from public.ebay_active_listings a
  where a.account_key=p_account_key and a.ebay_item_id=p_ebay_item_id
  for update;
  if not found or v_active.listing_status <> 'active'
    or v_active.last_ebay_sync_at is null
    or v_active.last_ebay_sync_at < v_now - interval '36 hours'
    or v_active.last_ebay_sync_at > v_now
    or coalesce(v_active.raw_payload->>'marketplaceId','') <> 'EBAY_US'
    or coalesce(v_active.raw_payload->>'source','') not in (
      'EBAY_TRADING_GET_MY_EBAY_SELLING', 'EBAY_TRADING_GET_ITEM_READONLY') then
    raise exception 'LISTING_OWNER_CURRENT_OFFICIAL_ITEM_REQUIRED';
  end if;

  select count(*) into v_count
  from public.market_radar_latest_variants m
  where m.source_key='lunaportex'
    and m.supplier_product_id=p_luna_product_id
    and m.supplier_variant_id=p_luna_variant_id and m.sku=p_luna_sku;
  if v_count <> 1 or exists (
    select 1 from public.market_radar_latest_variants m
    where m.source_key='lunaportex' and m.sku=p_luna_sku
      and (m.supplier_product_id is distinct from p_luna_product_id
        or m.supplier_variant_id is distinct from p_luna_variant_id)
  ) then
    raise exception 'LISTING_OWNER_CURRENT_LUNA_IDENTITY_NOT_UNIQUE';
  end if;
  select product_id into v_market_product_id
  from public.market_radar_latest_variants m
  where m.source_key='lunaportex'
    and m.supplier_product_id=p_luna_product_id
    and m.supplier_variant_id=p_luna_variant_id and m.sku=p_luna_sku;
  select snapshot.snapshot_id,snapshot.snapshot_completed_at,
    variant.preflight_status,variant.source_fingerprint
    into v_snapshot
  from public.luna_catalog_snapshots_v1 snapshot
  join public.luna_catalog_snapshot_variants_v1 variant
    on variant.snapshot_id=snapshot.snapshot_id
  where snapshot.snapshot_status='COMPLETE'
    and variant.product_id=p_luna_product_id
    and variant.variant_id=p_luna_variant_id and variant.sku=p_luna_sku
    and not exists (select 1 from public.luna_catalog_snapshots_v1 newer
      where newer.snapshot_status='COMPLETE'
        and newer.snapshot_completed_at>snapshot.snapshot_completed_at)
  limit 1;
  if not found or v_snapshot.preflight_status<>'PREFLIGHT_PASS'
    or v_snapshot.source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or v_snapshot.snapshot_completed_at < v_now - interval '6 hours' then
    raise exception 'LISTING_OWNER_CURRENT_LUNA_PREFLIGHT_REQUIRED';
  end if;
  select count(*) into v_count from public.luna_catalog_snapshot_variants_v1 variant
  where variant.snapshot_id=v_snapshot.snapshot_id and variant.sku=p_luna_sku;
  if v_count<>1 then raise exception 'LISTING_OWNER_LUNA_SKU_NOT_UNIQUE'; end if;
  if not exists (select 1 from public.ebay_luna_opportunity_queue o
    where o.id=p_opportunity_id and o.candidate_key=
      'luna-portex:'||p_luna_product_id||':'||p_luna_variant_id
      and o.market_radar_product_id=v_market_product_id
      and o.supplier_product_id=p_luna_product_id
      and o.supplier_variant_id=p_luna_variant_id and o.supplier_sku=p_luna_sku) then
    raise exception 'LISTING_OWNER_CANONICAL_OPPORTUNITY_REQUIRED';
  end if;

  if exists (select 1 from public.seller_os_luna_linkage_decisions d
    where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
      and d.ebay_item_id=p_ebay_item_id)
    or exists (select 1 from public.seller_os_listing_product_link_authorities_v1 a
      where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
        and a.lifecycle_state='ACTIVE' and a.ebay_item_id=p_ebay_item_id) then
    raise exception 'LISTING_OWNER_MANUAL_IDENTITY_TARGET_ALREADY_LINKED';
  end if;
  if exists (select 1 from public.seller_os_luna_linkage_decisions d
    where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
      and d.decision='APPROVE_EXACT_LINKAGE'
      and d.luna_product_id=p_luna_product_id
      and d.luna_variant_id=p_luna_variant_id
      and d.ebay_item_id<>p_ebay_item_id)
    or exists (select 1 from public.seller_os_listing_product_link_authorities_v1 a
      where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
        and a.lifecycle_state='ACTIVE' and a.luna_product_id=p_luna_product_id
        and a.luna_variant_id=p_luna_variant_id and a.ebay_item_id<>p_ebay_item_id) then
    raise exception 'LISTING_OWNER_MANUAL_IDENTITY_DUPLICATE_SOURCE';
  end if;

  v_evidence_at := least(p_official_observed_at,v_snapshot.snapshot_completed_at);
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_account_key,p_ebay_item_id,v_sweep.sweep_id,
      p_luna_product_id,p_luna_variant_id,p_luna_sku,p_actor_user_id)::text,
    'UTF8'),'sha256'),'hex');
  v_linkage_id := 'luna-linkage-v1:sha256:'||v_hash;
  v_review_set_id := 'luna-linkage-review-set-v1:sha256:'||v_hash;
  v_candidate_id := 'luna-linkage-review-candidate-v1:sha256:'||v_hash;
  v_decision_id := 'luna-linkage-decision-v1:sha256:'||v_hash;
  v_components := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'lunaProductId',p_luna_product_id,'lunaVariantId',p_luna_variant_id,
    'lunaSku',p_luna_sku,'productTitle',null,'variantTitle',null,
    'supplierQuantityRequired',1,'quantityBasis','OWNER_SELECTED_EXACT_IDENTITY',
    'variantPresence','PRESENT','exactProductIdentity',true,
    'exactVariantIdentity',true,'exactSupplierSku',true,
    'structuredVariantAttributesComplete',true,'identityConflict',false));
  if not public.are_seller_os_luna_linkage_components_approvable_v1(v_components) then
    raise exception 'LISTING_OWNER_COMPONENT_EVIDENCE_INVALID';
  end if;
  v_evidence_references := array[
    'luna-identity-v1:sha256:'||v_hash,
    'OFFICIAL_EBAY_GET_ITEM:'||p_ebay_item_id,
    'LUNA_CATALOG_SNAPSHOT:'||v_snapshot.snapshot_id::text,
    'LUNA_SOURCE_FINGERPRINT:'||v_snapshot.source_fingerprint,
    'OWNER_SELECTED_LUNA_IDENTITY'];
  v_lineage := pg_catalog.jsonb_build_object(
    'contractVersion','MANUAL_OWNER_LISTING_IDENTITY_V1',
    'status','CERTIFIED','mode','OWNER_SELECTED_EXACT_LUNA_IDENTITY',
    'accountKey',p_account_key,'marketplaceId','EBAY_US',
    'itemId',p_ebay_item_id,'ebayCustomLabel',p_official_custom_label,
    'productId',p_luna_product_id,'variantId',p_luna_variant_id,
    'supplierSku',p_luna_sku,'linkageId',v_linkage_id,
    'decisionReference',v_decision_id,'customLabelUsedAsIdentity',false,
    'ownerActionRequired',false);

  insert into public.seller_os_luna_linkage_review_candidates (
    review_candidate_id,review_set_id,current_cohort_id,account_key,
    account_binding,marketplace_id,ebay_item_id,ebay_sku,listing_title,
    classification,linkage_mode,linkage_id,luna_product_id,luna_variant_id,
    luna_sku,components,supplier_quantity_required,match_signals,
    conflict_signals,evidence_references,evidence_digest,evidence_observed_at,
    review_observed_at,evidence_maximum_age_seconds,
    identity_evidence_provenance,evidence_freshness,decision_version,
    approval_eligible,is_current,retired_at,contract_version
  ) values (
    v_candidate_id,v_review_set_id,'owner-listings:'||v_sweep.sweep_id::text,
    p_account_key,'CANONICAL_SELLER_ACCOUNT','EBAY_US',p_ebay_item_id,
    p_official_custom_label,p_official_title,'EXACT_UNIQUE_MATCH',
    'SINGLE_COMPONENT',v_linkage_id,p_luna_product_id,p_luna_variant_id,
    p_luna_sku,v_components,1,
    array['OFFICIAL_EBAY_OWNERSHIP_ACTIVE_EXACT','OWNER_SELECTED_LUNA_IDENTITY'],
    '{}'::text[],v_evidence_references,'sha256:'||v_hash,v_evidence_at,
    v_now,21600,v_provenance,'CURRENT',1,true,false,v_now,
    'SELLER_OS_LUNA_LINKAGE_REVIEW_V2');
  insert into public.seller_os_luna_linkage_decisions (
    decision_id,review_candidate_id,review_set_id,current_cohort_id,
    account_key,account_binding,marketplace_id,ebay_item_id,ebay_sku,
    listing_title,classification,linkage_mode,linkage_id,luna_product_id,
    luna_variant_id,luna_sku,components,supplier_quantity_required,
    evidence_references,evidence_digest,evidence_observed_at,review_observed_at,
    evidence_maximum_age_seconds,identity_evidence_provenance,evidence_freshness,
    provenance,decision,decision_version,decision_at,decision_reference,
    actor_user_id,contract_version
  ) values (
    v_decision_id,v_candidate_id,v_review_set_id,
    'owner-listings:'||v_sweep.sweep_id::text,p_account_key,
    'CANONICAL_SELLER_ACCOUNT','EBAY_US',p_ebay_item_id,p_official_custom_label,
    p_official_title,'EXACT_UNIQUE_MATCH','SINGLE_COMPONENT',v_linkage_id,
    p_luna_product_id,p_luna_variant_id,p_luna_sku,v_components,1,
    v_evidence_references,'sha256:'||v_hash,v_evidence_at,v_now,21600,
    v_provenance,'CURRENT',pg_catalog.jsonb_build_object(
      'authorityClass','HUMAN_DECISION','identityEvidenceClass','SUPPLIER_CURRENT_IDENTITY',
      'stockEvidenceUsed',false,'identityEvidenceProvenance',v_provenance,
      'customLabelUsedAsIdentity',false),
    'APPROVE_EXACT_LINKAGE',1,v_now,v_decision_id,p_actor_user_id,
    'SELLER_OS_LUNA_LINKAGE_DECISION_V1');
  update public.ebay_active_listings a set
    market_radar_product_id=v_market_product_id,
    supplier_variant_id=p_luna_variant_id,supplier_sku=p_luna_sku,
    raw_payload=coalesce(a.raw_payload,'{}'::jsonb)||
      pg_catalog.jsonb_build_object('canonicalSupplierLineage',v_lineage),
    updated_at=v_now
  where a.id=v_active.id and a.account_key=p_account_key;
  if not exists (select 1 from public.ebay_active_listings a
    where a.id=v_active.id and a.market_radar_product_id=v_market_product_id
      and a.supplier_variant_id=p_luna_variant_id and a.supplier_sku=p_luna_sku
      and a.raw_payload->'canonicalSupplierLineage'=v_lineage)
    or not exists (select 1 from public.seller_os_luna_linkage_decisions d
      where d.decision_id=v_decision_id and d.actor_user_id=p_actor_user_id
        and d.ebay_item_id=p_ebay_item_id and d.luna_product_id=p_luna_product_id
        and d.luna_variant_id=p_luna_variant_id and d.luna_sku=p_luna_sku) then
    raise exception 'LISTING_OWNER_MANUAL_IDENTITY_READBACK_FAILED';
  end if;
  return pg_catalog.jsonb_build_object('status','PROVEN',
    'decisionId',v_decision_id,'linkageId',v_linkage_id,
    'productId',p_luna_product_id,'variantId',p_luna_variant_id,
    'supplierSku',p_luna_sku,'durableReadbackMatch',true,
    'customLabelUsedAsIdentity',false,'ebayWrites',0,'inventoryWrites',0);
end;
$$;

revoke all on function public.confirm_seller_os_listing_manual_identity_v1(
  text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_seller_os_listing_manual_identity_v1(
  text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)
  to service_role;
