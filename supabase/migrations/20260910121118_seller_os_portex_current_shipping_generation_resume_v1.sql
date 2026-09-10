-- Historical incident rows and markers are immutable. Current shipping gets its
-- own generation budget, discovery, and existing-leader durable admission gate.
alter table public.seller_os_economic_evidence_refresh_jobs_v1
  add column shipping_refresh_attempt_count integer not null default 0
    check (shipping_refresh_attempt_count >= 0),
  add column shipping_execution_authority text null
    check (shipping_execution_authority is null or shipping_execution_authority='CURRENT_OPERATIONAL_V1');
alter table public.seller_os_browser_workload_leases_v1
  add column shipping_capture_state text not null default 'UNAVAILABLE'
    check (shipping_capture_state in ('AVAILABLE','UNAVAILABLE')),
  add column shipping_capability_worker_id text null,
  add column shipping_capability_observed_at timestamptz null,
  add column shipping_capability_transition bigint not null default 0,
  add column shipping_next_attempt_at timestamptz null;

-- Read-only, one-row discovery; capability heartbeat never invokes this function.
create or replace function public.discover_seller_os_current_shipping_refresh_v1(
  p_marketplace_account_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  select jsonb_build_object('job_id',j.job_id,'marketplace_account_key',j.marketplace_account_key,
    'ebay_item_id',j.ebay_item_id,'source_identity',j.source_identity,'status',j.status,
    'last_evidence_id',j.last_evidence_id,'next_retry_at',j.next_retry_at,
    'attempt_count',j.attempt_count,'first_detected_at',j.first_detected_at,
    'lease_owner',j.lease_owner,'lease_expires_at',j.lease_expires_at)
  into v_result
  from public.seller_os_economic_evidence_refresh_jobs_v1 j
  where j.marketplace_account_key=p_marketplace_account_key
    and j.evidence_type='LUNA_CURRENT_SHIPPING'
    and (j.status in ('STALE','MISSING','WAITING_FOR_WORKER','FAILED_RETRYABLE')
      or (j.status='FRESH' and exists (
        select 1 from public.seller_os_live_economic_evidence_v1 e
        where e.evidence_id=j.last_evidence_id and e.fresh_until<=clock_timestamp()))
      or (j.status='REFRESHING' and j.lease_expires_at<=clock_timestamp()))
    and (j.next_retry_at is null or j.next_retry_at<=clock_timestamp())
    and (j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp())
    and (j.shipping_legacy_recovery_generation is null or exists (
      select 1 from public.seller_os_economic_shipping_legacy_recoveries_v1 r
      where r.job_id=j.job_id and r.marketplace_account_key=j.marketplace_account_key
        and r.recovery_generation=j.shipping_legacy_recovery_generation and r.status='COMPLETED'))
    and exists (select 1 from public.ebay_active_listings l
      where l.account_key=j.marketplace_account_key and l.ebay_item_id=j.ebay_item_id
        and lower(l.listing_status)='active')
  order by j.last_detected_at,j.job_id limit 1;
  return case when v_result is null then '[]'::jsonb else jsonb_build_array(v_result) end;
end; $$;

-- This gate touches only the existing lease row. No jobs are scanned or claimed.
-- A fresh read-only executor probe, never a connection heartbeat, supplies state.
create or replace function public.gate_seller_os_shipping_capture_v1(
  p_marketplace_account_key text, p_worker_id text, p_leader_session_id uuid,
  p_action text, p_capture_state text default null,
  p_probe_observed_at timestamptz default null,
  p_retry_after timestamptz default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp(); v_state text; v_next timestamptz;
  v_worker text; v_observed timestamptz; v_transition bigint;
begin
  if not public.is_seller_os_service_role_request_v1() or
    p_action not in ('READ','CAPABILITY','ACQUIRE','BACKOFF') then
    raise exception 'SHIPPING_CAPABILITY_GATE_INVALID';
  end if;
  select shipping_capture_state,shipping_next_attempt_at,shipping_capability_worker_id,
    shipping_capability_observed_at,shipping_capability_transition
    into v_state,v_next,v_worker,v_observed,v_transition
  from public.seller_os_browser_workload_leases_v1
  where marketplace_account_key=p_marketplace_account_key and worker_family='LUNA_SHIPPING'
    and leader_session_id=p_leader_session_id and worker_instance_id=p_worker_id
    and lease_expires_at>v_now for update;
  if not found then return jsonb_build_object('allowed',false,'reasonCode','FOLLOWER_SUPPRESSED'); end if;
  if p_action='CAPABILITY' then
    if p_capture_state is null or p_capture_state not in ('AVAILABLE','UNAVAILABLE')
      or p_probe_observed_at is null or p_probe_observed_at>v_now+interval '1 minute'
      or p_probe_observed_at<v_now-interval '5 minutes'
      or (v_worker=p_worker_id and p_probe_observed_at<v_observed) then
      return jsonb_build_object('allowed',false,'reasonCode','CAPABILITY_PROOF_STALE');
    end if;
    -- Repeated AVAILABLE reports cannot erase a durable cooldown, including 429.
    update public.seller_os_browser_workload_leases_v1
    set shipping_capture_state=p_capture_state,shipping_capability_worker_id=p_worker_id,
      shipping_capability_observed_at=p_probe_observed_at,
      shipping_capability_transition=shipping_capability_transition+
        case when shipping_capture_state is distinct from p_capture_state then 1 else 0 end
    where marketplace_account_key=p_marketplace_account_key and worker_family='LUNA_SHIPPING';
    return jsonb_build_object('allowed',false,'state',p_capture_state,
      'transition',v_state is distinct from p_capture_state,'nextAttemptAt',v_next);
  end if;
  if p_action='BACKOFF' then
    v_next:=greatest(v_next, p_retry_after,
      v_now+public.seller_os_economic_shipping_retry_delay_v1(5)*(1+random()*0.1));
    update public.seller_os_browser_workload_leases_v1
    set shipping_capture_state='UNAVAILABLE',shipping_next_attempt_at=v_next
    where marketplace_account_key=p_marketplace_account_key and worker_family='LUNA_SHIPPING';
    return jsonb_build_object('allowed',false,'state','UNAVAILABLE','nextAttemptAt',v_next);
  end if;
  if v_state<>'AVAILABLE' or v_worker is distinct from p_worker_id
    or v_observed is null or v_observed<v_now-interval '5 minutes' then
    return jsonb_build_object('allowed',false,'reasonCode','WAITING_FOR_CAPTURE_CAPABILITY',
      'nextAttemptAt',v_next);
  end if;
  if v_next>v_now then return jsonb_build_object('allowed',false,
    'reasonCode','WAIT_RETRY_WINDOW','nextAttemptAt',v_next); end if;
  if p_action='ACQUIRE' then
    -- Reserve before discovery: reloads, duplicate transitions and empty results
    -- cannot cause a second claim in this fifteen-minute window.
    v_next:=v_now+interval '15 minutes';
    update public.seller_os_browser_workload_leases_v1 set shipping_next_attempt_at=v_next
    where marketplace_account_key=p_marketplace_account_key and worker_family='LUNA_SHIPPING';
  end if;
  return jsonb_build_object('allowed',p_action='ACQUIRE','state',v_state,
    'nextAttemptAt',v_next,'transitionGeneration',v_transition);
end; $$;
revoke all on function public.discover_seller_os_current_shipping_refresh_v1(text) from public,anon,authenticated;
grant execute on function public.discover_seller_os_current_shipping_refresh_v1(text) to service_role;
revoke all on function public.gate_seller_os_shipping_capture_v1(text,text,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.gate_seller_os_shipping_capture_v1(text,text,uuid,text,text,timestamptz,timestamptz) to service_role;

create or replace function public.admit_seller_os_economic_shipping_refresh_v1(
  p_job_id uuid,
  p_worker_id text,
  p_candidate_id text,
  p_snapshot_digest text,
  p_capture_session_id uuid,
  p_freshness_generation text,
  p_required_evidence_after timestamptz,
  p_reuse_fresh_evidence boolean default false,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempt integer;
  v_secondary_admitted boolean := false;
  v_secondary_status text;
  v_terminal boolean;
  v_reason text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_worker_id, ''))) not between 8 and 160
      or p_worker_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_candidate_id !~ '^sha256:[0-9a-f]{64}$'
      or p_snapshot_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_freshness_generation !~
        '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$'
      or p_required_evidence_after is null
      or p_capture_session_id is null
      or p_lease_seconds not between 30 and 900
      or p_max_attempts not between 1 and 20 then
    raise exception 'SELLER_OS_ECONOMIC_SHIPPING_ADMISSION_INVALID';
  end if;

  select last_evidence_id,failure_class,job_id,evidence_type,status,next_retry_at,lease_expires_at,attempt_count,marketplace_account_key,lease_owner,shipping_freshness_generation,shipping_refresh_attempt_count,shipping_legacy_recovery_generation into v_job.last_evidence_id,v_job.failure_class,v_job.job_id,v_job.evidence_type,v_job.status,v_job.next_retry_at,v_job.lease_expires_at,v_job.attempt_count,v_job.marketplace_account_key,v_job.lease_owner,v_job.shipping_freshness_generation,v_job.shipping_refresh_attempt_count,v_job.shipping_legacy_recovery_generation
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id
  for update;

  if not found or v_job.evidence_type <> 'LUNA_CURRENT_SHIPPING' then
    return jsonb_build_object('admitted', false,
      'reasonCode', 'ECONOMIC_SHIPPING_JOB_NOT_FOUND');
  end if;
  if not (v_job.status in ('STALE','MISSING','WAITING_FOR_WORKER','FAILED_RETRYABLE')
      or (v_job.status='FRESH' and exists (
        select 1 from public.seller_os_live_economic_evidence_v1 e
        where e.evidence_id=v_job.last_evidence_id and e.fresh_until<=v_now))
      or (v_job.status='REFRESHING' and v_job.lease_expires_at<=v_now))
      or (v_job.next_retry_at is not null and v_job.next_retry_at > v_now)
      or (v_job.lease_expires_at is not null and
        v_job.lease_expires_at > v_now) then
    return jsonb_build_object('admitted', false,
      'reasonCode', 'ECONOMIC_SHIPPING_JOB_NOT_CLAIMABLE');
  end if;

  if not p_reuse_fresh_evidence and not exists (
    select 1 from public.seller_os_browser_workload_leases_v1 l
    where l.marketplace_account_key=v_job.marketplace_account_key
      and l.worker_family='LUNA_SHIPPING' and l.worker_instance_id=p_worker_id
      and l.lease_expires_at>v_now and l.shipping_capture_state='AVAILABLE'
      and l.shipping_capability_worker_id=p_worker_id
      and l.shipping_capability_observed_at>=v_now-interval '5 minutes'
  ) then return jsonb_build_object('admitted',false,
    'reasonCode','WAITING_FOR_CAPTURE_CAPABILITY'); end if;

  v_attempt := case when v_job.shipping_freshness_generation is distinct from
    p_freshness_generation then 1 else v_job.shipping_refresh_attempt_count + 1 end;
  if v_job.shipping_legacy_recovery_generation is not null and not exists (
    select 1 from public.seller_os_economic_shipping_legacy_recoveries_v1 r
    where r.job_id=p_job_id and r.marketplace_account_key=v_job.marketplace_account_key
      and r.recovery_generation=v_job.shipping_legacy_recovery_generation
      and r.status='COMPLETED'
      and r.shipping_freshness_generation is distinct from p_freshness_generation
  ) then
    return jsonb_build_object('admitted',false,'reasonCode','HISTORICAL_RECOVERY_AUTHORITY_RESERVED');
  end if;
  if v_attempt > p_max_attempts and coalesce(v_job.failure_class,'') !~ '(429|RATE_LIMIT|CAPTURE|BROWSER_UNAVAILABLE|TEMPORAR|TIMEOUT)' then
    update public.seller_os_economic_evidence_refresh_jobs_v1
    set status = 'FAILED_TERMINAL',
        failure_class = 'ECONOMIC_SHIPPING_MAX_ATTEMPTS_EXHAUSTED',
        next_retry_at = null, lease_owner = null, lease_expires_at = null,
        dead_letter_at = v_now, updated_at = v_now
    where job_id = p_job_id;
    return jsonb_build_object('admitted', false,
      'reasonCode', 'ECONOMIC_SHIPPING_DEAD_LETTER',
      'attemptOrdinal', v_job.attempt_count, 'deadLetter', true);
  end if;

  if not p_reuse_fresh_evidence then
    insert into public.seller_os_luna_shipping_job_claims as claim (
      account_key, candidate_id, snapshot_digest, runtime_instance_id,
      capture_session_id, status, claimed_at, lease_expires_at,
      completed_at, updated_at, freshness_generation,
      required_evidence_after
    ) values (
      v_job.marketplace_account_key, p_candidate_id, p_snapshot_digest,
      p_worker_id::uuid, p_capture_session_id, 'CLAIMED', v_now,
      v_now + make_interval(secs => p_lease_seconds), null, v_now,
      p_freshness_generation, p_required_evidence_after
    )
    on conflict (account_key, candidate_id) do update set
      snapshot_digest = excluded.snapshot_digest,
      runtime_instance_id = excluded.runtime_instance_id,
      capture_session_id = excluded.capture_session_id,
      status = 'CLAIMED', claimed_at = excluded.claimed_at,
      lease_expires_at = excluded.lease_expires_at, completed_at = null,
      updated_at = excluded.updated_at,
      freshness_generation = excluded.freshness_generation,
      required_evidence_after = excluded.required_evidence_after
    where (claim.status = 'COMPLETED' and
        claim.freshness_generation is distinct from
          excluded.freshness_generation)
      or (claim.status = 'CLAIMED' and claim.lease_expires_at <= v_now)
    returning true into v_secondary_admitted;

    if not coalesce(v_secondary_admitted, false) then
      select status into v_secondary_status
      from public.seller_os_luna_shipping_job_claims
      where account_key = v_job.marketplace_account_key
        and candidate_id = p_candidate_id;
      v_terminal := v_attempt >= p_max_attempts;
      v_reason := case when v_secondary_status = 'COMPLETED'
        then 'ECONOMIC_SHIPPING_COMPLETED_GENERATION_NOT_REUSABLE'
        else 'ECONOMIC_SHIPPING_EXECUTOR_ADMISSION_CONFLICT' end;
      update public.seller_os_economic_evidence_refresh_jobs_v1
      set status = case when v_terminal then 'FAILED_TERMINAL'
          else 'FAILED_RETRYABLE' end,
          attempt_count = attempt_count + 1, shipping_refresh_attempt_count = v_attempt, failure_class = v_reason,
          next_retry_at = case when v_terminal then null else
            v_now + public.seller_os_economic_shipping_retry_delay_v1(
              v_attempt) end,
          lease_owner = null, lease_expires_at = null,
          shipping_execution_authority = 'CURRENT_OPERATIONAL_V1',
          shipping_freshness_generation = p_freshness_generation,
          shipping_required_evidence_after = p_required_evidence_after,
          dead_letter_at = case when v_terminal then v_now else null end,
          updated_at = v_now
      where job_id = p_job_id;
      return jsonb_build_object('admitted', false,
        'reasonCode', v_reason, 'attemptOrdinal', v_attempt,
        'deadLetter', v_terminal);
    end if;
  end if;

  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status = 'REFRESHING', attempt_count = attempt_count + 1, shipping_refresh_attempt_count = v_attempt,
      lease_owner = p_worker_id,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      failure_class = null, next_retry_at = null,
      shipping_execution_authority = 'CURRENT_OPERATIONAL_V1',
          shipping_freshness_generation = p_freshness_generation,
      shipping_required_evidence_after = p_required_evidence_after,
      dead_letter_at = null, updated_at = v_now
  where job_id = p_job_id;

  return jsonb_build_object('admitted', true,
    'reasonCode', case when p_reuse_fresh_evidence
      then 'FRESH_EVIDENCE_REUSE_ADMITTED'
      else 'SHIPPING_EXECUTOR_ADMITTED' end,
    'attemptOrdinal', v_attempt,
    'leaseExpiresAt', v_now + make_interval(secs => p_lease_seconds),
    'freshnessGeneration', p_freshness_generation,
    'deadLetter', false);
end;
$$;

create or replace function public.fail_seller_os_economic_shipping_refresh_v1(
  p_job_id uuid,
  p_worker_id text,
  p_freshness_generation text,
  p_reason_code text,
  p_retryable boolean default true,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_terminal boolean;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_worker_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_freshness_generation !~
        '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$'
      or p_reason_code !~ '^[A-Z0-9_]{8,160}$'
      or p_max_attempts not between 1 and 20 then
    raise exception 'SELLER_OS_ECONOMIC_SHIPPING_FAILURE_INVALID';
  end if;
  select last_evidence_id,failure_class,job_id,evidence_type,status,next_retry_at,lease_expires_at,attempt_count,marketplace_account_key,lease_owner,shipping_freshness_generation,shipping_refresh_attempt_count,shipping_legacy_recovery_generation into v_job.last_evidence_id,v_job.failure_class,v_job.job_id,v_job.evidence_type,v_job.status,v_job.next_retry_at,v_job.lease_expires_at,v_job.attempt_count,v_job.marketplace_account_key,v_job.lease_owner,v_job.shipping_freshness_generation,v_job.shipping_refresh_attempt_count,v_job.shipping_legacy_recovery_generation
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id for update;
  if not found or v_job.status <> 'REFRESHING'
      or v_job.lease_owner is distinct from p_worker_id
      or v_job.shipping_freshness_generation is distinct from
        p_freshness_generation then
    return jsonb_build_object('closed', false,
      'reasonCode', 'ECONOMIC_SHIPPING_FAILURE_BINDING_MISMATCH');
  end if;
  v_terminal := not p_retryable or (v_job.shipping_refresh_attempt_count >= p_max_attempts and p_reason_code !~ '(429|RATE_LIMIT|CAPTURE|BROWSER_UNAVAILABLE|TEMPORAR|TIMEOUT)');
  -- Release only the generation admitted by this economic transaction. A
  -- different worker/generation remains untouched, while this failed executor
  -- cannot hold the secondary claim throughout the durable retry backoff.
  update public.seller_os_luna_shipping_job_claims
  set lease_expires_at = greatest(v_now, claimed_at + interval '1 millisecond'),
      updated_at = v_now
  where account_key = v_job.marketplace_account_key
    and freshness_generation = p_freshness_generation
    and runtime_instance_id = p_worker_id::uuid
    and status = 'CLAIMED';
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status = case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,
      failure_class = p_reason_code,
      next_retry_at = case when v_terminal then null else
        v_now + public.seller_os_economic_shipping_retry_delay_v1(
          greatest(shipping_refresh_attempt_count,5)) * (1 + random()*0.1) end,
      lease_owner = null, lease_expires_at = null,
      dead_letter_at = case when v_terminal then v_now else null end,
      updated_at = v_now
  where job_id = p_job_id;
  return jsonb_build_object('closed', true,
    'status', case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,
    'reasonCode', p_reason_code, 'deadLetter', v_terminal);
end;
$$;

create or replace function public.close_seller_os_economic_shipping_preclaim_v1(
  p_job_id uuid,
  p_reason_code text,
  p_retryable boolean default true,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempt integer;
  v_terminal boolean;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_reason_code !~ '^[A-Z0-9_]{8,160}$'
      or p_max_attempts not between 1 and 20 then
    raise exception 'SELLER_OS_ECONOMIC_SHIPPING_PRECLAIM_FAILURE_INVALID';
  end if;
  select last_evidence_id,failure_class,job_id,evidence_type,status,next_retry_at,lease_expires_at,attempt_count,marketplace_account_key,lease_owner,shipping_freshness_generation,shipping_refresh_attempt_count,shipping_legacy_recovery_generation into v_job.last_evidence_id,v_job.failure_class,v_job.job_id,v_job.evidence_type,v_job.status,v_job.next_retry_at,v_job.lease_expires_at,v_job.attempt_count,v_job.marketplace_account_key,v_job.lease_owner,v_job.shipping_freshness_generation,v_job.shipping_refresh_attempt_count,v_job.shipping_legacy_recovery_generation
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id for update;
  if not found or v_job.evidence_type <> 'LUNA_CURRENT_SHIPPING'
      or v_job.status not in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
        'FAILED_RETRYABLE') then
    return jsonb_build_object('closed', false,
      'reasonCode', 'ECONOMIC_SHIPPING_PRECLAIM_NOT_CLOSABLE');
  end if;
  v_attempt := v_job.shipping_refresh_attempt_count + 1;
  v_terminal := not p_retryable or (v_attempt >= p_max_attempts and p_reason_code !~ '(429|RATE_LIMIT|CAPTURE|BROWSER_UNAVAILABLE|TEMPORAR|TIMEOUT)');
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status = case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,
      attempt_count = attempt_count + 1, shipping_refresh_attempt_count = v_attempt, failure_class = p_reason_code,
      next_retry_at = case when v_terminal then null else
        v_now + public.seller_os_economic_shipping_retry_delay_v1(
          greatest(v_attempt,5)) * (1 + random()*0.1) end,
      lease_owner = null, lease_expires_at = null,
      dead_letter_at = case when v_terminal then v_now else null end,
      updated_at = v_now
  where job_id = p_job_id;
  return jsonb_build_object('closed', true,
    'status', case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,
    'reasonCode', p_reason_code, 'attemptOrdinal', v_attempt,
    'deadLetter', v_terminal);
end;
$$;

revoke all on function public.admit_seller_os_economic_shipping_refresh_v1(
  uuid,text,text,text,uuid,text,timestamptz,boolean,integer,integer)
  from public, anon, authenticated;
revoke all on function public.fail_seller_os_economic_shipping_refresh_v1(
  uuid,text,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function public.close_seller_os_economic_shipping_preclaim_v1(
  uuid,text,boolean,integer) from public, anon, authenticated;
grant execute on function public.admit_seller_os_economic_shipping_refresh_v1(
  uuid,text,text,text,uuid,text,timestamptz,boolean,integer,integer)
  to service_role;
grant execute on function public.fail_seller_os_economic_shipping_refresh_v1(
  uuid,text,text,text,boolean,integer) to service_role;
grant execute on function public.close_seller_os_economic_shipping_preclaim_v1(
  uuid,text,boolean,integer) to service_role;


-- Shipping is routed exclusively through the capability-gated producer.
create or replace function public.claim_seller_os_economic_refresh_jobs_v1(
  p_marketplace_account_key text,
  p_worker_id text,
  p_evidence_types text[] default null,
  p_limit integer default 4,
  p_lease_seconds integer default 180
)
returns setof public.seller_os_economic_evidence_refresh_jobs_v1
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 200
      or p_worker_id is null or char_length(p_worker_id) not between 8 and 160
      or p_limit not between 1 and 100
      or p_lease_seconds not between 30 and 900 then
    raise exception 'SELLER_OS_ECONOMIC_REFRESH_CLAIM_INVALID';
  end if;
  return query
  with selected as (
    select job_id from public.seller_os_economic_evidence_refresh_jobs_v1
    where marketplace_account_key=p_marketplace_account_key
      and status in ('STALE','MISSING','WAITING_FOR_WORKER',
        'FAILED_RETRYABLE')
      and (p_evidence_types is null or evidence_type=any(p_evidence_types))
      and (next_retry_at is null or next_retry_at<=clock_timestamp())
      and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
      and evidence_type <> 'LUNA_CURRENT_SHIPPING'
    order by case status when 'MISSING' then 0 when 'STALE' then 1
      when 'FAILED_RETRYABLE' then 2 else 3 end,
      last_detected_at,ebay_item_id,evidence_type
    for update skip locked limit p_limit
  )
  update public.seller_os_economic_evidence_refresh_jobs_v1 job
  set status='REFRESHING',lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+
        make_interval(secs=>p_lease_seconds),
      attempt_count=job.attempt_count+1,updated_at=clock_timestamp()
  from selected where job.job_id=selected.job_id
  returning job.*;
end;
$$;
