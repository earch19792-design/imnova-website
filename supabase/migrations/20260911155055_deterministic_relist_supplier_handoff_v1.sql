-- Reconcile a newly discovered relist only from account/exact SKU, ended
-- certified history, package and exact supplier identity. No marketplace call.
create or replace function public.resolve_relist_supplier_handoff_v1(
 p_account_key text, p_item_id text, p_apply boolean default false
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp as $function$
declare
 v_active public.ebay_active_listings%rowtype;
 v_old public.ebay_active_listings%rowtype;
 v_opportunity public.ebay_luna_opportunity_queue%rowtype;
 v_package public.ebay_listing_packages%rowtype;
 v_existing public.seller_os_luna_linkage_decisions%rowtype;
 v_link record; v_truth jsonb; v_field jsonb; v_identity jsonb; v_now timestamptz:=clock_timestamp();
 v_ids uuid[]; v_packages uuid[]; v_components jsonb; v_lineage jsonb; v_hash text;
 v_linkage_id text; v_review_set_id text; v_review_candidate_id text; v_decision_id text;
 v_evidence_digest text; v_evidence_reference text; v_current_cohort_id text;
 v_actor uuid; v_field_name text; v_expected text;
begin
 if not public.is_seller_os_service_role_request_v1() then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 if p_account_key is null or p_item_id is null or p_item_id !~ '^[0-9]{9,19}$' then raise exception 'RELIST_HANDOFF_INPUT_INVALID'; end if;
 -- Same account/SKU advisory lock serializes successor intentions as well as replays.
 select * into v_active from public.ebay_active_listings where account_key=p_account_key and ebay_item_id=p_item_id;
 if v_active.id is null then return jsonb_build_object('status','WAITING_FOR_DATA','reason','CURRENT_LISTING_MISSING','ownerActionRequired',false); end if;
 perform pg_advisory_xact_lock(hashtextextended('relist-linkage:'||p_account_key||':'||coalesce(v_active.ebay_sku,''),0));
 select * into v_active from public.ebay_active_listings where id=v_active.id for update;
 if v_active.listing_status is distinct from 'active' or nullif(v_active.ebay_sku,'') is null
 or coalesce(v_active.raw_payload->>'source','') not in ('EBAY_TRADING_GET_MY_EBAY_SELLING','EBAY_TRADING_GET_ITEM_READONLY')
 or coalesce(v_active.raw_payload->>'marketplaceId','')<>'EBAY_US'
 or v_active.last_ebay_sync_at is null or v_active.last_ebay_sync_at < v_now-interval '36 hours'
 or v_active.last_ebay_sync_at > v_now then
  return jsonb_build_object('status','WAITING_FOR_DATA','reason','CURRENT_OFFICIAL_IDENTITY_REQUIRED','ownerActionRequired',false);
 end if;
 select * into v_existing from public.seller_os_luna_linkage_decisions
 where account_key=p_account_key and marketplace_id='EBAY_US' and ebay_item_id=p_item_id order by decision_version desc limit 1;
 if v_existing.decision_id is not null then
  if v_existing.decision='APPROVE_EXACT_LINKAGE' and v_existing.ebay_sku=v_active.ebay_sku then
   return jsonb_build_object('status','CERTIFIED','linkageId',v_existing.linkage_id,'decisionId',v_existing.decision_id,
    'productId',v_existing.luna_product_id,'variantId',v_existing.luna_variant_id,'supplierSku',v_existing.luna_sku,'idempotent',true,'ownerActionRequired',false);
  end if;
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','CURRENT_LINKAGE_DECISION_CONFLICT','ownerActionRequired',true);
 end if;
 if exists(select 1 from public.ebay_active_listings where account_key=p_account_key and ebay_sku=v_active.ebay_sku and listing_status='active' and id<>v_active.id) then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','AMBIGUOUS_ACTIVE_SKU','ownerActionRequired',true);
 end if;
 -- A matching title is deliberately never read. Bound history to two rows:
 -- multiple predecessors require explicit lineage rather than choosing latest.
 select array_agg(id) into v_ids from (select id from public.ebay_active_listings
 where account_key=p_account_key and ebay_sku=v_active.ebay_sku and listing_status='ended' and id<>v_active.id limit 2) h;
 if coalesce(cardinality(v_ids),0)<>1 then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason',case when cardinality(v_ids)>1 then 'AMBIGUOUS_PREDECESSOR' else 'CERTIFIED_PREDECESSOR_MISSING' end,'ownerActionRequired',true);
 end if;
 select * into v_old from public.ebay_active_listings where id=v_ids[1] for key share;
 select array_agg(k.id) into v_packages from (select k.id from public.ebay_listing_packages k
 join public.ebay_luna_opportunity_queue o on o.id=k.opportunity_id and o.candidate_key=k.candidate_key
 where k.account_key=p_account_key and o.supplier_variant_id=v_old.supplier_variant_id
 and o.supplier_sku=v_old.supplier_sku and o.market_radar_product_id=v_old.market_radar_product_id limit 2) k;
 if coalesce(cardinality(v_packages),0)<>1 then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','EXACT_UNIQUE_PACKAGE_LINEAGE_REQUIRED','ownerActionRequired',true);
 end if;
 select * into v_package from public.ebay_listing_packages where id=v_packages[1] for key share;
 select * into v_opportunity from public.ebay_luna_opportunity_queue where id=v_package.opportunity_id for key share;
 -- Accept a prior canonical decision or the immutable official manual pilot
 -- event. The mutable manual verification row becoming ENDED is not revocation
 -- of the historical product identity.
 select d.actor_user_id,d.decision_id as reference into v_link from public.seller_os_luna_linkage_decisions d
 where d.account_key=p_account_key and d.ebay_item_id=v_old.ebay_item_id and d.marketplace_id='EBAY_US'
 and d.decision='APPROVE_EXACT_LINKAGE' and d.luna_product_id=v_opportunity.supplier_product_id
 and d.luna_variant_id=v_opportunity.supplier_variant_id and d.luna_sku=v_opportunity.supplier_sku
 and d.decision_version=(select max(d2.decision_version) from public.seller_os_luna_linkage_decisions d2 where d2.account_key=p_account_key and d2.ebay_item_id=v_old.ebay_item_id and d2.marketplace_id='EBAY_US') limit 1;
 if not found then
  select m.created_by as actor_user_id,e.id::text as reference into v_link
  from public.ebay_same_day_pilot_events e join public.ebay_same_day_pilot_candidates c on c.id=e.candidate_id
  join public.ebay_manual_listing_links m on m.id::text=e.event_payload->>'manualListingLinkId'
  where c.id::text=v_old.raw_payload#>>'{commercialMonitorRegistration,candidateId}'
  and e.event_type='MANUAL_LISTING_VERIFIED_ACTIVE_MONITOR_REGISTERED'
  and e.event_payload->>'accountKey'=p_account_key and e.event_payload->>'ebayItemId'=v_old.ebay_item_id
  and e.event_payload->>'activeListingId'=v_old.id::text and e.event_payload->>'observedEbaySku'=v_active.ebay_sku
  and e.event_payload->'verifiedActive'='true'::jsonb and e.event_payload->>'verificationMethod'='EBAY_TRADING_GET_ITEM_READONLY'
  and e.event_payload->>'handoffPackageHash'=v_old.raw_payload#>>'{commercialMonitorRegistration,handoffPackageHash}'
  and e.event_payload->>'opportunityId'=v_opportunity.id::text and e.event_payload->>'candidateKey'=v_opportunity.candidate_key
  and c.opportunity_id=v_opportunity.id and c.candidate_key=v_opportunity.candidate_key
  and c.supplier_variant_id=v_opportunity.supplier_variant_id and c.supplier_sku=v_opportunity.supplier_sku
  and m.account_key=p_account_key and m.opportunity_id=v_opportunity.id and m.ebay_item_id=v_old.ebay_item_id
  and m.supplier_variant_id=v_opportunity.supplier_variant_id and m.supplier_sku=v_opportunity.supplier_sku limit 1;
 end if;
 if v_link.reference is null then return jsonb_build_object('status','REQUIRES_ATTENTION','reason','HISTORICAL_IDENTITY_CERTIFICATION_REQUIRED','ownerActionRequired',true); end if;
 v_actor:=coalesce(v_link.actor_user_id,v_package.created_by);
 if (v_active.market_radar_product_id is not null and v_active.market_radar_product_id is distinct from v_opportunity.market_radar_product_id)
 or (v_active.supplier_variant_id is not null and v_active.supplier_variant_id is distinct from v_opportunity.supplier_variant_id)
 or (v_active.supplier_sku is not null and v_active.supplier_sku is distinct from v_opportunity.supplier_sku) then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','CURRENT_SUPPLIER_IDENTITY_CONFLICT','ownerActionRequired',true);
 end if;
 -- Require unique exact identity in the supplier catalog, not stock or title.
 if not exists(select 1 from public.market_radar_latest_variants where source_key='lunaportex'
 and supplier_product_id=v_opportunity.supplier_product_id and supplier_variant_id=v_opportunity.supplier_variant_id and sku=v_opportunity.supplier_sku)
 or exists(select 1 from public.market_radar_latest_variants where source_key='lunaportex' and sku=v_opportunity.supplier_sku
 and (supplier_product_id is distinct from v_opportunity.supplier_product_id or supplier_variant_id is distinct from v_opportunity.supplier_variant_id)) then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','SUPPLIER_IDENTITY_NOT_UNIQUE','ownerActionRequired',true);
 end if;
 v_truth:=v_opportunity.assessment#>'{productTruth,fieldTruthV1}';
 if v_truth->>'evidenceDigest' is null or v_truth->>'evidenceDigest' !~ '^sha256:[a-f0-9]{64}$'
 or jsonb_typeof(v_truth->'fields') is distinct from 'array' then
  return jsonb_build_object('status','WAITING_FOR_DATA','reason','CURRENT_PRODUCT_TRUTH_IDENTITY_REQUIRED','ownerActionRequired',false);
 end if;
 foreach v_field_name in array array['LUNA_PRODUCT_ID','LUNA_VARIANT_ID','SUPPLIER_SKU'] loop
  v_expected:=case v_field_name when 'LUNA_PRODUCT_ID' then v_opportunity.supplier_product_id when 'LUNA_VARIANT_ID' then v_opportunity.supplier_variant_id else v_opportunity.supplier_sku end;
  if (select count(*) from jsonb_array_elements(v_truth->'fields') f where f->>'FIELD'=v_field_name)<>1
  or not exists(select 1 from jsonb_array_elements(v_truth->'fields') f where f->>'FIELD'=v_field_name
   and f->>'VALUE'=v_expected and f->>'EVIDENCE_STATUS'='PROVEN' and f->>'SEMANTIC_CLASS'='FACT'
   and f->'CONTRADICTION'='false'::jsonb and f->>'SOURCE'='LUNA_EXACT_VARIANT') then
   return jsonb_build_object('status','REQUIRES_ATTENTION','reason','PRODUCT_TRUTH_IDENTITY_MISMATCH','ownerActionRequired',true);
  end if;
 end loop;
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_account_key,p_item_id,v_old.ebay_item_id,v_package.id,
  v_opportunity.supplier_product_id,v_opportunity.supplier_variant_id,v_opportunity.supplier_sku,v_link.reference)::text,'UTF8'),'sha256'),'hex');
 v_linkage_id:='luna-linkage-v1:sha256:'||v_hash;
 v_review_set_id:='luna-linkage-review-set-v1:sha256:'||v_hash;
 v_review_candidate_id:='luna-linkage-review-candidate-v1:sha256:'||v_hash;
 v_decision_id:='luna-linkage-decision-v1:sha256:'||v_hash;
 v_evidence_digest:='sha256:'||v_hash; v_evidence_reference:='luna-identity-v1:sha256:'||v_hash;
 v_current_cohort_id:='relist:'||v_active.id::text;
 v_lineage:=jsonb_build_object('contractVersion','POST_PUBLISH_SUPPLIER_LINKAGE_HANDOFF_V1','status','CERTIFIED','mode','DETERMINISTIC_RELIST',
  'accountKey',p_account_key,'marketplaceId','EBAY_US','itemId',p_item_id,'ebaySku',v_active.ebay_sku,
  'productId',v_opportunity.supplier_product_id,'variantId',v_opportunity.supplier_variant_id,'sourceSku',v_opportunity.supplier_sku,
  'listingPackageId',v_package.id,'opportunityId',v_opportunity.id,'candidateKey',v_opportunity.candidate_key,
  'supersedesItemId',v_old.ebay_item_id,'historicalEvidenceReference',v_link.reference,'productTruthDigest',v_truth->>'evidenceDigest',
  'linkageId',v_linkage_id,'decisionReference',v_decision_id,'titleInferenceUsed',false,'stockEvidenceUsed',false,
  'handoffAttempted',true,'ownerActionRequired',false);
 if p_apply is not true then return v_lineage||jsonb_build_object('status','READY_TO_BIND','idempotent',false); end if;
 v_components:=jsonb_build_array(jsonb_build_object('lunaProductId',v_opportunity.supplier_product_id,
  'lunaVariantId',v_opportunity.supplier_variant_id,'lunaSku',v_opportunity.supplier_sku,'supplierQuantityRequired',1,
  'quantityBasis','STRUCTURED_EVIDENCE','variantPresence','PRESENT','exactProductIdentity',true,
  'exactVariantIdentity',true,'exactSupplierSku',true,'structuredVariantAttributesComplete',true,'identityConflict',false));
 if not public.are_seller_os_luna_linkage_components_approvable_v1(v_components) then raise exception 'RELIST_COMPONENT_INVALID'; end if;
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
      p_account_key, 'CANONICAL_SELLER_ACCOUNT', 'EBAY_US',
      p_item_id, v_active.ebay_sku,
      nullif(v_opportunity.product_title, ''), 'EXACT_UNIQUE_MATCH',
      'SINGLE_COMPONENT', v_linkage_id, v_opportunity.supplier_product_id,
      v_opportunity.supplier_variant_id, v_opportunity.supplier_sku,
      v_components, 1,
      array['OFFICIAL_EBAY_OWNERSHIP_ACTIVE_EXACT',
        'CURRENT_LUNA_IDENTITY_EXACT', 'DETERMINISTIC_RELIST'], '{}'::text[],
      array[v_evidence_reference,
        'HISTORICAL_CERTIFICATION:' || v_link.reference,
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
      v_current_cohort_id, p_account_key,
      'CANONICAL_SELLER_ACCOUNT', 'EBAY_US', p_item_id,
      v_active.ebay_sku, nullif(v_opportunity.product_title, ''),
      'EXACT_UNIQUE_MATCH', 'SINGLE_COMPONENT', v_linkage_id,
      v_opportunity.supplier_product_id, v_opportunity.supplier_variant_id,
      v_opportunity.supplier_sku, v_components, 1,
      array[v_evidence_reference,
        'HISTORICAL_CERTIFICATION:' || v_link.reference,
        'LISTING_PACKAGE:' || v_package.id::text],
      v_evidence_digest, v_now, v_now, 21600,
      jsonb_build_object(
        'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
        'sourceStatus', 'AVAILABLE',
        'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
      ), 'CURRENT', jsonb_build_object(
        'authorityClass', 'DETERMINISTIC_EXACT_IDENTITY',
        'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
        'stockEvidenceUsed', false,
        'identityEvidenceProvenance', jsonb_build_object(
          'contractVersion', 'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1',
          'sourceStatus', 'AVAILABLE',
          'acquisitionMethod', 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
        )
      ), 'APPROVE_EXACT_LINKAGE', 1, v_now, v_decision_id,
      null, 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
    );

 update public.ebay_active_listings set market_radar_product_id=v_opportunity.market_radar_product_id,
 supplier_variant_id=v_opportunity.supplier_variant_id,supplier_sku=v_opportunity.supplier_sku,
 raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('canonicalSupplierLineage',v_lineage),updated_at=v_now
 where id=v_active.id and account_key=p_account_key and ebay_item_id=p_item_id;
 if not exists(select 1 from public.seller_os_luna_linkage_decisions d join public.ebay_active_listings a on a.id=v_active.id
 where d.decision_id=v_decision_id and d.ebay_item_id=a.ebay_item_id and d.account_key=a.account_key
 and d.luna_variant_id=a.supplier_variant_id and d.luna_sku=a.supplier_sku and a.raw_payload->'canonicalSupplierLineage'=v_lineage) then
 raise exception 'RELIST_DURABLE_READBACK_MISMATCH'; end if;
 return v_lineage||jsonb_build_object('durableReadbackMatch',true,'idempotent',false);
end;
$function$;
revoke all on function public.resolve_relist_supplier_handoff_v1(text,text,boolean) from public,anon,authenticated;
grant execute on function public.resolve_relist_supplier_handoff_v1(text,text,boolean) to service_role;

-- CURRENT publication completion cannot precede its supplier handoff. Existing
-- historical executions are preserved; no previously published row is rewritten.
do $guard_current_completion$
declare d text; anchor text := '  select * into v_approval
  from public.ebay_draft_only_approvals';
begin
 select pg_get_functiondef('public.complete_ebay_authorized_listing_monitor_registration(uuid,uuid,text,uuid,uuid)'::regprocedure) into d;
 if strpos(d,'CURRENT_POST_PUBLISH_SUPPLIER_HANDOFF_REQUIRED')=0 then
  if strpos(d,anchor)=0 then raise exception 'CURRENT_COMPLETION_PATCH_TARGET_MISSING'; end if;
  d:=replace(d,anchor,$guard$
  if v_publication.sanitized_result#>>'{publicationPreparationV1,current,version}'='SELLER_OS_PACKAGE_PREVIEW_REVISION_V1' and not exists (
   select 1 from public.seller_os_luna_linkage_decisions l
   where l.account_key=v_publication.marketplace_account_key and l.marketplace_id='EBAY_US'
   and l.ebay_item_id=p_listing_id and l.ebay_sku=v_publication.sku and l.decision='APPROVE_EXACT_LINKAGE'
   and l.luna_product_id=v_publication.sanitized_result#>>'{publicationPreparationV1,current,snapshot,binding,PRODUCT_ID}'
   and l.luna_variant_id=v_publication.sanitized_result#>>'{publicationPreparationV1,current,snapshot,binding,VARIANT_ID}'
   and l.luna_sku=v_publication.sanitized_result#>>'{publicationPreparationV1,current,snapshot,binding,SKU}'
   and l.decision_version=(select max(c.decision_version) from public.seller_os_luna_linkage_decisions c
    where c.account_key=l.account_key and c.marketplace_id=l.marketplace_id and c.ebay_item_id=l.ebay_item_id)
   and v_active.supplier_variant_id=l.luna_variant_id and v_active.supplier_sku=l.luna_sku
   and v_active.raw_payload#>>'{canonicalSupplierLineage,status}'='CERTIFIED'
  ) then raise exception 'CURRENT_POST_PUBLISH_SUPPLIER_HANDOFF_REQUIRED'; end if;
$guard$||anchor);
  execute d;
 end if;
end;
$guard_current_completion$;
