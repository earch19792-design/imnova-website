-- Additive staging-safe persistence for manual Seller Hub evidence, source
-- divergence health, and exact marketplace listing identity verification.

create table if not exists public.listing_commercial_manual_evidence (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  sku text not null,
  source text not null,
  impressions_metric text not null default 'ORGANIC_IMPRESSIONS',
  views_metric text not null default 'ORGANIC_LISTING_VIEWS',
  transactions_metric text not null default 'QUANTITY_SOLD',
  observed_on date not null,
  impressions bigint not null,
  views bigint not null,
  transactions bigint not null,
  ctr numeric(10,4) not null,
  recorded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint listing_commercial_manual_evidence_identity unique (
    marketplace_account_key, marketplace, listing_id, sku, source, observed_on
  ),
  constraint listing_commercial_manual_evidence_source_check check (
    source = 'SELLER_HUB_MANUAL_LISTING_OBSERVATION'
  ),
  constraint listing_commercial_manual_evidence_metric_names_check check (
    impressions_metric = 'ORGANIC_IMPRESSIONS'
    and views_metric = 'ORGANIC_LISTING_VIEWS'
    and transactions_metric = 'QUANTITY_SOLD'
  ),
  constraint listing_commercial_manual_evidence_metrics_check check (
    impressions >= 0 and views >= 0 and transactions >= 0 and ctr between 0 and 100
  )
);

create table if not exists public.listing_analytics_source_divergences (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  sku text not null,
  manual_evidence_id uuid not null references public.listing_commercial_manual_evidence(id),
  classification text not null default 'SELLER_HUB_LISTING_API_DISCREPANCY',
  health_flag text not null default 'ANALYTICS_SOURCE_DIVERGENCE',
  status text not null default 'open',
  official_source text null,
  official_metrics jsonb null,
  official_window_start date null,
  official_window_end date null,
  official_last_updated_date date null,
  opened_at timestamptz not null default now(),
  last_checked_at timestamptz null,
  next_check_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolution_code text null,
  verified_explanation text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_analytics_source_divergences_status_check check (
    status in ('open', 'resolved')
  ),
  constraint listing_analytics_source_divergences_classification_check check (
    classification in (
      'SELLER_HUB_LISTING_API_DISCREPANCY',
      'SOURCES_MATCH',
      'VERIFIED_EXPLANATION'
    )
  ),
  constraint listing_analytics_source_divergences_health_check check (
    health_flag in ('ANALYTICS_SOURCE_DIVERGENCE', 'RESOLVED')
  ),
  constraint listing_analytics_source_divergences_metrics_check check (
    official_metrics is null or jsonb_typeof(official_metrics) = 'object'
  )
);

create unique index if not exists listing_analytics_source_divergences_one_open_uidx
  on public.listing_analytics_source_divergences(
    marketplace_account_key, marketplace, listing_id, sku
  ) where status = 'open';

create table if not exists public.marketplace_listing_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  expected_sku text not null,
  observed_listing_id text null,
  observed_sku text null,
  observed_listing_status text null,
  item_id_matches boolean not null default false,
  sku_matches boolean not null default false,
  active_listing_confirmed boolean not null default false,
  source text not null,
  error_code text null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_identity_verifications_current_unique unique (
    marketplace_account_key, marketplace, listing_id, expected_sku
  ),
  constraint marketplace_listing_identity_verifications_source_check check (
    source = 'EBAY_TRADING_GET_ITEM_READONLY'
  )
);

create index if not exists listing_commercial_manual_evidence_account_listing_idx
  on public.listing_commercial_manual_evidence(
    marketplace_account_key, marketplace, listing_id, observed_on desc
  );
create index if not exists listing_analytics_source_divergences_recheck_idx
  on public.listing_analytics_source_divergences(
    marketplace_account_key, marketplace, status, next_check_at
  );
create index if not exists marketplace_listing_identity_verifications_health_idx
  on public.marketplace_listing_identity_verifications(
    marketplace_account_key, marketplace, active_listing_confirmed, observed_at desc
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'listing_commercial_manual_evidence',
    'listing_analytics_source_divergences',
    'marketplace_listing_identity_verifications'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to service_role', table_name);
  end loop;
end $$;
