-- A completed V3 visual review and its durable publication transport are the
-- image authority for the listing package. Legacy package saves must not erase
-- or replace that seven-image set. This migration changes no eBay resource.

create or replace function public.enforce_ebay_v3_listing_package_image_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preview public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_transport public.ebay_v3_publication_image_transports%rowtype;
  v_asset_count integer;
  v_distinct_positions integer;
  v_distinct_roles integer;
  v_assets_valid boolean;
  v_roles_valid boolean;
  v_roles text[] := array[
    'PRIMARY_MAIN',
    'SECONDARY_MATERIAL_DETAIL',
    'SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY',
    'SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE',
    'SECONDARY_HUMAN_CONTEXT'
  ];
  v_urls jsonb;
  v_manifest jsonb;
  v_next_data jsonb;
  v_draft jsonb;
  v_image_authorization jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select review.*
  into v_preview
  from public.ebay_reference_guided_final_listing_review_previews review
  where review.listing_package_id = new.id
    and review.final_visual_set_locked
    and review.generation_controls_hidden
    and review.ready_for_unpublished_offer_authorization
    and review.visual_phase = 'COMPLETED'
    and review.provider_calls_snapshot = 8
    and cardinality(review.blockers) = 0
  order by review.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  select transport.*
  into v_transport
  from public.ebay_v3_publication_image_transports transport
  where transport.listing_package_id = new.id
    and transport.final_preview_id = v_preview.id
    and transport.attempt_id = v_preview.attempt_id
    and transport.preview_hash = v_preview.preview_hash
    and transport.status = 'READY'
    and transport.image_count = 7
  order by transport.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  if jsonb_typeof(v_transport.assets) <> 'array' then
    raise exception 'EBAY_V3_IMAGE_AUTHORITY_TRANSPORT_INVALID';
  end if;

  select
    count(*),
    count(distinct (asset ->> 'position')::integer),
    count(distinct asset ->> 'assetRole'),
    coalesce(bool_and(
      (asset ->> 'position') ~ '^[0-6]$'
      and (asset ->> 'sha256') ~ '^[0-9a-f]{64}$'
      and (asset ->> 'url') ~ '^https://[^[:space:][:cntrl:]]+$'
      and nullif(asset ->> 'assetRole', '') is not null
    ), false),
    coalesce(bool_and(
      (asset ->> 'assetRole') = v_roles[
        ((asset ->> 'position')::integer) + 1
      ]
    ), false),
    jsonb_agg(asset -> 'url' order by (asset ->> 'position')::integer),
    jsonb_agg(asset order by (asset ->> 'position')::integer)
  into
    v_asset_count,
    v_distinct_positions,
    v_distinct_roles,
    v_assets_valid,
    v_roles_valid,
    v_urls,
    v_manifest
  from jsonb_array_elements(v_transport.assets) asset;

  if v_asset_count <> 7
    or v_distinct_positions <> 7
    or v_distinct_roles <> 7
    or not v_assets_valid
    or not v_roles_valid
    or v_manifest -> 0 ->> 'assetRole' is distinct from 'PRIMARY_MAIN' then
    raise exception 'EBAY_V3_IMAGE_AUTHORITY_TRANSPORT_INVALID';
  end if;

  v_next_data := case
    when jsonb_typeof(new.package_data) = 'object' then new.package_data
    else '{}'::jsonb
  end;
  v_draft := case
    when jsonb_typeof(v_next_data -> 'draftConfiguration') = 'object'
      then v_next_data -> 'draftConfiguration'
    else '{}'::jsonb
  end;
  v_image_authorization := case
    when jsonb_typeof(v_draft -> 'imageAuthorization') = 'object'
      then v_draft -> 'imageAuthorization'
    else '{}'::jsonb
  end;

  v_before := jsonb_build_object(
    'imageUrls', v_next_data -> 'imageUrls',
    'imageAssetManifest', v_next_data -> 'imageAssetManifest',
    'imageAuthorization', v_image_authorization
  );

  v_image_authorization := v_image_authorization || jsonb_build_object(
    'approved', true,
    'approvedAt', v_preview.created_at,
    'approvedBy', v_preview.created_by,
    'approvedImageUrls', v_urls,
    'protectedManifestVerified', true,
    'protectedManifestAssetCount', 7,
    'rightsBasis', 'supplier_authorized',
    'source', 'luna'
  );
  v_draft := jsonb_set(
    v_draft,
    '{imageAuthorization}',
    v_image_authorization,
    true
  );
  v_next_data := jsonb_set(
    jsonb_set(
      jsonb_set(v_next_data, '{imageUrls}', v_urls, true),
      '{imageAssetManifest}',
      v_manifest,
      true
    ),
    '{draftConfiguration}',
    v_draft,
    true
  );

  v_after := jsonb_build_object(
    'imageUrls', v_next_data -> 'imageUrls',
    'imageAssetManifest', v_next_data -> 'imageAssetManifest',
    'imageAuthorization',
      v_next_data #> '{draftConfiguration,imageAuthorization}'
  );

  if v_before is distinct from v_after then
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
      new.id,
      v_preview.id,
      v_preview.preview_hash,
      v_transport.id,
      v_before,
      encode(
        extensions.digest(convert_to(v_before::text, 'UTF8'), 'sha256'),
        'hex'
      ),
      v_after,
      encode(
        extensions.digest(convert_to(v_after::text, 'UTF8'), 'sha256'),
        'hex'
      ),
      'FINAL_SNAPSHOT_SCREEN_AND_PAYLOAD_RECONCILIATION',
      v_preview.created_by
    )
    on conflict do nothing;
  end if;

  new.package_data := v_next_data;
  return new;
end;
$$;

revoke all on function
  public.enforce_ebay_v3_listing_package_image_authority()
from public, anon, authenticated, service_role;

drop trigger if exists ebay_v3_listing_package_image_authority_guard
on public.ebay_listing_packages;
create trigger ebay_v3_listing_package_image_authority_guard
before update on public.ebay_listing_packages
for each row execute function
  public.enforce_ebay_v3_listing_package_image_authority();

-- Repair any package that drifted before the trigger existed. The trigger
-- derives the exact URLs and manifest from the append-only READY transport.
update public.ebay_listing_packages package
set package_data = package.package_data,
    updated_at = now()
where exists (
  select 1
  from public.ebay_reference_guided_final_listing_review_previews review
  join public.ebay_v3_publication_image_transports transport
    on transport.final_preview_id = review.id
   and transport.listing_package_id = review.listing_package_id
   and transport.attempt_id = review.attempt_id
   and transport.preview_hash = review.preview_hash
   and transport.status = 'READY'
   and transport.image_count = 7
  where review.listing_package_id = package.id
    and review.final_visual_set_locked
    and review.ready_for_unpublished_offer_authorization
);

comment on function
  public.enforce_ebay_v3_listing_package_image_authority()
is 'Preserves the exact seven-image V3 publication transport across legacy listing-package saves; writes only internal audited package state.';

notify pgrst, 'reload schema';
