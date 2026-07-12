alter table public.market_radar_snapshots
  add column if not exists barcode text null,
  add column if not exists weight numeric(12, 3) null,
  add column if not exists weight_unit text null;

create index if not exists market_radar_snapshots_barcode_idx
  on public.market_radar_snapshots(barcode)
  where barcode is not null;

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
  score.updated_at as score_updated_at,
  snapshot.barcode,
  snapshot.weight,
  snapshot.weight_unit
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

notify pgrst, 'reload schema';
