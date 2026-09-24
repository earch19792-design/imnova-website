-- A current official eBay case plus an OWNER decision may bind one exact Luna
-- SKU without inventing a listing package. Existing decision and StockGuard
-- authority tables remain the only linkage authorities.
create function public.confirm_seller_os_listing_owner_exact_sku_v1(
  p_account_key text,
  p_ebay_item_id text,
  p_opportunity_id uuid,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_luna_sku text,
  p_official_observed_at timestamptz,
  p_official_title text,
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
  v_decision public.seller_os_luna_linkage_decisions%rowtype;
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
    'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY');
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_account_key is null or length(p_account_key) not between 3 and 200
    or p_ebay_item_id !~ '^[0-9]{9,19}$'
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
    raise exception 'LISTING_OWNER_EXACT_INPUT_INVALID';
  end if;
  if not exists (select 1 from auth.users actor where actor.id=p_actor_user_id
    and (actor.raw_app_meta_data->>'is_admin'='true'
      or actor.raw_app_meta_data->>'role'='admin')) then
    raise exception 'LISTING_OWNER_ADMIN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
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
  select count(*) into v_count from public.seller_os_listing_cases_v1 c
  where c.account_key=p_account_key and c.marketplace_id='EBAY_US'
    and c.last_reconciled_sweep_id=v_sweep.sweep_id;
  if v_count <> v_sweep.official_live_item_count then
    raise exception 'LISTING_OWNER_COMPLETE_COHORT_REQUIRED';
  end if;
  select * into v_case from public.seller_os_listing_cases_v1 c
  where c.account_key=p_account_key and c.marketplace_id='EBAY_US'
    and c.ebay_item_id=p_ebay_item_id
    and c.last_reconciled_sweep_id=v_sweep.sweep_id
  for update;
  if not found or v_case.listing_status <> 'ACTIVE'
    or v_case.identity_status <> 'MISSING_LUNA_IDENTITY'
    or v_case.ebay_custom_label is distinct from p_luna_sku
    or v_case.ebay_observed_at is distinct from v_sweep.official_observed_at then
    raise exception 'LISTING_OWNER_EXACT_CASE_REQUIRED';
  end if;
  if exists (select 1 from public.seller_os_listing_cases_v1 other
    where other.account_key=p_account_key and other.marketplace_id='EBAY_US'
      and other.last_reconciled_sweep_id=v_sweep.sweep_id
      and other.ebay_item_id<>p_ebay_item_id
      and (upper(other.ebay_custom_label)=upper(p_luna_sku)
        or (other.identity_status='LINKED_EXACT'
          and other.luna_product_id=p_luna_product_id
          and other.luna_variant_id=p_luna_variant_id)))
    or exists (select 1 from public.seller_os_listing_product_link_authorities_v1 a
      where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
        and a.lifecycle_state='ACTIVE' and a.ebay_item_id<>p_ebay_item_id
        and a.luna_product_id=p_luna_product_id
        and a.luna_variant_id=p_luna_variant_id) then
    raise exception 'LISTING_OWNER_DUPLICATE_IDENTITY_BLOCKED';
  end if;
  select snapshot.snapshot_id, snapshot.snapshot_completed_at,
    variant.preflight_status, variant.source_fingerprint
    into v_snapshot
  from public.luna_catalog_snapshots_v1 snapshot
  join public.luna_catalog_snapshot_variants_v1 variant
    on variant.snapshot_id=snapshot.snapshot_id
  where snapshot.snapshot_status='COMPLETE'
    and variant.product_id=p_luna_product_id
    and variant.variant_id=p_luna_variant_id
    and variant.sku=p_luna_sku
    and not exists (select 1 from public.luna_catalog_snapshots_v1 newer
      where newer.snapshot_status='COMPLETE'
        and newer.snapshot_completed_at>snapshot.snapshot_completed_at)
  limit 1;
  if not found or v_snapshot.preflight_status<>'PREFLIGHT_PASS'
    or v_snapshot.source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or v_snapshot.snapshot_completed_at < v_now - interval '6 hours' then
    raise exception 'LISTING_OWNER_CURRENT_LUNA_PREFLIGHT_REQUIRED';
  end if;
  select count(*) into v_count
  from public.luna_catalog_snapshot_variants_v1 variant
  where variant.snapshot_id=v_snapshot.snapshot_id and variant.sku=p_luna_sku;
  if v_count<>1 then raise exception 'LISTING_OWNER_LUNA_SKU_NOT_UNIQUE'; end if;
  select product_id into v_market_product_id
  from public.market_radar_latest_variants market
  where market.source_key='lunaportex'
    and market.supplier_product_id=p_luna_product_id
    and market.supplier_variant_id=p_luna_variant_id
    and market.sku=p_luna_sku;
  if not found or (select count(*) from public.market_radar_latest_variants market
    where market.source_key='lunaportex' and market.sku=p_luna_sku)<>1 then
    raise exception 'LISTING_OWNER_CURRENT_LUNA_IDENTITY_REQUIRED';
  end if;
  if not exists (select 1 from public.ebay_luna_opportunity_queue o
    where o.id=p_opportunity_id and o.candidate_key=
      'luna-portex:'||p_luna_product_id||':'||p_luna_variant_id
      and o.market_radar_product_id=v_market_product_id
      and o.supplier_product_id=p_luna_product_id
      and o.supplier_variant_id=p_luna_variant_id
      and o.supplier_sku=p_luna_sku) then
    raise exception 'LISTING_OWNER_CANONICAL_OPPORTUNITY_REQUIRED';
  end if;
  v_evidence_at := least(p_official_observed_at,
    v_snapshot.snapshot_completed_at);
  if v_evidence_at < v_now - interval '6 hours' then
    raise exception 'LISTING_OWNER_IDENTITY_EVIDENCE_STALE';
  end if;

  select * into v_active from public.ebay_active_listings a
  where a.ebay_item_id=p_ebay_item_id for update;
  if found and (v_active.account_key is distinct from p_account_key
    or v_active.listing_status<>'active'
    or v_active.ebay_sku is distinct from p_luna_sku
    or (v_active.market_radar_product_id is not null and
      v_active.market_radar_product_id<>v_market_product_id)
    or (v_active.supplier_variant_id is not null and
      v_active.supplier_variant_id<>p_luna_variant_id)
    or (v_active.supplier_sku is not null and
      v_active.supplier_sku<>p_luna_sku)) then
    raise exception 'LISTING_OWNER_ACTIVE_ROW_CONFLICT';
  end if;
  select * into v_decision from public.seller_os_luna_linkage_decisions d
  where d.account_key=p_account_key and d.marketplace_id='EBAY_US'
    and d.ebay_item_id=p_ebay_item_id
  order by d.decision_version desc limit 1;
  if found and (v_decision.decision<>'APPROVE_EXACT_LINKAGE'
    or v_decision.ebay_sku<>p_luna_sku
    or v_decision.luna_product_id<>p_luna_product_id
    or v_decision.luna_variant_id<>p_luna_variant_id
    or v_decision.luna_sku<>p_luna_sku) then
    raise exception 'LISTING_OWNER_PREVIOUS_DECISION_CONFLICT';
  end if;

  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_account_key,p_ebay_item_id,
      v_sweep.sweep_id,p_luna_product_id,p_luna_variant_id,p_luna_sku)::text,
    'UTF8'), 'sha256'), 'hex');
  v_linkage_id := 'luna-linkage-v1:sha256:'||v_hash;
  v_review_set_id := 'luna-linkage-review-set-v1:sha256:'||v_hash;
  v_candidate_id := 'luna-linkage-review-candidate-v1:sha256:'||v_hash;
  v_decision_id := 'luna-linkage-decision-v1:sha256:'||v_hash;
  v_components := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'lunaProductId', p_luna_product_id,
    'lunaVariantId', p_luna_variant_id,
    'lunaSku', p_luna_sku,
    'productTitle', null,
    'variantTitle', null,
    'supplierQuantityRequired', 1,
    'quantityBasis', 'STRUCTURED_EVIDENCE',
    'variantPresence', 'PRESENT',
    'exactProductIdentity', true,
    'exactVariantIdentity', true,
    'exactSupplierSku', true,
    'structuredVariantAttributesComplete', true,
    'identityConflict', false));
  if not public.are_seller_os_luna_linkage_components_approvable_v1(v_components) then
    raise exception 'LISTING_OWNER_COMPONENT_EVIDENCE_INVALID';
  end if;
  v_evidence_references := array[
    'luna-identity-v1:sha256:'||v_hash,
    'OFFICIAL_EBAY_GET_ITEM:'||p_ebay_item_id,
    'LUNA_CATALOG_SNAPSHOT:'||v_snapshot.snapshot_id::text,
    'LUNA_SOURCE_FINGERPRINT:'||v_snapshot.source_fingerprint];

  if v_decision.decision_id is null then
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
      p_luna_sku,p_official_title,'EXACT_UNIQUE_MATCH','SINGLE_COMPONENT',
      v_linkage_id,p_luna_product_id,p_luna_variant_id,p_luna_sku,v_components,
      1,array['OFFICIAL_EBAY_OWNERSHIP_ACTIVE_EXACT','OWNER_EXACT_SKU_CONFIRMATION'],
      '{}'::text[],v_evidence_references,'sha256:'||v_hash,v_evidence_at,
      v_now,21600,v_provenance,'CURRENT',1,true,false,v_now,
      'SELLER_OS_LUNA_LINKAGE_REVIEW_V2');
    insert into public.seller_os_luna_linkage_decisions (
      decision_id,review_candidate_id,review_set_id,current_cohort_id,
      account_key,account_binding,marketplace_id,ebay_item_id,ebay_sku,
      listing_title,classification,linkage_mode,linkage_id,luna_product_id,
      luna_variant_id,luna_sku,components,supplier_quantity_required,
      evidence_references,evidence_digest,evidence_observed_at,
      review_observed_at,evidence_maximum_age_seconds,
      identity_evidence_provenance,evidence_freshness,provenance,decision,
      decision_version,decision_at,decision_reference,actor_user_id,
      contract_version
    ) values (
      v_decision_id,v_candidate_id,v_review_set_id,
      'owner-listings:'||v_sweep.sweep_id::text,p_account_key,
      'CANONICAL_SELLER_ACCOUNT','EBAY_US',p_ebay_item_id,p_luna_sku,
      p_official_title,'EXACT_UNIQUE_MATCH','SINGLE_COMPONENT',v_linkage_id,
      p_luna_product_id,p_luna_variant_id,p_luna_sku,v_components,1,
      v_evidence_references,'sha256:'||v_hash,v_evidence_at,v_now,21600,
      v_provenance,'CURRENT',pg_catalog.jsonb_build_object(
        'authorityClass','HUMAN_DECISION',
        'identityEvidenceClass','SUPPLIER_CURRENT_IDENTITY',
        'stockEvidenceUsed',false,
        'identityEvidenceProvenance',v_provenance),
      'APPROVE_EXACT_LINKAGE',1,v_now,v_decision_id,p_actor_user_id,
      'SELLER_OS_LUNA_LINKAGE_DECISION_V1');
  else
    v_decision_id := v_decision.decision_id;
  end if;

  if v_active.id is null then
    insert into public.ebay_active_listings (
      ebay_item_id,listing_status,title,ebay_sku,ebay_quantity,ebay_price,
      currency,market_radar_product_id,supplier_variant_id,supplier_sku,
      last_ebay_sync_at,source,account_key,raw_payload
    ) values (
      p_ebay_item_id,'active',p_official_title,p_luna_sku,
      p_official_quantity,p_official_price,p_official_currency,
      v_market_product_id,p_luna_variant_id,p_luna_sku,p_official_observed_at,
      'EBAY_TRADING_GET_ITEM_READONLY',p_account_key,
      pg_catalog.jsonb_build_object('ownerExactLinkV1',
        pg_catalog.jsonb_build_object('decisionReference',v_decision_id,
          'catalogSnapshotId',v_snapshot.snapshot_id,
          'officialObservedAt',p_official_observed_at,
          'productId',p_luna_product_id,'variantId',p_luna_variant_id,
          'sku',p_luna_sku,'sourceFingerprint',v_snapshot.source_fingerprint)))
    returning * into v_active;
  else
    update public.ebay_active_listings a set
      title=p_official_title,ebay_quantity=p_official_quantity,
      ebay_price=p_official_price,currency=p_official_currency,
      market_radar_product_id=v_market_product_id,
      supplier_variant_id=p_luna_variant_id,supplier_sku=p_luna_sku,
      last_ebay_sync_at=p_official_observed_at,
      raw_payload=coalesce(a.raw_payload,'{}'::jsonb) ||
        pg_catalog.jsonb_build_object('ownerExactLinkV1',
          pg_catalog.jsonb_build_object('decisionReference',v_decision_id,
            'catalogSnapshotId',v_snapshot.snapshot_id,
            'officialObservedAt',p_official_observed_at,
            'productId',p_luna_product_id,'variantId',p_luna_variant_id,
            'sku',p_luna_sku,'sourceFingerprint',v_snapshot.source_fingerprint)),
      updated_at=v_now
    where a.id=v_active.id and a.account_key=p_account_key
    returning * into v_active;
  end if;
  if v_active.id is null or v_active.market_radar_product_id<>v_market_product_id
    or v_active.supplier_variant_id<>p_luna_variant_id
    or v_active.supplier_sku<>p_luna_sku then
    raise exception 'LISTING_OWNER_EXACT_LINK_READBACK_FAILED';
  end if;
  return pg_catalog.jsonb_build_object(
    'status','PROVEN','decisionId',v_decision_id,
    'activeListingId',v_active.id,'opportunityId',p_opportunity_id,
    'catalogSnapshotId',v_snapshot.snapshot_id,
    'sourceFingerprint',v_snapshot.source_fingerprint,
    'officialObservedAt',p_official_observed_at,
    'ebayWrites',0,'inventoryWrites',0);
end;
$$;

revoke all on function public.confirm_seller_os_listing_owner_exact_sku_v1(
  text,text,uuid,text,text,text,timestamptz,text,integer,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_seller_os_listing_owner_exact_sku_v1(
  text,text,uuid,text,text,text,timestamptz,text,integer,numeric,text,uuid)
  to service_role;
