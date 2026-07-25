-- Internal staging reconciliation only. It changes no eBay resource.
-- Before/after authority snapshots are retained append-only.

create table if not exists public.ebay_v3_listing_package_reconciliations (
  id uuid primary key default gen_random_uuid(),
  listing_package_id uuid not null references public.ebay_listing_packages(id),
  final_preview_id uuid not null references
    public.ebay_reference_guided_final_listing_review_previews(id),
  final_preview_hash text not null check (final_preview_hash ~ '^[0-9a-f]{64}$'),
  image_transport_id uuid not null references
    public.ebay_v3_publication_image_transports(id),
  before_authority jsonb not null,
  before_authority_hash text not null check (before_authority_hash ~ '^[0-9a-f]{64}$'),
  after_authority jsonb not null,
  after_authority_hash text not null check (after_authority_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (
    reason = 'FINAL_SNAPSHOT_SCREEN_AND_PAYLOAD_RECONCILIATION'
  ),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (listing_package_id, final_preview_hash, after_authority_hash)
);

alter table public.ebay_v3_listing_package_reconciliations enable row level security;
alter table public.ebay_v3_listing_package_reconciliations force row level security;
revoke all on public.ebay_v3_listing_package_reconciliations
from public, anon, authenticated, service_role;
grant select, insert on public.ebay_v3_listing_package_reconciliations
to service_role;

drop trigger if exists ebay_v3_listing_package_reconciliations_append_only
on public.ebay_v3_listing_package_reconciliations;
create trigger ebay_v3_listing_package_reconciliations_append_only
before update or delete on public.ebay_v3_listing_package_reconciliations
for each row execute function
  public.reject_v3_unpublished_authorization_mutation();

do $$
declare
  v_preview public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_transport public.ebay_v3_publication_image_transports%rowtype;
  v_listing jsonb;
  v_urls jsonb;
  v_manifest jsonb;
  v_before jsonb;
  v_after jsonb;
  v_next_package_data jsonb;
begin
  select * into strict v_preview
  from public.ebay_reference_guided_final_listing_review_previews
  where attempt_id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    and preview_hash =
      'd6827d6697310771eeedb8ff40d223bfb3c413444eb92fcf6774bc5d993a2bd0';

  select * into strict v_package
  from public.ebay_listing_packages
  where id = v_preview.listing_package_id
  for update;

  select * into strict v_transport
  from public.ebay_v3_publication_image_transports
  where attempt_id = v_preview.attempt_id
    and preview_hash = v_preview.preview_hash
    and status = 'READY';

  v_listing := v_preview.preview_snapshot -> 'listing';
  if v_listing ->> 'title' is distinct from
      'Calypso Basics by Reston Lloyd 1.5 Qt Powder Coated Enamel Colander White'
    or v_listing ->> 'categoryId' is distinct from '20636'
    or v_listing #>> '{itemSpecifics,Size}' is distinct from '1.5 Quart'
    or v_listing #>> '{pricing,targetPrice}' is distinct from '21.39'
    or v_listing ->> 'quantity' is distinct from '1' then
    raise exception 'CALYPSO_FINAL_AUTHORITY_INVALID';
  end if;

  select jsonb_agg(asset -> 'url' order by (asset ->> 'position')::integer),
         jsonb_agg(asset order by (asset ->> 'position')::integer)
  into v_urls, v_manifest
  from jsonb_array_elements(v_transport.assets) asset;

  if jsonb_array_length(v_urls) <> 7
    or (v_manifest -> 0 ->> 'assetRole') is distinct from 'PRIMARY_MAIN' then
    raise exception 'CALYPSO_FINAL_IMAGE_TRANSPORT_INVALID';
  end if;

  v_before := jsonb_build_object(
    'title', v_package.package_data -> 'title',
    'aspects', v_package.package_data -> 'aspects',
    'imageUrls', v_package.package_data -> 'imageUrls',
    'draftConfiguration', v_package.package_data -> 'draftConfiguration'
  );

  v_next_package_data := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_package.package_data,
          '{title}',
          v_listing -> 'title',
          true
        ),
        '{aspects}',
        v_listing -> 'itemSpecifics',
        true
      ),
      '{imageUrls}',
      v_urls,
      true
    ),
    '{imageAssetManifest}',
    v_manifest,
    true
  );

  v_next_package_data := jsonb_set(
    v_next_package_data,
    '{draftConfiguration}',
    coalesce(v_next_package_data -> 'draftConfiguration', '{}'::jsonb)
      || jsonb_build_object(
        'sku', 'IMNOVA-34608F12B90C4241AC113B86D20F0A3E',
        'quantity', 1,
        'condition', 'NEW',
        'merchantLocationKey', v_listing ->> 'merchantLocationKey',
        'businessPolicies', jsonb_build_object(
          'fulfillmentPolicyId',
            v_listing #>> '{businessPolicies,fulfillmentPolicyId}',
          'paymentPolicyId',
            v_listing #>> '{businessPolicies,paymentPolicyId}',
          'returnPolicyId',
            v_listing #>> '{businessPolicies,returnPolicyId}',
          'verifiedSourceAt',
            v_listing #>> '{businessPolicies,verifiedAt}'
        ),
        'packageWeightAndSize', '{}'::jsonb,
        'imageAuthorization', jsonb_build_object(
          'approved', true,
          'source', 'luna',
          'rightsBasis', 'supplier_authorized',
          'approvedImageUrls', v_urls,
          'protectedManifestVerified', true,
          'protectedManifestAssetCount', 7
        )
      ),
    true
  );

  v_after := jsonb_build_object(
    'title', v_next_package_data -> 'title',
    'aspects', v_next_package_data -> 'aspects',
    'imageUrls', v_next_package_data -> 'imageUrls',
    'draftConfiguration', v_next_package_data -> 'draftConfiguration'
  );

  insert into public.ebay_v3_listing_package_reconciliations (
    listing_package_id,
    final_preview_id,
    final_preview_hash,
    image_transport_id,
    before_authority,
    before_authority_hash,
    after_authority,
    after_authority_hash,
    reason,
    created_by
  ) values (
    v_package.id,
    v_preview.id,
    v_preview.preview_hash,
    v_transport.id,
    v_before,
    encode(digest(convert_to(v_before::text, 'UTF8'), 'sha256'), 'hex'),
    v_after,
    encode(digest(convert_to(v_after::text, 'UTF8'), 'sha256'), 'hex'),
    'FINAL_SNAPSHOT_SCREEN_AND_PAYLOAD_RECONCILIATION',
    v_preview.created_by
  )
  on conflict do nothing;

  update public.ebay_listing_packages
  set package_data = v_next_package_data,
      updated_at = now()
  where id = v_package.id;
end;
$$;
