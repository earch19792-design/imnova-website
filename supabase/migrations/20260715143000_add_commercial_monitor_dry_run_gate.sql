-- One satisfactory commercial dry run authorizes exactly one persistent run.
-- This migration is additive and Preview/staging is the only intended target.

alter table public.commercial_monitor_runs
  add column if not exists dry_run_satisfactory boolean not null default false,
  add column if not exists dry_run_consumed_at timestamptz null,
  add column if not exists authorized_persistent_run_id uuid null,
  add column if not exists authorized_by_dry_run_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commercial_monitor_runs'::regclass
      and conname = 'commercial_monitor_runs_authorized_persistent_fkey'
  ) then
    alter table public.commercial_monitor_runs
      add constraint commercial_monitor_runs_authorized_persistent_fkey
      foreign key (authorized_persistent_run_id)
      references public.commercial_monitor_runs(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commercial_monitor_runs'::regclass
      and conname = 'commercial_monitor_runs_authorized_by_dry_run_fkey'
  ) then
    alter table public.commercial_monitor_runs
      add constraint commercial_monitor_runs_authorized_by_dry_run_fkey
      foreign key (authorized_by_dry_run_id)
      references public.commercial_monitor_runs(id) on delete set null;
  end if;
end $$;

create unique index if not exists commercial_monitor_runs_one_use_dry_run_uidx
  on public.commercial_monitor_runs(authorized_by_dry_run_id)
  where authorized_by_dry_run_id is not null;

create index if not exists commercial_monitor_runs_dry_run_gate_idx
  on public.commercial_monitor_runs(
    marketplace_account_key, marketplace, completed_at desc
  )
  where trigger_source = 'dry_run';

create or replace function public.start_authorized_commercial_monitor_run(
  p_marketplace_account_key text,
  p_marketplace text,
  p_requested_lanes text[],
  p_worker_id text,
  p_dry_run_id uuid,
  p_lease_seconds integer default 240,
  p_max_dry_run_age_seconds integer default 1800
)
returns setof public.commercial_monitor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_dry_run public.commercial_monitor_runs%rowtype;
  v_run public.commercial_monitor_runs%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_worker_id), '') is null
    or p_dry_run_id is null then
    raise exception 'COMMERCIAL_DRY_RUN_GATE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  );

  select * into v_dry_run
  from public.commercial_monitor_runs
  where id = p_dry_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and trigger_source = 'dry_run'
  for update;

  if not found
    or v_dry_run.status not in ('completed', 'partial')
    or v_dry_run.dry_run_satisfactory is not true
    or v_dry_run.dry_run_consumed_at is not null
    or v_dry_run.authorized_persistent_run_id is not null
    or v_dry_run.completed_at is null
    or v_dry_run.completed_at < v_now - make_interval(
      secs => greatest(60, least(coalesce(p_max_dry_run_age_seconds, 1800), 3600))
    ) then
    raise exception 'COMMERCIAL_DRY_RUN_GATE_NOT_SATISFIED';
  end if;

  select * into v_run
  from public.start_commercial_monitor_run(
    p_marketplace_account_key,
    p_marketplace,
    'manual',
    coalesce(p_requested_lanes, '{}'::text[]),
    p_worker_id,
    p_lease_seconds
  );

  if v_run.id is null then
    return;
  end if;

  update public.commercial_monitor_runs
  set authorized_by_dry_run_id = v_dry_run.id
  where id = v_run.id;

  update public.commercial_monitor_runs
  set dry_run_consumed_at = v_now,
      authorized_persistent_run_id = v_run.id
  where id = v_dry_run.id;

  select * into v_run
  from public.commercial_monitor_runs
  where id = v_run.id;
  return next v_run;
end;
$$;

revoke all on function public.start_authorized_commercial_monitor_run(
  text, text, text[], text, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.start_authorized_commercial_monitor_run(
  text, text, text[], text, uuid, integer, integer
) to service_role;

notify pgrst, 'reload schema';
