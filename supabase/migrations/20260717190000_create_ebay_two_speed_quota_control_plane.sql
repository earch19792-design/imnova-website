-- Seller OS Preview: persistent read-only quota and two-speed discovery control plane.
-- No eBay write capability is introduced by this migration.

create table if not exists public.ebay_api_quota_states (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null default 'EBAY_US',
  api_family text not null,
  operation text not null,
  quota_source text not null default 'UNKNOWN',
  daily_limit integer,
  consumed integer not null default 0 check (consumed >= 0),
  remaining integer,
  reset_at timestamptz,
  reserved_budget integer not null default 0 check (reserved_budget >= 0),
  available_budget integer not null default 0 check (available_budget >= 0),
  status text not null default 'UNKNOWN' check (status in ('AVAILABLE','LOW','EXHAUSTED','PAUSED_429','UNKNOWN')),
  owner_lane text not null,
  last_refreshed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (marketplace, api_family, operation)
);

create table if not exists public.ebay_api_quota_events (
  id uuid primary key default gen_random_uuid(),
  quota_state_id uuid references public.ebay_api_quota_states(id) on delete restrict,
  api_family text not null,
  endpoint text not null,
  http_status integer not null,
  retry_after_seconds integer,
  rate_limit_reset_at timestamptz,
  observed_at timestamptz not null,
  pause_started_at timestamptz not null,
  resume_at timestamptz,
  affected_lane text not null,
  checkpoint jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ebay_discovery_family_cache (
  id uuid primary key default gen_random_uuid(),
  family_fingerprint text not null,
  query_fingerprint text not null,
  query_strategy text not null,
  category_id text,
  result_count integer not null default 0,
  minimum_landed_price numeric,
  maximum_landed_price numeric,
  seller_count integer,
  exact_compatible_signal_count integer not null default 0,
  aggregate_signals jsonb not null default '{}'::jsonb,
  source_call_count integer not null default 1 check (source_call_count between 0 and 2),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (family_fingerprint, query_fingerprint, observed_at)
);

create index if not exists ebay_discovery_family_cache_lookup_idx
  on public.ebay_discovery_family_cache (family_fingerprint, query_fingerprint, expires_at desc);

create table if not exists public.ebay_readonly_detail_cache (
  id uuid primary key default gen_random_uuid(),
  api_family text not null,
  resource_fingerprint text not null,
  safe_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (api_family, resource_fingerprint, observed_at),
  check (api_family in ('BROWSE_ITEM_DETAIL','TAXONOMY'))
);

create index if not exists ebay_readonly_detail_cache_lookup_idx
  on public.ebay_readonly_detail_cache (api_family, resource_fingerprint, expires_at desc);

alter table public.ebay_api_quota_states enable row level security;
alter table public.ebay_api_quota_states force row level security;
alter table public.ebay_api_quota_events enable row level security;
alter table public.ebay_api_quota_events force row level security;
alter table public.ebay_discovery_family_cache enable row level security;
alter table public.ebay_discovery_family_cache force row level security;
alter table public.ebay_readonly_detail_cache enable row level security;
alter table public.ebay_readonly_detail_cache force row level security;

revoke all on table public.ebay_api_quota_states from anon, authenticated;
revoke all on table public.ebay_api_quota_events from anon, authenticated;
revoke all on table public.ebay_discovery_family_cache from anon, authenticated;
revoke all on table public.ebay_readonly_detail_cache from anon, authenticated;
grant all on public.ebay_api_quota_states to service_role;
grant all on public.ebay_api_quota_events to service_role;
grant all on public.ebay_discovery_family_cache to service_role;
grant all on public.ebay_readonly_detail_cache to service_role;

insert into public.ebay_api_quota_states
  (api_family, operation, quota_source, reserved_budget, available_budget, status, owner_lane)
values
  ('SELL', 'ORDERS_MONITOR', 'PROTECTED_INTERNAL_BUDGET', 500, 500, 'UNKNOWN', 'P0_ORDERS'),
  ('TRADING', 'ACTIVE_LISTING_PROTECTION', 'PROTECTED_INTERNAL_BUDGET', 250, 250, 'UNKNOWN', 'P0_PROTECTION'),
  ('ANALYTICS', 'TRAFFIC_MONITOR', 'PROTECTED_INTERNAL_BUDGET', 250, 250, 'UNKNOWN', 'P0_COMMERCIAL_MONITOR'),
  ('MARKETING', 'WATCHCOUNT_MONITOR', 'PROTECTED_INTERNAL_BUDGET', 250, 250, 'UNKNOWN', 'P0_COMMERCIAL_MONITOR'),
  ('BROWSE', 'EXACT_VERIFICATION', 'EBAY_APPLICATION_RATE_LIMIT', 300, 0, 'UNKNOWN', 'P1_EXACT_VERIFICATION'),
  ('BROWSE', 'LIGHTWEIGHT_DISCOVERY', 'EBAY_APPLICATION_RATE_LIMIT', 0, 0, 'UNKNOWN', 'P2_DISCOVERY'),
  ('BROWSE', 'DEEP_EXPLORATION', 'EBAY_APPLICATION_RATE_LIMIT', 0, 0, 'UNKNOWN', 'P3_DEEP_ANALYSIS'),
  ('TAXONOMY', 'CATEGORY_REQUIREMENTS', 'EBAY_APPLICATION_RATE_LIMIT', 100, 0, 'UNKNOWN', 'P1_EXACT_VERIFICATION')
on conflict (marketplace, api_family, operation) do nothing;
