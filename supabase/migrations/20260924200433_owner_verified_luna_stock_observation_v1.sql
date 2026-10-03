create table public.seller_os_owner_luna_stock_observations_v1 (
  observation_id uuid primary key default gen_random_uuid(),
  contract_version text not null default 'OWNER_VERIFIED_LUNA_STOCK_OBSERVATION_V1'
    check (contract_version = 'OWNER_VERIFIED_LUNA_STOCK_OBSERVATION_V1'),
  account_key text not null check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
  marketplace_id text not null default 'EBAY_US' check (marketplace_id = 'EBAY_US'),
  ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
  linkage_id text not null check (linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'),
  luna_sku text not null check (luna_sku ~ '^[A-Za-z0-9._-]{1,120}$'),
  luna_product_id text not null check (luna_product_id ~ '^[0-9]{1,30}$'),
  luna_variant_id text not null check (luna_variant_id ~ '^[0-9]{1,30}$'),
  observed_stock_state text not null
    check (observed_stock_state in ('IN_STOCK','OUT_OF_STOCK')),
  observed_supplier_quantity integer null
    check (observed_supplier_quantity between 0 and 1000000),
  quantity_explicitly_visible boolean not null default false,
  observed_at timestamptz not null,
  owner_confirmed_at timestamptz not null default clock_timestamp(),
  source text not null default 'LUNA_OWNER_VISIBLE_SOURCE'
    check (source = 'LUNA_OWNER_VISIBLE_SOURCE'),
  actor_user_id uuid not null,
  maximum_age_seconds integer not null check (maximum_age_seconds between 60 and 21600),
  constraint owner_stock_quantity_visibility_check check (
    (observed_supplier_quantity is null and not quantity_explicitly_visible)
    or (observed_supplier_quantity is not null and quantity_explicitly_visible)
  ),
  constraint owner_stock_state_quantity_check check (
    observed_supplier_quantity is null or
    (observed_stock_state = 'IN_STOCK' and observed_supplier_quantity > 0) or
    (observed_stock_state = 'OUT_OF_STOCK' and observed_supplier_quantity = 0)
  ),
  constraint owner_stock_time_check check (
    observed_at <= owner_confirmed_at and
    observed_at >= owner_confirmed_at - interval '5 minutes'
  )
);

create index seller_os_owner_luna_stock_observations_v1_latest_idx
  on public.seller_os_owner_luna_stock_observations_v1
  (account_key, marketplace_id, ebay_item_id, observed_at desc);

create trigger seller_os_owner_luna_stock_observations_v1_immutable
before update or delete on public.seller_os_owner_luna_stock_observations_v1
for each row execute function
  public.prevent_seller_os_luna_stock_observation_mutation_v1();

alter table public.seller_os_owner_luna_stock_observations_v1
  enable row level security;
alter table public.seller_os_owner_luna_stock_observations_v1
  force row level security;
revoke all on table public.seller_os_owner_luna_stock_observations_v1
  from public, anon, authenticated, service_role;
grant select, insert on table public.seller_os_owner_luna_stock_observations_v1
  to service_role;
create policy seller_os_owner_luna_stock_observations_v1_service_role
  on public.seller_os_owner_luna_stock_observations_v1
  for all to service_role using (true) with check (true);
