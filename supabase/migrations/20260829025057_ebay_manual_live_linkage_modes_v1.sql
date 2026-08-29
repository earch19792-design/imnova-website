-- Certify every owned, ACTIVE manual listing through the existing manual-link,
-- active-listing, Luna-linkage and StockGuard authorities. A durable
-- compensated publication lineage selects AUTO_LINEAGE_SUCCESSOR; otherwise
-- the same registration flow selects NET_NEW_MANUAL_LIVE. Only the former
-- retires an old publication ledger. No marketplace operation is performed.

create or replace function public.certify_ebay_manual_live_luna_linkage_v1(
  p_expected_listing_id text,
  p_active_listing_id uuid,
  p_manual_registration_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_active public.ebay_active_listings%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_old_active public.ebay_active_listings%rowtype;
  v_existing public.seller_os_luna_linkage_decisions%rowtype;
  v_product_truth jsonb;
  v_components jsonb;
  v_mode text := 'NET_NEW_MANUAL_LIVE';
  v_now timestamptz := clock_timestamp();
  v_hash text;
  v_linkage_id text;
  v_review_set_id text;
  v_review_candidate_id text;
  v_decision_id text;
  v_evidence_digest text;
  v_evidence_reference text;
  v_current_cohort_id text;
  v_lineage jsonb;
  v_expected_package_sku text;
  v_custom_label_exact boolean := false;
  v_idempotent boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_expected_listing_id !~ '^[0-9]{9,19}$'
    or p_active_listing_id is null
    or p_manual_registration_id is null
    or p_actor_user_id is null then
    raise exception 'MANUAL_LIVE_LINKAGE_INPUT_INVALID';
  end if;

  select * into v_active
  from public.ebay_active_listings active_listing
  where active_listing.id = p_active_listing_id
  for update;
  select * into v_link
  from public.ebay_manual_listing_links manual_link
  where manual_link.id = p_manual_registration_id
  for update;
  select * into v_opportunity
  from public.ebay_luna_opportunity_queue opportunity
  where opportunity.id = v_link.opportunity_id
  for key share;
  select * into v_package
  from public.ebay_listing_packages package
  where package.opportunity_id = v_opportunity.id
    and package.candidate_key = v_opportunity.candidate_key
    and package.account_key = v_link.account_key
  for key share;

  v_product_truth := v_opportunity.assessment -> 'productTruth';
  v_expected_package_sku := concat(
    'IMNOVA', upper(replace(v_package.id::text, '-', ''))
  );
  v_custom_label_exact :=
    v_active.ebay_sku = v_expected_package_sku
    or (
      v_active.raw_payload ->> 'productIdentityBinding' =
        'AUTHORITATIVE_MANUAL_HANDOFF_CUSTOM_LABEL'
      and v_active.raw_payload ->> 'observedEbaySku' = v_active.ebay_sku
      and v_active.raw_payload ->> 'canonicalPackageSku' =
        v_expected_package_sku
    );

  if v_active.id is null or v_link.id is null
    or v_opportunity.id is null or v_package.id is null
    or v_active.account_key is distinct from v_link.account_key
    or v_active.ebay_item_id is distinct from p_expected_listing_id
    or v_active.listing_status <> 'active'
    or v_active.ebay_sku is distinct from v_link.connector_ebay_sku
    or v_active.raw_payload -> 'ownershipVerified' is distinct from
      'true'::jsonb
    or v_active.raw_payload -> 'productIdentityVerified' is distinct from
      'true'::jsonb
    or v_link.ebay_item_id is distinct from p_expected_listing_id
    or v_link.marketplace_id <> 'EBAY_US'
    or v_link.verification_status <> 'verified'
    or v_link.verification_method not in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY'
    )
    or v_link.connector_listing_status <> 'active'
    or v_link.connector_listing_id is distinct from v_active.id
    or v_link.last_verification_at < v_now - interval '10 minutes'
    or v_package.account_key is distinct from v_link.account_key
    or v_package.opportunity_id is distinct from v_opportunity.id
    or v_package.candidate_key is distinct from v_opportunity.candidate_key
    or v_custom_label_exact is distinct from true
    or v_active.market_radar_product_id is distinct from
      v_opportunity.market_radar_product_id
    or v_active.supplier_variant_id is distinct from
      v_opportunity.supplier_variant_id
    or v_active.supplier_sku is distinct from v_opportunity.supplier_sku
    or v_link.market_radar_product_id is distinct from
      v_opportunity.market_radar_product_id
    or v_link.supplier_variant_id is distinct from
      v_opportunity.supplier_variant_id
    or v_link.supplier_sku is distinct from v_opportunity.supplier_sku
    or jsonb_typeof(v_product_truth) is distinct from 'object'
    or v_product_truth ->> 'evidenceDigest' !~ '^sha256:[0-9a-f]{64}$'
    or v_product_truth ->> 'candidateKey' is distinct from
      v_opportunity.candidate_key
    or v_product_truth ->> 'lunaProductId' is distinct from
      v_opportunity.supplier_product_id
    or v_product_truth ->> 'lunaVariantId' is distinct from
      v_opportunity.supplier_variant_id
    or v_product_truth ->> 'supplierSku' is distinct from
      v_opportunity.supplier_sku
    or v_product_truth ->> 'gtin' is distinct from v_opportunity.gtin
    or exists (
      select 1 from public.ebay_active_listings competing
      where competing.account_key = v_link.account_key
        and competing.listing_status = 'active'
        and competing.id is distinct from v_active.id
        and (
          competing.ebay_sku = v_active.ebay_sku
          or competing.market_radar_product_id =
            v_opportunity.market_radar_product_id
        )
    ) then
    raise exception 'MANUAL_LIVE_LINKAGE_IDENTITY_MISMATCH';
  end if;

  select publication.* into v_publication
  from public.ebay_authorized_listing_publications publication
  join public.ebay_draft_only_approvals approval
    on approval.id = publication.draft_approval_id
  join public.ebay_draft_only_execution_ledger execution
    on execution.id = publication.draft_execution_id
  where publication.actor_user_id = p_actor_user_id
    and publication.marketplace_account_key = v_link.account_key
    and publication.opportunity_id = v_opportunity.id
    and publication.listing_package_id = v_package.id
    and publication.preview ->> 'candidateKey' = v_opportunity.candidate_key
    and publication.publish_attempt_count = 0
    and publication.publish_recovery_count = 1
    and publication.listing_id is null
    and publication.active_listing_id is null
    and publication.manual_registration_id is null
    and publication.publication_idempotency_key is null
    and publication.claim_token is null
    and publication.offer_id = execution.offer_id
    and publication.draft_approval_id = approval.id
    and approval.actor_user_id = p_actor_user_id
    and approval.listing_package_id = v_package.id
    and approval.opportunity_id = v_opportunity.id
    and approval.status = 'consumed'
    and approval.revoked_at is null
    and approval.payload_hash = execution.request_hash
    and execution.approval_id = approval.id
    and execution.phase = 'completed'
    and execution.listing_package_id = v_package.id
    and execution.opportunity_id = v_opportunity.id
    and execution.offer_id = publication.offer_id
    and execution.sku = publication.sku
    and publication.sanitized_result ->> 'compensatedListingId'
      ~ '^[0-9]{9,20}$'
    and publication.sanitized_result ->> 'compensatingEndVerified' = 'true'
    and publication.sanitized_result ->> 'officialReadbackNotCurrentLive'
      = 'true'
    and (
      publication.phase = 'preview_ready'
      or (
        publication.phase = 'terminal_failure'
        and publication.last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM'
        and publication.sanitized_result ->> 'supersededByManualLiveItemId'
          = p_expected_listing_id
      )
    )
  order by publication.updated_at desc
  limit 1
  for update of publication;

  if found then
    v_mode := 'AUTO_LINEAGE_SUCCESSOR';
    select * into v_old_active
    from public.ebay_active_listings old_active
    where old_active.account_key = v_link.account_key
      and old_active.ebay_item_id =
        v_publication.sanitized_result ->> 'compensatedListingId'
      and old_active.ebay_sku = v_publication.sku
      and old_active.listing_status = 'ended'
    for update;
    if not found then
      raise exception 'MANUAL_LIVE_SUCCESSOR_PREDECESSOR_NOT_EXACT';
    end if;
  end if;

  v_components := jsonb_build_array(jsonb_build_object(
    'lunaProductId', v_opportunity.supplier_product_id,
    'lunaVariantId', v_opportunity.supplier_variant_id,
    'lunaSku', v_opportunity.supplier_sku,
    'productTitle', nullif(v_opportunity.product_title, ''),
    'variantTitle', nullif(v_opportunity.variant_title, ''),
    'supplierQuantityRequired', 1,
    'quantityBasis', 'STRUCTURED_EVIDENCE',
    'variantPresence', 'PRESENT',
    'exactProductIdentity', true,
    'exactVariantIdentity', true,
    'exactSupplierSku', true,
    'structuredVariantAttributesComplete', true,
    'identityConflict', false
  ));
  if not public.are_seller_os_luna_linkage_components_approvable_v1(
    v_components
  ) then
    raise exception 'MANUAL_LIVE_LINKAGE_COMPONENT_INVALID';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    v_link.account_key, 'EBAY_US', p_expected_listing_id,
    v_opportunity.supplier_product_id, v_opportunity.supplier_variant_id,
    v_opportunity.supplier_sku, v_link.id, v_package.id, v_mode,
    v_product_truth ->> 'evidenceDigest'
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_linkage_id := 'luna-linkage-v1:sha256:' || v_hash;
  v_review_set_id := 'luna-linkage-review-set-v1:sha256:' || v_hash;
  v_review_candidate_id :=
    'luna-linkage-review-candidate-v1:sha256:' || v_hash;
  v_decision_id := 'luna-linkage-decision-v1:sha256:' || v_hash;
  v_evidence_digest := 'sha256:' || v_hash;
  v_evidence_reference := 'luna-identity-v1:sha256:' || v_hash;
  v_current_cohort_id := 'manual-live:' || v_link.id::text;

  select * into v_existing
  from public.seller_os_luna_linkage_decisions decision_record
  where decision_record.account_key = v_link.account_key
    and decision_record.marketplace_id = 'EBAY_US'
    and decision_record.ebay_item_id = p_expected_listing_id
  order by decision_record.decision_version desc
  limit 1;
  if found and (
    v_existing.decision <> 'APPROVE_EXACT_LINKAGE'
    or v_existing.luna_product_id is distinct from
      v_opportunity.supplier_product_id
    or v_existing.luna_variant_id is distinct from
      v_opportunity.supplier_variant_id
    or v_existing.luna_sku is distinct from v_opportunity.supplier_sku
    or v_existing.components is distinct from v_components
  ) then
    raise exception 'MANUAL_LIVE_LINKAGE_EXISTING_DECISION_CONFLICT';
  end if;
  v_idempotent := found;

  if not v_idempotent then
    insert into public.seller_os_luna_linkage_review_candidates (
      review_candidate_id, review_set_id, current_cohort_id, account_key,
      account_binding, marketplace_id, ebay_item_id, ebay_sku, listing_title,
      classification, linkage_mode, linkage_id, luna_product_id,
      luna_variant_id, luna_sku, components, supplier_quantity_required,
      match_signals, conflict_signals, evidence_references, evidence_digest,
      evidence_observed_at, review_observed_at,
      evidence_maximum_age_seconds, identity_evidence_provenance,
      evidence_freshness, decision_version, approval_eligible,
      contract_version
    ) values (
      v_review_candidate_id, v_review_set_id, v_current_cohort_id,
      v_link.account_key, 'CANONICAL_SELLER_ACCOUNT', 'EBAY_US',
      p_expected_listing_id, v_active.ebay_sku,
      nullif(v_opportunity.product_title, ''), 'EXACT_UNIQUE_MATCH',
      'SINGLE_COMPONENT', v_linkage_id, v_opportunity.supplier_product_id,
      v_opportunity.supplier_variant_id, v_opportunity.supplier_sku,
      v_components, 1,
      array['OFFICIAL_EBAY_OWNERSHIP_ACTIVE_EXACT',
        'CURRENT_LUNA_IDENTITY_EXACT', v_mode], '{}'::text[],
      array[v_evidence_reference,
        'MANUAL_LISTING:' || v_link.id::text,
        'LISTING_PACKAGE:' || v_package.id::text],
      v_evidence_digest, v_now, v_now, 21600,
      jsonb_build_object(
        'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
        'sourceStatus', 'AVAILABLE',
        'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
      ), 'CURRENT', 1, true, 'SELLER_OS_LUNA_LINKAGE_REVIEW_V2'
    );

    insert into public.seller_os_luna_linkage_decisions (
      decision_id, review_candidate_id, review_set_id, current_cohort_id,
      account_key, account_binding, marketplace_id, ebay_item_id, ebay_sku,
      listing_title, classification, linkage_mode, linkage_id,
      luna_product_id, luna_variant_id, luna_sku, components,
      supplier_quantity_required, evidence_references, evidence_digest,
      evidence_observed_at, review_observed_at,
      evidence_maximum_age_seconds, identity_evidence_provenance,
      evidence_freshness, provenance, decision, decision_version,
      decision_at, decision_reference, actor_user_id, contract_version
    ) values (
      v_decision_id, v_review_candidate_id, v_review_set_id,
      v_current_cohort_id, v_link.account_key,
      'CANONICAL_SELLER_ACCOUNT', 'EBAY_US', p_expected_listing_id,
      v_active.ebay_sku, nullif(v_opportunity.product_title, ''),
      'EXACT_UNIQUE_MATCH', 'SINGLE_COMPONENT', v_linkage_id,
      v_opportunity.supplier_product_id, v_opportunity.supplier_variant_id,
      v_opportunity.supplier_sku, v_components, 1,
      array[v_evidence_reference,
        'MANUAL_LISTING:' || v_link.id::text,
        'LISTING_PACKAGE:' || v_package.id::text],
      v_evidence_digest, v_now, v_now, 21600,
      jsonb_build_object(
        'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
        'sourceStatus', 'AVAILABLE',
        'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
      ), 'CURRENT', jsonb_build_object(
        'authorityClass', 'HUMAN_DECISION',
        'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
        'stockEvidenceUsed', false,
        'identityEvidenceProvenance', jsonb_build_object(
          'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
          'sourceStatus', 'AVAILABLE',
          'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
        )
      ), 'APPROVE_EXACT_LINKAGE', 1, v_now, v_decision_id,
      p_actor_user_id, 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
    );
  else
    v_linkage_id := v_existing.linkage_id;
    v_decision_id := v_existing.decision_id;
    v_evidence_reference := coalesce(
      v_existing.evidence_references[1], v_evidence_reference
    );
  end if;

  v_lineage := jsonb_build_object(
    'contractVersion', 'SELLER_OS_MANUAL_LIVE_LINKAGE_V1',
    'status', 'CERTIFIED',
    'mode', v_mode,
    'authority', 'OFFICIAL_EBAY_AND_CURRENT_LUNA_EXACT_IDENTITY',
    'marketplaceId', 'EBAY_US',
    'accountKey', v_link.account_key,
    'itemId', p_expected_listing_id,
    'ebaySku', v_active.ebay_sku,
    'productId', v_opportunity.supplier_product_id,
    'variantId', v_opportunity.supplier_variant_id,
    'sourceSku', v_opportunity.supplier_sku,
    'gtin', v_opportunity.gtin,
    'candidateKey', v_opportunity.candidate_key,
    'opportunityId', v_opportunity.id,
    'listingPackageId', v_package.id,
    'listingPackageStatusAtLinkage', v_package.status,
    'manualRegistrationId', v_link.id,
    'publicationId', v_publication.id,
    'productTruthDigest', v_product_truth ->> 'evidenceDigest',
    'linkageId', v_linkage_id,
    'decisionReference', v_decision_id,
    'evidenceReference', v_evidence_reference,
    'handedOffAt', v_now,
    'titleInferenceUsed', false,
    'ebaySkuUsedAsSupplierIdentity', false,
    'marketplaceWrites', 0
  );

  update public.ebay_active_listings active_listing
  set raw_payload = coalesce(active_listing.raw_payload, '{}'::jsonb)
      || jsonb_build_object('canonicalSupplierLineage', v_lineage),
      updated_at = v_now
  where active_listing.id = v_active.id;

  if v_mode = 'AUTO_LINEAGE_SUCCESSOR' then
    update public.ebay_authorized_listing_publications publication
    set phase = 'terminal_failure',
        last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM',
        publication_idempotency_key = null,
        claim_token = null,
        lease_expires_at = null,
        sanitized_result = coalesce(
          publication.sanitized_result, '{}'::jsonb
        ) || jsonb_build_object(
          'lunaLinkageHandoff', v_lineage,
          'lineageDispositionContract',
            'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_V1',
          'lineageDisposition',
            'SUPERSEDED_BY_MANUAL_LIVE_ITEM_' || p_expected_listing_id,
          'supersededByManualLiveItemId', p_expected_listing_id,
          'supersededHistoricalItemId', v_old_active.ebay_item_id,
          'supersededOfferId', publication.offer_id,
          'supersededAt', v_now,
          'marketplaceWrites', 0
        ),
        updated_at = v_now
    where publication.id = v_publication.id
      and publication.phase = 'preview_ready'
      and publication.publish_attempt_count = 0
      and publication.publish_recovery_count = 1;
    if not found and not (
      v_publication.phase = 'terminal_failure'
      and v_publication.last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM'
      and v_publication.sanitized_result ->>
        'supersededByManualLiveItemId' = p_expected_listing_id
    ) then
      raise exception 'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_FAILED';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'CERTIFIED',
    'mode', v_mode,
    'itemId', p_expected_listing_id,
    'productId', v_opportunity.supplier_product_id,
    'variantId', v_opportunity.supplier_variant_id,
    'sourceSku', v_opportunity.supplier_sku,
    'linkageId', v_linkage_id,
    'decisionReference', v_decision_id,
    'legacyLineageSuperseded', v_mode = 'AUTO_LINEAGE_SUCCESSOR',
    'idempotent', v_idempotent,
    'marketplaceWrites', 0
  );
end;
$function$;

revoke all on function public.certify_ebay_manual_live_luna_linkage_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.certify_ebay_manual_live_luna_linkage_v1(
  text, uuid, uuid, uuid
) to service_role;

do $move_manual_linkage_after_exact_custom_label_binding$
declare
  v_canonical_signature regprocedure :=
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure;
  v_bound_signature regprocedure :=
    'public.register_ebay_manual_listing_link_bound_core_v2(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure;
  v_definition text;
  v_canonical_old text := $old$
    if v_manual_successor_publication_id is not null then
      perform public.handoff_ebay_authorized_publication_luna_linkage_v1(
        v_manual_successor_publication_id,
        p_ebay_item_id,
        v_link.connector_listing_id,
        v_link.id
      );
      update public.ebay_authorized_listing_publications publication
      set phase = 'terminal_failure',
          last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM',
          publication_idempotency_key = null,
          claim_token = null,
          lease_expires_at = null,
          sanitized_result = coalesce(
            publication.sanitized_result, '{}'::jsonb
          ) || jsonb_build_object(
            'lineageDispositionContract',
              'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_V1',
            'lineageDisposition',
              'SUPERSEDED_BY_MANUAL_LIVE_ITEM_' || p_ebay_item_id,
            'supersededByManualLiveItemId', p_ebay_item_id,
            'supersededHistoricalItemId',
              v_manual_successor_old_item_id,
            'supersededOfferId', publication.offer_id,
            'supersededAt', clock_timestamp(),
            'marketplaceWrites', 0
          ),
          updated_at = clock_timestamp()
      where publication.id = v_manual_successor_publication_id
        and publication.phase = 'preview_ready'
        and publication.publish_attempt_count = 0
        and publication.publish_recovery_count = 1;
      if not found then
        raise exception 'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_FAILED';
      end if;
    end if;
    return next v_link;$old$;
  v_canonical_new text := $new$
    return next v_link;$new$;
  v_bound_old text := $old$
  return next v_link;
end;$old$;
  v_bound_new text := $new$
  if p_verification_status = 'verified' then
    perform public.certify_ebay_manual_live_luna_linkage_v1(
      p_ebay_item_id,
      v_link.connector_listing_id,
      v_link.id,
      p_actor_user_id
    );
  end if;

  return next v_link;
end;$new$;
begin
  select pg_get_functiondef(v_canonical_signature)
  into strict v_definition;
  if strpos(v_definition, v_canonical_old) = 0 then
    raise exception 'MANUAL_LIVE_OLD_AUTOMATIC_HANDOFF_TARGET_MISSING';
  end if;
  execute replace(v_definition, v_canonical_old, v_canonical_new);

  select pg_get_functiondef(v_bound_signature)
  into strict v_definition;
  if strpos(v_definition,
    'certify_ebay_manual_live_luna_linkage_v1') = 0 then
    if strpos(v_definition, v_bound_old) = 0 then
      raise exception 'MANUAL_LIVE_BOUND_WRAPPER_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_bound_old, v_bound_new);
  end if;
end;
$move_manual_linkage_after_exact_custom_label_binding$;

notify pgrst, 'reload schema';
