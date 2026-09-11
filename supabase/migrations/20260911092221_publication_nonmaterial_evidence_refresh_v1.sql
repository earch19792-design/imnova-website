-- Read-only assessment of the current certified revision. Does not authorize a
-- publication or replace the publisher's approval, execution, and readback gates.
create or replace function public.assess_publication_revision_images_v1(
 p_publication_id uuid,p_actor uuid,p_account_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pub record; pkg record; op record;
 r jsonb; b jsonb; imgs jsonb; own_set jsonb; facts jsonb; fact jsonb; valid boolean;
begin
 select id,listing_package_id,opportunity_id,sanitized_result into pub from public.ebay_authorized_listing_publications
 where id=p_publication_id and actor_user_id=p_actor and marketplace_account_key=p_account_key;
 if not found then return jsonb_build_object('pass',false,'reason','PUBLICATION_IDENTITY_REQUIRED');end if;
 select id,status,opportunity_id,candidate_key into pkg from public.ebay_listing_packages where id=pub.listing_package_id and account_key=p_account_key and created_by=p_actor;
 select id,supplier_product_id,supplier_variant_id,supplier_sku,candidate_key,assessment into op from public.ebay_luna_opportunity_queue where id=pkg.opportunity_id and candidate_key=pkg.candidate_key;
 r:=pub.sanitized_result#>'{publicationPreparationV1,current}';b:=r#>'{snapshot,binding}';
 imgs:=r#>'{snapshot,content,imageUrls}';
 own_set:=op.assessment#>'{canonicalMarketplaceReadinessV1,requiredItemSpecificsTruth,lunaExactProductEvidenceSetV1}';
 select coalesce(jsonb_agg(f),'[]') into facts from jsonb_array_elements(
   coalesce(op.assessment#>'{productTruth,fieldTruthV1,fields}','[]')) f where f->>'FIELD'='IMAGES';
 fact:=facts->0;
 valid:=coalesce(pkg.status='approved' and op.id=pub.opportunity_id and jsonb_array_length(facts)=1
  and r->>'version'='SELLER_OS_PACKAGE_PREVIEW_REVISION_V1' and r->>'publicationId'=pub.id::text
  and r->>'packageId'=pkg.id::text and r->>'accountKey'=p_account_key
  and b->>'ACCOUNT_KEY'=p_account_key and b->>'PRODUCT_ID'=op.supplier_product_id
  and b->>'VARIANT_ID'=op.supplier_variant_id and b->>'SKU'=op.supplier_sku
  and b->>'CANDIDATE_KEY'=op.candidate_key and b->>'OPPORTUNITY_ID'=op.id::text
  and r->>'packageHash' ~ '^sha256:[a-f0-9]{64}$'
  and r->>'packageGeneration'=r#>>'{certifiedPackage,listingPackage,generation}'
  and r#>'{snapshot,content}'=r#>'{certifiedPackage,listingPackage,content}'
  and r#>>'{certifiedPackage,imageHandoffPass}'='true'
  and r#>>'{certifiedPackage,competitorContaminationCount}'='0'
  and r#>>'{certifiedPackage,unsupportedClaimCount}'='0'
  and fact->>'EVIDENCE_STATUS'='PROVEN' and fact->>'SEMANTIC_CLASS'='FACT' and fact->>'CONTRADICTION'='false'
  and nullif(fact->>'EVIDENCE_ID','') is not null
  and fact->>'SOURCE_AUTHORITY' in ('SUPPLIER','OWNER')
  and coalesce(fact->>'OBSERVED_AT',fact->>'CAPTURED_AT')::timestamptz <= now()
  and (nullif(fact->>'FRESH_UNTIL','') is null or (fact->>'FRESH_UNTIL')::timestamptz > now())
  -- A new capture receipt is not a new gallery. Compare ordered image values,
  -- retaining ordinal, variant association and any content identity/hash.
  and (select jsonb_agg(x-'CAPTURED_AT' order by ord)
       from jsonb_array_elements(r#>'{certifiedPackage,sourceProvenance,images,images}') with ordinality z(x,ord))
      =(select jsonb_agg(x-'CAPTURED_AT' order by ord)
       from jsonb_array_elements(fact->'VALUE') with ordinality z(x,ord))
  and own_set->>'lunaProductId'=op.supplier_product_id and own_set->>'lunaVariantId'=op.supplier_variant_id
  and own_set->>'supplierSku'=op.supplier_sku and own_set->>'productIdentityExact'='true'
  and own_set->>'exactSupplierLineageCertified'='true' and own_set->>'allExactProductImagesReviewed'='true'
  and r#>>'{certifiedPackage,sourceProvenance,images,ownImageSetDigest}'=own_set->>'imageSetDigest'
  and public.publication_revision_content_matches_v1(r,r->'preview'),false);
 if not valid or jsonb_typeof(imgs) is distinct from 'array' then
  return jsonb_build_object('pass',false,'reason','CURRENT_REVISION_IMAGE_AUTHORITY_UNPROVEN');end if;
 -- This branch preserves the complete already-certified supplier gallery. It
 -- does not add an image-count policy or permit arbitrary generated assets.
 valid:=jsonb_array_length(imgs)>0 and imgs=own_set->'exactImageUrls'
  and jsonb_array_length(imgs)=(select count(distinct x) from jsonb_array_elements_text(imgs) x)
  and not exists(select 1 from jsonb_array_elements_text(imgs) x where x !~ '^https://' or not exists(
   select 1 from jsonb_array_elements(fact->'VALUE') f where f->>'SOURCE_IMAGE_URL'=x));
 return jsonb_build_object('pass',valid,'reason',case when valid then 'CURRENT_CERTIFIED_FULL_SOURCE_GALLERY' else 'CURRENT_GALLERY_PROVENANCE_MISMATCH' end,
  'contractVersion','SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1',
  'currentViolationProven',not valid,'imageSetDigest',own_set->>'imageSetDigest',
  'packageHash',r->>'packageHash','generation',r->>'packageGeneration','imageCount',jsonb_array_length(imgs),
  'publicationAuthorized',false,'marketplaceWrites',0);
end $$;
revoke all on function public.assess_publication_revision_images_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.assess_publication_revision_images_v1(uuid,uuid,text) to service_role;


-- Audit resolution only; it conveys no authorization and cannot claim a publish.
create or replace function public.record_publication_publisher_resolution_v1(
 p_publication_id uuid,p_actor uuid,p_account_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p record; a jsonb; r jsonb; existing jsonb; result jsonb;
begin
 select id,listing_package_id,opportunity_id,sanitized_result,publish_attempt_count,claim_token,listing_id
 into p from public.ebay_authorized_listing_publications
 where id=p_publication_id and actor_user_id=p_actor and marketplace_account_key=p_account_key for update;
 if not found or p.publish_attempt_count<>0 or p.claim_token is not null or p.listing_id is not null then
  raise exception 'PUBLICATION_RESOLUTION_IDENTITY_OR_STATE_INVALID';end if;
 r:=p.sanitized_result#>'{publicationPreparationV1,current}';
 a:=public.assess_publication_revision_images_v1(p_publication_id,p_actor,p_account_key);
 if a->>'pass' is distinct from 'true' or a->>'contractVersion'<>'SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1' then
  raise exception 'CURRENT_PUBLISHER_RESOLUTION_UNPROVEN';end if;
 result:=jsonb_build_object('issueSignature','EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED',
  'publisherContract','SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1','resolution','SUPERSEDED',
  'resolutionBasis','CURRENT_CERTIFIED_FULL_SOURCE_GALLERY','publicationId',p.id,'packageId',p.listing_package_id,
  'imageSetDigest',a->>'imageSetDigest','publicationAuthorized',false);
 existing:=p.sanitized_result#>'{publicationPreparationV1,publisherResolutionV1}';
 if existing-'recordedAt'=result then return existing;end if;
 if existing is not null then raise exception 'PUBLISHER_RESOLUTION_MATERIAL_CHANGE_REQUIRES_NEW_REVIEW';end if;
 result:=result||jsonb_build_object('recordedAt',now());
 update public.ebay_authorized_listing_publications set sanitized_result=jsonb_set(sanitized_result,
   '{publicationPreparationV1,publisherResolutionV1}',result,true) where id=p.id;
 return result;
end $$;
revoke all on function public.record_publication_publisher_resolution_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_publication_publisher_resolution_v1(uuid,uuid,text) to service_role;
