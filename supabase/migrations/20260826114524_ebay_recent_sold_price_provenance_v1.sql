-- Durable, explicit price provenance for individual sold evidence.
-- Existing aggregate Product Research semantics remain in item_price/shipping_cost.

alter table public.marketplace_sold_evidence_import_batches
  drop constraint marketplace_sold_evidence_import_batches_source_check,
  drop constraint marketplace_sold_evidence_import_batches_export_check;

alter table public.marketplace_sold_evidence_import_batches
  add constraint marketplace_sold_evidence_import_batches_source_check check (
    source_type in (
      'EBAY_OFFICIAL_CSV_IMPORT','EBAY_OFFICIAL_JSON_IMPORT',
      'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE'
    )
  ),
  add constraint marketplace_sold_evidence_import_batches_export_check check (
    source_export_type in (
      'EBAY_PRODUCT_RESEARCH_EXPORT','EBAY_SELLER_HUB_EXPORT',
      'EBAY_MARKETPLACE_INSIGHTS_EXPORT','EBAY_MAIN_SEARCH_SOLD_CAPTURE'
    )
  );

alter table public.marketplace_sold_evidence_observations
  add column source_class text null,
  add column item_id text null,
  add column sold_at timestamptz null,
  add column captured_at timestamptz null,
  add column query_or_research_identity text null,
  add column displayed_sold_price_amount numeric(14,2) null,
  add column displayed_sold_price_currency text null,
  add column realized_transaction_price_amount numeric(14,2) null,
  add column realized_transaction_price_currency text null,
  add column realized_price_status text null,
  add column best_offer_status text null,
  add column visible_shipping_amount numeric(14,2) null,
  add column visible_shipping_currency text null,
  add column shipping_status text null,
  add column price_evidence_provenance text null,
  add column evidence_digest text null;

update public.marketplace_sold_evidence_observations
set source_class = case
      when source_export_type = 'EBAY_PRODUCT_RESEARCH_EXPORT'
        then 'OFFICIAL_PRODUCT_RESEARCH'
      else 'OFFICIAL_API'
    end,
    sold_at = observed_at,
    captured_at = created_at,
    realized_price_status = 'UNAVAILABLE',
    best_offer_status = 'UNKNOWN',
    shipping_status = 'UNAVAILABLE',
    price_evidence_provenance = case
      when source_export_type = 'EBAY_PRODUCT_RESEARCH_EXPORT'
        then 'PRODUCT_RESEARCH_AGGREGATE'
      else 'LEGACY_OFFICIAL_PRICE'
    end,
    evidence_digest = evidence_deduplication_key;

alter table public.marketplace_sold_evidence_observations
  alter column source_class set not null,
  alter column sold_at set not null,
  alter column captured_at set not null,
  alter column realized_price_status set not null,
  alter column best_offer_status set not null,
  alter column shipping_status set not null,
  alter column price_evidence_provenance set not null,
  alter column evidence_digest set not null,
  drop constraint marketplace_sold_evidence_observations_source_check,
  drop constraint marketplace_sold_evidence_observations_export_check;

alter table public.marketplace_sold_evidence_observations
  add constraint marketplace_sold_evidence_observations_source_check check (
    source_type in (
      'EBAY_OFFICIAL_CSV_IMPORT','EBAY_OFFICIAL_JSON_IMPORT',
      'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE'
    )
  ),
  add constraint marketplace_sold_evidence_observations_export_check check (
    source_export_type in (
      'EBAY_PRODUCT_RESEARCH_EXPORT','EBAY_SELLER_HUB_EXPORT',
      'EBAY_MARKETPLACE_INSIGHTS_EXPORT','EBAY_MAIN_SEARCH_SOLD_CAPTURE'
    )
  ),
  add constraint marketplace_sold_evidence_observations_source_class_v3_check check (
    source_class in ('OFFICIAL_PRODUCT_RESEARCH','MAIN_SEARCH_SOLD','OFFICIAL_API')
  ),
  add constraint marketplace_sold_evidence_observations_source_alignment_v3_check check (
    (source_export_type = 'EBAY_MAIN_SEARCH_SOLD_CAPTURE'
      and source_type = 'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE'
      and source_class = 'MAIN_SEARCH_SOLD')
    or
    (source_export_type = 'EBAY_PRODUCT_RESEARCH_EXPORT'
      and source_type <> 'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE'
      and source_class = 'OFFICIAL_PRODUCT_RESEARCH')
    or
    (source_export_type in ('EBAY_SELLER_HUB_EXPORT','EBAY_MARKETPLACE_INSIGHTS_EXPORT')
      and source_type <> 'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE'
      and source_class = 'OFFICIAL_API')
  ),
  add constraint marketplace_sold_evidence_observations_item_id_v3_check check (
    item_id is null or item_id ~ '^[0-9]{9,20}$'
  ),
  add constraint marketplace_sold_evidence_observations_query_identity_v3_check check (
    query_or_research_identity is null
      or query_or_research_identity ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint marketplace_sold_evidence_observations_price_status_v3_check check (
    realized_price_status in ('PROVEN','UNPROVEN','UNAVAILABLE')
    and best_offer_status in ('EXPLICIT_PRESENT','EXPLICIT_ABSENT','UNKNOWN')
    and shipping_status in ('OBSERVED','UNAVAILABLE','AMBIGUOUS')
  ),
  add constraint marketplace_sold_evidence_observations_price_pairs_v3_check check (
    (displayed_sold_price_amount is null) = (displayed_sold_price_currency is null)
    and (displayed_sold_price_amount is null or displayed_sold_price_amount >= 0)
  ),
  add constraint marketplace_sold_evidence_observations_realized_pair_v3_check check (
    (realized_price_status = 'PROVEN'
      and realized_transaction_price_amount is not null
      and realized_transaction_price_amount >= 0
      and realized_transaction_price_currency is not null)
    or
    (realized_price_status in ('UNPROVEN','UNAVAILABLE')
      and realized_transaction_price_amount is null
      and realized_transaction_price_currency is null)
  ),
  add constraint marketplace_sold_evidence_observations_shipping_pair_v3_check check (
    (shipping_status = 'OBSERVED'
      and visible_shipping_amount is not null
      and visible_shipping_amount >= 0
      and visible_shipping_currency is not null)
    or
    (shipping_status in ('UNAVAILABLE','AMBIGUOUS')
      and visible_shipping_amount is null
      and visible_shipping_currency is null)
  ),
  add constraint marketplace_sold_evidence_observations_main_search_semantics_v3_check check (
    source_class <> 'MAIN_SEARCH_SOLD'
    or (
      item_id is not null
      and query_or_research_identity is not null
      and item_price is null
      and shipping_cost is null
      and realized_price_status = 'UNPROVEN'
      and realized_transaction_price_amount is null
      and realized_transaction_price_currency is null
    )
  ),
  add constraint marketplace_sold_evidence_observations_best_offer_v3_check check (
    best_offer_status <> 'EXPLICIT_PRESENT'
    or (
      realized_price_status = 'UNPROVEN'
      and realized_transaction_price_amount is null
      and realized_transaction_price_currency is null
    )
  ),
  add constraint marketplace_sold_evidence_observations_currency_v3_check check (
    (displayed_sold_price_currency is null or displayed_sold_price_currency ~ '^[A-Z]{3}$')
    and (realized_transaction_price_currency is null or realized_transaction_price_currency ~ '^[A-Z]{3}$')
    and (visible_shipping_currency is null or visible_shipping_currency ~ '^[A-Z]{3}$')
  ),
  add constraint marketplace_sold_evidence_observations_digest_v3_check check (
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  );

create or replace function public.import_marketplace_sold_evidence_v3(
  p_batch_id uuid,
  p_marketplace_account_key text,
  p_source_type text,
  p_source_export_type text,
  p_evidence_scope text,
  p_market_wide_schema_confirmed boolean,
  p_source_file_hash text,
  p_import_schema_version text,
  p_source_row_count integer,
  p_row_count integer,
  p_valid_count integer,
  p_confirmed_sale_count integer,
  p_completed_without_sale_count integer,
  p_duplicate_count integer,
  p_rejected_count integer,
  p_error_counts jsonb,
  p_source_observed_start timestamptz,
  p_source_observed_end timestamptz,
  p_reviewed_by uuid,
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
    raise exception 'SOLD_EVIDENCE_OBSERVATIONS_ARRAY_REQUIRED';
  end if;

  insert into public.marketplace_sold_evidence_import_batches(
    id,marketplace_account_key,marketplace,source_type,source_export_type,evidence_scope,
    market_wide_schema_confirmed,source_file_hash,import_schema_version,status,
    operator_attested,row_count,source_row_count,valid_count,confirmed_sale_count,
    completed_without_sale_count,imported_count,duplicate_count,rejected_count,error_counts,
    source_observed_start,source_observed_end,reviewed_by
  ) values (
    p_batch_id,p_marketplace_account_key,'EBAY_US',p_source_type,p_source_export_type,
    p_evidence_scope,p_market_wide_schema_confirmed,p_source_file_hash,p_import_schema_version,
    'IMPORTED',true,p_row_count,p_source_row_count,p_valid_count,p_confirmed_sale_count,
    p_completed_without_sale_count,v_imported_count,p_duplicate_count,p_rejected_count,
    coalesce(p_error_counts,'{}'::jsonb),p_source_observed_start,p_source_observed_end,p_reviewed_by
  );

  insert into public.marketplace_sold_evidence_observations(
    import_batch_id,marketplace_account_key,marketplace,source_type,source_export_type,
    source_class,item_id,sold_at,captured_at,query_or_research_identity,
    evidence_scope,sale_confirmation_basis,source_listing_reference_hash,
    evidence_deduplication_key,normalized_identity,confirmed_sold_quantity,item_price,
    shipping_cost,currency,displayed_sold_price_amount,displayed_sold_price_currency,
    realized_transaction_price_amount,realized_transaction_price_currency,
    realized_price_status,best_offer_status,visible_shipping_amount,
    visible_shipping_currency,shipping_status,price_evidence_provenance,evidence_digest,
    keyword_signals,shipping_pattern,returns_pattern,image_count,visual_evidence,
    observed_at,eligible_until,evidence_reviewed
  )
  select
    p_batch_id,p_marketplace_account_key,'EBAY_US',p_source_type,p_source_export_type,
    row.source_class,row.item_id,row.sold_at,row.captured_at,row.query_or_research_identity,
    p_evidence_scope,row.sale_confirmation_basis,row.source_listing_reference_hash,
    row.evidence_deduplication_key,row.normalized_identity,row.confirmed_sold_quantity,
    row.item_price,row.shipping_cost,'USD',row.displayed_sold_price_amount,
    row.displayed_sold_price_currency,row.realized_transaction_price_amount,
    row.realized_transaction_price_currency,row.realized_price_status,row.best_offer_status,
    row.visible_shipping_amount,row.visible_shipping_currency,row.shipping_status,
    row.price_evidence_provenance,row.evidence_digest,row.keyword_signals,row.shipping_pattern,
    row.returns_pattern,row.image_count,row.visual_evidence,row.observed_at,
    row.eligible_until,true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
    source_class text,
    item_id text,
    sold_at timestamptz,
    captured_at timestamptz,
    query_or_research_identity text,
    sale_confirmation_basis text,
    source_listing_reference_hash text,
    evidence_deduplication_key text,
    normalized_identity jsonb,
    confirmed_sold_quantity integer,
    item_price numeric,
    shipping_cost numeric,
    displayed_sold_price_amount numeric,
    displayed_sold_price_currency text,
    realized_transaction_price_amount numeric,
    realized_transaction_price_currency text,
    realized_price_status text,
    best_offer_status text,
    visible_shipping_amount numeric,
    visible_shipping_currency text,
    shipping_status text,
    price_evidence_provenance text,
    evidence_digest text,
    keyword_signals text[],
    shipping_pattern text,
    returns_pattern text,
    image_count integer,
    visual_evidence jsonb,
    observed_at timestamptz,
    eligible_until timestamptz
  );

  return p_batch_id;
end;
$$;

revoke all on function public.import_marketplace_sold_evidence_v3(
  uuid,text,text,text,text,boolean,text,text,integer,integer,integer,integer,integer,
  integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_marketplace_sold_evidence_v3(
  uuid,text,text,text,text,boolean,text,text,integer,integer,integer,integer,integer,
  integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) to service_role;

create or replace function public.read_marketplace_sold_evidence_v1(
  p_marketplace_account_key text,
  p_eligible_at timestamptz default null,
  p_import_batch_id uuid default null,
  p_limit integer default 2000
) returns table (
  source_type text,
  source_class text,
  item_id text,
  sold_at timestamptz,
  captured_at timestamptz,
  query_or_research_identity text,
  source_listing_reference_hash text,
  normalized_identity jsonb,
  confirmed_sold_quantity integer,
  evidence_scope text,
  sale_confirmation_basis text,
  item_price numeric,
  shipping_cost numeric,
  displayed_sold_price_amount numeric,
  displayed_sold_price_currency text,
  realized_transaction_price_amount numeric,
  realized_transaction_price_currency text,
  realized_price_status text,
  best_offer_status text,
  visible_shipping_amount numeric,
  visible_shipping_currency text,
  shipping_status text,
  price_evidence_provenance text,
  evidence_digest text,
  keyword_signals text[],
  shipping_pattern text,
  returns_pattern text,
  image_count integer,
  visual_evidence jsonb,
  observed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select observation.source_type,
    observation.source_class,
    observation.item_id,
    observation.sold_at,
    observation.captured_at,
    observation.query_or_research_identity,
    observation.source_listing_reference_hash,
    observation.normalized_identity,
    observation.confirmed_sold_quantity,
    observation.evidence_scope,
    observation.sale_confirmation_basis,
    observation.item_price,
    observation.shipping_cost,
    observation.displayed_sold_price_amount,
    observation.displayed_sold_price_currency,
    observation.realized_transaction_price_amount,
    observation.realized_transaction_price_currency,
    observation.realized_price_status,
    observation.best_offer_status,
    observation.visible_shipping_amount,
    observation.visible_shipping_currency,
    observation.shipping_status,
    observation.price_evidence_provenance,
    observation.evidence_digest,
    observation.keyword_signals,
    observation.shipping_pattern,
    observation.returns_pattern,
    observation.image_count,
    observation.visual_evidence,
    observation.observed_at
  from public.marketplace_sold_evidence_observations observation
  where observation.marketplace_account_key = p_marketplace_account_key
    and observation.marketplace = 'EBAY_US'
    and observation.evidence_reviewed = true
    and (p_eligible_at is null or observation.eligible_until >= p_eligible_at)
    and (p_import_batch_id is null or observation.import_batch_id = p_import_batch_id)
  order by observation.observed_at desc, observation.evidence_digest
  limit least(greatest(coalesce(p_limit, 2000), 1), 2000);
$$;

revoke all on function public.read_marketplace_sold_evidence_v1(
  text,timestamptz,uuid,integer
) from public, anon, authenticated;
grant execute on function public.read_marketplace_sold_evidence_v1(
  text,timestamptz,uuid,integer
) to service_role;

comment on column public.marketplace_sold_evidence_observations.item_price is
  'Legacy official/export or Product Research aggregate price. Main Search Sold rows must leave it null.';
comment on column public.marketplace_sold_evidence_observations.displayed_sold_price_amount is
  'Price visibly displayed on an individual sold row; never implicitly an authoritative realized transaction price.';
comment on column public.marketplace_sold_evidence_observations.realized_transaction_price_amount is
  'Authoritative transaction price only when realized_price_status is PROVEN.';
comment on column public.marketplace_sold_evidence_observations.evidence_digest is
  'Deterministic digest of source identity, price provenance and evidence semantics.';
