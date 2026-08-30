-- Durable, exact-identity Luna shipping quote evidence for already-LIVE eBay
-- listings. This is deliberately independent of opportunity/package/frontier
-- lineage: a LIVE listing must not be fabricated into a profitability
-- candidate merely to persist a supplier shipping fact.

create table public.seller_os_live_listing_shipping_evidence (
  evidence_id text primary key,
  account_key text not null,
  marketplace_id text not null,
  ebay_item_id text not null,
  linkage_id text not null,
  luna_product_id text not null,
  luna_variant_id text not null,
  source_sku text not null,
  destination_fingerprint text not null,
  supplier_subtotal numeric(12,2) not null,
  supplier_currency text not null,
  shipping_cost numeric(12,2) not null,
  shipping_currency text not null,
  observed_at timestamptz not null,
  maximum_age_seconds integer not null,
  source_authority text not null,
  source_evidence_digest text not null,
  purchase_performed boolean not null default false,
  payment_performed boolean not null default false,
  raw_address_persisted boolean not null default false,
  credentials_persisted boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_live_listing_shipping_evidence_id_check check (
    evidence_id ~
      '^live-listing-luna-shipping-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_account_check check (
    length(account_key) between 1 and 240
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint seller_os_live_listing_shipping_evidence_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_live_listing_shipping_evidence_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_linkage_check check (
    linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_identity_check check (
    luna_product_id ~ '^[0-9]{8,24}$'
    and luna_variant_id ~ '^[0-9]{8,24}$'
    and source_sku ~ '^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_destination_check check (
    destination_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_money_check check (
    supplier_subtotal >= 0 and shipping_cost >= 0
    and supplier_currency = shipping_currency
    and shipping_currency = 'USD'
  ),
  constraint seller_os_live_listing_shipping_evidence_freshness_check check (
    maximum_age_seconds = 21600
  ),
  constraint seller_os_live_listing_shipping_evidence_source_check check (
    source_authority in (
      'LUNA_AUTHENTICATED_HTTP_CART_SHIPPING',
      'LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING'
    )
    and source_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_listing_shipping_evidence_safety_check check (
    purchase_performed is false
    and payment_performed is false
    and raw_address_persisted is false
    and credentials_persisted is false
  ),
  constraint seller_os_live_listing_shipping_evidence_logical_unique unique (
    account_key, marketplace_id, ebay_item_id, linkage_id,
    source_evidence_digest
  )
);

create index seller_os_live_listing_shipping_evidence_latest_idx
  on public.seller_os_live_listing_shipping_evidence (
    account_key, marketplace_id, ebay_item_id, observed_at desc
  );

create or replace function public.prevent_live_listing_shipping_evidence_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'LIVE_LISTING_SHIPPING_EVIDENCE_IMMUTABLE';
end;
$$;

create trigger seller_os_live_listing_shipping_evidence_immutable
before update or delete on public.seller_os_live_listing_shipping_evidence
for each row execute function
  public.prevent_live_listing_shipping_evidence_mutation_v1();

alter table public.seller_os_live_listing_shipping_evidence
  enable row level security;
alter table public.seller_os_live_listing_shipping_evidence
  force row level security;

revoke all on table public.seller_os_live_listing_shipping_evidence
  from public, anon, authenticated;
grant select, insert on table public.seller_os_live_listing_shipping_evidence
  to service_role;

create policy seller_os_live_listing_shipping_evidence_service_role
  on public.seller_os_live_listing_shipping_evidence
  for all
  to service_role
  using (true)
  with check (true);

revoke all on function
  public.prevent_live_listing_shipping_evidence_mutation_v1()
  from public, anon, authenticated;
grant execute on function
  public.prevent_live_listing_shipping_evidence_mutation_v1()
  to service_role;

comment on table public.seller_os_live_listing_shipping_evidence is
  'Append-only, exact Item-ID/Luna-lineage shipping quote evidence. Stores no raw address, cookie, credential, purchase or payment data.';

notify pgrst, 'reload schema';
