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
  score.price_change_count_7d,
  greatest(0, least(100,
    coalesce(score.opportunity_score, 0) * 0.55 +
    case when snapshot.available is true then 10 else 0 end +
    case when snapshot.inventory_quantity > 0 then 10 else 0 end +
    case when nullif(trim(snapshot.barcode), '') is not null then 10 else 0 end +
    case when nullif(trim(snapshot.sku), '') is not null then 5 else 0 end +
    case when snapshot.weight is not null and snapshot.weight > 0 then 5 else 0 end +
    case when nullif(trim(product.featured_image_url), '') is not null then 5 else 0 end -
    case when concat_ws(' ', product.title, product.product_type, array_to_string(product.tags, ' '))
      ~* '(aerosol|electronics duster|spray paint|striping paint|concrete crack filler|battery|lithium|chemical|pesticide|eyelash growth|baby product)'
      then 25 else 0 end
  ))::numeric(6,2) as seller_scan_priority_score,
  case when concat_ws(' ', product.title, product.product_type, array_to_string(product.tags, ' '))
    ~* '(aerosol|electronics duster|spray paint|striping paint|concrete crack filler|battery|lithium|chemical|pesticide|eyelash growth|baby product)'
    then 'PRE_SCAN_RESTRICTION_REVIEW'
    else null
  end as seller_scan_risk_hint
from public.market_radar_current_variant_snapshots latest
join public.market_radar_snapshots snapshot on snapshot.id = latest.snapshot_id
join public.market_radar_products product on product.id = latest.product_id
join public.market_radar_sources source on source.id = product.source_id
left join public.market_radar_scores score on score.product_id = product.id
where product.is_active = true;

grant select on public.market_radar_latest_variants
  to authenticated, service_role;

notify pgrst, 'reload schema';
