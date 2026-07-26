begin;

-- Extend the canonical organic listing snapshot instead of creating a parallel
-- traffic store. These values come only from Sell Analytics getTrafficReport.
alter table public.listing_commercial_snapshots
  add column if not exists search_impressions bigint null,
  add column if not exists store_impressions bigint null,
  add column if not exists search_views bigint null,
  add column if not exists direct_views bigint null,
  add column if not exists external_views bigint null,
  add column if not exists other_ebay_views bigint null,
  add column if not exists store_views bigint null,
  add column if not exists analytics_last_updated_at timestamptz null,
  add column if not exists analytics_timezone text null,
  add column if not exists analytics_reconciliation_status text null,
  add column if not exists analytics_scope text null;

create table if not exists public.ebay_listing_recovery_configs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  enabled boolean not null default false,
  shadow_mode boolean not null default true,
  scheduler_enabled boolean not null default false,
  external_writes_enabled boolean not null default false,
  policy_version text not null default 'EBAY_RECOVERY_POLICY_V1',
  policy jsonb not null default jsonb_build_object(
    'minimumObservationHours', 168,
    'organicFreshnessHours', 48,
    'paidReconciliationHours', 72,
    'minimumImpressions', 100,
    'minimumViews', 30,
    'cooldownHours', 168,
    'maximumExperimentsPerListing', 6,
    'maximumPublicPriceStepPercent', 3
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_recovery_configs_identity unique (
    marketplace_account_key, marketplace
  ),
  constraint ebay_listing_recovery_configs_safe_mode_check check (
    not external_writes_enabled
  ),
  constraint ebay_listing_recovery_configs_policy_check check (
    jsonb_typeof(policy) = 'object'
  )
);

insert into public.ebay_listing_recovery_configs (
  marketplace_account_key, marketplace
)
select distinct marketplace_account_key, marketplace
from public.commercial_threshold_configs
where nullif(trim(marketplace_account_key), '') is not null
on conflict (marketplace_account_key, marketplace) do nothing;

create table if not exists public.ebay_listing_recovery_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  trigger_source text not null,
  status text not null default 'RUNNING',
  worker_id text not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  target_limit integer not null,
  selected_count integer not null default 0,
  diagnosed_count integer not null default 0,
  quarantined_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_recovery_runs_trigger_check check (
    trigger_source in ('schedule', 'manual_shadow', 'dry_run')
  ),
  constraint ebay_listing_recovery_runs_status_check check (
    status in (
      'RUNNING', 'COMPLETED', 'COMPLETED_WITH_QUARANTINE',
      'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'
    )
  ),
  constraint ebay_listing_recovery_runs_counts_check check (
    target_limit between 1 and 100
    and selected_count >= 0
    and diagnosed_count >= 0
    and quarantined_count >= 0
  ),
  constraint ebay_listing_recovery_runs_errors_check check (
    jsonb_typeof(errors) = 'array'
  )
);

create unique index if not exists ebay_listing_recovery_one_running_uidx
  on public.ebay_listing_recovery_runs(
    marketplace_account_key, marketplace
  ) where status = 'RUNNING';

create table if not exists public.ebay_listing_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  sku text null,
  current_state text not null,
  current_diagnosis text not null,
  action_level integer null,
  current_action text null,
  evidence_hash text not null,
  output_hash text not null,
  latest_snapshot_id uuid null references
    public.listing_commercial_snapshots(id) on delete set null,
  last_run_id uuid null references public.ebay_listing_recovery_runs(id)
    on delete set null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  next_evaluation_at timestamptz null,
  recovered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_recovery_cases_identity unique (
    marketplace_account_key, marketplace, listing_id
  ),
  constraint ebay_listing_recovery_cases_state_check check (
    current_state in (
      'POST_PUBLISH_VERIFICATION', 'OBSERVATION_WINDOW',
      'PERFORMANCE_BASELINE_READY', 'PERFORMANCE_DIAGNOSIS',
      'ACTION_PROPOSED', 'EXPERIMENT_PREPARED', 'EXPERIMENT_ACTIVE',
      'COOLDOWN', 'EXPERIMENT_EVALUATION', 'PERFORMANCE_RECOVERED',
      'CONTINUE_MONITORING', 'NEXT_OPTIMIZATION_LEVEL',
      'WAITING_FOR_SUFFICIENT_SAMPLE', 'ROLLBACK_REQUIRED',
      'PRICE_TEST_ELIGIBLE', 'PAUSE_OR_RETIRE_RECOMMENDED',
      'QUARANTINED_OPTIMIZATION_ERROR'
    )
  ),
  constraint ebay_listing_recovery_cases_diagnosis_check check (
    current_diagnosis in (
      'NO_IMPRESSIONS', 'IMPRESSIONS_NO_CLICKS',
      'CLICKS_NO_CONVERSION', 'INTEREST_WITHOUT_SALE',
      'PROMOTED_NO_RESULT', 'PRICE_NOT_COMPETITIVE',
      'MARKET_DEMAND_WEAK', 'LISTING_TECHNICAL_PROBLEM',
      'INSUFFICIENT_EVIDENCE'
    )
  ),
  constraint ebay_listing_recovery_cases_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
    and output_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_recovery_cases_action_level_check check (
    action_level is null or action_level between 1 and 11
  )
);

create table if not exists public.ebay_listing_recovery_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_listing_recovery_runs(id)
    on delete restrict,
  recovery_case_id uuid null references public.ebay_listing_recovery_cases(id)
    on delete set null,
  listing_commercial_snapshot_id uuid null references
    public.listing_commercial_snapshots(id) on delete set null,
  listing_id text not null,
  sku text null,
  position integer not null,
  status text not null,
  diagnosis text null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_recovery_run_items_identity unique (
    run_id, listing_id
  ),
  constraint ebay_listing_recovery_run_items_position unique (
    run_id, position
  ),
  constraint ebay_listing_recovery_run_items_status_check check (
    status in ('DIAGNOSED', 'QUARANTINED_OPTIMIZATION_ERROR')
  )
);

create table if not exists public.ebay_listing_recovery_state_transitions (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.ebay_listing_recovery_cases(id)
    on delete restrict,
  run_id uuid null references public.ebay_listing_recovery_runs(id)
    on delete set null,
  previous_state text null,
  next_state text not null,
  cause text not null,
  evidence_hash text not null,
  output_hash text not null,
  actor_type text not null default 'SYSTEM_SHADOW',
  transitioned_at timestamptz not null default now(),
  constraint ebay_listing_recovery_transition_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
    and output_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_recovery_transition_actor_check check (
    actor_type in ('SYSTEM_SHADOW', 'HUMAN', 'RECONCILER')
  )
);

create table if not exists public.ebay_listing_recovery_diagnostics (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.ebay_listing_recovery_cases(id)
    on delete restrict,
  run_id uuid not null references public.ebay_listing_recovery_runs(id)
    on delete restrict,
  listing_commercial_snapshot_id uuid not null references
    public.listing_commercial_snapshots(id) on delete restrict,
  engine_version text not null,
  policy_version text not null,
  diagnosis text not null,
  action_level integer null,
  action text null,
  evidence_hash text not null,
  output_hash text not null,
  output jsonb not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_recovery_diagnostics_idempotency unique (
    recovery_case_id, evidence_hash, output_hash
  ),
  constraint ebay_listing_recovery_diagnostics_json_check check (
    jsonb_typeof(output) = 'object'
  ),
  constraint ebay_listing_recovery_diagnostics_no_effect_check check (
    coalesce((output #>> '{safety,ebayWrites}')::integer, 0) = 0
    and coalesce((output #>> '{safety,externalEffects}')::integer, 0) = 0
  )
);

create table if not exists public.ebay_listing_performance_baselines (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  version text not null,
  source text not null,
  category_id text null,
  condition text null,
  price_band text null,
  listing_age_band text null,
  product_type text null,
  pack text null,
  traffic_mode text not null,
  sample_size integer not null,
  minimum_impressions integer not null,
  minimum_views integer not null,
  minimum_ctr_percent numeric(10,4) not null,
  minimum_conversion_percent numeric(10,4) not null,
  window_start date not null,
  window_end date not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_performance_baselines_identity unique (
    marketplace_account_key, marketplace, version, category_id, condition,
    price_band, listing_age_band, product_type, pack, traffic_mode
  ),
  constraint ebay_listing_performance_baselines_source_check check (
    source in ('ACCOUNT_COHORT', 'PROVISIONAL_CONSERVATIVE')
  ),
  constraint ebay_listing_performance_baselines_mode_check check (
    traffic_mode in ('ORGANIC', 'PROMOTED')
  ),
  constraint ebay_listing_performance_baselines_sample_check check (
    sample_size >= 0 and minimum_impressions >= 0 and minimum_views >= 0
  )
);

-- Paid traffic remains isolated from organic Sell Analytics metrics.
create table if not exists public.ebay_listing_marketing_snapshots (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  sku text null,
  source text not null default 'EBAY_SELL_MARKETING_AD_REPORT',
  scope text not null,
  funding_model text not null,
  campaign_id text null,
  ad_group_id text null,
  campaign_status text not null,
  impressions bigint null,
  clicks bigint null,
  ctr numeric(10,4) null,
  attributed_sales bigint null,
  sales_conversion_rate numeric(10,4) null,
  ad_fees numeric(14,2) null,
  cost_per_click numeric(14,4) null,
  roas numeric(14,4) null,
  window_start date not null,
  window_end date not null,
  captured_at timestamptz not null,
  last_updated_at timestamptz null,
  reconciliation_status text not null,
  completeness_status text not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_marketing_snapshots_identity unique (
    marketplace_account_key, marketplace, listing_id, source,
    funding_model, campaign_id, ad_group_id, window_start, window_end,
    captured_at
  ),
  constraint ebay_listing_marketing_snapshots_source_check check (
    source = 'EBAY_SELL_MARKETING_AD_REPORT'
  ),
  constraint ebay_listing_marketing_snapshots_scope_check check (
    scope in ('sell.marketing.readonly', 'sell.marketing')
  ),
  constraint ebay_listing_marketing_snapshots_funding_check check (
    funding_model in ('COST_PER_SALE', 'COST_PER_CLICK')
  ),
  constraint ebay_listing_marketing_snapshots_reconciliation_check check (
    reconciliation_status in ('pending', 'reconciled', 'unknown')
  ),
  constraint ebay_listing_marketing_snapshots_completeness_check check (
    completeness_status in ('complete', 'incomplete', 'unavailable')
  ),
  constraint ebay_listing_marketing_snapshots_hash_check check (
    source_hash ~ '^[0-9a-f]{64}$'
  )
);

-- This table is intentionally empty until Negotiation read access is
-- implemented and verified. It stores listing eligibility only, never buyer PII.
create table if not exists public.ebay_listing_negotiation_eligibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  eligible boolean not null,
  source text not null default 'EBAY_NEGOTIATION_FIND_ELIGIBLE_ITEMS',
  scope text not null,
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_negotiation_eligibility_identity unique (
    marketplace_account_key, marketplace, listing_id, captured_at
  ),
  constraint ebay_listing_negotiation_source_check check (
    source = 'EBAY_NEGOTIATION_FIND_ELIGIBLE_ITEMS'
  ),
  constraint ebay_listing_negotiation_hash_check check (
    source_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_negotiation_expiry_check check (
    expires_at > captured_at
  )
);

create table if not exists public.commercial_experiment_controls (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  commercial_event_id uuid null references public.commercial_alert_events(id)
    on delete restrict,
  recovery_case_id uuid null references public.ebay_listing_recovery_cases(id)
    on delete restrict,
  listing_id text not null,
  sku text null,
  contract_version text not null,
  ruleset_version text not null,
  configuration_version text not null,
  evidence_hash text not null,
  proposal_hash text not null,
  experiment_idempotency_key text not null unique,
  variable text not null,
  hypothesis text not null,
  primary_kpi text not null,
  baseline jsonb not null,
  previous_value jsonb null,
  proposed_value jsonb null,
  observation_window_days integer not null,
  minimum_sample integer not null,
  guardrails jsonb not null,
  rollback jsonb not null,
  execution_mechanism text not null,
  status text not null default 'PROPOSED',
  ebay_write_allowed boolean not null default false,
  cooldown_until timestamptz null,
  measurement_due_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  manually_executed_at timestamptz null,
  result text null,
  result_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_experiment_controls_status_check check (
    status in (
      'PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED_MANUALLY',
      'MEASURING', 'WON', 'NEUTRAL', 'LOST', 'INCONCLUSIVE',
      'RESOLVED', 'CANCELLED'
    )
  ),
  constraint commercial_experiment_controls_result_check check (
    result is null or result in ('WON', 'NEUTRAL', 'LOST', 'INCONCLUSIVE')
  ),
  constraint commercial_experiment_controls_single_variable_check check (
    nullif(trim(variable), '') is not null
    and jsonb_typeof(baseline) = 'object'
    and jsonb_typeof(guardrails) = 'array'
    and jsonb_typeof(rollback) = 'object'
  ),
  constraint commercial_experiment_controls_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
    and proposal_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint commercial_experiment_controls_no_write_check check (
    ebay_write_allowed = false
  )
);

create unique index if not exists commercial_experiment_one_active_variable_uidx
  on public.commercial_experiment_controls(
    marketplace_account_key, marketplace, listing_id, variable
  ) where status in (
    'PROPOSED', 'APPROVED', 'EXECUTED_MANUALLY', 'MEASURING'
  );

create table if not exists public.commercial_experiment_snapshot_memberships (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.commercial_experiment_controls(id)
    on delete restrict,
  listing_commercial_snapshot_id uuid not null references
    public.listing_commercial_snapshots(id) on delete restrict,
  role text not null,
  position integer not null default 1,
  included_at timestamptz not null default now(),
  constraint commercial_experiment_snapshot_membership_unique unique (
    experiment_id, listing_commercial_snapshot_id, role
  ),
  constraint commercial_experiment_snapshot_membership_role_check check (
    role in ('BASELINE', 'MEASUREMENT', 'ROLLBACK')
  )
);

create table if not exists public.ebay_listing_recovery_competitive_gap_reports (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.ebay_listing_recovery_cases(id)
    on delete restrict,
  diagnostic_id uuid not null references public.ebay_listing_recovery_diagnostics(id)
    on delete restrict,
  report_version text not null,
  evidence_hash text not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_recovery_gap_idempotency unique (
    recovery_case_id, evidence_hash, report_version
  ),
  constraint ebay_listing_recovery_gap_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_recovery_gap_json_check check (
    jsonb_typeof(report) = 'object'
    and coalesce((report->>'competitorContentCopied')::boolean, false) = false
  )
);

create table if not exists public.ebay_listing_recovery_learning_events (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.ebay_listing_recovery_cases(id)
    on delete restrict,
  experiment_id uuid not null references public.commercial_experiment_controls(id)
    on delete restrict,
  version text not null,
  result text not null,
  confirmed_units_sold integer not null,
  net_contribution numeric(14,2) null,
  commercially_reusable boolean not null default false,
  feeds text[] not null default '{}',
  evidence_refs jsonb not null,
  learning_hash text not null unique,
  created_at timestamptz not null default now(),
  constraint ebay_listing_recovery_learning_result_check check (
    result in ('WON', 'NEUTRAL', 'LOST', 'INCONCLUSIVE')
  ),
  constraint ebay_listing_recovery_learning_evidence_check check (
    jsonb_typeof(evidence_refs) = 'array'
  ),
  constraint ebay_listing_recovery_learning_hash_check check (
    learning_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_recovery_learning_profit_check check (
    not commercially_reusable
    or (result = 'WON' and confirmed_units_sold > 0 and net_contribution >= 5)
  )
);

-- Reuse and strengthen the existing commercial action ledger. No new eBay
-- update route is introduced by this migration.
alter table public.ebay_commercial_improvement_executions
  add column if not exists experiment_id uuid null,
  add column if not exists claim_token uuid null,
  add column if not exists lease_expires_at timestamptz null,
  add column if not exists reconciled boolean not null default false,
  add column if not exists reconciled_at timestamptz null,
  add column if not exists reconciliation_code text null,
  add column if not exists rollback_of_execution_id uuid null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ebay_commercial_improvement_executions'::regclass
      and conname = 'ebay_commercial_improvement_experiment_fkey'
  ) then
    alter table public.ebay_commercial_improvement_executions
      add constraint ebay_commercial_improvement_experiment_fkey
      foreign key (experiment_id)
      references public.commercial_experiment_controls(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ebay_commercial_improvement_executions'::regclass
      and conname = 'ebay_commercial_improvement_rollback_fkey'
  ) then
    alter table public.ebay_commercial_improvement_executions
      add constraint ebay_commercial_improvement_rollback_fkey
      foreign key (rollback_of_execution_id)
      references public.ebay_commercial_improvement_executions(id)
      on delete restrict;
  end if;
end
$constraints$;

create unique index if not exists ebay_commercial_improvement_experiment_uidx
  on public.ebay_commercial_improvement_executions(experiment_id)
  where experiment_id is not null;

create index if not exists ebay_listing_recovery_case_queue_idx
  on public.ebay_listing_recovery_cases(
    marketplace_account_key, marketplace, current_diagnosis, updated_at desc
  );
create index if not exists ebay_listing_marketing_snapshot_lookup_idx
  on public.ebay_listing_marketing_snapshots(
    marketplace_account_key, marketplace, listing_id, captured_at desc
  );
create index if not exists commercial_experiment_measurement_idx
  on public.commercial_experiment_controls(
    marketplace_account_key, marketplace, status, measurement_due_at
  );

create or replace function public.reject_ebay_listing_recovery_immutable_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_LISTING_RECOVERY_IMMUTABLE_RECORD';
end;
$$;

do $triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'ebay_listing_recovery_state_transitions',
    'ebay_listing_recovery_diagnostics',
    'ebay_listing_performance_baselines',
    'ebay_listing_marketing_snapshots',
    'ebay_listing_negotiation_eligibility_snapshots',
    'ebay_listing_recovery_competitive_gap_reports',
    'ebay_listing_recovery_learning_events'
  ] loop
    v_trigger := v_table || '_immutable_v1';
    execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_ebay_listing_recovery_immutable_change_v1()',
      v_trigger, v_table
    );
  end loop;
end
$triggers$;

create or replace function public.start_ebay_listing_recovery_shadow_run_v1(
  p_marketplace_account_key text,
  p_marketplace text,
  p_trigger_source text,
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 240
)
returns setof public.ebay_listing_recovery_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_config public.ebay_listing_recovery_configs%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_marketplace), '') is null
    or nullif(trim(p_worker_id), '') is null
    or p_trigger_source not in ('schedule', 'manual_shadow') then
    raise exception 'EBAY_LISTING_RECOVERY_SCOPE_INVALID';
  end if;
  select * into v_config
  from public.ebay_listing_recovery_configs
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
  for update;
  if not found
    or not v_config.enabled
    or not v_config.shadow_mode
    or v_config.external_writes_enabled
    or (p_trigger_source = 'schedule' and not v_config.scheduler_enabled) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-recovery:' || p_marketplace_account_key || ':' || p_marketplace, 0
  ));
  update public.ebay_listing_recovery_runs
  set status = 'FAILED',
      errors = errors || jsonb_build_array(jsonb_build_object(
        'code', 'RECOVERY_RUN_LEASE_EXPIRED', 'at', v_now
      )),
      completed_at = v_now
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and status = 'RUNNING'
    and lease_expires_at < v_now;
  if exists (
    select 1 from public.ebay_listing_recovery_runs
    where marketplace_account_key = p_marketplace_account_key
      and marketplace = p_marketplace
      and status = 'RUNNING'
      and lease_expires_at >= v_now
  ) then return; end if;
  return query
  insert into public.ebay_listing_recovery_runs (
    marketplace_account_key, marketplace, trigger_source, worker_id,
    lease_expires_at, target_limit
  ) values (
    p_marketplace_account_key, p_marketplace, p_trigger_source,
    left(p_worker_id, 180),
    v_now + make_interval(secs => greatest(60, least(p_lease_seconds, 900))),
    greatest(1, least(p_limit, 100))
  ) returning *;
end;
$$;

create or replace function public.record_ebay_listing_recovery_shadow_result_v1(
  p_run_id uuid,
  p_worker_id text,
  p_listing_commercial_snapshot_id uuid,
  p_listing_id text,
  p_sku text,
  p_state text,
  p_diagnosis text,
  p_action_level integer,
  p_action text,
  p_evidence_hash text,
  p_output_hash text,
  p_output jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_listing_recovery_runs%rowtype;
  v_case public.ebay_listing_recovery_cases%rowtype;
  v_previous_state text;
  v_diagnostic_id uuid;
  v_position integer;
  v_experiment jsonb := p_output->'experiment';
begin
  select * into v_run from public.ebay_listing_recovery_runs
  where id = p_run_id and worker_id = p_worker_id and status = 'RUNNING'
    and lease_expires_at >= clock_timestamp()
  for update;
  if not found then raise exception 'EBAY_LISTING_RECOVERY_RUN_NOT_OWNED'; end if;
  if p_output is null or jsonb_typeof(p_output) <> 'object'
    or coalesce((p_output #>> '{safety,ebayWrites}')::integer, 0) <> 0
    or coalesce((p_output #>> '{safety,externalEffects}')::integer, 0) <> 0 then
    raise exception 'EBAY_LISTING_RECOVERY_SHADOW_OUTPUT_UNSAFE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_run.marketplace_account_key || ':' || v_run.marketplace || ':' ||
    p_listing_id, 0
  ));
  select current_state into v_previous_state
  from public.ebay_listing_recovery_cases
  where marketplace_account_key = v_run.marketplace_account_key
    and marketplace = v_run.marketplace
    and listing_id = p_listing_id;
  insert into public.ebay_listing_recovery_cases (
    marketplace_account_key, marketplace, listing_id, sku, current_state,
    current_diagnosis, action_level, current_action, evidence_hash,
    output_hash, latest_snapshot_id, last_run_id, last_observed_at,
    next_evaluation_at, recovered_at
  ) values (
    v_run.marketplace_account_key, v_run.marketplace, p_listing_id,
    nullif(trim(p_sku), ''), p_state, p_diagnosis, p_action_level,
    nullif(trim(p_action), ''), p_evidence_hash, p_output_hash,
    p_listing_commercial_snapshot_id, p_run_id, clock_timestamp(),
    case when p_state in ('COOLDOWN', 'WAITING_FOR_SUFFICIENT_SAMPLE')
      then clock_timestamp() + interval '7 days' else null end,
    case when p_state = 'PERFORMANCE_RECOVERED'
      then clock_timestamp() else null end
  )
  on conflict (marketplace_account_key, marketplace, listing_id)
  do update set
    sku = excluded.sku,
    current_state = excluded.current_state,
    current_diagnosis = excluded.current_diagnosis,
    action_level = excluded.action_level,
    current_action = excluded.current_action,
    evidence_hash = excluded.evidence_hash,
    output_hash = excluded.output_hash,
    latest_snapshot_id = excluded.latest_snapshot_id,
    last_run_id = excluded.last_run_id,
    last_observed_at = excluded.last_observed_at,
    next_evaluation_at = excluded.next_evaluation_at,
    recovered_at = coalesce(excluded.recovered_at,
      public.ebay_listing_recovery_cases.recovered_at),
    updated_at = clock_timestamp()
  returning * into v_case;
  if v_previous_state is distinct from p_state then
    insert into public.ebay_listing_recovery_state_transitions (
      recovery_case_id, run_id, previous_state, next_state, cause,
      evidence_hash, output_hash
    ) values (
      v_case.id, p_run_id, v_previous_state, p_state,
      coalesce(p_output->>'reason', 'RECOVERY_SHADOW_DIAGNOSIS'),
      p_evidence_hash, p_output_hash
    );
  end if;
  insert into public.ebay_listing_recovery_diagnostics (
    recovery_case_id, run_id, listing_commercial_snapshot_id,
    engine_version, policy_version, diagnosis, action_level, action,
    evidence_hash, output_hash, output
  ) values (
    v_case.id, p_run_id, p_listing_commercial_snapshot_id,
    p_output->>'engineVersion', p_output->>'policyVersion',
    p_diagnosis, p_action_level, nullif(trim(p_action), ''),
    p_evidence_hash, p_output_hash, p_output
  )
  on conflict (recovery_case_id, evidence_hash, output_hash)
  do nothing
  returning id into v_diagnostic_id;
  if v_diagnostic_id is null then
    select id into v_diagnostic_id
    from public.ebay_listing_recovery_diagnostics
    where recovery_case_id = v_case.id
      and evidence_hash = p_evidence_hash
      and output_hash = p_output_hash;
  end if;
  insert into public.ebay_listing_recovery_competitive_gap_reports (
    recovery_case_id, diagnostic_id, report_version, evidence_hash, report
  ) values (
    v_case.id, v_diagnostic_id,
    coalesce(p_output #>> '{competitiveGap,version}',
      'EBAY_COMPETITIVE_GAP_REPORT_V1'),
    p_evidence_hash, p_output->'competitiveGap'
  ) on conflict do nothing;
  if v_experiment is not null and jsonb_typeof(v_experiment) = 'object'
    and not exists (
      select 1 from public.commercial_experiment_controls
      where marketplace_account_key = v_run.marketplace_account_key
        and marketplace = v_run.marketplace
        and listing_id = p_listing_id
        and variable = v_experiment->>'variable'
        and status in ('PROPOSED', 'APPROVED', 'EXECUTED_MANUALLY', 'MEASURING')
    ) then
    insert into public.commercial_experiment_controls (
      marketplace_account_key, marketplace, recovery_case_id, listing_id,
      sku, contract_version, ruleset_version, configuration_version,
      evidence_hash, proposal_hash, experiment_idempotency_key, variable,
      hypothesis, primary_kpi, baseline, previous_value, proposed_value,
      observation_window_days, minimum_sample, guardrails, rollback,
      execution_mechanism, ebay_write_allowed
    ) values (
      v_run.marketplace_account_key, v_run.marketplace, v_case.id,
      p_listing_id, nullif(trim(p_sku), ''),
      v_experiment->>'contractVersion', p_output->>'engineVersion',
      p_output->>'policyVersion', p_evidence_hash, p_output_hash,
      v_experiment->>'experimentIdempotencyKey',
      v_experiment->>'variable', v_experiment->>'hypothesis',
      v_experiment->>'primaryKpi', v_experiment->'baseline',
      v_experiment->'previousValue', v_experiment->'proposedValue',
      greatest(1, least(coalesce(
        (v_experiment->>'observationWindowDays')::integer, 7), 30)),
      greatest(1, coalesce((v_experiment->>'minimumSample')::integer, 1)),
      v_experiment->'guardrails', v_experiment->'rollback',
      v_experiment->>'executionMechanism', false
    ) on conflict (experiment_idempotency_key) do nothing;
  end if;
  select coalesce(max(position), 0) + 1 into v_position
  from public.ebay_listing_recovery_run_items where run_id = p_run_id;
  insert into public.ebay_listing_recovery_run_items (
    run_id, recovery_case_id, listing_commercial_snapshot_id, listing_id,
    sku, position, status, diagnosis
  ) values (
    p_run_id, v_case.id, p_listing_commercial_snapshot_id, p_listing_id,
    nullif(trim(p_sku), ''), v_position, 'DIAGNOSED', p_diagnosis
  ) on conflict (run_id, listing_id) do update set
    status = excluded.status,
    diagnosis = excluded.diagnosis,
    updated_at = clock_timestamp();
  update public.ebay_listing_recovery_runs
  set heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '240 seconds'
  where id = p_run_id and worker_id = p_worker_id;
  return v_case.id;
end;
$$;

create or replace function public.record_ebay_listing_recovery_shadow_error_v1(
  p_run_id uuid,
  p_worker_id text,
  p_listing_id text,
  p_sku text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_listing_recovery_runs%rowtype;
  v_case_id uuid;
  v_position integer;
  v_hash text := encode(digest(
    p_run_id::text || ':' || p_listing_id || ':' || p_error_code, 'sha256'
  ), 'hex');
begin
  select * into v_run from public.ebay_listing_recovery_runs
  where id = p_run_id and worker_id = p_worker_id and status = 'RUNNING'
  for update;
  if not found then return false; end if;
  insert into public.ebay_listing_recovery_cases (
    marketplace_account_key, marketplace, listing_id, sku, current_state,
    current_diagnosis, evidence_hash, output_hash, last_run_id,
    last_observed_at
  ) values (
    v_run.marketplace_account_key, v_run.marketplace, p_listing_id,
    nullif(trim(p_sku), ''), 'QUARANTINED_OPTIMIZATION_ERROR',
    'INSUFFICIENT_EVIDENCE', v_hash, v_hash, p_run_id, clock_timestamp()
  ) on conflict (marketplace_account_key, marketplace, listing_id)
  do update set
    current_state = 'QUARANTINED_OPTIMIZATION_ERROR',
    current_diagnosis = 'INSUFFICIENT_EVIDENCE',
    last_run_id = excluded.last_run_id,
    last_observed_at = excluded.last_observed_at,
    updated_at = clock_timestamp()
  returning id into v_case_id;
  select coalesce(max(position), 0) + 1 into v_position
  from public.ebay_listing_recovery_run_items where run_id = p_run_id;
  insert into public.ebay_listing_recovery_run_items (
    run_id, recovery_case_id, listing_id, sku, position, status, error_code
  ) values (
    p_run_id, v_case_id, p_listing_id, nullif(trim(p_sku), ''), v_position,
    'QUARANTINED_OPTIMIZATION_ERROR', left(p_error_code, 100)
  ) on conflict (run_id, listing_id) do update set
    status = excluded.status, error_code = excluded.error_code,
    updated_at = clock_timestamp();
  return true;
end;
$$;

create or replace function public.finish_ebay_listing_recovery_shadow_run_v1(
  p_run_id uuid,
  p_worker_id text,
  p_status text,
  p_selected_count integer,
  p_diagnosed_count integer,
  p_quarantined_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ebay_listing_recovery_runs
  set status = p_status,
      selected_count = greatest(0, p_selected_count),
      diagnosed_count = greatest(0, p_diagnosed_count),
      quarantined_count = greatest(0, p_quarantined_count),
      heartbeat_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where id = p_run_id and worker_id = p_worker_id and status = 'RUNNING'
    and p_status in (
      'COMPLETED', 'COMPLETED_WITH_QUARANTINE',
      'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'
    );
  return found;
end;
$$;

-- Future canaries must claim the existing ledger atomically. These RPCs do not
-- call eBay and are not used by the current Preview runtime.
create or replace function public.claim_commercial_improvement_execution_v2(
  p_execution_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.ebay_commercial_improvement_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidate as (
    select execution.id
    from public.ebay_commercial_improvement_executions execution
    left join public.commercial_experiment_controls experiment
      on experiment.id = execution.experiment_id
    where execution.id = p_execution_id
      and execution.phase = 'preview_ready'
      and execution.ebay_write_dispatched = false
      and (
        execution.experiment_id is null
        or experiment.status = 'APPROVED'
      )
      and (execution.lease_expires_at is null
        or execution.lease_expires_at < clock_timestamp())
    for update of execution skip locked
  )
  update public.ebay_commercial_improvement_executions execution
  set claim_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() +
        make_interval(secs => greatest(30, least(p_lease_seconds, 300))),
      updated_at = clock_timestamp()
  from candidate
  where execution.id = candidate.id
  returning execution.*;
end;
$$;

create or replace function public.mark_commercial_improvement_uncertain_v2(
  p_execution_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ebay_commercial_improvement_executions
  set phase = 'outcome_unknown',
      last_error_code = left(p_error_code, 100),
      claim_token = null,
      lease_expires_at = null,
      reconciled = false,
      updated_at = clock_timestamp()
  where id = p_execution_id and claim_token = p_claim_token
    and phase in ('preview_ready', 'write_in_flight');
  return found;
end;
$$;

create or replace function public.reconcile_commercial_improvement_outcome_v2(
  p_execution_id uuid,
  p_observed_matches_expected boolean,
  p_reconciliation_code text,
  p_postflight_snapshot jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ebay_commercial_improvement_executions
  set phase = case when p_observed_matches_expected
      then 'applied_verified' else 'outcome_unknown' end,
      postflight_snapshot = coalesce(p_postflight_snapshot, '{}'::jsonb),
      reconciled = p_observed_matches_expected,
      reconciled_at = clock_timestamp(),
      reconciliation_code = left(p_reconciliation_code, 100),
      applied_verified_at = case when p_observed_matches_expected
        then clock_timestamp() else applied_verified_at end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_execution_id and phase = 'outcome_unknown';
  return found;
end;
$$;

create or replace view public.ebay_listing_recovery_dashboard_v1
with (security_invoker = true)
as
select
  recovery.id,
  recovery.marketplace_account_key,
  recovery.marketplace,
  recovery.listing_id,
  recovery.sku,
  recovery.current_state,
  recovery.current_diagnosis,
  recovery.action_level,
  recovery.current_action,
  recovery.first_observed_at,
  recovery.last_observed_at,
  recovery.next_evaluation_at,
  recovery.recovered_at,
  recovery.updated_at,
  snapshot.impressions,
  snapshot.views,
  snapshot.ctr,
  snapshot.transactions,
  snapshot.sales_conversion_rate,
  snapshot.revenue,
  snapshot.stock_available,
  snapshot.supplier_cost,
  snapshot.estimated_margin_percent,
  snapshot.analytics_last_updated_at,
  snapshot.analytics_reconciliation_status,
  experiment.id as experiment_id,
  experiment.status as experiment_status,
  experiment.variable as experiment_variable,
  experiment.primary_kpi,
  experiment.measurement_due_at,
  experiment.result as experiment_result
from public.ebay_listing_recovery_cases recovery
left join public.listing_commercial_snapshots snapshot
  on snapshot.id = recovery.latest_snapshot_id
left join lateral (
  select control.*
  from public.commercial_experiment_controls control
  where control.recovery_case_id = recovery.id
  order by control.created_at desc
  limit 1
) experiment on true;

do $security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ebay_listing_recovery_configs',
    'ebay_listing_recovery_runs',
    'ebay_listing_recovery_cases',
    'ebay_listing_recovery_run_items',
    'ebay_listing_recovery_state_transitions',
    'ebay_listing_recovery_diagnostics',
    'ebay_listing_performance_baselines',
    'ebay_listing_marketing_snapshots',
    'ebay_listing_negotiation_eligibility_snapshots',
    'commercial_experiment_controls',
    'commercial_experiment_snapshot_memberships',
    'ebay_listing_recovery_competitive_gap_reports',
    'ebay_listing_recovery_learning_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      v_table
    );
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end
$security$;

revoke all on table public.ebay_listing_recovery_configs from anon, authenticated;
revoke all on table public.ebay_listing_recovery_runs from anon, authenticated;
revoke all on table public.ebay_listing_recovery_cases from anon, authenticated;
revoke all on table public.ebay_listing_recovery_run_items from anon, authenticated;
revoke all on table public.ebay_listing_recovery_state_transitions from anon, authenticated;
revoke all on table public.ebay_listing_recovery_diagnostics from anon, authenticated;
revoke all on table public.ebay_listing_performance_baselines from anon, authenticated;
revoke all on table public.ebay_listing_marketing_snapshots from anon, authenticated;
revoke all on table public.ebay_listing_negotiation_eligibility_snapshots from anon, authenticated;
revoke all on table public.ebay_listing_recovery_competitive_gap_reports from anon, authenticated;
revoke all on table public.ebay_listing_recovery_learning_events from anon, authenticated;

alter table public.listing_commercial_snapshots force row level security;
alter table public.ebay_commercial_improvement_executions force row level security;
revoke all on public.ebay_listing_recovery_dashboard_v1
  from public, anon, authenticated;
grant select on public.ebay_listing_recovery_dashboard_v1 to service_role;

revoke all on function
  public.reject_ebay_listing_recovery_immutable_change_v1()
  from public, anon, authenticated;
revoke all on function
  public.start_ebay_listing_recovery_shadow_run_v1(
    text, text, text, text, integer, integer
  ) from public, anon, authenticated;
revoke all on function
  public.record_ebay_listing_recovery_shadow_result_v1(
    uuid, text, uuid, text, text, text, text, integer, text,
    text, text, jsonb
  ) from public, anon, authenticated;
revoke all on function
  public.record_ebay_listing_recovery_shadow_error_v1(
    uuid, text, text, text, text
  ) from public, anon, authenticated;
revoke all on function
  public.finish_ebay_listing_recovery_shadow_run_v1(
    uuid, text, text, integer, integer, integer
  ) from public, anon, authenticated;
revoke all on function
  public.claim_commercial_improvement_execution_v2(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function
  public.mark_commercial_improvement_uncertain_v2(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function
  public.reconcile_commercial_improvement_outcome_v2(
    uuid, boolean, text, jsonb
  ) from public, anon, authenticated;

grant execute on function
  public.start_ebay_listing_recovery_shadow_run_v1(
    text, text, text, text, integer, integer
  ) to service_role;
grant execute on function
  public.record_ebay_listing_recovery_shadow_result_v1(
    uuid, text, uuid, text, text, text, text, integer, text,
    text, text, jsonb
  ) to service_role;
grant execute on function
  public.record_ebay_listing_recovery_shadow_error_v1(
    uuid, text, text, text, text
  ) to service_role;
grant execute on function
  public.finish_ebay_listing_recovery_shadow_run_v1(
    uuid, text, text, integer, integer, integer
  ) to service_role;
grant execute on function
  public.claim_commercial_improvement_execution_v2(uuid, text, integer)
  to service_role;
grant execute on function
  public.mark_commercial_improvement_uncertain_v2(uuid, uuid, text)
  to service_role;
grant execute on function
  public.reconcile_commercial_improvement_outcome_v2(
    uuid, boolean, text, jsonb
  ) to service_role;

commit;
