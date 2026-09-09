-- Extend only the presentation-asset origin. Existing automatic and human QA,
-- exact actor/task binding, immutable canonical storage and atomic manifest
-- promotion remain mandatory. No eBay request is executed by this migration.
begin;
alter table public.ebay_mayel_visual_tasks_v1 drop constraint if exists ebay_mayel_visual_tasks_selection_check;
alter table public.ebay_mayel_visual_tasks_v1 add constraint ebay_mayel_visual_tasks_selection_check check (
  selection_authority in ('EBAY_LISTING_QUALITY_VISUAL_SIGNAL', 'SELLER_OS_LIVE_VISUAL_QUALITY_SIGNAL',
    'LOW_CTR_SUFFICIENT_IMPRESSIONS', 'SELLER_OS_AUTHORITATIVE_LIVE_VISUAL_PORTFOLIO', 'SELLER_OS_SAVED_LISTING_VISUAL_DRAFT')
  and jsonb_typeof(selection_signal) = 'object'
);
alter table public.ebay_listing_image_assets
  drop constraint if exists ebay_listing_image_assets_mayel_output_check;

alter table public.ebay_listing_image_assets
  add constraint ebay_listing_image_assets_mayel_output_check check (
    mayel_visual_task_id is null or (
      listing_package_id is null
      and source_kind = 'owned_upload'
      and source_type in ('CHATGPT_SUBSCRIPTION_MAYEL', 'SELLER_OS_ASSISTANT_IMAGE_VARIANT')
      and uploaded_by is not null
      and mayel_output_role in (
        'DETAIL', 'PACKAGE_CONTENTS', 'DIMENSIONS',
        'PRIMARY_BENEFIT', 'LIFESTYLE', 'HUMAN_USE'
      )
      and declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and actual_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and jsonb_typeof(source_image_references) = 'array'
      and jsonb_array_length(source_image_references) between 1 and 24
      and source_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
      and product_truth_version <> ''
      and product_truth_digest ~ '^sha256:[0-9a-f]{64}$'
      and prompt_contract_version = 'MAYEL_CHATGPT_VISUAL_PROMPT_V1'
      and mayel_approval_status in ('PENDING', 'APPROVED', 'REJECTED')
      and owner_approval_status = 'PENDING'
      and jsonb_typeof(provenance) = 'object'
    )
  ) not valid;

alter table public.ebay_listing_image_assets
  validate constraint ebay_listing_image_assets_mayel_output_check;

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
      and new.uploaded_by is not null
      and new.approved_by = new.uploaded_by
      and new.rights_basis = 'owned'
      and new.rights_evidence_confirmed = true
      and new.transformation ->> 'method' = 'PRESERVED_FULL_FRAME'
      and new.transformation ->> 'output' = '1600_SQUARE_JPEG'
      and (
        (new.source_type = 'CHATGPT_SUBSCRIPTION_MAYEL'
          and new.authorization_reference = 'MAYEL_CHATGPT_SUBSCRIPTION:' || new.mayel_visual_task_id::text
          and new.transformation_version = 'MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1'
          and new.transformation ->> 'generativeAiUsedBySellerOs' = 'false')
        or
        (new.source_type = 'SELLER_OS_ASSISTANT_IMAGE_VARIANT'
          and new.transformation_version = 'SELLER_OS_ASSISTANT_OUTPUT_NORMALIZATION_V1'
          and new.transformation ->> 'generativeAiUsedBySellerOs' = 'true'
          and exists (
            select 1 from public.ebay_listing_experiments_v1 experiment
            join public.ebay_mayel_visual_tasks_v1 visual_task
              on visual_task.id = new.mayel_visual_task_id
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(experiment.baseline_evidence_ref #> '{sellerOsVisualVariant,variants}') = 'array'
              then experiment.baseline_evidence_ref #> '{sellerOsVisualVariant,variants}' else '[]'::jsonb end
            ) variant
            where experiment.experiment_id::text = new.provenance #>> '{generatedOrigin,experimentId}'
              and experiment.account_key = new.account_key
              and experiment.marketplace = 'EBAY_US'
              and experiment.ebay_item_id = visual_task.ebay_item_id
              and experiment.experiment_type = 'HERO_VISUAL_VARIANT'
              and experiment.lifecycle_status in ('DRAFT', 'READY')
              and experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,contractVersion}' = 'SELLER_OS_VISUAL_VARIANT_V1_2026_08_29'
              and experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,experimentId}' = experiment.experiment_id::text
              and experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,ebayItemId}' = visual_task.ebay_item_id
              and new.authorization_reference = 'SELLER_OS_ASSISTANT_VARIANT:' || experiment.experiment_id::text
              and variant ->> 'assetId' = new.id::text
              and variant ->> 'outputSha256' = new.source_sha256
              and variant ->> 'outputStoragePath' = new.provenance #>> '{generatedOrigin,outputStoragePath}'
              and variant ->> 'outputStoragePath' in (
                'seller-os-visual-variants/' || visual_task.ebay_item_id || '/' || experiment.experiment_id::text || '/variant-a.png',
                'seller-os-visual-variants/' || visual_task.ebay_item_id || '/' || experiment.experiment_id::text || '/variant-b.png')
              and variant ->> 'status' = 'EXPERIMENT_READY'
              and variant ->> 'variantRejected' = 'false'
              and variant ->> 'productTruthPreserved' = 'true'
              and variant ->> 'protectedLayerRoundtripExact' = 'true'
              and variant ->> 'sourceImageFullResolutionCertified' = 'true'
              and variant #>> '{backgroundQa,passed}' = 'true'
              and (
                visual_task.current_image_set ? (experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,sourceImageUrl}')
                or exists (select 1 from jsonb_array_elements(visual_task.source_image_references) ref
                  where ref ->> 'url' = experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,sourceImageUrl}')
              )
          ))
      )
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
          and task.opportunity_id is not distinct from new.opportunity_id
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

-- Discovery excludes only exact completed manifests before LIMIT. Previously
-- three completed tasks could indefinitely hide a fourth pending listing.
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table (id uuid, ebay_item_id text, visual_manifest_id uuid, visual_manifest_digest text, updated_at timestamptz)
language sql stable security invoker
set search_path = public, pg_temp
as $function$
  select task.id, task.ebay_item_id, task.visual_manifest_id, task.visual_manifest_digest, task.updated_at
  from public.ebay_mayel_visual_tasks_v1 task
  where task.marketplace_account_key = p_account_key
    and task.status = 'OWNER_PREVIEW_READY'
    and task.visual_manifest_id is not null
    and task.visual_manifest_digest is not null
    and not exists (
      select 1 from public.ebay_mayel_visual_phase_b_executions_v1 execution
      where execution.marketplace_account_key = task.marketplace_account_key
        and execution.visual_task_id = task.id
        and execution.visual_manifest_digest = task.visual_manifest_digest
        and execution.phase = 'APPLIED_AND_OFFICIALLY_VERIFIED'
    )
  order by task.updated_at asc, task.id asc
  limit 3;
$function$;
revoke all on function public.seller_os_pending_mayel_visual_manifests_v1(text) from public, anon, authenticated;
grant execute on function public.seller_os_pending_mayel_visual_manifests_v1(text) to service_role;
-- Compare the manifest under the same task lock used by the existing atomic
-- promotion. Two concurrent reviews may not silently replace each other's intent.
create or replace function public.seller_os_promote_assistant_image_v1(
  p_account_key text, p_actor_user_id uuid, p_task_id uuid, p_asset_id uuid,
  p_public_path text, p_public_url text, p_qa_result jsonb, p_manifest jsonb,
  p_manifest_digest text, p_expected_visual_manifest_digest text
) returns jsonb language plpgsql security invoker
set search_path = public, pg_temp
as $function$
declare v_digest text;
begin
  select visual_manifest_digest into v_digest from public.ebay_mayel_visual_tasks_v1
  where id = p_task_id and marketplace_account_key = p_account_key
    and assigned_operator_user_id = p_actor_user_id
  for update;
  if not found or v_digest is distinct from p_expected_visual_manifest_digest then
    raise exception 'MAYEL_IMAGE_REVIEW_MANIFEST_CHANGED';
  end if;
  return public.promote_ebay_mayel_visual_asset_v1(p_account_key, p_actor_user_id,
    p_task_id, p_asset_id, p_public_path, p_public_url, p_qa_result, p_manifest, p_manifest_digest);
end;
$function$;
revoke all on function public.seller_os_promote_assistant_image_v1(text,uuid,uuid,uuid,text,text,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.seller_os_promote_assistant_image_v1(text,uuid,uuid,uuid,text,text,jsonb,jsonb,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
