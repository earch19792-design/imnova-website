-- Append-only candidate cycles for the same-day pilot. Each cycle keeps a
-- maximum of five candidates and preserves every previous decision. This does
-- not schedule broad Discovery, call OpenAI, or add an eBay write path.

alter table public.ebay_same_day_pilot_runs
  add column if not exists cycle integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ebay_same_day_pilot_runs'::regclass
      and conname = 'ebay_pilot_run_cycle_range'
  ) then
    alter table public.ebay_same_day_pilot_runs
      add constraint ebay_pilot_run_cycle_range
      check (cycle between 1 and 20);
  end if;
end;
$$;

-- Drop only the legacy two-column uniqueness rule. Resolve it by its exact
-- ordered columns because PostgreSQL may shorten generated constraint names.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.ebay_same_day_pilot_runs'::regclass
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute_row.attname::text order by key_row.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key_row(attnum, ordinality)
        join pg_attribute as attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_row.attnum
      ) = array['marketplace_account_key','operation_date']::text[]
  loop
    execute format(
      'alter table public.ebay_same_day_pilot_runs drop constraint %I',
      legacy_constraint.conname
    );
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ebay_same_day_pilot_runs'::regclass
      and conname = 'ebay_pilot_run_account_date_cycle_key'
  ) then
    alter table public.ebay_same_day_pilot_runs
      add constraint ebay_pilot_run_account_date_cycle_key
      unique (marketplace_account_key, operation_date, cycle);
  end if;
end;
$$;

create index if not exists ebay_pilot_run_latest_cycle_idx
  on public.ebay_same_day_pilot_runs(
    marketplace_account_key,
    operation_date desc,
    cycle desc
  );

-- Serialize cycle creation by account and date. The function only claims an
-- empty run; candidate selection, Product Research plans and candidate rows
-- are created by the single successful claimant after this transaction.
create or replace function public.claim_same_day_pilot_cycle_v1(
  p_marketplace_account_key text,
  p_operation_date date,
  p_cycle integer,
  p_run_key text,
  p_target_new_listings integer,
  p_verified_existing_listings integer,
  p_created_by uuid,
  p_expected_previous_run_id uuid default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_run public.ebay_same_day_pilot_runs%rowtype;
  previous_run public.ebay_same_day_pilot_runs%rowtype;
  claimed_run_id uuid;
  previous_plan_id uuid;
begin
  if length(trim(coalesce(p_marketplace_account_key, ''))) < 3
    or p_operation_date is null
    or p_cycle < 1 or p_cycle > 20
    or length(trim(coalesce(p_run_key, ''))) < 8
    or p_target_new_listings < 0 or p_target_new_listings > 2
    or p_verified_existing_listings < 0 or p_verified_existing_listings > 3 then
    raise exception 'SAME_DAY_PILOT_CYCLE_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_marketplace_account_key || ':' || p_operation_date::text,
    0
  ));

  select run_row.*
  into existing_run
  from public.ebay_same_day_pilot_runs as run_row
  where run_row.marketplace_account_key = p_marketplace_account_key
    and run_row.operation_date = p_operation_date
    and run_row.cycle = p_cycle
  for update;

  if found then
    if existing_run.queue_count = 0
      and not exists (
        select 1 from public.ebay_same_day_pilot_candidates as candidate
        where candidate.run_id = existing_run.id
      )
      and (
        existing_run.stage <> 'CANDIDATE_SELECTION_IN_PROGRESS'
        or existing_run.updated_at <= p_now - interval '10 minutes'
      ) then
      update public.ebay_same_day_pilot_runs
      set stage = 'CANDIDATE_SELECTION_IN_PROGRESS',
          status = 'ACTIVE',
          target_new_listings = p_target_new_listings,
          verified_existing_listings = p_verified_existing_listings,
          next_automated_action = 'Seleccionar un máximo de cinco candidatos distintos.',
          next_human_action = 'Ninguna mientras Seller OS prepara la cola.',
          updated_at = p_now
      where id = existing_run.id;
      return jsonb_build_object(
        'runId', existing_run.id,
        'claimed', true,
        'created', false,
        'recovered', true
      );
    end if;
    return jsonb_build_object(
      'runId', existing_run.id,
      'claimed', false,
      'created', false,
      'recovered', false
    );
  end if;

  if p_cycle > 1 then
    select run_row.*
    into previous_run
    from public.ebay_same_day_pilot_runs as run_row
    where run_row.marketplace_account_key = p_marketplace_account_key
      and run_row.operation_date = p_operation_date
    order by run_row.cycle desc
    limit 1
    for update;

    if not found
      or previous_run.id is distinct from p_expected_previous_run_id
      or previous_run.cycle <> p_cycle - 1
      or previous_run.status <> 'BLOCKED'
      or previous_run.verified_new_listings >= previous_run.target_new_listings
      or coalesce(previous_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
      or coalesce((previous_run.source_inventory ->> 'nextCandidateSetExhausted')::boolean, false)
      or exists (
        select 1 from public.ebay_same_day_pilot_human_tasks as task
        where task.run_id = previous_run.id and task.status = 'OPEN'
      )
      or exists (
        select 1 from public.ebay_same_day_pilot_jobs as job
        where job.run_id = previous_run.id
          and job.status in ('PENDING','WAITING_RETRY','LEASED')
      )
      or not exists (
        select 1 from public.ebay_same_day_pilot_candidates as candidate
        where candidate.run_id = previous_run.id
      )
      or exists (
        select 1 from public.ebay_same_day_pilot_candidates as candidate
        where candidate.run_id = previous_run.id
          and candidate.machine_state not in ('REJECTED','BLOCKED','VERIFIED_ACTIVE','COMPLETED')
      ) then
      raise exception 'SAME_DAY_PILOT_PREVIOUS_CYCLE_NOT_SETTLED';
    end if;

    begin
      previous_plan_id := nullif(
        previous_run.source_inventory ->> 'productResearchPlanId',
        ''
      )::uuid;
    exception when invalid_text_representation then
      raise exception 'SAME_DAY_PILOT_PREVIOUS_RESEARCH_PLAN_INVALID';
    end;
    if previous_plan_id is not null and not exists (
      select 1
      from public.marketplace_product_research_query_plans as plan
      where plan.id = previous_plan_id
        and plan.marketplace_account_key = p_marketplace_account_key
        and plan.marketplace = 'EBAY_US'
        and plan.status in ('COMPLETED','SUPERSEDED')
    ) then
      raise exception 'SAME_DAY_PILOT_PREVIOUS_RESEARCH_PLAN_PENDING';
    end if;
  elsif exists (
    select 1 from public.ebay_same_day_pilot_runs as run_row
    where run_row.marketplace_account_key = p_marketplace_account_key
      and run_row.operation_date = p_operation_date
  ) then
    raise exception 'SAME_DAY_PILOT_CYCLE_SEQUENCE_INVALID';
  end if;

  insert into public.ebay_same_day_pilot_runs(
    marketplace_account_key,
    operation_date,
    cycle,
    run_key,
    status,
    stage,
    target_new_listings,
    verified_existing_listings,
    queue_count,
    deep_discovery_frozen,
    source_inventory,
    quota_snapshot,
    monitor_snapshot,
    next_automated_action,
    next_human_action,
    orchestrator_version,
    created_by,
    created_at,
    updated_at
  ) values (
    p_marketplace_account_key,
    p_operation_date,
    p_cycle,
    p_run_key,
    'ACTIVE',
    'CANDIDATE_SELECTION_IN_PROGRESS',
    p_target_new_listings,
    p_verified_existing_listings,
    0,
    true,
    jsonb_build_object('cycleClaimed', true, 'fullCatalogRescan', false),
    '{}'::jsonb,
    '{}'::jsonb,
    'Seleccionar un máximo de cinco candidatos distintos.',
    'Ninguna mientras Seller OS prepara la cola.',
    'PILOT_3_LISTINGS_SAME_DAY_V1',
    p_created_by,
    p_now,
    p_now
  )
  returning id into claimed_run_id;

  return jsonb_build_object(
    'runId', claimed_run_id,
    'claimed', true,
    'created', true,
    'recovered', false
  );
end;
$$;

revoke all on function public.claim_same_day_pilot_cycle_v1(
  text,date,integer,text,integer,integer,uuid,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_same_day_pilot_cycle_v1(
  text,date,integer,text,integer,integer,uuid,uuid,timestamptz
) to service_role;

alter table public.ebay_same_day_pilot_runs enable row level security;
alter table public.ebay_same_day_pilot_runs force row level security;

notify pgrst, 'reload schema';
