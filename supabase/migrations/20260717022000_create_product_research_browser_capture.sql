-- Loop 2: official eBay Product Research visible-table capture for Preview/staging.
-- Additive only. No raw HTML, complete competitor titles, image files, credentials or PII are stored.

create table if not exists public.marketplace_product_research_capture_batches (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  source text not null default 'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
  capture_hash text not null,
  capture_window_hash text not null,
  listing_site text not null,
  search_query_hash text not null,
  search_keyword_patterns text[] not null default '{}'::text[],
  date_range jsonb not null,
  captured_at timestamptz not null,
  source_row_count integer not null,
  valid_count integer not null,
  imported_count integer not null,
  duplicate_count integer not null,
  rejected_count integer not null,
  exact_luna_match_count integer not null,
  different_pack_count integer not null,
  different_size_count integer not null,
  different_variant_count integer not null,
  ambiguous_count integer not null,
  no_luna_match_count integer not null,
  candidates_enriched_count integer not null,
  error_counts jsonb not null default '{}'::jsonb,
  captured_by uuid not null references auth.users(id) on delete restrict,
  raw_html_stored boolean not null default false,
  temporary_titles_stored boolean not null default false,
  competitor_images_downloaded integer not null default 0,
  pii_stored boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_research_capture_batches_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_capture_batches_source_check
    check (source = 'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE'),
  constraint marketplace_product_research_capture_batches_hashes_check check (
    capture_hash ~ '^sha256:[0-9a-f]{64}$'
    and capture_window_hash ~ '^sha256:[0-9a-f]{64}$'
    and search_query_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_product_research_capture_batches_site_check
    check (listing_site = 'www.ebay.com'),
  constraint marketplace_product_research_capture_batches_date_range_check
    check (jsonb_typeof(date_range) = 'object'),
  constraint marketplace_product_research_capture_batches_counts_check check (
    source_row_count > 0 and valid_count > 0 and imported_count >= 0
    and duplicate_count >= 0 and rejected_count >= 0
    and exact_luna_match_count >= 0 and different_pack_count >= 0
    and different_size_count >= 0 and different_variant_count >= 0
    and ambiguous_count >= 0 and no_luna_match_count >= 0
    and candidates_enriched_count >= 0
    and source_row_count = valid_count + rejected_count
    and source_row_count = imported_count + duplicate_count + rejected_count
  ),
  constraint marketplace_product_research_capture_batches_errors_check
    check (jsonb_typeof(error_counts) = 'object'),
  constraint marketplace_product_research_capture_batches_no_sensitive_content_check check (
    raw_html_stored = false and temporary_titles_stored = false
    and competitor_images_downloaded = 0 and pii_stored = false
  ),
  constraint marketplace_product_research_capture_batches_unique
    unique (marketplace_account_key, marketplace, capture_hash)
);

create table if not exists public.marketplace_product_research_capture_observations (
  id uuid primary key default gen_random_uuid(),
  capture_batch_id uuid not null
    references public.marketplace_product_research_capture_batches(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  source text not null default 'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
  evidence_scope text not null default 'MARKET_WIDE_SOLD_EVIDENCE',
  source_listing_reference_hash text not null,
  title_fingerprint text not null,
  identity_hash text not null,
  evidence_deduplication_key text not null,
  normalized_identity jsonb not null,
  detected_offer_pack_count integer null,
  detected_unit_count integer null,
  detected_size text null,
  detected_variant text null,
  average_sold_price numeric(14,2) not null,
  average_shipping numeric(14,2) null,
  confirmed_sold_quantity integer not null,
  item_sales numeric(14,2) null,
  last_sold_date timestamptz not null,
  listing_format text not null,
  free_shipping_percent numeric(7,3) null,
  bids integer null,
  visible_image_count integer null,
  keyword_signals text[] not null default '{}'::text[],
  match_classification text not null,
  match_reasons text[] not null default '{}'::text[],
  matched_queue_item_id uuid null
    references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  matched_supplier_variant_id text null,
  evidence_reviewed boolean not null default true,
  raw_html_stored boolean not null default false,
  temporary_title_stored boolean not null default false,
  competitor_image_downloaded boolean not null default false,
  pii_stored boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_research_capture_observations_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_capture_observations_source_check
    check (source = 'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE'),
  constraint marketplace_product_research_capture_observations_scope_check
    check (evidence_scope = 'MARKET_WIDE_SOLD_EVIDENCE'),
  constraint marketplace_product_research_capture_observations_hashes_check check (
    source_listing_reference_hash ~ '^sha256:[0-9a-f]{64}$'
    and title_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and identity_hash ~ '^sha256:[0-9a-f]{64}$'
    and evidence_deduplication_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_product_research_capture_observations_identity_check
    check (jsonb_typeof(normalized_identity) = 'object'),
  constraint marketplace_product_research_capture_observations_metrics_check check (
    average_sold_price >= 0 and (average_shipping is null or average_shipping >= 0)
    and confirmed_sold_quantity > 0 and (item_sales is null or item_sales >= 0)
    and (detected_offer_pack_count is null or detected_offer_pack_count > 0)
    and (detected_unit_count is null or detected_unit_count > 0)
    and (free_shipping_percent is null or free_shipping_percent between 0 and 100)
    and (bids is null or bids >= 0) and (visible_image_count is null or visible_image_count >= 0)
  ),
  constraint marketplace_product_research_capture_observations_format_check
    check (listing_format in ('FIXED_PRICE','AUCTION','BEST_OFFER','UNKNOWN')),
  constraint marketplace_product_research_capture_observations_match_check
    check (match_classification in (
      'EXACT_LUNA_MATCH','SAME_PRODUCT_DIFFERENT_PACK','SAME_PRODUCT_DIFFERENT_SIZE',
      'DIFFERENT_VARIANT','AMBIGUOUS','NO_LUNA_MATCH'
    )),
  constraint marketplace_product_research_capture_observations_match_binding_check check (
    (match_classification in (
      'EXACT_LUNA_MATCH','SAME_PRODUCT_DIFFERENT_PACK','SAME_PRODUCT_DIFFERENT_SIZE','DIFFERENT_VARIANT'
    ) and matched_supplier_variant_id is not null)
    or (match_classification in ('AMBIGUOUS','NO_LUNA_MATCH')
      and matched_queue_item_id is null and matched_supplier_variant_id is null)
  ),
  constraint marketplace_product_research_capture_observations_review_check
    check (evidence_reviewed = true),
  constraint marketplace_product_research_capture_observations_no_sensitive_content_check check (
    raw_html_stored = false and temporary_title_stored = false
    and competitor_image_downloaded = false and pii_stored = false
  ),
  constraint marketplace_product_research_capture_observations_dedup_unique
    unique (marketplace_account_key, marketplace, evidence_deduplication_key)
);

create index if not exists marketplace_product_research_capture_batches_account_time_idx
  on public.marketplace_product_research_capture_batches(
    marketplace_account_key, marketplace, captured_at desc
  );
create index if not exists marketplace_product_research_capture_observations_match_idx
  on public.marketplace_product_research_capture_observations(
    marketplace_account_key, marketplace, match_classification, last_sold_date desc
  );
create index if not exists marketplace_product_research_capture_observations_target_idx
  on public.marketplace_product_research_capture_observations(
    marketplace_account_key, marketplace, matched_supplier_variant_id, last_sold_date desc
  ) where matched_supplier_variant_id is not null;

create or replace function public.import_product_research_browser_capture_v1(
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
  v_imported_count integer := jsonb_array_length(coalesce(p_observations, '[]'::jsonb));
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array' then
    raise exception 'PRODUCT_RESEARCH_CAPTURE_OBSERVATIONS_ARRAY_REQUIRED';
  end if;

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
    p_captured_at,p_source_row_count,p_valid_count,v_imported_count,p_duplicate_count,
    p_rejected_count,p_exact_luna_match_count,p_different_pack_count,p_different_size_count,
    p_different_variant_count,p_ambiguous_count,p_no_luna_match_count,
    p_candidates_enriched_count,coalesce(p_error_counts,'{}'::jsonb),p_captured_by
  );

  insert into public.marketplace_product_research_capture_observations(
    capture_batch_id,marketplace_account_key,marketplace,source,evidence_scope,
    source_listing_reference_hash,title_fingerprint,identity_hash,evidence_deduplication_key,
    normalized_identity,detected_offer_pack_count,detected_unit_count,detected_size,
    detected_variant,average_sold_price,average_shipping,confirmed_sold_quantity,item_sales,
    last_sold_date,listing_format,free_shipping_percent,bids,visible_image_count,
    keyword_signals,match_classification,match_reasons,matched_queue_item_id,
    matched_supplier_variant_id,evidence_reviewed
  )
  select
    p_batch_id,p_marketplace_account_key,'EBAY_US','EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
    'MARKET_WIDE_SOLD_EVIDENCE',row.source_listing_reference_hash,row.title_fingerprint,
    row.identity_hash,row.evidence_deduplication_key,row.normalized_identity,
    row.detected_offer_pack_count,row.detected_unit_count,row.detected_size,row.detected_variant,
    row.average_sold_price,row.average_shipping,row.confirmed_sold_quantity,row.item_sales,
    row.last_sold_date,row.listing_format,row.free_shipping_percent,row.bids,
    row.visible_image_count,row.keyword_signals,row.match_classification,row.match_reasons,
    row.matched_queue_item_id,row.matched_supplier_variant_id,true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
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
  );

  return p_batch_id;
end;
$$;

alter table public.marketplace_product_research_capture_batches enable row level security;
alter table public.marketplace_product_research_capture_batches force row level security;
alter table public.marketplace_product_research_capture_observations enable row level security;
alter table public.marketplace_product_research_capture_observations force row level security;

revoke all on table public.marketplace_product_research_capture_batches
  from anon, authenticated, service_role;
revoke all on table public.marketplace_product_research_capture_observations
  from anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_research_capture_batches to service_role;
grant select, insert on table public.marketplace_product_research_capture_observations to service_role;

revoke all on function public.import_product_research_browser_capture_v1(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_product_research_browser_capture_v1(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) to service_role;

comment on table public.marketplace_product_research_capture_batches is
  'Sanitized metadata from an operator-visible official eBay Product Research table; raw page content is never stored.';
comment on table public.marketplace_product_research_capture_observations is
  'Append-only sold evidence and family/pack intelligence; exact Luna matches alone enter confirmed sold cohorts.';
