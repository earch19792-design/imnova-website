-- A light/white authorized product can require the main image to preserve its
-- original frame so the compositor does not erase legitimate product edges.
-- That exact main remains non-generative and requires human review. Exclude it
-- from the AI partial count and admit it only under the strict V5 evidence
-- contract. The five secondary images must still be high-quality V3 scenes.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old_partial_count text := $old$
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
    ),
$old$;
  v_new_partial_count text := $new$
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and not (
          asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
          and asset.transformation ->> 'generativeAiUsed' = 'false'
          and asset.transformation ->> 'layoutId'
            = 'MAIN_WHITE_BACKGROUND_CANONICAL_V3'
          and asset.transformation ->> 'compositorContractVersion'
            = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
          and asset.transformation ->> 'authorizedSourceTreatment'
            = 'PRESERVED_FRAMED_SOURCE'
          and asset.transformation ->> 'mainEncodingProfile'
            = 'JPEG_Q93_444_MOZJPEG_V3'
          and asset.transformation ->> 'competitorImageUsed' = 'false'
          and asset.transformation ->> 'originalPackagePixelsPreserved' = 'true'
          and asset.transformation ->> 'verifiedFactsOnly' = 'true'
          and asset.qa_result ->> 'mainBackground'
            = 'FRAMED_AUTHORIZED_SOURCE'
          and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
          and asset.qa_result ->> 'deterministicBackgroundSelection' = 'false'
          and asset.qa_result ->> 'humanApprovalRequired' = 'true'
          and case
            when jsonb_typeof(asset.qa_result -> 'foregroundEdgeCoverage')
              = 'number' then (
                asset.qa_result ->> 'foregroundEdgeCoverage'
              )::numeric between 0.004 and 1
            else false
          end
          and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
          and asset.qa_result -> 'manualChecksRequired' @> jsonb_build_array(
            'AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL',
            'FRAMED_MAIN_BACKGROUND_HUMAN_ACCEPTANCE'
          )
        )
    ),
$new$;
  v_old_partial_guard text := $old$
        and not (
          (
            asset.transformation ->> 'slot' = 'USE_CONTEXT'
$old$;
  v_new_partial_guard text := $new$
        and not (
          (
            asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
            and asset.transformation ->> 'generativeAiUsed' = 'false'
            and asset.transformation ->> 'layoutId'
              = 'MAIN_WHITE_BACKGROUND_CANONICAL_V3'
            and asset.transformation ->> 'compositorContractVersion'
              = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
            and asset.transformation ->> 'authorizedSourceTreatment'
              = 'PRESERVED_FRAMED_SOURCE'
            and asset.transformation ->> 'mainEncodingProfile'
              = 'JPEG_Q93_444_MOZJPEG_V3'
            and asset.transformation ->> 'competitorImageUsed' = 'false'
            and asset.transformation ->> 'originalPackagePixelsPreserved' = 'true'
            and asset.transformation ->> 'verifiedFactsOnly' = 'true'
            and asset.qa_result ->> 'mainBackground'
              = 'FRAMED_AUTHORIZED_SOURCE'
            and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
            and asset.qa_result ->> 'deterministicBackgroundSelection' = 'false'
            and asset.qa_result ->> 'humanApprovalRequired' = 'true'
            and case
              when jsonb_typeof(asset.qa_result -> 'foregroundEdgeCoverage')
                = 'number' then (
                  asset.qa_result ->> 'foregroundEdgeCoverage'
                )::numeric between 0.004 and 1
              else false
            end
            and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
            and asset.qa_result -> 'manualChecksRequired' @> jsonb_build_array(
              'AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL',
              'FRAMED_MAIN_BACKGROUND_HUMAN_ACCEPTANCE'
            )
          )
          or
          (
            asset.transformation ->> 'slot' = 'USE_CONTEXT'
$new$;
begin
  select pg_get_functiondef(
    'public.assert_same_day_pilot_image_set_safe(uuid,uuid,uuid[])'::regprocedure
  ) into v_definition;
  if v_definition is null
    or strpos(v_definition, v_old_partial_count) = 0
    or strpos(v_definition, v_old_partial_guard) = 0 then
    raise exception 'FRAMED_MAIN_VALIDATOR_BASE_CONTRACT_NOT_FOUND';
  end if;

  v_updated_definition := replace(
    replace(v_definition, v_old_partial_count, v_new_partial_count),
    v_old_partial_guard,
    v_new_partial_guard
  );
  execute v_updated_definition;
end;
$migration$;

comment on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) is 'Validates legacy and high-quality V3 image sets; admits an exact non-generative framed authorized main only with V5 edge-preservation and human-review evidence.';

-- Create a distinct append-only recovery lane for the framed-main validator.
-- It reuses the already audited recovery mechanics but receives unique hashes,
-- job keys, event codes and function identity so the previous failed attempt
-- remains immutable.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.resume_same_day_image_after_v3_evidence_validator_v1(text,uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or strpos(v_definition,
      'resume_same_day_image_after_v3_evidence_validator_v1') = 0
    or strpos(v_definition, 'SAME_DAY_V3_VALIDATOR_RECOVERY') = 0
    or strpos(v_definition,
      'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21') = 0 then
    raise exception 'FRAMED_MAIN_RECOVERY_BASE_CONTRACT_NOT_FOUND';
  end if;

  v_definition := replace(
    v_definition,
    'resume_same_day_image_after_v3_evidence_validator_v1',
    'resume_same_day_image_after_framed_main_validator_v1'
  );
  v_definition := replace(
    v_definition,
    'SAME_DAY_V3_VALIDATOR_RECOVERY',
    'SAME_DAY_FRAMED_MAIN_RECOVERY'
  );
  v_definition := replace(
    v_definition,
    'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
    'FRAMED_MAIN_VALIDATOR_V1_2026_07_21'
  );
  v_definition := replace(
    v_definition,
    'VISUAL_STRATEGY_V3_VALIDATOR_V1',
    'FRAMED_MAIN_VALIDATOR_V1'
  );
  v_definition := replace(
    v_definition,
    'SAME_DAY_IMAGE_V3_VALIDATOR_RECOVERY_CREATED',
    'SAME_DAY_IMAGE_FRAMED_MAIN_RECOVERY_CREATED'
  );
  execute v_definition;
end;
$migration$;

revoke all on function public.resume_same_day_image_after_framed_main_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.resume_same_day_image_after_framed_main_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_same_day_image_after_framed_main_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is 'Creates one append-only recovery after admitting the strict framed authorized main contract; prior controls remain immutable and no eBay write is possible.';

notify pgrst, 'reload schema';
