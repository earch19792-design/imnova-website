-- Missing or weak competitor imagery is not a product rejection reason.
-- The image provider may create empty professional background plates from the
-- explicit fallback prompt while the exact authorized Luna pixels remain the
-- only product representation. This gate keeps market-evidence metadata strict
-- when evidence is used and records a separate, explicit no-evidence policy.

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
  v_secondary_objective_count integer;
  v_qa_not_passed integer;
  v_invalid_count integer;
begin
  if p_control_id is null or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 7
    or (select count(distinct id) from unnest(p_asset_ids) id) <> 7 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SEVEN_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  perform 1 from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for update;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(distinct asset.transformation #>>
      '{visualStrategyPosition,salesObjective}') filter (
        where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      ),
    count(*) filter (where asset.id is null
      or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600 or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation ->> 'compositorContractVersion'
        <> 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      or asset.transformation ->> 'sourceVisualPolicy'
        is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or asset.transformation ->> 'authorizedSourceViewReused'
        is distinct from 'true'
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.qa_result ->> 'sourceViewCapabilityPassed' is distinct from 'true'
      or asset.qa_result ->> 'marketSignalsLimitedToScene' is distinct from 'true'
      or asset.qa_result ->> 'hiddenProductGeometryGenerated' is distinct from 'false'
      or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
      or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
      or asset.qa_result ->> 'technicalQualityPassed' is distinct from 'true'
      or asset.qa_result ->> 'productCoveragePassed' is distinct from 'true'
      or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
      or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
      or asset.qa_result ->> 'mobileReadabilityPassed' is distinct from 'true'
      or asset.qa_result ->> 'qaEvaluatorVersion'
        is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
      or coalesce(jsonb_array_length(asset.qa_result -> 'failureReasons'), -1) <> 0
      or coalesce(jsonb_array_length(asset.qa_result -> 'blockers'), -1) <> 0
      or coalesce((asset.qa_result ->> 'textLineCount')::integer, -1) <> 0
      or coalesce((asset.qa_result ->> 'textMinimumPixelSize')::integer, -1) <> 0
      or case
        when asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND' then
          asset.transformation ->> 'generativeAiUsed' is distinct from 'false'
          or coalesce((asset.qa_result ->> 'outputEdgeWhiteRatio')::numeric, 0) < .90
          or coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .75 and .85
          or asset.transformation ? 'visualStrategyPosition'
        else
          coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .50 and .70
          or asset.transformation #>> '{visualStrategyPosition,feasibilityStatus}'
            is distinct from 'FEASIBLE'
          or coalesce(asset.transformation #>>
            '{visualStrategyPosition,contractHash}', '') !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation #>>
            '{visualStrategyPosition,salesObjective}', '') not in (
              'DETAIL_AND_MATERIAL', 'PACKAGE_CONTENTS', 'SIZE_AND_SCALE',
              'PRIMARY_USE', 'ASPIRATIONAL_LIFESTYLE',
              'TRUST_OR_OBJECTION', 'ALTERNATE_AUTHORIZED_ANGLE',
              'SECONDARY_USE', 'QUALITY_DETAIL',
              'RETURN_RISK_CLARIFICATION'
            )
        end
      or (
        asset.transformation ->> 'generativeAiUsed' = 'true'
        and (
          asset.transformation ->> 'backgroundPlateQuality' <> 'high'
          or coalesce(asset.transformation ->> 'promptHash', '')
            !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation ->> 'visualEvidenceMode', '')
            not in ('MARKET_SIGNAL_PROMPT', 'PROFESSIONAL_FALLBACK')
          or (
            asset.transformation ->> 'visualEvidenceMode'
              = 'MARKET_SIGNAL_PROMPT'
            and (
              coalesce(asset.transformation ->> 'marketSignalHash', '')
                !~ '^[0-9a-f]{64}$'
              or coalesce(
                asset.transformation ->> 'marketSignalConfidence',
                ''
              ) not in ('HIGH', 'MEDIUM')
              or coalesce(
                asset.transformation ->> 'marketSignalObservedAt',
                ''
              ) = ''
              or coalesce(
                asset.transformation ->> 'marketSignalFreshUntil',
                ''
              ) = ''
            )
          )
          or (
            asset.transformation ->> 'visualEvidenceMode'
              = 'PROFESSIONAL_FALLBACK'
            and (
              asset.transformation ->> 'professionalFallbackPolicy'
                is distinct from 'PROFESSIONAL_FALLBACK_EXPLICIT'
              or asset.transformation ->> 'professionalFallbackReason'
                is distinct from
                  'MARKET_VISUAL_EVIDENCE_UNAVAILABLE_OR_BELOW_THRESHOLD'
              or asset.transformation ->> 'competitorEvidenceUsed'
                is distinct from 'false'
              or asset.transformation ? 'marketSignalConfidence'
              or asset.transformation ? 'marketSignalObservedAt'
              or asset.transformation ? 'marketSignalFreshUntil'
            )
          )
        )
      )
    )
  into v_asset_count, v_slot_count, v_secondary_objective_count,
    v_qa_not_passed, v_invalid_count
  from unnest(p_asset_ids) requested(id)
  left join public.ebay_listing_image_assets asset on asset.id = requested.id;

  if v_qa_not_passed <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
  end if;
  if v_asset_count <> 7 or v_slot_count <> 7
    or v_secondary_objective_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) to service_role;
