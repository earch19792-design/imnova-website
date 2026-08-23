-- OP-LAUNCH-I02W: durable, quota-zero daily Dollar Radar execution state.
--
-- This migration intentionally does not install or enable a scheduler. The
-- canonical scheduler remains a future Vercel Cron entry after Seller OS has
-- an approved business-timezone/hour policy. No raw market evidence is copied
-- here: the morning queue stores only bounded canonical references and derived
-- decision metadata.

create table public.seller_os_daily_dollar_radar_runs (
  run_id text primary key,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  logical_run_date date not null,
  logical_window_start timestamptz not null,
  logical_window_end timestamptz not null,
  evidence_cutoff_at timestamptz not null,
  input_digest text not null,
  output_digest text null,
  status text not null default 'RUNNING',
  attempt_count integer not null default 1,
  maximum_attempts integer not null default 3,
  worker_id text not null,
  lease_token_hash text not null,
  lease_expires_at timestamptz null,
  next_retry_at timestamptz null,
  last_error_code text null,
  queue_snapshot_id text null,
  queue_snapshot_digest text null,
  queue_entry_count integer null,
  family_input_count integer not null default 0,
  eligible_family_count integer not null default 0,
  configuration_input_count integer not null default 0,
  queue_count integer not null default 0,
  escalation_count integer not null default 0,
  radar_family_rows integer not null default 0,
  product_research_rows integer not null default 0,
  luna_variant_rows integer not null default 0,
  family_evaluation_rows integer not null default 0,
  families_evaluated integer not null default 0,
  new_families_discovered integer not null default 0,
  demand_proven_count integer not null default 0,
  demand_supported_count integer not null default 0,
  luna_match_count integer not null default 0,
  product_fit_strong_count integer not null default 0,
  economically_dead_count integer not null default 0,
  economically_recoverable_count integer not null default 0,
  economically_promising_count integer not null default 0,
  economics_unproven_count integer not null default 0,
  morning_queue_count integer not null default 0,
  needs_fresh_ebay_verification_count integer not null default 0,
  failure_stage text null,
  ebay_api_calls integer not null default 0,
  ebay_sell_calls integer not null default 0,
  ebay_marketplace_api_calls integer not null default 0,
  ebay_trading_calls integer not null default 0,
  ebay_browse_calls integer not null default 0,
  ebay_developer_analytics_calls integer not null default 0,
  marketplace_writes integer not null default 0,
  luna_network_reads integer not null default 0,
  luna_stock_reads integer not null default 0,
  luna_mutations integer not null default 0,
  p2_mutations integer not null default 0,
  t0_writes integer not null default 0,
  t1_writes integer not null default 0,
  sku_reservations integer not null default 0,
  generative_image_calls integer not null default 0,
  payments integer not null default 0,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  contract_version text not null
    default 'SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_V1',
  constraint seller_os_daily_dollar_radar_run_id_check check (
    run_id ~ '^daily-dollar-radar-run-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_daily_dollar_radar_scope_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_daily_dollar_radar_window_check check (
    logical_window_end > logical_window_start
    and logical_window_end - logical_window_start = interval '24 hours'
    and evidence_cutoff_at = logical_window_end
  ),
  constraint seller_os_daily_dollar_radar_digest_check check (
    input_digest ~ '^sha256:[0-9a-f]{64}$'
    and (output_digest is null or output_digest ~ '^sha256:[0-9a-f]{64}$')
    and (queue_snapshot_id is null or queue_snapshot_id ~
      '^morning-dollar-queue-v1:sha256:[0-9a-f]{64}$')
    and (queue_snapshot_digest is null or queue_snapshot_digest ~
      '^sha256:[0-9a-f]{64}$')
  ),
  constraint seller_os_daily_dollar_radar_status_check check (
    status in ('RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED_TERMINAL')
  ),
  constraint seller_os_daily_dollar_radar_attempt_check check (
    maximum_attempts = 3
    and attempt_count between 1 and maximum_attempts
  ),
  constraint seller_os_daily_dollar_radar_lease_check check (
    worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    and lease_token_hash ~ '^sha256:[0-9a-f]{64}$'
    and (
      (status = 'RUNNING' and lease_expires_at is not null
        and next_retry_at is null and completed_at is null and failed_at is null)
      or
      (status = 'RETRY_WAIT' and lease_expires_at is null
        and next_retry_at is not null and completed_at is null and failed_at is null)
      or
      (status = 'COMPLETED' and lease_expires_at is null
        and next_retry_at is null and completed_at is not null and failed_at is null)
      or
      (status = 'FAILED_TERMINAL' and lease_expires_at is null
        and next_retry_at is null and completed_at is null and failed_at is not null)
    )
  ),
  constraint seller_os_daily_dollar_radar_output_binding_check check (
    (status = 'COMPLETED'
      and output_digest is not null
      and queue_snapshot_id is not null
      and queue_snapshot_digest is not null
      and queue_entry_count between 0 and 5)
    or
    (status <> 'COMPLETED'
      and output_digest is null
      and queue_snapshot_id is null
      and queue_snapshot_digest is null
      and queue_entry_count is null)
  ),
  constraint seller_os_daily_dollar_radar_counter_check check (
    family_input_count between 0 and 100
    and eligible_family_count between 0 and family_input_count
    and configuration_input_count between 0 and 500
    and queue_count between 0 and 5
    and escalation_count between 0 and queue_count
    and radar_family_rows between 0 and 10000
    and product_research_rows between 0 and 100000
    and luna_variant_rows between 0 and 100000
    and family_evaluation_rows between 0 and 100000
    and families_evaluated between 0 and family_input_count
    and new_families_discovered between 0 and families_evaluated
    and demand_proven_count between 0 and families_evaluated
    and demand_supported_count between 0 and families_evaluated
    and demand_proven_count + demand_supported_count <= families_evaluated
    and luna_match_count between 0 and configuration_input_count
    and product_fit_strong_count between 0 and luna_match_count
    and economically_dead_count between 0 and configuration_input_count
    and economically_recoverable_count between 0 and configuration_input_count
    and economically_promising_count between 0 and configuration_input_count
    and economics_unproven_count between 0 and configuration_input_count
    and economically_dead_count + economically_recoverable_count
      + economically_promising_count + economics_unproven_count
      = configuration_input_count
    and morning_queue_count = queue_count
    and needs_fresh_ebay_verification_count = escalation_count
    and (
      (status = 'COMPLETED' and failure_stage = 'NONE')
      or (status in ('RETRY_WAIT', 'FAILED_TERMINAL')
        and failure_stage ~ '^[A-Z][A-Z0-9_]{2,119}$'
        and failure_stage <> 'NONE')
      or (status = 'RUNNING' and failure_stage is null)
    )
    and ebay_api_calls = 0
    and ebay_sell_calls = 0
    and ebay_marketplace_api_calls = 0
    and ebay_trading_calls = 0
    and ebay_browse_calls = 0
    and ebay_developer_analytics_calls = 0
    and marketplace_writes = 0
    and luna_network_reads = 0
    and luna_stock_reads = 0
    and luna_mutations = 0
    and p2_mutations = 0
    and t0_writes = 0
    and t1_writes = 0
    and sku_reservations = 0
    and generative_image_calls = 0
    and payments = 0
  ),
  constraint seller_os_daily_dollar_radar_contract_check check (
    contract_version = 'SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_V1'
  ),
  constraint seller_os_daily_dollar_radar_one_logical_day unique (
    account_key, marketplace_id, logical_run_date, contract_version
  ),
  constraint seller_os_daily_dollar_radar_one_logical_window unique (
    account_key, marketplace_id, logical_window_start, logical_window_end,
    contract_version
  )
);

create table public.seller_os_daily_dollar_radar_run_receipts (
  receipt_id text primary key,
  run_id text not null references
    public.seller_os_daily_dollar_radar_runs(run_id) on delete restrict,
  attempt_number integer not null,
  event_type text not null,
  input_digest text not null,
  output_digest text null,
  queue_snapshot_digest text null,
  error_code text null,
  run_status text not null,
  evidence_cutoff_at timestamptz not null,
  run_started_at timestamptz not null,
  run_completed_at timestamptz null,
  failure_stage text null,
  families_evaluated integer not null default 0,
  new_families_discovered integer not null default 0,
  demand_proven_count integer not null default 0,
  demand_supported_count integer not null default 0,
  luna_match_count integer not null default 0,
  product_fit_strong_count integer not null default 0,
  economically_dead_count integer not null default 0,
  economically_recoverable_count integer not null default 0,
  economically_promising_count integer not null default 0,
  economics_unproven_count integer not null default 0,
  morning_queue_count integer not null default 0,
  needs_fresh_ebay_verification_count integer not null default 0,
  ebay_api_calls integer not null default 0,
  ebay_sell_calls integer not null default 0,
  ebay_marketplace_api_calls integer not null default 0,
  ebay_trading_calls integer not null default 0,
  ebay_browse_calls integer not null default 0,
  ebay_developer_analytics_calls integer not null default 0,
  marketplace_writes integer not null default 0,
  luna_network_reads integer not null default 0,
  luna_stock_reads integer not null default 0,
  luna_mutations integer not null default 0,
  p2_mutations integer not null default 0,
  t0_writes integer not null default 0,
  t1_writes integer not null default 0,
  sku_reservations integer not null default 0,
  generative_image_calls integer not null default 0,
  payments integer not null default 0,
  recorded_at timestamptz not null default clock_timestamp(),
  contract_version text not null
    default 'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_RECEIPT_V1',
  constraint seller_os_daily_dollar_radar_receipt_id_check check (
    receipt_id ~ '^daily-dollar-radar-receipt-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_daily_dollar_radar_receipt_event_check check (
    event_type in (
      'CLAIMED', 'LEASE_EXPIRED', 'FAILED_RETRYABLE',
      'FAILED_TERMINAL', 'COMPLETED'
    )
  ),
  constraint seller_os_daily_dollar_radar_receipt_digest_check check (
    input_digest ~ '^sha256:[0-9a-f]{64}$'
    and (output_digest is null or output_digest ~ '^sha256:[0-9a-f]{64}$')
    and (queue_snapshot_digest is null or queue_snapshot_digest ~
      '^sha256:[0-9a-f]{64}$')
  ),
  constraint seller_os_daily_dollar_radar_receipt_counter_check check (
    attempt_number between 1 and 3
    and run_status in ('RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED_TERMINAL')
    and run_started_at <= recorded_at
    and (
      (run_status = 'COMPLETED' and run_completed_at is not null
        and failure_stage = 'NONE')
      or (run_status in ('RETRY_WAIT', 'FAILED_TERMINAL')
        and failure_stage ~ '^[A-Z][A-Z0-9_]{2,119}$'
        and failure_stage <> 'NONE')
      or (run_status = 'RUNNING' and run_completed_at is null
        and failure_stage is null)
    )
    and families_evaluated between 0 and 100
    and new_families_discovered between 0 and families_evaluated
    and demand_proven_count between 0 and families_evaluated
    and demand_supported_count between 0 and families_evaluated
    and demand_proven_count + demand_supported_count <= families_evaluated
    and luna_match_count between 0 and 500
    and product_fit_strong_count between 0 and luna_match_count
    and economically_dead_count between 0 and 500
    and economically_recoverable_count between 0 and 500
    and economically_promising_count between 0 and 500
    and economics_unproven_count between 0 and 500
    and economically_dead_count + economically_recoverable_count
      + economically_promising_count + economics_unproven_count
      between 0 and 500
    and morning_queue_count between 0 and 5
    and needs_fresh_ebay_verification_count between 0 and morning_queue_count
    and ebay_api_calls = 0
    and ebay_sell_calls = 0
    and ebay_marketplace_api_calls = 0
    and ebay_trading_calls = 0
    and ebay_browse_calls = 0
    and ebay_developer_analytics_calls = 0
    and marketplace_writes = 0
    and luna_network_reads = 0
    and luna_stock_reads = 0
    and luna_mutations = 0
    and p2_mutations = 0
    and t0_writes = 0
    and t1_writes = 0
    and sku_reservations = 0
    and generative_image_calls = 0
    and payments = 0
  ),
  constraint seller_os_daily_dollar_radar_receipt_contract_check check (
    contract_version = 'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_RECEIPT_V1'
  ),
  constraint seller_os_daily_dollar_radar_receipt_logical_event unique (
    run_id, attempt_number, event_type
  )
);

create table public.seller_os_morning_dollar_opportunity_queue_snapshots (
  snapshot_id text primary key,
  run_id text not null unique references
    public.seller_os_daily_dollar_radar_runs(run_id) on delete restrict,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  logical_run_date date not null,
  input_digest text not null,
  output_digest text not null,
  snapshot_digest text not null,
  entries jsonb not null,
  entry_count integer not null,
  ebay_api_calls integer not null default 0,
  ebay_sell_calls integer not null default 0,
  ebay_marketplace_api_calls integer not null default 0,
  ebay_trading_calls integer not null default 0,
  ebay_browse_calls integer not null default 0,
  ebay_developer_analytics_calls integer not null default 0,
  marketplace_writes integer not null default 0,
  luna_network_reads integer not null default 0,
  luna_stock_reads integer not null default 0,
  luna_mutations integer not null default 0,
  p2_mutations integer not null default 0,
  t0_writes integer not null default 0,
  t1_writes integer not null default 0,
  sku_reservations integer not null default 0,
  generative_image_calls integer not null default 0,
  payments integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  contract_version text not null
    default 'MORNING_DOLLAR_OPPORTUNITY_QUEUE_V1',
  constraint seller_os_morning_dollar_queue_snapshot_id_check check (
    snapshot_id ~ '^morning-dollar-queue-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_morning_dollar_queue_scope_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_morning_dollar_queue_digest_check check (
    input_digest ~ '^sha256:[0-9a-f]{64}$'
    and output_digest ~ '^sha256:[0-9a-f]{64}$'
    and snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_morning_dollar_queue_entries_check check (
    jsonb_typeof(entries) = 'array'
    and jsonb_array_length(entries) = entry_count
    and entry_count between 0 and 5
  ),
  constraint seller_os_morning_dollar_queue_counter_check check (
    ebay_api_calls = 0
    and ebay_sell_calls = 0
    and ebay_marketplace_api_calls = 0
    and ebay_trading_calls = 0
    and ebay_browse_calls = 0
    and ebay_developer_analytics_calls = 0
    and marketplace_writes = 0
    and luna_network_reads = 0
    and luna_stock_reads = 0
    and luna_mutations = 0
    and p2_mutations = 0
    and t0_writes = 0
    and t1_writes = 0
    and sku_reservations = 0
    and generative_image_calls = 0
    and payments = 0
  ),
  constraint seller_os_morning_dollar_queue_contract_check check (
    contract_version = 'MORNING_DOLLAR_OPPORTUNITY_QUEUE_V1'
  ),
  constraint seller_os_morning_dollar_queue_logical_day unique (
    account_key, marketplace_id, logical_run_date, contract_version
  )
);

-- Scheduler metadata is deliberately immutable and blocked. A later bounded
-- code change may add a Vercel Cron entry after the canonical business timezone
-- and UTC dispatch hour are approved. `CRON_SECRET` is a secret *name* already
-- used by the Seller OS route control plane; no secret value is stored here.
create table public.seller_os_daily_dollar_radar_scheduler_policy (
  singleton boolean primary key default true check (singleton),
  scheduler_authority text not null default 'VERCEL_CRON'
    check (scheduler_authority = 'VERCEL_CRON'),
  scheduler_enabled boolean not null default false check (not scheduler_enabled),
  policy_status text not null default 'BLOCKED_TIMEZONE_POLICY_UNPROVEN'
    check (policy_status = 'BLOCKED_TIMEZONE_POLICY_UNPROVEN'),
  business_timezone text null check (business_timezone is null),
  utc_cron_schedule text null check (utc_cron_schedule is null),
  authorization_secret_name text not null default 'CRON_SECRET'
    check (authorization_secret_name = 'CRON_SECRET'),
  dispatch_boundary text not null default 'FUTURE_VERCEL_JSON_ROUTE'
    check (dispatch_boundary = 'FUTURE_VERCEL_JSON_ROUTE'),
  policy_reference text null check (policy_reference is null),
  created_at timestamptz not null default clock_timestamp(),
  contract_version text not null
    default 'SELLER_OS_DAILY_DOLLAR_RADAR_SCHEDULER_POLICY_V1'
    check (contract_version =
      'SELLER_OS_DAILY_DOLLAR_RADAR_SCHEDULER_POLICY_V1')
);

insert into public.seller_os_daily_dollar_radar_scheduler_policy (singleton)
values (true);

create index seller_os_daily_dollar_radar_runs_status_retry_idx
  on public.seller_os_daily_dollar_radar_runs(
    account_key, marketplace_id, status, next_retry_at, lease_expires_at
  );
create index seller_os_daily_dollar_radar_receipts_run_time_idx
  on public.seller_os_daily_dollar_radar_run_receipts(
    run_id, attempt_number, recorded_at
  );
create index seller_os_morning_dollar_queue_latest_idx
  on public.seller_os_morning_dollar_opportunity_queue_snapshots(
    account_key, marketplace_id, logical_run_date desc
  );

create or replace function public.is_valid_seller_os_daily_dollar_metrics_v1(
  p_metrics jsonb
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_key text;
  v_value jsonb;
  v_required_keys constant text[] := array[
    'familyInputCount', 'eligibleFamilyCount', 'configurationInputCount',
    'queueCount', 'escalationCount', 'radarFamilyRows',
    'productResearchRows', 'lunaVariantRows', 'familyEvaluationRows',
    'familiesEvaluated', 'newFamiliesDiscovered', 'demandProvenCount',
    'demandSupportedCount', 'lunaMatchCount', 'productFitStrongCount',
    'economicallyDeadCount', 'economicallyRecoverableCount',
    'economicallyPromisingCount', 'economicsUnprovenCount',
    'morningQueueCount', 'needsFreshEbayVerificationCount', 'failureStage',
    'eBayApiCalls', 'eBaySellCalls', 'eBayMarketplaceApiCalls',
    'eBayTradingCalls',
    'eBayBrowseCalls', 'eBayDeveloperAnalyticsCalls', 'marketplaceWrites',
    'lunaNetworkReads', 'lunaStockReads', 'lunaMutations', 'p2Mutations',
    't0Writes', 't1Writes', 'skuReservations'
  ];
  v_family_count integer;
  v_eligible_count integer;
  v_configuration_count integer;
  v_queue_count integer;
  v_families_evaluated integer;
  v_luna_match_count integer;
  v_dead_count integer;
  v_recoverable_count integer;
  v_promising_count integer;
  v_unproven_count integer;
begin
  if jsonb_typeof(p_metrics) <> 'object'
    or (select count(*) from jsonb_object_keys(p_metrics)) <>
      cardinality(v_required_keys)
    or exists (
      select 1 from unnest(v_required_keys) required(key)
      where not p_metrics ? required.key
    ) then
    return false;
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_metrics) loop
    if not (v_key = any(v_required_keys)) then
      return false;
    end if;
    if v_key = 'failureStage' then
      if jsonb_typeof(v_value) <> 'string'
        or v_value #>> '{}' !~ '^[A-Z][A-Z0-9_]{2,119}$' then
        return false;
      end if;
    elsif jsonb_typeof(v_value) <> 'number'
      or v_value #>> '{}' !~ '^[0-9]+$' then
      return false;
    end if;
  end loop;

  begin
    v_family_count := (p_metrics ->> 'familyInputCount')::integer;
    v_eligible_count := (p_metrics ->> 'eligibleFamilyCount')::integer;
    v_configuration_count :=
      (p_metrics ->> 'configurationInputCount')::integer;
    v_queue_count := (p_metrics ->> 'queueCount')::integer;
    v_families_evaluated := (p_metrics ->> 'familiesEvaluated')::integer;
    v_luna_match_count := (p_metrics ->> 'lunaMatchCount')::integer;
    v_dead_count := (p_metrics ->> 'economicallyDeadCount')::integer;
    v_recoverable_count :=
      (p_metrics ->> 'economicallyRecoverableCount')::integer;
    v_promising_count :=
      (p_metrics ->> 'economicallyPromisingCount')::integer;
    v_unproven_count := (p_metrics ->> 'economicsUnprovenCount')::integer;
  exception when others then
    return false;
  end;

  return v_family_count between 0 and 100
    and v_eligible_count between 0 and v_family_count
    and v_configuration_count between 0 and 500
    and v_queue_count between 0 and 5
    and (p_metrics ->> 'escalationCount')::integer
      between 0 and v_queue_count
    and (p_metrics ->> 'radarFamilyRows')::integer between 0 and 10000
    and (p_metrics ->> 'productResearchRows')::integer between 0 and 100000
    and (p_metrics ->> 'lunaVariantRows')::integer between 0 and 100000
    and (p_metrics ->> 'familyEvaluationRows')::integer between 0 and 100000
    and v_families_evaluated between 0 and v_family_count
    and (p_metrics ->> 'newFamiliesDiscovered')::integer
      between 0 and v_families_evaluated
    and (p_metrics ->> 'demandProvenCount')::integer
      between 0 and v_families_evaluated
    and (p_metrics ->> 'demandSupportedCount')::integer
      between 0 and v_families_evaluated
    and (p_metrics ->> 'demandProvenCount')::integer
      + (p_metrics ->> 'demandSupportedCount')::integer
      <= v_families_evaluated
    and v_luna_match_count between 0 and v_configuration_count
    and (p_metrics ->> 'productFitStrongCount')::integer
      between 0 and v_luna_match_count
    and v_dead_count between 0 and v_configuration_count
    and v_recoverable_count between 0 and v_configuration_count
    and v_promising_count between 0 and v_configuration_count
    and v_unproven_count between 0 and v_configuration_count
    and v_dead_count + v_recoverable_count + v_promising_count
      + v_unproven_count = v_configuration_count
    and (p_metrics ->> 'morningQueueCount')::integer = v_queue_count
    and (p_metrics ->> 'needsFreshEbayVerificationCount')::integer =
      (p_metrics ->> 'escalationCount')::integer
    and (p_metrics ->> 'needsFreshEbayVerificationCount')::integer
      between 0 and v_queue_count
    and (p_metrics ->> 'eBayApiCalls')::integer = 0
    and (p_metrics ->> 'eBaySellCalls')::integer = 0
    and (p_metrics ->> 'eBayMarketplaceApiCalls')::integer = 0
    and (p_metrics ->> 'eBayTradingCalls')::integer = 0
    and (p_metrics ->> 'eBayBrowseCalls')::integer = 0
    and (p_metrics ->> 'eBayDeveloperAnalyticsCalls')::integer = 0
    and (p_metrics ->> 'marketplaceWrites')::integer = 0
    and (p_metrics ->> 'lunaNetworkReads')::integer = 0
    and (p_metrics ->> 'lunaStockReads')::integer = 0
    and (p_metrics ->> 'lunaMutations')::integer = 0
    and (p_metrics ->> 'p2Mutations')::integer = 0
    and (p_metrics ->> 't0Writes')::integer = 0
    and (p_metrics ->> 't1Writes')::integer = 0
    and (p_metrics ->> 'skuReservations')::integer = 0;
exception when others then
  return false;
end;
$function$;

create or replace function public.is_valid_seller_os_daily_dollar_text_array_v1(
  p_value jsonb,
  p_minimum integer,
  p_maximum integer,
  p_code_only boolean,
  p_sorted_unique boolean
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_value) <> 'array'
    or jsonb_array_length(p_value) not between p_minimum and p_maximum
    or p_minimum < 0 or p_maximum < p_minimum or p_maximum > 64 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) <> 'string'
      or length(v_item #>> '{}') not between 1 and 240
      or (v_item #>> '{}') ~ '[[:cntrl:]]'
      or (p_code_only
        and (v_item #>> '{}') !~ '^[A-Z][A-Z0-9_]{2,119}$') then
      return false;
    end if;
  end loop;

  if p_sorted_unique and exists (
    select 1
    from jsonb_array_elements_text(p_value) item(value) cross join lateral (
      select count(*) as occurrences
      from jsonb_array_elements_text(p_value) repeated(value)
      where repeated.value = item.value
    ) duplicates
    where duplicates.occurrences <> 1
  ) then
    return false;
  end if;
  if p_sorted_unique and exists (
    select 1
    from jsonb_array_elements_text(p_value)
      with ordinality item(value, ordinality)
    join jsonb_array_elements_text(p_value)
      with ordinality prior(value, ordinality)
      on prior.ordinality < item.ordinality
    where prior.value >= item.value collate "C"
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.is_valid_seller_os_daily_dollar_number_v1(
  p_value jsonb,
  p_nullable boolean
)
returns boolean
language sql immutable security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select case
    when p_value = 'null'::jsonb then p_nullable
    else jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
  end;
$function$;

create or replace function public.is_valid_seller_os_daily_dollar_profile_attributes_v1(
  p_attributes jsonb
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_attribute jsonb;
begin
  if jsonb_typeof(p_attributes) <> 'array'
    or jsonb_array_length(p_attributes) > 64 then
    return false;
  end if;
  for v_attribute in select value from jsonb_array_elements(p_attributes) loop
    if jsonb_typeof(v_attribute) <> 'object'
      or (select count(*) from jsonb_object_keys(v_attribute)) <> 8
      or not (v_attribute ?& array[
        'key', 'expectedValue', 'attributeClassification', 'matchMode',
        'componentIdentityId', 'authorityClass', 'evidenceReference',
        'evidenceDigest'
      ])
      or coalesce(v_attribute ->> 'key', '') !~
        '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
      or jsonb_typeof(v_attribute -> 'expectedValue') <> 'string'
      or length(v_attribute ->> 'expectedValue') not between 1 and 240
      or v_attribute ->> 'expectedValue' ~ '[[:cntrl:]]'
      or v_attribute ->> 'attributeClassification' not in (
        'PROVEN_ATTRIBUTE', 'SUPPORTED_ATTRIBUTE',
        'INFERRED_ATTRIBUTE', 'UNPROVEN_ATTRIBUTE'
      )
      or v_attribute ->> 'matchMode' not in (
        'EXACT_NORMALIZED', 'TOKEN_SUBSET', 'NUMERIC_EXACT'
      )
      or not (
        v_attribute -> 'componentIdentityId' = 'null'::jsonb
        or (
          jsonb_typeof(v_attribute -> 'componentIdentityId') = 'string'
          and length(v_attribute ->> 'componentIdentityId') between 1 and 240
          and v_attribute ->> 'componentIdentityId' ~
            '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
        )
      )
      or v_attribute ->> 'authorityClass' not in (
        'OFFICIAL_EXTERNAL_FACT', 'DIRECT_OBSERVATION',
        'DURABLY_PERSISTED_FACT', 'DERIVED_FACT', 'INFERENCE', 'UNPROVEN'
      )
      or jsonb_typeof(v_attribute -> 'evidenceReference') <> 'string'
      or length(v_attribute ->> 'evidenceReference') not between 1 and 300
      or v_attribute ->> 'evidenceReference' ~ '[[:cntrl:]]'
      or coalesce(v_attribute ->> 'evidenceDigest', '') !~
        '^sha256:[0-9a-f]{64}$' then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.is_valid_seller_os_morning_dollar_queue_v1(
  p_entries jsonb
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_entry jsonb;
  v_rank integer;
  v_seen_ranks integer[] := '{}';
  v_allowed_keys constant text[] := array[
    'queueEntryId', 'rank', 'dollarPriorityRank', 'familyId', 'familyName',
    'opportunityCaseId',
    'currentMarketObservationId', 'demandStatus', 'demandEvidenceSummary',
    'candidateId', 'configurationId', 'lunaProductId', 'lunaVariantId',
    'topLunaProductId', 'topLunaVariantId', 'lunaSku',
    'exactProductVariantIdentity', 'productFit', 'competitionStatus',
    'targetProfileDigest', 'targetProductProfileSummary',
    'economicClassification', 'dollarPriorityScore', 'nextBestEvidence',
    'nextAction', 'nextBestAction', 'nextEvidenceValue',
    'buyerIntent', 'buyerIntentTerms', 'primaryKeyword', 'primaryKeywords',
    'secondaryKeywords', 'contributionPathSummary',
    'currentHardBlockers', 'hardBlockers', 'shipping', 'researchStatus',
    'ebayEscalationRequired', 'needsFreshEbayVerification',
    'ebayVerificationReason', 'ebayVerificationPriority',
    'ebayVerificationExpectedDecisionValue', 'ebayEscalationId',
    'executionRoute', 'frontierDigest', 'frontierInterpretation', 'reasonCodes',
    'listingAuthorized', 'marketplaceWriteAllowed', 'p2MutationAllowed'
  ];
begin
  if jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) > 5 then
    return false;
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_entry) supplied(key)
        where not supplied.key = any(v_allowed_keys)
      )
      or not (v_entry ?& array[
        'queueEntryId', 'rank', 'dollarPriorityRank', 'familyId', 'familyName',
        'opportunityCaseId', 'currentMarketObservationId', 'demandStatus',
        'demandEvidenceSummary', 'candidateId', 'configurationId',
        'lunaProductId', 'lunaVariantId', 'topLunaProductId',
        'topLunaVariantId', 'lunaSku', 'exactProductVariantIdentity',
        'productFit', 'competitionStatus', 'targetProfileDigest',
        'targetProductProfileSummary',
        'economicClassification', 'dollarPriorityScore',
        'nextBestEvidence', 'nextAction', 'nextBestAction', 'nextEvidenceValue',
        'buyerIntent', 'buyerIntentTerms', 'primaryKeyword', 'primaryKeywords',
        'secondaryKeywords', 'contributionPathSummary',
        'currentHardBlockers', 'hardBlockers', 'shipping', 'researchStatus',
        'ebayEscalationRequired', 'needsFreshEbayVerification',
        'ebayVerificationReason', 'ebayVerificationPriority',
        'ebayVerificationExpectedDecisionValue', 'ebayEscalationId',
        'executionRoute', 'frontierDigest', 'frontierInterpretation',
        'reasonCodes', 'listingAuthorized', 'marketplaceWriteAllowed',
        'p2MutationAllowed'
      ])
      or coalesce(v_entry ->> 'queueEntryId', '') !~
        '^morning-dollar-queue-entry-v1:sha256:[0-9a-f]{64}$'
      or v_entry ->> 'queueEntryId' <>
        'morning-dollar-queue-entry-v1:sha256:' || encode(
          extensions.digest(convert_to(concat(
            'SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1', E'\n',
            v_entry ->> 'familyId', E'\n',
            v_entry ->> 'configurationId', E'\n',
            v_entry ->> 'frontierDigest'
          ), 'UTF8'), 'sha256'), 'hex'
        )
      or jsonb_typeof(v_entry -> 'rank') <> 'number'
      or v_entry ->> 'rank' !~ '^[1-5]$'
      or jsonb_typeof(v_entry -> 'dollarPriorityRank') <> 'number'
      or v_entry ->> 'dollarPriorityRank' <> v_entry ->> 'rank'
      or coalesce(v_entry ->> 'familyId', '') !~
        '^market-family-v1:sha256:[0-9a-f]{64}$'
      or length(coalesce(v_entry ->> 'familyName', '')) not between 1 and 160
      or v_entry ->> 'familyName' ~ '[[:cntrl:]]'
      or coalesce(v_entry ->> 'opportunityCaseId', '') !~
        '^opportunity-case-v1:sha256:[0-9a-f]{64}$'
      or coalesce(v_entry ->> 'currentMarketObservationId', '') !~
        '^family-market-observation-v1:sha256:[0-9a-f]{64}$'
      or v_entry ->> 'demandStatus' not in (
        'FAMILY_DEMAND_PROVEN', 'FAMILY_DEMAND_SUPPORTED'
      )
      or jsonb_typeof(v_entry -> 'demandEvidenceSummary') <> 'object'
      or (select count(*) from jsonb_object_keys(
        v_entry -> 'demandEvidenceSummary')) <> 7
      or not ((v_entry -> 'demandEvidenceSummary') ?& array[
        'demandEvidenceClass', 'soldComparableCount', 'soldQuantityEvidence',
        'priceMedianUsd', 'limitations', 'evidenceReference', 'evidenceDigest'
      ])
      or v_entry #>> '{demandEvidenceSummary,demandEvidenceClass}' not in (
        'OFFICIAL_SOLD_EVIDENCE', 'DIRECT_MARKET_OBSERVATION',
        'DERIVED_NON_SALES_SIGNAL', 'UNPROVEN'
      )
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{demandEvidenceSummary,soldComparableCount}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{demandEvidenceSummary,soldQuantityEvidence}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{demandEvidenceSummary,priceMedianUsd}', true)
      or (
        v_entry #> '{demandEvidenceSummary,soldComparableCount}' <> 'null'::jsonb
        and v_entry #>> '{demandEvidenceSummary,soldComparableCount}' !~
          '^[0-9]+$'
      )
      or (
        v_entry #> '{demandEvidenceSummary,soldQuantityEvidence}' <> 'null'::jsonb
        and v_entry #>> '{demandEvidenceSummary,soldQuantityEvidence}' !~
          '^[0-9]+$'
      )
      or coalesce((v_entry #>> '{demandEvidenceSummary,priceMedianUsd}')::numeric
        < 0, false)
      or not public.is_valid_seller_os_daily_dollar_text_array_v1(
        v_entry #> '{demandEvidenceSummary,limitations}', 0, 20, false, true)
      or v_entry #>> '{demandEvidenceSummary,evidenceReference}' <>
        v_entry ->> 'currentMarketObservationId'
      or coalesce(v_entry #>> '{demandEvidenceSummary,evidenceDigest}', '') !~
        '^sha256:[0-9a-f]{64}$'
      or (
        v_entry ->> 'demandStatus' = 'FAMILY_DEMAND_PROVEN' and (
          v_entry #>> '{demandEvidenceSummary,demandEvidenceClass}' <>
            'OFFICIAL_SOLD_EVIDENCE'
          or coalesce((v_entry #>>
            '{demandEvidenceSummary,soldComparableCount}')::integer, 0) < 1
          or coalesce((v_entry #>>
            '{demandEvidenceSummary,soldQuantityEvidence}')::integer, 0) < 1
        )
      )
      or coalesce(v_entry ->> 'configurationId', '') !~
        '^launch-configuration-v1:sha256:[0-9a-f]{64}$'
      or coalesce(v_entry ->> 'candidateId', '') !~
        '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
      or coalesce(v_entry ->> 'lunaProductId', '') !~ '^[0-9]{1,30}$'
      or coalesce(v_entry ->> 'lunaVariantId', '') !~ '^[0-9]{1,30}$'
      or v_entry ->> 'topLunaProductId' <> v_entry ->> 'lunaProductId'
      or v_entry ->> 'topLunaVariantId' <> v_entry ->> 'lunaVariantId'
      or jsonb_typeof(v_entry -> 'lunaSku') <> 'string'
      or length(v_entry ->> 'lunaSku') not between 1 and 160
      or v_entry ->> 'lunaSku' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
      or coalesce(v_entry ->> 'targetProfileDigest', '') !~
        '^sha256:[0-9a-f]{64}$'
      or v_entry -> 'exactProductVariantIdentity' <> 'true'::jsonb
      or v_entry ->> 'productFit' <> 'STRONG'
      or v_entry ->> 'competitionStatus' not in (
        'FAVORABLE', 'ACCEPTABLE', 'DIFFICULT', 'UNPROVEN'
      )
      or jsonb_typeof(v_entry -> 'targetProductProfileSummary') <> 'object'
      or (select count(*) from jsonb_object_keys(
        v_entry -> 'targetProductProfileSummary')) <> 5
      or not ((v_entry -> 'targetProductProfileSummary') ?& array[
        'contractVersion', 'profileDigest', 'authority',
        'requiredAttributes', 'preferredAttributes'
      ])
      or v_entry #>> '{targetProductProfileSummary,contractVersion}' <>
        'SELLER_OS_TARGET_PRODUCT_PROFILE_WITH_AUTHORITY_V1'
      or v_entry #>> '{targetProductProfileSummary,profileDigest}' <>
        v_entry ->> 'targetProfileDigest'
      or v_entry #>> '{targetProductProfileSummary,authority}' <>
        'SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION'
      or not public.is_valid_seller_os_daily_dollar_profile_attributes_v1(
        v_entry #> '{targetProductProfileSummary,requiredAttributes}')
      or not public.is_valid_seller_os_daily_dollar_profile_attributes_v1(
        v_entry #> '{targetProductProfileSummary,preferredAttributes}')
      or jsonb_array_length(
        v_entry #> '{targetProductProfileSummary,requiredAttributes}')
        + jsonb_array_length(
          v_entry #> '{targetProductProfileSummary,preferredAttributes}')
        not between 1 and 64
      or v_entry ->> 'economicClassification' not in (
        'ECONOMICALLY_RECOVERABLE', 'ECONOMICALLY_PROMISING',
        'ECONOMICS_UNPROVEN'
      )
      or jsonb_typeof(v_entry -> 'dollarPriorityScore') <> 'number'
      or (v_entry ->> 'dollarPriorityScore')::numeric not between 0 and 100
      or v_entry ->> 'nextBestEvidence' not in (
        'ACTUAL_LUNA_SHIPPING', 'BETTER_PRICE_DISTRIBUTION',
        'CURRENT_EBAY_COMPETITION', 'EXACT_SUBTYPE_DEMAND',
        'COMPLIANCE', 'LUNA_COST_CONFIRMATION'
      )
      or v_entry ->> 'nextAction' <> v_entry ->> 'nextBestEvidence'
      or v_entry ->> 'nextBestAction' <> v_entry ->> 'nextBestEvidence'
      or v_entry ->> 'nextEvidenceValue' not in (
        'HIGH', 'MEDIUM', 'LOW', 'NEAR_ZERO'
      )
      or not public.is_valid_seller_os_daily_dollar_text_array_v1(
        v_entry -> 'buyerIntent', 0, 64, false, false)
      or v_entry -> 'buyerIntent' <> v_entry -> 'buyerIntentTerms'
      or not public.is_valid_seller_os_daily_dollar_text_array_v1(
        v_entry -> 'primaryKeywords', 1, 16, false, false)
      or not public.is_valid_seller_os_daily_dollar_text_array_v1(
        v_entry -> 'secondaryKeywords', 0, 64, false, false)
      or jsonb_typeof(v_entry -> 'primaryKeyword') <> 'string'
      or v_entry ->> 'primaryKeyword' <>
        v_entry #>> '{primaryKeywords,0}'
      or jsonb_typeof(v_entry -> 'contributionPathSummary') <> 'object'
      or (select count(*) from jsonb_object_keys(
        v_entry -> 'contributionPathSummary')) <> 10
      or not ((v_entry -> 'contributionPathSummary') ?& array[
        'marketPriceMedianUsd', 'totalProductCostUsd', 'shippingStatus',
        'provisionalShippingReserveUsd', 'contributionProfitAtMarketMedianUsd',
        'contributionMarginAtMarketMedianPercent',
        'maxShippingAtTargetMarginUsd', 'minSellingPriceAtTargetMarginUsd',
        'strongRecoverablePath', 'authority'
      ])
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,marketPriceMedianUsd}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,totalProductCostUsd}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,provisionalShippingReserveUsd}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,contributionProfitAtMarketMedianUsd}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,contributionMarginAtMarketMedianPercent}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,maxShippingAtTargetMarginUsd}', true)
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{contributionPathSummary,minSellingPriceAtTargetMarginUsd}', true)
      or v_entry #>> '{contributionPathSummary,shippingStatus}' not in (
        'SHIPPING_OBSERVED', 'SHIPPING_DURABLY_PERSISTED',
        'SHIPPING_PROVISIONAL_RESERVE', 'SHIPPING_UNPROVEN'
      )
      or jsonb_typeof(v_entry #> '{contributionPathSummary,strongRecoverablePath}')
        <> 'boolean'
      or v_entry #>> '{contributionPathSummary,authority}' <>
        'CANONICAL_I02V_FRONTIER_PASSTHROUGH'
      or not public.is_valid_seller_os_daily_dollar_text_array_v1(
        v_entry -> 'currentHardBlockers', 0, 32, true, true)
      or v_entry -> 'hardBlockers' <> v_entry -> 'currentHardBlockers'
      or v_entry -> 'reasonCodes' <> v_entry -> 'currentHardBlockers'
      or jsonb_typeof(v_entry -> 'shipping') <> 'object'
      or (select count(*) from jsonb_object_keys(v_entry -> 'shipping')) <> 3
      or not ((v_entry -> 'shipping') ?& array[
        'status', 'provisionalReserveUsd',
        'provisionalReserveClaimedAsObserved'
      ])
      or v_entry #>> '{shipping,status}' <>
        v_entry #>> '{contributionPathSummary,shippingStatus}'
      or not public.is_valid_seller_os_daily_dollar_number_v1(
        v_entry #> '{shipping,provisionalReserveUsd}', true)
      or v_entry #> '{shipping,provisionalReserveUsd}' is distinct from
        v_entry #> '{contributionPathSummary,provisionalShippingReserveUsd}'
      or v_entry #> '{shipping,provisionalReserveClaimedAsObserved}' <>
        'false'::jsonb
      or v_entry ->> 'researchStatus' <>
        'READY_FOR_BOUNDED_EVIDENCE_ACQUISITION'
      or jsonb_typeof(v_entry -> 'ebayEscalationRequired') <> 'boolean'
      or v_entry -> 'ebayEscalationRequired' <>
        v_entry -> 'needsFreshEbayVerification'
      or (
        v_entry -> 'needsFreshEbayVerification' = 'true'::jsonb and (
          v_entry ->> 'nextBestEvidence' not in (
            'BETTER_PRICE_DISTRIBUTION', 'CURRENT_EBAY_COMPETITION',
            'EXACT_SUBTYPE_DEMAND'
          )
          or v_entry ->> 'ebayVerificationReason' <>
            v_entry ->> 'nextBestEvidence'
          or v_entry ->> 'ebayVerificationPriority' <>
            v_entry ->> 'nextEvidenceValue'
          or v_entry ->> 'ebayVerificationExpectedDecisionValue' <>
            v_entry ->> 'nextEvidenceValue'
          or coalesce(v_entry ->> 'ebayEscalationId', '') !~
            '^ebay-read-escalation-v1:sha256:[0-9a-f]{64}$'
        )
      )
      or (
        v_entry -> 'needsFreshEbayVerification' = 'false'::jsonb and not (
          v_entry -> 'ebayVerificationReason' = 'null'::jsonb
          and v_entry -> 'ebayVerificationPriority' = 'null'::jsonb
          and v_entry -> 'ebayVerificationExpectedDecisionValue' = 'null'::jsonb
          and v_entry -> 'ebayEscalationId' = 'null'::jsonb
        )
      )
      or v_entry ->> 'executionRoute' not in (
        'BOUNDED_EBAY_EVIDENCE_ESCALATION', 'DURABLE_EVIDENCE_ONLY'
      )
      or v_entry ->> 'executionRoute' <> (
        case
          when v_entry -> 'needsFreshEbayVerification' = 'true'::jsonb
            then 'BOUNDED_EBAY_EVIDENCE_ESCALATION'
          else 'DURABLE_EVIDENCE_ONLY'
        end
      )
      or coalesce(v_entry ->> 'frontierDigest', '') !~
        '^sha256:[0-9a-f]{64}$'
      or v_entry ->> 'frontierInterpretation' <> 'PASSTHROUGH_I02V'
      or jsonb_typeof(v_entry -> 'reasonCodes') <> 'array'
      or jsonb_array_length(v_entry -> 'reasonCodes') > 20
      or exists (
        select 1
        from jsonb_array_elements_text(v_entry -> 'reasonCodes')
          with ordinality reason(value, ordinality)
        where reason.value !~ '^[A-Z][A-Z0-9_]{2,119}$'
          or exists (
            select 1
            from jsonb_array_elements_text(v_entry -> 'reasonCodes')
              with ordinality prior(value, ordinality)
            where prior.ordinality < reason.ordinality
              and prior.value >= reason.value collate "C"
          )
      )
      or v_entry -> 'listingAuthorized' <> 'false'::jsonb
      or v_entry -> 'marketplaceWriteAllowed' <> 'false'::jsonb
      or v_entry -> 'p2MutationAllowed' <> 'false'::jsonb then
      return false;
    end if;

    v_rank := (v_entry ->> 'rank')::integer;
    if v_rank = any(v_seen_ranks) then
      return false;
    end if;
    v_seen_ranks := array_append(v_seen_ranks, v_rank);
  end loop;

  if cardinality(v_seen_ranks) > 0 and (
    (select min(value) from unnest(v_seen_ranks) ranked(value)) <> 1
    or (select max(value) from unnest(v_seen_ranks) ranked(value)) <>
      cardinality(v_seen_ranks)
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.append_seller_os_daily_dollar_run_receipt_v1(
  p_run_id text,
  p_event_type text,
  p_error_code text,
  p_recorded_at timestamptz
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_run public.seller_os_daily_dollar_radar_runs%rowtype;
  v_receipt_id text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_event_type not in (
      'CLAIMED', 'LEASE_EXPIRED', 'FAILED_RETRYABLE',
      'FAILED_TERMINAL', 'COMPLETED'
    )
    or p_recorded_at is distinct from date_trunc('milliseconds', p_recorded_at)
    or (p_error_code is not null
      and p_error_code !~ '^[A-Z0-9_]{3,100}$') then
    raise exception 'SELLER_OS_DAILY_DOLLAR_RECEIPT_INPUT_INVALID';
  end if;

  select * into strict v_run
  from public.seller_os_daily_dollar_radar_runs
  where run_id = p_run_id;
  v_receipt_id := 'daily-dollar-radar-receipt-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_RECEIPT_V1', E'\n',
      v_run.run_id, E'\n', v_run.attempt_count::text, E'\n', p_event_type
    ), 'UTF8'), 'sha256'), 'hex');

  insert into public.seller_os_daily_dollar_radar_run_receipts (
    receipt_id, run_id, attempt_number, event_type, input_digest,
    output_digest, queue_snapshot_digest, error_code, run_status,
    evidence_cutoff_at, run_started_at, run_completed_at, failure_stage,
    families_evaluated, new_families_discovered, demand_proven_count,
    demand_supported_count, luna_match_count, product_fit_strong_count,
    economically_dead_count, economically_recoverable_count,
    economically_promising_count, economics_unproven_count,
    morning_queue_count, needs_fresh_ebay_verification_count,
    ebay_api_calls, ebay_sell_calls, ebay_marketplace_api_calls,
    ebay_trading_calls, ebay_browse_calls, ebay_developer_analytics_calls,
    marketplace_writes, luna_network_reads, luna_stock_reads, luna_mutations,
    p2_mutations, t0_writes, t1_writes, sku_reservations,
    generative_image_calls, payments, recorded_at
  ) values (
    v_receipt_id, v_run.run_id, v_run.attempt_count, p_event_type,
    v_run.input_digest, v_run.output_digest, v_run.queue_snapshot_digest,
    p_error_code, v_run.status, v_run.evidence_cutoff_at, v_run.started_at,
    v_run.completed_at, v_run.failure_stage, v_run.families_evaluated,
    v_run.new_families_discovered, v_run.demand_proven_count,
    v_run.demand_supported_count, v_run.luna_match_count,
    v_run.product_fit_strong_count, v_run.economically_dead_count,
    v_run.economically_recoverable_count, v_run.economically_promising_count,
    v_run.economics_unproven_count, v_run.morning_queue_count,
    v_run.needs_fresh_ebay_verification_count, v_run.ebay_api_calls,
    v_run.ebay_sell_calls, v_run.ebay_marketplace_api_calls,
    v_run.ebay_trading_calls, v_run.ebay_browse_calls,
    v_run.ebay_developer_analytics_calls, v_run.marketplace_writes,
    v_run.luna_network_reads, v_run.luna_stock_reads, v_run.luna_mutations,
    v_run.p2_mutations, v_run.t0_writes, v_run.t1_writes,
    v_run.sku_reservations, v_run.generative_image_calls, v_run.payments,
    p_recorded_at
  ) on conflict (run_id, attempt_number, event_type) do nothing;
end;
$function$;

create or replace function public.reject_seller_os_daily_dollar_append_mutation_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'SELLER_OS_DAILY_DOLLAR_APPEND_ONLY';
end;
$function$;

create trigger seller_os_daily_dollar_receipts_append_only
before update or delete
on public.seller_os_daily_dollar_radar_run_receipts
for each row execute function
  public.reject_seller_os_daily_dollar_append_mutation_v1();

create trigger seller_os_morning_dollar_queue_append_only
before update or delete
on public.seller_os_morning_dollar_opportunity_queue_snapshots
for each row execute function
  public.reject_seller_os_daily_dollar_append_mutation_v1();

create trigger seller_os_daily_dollar_scheduler_policy_immutable
before update or delete
on public.seller_os_daily_dollar_radar_scheduler_policy
for each row execute function
  public.reject_seller_os_daily_dollar_append_mutation_v1();

create or replace function public.claim_seller_os_daily_dollar_radar_run_v1(
  p_account_key text,
  p_marketplace_id text,
  p_logical_window_start timestamptz,
  p_logical_window_end timestamptz,
  p_evidence_cutoff_at timestamptz,
  p_worker_id text,
  p_input_digest text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_account_key text := trim(coalesce(p_account_key, ''));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_logical_date date;
  v_run_id text;
  v_lease_token text;
  v_lease_token_hash text;
  v_run public.seller_os_daily_dollar_radar_runs%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or v_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or coalesce(p_input_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or p_logical_window_start is distinct from
      date_trunc('milliseconds', p_logical_window_start)
    or p_logical_window_end is distinct from
      date_trunc('milliseconds', p_logical_window_end)
    or p_evidence_cutoff_at is distinct from
      date_trunc('milliseconds', p_evidence_cutoff_at)
    or p_logical_window_end - p_logical_window_start <> interval '24 hours'
    or p_evidence_cutoff_at <> p_logical_window_end
    or p_lease_seconds not between 60 and 900 then
    raise exception 'SELLER_OS_DAILY_DOLLAR_RUN_INPUT_INVALID';
  end if;

  v_logical_date := (p_logical_window_start at time zone 'UTC')::date;
  v_run_id := 'daily-dollar-radar-run-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_ID_V1', E'\n',
      v_account_key, E'\n', p_marketplace_id, E'\n',
      to_char(p_logical_window_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS'), E'Z\n',
      to_char(p_logical_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS'), 'Z'
    ), 'UTF8'), 'sha256'), 'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_V1:', v_account_key, ':',
    p_marketplace_id, ':', v_logical_date::text
  ), 0));

  select * into v_run
  from public.seller_os_daily_dollar_radar_runs
  where account_key = v_account_key
    and marketplace_id = p_marketplace_id
    and logical_run_date = v_logical_date
    and contract_version = 'SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_V1'
  for update;

  if found and (
    v_run.run_id <> v_run_id
    or v_run.logical_window_start <> p_logical_window_start
    or v_run.logical_window_end <> p_logical_window_end
    or v_run.evidence_cutoff_at <> p_evidence_cutoff_at
    or v_run.input_digest <> p_input_digest
  ) then
    raise exception 'SELLER_OS_DAILY_DOLLAR_LOGICAL_RUN_CONFLICT';
  end if;

  if found and v_run.status = 'COMPLETED' then
    return jsonb_build_object(
      'outcome', 'IDEMPOTENT_COMPLETED',
      'runId', v_run.run_id,
      'status', v_run.status,
      'attemptCount', v_run.attempt_count,
      'leaseToken', null,
      'queueSnapshotId', v_run.queue_snapshot_id,
      'inputDigest', v_run.input_digest,
      'outputDigest', v_run.output_digest
    );
  end if;

  if found and v_run.status = 'FAILED_TERMINAL' then
    return jsonb_build_object(
      'outcome', 'TERMINAL_FAILURE', 'runId', v_run.run_id,
      'status', v_run.status, 'attemptCount', v_run.attempt_count,
      'leaseToken', null, 'lastErrorCode', v_run.last_error_code
    );
  end if;

  if found and v_run.status = 'RUNNING'
    and v_run.lease_expires_at > v_now then
    return jsonb_build_object(
      'outcome', 'LEASE_HELD', 'runId', v_run.run_id,
      'status', v_run.status, 'attemptCount', v_run.attempt_count,
      'leaseToken', null, 'leaseExpiresAt', v_run.lease_expires_at
    );
  end if;

  if found and v_run.status = 'RETRY_WAIT'
    and v_run.next_retry_at > v_now then
    return jsonb_build_object(
      'outcome', 'RETRY_NOT_DUE', 'runId', v_run.run_id,
      'status', v_run.status, 'attemptCount', v_run.attempt_count,
      'leaseToken', null, 'nextRetryAt', v_run.next_retry_at
    );
  end if;

  if found and v_run.status = 'RUNNING' then
    perform public.append_seller_os_daily_dollar_run_receipt_v1(
      v_run.run_id, 'LEASE_EXPIRED', 'LEASE_EXPIRED', v_now
    );
  end if;

  if found and v_run.attempt_count >= v_run.maximum_attempts then
    update public.seller_os_daily_dollar_radar_runs
    set status = 'FAILED_TERMINAL', lease_expires_at = null,
        next_retry_at = null, last_error_code = 'MAXIMUM_ATTEMPTS_EXHAUSTED',
        failure_stage = 'LEASE_CONTROL',
        failed_at = v_now, updated_at = v_now
    where run_id = v_run.run_id
    returning * into v_run;

    perform public.append_seller_os_daily_dollar_run_receipt_v1(
      v_run.run_id, 'FAILED_TERMINAL', v_run.last_error_code, v_now
    );

    return jsonb_build_object(
      'outcome', 'TERMINAL_FAILURE', 'runId', v_run.run_id,
      'status', v_run.status, 'attemptCount', v_run.attempt_count,
      'leaseToken', null, 'lastErrorCode', v_run.last_error_code
    );
  end if;

  v_lease_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_lease_token_hash := 'sha256:' || encode(extensions.digest(
    convert_to(v_lease_token, 'UTF8'), 'sha256'), 'hex');

  if not found then
    insert into public.seller_os_daily_dollar_radar_runs (
      run_id, account_key, marketplace_id, logical_run_date,
      logical_window_start, logical_window_end, evidence_cutoff_at,
      input_digest, status, attempt_count, worker_id, lease_token_hash,
      lease_expires_at, started_at, created_at, updated_at
    ) values (
      v_run_id, v_account_key, p_marketplace_id, v_logical_date,
      p_logical_window_start, p_logical_window_end, p_evidence_cutoff_at,
      p_input_digest, 'RUNNING', 1, v_worker_id, v_lease_token_hash,
      v_now + make_interval(secs => p_lease_seconds), v_now, v_now, v_now
    ) returning * into v_run;
  else
    update public.seller_os_daily_dollar_radar_runs
    set status = 'RUNNING',
        attempt_count = attempt_count + 1,
        worker_id = v_worker_id,
        lease_token_hash = v_lease_token_hash,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        next_retry_at = null,
        last_error_code = null,
        family_input_count = 0,
        eligible_family_count = 0,
        configuration_input_count = 0,
        queue_count = 0,
        escalation_count = 0,
        radar_family_rows = 0,
        product_research_rows = 0,
        luna_variant_rows = 0,
        family_evaluation_rows = 0,
        families_evaluated = 0,
        new_families_discovered = 0,
        demand_proven_count = 0,
        demand_supported_count = 0,
        luna_match_count = 0,
        product_fit_strong_count = 0,
        economically_dead_count = 0,
        economically_recoverable_count = 0,
        economically_promising_count = 0,
        economics_unproven_count = 0,
        morning_queue_count = 0,
        needs_fresh_ebay_verification_count = 0,
        failure_stage = null,
        failed_at = null,
        updated_at = v_now
    where run_id = v_run.run_id
    returning * into v_run;
  end if;

  perform public.append_seller_os_daily_dollar_run_receipt_v1(
    v_run.run_id, 'CLAIMED', null, v_now
  );

  return jsonb_build_object(
    'outcome', 'CLAIMED', 'runId', v_run.run_id,
    'status', v_run.status, 'attemptCount', v_run.attempt_count,
    'maximumAttempts', v_run.maximum_attempts,
    'leaseToken', v_lease_token, 'leaseExpiresAt', v_run.lease_expires_at,
    'inputDigest', v_run.input_digest
  );
end;
$function$;

create or replace function public.complete_seller_os_daily_dollar_radar_run_v1(
  p_run_id text,
  p_lease_token text,
  p_input_digest text,
  p_output_digest text,
  p_entries jsonb,
  p_metrics jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_token_hash text;
  v_entries jsonb;
  v_snapshot_id text;
  v_snapshot_digest text;
  v_run public.seller_os_daily_dollar_radar_runs%rowtype;
  v_snapshot public.seller_os_morning_dollar_opportunity_queue_snapshots%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_run_id, '') !~
      '^daily-dollar-radar-run-v1:sha256:[0-9a-f]{64}$'
    or length(coalesce(p_lease_token, '')) not between 32 and 256
    or coalesce(p_input_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_output_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or not public.is_valid_seller_os_daily_dollar_metrics_v1(p_metrics)
    or not public.is_valid_seller_os_morning_dollar_queue_v1(p_entries)
    or (p_metrics ->> 'queueCount')::integer <>
      jsonb_array_length(p_entries)
    or p_metrics ->> 'failureStage' <> 'NONE' then
    raise exception 'SELLER_OS_DAILY_DOLLAR_COMPLETION_INPUT_INVALID';
  end if;

  v_token_hash := 'sha256:' || encode(extensions.digest(
    convert_to(p_lease_token, 'UTF8'), 'sha256'), 'hex');
  select coalesce(jsonb_agg(entry.value order by
    (entry.value ->> 'rank')::integer), '[]'::jsonb)
  into v_entries from jsonb_array_elements(p_entries) entry(value);

  select * into v_run
  from public.seller_os_daily_dollar_radar_runs
  where run_id = p_run_id for update;

  if not found or v_run.input_digest <> p_input_digest
    or v_run.lease_token_hash <> v_token_hash then
    raise exception 'SELLER_OS_DAILY_DOLLAR_COMPLETION_OWNERSHIP_REJECTED';
  end if;

  v_snapshot_digest := 'sha256:' || encode(extensions.digest(convert_to(
    concat(
      'SELLER_OS_MORNING_DOLLAR_OPPORTUNITY_QUEUE_DIGEST_V1', E'\n',
      v_run.run_id, E'\n', p_input_digest, E'\n', p_output_digest, E'\n',
      v_entries::text, E'\n', p_metrics::text
    ), 'UTF8'), 'sha256'), 'hex');
  v_snapshot_id := 'morning-dollar-queue-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_MORNING_DOLLAR_OPPORTUNITY_QUEUE_ID_V1', E'\n',
      v_run.run_id, E'\n', v_snapshot_digest
    ), 'UTF8'), 'sha256'), 'hex');

  if v_run.status = 'COMPLETED' then
    if v_run.output_digest <> p_output_digest
      or v_run.queue_snapshot_id <> v_snapshot_id
      or v_run.queue_snapshot_digest <> v_snapshot_digest then
      raise exception 'SELLER_OS_DAILY_DOLLAR_COMPLETION_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'outcome', 'IDEMPOTENT_SUCCESS', 'runId', v_run.run_id,
      'status', v_run.status, 'queueSnapshotId', v_run.queue_snapshot_id,
      'queueEntryCount', v_run.queue_entry_count,
      'inputDigest', v_run.input_digest, 'outputDigest', v_run.output_digest
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_entries) entry(value)
    left join public.seller_os_market_opportunity_cases opportunity
      on opportunity.family_id = entry.value ->> 'familyId'
      and opportunity.opportunity_case_id =
        entry.value ->> 'opportunityCaseId'
    left join public.seller_os_market_family_definitions definition
      on definition.family_id = opportunity.family_id
      and definition.opportunity_case_id = opportunity.opportunity_case_id
      and definition.family_definition_version_id =
        opportunity.current_family_definition_version_id
    left join public.seller_os_family_market_observations observation
      on observation.family_id = opportunity.family_id
      and observation.opportunity_case_id = opportunity.opportunity_case_id
      and observation.observation_id =
        entry.value ->> 'currentMarketObservationId'
    where opportunity.opportunity_case_id is null
      or definition.family_definition_version_id is null
      or definition.family_name <> entry.value ->> 'familyName'
      or observation.observation_id is null
      or observation.family_demand_status <>
        entry.value ->> 'demandStatus'
      or observation.demand_evidence_digest <>
        entry.value #>> '{demandEvidenceSummary,evidenceDigest}'
  ) then
    raise exception 'SELLER_OS_MORNING_DOLLAR_QUEUE_REFERENCE_REJECTED';
  end if;

  if v_run.status <> 'RUNNING' or v_run.lease_expires_at <= v_now then
    raise exception 'SELLER_OS_DAILY_DOLLAR_COMPLETION_LEASE_EXPIRED';
  end if;

  insert into public.seller_os_morning_dollar_opportunity_queue_snapshots (
    snapshot_id, run_id, account_key, marketplace_id, logical_run_date,
    input_digest, output_digest, snapshot_digest, entries, entry_count,
    ebay_api_calls, ebay_sell_calls, ebay_marketplace_api_calls,
    ebay_trading_calls, ebay_browse_calls, ebay_developer_analytics_calls,
    marketplace_writes, luna_network_reads, luna_stock_reads, luna_mutations,
    p2_mutations, t0_writes, t1_writes, sku_reservations,
    generative_image_calls, payments, created_at
  ) values (
    v_snapshot_id, v_run.run_id, v_run.account_key, v_run.marketplace_id,
    v_run.logical_run_date, p_input_digest, p_output_digest,
    v_snapshot_digest, v_entries, jsonb_array_length(v_entries),
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, v_now
  ) on conflict (run_id) do nothing;

  select * into v_snapshot
  from public.seller_os_morning_dollar_opportunity_queue_snapshots
  where run_id = v_run.run_id;
  if not found or v_snapshot.snapshot_id <> v_snapshot_id
    or v_snapshot.snapshot_digest <> v_snapshot_digest
    or v_snapshot.entries <> v_entries then
    raise exception 'SELLER_OS_MORNING_DOLLAR_QUEUE_REPLAY_CONFLICT';
  end if;

  update public.seller_os_daily_dollar_radar_runs
  set status = 'COMPLETED', output_digest = p_output_digest,
      lease_expires_at = null, next_retry_at = null,
      queue_snapshot_id = v_snapshot_id,
      queue_snapshot_digest = v_snapshot_digest,
      queue_entry_count = jsonb_array_length(v_entries),
      family_input_count = (p_metrics ->> 'familyInputCount')::integer,
      eligible_family_count = (p_metrics ->> 'eligibleFamilyCount')::integer,
      configuration_input_count =
        (p_metrics ->> 'configurationInputCount')::integer,
      queue_count = (p_metrics ->> 'queueCount')::integer,
      escalation_count = (p_metrics ->> 'escalationCount')::integer,
      radar_family_rows = (p_metrics ->> 'radarFamilyRows')::integer,
      product_research_rows =
        (p_metrics ->> 'productResearchRows')::integer,
      luna_variant_rows = (p_metrics ->> 'lunaVariantRows')::integer,
      family_evaluation_rows =
        (p_metrics ->> 'familyEvaluationRows')::integer,
      families_evaluated = (p_metrics ->> 'familiesEvaluated')::integer,
      new_families_discovered =
        (p_metrics ->> 'newFamiliesDiscovered')::integer,
      demand_proven_count = (p_metrics ->> 'demandProvenCount')::integer,
      demand_supported_count =
        (p_metrics ->> 'demandSupportedCount')::integer,
      luna_match_count = (p_metrics ->> 'lunaMatchCount')::integer,
      product_fit_strong_count =
        (p_metrics ->> 'productFitStrongCount')::integer,
      economically_dead_count =
        (p_metrics ->> 'economicallyDeadCount')::integer,
      economically_recoverable_count =
        (p_metrics ->> 'economicallyRecoverableCount')::integer,
      economically_promising_count =
        (p_metrics ->> 'economicallyPromisingCount')::integer,
      economics_unproven_count =
        (p_metrics ->> 'economicsUnprovenCount')::integer,
      morning_queue_count = (p_metrics ->> 'morningQueueCount')::integer,
      needs_fresh_ebay_verification_count =
        (p_metrics ->> 'needsFreshEbayVerificationCount')::integer,
      failure_stage = p_metrics ->> 'failureStage',
      ebay_api_calls = (p_metrics ->> 'eBayApiCalls')::integer,
      ebay_sell_calls = (p_metrics ->> 'eBaySellCalls')::integer,
      ebay_marketplace_api_calls =
        (p_metrics ->> 'eBayMarketplaceApiCalls')::integer,
      ebay_trading_calls = (p_metrics ->> 'eBayTradingCalls')::integer,
      ebay_browse_calls = (p_metrics ->> 'eBayBrowseCalls')::integer,
      ebay_developer_analytics_calls =
        (p_metrics ->> 'eBayDeveloperAnalyticsCalls')::integer,
      marketplace_writes = (p_metrics ->> 'marketplaceWrites')::integer,
      luna_network_reads = (p_metrics ->> 'lunaNetworkReads')::integer,
      luna_stock_reads = (p_metrics ->> 'lunaStockReads')::integer,
      luna_mutations = (p_metrics ->> 'lunaMutations')::integer,
      p2_mutations = (p_metrics ->> 'p2Mutations')::integer,
      t0_writes = (p_metrics ->> 't0Writes')::integer,
      t1_writes = (p_metrics ->> 't1Writes')::integer,
      sku_reservations = (p_metrics ->> 'skuReservations')::integer,
      completed_at = v_now, updated_at = v_now
  where run_id = v_run.run_id
  returning * into v_run;

  perform public.append_seller_os_daily_dollar_run_receipt_v1(
    v_run.run_id, 'COMPLETED', null, v_now
  );

  return jsonb_build_object(
    'outcome', 'COMPLETED', 'runId', v_run.run_id,
    'status', v_run.status, 'queueSnapshotId', v_snapshot_id,
    'queueSnapshotDigest', v_snapshot_digest,
    'queueEntryCount', v_run.queue_entry_count,
    'inputDigest', v_run.input_digest, 'outputDigest', v_run.output_digest
  );
end;
$function$;

create or replace function public.fail_seller_os_daily_dollar_radar_run_v1(
  p_run_id text,
  p_lease_token text,
  p_input_digest text,
  p_error_code text,
  p_metrics jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_token_hash text;
  v_event_type text;
  v_run public.seller_os_daily_dollar_radar_runs%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_run_id, '') !~
      '^daily-dollar-radar-run-v1:sha256:[0-9a-f]{64}$'
    or length(coalesce(p_lease_token, '')) not between 32 and 256
    or coalesce(p_input_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_error_code, '') !~ '^[A-Z0-9_]{3,100}$'
    or not public.is_valid_seller_os_daily_dollar_metrics_v1(p_metrics)
    or p_metrics ->> 'failureStage' = 'NONE' then
    raise exception 'SELLER_OS_DAILY_DOLLAR_FAILURE_INPUT_INVALID';
  end if;

  v_token_hash := 'sha256:' || encode(extensions.digest(
    convert_to(p_lease_token, 'UTF8'), 'sha256'), 'hex');
  select * into v_run
  from public.seller_os_daily_dollar_radar_runs
  where run_id = p_run_id for update;

  if not found or v_run.input_digest <> p_input_digest
    or v_run.lease_token_hash <> v_token_hash then
    raise exception 'SELLER_OS_DAILY_DOLLAR_FAILURE_OWNERSHIP_REJECTED';
  end if;

  if v_run.status in ('RETRY_WAIT', 'FAILED_TERMINAL')
    and v_run.last_error_code = p_error_code then
    return jsonb_build_object(
      'outcome', 'IDEMPOTENT_SUCCESS', 'runId', v_run.run_id,
      'status', v_run.status, 'attemptCount', v_run.attempt_count,
      'nextRetryAt', v_run.next_retry_at,
      'lastErrorCode', v_run.last_error_code
    );
  end if;
  if v_run.status <> 'RUNNING' then
    raise exception 'SELLER_OS_DAILY_DOLLAR_FAILURE_STATE_CONFLICT';
  end if;

  if v_run.attempt_count < v_run.maximum_attempts then
    v_event_type := 'FAILED_RETRYABLE';
    update public.seller_os_daily_dollar_radar_runs
    set status = 'RETRY_WAIT', lease_expires_at = null,
        next_retry_at = v_now + make_interval(
          secs => least(3600, 60 * (2 ^ (attempt_count - 1)))::integer
        ),
        last_error_code = p_error_code,
        family_input_count = (p_metrics ->> 'familyInputCount')::integer,
        eligible_family_count =
          (p_metrics ->> 'eligibleFamilyCount')::integer,
        configuration_input_count =
          (p_metrics ->> 'configurationInputCount')::integer,
        queue_count = (p_metrics ->> 'queueCount')::integer,
        escalation_count = (p_metrics ->> 'escalationCount')::integer,
        radar_family_rows = (p_metrics ->> 'radarFamilyRows')::integer,
        product_research_rows =
          (p_metrics ->> 'productResearchRows')::integer,
        luna_variant_rows = (p_metrics ->> 'lunaVariantRows')::integer,
        family_evaluation_rows =
          (p_metrics ->> 'familyEvaluationRows')::integer,
        families_evaluated = (p_metrics ->> 'familiesEvaluated')::integer,
        new_families_discovered =
          (p_metrics ->> 'newFamiliesDiscovered')::integer,
        demand_proven_count = (p_metrics ->> 'demandProvenCount')::integer,
        demand_supported_count =
          (p_metrics ->> 'demandSupportedCount')::integer,
        luna_match_count = (p_metrics ->> 'lunaMatchCount')::integer,
        product_fit_strong_count =
          (p_metrics ->> 'productFitStrongCount')::integer,
        economically_dead_count =
          (p_metrics ->> 'economicallyDeadCount')::integer,
        economically_recoverable_count =
          (p_metrics ->> 'economicallyRecoverableCount')::integer,
        economically_promising_count =
          (p_metrics ->> 'economicallyPromisingCount')::integer,
        economics_unproven_count =
          (p_metrics ->> 'economicsUnprovenCount')::integer,
        morning_queue_count = (p_metrics ->> 'morningQueueCount')::integer,
        needs_fresh_ebay_verification_count =
          (p_metrics ->> 'needsFreshEbayVerificationCount')::integer,
        failure_stage = p_metrics ->> 'failureStage',
        updated_at = v_now
    where run_id = v_run.run_id
    returning * into v_run;
  else
    v_event_type := 'FAILED_TERMINAL';
    update public.seller_os_daily_dollar_radar_runs
    set status = 'FAILED_TERMINAL', lease_expires_at = null,
        next_retry_at = null, last_error_code = p_error_code,
        family_input_count = (p_metrics ->> 'familyInputCount')::integer,
        eligible_family_count =
          (p_metrics ->> 'eligibleFamilyCount')::integer,
        configuration_input_count =
          (p_metrics ->> 'configurationInputCount')::integer,
        queue_count = (p_metrics ->> 'queueCount')::integer,
        escalation_count = (p_metrics ->> 'escalationCount')::integer,
        radar_family_rows = (p_metrics ->> 'radarFamilyRows')::integer,
        product_research_rows =
          (p_metrics ->> 'productResearchRows')::integer,
        luna_variant_rows = (p_metrics ->> 'lunaVariantRows')::integer,
        family_evaluation_rows =
          (p_metrics ->> 'familyEvaluationRows')::integer,
        families_evaluated = (p_metrics ->> 'familiesEvaluated')::integer,
        new_families_discovered =
          (p_metrics ->> 'newFamiliesDiscovered')::integer,
        demand_proven_count = (p_metrics ->> 'demandProvenCount')::integer,
        demand_supported_count =
          (p_metrics ->> 'demandSupportedCount')::integer,
        luna_match_count = (p_metrics ->> 'lunaMatchCount')::integer,
        product_fit_strong_count =
          (p_metrics ->> 'productFitStrongCount')::integer,
        economically_dead_count =
          (p_metrics ->> 'economicallyDeadCount')::integer,
        economically_recoverable_count =
          (p_metrics ->> 'economicallyRecoverableCount')::integer,
        economically_promising_count =
          (p_metrics ->> 'economicallyPromisingCount')::integer,
        economics_unproven_count =
          (p_metrics ->> 'economicsUnprovenCount')::integer,
        morning_queue_count = (p_metrics ->> 'morningQueueCount')::integer,
        needs_fresh_ebay_verification_count =
          (p_metrics ->> 'needsFreshEbayVerificationCount')::integer,
        failure_stage = p_metrics ->> 'failureStage',
        failed_at = v_now, updated_at = v_now
    where run_id = v_run.run_id
    returning * into v_run;
  end if;

  perform public.append_seller_os_daily_dollar_run_receipt_v1(
    v_run.run_id, v_event_type, p_error_code, v_now
  );

  return jsonb_build_object(
    'outcome', v_event_type, 'runId', v_run.run_id,
    'status', v_run.status, 'attemptCount', v_run.attempt_count,
    'maximumAttempts', v_run.maximum_attempts,
    'nextRetryAt', v_run.next_retry_at,
    'lastErrorCode', v_run.last_error_code
  );
end;
$function$;

create or replace function public.get_seller_os_morning_dollar_opportunity_queue_v1(
  p_account_key text,
  p_marketplace_id text default 'EBAY_US',
  p_logical_run_date date default null,
  p_limit integer default 5
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_snapshot public.seller_os_morning_dollar_opportunity_queue_snapshots%rowtype;
  v_scheduler public.seller_os_daily_dollar_radar_scheduler_policy%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(trim(p_account_key), '') !~
      '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or p_limit not between 1 and 5 then
    raise exception 'SELLER_OS_MORNING_DOLLAR_QUEUE_SELECTOR_INVALID';
  end if;

  select * into v_scheduler
  from public.seller_os_daily_dollar_radar_scheduler_policy
  where singleton;

  select * into v_snapshot
  from public.seller_os_morning_dollar_opportunity_queue_snapshots snapshot
  where snapshot.account_key = trim(p_account_key)
    and snapshot.marketplace_id = p_marketplace_id
    and (p_logical_run_date is null
      or snapshot.logical_run_date = p_logical_run_date)
  order by snapshot.logical_run_date desc, snapshot.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'MORNING_DOLLAR_QUEUE_NOT_PERSISTED',
      'resultCount', 0,
      'entries', '[]'::jsonb,
      'schedulerPolicy', jsonb_build_object(
        'authority', v_scheduler.scheduler_authority,
        'enabled', v_scheduler.scheduler_enabled,
        'status', v_scheduler.policy_status,
        'businessTimeZone', v_scheduler.business_timezone,
        'utcCronSchedule', v_scheduler.utc_cron_schedule
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'AVAILABLE',
    'runId', v_snapshot.run_id,
    'logicalRunDate', v_snapshot.logical_run_date,
    'queueSnapshotId', v_snapshot.snapshot_id,
    'inputDigest', v_snapshot.input_digest,
    'outputDigest', v_snapshot.output_digest,
    'snapshotDigest', v_snapshot.snapshot_digest,
    'resultCount', least(v_snapshot.entry_count, p_limit),
    'entries', (
      select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_snapshot.entries)
        with ordinality entry(value, ordinality)
      where entry.ordinality <= p_limit
    ),
    'schedulerPolicy', jsonb_build_object(
      'authority', v_scheduler.scheduler_authority,
      'enabled', v_scheduler.scheduler_enabled,
      'status', v_scheduler.policy_status,
      'businessTimeZone', v_scheduler.business_timezone,
      'utcCronSchedule', v_scheduler.utc_cron_schedule
    ),
    'rawMarketFactsDuplicated', false,
    'contractVersion', v_snapshot.contract_version
  );
end;
$function$;

alter table public.seller_os_daily_dollar_radar_runs
  enable row level security;
alter table public.seller_os_daily_dollar_radar_runs
  force row level security;
alter table public.seller_os_daily_dollar_radar_run_receipts
  enable row level security;
alter table public.seller_os_daily_dollar_radar_run_receipts
  force row level security;
alter table public.seller_os_morning_dollar_opportunity_queue_snapshots
  enable row level security;
alter table public.seller_os_morning_dollar_opportunity_queue_snapshots
  force row level security;
alter table public.seller_os_daily_dollar_radar_scheduler_policy
  enable row level security;
alter table public.seller_os_daily_dollar_radar_scheduler_policy
  force row level security;

revoke all on table public.seller_os_daily_dollar_radar_runs
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_daily_dollar_radar_run_receipts
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_morning_dollar_opportunity_queue_snapshots
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_daily_dollar_radar_scheduler_policy
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.seller_os_daily_dollar_radar_runs
  to postgres;
grant select, insert on table
  public.seller_os_daily_dollar_radar_run_receipts to postgres;
grant select, insert on table
  public.seller_os_morning_dollar_opportunity_queue_snapshots to postgres;
grant select on table public.seller_os_daily_dollar_radar_scheduler_policy
  to postgres;

create policy seller_os_daily_dollar_radar_runs_rpc_owner_all
  on public.seller_os_daily_dollar_radar_runs for all to postgres
  using (public.is_seller_os_service_role_request_v1())
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_daily_dollar_radar_receipts_rpc_owner_read
  on public.seller_os_daily_dollar_radar_run_receipts for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_daily_dollar_radar_receipts_rpc_owner_insert
  on public.seller_os_daily_dollar_radar_run_receipts for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_morning_dollar_queue_rpc_owner_read
  on public.seller_os_morning_dollar_opportunity_queue_snapshots
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_morning_dollar_queue_rpc_owner_insert
  on public.seller_os_morning_dollar_opportunity_queue_snapshots
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_daily_dollar_scheduler_policy_rpc_owner_read
  on public.seller_os_daily_dollar_radar_scheduler_policy
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());

revoke all on function public.is_valid_seller_os_daily_dollar_metrics_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.is_valid_seller_os_daily_dollar_text_array_v1(
  jsonb,integer,integer,boolean,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_seller_os_daily_dollar_number_v1(
  jsonb,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_seller_os_daily_dollar_profile_attributes_v1(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_seller_os_morning_dollar_queue_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.append_seller_os_daily_dollar_run_receipt_v1(
  text,text,text,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.reject_seller_os_daily_dollar_append_mutation_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.claim_seller_os_daily_dollar_radar_run_v1(
  text,text,timestamptz,timestamptz,timestamptz,text,text,integer
) from public, anon, authenticated;
grant execute on function public.claim_seller_os_daily_dollar_radar_run_v1(
  text,text,timestamptz,timestamptz,timestamptz,text,text,integer
) to service_role;

revoke all on function public.complete_seller_os_daily_dollar_radar_run_v1(
  text,text,text,text,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.complete_seller_os_daily_dollar_radar_run_v1(
  text,text,text,text,jsonb,jsonb
) to service_role;

revoke all on function public.fail_seller_os_daily_dollar_radar_run_v1(
  text,text,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.fail_seller_os_daily_dollar_radar_run_v1(
  text,text,text,text,jsonb
) to service_role;

revoke all on function public.get_seller_os_morning_dollar_opportunity_queue_v1(
  text,text,date,integer
) from public, anon, authenticated;
grant execute on function public.get_seller_os_morning_dollar_opportunity_queue_v1(
  text,text,date,integer
) to service_role;

comment on table public.seller_os_daily_dollar_radar_runs is
  'One durable, restart-safe logical daily Dollar Radar run per account/day; leases persist only as SHA-256 hashes and retries are bounded to three attempts.';
comment on table public.seller_os_daily_dollar_radar_run_receipts is
  'Append-only sanitized attempt receipts. Input/output digests bind execution without duplicating raw market evidence.';
comment on table public.seller_os_morning_dollar_opportunity_queue_snapshots is
  'Immutable deterministic morning queue snapshot, bounded to five canonical evidence-reference entries; no raw market facts.';
comment on table public.seller_os_daily_dollar_radar_scheduler_policy is
  'Fail-closed Vercel Cron policy metadata. Scheduling remains disabled until business timezone and UTC hour are separately authorized.';
