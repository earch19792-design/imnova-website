create extension if not exists pgcrypto;

create table if not exists public.ebay_product_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null,
  source_id uuid null references public.market_radar_sources(id) on delete set null,
  market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
  market_radar_snapshot_id uuid null references public.market_radar_snapshots(id) on delete set null,
  supplier_product_id text null,
  supplier_variant_id text not null,
  supplier_sku text null,
  title text not null,
  product_url text null,
  brand text null,
  product_type text null,
  source_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  state text not null default 'DETECTED',
  detected_at timestamptz not null default now(),
  last_evaluated_at timestamptz null,
  blocked_reason text null,
  needs_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_product_candidates_key_unique unique (candidate_key),
  constraint ebay_product_candidates_state_check check (
    state in (
      'DETECTED',
      'ENRICHING',
      'NEEDS_DATA',
      'BLOCKED',
      'VALIDATED',
      'APPROVAL_PENDING',
      'APPROVED',
      'DRAFT_CREATED',
      'PAUSED',
      'REJECTED'
    )
  )
);

create table if not exists public.ebay_candidate_validations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  validation_version text not null default 'v1',
  validation_status text not null,
  required_fields jsonb not null default '[]'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  critical_reasons jsonb not null default '[]'::jsonb,
  validated_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint ebay_candidate_validations_key_unique unique (idempotency_key),
  constraint ebay_candidate_validations_status_check check (
    validation_status in ('passed', 'needs_data', 'blocked')
  )
);

create table if not exists public.ebay_profit_scenarios (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  scenario_version text not null default 'v1',
  estimated_sale_price numeric(12,2) not null default 0,
  luna_cost numeric(12,2) not null default 0,
  fulfillment_cost numeric(12,2) not null default 0,
  packaging_cost numeric(12,2) not null default 0,
  estimated_shipping_cost numeric(12,2) not null default 0,
  estimated_ebay_fee numeric(12,2) not null default 0,
  estimated_payment_fee numeric(12,2) not null default 0,
  estimated_advertising_cost numeric(12,2) not null default 0,
  return_reserve numeric(12,2) not null default 0,
  total_estimated_cost numeric(12,2) not null default 0,
  net_profit numeric(12,2) not null default 0,
  net_margin_percent numeric(6,2) not null default 0,
  roi_percent numeric(6,2) not null default 0,
  passes_minimums boolean not null default false,
  assumptions jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint ebay_profit_scenarios_key_unique unique (idempotency_key)
);

create table if not exists public.ebay_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  check_version text not null default 'v1',
  overall_status text not null,
  blocker_count integer not null default 0,
  findings jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint ebay_compliance_checks_key_unique unique (idempotency_key),
  constraint ebay_compliance_checks_status_check check (
    overall_status in ('passed', 'blocked', 'needs_review')
  )
);

create table if not exists public.ebay_candidate_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  score_version text not null default 'v1',
  winner_score numeric(6,2) not null default 0,
  demand_score numeric(6,2) not null default 0,
  profitability_score numeric(6,2) not null default 0,
  competition_score numeric(6,2) not null default 0,
  stock_stability_score numeric(6,2) not null default 0,
  data_quality_score numeric(6,2) not null default 0,
  inverse_operational_risk_score numeric(6,2) not null default 0,
  explanation text not null,
  score_payload jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint ebay_candidate_scores_key_unique unique (idempotency_key),
  constraint ebay_candidate_scores_winner_score_check check (winner_score between 0 and 100)
);

create table if not exists public.ebay_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  decision text not null,
  decision_channel text not null default 'whatsapp_dry_run',
  message_id text null,
  decided_by text null,
  decision_payload jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint ebay_candidate_decisions_key_unique unique (idempotency_key),
  constraint ebay_candidate_decisions_decision_check check (
    decision in ('create_draft', 'reject', 'review_data', 'postpone')
  )
);

create table if not exists public.ebay_listing_drafts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ebay_product_candidates(id) on delete cascade,
  draft_status text not null default 'created',
  title text not null,
  description_html text null,
  category_id text null,
  condition_id text null,
  price numeric(12,2) null,
  quantity integer null,
  supplier_sku text null,
  brand text null,
  image_urls text[] not null default '{}'::text[],
  aspects jsonb not null default '{}'::jsonb,
  shipping_policy jsonb not null default '{}'::jsonb,
  return_policy jsonb not null default '{}'::jsonb,
  payment_policy jsonb not null default '{}'::jsonb,
  dry_run_only boolean not null default true,
  ebay_draft_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_drafts_candidate_unique unique (candidate_id),
  constraint ebay_listing_drafts_status_check check (
    draft_status in ('created', 'paused', 'rejected')
  ),
  constraint ebay_listing_drafts_no_real_ebay_id_check check (ebay_draft_id is null)
);

create table if not exists public.ebay_pipeline_audit_log (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid null references public.ebay_product_candidates(id) on delete set null,
  event_type text not null,
  from_state text null,
  to_state text null,
  actor text not null default 'system',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint ebay_pipeline_audit_log_key_unique unique (idempotency_key),
  constraint ebay_pipeline_audit_log_to_state_check check (
    to_state is null or to_state in (
      'DETECTED',
      'ENRICHING',
      'NEEDS_DATA',
      'BLOCKED',
      'VALIDATED',
      'APPROVAL_PENDING',
      'APPROVED',
      'DRAFT_CREATED',
      'PAUSED',
      'REJECTED'
    )
  )
);

create index if not exists ebay_product_candidates_state_idx
  on public.ebay_product_candidates(state, updated_at desc);

create index if not exists ebay_product_candidates_radar_idx
  on public.ebay_product_candidates(market_radar_product_id, supplier_variant_id);

create index if not exists ebay_candidate_scores_score_idx
  on public.ebay_candidate_scores(winner_score desc, calculated_at desc);

create index if not exists ebay_pipeline_audit_log_candidate_idx
  on public.ebay_pipeline_audit_log(candidate_id, created_at desc);

alter table public.ebay_product_candidates enable row level security;
alter table public.ebay_candidate_validations enable row level security;
alter table public.ebay_profit_scenarios enable row level security;
alter table public.ebay_compliance_checks enable row level security;
alter table public.ebay_candidate_scores enable row level security;
alter table public.ebay_candidate_decisions enable row level security;
alter table public.ebay_listing_drafts enable row level security;
alter table public.ebay_pipeline_audit_log enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ebay_product_candidates',
    'ebay_candidate_validations',
    'ebay_profit_scenarios',
    'ebay_compliance_checks',
    'ebay_candidate_scores',
    'ebay_candidate_decisions',
    'ebay_listing_drafts',
    'ebay_pipeline_audit_log'
  ] loop
    execute format('drop policy if exists "admin manage %s" on public.%I', table_name, table_name);
    execute format('create policy "admin manage %s" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', table_name, table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
