-- A Shipping lease expiry is not evidence that Chrome stopped executing.
-- Bind claims to an exact, current extension execution observation and retain
-- every expired attempt before a bounded autonomous reclaim.
alter table public.seller_os_browser_workload_leases_v1
  add column shipping_execution_state text not null default 'UNKNOWN'
    check (shipping_execution_state in ('UNKNOWN','IDLE','ACTIVE')),
  add column shipping_execution_candidate_id text null,
  add column shipping_execution_snapshot_digest text null,
  add column shipping_execution_capture_session_id uuid null,
  add column shipping_execution_observed_at timestamptz null,
  add column shipping_execution_lease_generation bigint null,
  add constraint seller_os_shipping_execution_binding_check check (
    (shipping_execution_state='UNKNOWN' and
      shipping_execution_candidate_id is null and
      shipping_execution_snapshot_digest is null and
      shipping_execution_capture_session_id is null and
      shipping_execution_observed_at is null and
      shipping_execution_lease_generation is null)
    or (shipping_execution_state='IDLE' and
      shipping_execution_candidate_id is null and
      shipping_execution_snapshot_digest is null and
      shipping_execution_capture_session_id is null and
      shipping_execution_observed_at is not null and
      shipping_execution_lease_generation is not null)
    or (shipping_execution_state='ACTIVE' and
      shipping_execution_candidate_id ~ '^sha256:[0-9a-f]{64}$' and
      shipping_execution_snapshot_digest ~ '^sha256:[0-9a-f]{64}$' and
      shipping_execution_capture_session_id is not null and
      shipping_execution_observed_at is not null and
      shipping_execution_lease_generation is not null)
  );

alter table public.seller_os_luna_shipping_job_claims
  add column expired_recovery_count integer not null default 0
    check (expired_recovery_count between 0 and 2),
  add column last_recovered_at timestamptz null;

create table public.seller_os_luna_shipping_claim_recovery_events_v1 (
  recovery_event_id uuid primary key default extensions.gen_random_uuid(),
  account_key text not null,
  candidate_id text not null,
  snapshot_digest text not null,
  expired_runtime_instance_id uuid not null,
  expired_capture_session_id uuid not null,
  expired_claimed_at timestamptz not null,
  expired_lease_expires_at timestamptz not null,
  attempt_status text not null check (attempt_status in (
    'EXPIRED_RECOVERABLE','DURABLE_RESULT_RECONCILED')),
  replacement_runtime_instance_id uuid null,
  replacement_capture_session_id uuid null,
  durable_result_frontier_id text null,
  execution_observation_state text not null,
  execution_observed_at timestamptz null,
  recovery_ordinal integer not null check (recovery_ordinal between 0 and 2),
  created_at timestamptz not null default clock_timestamp(),
  unique (account_key, candidate_id, expired_capture_session_id),
  check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
  check (candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  check (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  check (expired_lease_expires_at > expired_claimed_at),
  check ((attempt_status='EXPIRED_RECOVERABLE') =
    (replacement_capture_session_id is not null)),
  check ((attempt_status='DURABLE_RESULT_RECONCILED') =
    (durable_result_frontier_id is not null))
);

create index seller_os_luna_shipping_recovery_scope_idx
  on public.seller_os_luna_shipping_claim_recovery_events_v1
  (account_key,candidate_id,created_at desc);
alter table public.seller_os_luna_shipping_claim_recovery_events_v1
  enable row level security;
alter table public.seller_os_luna_shipping_claim_recovery_events_v1
  force row level security;
revoke all on public.seller_os_luna_shipping_claim_recovery_events_v1
  from public,anon,authenticated,service_role;
grant select,insert on public.seller_os_luna_shipping_claim_recovery_events_v1
  to service_role;

create or replace function public.reject_seller_os_luna_shipping_recovery_event_mutation_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'SELLER_OS_LUNA_SHIPPING_RECOVERY_EVENT_IMMUTABLE';
end; $$;
create trigger seller_os_luna_shipping_recovery_event_immutable
before update or delete on public.seller_os_luna_shipping_claim_recovery_events_v1
for each row execute function
  public.reject_seller_os_luna_shipping_recovery_event_mutation_v1();

create or replace function public.record_seller_os_luna_shipping_execution_observation_v1(
  p_account_key text,
  p_worker_id text,
  p_leader_session_id uuid,
  p_execution_state text,
  p_candidate_id text default null,
  p_snapshot_digest text default null,
  p_capture_session_id uuid default null,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_lease public.seller_os_browser_workload_leases_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_execution_state not in ('IDLE','ACTIVE')
    or p_observed_at is null
    or p_observed_at<v_now-interval '2 minutes'
    or p_observed_at>v_now+interval '1 minute'
    or (p_execution_state='IDLE' and (p_candidate_id is not null
      or p_snapshot_digest is not null or p_capture_session_id is not null))
    or (p_execution_state='ACTIVE' and (p_candidate_id !~ '^sha256:[0-9a-f]{64}$'
      or p_snapshot_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_capture_session_id is null)) then
    raise exception 'SELLER_OS_LUNA_SHIPPING_EXECUTION_OBSERVATION_INVALID';
  end if;
  select * into v_lease from public.seller_os_browser_workload_leases_v1
  where marketplace_account_key=p_account_key and worker_family='LUNA_SHIPPING'
  for update;
  if not found or v_lease.worker_instance_id is distinct from p_worker_id
    or v_lease.leader_session_id is distinct from p_leader_session_id
    or v_lease.lease_expires_at<=v_now
    or v_lease.shipping_capture_state<>'AVAILABLE'
    or v_lease.shipping_capability_worker_id is distinct from p_worker_id
    or v_lease.shipping_capability_observed_at<v_now-interval '5 minutes' then
    return jsonb_build_object('recorded',false,
      'reasonCode','SHIPPING_EXECUTION_OBSERVATION_AUTHORITY_UNPROVEN');
  end if;
  update public.seller_os_browser_workload_leases_v1 set
    shipping_execution_state=p_execution_state,
    shipping_execution_candidate_id=p_candidate_id,
    shipping_execution_snapshot_digest=p_snapshot_digest,
    shipping_execution_capture_session_id=p_capture_session_id,
    shipping_execution_observed_at=p_observed_at,
    shipping_execution_lease_generation=v_lease.lease_generation,
    updated_at=v_now
  where marketplace_account_key=p_account_key and worker_family='LUNA_SHIPPING'
    and (shipping_execution_observed_at is null
      or shipping_execution_lease_generation is distinct from v_lease.lease_generation
      or shipping_execution_observed_at<=p_observed_at);
  if not found then return jsonb_build_object('recorded',false,
    'reasonCode','SHIPPING_EXECUTION_OBSERVATION_STALE'); end if;
  return jsonb_build_object('recorded',true,'executionState',p_execution_state,
    'observedAt',p_observed_at,'leaseGeneration',v_lease.lease_generation,
    'durableReadbackMatch',true);
end; $$;

create or replace function public.claim_seller_os_luna_shipping_job_v2(
  p_account_key text,
  p_candidate_id text,
  p_snapshot_digest text,
  p_runtime_instance_id uuid,
  p_capture_session_id uuid,
  p_leader_session_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_lease public.seller_os_browser_workload_leases_v1%rowtype;
  v_claim public.seller_os_luna_shipping_job_claims%rowtype;
  v_result_count integer:=0;
  v_result_id text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_candidate_id !~ '^sha256:[0-9a-f]{64}$'
    or p_snapshot_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_runtime_instance_id is null or p_capture_session_id is null
    or p_leader_session_id is null then
    raise exception 'SELLER_OS_LUNA_SHIPPING_CLAIM_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-luna-shipping-claim:'||p_account_key||':'||p_candidate_id,0));
  select * into v_lease from public.seller_os_browser_workload_leases_v1
  where marketplace_account_key=p_account_key and worker_family='LUNA_SHIPPING'
  for update;
  if not found or v_lease.worker_instance_id is distinct from p_runtime_instance_id::text
    or v_lease.leader_session_id is distinct from p_leader_session_id
    or v_lease.lease_expires_at<=v_now
    or v_lease.shipping_capture_state<>'AVAILABLE'
    or v_lease.shipping_capability_worker_id is distinct from p_runtime_instance_id::text
    or v_lease.shipping_capability_observed_at<v_now-interval '5 minutes' then
    return jsonb_build_object('claimed',false,
      'claimStatus','CAPTURE_AUTHORITY_UNPROVEN');
  end if;
  select * into v_claim from public.seller_os_luna_shipping_job_claims
  where account_key=p_account_key and candidate_id=p_candidate_id for update;
  if found and v_claim.status='CLAIMED' and v_claim.lease_expires_at>v_now then
    return jsonb_build_object('claimed',false,'claimStatus','ACTIVE_LEASE',
      'leaseExpiresAt',v_claim.lease_expires_at);
  end if;
  if found and v_claim.status='COMPLETED'
    and v_claim.snapshot_digest=p_snapshot_digest then
    select count(*)::integer,max(frontier_id) into v_result_count,v_result_id
    from public.seller_os_profitability_frontier_snapshots
    where account_key=p_account_key
      and shipping_status='SHIPPING_DURABLY_PERSISTED'
      and frontier_payload->'shippingCaptureEvidence'->>'candidateId'=p_candidate_id
      and frontier_payload->'shippingCaptureEvidence'->>'captureSessionId'=
        v_claim.capture_session_id::text;
    if v_result_count=1 then
      return jsonb_build_object('claimed',false,
        'claimStatus','ALREADY_COMPLETED','durableResultPresent',true,
        'captureRequired',false,'durableReadbackMatch',true);
    elsif v_result_count>1 then
      return jsonb_build_object('claimed',false,
        'claimStatus','DURABLE_RESULT_AMBIGUOUS');
    end if;
  end if;
  if found and v_claim.status='CLAIMED' then
    select count(*)::integer,max(frontier_id) into v_result_count,v_result_id
    from public.seller_os_profitability_frontier_snapshots
    where account_key=p_account_key
      and shipping_status='SHIPPING_DURABLY_PERSISTED'
      and frontier_payload->'shippingCaptureEvidence'->>'candidateId'=p_candidate_id
      and frontier_payload->'shippingCaptureEvidence'->>'captureSessionId'=
        v_claim.capture_session_id::text;
    if v_result_count=1 then
      update public.seller_os_luna_shipping_job_claims set status='COMPLETED',
        completed_at=v_now,updated_at=v_now
      where account_key=p_account_key and candidate_id=p_candidate_id;
      insert into public.seller_os_luna_shipping_claim_recovery_events_v1(
        account_key,candidate_id,snapshot_digest,expired_runtime_instance_id,
        expired_capture_session_id,expired_claimed_at,expired_lease_expires_at,
        attempt_status,durable_result_frontier_id,execution_observation_state,
        execution_observed_at,recovery_ordinal)
      values(p_account_key,p_candidate_id,v_claim.snapshot_digest,
        v_claim.runtime_instance_id,v_claim.capture_session_id,v_claim.claimed_at,
        v_claim.lease_expires_at,'DURABLE_RESULT_RECONCILED',v_result_id,
        v_lease.shipping_execution_state,v_lease.shipping_execution_observed_at,
        v_claim.expired_recovery_count)
      on conflict(account_key,candidate_id,expired_capture_session_id) do nothing;
      return jsonb_build_object('claimed',false,
        'claimStatus','DURABLE_RESULT_RECONCILED','durableResultPresent',true,
        'captureRequired',false,'durableReadbackMatch',true);
    elsif v_result_count>1 then
      return jsonb_build_object('claimed',false,
        'claimStatus','DURABLE_RESULT_AMBIGUOUS');
    end if;
    if v_claim.snapshot_digest is distinct from p_snapshot_digest then
      return jsonb_build_object('claimed',false,
        'claimStatus','IDENTITY_BINDING_MISMATCH');
    end if;
    if v_claim.expired_recovery_count>=2 then
      return jsonb_build_object('claimed',false,
        'claimStatus','EXPIRED_RECOVERY_LIMIT_REACHED');
    end if;
    if v_lease.shipping_execution_state<>'IDLE'
      or v_lease.shipping_execution_observed_at is null
      or v_lease.shipping_execution_observed_at<v_claim.lease_expires_at
      or v_lease.shipping_execution_observed_at<v_now-interval '2 minutes'
      or v_lease.shipping_execution_lease_generation is distinct from
        v_lease.lease_generation then
      return jsonb_build_object('claimed',false,
        'claimStatus',case when v_lease.shipping_execution_state='ACTIVE'
          then 'CAPTURE_EXECUTION_ACTIVE' else 'CAPTURE_EXECUTION_UNCERTAIN' end);
    end if;
    insert into public.seller_os_luna_shipping_claim_recovery_events_v1(
      account_key,candidate_id,snapshot_digest,expired_runtime_instance_id,
      expired_capture_session_id,expired_claimed_at,expired_lease_expires_at,
      attempt_status,replacement_runtime_instance_id,
      replacement_capture_session_id,execution_observation_state,
      execution_observed_at,recovery_ordinal)
    values(p_account_key,p_candidate_id,v_claim.snapshot_digest,
      v_claim.runtime_instance_id,v_claim.capture_session_id,v_claim.claimed_at,
      v_claim.lease_expires_at,'EXPIRED_RECOVERABLE',p_runtime_instance_id,
      p_capture_session_id,'IDLE',v_lease.shipping_execution_observed_at,
      v_claim.expired_recovery_count+1);
    update public.seller_os_luna_shipping_job_claims set
      runtime_instance_id=p_runtime_instance_id,
      capture_session_id=p_capture_session_id,status='CLAIMED',claimed_at=v_now,
      lease_expires_at=v_now+interval '15 minutes',completed_at=null,
      updated_at=v_now,expired_recovery_count=expired_recovery_count+1,
      last_recovered_at=v_now
    where account_key=p_account_key and candidate_id=p_candidate_id;
  elsif found then
    if v_lease.shipping_execution_state<>'IDLE'
      or v_lease.shipping_execution_observed_at<v_now-interval '2 minutes'
      or v_lease.shipping_execution_lease_generation is distinct from
        v_lease.lease_generation then
      return jsonb_build_object('claimed',false,
        'claimStatus','CAPTURE_EXECUTION_UNCERTAIN');
    end if;
    update public.seller_os_luna_shipping_job_claims set
      snapshot_digest=p_snapshot_digest,runtime_instance_id=p_runtime_instance_id,
      capture_session_id=p_capture_session_id,status='CLAIMED',claimed_at=v_now,
      lease_expires_at=v_now+interval '15 minutes',completed_at=null,updated_at=v_now
    where account_key=p_account_key and candidate_id=p_candidate_id;
  else
    if v_lease.shipping_execution_state<>'IDLE'
      or v_lease.shipping_execution_observed_at<v_now-interval '2 minutes'
      or v_lease.shipping_execution_lease_generation is distinct from
        v_lease.lease_generation then
      return jsonb_build_object('claimed',false,
        'claimStatus','CAPTURE_EXECUTION_UNCERTAIN');
    end if;
    insert into public.seller_os_luna_shipping_job_claims(
      account_key,candidate_id,snapshot_digest,runtime_instance_id,
      capture_session_id,status,claimed_at,lease_expires_at,completed_at,updated_at)
    values(p_account_key,p_candidate_id,p_snapshot_digest,p_runtime_instance_id,
      p_capture_session_id,'CLAIMED',v_now,v_now+interval '15 minutes',null,v_now);
  end if;
  update public.seller_os_browser_workload_leases_v1 set
    shipping_execution_state='ACTIVE',
    shipping_execution_candidate_id=p_candidate_id,
    shipping_execution_snapshot_digest=p_snapshot_digest,
    shipping_execution_capture_session_id=p_capture_session_id,
    shipping_execution_observed_at=v_now,
    shipping_execution_lease_generation=lease_generation,updated_at=v_now
  where marketplace_account_key=p_account_key and worker_family='LUNA_SHIPPING';
  return jsonb_build_object('claimed',true,'claimStatus','CLAIMED',
    'leaseExpiresAt',v_now+interval '15 minutes','captureRequired',true,
    'automaticExpiredRecovery',v_claim.status='CLAIMED');
end; $$;

create or replace function public.complete_seller_os_luna_shipping_job_v1(
  p_account_key text,p_candidate_id text,p_snapshot_digest text,
  p_capture_session_id uuid
) returns boolean language plpgsql security invoker
set search_path=public,pg_temp as $$
declare v_completed boolean:=false; v_now timestamptz:=statement_timestamp();
begin
  update public.seller_os_luna_shipping_job_claims set status='COMPLETED',
    completed_at=coalesce(completed_at,v_now),updated_at=v_now
  where account_key=p_account_key and candidate_id=p_candidate_id
    and snapshot_digest=p_snapshot_digest
    and capture_session_id=p_capture_session_id
    and status in ('CLAIMED','COMPLETED') returning true into v_completed;
  if coalesce(v_completed,false) then
    update public.seller_os_browser_workload_leases_v1 set
      shipping_execution_state='IDLE',shipping_execution_candidate_id=null,
      shipping_execution_snapshot_digest=null,
      shipping_execution_capture_session_id=null,
      shipping_execution_observed_at=v_now,
      shipping_execution_lease_generation=lease_generation,updated_at=v_now
    where marketplace_account_key=p_account_key and worker_family='LUNA_SHIPPING'
      and shipping_execution_state='ACTIVE'
      and shipping_execution_candidate_id=p_candidate_id
      and shipping_execution_snapshot_digest=p_snapshot_digest
      and shipping_execution_capture_session_id=p_capture_session_id;
  end if;
  return coalesce(v_completed,false);
end; $$;

revoke all on function public.record_seller_os_luna_shipping_execution_observation_v1(
  text,text,uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_seller_os_luna_shipping_job_v2(
  text,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_seller_os_luna_shipping_execution_observation_v1(
  text,text,uuid,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.claim_seller_os_luna_shipping_job_v2(
  text,text,text,uuid,uuid,uuid) to service_role;

comment on table public.seller_os_luna_shipping_claim_recovery_events_v1 is
  'Immutable no-secret evidence for bounded autonomous recovery of expired Luna Shipping claims.';
comment on function public.claim_seller_os_luna_shipping_job_v2(
  text,text,text,uuid,uuid,uuid) is
  'Claims or recovers one exact Shipping job only after current leader, identity, durable-result and extension execution-state checks.';

notify pgrst, 'reload schema';
