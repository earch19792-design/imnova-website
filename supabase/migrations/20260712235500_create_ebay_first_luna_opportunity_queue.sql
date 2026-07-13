create or replace view public.market_radar_latest_variants
with (security_invoker = true) as
select distinct on (snapshot.product_id, snapshot.supplier_variant_id)
  product.id as product_id,
  product.source_id,
  source.key as source_key,
  product.supplier_product_id,
  product.title,
  product.vendor,
  product.product_type,
  product.tags,
  product.product_url,
  product.featured_image_url,
  product.image_urls,
  product.metadata,
  snapshot.id as snapshot_id,
  snapshot.supplier_variant_id,
  snapshot.variant_title,
  snapshot.sku,
  snapshot.barcode,
  snapshot.price,
  snapshot.compare_at_price,
  snapshot.available,
  snapshot.inventory_quantity,
  snapshot.weight,
  snapshot.weight_unit,
  snapshot.captured_at,
  score.opportunity_score as radar_opportunity_score,
  score.restock_count_7d,
  score.out_of_stock_count_7d,
  score.price_change_count_7d
from public.market_radar_snapshots snapshot
join public.market_radar_products product on product.id = snapshot.product_id
join public.market_radar_sources source on source.id = product.source_id
left join public.market_radar_scores score on score.product_id = product.id
where product.is_active = true
order by snapshot.product_id, snapshot.supplier_variant_id, snapshot.captured_at desc;

create table if not exists public.ebay_luna_scan_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  scan_mode text not null default 'hybrid',
  category_ids text[] not null default '{}'::text[],
  total_candidates integer not null default 0,
  processed_candidates integer not null default 0,
  next_offset integer not null default 0,
  successful_candidates integer not null default 0,
  failed_candidates integer not null default 0,
  best_selling_signals_found integer not null default 0,
  last_error text null,
  started_at timestamptz not null default now(),
  last_batch_at timestamptz null,
  completed_at timestamptz null,
  created_by uuid null,
  constraint ebay_luna_scan_runs_status_check check (
    status in ('running', 'completed', 'paused', 'failed')
  ),
  constraint ebay_luna_scan_runs_mode_check check (
    scan_mode in ('hybrid', 'luna_coverage', 'ebay_first_refresh')
  )
);

create table if not exists public.ebay_luna_best_selling_signals (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique,
  category_id text not null,
  epid text null,
  title text not null,
  image_url text null,
  average_rating numeric(6,2) null,
  rating_count integer null,
  review_count integer null,
  discovery_status text not null default 'available',
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  raw_signal jsonb not null default '{}'::jsonb
);

create table if not exists public.ebay_luna_opportunity_queue (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,
  market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
  supplier_product_id text null,
  supplier_variant_id text null,
  supplier_sku text null,
  product_title text not null,
  variant_title text null,
  gtin text null,
  queue_status text not null default 'watchlist',
  decision text not null,
  opportunity_score numeric(6,2) not null default 0,
  demand_score numeric(6,2) not null default 0,
  economics_score numeric(6,2) not null default 0,
  identity_score numeric(6,2) not null default 0,
  competition_score numeric(6,2) not null default 0,
  supply_score numeric(6,2) not null default 0,
  listing_readiness_score numeric(6,2) not null default 0,
  active_comparables integer not null default 0,
  sellers_with_movement integer not null default 0,
  estimated_weekly_velocity numeric(12,2) null,
  median_total_buyer_price numeric(12,2) null,
  estimated_net_profit numeric(12,2) null,
  supplier_price numeric(12,2) null,
  supplier_available boolean null,
  supplier_inventory_quantity integer null,
  supplier_snapshot_at timestamptz null,
  best_selling_match_score numeric(6,2) null,
  best_selling_matches jsonb not null default '[]'::jsonb,
  keyword_structure jsonb not null default '{}'::jsonb,
  hard_gates text[] not null default '{}'::text[],
  evidence_guards text[] not null default '{}'::text[],
  assessment jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  next_scan_at timestamptz not null default (now() + interval '1 day'),
  updated_at timestamptz not null default now(),
  constraint ebay_luna_opportunity_queue_status_check check (
    queue_status in ('watchlist', 'review', 'ready', 'hold', 'rejected', 'listed', 'archived')
  )
);

create table if not exists public.ebay_luna_opportunity_queue_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete cascade,
  event_type text not null,
  old_value jsonb null,
  new_value jsonb null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint ebay_luna_opportunity_queue_event_type_check check (
    event_type in ('discovered', 'rescored', 'price_up', 'price_down', 'out_of_stock', 'restocked', 'stock_changed', 'listed', 'status_changed')
  )
);

create index if not exists ebay_luna_scan_runs_status_time_idx
  on public.ebay_luna_scan_runs(status, started_at desc);
create index if not exists ebay_luna_queue_rank_idx
  on public.ebay_luna_opportunity_queue(queue_status, opportunity_score desc, last_scanned_at desc);
create index if not exists ebay_luna_queue_next_scan_idx
  on public.ebay_luna_opportunity_queue(next_scan_at, opportunity_score desc);
create index if not exists ebay_luna_queue_radar_variant_idx
  on public.ebay_luna_opportunity_queue(market_radar_product_id, supplier_variant_id);
create index if not exists ebay_luna_queue_events_time_idx
  on public.ebay_luna_opportunity_queue_events(created_at desc);

alter table public.ebay_luna_scan_runs enable row level security;
alter table public.ebay_luna_best_selling_signals enable row level security;
alter table public.ebay_luna_opportunity_queue enable row level security;
alter table public.ebay_luna_opportunity_queue_events enable row level security;

create policy "admin manage ebay luna scan runs" on public.ebay_luna_scan_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage ebay luna best selling signals" on public.ebay_luna_best_selling_signals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage ebay luna opportunity queue" on public.ebay_luna_opportunity_queue
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage ebay luna opportunity queue events" on public.ebay_luna_opportunity_queue_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.market_radar_latest_variants to authenticated, service_role;
grant select, insert, update, delete on
  public.ebay_luna_scan_runs,
  public.ebay_luna_best_selling_signals,
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events
to authenticated;

notify pgrst, 'reload schema';
