-- Preflight the per-run lease invariant before the unique partial index in
-- 20260718044000 is created. Existing jobs are preserved: for each run the
-- newest lease remains active, while every additional lease is made safely
-- retryable and retains an audit marker in its existing checkpoint.
--
-- This migration creates no worker, scheduler, eBay write, or production
-- behavior. It is also harmless when the invariant is already satisfied.

do $$
declare
  v_recovered_at timestamptz := clock_timestamp();
begin
  with ranked_leases as (
    select
      job.id,
      row_number() over (
        partition by job.run_id
        order by
          job.lease_expires_at desc nulls last,
          job.last_heartbeat_at desc nulls last,
          job.updated_at desc,
          job.created_at desc,
          job.id desc
      ) as lease_position
    from public.ebay_same_day_pilot_jobs job
    where job.status = 'LEASED'
  )
  update public.ebay_same_day_pilot_jobs job
  set status = 'WAITING_RETRY',
      available_at = v_recovered_at,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = 'LEASE_DEDUPLICATED_BEFORE_PER_RUN_UNIQUE_INDEX',
      checkpoint = coalesce(job.checkpoint, '{}'::jsonb) || jsonb_build_object(
        '_leasePreflightRecovery',
        jsonb_build_object(
          'reason', 'DUPLICATE_ACTIVE_LEASE_FOR_RUN',
          'recoveredAt', to_jsonb(v_recovered_at),
          'previousLeaseExpiresAt', to_jsonb(job.lease_expires_at),
          'previousLastHeartbeatAt', to_jsonb(job.last_heartbeat_at)
        )
      ),
      updated_at = v_recovered_at
  from ranked_leases ranked
  where job.id = ranked.id
    and ranked.lease_position > 1;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.status = 'LEASED'
    group by job.run_id
    having count(*) > 1
  ) then
    raise exception 'SAME_DAY_PILOT_DUPLICATE_LEASE_PREFLIGHT_FAILED';
  end if;
end;
$$;
