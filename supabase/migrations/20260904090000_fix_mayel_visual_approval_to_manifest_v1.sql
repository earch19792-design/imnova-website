-- Admit the strict Mayel human-reviewed Phase A contract to the existing image
-- approval guard. This does not attach the asset to a publishable package and
-- does not grant any marketplace mutation capability.
create or replace function public.block_non_passed_image_approval_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_luna_automatic boolean := false;
  v_mayel_human boolean := false;
begin
  if new.status = 'approved'
    and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if new.qa_result ->> 'automaticStatus' is distinct from 'PASSED' then
      raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
    end if;

    v_luna_automatic := coalesce((
      new.source_kind = 'authorized_url'
      and new.source_url ~ '^https://([^/]+[.])?(cdn[.]shopify[.]com|lunaportex[.]com)/'
      and new.rights_basis = 'supplier_authorized'
      and new.authorization_reference =
        'OPERATOR_ATTESTED_LUNA_SUPPLIER_IMAGE_AUTHORIZATION_V1'
      and new.rights_evidence_confirmed = true
      and new.transformation_version = 'EBAY_MAIN_IMAGE_SAFE_WHITE_V2'
      and new.source_sha256 ~ '^[0-9a-f]{64}$'
      and new.output_sha256 ~ '^[0-9a-f]{64}$'
      and new.source_sha256 <> new.output_sha256
      and new.output_width = 1600
      and new.output_height = 1600
      and new.transformation ->> 'supplierRightsAuthorityVersion' =
        'OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1'
      and new.transformation ->> 'supplierImageIdentityDigest'
        ~ '^[0-9a-f]{64}$'
      and new.transformation ->> 'supplierImageSourceBindingDigest'
        ~ '^[0-9a-f]{64}$'
      and new.transformation ->> 'generativeAiUsed' = 'false'
      and (
        (
          new.transformation ->> 'backgroundMethod' =
            'AUTHORIZED_SOURCE_FRAMED_CONTAIN'
          and new.transformation ->> 'sourcePixelsTreatment' =
            'PRESERVED_FULL_FRAME'
          and new.qa_result ->> 'fullAuthorizedFramePreserved' = 'true'
        )
        or (
          new.transformation ->> 'backgroundMethod' =
            'LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION'
          and new.transformation ->> 'sourcePixelsTreatment' =
            'NEAR_NEUTRAL_WHITEN_ONLY'
          and new.qa_result #>> '{sourceVisualProfile,productToneRisk}' =
            'STANDARD'
        )
      )
      and new.qa_result ->> 'approvalMode' = 'AUTOMATIC_DETERMINISTIC'
      and new.qa_result ->> 'imageReadiness' = 'IMAGE_READY_AUTO_PASS'
      and new.qa_result ->> 'humanApprovalRequired' = 'false'
      and new.qa_result ->> 'outputQualityPassed' = 'true'
      and new.qa_result ->> 'materialProductEquivalencePassed' = 'true'
      and new.qa_result ->> 'sourceHashPreserved' = 'true'
      and new.qa_result ->> 'onlyAllowedDeterministicTransforms' = 'true'
      and new.qa_result ->> 'productCoverageVerified' = 'true'
      and new.qa_result ->> 'outputUnderTwelveMegabytes' = 'true'
      and new.qa_result ->> 'outputWidth' = '1600'
      and new.qa_result ->> 'outputHeight' = '1600'
      and new.qa_result ->> 'outputEdgeWhiteRatio'
        ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      and (new.qa_result ->> 'outputEdgeWhiteRatio')::numeric >= 0.9
      and new.qa_result #>> '{rightsAuthority,version}' =
        'OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1'
      and new.qa_result #>> '{rightsAuthority,authorityType}' =
        'OPERATOR_ATTESTED_SUPPLIER_IMAGE_AUTHORIZATION'
      and new.qa_result #>> '{rightsAuthority,authorityProvenance}' =
        'OPERATOR_ATTESTED'
      and new.qa_result #>> '{rightsAuthority,documentedLicense}' = 'false'
      and new.qa_result #>> '{rightsAuthority,operatorAttested}' = 'true'
      and new.qa_result #>> '{rightsAuthority,identityDigest}'
        = new.transformation ->> 'supplierImageIdentityDigest'
      and new.qa_result #>> '{rightsAuthority,sourceBindingDigest}'
        = new.transformation ->> 'supplierImageSourceBindingDigest'
    ), false);

    v_mayel_human := coalesce((
      new.mayel_visual_task_id is not null
      and new.listing_package_id is null
      and new.source_kind = 'owned_upload'
      and new.source_type = 'CHATGPT_SUBSCRIPTION_MAYEL'
      and new.uploaded_by is not null
      and new.approved_by = new.uploaded_by
      and new.rights_basis = 'owned'
      and new.rights_evidence_confirmed = true
      and new.authorization_reference =
        'MAYEL_CHATGPT_SUBSCRIPTION:' || new.mayel_visual_task_id::text
      and new.transformation_version =
        'MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1'
      and new.transformation ->> 'method' = 'PRESERVED_FULL_FRAME'
      and new.transformation ->> 'output' = '1600_SQUARE_JPEG'
      and new.transformation ->> 'generativeAiUsedBySellerOs' = 'false'
      and new.source_sha256 ~ '^[0-9a-f]{64}$'
      and new.output_sha256 ~ '^[0-9a-f]{64}$'
      and new.output_width = 1600
      and new.output_height = 1600
      and new.output_bytes between 1 and 12582912
      and new.mayel_output_role in (
        'DETAIL', 'PACKAGE_CONTENTS', 'DIMENSIONS',
        'PRIMARY_BENEFIT', 'LIFESTYLE', 'HUMAN_USE'
      )
      and new.mayel_approval_status = 'APPROVED'
      and new.owner_approval_status = 'PENDING'
      and new.product_truth_digest ~ '^sha256:[0-9a-f]{64}$'
      and new.source_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
      and new.prompt_contract_version = 'MAYEL_CHATGPT_VISUAL_PROMPT_V1'
      and new.qa_result #>> '{humanReview,decision}' = 'APPROVE'
      and new.qa_result #>> '{humanReview,checks,productIdentityPreserved}' = 'true'
      and new.qa_result #>> '{humanReview,checks,colorPreserved}' = 'true'
      and new.qa_result #>> '{humanReview,checks,shapePreserved}' = 'true'
      and new.qa_result #>> '{humanReview,checks,partCountPreserved}' = 'true'
      and new.qa_result #>> '{humanReview,checks,visibleLogosPreserved}' = 'true'
      and new.qa_result #>> '{humanReview,checks,noInventedAccessories}' = 'true'
      and new.qa_result #>> '{humanReview,checks,noUnsupportedClaims}' = 'true'
      and new.qa_result #>> '{humanReview,checks,noUnauthorizedText}' = 'true'
      and new.qa_result #>> '{humanReview,checks,roleMatchesOutput}' = 'true'
      and (
        new.mayel_output_role <> 'DIMENSIONS'
        or new.qa_result #>>
          '{humanReview,checks,dimensionTextMatchesProductTruth}' = 'true'
      )
      and exists (
        select 1
        from public.ebay_mayel_visual_tasks_v1 task
        where task.id = new.mayel_visual_task_id
          and task.marketplace_account_key = new.account_key
          and task.assigned_operator_user_id = new.uploaded_by
          and task.product_truth_version = new.product_truth_version
          and task.product_truth_digest = new.product_truth_digest
          and task.source_image_set_digest = new.source_image_set_digest
          and task.prompt_contract_version = new.prompt_contract_version
          and task.candidate_key = new.candidate_key
          and task.opportunity_id = new.opportunity_id
          and task.status in ('MAYEL_REVIEW_PENDING', 'OWNER_PREVIEW_READY')
      )
    ), false);

    if not v_luna_automatic and not v_mayel_human and (
      new.transformation ->> 'sourceVisualPolicy'
          is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or new.transformation ->> 'authorizedSourceViewReused'
          is distinct from 'true'
      or new.qa_result ->> 'sourceViewCapabilityPassed'
          is distinct from 'true'
      or new.qa_result ->> 'marketSignalsLimitedToScene'
          is distinct from 'true'
      or new.qa_result ->> 'hiddenProductGeometryGenerated'
          is distinct from 'false'
      or new.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or new.qa_result ->> 'qaEvaluatorVersion'
          is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
    ) then
      raise exception 'SAME_DAY_IMAGE_SOURCE_VISUAL_POLICY_NOT_PASSED';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.block_non_passed_image_approval_v1() is
  'Preserves Same-Day and Luna deterministic approval contracts and admits only an exact task-bound Mayel Phase A asset after automatic file QA plus complete human product-fidelity QA. No package attachment or marketplace authority is granted.';

-- Commit the canonical asset row and proposed manifest in one database
-- transaction after the immutable public object has been verified. Storage is
-- compensated by the server if this transaction fails.
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
  v_idempotent boolean := false;
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

  if p_public_path is distinct from
      'mayel-visual/' || p_task_id::text || '/' || p_asset_id::text || '/' ||
      v_asset.output_sha256 || '.jpg'
    or p_public_url !~ '^https://'
    or p_qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or p_qa_result #>> '{humanReview,decision}' is distinct from 'APPROVE'
    or p_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_manifest ->> 'visualManifestDigest' is distinct from p_manifest_digest
    or p_manifest ->> 'contractVersion' is distinct from
      'MAYEL_VISUAL_MANIFEST_V1'
    or p_manifest ->> 'visualTaskId' is distinct from p_task_id::text
    or p_manifest ->> 'ebayItemId' is distinct from v_task.ebay_item_id
    or p_manifest ->> 'productTruthDigest' is distinct from
      v_task.product_truth_digest
    or p_manifest ->> 'sourceImageSetDigest' is distinct from
      v_task.source_image_set_digest
    or p_manifest ->> 'currentMainImagePreserved' is distinct from 'true'
    or p_manifest ->> 'separateExplicitOwnerApprovalRequiredForMainImage'
      is distinct from 'true'
    or p_manifest -> 'fieldsToChange' is distinct from '["IMAGES_ONLY"]'::jsonb
    or not exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_manifest -> 'proposedOrderedImages', '[]'::jsonb)
      ) entry
      where entry ->> 'assetId' = p_asset_id::text
        and entry ->> 'outputSha256' = v_asset.output_sha256
        and entry ->> 'publicUrl' = p_public_url
        and entry ->> 'role' = v_asset.mayel_output_role
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
  'Atomically promotes one exact task-bound Mayel Phase A output and persists its proposed visual manifest. It never attaches the asset to a listing package or writes to eBay.';

notify pgrst, 'reload schema';
