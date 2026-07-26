begin;

-- Additive shadow-only selector state. This migration does not create a
-- scheduler, claim work automatically, call eBay, or change the V1 selector.
create table if not exists public.ebay_luna_selector_policies_v2 (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  marketplace text not null default 'EBAY_US',
  policy_version text not null,
  enabled boolean not null default false,
  shadow_mode boolean not null default true,
  policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_key, marketplace)
);

insert into public.ebay_luna_selector_policies_v2 (
  scope_key,
  marketplace,
  policy_version,
  enabled,
  shadow_mode,
  policy
)
values (
  'DEFAULT',
  'EBAY_US',
  'EBAY_LUNA_SELECTOR_V2_SHADOW_2026_07_26',
  false,
  true,
  jsonb_build_object(
    'targetBatchSize', 5,
    'minimumConfirmedDemandPreferred', 4,
    'maximumExploratory', 1,
    'maximumPerFamily', 2,
    'maximumPerCategory', 2,
    'minimumNetProfitUsd', 5,
    'minimumMarginRate', 0.20,
    'minimumRoiRate', 0.30,
    'minimumConfidenceScore', 70,
    'minimumReadyScore', 70,
    'maximumRiskScore', 35,
    'maximumSupplierEvidenceAgeHours', 72,
    'maximumSoldEvidenceAgeDays', 30,
    'explorationMinimumPotentialScore', 55,
    'fairnessMaximumBoost', 10
  )
)
on conflict (scope_key, marketplace) do nothing;

create table if not exists public.ebay_luna_scan_run_memberships_v2 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_luna_scan_runs(id) on delete restrict,
  task_id uuid not null references public.ebay_seller_scan_tasks(id) on delete restrict,
  candidate_key text not null,
  lane text not null,
  membership_kind text not null
    check (membership_kind in ('COMMERCIAL', 'MAINTENANCE', 'EXPLORATION')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'LEASED', 'COMPLETED', 'DEFERRED', 'CANCELLED')),
  snapshot_at timestamptz not null,
  next_eligible_at timestamptz,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, task_id)
);

create index if not exists ebay_luna_scan_run_memberships_v2_claim_idx
  on public.ebay_luna_scan_run_memberships_v2 (
    run_id,
    membership_kind,
    status,
    next_eligible_at,
    created_at
  );

create table if not exists public.ebay_luna_selector_ranking_snapshots_v2 (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  run_id uuid references public.ebay_luna_scan_runs(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  policy_version text not null,
  candidate_key text not null,
  product_id text not null,
  supplier_variant_id text,
  supplier_sku text,
  family_key text not null,
  category_id text,
  evidence_class text not null
    check (evidence_class in (
      'CONFIRMED_SOLD_EXACT',
      'OBSERVED_ESTIMATED_ROTATION',
      'POPULARITY_OR_RELATED',
      'ACTIVE_ONLY',
      'INSUFFICIENT_EVIDENCE'
    )),
  evidence_observed_at timestamptz,
  sold_exact_units integer not null default 0,
  sold_exact_seller_count integer not null default 0,
  sold_exact_comparable_count integer not null default 0,
  supplier_readiness_score numeric(7, 3) not null default 0,
  supplier_rotation_score numeric(7, 3) not null default 0,
  ebay_demand_score numeric(7, 3) not null default 0,
  commercial_viability_score numeric(7, 3) not null default 0,
  operational_readiness_score numeric(7, 3) not null default 0,
  risk_score numeric(7, 3) not null default 0,
  confidence_score numeric(7, 3) not null default 0,
  final_selection_score numeric(7, 3) not null default 0,
  research_priority_score numeric(7, 3) not null default 0,
  fairness_boost numeric(7, 3) not null default 0,
  hard_gate_codes text[] not null default '{}',
  ready_to_list boolean not null default false,
  eligible_for_exploration boolean not null default false,
  selected_for_ready_batch boolean not null default false,
  selected_for_exploration boolean not null default false,
  ready_position integer,
  research_position integer,
  selection_reason text not null,
  evidence_hash text not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    evidence_class <> 'CONFIRMED_SOLD_EXACT'
    or (
      sold_exact_units > 0
      and sold_exact_seller_count > 0
      and sold_exact_comparable_count > 0
    )
  ),
  check (
    not ready_to_list
    or (
      evidence_class = 'CONFIRMED_SOLD_EXACT'
      and cardinality(hard_gate_codes) = 0
    )
  )
);

create index if not exists ebay_luna_selector_ranking_v2_run_idx
  on public.ebay_luna_selector_ranking_snapshots_v2 (
    run_id,
    ready_to_list desc,
    final_selection_score desc,
    candidate_key
  );

alter table public.ebay_seller_scan_tasks
  add column if not exists selector_v2_last_deep_analyzed_at timestamptz,
  add column if not exists selector_v2_next_deep_eligible_at timestamptz,
  add column if not exists selector_v2_deep_analysis_attempts integer not null default 0,
  add column if not exists selector_v2_deferred_reason text;

create or replace function public.create_ebay_luna_scan_cohort_v2(
  p_run_id uuid,
  p_snapshot_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.ebay_luna_scan_runs run
    where run.id = p_run_id
      and run.status = 'running'
  ) then
    raise exception 'EBAY_LUNA_SCAN_RUN_NOT_ACTIVE';
  end if;

  insert into public.ebay_luna_scan_run_memberships_v2 (
    run_id,
    task_id,
    candidate_key,
    lane,
    membership_kind,
    status,
    snapshot_at,
    next_eligible_at,
    reason_codes
  )
  select
    p_run_id,
    task.id,
    task.candidate_key,
    task.lane,
    case
      when task.lane in ('protection', 'event') then 'MAINTENANCE'
      else 'COMMERCIAL'
    end,
    'PENDING',
    coalesce(p_snapshot_at, now()),
    task.selector_v2_next_deep_eligible_at,
    case
      when task.lane in ('protection', 'event')
        then array['MAINTENANCE_EXCLUDED_FROM_COMMERCIAL_SLOTS']::text[]
      else '{}'::text[]
    end
  from public.ebay_seller_scan_tasks task
  where task.status in ('queued', 'retry')
    and task.due_at <= coalesce(p_snapshot_at, now())
  on conflict (run_id, task_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.claim_ebay_commercial_scan_tasks_v2(
  p_run_id uuid,
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 120
)
returns setof public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'WORKER_ID_REQUIRED';
  end if;

  return query
  with claimable as (
    select task.id, membership.id as membership_id
    from public.ebay_luna_scan_run_memberships_v2 membership
    join public.ebay_seller_scan_tasks task on task.id = membership.task_id
    where membership.run_id = p_run_id
      and membership.membership_kind = 'COMMERCIAL'
      and membership.status in ('PENDING', 'DEFERRED')
      and (
        membership.next_eligible_at is null
        or membership.next_eligible_at <= now()
      )
      and task.status in ('queued', 'retry')
      and task.due_at <= now()
      and task.lane in ('hot', 'baseline', 'coverage')
      and (
        task.selector_v2_next_deep_eligible_at is null
        or task.selector_v2_next_deep_eligible_at <= now()
      )
    order by
      task.priority desc,
      task.selector_v2_last_deep_analyzed_at asc nulls first,
      task.due_at asc,
      task.task_key asc
    for update of task, membership skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 5))
  ),
  leased_memberships as (
    update public.ebay_luna_scan_run_memberships_v2 membership
    set status = 'LEASED',
        updated_at = now()
    from claimable
    where membership.id = claimable.membership_id
    returning membership.task_id
  )
  update public.ebay_seller_scan_tasks task
  set status = 'leased',
      attempts = task.attempts + 1,
      selector_v2_deep_analysis_attempts =
        task.selector_v2_deep_analysis_attempts + 1,
      lease_owner = trim(p_worker_id),
      lease_expires_at = now() + make_interval(
        secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))
      ),
      last_started_at = now(),
      updated_at = now()
  from leased_memberships
  where task.id = leased_memberships.task_id
  returning task.*;
end;
$$;

create or replace function public.complete_ebay_commercial_scan_task_v2(
  p_run_id uuid,
  p_task_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
)
returns public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.ebay_seller_scan_tasks;
  v_membership_updated integer := 0;
begin
  if not exists (
    select 1
    from public.ebay_luna_scan_run_memberships_v2 membership
    where membership.run_id = p_run_id
      and membership.task_id = p_task_id
      and membership.membership_kind = 'COMMERCIAL'
      and membership.status = 'LEASED'
  ) then
    raise exception 'EBAY_LUNA_SELECTOR_V2_MEMBERSHIP_NOT_LEASED';
  end if;

  select public.complete_ebay_seller_scan_task(
    p_task_id,
    p_worker_id,
    coalesce(p_result, '{}'::jsonb)
  ) into v_task;

  update public.ebay_seller_scan_tasks task
  set selector_v2_last_deep_analyzed_at = now(),
      selector_v2_next_deep_eligible_at = task.due_at,
      selector_v2_deferred_reason = null,
      updated_at = now()
  where task.id = p_task_id
  returning task.* into v_task;

  update public.ebay_luna_scan_run_memberships_v2 membership
  set status = 'COMPLETED',
      next_eligible_at = v_task.due_at,
      updated_at = now()
  where membership.run_id = p_run_id
    and membership.task_id = p_task_id
    and membership.status = 'LEASED';
  get diagnostics v_membership_updated = row_count;
  if v_membership_updated <> 1 then
    raise exception 'EBAY_LUNA_SELECTOR_V2_MEMBERSHIP_COMPLETION_CONFLICT';
  end if;

  return v_task;
end;
$$;

create or replace function public.defer_ebay_commercial_scan_task_v2(
  p_run_id uuid,
  p_task_id uuid,
  p_worker_id text,
  p_next_eligible_at timestamptz,
  p_reason_code text
)
returns public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.ebay_seller_scan_tasks;
  v_next timestamptz := greatest(coalesce(p_next_eligible_at, now()), now());
  v_membership_updated integer := 0;
  v_reason text := upper(regexp_replace(
    coalesce(nullif(trim(p_reason_code), ''), 'SELECTOR_V2_DEFERRED'),
    '[^A-Z0-9_]',
    '_',
    'g'
  ));
begin
  update public.ebay_luna_scan_run_memberships_v2 membership
  set status = 'DEFERRED',
      next_eligible_at = v_next,
      reason_codes = array(
        select distinct reason
        from unnest(
          membership.reason_codes || array[left(v_reason, 120)]
        ) reason
      ),
      updated_at = now()
  where membership.run_id = p_run_id
    and membership.task_id = p_task_id
    and membership.membership_kind = 'COMMERCIAL'
    and membership.status = 'LEASED';
  get diagnostics v_membership_updated = row_count;
  if v_membership_updated <> 1 then
    raise exception 'EBAY_LUNA_SELECTOR_V2_MEMBERSHIP_NOT_LEASED';
  end if;

  update public.ebay_seller_scan_tasks task
  set status = 'retry',
      due_at = v_next,
      lease_owner = null,
      lease_expires_at = null,
      selector_v2_next_deep_eligible_at = v_next,
      selector_v2_deferred_reason = left(v_reason, 120),
      last_error_code = left(v_reason, 120),
      updated_at = now()
  where task.id = p_task_id
    and task.status = 'leased'
    and task.lease_owner = trim(p_worker_id)
  returning task.* into v_task;

  if v_task.id is null then
    raise exception 'TASK_LEASE_NOT_OWNED';
  end if;

  return v_task;
end;
$$;

create or replace view public.ebay_luna_selector_v2_shadow_metrics
with (security_invoker = true)
as
select
  snapshot.policy_version,
  snapshot.marketplace_account_key,
  snapshot.marketplace,
  date_trunc('day', snapshot.captured_at) as snapshot_day,
  count(*) as candidate_count,
  count(*) filter (where snapshot.ready_to_list) as ready_count,
  count(*) filter (where snapshot.eligible_for_exploration) as exploration_count,
  count(*) filter (
    where snapshot.evidence_class = 'CONFIRMED_SOLD_EXACT'
  ) as confirmed_sold_exact_count,
  count(*) filter (
    where snapshot.evidence_class in (
      'ACTIVE_ONLY',
      'OBSERVED_ESTIMATED_ROTATION',
      'POPULARITY_OR_RELATED'
    )
      and snapshot.ready_to_list
  ) as weak_evidence_ready_violation_count,
  avg(snapshot.final_selection_score) as average_final_selection_score,
  avg(snapshot.research_priority_score) as average_research_priority_score,
  max(snapshot.captured_at) as last_captured_at
from public.ebay_luna_selector_ranking_snapshots_v2 snapshot
group by
  snapshot.policy_version,
  snapshot.marketplace_account_key,
  snapshot.marketplace,
  date_trunc('day', snapshot.captured_at);

alter table public.ebay_luna_selector_policies_v2 enable row level security;
alter table public.ebay_luna_scan_run_memberships_v2 enable row level security;
alter table public.ebay_luna_selector_ranking_snapshots_v2 enable row level security;
alter table public.ebay_luna_selector_policies_v2 force row level security;
alter table public.ebay_luna_scan_run_memberships_v2 force row level security;
alter table public.ebay_luna_selector_ranking_snapshots_v2 force row level security;

revoke all on table public.ebay_luna_selector_policies_v2
  from anon, authenticated;
revoke all on table public.ebay_luna_selector_policies_v2 from public;
revoke all on table public.ebay_luna_scan_run_memberships_v2
  from anon, authenticated;
revoke all on table public.ebay_luna_scan_run_memberships_v2 from public;
revoke all on table public.ebay_luna_selector_ranking_snapshots_v2
  from anon, authenticated;
revoke all on table public.ebay_luna_selector_ranking_snapshots_v2 from public;
revoke all on table public.ebay_luna_selector_v2_shadow_metrics
  from anon, authenticated;
revoke all on table public.ebay_luna_selector_v2_shadow_metrics from public;

grant select, insert, update on table public.ebay_luna_selector_policies_v2
  to service_role;
grant select, insert, update on table public.ebay_luna_scan_run_memberships_v2
  to service_role;
grant select, insert on table public.ebay_luna_selector_ranking_snapshots_v2
  to service_role;
grant select on table public.ebay_luna_selector_v2_shadow_metrics
  to service_role;

revoke all on function public.create_ebay_luna_scan_cohort_v2(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_ebay_commercial_scan_tasks_v2(
  uuid,
  text,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.complete_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.defer_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  timestamptz,
  text
) from public, anon, authenticated;

grant execute on function public.create_ebay_luna_scan_cohort_v2(uuid, timestamptz)
  to service_role;
grant execute on function public.claim_ebay_commercial_scan_tasks_v2(
  uuid,
  text,
  integer,
  integer
) to service_role;
grant execute on function public.complete_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  jsonb
) to service_role;
grant execute on function public.defer_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  timestamptz,
  text
) to service_role;

commit;
