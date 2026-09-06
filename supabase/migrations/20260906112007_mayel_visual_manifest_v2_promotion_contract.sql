-- Align the existing atomic quarantine -> canonical asset promotion with the
-- ordered gallery manifest. This extends the established RPC; it does not
-- create a second asset workflow and it has no marketplace capability.

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
        or p_manifest ->> 'ownerPerImageApproval' is distinct from 'false'
        or p_manifest ->> 'ownerPerListingVisualApproval'
          is distinct from 'false'
        or p_manifest ->> 'capacityExceeded' is distinct from 'false'
        or p_manifest ->> 'ownerDecisionRequiredBeforeAuthorization'
          is distinct from 'false'
        or not v_v2_asset_bound
        or not v_v2_order_valid
      )
    ) then
    raise exception 'MAYEL_VISUAL_PROMOTION_CONTRACT_INVALID';
  end if;

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
