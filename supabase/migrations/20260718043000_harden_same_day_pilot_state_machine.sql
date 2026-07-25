-- Make every durable state advancement compare-and-set, and make job leases
-- safe against a late serverless worker completing work owned by a newer one.
-- This migration schedules nothing and grants no eBay/OpenAI write capability.

alter table public.ebay_same_day_pilot_jobs
  add column if not exists lease_token uuid null,
  add column if not exists completed_at timestamptz null;

create or replace function public.requeue_expired_same_day_pilot_jobs(
  p_run_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.ebay_same_day_pilot_jobs
  set status = case when attempt >= max_attempts then 'DEAD_LETTER' else 'WAITING_RETRY' end,
      available_at = p_now,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = 'LEASE_EXPIRED_RECOVERED',
      updated_at = p_now
  where run_id = p_run_id
    and status = 'LEASED'
    and lease_expires_at <= p_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_expired_same_day_pilot_jobs(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.requeue_expired_same_day_pilot_jobs(uuid,timestamptz)
  to service_role;

create or replace function public.claim_same_day_pilot_job(
  p_run_id uuid,
  p_worker_id text,
  p_now timestamptz default clock_timestamp()
)
returns setof public.ebay_same_day_pilot_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(trim(coalesce(p_worker_id, ''))) < 8 then
    raise exception 'SAME_DAY_PILOT_WORKER_ID_INVALID';
  end if;

  perform public.requeue_expired_same_day_pilot_jobs(p_run_id, p_now);

  return query
  with next_job as (
    select job.id
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = p_run_id
      and job.status in ('PENDING', 'WAITING_RETRY')
      and job.available_at <= p_now
      and not exists (
        select 1
        from public.ebay_same_day_pilot_jobs blocker
        where blocker.run_id = p_run_id
          and blocker.status in ('LEASED', 'DEAD_LETTER')
      )
    order by job.available_at, job.created_at
    for update skip locked
    limit 1
  )
  update public.ebay_same_day_pilot_jobs job
  set status = 'LEASED',
      lease_owner = p_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + interval '6 minutes',
      last_heartbeat_at = p_now,
      attempt = job.attempt + 1,
      updated_at = p_now
  from next_job
  where job.id = next_job.id
  returning job.*;
end;
$$;

revoke all on function public.claim_same_day_pilot_job(uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_same_day_pilot_job(uuid,text,timestamptz)
  to service_role;

create or replace function public.heartbeat_same_day_pilot_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ebay_same_day_pilot_jobs
  set last_heartbeat_at = p_now,
      lease_expires_at = p_now + interval '6 minutes',
      updated_at = p_now
  where id = p_job_id
    and status = 'LEASED'
    and lease_owner = p_worker_id
    and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.heartbeat_same_day_pilot_job(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.heartbeat_same_day_pilot_job(uuid,text,uuid,timestamptz)
  to service_role;

create or replace function public.settle_same_day_pilot_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_status text,
  p_available_at timestamptz default null,
  p_error_code text default null,
  p_preserve_attempt boolean default false,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('COMPLETED', 'WAITING_RETRY', 'DEAD_LETTER') then
    raise exception 'SAME_DAY_PILOT_JOB_SETTLEMENT_INVALID';
  end if;

  update public.ebay_same_day_pilot_jobs
  set status = p_status,
      available_at = case
        when p_status = 'WAITING_RETRY' then coalesce(p_available_at, p_now)
        else available_at
      end,
      attempt = greatest(0, attempt - case when p_preserve_attempt then 1 else 0 end),
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      last_heartbeat_at = p_now,
      last_error_code = case when p_status = 'COMPLETED' then null else p_error_code end,
      rate_limit_resume_at = case
        when p_status = 'WAITING_RETRY' and coalesce(p_error_code, '') ~ '(429|QUOTA_PAUSED)'
          then coalesce(p_available_at, p_now)
        else null
      end,
      completed_at = case when p_status = 'COMPLETED' then p_now else completed_at end,
      updated_at = p_now
  where id = p_job_id
    and status = 'LEASED'
    and lease_owner = p_worker_id
    and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.settle_same_day_pilot_job(uuid,text,uuid,text,timestamptz,text,boolean,timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_same_day_pilot_job(uuid,text,uuid,text,timestamptz,text,boolean,timestamptz)
  to service_role;

create or replace function public.advance_same_day_pilot_candidate(
  p_run_id uuid,
  p_candidate_id uuid,
  p_expected_previous_state text,
  p_next_state text,
  p_reason_code text,
  p_triggered_by text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_attempt integer,
  p_checkpoint jsonb,
  p_evidence_hash text,
  p_transition_idempotency_key text,
  p_next_automatic_action text,
  p_next_human_action text,
  p_job_type text default null,
  p_job_idempotency_key text default null,
  p_job_checkpoint jsonb default '{}'::jsonb,
  p_job_available_at timestamptz default null,
  p_job_max_attempts integer default 4,
  p_api_family text default null,
  p_api_operation text default null,
  p_owner_lane text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_state text;
begin
  if p_triggered_by not in ('SYSTEM', 'USER', 'SCHEDULER', 'RETRY') then
    raise exception 'SAME_DAY_PILOT_TRANSITION_TRIGGER_INVALID';
  end if;
  if p_evidence_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'SAME_DAY_PILOT_TRANSITION_HASH_INVALID';
  end if;
  if p_job_type is not null and length(trim(coalesce(p_job_idempotency_key, ''))) = 0 then
    raise exception 'SAME_DAY_PILOT_JOB_IDEMPOTENCY_REQUIRED';
  end if;

  select machine_state into v_current_state
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id and run_id = p_run_id
  for update;
  if not found then
    raise exception 'SAME_DAY_PILOT_CANDIDATE_NOT_FOUND';
  end if;

  if v_current_state not in (p_expected_previous_state, p_next_state) then
    return 'STALE';
  end if;

  -- Reaching the same next state is idempotent only for the exact same
  -- transition. A second event with different evidence/checkpoint must never
  -- smuggle in another transition or job under the guise of idempotency.
  if v_current_state = p_next_state and not exists (
    select 1
    from public.ebay_same_day_pilot_transitions transition_row
    where transition_row.run_id = p_run_id
      and transition_row.candidate_id = p_candidate_id
      and transition_row.idempotency_key = p_transition_idempotency_key
      and transition_row.previous_state = p_expected_previous_state
      and transition_row.next_state = p_next_state
  ) then
    return 'STALE';
  end if;

  insert into public.ebay_same_day_pilot_transitions (
    run_id, candidate_id, previous_state, next_state, reason_code,
    triggered_by, started_at, completed_at, attempt, checkpoint,
    evidence_hash, idempotency_key, next_automatic_action, next_human_action
  ) values (
    p_run_id, p_candidate_id, p_expected_previous_state, p_next_state, p_reason_code,
    p_triggered_by, p_started_at, p_completed_at, p_attempt, coalesce(p_checkpoint, '{}'::jsonb),
    p_evidence_hash, p_transition_idempotency_key, p_next_automatic_action, p_next_human_action
  ) on conflict (idempotency_key) do nothing;

  if v_current_state = p_expected_previous_state then
    update public.ebay_same_day_pilot_candidates
    set machine_state = p_next_state,
        next_automated_action = p_next_automatic_action,
        next_human_action = p_next_human_action,
        updated_at = p_completed_at
    where id = p_candidate_id and run_id = p_run_id;
  end if;

  if p_job_type is not null then
    insert into public.ebay_same_day_pilot_jobs (
      run_id, candidate_id, job_type, idempotency_key, checkpoint,
      available_at, max_attempts, api_family, api_operation, owner_lane
    ) values (
      p_run_id, p_candidate_id, p_job_type, p_job_idempotency_key,
      coalesce(p_job_checkpoint, '{}'::jsonb), coalesce(p_job_available_at, p_completed_at),
      p_job_max_attempts, p_api_family, p_api_operation, p_owner_lane
    ) on conflict (idempotency_key) do nothing;
  end if;

  return case when v_current_state = p_next_state then 'IDEMPOTENT' else 'ADVANCED' end;
end;
$$;

revoke all on function public.advance_same_day_pilot_candidate(
  uuid,uuid,text,text,text,text,timestamptz,timestamptz,integer,jsonb,text,text,text,text,
  text,text,jsonb,timestamptz,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.advance_same_day_pilot_candidate(
  uuid,uuid,text,text,text,text,timestamptz,timestamptz,integer,jsonb,text,text,text,text,
  text,text,jsonb,timestamptz,integer,text,text,text
) to service_role;

notify pgrst, 'reload schema';
