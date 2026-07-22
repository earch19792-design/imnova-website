-- Append-only metadata for protected, content-addressed catalog snapshots.
alter table public.luna_catalog_authorized_source_packs
  add column if not exists source_pack_version text,
  add column if not exists policy_version text,
  add column if not exists manifest_hash text,
  add column if not exists reconciliation_reason text,
  add column if not exists verified_at timestamptz;

create unique index if not exists luna_catalog_source_pack_active_version_uidx
  on public.luna_catalog_authorized_source_packs(marketplace_account_key, listing_package_id, resolver_version, source_pack_version)
  where source_pack_version is not null;

alter table public.luna_catalog_authorized_source_packs
  add constraint luna_catalog_source_pack_policy_check
  check (policy_version is null or policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1');
alter table public.luna_catalog_authorized_source_packs
  add constraint luna_catalog_source_pack_manifest_check
  check (manifest_hash is null or manifest_hash ~ '^[0-9a-f]{64}$');

comment on column public.luna_catalog_authorized_source_packs.source_pack_version is
  'Immutable content version; a changed source creates a successor row.';
