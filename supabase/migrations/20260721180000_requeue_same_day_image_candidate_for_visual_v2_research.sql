-- Return one exact same-day candidate from image review to Product Research
-- when its current capture predates Visual Evidence V2. The rejected image set
-- and original capture remain append-only audit evidence. No OpenAI call, eBay
-- write, Production mutation, table rebuild, or deletion is performed.

create or replace function public.requeue_same_day_image_candidate_for_visual_v2_research_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
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
  v_human_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_image_job public.ebay_same_day_pilot_jobs%rowtype;
  v_query_task public.marketplace_product_research_query_tasks%rowtype;
  v_query_plan public.marketplace_product_research_query_plans%rowtype;
  v_review jsonb;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_result text;
  v_transition_key text;
  v_event_key text;
  v_previous_plan_id text;
  v_legacy_visual_count integer;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_capture_batch_id is null
    or p_expected_control_id is null
    or p_now is null then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CANDIDATE_NOT_FOUND';
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
    or v_run.status not in ('ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR')
    or v_run.worker_lease_token is not null
    or v_run.worker_lease_owner is not null then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CANDIDATE_NOT_FOUND';
  end if;

  v_transition_key := v_run.id::text || ':' || p_candidate_id::text
    || ':VISUAL_V2_RESEARCH_REQUEUE:' || p_expected_control_id::text;
  v_event_key := 'same-day-image:' || p_expected_control_id::text
    || ':visual-v2-research-requeue';

  if v_candidate.machine_state = 'PRODUCT_RESEARCH_PLAN_READY'
    and v_candidate.state = 'NEEDS_PRODUCT_RESEARCH_CAPTURE'
    and v_candidate.product_research_capture_batch_id is null
    and v_candidate.image_package_summary ->> 'supersededControlId'
      = p_expected_control_id::text
    and exists (
      select 1
      from public.ebay_same_day_pilot_events event
      where event.idempotency_key = v_event_key
        and event.run_id = v_run.id
        and event.candidate_id = p_candidate_id
    ) then
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'captureBatchId', p_expected_capture_batch_id,
      'controlId', p_expected_control_id,
      'machineState', 'PRODUCT_RESEARCH_PLAN_READY',
      'candidateState', 'NEEDS_PRODUCT_RESEARCH_CAPTURE',
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.machine_state <> 'WAITING_IMAGE_APPROVAL'
    or v_candidate.state <> 'READY_FOR_IMAGE_REVIEW'
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id
    or v_candidate.image_package_summary ->> 'controlId'
      <> p_expected_control_id::text then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CANDIDATE_INVALID';
  end if;

  if exists (
    select 1
    from public.marketplace_product_research_visual_pattern_observations visual
    where visual.capture_batch_id = p_expected_capture_batch_id
      and visual.marketplace_account_key = p_account_key
      and visual.marketplace = 'EBAY_US'
      and visual.visual_pattern_schema_version
        = 'PRODUCT_RESEARCH_VISUAL_PATTERN_V2_2026_07_21'
  ) or exists (
    select 1
    from public.marketplace_product_research_visual_market_briefs brief
    where brief.capture_batch_id = p_expected_capture_batch_id
      and brief.marketplace_account_key = p_account_key
      and brief.marketplace = 'EBAY_US'
      and brief.visual_market_brief_version
        = 'VISUAL_MARKET_BRIEF_V2_2026_07_21'
  ) then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CURRENT_EVIDENCE_EXISTS';
  end if;

  select count(*) into v_legacy_visual_count
  from public.marketplace_product_research_visual_pattern_observations visual
  where visual.capture_batch_id = p_expected_capture_batch_id
    and visual.marketplace_account_key = p_account_key
    and visual.marketplace = 'EBAY_US';

  select query_task.* into v_query_task
  from public.marketplace_product_research_query_tasks query_task
  where query_task.capture_batch_id = p_expected_capture_batch_id
    and query_task.marketplace_account_key = p_account_key
    and query_task.marketplace = 'EBAY_US'
  order by query_task.created_at desc, query_task.id desc
  limit 1
  for update;
  if not found
    or v_query_task.status <> 'PROCESSED'
    or trim(v_query_task.search_query)
      <> trim(coalesce(v_candidate.product_research_query_plan ->> 'query', ''))
    or exists (
      select 1
      from public.marketplace_product_research_query_tasks duplicate_task
      where duplicate_task.capture_batch_id = p_expected_capture_batch_id
        and duplicate_task.id <> v_query_task.id
    ) then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_QUERY_TASK_INVALID';
  end if;

  select query_plan.* into v_query_plan
  from public.marketplace_product_research_query_plans query_plan
  where query_plan.id = v_query_task.plan_id
    and query_plan.marketplace_account_key = p_account_key
    and query_plan.marketplace = 'EBAY_US'
  for update;
  if not found
    or v_query_plan.status not in ('ACTIVE', 'COMPLETED')
    or v_query_plan.openai_calls <> 0
    or v_query_plan.ebay_writes <> 0 then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_QUERY_PLAN_INVALID';
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
    or cardinality(v_control.asset_ids) <> 6
    or v_control.openai_calls <> 0
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CONTROL_INVALID';
  end if;

  if (
    select count(*)
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_control.asset_ids)
      and asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.status = 'pending_review'
  ) <> 6 then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_ASSETS_INVALID';
  end if;

  select handoff.* into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for share;
  if not found
    or v_handoff.openai_calls <> 0
    or v_handoff.ebay_writes <> 0
    or v_handoff.production_changed then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_HANDOFF_INVALID';
  end if;

  select task.* into v_human_task
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_run.id
    and task.candidate_id = p_candidate_id
    and task.gate_type = 'IMAGE_APPROVAL_REQUIRED'
    and task.status = 'OPEN'
  order by task.created_at desc, task.id desc
  limit 1
  for update;
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_HUMAN_TASK_INVALID';
  end if;

  select job.* into v_image_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  order by job.created_at desc, job.id desc
  limit 1
  for update;
  if not found
    or v_image_job.status <> 'COMPLETED'
    or v_image_job.lease_owner is not null
    or v_image_job.lease_token is not null
    or v_image_job.lease_expires_at is not null then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_IMAGE_JOB_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  ) then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_LANE_BUSY';
  end if;

  v_review := public.review_ebay_same_day_pilot_image_package_set(
    p_expected_control_id, p_actor, 'REJECT', true, '[]'::jsonb
  );
  if v_review ->> 'status' <> 'REJECTED' then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_REJECTION_FAILED';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set status = 'SUPERSEDED',
      completed_at = p_now,
      updated_at = p_now
  where task.id = v_human_task.id
    and task.status = 'OPEN';
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_HUMAN_TASK_PATCH_FAILED';
  end if;

  update public.marketplace_product_research_query_tasks query_task
  set status = 'PENDING',
      capture_batch_id = null,
      captured_at = null,
      processed_at = null,
      last_error_code = 'VISUAL_V2_RECAPTURE_REQUIRED',
      updated_at = p_now
  where query_task.id = v_query_task.id
    and query_task.status = 'PROCESSED'
    and query_task.capture_batch_id = p_expected_capture_batch_id;
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_QUERY_TASK_PATCH_FAILED';
  end if;

  update public.marketplace_product_research_query_plans query_plan
  set status = 'ACTIVE',
      completed_at = null,
      updated_at = p_now
  where query_plan.id = v_query_plan.id;

  v_previous_plan_id := v_run.source_inventory ->> 'productResearchPlanId';
  v_checkpoint := jsonb_build_object(
    'recoveryVersion', 'VISUAL_V2_RESEARCH_REQUEUE_V1_2026_07_21',
    'supersededCaptureBatchId', p_expected_capture_batch_id,
    'supersededControlId', p_expected_control_id,
    'supersededAssetCount', 6,
    'legacyVisualObservationCount', v_legacy_visual_count,
    'requiredVisualPatternSchemaVersion',
      'PRODUCT_RESEARCH_VISUAL_PATTERN_V2_2026_07_21',
    'requiredVisualMarketBriefVersion',
      'VISUAL_MARKET_BRIEF_V2_2026_07_21',
    'productResearchPlanId', v_query_plan.id,
    'productResearchQueryTaskId', v_query_task.id,
    'previousProductResearchPlanId', v_previous_plan_id,
    'existingProductApprovalRetainedForRevalidation', true,
    'oldEvidencePreserved', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'), 'hex'
  );

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'WAITING_IMAGE_APPROVAL',
    'PRODUCT_RESEARCH_PLAN_READY',
    'VISUAL_V2_RESEARCH_REQUIRED',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Esperar una captura nueva con Visual Evidence V2.',
    'Abrir la consulta exacta de Calypso y pulsar Capturar y continuar.',
    null::text,
    null::text,
    null::jsonb,
    p_now,
    4,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result <> 'ADVANCED' then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'NEEDS_PRODUCT_RESEARCH_CAPTURE',
      blockers = '{}'::text[],
      product_research_capture_batch_id = null,
      product_research_query_plan = candidate.product_research_query_plan
        || jsonb_build_object('productResearchPlanId', v_query_plan.id),
      evidence_summary = candidate.evidence_summary || jsonb_build_object(
        'visualMarketEvidenceStatus', 'RECAPTURE_REQUIRED_V2',
        'visualMarketEvidenceReason', 'LEGACY_VISUAL_SCHEMA_ONLY',
        'requiredVisualPatternSchemaVersion',
          'PRODUCT_RESEARCH_VISUAL_PATTERN_V2_2026_07_21',
        'requiredVisualMarketBriefVersion',
          'VISUAL_MARKET_BRIEF_V2_2026_07_21',
        'supersededVisualCaptureBatchId', p_expected_capture_batch_id
      ),
      image_package_summary = jsonb_build_object(
        'status', 'SUPERSEDED_PENDING_VISUAL_V2_RESEARCH',
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'supersededControlId', p_expected_control_id,
        'supersededAssetCount', 6,
        'regenerationReason', 'VISUAL_V2_EVIDENCE_REQUIRED',
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      next_automated_action =
        'Esperar una captura nueva con Visual Evidence V2.',
      next_human_action =
        'Abrir la consulta exacta de Calypso y pulsar Capturar y continuar.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PRODUCT_RESEARCH_PLAN_READY';
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_RESEARCH_REQUEUE_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PRODUCT_RESEARCH_RECAPTURE_REQUIRED',
      source_inventory = run.source_inventory || jsonb_build_object(
        'productResearchPlanId', v_query_plan.id,
        'productResearchPlanActivatedForCandidateId', p_candidate_id,
        'productResearchPlanActivatedAt', p_now,
        'visualResearchRecoveryVersion',
          'VISUAL_V2_RESEARCH_REQUEUE_V1_2026_07_21',
        'visualResearchRecoveryCandidateId', p_candidate_id,
        'visualResearchRecoveryRequestedAt', p_now
      ),
      next_automated_action =
        'Procesar la captura V2 sin repetir Discovery.',
      next_human_action =
        'Recapturar la consulta exacta indicada por Seller OS.',
      updated_at = p_now
  where run.id = v_run.id;

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'VISUAL_V2_RESEARCH_REQUEUE_REQUESTED',
    v_checkpoint,
    v_event_key,
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'captureBatchId', p_expected_capture_batch_id,
    'controlId', p_expected_control_id,
    'productResearchPlanId', v_query_plan.id,
    'productResearchQueryTaskId', v_query_task.id,
    'machineState', 'PRODUCT_RESEARCH_PLAN_READY',
    'candidateState', 'NEEDS_PRODUCT_RESEARCH_CAPTURE',
    'imageControlStatus', 'REJECTED',
    'queryTaskStatus', 'PENDING',
    'idempotent', false,
    'oldEvidencePreserved', true,
    'existingProductApprovalRetainedForRevalidation', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.requeue_same_day_image_candidate_for_visual_v2_research_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.requeue_same_day_image_candidate_for_visual_v2_research_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.requeue_same_day_image_candidate_for_visual_v2_research_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) is
  'Rejects one exact unapproved legacy image set and returns its candidate to an exact Product Research recapture for Visual Evidence V2. Historical rows remain append-only; OpenAI, eBay and Production writes remain zero.';

notify pgrst, 'reload schema';
