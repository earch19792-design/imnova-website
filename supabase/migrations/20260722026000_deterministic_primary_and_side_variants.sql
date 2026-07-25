-- Append-only deterministic asset alternatives. This migration does not alter
-- generation jobs, provider budgets, commercial facts, or publication state.
create table if not exists public.ebay_reference_guided_deterministic_asset_variants (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  asset_ordinal integer not null check (asset_ordinal in (0, 1)),
  asset_role text not null,
  variant_version text not null,
  source_image_id text not null check (source_image_id in ('MAIN', 'SIDE')),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_storage_path text not null,
  parent_output_sha256 text check (
    parent_output_sha256 is null or parent_output_sha256 ~ '^[0-9a-f]{64}$'
  ),
  crop_coordinates jsonb not null,
  output_width integer not null check (output_width = 1600),
  output_height integer not null check (output_height = 1600),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  transform_manifest_text text not null,
  transform_manifest_hash text not null check (transform_manifest_hash ~ '^[0-9a-f]{64}$'),
  qa_metrics jsonb not null,
  status text not null check (status = 'PENDING_HUMAN_SELECTION'),
  created_at timestamptz not null default now(),
  unique (attempt_id, variant_version),
  check (
    (asset_ordinal = 0 and asset_role = 'PRIMARY_MAIN'
      and variant_version = 'DETERMINISTIC_PRIMARY_VERTICAL_CENTER_V1'
      and source_image_id = 'MAIN' and parent_output_sha256 is not null)
    or
    (asset_ordinal = 1 and asset_role = 'SECONDARY_MATERIAL_DETAIL'
      and variant_version = 'DETERMINISTIC_SOURCE_CROP_SIDE_V1'
      and source_image_id = 'SIDE' and parent_output_sha256 is null)
  )
);

drop trigger if exists ebay_reference_guided_deterministic_asset_variants_append_only
  on public.ebay_reference_guided_deterministic_asset_variants;
create trigger ebay_reference_guided_deterministic_asset_variants_append_only
before update or delete on public.ebay_reference_guided_deterministic_asset_variants
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_deterministic_asset_variants
  enable row level security;
alter table public.ebay_reference_guided_deterministic_asset_variants
  force row level security;
revoke all on table public.ebay_reference_guided_deterministic_asset_variants
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_deterministic_asset_variants
  to service_role;

notify pgrst, 'reload schema';
