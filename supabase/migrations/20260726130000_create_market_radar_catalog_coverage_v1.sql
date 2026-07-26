begin;

create extension if not exists pgcrypto;

create table if not exists public.market_radar_catalog_scan_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_radar_sources(id) on delete cascade,
  manifest_version text not null,
  execution_mode text not null default 'SHADOW',
  status text not null default 'RUNNING',
  expected_products integer null,
  received_products integer not null default 0,
  unique_products integer not null default 0,
  unique_variants integer not null default 0,
  missing_identity_count integer not null default 0,
  duplicate_product_count integer not null default 0,
  collision_count integer not null default 0,
  coverage_percent numeric(6,2) null,
  catalog_checksum text null,
  source_observed_at timestamptz null,
  fetched_at timestamptz null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  error_code text null,
  created_at timestamptz not null default now(),
  constraint market_radar_catalog_scan_mode_check
    check (execution_mode in ('SHADOW', 'ENFORCED')),
  constraint market_radar_catalog_scan_status_check
    check (status in ('RUNNING', 'COMPLETE', 'PARTIAL', 'TRUNCATED', 'FAILED', 'CANCELLED')),
  constraint market_radar_catalog_scan_counts_check check (
    received_products >= 0 and unique_products >= 0 and unique_variants >= 0
    and missing_identity_count >= 0 and duplicate_product_count >= 0
    and collision_count >= 0
    and (expected_products is null or expected_products >= 0)
    and (coverage_percent is null or coverage_percent between 0 and 100)
  )
);

create table if not exists public.market_radar_catalog_scan_segments (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.market_radar_catalog_scan_runs(id) on delete cascade,
  collection_key text not null,
  page_number integer not null,
  cursor_value text null,
  resume_token text null,
  status text not null,
  page_limit integer not null,
  max_pages integer not null,
  expected_total integer null,
  received_products integer not null default 0,
  unique_products integer not null default 0,
  unique_variants integer not null default 0,
  missing_identity_count integer not null default 0,
  duplicate_product_count integer not null default 0,
  collision_count integer not null default 0,
  attempts integer not null default 1,
  next_retry_at timestamptz null,
  checksum text not null,
  etag text null,
  source_observed_at timestamptz not null,
  fetched_at timestamptz not null,
  error_code text null,
  product_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_radar_catalog_segment_status_check
    check (status in ('COMPLETE', 'PARTIAL', 'TRUNCATED', 'FAILED')),
  constraint market_radar_catalog_segment_numbers_check check (
    page_number >= 1 and page_limit >= 1 and max_pages >= 1 and attempts >= 1
    and received_products >= 0 and unique_products >= 0 and unique_variants >= 0
    and missing_identity_count >= 0 and duplicate_product_count >= 0
    and collision_count >= 0
  ),
  constraint market_radar_catalog_segment_unique
    unique (scan_run_id, collection_key, page_number)
);

alter table public.market_radar_catalog_scan_segments
  add column if not exists product_payload jsonb not null default '[]'::jsonb;

create table if not exists public.market_radar_inventory_hydration_cursors (
  source_id uuid primary key references public.market_radar_sources(id) on delete cascade,
  policy_version text not null,
  catalog_fingerprint text not null,
  next_offset integer not null default 0,
  candidate_count integer not null default 0,
  last_window_size integer not null default 0,
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_claimed_at timestamptz null,
  completed_cycles bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint market_radar_hydration_cursor_numbers_check check (
    next_offset >= 0 and candidate_count >= 0 and last_window_size >= 0
    and completed_cycles >= 0
  )
);

create table if not exists public.market_radar_supplier_rotation_metrics (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.market_radar_products(id) on delete cascade,
  supplier_variant_id text not null,
  window_days integer not null,
  policy_version text not null,
  evidence_class text not null,
  observation_count integer not null default 0,
  numeric_observation_count integer not null default 0,
  initial_inventory integer null,
  final_inventory integer null,
  reduction_event_count integer not null default 0,
  estimated_units_out integer not null default 0,
  observed_increase_count integer not null default 0,
  observed_increase_units integer not null default 0,
  confirmed_restock_count integer not null default 0,
  days_with_stock integer not null default 0,
  days_out_of_stock integer not null default 0,
  inventory_volatility numeric(14,4) null,
  availability_stability numeric(8,6) null,
  supplier_cost_change_count integer not null default 0,
  discount_dependency numeric(8,6) null,
  freshest_observation_at timestamptz null,
  confidence_score numeric(6,2) not null default 0,
  supplier_rotation_score numeric(6,2) not null default 0,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_radar_supplier_rotation_window_check check (window_days in (7, 30, 90)),
  constraint market_radar_supplier_rotation_evidence_check check (
    evidence_class in (
      'SUPPLIER_STOCK_MOVEMENT_CONFIRMED',
      'SUPPLIER_STOCK_MOVEMENT_ESTIMATED',
      'RESTOCK_CONFIRMED',
      'AVAILABILITY_ONLY',
      'UNKNOWN'
    )
  ),
  constraint market_radar_supplier_rotation_score_check check (
    confidence_score between 0 and 100 and supplier_rotation_score between 0 and 100
  ),
  constraint market_radar_supplier_rotation_unique
    unique (product_id, supplier_variant_id, window_days, policy_version)
);

alter table public.market_radar_snapshots
  add column if not exists catalog_scan_run_id uuid null
    references public.market_radar_catalog_scan_runs(id) on delete set null,
  add column if not exists source_observed_at timestamptz null,
  add column if not exists fetched_at timestamptz null,
  add column if not exists snapshot_fingerprint text null;

create index if not exists market_radar_catalog_scan_source_time_idx
  on public.market_radar_catalog_scan_runs(source_id, started_at desc);
create index if not exists market_radar_catalog_segment_resume_idx
  on public.market_radar_catalog_scan_segments(scan_run_id, collection_key, status, page_number);
create index if not exists market_radar_snapshot_scan_run_idx
  on public.market_radar_snapshots(catalog_scan_run_id)
  where catalog_scan_run_id is not null;
create index if not exists market_radar_snapshot_source_observed_idx
  on public.market_radar_snapshots(product_id, supplier_variant_id, source_observed_at desc)
  where source_observed_at is not null;
create index if not exists market_radar_supplier_rotation_lookup_idx
  on public.market_radar_supplier_rotation_metrics(
    product_id, supplier_variant_id, window_days, calculated_at desc
  );

create or replace function public.claim_market_radar_luna_hydration_window_v1(
  p_source_id uuid,
  p_policy_version text,
  p_catalog_fingerprint text,
  p_candidate_count integer,
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table(start_offset integer, next_offset integer, selected_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_cursor public.market_radar_inventory_hydration_cursors%rowtype;
  v_start integer := 0;
  v_selected integer := 0;
  v_next integer := 0;
begin
  if p_source_id is null or nullif(trim(p_policy_version), '') is null
    or nullif(trim(p_catalog_fingerprint), '') is null
    or nullif(trim(p_worker_id), '') is null then
    raise exception 'LUNA_HYDRATION_CURSOR_INPUT_REQUIRED';
  end if;
  if p_candidate_count < 0 or p_limit < 1 then
    raise exception 'LUNA_HYDRATION_CURSOR_COUNTS_INVALID';
  end if;

  insert into public.market_radar_inventory_hydration_cursors (
    source_id, policy_version, catalog_fingerprint
  ) values (
    p_source_id, trim(p_policy_version), trim(p_catalog_fingerprint)
  )
  on conflict (source_id) do nothing;

  select * into v_cursor
  from public.market_radar_inventory_hydration_cursors
  where source_id = p_source_id
  for update;

  if v_cursor.lease_expires_at is not null
    and v_cursor.lease_expires_at > now()
    and v_cursor.lease_owner is distinct from trim(p_worker_id) then
    raise exception 'LUNA_HYDRATION_CURSOR_LEASED';
  end if;

  if p_candidate_count > 0 then
    v_start := case
      when v_cursor.catalog_fingerprint is distinct from trim(p_catalog_fingerprint)
        then least(v_cursor.next_offset, p_candidate_count - 1)
      else mod(v_cursor.next_offset, p_candidate_count)
    end;
    v_selected := least(p_limit, p_candidate_count);
    v_next := mod(v_start + v_selected, p_candidate_count);
  end if;

  update public.market_radar_inventory_hydration_cursors
  set policy_version = trim(p_policy_version),
      catalog_fingerprint = trim(p_catalog_fingerprint),
      next_offset = v_next,
      candidate_count = p_candidate_count,
      last_window_size = v_selected,
      lease_owner = trim(p_worker_id),
      lease_expires_at = now() + make_interval(
        secs => greatest(30, least(coalesce(p_lease_seconds, 300), 900))
      ),
      last_claimed_at = now(),
      completed_cycles = completed_cycles +
        case when p_candidate_count > 0 and v_next <= v_start then 1 else 0 end,
      updated_at = now()
  where source_id = p_source_id;

  return query select v_start, v_next, v_selected;
end;
$function$;

create or replace function public.release_market_radar_luna_hydration_window_v1(
  p_source_id uuid,
  p_worker_id text,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_released boolean := false;
begin
  if p_source_id is null or nullif(trim(p_worker_id), '') is null then
    raise exception 'LUNA_HYDRATION_CURSOR_RELEASE_INPUT_REQUIRED';
  end if;
  if p_outcome not in ('SUCCESS', 'SAFE_FAILURE') then
    raise exception 'LUNA_HYDRATION_CURSOR_RELEASE_OUTCOME_INVALID';
  end if;

  update public.market_radar_inventory_hydration_cursors
  set lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where source_id = p_source_id
    and lease_owner = trim(p_worker_id);
  v_released := found;
  return v_released;
end;
$function$;

alter table public.market_radar_catalog_scan_runs enable row level security;
alter table public.market_radar_catalog_scan_segments enable row level security;
alter table public.market_radar_inventory_hydration_cursors enable row level security;
alter table public.market_radar_supplier_rotation_metrics enable row level security;

revoke all on table public.market_radar_catalog_scan_runs from public, anon, authenticated;
revoke all on table public.market_radar_catalog_scan_segments from public, anon, authenticated;
revoke all on table public.market_radar_inventory_hydration_cursors from public, anon, authenticated;
revoke all on table public.market_radar_supplier_rotation_metrics from public, anon, authenticated;
revoke all on function public.claim_market_radar_luna_hydration_window_v1(
  uuid, text, text, integer, integer, text, integer
) from public, anon, authenticated;
revoke all on function public.release_market_radar_luna_hydration_window_v1(
  uuid, text, text
) from public, anon, authenticated;

grant select, insert, update on table public.market_radar_catalog_scan_runs to service_role;
grant select, insert, update on table public.market_radar_catalog_scan_segments to service_role;
grant select, insert, update on table public.market_radar_inventory_hydration_cursors to service_role;
grant select, insert, update on table public.market_radar_supplier_rotation_metrics to service_role;
grant execute on function public.claim_market_radar_luna_hydration_window_v1(
  uuid, text, text, integer, integer, text, integer
) to service_role;
grant execute on function public.release_market_radar_luna_hydration_window_v1(
  uuid, text, text
) to service_role;

comment on table public.market_radar_catalog_scan_runs is
  'Versioned Luna coverage manifests. COMPLETE requires authoritative reconciliation; zero rows can never be complete.';
comment on table public.market_radar_supplier_rotation_metrics is
  'Supplier movement confidence only; never confirmed Luna or eBay sales.';

notify pgrst, 'reload schema';
commit;
