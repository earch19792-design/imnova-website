-- The background reconciler can settle a DEAD_LETTER image job as COMPLETED
-- when the candidate rejection already reflects its effect. Normalize only an
-- exact, no-output OpenAI HTTP 400 back to DEAD_LETTER inside the same
-- transaction that invokes the guarded retry function. No evidence is deleted.

create or replace function public.normalize_reconciled_image_job_for_safe_retry_v1(
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
  v_job public.ebay_same_day_pilot_jobs%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_event_key text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_capture_batch_id is null
    or p_expected_failed_job_id is null
    or p_expected_control_id is null
    or p_now is null then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_CANDIDATE_NOT_FOUND';
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
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_RUN_SCOPE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id
    or v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.machine_state <> 'REJECTED'
    or v_candidate.blockers <> array['EBAY_IMAGE_OPENAI_HTTP_400']::text[] then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_CANDIDATE_SCOPE_INVALID';
  end if;

  select job.* into v_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_failed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for update;
  if not found
    or v_job.status <> 'COMPLETED'
    or v_job.last_error_code <> 'EFFECT_ALREADY_APPLIED_RECOVERED'
    or v_job.lease_owner is not null
    or v_job.lease_token is not null
    or v_job.lease_expires_at is not null
    or v_job.checkpoint ->> 'productResearchCaptureBatchId'
      <> p_expected_capture_batch_id::text then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_JOB_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_candidate_id
  for update;
  if not found
    or v_control.status <> 'FAILED_FINAL'
    or v_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
    or v_control.attempt <> 1
    or v_control.openai_calls <> 1
    or v_control.last_error_code <> 'EBAY_IMAGE_OPENAI_HTTP_400'
    or v_control.provider_request_id is not null
    or v_control.asset_ids is not null
    or v_control.image_set_hash is not null
    or v_control.completed_at is not null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_CONTROL_INVALID';
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
    or v_last_transition.reason_code <> 'EBAY_IMAGE_OPENAI_HTTP_400' then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_TRANSITION_INVALID';
  end if;

  if exists (
      select 1
      from public.ebay_same_day_pilot_jobs other_job
      where other_job.run_id = v_run.id
        and other_job.id <> p_expected_failed_job_id
        and other_job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.run_id = v_run.id
        and task.status = 'OPEN'
    ) then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_LANE_NOT_CLEAN';
  end if;

  update public.ebay_same_day_pilot_jobs job
  set status = 'DEAD_LETTER',
      last_error_code = 'EBAY_IMAGE_OPENAI_HTTP_400',
      checkpoint = job.checkpoint || jsonb_build_object(
        'reconciledStatusNormalized', true,
        'reconciledStatusBeforeNormalization', 'COMPLETED',
        'reconciledErrorBeforeNormalization',
          'EFFECT_ALREADY_APPLIED_RECOVERED',
        'originalProviderErrorCode', 'EBAY_IMAGE_OPENAI_HTTP_400',
        'historyPreserved', true
      ),
      updated_at = p_now
  where job.id = p_expected_failed_job_id
    and job.status = 'COMPLETED'
    and job.last_error_code = 'EFFECT_ALREADY_APPLIED_RECOVERED';
  if not found then
    raise exception 'SAME_DAY_RECONCILED_IMAGE_NORMALIZATION_PATCH_FAILED';
  end if;

  v_event_key := v_job.idempotency_key
    || ':RECONCILED_IMAGE_NORMALIZED_FOR_SAFE_RETRY';
  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_RECONCILED_IMAGE_JOB_NORMALIZED_FOR_SAFE_RETRY',
    jsonb_build_object(
      'jobId', p_expected_failed_job_id,
      'controlId', p_expected_control_id,
      'statusBefore', 'COMPLETED',
      'errorBefore', 'EFFECT_ALREADY_APPLIED_RECOVERED',
      'statusAfter', 'DEAD_LETTER',
      'errorAfter', 'EBAY_IMAGE_OPENAI_HTTP_400',
      'providerRequestIdRecorded', false,
      'providerOutputReceived', false,
      'historyPreserved', true,
      'externalCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'jobId', p_expected_failed_job_id,
    'controlId', p_expected_control_id,
    'status', 'DEAD_LETTER',
    'errorCode', 'EBAY_IMAGE_OPENAI_HTTP_400',
    'historyPreserved', true,
    'externalCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.normalize_reconciled_image_job_for_safe_retry_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.normalize_reconciled_image_job_for_safe_retry_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.normalize_reconciled_image_job_for_safe_retry_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Normalizes one exact reconciled no-output HTTP 400 image job immediately before the guarded safe-error retry; preserves all prior evidence.';

notify pgrst, 'reload schema';
