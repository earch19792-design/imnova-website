-- Loop 2 only: append-only factual provenance and readiness gates.
-- These tables intentionally store structured scalar facts and hashes, never raw pages,
-- credentials, cookies, competitor images, source URLs, OpenAI input/output or eBay writes.

create table if not exists public.marketplace_product_fact_runs (
  id uuid primary key default gen_random_uuid(),
  queue_run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  engine_version text not null,
  candidate_limit integer not null default 20,
  candidates_requested integer not null default 0,
  candidates_processed integer not null default 0,
  candidates_excluded integer not null default 0,
  source_reads jsonb not null default '{}'::jsonb,
  status text not null default 'RUNNING',
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_runs_marketplace_check check (marketplace = 'EBAY_US'),
  constraint marketplace_product_fact_runs_limit_check check (candidate_limit between 1 and 20),
  constraint marketplace_product_fact_runs_counts_check check (candidates_requested >= 0
    and candidates_processed >= 0 and candidates_excluded >= 0),
  constraint marketplace_product_fact_runs_status_check check (status in ('RUNNING','COMPLETED','PARTIAL','FAILED')),
  constraint marketplace_product_fact_runs_safety_check check (openai_calls = 0 and ebay_writes = 0 and production_changed = false)
);

create table if not exists public.marketplace_product_fact_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  luna_variant_id text null,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  source_type text not null,
  source_reference_hash text not null,
  source_authority text not null,
  source_observed_at timestamptz null,
  fetched_at timestamptz not null,
  expires_at timestamptz null,
  snapshot_status text not null,
  sanitized_snapshot jsonb not null default '{}'::jsonb,
  evidence_hash text not null,
  adapter_version text not null,
  raw_html_stored boolean not null default false,
  source_urls_stored boolean not null default false,
  credentials_stored boolean not null default false,
  cookies_stored boolean not null default false,
  images_stored boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_source_snapshots_marketplace_check check (marketplace = 'EBAY_US'),
  constraint marketplace_product_fact_source_snapshots_hash_check check (source_reference_hash ~ '^[A-Z_]+:sha256:[0-9a-f]{24}$'
    and evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_source_snapshots_source_check check (source_type in ('LUNA_EXACT_VARIANT','LUNA_FULFILLMENT',
    'EBAY_BROWSE_OFFICIAL_READONLY','EBAY_TRADING_GET_ITEM_READONLY','EBAY_CATALOG_OFFICIAL_READONLY',
    'EBAY_TAXONOMY_OFFICIAL_READONLY','MANUFACTURER_OFFICIAL_PUBLIC','OFFICIAL_LABEL','REGULATOR_OFFICIAL',
    'PHYSICAL_MEASUREMENT_CONFIRMED','INTERNAL_DERIVATION','INTERNAL_ESTIMATE')),
  constraint marketplace_product_fact_source_snapshots_authority_check check (source_authority in ('SUPPLIER','MANUFACTURER_OR_LABEL',
    'EBAY_TAXONOMY','REGULATOR','FULFILLMENT','PHYSICAL_MEASUREMENT','CORROBORATION','INTERNAL')),
  constraint marketplace_product_fact_source_snapshots_content_check check (jsonb_typeof(sanitized_snapshot) = 'object'
    and lower(sanitized_snapshot::text) !~ '(https?://|cookie|authorization|password|token|base64|blob|imageurl|rawhtml|<html|data:image)'),
  constraint marketplace_product_fact_source_snapshots_safety_check check (raw_html_stored = false and source_urls_stored = false
    and credentials_stored = false and cookies_stored = false and images_stored = false),
  constraint marketplace_product_fact_source_snapshots_unique unique (queue_item_id, evidence_hash)
);

create table if not exists public.marketplace_product_fact_observations (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  luna_variant_id text null,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  fact_scope text not null,
  fact_key text not null,
  raw_value jsonb null,
  normalized_value jsonb null,
  normalized_unit text null,
  source_type text not null,
  source_reference text not null,
  source_authority text not null,
  source_observed_at timestamptz not null,
  fetched_at timestamptz not null,
  expires_at timestamptz null,
  confidence numeric(5,4) not null,
  verification_status text not null,
  evidence_hash text not null,
  adapter_version text not null,
  derivation jsonb null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_observations_marketplace_check check (marketplace = 'EBAY_US'),
  constraint marketplace_product_fact_observations_scope_check check (fact_scope in ('PRODUCT_UNIT','OFFER_PACK','SHIPPING_PACKAGE','EBAY_LISTING_REQUIREMENTS')),
  constraint marketplace_product_fact_observations_status_check check (verification_status in ('VERIFIED','CORROBORATED','DERIVED_VERIFIED',
    'ESTIMATED_INTERNAL','MISSING','CONFLICTED','NOT_APPLICABLE','REJECTED')),
  constraint marketplace_product_fact_observations_source_check check (source_type in ('LUNA_EXACT_VARIANT','LUNA_FULFILLMENT',
    'EBAY_BROWSE_OFFICIAL_READONLY','EBAY_TRADING_GET_ITEM_READONLY','EBAY_CATALOG_OFFICIAL_READONLY',
    'EBAY_TAXONOMY_OFFICIAL_READONLY','MANUFACTURER_OFFICIAL_PUBLIC','OFFICIAL_LABEL','REGULATOR_OFFICIAL',
    'PHYSICAL_MEASUREMENT_CONFIRMED','INTERNAL_DERIVATION','INTERNAL_ESTIMATE')),
  constraint marketplace_product_fact_observations_authority_check check (source_authority in ('SUPPLIER','MANUFACTURER_OR_LABEL',
    'EBAY_TAXONOMY','REGULATOR','FULFILLMENT','PHYSICAL_MEASUREMENT','CORROBORATION','INTERNAL')),
  constraint marketplace_product_fact_observations_confidence_check check (confidence between 0 and 1),
  constraint marketplace_product_fact_observations_hash_check check (evidence_hash ~ '^sha256:[0-9a-f]{64}$'
    and source_reference ~ '^[A-Z_]+:sha256:[0-9a-f]{24}$'),
  constraint marketplace_product_fact_observations_content_check check ((raw_value is null or lower(raw_value::text) !~ '(https?://|cookie|authorization|password|token|base64|blob|imageurl|rawhtml|<html|data:image)')
    and (normalized_value is null or lower(normalized_value::text) !~ '(https?://|cookie|authorization|password|token|base64|blob|imageurl|rawhtml|<html|data:image)')),
  constraint marketplace_product_fact_observations_unique unique (queue_item_id, evidence_hash)
);

create table if not exists public.marketplace_product_fact_resolutions (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  fact_scope text not null,
  fact_key text not null,
  selected_value jsonb null,
  selected_unit text null,
  supporting_observation_ids uuid[] not null default '{}'::uuid[],
  conflicting_observation_ids uuid[] not null default '{}'::uuid[],
  resolution_rule text not null,
  confidence numeric(5,4) not null,
  verification_status text not null,
  resolved_at timestamptz not null,
  resolver_version text not null,
  resolution_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_resolutions_scope_check check (fact_scope in ('PRODUCT_UNIT','OFFER_PACK','SHIPPING_PACKAGE','EBAY_LISTING_REQUIREMENTS')),
  constraint marketplace_product_fact_resolutions_status_check check (verification_status in ('VERIFIED','CORROBORATED','DERIVED_VERIFIED',
    'ESTIMATED_INTERNAL','MISSING','CONFLICTED','NOT_APPLICABLE','REJECTED')),
  constraint marketplace_product_fact_resolutions_confidence_check check (confidence between 0 and 1),
  constraint marketplace_product_fact_resolutions_hash_check check (resolution_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_resolutions_unique unique (queue_item_id, resolution_hash)
);

create table if not exists public.marketplace_product_fact_conflicts (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  fact_scope text not null,
  fact_key text not null,
  observation_ids uuid[] not null default '{}'::uuid[],
  conflicting_value_hashes text[] not null default '{}'::text[],
  conflict_status text not null default 'CONFLICTED_BLOCKING',
  detected_at timestamptz not null,
  resolver_version text not null,
  conflict_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_conflicts_status_check check (conflict_status = 'CONFLICTED_BLOCKING'),
  constraint marketplace_product_fact_conflicts_hash_check check (conflict_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_conflicts_unique unique (queue_item_id, conflict_hash)
);

create table if not exists public.marketplace_product_fact_requirements (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  category_tree_id text null,
  category_id text null,
  aspect_name text not null,
  required boolean not null,
  mapped_fact_key text null,
  selected_value jsonb null,
  allowed_values jsonb not null default '[]'::jsonb,
  requirement_status text not null,
  taxonomy_observed_at timestamptz null,
  requirement_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_requirements_status_check check (requirement_status in ('SATISFIED_VERIFIED','SATISFIED_CORROBORATED',
    'NOT_APPLICABLE','MISSING_OPTIONAL','MISSING_BLOCKING','CONFLICTED_BLOCKING')),
  constraint marketplace_product_fact_requirements_values_check check (jsonb_typeof(allowed_values) = 'array'),
  constraint marketplace_product_fact_requirements_hash_check check (requirement_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_requirements_unique unique (queue_item_id, requirement_hash)
);

create table if not exists public.marketplace_offer_pack_fact_profiles (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  offer_pack_count integer null,
  units_per_pack integer null,
  total_unit_count integer null,
  manufacturer_multipack boolean null,
  seller_created_multipack boolean null,
  multipack_gtin text null,
  unit_gtin_reference text null,
  pack_labeling_requirements jsonb not null default '[]'::jsonb,
  profile_status text not null,
  profile_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_offer_pack_fact_profiles_status_check check (profile_status in ('READY','MISSING','CONFLICTED')),
  constraint marketplace_offer_pack_fact_profiles_gtin_check check (multipack_gtin is null or multipack_gtin !~ '[^0-9]'),
  constraint marketplace_offer_pack_fact_profiles_hash_check check (profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_offer_pack_fact_profiles_unique unique (queue_item_id, profile_hash)
);

create table if not exists public.marketplace_shipping_package_profiles (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  package_type text null,
  shipping_weight numeric null,
  shipping_weight_unit text null,
  shipping_length numeric null,
  shipping_width numeric null,
  shipping_height numeric null,
  dimension_unit text null,
  dimensional_weight numeric null,
  packaging_material text null,
  packaging_allowance jsonb not null default '{}'::jsonb,
  fulfillment_source text null,
  measurement_source text null,
  measurement_status text not null,
  estimation_model_version text null,
  assumptions jsonb not null default '{}'::jsonb,
  maximum_error_tolerance_percent numeric null,
  profile_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_shipping_package_profiles_status_check check (measurement_status in ('ACTUAL_CONFIRMED','SUPPLIER_PROVIDED',
    'FULFILLMENT_PROVIDED','ESTIMATED_INTERNAL','MISSING','CONFLICTED')),
  constraint marketplace_shipping_package_profiles_hash_check check (profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_shipping_package_profiles_unique unique (queue_item_id, profile_hash)
);

create table if not exists public.marketplace_product_fact_readiness_events (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  gate_name text not null,
  ready boolean not null,
  blocking_reason_codes text[] not null default '{}'::text[],
  exception jsonb null,
  resolver_version text not null,
  event_hash text not null,
  observed_at timestamptz not null,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_readiness_events_gate_check check (gate_name in ('IDENTITY_READY','PRODUCT_FACTS_READY','OFFER_PACK_READY',
    'EBAY_ASPECTS_READY','REGULATORY_READY','SHIPPING_ESTIMATE_READY','SHIPPING_CONFIRMED','OPENAI_INPUT_READY','PUBLICATION_FACTS_READY')),
  constraint marketplace_product_fact_readiness_events_hash_check check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_readiness_events_safety_check check (openai_calls = 0 and ebay_writes = 0 and production_changed = false),
  constraint marketplace_product_fact_readiness_events_unique unique (queue_item_id, event_hash)
);

create index if not exists marketplace_product_fact_runs_account_idx on public.marketplace_product_fact_runs (marketplace_account_key, marketplace, created_at desc);
create index if not exists marketplace_product_fact_observations_candidate_idx on public.marketplace_product_fact_observations (marketplace_account_key, queue_item_id, created_at desc);
create index if not exists marketplace_product_fact_resolutions_candidate_idx on public.marketplace_product_fact_resolutions (marketplace_account_key, queue_item_id, resolved_at desc);
create index if not exists marketplace_product_fact_readiness_candidate_idx on public.marketplace_product_fact_readiness_events (marketplace_account_key, queue_item_id, observed_at desc);

alter table public.marketplace_product_fact_runs enable row level security;
alter table public.marketplace_product_fact_runs force row level security;
alter table public.marketplace_product_fact_source_snapshots enable row level security;
alter table public.marketplace_product_fact_source_snapshots force row level security;
alter table public.marketplace_product_fact_observations enable row level security;
alter table public.marketplace_product_fact_observations force row level security;
alter table public.marketplace_product_fact_resolutions enable row level security;
alter table public.marketplace_product_fact_resolutions force row level security;
alter table public.marketplace_product_fact_conflicts enable row level security;
alter table public.marketplace_product_fact_conflicts force row level security;
alter table public.marketplace_product_fact_requirements enable row level security;
alter table public.marketplace_offer_pack_fact_profiles enable row level security;
alter table public.marketplace_shipping_package_profiles enable row level security;
alter table public.marketplace_product_fact_readiness_events enable row level security;
alter table public.marketplace_product_fact_readiness_events force row level security;

revoke all on table public.marketplace_product_fact_runs, public.marketplace_product_fact_source_snapshots,
  public.marketplace_product_fact_observations, public.marketplace_product_fact_resolutions,
  public.marketplace_product_fact_conflicts, public.marketplace_product_fact_requirements,
  public.marketplace_offer_pack_fact_profiles, public.marketplace_shipping_package_profiles,
  public.marketplace_product_fact_readiness_events from public, anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_fact_runs, public.marketplace_product_fact_source_snapshots,
  public.marketplace_product_fact_observations, public.marketplace_product_fact_resolutions,
  public.marketplace_product_fact_conflicts, public.marketplace_product_fact_requirements,
  public.marketplace_offer_pack_fact_profiles, public.marketplace_shipping_package_profiles,
  public.marketplace_product_fact_readiness_events to service_role;

create or replace function public.reject_product_fact_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'PRODUCT_FACTS_APPEND_ONLY';
end;
$$;

create trigger marketplace_product_fact_runs_append_only before update or delete on public.marketplace_product_fact_runs for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_source_snapshots_append_only before update or delete on public.marketplace_product_fact_source_snapshots for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_observations_append_only before update or delete on public.marketplace_product_fact_observations for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_resolutions_append_only before update or delete on public.marketplace_product_fact_resolutions for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_conflicts_append_only before update or delete on public.marketplace_product_fact_conflicts for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_requirements_append_only before update or delete on public.marketplace_product_fact_requirements for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_offer_pack_fact_profiles_append_only before update or delete on public.marketplace_offer_pack_fact_profiles for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_shipping_package_profiles_append_only before update or delete on public.marketplace_shipping_package_profiles for each row execute function public.reject_product_fact_mutation();
create trigger marketplace_product_fact_readiness_events_append_only before update or delete on public.marketplace_product_fact_readiness_events for each row execute function public.reject_product_fact_mutation();

comment on table public.marketplace_product_fact_observations is 'Append-only, source-provenanced product facts for Loop 2. Prohibits raw pages, source URLs, cookies, credentials and images.';
comment on table public.marketplace_product_fact_readiness_events is 'Append-only fact gate decisions. OpenAI remains off and eBay writes remain zero.';
notify pgrst, 'reload schema';
