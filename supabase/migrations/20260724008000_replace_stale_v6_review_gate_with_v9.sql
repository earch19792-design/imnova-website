-- Replace the last approval-only V6/six-image assertion with the current V9
-- one-main-plus-six-secondary contract. The general professional QA gate
-- remains mandatory and this supplemental assertion verifies current matte,
-- zero/rendered-text and generation-mode evidence. Historical functions and
-- rows remain readable. No eBay, OpenAI or Production write occurs here.

create or replace function public.assert_same_day_pilot_image_set_current_v9(
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
  v_main_count integer;
  v_secondary_count integer;
  v_generative_count integer;
  v_ai_secondary_count integer;
  v_deterministic_secondary_count integer;
  v_source_count integer;
  v_presentation_count integer;
  v_single_source_manual_count integer;
  v_objective_count integer;
  v_invalid_count integer;
  v_presentation_mode text;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 7
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 7 then
    raise exception 'SAME_DAY_IMAGE_V9_EXACT_SEVEN_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor;
  if not found
    or v_control.status <> 'PENDING_REVIEW'
    or v_control.generation_mode not in (
      'OPENAI_CONTEXT_PLATE', 'DETERMINISTIC_ONLY'
    )
    or cardinality(v_control.asset_ids) <> 7
    or not (p_asset_ids @> v_control.asset_ids)
    or not (p_asset_ids <@ v_control.asset_ids)
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_IMAGE_V9_CONTROL_INVALID';
  end if;

  perform 1
  from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for update;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (where
      asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      and asset.transformation ->> 'layoutId'
        = 'MAIN_WHITE_BACKGROUND_CANONICAL_V3'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'authorizedSourceTreatment' in (
        'NORMALIZED_LIGHT_NEUTRAL',
        'PRESERVED_FRAMED_SOURCE',
        'LOCAL_AUTHORIZED_FOREGROUND'
      )
      and asset.transformation ->> 'mainEncodingProfile'
        = 'JPEG_Q94_444_MOZJPEG_V4'
      and not (asset.transformation ? 'foregroundMatteVersion')
      and not (asset.transformation ? 'foregroundMatteSha256')
      and not (asset.qa_result ? 'foregroundMatteValidated')
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
      and (asset.qa_result ->> 'textLineCount')::integer = 0
      and jsonb_typeof(asset.qa_result -> 'textMinimumPixelSize') = 'number'
      and (asset.qa_result ->> 'textMinimumPixelSize')::integer = 0
      and asset.qa_result ->> 'textPolicyPassed' = 'true'
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'textSafeAreaVerified')
      and not (asset.qa_result ? 'textGlyphsValidated')
      and asset.qa_result ->> 'automaticStatus' = 'PASSED'
      and asset.qa_result ->> 'mainBackground' = 'PURE_WHITE'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'LOCAL_AUTHORIZED_FOREGROUND'
      and asset.transformation ->> 'foregroundMatteVersion'
        = 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
      and asset.transformation ->> 'foregroundMatteMethod' in (
        'NATIVE_ALPHA',
        'EDGE_CONNECTED_LIGHT_NEUTRAL_V1',
        'PROTECTED_TRIMAP_MATTING_V1',
        'FULL_AUTHORIZED_FRAME'
      )
      and coalesce(
        asset.transformation ->> 'foregroundMatteSha256', ''
      ) ~ '^[0-9a-f]{64}$'
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundBackgroundRemovalRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundBackgroundRemovalRatio'
      )::numeric between 0.02 and 0.98 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundTransparentBorderRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundTransparentBorderRatio'
      )::numeric between 0.99 and 1 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundProtectedPixelRetentionRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundProtectedPixelRetentionRatio'
      )::numeric between 0.9999 and 1 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundOpaqueCornerRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundOpaqueCornerRatio'
      )::numeric between 0 and 0.001 else false end
      and asset.qa_result ->> 'foregroundMatteValidated' = 'true'
      and asset.qa_result ->> 'opaqueSourceFrameRemoved' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
      and asset.qa_result ->> 'textPolicyPassed' = 'true'
      and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        @> jsonb_build_array(
          'AUTHORIZED_FOREGROUND_MATTE_HUMAN_ACCEPTANCE'
        )
      and (
        (
          jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
          and (asset.qa_result ->> 'textLineCount')::integer = 0
          and not (asset.transformation ? 'textRendererVersion')
          and not (asset.qa_result ? 'textSafeAreaVerified')
          and not (asset.qa_result ? 'textGlyphsValidated')
        )
        or
        (
          jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
          and (asset.qa_result ->> 'textLineCount')::integer between 1 and 3
          and asset.transformation ->> 'textRendererVersion'
            = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
          and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
          and asset.qa_result ->> 'textGlyphsValidated' = 'true'
        )
      )
    ),
    count(*) filter (where
      asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'true'
      and asset.transformation ->> 'backgroundPlateVersion'
        = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V4'
      and asset.transformation ->> 'backgroundPlateQuality' = 'high'
      and asset.transformation ->> 'visualStrategyVersion'
        = 'SELLER_OS_EBAY_VISUAL_STRATEGY_V2'
      and asset.transformation ->> 'visualEvidenceMode'
        = 'MARKET_SIGNAL_PROMPT'
      and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'visualEvidenceMode'
        = 'PROFESSIONAL_FALLBACK'
      and asset.qa_result ->> 'deterministicBackgroundSelection' = 'false'
    ),
    count(distinct asset.source_sha256),
    count(distinct asset.transformation ->> 'presentationMode'),
    count(*) filter (where
      jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        ? 'SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS'
    ),
    count(distinct asset.transformation #>>
      '{visualStrategyPosition,salesObjective}') filter (
        where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.source_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version
        <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V2'
      or asset.transformation ->> 'competitorImageUsed'
        is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved'
        is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly'
        is distinct from 'true'
      or asset.transformation ->> 'sourceVisualPolicy'
        is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or asset.transformation ->> 'authorizedSourceViewReused'
        is distinct from 'true'
      or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
      or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
      or asset.qa_result ->> 'commercialQualityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'technicalQualityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
      or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
      or asset.qa_result ->> 'mobileReadabilityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'sourceViewCapabilityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'marketSignalsLimitedToScene'
        is distinct from 'true'
      or asset.qa_result ->> 'hiddenProductGeometryGenerated'
        is distinct from 'false'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND',
        'PACK_AND_COUNT',
        'KEY_FEATURES',
        'SIZE_AND_CONTENT',
        'USE_CONTEXT',
        'PACKAGE_CONTENTS',
        'SECONDARY_6'
      ])
    ),
    min(asset.transformation ->> 'presentationMode')
  into
    v_asset_count,
    v_slot_count,
    v_main_count,
    v_secondary_count,
    v_generative_count,
    v_ai_secondary_count,
    v_deterministic_secondary_count,
    v_source_count,
    v_presentation_count,
    v_single_source_manual_count,
    v_objective_count,
    v_invalid_count,
    v_presentation_mode
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 7
    or v_slot_count <> 7
    or v_main_count <> 1
    or v_secondary_count <> 6
    or v_objective_count <> 6
    or v_invalid_count <> 0
    or v_presentation_count <> 1
    or v_source_count not between 1 and 3
    or (
      v_presentation_mode = 'SINGLE_SOURCE_INFORMATIONAL'
      and (
        v_source_count <> 1
        or v_single_source_manual_count <> 7
      )
    )
    or (
      v_presentation_mode = 'AUTHORIZED_MULTI_SOURCE'
      and v_source_count not between 2 and 3
    )
    or v_presentation_mode not in (
      'SINGLE_SOURCE_INFORMATIONAL', 'AUTHORIZED_MULTI_SOURCE'
    )
    or (
      v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
      and (
        v_generative_count <> 6
        or v_ai_secondary_count <> 6
      )
    )
    or (
      v_control.generation_mode = 'DETERMINISTIC_ONLY'
      and (
        v_generative_count <> 0
        or v_deterministic_secondary_count <> 6
      )
    ) then
    raise exception 'SAME_DAY_IMAGE_V9_CURRENT_EVIDENCE_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_current_v9(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_current_v9(
  uuid, uuid, uuid[]
) to service_role;

comment on function public.assert_same_day_pilot_image_set_current_v9(
  uuid, uuid, uuid[]
) is
  'Requires one exact V9 main plus six distinct current secondary assets; '
  'zero-text assets carry no fake renderer evidence and AI mode uses all six '
  'secondary scene-board panels.';

-- Keep V6 readable as historical audit evidence, but stop invoking it for
-- current approvals.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old text :=
    'public.assert_same_day_pilot_image_set_current_v6(';
  v_new text :=
    'public.assert_same_day_pilot_image_set_current_v9(';
begin
  select pg_get_functiondef(
    'public.review_ebay_same_day_pilot_image_package_set(uuid,uuid,text,boolean,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'SAME_DAY_IMAGE_V9_REVIEW_FUNCTION_MISSING';
  end if;
  if strpos(v_definition, v_new) = 0 then
    if strpos(v_definition, v_old) = 0 then
      raise exception 'SAME_DAY_IMAGE_V9_REVIEW_PATCH_TARGET_MISSING';
    end if;
    v_updated_definition := replace(v_definition, v_old, v_new);
    if v_updated_definition = v_definition
      or strpos(v_updated_definition, v_old) > 0
      or strpos(v_updated_definition, v_new) = 0 then
      raise exception 'SAME_DAY_IMAGE_V9_REVIEW_PATCH_FAILED';
    end if;
    execute v_updated_definition;
  end if;
end;
$migration$;

-- One append-only recovery for the exact already-approved set that the stale
-- V6 assertion rejected. The dead-letter job and all previous transitions
-- remain immutable; a new idempotent approval job is appended.
create or replace function public.recover_current_v9_exact_seven_sql_gate_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_control_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_approval_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_approval_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_rejection_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_prior_job public.ebay_same_day_pilot_jobs%rowtype;
  v_source_count integer;
  v_single_source_count integer;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_key text;
  v_job_key text;
  v_event_key text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_control_id is null
    or p_now is null then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_CANDIDATE_MISSING';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run.id::text, 0)
  );

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run.id
  for update;
  if not found
    or v_run.marketplace_account_key <> p_account_key
    or v_run.marketplace <> 'EBAY_US'
    or v_run.created_by is distinct from p_actor
    or v_run.status not in (
      'ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR'
    )
    or v_run.worker_lease_token is not null
    or v_run.worker_lease_owner is not null then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_CANDIDATE_MISSING';
  end if;

  v_event_key := v_run.id::text || ':' || p_candidate_id::text
    || ':V9_EXACT_SEVEN_SQL_GATE:' || p_expected_control_id::text;
  if exists (
    select 1
    from public.ebay_same_day_pilot_events event_row
    where event_row.idempotency_key = v_event_key
      and event_row.run_id = v_run.id
      and event_row.candidate_id = p_candidate_id
      and event_row.event_type = 'V9_EXACT_SEVEN_SQL_GATE_RECOVERED'
  ) then
    return jsonb_build_object(
      'recovered', true,
      'effectAlreadyApplied', true,
      'candidateState', v_candidate.machine_state,
      'controlId', p_expected_control_id,
      'ebayWrites', 0,
      'openAiCalls', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.machine_state <> 'REJECTED'
    or v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.blockers <>
      array['SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED']::text[]
    or v_candidate.image_package_summary ->> 'controlId'
      <> p_expected_control_id::text
    or v_candidate.image_package_summary ->> 'status'
      <> 'PENDING_HUMAN_REVIEW'
    or coalesce(
      (v_candidate.image_package_summary ->> 'approved')::boolean,
      false
    )
    or v_candidate.manual_handoff_package ->> 'status'
      <> 'AWAITING_IMAGE_APPROVAL'
    or v_candidate.manual_handoff_package ->> 'version'
      <> 'SELLER_HUB_FACTS_ONLY_V10_2026_07_24' then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_CANDIDATE_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_candidate_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for update;
  if not found
    or v_control.status <> 'PENDING_REVIEW'
    or v_control.generation_mode <> 'DETERMINISTIC_ONLY'
    or v_control.attempt <> 1
    or cardinality(v_control.asset_ids) <> 7
    or coalesce(v_control.image_set_hash, '') !~ '^[0-9a-f]{64}$'
    or v_control.openai_calls <> 0
    or v_control.competitor_image_count <> 0
    or v_control.product_byte_count_sent <> 0
    or v_control.product_url_count_sent <> 0
    or v_control.ebay_writes <> 0
    or v_control.production_changed
    or v_control.provider_request_id is not null
    or v_control.human_decision is not null
    or v_control.reviewed_at is not null
    or v_control.reviewed_by is not null
    or v_control.last_error_code is not null then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_CONTROL_INVALID';
  end if;

  if v_candidate.image_package_summary ->> 'listingPackageId'
      <> v_control.listing_package_id::text
    or jsonb_array_length(coalesce(
      v_candidate.image_package_summary -> 'assetIds', '[]'::jsonb
    )) <> 7 then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_BINDING_INVALID';
  end if;

  select handoff.* into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.fact_run_id = v_control.fact_run_id
    and handoff.package_hash = v_control.handoff_hash
  for key share;
  if not found
    or v_handoff.status <> 'AWAITING_IMAGE_APPROVAL'
    or v_handoff.handoff_version
      <> 'SELLER_HUB_FACTS_ONLY_V10_2026_07_24'
    or v_handoff.operator_price_approved is distinct from true
    or v_handoff.openai_calls <> 0
    or v_handoff.ebay_writes <> 0
    or v_handoff.production_changed then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_HANDOFF_INVALID';
  end if;

  perform public.assert_same_day_pilot_image_set_safe(
    v_control.id, p_actor, v_control.asset_ids
  );
  perform public.assert_same_day_pilot_image_set_current_v9(
    v_control.id, p_actor, v_control.asset_ids
  );

  select
    count(distinct asset.source_sha256),
    count(*) filter (where
      asset.transformation ->> 'presentationMode'
        = 'SINGLE_SOURCE_INFORMATIONAL'
      and asset.qa_result -> 'manualChecksRequired'
        ? 'SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS'
    )
  into v_source_count, v_single_source_count
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_control.asset_ids);
  if v_source_count <> 1 or v_single_source_count <> 7 then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_ASSET_SET_INVALID';
  end if;

  select task.* into v_approval_task
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_run.id
    and task.candidate_id = p_candidate_id
    and task.gate_type = 'IMAGE_APPROVAL_REQUIRED'
    and task.status = 'COMPLETED'
    and task.completed_at is not null
  order by task.created_at desc, task.id desc
  limit 1
  for key share;
  if not found then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_TASK_INVALID';
  end if;

  select transition_row.* into v_approval_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
    and transition_row.previous_state = 'WAITING_IMAGE_APPROVAL'
    and transition_row.next_state = 'BUILDING_SELLER_HUB_HANDOFF'
    and transition_row.reason_code = 'SIX_IMAGE_SET_APPROVAL_CONFIRMED'
    and transition_row.triggered_by = 'USER'
    and transition_row.checkpoint ->> 'controlId'
      = p_expected_control_id::text
    and transition_row.checkpoint ->> 'imageApproval' = 'true'
  order by transition_row.created_at desc, transition_row.id desc
  limit 1
  for key share;
  if not found then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_APPROVAL_MISSING';
  end if;

  select transition_row.* into v_rejection_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1
  for key share;
  if not found
    or v_rejection_transition.previous_state
      <> 'BUILDING_SELLER_HUB_HANDOFF'
    or v_rejection_transition.next_state <> 'REJECTED'
    or v_rejection_transition.reason_code
      <> 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED'
    or v_rejection_transition.triggered_by <> 'SYSTEM' then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_REJECTION_INVALID';
  end if;

  select job.* into v_prior_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'APPROVE_SIX_IMAGE_SET'
    and job.idempotency_key =
      v_run.id::text || ':' || p_candidate_id::text
        || ':APPROVE_SIX_IMAGE_SET:V9_SINGLE_SOURCE_APPROVAL_CONTRACT:'
        || p_expected_control_id::text
  for update;
  if not found
    or v_prior_job.status <> 'DEAD_LETTER'
    or v_prior_job.attempt <> 1
    or v_prior_job.max_attempts <> 4
    or v_prior_job.last_error_code
      <> 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED'
    or v_prior_job.completed_at is not null
    or v_prior_job.lease_owner is not null
    or v_prior_job.lease_token is not null
    or v_prior_job.lease_expires_at is not null
    or v_prior_job.checkpoint ->> 'recoveryVersion'
      <> 'V9_SINGLE_SOURCE_ZERO_TEXT_REVIEW_CONTRACT_V1_2026_07_24'
    or coalesce(
      (v_prior_job.checkpoint ->> 'ebayWrites')::integer, 0
    ) <> 0
    or coalesce(
      (v_prior_job.checkpoint ->> 'openAiCalls')::integer, 0
    ) <> 0
    or v_prior_job.checkpoint ->> 'controlId'
      <> p_expected_control_id::text then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_JOB_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.id <> v_prior_job.id
      and job.status in (
        'PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER'
      )
  ) then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_LANE_BUSY';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.job_type in (
        'PREPARE_UNPUBLISHED_OFFER',
        'PUBLISH_AUTHORIZED_OFFER',
        'VERIFY_ACTIVE_LISTING'
      )
  ) then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_PUBLICATION_EXISTS';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_events event_row
    where event_row.run_id = v_run.id
      and event_row.candidate_id = p_candidate_id
      and (
        event_row.ebay_writes <> 0
        or event_row.production_changed
      )
  ) then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_EXTERNAL_EFFECT';
  end if;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion',
      'V9_EXACT_SEVEN_SQL_REVIEW_GATE_V1_2026_07_24',
    'controlId', p_expected_control_id,
    'priorApprovalJobId', v_prior_job.id,
    'approvalTaskId', v_approval_task.id,
    'approvalTransitionId', v_approval_transition.id,
    'rejectionTransitionId', v_rejection_transition.id,
    'originalErrorCode', 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED',
    'reviewValidator', 'assert_same_day_pilot_image_set_current_v9',
    'compositorContractVersion',
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
    'presentationMode', 'SINGLE_SOURCE_INFORMATIONAL',
    'assetCount', 7,
    'secondaryCount', 6,
    'sourceCount', 1,
    'operatorApprovalPreserved', true,
    'historyPreserved', true,
    'researchRepeated', false,
    'imagesRegenerated', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'),
    'hex'
  );
  v_transition_key := v_run.id::text || ':' || p_candidate_id::text
    || ':V9_EXACT_SEVEN_SQL_GATE:' || p_expected_control_id::text;
  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':APPROVE_SIX_IMAGE_SET:V9_EXACT_SEVEN_SQL_GATE:'
    || p_expected_control_id::text;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'BUILDING_SELLER_HUB_HANDOFF',
    'V9_EXACT_SEVEN_SQL_GATE_RECOVERED',
    'RETRY',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Reintentar la aprobación interna del mismo set V9 de siete imágenes.',
    'Ninguna.',
    'APPROVE_SIX_IMAGE_SET',
    v_job_key,
    v_checkpoint,
    p_now,
    4,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result <> 'ADVANCED' then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_IMAGE_REVIEW',
      blockers = '{}'::text[],
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'BUILDING_SELLER_HUB_HANDOFF';
  if not found then
    raise exception 'V9_EXACT_SEVEN_SQL_RECOVERY_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    ebay_read_calls,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'V9_EXACT_SEVEN_SQL_GATE_RECOVERED',
    v_checkpoint,
    v_event_key,
    0,
    0,
    0,
    false
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'recovered', true,
    'effectAlreadyApplied', false,
    'candidateState', 'BUILDING_SELLER_HUB_HANDOFF',
    'jobStatus', 'PENDING',
    'controlId', p_expected_control_id,
    'assetCount', 7,
    'researchRepeated', false,
    'imagesRegenerated', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.recover_current_v9_exact_seven_sql_gate_v1(
  text, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.recover_current_v9_exact_seven_sql_gate_v1(
  text, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.recover_current_v9_exact_seven_sql_gate_v1(
  text, uuid, uuid, uuid, timestamptz
) is
  'Exact append-only recovery for the current approved V9 seven-image set '
  'rejected only by the retired V6 six-image SQL assertion; performs zero '
  'eBay, OpenAI or Production writes.';

notify pgrst, 'reload schema';
