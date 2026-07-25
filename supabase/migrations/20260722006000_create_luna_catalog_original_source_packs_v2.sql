-- Protected, append-only evidence for catalog originals resolved before an
-- image revision claims an attempt. This migration does not call eBay and
-- does not alter any production listing projection.

create table if not exists public.luna_catalog_authorized_source_packs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  candidate_id uuid not null references
    public.ebay_same_day_pilot_candidates(id) on delete restrict,
  product_id uuid not null references public.market_radar_products(id)
    on delete restrict,
  supplier_product_id text not null,
  supplier_variant_id text not null,
  product_identity_hash text not null,
  authoritative_fact_package_hash text not null,
  product_url text not null,
  source_assets jsonb not null,
  source_asset_count integer not null,
  largest_native_width integer not null,
  largest_native_height integer not null,
  gallery_coverage text not null,
  available_view_types text[] not null,
  authorization_evidence_hash text not null,
  resolver_version text not null,
  source_pack_hash text not null,
  precheck jsonb not null,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint luna_catalog_source_pack_account_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint luna_catalog_source_pack_identity_check check (
    supplier_product_id ~ '^[0-9]{1,30}$'
    and supplier_variant_id ~ '^[0-9]{1,30}$'
    and product_identity_hash ~ '^sha256:[0-9a-f]{64}$'
    and authoritative_fact_package_hash ~ '^sha256:[0-9a-f]{64}$'
    and authorization_evidence_hash ~ '^[0-9a-f]{64}$'
    and source_pack_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint luna_catalog_source_pack_url_check check (
    product_url ~ '^https://(www[.])?lunaportex[.]com/products/[A-Za-z0-9%._~-]+$'
  ),
  constraint luna_catalog_source_pack_assets_check check (
    jsonb_typeof(source_assets) = 'array'
    and jsonb_array_length(source_assets) = source_asset_count
    and source_asset_count between 1 and 24
    and greatest(largest_native_width, largest_native_height) >= 500
    and least(largest_native_width, largest_native_height) >= 1
  ),
  constraint luna_catalog_source_pack_gallery_check check (
    gallery_coverage in ('SINGLE_VIEW', 'MULTI_VIEW', 'MULTI_VIEW_WITH_DETAIL')
    and cardinality(available_view_types) between 1 and 5
  ),
  constraint luna_catalog_source_pack_version_check check (
    resolver_version = 'LUNA_CATALOG_ORIGINAL_SOURCE_RESOLVER_V2'
  ),
  constraint luna_catalog_source_pack_precheck_check check (
    precheck @> '{
      "CATALOG_ORIGINAL_DISCOVERY_COMPLETED": true,
      "ALL_CATALOG_MEDIA_INSPECTED": true,
      "PRODUCT_IDENTITY_MATCHED": true,
      "SOURCE_PACK_READY": true,
      "SIX_SECONDARY_JOBS_FEASIBLE": true,
      "MARKET_VISUAL_SIGNALS_USABLE": true
    }'::jsonb
  ),
  constraint luna_catalog_source_pack_safety_check check (
    openai_calls = 0 and ebay_writes = 0 and production_changed = false
  ),
  constraint luna_catalog_source_pack_hash_unique unique (
    marketplace_account_key, listing_package_id, source_pack_hash
  )
);

create index if not exists luna_catalog_source_pack_candidate_idx
  on public.luna_catalog_authorized_source_packs(
    candidate_id, created_at desc
  );

create or replace function public.prevent_luna_catalog_source_pack_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'LUNA_CATALOG_SOURCE_PACK_APPEND_ONLY';
end;
$$;

drop trigger if exists prevent_luna_catalog_source_pack_mutation
  on public.luna_catalog_authorized_source_packs;
create trigger prevent_luna_catalog_source_pack_mutation
before update or delete on public.luna_catalog_authorized_source_packs
for each row execute function public.prevent_luna_catalog_source_pack_mutation();

alter table public.luna_catalog_authorized_source_packs enable row level security;
alter table public.luna_catalog_authorized_source_packs force row level security;
revoke all on table public.luna_catalog_authorized_source_packs
  from public, anon, authenticated;
grant select, insert on table public.luna_catalog_authorized_source_packs
  to service_role;

comment on table public.luna_catalog_authorized_source_packs is
  'Append-only protected Luna/Shopify original-media evidence resolved before consuming an image revision attempt; zero OpenAI calls and zero eBay writes.';
