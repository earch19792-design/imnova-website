-- Loop 2: append-only reconciliation between official Product Research sold evidence
-- and Luna supplier variants. Additive only; no raw competitor content, PII or secrets.

alter table public.marketplace_product_research_capture_observations
  add column if not exists source_listing_id text null;

alter table public.marketplace_product_research_capture_observations
  add constraint marketplace_product_research_capture_observations_listing_id_check
    check (source_listing_id is null or source_listing_id ~ '^[0-9]{9,20}$');

create or replace function public.import_product_research_browser_capture_v2(
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
  );

  return p_batch_id;
end;
$$;

create table if not exists public.marketplace_product_identity_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  observation_id uuid not null
    references public.marketplace_product_research_capture_observations(id) on delete restrict,
  reconciliation_version text not null,
  previous_reconciliation_event_id uuid null
    references public.marketplace_product_identity_reconciliation_events(id) on delete restrict,
  source_listing_id text null,
  luna_supplier_product_id text null,
  luna_supplier_variant_id text null,
  supplier_sku text null,
  classification text not null,
  evidence_class text not null,
  confidence numeric(6,5) not null,
  matched_attributes jsonb not null default '{}'::jsonb,
  conflicting_attributes jsonb not null default '{}'::jsonb,
  sources_consulted text[] not null default '{}'::text[],
  source_outcomes jsonb not null default '{}'::jsonb,
  base_product_fingerprint text not null,
  luna_variant_fingerprint text null,
  observed_offer_pack_fingerprint text not null,
  candidate_offer_pack_fingerprint text null,
  affects_sold_exact_count boolean not null default false,
  affects_pack_intelligence boolean not null default false,
  observation_observed_at timestamptz not null,
  reconciled_at timestamptz not null default clock_timestamp(),
  deduplication_key text not null,
  pii_stored boolean not null default false,
  raw_competitor_content_stored boolean not null default false,
  competitor_images_downloaded integer not null default 0,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  constraint marketplace_product_identity_reconciliation_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_identity_reconciliation_version_check
    check (reconciliation_version ~ '^[A-Z0-9_]+$'),
  constraint marketplace_product_identity_reconciliation_listing_id_check
    check (source_listing_id is null or source_listing_id ~ '^[0-9]{9,20}$'),
  constraint marketplace_product_identity_reconciliation_classification_check
    check (classification in (
      'EXACT_LUNA_MATCH','SAME_PRODUCT_DIFFERENT_PACK','SAME_PRODUCT_DIFFERENT_SIZE',
      'DIFFERENT_VARIANT','AMBIGUOUS','NO_LUNA_MATCH','CONFLICTED'
    )),
  constraint marketplace_product_identity_reconciliation_evidence_class_check
    check (evidence_class in (
      'CONFIRMED_SOLD_EXACT','CONFIRMED_SOLD_RELATED_PACK',
      'CONFIRMED_SOLD_RELATED_SIZE','NON_QUALIFYING'
    )),
  constraint marketplace_product_identity_reconciliation_confidence_check
    check (confidence between 0 and 1),
  constraint marketplace_product_identity_reconciliation_json_check check (
    jsonb_typeof(matched_attributes) = 'object'
    and jsonb_typeof(conflicting_attributes) = 'object'
    and jsonb_typeof(source_outcomes) = 'object'
  ),
  constraint marketplace_product_identity_reconciliation_fingerprints_check check (
    base_product_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and (luna_variant_fingerprint is null
      or luna_variant_fingerprint ~ '^sha256:[0-9a-f]{64}$')
    and observed_offer_pack_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and (candidate_offer_pack_fingerprint is null
      or candidate_offer_pack_fingerprint ~ '^sha256:[0-9a-f]{64}$')
    and deduplication_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_product_identity_reconciliation_effect_check check (
    affects_sold_exact_count = (classification = 'EXACT_LUNA_MATCH')
    and affects_pack_intelligence = (classification in (
      'SAME_PRODUCT_DIFFERENT_PACK','SAME_PRODUCT_DIFFERENT_SIZE'
    ))
  ),
  constraint marketplace_product_identity_reconciliation_binding_check check (
    (classification in (
      'EXACT_LUNA_MATCH','SAME_PRODUCT_DIFFERENT_PACK','SAME_PRODUCT_DIFFERENT_SIZE',
      'DIFFERENT_VARIANT','CONFLICTED'
    ) and luna_supplier_variant_id is not null and supplier_sku is not null)
    or (classification in ('AMBIGUOUS','NO_LUNA_MATCH')
      and luna_supplier_variant_id is null and supplier_sku is null)
  ),
  constraint marketplace_product_identity_reconciliation_semantics_check check (
    (classification = 'EXACT_LUNA_MATCH' and evidence_class = 'CONFIRMED_SOLD_EXACT')
    or (classification = 'SAME_PRODUCT_DIFFERENT_PACK'
      and evidence_class = 'CONFIRMED_SOLD_RELATED_PACK')
    or (classification = 'SAME_PRODUCT_DIFFERENT_SIZE'
      and evidence_class = 'CONFIRMED_SOLD_RELATED_SIZE')
    or (classification in ('DIFFERENT_VARIANT','AMBIGUOUS','NO_LUNA_MATCH','CONFLICTED')
      and evidence_class = 'NON_QUALIFYING')
  ),
  constraint marketplace_product_identity_reconciliation_no_sensitive_check check (
    pii_stored = false and raw_competitor_content_stored = false
    and competitor_images_downloaded = 0 and openai_calls = 0 and ebay_writes = 0
  ),
  constraint marketplace_product_identity_reconciliation_unique
    unique (marketplace_account_key, marketplace, deduplication_key)
);

create index if not exists marketplace_product_identity_reconciliation_account_time_idx
  on public.marketplace_product_identity_reconciliation_events(
    marketplace_account_key, marketplace, reconciled_at desc
  );
create index if not exists marketplace_product_identity_reconciliation_observation_idx
  on public.marketplace_product_identity_reconciliation_events(
    observation_id, reconciled_at desc
  );
create index if not exists marketplace_product_identity_reconciliation_variant_idx
  on public.marketplace_product_identity_reconciliation_events(
    marketplace_account_key, luna_supplier_variant_id, classification, reconciled_at desc
  ) where luna_supplier_variant_id is not null;

create or replace function public.reject_marketplace_product_identity_reconciliation_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'PRODUCT_IDENTITY_RECONCILIATION_APPEND_ONLY';
end;
$$;

create trigger marketplace_product_identity_reconciliation_append_only
before update or delete on public.marketplace_product_identity_reconciliation_events
for each row execute function public.reject_marketplace_product_identity_reconciliation_mutation();

alter table public.marketplace_product_identity_reconciliation_events enable row level security;
alter table public.marketplace_product_identity_reconciliation_events force row level security;

revoke all on table public.marketplace_product_identity_reconciliation_events
  from anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_identity_reconciliation_events
  to service_role;

revoke all on function public.import_product_research_browser_capture_v2(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_product_research_browser_capture_v2(
  uuid,text,text,text,text,text,text[],jsonb,timestamptz,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,jsonb,uuid,jsonb
) to service_role;

revoke all on function public.reject_marketplace_product_identity_reconciliation_mutation()
  from public, anon, authenticated;

comment on table public.marketplace_product_identity_reconciliation_events is
  'Append-only, sanitized identity reconciliation events. Competitor SKU/Custom Label is never matched to Luna supplier SKU.';

notify pgrst, 'reload schema';
