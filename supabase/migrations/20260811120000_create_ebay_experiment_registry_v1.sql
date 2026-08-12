-- Prepared persistence contract for Commercial Monitor experiments.
-- This migration is intentionally not deployed by the application.

create table if not exists public.ebay_listing_experiments_v1 (
  experiment_id text primary key,
  account_key text not null,
  marketplace text not null,
  ebay_item_id text not null,
  ebay_sku text,
  hypothesis text not null,
  diagnosis_class text not null check (
    diagnosis_class in ('VISIBILITY', 'CTR', 'CONVERSION', 'DATA_QUALITY', 'HEALTHY_WAIT')
  ),
  experiment_type text not null,
  variable_changed text not null,
  changed_at timestamptz not null,
  baseline_evidence_ref jsonb,
  lifecycle_status text not null check (
    lifecycle_status in (
      'DRAFT',
      'READY',
      'RUNNING',
      'WAITING_FOR_EVIDENCE',
      'READY_TO_EVALUATE',
      'PAUSED_FOR_EXTERNAL_SIGNAL',
      'COMPLETED',
      'INCONCLUSIVE',
      'CANCELLED'
    )
  ),
  frozen_variables text[] not null default array[]::text[],
  minimum_observation_duration_hours integer not null check (
    minimum_observation_duration_hours >= 0
  ),
  minimum_evidence_metric text not null check (
    minimum_evidence_metric in (
      'IMPRESSIONS',
      'LISTING_VIEWS',
      'QUANTITY_SOLD',
      'DATA_QUALITY_RESOLUTION'
    )
  ),
  minimum_evidence_value numeric not null check (minimum_evidence_value >= 0),
  current_evidence_value numeric,
  next_review_condition text,
  next_review_at timestamptz,
  outcome jsonb,
  learning_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ebay_item_id ~ '^[0-9]+$'),
  check (jsonb_typeof(coalesce(baseline_evidence_ref, '{}'::jsonb)) = 'object'),
  check (jsonb_typeof(coalesce(outcome, '{}'::jsonb)) = 'object')
);

create unique index if not exists ebay_listing_experiments_v1_active_item_uq
  on public.ebay_listing_experiments_v1 (account_key, marketplace, ebay_item_id)
  where lifecycle_status in (
    'READY',
    'RUNNING',
    'WAITING_FOR_EVIDENCE',
    'READY_TO_EVALUATE',
    'PAUSED_FOR_EXTERNAL_SIGNAL'
  );

alter table public.ebay_listing_experiments_v1 enable row level security;

revoke all on table public.ebay_listing_experiments_v1 from public;
revoke all on table public.ebay_listing_experiments_v1 from anon, authenticated;
grant select, insert, update on table public.ebay_listing_experiments_v1 to service_role;

comment on table public.ebay_listing_experiments_v1 is
  'Server-only experiment registry contract. Records recommendations and evidence gates; it never performs eBay operations.';
