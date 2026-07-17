-- Loop 2 clarification: source semantics, confirmed-sale basis and aggregate coverage inputs.
-- Additive follow-up to 20260717020000; the applied migration remains unchanged.

alter table public.marketplace_sold_evidence_import_batches
  add column if not exists evidence_scope text not null default 'OWN_ACCOUNT_SOLD_EVIDENCE',
  add column if not exists market_wide_schema_confirmed boolean not null default false,
  add column if not exists source_row_count integer not null default 0,
  add column if not exists valid_count integer not null default 0,
  add column if not exists confirmed_sale_count integer not null default 0,
  add column if not exists completed_without_sale_count integer not null default 0;

alter table public.marketplace_sold_evidence_import_batches
  add constraint marketplace_sold_evidence_import_batches_scope_v2_check check (
    evidence_scope in ('MARKET_WIDE_SOLD_EVIDENCE','OWN_ACCOUNT_SOLD_EVIDENCE')
  ) not valid,
  add constraint marketplace_sold_evidence_import_batches_scope_proof_v2_check check (
    evidence_scope <> 'MARKET_WIDE_SOLD_EVIDENCE'
    or source_export_type in ('EBAY_PRODUCT_RESEARCH_EXPORT','EBAY_MARKETPLACE_INSIGHTS_EXPORT')
    or market_wide_schema_confirmed = true
  ) not valid,
  add constraint marketplace_sold_evidence_import_batches_semantic_counts_v2_check check (
    source_row_count >= 0 and valid_count >= 0 and confirmed_sale_count >= 0
    and completed_without_sale_count >= 0
    and source_row_count = row_count + completed_without_sale_count
    and valid_count = confirmed_sale_count + completed_without_sale_count
    and confirmed_sale_count = imported_count + duplicate_count
  ) not valid;

alter table public.marketplace_sold_evidence_import_batches
  validate constraint marketplace_sold_evidence_import_batches_scope_v2_check;
alter table public.marketplace_sold_evidence_import_batches
  validate constraint marketplace_sold_evidence_import_batches_scope_proof_v2_check;
alter table public.marketplace_sold_evidence_import_batches
  validate constraint marketplace_sold_evidence_import_batches_semantic_counts_v2_check;

alter table public.marketplace_sold_evidence_observations
  add column if not exists evidence_scope text not null default 'OWN_ACCOUNT_SOLD_EVIDENCE',
  add column if not exists sale_confirmation_basis text not null default 'SOLD_QUANTITY_POSITIVE';

alter table public.marketplace_sold_evidence_observations
  add constraint marketplace_sold_evidence_observations_scope_v2_check check (
    evidence_scope in ('MARKET_WIDE_SOLD_EVIDENCE','OWN_ACCOUNT_SOLD_EVIDENCE')
  ) not valid,
  add constraint marketplace_sold_evidence_observations_sale_basis_v2_check check (
    sale_confirmation_basis in ('SOLD_QUANTITY_POSITIVE','EXPLICIT_CONFIRMED_SALE_MINIMUM_ONE')
  ) not valid;

alter table public.marketplace_sold_evidence_observations
  validate constraint marketplace_sold_evidence_observations_scope_v2_check;
alter table public.marketplace_sold_evidence_observations
  validate constraint marketplace_sold_evidence_observations_sale_basis_v2_check;

create index if not exists marketplace_sold_evidence_observations_scope_match_v2_idx
  on public.marketplace_sold_evidence_observations(
    marketplace_account_key, marketplace, evidence_scope, eligible_until desc
  );

create or replace function public.import_marketplace_sold_evidence_v2(
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
    evidence_scope,sale_confirmation_basis,source_listing_reference_hash,
    evidence_deduplication_key,normalized_identity,confirmed_sold_quantity,item_price,
    shipping_cost,currency,keyword_signals,shipping_pattern,returns_pattern,image_count,
    visual_evidence,observed_at,eligible_until,evidence_reviewed
  )
  select
    p_batch_id,p_marketplace_account_key,'EBAY_US',p_source_type,p_source_export_type,
    p_evidence_scope,row.sale_confirmation_basis,row.source_listing_reference_hash,
    row.evidence_deduplication_key,row.normalized_identity,row.confirmed_sold_quantity,
    row.item_price,row.shipping_cost,'USD',row.keyword_signals,row.shipping_pattern,
    row.returns_pattern,row.image_count,row.visual_evidence,row.observed_at,
    row.eligible_until,true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
    sale_confirmation_basis text,
    source_listing_reference_hash text,
    evidence_deduplication_key text,
    normalized_identity jsonb,
    confirmed_sold_quantity integer,
    item_price numeric,
    shipping_cost numeric,
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

revoke all on function public.import_marketplace_sold_evidence_v2(
  uuid,text,text,text,text,boolean,text,text,integer,integer,integer,integer,integer,
  integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_marketplace_sold_evidence_v2(
  uuid,text,text,text,text,boolean,text,text,integer,integer,integer,integer,integer,
  integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) to service_role;

comment on column public.marketplace_sold_evidence_import_batches.evidence_scope is
  'Market-wide for Product Research/Marketplace Insights; Seller Hub defaults to own-account evidence.';
comment on column public.marketplace_sold_evidence_import_batches.completed_without_sale_count is
  'Finalized listings without confirmed sold quantity; never inserted as confirmed sold evidence.';
