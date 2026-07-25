-- Resume only the exact Calypso V6 package after the first high-quality
-- provider request exceeded the former 130-second client timeout. The timed
-- out control and its effect-reconciled completed job remain durable evidence.
-- A distinct handoff hash guarantees a distinct control and at most one newly
-- authorized call.

create or replace function public.resume_calypso_after_high_quality_timeout_v1(
  p_confirm_project_ref text,
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_failed_job_id uuid,
  p_expected_failed_control_id uuid,
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
  v_failed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_failed_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_recovery_package jsonb;
  v_recovery_package_hash text;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_job_key text;
  v_transition_key text;
  v_event_key text;
  v_transition_result text;
  v_failed_job_snapshot jsonb;
  v_failed_control_snapshot jsonb;
begin
  if trim(coalesce(p_confirm_project_ref, ''))
      <> 'vsfthqydfrdzulldbfbe'
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is distinct from
      'ab226a81-6d42-4404-a62a-b22d333be398'::uuid
    or p_expected_capture_batch_id is distinct from
      'afd79416-707a-457a-b0d7-ae308eb6589a'::uuid
    or p_expected_failed_job_id is distinct from
      '1d955612-2b93-454c-896e-66288f9ab89f'::uuid
    or p_expected_failed_control_id is distinct from
      '899ece3d-35e6-465c-a084-3223cf2928bc'::uuid
    or p_now is null then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_RECOVERY_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_scheduler_config config
    where config.singleton = true
      and config.enabled
      and config.environment = 'STAGING'
      and config.deployment_scope = 'PREVIEW'
      and config.supabase_project_ref = 'vsfthqydfrdzulldbfbe'
  ) then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_STAGING_SCOPE_REQUIRED';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found
    or v_run.id <> '88f48603-bc28-4ee7-b9ea-44d749ef4676'::uuid then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_RUN_NOT_FOUND';
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
    or v_run.status <> 'ACTIVE'
    or v_run.stage <> 'PREPARING_IMAGE_PACKAGE'
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz)
      > p_now then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_CANDIDATE_NOT_FOUND';
  end if;

  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':GENERATE_SIX_IMAGE_PACKAGE:HIGH_QUALITY_TIMEOUT_230S:'
    || p_expected_failed_control_id::text;
  v_transition_key := v_job_key || ':TRANSITION';
  v_event_key := 'same-day-image:' || p_expected_failed_control_id::text
    || ':high-quality-timeout-230s-recovery';

  if exists (
    select 1
    from public.ebay_same_day_pilot_events event
    where event.idempotency_key = v_event_key
      and event.run_id = v_run.id
      and event.candidate_id = p_candidate_id
      and event.event_type =
        'SAME_DAY_IMAGE_HIGH_QUALITY_TIMEOUT_230S_RECOVERY_CREATED'
      and event.event_payload ->> 'failedJobId'
        = p_expected_failed_job_id::text
      and event.event_payload ->> 'failedControlId'
        = p_expected_failed_control_id::text
      and event.ebay_writes = 0
      and not event.production_changed
  ) then
    select job.* into v_new_job
    from public.ebay_same_day_pilot_jobs job
    where job.idempotency_key = v_job_key
      and job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE';
    if not found
      or v_new_job.id::text is distinct from (
        select event.event_payload ->> 'newJobId'
        from public.ebay_same_day_pilot_events event
        where event.idempotency_key = v_event_key
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_handoffs handoff
        where handoff.id = (
          select (event.event_payload ->> 'recoveryHandoffId')::uuid
          from public.ebay_same_day_pilot_events event
          where event.idempotency_key = v_event_key
        )
          and handoff.run_id = v_run.id
          and handoff.candidate_id = p_candidate_id
          and handoff.status = 'AWAITING_IMAGE_APPROVAL'
          and handoff.openai_calls = 0
          and handoff.ebay_writes = 0
          and not handoff.production_changed
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_jobs failed_job
        where failed_job.id = p_expected_failed_job_id
          and failed_job.run_id = v_run.id
          and failed_job.candidate_id = p_candidate_id
          and failed_job.status = 'COMPLETED'
          and failed_job.attempt = 2
          and failed_job.last_error_code = 'EFFECT_ALREADY_APPLIED_RECOVERED'
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_image_package_runs failed_control
        where failed_control.id = p_expected_failed_control_id
          and failed_control.run_id = v_run.id
          and failed_control.candidate_id = p_candidate_id
          and failed_control.status = 'FAILED_FINAL'
          and failed_control.attempt = 1
          and failed_control.openai_calls = 1
          and failed_control.last_error_code = 'EBAY_IMAGE_OPENAI_TIMEOUT'
          and failed_control.provider_request_id is null
          and failed_control.asset_ids is null
          and failed_control.image_set_hash is null
      ) then
      raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_IDEMPOTENCY_INVALID';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'failedControlId', p_expected_failed_control_id,
      'newJobId', v_new_job.id,
      'jobStatus', v_new_job.status,
      'machineState', v_candidate.machine_state,
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.machine_state <> 'REJECTED'
    or v_candidate.blockers
      <> array['SAME_DAY_IMAGE_CONTROL_NOT_CLAIMED']::text[]
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_CANDIDATE_INVALID';
  end if;

  select job.* into v_failed_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_failed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for update;
  if not found
    or v_failed_job.status <> 'COMPLETED'
    or v_failed_job.attempt <> 2
    or v_failed_job.last_error_code
      <> 'EFFECT_ALREADY_APPLIED_RECOVERED'
    or v_failed_job.completed_at is null
    or v_failed_job.lease_owner is not null
    or v_failed_job.lease_token is not null
    or v_failed_job.lease_expires_at is not null
    or v_failed_job.checkpoint ->> 'productResearchCaptureBatchId'
      is distinct from p_expected_capture_batch_id::text
    or v_failed_job.checkpoint ->> 'requiredCompositorContractVersion'
      is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
    or v_failed_job.checkpoint ->> 'requiredForegroundMatteVersion'
      is distinct from 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
    or v_failed_job.checkpoint ->> 'maximumOpenAiCalls'
      is distinct from '1' then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_FAILED_JOB_INVALID';
  end if;
  v_failed_job_snapshot := to_jsonb(v_failed_job);

  select control.* into v_failed_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_failed_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_candidate_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for update;
  if not found
    or v_failed_control.status <> 'FAILED_FINAL'
    or v_failed_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
    or v_failed_control.attempt <> 1
    or v_failed_control.openai_calls <> 1
    or v_failed_control.last_error_code <> 'EBAY_IMAGE_OPENAI_TIMEOUT'
    or v_failed_control.provider_request_id is not null
    or v_failed_control.asset_ids is not null
    or v_failed_control.image_set_hash is not null
    or v_failed_control.completed_at is not null
    or v_failed_control.lease_token is not null
    or v_failed_control.lease_expires_at is not null
    or v_failed_control.ebay_writes <> 0
    or v_failed_control.production_changed then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_CONTROL_INVALID';
  end if;
  v_failed_control_snapshot := to_jsonb(v_failed_control);

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_failed_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.fact_run_id = v_failed_control.fact_run_id
    and handoff.package_hash = v_failed_control.handoff_hash
    and handoff.package_hash = v_failed_job.checkpoint ->> 'packageHash'
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for key share;
  if not found
    or v_old_handoff.package_hash is distinct from
      v_candidate.manual_handoff_package ->> 'packageHash'
    or v_old_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_old_handoff.openai_calls <> 0
    or v_old_handoff.ebay_writes <> 0
    or v_old_handoff.production_changed
    or v_old_handoff.package_data -> 'imageCompositionRecovery'
      ->> 'requiredCompositorContractVersion'
      is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21' then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_HANDOFF_INVALID';
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
      <> 'SAME_DAY_IMAGE_CONTROL_NOT_CLAIMED' then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_TRANSITION_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.id <> p_expected_failed_job_id
      and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  ) or exists (
    select 1
    from public.ebay_same_day_pilot_human_tasks task
    where task.run_id = v_run.id
      and task.candidate_id = p_candidate_id
      and task.status = 'OPEN'
  ) or exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs control
    where control.run_id = v_run.id
      and control.candidate_id = p_candidate_id
      and control.id <> p_expected_failed_control_id
      and control.status in (
        'CLAIMED', 'FAILED_RETRYABLE', 'PENDING_REVIEW', 'APPROVED'
      )
  ) then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_LANE_BUSY';
  end if;

  v_recovery_package := v_old_handoff.package_data || jsonb_build_object(
    'imageGenerationTimeoutRecovery', jsonb_build_object(
      'version', 'HIGH_QUALITY_TIMEOUT_230S_RECOVERY_V1_2026_07_21',
      'failedJobId', p_expected_failed_job_id,
      'failedControlId', p_expected_failed_control_id,
      'originalTimeoutMilliseconds', 130000,
      'requiredTimeoutMilliseconds', 230000,
      'previousProviderCallCounted', true,
      'previousProviderOutputReceived', false,
      'previousFailureEvidencePreserved', true,
      'newMaximumOpenAiCalls', 1,
      'requiredCompositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
      'requiredForegroundMatteVersion',
        'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
    )
  );
  v_recovery_package_hash := encode(
    extensions.digest(v_recovery_package::text, 'sha256'), 'hex'
  );
  if v_recovery_package_hash !~ '^[0-9a-f]{64}$'
    or v_recovery_package_hash = v_old_handoff.package_hash then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_HASH_INVALID';
  end if;

  insert into public.ebay_same_day_pilot_handoffs (
    run_id, candidate_id, fact_run_id, handoff_version, status,
    package_data, package_hash, source_image_type, image_count,
    operator_price_approved, openai_calls, ebay_writes,
    production_changed, created_at
  ) values (
    v_run.id,
    p_candidate_id,
    v_old_handoff.fact_run_id,
    v_old_handoff.handoff_version || ':HIGH_QUALITY_TIMEOUT_230S_V1',
    'AWAITING_IMAGE_APPROVAL',
    v_recovery_package,
    v_recovery_package_hash,
    v_old_handoff.source_image_type,
    v_old_handoff.image_count,
    v_old_handoff.operator_price_approved,
    0, 0, false, p_now
  )
  on conflict (candidate_id, package_hash) do nothing
  returning * into v_new_handoff;
  if not found then
    select handoff.* into v_new_handoff
    from public.ebay_same_day_pilot_handoffs handoff
    where handoff.candidate_id = p_candidate_id
      and handoff.package_hash = v_recovery_package_hash
    for key share;
  end if;
  if not found
    or v_new_handoff.run_id <> v_run.id
    or v_new_handoff.fact_run_id <> v_old_handoff.fact_run_id
    or v_new_handoff.package_data <> v_recovery_package
    or v_new_handoff.status <> 'AWAITING_IMAGE_APPROVAL'
    or v_new_handoff.openai_calls <> 0
    or v_new_handoff.ebay_writes <> 0
    or v_new_handoff.production_changed then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_HANDOFF_CREATE_FAILED';
  end if;

  v_checkpoint := v_failed_job.checkpoint || jsonb_build_object(
    'packageHash', v_recovery_package_hash,
    'recoveryVersion', 'HIGH_QUALITY_TIMEOUT_230S_RECOVERY_V1_2026_07_21',
    'recoveryFromJobId', p_expected_failed_job_id,
    'recoveryFromControlId', p_expected_failed_control_id,
    'previousHandoffId', v_old_handoff.id,
    'recoveryHandoffId', v_new_handoff.id,
    'originalErrorCode', 'EBAY_IMAGE_OPENAI_TIMEOUT',
    'previousProviderCallCounted', true,
    'previousProviderOutputReceived', false,
    'requiredTimeoutMilliseconds', 230000,
    'maximumOpenAiCalls', 1,
    'generationAttemptVersion',
      'HIGH_QUALITY_TIMEOUT_230S_CAPTURE_BOUND_V1_2026_07_21',
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'), 'hex'
  );

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'PREPARING_IMAGE_PACKAGE',
    'HIGH_QUALITY_IMAGE_TIMEOUT_EXTENDED_TO_230S',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Regenerar Calypso con timeout de calidad alta de 230 segundos.',
    'Ninguna hasta revisar el nuevo set.',
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
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      manual_handoff_package = candidate.manual_handoff_package
        || jsonb_build_object(
          'status', 'AWAITING_IMAGE_APPROVAL',
          'version', v_new_handoff.handoff_version,
          'packageHash', v_new_handoff.package_hash,
          'package', v_new_handoff.package_data,
          'blockers', '[]'::jsonb,
          'openAiCalls', 0,
          'ebayWrites', 0,
          'imageGenerationTimeoutRecovery',
            v_recovery_package -> 'imageGenerationTimeoutRecovery'
        ),
      image_package_summary = jsonb_build_object(
        'status', 'PREPARING_HIGH_QUALITY_TIMEOUT_RETRY',
        'source', 'LUNA_AUTHORIZED_CATALOG',
        'count', v_old_handoff.image_count,
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'failedControlId', p_expected_failed_control_id,
        'previousProviderCallCounted', true,
        'requiredTimeoutMilliseconds', 230000,
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      next_automated_action =
        'Regenerar Calypso con timeout de calidad alta de 230 segundos.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Procesar el reintento de calidad alta de Calypso.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where run.id = v_run.id;

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE';
  if not found or v_new_job.id = p_expected_failed_job_id then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_NEW_JOB_MISSING';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.id = p_expected_failed_job_id
      and to_jsonb(job) = v_failed_job_snapshot
  ) then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_FAILED_JOB_MUTATED';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs control
    where control.id = p_expected_failed_control_id
      and to_jsonb(control) = v_failed_control_snapshot
  ) then
    raise exception 'CALYPSO_HIGH_QUALITY_TIMEOUT_FAILED_CONTROL_MUTATED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_IMAGE_HIGH_QUALITY_TIMEOUT_230S_RECOVERY_CREATED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'failedJobId', p_expected_failed_job_id,
      'failedControlId', p_expected_failed_control_id,
      'previousHandoffId', v_old_handoff.id,
      'recoveryHandoffId', v_new_handoff.id,
      'newJobId', v_new_job.id,
      'previousProviderCallCounted', true,
      'previousProviderOutputReceived', false,
      'requiredTimeoutMilliseconds', 230000,
      'newMaximumOpenAiCalls', 1,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'failedJobId', p_expected_failed_job_id,
    'failedControlId', p_expected_failed_control_id,
    'recoveryHandoffId', v_new_handoff.id,
    'newJobId', v_new_job.id,
    'jobStatus', v_new_job.status,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'previousProviderCallCounted', true,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.resume_calypso_after_high_quality_timeout_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.resume_calypso_after_high_quality_timeout_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_calypso_after_high_quality_timeout_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is 'Staging-only and ID-bound: preserves the timed-out Calypso V6 control, creates a distinct handoff/control lane for one 230-second high-quality retry, and performs no eBay or Production write.';

notify pgrst, 'reload schema';
