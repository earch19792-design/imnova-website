-- Visual QA is independent from commercial Luna freshness. These tables contain
-- only immutable visual evidence and human visual decisions; no cost, quantity
-- or availability fields are accepted.
create table if not exists public.ebay_reference_guided_primary_main_previews (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  asset_ordinal integer not null check (asset_ordinal = 0),
  asset_role text not null check (asset_role = 'PRIMARY_MAIN'),
  contract_version text not null check (contract_version = 'DETERMINISTIC_PRIMARY_MAIN_V1'),
  source_image_id text not null check (source_image_id = 'MAIN'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_storage_path text not null,
  safe_margin_pixels integer not null check (safe_margin_pixels = 120),
  background_color text not null check (background_color = '#FFFFFF'),
  output_width integer not null check (output_width = 1600),
  output_height integer not null check (output_height = 1600),
  output_storage_path text not null unique,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  transform_manifest_text text not null,
  transform_manifest_hash text not null check (transform_manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'PENDING_HUMAN_REVIEW'),
  created_at timestamptz not null default now(),
  unique(attempt_id, contract_version)
);

create table if not exists public.ebay_reference_guided_asset_review_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  asset_ordinal integer not null check (asset_ordinal between 0 and 6),
  asset_role text not null,
  preview_sha256 text not null check (preview_sha256 ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text not null,
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    (asset_ordinal = 0 and asset_role = 'PRIMARY_MAIN') or
    (asset_ordinal = 1 and asset_role = 'SECONDARY_MATERIAL_DETAIL') or
    (asset_ordinal = 2 and asset_role = 'SECONDARY_PACKAGE_CONTENTS') or
    (asset_ordinal = 3 and asset_role = 'SECONDARY_SCALE_CAPACITY') or
    (asset_ordinal = 4 and asset_role = 'SECONDARY_USE_CONTEXT') or
    (asset_ordinal = 5 and asset_role = 'SECONDARY_ASPIRATIONAL_LIFESTYLE') or
    (asset_ordinal = 6 and asset_role = 'SECONDARY_HUMAN_CONTEXT')
  ),
  unique(attempt_id, asset_ordinal, preview_sha256, decision)
);

drop trigger if exists ebay_reference_guided_primary_main_preview_append_only
  on public.ebay_reference_guided_primary_main_previews;
create trigger ebay_reference_guided_primary_main_preview_append_only
before update or delete on public.ebay_reference_guided_primary_main_previews
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

drop trigger if exists ebay_reference_guided_asset_review_events_append_only
  on public.ebay_reference_guided_asset_review_events;
create trigger ebay_reference_guided_asset_review_events_append_only
before update or delete on public.ebay_reference_guided_asset_review_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_primary_main_previews enable row level security;
alter table public.ebay_reference_guided_primary_main_previews force row level security;
alter table public.ebay_reference_guided_asset_review_events enable row level security;
alter table public.ebay_reference_guided_asset_review_events force row level security;

revoke all on table public.ebay_reference_guided_primary_main_previews,
  public.ebay_reference_guided_asset_review_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_primary_main_previews,
  public.ebay_reference_guided_asset_review_events to service_role;

notify pgrst, 'reload schema';
