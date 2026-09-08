-- Phase A reduces idle browser and scheduler amplification without changing
-- any job queue, business authority, claim lease, or idempotency contract.
-- This migration is intentionally local until physical staging approval.

create table public.seller_os_browser_workload_leases_v1 (
  marketplace_account_key text not null,
  worker_family text not null,
  leader_session_id uuid not null,
  worker_instance_id text not null,
  lease_generation bigint not null default 1,
  acquired_at timestamptz not null,
  renewed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (marketplace_account_key, worker_family),
  constraint seller_os_browser_workload_family_check check (
    worker_family in ('PRODUCT_RESEARCH', 'LUNA_SHIPPING')
  ),
  constraint seller_os_browser_workload_worker_check check (
    char_length(worker_instance_id) between 8 and 160
  ),
  constraint seller_os_browser_workload_lease_generation_check check (
    lease_generation >= 1
  ),
  constraint seller_os_browser_workload_lease_time_check check (
    lease_expires_at > renewed_at
    and renewed_at >= acquired_at
    and lease_expires_at <= renewed_at + interval '3 minutes'
  )
);

create index seller_os_browser_workload_lease_expiry_idx
  on public.seller_os_browser_workload_leases_v1(lease_expires_at);

alter table public.seller_os_browser_workload_leases_v1
  enable row level security;
alter table public.seller_os_browser_workload_leases_v1
  force row level security;
revoke all on table public.seller_os_browser_workload_leases_v1
  from public, anon, authenticated, service_role;
grant select, insert, update
  on table public.seller_os_browser_workload_leases_v1 to service_role;

comment on table public.seller_os_browser_workload_leases_v1 is
  'Account/family-scoped browser claim leadership. It gates polling only; existing Product Research, Shipping, and Economic job leases remain authoritative.';

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
language plpgsql
security definer
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

  -- The existing heartbeat authority and its 300 second maximum TTL remain
  -- unchanged. A failure anywhere in this RPC rolls both writes back.
  v_heartbeat := public.record_seller_os_browser_worker_heartbeat_v1(
    p_marketplace_account_key,
    p_worker_family,
    p_worker_instance_id,
    p_extension_version,
    p_extension_identity_match,
    p_worker_state,
    p_observed_at,
    p_ttl_seconds
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-browser-workload-leader:' || p_marketplace_account_key || ':' ||
      p_worker_family,
    0
  ));

  insert into public.seller_os_browser_workload_leases_v1 as lease (
    marketplace_account_key, worker_family, leader_session_id,
    worker_instance_id, lease_generation, acquired_at, renewed_at,
    lease_expires_at
  ) values (
    p_marketplace_account_key, p_worker_family,
    p_claim_authority_session_id, p_worker_instance_id, 1,
    v_now, v_now,
    v_now + make_interval(secs => p_claim_authority_lease_seconds)
  )
  on conflict (marketplace_account_key, worker_family) do update set
    leader_session_id = excluded.leader_session_id,
    worker_instance_id = excluded.worker_instance_id,
    lease_generation = case
      when lease.leader_session_id = excluded.leader_session_id
        then lease.lease_generation
      else lease.lease_generation + 1
    end,
    acquired_at = case
      when lease.leader_session_id = excluded.leader_session_id
        then lease.acquired_at
      else excluded.acquired_at
    end,
    renewed_at = excluded.renewed_at,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = v_now
  where lease.leader_session_id = excluded.leader_session_id
    or lease.lease_expires_at <= v_now
  returning lease.lease_expires_at, lease.lease_generation
  into v_lease_expires_at, v_lease_generation;

  v_granted := found;
  if not v_granted then
    select lease.lease_expires_at, lease.lease_generation
    into v_lease_expires_at, v_lease_generation
    from public.seller_os_browser_workload_leases_v1 lease
    where lease.marketplace_account_key = p_marketplace_account_key
      and lease.worker_family = p_worker_family;
  end if;

  return v_heartbeat || jsonb_build_object(
    'claimAuthorityGranted', v_granted,
    'claimAuthorityScope', p_worker_family,
    'claimAuthorityLeaseExpiresAt', v_lease_expires_at,
    'claimAuthorityLeaseGeneration', v_lease_generation,
    'claimAuthorityContractVersion',
      'SELLER_OS_BROWSER_WORKLOAD_LEASE_V1'
  );
end;
$$;

revoke all on function public.record_seller_os_browser_worker_heartbeat_v2(
  text, text, text, text, boolean, text, timestamptz, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_seller_os_browser_worker_heartbeat_v2(
  text, text, text, text, boolean, text, timestamptz, uuid, integer, integer
) to service_role;

comment on function public.record_seller_os_browser_worker_heartbeat_v2(
  text, text, text, text, boolean, text, timestamptz, uuid, integer, integer
) is 'Records the existing 60s/300s capability heartbeat and atomically acquires or renews the bounded browser polling leader lease. It never claims or completes a business job.';

create or replace function public.verify_seller_os_browser_workload_lease_v1(
  p_marketplace_account_key text,
  p_worker_family text,
  p_worker_instance_id text,
  p_claim_authority_session_id uuid,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lease public.seller_os_browser_workload_leases_v1%rowtype;
  v_granted boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_worker_family not in ('PRODUCT_RESEARCH', 'LUNA_SHIPPING')
      or char_length(trim(coalesce(p_marketplace_account_key, '')))
        not between 8 and 160
      or char_length(trim(coalesce(p_worker_instance_id, '')))
        not between 8 and 160
      or p_claim_authority_session_id is null
      or p_observed_at is null
      or p_observed_at < clock_timestamp() - interval '2 minutes'
      or p_observed_at > clock_timestamp() + interval '1 minute' then
    raise exception 'SELLER_OS_BROWSER_WORKLOAD_LEASE_VERIFY_INVALID';
  end if;

  select lease.* into v_lease
  from public.seller_os_browser_workload_leases_v1 lease
  where lease.marketplace_account_key = p_marketplace_account_key
    and lease.worker_family = p_worker_family;

  v_granted := found
    and v_lease.leader_session_id = p_claim_authority_session_id
    and v_lease.worker_instance_id = p_worker_instance_id
    and v_lease.lease_expires_at > clock_timestamp();

  return jsonb_build_object(
    'claimAuthorityGranted', v_granted,
    'claimAuthorityScope', p_worker_family,
    'claimAuthorityLeaseExpiresAt', v_lease.lease_expires_at,
    'claimAuthorityLeaseGeneration', v_lease.lease_generation,
    'claimAuthorityContractVersion',
      'SELLER_OS_BROWSER_WORKLOAD_LEASE_V1'
  );
end;
$$;

revoke all on function public.verify_seller_os_browser_workload_lease_v1(
  text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.verify_seller_os_browser_workload_lease_v1(
  text, text, text, uuid, timestamptz
) to service_role;

comment on function public.verify_seller_os_browser_workload_lease_v1(
  text, text, text, uuid, timestamptz
) is 'Fail-closed service-role-only browser poll admission check. It never renews the leader lease and never touches a business job lease.';

-- The previous scheduler migration already staggered the frequent runtime and
-- monitoring lanes. Reassert those schedules idempotently and separate the
-- two daily 09:00 jobs. Frequency, receipts, locks, and authorities are kept.
do $stagger$
declare
  v_job record;
begin
  for v_job in
    select jobid, jobname,
      case jobname
        when 'seller-os-ebay-commercial-monitor-staging-v1'
          then '1-59/5 * * * *'
        when 'seller-os-commercial-alert-dispatcher-staging-v1'
          then '2-59/5 * * * *'
        when 'seller-os-same-day-pilot-staging-v1'
          then '3-59/5 * * * *'
        when 'seller-os-post-publisher-batch-runtime-v1'
          then '4-59/5 * * * *'
        when 'seller-os-ebay-luna-monitor-staging-v1'
          then '5-59/15 * * * *'
        when 'seller-os-post-operational-integrity-auditor-v1'
          then '7-59/15 * * * *'
        when 'seller-os-post-publisher-preauthorization-v1'
          then '9-59/15 * * * *'
        when 'seller-os-post-runtime-capability-assurance-v1'
          then '12-59/15 * * * *'
        when 'seller-os-post-market-radar-luna-sync-v1'
          then '2 9 * * *'
        when 'seller-os-post-daily-dollar-radar-autopilot-v1'
          then '6 9 * * *'
      end as staggered_schedule
    from cron.job
    where jobname in (
      'seller-os-ebay-commercial-monitor-staging-v1',
      'seller-os-commercial-alert-dispatcher-staging-v1',
      'seller-os-same-day-pilot-staging-v1',
      'seller-os-post-publisher-batch-runtime-v1',
      'seller-os-ebay-luna-monitor-staging-v1',
      'seller-os-post-operational-integrity-auditor-v1',
      'seller-os-post-publisher-preauthorization-v1',
      'seller-os-post-runtime-capability-assurance-v1',
      'seller-os-post-market-radar-luna-sync-v1',
      'seller-os-post-daily-dollar-radar-autopilot-v1'
    )
  loop
    perform cron.alter_job(v_job.jobid, schedule => v_job.staggered_schedule);
  end loop;
end;
$stagger$;

update public.seller_os_post_runtime_scheduler_v1
set schedule = case lane
    when 'MARKET_RADAR_LUNA_SYNC' then '2 9 * * *'
    when 'DAILY_DOLLAR_RADAR_AUTOPILOT' then '6 9 * * *'
    else schedule
  end,
  updated_at = clock_timestamp()
where lane in ('MARKET_RADAR_LUNA_SYNC', 'DAILY_DOLLAR_RADAR_AUTOPILOT')
  and schedule is distinct from case lane
    when 'MARKET_RADAR_LUNA_SYNC' then '2 9 * * *'
    when 'DAILY_DOLLAR_RADAR_AUTOPILOT' then '6 9 * * *'
  end;

notify pgrst, 'reload schema';
