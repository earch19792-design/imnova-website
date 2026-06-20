create extension if not exists pgcrypto;

create table if not exists public.market_radar_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  base_url text not null,
  is_active boolean not null default true,
  poll_interval_minutes integer not null default 15,
  last_run_at timestamptz null,
  last_success_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_radar_sources_key_unique unique (key),
  constraint market_radar_sources_poll_interval_check
    check (poll_interval_minutes between 1 and 1440)
);

create table if not exists public.market_radar_products (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_radar_sources(id) on delete cascade,
  supplier_product_id text not null,
  handle text not null,
  title text not null,
  vendor text null,
  product_type text null,
  tags text[] not null default '{}'::text[],
  body_html text null,
  product_url text null,
  featured_image_url text null,
  image_urls text[] not null default '{}'::text[],
  created_at_source timestamptz null,
  updated_at_source timestamptz null,
  published_at_source timestamptz null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_snapshot_at timestamptz null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_radar_products_source_supplier_unique
    unique (source_id, supplier_product_id),
  constraint market_radar_products_source_handle_unique
    unique (source_id, handle)
);

create table if not exists public.market_radar_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_radar_sources(id) on delete cascade,
  product_id uuid not null references public.market_radar_products(id) on delete cascade,
  supplier_variant_id text not null,
  variant_title text null,
  sku text null,
  price numeric(12, 2) null,
  compare_at_price numeric(12, 2) null,
  available boolean null,
  inventory_quantity integer null,
  collections text[] not null default '{}'::text[],
  discount_percent numeric(6, 2) null,
  raw jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists public.market_radar_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_radar_sources(id) on delete cascade,
  product_id uuid not null references public.market_radar_products(id) on delete cascade,
  supplier_variant_id text not null,
  event_type text not null,
  old_value jsonb null,
  new_value jsonb null,
  event_strength integer not null default 1,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint market_radar_events_type_check
    check (
      event_type in (
        'new_product',
        'restocked',
        'out_of_stock',
        'price_up',
        'price_down',
        'entered_collection',
        'exited_collection',
        'discount_started',
        'discount_ended'
      )
    ),
  constraint market_radar_events_strength_check
    check (event_strength between 1 and 5),
  constraint market_radar_events_idempotency_unique unique (idempotency_key)
);

create table if not exists public.market_radar_scores (
  product_id uuid primary key references public.market_radar_products(id) on delete cascade,
  source_id uuid not null references public.market_radar_sources(id) on delete cascade,
  opportunity_score numeric(6, 2) not null default 0,
  rotation_score numeric(6, 2) not null default 0,
  price_score numeric(6, 2) not null default 0,
  stock_score numeric(6, 2) not null default 0,
  discount_score numeric(6, 2) not null default 0,
  collection_score numeric(6, 2) not null default 0,
  event_count_24h integer not null default 0,
  event_count_7d integer not null default 0,
  restock_count_7d integer not null default 0,
  out_of_stock_count_7d integer not null default 0,
  price_change_count_7d integer not null default 0,
  last_event_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists market_radar_sources_key_idx
  on public.market_radar_sources(key);

create index if not exists market_radar_products_source_seen_idx
  on public.market_radar_products(source_id, last_seen_at desc);

create index if not exists market_radar_products_handle_idx
  on public.market_radar_products(handle);

create index if not exists market_radar_snapshots_product_variant_captured_idx
  on public.market_radar_snapshots(product_id, supplier_variant_id, captured_at desc);

create index if not exists market_radar_snapshots_source_captured_idx
  on public.market_radar_snapshots(source_id, captured_at desc);

create index if not exists market_radar_events_source_created_idx
  on public.market_radar_events(source_id, created_at desc);

create index if not exists market_radar_events_product_created_idx
  on public.market_radar_events(product_id, created_at desc);

create index if not exists market_radar_events_type_idx
  on public.market_radar_events(event_type);

create index if not exists market_radar_scores_source_score_idx
  on public.market_radar_scores(source_id, opportunity_score desc);

drop trigger if exists set_market_radar_sources_updated_at
  on public.market_radar_sources;
create trigger set_market_radar_sources_updated_at
  before update on public.market_radar_sources
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_market_radar_products_updated_at
  on public.market_radar_products;
create trigger set_market_radar_products_updated_at
  before update on public.market_radar_products
  for each row
  execute function public.set_updated_at();

create or replace view public.market_radar_latest_snapshots as
select distinct on (product_id, supplier_variant_id)
  *
from public.market_radar_snapshots
order by product_id, supplier_variant_id, captured_at desc;

create or replace view public.market_radar_latest_products as
select
  product.id as product_id,
  product.source_id,
  source.key as source_key,
  source.name as source_name,
  product.supplier_product_id,
  product.handle,
  product.title,
  product.vendor,
  product.product_type,
  product.tags,
  product.product_url,
  product.featured_image_url,
  product.image_urls,
  product.first_seen_at,
  product.last_seen_at,
  product.updated_at_source,
  snapshot.id as snapshot_id,
  snapshot.supplier_variant_id,
  snapshot.variant_title,
  snapshot.sku,
  snapshot.price,
  snapshot.compare_at_price,
  snapshot.available,
  snapshot.inventory_quantity,
  snapshot.collections,
  snapshot.discount_percent,
  snapshot.captured_at as last_captured_at,
  score.opportunity_score,
  score.rotation_score,
  score.price_score,
  score.stock_score,
  score.discount_score,
  score.collection_score,
  score.event_count_24h,
  score.event_count_7d,
  score.restock_count_7d,
  score.out_of_stock_count_7d,
  score.price_change_count_7d,
  score.last_event_at,
  score.updated_at as score_updated_at
from public.market_radar_products product
join public.market_radar_sources source
  on source.id = product.source_id
left join lateral (
  select snapshot_row.*
  from public.market_radar_snapshots snapshot_row
  where snapshot_row.product_id = product.id
  order by snapshot_row.captured_at desc
  limit 1
) snapshot on true
left join public.market_radar_scores score
  on score.product_id = product.id;

insert into public.market_radar_sources (
  key,
  name,
  base_url,
  poll_interval_minutes
)
values (
  'lunaportex',
  'Luna Portex',
  'https://lunaportex.com',
  15
)
on conflict (key) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  poll_interval_minutes = excluded.poll_interval_minutes,
  updated_at = now();

alter table public.market_radar_sources enable row level security;
alter table public.market_radar_products enable row level security;
alter table public.market_radar_snapshots enable row level security;
alter table public.market_radar_events enable row level security;
alter table public.market_radar_scores enable row level security;

drop policy if exists "admin manage market radar sources"
  on public.market_radar_sources;
create policy "admin manage market radar sources"
  on public.market_radar_sources
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage market radar products"
  on public.market_radar_products;
create policy "admin manage market radar products"
  on public.market_radar_products
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage market radar snapshots"
  on public.market_radar_snapshots;
create policy "admin manage market radar snapshots"
  on public.market_radar_snapshots
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage market radar events"
  on public.market_radar_events;
create policy "admin manage market radar events"
  on public.market_radar_events
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage market radar scores"
  on public.market_radar_scores;
create policy "admin manage market radar scores"
  on public.market_radar_scores
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on
  public.market_radar_sources,
  public.market_radar_products,
  public.market_radar_snapshots,
  public.market_radar_events,
  public.market_radar_scores
to authenticated;

grant select on
  public.market_radar_latest_snapshots,
  public.market_radar_latest_products
to service_role;

notify pgrst, 'reload schema';
