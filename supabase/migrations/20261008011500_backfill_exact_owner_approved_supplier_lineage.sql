begin;

do $migration$
declare
  v_updated integer := 0;
begin
  with config as (
    select marketplace_account_key as account_key
    from public.ebay_monitoring_scheduler_config
    where singleton = true
  ), latest_decision as (
    select distinct on (decision.account_key, decision.ebay_item_id)
      decision.account_key,
      decision.ebay_item_id,
      decision.decision_id,
      decision.luna_product_id,
      decision.luna_variant_id,
      decision.luna_sku,
      decision.decision_at
    from public.seller_os_luna_linkage_decisions decision
    join config on config.account_key = decision.account_key
    where decision.decision = 'APPROVE_EXACT_LINKAGE'
      and decision.classification = 'EXACT_UNIQUE_MATCH'
    order by decision.account_key, decision.ebay_item_id,
      decision.decision_at desc, decision.created_at desc
  ), evidence as (
    select
      listing.id as listing_id,
      decision.decision_id,
      decision.luna_variant_id,
      decision.luna_sku,
      decision.decision_at,
      historical.snapshot_id,
      historical.price,
      historical.observed_at
    from public.ebay_active_listings listing
    join config on config.account_key = listing.account_key
    join latest_decision decision
      on decision.account_key = listing.account_key
      and decision.ebay_item_id = listing.ebay_item_id
    join lateral (
      select
        variant.snapshot_id,
        variant.price,
        variant.observed_at
      from public.luna_catalog_snapshot_variants_v1 variant
      join public.luna_catalog_snapshots_v1 snapshot
        on snapshot.snapshot_id = variant.snapshot_id
      where snapshot.snapshot_status = 'COMPLETE'
        and variant.product_id = decision.luna_product_id
        and variant.variant_id = decision.luna_variant_id
        and variant.sku = decision.luna_sku
        and variant.price > 0
        and variant.observed_at <= decision.decision_at
      order by variant.observed_at desc
      limit 1
    ) historical on true
    where listing.listing_status = 'active'
      and (
        listing.supplier_sku is null
        or trim(listing.supplier_sku) = ''
        or listing.supplier_variant_id is null
        or trim(listing.supplier_variant_id) = ''
        or listing.supplier_cost_at_linking is null
        or listing.supplier_cost_at_linking <= 0
      )
      and (
        nullif(trim(coalesce(listing.supplier_sku, '')), '') is null
        or listing.supplier_sku = decision.luna_sku
      )
      and (
        nullif(trim(coalesce(listing.supplier_variant_id, '')), '') is null
        or listing.supplier_variant_id = decision.luna_variant_id
      )
  )
  update public.ebay_active_listings listing
  set
    supplier_sku = evidence.luna_sku,
    supplier_variant_id = evidence.luna_variant_id,
    supplier_cost_at_linking = evidence.price,
    raw_payload = coalesce(listing.raw_payload, '{}'::jsonb) ||
      jsonb_build_object(
        'supplierLineageBackfillV1', jsonb_build_object(
          'authority', 'OWNER_APPROVED_EXACT_LINKAGE_PLUS_HISTORICAL_LUNA_SNAPSHOT',
          'decisionId', evidence.decision_id,
          'decisionAt', evidence.decision_at,
          'snapshotId', evidence.snapshot_id,
          'priceObservedAt', evidence.observed_at
        )
      ),
    updated_at = clock_timestamp()
  from evidence
  where listing.id = evidence.listing_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 49 then
    raise exception 'EBAY_SUPPLIER_LINEAGE_BACKFILL_COUNT_MISMATCH';
  end if;
end;
$migration$;

commit;
