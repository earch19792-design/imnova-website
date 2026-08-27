-- Extend the existing approval trigger with one strict, evidence-backed Luna
-- deterministic contract. The legacy Same-Day visual policy remains unchanged.
create or replace function public.block_non_passed_image_approval_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_luna_automatic boolean := false;
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

    if not v_luna_automatic and (
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
  'Preserves the strict Same-Day V2 approval policy and additionally admits only the exact operator-attested Luna deterministic image contract after durable QA evidence.';
