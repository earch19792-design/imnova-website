-- A human administrator may resolve an unmanaged active listing by selecting
-- one existing, latest, exact Luna certification. The database still proves
-- official target freshness, current supplier identity, source decision
-- authority and durable readback. Titles and images are never match inputs.
create or replace function public.resolve_manual_existing_certified_identity_v1(
  p_account_key text,
  p_item_id text,
  p_source_decision_id text,
  p_actor_user_id uuid,
  p_observed_ebay_sku text,
  p_observed_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_target public.ebay_active_listings%rowtype;
  v_source public.seller_os_luna_linkage_decisions%rowtype;
  v_existing public.seller_os_luna_linkage_decisions%rowtype;
  v_market_product_id uuid;
  v_identity_count integer;
  v_now timestamptz := clock_timestamp();
  v_hash text;
  v_linkage_id text;
  v_review_set_id text;
  v_review_candidate_id text;
  v_decision_id text;
  v_evidence_digest text;
  v_evidence_reference text;
  v_cohort_id text;
  v_identity_provenance jsonb;
  v_lineage jsonb;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'MANUAL_LISTING_SERVICE_ROLE_REQUIRED';
  end if;
  if p_account_key is null or p_item_id !~ '^[0-9]{9,19}$'
    or p_source_decision_id !~
      '^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$'
    or p_actor_user_id is null or nullif(p_observed_ebay_sku, '') is null
    or p_observed_at is null or p_observed_at > v_now + interval '1 minute'
    or p_observed_at < v_now - interval '15 minutes' then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'manual-certified-identity:' || p_account_key || ':' || p_item_id, 0
  ));
  select * into v_target
  from public.ebay_active_listings
  where account_key = p_account_key and ebay_item_id = p_item_id
  for update;
  if v_target.id is null then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_NOT_FOUND';
  end if;
  if v_target.listing_status is distinct from 'active'
    or v_target.last_ebay_sync_at is null
    or v_target.last_ebay_sync_at < v_now - interval '36 hours'
    or v_target.last_ebay_sync_at > v_now
    or coalesce(v_target.raw_payload ->> 'source', '') not in (
      'EBAY_TRADING_GET_MY_EBAY_SELLING', 'EBAY_TRADING_GET_ITEM_READONLY'
    )
    or coalesce(v_target.raw_payload ->> 'marketplaceId', '') <> 'EBAY_US' then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_NOT_CURRENT';
  end if;
  if v_target.ebay_sku is distinct from p_observed_ebay_sku then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_SKU_MISMATCH';
  end if;

  select * into v_existing
  from public.seller_os_luna_linkage_decisions
  where account_key = p_account_key and marketplace_id = 'EBAY_US'
    and ebay_item_id = p_item_id
  order by decision_version desc
  limit 1;
  if v_existing.decision_id is not null then
    if v_existing.decision = 'APPROVE_EXACT_LINKAGE'
      and ('CERTIFIED_IDENTITY_SOURCE:' || p_source_decision_id) = any(
        v_existing.evidence_references
      ) then
      return jsonb_build_object(
        'status', 'CERTIFIED', 'idempotent', true,
        'decisionId', v_existing.decision_id,
        'linkageId', v_existing.linkage_id,
        'productId', v_existing.luna_product_id,
        'variantId', v_existing.luna_variant_id,
        'supplierSku', v_existing.luna_sku,
        'titleInferenceUsed', false, 'marketplaceWrites', 0
      );
    end if;
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_CONFLICT';
  end if;

  select * into v_source
  from public.seller_os_luna_linkage_decisions
  where decision_id = p_source_decision_id
    and account_key = p_account_key and marketplace_id = 'EBAY_US';
  if v_source.decision_id is null then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_NOT_FOUND';
  end if;
  if v_source.ebay_item_id = p_item_id
    or v_source.decision <> 'APPROVE_EXACT_LINKAGE'
    or v_source.classification <> 'EXACT_UNIQUE_MATCH'
    or v_source.linkage_mode <> 'SINGLE_COMPONENT'
    or jsonb_array_length(v_source.components) <> 1
    or v_source.supplier_quantity_required <> 1
    or v_source.luna_product_id is null
    or v_source.luna_variant_id is null
    or v_source.luna_sku is null
    or v_source.decision_version <> (
      select max(current_source.decision_version)
      from public.seller_os_luna_linkage_decisions current_source
      where current_source.account_key = p_account_key
        and current_source.marketplace_id = 'EBAY_US'
        and current_source.ebay_item_id = v_source.ebay_item_id
    )
    or not public.are_seller_os_luna_linkage_components_approvable_v1(
      v_source.components
    ) then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_INVALID';
  end if;

  select count(*) into v_identity_count
  from public.market_radar_latest_variants
  where source_key = 'lunaportex'
    and supplier_product_id = v_source.luna_product_id
    and supplier_variant_id = v_source.luna_variant_id
    and sku = v_source.luna_sku;
  if v_identity_count <> 1 or exists (
    select 1 from public.market_radar_latest_variants other
    where other.source_key = 'lunaportex' and other.sku = v_source.luna_sku
      and (other.supplier_product_id is distinct from v_source.luna_product_id
        or other.supplier_variant_id is distinct from v_source.luna_variant_id)
  ) then
    raise exception 'MANUAL_LISTING_CURRENT_LUNA_IDENTITY_NOT_UNIQUE';
  end if;
  select product_id into v_market_product_id
  from public.market_radar_latest_variants
  where source_key = 'lunaportex'
    and supplier_product_id = v_source.luna_product_id
    and supplier_variant_id = v_source.luna_variant_id
    and sku = v_source.luna_sku;

  if exists (
    select 1 from public.seller_os_luna_linkage_review_candidates candidate
    where candidate.account_key = p_account_key
      and candidate.marketplace_id = 'EBAY_US'
      and candidate.ebay_item_id = p_item_id and candidate.is_current
  ) then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_CONFLICT';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    p_account_key, p_item_id, p_source_decision_id,
    v_source.luna_product_id, v_source.luna_variant_id, v_source.luna_sku
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_linkage_id := 'luna-linkage-v1:sha256:' || v_hash;
  v_review_set_id := 'luna-linkage-review-set-v1:sha256:' || v_hash;
  v_review_candidate_id :=
    'luna-linkage-review-candidate-v1:sha256:' || v_hash;
  v_decision_id := 'luna-linkage-decision-v1:sha256:' || v_hash;
  v_evidence_digest := 'sha256:' || v_hash;
  v_evidence_reference := 'luna-identity-v1:sha256:' || v_hash;
  v_cohort_id := 'manual-existing-certified:' || v_target.id::text;
  v_identity_provenance := jsonb_build_object(
    'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
    'sourceStatus', 'AVAILABLE',
    'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
  );
  v_lineage := jsonb_build_object(
    'contractVersion',
      'MANUAL_EXISTING_CERTIFIED_IDENTITY_RESOLUTION_V1',
    'status', 'CERTIFIED',
    'mode', 'MANUAL_EXISTING_CERTIFIED_IDENTITY',
    'accountKey', p_account_key, 'marketplaceId', 'EBAY_US',
    'itemId', p_item_id, 'ebaySku', v_target.ebay_sku,
    'productId', v_source.luna_product_id,
    'variantId', v_source.luna_variant_id,
    'sourceSku', v_source.luna_sku,
    'manualSourceItemId', v_source.ebay_item_id,
    'manualSourceDecisionId', p_source_decision_id,
    'linkageId', v_linkage_id, 'decisionReference', v_decision_id,
    'titleInferenceUsed', false, 'stockEvidenceUsed', false,
    'ownerActionRequired', false
  );

  insert into public.seller_os_luna_linkage_review_candidates (
    review_candidate_id, review_set_id, current_cohort_id, account_key,
    account_binding, marketplace_id, ebay_item_id, ebay_sku, listing_title,
    classification, linkage_mode, linkage_id, luna_product_id,
    luna_variant_id, luna_sku, components, supplier_quantity_required,
    match_signals, conflict_signals, evidence_references, evidence_digest,
    evidence_observed_at, review_observed_at, evidence_maximum_age_seconds,
    identity_evidence_provenance, evidence_freshness, decision_version,
    approval_eligible, is_current, retired_at, contract_version
  ) values (
    v_review_candidate_id, v_review_set_id, v_cohort_id, p_account_key,
    'CANONICAL_SELLER_ACCOUNT', 'EBAY_US', p_item_id, v_target.ebay_sku,
    nullif(v_target.title, ''), 'EXACT_UNIQUE_MATCH', 'SINGLE_COMPONENT',
    v_linkage_id, v_source.luna_product_id, v_source.luna_variant_id,
    v_source.luna_sku, v_source.components, 1,
    array['OFFICIAL_EBAY_OWNERSHIP_ACTIVE_EXACT',
      'HUMAN_SELECTED_EXISTING_CERTIFIED_IDENTITY'], '{}'::text[],
    array[v_evidence_reference,
      'CERTIFIED_IDENTITY_SOURCE:' || p_source_decision_id,
      'OFFICIAL_EBAY_GET_ITEM:' || p_item_id],
    v_evidence_digest, p_observed_at, v_now, 21600,
    v_identity_provenance, 'CURRENT', 1, true, false, v_now,
    'SELLER_OS_LUNA_LINKAGE_REVIEW_V2'
  );

  insert into public.seller_os_luna_linkage_decisions (
    decision_id, review_candidate_id, review_set_id, current_cohort_id,
    account_key, account_binding, marketplace_id, ebay_item_id, ebay_sku,
    listing_title, classification, linkage_mode, linkage_id,
    luna_product_id, luna_variant_id, luna_sku, components,
    supplier_quantity_required, evidence_references, evidence_digest,
    evidence_observed_at, review_observed_at, evidence_maximum_age_seconds,
    identity_evidence_provenance, evidence_freshness, provenance, decision,
    decision_version, decision_at, decision_reference, actor_user_id,
    contract_version
  ) values (
    v_decision_id, v_review_candidate_id, v_review_set_id, v_cohort_id,
    p_account_key, 'CANONICAL_SELLER_ACCOUNT', 'EBAY_US', p_item_id,
    v_target.ebay_sku, nullif(v_target.title, ''), 'EXACT_UNIQUE_MATCH',
    'SINGLE_COMPONENT', v_linkage_id, v_source.luna_product_id,
    v_source.luna_variant_id, v_source.luna_sku, v_source.components, 1,
    array[v_evidence_reference,
      'CERTIFIED_IDENTITY_SOURCE:' || p_source_decision_id,
      'OFFICIAL_EBAY_GET_ITEM:' || p_item_id],
    v_evidence_digest, p_observed_at, v_now, 21600,
    v_identity_provenance, 'CURRENT', jsonb_build_object(
      'authorityClass', 'HUMAN_DECISION',
      'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
      'stockEvidenceUsed', false,
      'identityEvidenceProvenance', v_identity_provenance
    ), 'APPROVE_EXACT_LINKAGE', 1, v_now, v_decision_id,
    p_actor_user_id, 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
  );

  update public.ebay_active_listings
  set market_radar_product_id = v_market_product_id,
    supplier_variant_id = v_source.luna_variant_id,
    supplier_sku = v_source.luna_sku,
    raw_payload = coalesce(raw_payload, '{}'::jsonb) ||
      jsonb_build_object('canonicalSupplierLineage', v_lineage),
    updated_at = v_now
  where id = v_target.id and account_key = p_account_key
    and ebay_item_id = p_item_id;

  if not exists (
    select 1
    from public.seller_os_luna_linkage_decisions decision
    join public.ebay_active_listings active on active.id = v_target.id
    where decision.decision_id = v_decision_id
      and decision.ebay_item_id = active.ebay_item_id
      and decision.account_key = active.account_key
      and decision.luna_variant_id = active.supplier_variant_id
      and decision.luna_sku = active.supplier_sku
      and active.raw_payload -> 'canonicalSupplierLineage' = v_lineage
  ) then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_WRITE_FAILED';
  end if;

  return jsonb_build_object(
    'status', 'CERTIFIED', 'idempotent', false,
    'decisionId', v_decision_id, 'linkageId', v_linkage_id,
    'productId', v_source.luna_product_id,
    'variantId', v_source.luna_variant_id,
    'supplierSku', v_source.luna_sku,
    'sourceItemId', v_source.ebay_item_id,
    'titleInferenceUsed', false, 'marketplaceWrites', 0,
    'durableReadbackMatch', true
  );
end;
$function$;

revoke all on function public.resolve_manual_existing_certified_identity_v1(
  text, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.resolve_manual_existing_certified_identity_v1(
  text, text, text, uuid, text, timestamptz
) to service_role;

comment on function public.resolve_manual_existing_certified_identity_v1(
  text, text, text, uuid, text, timestamptz
) is 'Human-confirmed linkage of an official active eBay Item ID to one existing latest exact Luna certification; no title inference or marketplace write.';
