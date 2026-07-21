-- Resume an exact single-source image job only after the Preview runtime has
-- been externally verified as OpenAI READY. The failed job and rejection
-- transition remain immutable; recovery appends a new job and audit entries.

create or replace function public.resume_same_day_single_source_image_after_openai_config_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_failed_job_id uuid,
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
  v_failed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_job_key text;
  v_transition_key text;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_capture_batch_id is null
    or p_expected_failed_job_id is null
    or p_now is null then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_CANDIDATE_NOT_FOUND';
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
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_RUN_SCOPE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_CANDIDATE_SCOPE_INVALID';
  end if;

  select batch.* into v_capture
  from public.marketplace_product_research_capture_batches batch
  where batch.id = p_expected_capture_batch_id
    and batch.marketplace_account_key = p_account_key
    and batch.marketplace = 'EBAY_US'
  for key share;
  if not found
    or v_capture.source_row_count <= 0
    or v_capture.valid_count <= 0 then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_CAPTURE_INVALID';
  end if;

  select job.* into v_failed_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_failed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for key share;
  if not found
    or v_failed_job.status <> 'COMPLETED'
    or v_failed_job.last_error_code <> 'EFFECT_ALREADY_APPLIED_RECOVERED'
    or v_failed_job.lease_owner is not null
    or v_failed_job.lease_token is not null
    or v_failed_job.lease_expires_at is not null
    or v_failed_job.checkpoint ->> 'productResearchCaptureBatchId'
      <> p_expected_capture_batch_id::text
    or v_failed_job.checkpoint ->> 'generationAttemptVersion'
      <> 'VISUAL_V2_CAPTURE_BOUND_V1_2026_07_21' then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_FAILED_JOB_INVALID';
  end if;

  select handoff.* into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.package_hash = v_failed_job.checkpoint ->> 'packageHash'
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  order by handoff.created_at desc, handoff.id desc
  limit 1
  for key share;
  if not found
    or v_handoff.package_hash
      <> coalesce(v_candidate.manual_handoff_package ->> 'packageHash', '')
    or v_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_handoff.image_count <> 1
    or v_handoff.openai_calls <> 0
    or v_handoff.ebay_writes <> 0
    or v_handoff.production_changed then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_HANDOFF_INVALID';
  end if;

  v_job_key := v_failed_job.idempotency_key
    || ':OPENAI_CONFIG_RECOVERY:' || p_expected_failed_job_id::text;
  v_transition_key := v_job_key || ':TRANSITION';

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key
  for key share;
  if found then
    if v_new_job.run_id <> v_run.id
      or v_new_job.candidate_id is distinct from p_candidate_id
      or v_new_job.job_type <> 'GENERATE_SIX_IMAGE_PACKAGE'
      or v_new_job.checkpoint ->> 'recoveryFromJobId'
        <> p_expected_failed_job_id::text then
      raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_IDEMPOTENCY_MISMATCH';
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

  select transition_row.* into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1
  for key share;
  if not found
    or v_last_transition.previous_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_last_transition.next_state <> 'REJECTED'
    or v_last_transition.reason_code
      <> 'SAME_DAY_IMAGE_SINGLE_SOURCE_AI_REQUIRED' then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_TRANSITION_INVALID';
  end if;

  if v_run.status <> 'ACTIVE'
    or v_run.stage <> 'PREPARING_IMAGE_PACKAGE'
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
    or v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.machine_state <> 'REJECTED'
    or v_candidate.blockers
      <> array['SAME_DAY_IMAGE_SINGLE_SOURCE_AI_REQUIRED']::text[] then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_STATE_INVALID';
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
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_image_package_runs control
      where control.run_id = v_run.id
        and control.candidate_id = p_candidate_id
        and control.handoff_id = v_handoff.id
    ) then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_LANE_NOT_CLEAN';
  end if;

  v_checkpoint := v_failed_job.checkpoint || jsonb_build_object(
    'recoveryVersion', 'OPENAI_CONFIG_READY_V1_2026_07_21',
    'recoveryFromJobId', p_expected_failed_job_id,
    'originalErrorCode', 'SAME_DAY_IMAGE_SINGLE_SOURCE_AI_REQUIRED',
    'runtimeReadinessVerifiedExternally', true,
    'historyPreserved', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'),
    'hex'
  );

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'PREPARING_IMAGE_PACKAGE',
    'OPENAI_IMAGE_FACTORY_CONFIGURATION_RECOVERED',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Generar el paquete visual con el runtime OpenAI verificado.',
    'Ninguna.',
    'GENERATE_SIX_IMAGE_PACKAGE',
    v_job_key,
    v_checkpoint,
    p_now,
    4,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result <> 'ADVANCED' then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      next_automated_action =
        'Generar el paquete visual con el runtime OpenAI verificado.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Procesar el paquete visual con el runtime OpenAI verificado.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where run.id = v_run.id;

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key;
  if not found then
    raise exception 'SAME_DAY_OPENAI_CONFIG_RECOVERY_JOB_MISSING';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_SINGLE_SOURCE_IMAGE_OPENAI_CONFIG_RECOVERED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'failedJobId', p_expected_failed_job_id,
      'newJobId', v_new_job.id,
      'runtimeReadinessVerifiedExternally', true,
      'historyPreserved', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_job_key || ':EVENT',
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'jobId', v_new_job.id,
    'jobStatus', v_new_job.status,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'failedJobPreserved', true,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.resume_same_day_single_source_image_after_openai_config_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.resume_same_day_single_source_image_after_openai_config_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_same_day_single_source_image_after_openai_config_v1(
  text, uuid, uuid, uuid, uuid, timestamptz
) is
  'Appends one new image job after external Preview runtime readiness verification; preserves the pre-network failed job and rejection history.';

notify pgrst, 'reload schema';
