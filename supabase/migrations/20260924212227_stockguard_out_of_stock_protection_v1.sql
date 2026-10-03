create table public.seller_os_stockguard_oos_protection_v1 (
  receipt_id uuid primary key default gen_random_uuid(),
  contract_version text not null default 'STOCKGUARD_OUT_OF_STOCK_PROTECTION_V1'
    check (contract_version = 'STOCKGUARD_OUT_OF_STOCK_PROTECTION_V1'),
  seller_account text not null,
  marketplace text not null check (marketplace = 'EBAY_US'),
  item_id text not null check (item_id ~ '^[0-9]{9,20}$'),
  supplier_sku text not null,
  product_id text not null check (product_id ~ '^[0-9]{1,30}$'),
  variant_id text not null check (variant_id ~ '^[0-9]{1,30}$'),
  source_stock_receipt_id text not null,
  source_stock_state text not null check (source_stock_state = 'EXPLICIT_PROVEN_OUT_OF_STOCK'),
  source_observed_at timestamptz not null,
  source_fresh_until timestamptz not null,
  previous_official_quantity integer not null check (previous_official_quantity >= 0),
  requested_quantity integer not null default 0 check (requested_quantity = 0),
  official_readback_quantity integer null check (official_readback_quantity >= 0),
  protection_attempted_at timestamptz not null default clock_timestamp(),
  protection_confirmed_at timestamptz null,
  protection_status text not null check (protection_status in
    ('PENDING','NO_OP_CONFIRMED','APPLIED_CONFIRMED',
     'PROTECTION_BLOCKED','PROTECTION_WRITE_UNCONFIRMED')),
  limitation_code text null,
  idempotency_key text not null unique
    check (idempotency_key ~ '^stockguard-oos-v1:sha256:[0-9a-f]{64}$'),
  constraint stockguard_oos_protection_time_check check (
    source_observed_at < source_fresh_until and
    protection_attempted_at < source_fresh_until and
    (protection_confirmed_at is null or
      protection_confirmed_at >= protection_attempted_at)),
  constraint stockguard_oos_protection_readback_check check (
    (protection_status in ('APPLIED_CONFIRMED','NO_OP_CONFIRMED') and
      official_readback_quantity = 0 and protection_confirmed_at is not null)
    or
    (protection_status in ('PENDING','PROTECTION_BLOCKED',
      'PROTECTION_WRITE_UNCONFIRMED') and
      protection_confirmed_at is null))
);

create index seller_os_stockguard_oos_protection_item_idx
  on public.seller_os_stockguard_oos_protection_v1
  (seller_account, marketplace, item_id, protection_attempted_at desc);

alter table public.seller_os_stockguard_oos_protection_v1 enable row level security;
alter table public.seller_os_stockguard_oos_protection_v1 force row level security;
revoke all on public.seller_os_stockguard_oos_protection_v1
  from public, anon, authenticated, service_role;
grant select, insert, update on public.seller_os_stockguard_oos_protection_v1
  to service_role;
create policy seller_os_stockguard_oos_protection_service_role
  on public.seller_os_stockguard_oos_protection_v1
  for all to service_role using (true) with check (true);
