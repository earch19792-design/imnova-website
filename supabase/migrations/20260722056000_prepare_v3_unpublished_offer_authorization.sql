-- Durable, service-role-only preparation records for a V3 final visual set.
-- This migration does not call eBay and does not create an Inventory Item,
-- Offer, or listing.

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png']
where id = 'ebay-listing-images';

create table if not exists public.ebay_v3_publication_image_transports (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  attempt_id uuid not null,
  listing_package_id uuid not null references public.ebay_listing_packages(id),
  final_preview_id uuid not null references public.ebay_reference_guided_final_listing_review_previews(id),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  source_bucket text not null check (source_bucket = 'ebay-listing-image-staging'),
  publication_bucket text not null check (publication_bucket = 'ebay-listing-images'),
  assets jsonb not null,
  transport_hash text not null check (transport_hash ~ '^[0-9a-f]{64}$'),
  image_count integer not null check (image_count = 7),
  scope text not null check (scope = 'EBAY_US_UNPUBLISHED_OFFER_ONLY'),
  status text not null check (status = 'READY'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (attempt_id, preview_hash),
  unique (transport_hash)
);

create table if not exists public.ebay_v3_unpublished_offer_authorization_previews (
  id uuid primary key,
  revision_id uuid not null,
  attempt_id uuid not null,
  listing_package_id uuid not null references public.ebay_listing_packages(id),
  final_preview_id uuid not null references public.ebay_reference_guided_final_listing_review_previews(id),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  image_transport_id uuid not null references public.ebay_v3_publication_image_transports(id),
  image_transport_hash text not null check (image_transport_hash ~ '^[0-9a-f]{64}$'),
  target text not null check (target in ('SANDBOX', 'PRODUCTION')),
  account_fingerprint text not null,
  sku text not null,
  listing_quantity integer not null check (listing_quantity > 0),
  exact_payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  preflight_snapshot_expires_at timestamptz not null,
  confirmation_phrase text not null,
  gates jsonb not null,
  blockers jsonb not null default '[]'::jsonb,
  status text not null check (status in (
    'READY_FOR_HUMAN_AUTHORIZATION',
    'SUPERSEDED',
    'AUTHORIZED'
  )),
  inventory_item_created boolean not null default false check (not inventory_item_created),
  offer_created boolean not null default false check (not offer_created),
  publish_offer_called boolean not null default false check (not publish_offer_called),
  ebay_writes integer not null default 0 check (ebay_writes = 0),
  production_changed boolean not null default false check (not production_changed),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 8),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (preview_hash, payload_hash)
);

alter table public.ebay_v3_publication_image_transports enable row level security;
alter table public.ebay_v3_publication_image_transports force row level security;
alter table public.ebay_v3_unpublished_offer_authorization_previews enable row level security;
alter table public.ebay_v3_unpublished_offer_authorization_previews force row level security;

revoke all on public.ebay_v3_publication_image_transports from public, anon, authenticated;
revoke all on public.ebay_v3_unpublished_offer_authorization_previews from public, anon, authenticated;
revoke all on public.ebay_v3_publication_image_transports from service_role;
revoke all on public.ebay_v3_unpublished_offer_authorization_previews from service_role;
grant select, insert on public.ebay_v3_publication_image_transports to service_role;
grant select, insert on public.ebay_v3_unpublished_offer_authorization_previews to service_role;

create or replace function public.reject_v3_unpublished_authorization_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'EBAY_V3_UNPUBLISHED_AUTHORIZATION_APPEND_ONLY';
end;
$$;

revoke all on function public.reject_v3_unpublished_authorization_mutation() from public;
revoke all on function public.reject_v3_unpublished_authorization_mutation() from anon, authenticated;
grant execute on function public.reject_v3_unpublished_authorization_mutation() to service_role;

drop trigger if exists ebay_v3_publication_image_transports_append_only
on public.ebay_v3_publication_image_transports;
create trigger ebay_v3_publication_image_transports_append_only
before update or delete on public.ebay_v3_publication_image_transports
for each row execute function public.reject_v3_unpublished_authorization_mutation();

drop trigger if exists ebay_v3_unpublished_offer_authorization_previews_append_only
on public.ebay_v3_unpublished_offer_authorization_previews;
create trigger ebay_v3_unpublished_offer_authorization_previews_append_only
before update or delete on public.ebay_v3_unpublished_offer_authorization_previews
for each row execute function public.reject_v3_unpublished_authorization_mutation();
