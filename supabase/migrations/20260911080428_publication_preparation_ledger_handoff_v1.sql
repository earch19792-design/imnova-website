-- Store preparation alongside its existing intent, never in the immutable package.
-- Internal preparation only. No new publication intent, no consumption of its
-- idempotency key, and no rewrite of a historical Preview/execution.
create or replace function public.prepare_publication_package_revision_v1(
  p_package_id uuid, p_publication_id uuid, p_actor_user_id uuid,
  p_authorization_reference text, p_revision jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pkg public.ebay_listing_packages%rowtype;
  pub public.ebay_authorized_listing_publications%rowtype;
  op public.ebay_luna_opportunity_queue%rowtype;
  review jsonb; exposure jsonb; prep jsonb; lineage jsonb; b jsonb; c jsonb;
begin
  select * into pkg from public.ebay_listing_packages where id=p_package_id for update;
  select * into pub from public.ebay_authorized_listing_publications where id=p_publication_id for update;
  if pkg.id is null or pub.id is null or pkg.created_by is distinct from p_actor_user_id or
    pub.actor_user_id is distinct from p_actor_user_id or pub.listing_package_id is distinct from pkg.id or
    pub.marketplace_account_key is distinct from pkg.account_key or
    pub.phase is distinct from 'preview_ready' or pub.publish_attempt_count<>0 or
    pub.publication_idempotency_key is not null or pub.claim_token is not null or pub.listing_id is not null then
    raise exception 'PUBLICATION_REVISION_NOT_SAFE_TO_PREPARE';
  end if;
  select * into op from public.ebay_luna_opportunity_queue where id=pkg.opportunity_id;
  review:=pkg.package_data->'quickPickOwnerReviewV1'; lineage:=review->'exactProductLineage';
  b:=p_revision#>'{snapshot,binding}'; c:=p_revision#>'{snapshot,content}';
  if p_authorization_reference is null or length(p_authorization_reference)<16 or length(p_authorization_reference)>300 or
    review->>'contractVersion' is distinct from 'QUICK_PICK_REMOTE_OWNER_REVIEW_V1' or
    review->>'status' is distinct from 'CONFIRMED' or review->>'reviewedBy' is distinct from p_actor_user_id::text or
    review->>'authorizedQuantity' is distinct from '1' or review->>'authorizedPackageId' is distinct from pkg.id::text or
    review->>'authorizedSku' is distinct from op.supplier_sku or
    lineage->>'lunaProductId' is distinct from op.supplier_product_id or
    lineage->>'lunaVariantId' is distinct from op.supplier_variant_id or
    lineage->>'productTruthDigest' is distinct from op.assessment#>>'{productTruth,evidenceDigest}' then
    raise exception 'EXPLICIT_PACKAGE_EXPOSURE_AUTHORITY_REQUIRED';
  end if;
  if p_revision->>'version' is distinct from 'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1' or
    p_revision->>'publicationId' is distinct from pub.id::text or p_revision->>'packageId' is distinct from pkg.id::text or
    p_revision->>'accountKey' is distinct from pkg.account_key or
    p_revision->>'priorPreviewHash' is distinct from pub.preview_hash or
    p_revision->>'priorDraftExecutionId' is distinct from pub.draft_execution_id::text or
    p_revision->>'preparationStatus' is distinct from 'INTERNAL_PREVIEW_ONLY' or
    p_revision->>'ebayPrevalidated' is distinct from 'false' or p_revision->>'publicationAuthorized' is distinct from 'false' or
    b->>'ACCOUNT_KEY' is distinct from pkg.account_key or b->>'PRODUCT_ID' is distinct from op.supplier_product_id or
    b->>'VARIANT_ID' is distinct from op.supplier_variant_id or b->>'SKU' is distinct from op.supplier_sku or
    b->>'OPPORTUNITY_ID' is distinct from op.id::text or b->>'CANDIDATE_KEY' is distinct from pkg.candidate_key or
    p_revision->>'packageGeneration' is distinct from p_revision#>>'{certifiedPackage,listingPackage,generation}' or
    c is distinct from p_revision#>'{certifiedPackage,listingPackage,content}' or
    c->>'title' is distinct from p_revision#>>'{preview,inventoryItemPayload,product,title}' or
    c->>'description' is distinct from p_revision#>>'{preview,inventoryItemPayload,product,description}' or
    c->'imageUrls' is distinct from p_revision#>'{preview,inventoryItemPayload,product,imageUrls}' or
    c->>'categoryId' is distinct from p_revision#>>'{preview,offerPayload,categoryId}' or
    p_revision#>>'{preview,sku}' is distinct from pub.sku or
    coalesce(p_revision->>'packageHash','') !~ '^sha256:[a-f0-9]{64}$' or
    coalesce(p_revision->>'previewHash','') !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'PUBLICATION_REVISION_EXACT_PACKAGE_BINDING_REQUIRED';
  end if;
  prep:=coalesce(pub.sanitized_result->'publicationPreparationV1','{}'::jsonb);
  if prep#>>'{current,revisionKey}' = p_revision->>'revisionKey' then
    if (prep->'current')-'createdAt' is distinct from p_revision-'createdAt' then
      raise exception 'PUBLICATION_REVISION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('created',false,'revisionKey',p_revision->>'revisionKey');
  end if;
  if prep ? 'current' then raise exception 'PUBLICATION_REVISION_ALREADY_PENDING'; end if;
  exposure:=jsonb_build_object('version','SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1','status','ACTIVE',
    'scope','EXACT_NEW_PACKAGE_EXPOSURE','quantity',1,'sourcePolicy','QUICK_PICK_REMOTE_OWNER_REVIEW_V1',
    'authorizedBy',p_actor_user_id,'authorizedAt',clock_timestamp(),'authorizationReference',p_authorization_reference,
    'supplierQuantityInferred',false,'publicationAuthorized',false,
    'binding',jsonb_build_object('accountKey',pkg.account_key,'packageId',pkg.id,'productId',op.supplier_product_id,
      'variantId',op.supplier_variant_id,'sku',op.supplier_sku,'productTruthDigest',lineage->>'productTruthDigest'));
  prep:=jsonb_build_object('current',p_revision,'historicalPublication',jsonb_build_object(
    'id',pub.id,'previewHash',pub.preview_hash,'preview',pub.preview,'draftExecutionId',pub.draft_execution_id,
    'draftApprovalId',pub.draft_approval_id,'publicationIdempotencyKey',pub.publication_idempotency_key));
  prep:=prep||jsonb_build_object('exposurePolicy',exposure);
  update public.ebay_authorized_listing_publications set sanitized_result=jsonb_set(sanitized_result,
    '{publicationPreparationV1}',prep) where id=pub.id;
  return jsonb_build_object('created',true,'revisionKey',p_revision->>'revisionKey','publicationId',pub.id,
    'publicationIntentCreated',false,'publicationKeyConsumed',false);
end $$;
revoke all on function public.prepare_publication_package_revision_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_publication_package_revision_v1(uuid,uuid,uuid,text,jsonb) to service_role;

do $patch$
declare definition text; old_branch text; new_branch text;
begin
 definition:=pg_get_functiondef('public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure);
 old_branch:=$oldBranch$
  if v_package.package_data#>'{publicationPreparationV1,current}' is not null then
    select * into v_publication from public.ebay_authorized_listing_publications
      where id=(v_package.package_data#>>'{publicationPreparationV1,current,publicationId}')::uuid for update;
    if not found or v_publication.phase<>'preview_ready' or v_publication.publish_attempt_count<>0 or
      v_publication.publication_idempotency_key is not null or v_publication.claim_token is not null or
      v_publication.listing_package_id is distinct from v_package.id or
      v_publication.actor_user_id is distinct from p_actor_user_id or
      v_publication.marketplace_account_key is distinct from p_marketplace_account_key or
      not public.publication_revision_content_matches_v1(v_package.package_data#>'{publicationPreparationV1,current}',p_preview) then
      raise exception 'PUBLICATION_CURRENT_REVISION_PREPARATION_MISMATCH';
    end if;
    if v_publication.draft_execution_id is distinct from p_draft_execution_id then
      if v_package.package_data#>'{publicationPreparationV1,activation}' is not null then
        raise exception 'PUBLICATION_REVISION_ALREADY_ACTIVATED';
      end if;
      update public.ebay_authorized_listing_publications set
        draft_execution_id=p_draft_execution_id,draft_approval_id=v_approval.id,
        offer_id=v_execution.offer_id,preview_hash=p_preview_hash,preview=p_preview,
        preview_prepared_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=v_publication.id returning * into v_publication;
      update public.ebay_listing_packages set package_data=jsonb_set(package_data,
        '{publicationPreparationV1,activation}',jsonb_build_object('draftExecutionId',p_draft_execution_id,
          'previewHash',p_preview_hash,'publicationId',v_publication.id,'activatedAt',clock_timestamp()))
        where id=v_package.id;
      return next v_publication;
      return;
    end if;
  end if;
$oldBranch$;
 new_branch:=$newBranch$
  select * into v_publication from public.ebay_authorized_listing_publications
    where listing_package_id=v_package.id and marketplace_account_key=p_marketplace_account_key
      and sanitized_result#>'{publicationPreparationV1,current}' is not null for update;
  if found then
    if not found or v_publication.phase<>'preview_ready' or v_publication.publish_attempt_count<>0 or
      v_publication.publication_idempotency_key is not null or v_publication.claim_token is not null or
      v_publication.listing_package_id is distinct from v_package.id or
      v_publication.actor_user_id is distinct from p_actor_user_id or
      v_publication.marketplace_account_key is distinct from p_marketplace_account_key or
      not public.publication_revision_content_matches_v1(v_publication.sanitized_result#>'{publicationPreparationV1,current}',p_preview) then
      raise exception 'PUBLICATION_CURRENT_REVISION_PREPARATION_MISMATCH';
    end if;
    if v_publication.draft_execution_id is distinct from p_draft_execution_id then
      if v_publication.sanitized_result#>'{publicationPreparationV1,activation}' is not null then
        raise exception 'PUBLICATION_REVISION_ALREADY_ACTIVATED';
      end if;
      update public.ebay_authorized_listing_publications set
        draft_execution_id=p_draft_execution_id,draft_approval_id=v_approval.id,
        offer_id=v_execution.offer_id,preview_hash=p_preview_hash,preview=p_preview,
        preview_prepared_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=v_publication.id returning * into v_publication;
      update public.ebay_authorized_listing_publications set sanitized_result=jsonb_set(sanitized_result,
        '{publicationPreparationV1,activation}',jsonb_build_object('draftExecutionId',p_draft_execution_id,
          'previewHash',p_preview_hash,'publicationId',v_publication.id,'activatedAt',clock_timestamp()))
        where id=v_publication.id;
      return next v_publication;
      return;
    end if;
  end if;
$newBranch$;
 if strpos(definition,old_branch)=0 then raise exception 'PUBLICATION_REVISION_HANDOFF_BASE_MISMATCH'; end if;
 execute replace(definition,old_branch,new_branch);
end $patch$;
create or replace function public.guard_publication_pending_package_revision_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare prep jsonb;
begin
  if new.phase='publish_in_flight' and old.phase is distinct from 'publish_in_flight' then
    prep:=new.sanitized_result->'publicationPreparationV1';
    if prep->'current' is not null and (prep#>>'{activation,draftExecutionId}' is distinct from new.draft_execution_id::text or
      prep#>>'{activation,previewHash}' is distinct from new.preview_hash or
      prep#>>'{activation,publicationId}' is distinct from new.id::text or
      not public.publication_revision_content_matches_v1(prep->'current',new.preview)) then
      raise exception 'PUBLICATION_CURRENT_PREVIEW_REVISION_REQUIRES_EBAY_PREPARATION';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_publication_pending_package_revision_v1() from public,anon,authenticated;
