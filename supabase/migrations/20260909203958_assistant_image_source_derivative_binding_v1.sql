-- Same source identity at eBay's thumbnail and certified maximum size. Matches
-- the existing resolveMaximumOfficialEbayImageV1 contract; does not accept a
-- different image ID, host, format, query, or a caller-provided unrelated URL.
begin;
create or replace function public.seller_os_same_ebay_image_source_v1(p_reference text, p_generated_source text)
returns boolean language sql immutable security invoker
set search_path = public, pg_temp
as $function$
  select coalesce(case
    when p_reference = p_generated_source then true
    when p_reference ~ '^https://([a-z0-9-]+[.])*ebayimg[.]com/images/g/[^/?#]+/s-l[0-9]+[.](jpe?g|png|webp)([?][^#]*)?$'
      then regexp_replace(p_reference, '/s-l[0-9]+([.](?:jpe?g|png|webp))([?][^#]*)?$', '/s-l1600\1\2', 'i') = p_generated_source
    else false
  end, false);
$function$;
revoke all on function public.seller_os_same_ebay_image_source_v1(text,text) from public, anon, authenticated;
grant execute on function public.seller_os_same_ebay_image_source_v1(text,text) to service_role;

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
                exists (select 1 from jsonb_array_elements_text(visual_task.current_image_set) image_url where public.seller_os_same_ebay_image_source_v1(image_url, experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,sourceImageUrl}'))
                or exists (select 1 from jsonb_array_elements(visual_task.source_image_references) ref
                  where public.seller_os_same_ebay_image_source_v1(ref ->> 'url', experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,sourceImageUrl}'))
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
commit;
