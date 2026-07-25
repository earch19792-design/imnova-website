-- Accept the current Visual Strategy V2 / scene-board V3 / compositor V5
-- evidence contract while preserving review of historical V1 and V2 sets.
-- One OpenAI response may supply the five secondary backgrounds; the exact
-- authorized main remains deterministic. No competitor image, eBay write or
-- Production capability is introduced.

create or replace function public.assert_same_day_pilot_image_set_safe(
  p_control_id uuid,
  p_actor uuid,
  p_asset_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_asset_count integer;
  v_slot_count integer;
  v_partial_count integer;
  v_generative_count integer;
  v_safe_v1_count integer;
  v_safe_v2_count integer;
  v_safe_v3_count integer;
  v_invalid_count integer;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SIX_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
    ),
    count(*) filter (
      where asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' = 'USE_CONTEXT'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2'
        and asset.transformation ->> 'compositorContractVersion'
          = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V4_2026_07_21'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.transformation ->> 'competitorImageUsed' = 'false'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
        and asset.transformation ->> 'compositorContractVersion'
          = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
        and asset.transformation ->> 'visualStrategyVersion'
          = 'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.transformation ->> 'competitorImageUsed' = 'false'
        and case
          when jsonb_typeof(
            asset.transformation -> 'selectedSceneBoardPanel'
          ) = 'number' then (
            asset.transformation ->> 'selectedSceneBoardPanel'
          )::numeric between 1 and 6
          else false
        end
        and jsonb_typeof(
          asset.transformation -> 'candidateSceneBoardPanels'
        ) = 'array'
        and case
          when jsonb_typeof(
            asset.transformation -> 'candidateSceneBoardPanels'
          ) = 'array' then jsonb_array_length(
            asset.transformation -> 'candidateSceneBoardPanels'
          ) between 1 and 2
          else false
        end
        and asset.transformation -> 'candidateSceneBoardPanels'
          @> jsonb_build_array(
            asset.transformation -> 'selectedSceneBoardPanel'
          )
        and case
          when jsonb_typeof(
            asset.transformation -> 'backgroundCompatibilityScore'
          ) = 'number' then (
            asset.transformation ->> 'backgroundCompatibilityScore'
          )::numeric between 0 and 100
          else false
        end
        and jsonb_typeof(asset.transformation -> 'sourceVisualProfile')
          = 'object'
        and asset.transformation #>> '{sourceVisualProfile,brightness}'
          in ('DARK', 'MID', 'LIGHT')
        and asset.transformation #>> '{sourceVisualProfile,contrast}'
          in ('LOW', 'MEDIUM', 'HIGH')
        and asset.transformation #>> '{sourceVisualProfile,palette}'
          in ('COOL', 'NEUTRAL', 'WARM', 'MIXED')
        and asset.transformation #>> '{sourceVisualProfile,productToneRisk}'
          in ('LIGHT_NEUTRAL_AMBIGUITY', 'STANDARD')
        and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
        and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.candidate_key is distinct from (
        select candidate.candidate_key
        from public.ebay_same_day_pilot_candidates candidate
        where candidate.id = v_control.candidate_id
      )
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
        'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
      ])
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved' is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly' is distinct from 'true'
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or coalesce(asset.qa_result ->> 'automaticStatus', '')
        not in ('PASSED', 'PARTIAL')
      or (
        asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and not (
          (
            asset.transformation ->> 'slot' = 'USE_CONTEXT'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
            and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
              ~ '^[0-9a-f]{64}$'
            and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
              ~ '^[0-9a-f]{64}$'
          )
          or
          (
            asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2'
            and asset.transformation ->> 'compositorContractVersion'
              = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V4_2026_07_21'
            and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
              ~ '^[0-9a-f]{64}$'
            and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
              ~ '^[0-9a-f]{64}$'
          )
          or
          (
            asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
            and asset.transformation ->> 'compositorContractVersion'
              = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
            and asset.transformation ->> 'visualStrategyVersion'
              = 'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21'
            and coalesce(
              asset.transformation ->> 'backgroundPlateRequestHash', ''
            ) ~ '^[0-9a-f]{64}$'
            and coalesce(
              asset.transformation ->> 'backgroundPlateOutputSha256', ''
            ) ~ '^[0-9a-f]{64}$'
            and case
              when jsonb_typeof(
                asset.transformation -> 'selectedSceneBoardPanel'
              ) = 'number' then (
                asset.transformation ->> 'selectedSceneBoardPanel'
              )::numeric between 1 and 6
              else false
            end
            and jsonb_typeof(
              asset.transformation -> 'candidateSceneBoardPanels'
            ) = 'array'
            and case
              when jsonb_typeof(
                asset.transformation -> 'candidateSceneBoardPanels'
              ) = 'array' then jsonb_array_length(
                asset.transformation -> 'candidateSceneBoardPanels'
              ) between 1 and 2
              else false
            end
            and asset.transformation -> 'candidateSceneBoardPanels'
              @> jsonb_build_array(
                asset.transformation -> 'selectedSceneBoardPanel'
              )
            and case
              when jsonb_typeof(
                asset.transformation -> 'backgroundCompatibilityScore'
              ) = 'number' then (
                asset.transformation ->> 'backgroundCompatibilityScore'
              )::numeric between 0 and 100
              else false
            end
            and jsonb_typeof(
              asset.transformation -> 'sourceVisualProfile'
            ) = 'object'
            and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
            and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
          )
        )
      )
    )
  into v_asset_count, v_slot_count, v_partial_count, v_generative_count,
    v_safe_v1_count, v_safe_v2_count, v_safe_v3_count, v_invalid_count
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID';
  end if;
  if v_control.generation_mode = 'OPENAI_CONTEXT_PLATE' and not (
    (v_partial_count = 1 and v_generative_count = 1 and v_safe_v1_count = 1)
    or
    (v_partial_count = 5 and v_generative_count = 5 and v_safe_v2_count = 5)
    or
    (v_partial_count = 5 and v_generative_count = 5 and v_safe_v3_count = 5)
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_AI_CONTEXT_INVALID';
  end if;
  if v_control.generation_mode = 'DETERMINISTIC_ONLY' and (
    v_partial_count <> 0 or v_generative_count <> 0
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_DETERMINISTIC_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) to service_role;

comment on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) is 'Validates legacy context sets and the Visual Strategy V2 scene-board V3/compositor V5 contract; exact authorized main and human review remain mandatory.';

notify pgrst, 'reload schema';
