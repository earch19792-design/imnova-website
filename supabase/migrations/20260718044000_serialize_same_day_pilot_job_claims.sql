-- Serialize background work per same-day pilot run. This prevents two
-- serverless workers from leasing different jobs for the same state machine
-- at the same time. It adds no scheduler, eBay write, or production behavior.

create unique index if not exists ebay_same_day_pilot_one_lease_per_run_idx
  on public.ebay_same_day_pilot_jobs(run_id)
  where status = 'LEASED';

alter table public.ebay_same_day_pilot_runs
  add column if not exists worker_lease_owner text null,
  add column if not exists worker_lease_token uuid null,
  add column if not exists worker_lease_expires_at timestamptz null;

create or replace function public.acquire_same_day_pilot_run_lease(
  p_run_id uuid,
  p_worker_id text,
  p_now timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_expiry timestamptz;
  v_token uuid;
begin
  if length(trim(coalesce(p_worker_id, ''))) < 8 then
    raise exception 'SAME_DAY_PILOT_WORKER_ID_INVALID';
  end if;

  select worker_lease_expires_at
  into v_current_expiry
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'SAME_DAY_PILOT_RUN_NOT_FOUND';
  end if;
  if v_current_expiry is not null and v_current_expiry > p_now then
    return null;
  end if;

  v_token := gen_random_uuid();
  update public.ebay_same_day_pilot_runs
  set worker_lease_owner = p_worker_id,
      worker_lease_token = v_token,
      worker_lease_expires_at = p_now + interval '6 minutes',
      updated_at = p_now
  where id = p_run_id;
  return v_token;
end;
$$;

create or replace function public.release_same_day_pilot_run_lease(
  p_run_id uuid,
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
  update public.ebay_same_day_pilot_runs
  set worker_lease_owner = null,
      worker_lease_token = null,
      worker_lease_expires_at = null,
      updated_at = p_now
  where id = p_run_id
    and worker_lease_owner = p_worker_id
    and worker_lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_same_day_pilot_run_lease(uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.release_same_day_pilot_run_lease(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.acquire_same_day_pilot_run_lease(uuid,text,timestamptz)
  to service_role;
grant execute on function public.release_same_day_pilot_run_lease(uuid,text,uuid,timestamptz)
  to service_role;

alter table public.ebay_same_day_pilot_human_tasks
  add column if not exists gate_generation integer not null default 1
    check (gate_generation between 1 and 100);

-- Preserve every closed gate as history while guaranteeing that the operator
-- never sees two simultaneous tasks for the same candidate.
with duplicate_open as (
  select id,
         row_number() over (
           partition by candidate_id
           order by created_at desc, id desc
         ) as position
  from public.ebay_same_day_pilot_human_tasks
  where status = 'OPEN'
)
update public.ebay_same_day_pilot_human_tasks task
set status = 'SUPERSEDED',
    updated_at = clock_timestamp()
from duplicate_open duplicate
where task.id = duplicate.id
  and duplicate.position > 1;

create unique index if not exists ebay_same_day_pilot_one_open_task_per_candidate_idx
  on public.ebay_same_day_pilot_human_tasks(candidate_id)
  where status = 'OPEN';

create or replace function public.ensure_same_day_pilot_human_task(
  p_run_id uuid,
  p_candidate_id uuid,
  p_expected_machine_state text,
  p_gate_type text,
  p_title text,
  p_why_needed text,
  p_estimated_seconds integer,
  p_impact text,
  p_evidence_summary jsonb,
  p_action_schema jsonb,
  p_continuation_job_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_state text;
  v_task_id uuid;
  v_existing_gate text;
  v_generation integer;
begin
  select machine_state
  into v_machine_state
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id
    and run_id = p_run_id
  for update;

  if not found then
    raise exception 'SAME_DAY_PILOT_CANDIDATE_NOT_FOUND';
  end if;
  if v_machine_state <> p_expected_machine_state then
    raise exception 'SAME_DAY_PILOT_HUMAN_TASK_STATE_STALE';
  end if;

  select id, gate_type
  into v_task_id, v_existing_gate
  from public.ebay_same_day_pilot_human_tasks
  where candidate_id = p_candidate_id
    and status = 'OPEN'
  for update;

  if found then
    if v_existing_gate <> p_gate_type then
      raise exception 'SAME_DAY_PILOT_ACTIVE_HUMAN_GATE_CONFLICT';
    end if;
    update public.ebay_same_day_pilot_human_tasks
    set title = p_title,
        why_needed = p_why_needed,
        estimated_seconds = p_estimated_seconds,
        impact = p_impact,
        evidence_summary = coalesce(p_evidence_summary, '{}'::jsonb),
        action_schema = coalesce(p_action_schema, '{}'::jsonb),
        continuation_job_type = p_continuation_job_type,
        updated_at = clock_timestamp()
    where id = v_task_id;
    return v_task_id;
  end if;

  select coalesce(max(gate_generation), 0) + 1
  into v_generation
  from public.ebay_same_day_pilot_human_tasks
  where candidate_id = p_candidate_id
    and gate_type = p_gate_type;

  insert into public.ebay_same_day_pilot_human_tasks (
    run_id, candidate_id, gate_type, status, title, why_needed,
    estimated_seconds, impact, evidence_summary, action_schema,
    continuation_job_type, idempotency_key, gate_generation
  ) values (
    p_run_id, p_candidate_id, p_gate_type, 'OPEN', p_title, p_why_needed,
    p_estimated_seconds, p_impact, coalesce(p_evidence_summary, '{}'::jsonb),
    coalesce(p_action_schema, '{}'::jsonb), p_continuation_job_type,
    p_run_id::text || ':' || p_candidate_id::text || ':' || p_gate_type || ':g' || v_generation::text,
    v_generation
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

revoke all on function public.ensure_same_day_pilot_human_task(
  uuid,uuid,text,text,text,text,integer,text,jsonb,jsonb,text
) from public, anon, authenticated;
grant execute on function public.ensure_same_day_pilot_human_task(
  uuid,uuid,text,text,text,text,integer,text,jsonb,jsonb,text
) to service_role;

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

  -- The transaction-scoped lock is keyed by run, so independent pilot runs
  -- can progress concurrently while every individual run remains sequential.
  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || p_run_id::text, 0)
  );

  if not exists (
    select 1 from public.ebay_same_day_pilot_runs where id = p_run_id
  ) then
    raise exception 'SAME_DAY_PILOT_RUN_NOT_FOUND';
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

create table if not exists public.ebay_same_day_pilot_handoffs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  handoff_version text not null,
  status text not null check (status in ('AWAITING_IMAGE_APPROVAL','READY_FOR_MANUAL_PUBLICATION')),
  package_data jsonb not null,
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  source_image_type text not null check (source_image_type = 'LUNA_AUTHORIZED_CATALOG'),
  image_count integer not null check (image_count between 1 and 24),
  operator_price_approved boolean not null check (operator_price_approved),
  openai_calls integer not null default 0 check (openai_calls = 0),
  ebay_writes integer not null default 0 check (ebay_writes = 0),
  production_changed boolean not null default false check (not production_changed),
  created_at timestamptz not null default now(),
  unique (candidate_id, package_hash)
);

create index if not exists ebay_same_day_pilot_handoffs_run_idx
  on public.ebay_same_day_pilot_handoffs(run_id, created_at desc);

create or replace function public.reject_same_day_pilot_handoff_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'SAME_DAY_PILOT_HANDOFF_APPEND_ONLY';
end;
$$;

drop trigger if exists ebay_same_day_pilot_handoffs_append_only
  on public.ebay_same_day_pilot_handoffs;
create trigger ebay_same_day_pilot_handoffs_append_only
before update or delete on public.ebay_same_day_pilot_handoffs
for each row execute function public.reject_same_day_pilot_handoff_mutation();

alter table public.ebay_same_day_pilot_handoffs enable row level security;
alter table public.ebay_same_day_pilot_handoffs force row level security;
revoke all on table public.ebay_same_day_pilot_handoffs from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_handoffs from public, service_role;
grant select, insert on table public.ebay_same_day_pilot_handoffs to service_role;

notify pgrst, 'reload schema';
