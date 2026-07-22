create table if not exists public.luna_catalog_source_pack_dossier_bindings (
  id uuid primary key default gen_random_uuid(),
  source_pack_id uuid not null references public.luna_catalog_authorized_source_packs(id) on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete restrict,
  dossier_hash text not null check (dossier_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_pack_manifest_hash text not null check (source_pack_manifest_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'),
  verified_at timestamptz not null default now(),
  unique(source_pack_id, dossier_hash)
);
alter table public.luna_catalog_source_pack_dossier_bindings enable row level security;
alter table public.luna_catalog_source_pack_dossier_bindings force row level security;
revoke all on public.luna_catalog_source_pack_dossier_bindings from public, anon, authenticated;
grant select, insert on public.luna_catalog_source_pack_dossier_bindings to service_role;
create or replace function public.prevent_luna_catalog_source_pack_dossier_binding_mutation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin raise exception 'LUNA_CATALOG_SOURCE_PACK_DOSSIER_BINDING_APPEND_ONLY'; end; $$;
drop trigger if exists prevent_luna_catalog_source_pack_dossier_binding_mutation on public.luna_catalog_source_pack_dossier_bindings;
create trigger prevent_luna_catalog_source_pack_dossier_binding_mutation before update or delete on public.luna_catalog_source_pack_dossier_bindings for each row execute function public.prevent_luna_catalog_source_pack_dossier_binding_mutation();
