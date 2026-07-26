begin;

-- Keep SECURITY DEFINER search paths restricted while resolving pgcrypto
-- explicitly. The claim-by-id definition also retains the 42702 repair.
-- CREATE OR REPLACE preserves RPC signatures, ownership, grants, and callers.

create or replace function public.initialize_ebay_listing_factory_run_v1(
  p_run_id uuid,
  p_actor text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate_count integer;
  v_initialized_at timestamptz;
  v_mode text;
  v_free_slot integer;
  v_replacement_id uuid;
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'LISTING_FACTORY_ACTOR_REQUIRED';
  end if;

  select factory_initialized_at, factory_mode
  into v_initialized_at, v_mode
  from public.ebay_same_day_pilot_runs
  where id = p_run_id for update;
  if not found then
    raise exception 'LISTING_FACTORY_RUN_NOT_FOUND';
  end if;

  select count(*) into v_candidate_count
  from public.ebay_same_day_pilot_candidates
  where run_id = p_run_id;
  if v_candidate_count < 5 then
    raise exception 'LISTING_FACTORY_REQUIRES_FIVE_CANDIDATES';
  end if;

  update public.ebay_same_day_pilot_runs
  set factory_target_size = 5,
      desired_active_slots = 5,
      factory_status = case
        when factory_initialized_at is null then 'ACTIVE'
        else factory_status
      end,
      factory_mode = case
        when factory_initialized_at is null then 'DRY_RUN'
        else factory_mode
      end,
      publication_kill_switch_engaged = case
        when factory_initialized_at is null then true
        else publication_kill_switch_engaged
      end,
      automatic_publication_allowed = case
        when factory_initialized_at is null then false
        else automatic_publication_allowed
      end,
      factory_initialized_at = coalesce(factory_initialized_at, now()),
      factory_correlation_id = p_correlation_id,
      factory_updated_at = now()
  where id = p_run_id;

  with ranked_initial as (
    select id, row_number() over (order by ordinal, id) as position
    from public.ebay_same_day_pilot_candidates
    where run_id = p_run_id
      and factory_registered_at is null
      and v_initialized_at is null
  )
  update public.ebay_same_day_pilot_candidates candidate
  set slot_index = case
        when ranked_initial.position <= 5 then ranked_initial.position::integer
        else null
      end,
      candidate_role = case
        when ranked_initial.position <= 5 then 'ACTIVE'
        else 'RESERVE'
      end,
      active_slot = ranked_initial.position <= 5,
      factory_marketplace_account_key = run.marketplace_account_key,
      factory_marketplace = run.marketplace,
      factory_registered_at = now(),
      factory_state_version = factory_state_version + 1,
      last_factory_checkpoint_at = coalesce(last_factory_checkpoint_at, now())
  from ranked_initial
  join public.ebay_same_day_pilot_runs run on run.id = p_run_id
  where candidate.id = ranked_initial.id;

  update public.ebay_same_day_pilot_candidates candidate
  set slot_index = null,
      candidate_role = 'RESERVE',
      active_slot = false,
      factory_marketplace_account_key = run.marketplace_account_key,
      factory_marketplace = run.marketplace,
      factory_registered_at = now(),
      factory_state_version = factory_state_version + 1,
      last_factory_checkpoint_at = coalesce(last_factory_checkpoint_at, now())
  from public.ebay_same_day_pilot_runs run
  where run.id = p_run_id
    and candidate.run_id = run.id
    and candidate.factory_registered_at is null;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  )
  select
    candidate.run_id, candidate.id, candidate.factory_state,
    candidate.factory_state,
    case
      when candidate.active_slot then 'BATCH5_INITIALIZED'
      else 'BATCH5_RESERVE_REGISTERED'
    end,
    candidate.dossier_version,
    candidate.dossier_hash, 'SYSTEM', p_actor, p_correlation_id,
    candidate.last_factory_checkpoint,
    pg_catalog.encode(extensions.digest(
      'BATCH5_REGISTERED:' || candidate.id::text,
      'sha256'
    ), 'hex')
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.factory_registered_at is not null
  on conflict (idempotency_key) do nothing;

  loop
    select slots.slot_index
    into v_free_slot
    from generate_series(1, 5) as slots(slot_index)
    where not exists (
      select 1
      from public.ebay_same_day_pilot_candidates active_candidate
      where active_candidate.run_id = p_run_id
        and active_candidate.active_slot
        and active_candidate.slot_index = slots.slot_index
    )
    order by slots.slot_index
    limit 1;
    exit when v_free_slot is null;

    select candidate.id
    into v_replacement_id
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.run_id = p_run_id
      and candidate.candidate_role = 'RESERVE'
      and candidate.factory_registered_at is not null
      and not candidate.active_slot
      and candidate.factory_state not in (
        'QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED',
        'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
        'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD',
        'MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD',
        'WAITING_EXTERNAL_DEPENDENCY'
      )
    order by candidate.priority desc, candidate.ordinal
    for update skip locked
    limit 1;
    exit when v_replacement_id is null;

    update public.ebay_same_day_pilot_candidates
    set active_slot = true,
        slot_index = v_free_slot,
        candidate_role = 'REPLACEMENT',
        factory_state_version = factory_state_version + 1,
        factory_updated_at = now()
    where id = v_replacement_id;

    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    )
    select
      replacement.run_id, replacement.id, replacement.factory_state,
      replacement.factory_state, 'RESERVE_PROMOTED_TO_VACANT_SLOT',
      replacement.dossier_version, replacement.dossier_hash, 'SYSTEM',
      p_actor, p_correlation_id, replacement.last_factory_checkpoint,
      pg_catalog.encode(extensions.digest(
        'RESERVE_PROMOTED_TO_VACANT_SLOT:' || replacement.id::text,
        'sha256'
      ), 'hex')
    from public.ebay_same_day_pilot_candidates replacement
    where replacement.id = v_replacement_id
    on conflict (idempotency_key) do nothing;

    v_free_slot := null;
    v_replacement_id := null;
  end loop;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  )
  select
    candidate.run_id, candidate.id, candidate.factory_state,
    candidate.factory_state,
    case
      when candidate.active_slot then 'BATCH5_INITIALIZED'
      else 'BATCH5_RESERVE_REGISTERED'
    end,
    candidate.dossier_version,
    candidate.dossier_hash, 'SYSTEM', p_actor, p_correlation_id,
    candidate.last_factory_checkpoint,
    pg_catalog.encode(extensions.digest(
      'BATCH5_REGISTERED:' || candidate.id::text,
      'sha256'
    ), 'hex')
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.factory_registered_at is not null
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'runId', p_run_id,
    'activeSlots', (
      select count(*) from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and active_slot
    ),
    'reserveCandidates', (
      select count(*) from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and candidate_role = 'RESERVE'
    ),
    'mode', case when v_initialized_at is null then 'DRY_RUN' else v_mode end,
    'externalWritesAllowed', false,
    'idempotentReplay', v_initialized_at is not null
  );
end
$$;

create or replace function public.claim_ebay_listing_factory_candidate_v1(
  p_run_id uuid,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 360
)
returns table (
  candidate_id uuid,
  run_id uuid,
  factory_state text,
  slot_index integer,
  dossier_version integer,
  dossier_hash text,
  reserved_sku text,
  commercial_generation integer,
  frozen_payload_hash text,
  checkpoint jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate_id uuid;
  v_lease_token uuid := gen_random_uuid();
  v_desired_slots integer;
  v_leased_count integer;
  v_account_key text;
  v_marketplace text;
  v_previous_state text;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_LEASE_REQUEST';
  end if;

  select desired_active_slots, marketplace_account_key, marketplace
  into v_desired_slots, v_account_key, v_marketplace
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.ebay_listing_factory_dependency_circuits circuit
    where circuit.marketplace_account_key = v_account_key
      and circuit.marketplace = v_marketplace
      and (
        circuit.status = 'OPEN'
        or (
          circuit.status = 'HALF_OPEN'
          and circuit.half_open_probe_owner is distinct from p_worker
        )
      )
  ) then
    return;
  end if;

  select count(*) into v_leased_count
  from public.ebay_same_day_pilot_candidates
  where run_id = p_run_id
    and factory_lease_expires_at > p_now;
  if v_leased_count >= v_desired_slots then return; end if;

  select candidate.id, candidate.factory_state
  into v_candidate_id, v_previous_state
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.active_slot
    and candidate.factory_state not in (
      'DRAFT_READY','PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR',
      'REJECTED_TERMINAL','CANCELLED','WAITING_EXTERNAL_DEPENDENCY'
    )
    and (
      candidate.factory_lease_expires_at is null
      or candidate.factory_lease_expires_at <= p_now
    )
  order by candidate.slot_index, candidate.ordinal
  for update skip locked
  limit 1;

  if v_candidate_id is null then return; end if;

  update public.ebay_same_day_pilot_candidates
  set factory_lease_owner = p_worker,
      factory_lease_token = v_lease_token,
      factory_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      factory_heartbeat_at = p_now,
      factory_attempt_count = factory_attempt_count + 1,
      factory_state = case when factory_state = 'QUEUED' then 'CLAIMED' else factory_state end,
      factory_state_version = factory_state_version + 1
  where id = v_candidate_id;

  if v_previous_state = 'QUEUED' then
    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    )
    select
      candidate.run_id, candidate.id, 'QUEUED', 'CLAIMED',
      'FACTORY_CANDIDATE_CLAIMED', candidate.dossier_version,
      candidate.dossier_hash, 'SYSTEM', p_worker, v_lease_token,
      candidate.last_factory_checkpoint,
      pg_catalog.encode(extensions.digest(
        'FACTORY_CANDIDATE_CLAIMED:' || candidate.id::text || ':'
          || v_lease_token::text,
        'sha256'
      ), 'hex')
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.id = v_candidate_id;
  end if;

  return query
  select candidate.id, candidate.run_id, candidate.factory_state,
    candidate.slot_index, candidate.dossier_version, candidate.dossier_hash,
    candidate.reserved_sku, candidate.commercial_generation,
    candidate.frozen_payload_hash, candidate.last_factory_checkpoint,
    candidate.factory_lease_token
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = v_candidate_id;
end
$$;

create or replace function public.claim_ebay_listing_factory_candidate_by_id_v1(
  p_run_id uuid,
  p_candidate_id uuid,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 300
)
returns table (
  candidate_id uuid,
  run_id uuid,
  factory_state text,
  slot_index integer,
  dossier_version integer,
  dossier_hash text,
  reserved_sku text,
  commercial_generation integer,
  frozen_payload_hash text,
  checkpoint jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_token uuid := gen_random_uuid();
  v_desired_slots integer;
  v_leased_count integer;
  v_account_key text;
  v_marketplace text;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_LEASE_REQUEST';
  end if;

  select desired_active_slots, marketplace_account_key, marketplace
  into v_desired_slots, v_account_key, v_marketplace
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.ebay_listing_factory_dependency_circuits circuit
    where circuit.marketplace_account_key = v_account_key
      and circuit.marketplace = v_marketplace
      and (
        circuit.status = 'OPEN'
        or (
          circuit.status = 'HALF_OPEN'
          and circuit.half_open_probe_owner is distinct from p_worker
        )
      )
  ) then
    return;
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  if not v_candidate.active_slot
    or v_candidate.factory_state in (
      'DRAFT_READY','PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR',
      'REJECTED_TERMINAL','CANCELLED','WAITING_EXTERNAL_DEPENDENCY'
    )
    or (
      v_candidate.factory_lease_expires_at is not null
      and v_candidate.factory_lease_expires_at > p_now
    ) then
    return;
  end if;

  select count(*) into v_leased_count
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.id <> p_candidate_id
    and candidate.factory_lease_expires_at > p_now;
  if v_leased_count >= v_desired_slots then return; end if;

  update public.ebay_same_day_pilot_candidates as target
  set factory_lease_owner = p_worker,
      factory_lease_token = v_token,
      factory_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      factory_heartbeat_at = p_now,
      factory_attempt_count = target.factory_attempt_count + 1,
      factory_state = case
        when target.factory_state = 'QUEUED' then 'CLAIMED'
        else target.factory_state
      end,
      factory_state_version = target.factory_state_version + 1,
      factory_updated_at = p_now
  where target.id = p_candidate_id;

  if v_candidate.factory_state = 'QUEUED' then
    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    ) values (
      v_candidate.run_id, v_candidate.id, 'QUEUED', 'CLAIMED',
      'FACTORY_CANDIDATE_CLAIMED', v_candidate.dossier_version,
      v_candidate.dossier_hash, 'SYSTEM', p_worker, v_token,
      v_candidate.last_factory_checkpoint,
      pg_catalog.encode(extensions.digest(
        'FACTORY_CANDIDATE_CLAIMED:' || v_candidate.id::text || ':'
          || v_token::text,
        'sha256'
      ), 'hex')
    );
  end if;

  return query
  select candidate.id, candidate.run_id, candidate.factory_state,
    candidate.slot_index, candidate.dossier_version, candidate.dossier_hash,
    candidate.reserved_sku, candidate.commercial_generation,
    candidate.frozen_payload_hash, candidate.last_factory_checkpoint,
    candidate.factory_lease_token
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id;
end
$$;

create or replace function public.transition_ebay_listing_factory_candidate_v1(
  p_candidate_id uuid,
  p_expected_state text,
  p_next_state text,
  p_cause_code text,
  p_dossier_version integer,
  p_dossier_hash text,
  p_checkpoint jsonb,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_worker text default null,
  p_lease_token uuid default null,
  p_payload_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_replacement_id uuid;
  v_released_slot integer;
begin
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
    or p_dossier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'LISTING_FACTORY_INVALID_HASH';
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.ebay_listing_factory_transitions
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('candidateId', p_candidate_id, 'idempotentReplay', true);
  end if;
  if v_candidate.factory_state <> p_expected_state then
    raise exception 'LISTING_FACTORY_STATE_COMPARE_AND_SWAP_FAILED';
  end if;
  if p_worker is not null and (
    v_candidate.factory_lease_owner is distinct from p_worker
    or v_candidate.factory_lease_token is distinct from p_lease_token
    or v_candidate.factory_lease_expires_at <= now()
  ) then
    raise exception 'LISTING_FACTORY_LEASE_NOT_OWNED';
  end if;
  if p_worker is null
    and v_candidate.factory_lease_expires_at is not null
    and v_candidate.factory_lease_expires_at > now() then
    raise exception 'LISTING_FACTORY_ACTIVE_LEASE_REQUIRES_OWNER';
  end if;
  if not exists (
    select 1 from public.ebay_listing_factory_transition_rules
    where previous_state = p_expected_state and next_state = p_next_state and active
  ) then
    raise exception 'LISTING_FACTORY_TRANSITION_NOT_ALLOWED';
  end if;
  if p_expected_state in (
    'POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING','REJECTED_TERMINAL','CANCELLED'
  ) then
    raise exception 'LISTING_FACTORY_FINALIZED_STATE_IMMUTABLE';
  end if;
  if p_dossier_version > 0 and not exists (
    select 1 from public.ebay_listing_factory_dossiers
    where candidate_id = p_candidate_id
      and version = p_dossier_version
      and dossier_hash = p_dossier_hash
  ) then
    raise exception 'LISTING_FACTORY_DOSSIER_VERSION_NOT_FOUND';
  end if;

  v_released_slot := case
    when p_next_state in (
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD',
      'MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD'
    ) then v_candidate.slot_index
    else null
  end;

  update public.ebay_same_day_pilot_candidates
  set factory_state = p_next_state,
      factory_state_version = factory_state_version + 1,
      dossier_version = p_dossier_version,
      dossier_hash = p_dossier_hash,
      frozen_payload_hash = coalesce(p_payload_hash, frozen_payload_hash),
      last_factory_checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
      last_factory_checkpoint_at = now(),
      active_slot = case when v_released_slot is not null then false else active_slot end,
      slot_index = case when v_released_slot is not null then null else slot_index end,
      factory_last_error_code = null,
      factory_updated_at = now()
  where id = p_candidate_id;

  if v_released_slot is not null then
    select candidate.id into v_replacement_id
    from public.ebay_same_day_pilot_candidates candidate
    join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
    where candidate.run_id = v_candidate.run_id
      and run.reserve_enabled
      and candidate.candidate_role = 'RESERVE'
      and candidate.factory_registered_at is not null
      and not candidate.active_slot
      and candidate.factory_state not in (
        'QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED',
        'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING'
      )
    order by candidate.priority desc, candidate.ordinal
    for update of candidate skip locked
    limit 1;

    if v_replacement_id is not null then
      update public.ebay_same_day_pilot_candidates
      set active_slot = true,
          slot_index = v_released_slot,
          candidate_role = 'REPLACEMENT',
          replaces_candidate_id = p_candidate_id,
          factory_state_version = factory_state_version + 1,
          factory_updated_at = now()
      where id = v_replacement_id;

      insert into public.ebay_listing_factory_transitions (
        run_id, candidate_id, previous_state, next_state, cause_code,
        dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
        checkpoint, idempotency_key
      )
      select
        replacement.run_id, replacement.id, replacement.factory_state,
        replacement.factory_state, 'RESERVE_PROMOTED_AFTER_HOLD',
        replacement.dossier_version, replacement.dossier_hash, 'SYSTEM',
        p_actor_id, p_correlation_id, replacement.last_factory_checkpoint,
        pg_catalog.encode(extensions.digest(
          'RESERVE_PROMOTED_AFTER_HOLD:' || p_idempotency_key || ':'
            || replacement.id::text,
          'sha256'
        ), 'hex')
      from public.ebay_same_day_pilot_candidates replacement
      where replacement.id = v_replacement_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  ) values (
    v_candidate.run_id, p_candidate_id, p_expected_state, p_next_state, p_cause_code,
    p_dossier_version, p_dossier_hash, p_actor_kind, p_actor_id, p_correlation_id,
    coalesce(p_checkpoint, '{}'::jsonb), p_idempotency_key
  );

  return jsonb_build_object(
    'candidateId', p_candidate_id, 'previousState', p_expected_state,
    'nextState', p_next_state, 'idempotentReplay', false
  );
end
$$;

create or replace function public.resolve_ebay_listing_factory_circuit_probe_v1(
  p_marketplace_account_key text,
  p_marketplace text,
  p_dependency text,
  p_worker text,
  p_recovered boolean,
  p_error_code text default null,
  p_sanitized_error text default null,
  p_retry_after timestamptz default null,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_circuit public.ebay_listing_factory_dependency_circuits%rowtype;
  v_waiting record;
  v_resume_state text;
begin
  if length(coalesce(p_sanitized_error, '')) > 500 then
    raise exception 'LISTING_FACTORY_SANITIZED_ERROR_TOO_LONG';
  end if;
  select * into v_circuit
  from public.ebay_listing_factory_dependency_circuits
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and dependency = p_dependency
  for update;
  if not found then raise exception 'LISTING_FACTORY_CIRCUIT_NOT_FOUND'; end if;
  if v_circuit.status <> 'HALF_OPEN'
    or v_circuit.half_open_probe_owner is distinct from p_worker
    or v_circuit.half_open_probe_expires_at <= p_now then
    raise exception 'LISTING_FACTORY_CIRCUIT_PROBE_NOT_OWNED';
  end if;

  if p_recovered then
    update public.ebay_listing_factory_dependency_circuits
    set status = 'CLOSED',
        failure_count = 0,
        opened_at = null,
        retry_after = null,
        half_open_probe_owner = null,
        half_open_probe_expires_at = null,
        last_error_code = null,
        sanitized_error = null,
        updated_at = p_now
    where id = v_circuit.id;
    if not exists (
      select 1
      from public.ebay_listing_factory_dependency_circuits circuit
      where circuit.marketplace_account_key = p_marketplace_account_key
        and circuit.marketplace = p_marketplace
        and circuit.status in ('OPEN', 'HALF_OPEN')
    ) then
      for v_waiting in
        select candidate.*
        from public.ebay_same_day_pilot_candidates candidate
        join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
        where run.marketplace_account_key = p_marketplace_account_key
          and run.marketplace = p_marketplace
          and candidate.factory_state = 'WAITING_EXTERNAL_DEPENDENCY'
        for update of candidate
      loop
        select transition.previous_state
        into v_resume_state
        from public.ebay_listing_factory_transitions transition
        where transition.candidate_id = v_waiting.id
          and transition.next_state = 'WAITING_EXTERNAL_DEPENDENCY'
        order by transition.occurred_at desc, transition.id desc
        limit 1;
        if v_resume_state in (
          'QUEUED','CLAIMED','MARKET_RESEARCH','IDENTITY_VERIFIED',
          'SUPPLY_VERIFIED','DEMAND_VALIDATED','ECONOMICS_PASSED',
          'CATEGORY_AND_COMPLIANCE_PASSED','LISTING_INTELLIGENCE_READY',
          'VISUAL_PACKAGE_READY','FINAL_QA_PASSED','DRAFT_READY',
          'APPROVED_TO_PUBLISH','PUBLISHING','PUBLISHED'
        ) then
          insert into public.ebay_listing_factory_transitions (
            run_id, candidate_id, previous_state, next_state, cause_code,
            dossier_version, dossier_hash, actor_kind, actor_id,
            correlation_id, checkpoint, idempotency_key
          ) values (
            v_waiting.run_id, v_waiting.id, 'WAITING_EXTERNAL_DEPENDENCY',
            v_resume_state, 'DEPENDENCY_CIRCUIT_RECOVERED',
            v_waiting.dossier_version, v_waiting.dossier_hash, 'RETRY',
            p_worker, gen_random_uuid(), v_waiting.last_factory_checkpoint,
            pg_catalog.encode(extensions.digest(
              'DEPENDENCY_CIRCUIT_RECOVERED:' || v_circuit.id::text || ':'
                || v_waiting.id::text,
              'sha256'
            ), 'hex')
          ) on conflict (idempotency_key) do nothing;
          update public.ebay_same_day_pilot_candidates
          set factory_state = v_resume_state,
              factory_state_version = factory_state_version + 1,
              factory_updated_at = p_now
          where id = v_waiting.id
            and factory_state = 'WAITING_EXTERNAL_DEPENDENCY';
        end if;
      end loop;
    end if;
    return 'CLOSED';
  end if;

  update public.ebay_listing_factory_dependency_circuits
  set status = 'OPEN',
      failure_count = failure_count + 1,
      opened_at = coalesce(opened_at, p_now),
      retry_after = coalesce(p_retry_after, p_now + interval '5 minutes'),
      half_open_probe_owner = null,
      half_open_probe_expires_at = null,
      last_error_code = p_error_code,
      sanitized_error = p_sanitized_error,
      updated_at = p_now
  where id = v_circuit.id;
  return 'OPEN';
end
$$;

commit;
