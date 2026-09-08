-- Bound the economic -> browser Shipping handoff.  The economic job is only
-- marked REFRESHING in the same transaction that admits a generation-specific
-- Shipping execution.  Every rejection/failure receives a durable terminal or
-- retryable outcome; no global trigger or existing claim authority is disabled.

alter table public.seller_os_economic_evidence_refresh_jobs_v1
  add column shipping_freshness_generation text null,
  add column shipping_required_evidence_after timestamptz null,
  add column dead_letter_at timestamptz null;

alter table public.seller_os_luna_shipping_job_claims
  add column freshness_generation text not null default 'LEGACY_V1',
  add column required_evidence_after timestamptz null;

alter table public.seller_os_economic_evidence_refresh_jobs_v1
  add constraint seller_os_economic_shipping_generation_check check (
    shipping_freshness_generation is null or
    shipping_freshness_generation ~
      '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$'
  );

alter table public.seller_os_luna_shipping_job_claims
  add constraint seller_os_shipping_freshness_generation_check check (
    freshness_generation = 'LEGACY_V1' or
    freshness_generation ~
      '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$'
  );

create index seller_os_economic_shipping_retry_v1_idx
  on public.seller_os_economic_evidence_refresh_jobs_v1(
    marketplace_account_key, next_retry_at, attempt_count, last_detected_at
  ) where evidence_type = 'LUNA_CURRENT_SHIPPING'
    and status in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
      'FAILED_RETRYABLE');

create or replace function public.seller_os_economic_shipping_retry_delay_v1(
  p_attempt integer
) returns interval
language sql immutable
set search_path = pg_catalog
as $$
  select make_interval(mins => case
    when p_attempt <= 1 then 1
    when p_attempt = 2 then 2
    when p_attempt = 3 then 4
    when p_attempt = 4 then 8
    else 15 end);
$$;

revoke all on function public.seller_os_economic_shipping_retry_delay_v1(
  integer) from public, anon, authenticated;
grant execute on function public.seller_os_economic_shipping_retry_delay_v1(
  integer) to service_role;

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

  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id
  for update;

  if not found or v_job.evidence_type <> 'LUNA_CURRENT_SHIPPING' then
    return jsonb_build_object('admitted', false,
      'reasonCode', 'ECONOMIC_SHIPPING_JOB_NOT_FOUND');
  end if;
  if v_job.status not in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
      'FAILED_RETRYABLE')
      or (v_job.next_retry_at is not null and v_job.next_retry_at > v_now)
      or (v_job.lease_expires_at is not null and
        v_job.lease_expires_at > v_now) then
    return jsonb_build_object('admitted', false,
      'reasonCode', 'ECONOMIC_SHIPPING_JOB_NOT_CLAIMABLE');
  end if;

  v_attempt := v_job.attempt_count + 1;
  if v_attempt > p_max_attempts then
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
          attempt_count = v_attempt, failure_class = v_reason,
          next_retry_at = case when v_terminal then null else
            v_now + public.seller_os_economic_shipping_retry_delay_v1(
              v_attempt) end,
          lease_owner = null, lease_expires_at = null,
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
  set status = 'REFRESHING', attempt_count = v_attempt,
      lease_owner = p_worker_id,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      failure_class = null, next_retry_at = null,
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
  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id for update;
  if not found or v_job.status <> 'REFRESHING'
      or v_job.lease_owner is distinct from p_worker_id
      or v_job.shipping_freshness_generation is distinct from
        p_freshness_generation then
    return jsonb_build_object('closed', false,
      'reasonCode', 'ECONOMIC_SHIPPING_FAILURE_BINDING_MISMATCH');
  end if;
  v_terminal := not p_retryable or v_job.attempt_count >= p_max_attempts;
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
          attempt_count) end,
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
  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id = p_job_id for update;
  if not found or v_job.evidence_type <> 'LUNA_CURRENT_SHIPPING'
      or v_job.status not in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
        'FAILED_RETRYABLE') then
    return jsonb_build_object('closed', false,
      'reasonCode', 'ECONOMIC_SHIPPING_PRECLAIM_NOT_CLOSABLE');
  end if;
  v_attempt := v_job.attempt_count + 1;
  v_terminal := not p_retryable or v_attempt >= p_max_attempts;
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status = case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,
      attempt_count = v_attempt, failure_class = p_reason_code,
      next_retry_at = case when v_terminal then null else
        v_now + public.seller_os_economic_shipping_retry_delay_v1(
          v_attempt) end,
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

-- Keep general capability observations intact, but persist the granted leader
-- separately so a follower heartbeat cannot overwrite claim-authority truth.
create table public.seller_os_browser_workload_leader_heartbeats_v1 (
  marketplace_account_key text not null,
  worker_family text not null,
  leader_session_id uuid not null,
  worker_instance_id text not null,
  lease_generation bigint not null,
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (marketplace_account_key, worker_family),
  constraint seller_os_browser_leader_heartbeat_family_check check (
    worker_family in ('PRODUCT_RESEARCH','LUNA_SHIPPING')),
  constraint seller_os_browser_leader_heartbeat_time_check check (
    fresh_until > observed_at and
    fresh_until <= observed_at + interval '3 minutes')
);

alter table public.seller_os_browser_workload_leader_heartbeats_v1
  enable row level security;
alter table public.seller_os_browser_workload_leader_heartbeats_v1
  force row level security;
revoke all on table public.seller_os_browser_workload_leader_heartbeats_v1
  from public, anon, authenticated, service_role;
grant select, insert, update on table
  public.seller_os_browser_workload_leader_heartbeats_v1 to service_role;

create or replace function public.record_seller_os_browser_worker_heartbeat_v2(
  p_marketplace_account_key text,
  p_worker_family text,
  p_worker_instance_id text,
  p_extension_version text,
  p_extension_identity_match boolean,
  p_worker_state text,
  p_observed_at timestamptz,
  p_claim_authority_session_id uuid,
  p_ttl_seconds integer default 300,
  p_claim_authority_lease_seconds integer default 150
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_heartbeat jsonb;
  v_now timestamptz := clock_timestamp();
  v_lease_expires_at timestamptz;
  v_lease_generation bigint;
  v_granted boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_claim_authority_session_id is null
      or p_claim_authority_lease_seconds not between 120 and 180 then
    raise exception 'SELLER_OS_BROWSER_WORKLOAD_LEASE_INPUT_INVALID';
  end if;
  v_heartbeat := public.record_seller_os_browser_worker_heartbeat_v1(
    p_marketplace_account_key,p_worker_family,p_worker_instance_id,
    p_extension_version,p_extension_identity_match,p_worker_state,
    p_observed_at,p_ttl_seconds);
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-browser-workload-leader:'||p_marketplace_account_key||':'||
      p_worker_family,0));
  insert into public.seller_os_browser_workload_leases_v1 as lease (
    marketplace_account_key,worker_family,leader_session_id,
    worker_instance_id,lease_generation,acquired_at,renewed_at,
    lease_expires_at
  ) values (p_marketplace_account_key,p_worker_family,
    p_claim_authority_session_id,p_worker_instance_id,1,v_now,v_now,
    v_now+make_interval(secs=>p_claim_authority_lease_seconds))
  on conflict (marketplace_account_key,worker_family) do update set
    leader_session_id=excluded.leader_session_id,
    worker_instance_id=excluded.worker_instance_id,
    lease_generation=case when lease.leader_session_id=excluded.leader_session_id
      then lease.lease_generation else lease.lease_generation+1 end,
    acquired_at=case when lease.leader_session_id=excluded.leader_session_id
      then lease.acquired_at else excluded.acquired_at end,
    renewed_at=excluded.renewed_at,
    lease_expires_at=excluded.lease_expires_at,updated_at=v_now
  where lease.leader_session_id=excluded.leader_session_id
    or lease.lease_expires_at<=v_now
  returning lease.lease_expires_at,lease.lease_generation
    into v_lease_expires_at,v_lease_generation;
  v_granted := found;
  if not v_granted then
    select lease_expires_at,lease_generation
      into v_lease_expires_at,v_lease_generation
    from public.seller_os_browser_workload_leases_v1
    where marketplace_account_key=p_marketplace_account_key
      and worker_family=p_worker_family;
  else
    insert into public.seller_os_browser_workload_leader_heartbeats_v1 as leader(
      marketplace_account_key,worker_family,leader_session_id,
      worker_instance_id,lease_generation,observed_at,fresh_until
    ) values (p_marketplace_account_key,p_worker_family,
      p_claim_authority_session_id,p_worker_instance_id,v_lease_generation,
      p_observed_at,v_lease_expires_at)
    on conflict (marketplace_account_key,worker_family) do update set
      leader_session_id=excluded.leader_session_id,
      worker_instance_id=excluded.worker_instance_id,
      lease_generation=excluded.lease_generation,
      observed_at=excluded.observed_at,fresh_until=excluded.fresh_until,
      updated_at=v_now;
  end if;
  return v_heartbeat||jsonb_build_object(
    'claimAuthorityGranted',v_granted,
    'claimAuthorityScope',p_worker_family,
    'claimAuthorityLeaseExpiresAt',v_lease_expires_at,
    'claimAuthorityLeaseGeneration',v_lease_generation,
    'claimAuthorityContractVersion','SELLER_OS_BROWSER_WORKLOAD_LEASE_V1',
    'leaderHeartbeatDurable',v_granted);
end;
$$;

revoke all on function public.record_seller_os_browser_worker_heartbeat_v2(
  text,text,text,text,boolean,text,timestamptz,uuid,integer,integer)
  from public, anon, authenticated;
grant execute on function public.record_seller_os_browser_worker_heartbeat_v2(
  text,text,text,text,boolean,text,timestamptz,uuid,integer,integer)
  to service_role;

comment on table public.seller_os_browser_workload_leader_heartbeats_v1 is
  'Current granted leader heartbeat. Follower capability heartbeats cannot overwrite this claim-authority identity.';

notify pgrst, 'reload schema';
