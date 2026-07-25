-- Append-only authorization for the two exact native catalog views approved
-- for the Calypso staging revision. No external request and no eBay write is
-- performed by this migration.

create table if not exists public.ebay_authorized_catalog_native_media (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id)
    on delete restrict,
  candidate_id uuid not null references public.ebay_same_day_pilot_candidates(id)
    on delete restrict,
  supplier_product_id text not null,
  supplier_variant_id text not null,
  source_image_id text not null,
  source_angle text not null,
  source_url text not null,
  expected_sha256 text not null,
  native_width integer not null,
  native_height integer not null,
  authorization_status text not null,
  authorization_reference text not null,
  excluded_source_sha256s text[] not null,
  resolver_version text not null,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ebay_authorized_native_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and supplier_product_id ~ '^[0-9]{1,30}$'
    and supplier_variant_id ~ '^[0-9]{1,30}$'
  ),
  constraint ebay_authorized_native_identity_check check (
    source_image_id in ('MAIN', 'SIDE')
    and source_angle in ('FRONT', 'SIDE')
    and ((source_image_id = 'MAIN' and source_angle = 'FRONT')
      or (source_image_id = 'SIDE' and source_angle = 'SIDE'))
    and authorization_status = 'AUTHORIZED_CATALOG_NATIVE_HIGH_RES'
    and expected_sha256 ~ '^[0-9a-f]{64}$'
    and greatest(native_width, native_height) >= 1200
  ),
  constraint ebay_authorized_native_url_check check (
    source_url ~ '^https://m[.]media-amazon[.]com/images/I/[A-Za-z0-9+_-]+[.]_SL1500_[.]jpg$'
  ),
  constraint ebay_authorized_native_exclusion_check check (
    cardinality(excluded_source_sha256s) = 5
    and not expected_sha256 = any(excluded_source_sha256s)
  ),
  constraint ebay_authorized_native_safety_check check (
    resolver_version = 'AUTHORIZED_CATALOG_NATIVE_MEDIA_V1_2026_07_22'
    and ebay_writes = 0 and production_changed = false
  ),
  constraint ebay_authorized_native_unique unique (
    marketplace_account_key, listing_package_id, source_image_id
  )
);

create or replace function public.prevent_ebay_authorized_native_media_mutation()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  raise exception 'AUTHORIZED_CATALOG_NATIVE_MEDIA_APPEND_ONLY';
end;
$$;

drop trigger if exists prevent_ebay_authorized_native_media_mutation
  on public.ebay_authorized_catalog_native_media;
create trigger prevent_ebay_authorized_native_media_mutation
before update or delete on public.ebay_authorized_catalog_native_media
for each row execute function
  public.prevent_ebay_authorized_native_media_mutation();

alter table public.ebay_authorized_catalog_native_media enable row level security;
alter table public.ebay_authorized_catalog_native_media force row level security;
revoke all on table public.ebay_authorized_catalog_native_media
  from anon, authenticated;
revoke all on table public.ebay_authorized_catalog_native_media
  from public;
grant select, insert on table public.ebay_authorized_catalog_native_media
  to service_role;

with package_scope as (
  select id, account_key, created_by
  from public.ebay_listing_packages
  where id = '34608f12-b90c-4241-ac11-3b86d20f0a3e'::uuid
), approved_sources as (
  select * from (values
    ('MAIN', 'FRONT',
      'https://m.media-amazon.com/images/I/71U-K-A+nYL._SL1500_.jpg',
      '3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1',
      1500, 905),
    ('SIDE', 'SIDE',
      'https://m.media-amazon.com/images/I/61KXCx1tZ1L._SL1500_.jpg',
      '0360d335277351af99587eee55604c2808d6f6bc1a29ca7e0234d360497d700e',
      1500, 1053)
  ) as source(source_image_id, source_angle, source_url, expected_sha256,
    native_width, native_height)
)
insert into public.ebay_authorized_catalog_native_media (
  marketplace_account_key, created_by, listing_package_id, candidate_id,
  supplier_product_id, supplier_variant_id, source_image_id, source_angle,
  source_url, expected_sha256, native_width, native_height,
  authorization_status, authorization_reference, excluded_source_sha256s,
  resolver_version
)
select package_scope.account_key, package_scope.created_by, package_scope.id,
  'ab226a81-6d42-4404-a62a-b22d333be398'::uuid,
  '9220835311840', '48809646489824', approved_sources.source_image_id,
  approved_sources.source_angle, approved_sources.source_url,
  approved_sources.expected_sha256, approved_sources.native_width,
  approved_sources.native_height, 'AUTHORIZED_CATALOG_NATIVE_HIGH_RES',
  'USER_APPROVED_CONTROLLED_COMPOSITE_V1_2026_07_21',
  array[
    '3dd4cb7f37c13275b0504e405c3ac849d1dfd24b7d9ecc0b96fdfe8ada74cbda',
    'eff0ece04ca7acf18ae14654d6cf9af7fe9305a5ef446380da2337c2e046dce0',
    '3dd09b7103535c33db9d472a640ca9e81bee21142576c8a96a414571a1465f22',
    '8403b36c11225d45381eaf2641904f2dbaa9392f50888e1c63342e61701c658d',
    'c1be5b63611d49ca6e339d724aa8bc1af45fe5bbda95012a775b554dba1d8bd9'
  ]::text[], 'AUTHORIZED_CATALOG_NATIVE_MEDIA_V1_2026_07_22'
from package_scope cross join approved_sources
on conflict (marketplace_account_key, listing_package_id, source_image_id)
do nothing;

comment on table public.ebay_authorized_catalog_native_media is
  'Append-only exact MAIN/SIDE native catalog authorization. The five excluded media hashes may supply no pixels or generative references.';
