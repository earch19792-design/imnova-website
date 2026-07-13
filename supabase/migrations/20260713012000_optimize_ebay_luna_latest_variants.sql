set local statement_timeout = '2min';

create table if not exists public.market_radar_current_variant_snapshots (
  product_id uuid not null references public.market_radar_products(id) on delete cascade,
  supplier_variant_id text not null,
  snapshot_id uuid not null references public.market_radar_snapshots(id) on delete cascade,
  captured_at timestamptz not null,
  primary key (product_id, supplier_variant_id)
);

create unique index if not exists market_radar_current_variant_snapshot_id_idx
  on public.market_radar_current_variant_snapshots(snapshot_id);

create or replace function public.sync_market_radar_current_variant_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.market_radar_current_variant_snapshots (
    product_id,
    supplier_variant_id,
    snapshot_id,
    captured_at
  )
  values (
    new.product_id,
    new.supplier_variant_id,
    new.id,
    new.captured_at
  )
  on conflict (product_id, supplier_variant_id) do update set
    snapshot_id = excluded.snapshot_id,
    captured_at = excluded.captured_at
  where (excluded.captured_at, excluded.snapshot_id) > (
    market_radar_current_variant_snapshots.captured_at,
    market_radar_current_variant_snapshots.snapshot_id
  );

  return new;
end;
$$;

revoke all on function public.sync_market_radar_current_variant_snapshot()
  from public;

drop trigger if exists sync_market_radar_current_variant_snapshot
  on public.market_radar_snapshots;
create trigger sync_market_radar_current_variant_snapshot
  after insert on public.market_radar_snapshots
  for each row
  execute function public.sync_market_radar_current_variant_snapshot();

insert into public.market_radar_current_variant_snapshots (
  product_id,
  supplier_variant_id,
  snapshot_id,
  captured_at
)
select distinct on (snapshot.product_id, snapshot.supplier_variant_id)
  snapshot.product_id,
  snapshot.supplier_variant_id,
  snapshot.id,
  snapshot.captured_at
from public.market_radar_snapshots snapshot
order by
  snapshot.product_id,
  snapshot.supplier_variant_id,
  snapshot.captured_at desc,
  snapshot.id desc
on conflict (product_id, supplier_variant_id) do update set
  snapshot_id = excluded.snapshot_id,
  captured_at = excluded.captured_at
where (excluded.captured_at, excluded.snapshot_id) > (
  market_radar_current_variant_snapshots.captured_at,
  market_radar_current_variant_snapshots.snapshot_id
);

create or replace view public.market_radar_latest_variants
with (security_invoker = true) as
select
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
from public.market_radar_current_variant_snapshots latest
join public.market_radar_snapshots snapshot on snapshot.id = latest.snapshot_id
join public.market_radar_products product on product.id = latest.product_id
join public.market_radar_sources source on source.id = product.source_id
left join public.market_radar_scores score on score.product_id = product.id
where product.is_active = true;

alter table public.market_radar_current_variant_snapshots enable row level security;

drop policy if exists "admin read market radar current variant snapshots"
  on public.market_radar_current_variant_snapshots;
create policy "admin read market radar current variant snapshots"
  on public.market_radar_current_variant_snapshots
  for select
  to authenticated
  using (public.is_admin());

grant select on public.market_radar_current_variant_snapshots
  to authenticated, service_role;
grant select on public.market_radar_latest_variants
  to authenticated, service_role;

analyze public.market_radar_current_variant_snapshots;

notify pgrst, 'reload schema';
