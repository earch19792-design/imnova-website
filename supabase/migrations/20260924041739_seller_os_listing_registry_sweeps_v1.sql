-- Records exactly which official EBAY_US item set was reconciled. A pending
-- sweep never certifies the UI; completed sweeps retain their history.
create table public.seller_os_listing_registry_sweeps_v1 (
  sweep_id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null check (marketplace_id = 'EBAY_US'),
  source_authority text not null check
    (source_authority = 'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'),
  official_observed_at timestamptz not null,
  official_live_item_count integer not null check (official_live_item_count >= 0),
  reconciled_item_count integer check (reconciled_item_count >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETE')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_registry_sweep_complete_v1 check (
    (status = 'PENDING' and reconciled_item_count is null and completed_at is null)
    or (status = 'COMPLETE' and reconciled_item_count = official_live_item_count
        and completed_at is not null)
  )
);
create index seller_os_listing_registry_sweeps_account_v1
  on public.seller_os_listing_registry_sweeps_v1
    (account_key, marketplace_id, completed_at desc)
  where status = 'COMPLETE';

alter table public.seller_os_listing_cases_v1
  add column last_reconciled_sweep_id uuid references
    public.seller_os_listing_registry_sweeps_v1(sweep_id) on delete restrict;
create index seller_os_listing_cases_sweep_v1
  on public.seller_os_listing_cases_v1(last_reconciled_sweep_id)
  where last_reconciled_sweep_id is not null;

alter table public.seller_os_listing_registry_sweeps_v1 enable row level security;
revoke all on public.seller_os_listing_registry_sweeps_v1 from anon, authenticated;
grant select, insert, update on public.seller_os_listing_registry_sweeps_v1 to service_role;
