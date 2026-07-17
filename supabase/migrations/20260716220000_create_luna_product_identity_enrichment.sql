-- Additive Preview/staging persistence for Loop 2 Luna identity enrichment.
-- Contains product facts and sanitized provenance only; no PII, credentials or competitor content.

alter table public.marketplace_listing_approval_queue_runs
  add column if not exists enrichment_version text null,
  add column if not exists identity_enriched_count integer not null default 0,
  add column if not exists identity_conflict_count integer not null default 0,
  add column if not exists catalog_read_count integer not null default 0,
  add column if not exists browse_read_count integer not null default 0,
  add column if not exists coverage_before jsonb not null default '{}'::jsonb,
  add column if not exists coverage_after jsonb not null default '{}'::jsonb,
  add column if not exists source_coverage jsonb not null default '{}'::jsonb;

create table if not exists public.marketplace_product_identity_enrichments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  market_radar_product_id uuid not null references public.market_radar_products(id) on delete restrict,
  supplier_product_id text not null,
  supplier_variant_id text not null,
  supplier_sku text not null,
  enrichment_version text not null,
  status text not null,
  identity_fingerprint text null,
  canonical_identity jsonb not null default '{}'::jsonb,
  logistics jsonb not null default '{}'::jsonb,
  conflict_attributes text[] not null default '{}'::text[],
  reason_codes text[] not null default '{}'::text[],
  source_coverage jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  next_retry_at timestamptz null,
  last_error_code text null,
  observed_at timestamptz not null,
  stale_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_product_identity_enrichments_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_identity_enrichments_status_check
    check (status in ('RESOLVED','CONFLICTED','NEEDS_DATA','RETRY_REQUIRED')),
  constraint marketplace_product_identity_enrichments_fingerprint_check
    check (identity_fingerprint is null or identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_identity_enrichments_json_check
    check (jsonb_typeof(canonical_identity) = 'object'
      and jsonb_typeof(logistics) = 'object'
      and jsonb_typeof(source_coverage) = 'object'),
  constraint marketplace_product_identity_enrichments_values_check
    check (retry_count >= 0 and stale_after > observed_at),
  constraint marketplace_product_identity_enrichments_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_product_identity_enrichments_unique
    unique (run_id, market_radar_product_id, supplier_variant_id)
);

create table if not exists public.marketplace_product_identity_attribute_evidence (
  id uuid primary key default gen_random_uuid(),
  enrichment_id uuid not null references public.marketplace_product_identity_enrichments(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  attribute_name text not null,
  raw_value jsonb null,
  normalized_value jsonb null,
  source_type text not null,
  source_identifier text not null,
  observed_at timestamptz not null,
  confidence numeric(5,4) not null,
  verified_by_rule text not null,
  conflict_status text not null,
  evidence_hash text not null,
  created_at timestamptz not null default now(),
  constraint marketplace_product_identity_evidence_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_identity_evidence_attribute_check
    check (attribute_name in ('manufacturer','brand','validGtin','mpn','model',
      'normalizedProductName','packCount','unitCount','totalContents','size','color',
      'scent','variant','condition','weight','dimensions','categoryId','requiredAspects')),
  constraint marketplace_product_identity_evidence_source_check
    check (source_type in ('LUNA_STRUCTURED','LUNA_AUTHORIZED_FEED','EBAY_CATALOG',
      'EBAY_BROWSE','MANUFACTURER_OFFICIAL','CONSERVATIVE_POLICY')),
  constraint marketplace_product_identity_evidence_conflict_check
    check (conflict_status in ('CLEAR','CONFLICTED','INVALID','UNVERIFIED')),
  constraint marketplace_product_identity_evidence_confidence_check
    check (confidence between 0 and 1),
  constraint marketplace_product_identity_evidence_identifier_check
    check (source_identifier ~ '^[A-Z_]+:sha256:[0-9a-f]{16}$'),
  constraint marketplace_product_identity_evidence_hash_check
    check (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_identity_evidence_append_unique
    unique (enrichment_id, evidence_hash)
);

create table if not exists public.marketplace_product_identity_source_attempts (
  id uuid primary key default gen_random_uuid(),
  enrichment_id uuid not null references public.marketplace_product_identity_enrichments(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  source_type text not null,
  status text not null,
  sanitized_error_code text null,
  retry_number integer not null default 0,
  started_at timestamptz not null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint marketplace_product_identity_attempts_marketplace_check check (marketplace = 'EBAY_US'),
  constraint marketplace_product_identity_attempts_source_check
    check (source_type in ('LUNA_STRUCTURED','LUNA_AUTHORIZED_FEED','EBAY_CATALOG',
      'EBAY_BROWSE','MANUFACTURER_OFFICIAL','CONSERVATIVE_POLICY')),
  constraint marketplace_product_identity_attempts_status_check
    check (status in ('AVAILABLE','NO_MATCH','NOT_CONFIGURED','REQUEST_FAILED','SKIPPED')),
  constraint marketplace_product_identity_attempts_error_check
    check (sanitized_error_code is null or sanitized_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_product_identity_attempts_retry_check check (retry_number >= 0)
);

alter table public.marketplace_listing_approval_queue_items
  add column if not exists identity_enrichment_id uuid null
    references public.marketplace_product_identity_enrichments(id) on delete set null;

create index if not exists marketplace_product_identity_enrichments_account_idx
  on public.marketplace_product_identity_enrichments(
    marketplace_account_key, marketplace, run_id, status, observed_at desc);
create index if not exists marketplace_product_identity_enrichments_sku_idx
  on public.marketplace_product_identity_enrichments(
    marketplace_account_key, marketplace, supplier_sku, observed_at desc);
create index if not exists marketplace_product_identity_enrichments_retry_idx
  on public.marketplace_product_identity_enrichments(
    marketplace_account_key, marketplace, next_retry_at)
  where next_retry_at is not null;
create index if not exists marketplace_product_identity_evidence_lookup_idx
  on public.marketplace_product_identity_attribute_evidence(
    marketplace_account_key, marketplace, enrichment_id, attribute_name, source_type);
create index if not exists marketplace_product_identity_attempts_lookup_idx
  on public.marketplace_product_identity_source_attempts(
    marketplace_account_key, marketplace, enrichment_id, started_at desc);
create index if not exists marketplace_listing_approval_queue_identity_enrichment_idx
  on public.marketplace_listing_approval_queue_items(
    marketplace_account_key, marketplace, identity_enrichment_id)
  where identity_enrichment_id is not null;

alter table public.marketplace_product_identity_enrichments enable row level security;
alter table public.marketplace_product_identity_attribute_evidence enable row level security;
alter table public.marketplace_product_identity_source_attempts enable row level security;

revoke all on table public.marketplace_product_identity_enrichments from anon, authenticated, service_role;
revoke all on table public.marketplace_product_identity_attribute_evidence from anon, authenticated, service_role;
revoke all on table public.marketplace_product_identity_source_attempts from anon, authenticated, service_role;

grant select, insert, update on table public.marketplace_product_identity_enrichments to service_role;
grant select, insert on table public.marketplace_product_identity_attribute_evidence to service_role;
grant select, insert on table public.marketplace_product_identity_source_attempts to service_role;

notify pgrst, 'reload schema';
