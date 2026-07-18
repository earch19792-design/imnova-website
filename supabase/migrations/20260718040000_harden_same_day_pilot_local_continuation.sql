-- Keep local preparation available while an eBay read lane is paused.
-- These payloads are non-publishable scaffolds and contain no generated claims.

alter table public.ebay_same_day_pilot_candidates
  add column if not exists local_preparation_status text not null default 'NOT_PREPARED',
  add column if not exists local_preparation_package jsonb not null default '{}'::jsonb,
  add column if not exists product_research_capture_batch_id uuid null
    references public.marketplace_product_research_capture_batches(id) on delete set null;

alter table public.ebay_same_day_pilot_runs
  add column if not exists orchestrator_version text not null default 'PILOT_3_LISTINGS_SAME_DAY_V1',
  add column if not exists last_worker_heartbeat_at timestamptz null,
  add column if not exists automation_metrics jsonb not null default '{}'::jsonb;

alter table public.ebay_same_day_pilot_jobs
  add column if not exists api_family text null,
  add column if not exists api_operation text null,
  add column if not exists owner_lane text null,
  add column if not exists rate_limit_resume_at timestamptz null;

alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_local_preparation_status_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_local_preparation_status_check check (
    local_preparation_status in (
      'NOT_PREPARED',
      'BLOCKED_PENDING_VERIFIED_GATES',
      'READY_FOR_FACT_ENRICHMENT',
      'SUPERSEDED'
    )
  );

alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_local_package_safety_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_local_package_safety_check check (
    jsonb_typeof(local_preparation_package) = 'object'
    and not (local_preparation_package::text ~* '(competitorImage|imageUrl|base64|cookie|authorization|rawHtml)')
  );

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

revoke all on function public.requeue_expired_same_day_pilot_jobs(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.requeue_expired_same_day_pilot_jobs(uuid,timestamptz) to service_role;

-- Atomic, server-side job claim. It also recovers an abandoned lease before
-- selecting work, so a browser or serverless invocation ending cannot strand
-- the durable run.
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
    order by job.available_at, job.created_at
    for update skip locked
    limit 1
  )
  update public.ebay_same_day_pilot_jobs job
  set status = 'LEASED',
      lease_owner = p_worker_id,
      lease_expires_at = p_now + interval '2 minutes',
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

create index if not exists ebay_same_day_pilot_capture_batch_idx
  on public.ebay_same_day_pilot_candidates(run_id, product_research_capture_batch_id)
  where product_research_capture_batch_id is not null;

notify pgrst, 'reload schema';
