-- Create a new append-only handoff/control lane after the database validator
-- gains support for the current Visual Strategy V2 / scene-board V3 /
-- compositor V5 evidence contract. The rejected generated set and its original
-- control remain auditable history; the new handoff receives a content-bound
-- recovery hash and permits one fresh image generation call.

create or replace function public.resume_same_day_image_after_v3_evidence_validator_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_failed_job_id uuid,
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
  v_failed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_recovery_package jsonb;
  v_recovery_package_hash text;
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
    or p_expected_control_id is null
    or p_now is null then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_CANDIDATE_NOT_FOUND';
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
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_RUN_SCOPE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_CANDIDATE_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from public.marketplace_product_research_capture_batches batch
    where batch.id = p_expected_capture_batch_id
      and batch.marketplace_account_key = p_account_key
      and batch.marketplace = 'EBAY_US'
      and batch.source_row_count > 0
      and batch.valid_count > 0
  ) then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_CAPTURE_INVALID';
  end if;

  select job.* into v_failed_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_failed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for update;
  if not found
    or not (
      (
        v_failed_job.status = 'DEAD_LETTER'
        and v_failed_job.last_error_code = 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID'
      )
      or (
        v_failed_job.status = 'COMPLETED'
        and v_failed_job.last_error_code = 'EFFECT_ALREADY_APPLIED_RECOVERED'
      )
    )
    or v_failed_job.lease_owner is not null
    or v_failed_job.lease_token is not null
    or v_failed_job.lease_expires_at is not null
    or v_failed_job.checkpoint ->> 'productResearchCaptureBatchId'
      <> p_expected_capture_batch_id::text then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_FAILED_JOB_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_candidate_id
  for key share;
  if not found
    or v_control.status <> 'FAILED_FINAL'
    or v_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
    or v_control.attempt <> 1
    or v_control.openai_calls <> 1
    or v_control.last_error_code <> 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID'
    or v_control.provider_request_id is not null
    or v_control.asset_ids is not null
    or v_control.image_set_hash is not null
    or v_control.completed_at is not null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_CONTROL_INVALID';
  end if;

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.fact_run_id = v_control.fact_run_id
    and handoff.package_hash = v_control.handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for key share;
  if not found
    or v_old_handoff.package_hash
      <> coalesce(v_candidate.manual_handoff_package ->> 'packageHash', '')
    or v_old_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_old_handoff.image_count <> 1
    or v_old_handoff.openai_calls <> 0
    or v_old_handoff.ebay_writes <> 0
    or v_old_handoff.production_changed then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_HANDOFF_INVALID';
  end if;

  v_recovery_package := v_old_handoff.package_data || jsonb_build_object(
    'imageEvidenceRecovery', jsonb_build_object(
      'version', 'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
      'previousControlId', p_expected_control_id,
      'previousErrorCode', 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID',
      'validatorContract', jsonb_build_object(
        'visualStrategyVersion',
          'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21',
        'backgroundPlateVersion',
          'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3',
        'compositorContractVersion',
          'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
      ),
      'historyPreserved', true
    )
  );
  v_recovery_package_hash := encode(
    extensions.digest(v_recovery_package::text, 'sha256'),
    'hex'
  );
  if v_recovery_package_hash !~ '^[0-9a-f]{64}$'
    or v_recovery_package_hash = v_old_handoff.package_hash then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_HASH_INVALID';
  end if;

  v_job_key := v_failed_job.idempotency_key
    || ':VISUAL_STRATEGY_V3_VALIDATOR_RECOVERY:'
    || p_expected_failed_job_id::text;
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
        <> p_expected_failed_job_id::text
      or v_new_job.checkpoint ->> 'previousControlId'
        <> p_expected_control_id::text
      or v_new_job.checkpoint ->> 'packageHash'
        <> v_recovery_package_hash then
      raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'jobId', v_new_job.id,
      'jobStatus', v_new_job.status,
      'machineState', v_candidate.machine_state,
      'idempotent', true,
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
    or v_last_transition.reason_code <> 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID' then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_TRANSITION_INVALID';
  end if;

  if v_run.status <> 'ACTIVE'
    or v_run.stage <> 'PREPARING_IMAGE_PACKAGE'
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
    or v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.machine_state <> 'REJECTED'
    or v_candidate.blockers <> array[
      'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID'
    ]::text[] then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_STATE_INVALID';
  end if;

  if exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.candidate_id = p_candidate_id
        and job.id <> p_expected_failed_job_id
        and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.candidate_id = p_candidate_id
        and task.status = 'OPEN'
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_image_package_runs control
      where control.candidate_id = p_candidate_id
        and control.id <> p_expected_control_id
        and control.status in ('CLAIMED', 'FAILED_RETRYABLE', 'PENDING_REVIEW', 'APPROVED')
    ) then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_LANE_NOT_CLEAN';
  end if;

  if v_failed_job.status = 'DEAD_LETTER' then
    update public.ebay_same_day_pilot_jobs job
    set status = 'CANCELLED',
        updated_at = p_now
    where job.id = p_expected_failed_job_id
      and job.status = 'DEAD_LETTER'
      and job.last_error_code = 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID';
    if not found then
      raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_JOB_CANCEL_FAILED';
    end if;
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
    v_old_handoff.handoff_version || ':VISUAL_STRATEGY_V3_VALIDATOR_V1',
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
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_HANDOFF_CREATE_FAILED';
  end if;

  v_checkpoint := v_failed_job.checkpoint || jsonb_build_object(
    'recoveryVersion', 'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
    'recoveryFromJobId', p_expected_failed_job_id,
    'previousControlId', p_expected_control_id,
    'previousHandoffId', v_old_handoff.id,
    'recoveryHandoffId', v_new_handoff.id,
    'packageHash', v_recovery_package_hash,
    'originalErrorCode', 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID',
    'validatorContract', jsonb_build_object(
      'visualStrategyVersion',
        'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21',
      'backgroundPlateVersion', 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3',
      'compositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
    ),
    'previousControlPreserved', true,
    'previousFailedAttemptsPreserved', 1,
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
    'VISUAL_STRATEGY_V3_EVIDENCE_VALIDATOR_DEPLOYED',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Regenerar las imágenes con el contrato visual V3 validado.',
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
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      manual_handoff_package = candidate.manual_handoff_package
        || jsonb_build_object(
          'package', v_recovery_package,
          'packageHash', v_recovery_package_hash,
          'imageEvidenceRecovery', jsonb_build_object(
            'version', 'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
            'previousControlId', p_expected_control_id,
            'historyPreserved', true
          )
        ),
      next_automated_action =
        'Regenerar las imágenes con el contrato visual V3 validado.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Procesar la generación con el contrato visual V3 validado.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where run.id = v_run.id;

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key;
  if not found then
    raise exception 'SAME_DAY_V3_VALIDATOR_RECOVERY_JOB_MISSING';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_IMAGE_V3_VALIDATOR_RECOVERY_CREATED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'failedJobId', p_expected_failed_job_id,
      'previousControlId', p_expected_control_id,
      'previousHandoffId', v_old_handoff.id,
      'recoveryHandoffId', v_new_handoff.id,
      'newJobId', v_new_job.id,
      'validatorVersion', 'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
      'previousControlPreserved', true,
      'previousFailedAttemptsPreserved', 1,
      'externalCalls', 0,
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
    'previousControlId', p_expected_control_id,
    'recoveryHandoffId', v_new_handoff.id,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'validatorVersion', 'VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21',
    'previousControlPreserved', true,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.resume_same_day_image_after_v3_evidence_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.resume_same_day_image_after_v3_evidence_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_same_day_image_after_v3_evidence_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Creates one append-only recovery handoff after deploying the Visual Strategy V3 evidence validator; preserves prior failed controls and makes no eBay write.';

notify pgrst, 'reload schema';
