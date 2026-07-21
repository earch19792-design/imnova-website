-- A Visual Evidence V2 recapture creates a new market brief and handoff, so
-- its image-generation job must not reuse the completed legacy idempotency
-- key. This recovery appends one capture-bound job and preserves the old job,
-- rejected image control, assets and audit history.

create or replace function public.resume_same_day_visual_v2_image_generation_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_completed_job_id uuid,
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
  v_capture public.marketplace_product_research_capture_batches%rowtype;
  v_old_job public.ebay_same_day_pilot_jobs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_fact_run_id uuid;
  v_job_key text;
  v_event_key text;
  v_checkpoint jsonb;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_capture_batch_id is null
    or p_expected_completed_job_id is null
    or p_now is null then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_CANDIDATE_NOT_FOUND';
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
    or v_run.created_by is distinct from p_actor then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_RUN_SCOPE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_CANDIDATE_SCOPE_INVALID';
  end if;

  select job.* into v_old_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_completed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for key share;
  if not found
    or v_old_job.status <> 'COMPLETED'
    or v_old_job.completed_at is null
    or v_old_job.lease_owner is not null
    or v_old_job.lease_token is not null
    or v_old_job.lease_expires_at is not null then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_OLD_JOB_INVALID';
  end if;

  select batch.* into v_capture
  from public.marketplace_product_research_capture_batches batch
  where batch.id = p_expected_capture_batch_id
    and batch.marketplace_account_key = p_account_key
    and batch.marketplace = 'EBAY_US'
  for key share;
  if not found
    or v_capture.captured_at <= v_old_job.completed_at
    or v_capture.source_row_count <= 0
    or v_capture.valid_count <= 0
    or v_capture.valid_count + v_capture.rejected_count
      <> v_capture.source_row_count then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_CAPTURE_INVALID';
  end if;

  begin
    v_fact_run_id := nullif(
      v_candidate.product_facts_summary ->> 'factRunId', ''
    )::uuid;
  exception when others then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_FACT_BINDING_INVALID';
  end;
  if v_fact_run_id is null then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_FACT_BINDING_MISSING';
  end if;

  select handoff.* into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.fact_run_id = v_fact_run_id
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  order by handoff.created_at desc, handoff.id desc
  limit 1
  for key share;
  if not found
    or v_handoff.created_at <= v_old_job.completed_at
    or v_handoff.package_hash
      <> coalesce(v_candidate.manual_handoff_package ->> 'packageHash', '')
    or v_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_handoff.image_count < 1
    or v_handoff.openai_calls <> 0
    or v_handoff.ebay_writes <> 0
    or v_handoff.production_changed then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_HANDOFF_INVALID';
  end if;

  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':GENERATE_SIX_IMAGE_PACKAGE:VISUAL_V2:'
    || p_expected_capture_batch_id::text || ':' || v_handoff.package_hash;
  v_event_key := v_job_key || ':RESUMED';

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key
  for key share;
  if found then
    if v_new_job.run_id <> v_run.id
      or v_new_job.candidate_id is distinct from p_candidate_id
      or v_new_job.job_type <> 'GENERATE_SIX_IMAGE_PACKAGE'
      or v_new_job.checkpoint ->> 'productResearchCaptureBatchId'
        <> p_expected_capture_batch_id::text
      or v_new_job.checkpoint ->> 'packageHash' <> v_handoff.package_hash then
      raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'jobId', v_new_job.id,
      'jobStatus', v_new_job.status,
      'machineState', v_candidate.machine_state,
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_run.status <> 'ACTIVE'
    or v_run.stage <> 'PREPARING_IMAGE_PACKAGE'
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
    or v_candidate.state <> 'READY_FOR_CONTENT'
    or v_candidate.machine_state <> 'PREPARING_IMAGE_PACKAGE'
    or cardinality(v_candidate.blockers) <> 0 then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_STATE_INVALID';
  end if;

  if exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.run_id = v_run.id
        and task.status = 'OPEN'
    ) then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_LANE_BUSY';
  end if;

  v_checkpoint := jsonb_build_object(
    'packageHash', v_handoff.package_hash,
    'factRunId', v_fact_run_id,
    'productResearchCaptureBatchId', p_expected_capture_batch_id,
    'generationAttemptVersion', 'VISUAL_V2_CAPTURE_BOUND_V1_2026_07_21',
    'supersededCompletedJobId', v_old_job.id,
    'maximumOpenAiCalls', 1,
    'competitorImages', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );

  insert into public.ebay_same_day_pilot_jobs (
    run_id, candidate_id, job_type, status, idempotency_key, checkpoint,
    attempt, max_attempts, available_at, created_at, updated_at
  ) values (
    v_run.id, p_candidate_id, 'GENERATE_SIX_IMAGE_PACKAGE', 'PENDING',
    v_job_key, v_checkpoint, 0, 4, p_now, p_now, p_now
  ) returning * into v_new_job;

  update public.ebay_same_day_pilot_candidates candidate
  set next_automated_action =
        'Generar el nuevo paquete visual ligado a la captura V2.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set next_automated_action =
        'Procesar el paquete visual ligado a la captura V2.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where run.id = v_run.id
    and run.status = 'ACTIVE';
  if not found then
    raise exception 'SAME_DAY_VISUAL_V2_IMAGE_RESUME_RUN_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'VISUAL_V2_IMAGE_GENERATION_RESUMED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'newJobId', v_new_job.id,
      'supersededCompletedJobId', v_old_job.id,
      'generationAttemptVersion',
        'VISUAL_V2_CAPTURE_BOUND_V1_2026_07_21',
      'historyPreserved', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'jobId', v_new_job.id,
    'jobStatus', v_new_job.status,
    'machineState', v_candidate.machine_state,
    'oldJobPreserved', true,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.resume_same_day_visual_v2_image_generation_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.resume_same_day_visual_v2_image_generation_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_same_day_visual_v2_image_generation_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) is
  'Appends one capture-bound Visual V2 image job after a completed legacy job while preserving all prior controls, assets and audit history.';

notify pgrst, 'reload schema';
