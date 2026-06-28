create index if not exists market_radar_snapshots_source_sku_idx
  on public.market_radar_snapshots(source_id, sku);

create index if not exists market_radar_snapshots_source_variant_idx
  on public.market_radar_snapshots(source_id, supplier_variant_id);

create index if not exists market_radar_snapshots_product_captured_idx
  on public.market_radar_snapshots(product_id, captured_at desc);

create index if not exists market_radar_events_source_product_created_idx
  on public.market_radar_events(source_id, product_id, created_at desc);

create index if not exists market_radar_events_source_type_created_idx
  on public.market_radar_events(source_id, event_type, created_at desc);

create index if not exists market_radar_scores_source_score_event_idx
  on public.market_radar_scores(source_id, opportunity_score desc, last_event_at desc);

create index if not exists ebay_product_candidates_radar_updated_idx
  on public.ebay_product_candidates(market_radar_product_id, updated_at desc);
