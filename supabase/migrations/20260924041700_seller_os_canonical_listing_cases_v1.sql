-- One durable identity per seller account, marketplace and eBay Item ID.
-- eBay snapshots, manual registrations, publications and StockGuard authorities
-- remain the evidence sources; this table is their reconciled operational case.
create table public.seller_os_listing_cases_v1 (
  case_id uuid primary key default gen_random_uuid(),
  account_key text not null check (length(account_key) between 3 and 240),
  marketplace_id text not null check (marketplace_id = 'EBAY_US'),
  ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
  ebay_custom_label text,
  supplier_sku text,
  luna_product_id text,
  luna_variant_id text,
  opportunity_id uuid,
  listing_package_id uuid,
  origin text not null check (origin in ('SELLER_OS', 'MANUAL_EBAY', 'IMPORTED_LEGACY')),
  listing_status text not null check (listing_status in ('ACTIVE', 'ENDED', 'UNKNOWN')),
  identity_status text not null check (identity_status in
    ('LINKED_EXACT', 'LINKABLE_EXACT', 'AMBIGUOUS', 'MISSING_LUNA_IDENTITY',
     'DUPLICATE_IDENTITY', 'NEEDS_OWNER_REVIEW')),
  stockguard_link_status text not null check (stockguard_link_status in
    ('LINKED_ACTIVE', 'LINKED_MONITOR_ONLY', 'BLOCKED_IDENTITY',
     'BLOCKED_STOCK_SOURCE', 'NEEDS_OWNER_REVIEW')),
  stockguard_authority_id text,
  next_blocker text,
  identity_source text not null,
  ebay_observed_at timestamptz not null,
  reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_listing_cases_unique_item_v1 unique
    (account_key, marketplace_id, ebay_item_id),
  constraint seller_os_listing_cases_tuple_v1 check (
    (luna_product_id is null and luna_variant_id is null and supplier_sku is null)
    or (luna_product_id is not null and luna_variant_id is not null and supplier_sku is not null)
  ),
  constraint seller_os_listing_cases_exact_v1 check (
    identity_status <> 'LINKED_EXACT' or
    (ebay_custom_label is not null and luna_product_id is not null
     and stockguard_authority_id is not null)
  )
);

create index seller_os_listing_cases_account_status_v1
  on public.seller_os_listing_cases_v1(account_key, marketplace_id, listing_status, identity_status);
create index seller_os_listing_cases_stockguard_v1
  on public.seller_os_listing_cases_v1(account_key, marketplace_id, stockguard_link_status);

create table public.seller_os_listing_case_events_v1 (
  event_id bigint generated always as identity primary key,
  case_id uuid not null references public.seller_os_listing_cases_v1(case_id) on delete restrict,
  event_type text not null check (event_type in ('CREATED', 'RECONCILED')),
  previous_state jsonb,
  current_state jsonb not null,
  recorded_at timestamptz not null default now()
);
create index seller_os_listing_case_events_case_v1
  on public.seller_os_listing_case_events_v1(case_id, event_id desc);

create function public.seller_os_listing_case_history_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.case_id is distinct from old.case_id or
       new.account_key is distinct from old.account_key or
       new.marketplace_id is distinct from old.marketplace_id or
       new.ebay_item_id is distinct from old.ebay_item_id or
       new.created_at is distinct from old.created_at then
      raise exception 'LISTING_CASE_IMMUTABLE_IDENTITY';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger seller_os_listing_case_before_v1
  before update on public.seller_os_listing_cases_v1
  for each row execute function public.seller_os_listing_case_history_v1();

create function public.seller_os_listing_case_event_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.seller_os_listing_case_events_v1
    (case_id, event_type, previous_state, current_state)
  values (new.case_id, case when tg_op = 'INSERT' then 'CREATED' else 'RECONCILED' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;
create trigger seller_os_listing_case_event_after_v1
  after insert or update on public.seller_os_listing_cases_v1
  for each row execute function public.seller_os_listing_case_event_v1();

alter table public.seller_os_listing_cases_v1 enable row level security;
alter table public.seller_os_listing_case_events_v1 enable row level security;
revoke all on public.seller_os_listing_cases_v1 from anon, authenticated;
revoke all on public.seller_os_listing_case_events_v1 from anon, authenticated;
revoke all on sequence public.seller_os_listing_case_events_v1_event_id_seq from anon, authenticated;
revoke all on function public.seller_os_listing_case_history_v1() from public, anon, authenticated;
revoke all on function public.seller_os_listing_case_event_v1() from public, anon, authenticated;
grant select, insert, update on public.seller_os_listing_cases_v1 to service_role;
grant select, insert on public.seller_os_listing_case_events_v1 to service_role;
grant usage on sequence public.seller_os_listing_case_events_v1_event_id_seq to service_role;
grant execute on function public.seller_os_listing_case_history_v1() to service_role;
grant execute on function public.seller_os_listing_case_event_v1() to service_role;
