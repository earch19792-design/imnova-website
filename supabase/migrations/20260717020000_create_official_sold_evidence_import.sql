-- Loop 2: reviewed, official sold/completed evidence imports for Preview/staging.
-- Additive only. Raw files, competitor titles, seller identities, image URLs and PII are not stored.

create table if not exists public.marketplace_sold_evidence_import_batches (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  source_type text not null,
  source_export_type text not null,
  source_file_hash text not null,
  import_schema_version text not null,
  status text not null default 'IMPORTED',
  operator_attested boolean not null,
  row_count integer not null,
  imported_count integer not null,
  duplicate_count integer not null,
  rejected_count integer not null,
  error_counts jsonb not null default '{}'::jsonb,
  source_observed_start timestamptz null,
  source_observed_end timestamptz null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_sold_evidence_import_batches_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_sold_evidence_import_batches_source_check
    check (source_type in ('EBAY_OFFICIAL_CSV_IMPORT','EBAY_OFFICIAL_JSON_IMPORT')),
  constraint marketplace_sold_evidence_import_batches_export_check
    check (source_export_type in (
      'EBAY_PRODUCT_RESEARCH_EXPORT','EBAY_SELLER_HUB_EXPORT',
      'EBAY_MARKETPLACE_INSIGHTS_EXPORT'
    )),
  constraint marketplace_sold_evidence_import_batches_hash_check
    check (source_file_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_sold_evidence_import_batches_status_check
    check (status in ('IMPORTED','REJECTED')),
  constraint marketplace_sold_evidence_import_batches_attestation_check
    check (operator_attested = true),
  constraint marketplace_sold_evidence_import_batches_counts_check check (
    row_count >= 0 and imported_count >= 0 and duplicate_count >= 0 and rejected_count >= 0
    and imported_count + duplicate_count + rejected_count = row_count
  ),
  constraint marketplace_sold_evidence_import_batches_errors_check
    check (jsonb_typeof(error_counts) = 'object'),
  constraint marketplace_sold_evidence_import_batches_file_unique
    unique (marketplace_account_key, marketplace, source_file_hash)
);

create table if not exists public.marketplace_sold_evidence_observations (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.marketplace_sold_evidence_import_batches(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null,
  source_type text not null,
  source_export_type text not null,
  source_listing_reference_hash text not null,
  evidence_deduplication_key text not null,
  normalized_identity jsonb not null,
  confirmed_sold_quantity integer not null,
  item_price numeric(14,2) null,
  shipping_cost numeric(14,2) null,
  currency text not null default 'USD',
  keyword_signals text[] not null default '{}'::text[],
  shipping_pattern text null,
  returns_pattern text null,
  image_count integer null,
  visual_evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  eligible_until timestamptz not null,
  evidence_reviewed boolean not null,
  raw_file_stored boolean not null default false,
  competitor_title_stored boolean not null default false,
  seller_identity_stored boolean not null default false,
  competitor_image_url_stored boolean not null default false,
  competitor_image_downloaded boolean not null default false,
  pii_stored boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_sold_evidence_observations_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_sold_evidence_observations_source_check
    check (source_type in ('EBAY_OFFICIAL_CSV_IMPORT','EBAY_OFFICIAL_JSON_IMPORT')),
  constraint marketplace_sold_evidence_observations_export_check
    check (source_export_type in (
      'EBAY_PRODUCT_RESEARCH_EXPORT','EBAY_SELLER_HUB_EXPORT',
      'EBAY_MARKETPLACE_INSIGHTS_EXPORT'
    )),
  constraint marketplace_sold_evidence_observations_hashes_check check (
    source_listing_reference_hash ~ '^sha256:[0-9a-f]{64}$'
    and evidence_deduplication_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_sold_evidence_observations_identity_check
    check (jsonb_typeof(normalized_identity) = 'object'),
  constraint marketplace_sold_evidence_observations_values_check check (
    confirmed_sold_quantity > 0
    and (item_price is null or item_price >= 0)
    and (shipping_cost is null or shipping_cost >= 0)
    and (image_count is null or image_count >= 0)
    and currency = 'USD'
    and eligible_until >= observed_at
  ),
  constraint marketplace_sold_evidence_observations_review_check
    check (evidence_reviewed = true),
  constraint marketplace_sold_evidence_observations_no_content_check check (
    raw_file_stored = false
    and competitor_title_stored = false
    and seller_identity_stored = false
    and competitor_image_url_stored = false
    and competitor_image_downloaded = false
    and pii_stored = false
  ),
  constraint marketplace_sold_evidence_observations_visual_check
    check (jsonb_typeof(visual_evidence) = 'object'),
  constraint marketplace_sold_evidence_observations_dedup_unique
    unique (marketplace_account_key, marketplace, evidence_deduplication_key)
);

alter table public.marketplace_listing_approval_queue_runs
  add column if not exists sold_evidence_version text null,
  add column if not exists sold_evidence_applied_version text null,
  add column if not exists sold_evidence_imported_at timestamptz null;

alter table public.marketplace_listing_approval_queue_runs
  add constraint marketplace_listing_approval_queue_runs_sold_evidence_hashes_check check (
    (sold_evidence_version is null or sold_evidence_version ~ '^sha256:[0-9a-f]{64}$')
    and (sold_evidence_applied_version is null or sold_evidence_applied_version ~ '^sha256:[0-9a-f]{64}$')
  ) not valid;
alter table public.marketplace_listing_approval_queue_runs
  validate constraint marketplace_listing_approval_queue_runs_sold_evidence_hashes_check;

create index if not exists marketplace_sold_evidence_import_batches_account_time_idx
  on public.marketplace_sold_evidence_import_batches(
    marketplace_account_key, marketplace, imported_at desc
  );
create index if not exists marketplace_sold_evidence_observations_match_idx
  on public.marketplace_sold_evidence_observations(
    marketplace_account_key, marketplace, eligible_until desc, observed_at desc
  );
create index if not exists marketplace_sold_evidence_observations_gtin_idx
  on public.marketplace_sold_evidence_observations(
    marketplace_account_key, marketplace, (normalized_identity->>'gtin')
  ) where normalized_identity->>'gtin' is not null;
create index if not exists marketplace_sold_evidence_observations_model_idx
  on public.marketplace_sold_evidence_observations(
    marketplace_account_key, marketplace,
    (normalized_identity->>'manufacturerBrand'), (normalized_identity->>'mpn'),
    (normalized_identity->>'model')
  );

create or replace function public.import_marketplace_sold_evidence_v1(
  p_batch_id uuid,
  p_marketplace_account_key text,
  p_source_type text,
  p_source_export_type text,
  p_source_file_hash text,
  p_import_schema_version text,
  p_row_count integer,
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
    id,marketplace_account_key,marketplace,source_type,source_export_type,
    source_file_hash,import_schema_version,status,operator_attested,row_count,
    imported_count,duplicate_count,rejected_count,error_counts,
    source_observed_start,source_observed_end,reviewed_by
  ) values (
    p_batch_id,p_marketplace_account_key,'EBAY_US',p_source_type,p_source_export_type,
    p_source_file_hash,p_import_schema_version,'IMPORTED',true,p_row_count,
    v_imported_count,p_duplicate_count,p_rejected_count,coalesce(p_error_counts,'{}'::jsonb),
    p_source_observed_start,p_source_observed_end,p_reviewed_by
  );

  insert into public.marketplace_sold_evidence_observations(
    import_batch_id,marketplace_account_key,marketplace,source_type,source_export_type,
    source_listing_reference_hash,evidence_deduplication_key,normalized_identity,
    confirmed_sold_quantity,item_price,shipping_cost,currency,keyword_signals,
    shipping_pattern,returns_pattern,image_count,visual_evidence,observed_at,
    eligible_until,evidence_reviewed
  )
  select
    p_batch_id,p_marketplace_account_key,'EBAY_US',p_source_type,p_source_export_type,
    row.source_listing_reference_hash,row.evidence_deduplication_key,row.normalized_identity,
    row.confirmed_sold_quantity,row.item_price,row.shipping_cost,'USD',row.keyword_signals,
    row.shipping_pattern,row.returns_pattern,row.image_count,row.visual_evidence,
    row.observed_at,row.eligible_until,true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
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

alter table public.marketplace_sold_evidence_import_batches enable row level security;
alter table public.marketplace_sold_evidence_import_batches force row level security;
alter table public.marketplace_sold_evidence_observations enable row level security;
alter table public.marketplace_sold_evidence_observations force row level security;

revoke all on table public.marketplace_sold_evidence_import_batches from public, anon, authenticated, service_role;
revoke all on table public.marketplace_sold_evidence_observations from public, anon, authenticated, service_role;
grant select, insert on table public.marketplace_sold_evidence_import_batches to service_role;
grant select, insert on table public.marketplace_sold_evidence_observations to service_role;
revoke all on function public.import_marketplace_sold_evidence_v1(
  uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.import_marketplace_sold_evidence_v1(
  uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,timestamptz,uuid,jsonb
) to service_role;

create policy marketplace_sold_evidence_import_batches_service_role_v1
  on public.marketplace_sold_evidence_import_batches
  for all to service_role
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

create policy marketplace_sold_evidence_observations_service_role_v1
  on public.marketplace_sold_evidence_observations
  for all to service_role
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

comment on table public.marketplace_sold_evidence_import_batches is
  'Audit-only metadata for reviewed official eBay sold/completed imports; raw files and PII are prohibited.';
comment on table public.marketplace_sold_evidence_observations is
  'Normalized sold/completed evidence without competitor titles, seller identities, image URLs, raw files or PII.';
