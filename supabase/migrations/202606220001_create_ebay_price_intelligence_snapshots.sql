create table if not exists public.ebay_price_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid null references public.ebay_product_candidates(id) on delete set null,
  market_radar_product_id uuid null,
  supplier_sku text not null,
  candidate_key text null,
  source_type text not null,
  marketplace text not null default 'ebay',
  search_query text null,
  product_match_type text null,
  sold_avg_price numeric(12,2) null,
  sold_median_price numeric(12,2) null,
  sold_min_price numeric(12,2) null,
  sold_max_price numeric(12,2) null,
  sold_comp_count integer null,
  active_avg_price numeric(12,2) null,
  active_min_price numeric(12,2) null,
  active_max_price numeric(12,2) null,
  active_comp_count integer null,
  estimated_shipping_cost numeric(12,2) null,
  recommended_sale_price numeric(12,2) null,
  confidence_score numeric(5,2) null,
  source_confidence text null,
  category_id text null,
  category_name text null,
  evidence_url text null,
  evidence_notes text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_by text null,
  created_at timestamptz not null default now(),
  constraint ebay_price_intelligence_source_type_check check (
    source_type in ('manual', 'aiprice', 'terapeak', 'zik', 'ebay_api', 'other')
  ),
  constraint ebay_price_intelligence_marketplace_check check (
    marketplace = 'ebay'
  ),
  constraint ebay_price_intelligence_source_confidence_check check (
    source_confidence is null or source_confidence in ('low', 'medium', 'high')
  ),
  constraint ebay_price_intelligence_confidence_score_check check (
    confidence_score is null or confidence_score between 0 and 100
  ),
  constraint ebay_price_intelligence_product_match_type_check check (
    product_match_type is null or product_match_type in (
      'exact',
      'same_model',
      'similar',
      'category_only',
      'unknown'
    )
  ),
  constraint ebay_price_intelligence_price_values_check check (
    (sold_avg_price is null or sold_avg_price >= 0) and
    (sold_median_price is null or sold_median_price >= 0) and
    (sold_min_price is null or sold_min_price >= 0) and
    (sold_max_price is null or sold_max_price >= 0) and
    (active_avg_price is null or active_avg_price >= 0) and
    (active_min_price is null or active_min_price >= 0) and
    (active_max_price is null or active_max_price >= 0) and
    (estimated_shipping_cost is null or estimated_shipping_cost >= 0) and
    (recommended_sale_price is null or recommended_sale_price >= 0)
  ),
  constraint ebay_price_intelligence_comp_counts_check check (
    (sold_comp_count is null or sold_comp_count >= 0) and
    (active_comp_count is null or active_comp_count >= 0)
  )
);

create index if not exists ebay_price_intelligence_supplier_sku_idx
  on public.ebay_price_intelligence_snapshots(supplier_sku);

create index if not exists ebay_price_intelligence_candidate_idx
  on public.ebay_price_intelligence_snapshots(candidate_id);

create index if not exists ebay_price_intelligence_market_radar_product_idx
  on public.ebay_price_intelligence_snapshots(market_radar_product_id);

create index if not exists ebay_price_intelligence_created_at_idx
  on public.ebay_price_intelligence_snapshots(created_at desc);

create index if not exists ebay_price_intelligence_source_type_idx
  on public.ebay_price_intelligence_snapshots(source_type);

alter table public.ebay_price_intelligence_snapshots enable row level security;

drop policy if exists "admin manage ebay_price_intelligence_snapshots"
  on public.ebay_price_intelligence_snapshots;

create policy "admin manage ebay_price_intelligence_snapshots"
  on public.ebay_price_intelligence_snapshots
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.ebay_price_intelligence_snapshots
  to authenticated;

notify pgrst, 'reload schema';
