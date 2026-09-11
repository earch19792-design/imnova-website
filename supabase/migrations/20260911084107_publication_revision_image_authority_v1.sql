-- Read-only assessment of the current certified revision. Does not authorize a
-- publication or replace the publisher's approval, execution, and readback gates.
create or replace function public.assess_publication_revision_images_v1(
 p_publication_id uuid,p_actor uuid,p_account_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pub public.ebay_authorized_listing_publications%rowtype;
 pkg public.ebay_listing_packages%rowtype; op public.ebay_luna_opportunity_queue%rowtype;
 r jsonb; b jsonb; imgs jsonb; own_set jsonb; facts jsonb; fact jsonb; valid boolean;
begin
 select * into pub from public.ebay_authorized_listing_publications
 where id=p_publication_id and actor_user_id=p_actor and marketplace_account_key=p_account_key;
 if not found then return jsonb_build_object('pass',false,'reason','PUBLICATION_IDENTITY_REQUIRED');end if;
 select * into pkg from public.ebay_listing_packages where id=pub.listing_package_id and account_key=p_account_key and created_by=p_actor;
 select * into op from public.ebay_luna_opportunity_queue where id=pkg.opportunity_id and candidate_key=pkg.candidate_key;
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
  and r#>>'{certifiedPackage,sourceProvenance,images,evidenceId}'=fact->>'EVIDENCE_ID'
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
  'packageHash',r->>'packageHash','generation',r->>'packageGeneration','imageCount',jsonb_array_length(imgs),
  'publicationAuthorized',false,'marketplaceWrites',0);
end $$;
revoke all on function public.assess_publication_revision_images_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.assess_publication_revision_images_v1(uuid,uuid,text) to service_role;

do $patch$
declare definition text; marker text; insertion text;
begin
 definition:=pg_get_functiondef('public.assert_ebay_authorized_publication_image_set_high_quality(uuid,uuid,text)'::regprocedure);
 marker:=$marker$  v_binding := v_approval.approved_payload$marker$;
 insertion:=$insert$  -- A prepared current package revision uses its exact source gallery. The
  -- historical seven-image compositor contract still governs legacy executions.
  if v_publication.sanitized_result#>'{publicationPreparationV1,current}' is not null then
    if v_publication.sanitized_result#>>'{publicationPreparationV1,activation,draftExecutionId}' is distinct from v_execution.id::text
      or v_publication.sanitized_result#>>'{publicationPreparationV1,activation,previewHash}' is distinct from v_publication.preview_hash
      or v_publication.sanitized_result#>>'{publicationPreparationV1,activation,publicationId}' is distinct from v_publication.id::text
      or not public.publication_revision_content_matches_v1(v_publication.sanitized_result#>'{publicationPreparationV1,current}',v_publication.preview)
      or public.assess_publication_revision_images_v1(p_publication_id,p_actor,p_account_key)->>'pass' is distinct from 'true' then
      raise exception 'CURRENT_PACKAGE_REVISION_IMAGE_AUTHORITY_REQUIRED';
    end if;
    return;
  end if;

$insert$;
 if strpos(definition,marker)=0 then raise exception 'PUBLICATION_IMAGE_GUARD_BASE_MISMATCH';end if;
 execute replace(definition,marker,insertion||marker);
end $patch$;
