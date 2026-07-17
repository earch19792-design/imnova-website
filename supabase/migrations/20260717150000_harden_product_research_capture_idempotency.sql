-- Loop 2 Product Research capture idempotency hardening for Preview/staging.
-- Additive only: serializes imports per account and resolves concurrent duplicates
-- without storing raw titles, HTML, images, PII, credentials, or marketplace writes.

create or replace function public.import_product_research_browser_capture_v3(
  p_batch_id uuid,
  p_marketplace_account_key text,
  p_capture_hash text,
  p_capture_window_hash text,
  p_listing_site text,
  p_search_query_hash text,
  p_search_keyword_patterns text[],
  p_date_range jsonb,
  p_captured_at timestamptz,
  p_source_row_count integer,
  p_valid_count integer,
  p_duplicate_count integer,
  p_rejected_count integer,
  p_exact_luna_match_count integer,
  p_different_pack_count integer,
  p_different_size_count integer,
  p_different_variant_count integer,
  p_ambiguous_count integer,
  p_no_luna_match_count integer,
  p_candidates_enriched_count integer,
  p_error_counts jsonb,
  p_captured_by uuid,
  p_observations jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_requested_count integer := jsonb_array_length(coalesce(p_observations, '[]'::jsonb));
  v_collision_count integer := 0;
  v_imported_count integer := 0;
  v_duplicate_count integer := 0;
  v_inserted_count integer := 0;
  v_existing_batch_id uuid;
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array' then
    raise exception 'PRODUCT_RESEARCH_CAPTURE_OBSERVATIONS_ARRAY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-capture:' || p_marketplace_account_key,
    0
  ));

  select id into v_existing_batch_id
  from public.marketplace_product_research_capture_batches
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = 'EBAY_US'
    and capture_hash = p_capture_hash;
  if v_existing_batch_id is not null then
    return v_existing_batch_id;
  end if;

  select count(*) into v_collision_count
  from public.marketplace_product_research_capture_observations observation
  join jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as requested(
    evidence_deduplication_key text
  ) on requested.evidence_deduplication_key = observation.evidence_deduplication_key
  where observation.marketplace_account_key = p_marketplace_account_key
    and observation.marketplace = 'EBAY_US';

  v_imported_count := greatest(0, v_requested_count - v_collision_count);
  v_duplicate_count := p_duplicate_count + v_collision_count;

  insert into public.marketplace_product_research_capture_batches(
    id,marketplace_account_key,marketplace,source,capture_hash,capture_window_hash,
    listing_site,search_query_hash,search_keyword_patterns,date_range,captured_at,
    source_row_count,valid_count,imported_count,duplicate_count,rejected_count,
    exact_luna_match_count,different_pack_count,different_size_count,different_variant_count,
    ambiguous_count,no_luna_match_count,candidates_enriched_count,error_counts,captured_by
  ) values (
    p_batch_id,p_marketplace_account_key,'EBAY_US','EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
    p_capture_hash,p_capture_window_hash,p_listing_site,p_search_query_hash,
    coalesce(p_search_keyword_patterns,'{}'::text[]),coalesce(p_date_range,'{}'::jsonb),
    p_captured_at,p_source_row_count,p_valid_count,v_imported_count,v_duplicate_count,
    p_rejected_count,p_exact_luna_match_count,p_different_pack_count,p_different_size_count,
    p_different_variant_count,p_ambiguous_count,p_no_luna_match_count,
    p_candidates_enriched_count,coalesce(p_error_counts,'{}'::jsonb),p_captured_by
  );

  insert into public.marketplace_product_research_capture_observations(
    capture_batch_id,marketplace_account_key,marketplace,source,evidence_scope,
    source_listing_id,source_listing_reference_hash,title_fingerprint,identity_hash,
    evidence_deduplication_key,normalized_identity,detected_offer_pack_count,
    detected_unit_count,detected_size,detected_variant,average_sold_price,
    average_shipping,confirmed_sold_quantity,item_sales,last_sold_date,listing_format,
    free_shipping_percent,bids,visible_image_count,keyword_signals,match_classification,
    match_reasons,matched_queue_item_id,matched_supplier_variant_id,evidence_reviewed
  )
  select
    p_batch_id,p_marketplace_account_key,'EBAY_US','EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
    'MARKET_WIDE_SOLD_EVIDENCE',row.source_listing_id,row.source_listing_reference_hash,
    row.title_fingerprint,row.identity_hash,row.evidence_deduplication_key,
    row.normalized_identity,row.detected_offer_pack_count,row.detected_unit_count,
    row.detected_size,row.detected_variant,row.average_sold_price,row.average_shipping,
    row.confirmed_sold_quantity,row.item_sales,row.last_sold_date,row.listing_format,
    row.free_shipping_percent,row.bids,row.visible_image_count,row.keyword_signals,
    row.match_classification,row.match_reasons,row.matched_queue_item_id,
    row.matched_supplier_variant_id,true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
    source_listing_id text,
    source_listing_reference_hash text,
    title_fingerprint text,
    identity_hash text,
    evidence_deduplication_key text,
    normalized_identity jsonb,
    detected_offer_pack_count integer,
    detected_unit_count integer,
    detected_size text,
    detected_variant text,
    average_sold_price numeric,
    average_shipping numeric,
    confirmed_sold_quantity integer,
    item_sales numeric,
    last_sold_date timestamptz,
    listing_format text,
    free_shipping_percent numeric,
    bids integer,
    visible_image_count integer,
    keyword_signals text[],
    match_classification text,
    match_reasons text[],
    matched_queue_item_id uuid,
    matched_supplier_variant_id text
  )
  on conflict (marketplace_account_key,marketplace,evidence_deduplication_key) do nothing;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_imported_count then
    raise exception 'PRODUCT_RESEARCH_CAPTURE_IDEMPOTENCY_COUNT_MISMATCH';
  end if;

  return p_batch_id;
end;
$$;

revoke all on function public.import_product_research_browser_capture_v3(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_product_research_browser_capture_v3(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) to service_role;

notify pgrst, 'reload schema';
