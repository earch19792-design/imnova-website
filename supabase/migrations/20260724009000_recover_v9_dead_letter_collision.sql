-- Recover only the current V9 seven-image approval whose replacement job was
-- incorrectly treated as already applied after the retired V6 dead letter
-- reverted the candidate row. This function is inert until service_role calls
-- it with the exact run bindings and performs no external provider/eBay write.

create or replace function public.recover_current_v9_dead_letter_collision_v1(
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
  v_recovery_job public.ebay_same_day_pilot_jobs%rowtype;
  v_latest_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_retired_job_count integer;
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
    raise exception 'V9_DEAD_LETTER_COLLISION_RECOVERY_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'V9_DEAD_LETTER_COLLISION_CANDIDATE_MISSING';
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
    raise exception 'V9_DEAD_LETTER_COLLISION_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'V9_DEAD_LETTER_COLLISION_CANDIDATE_MISSING';
  end if;

  v_event_key := v_run.id::text || ':' || p_candidate_id::text
    || ':V9_EXACT_SEVEN_DEAD_LETTER_COLLISION:'
    || p_expected_control_id::text;
  if exists (
    select 1
    from public.ebay_same_day_pilot_events event_row
    where event_row.idempotency_key = v_event_key
      and event_row.run_id = v_run.id
      and event_row.candidate_id = p_candidate_id
      and event_row.event_type
        = 'V9_EXACT_SEVEN_DEAD_LETTER_COLLISION_RECOVERED'
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
    or jsonb_array_length(coalesce(
      v_candidate.image_package_summary -> 'assetIds',
      '[]'::jsonb
    )) <> 7
    or coalesce(
      (v_candidate.image_package_summary ->> 'count')::integer,
      0
    ) <> 7
    or v_candidate.manual_handoff_package ->> 'status'
      <> 'AWAITING_IMAGE_APPROVAL'
    or v_candidate.manual_handoff_package ->> 'version'
      <> 'SELLER_HUB_FACTS_ONLY_V10_2026_07_24' then
    raise exception 'V9_DEAD_LETTER_COLLISION_CANDIDATE_INVALID';
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
    raise exception 'V9_DEAD_LETTER_COLLISION_CONTROL_INVALID';
  end if;

  if v_candidate.image_package_summary ->> 'listingPackageId'
      <> v_control.listing_package_id::text then
    raise exception 'V9_DEAD_LETTER_COLLISION_BINDING_INVALID';
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
    raise exception 'V9_DEAD_LETTER_COLLISION_HANDOFF_INVALID';
  end if;

  perform public.assert_same_day_pilot_image_set_safe(
    v_control.id,
    p_actor,
    v_control.asset_ids
  );
  perform public.assert_same_day_pilot_image_set_current_v9(
    v_control.id,
    p_actor,
    v_control.asset_ids
  );

  if not exists (
    select 1
    from public.ebay_same_day_pilot_events event_row
    where event_row.run_id = v_run.id
      and event_row.candidate_id = p_candidate_id
      and event_row.event_type = 'V9_EXACT_SEVEN_SQL_GATE_RECOVERED'
      and event_row.event_payload ->> 'controlId'
        = p_expected_control_id::text
      and event_row.ebay_read_calls = 0
      and event_row.openai_calls = 0
      and event_row.ebay_writes = 0
      and not event_row.production_changed
  ) then
    raise exception 'V9_DEAD_LETTER_COLLISION_RECOVERY_EVENT_MISSING';
  end if;

  select transition_row.* into v_latest_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1
  for key share;
  if not found
    or v_latest_transition.previous_state <> 'REJECTED'
    or v_latest_transition.next_state <> 'BUILDING_SELLER_HUB_HANDOFF'
    or v_latest_transition.reason_code
      <> 'V9_EXACT_SEVEN_SQL_GATE_RECOVERED'
    or v_latest_transition.triggered_by <> 'RETRY'
    or v_latest_transition.checkpoint ->> 'controlId'
      <> p_expected_control_id::text then
    raise exception 'V9_DEAD_LETTER_COLLISION_TRANSITION_INVALID';
  end if;

  select job.* into v_recovery_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'APPROVE_SIX_IMAGE_SET'
    and job.idempotency_key =
      v_run.id::text || ':' || p_candidate_id::text
        || ':APPROVE_SIX_IMAGE_SET:V9_EXACT_SEVEN_SQL_GATE:'
        || p_expected_control_id::text
  for key share;
  if not found
    or v_recovery_job.status <> 'COMPLETED'
    or v_recovery_job.attempt <> 1
    or v_recovery_job.max_attempts <> 4
    or v_recovery_job.last_error_code is not null
    or v_recovery_job.completed_at is null
    or v_recovery_job.lease_owner is not null
    or v_recovery_job.lease_token is not null
    or v_recovery_job.lease_expires_at is not null
    or v_recovery_job.checkpoint ->> 'recoveryVersion'
      <> 'V9_EXACT_SEVEN_SQL_REVIEW_GATE_V1_2026_07_24'
    or v_recovery_job.checkpoint ->> 'controlId'
      <> p_expected_control_id::text
    or coalesce(
      (v_recovery_job.checkpoint ->> 'openAiCalls')::integer,
      0
    ) <> 0
    or coalesce(
      (v_recovery_job.checkpoint ->> 'ebayWrites')::integer,
      0
    ) <> 0 then
    raise exception 'V9_DEAD_LETTER_COLLISION_RECOVERY_JOB_INVALID';
  end if;

  select count(*) into v_retired_job_count
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'APPROVE_SIX_IMAGE_SET'
    and job.status = 'CANCELLED'
    and job.last_error_code = 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED'
    and job.created_at < v_recovery_job.created_at;
  if v_retired_job_count <> 1 then
    raise exception 'V9_DEAD_LETTER_COLLISION_RETIRED_JOB_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.status in (
        'PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER'
      )
  ) then
    raise exception 'V9_DEAD_LETTER_COLLISION_LANE_BUSY';
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
    raise exception 'V9_DEAD_LETTER_COLLISION_PUBLICATION_EXISTS';
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
    raise exception 'V9_DEAD_LETTER_COLLISION_EXTERNAL_EFFECT';
  end if;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion',
      'V9_EXACT_SEVEN_DEAD_LETTER_COLLISION_V1_2026_07_24',
    'controlId', p_expected_control_id,
    'completedReplacementJobId', v_recovery_job.id,
    'latestRecoveryTransitionId', v_latest_transition.id,
    'originalErrorCode', 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED',
    'collisionCause',
      'RETIRED_V6_DEAD_LETTER_REJECTED_BEFORE_V9_JOB_CLAIM',
    'reviewValidator', 'assert_same_day_pilot_image_set_current_v9',
    'assetCount', 7,
    'secondaryCount', 6,
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
    || ':V9_EXACT_SEVEN_DEAD_LETTER_COLLISION:'
    || p_expected_control_id::text;
  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':APPROVE_SIX_IMAGE_SET:V9_DEAD_LETTER_COLLISION:'
    || p_expected_control_id::text;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'BUILDING_SELLER_HUB_HANDOFF',
    'V9_EXACT_SEVEN_DEAD_LETTER_COLLISION_RECOVERED',
    'RETRY',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Reintentar una vez la aprobación V9 del mismo set de siete imágenes.',
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
    raise exception 'V9_DEAD_LETTER_COLLISION_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_IMAGE_REVIEW',
      blockers = '{}'::text[],
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'BUILDING_SELLER_HUB_HANDOFF';
  if not found then
    raise exception 'V9_DEAD_LETTER_COLLISION_PATCH_FAILED';
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
    'V9_EXACT_SEVEN_DEAD_LETTER_COLLISION_RECOVERED',
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

revoke all on function public.recover_current_v9_dead_letter_collision_v1(
  text, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.recover_current_v9_dead_letter_collision_v1(
  text, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.recover_current_v9_dead_letter_collision_v1(
  text, uuid, uuid, uuid, timestamptz
) is
  'Exact append-only recovery for the current V9 approval job skipped after '
  'a retired V6 dead letter reverted the candidate row; performs zero eBay, '
  'OpenAI or Production writes.';

notify pgrst, 'reload schema';
