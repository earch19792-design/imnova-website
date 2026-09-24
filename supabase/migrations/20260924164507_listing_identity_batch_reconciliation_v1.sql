-- Images are presentation evidence only; Item ID and supplier tuple remain identity.
alter table public.seller_os_listing_cases_v1
  add column ebay_image_url text;

create table public.seller_os_listing_identity_batches_v1 (
  batch_id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null default 'EBAY_US'
    check (marketplace_id = 'EBAY_US'),
  sweep_id uuid not null references public.seller_os_listing_registry_sweeps_v1(sweep_id),
  actor_user_id uuid not null,
  requested_item_ids text[] not null check (cardinality(requested_item_ids) between 1 and 200),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETE', 'PARTIAL')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint listing_identity_batch_status_v1 check (
    (status = 'PENDING' and completed_at is null) or
    (status <> 'PENDING' and completed_at is not null))
);

create table public.seller_os_listing_identity_batch_receipts_v1 (
  batch_id uuid not null references public.seller_os_listing_identity_batches_v1(batch_id)
    on delete restrict,
  case_id uuid not null references public.seller_os_listing_cases_v1(case_id)
    on delete restrict,
  ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
  owner_event_id bigint not null unique
    references public.seller_os_listing_case_events_v1(event_id) on delete restrict,
  authority_id text not null references
    public.seller_os_listing_product_link_authorities_v1(authority_id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (batch_id, case_id),
  unique (batch_id, ebay_item_id)
);
create index listing_identity_batch_account_v1
  on public.seller_os_listing_identity_batches_v1
    (account_key, marketplace_id, created_at desc);

alter table public.seller_os_listing_identity_batches_v1 enable row level security;
alter table public.seller_os_listing_identity_batch_receipts_v1 enable row level security;
revoke all on public.seller_os_listing_identity_batches_v1 from anon, authenticated;
revoke all on public.seller_os_listing_identity_batch_receipts_v1 from anon, authenticated;
grant select, insert, update on public.seller_os_listing_identity_batches_v1 to service_role;
grant select, insert on public.seller_os_listing_identity_batch_receipts_v1 to service_role;
