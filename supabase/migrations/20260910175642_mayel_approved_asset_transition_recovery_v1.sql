begin;
create function public.seller_os_visual_semantic_checks_pass_v1(c jsonb,r text)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_typeof(c)='object' and not exists(
 select 1 from unnest(array['productIdentityPreserved','colorPreserved','shapePreserved','partCountPreserved',
 'visibleLogosPreserved','noInventedAccessories','noUnsupportedClaims','noUnauthorizedText','roleMatchesOutput']) k
 where c->>k is distinct from 'true')
 and (r<>'DIMENSIONS' or c->>'dimensionTextMatchesProductTruth'='true'),false);
$$;
create function public.seller_os_record_visual_safe_decision_v1(p_account_key text,p_actor_user_id uuid,p_task_id uuid,p_asset_id uuid,p_decision jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.ebay_mayel_visual_tasks_v1%rowtype; a public.ebay_listing_image_assets%rowtype;
begin
 select * into t from public.ebay_mayel_visual_tasks_v1 where id=p_task_id and marketplace_account_key=p_account_key
 and assigned_operator_user_id=p_actor_user_id and status in ('MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY') for update;
 if not found then raise exception 'MAYEL_VISUAL_TASK_NOT_AVAILABLE'; end if;
 select * into a from public.ebay_listing_image_assets where id=p_asset_id and mayel_visual_task_id=t.id
 and account_key=p_account_key and uploaded_by=p_actor_user_id for update;
 if not found or a.status<>'pending_review' or a.mayel_approval_status<>'PENDING'
 or a.qa_result #>> '{humanReview,decision}'='REJECT' then raise exception 'MAYEL_VISUAL_REVIEW_ALREADY_FINAL'; end if;
 if a.qa_result->>'automaticStatus' is distinct from 'PASSED'
 or p_decision->>'contract' is distinct from 'MAYEL_APPROVED_ASSET_TRANSITION_V1'
 or p_decision->>'taskId' is distinct from t.id::text or p_decision->>'assetId' is distinct from a.id::text
 or p_decision->>'actorUserId' is distinct from p_actor_user_id::text
 or p_decision->>'outputSha256' is distinct from a.output_sha256
 or p_decision->>'sourceImageSetDigest' is distinct from t.source_image_set_digest
 or p_decision->>'productTruthDigest' is distinct from t.product_truth_digest
 or p_decision->>'writeAuthority' is distinct from 'false'
 or t.selection_signal #>> '{currentOfficialGallery,authority}' is distinct from 'CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 or coalesce(jsonb_array_length(p_decision->'currentImages'),0) not between 1 and 24
 or p_decision->>'galleryDigest' is distinct from t.selection_signal #>> '{currentOfficialGallery,digest}'
 or p_decision->'currentImages' is distinct from t.selection_signal #> '{currentOfficialGallery,images}'
 or p_decision #>> '{intent,assetId}' is distinct from a.id::text
 or coalesce(p_decision #>> '{intent,visualIntent}','') not in ('REPLACE_MAIN','REPLACE_SLOT','ADD_SECONDARY')
 or not public.seller_os_visual_semantic_checks_pass_v1(p_decision->'checks',a.mayel_output_role)
 then raise exception 'MAYEL_VISUAL_SAFE_DECISION_INVALID'; end if;
 if a.qa_result ? 'transitionDecision' then
   if a.qa_result->'transitionDecision' is distinct from p_decision then raise exception 'MAYEL_VISUAL_DECISION_GENERATION_CHANGED'; end if;
   return true;
 end if;
 update public.ebay_listing_image_assets set qa_result=qa_result||jsonb_build_object('transitionDecision',p_decision)
 where id=a.id;
 return true;
end $$;
revoke all on function public.seller_os_visual_semantic_checks_pass_v1(jsonb,text),
 public.seller_os_record_visual_safe_decision_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_visual_semantic_checks_pass_v1(jsonb,text),
 public.seller_os_record_visual_safe_decision_v1(text,uuid,uuid,uuid,jsonb) to service_role;
create or replace function public.promote_ebay_mayel_visual_asset_v1(
  p_account_key text,
  p_actor_user_id uuid,
  p_task_id uuid,
  p_asset_id uuid,
  p_public_path text,
  p_public_url text,
  p_qa_result jsonb,
  p_manifest jsonb,
  p_manifest_digest text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_task public.ebay_mayel_visual_tasks_v1%rowtype;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_contract_version text := p_manifest ->> 'contractVersion';
  v_idempotent boolean := false;
  v_v1_asset_bound boolean := false;
  v_v2_asset_bound boolean := false;
  v_v2_order_valid boolean := false;
begin
  select * into v_task
  from public.ebay_mayel_visual_tasks_v1
  where id = p_task_id
    and marketplace_account_key = p_account_key
    and assigned_operator_user_id = p_actor_user_id
    and status in ('MAYEL_REVIEW_PENDING', 'OWNER_PREVIEW_READY')
  for update;
  if not found then
    raise exception 'MAYEL_VISUAL_TASK_NOT_AVAILABLE';
  end if;

  select * into v_asset
  from public.ebay_listing_image_assets
  where id = p_asset_id
    and mayel_visual_task_id = p_task_id
    and account_key = p_account_key
    and uploaded_by = p_actor_user_id
  for update;
  if not found then
    raise exception 'MAYEL_VISUAL_ASSET_NOT_FOUND';
  end if;

  if v_contract_version = 'MAYEL_VISUAL_MANIFEST_V1' then
    select exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_manifest -> 'proposedOrderedImages', '[]'::jsonb)
      ) entry
      where entry ->> 'assetId' = p_asset_id::text
        and entry ->> 'outputSha256' = v_asset.output_sha256
        and entry ->> 'publicUrl' = p_public_url
        and entry ->> 'role' = v_asset.mayel_output_role
    ) into v_v1_asset_bound;
  elsif v_contract_version = 'MAYEL_ORDERED_VISUAL_MANIFEST_V2' then
    select exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_manifest -> 'finalOrderedImageSet', '[]'::jsonb)
      ) entry
      where entry ->> 'kind' = 'MAYEL_ASSET'
        and entry ->> 'assetId' = p_asset_id::text
        and entry ->> 'outputSha256' = v_asset.output_sha256
        and entry ->> 'publicUrl' = p_public_url
    ) into v_v2_asset_bound;

    select
      jsonb_typeof(p_manifest -> 'finalOrderedImageSet') = 'array'
      and jsonb_typeof(p_manifest -> 'proposedOrderedImages') = 'array'
      and jsonb_array_length(p_manifest -> 'finalOrderedImageSet')
        between 1 and 24
      and jsonb_array_length(p_manifest -> 'proposedOrderedImages') =
        jsonb_array_length(p_manifest -> 'finalOrderedImageSet')
      and (
        select count(*) = count(distinct entry ->> 'publicUrl')
        from jsonb_array_elements(
          p_manifest -> 'finalOrderedImageSet') entry
      )
      and not exists (
        select 1
        from jsonb_array_elements(
          p_manifest -> 'proposedOrderedImages') with ordinality proposed(entry, ordinal)
        full join jsonb_array_elements(
          p_manifest -> 'finalOrderedImageSet') with ordinality final(entry, ordinal)
          using (ordinal)
        where proposed.entry is null
          or final.entry is null
          or proposed.entry ->> 'position' is distinct from
            (proposed.ordinal - 1)::text
          or proposed.entry ->> 'publicUrl' is distinct from
            final.entry ->> 'publicUrl'
          or proposed.entry ->> 'assetId' is distinct from
            final.entry ->> 'assetId'
          or proposed.entry ->> 'outputSha256' is distinct from
            final.entry ->> 'outputSha256'
      )
      and p_manifest ->> 'selectedHeroAssetId' is not distinct from (
        p_manifest #>> '{finalOrderedImageSet,0,assetId}'
      )
    into v_v2_order_valid;
  end if;

  if p_public_path is distinct from
      'mayel-visual/' || p_task_id::text || '/' || p_asset_id::text || '/' ||
      v_asset.output_sha256 || '.jpg'
    or p_public_url !~ '^https://'
    or p_qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or p_qa_result #>> '{humanReview,decision}' is distinct from 'APPROVE'
    or p_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_manifest ->> 'visualManifestDigest' is distinct from p_manifest_digest
    or v_contract_version not in (
      'MAYEL_VISUAL_MANIFEST_V1',
      'MAYEL_ORDERED_VISUAL_MANIFEST_V2'
    )
    or p_manifest ->> 'visualTaskId' is distinct from p_task_id::text
    or p_manifest ->> 'ebayItemId' is distinct from v_task.ebay_item_id
    or p_manifest ->> 'productTruthDigest' is distinct from
      v_task.product_truth_digest
    or p_manifest ->> 'sourceImageSetDigest' is distinct from
      v_task.source_image_set_digest
    or p_manifest -> 'fieldsToChange' is distinct from
      '["IMAGES_ONLY"]'::jsonb
    or (
      v_contract_version = 'MAYEL_VISUAL_MANIFEST_V1'
      and (
        p_manifest ->> 'currentMainImagePreserved' is distinct from 'true'
        or p_manifest ->> 'separateExplicitOwnerApprovalRequiredForMainImage'
          is distinct from 'true'
        or not v_v1_asset_bound
      )
    )
    or (
      v_contract_version = 'MAYEL_ORDERED_VISUAL_MANIFEST_V2'
      and (
        p_manifest ->> 'orderControlledByMayel' is distinct from 'true'
        or p_manifest ->> 'backendSilentReorder' is distinct from 'false'
        or p_manifest ->> 'mayelMainImageAuthority' is distinct from 'true'
        or p_manifest ->> 'ownerPerImageApproval' is distinct from
          case when p_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1' then 'true' else 'false' end
        or p_manifest ->> 'ownerPerListingVisualApproval'
          is distinct from 'false'
        or p_manifest ->> 'capacityExceeded' is distinct from 'false'
        or p_manifest ->> 'ownerDecisionRequiredBeforeAuthorization' is distinct from
          case when p_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1' then 'true' else 'false' end
        or not v_v2_asset_bound
        or not v_v2_order_valid
      )
    ) then
    raise exception 'MAYEL_VISUAL_PROMOTION_CONTRACT_INVALID';
  end if;

  -- New explicit intents use precisely the full gallery visible to the operator.
  -- Historical task evidence/source digests remain unchanged.
  if p_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1' and (
    p_manifest->'currentOfficialImageSet' is distinct from v_task.selection_signal #> '{currentOfficialGallery,images}'
    or v_task.selection_signal #>> '{currentOfficialGallery,authority}' is distinct from 'CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
    or (v_task.visual_manifest_digest is not null and v_task.current_image_set is distinct from p_manifest->'currentOfficialImageSet')
    or not public.seller_os_visual_semantic_checks_pass_v1(p_qa_result #> '{humanReview,checks}',v_asset.mayel_output_role)
    or p_qa_result->'transitionDecision' is distinct from v_asset.qa_result->'transitionDecision'
    or p_qa_result #>> '{transitionDecision,contract}' is distinct from 'MAYEL_APPROVED_ASSET_TRANSITION_V1'
  ) then raise exception 'MAYEL_VISUAL_GALLERY_OR_SEMANTIC_DECISION_CHANGED'; end if;

  if v_asset.status = 'approved' then
    if v_asset.mayel_approval_status <> 'APPROVED'
      or v_asset.owner_approval_status <> 'PENDING'
      or v_asset.published_storage_path is distinct from p_public_path
      or v_asset.public_url is distinct from p_public_url then
      raise exception 'MAYEL_VISUAL_APPROVAL_STATE_CONFLICT';
    end if;
    v_idempotent := true;
  elsif v_asset.status = 'pending_review'
    and v_asset.mayel_approval_status = 'PENDING'
    and v_asset.owner_approval_status = 'PENDING'
    and v_asset.listing_package_id is null then
    update public.ebay_listing_image_assets
    set status = 'approved',
      mayel_approval_status = 'APPROVED',
      approved_at = now(),
      approved_by = p_actor_user_id,
      published_storage_path = p_public_path,
      public_url = p_public_url,
      qa_result = p_qa_result
    where id = p_asset_id
    returning * into v_asset;
  else
    raise exception 'MAYEL_VISUAL_REVIEW_ALREADY_FINAL';
  end if;

  update public.ebay_mayel_visual_tasks_v1
  set status = 'OWNER_PREVIEW_READY',
    current_image_set = case when p_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1'
      then p_manifest->'currentOfficialImageSet' else current_image_set end,
    visual_manifest = p_manifest,
    visual_manifest_digest = p_manifest_digest,
    updated_at = now()
  where id = p_task_id;

  return jsonb_build_object(
    'asset', to_jsonb(v_asset),
    'manifest', p_manifest,
    'idempotent', v_idempotent
  );
end;
$$;

revoke all on function public.promote_ebay_mayel_visual_asset_v1(
  text, uuid, uuid, uuid, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.promote_ebay_mayel_visual_asset_v1(
  text, uuid, uuid, uuid, text, text, jsonb, jsonb, text
) to service_role;

comment on function public.promote_ebay_mayel_visual_asset_v1(
  text, uuid, uuid, uuid, text, text, jsonb, jsonb, text
) is
  'Atomically promotes a task-bound Mayel asset and accepts the guarded V1 or ordered V2 visual manifest. It never writes to eBay.';

notify pgrst, 'reload schema';

create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and ((t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and (not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE')
 or exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE'
 and public.seller_os_visual_delegated_ready_v1(t,d.id::text)))
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state<>'SUPERSEDED'
 and o.intent #>> '{requestedChanges,taskId}'=t.id::text
 and (o.kind='IMAGE_SYNC' and o.intent #>> '{requestedChanges,manifestDigest}'=t.visual_manifest_digest
 or o.dispatch_count>0 or not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
 where d.account_key=p_account_key and d.status='ACTIVE' and d.revoked_at is null
 and public.seller_os_visual_delegated_ready_v1(t,d.id::text)))))
 or (t.status='MAYEL_REVIEW_PENDING' and t.visual_manifest_digest is null
 and exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key
 and d.status='ACTIVE' and d.scope='FULL' and d.revoked_at is null)
 and exists(select 1 from public.ebay_listing_image_assets a where a.mayel_visual_task_id=t.id
 and a.account_key=p_account_key and a.status='pending_review' and a.mayel_approval_status='PENDING'
 and a.qa_result #>> '{transitionDecision,contract}'='MAYEL_APPROVED_ASSET_TRANSITION_V1'
 and a.qa_result #>> '{transitionDecision,galleryDigest}'=t.selection_signal #>> '{currentOfficialGallery,digest}'
 and public.seller_os_visual_semantic_checks_pass_v1(a.qa_result #> '{transitionDecision,checks}',a.mayel_output_role)
 and a.qa_result->>'automaticStatus'='PASSED')))
 order by t.updated_at,t.id limit 3;
$$;

notify pgrst,'reload schema';
commit;
