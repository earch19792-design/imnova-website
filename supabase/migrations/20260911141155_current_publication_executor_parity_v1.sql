-- CURRENT content is immutable by binding, not by the age of its Preview.
-- Operational evidence still expires. Gate and atomic claim share this reader.
create or replace function public.read_current_publication_execution_contract_v1(
 p_publication_id uuid,p_actor_user_id uuid,p_account_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.ebay_authorized_listing_publications%rowtype;
 e public.ebay_draft_only_execution_ledger%rowtype;
 a public.ebay_draft_only_approvals%rowtype;
 k public.ebay_listing_packages%rowtype;
 o public.ebay_luna_opportunity_queue%rowtype;
 r jsonb; x jsonb; b jsonb; urls jsonb; binding jsonb; errors text[]:='{}';
begin
 if not public.is_seller_os_service_role_request_v1() then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 select * into p from public.ebay_authorized_listing_publications where id=p_publication_id;
 if p.id is null or p.actor_user_id is distinct from p_actor_user_id or p.marketplace_account_key is distinct from p_account_key then
  return jsonb_build_object('valid',false,'blockers',jsonb_build_array('CURRENT_PUBLICATION_IDENTITY_MISMATCH'));
 end if;
 r:=p.sanitized_result#>'{publicationPreparationV1,current}';
 x:=p.sanitized_result#>'{publicationPreparationV1,activation}';b:=r#>'{snapshot,binding}';
 select * into e from public.ebay_draft_only_execution_ledger where id=p.draft_execution_id;
 select * into a from public.ebay_draft_only_approvals where id=p.draft_approval_id;
 select * into k from public.ebay_listing_packages where id=p.listing_package_id;
 select * into o from public.ebay_luna_opportunity_queue where id=p.opportunity_id;
 if r is null or e.id is null or a.id is null or k.id is null or o.id is null then errors:=array_append(errors,'CURRENT_EXECUTION_AUTHORITY_MISSING'); end if;
 if coalesce(r->>'version','')<>'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1'
 or r->>'publicationId' is distinct from p.id::text or r->>'packageId' is distinct from k.id::text
 or r->>'accountKey' is distinct from p.marketplace_account_key
 or b->>'PRODUCT_ID' is distinct from o.supplier_product_id or b->>'VARIANT_ID' is distinct from o.supplier_variant_id
 or b->>'SKU' is distinct from o.supplier_sku or b->>'OPPORTUNITY_ID' is distinct from o.id::text
 or b->>'CANDIDATE_KEY' is distinct from o.candidate_key or k.candidate_key is distinct from o.candidate_key
 or k.account_key is distinct from p.marketplace_account_key or k.created_by is distinct from p.actor_user_id
 or k.status is distinct from 'approved' or r#>>'{snapshot,generation}' is distinct from r->>'packageGeneration'
 or r->>'previewHash' is distinct from 'sha256:'||p.preview_hash
 or r->'preview' is distinct from p.preview
 or p.preview#>>'{offerPayload,sku}' is distinct from p.sku
 or p.preview->>'accountFingerprint' is distinct from p.account_fingerprint
 then errors:=array_append(errors,'CURRENT_EXECUTION_MATERIAL_BINDING_MISMATCH'); end if;
 if x->>'version' is distinct from 'CURRENT_PREPARATION_ACTIVATION_V1'
 or x->>'publicationId' is distinct from p.id::text or x->>'draftExecutionId' is distinct from e.id::text
 or x->>'draftApprovalId' is distinct from a.id::text or x->>'previewHash' is distinct from p.preview_hash
 or x->>'packageHash' is distinct from r->>'packageHash' or x->>'packageGeneration' is distinct from r->>'packageGeneration'
 or x->'historicalExecutionReused' is distinct from 'false'::jsonb
 or e.id::text=r->>'priorDraftExecutionId' or e.approval_id is distinct from a.id
 or e.phase is distinct from 'completed' or e.offer_id is distinct from p.offer_id or e.sku is distinct from p.sku
 or e.opportunity_id is distinct from p.opportunity_id or a.opportunity_id is distinct from p.opportunity_id
 or p.target is distinct from e.target
 or e.actor_user_id is distinct from p.actor_user_id or e.listing_package_id is distinct from k.id
 or e.account_fingerprint is distinct from p.account_fingerprint or e.target is distinct from 'PRODUCTION'
 or a.actor_user_id is distinct from p.actor_user_id or a.listing_package_id is distinct from k.id
 or a.status is distinct from 'consumed' or a.consumed_at is null or a.payload_hash is distinct from e.request_hash
 or a.approval_phrase_version is distinct from 'CURRENT_PREPARATION_RECONCILIATION_V1'
 or a.approved_payload->'inventoryItemPayload' is distinct from p.preview->'inventoryItemPayload'
 or a.approved_payload->'offerPayload' is distinct from p.preview->'offerPayload'
 or a.approved_payload#>'{economics,historicalStateInherited}' is distinct from 'false'::jsonb
 then errors:=array_append(errors,'CURRENT_EXECUTION_HISTORICAL_OR_PAYLOAD_MISMATCH'); end if;
 if public.assess_publication_revision_images_v1(p.id,p.actor_user_id,p.marketplace_account_key)->>'pass' is distinct from 'true' then
  errors:=array_append(errors,'CURRENT_EXECUTION_IMAGE_AUTHORITY_UNPROVEN'); end if;
 select jsonb_agg(product_url) into urls from (select product_url from public.market_radar_latest_variants
 where source_key='lunaportex' and supplier_product_id=o.supplier_product_id and supplier_variant_id=o.supplier_variant_id
 and sku=o.supplier_sku limit 2) exact_catalog;
 if jsonb_array_length(coalesce(urls,'[]'))<>1 or coalesce(urls->>0,'')!~'^https://(www\.)?lunaportex\.com/products/[A-Za-z0-9%._~-]+$'
 then errors:=array_append(errors,'CURRENT_EXECUTION_CANONICAL_LINKAGE_UNPROVEN'); end if;
 if exists(select 1 from public.ebay_active_listings l where l.account_key=p.marketplace_account_key
   and l.listing_status='active' and (l.ebay_sku=p.sku or (l.market_radar_product_id=o.market_radar_product_id and l.supplier_variant_id=o.supplier_variant_id))
   and l.ebay_item_id is distinct from p.listing_id) or exists(select 1 from public.ebay_authorized_listing_publications other
   where other.marketplace_account_key=p.marketplace_account_key and other.id<>p.id
   and (other.sku=p.sku or other.opportunity_id=p.opportunity_id) and other.phase in ('publish_in_flight','outcome_unknown','published_pending_verification','monitor_registered'))
 then errors:=array_append(errors,'CURRENT_PUBLICATION_DUPLICATE_IDENTITY_CONFLICT'); end if;
 binding:=jsonb_build_object('publicationId',p.id,'packageId',k.id,'accountKey',p.marketplace_account_key,
 'sku',p.sku,'offerId',p.offer_id,'draftExecutionId',e.id,'draftApprovalId',a.id,
 'packageHash',r->>'packageHash','packageGeneration',r->>'packageGeneration','previewHash',r->>'previewHash',
 'previewGeneration',r->>'packageGeneration','productId',o.supplier_product_id,'variantId',o.supplier_variant_id,
 'supplierSku',o.supplier_sku,'opportunityId',o.id,'candidateKey',o.candidate_key,
 'productTruthDigest',o.assessment#>>'{productTruth,evidenceDigest}','canonicalLunaUrl',urls->>0,'gtin',o.gtin);
 return jsonb_build_object('version','CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1','valid',cardinality(errors)=0,
 'binding',binding,'blockers',to_jsonb(errors),'phase',p.phase,'publishAttemptCount',p.publish_attempt_count,
 'unclaimed',p.phase='preview_ready' and p.publish_attempt_count=0 and p.publication_idempotency_key is null and p.claim_token is null and p.listing_id is null);
end;$$;
revoke all on function public.read_current_publication_execution_contract_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_current_publication_execution_contract_v1(uuid,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.claim_ebay_authorized_listing_publication(p_publication_id uuid, p_actor_user_id uuid, p_idempotency_key text, p_preview_hash text, p_confirm_publish text, p_claim_token uuid)
 RETURNS SETOF ebay_authorized_listing_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_contract jsonb; v_proof jsonb; v_binding jsonb; v_checks jsonb;
begin
  if p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$'
    or p_preview_hash !~ '^[0-9a-f]{64}$'
    or p_claim_token is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_CONFIRMATION_INVALID';
  end if;
  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.preview_hash is distinct from p_preview_hash then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_NOT_CLAIMABLE';
  end if;
  if v_publication.publication_idempotency_key is not null then
    if v_publication.publication_idempotency_key is distinct from p_idempotency_key then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_publication;
    return;
  end if;

  perform public.assert_ebay_authorized_publication_image_set_high_quality(
    v_publication.id,
    p_actor_user_id,
    v_publication.marketplace_account_key
  );

  if v_publication.sanitized_result#>'{publicationPreparationV1,current}' is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_publication.marketplace_account_key||':'||
      coalesce(v_publication.sanitized_result#>>'{publicationPreparationV1,current,productId}','')||':'||
      coalesce(v_publication.sanitized_result#>>'{publicationPreparationV1,current,variantId}',''),0));
    v_contract:=public.read_current_publication_execution_contract_v1(p_publication_id,p_actor_user_id,v_publication.marketplace_account_key);
    v_proof:=v_publication.sanitized_result#>'{publicationPreparationV1,prepublicationEvidenceV1}';
    v_binding:=v_contract->'binding';v_checks:=v_proof->'checks';
    if v_contract->'valid' is distinct from 'true'::jsonb or v_contract->'unclaimed' is distinct from 'true'::jsonb
      or v_proof->>'version' is distinct from 'SELLER_OS_PREPUBLICATION_ATTAINABLE_EVIDENCE_V1'
      or (v_proof->>'observedAt')::timestamptz>clock_timestamp()
      or (v_proof->>'observedAt')::timestamptz<=clock_timestamp()-interval '10 minutes'
      or v_proof->>'observedAt' is null
      or v_proof#>>'{executionReadiness,validUntil}' is null
      or (v_proof#>>'{executionReadiness,validUntil}')::timestamptz<=clock_timestamp()
      or v_proof#>'{executionReadiness,ready}' is distinct from 'true'::jsonb
      or v_proof#>'{executionReadiness,contractBinding}' is distinct from v_binding
      or v_proof#>'{executionReadiness,stockguard,publishAllowed}' is distinct from 'true'::jsonb
      or v_proof->'blockingErrors' is distinct from '[]'::jsonb
      or exists(select 1 from jsonb_array_elements(coalesce(v_proof->'warnings','[]')) w where w->>'classification' is distinct from 'NON_BLOCKING')
      or not coalesce(v_checks @> '{"currentOfferReadbackPass":true,"currentInventoryReadbackPass":true,"currentPolicyReadbackPass":true,"currentFeesRequestPass":true,"prepublicationContractValidationPass":true,"currentTaxonomyPass":true,"currentAccountPass":true,"currentImageAuthorityPass":true}',false)
      or exists(select 1 from jsonb_each(v_proof->'binding') kv where kv.value is distinct from v_binding->kv.key)
    then raise exception 'CURRENT_EXECUTOR_NOT_CLAIMABLE'; end if;
  elsif v_publication.preview_prepared_at < clock_timestamp()-interval '15 minutes' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_NOT_CLAIMABLE';
  end if;
  if v_publication.phase <> 'preview_ready' 
    or v_publication.publish_attempt_count <> 0 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_NOT_CLAIMABLE';
  end if;
  update public.ebay_authorized_listing_publications
  set phase = 'publish_in_flight',
      publication_idempotency_key = p_idempotency_key,
      publish_attempt_count = 1,
      claim_token = p_claim_token,
      lease_expires_at = clock_timestamp() + interval '2 minutes',
      publish_started_at = clock_timestamp(),
      last_error_code = null,
      sanitized_result = case when v_contract is not null then v_publication.sanitized_result || jsonb_build_object(
        'currentPublicationExecutionV1',jsonb_build_object('version','CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1',
        'binding',v_binding,'stockguard',v_proof#>'{executionReadiness,stockguard}',
        'ownerAuthorization',jsonb_build_object('actor',p_actor_user_id,'confirmation',p_confirm_publish,'idempotencyKey',p_idempotency_key),
        'state','PUBLISH_REQUESTED','transitions',jsonb_build_array('PUBLISH_REQUESTED'),'claimedAt',clock_timestamp(),'prepublicationEvidence',v_proof))
        else v_publication.sanitized_result end,
      updated_at = clock_timestamp()
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$function$;



CREATE OR REPLACE FUNCTION public.handoff_ebay_authorized_publication_luna_linkage_v1(p_publication_id uuid, p_expected_listing_id text, p_active_listing_id uuid, p_manual_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_existing public.seller_os_luna_linkage_decisions%rowtype;
  v_authorization jsonb;
  v_current jsonb; v_current_binding jsonb; v_current_authorized boolean:=false;
  v_quick_pick_authorization boolean := false;
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
  v_manual_live_successor boolean := false;
  v_compensated_active public.ebay_active_listings%rowtype;
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
  if not found then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT';
  end if;
  v_manual_live_successor :=
    v_publication.phase = 'preview_ready'
    and v_publication.listing_id is null
    and v_publication.active_listing_id is null
    and v_publication.manual_registration_id is null
    and v_publication.publication_idempotency_key is null
    and v_publication.claim_token is null
    and v_publication.publish_attempt_count = 0
    and v_publication.publish_recovery_count = 1
    and v_publication.sanitized_result->>'compensatedListingId'
      ~ '^[0-9]{9,20}$'
    and v_publication.sanitized_result->>'compensatingEndVerified' = 'true'
    and v_publication.sanitized_result->>'officialReadbackNotCurrentLive'
      = 'true';
  if (
    not v_manual_live_successor and (
      v_publication.phase not in (
        'published_pending_verification', 'monitor_registered'
      )
      or v_publication.listing_id is distinct from p_expected_listing_id
      or (v_publication.active_listing_id is not null and
        v_publication.active_listing_id is distinct from p_active_listing_id)
      or (v_publication.manual_registration_id is not null and
        v_publication.manual_registration_id is distinct from
          p_manual_registration_id)
    )
  ) then
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

  v_quick_pick_authorization := jsonb_typeof(
    v_approval.approved_payload
      #> '{compliance,quickPickPublicationAuthorization}'
  ) = 'object';
  v_authorization := case when v_quick_pick_authorization then
    v_approval.approved_payload
      #> '{compliance,quickPickPublicationAuthorization}'
  else
    v_approval.approved_payload
      #> '{compliance,smartStockingPublicationAuthorization}'
  end;
  v_stockguard := v_approval.approved_payload
    #> '{compliance,publishWithStockguardContract}';
  v_current:=v_publication.sanitized_result->'currentPublicationExecutionV1';
  v_current_binding:=v_current->'binding';
  v_current_authorized:=v_current->>'version'='CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1'
    and v_current_binding->>'publicationId'=v_publication.id::text
    and v_current_binding->>'draftExecutionId'=v_publication.draft_execution_id::text
    and v_current_binding->>'draftApprovalId'=v_publication.draft_approval_id::text
    and v_current_binding->>'previewHash'='sha256:'||v_publication.preview_hash
    and v_current#>>'{ownerAuthorization,actor}'=v_publication.actor_user_id::text
    and v_current#>>'{ownerAuthorization,confirmation}'='PUBLICAR LISTING EN EBAY'
    and v_current#>>'{ownerAuthorization,idempotencyKey}'=v_publication.publication_idempotency_key;
  if v_current_authorized then
    v_stockguard:=v_current->'stockguard';
    v_authorization:=v_current_binding || jsonb_build_object('authorizationDigest',
      'sha256:'||encode(extensions.digest(convert_to(v_current::text,'UTF8'),'sha256'),'hex'));
    if v_current_binding->>'productId' is distinct from v_opportunity.supplier_product_id
      or v_current_binding->>'variantId' is distinct from v_opportunity.supplier_variant_id
      or v_current_binding->>'supplierSku' is distinct from v_opportunity.supplier_sku
      or v_current_binding->>'productTruthDigest' is distinct from v_opportunity.assessment#>>'{productTruth,evidenceDigest}'
      or v_current_binding->>'packageId' is distinct from v_package.id::text
      or v_current_binding->>'accountKey' is distinct from v_publication.marketplace_account_key
      or v_current_binding->>'sku' is distinct from v_publication.sku
      or v_current_binding->>'offerId' is distinct from v_publication.offer_id
    then raise exception 'CURRENT_POST_PUBLISH_LINEAGE_MISMATCH'; end if;
  end if;
  v_component := v_stockguard #> '{attachmentIntent,components,0}';
  v_product_truth := v_opportunity.assessment -> 'productTruth';

  if v_manual_live_successor then
    select * into v_compensated_active
    from public.ebay_active_listings active_listing
    where active_listing.account_key =
        v_publication.marketplace_account_key
      and active_listing.ebay_item_id =
        v_publication.sanitized_result->>'compensatedListingId'
      and active_listing.ebay_sku = v_publication.sku
      and active_listing.listing_status = 'ended'
    for update;
    if not found or exists (
      select 1 from public.ebay_active_listings competing
      where competing.account_key = v_publication.marketplace_account_key
        and competing.listing_status = 'active'
        and competing.id is distinct from p_active_listing_id
        and (
          competing.ebay_sku = v_publication.sku
          or competing.market_radar_product_id =
            v_opportunity.market_radar_product_id
        )
    ) then
      raise exception 'MANUAL_LIVE_SUCCESSOR_DUPLICATE_OR_HISTORY_MISMATCH';
    end if;
  end if;

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
    or (not v_manual_live_successor and
      v_active.ebay_sku is distinct from v_publication.sku)
    or v_active.listing_status <> 'active'
    or v_link.account_key is distinct from
      v_publication.marketplace_account_key
    or v_link.ebay_item_id is distinct from p_expected_listing_id
    or v_link.opportunity_id is distinct from v_opportunity.id
    or v_link.candidate_key is distinct from v_opportunity.candidate_key
    or v_link.verification_status <> 'verified'
    or v_link.connector_listing_id is distinct from v_active.id

    or (not coalesce(v_current_authorized,false) and (
      (v_quick_pick_authorization and not
      public.is_ebay_quick_pick_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        v_publication.actor_user_id,
        v_publication.marketplace_account_key
      ))
    or jsonb_typeof(v_authorization) is distinct from 'object'
    or jsonb_typeof(v_stockguard) is distinct from 'object'
    or jsonb_typeof(v_component) is distinct from 'object'
    or jsonb_typeof(v_product_truth) is distinct from 'object'
    or (
      v_quick_pick_authorization
      and v_authorization ->> 'version' is distinct from
        'SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1'
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'version' is distinct from
        'SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1'
    )
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
    or (
      v_quick_pick_authorization
      and coalesce(v_authorization ->> 'gtin', '') is distinct from
        coalesce(v_opportunity.gtin, '')
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'gtin' is distinct from v_opportunity.gtin
    )
    or v_authorization ->> 'productTruthDigest' is distinct from
      v_product_truth ->> 'evidenceDigest'
    or v_authorization ->> 'authorizationDigest' !~
      '^sha256:[0-9a-f]{64}$'
    or (
      v_quick_pick_authorization
      and v_authorization ->> 'sourceRevalidationAuthority' is distinct from
        'QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1'
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'sourceRevalidationAuthority' is distinct from
        'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1'
    )
    or v_authorization -> 'finalHumanAuthorizationRequired'
      is distinct from 'true'::jsonb
    or v_authorization -> 'unattendedPublicationAllowed'
      is distinct from 'false'::jsonb
    ))
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
    'ebaySkuUsedAsSupplierIdentity', false,
    'handoffMode', case when v_manual_live_successor
      then 'MANUAL_LIVE_SUCCESSOR'
      else 'CONTROLLED_PUBLICATION' end,
    'supersedesItemId', case when v_manual_live_successor
      then v_publication.sanitized_result->>'compensatedListingId'
      else null end
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



CREATE OR REPLACE FUNCTION public.complete_ebay_authorized_listing_monitor_registration(p_publication_id uuid, p_actor_user_id uuid, p_listing_id text, p_active_listing_id uuid, p_manual_registration_id uuid)
 RETURNS SETOF ebay_authorized_listing_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_batch_child public.seller_os_publisher_batch_children_v1%rowtype;
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_verified integer;
  v_ready integer;
  v_batch_authorized boolean := false;
  v_batch_child_id uuid;
  v_quick_pick jsonb;
begin
  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase not in (
      'published_pending_verification', 'monitor_registered')
    or v_publication.listing_id is distinct from p_listing_id then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_MONITOR_NOT_COMPLETABLE';
  end if;
  if v_publication.phase = 'monitor_registered' then
    return next v_publication;
    return;
  end if;
  select * into v_active
  from public.ebay_active_listings
  where id = p_active_listing_id
    and account_key = v_publication.marketplace_account_key
    and ebay_item_id = p_listing_id
    and listing_status = 'active'
    and ebay_sku = v_publication.sku
  for key share;
  select * into v_link
  from public.ebay_manual_listing_links
  where id = p_manual_registration_id
    and account_key = v_publication.marketplace_account_key
    and ebay_item_id = p_listing_id
    and opportunity_id = v_publication.opportunity_id
    and candidate_key = v_publication.preview->>'candidateKey'
    and verification_status = 'verified'
    and connector_listing_id = p_active_listing_id
  for key share;
  if v_active.id is null or v_link.id is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_publication.draft_approval_id
  for key share;
  if found and v_approval.approval_idempotency_key ~
      '^batch-approval:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_quick_pick := v_approval.approved_payload #>
      '{compliance,quickPickPublicationAuthorization}';
    v_batch_child_id := substring(v_approval.approval_idempotency_key
      from 16)::uuid;
    select * into v_batch_child
    from public.seller_os_publisher_batch_children_v1
    where id = v_batch_child_id
    for key share;
    if found then
      select * into v_batch
      from public.seller_os_publisher_batch_authorizations_v1
      where id = v_batch_child.batch_authorization_id
      for key share;
      v_batch_authorized := found
        and v_quick_pick->>'commercialAuthorizationAuthority' =
          'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1'
        and v_batch.status in (
          'AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
        and v_batch.marketplace_account_key =
          v_publication.marketplace_account_key
        and v_batch.actor_user_id = p_actor_user_id
        and v_batch_child.package_id = v_publication.listing_package_id
        and v_batch_child.candidate_id =
          v_publication.preview->>'candidateKey'
        and v_batch_child.package_digest =
          v_quick_pick->>'packageDigest'
        and v_batch_child.authorization_binding->>'imagesDigest' =
          v_quick_pick->>'authorizedImagesDigest'
        and v_quick_pick->>'batchAuthorizationId' = v_batch.id::text
        and v_quick_pick->>'batchAuthorizationDigest' =
          v_batch.authorization_digest;
    end if;
  end if;

  update public.ebay_authorized_listing_publications
  set phase = 'monitor_registered',
      active_listing_id = p_active_listing_id,
      manual_registration_id = p_manual_registration_id,
      verified_active_at = v_link.verified_at,
      monitor_registered_at = v_now,
      last_error_code = null,
      sanitized_result = (case when sanitized_result->'currentPublicationExecutionV1' is not null then
        jsonb_set(jsonb_set(sanitized_result,'{currentPublicationExecutionV1,state}','"PUBLISHED_CONFIRMED"'),
        '{currentPublicationExecutionV1,transitions}',coalesce(sanitized_result#>'{currentPublicationExecutionV1,transitions}','[]')||'"PUBLISHED_CONFIRMED"')
        else sanitized_result end) || jsonb_build_object(
        'activeListingId', p_active_listing_id,
        'manualRegistrationId', p_manual_registration_id,
        'activeVerified', true,
        'monitorRegistered', true
      ),
      updated_at = v_now
  where id = p_publication_id
  returning * into v_publication;

  if v_publication.sanitized_result#>>'{currentPublicationExecutionV1,version}'='CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1' then
    if v_publication.sanitized_result#>>'{currentPublicationExecutionV1,binding,publicationId}' is distinct from v_publication.id::text
      or v_publication.sanitized_result#>>'{currentPublicationExecutionV1,binding,previewHash}' is distinct from 'sha256:'||v_publication.preview_hash
      or v_publication.sanitized_result#>'{currentPublicationExecutionV1,stockguard,publishAllowed}' is distinct from 'true'::jsonb
      or v_publication.sanitized_result#>'{currentPublicationExecutionV1,readback,pass}' is distinct from 'true'::jsonb
      or v_publication.sanitized_result#>>'{currentPublicationExecutionV1,readback,listingId}' is distinct from p_listing_id
      or v_publication.sanitized_result#>'{currentPublicationExecutionV1,readback,binding}' is distinct from v_publication.sanitized_result#>'{currentPublicationExecutionV1,binding}'
      or v_publication.sanitized_result#>>'{lunaLinkageHandoff,status}' is distinct from 'CERTIFIED'
    then raise exception 'CURRENT_PUBLICATION_MONITOR_AUTHORITY_REQUIRED'; end if;
    return next v_publication; return;
  end if;
  if v_batch_authorized then
    return next v_publication;
    return;
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.opportunity_id = v_publication.opportunity_id
    and candidate.candidate_key = v_publication.preview->>'candidateKey'
    and run.marketplace_account_key = v_publication.marketplace_account_key
  order by candidate.updated_at desc
  limit 1
  for update of candidate;
  if not found then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED';
  end if;

  insert into public.ebay_same_day_pilot_transitions (
    run_id, candidate_id, previous_state, next_state, reason_code,
    triggered_by, started_at, completed_at, attempt, checkpoint,
    evidence_hash, idempotency_key, next_automatic_action, next_human_action
  ) values (
    v_candidate.run_id, v_candidate.id, v_candidate.machine_state,
    'VERIFIED_ACTIVE', 'AUTOMATED_PUBLISH_ACTIVE_AND_MONITOR_REGISTERED',
    'SYSTEM', coalesce(v_publication.publish_started_at, v_now), v_now, 1,
    jsonb_build_object(
      'publicationId', v_publication.id,
      'offerId', v_publication.offer_id,
      'listingId', p_listing_id,
      'activeListingId', p_active_listing_id,
      'monitorRegisteredAt', v_now
    ),
    encode(digest(convert_to(concat(
      v_publication.id::text, ':', p_listing_id, ':',
      p_active_listing_id::text
    ), 'UTF8'), 'sha256'), 'hex'),
    concat('auto-publish-monitor:', v_publication.id::text),
    'Monitorear desempeño comercial y disponibilidad Luna.',
    'Ninguna acción inmediata.'
  ) on conflict (idempotency_key) do nothing;

  update public.ebay_same_day_pilot_candidates
  set state = 'VERIFIED_ACTIVE',
      machine_state = 'VERIFIED_ACTIVE',
      blockers = '{}',
      evidence_summary = coalesce(evidence_summary, '{}'::jsonb) ||
        jsonb_build_object(
          'automatedPublicationId', v_publication.id,
          'ebayItemId', p_listing_id,
          'activeListingId', p_active_listing_id,
          'activeVerifiedAt', v_link.verified_at,
          'commercialMonitorRegisteredAt', v_now
        ),
      next_automated_action =
        'Monitorear desempeño comercial y disponibilidad Luna.',
      next_human_action = 'Ninguna acción inmediata.',
      updated_at = v_now
  where id = v_candidate.id;

  update public.ebay_same_day_pilot_human_tasks
  set status = 'COMPLETED',
      completed_at = coalesce(completed_at, v_now),
      updated_at = v_now
  where candidate_id = v_candidate.id
    and status = 'OPEN'
    and gate_type in ('MANUAL_PUBLICATION_REQUIRED', 'ITEM_ID_REQUIRED');

  select least(2, count(*) filter (where state = 'VERIFIED_ACTIVE')),
         least(2, count(*) filter (
           where state = 'READY_FOR_MANUAL_PUBLICATION'))
  into v_verified, v_ready
  from public.ebay_same_day_pilot_candidates
  where run_id = v_candidate.run_id;

  update public.ebay_same_day_pilot_runs
  set verified_new_listings = v_verified,
      ready_for_manual_publication_count = v_ready,
      status = case when v_verified >= target_new_listings
        then 'COMPLETED' else 'PARTIALLY_READY' end,
      stage = case when v_verified >= target_new_listings
        then 'PILOT_COMPLETED' else 'PUBLICATION_MONITORING' end,
      monitor_snapshot = coalesce(monitor_snapshot, '{}'::jsonb) ||
        jsonb_build_object(
          'lastRegisteredListingId', p_listing_id,
          'lastRegisteredAt', v_now,
          'activeListingId', p_active_listing_id
        ),
      next_automated_action =
        'Continuar monitoreo comercial de listings ACTIVE.',
      next_human_action = case when v_verified >= target_new_listings
        then 'Ninguna acción inmediata.'
        else 'Revisar el siguiente preview final listo.' end,
      updated_at = v_now
  where id = v_candidate.run_id;

  return next v_publication;
end;
$function$;



CREATE OR REPLACE FUNCTION public.record_ebay_authorized_listing_published(p_publication_id uuid, p_actor_user_id uuid, p_listing_id text, p_http_status integer, p_reconciled boolean)
 RETURNS SETOF ebay_authorized_listing_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
begin
  if p_listing_id !~ '^[0-9]{9,20}$' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_LISTING_ID_INVALID';
  end if;
  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase not in (
      'publish_in_flight', 'outcome_unknown',
      'published_pending_verification', 'monitor_registered'
    )
    or (v_publication.listing_id is not null
      and v_publication.listing_id is distinct from p_listing_id) then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_RESULT_INVALID';
  end if;
  if v_publication.phase in ('published_pending_verification', 'monitor_registered') then
    return next v_publication;
    return;
  end if;
  update public.ebay_authorized_listing_publications
  set phase = 'published_pending_verification',
      listing_id = p_listing_id,
      publish_http_status = p_http_status,
      publish_reconciled = coalesce(p_reconciled, false),
      published_at = clock_timestamp(),
      claim_token = null,
      lease_expires_at = null,
      last_error_code = null,
      sanitized_result = (case when sanitized_result->'currentPublicationExecutionV1' is not null then
        jsonb_set(jsonb_set(sanitized_result,'{currentPublicationExecutionV1,state}','"READBACK_REQUIRED"'),
        '{currentPublicationExecutionV1,transitions}',coalesce(sanitized_result#>'{currentPublicationExecutionV1,transitions}','[]')||'"READBACK_REQUIRED"')
        else sanitized_result end) || jsonb_build_object(
        'listingId', p_listing_id,
        'publishReconciled', coalesce(p_reconciled, false)
      ),
      updated_at = clock_timestamp()
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$function$;

-- Release only a claim owned by this invocation before dispatch. Transport
-- instrumentation, not an eBay timeout, supplies this internal authority.
create or replace function public.release_current_publication_before_dispatch_v1(p_publication_id uuid,p_actor uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_seller_os_service_role_request_v1() then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 update public.ebay_authorized_listing_publications set phase='preview_ready',publication_idempotency_key=null,
  publish_attempt_count=0,claim_token=null,lease_expires_at=null,publish_started_at=null,
  last_error_code='CURRENT_PREWRITE_TRANSPORT_OR_GUARD_FAILURE',
  sanitized_result=jsonb_set(sanitized_result,'{currentPublicationExecutionV1,state}','"PREWRITE_ABORTED"'),updated_at=clock_timestamp()
 where id=p_publication_id and actor_user_id=p_actor and phase='publish_in_flight' and claim_token=p_claim_token and listing_id is null
 and sanitized_result#>>'{currentPublicationExecutionV1,state}'='PUBLISH_REQUESTED';
 return found;
end;$$;
revoke all on function public.release_current_publication_before_dispatch_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_current_publication_before_dispatch_v1(uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.fail_ebay_authorized_listing_publication(p_publication_id uuid, p_actor_user_id uuid, p_claim_token uuid, p_http_status integer, p_error_code text, p_outcome_unknown boolean, p_error_details jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(p_error_code, '') !~ '^[A-Z0-9_]{3,120}$'
    or jsonb_typeof(coalesce(p_error_details, '{}'::jsonb)) <> 'object' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_ERROR_INVALID';
  end if;
  update public.ebay_authorized_listing_publications
  set phase = case
        when p_outcome_unknown then 'outcome_unknown'
        else 'terminal_failure'
      end,
      publish_http_status = p_http_status,
      last_error_code = p_error_code,
      sanitized_result = (case when sanitized_result->'currentPublicationExecutionV1' is not null then
        jsonb_set(jsonb_set(sanitized_result,'{currentPublicationExecutionV1,state}',
          to_jsonb(case when p_outcome_unknown then 'UNKNOWN_COMMIT_STATE' else 'PUBLISH_REJECTED' end)),
          '{currentPublicationExecutionV1,transitions}',coalesce(sanitized_result#>'{currentPublicationExecutionV1,transitions}','[]')||
          to_jsonb(case when p_outcome_unknown then 'UNKNOWN_COMMIT_STATE' else 'PUBLISH_REJECTED' end))
        else '{}'::jsonb end) || jsonb_build_object(
        'httpStatus', p_http_status,
        'errorCode', p_error_code,
        'details', coalesce(p_error_details, '{}'::jsonb)
      ),
      claim_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_publication_id
    and actor_user_id = p_actor_user_id
    and phase = 'publish_in_flight'
    and claim_token = p_claim_token;
  return found;
end;
$function$;
