-- Carry the exact Luna identity already authorized by the controlled
-- publication into the existing canonical linkage authority. This creates no
-- listing, offer, scheduler, or marketplace mutation. The append-only linkage
-- decision remains the single authority consumed by StockGuard.

create or replace function public.handoff_ebay_authorized_publication_luna_linkage_v1(
  p_publication_id uuid,
  p_expected_listing_id text,
  p_active_listing_id uuid,
  p_manual_registration_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_existing public.seller_os_luna_linkage_decisions%rowtype;
  v_authorization jsonb;
  v_stockguard jsonb;
  v_component jsonb;
  v_product_truth jsonb;
  v_now timestamptz := clock_timestamp();
  v_hash text;
  v_linkage_id text;
  v_review_set_id text;
  v_review_candidate_id text;
  v_decision_id text;
  v_evidence_digest text;
  v_evidence_reference text;
  v_current_cohort_id text;
  v_components jsonb;
  v_lineage jsonb;
  v_idempotent boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_publication_id is null
    or coalesce(p_expected_listing_id, '') !~ '^[0-9]{9,19}$'
    or p_active_listing_id is null
    or p_manual_registration_id is null then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_HANDOFF_INPUT_INVALID';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications publication
  where publication.id = p_publication_id
  for update;
  if not found
    or v_publication.phase not in (
      'published_pending_verification', 'monitor_registered'
    )
    or v_publication.listing_id is distinct from p_expected_listing_id
    or (v_publication.active_listing_id is not null and
      v_publication.active_listing_id is distinct from p_active_listing_id)
    or (v_publication.manual_registration_id is not null and
      v_publication.manual_registration_id is distinct from
        p_manual_registration_id) then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT';
  end if;

  select * into v_approval from public.ebay_draft_only_approvals approval
  where approval.id = v_publication.draft_approval_id;
  select * into v_package from public.ebay_listing_packages package
  where package.id = v_publication.listing_package_id;
  select * into v_opportunity from public.ebay_luna_opportunity_queue opportunity
  where opportunity.id = v_publication.opportunity_id;
  select * into v_active from public.ebay_active_listings active_listing
  where active_listing.id = p_active_listing_id
  for update;
  select * into v_link from public.ebay_manual_listing_links manual_link
  where manual_link.id = p_manual_registration_id;

  v_authorization := v_approval.approved_payload
    #> '{compliance,smartStockingPublicationAuthorization}';
  v_stockguard := v_approval.approved_payload
    #> '{compliance,publishWithStockguardContract}';
  v_component := v_stockguard #> '{attachmentIntent,components,0}';
  v_product_truth := v_opportunity.assessment -> 'productTruth';

  if v_approval.id is null or v_package.id is null
    or v_opportunity.id is null or v_active.id is null or v_link.id is null
    or v_approval.status <> 'consumed'
    or v_approval.actor_user_id is distinct from v_publication.actor_user_id
    or v_approval.listing_package_id is distinct from v_package.id
    or v_approval.opportunity_id is distinct from v_opportunity.id
    or v_package.status <> 'approved'
    or v_package.account_key is distinct from
      v_publication.marketplace_account_key
    or v_package.opportunity_id is distinct from v_opportunity.id
    or v_package.candidate_key is distinct from v_opportunity.candidate_key
    or v_active.account_key is distinct from
      v_publication.marketplace_account_key
    or v_active.ebay_item_id is distinct from p_expected_listing_id
    or v_active.ebay_sku is distinct from v_publication.sku
    or v_active.listing_status <> 'active'
    or v_link.account_key is distinct from
      v_publication.marketplace_account_key
    or v_link.ebay_item_id is distinct from p_expected_listing_id
    or v_link.opportunity_id is distinct from v_opportunity.id
    or v_link.candidate_key is distinct from v_opportunity.candidate_key
    or v_link.verification_status <> 'verified'
    or v_link.connector_listing_id is distinct from v_active.id
    or jsonb_typeof(v_authorization) is distinct from 'object'
    or jsonb_typeof(v_stockguard) is distinct from 'object'
    or jsonb_typeof(v_component) is distinct from 'object'
    or jsonb_typeof(v_product_truth) is distinct from 'object'
    or v_authorization ->> 'version' is distinct from
      'SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1'
    or v_authorization -> 'validated' is distinct from 'true'::jsonb
    or v_authorization ->> 'accountKey' is distinct from
      v_publication.marketplace_account_key
    or v_authorization ->> 'actorUserId' is distinct from
      v_publication.actor_user_id::text
    or v_authorization ->> 'listingPackageId' is distinct from
      v_package.id::text
    or v_authorization ->> 'opportunityId' is distinct from
      v_opportunity.id::text
    or v_authorization ->> 'candidateKey' is distinct from
      v_opportunity.candidate_key
    or v_authorization ->> 'lunaProductId' is distinct from
      v_opportunity.supplier_product_id
    or v_authorization ->> 'lunaVariantId' is distinct from
      v_opportunity.supplier_variant_id
    or v_authorization ->> 'supplierSku' is distinct from
      v_opportunity.supplier_sku
    or v_authorization ->> 'gtin' is distinct from v_opportunity.gtin
    or v_authorization ->> 'productTruthDigest' is distinct from
      v_product_truth ->> 'evidenceDigest'
    or v_authorization ->> 'authorizationDigest' !~
      '^sha256:[0-9a-f]{64}$'
    or v_authorization ->> 'sourceRevalidationAuthority' is distinct from
      'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1'
    or v_authorization -> 'finalHumanAuthorizationRequired'
      is distinct from 'true'::jsonb
    or v_authorization -> 'unattendedPublicationAllowed'
      is distinct from 'false'::jsonb
    or v_product_truth ->> 'candidateKey' is distinct from
      v_opportunity.candidate_key
    or v_product_truth ->> 'lunaProductId' is distinct from
      v_opportunity.supplier_product_id
    or v_product_truth ->> 'lunaVariantId' is distinct from
      v_opportunity.supplier_variant_id
    or v_product_truth ->> 'supplierSku' is distinct from
      v_opportunity.supplier_sku
    or v_product_truth ->> 'gtin' is distinct from v_opportunity.gtin
    or v_stockguard -> 'publishAllowed' is distinct from 'true'::jsonb
    or v_stockguard -> 'exactLunaLinkageReady' is distinct from 'true'::jsonb
    or v_stockguard -> 'stockguardReady' is distinct from 'true'::jsonb
    or v_stockguard #> '{attachmentIntent,expectedComponentCount}'
      is distinct from '1'::jsonb
    or jsonb_array_length(
      v_stockguard #> '{attachmentIntent,components}'
    ) <> 1
    or v_component ->> 'productId' is distinct from
      v_opportunity.supplier_product_id
    or v_component ->> 'variantId' is distinct from
      v_opportunity.supplier_variant_id
    or v_component ->> 'supplierSku' is distinct from
      v_opportunity.supplier_sku
    or v_component ->> 'canonicalLunaUrl' is distinct from
      v_authorization ->> 'canonicalLunaUrl'
    or v_component -> 'stockIdentityResolved' is distinct from 'true'::jsonb
    or v_component ->> 'quantityRequiredPerBundle' is distinct from '1'
    or v_active.market_radar_product_id is distinct from
      v_opportunity.market_radar_product_id
    or v_active.supplier_variant_id is distinct from
      v_opportunity.supplier_variant_id
    or v_active.supplier_sku is distinct from v_opportunity.supplier_sku
    or v_link.market_radar_product_id is distinct from
      v_opportunity.market_radar_product_id
    or v_link.supplier_variant_id is distinct from
      v_opportunity.supplier_variant_id
    or v_link.supplier_sku is distinct from v_opportunity.supplier_sku then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_IDENTITY_MISMATCH';
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
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_COMPONENT_INVALID';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    v_publication.marketplace_account_key, 'EBAY_US', p_expected_listing_id,
    v_opportunity.supplier_product_id, v_opportunity.supplier_variant_id,
    v_opportunity.supplier_sku, v_publication.id,
    v_authorization ->> 'authorizationDigest'
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_linkage_id := 'luna-linkage-v1:sha256:' || v_hash;
  v_review_set_id := 'luna-linkage-review-set-v1:sha256:' || v_hash;
  v_review_candidate_id :=
    'luna-linkage-review-candidate-v1:sha256:' || v_hash;
  v_decision_id := 'luna-linkage-decision-v1:sha256:' || v_hash;
  v_evidence_digest := 'sha256:' || v_hash;
  v_evidence_reference := 'luna-identity-v1:sha256:' || v_hash;
  v_current_cohort_id := 'post-publish:' || v_publication.id::text;

  select * into v_existing
  from public.seller_os_luna_linkage_decisions decision_record
  where decision_record.account_key = v_publication.marketplace_account_key
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
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_EXISTING_DECISION_CONFLICT';
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
      v_publication.marketplace_account_key, 'CANONICAL_SELLER_ACCOUNT',
      'EBAY_US', p_expected_listing_id, v_publication.sku,
      nullif(v_opportunity.product_title, ''), 'EXACT_UNIQUE_MATCH',
      'SINGLE_COMPONENT', v_linkage_id, v_opportunity.supplier_product_id,
      v_opportunity.supplier_variant_id, v_opportunity.supplier_sku,
      v_components, 1,
      array['DURABLE_PUBLICATION_LINEAGE_EXACT',
        'PRODUCT_TRUTH_EXACT_IDENTITY'], '{}'::text[],
      array[v_evidence_reference,
        'AUTHORIZED_PUBLICATION:' || v_publication.id::text,
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
      v_current_cohort_id, v_publication.marketplace_account_key,
      'CANONICAL_SELLER_ACCOUNT', 'EBAY_US', p_expected_listing_id,
      v_publication.sku, nullif(v_opportunity.product_title, ''),
      'EXACT_UNIQUE_MATCH', 'SINGLE_COMPONENT', v_linkage_id,
      v_opportunity.supplier_product_id, v_opportunity.supplier_variant_id,
      v_opportunity.supplier_sku, v_components, 1,
      array[v_evidence_reference,
        'AUTHORIZED_PUBLICATION:' || v_publication.id::text,
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
      v_publication.actor_user_id, 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
    );
  else
    v_linkage_id := v_existing.linkage_id;
    v_decision_id := v_existing.decision_id;
    v_evidence_reference := coalesce(v_existing.evidence_references[1],
      v_evidence_reference);
  end if;

  v_lineage := jsonb_build_object(
    'contractVersion', 'SELLER_OS_POST_PUBLISH_LUNA_LINEAGE_HANDOFF_V1',
    'status', 'CERTIFIED',
    'authority', 'DURABLE_CANDIDATE_PACKAGE_PUBLICATION_LINEAGE',
    'marketplaceId', 'EBAY_US',
    'accountKey', v_publication.marketplace_account_key,
    'itemId', p_expected_listing_id,
    'ebaySku', v_publication.sku,
    'productId', v_opportunity.supplier_product_id,
    'variantId', v_opportunity.supplier_variant_id,
    'sourceSku', v_opportunity.supplier_sku,
    'gtin', v_opportunity.gtin,
    'candidateKey', v_opportunity.candidate_key,
    'opportunityId', v_opportunity.id,
    'listingPackageId', v_package.id,
    'publicationId', v_publication.id,
    'draftApprovalId', v_publication.draft_approval_id,
    'draftExecutionId', v_publication.draft_execution_id,
    'authorizationDigest', v_authorization ->> 'authorizationDigest',
    'productTruthDigest', v_authorization ->> 'productTruthDigest',
    'linkageId', v_linkage_id,
    'decisionReference', v_decision_id,
    'evidenceReference', v_evidence_reference,
    'handedOffAt', v_now,
    'titleInferenceUsed', false,
    'ebaySkuUsedAsSupplierIdentity', false
  );

  update public.ebay_active_listings active_listing
  set raw_payload = coalesce(active_listing.raw_payload, '{}'::jsonb)
      || jsonb_build_object('canonicalSupplierLineage', v_lineage),
      updated_at = v_now
  where active_listing.id = v_active.id;

  update public.ebay_authorized_listing_publications publication
  set sanitized_result = coalesce(publication.sanitized_result, '{}'::jsonb)
      || jsonb_build_object('lunaLinkageHandoff', v_lineage),
      updated_at = v_now
  where publication.id = v_publication.id;

  return jsonb_build_object(
    'status', 'CERTIFIED',
    'itemId', p_expected_listing_id,
    'productId', v_opportunity.supplier_product_id,
    'variantId', v_opportunity.supplier_variant_id,
    'sourceSku', v_opportunity.supplier_sku,
    'gtin', v_opportunity.gtin,
    'linkageId', v_linkage_id,
    'decisionReference', v_decision_id,
    'idempotent', v_idempotent,
    'marketplaceWrites', 0
  );
end;
$function$;

revoke all on function
  public.handoff_ebay_authorized_publication_luna_linkage_v1(
    uuid, text, uuid, uuid
  )
  from public, anon, authenticated;
grant execute on function
  public.handoff_ebay_authorized_publication_luna_linkage_v1(
    uuid, text, uuid, uuid
  )
  to service_role;

comment on function
  public.handoff_ebay_authorized_publication_luna_linkage_v1(
    uuid, text, uuid, uuid
  ) is
  'Idempotently certifies exact Luna linkage from the already human-authorized candidate/package/publication lineage after ACTIVE attachment. It never infers from title or eBay SKU and performs no marketplace write.';

notify pgrst, 'reload schema';
