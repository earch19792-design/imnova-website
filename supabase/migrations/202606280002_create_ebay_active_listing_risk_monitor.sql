create table if not exists public.ebay_active_listings (
  id uuid primary key default gen_random_uuid(),
  ebay_item_id text not null,
  listing_status text not null default 'active',
  title text not null,
  ebay_sku text null,
  ebay_quantity integer null,
  ebay_price numeric(12,2) null,
  currency text not null default 'USD',
  market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
  supplier_variant_id text null,
  supplier_sku text null,
  last_ebay_sync_at timestamptz null,
  last_radar_review_at timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_active_listings_item_unique unique (ebay_item_id),
  constraint ebay_active_listings_status_check check (
    listing_status in ('active', 'paused', 'ended', 'draft', 'unknown')
  )
);

create table if not exists public.ebay_active_listing_risk_events (
  id uuid primary key default gen_random_uuid(),
  active_listing_id uuid not null references public.ebay_active_listings(id) on delete cascade,
  market_radar_event_id uuid null references public.market_radar_events(id) on delete set null,
  risk_type text not null,
  risk_priority text not null,
  risk_summary text not null,
  recommended_action text not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint ebay_active_listing_risk_type_check check (
    risk_type in ('out_of_stock', 'stock_unknown', 'price_up', 'margin_review', 'listing_stale', 'manual_review')
  ),
  constraint ebay_active_listing_risk_priority_check check (
    risk_priority in ('critical', 'high', 'medium', 'low')
  )
);

create index if not exists ebay_active_listings_status_idx
  on public.ebay_active_listings(listing_status, updated_at desc);

create index if not exists ebay_active_listings_radar_variant_idx
  on public.ebay_active_listings(market_radar_product_id, supplier_variant_id);

create index if not exists ebay_active_listings_supplier_sku_idx
  on public.ebay_active_listings(supplier_sku);

create index if not exists ebay_active_listing_risks_open_priority_idx
  on public.ebay_active_listing_risk_events(resolved_at, risk_priority, created_at desc);

alter table public.ebay_active_listings enable row level security;
alter table public.ebay_active_listing_risk_events enable row level security;

drop policy if exists "admin manage ebay_active_listings" on public.ebay_active_listings;
create policy "admin manage ebay_active_listings"
  on public.ebay_active_listings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage ebay_active_listing_risk_events" on public.ebay_active_listing_risk_events;
create policy "admin manage ebay_active_listing_risk_events"
  on public.ebay_active_listing_risk_events
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.ebay_active_listings to authenticated;
grant select, insert, update, delete on public.ebay_active_listing_risk_events to authenticated;

notify pgrst, 'reload schema';
