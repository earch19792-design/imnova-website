-- Reconcile the exact pre-network OpenAI accounting failure into the already
-- supported deterministic image path. This does not relax the append-only
-- control generally and performs no eBay or Production write.

create or replace function public.enforce_same_day_pilot_image_package_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reconcile_control_id text := current_setting(
    'imnova.same_day_image_control_reconcile_id', true
  );
  v_expected_deterministic_hash text;
  v_exact_pre_network_reconciliation boolean := false;
begin
  if tg_op = 'UPDATE' and (
    new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.created_by is distinct from old.created_by
    or new.run_id is distinct from old.run_id
    or new.candidate_id is distinct from old.candidate_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.fact_run_id is distinct from old.fact_run_id
    or new.handoff_id is distinct from old.handoff_id
    or new.handoff_hash is distinct from old.handoff_hash
    or new.generation_mode is distinct from old.generation_mode
    or new.image_set_version is distinct from old.image_set_version
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at
  ) then
    if v_reconcile_control_id = old.id::text then
      v_expected_deterministic_hash := encode(
        extensions.digest(
          new.marketplace_account_key || ':' || new.created_by::text || ':'
          || new.run_id::text || ':' || new.candidate_id::text || ':'
          || new.listing_package_id::text || ':' || new.fact_run_id::text || ':'
          || new.handoff_hash || ':deterministic',
          'sha256'
        ),
        'hex'
      );

      v_exact_pre_network_reconciliation := coalesce(
        old.marketplace_account_key = new.marketplace_account_key
        and old.created_by = new.created_by
        and old.run_id = new.run_id
        and old.candidate_id = new.candidate_id
        and old.listing_package_id = new.listing_package_id
        and old.fact_run_id = new.fact_run_id
        and old.handoff_id = new.handoff_id
        and old.handoff_hash = new.handoff_hash
        and old.image_set_version = new.image_set_version
        and old.created_at = new.created_at
        and old.generation_mode = 'OPENAI_CONTEXT_PLATE'
        and new.generation_mode = 'DETERMINISTIC_ONLY'
        and new.idempotency_key_hash = v_expected_deterministic_hash
        and old.status = 'FAILED_FINAL'
        and new.status = 'FAILED_RETRYABLE'
        and old.attempt = 1
        and new.attempt = old.attempt
        and old.last_error_code = 'EBAY_IMAGE_OPENAI_KEY_MISSING'
        and new.last_error_code = 'EBAY_IMAGE_PRENETWORK_ACCOUNTING_RECONCILED'
        and old.openai_calls = 1
        and new.openai_calls = 0
        and old.provider_request_id is null
        and new.provider_request_id is null
        and old.asset_ids is null
        and new.asset_ids is null
        and old.image_set_hash is null
        and new.image_set_hash is null
        and old.completed_at is null
        and new.completed_at is null
        and old.lease_token is null
        and new.lease_token is null
        and old.lease_expires_at is null
        and new.lease_expires_at is null
        and new.failed_at = old.failed_at
        and old.reviewed_at is null
        and new.reviewed_at is null
        and old.reviewed_by is null
        and new.reviewed_by is null
        and old.human_decision is null
        and new.human_decision is null
        and old.competitor_image_count = 0
        and new.competitor_image_count = 0
        and old.product_byte_count_sent = 0
        and new.product_byte_count_sent = 0
        and old.product_url_count_sent = 0
        and new.product_url_count_sent = 0
        and old.ebay_writes = 0
        and new.ebay_writes = 0
        and old.production_changed = false
        and new.production_changed = false,
        false
      );
    end if;

    if not v_exact_pre_network_reconciliation then
      raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_IMMUTABLE';
    end if;
  end if;

  perform 1
  from public.ebay_same_day_pilot_runs pilot_run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = pilot_run.id
  join public.ebay_listing_packages listing_package
    on listing_package.opportunity_id = candidate.opportunity_id
    and listing_package.candidate_key = candidate.candidate_key
  join public.marketplace_product_fact_runs fact_run
    on fact_run.id = new.fact_run_id
  join public.ebay_same_day_pilot_handoffs handoff
    on handoff.run_id = pilot_run.id
    and handoff.candidate_id = candidate.id
    and handoff.fact_run_id = fact_run.id
  where pilot_run.id = new.run_id
    and pilot_run.marketplace_account_key = new.marketplace_account_key
    and pilot_run.marketplace = 'EBAY_US'
    and pilot_run.created_by = new.created_by
    and candidate.id = new.candidate_id
    and candidate.machine_state in (
      'PREPARING_IMAGE_PACKAGE', 'WAITING_IMAGE_APPROVAL'
    )
    and listing_package.id = new.listing_package_id
    and listing_package.account_key = new.marketplace_account_key
    and listing_package.created_by = new.created_by
    and listing_package.status <> 'archived'
    and fact_run.marketplace_account_key = new.marketplace_account_key
    and fact_run.marketplace = 'EBAY_US'
    and fact_run.status in ('COMPLETED', 'PARTIAL')
    and handoff.id = new.handoff_id
    and handoff.package_hash = new.handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
    and handoff.openai_calls = 0
    and handoff.ebay_writes = 0
    and handoff.production_changed = false;
  if not found then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.reconcile_failed_openai_image_control_to_deterministic_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
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
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_prior_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_idempotency_key text;
  v_deterministic_hash text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._:-]{3,120}$'
    or p_actor is null
    or p_candidate_id is null
    or p_now is null then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_INPUT_INVALID';
  end if;

  select run.*
  into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_CANDIDATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run.id::text, 0)
  );

  select run.*
  into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run.id
  for update;
  if not found
    or v_run.marketplace_account_key <> p_account_key
    or v_run.marketplace <> 'EBAY_US'
    or v_run.created_by is distinct from p_actor
    or v_run.status <> 'BLOCKED'
    or v_run.stage <> 'BLOCKED'
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
    or v_run.worker_lease_token is not null
    or v_run.worker_lease_owner is not null then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_RUN_INVALID';
  end if;

  select candidate.*
  into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.machine_state <> 'REJECTED'
    or v_candidate.state <> 'REJECTED_TODAY'
    or v_candidate.blockers
      <> array['SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT']::text[] then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_CANDIDATE_INVALID';
  end if;

  select transition_row.*
  into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1;
  if not found
    or v_last_transition.previous_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_last_transition.next_state <> 'REJECTED'
    or v_last_transition.reason_code
      <> 'SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT' then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_TRANSITION_INVALID';
  end if;

  select transition_row.*
  into v_prior_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
    and (
      transition_row.created_at < v_last_transition.created_at
      or (
        transition_row.created_at = v_last_transition.created_at
        and transition_row.id < v_last_transition.id
      )
    )
  order by transition_row.created_at desc, transition_row.id desc
  limit 1;
  if not found
    or v_prior_transition.previous_state <> 'REJECTED'
    or v_prior_transition.next_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_prior_transition.reason_code
      <> 'OPENAI_IMAGE_FACTORY_CONFIGURATION_RECOVERED' then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_LEDGER_INVALID';
  end if;

  select job.*
  into v_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  order by job.created_at desc, job.id desc
  limit 1
  for update;
  if not found
    or v_job.status <> 'DEAD_LETTER'
    or v_job.attempt <> 1
    or v_job.last_error_code
      <> 'SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT'
    or v_job.lease_token is not null
    or v_job.lease_owner is not null
    or v_job.lease_expires_at is not null then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_JOB_INVALID';
  end if;

  if exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED')
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.run_id = v_run.id
        and task.status = 'OPEN'
    ) then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_LANE_BUSY';
  end if;

  select handoff.*
  into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  order by handoff.created_at desc, handoff.id desc
  limit 1
  for update;
  if not found
    or v_handoff.openai_calls <> 0
    or v_handoff.ebay_writes <> 0
    or v_handoff.production_changed
    or v_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_handoff.image_count < 1 then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_HANDOFF_INVALID';
  end if;

  select control.*
  into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.marketplace_account_key = p_account_key
    and control.candidate_id = p_candidate_id
    and control.handoff_id = v_handoff.id
    and control.handoff_hash = v_handoff.package_hash
  for update;
  if not found
    or v_control.created_by <> p_actor
    or v_control.run_id <> v_run.id
    or v_control.status <> 'FAILED_FINAL'
    or v_control.attempt <> 1
    or v_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
    or v_control.last_error_code <> 'EBAY_IMAGE_OPENAI_KEY_MISSING'
    or v_control.openai_calls <> 1
    or v_control.provider_request_id is not null
    or v_control.asset_ids is not null
    or v_control.image_set_hash is not null
    or v_control.completed_at is not null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_CONTROL_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_listing_image_assets asset
    where asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = p_account_key
      and asset.created_by = p_actor
  ) then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_ASSETS_EXIST';
  end if;

  v_deterministic_hash := encode(
    extensions.digest(
      p_account_key || ':' || p_actor::text || ':' || v_run.id::text || ':'
      || p_candidate_id::text || ':' || v_control.listing_package_id::text
      || ':' || v_control.fact_run_id::text || ':' || v_control.handoff_hash
      || ':deterministic',
      'sha256'
    ),
    'hex'
  );
  if exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs other_control
    where other_control.idempotency_key_hash = v_deterministic_hash
      and other_control.id <> v_control.id
  ) then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_HASH_CONFLICT';
  end if;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion', 'PRENETWORK_OPENAI_TO_DETERMINISTIC_V1_2026_07_20',
    'controlId', v_control.id,
    'jobId', v_job.id,
    'failedTransitionId', v_last_transition.id,
    'providerRequestObserved', false,
    'persistedAssetCount', 0,
    'correctedOpenAiCalls', 0,
    'generationMode', 'DETERMINISTIC_ONLY',
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'),
    'hex'
  );
  v_idempotency_key := v_run.id::text || ':' || p_candidate_id::text
    || ':PRENETWORK_OPENAI_TO_DETERMINISTIC:' || v_control.id::text;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'PREPARING_IMAGE_PACKAGE',
    'PRENETWORK_OPENAI_IMAGE_CONTROL_RECONCILED',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_idempotency_key,
    'Generate the deterministic six-image package.',
    'Ninguna.',
    null::text,
    null::text,
    null::jsonb,
    p_now,
    1,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result = 'STALE' then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      next_automated_action = 'Generate the deterministic six-image package.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_CANDIDATE_PATCH_FAILED';
  end if;

  perform set_config(
    'imnova.same_day_image_control_reconcile_id',
    v_control.id::text,
    true
  );
  update public.ebay_same_day_pilot_image_package_runs control
  set generation_mode = 'DETERMINISTIC_ONLY',
      idempotency_key_hash = v_deterministic_hash,
      status = 'FAILED_RETRYABLE',
      openai_calls = 0,
      last_error_code = 'EBAY_IMAGE_PRENETWORK_ACCOUNTING_RECONCILED',
      updated_at = p_now
  where control.id = v_control.id
    and control.status = 'FAILED_FINAL'
    and control.generation_mode = 'OPENAI_CONTEXT_PLATE'
    and control.last_error_code = 'EBAY_IMAGE_OPENAI_KEY_MISSING'
    and control.openai_calls = 1
    and control.provider_request_id is null
    and control.asset_ids is null;
  if not found then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_CONTROL_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_jobs job
  set status = 'PENDING',
      attempt = 0,
      available_at = p_now,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      last_heartbeat_at = null,
      last_error_code = null,
      completed_at = null,
      updated_at = p_now
  where job.id = v_job.id
    and job.status = 'DEAD_LETTER'
    and job.last_error_code = 'SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT';
  if not found then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_JOB_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action = 'Generate the deterministic six-image package.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where run.id = v_run.id
    and run.status = 'BLOCKED';
  if not found then
    raise exception 'SAME_DAY_IMAGE_DETERMINISTIC_RECOVERY_RUN_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_IMAGE_CONTROL_RECONCILED_TO_DETERMINISTIC',
    v_checkpoint,
    'same-day-image:' || v_control.id::text || ':deterministic-reconciliation',
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'candidateId', p_candidate_id,
    'runId', v_run.id,
    'jobId', v_job.id,
    'controlId', v_control.id,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'jobStatus', 'PENDING',
    'generationMode', 'DETERMINISTIC_ONLY',
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.reconcile_failed_openai_image_control_to_deterministic_v1(
  text, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_failed_openai_image_control_to_deterministic_v1(
  text, uuid, uuid, timestamptz
) to service_role;

comment on function public.reconcile_failed_openai_image_control_to_deterministic_v1(
  text, uuid, uuid, timestamptz
) is 'Atomically reconciles one exact pre-network OpenAI image failure to deterministic generation and resumes the existing job; no eBay or Production write.';

notify pgrst, 'reload schema';
