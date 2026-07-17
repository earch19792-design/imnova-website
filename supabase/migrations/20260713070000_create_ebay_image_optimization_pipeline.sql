-- Authorized, derivative image assets for eBay listing packages.
-- Source/output hashes and review evidence remain immutable. Rejected private
-- objects are deleted; only reviewed derivatives may be copied into a listing
-- package. This migration performs no eBay operation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ebay-listing-images',
  'ebay-listing-images',
  true,
  12582912,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ebay-listing-image-sources',
  'ebay-listing-image-sources',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A derivative is not public merely because the automatic QA passed. It stays
-- in this private bucket until the seller performs the explicit human review.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ebay-listing-image-staging',
  'ebay-listing-image-staging',
  false,
  12582912,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.ebay_listing_image_assets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid null references public.ebay_luna_opportunity_queue(id) on delete set null,
  listing_package_id uuid null references public.ebay_listing_packages(id) on delete cascade,
  candidate_key text not null,
  asset_role text not null default 'main',
  status text not null default 'pending_review',
  source_kind text not null,
  source_url text null,
  source_storage_path text null,
  output_storage_path text not null unique,
  published_storage_path text null unique,
  public_url text null,
  source_sha256 text not null,
  output_sha256 text not null,
  source_width integer not null,
  source_height integer not null,
  output_width integer not null,
  output_height integer not null,
  output_bytes integer not null,
  rights_basis text not null,
  authorization_reference text not null,
  rights_evidence_confirmed boolean not null,
  transformation_version text not null,
  transformation jsonb not null default '{}'::jsonb,
  qa_result jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  approved_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete set null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_image_assets_role_check check (
    asset_role in ('main', 'detail', 'packaging', 'label', 'lifestyle')
  ),
  constraint ebay_listing_image_assets_status_check check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  constraint ebay_listing_image_assets_source_check check (
    source_kind in ('authorized_url', 'owned_upload')
  ),
  constraint ebay_listing_image_assets_rights_check check (
    rights_basis in ('supplier_authorized', 'owned', 'licensed')
  ),
  constraint ebay_listing_image_assets_hashes_check check (
    source_sha256 ~ '^[0-9a-f]{64}$' and output_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_listing_image_assets_dimensions_check check (
    source_width > 0 and source_height > 0 and
    output_width = 1600 and output_height = 1600 and
    output_bytes between 1 and 12582912
  ),
  constraint ebay_listing_image_assets_authorization_check check (
    length(trim(authorization_reference)) >= 8
    and rights_evidence_confirmed = true
  ),
  constraint ebay_listing_image_assets_review_evidence_check check (
    (
      status = 'pending_review'
      and approved_at is null and approved_by is null and rejected_at is null
      and published_storage_path is null and public_url is null
    )
    or (
      status = 'approved'
      and approved_at is not null and approved_by is not null and rejected_at is null
      and nullif(trim(published_storage_path), '') is not null
      and public_url ~ '^https://'
    )
    or (
      status = 'rejected'
      and approved_at is null and approved_by is null and rejected_at is not null
      and published_storage_path is null and public_url is null
    )
  )
);

create index if not exists ebay_listing_image_assets_package_idx
  on public.ebay_listing_image_assets(listing_package_id, status, position, created_at);
create index if not exists ebay_listing_image_assets_candidate_idx
  on public.ebay_listing_image_assets(candidate_key, status, created_at desc);
create unique index if not exists ebay_listing_image_assets_package_output_hash_uidx
  on public.ebay_listing_image_assets(created_by, listing_package_id, output_sha256)
  where listing_package_id is not null
    and status in ('pending_review', 'approved');
create unique index if not exists ebay_listing_image_assets_unscoped_output_hash_uidx
  on public.ebay_listing_image_assets(created_by, candidate_key, output_sha256)
  where listing_package_id is null
    and status in ('pending_review', 'approved');
create unique index if not exists ebay_listing_image_assets_active_position_uidx
  on public.ebay_listing_image_assets(listing_package_id, position)
  where listing_package_id is not null
    and status in ('pending_review', 'approved');
create unique index if not exists ebay_listing_image_assets_active_main_uidx
  on public.ebay_listing_image_assets(listing_package_id)
  where listing_package_id is not null
    and status in ('pending_review', 'approved')
    and asset_role = 'main';

-- Creation, slot assignment and main-image election are one transaction. The
-- package row is the mutex shared by create/review/reorder, preventing two
-- simultaneous uploads from both claiming position 0 or exceeding eBay's cap.
create or replace function public.ebay_create_pending_listing_image(
  p_package_id uuid,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_asset jsonb
)
returns setof public.ebay_listing_image_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_asset_id uuid;
  v_requested_role text;
  v_effective_role text;
  v_active_count integer;
  v_next_position integer;
  v_source_path text;
  v_output_path text;
  v_asset public.ebay_listing_image_assets%rowtype;
begin
  if p_package_id is null
    or p_actor is null
    or p_opportunity_id is null
    or nullif(trim(p_candidate_key), '') is null
    or jsonb_typeof(coalesce(p_asset, '{}'::jsonb)) <> 'object' then
    raise exception 'EBAY_IMAGE_CREATE_SCOPE_INVALID';
  end if;

  begin
    v_asset_id := nullif(p_asset ->> 'id', '')::uuid;
  exception when others then
    raise exception 'EBAY_IMAGE_CREATE_ASSET_ID_INVALID';
  end;
  if v_asset_id is null then
    raise exception 'EBAY_IMAGE_CREATE_ASSET_ID_INVALID';
  end if;

  v_requested_role := coalesce(nullif(p_asset ->> 'asset_role', ''), 'main');
  if v_requested_role not in ('main', 'detail', 'packaging', 'label', 'lifestyle') then
    raise exception 'EBAY_IMAGE_CREATE_ROLE_INVALID';
  end if;
  v_source_path := nullif(p_asset ->> 'source_storage_path', '');
  v_output_path := nullif(p_asset ->> 'output_storage_path', '');
  if v_source_path is null
    or v_output_path is null
    or v_source_path !~ (
      '^' || p_actor::text || '/[0-9a-f]{24}/' || v_asset_id::text
      || '-source[.](jpg|png|webp)$'
    )
    or v_output_path !~ (
      '^' || p_actor::text || '/[0-9a-f]{24}/' || v_asset_id::text
      || '-optimized[.]jpg$'
    ) then
    raise exception 'EBAY_IMAGE_CREATE_STORAGE_PATH_INVALID';
  end if;

  select package_row.*
  into v_package
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.opportunity_id = p_opportunity_id
    and package_row.candidate_key = p_candidate_key
    and package_row.status <> 'archived'
  for update;
  if not found then
    raise exception 'EBAY_IMAGE_PACKAGE_NOT_FOUND';
  end if;

  select count(*), coalesce(max(image_asset.position), -1) + 1
  into v_active_count, v_next_position
  from public.ebay_listing_image_assets image_asset
  where image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status in ('pending_review', 'approved');
  if v_active_count >= 24 then
    raise exception 'EBAY_IMAGE_ACTIVE_CAP_REACHED';
  end if;
  v_effective_role := case
    when v_active_count = 0 then 'main'
    when v_requested_role = 'main' then 'detail'
    else v_requested_role
  end;

  insert into public.ebay_listing_image_assets (
    id, created_by, opportunity_id, listing_package_id, candidate_key,
    asset_role, status, source_kind, source_url, source_storage_path,
    output_storage_path, published_storage_path, public_url,
    source_sha256, output_sha256, source_width, source_height,
    output_width, output_height, output_bytes, rights_basis,
    authorization_reference, rights_evidence_confirmed,
    transformation_version, transformation, qa_result, position
  ) values (
    v_asset_id, p_actor, p_opportunity_id, p_package_id, p_candidate_key,
    v_effective_role, 'pending_review', p_asset ->> 'source_kind',
    nullif(p_asset ->> 'source_url', ''), v_source_path, v_output_path,
    null, null, p_asset ->> 'source_sha256', p_asset ->> 'output_sha256',
    (p_asset ->> 'source_width')::integer,
    (p_asset ->> 'source_height')::integer,
    (p_asset ->> 'output_width')::integer,
    (p_asset ->> 'output_height')::integer,
    (p_asset ->> 'output_bytes')::integer,
    p_asset ->> 'rights_basis', p_asset ->> 'authorization_reference',
    (p_asset ->> 'rights_evidence_confirmed')::boolean,
    p_asset ->> 'transformation_version',
    coalesce(p_asset -> 'transformation', '{}'::jsonb),
    coalesce(p_asset -> 'qa_result', '{}'::jsonb),
    v_next_position
  )
  returning * into v_asset;

  return next v_asset;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EBAY_IMAGE_CREATE_METADATA_INVALID';
end;
$$;

-- Serialize image-manifest attachment with every concurrent package edit. The
-- function changes only the two derived image keys; it never replaces the
-- package_data snapshot supplied by an API caller. Any image review/reorder
-- invalidates prior readiness so the complete package must be reviewed again.
create or replace function public.ebay_attach_approved_listing_images(
  p_package_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_image_urls jsonb := '[]'::jsonb;
  v_image_manifest jsonb := '[]'::jsonb;
begin
  if p_package_id is null or p_actor is null then
    raise exception 'EBAY_IMAGE_PACKAGE_ACTOR_REQUIRED';
  end if;

  select package_row.*
  into v_package
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.status <> 'archived'
  for update;

  if not found then
    raise exception 'EBAY_IMAGE_PACKAGE_NOT_FOUND';
  end if;

  select
    coalesce(
      jsonb_agg(asset.public_url order by asset.position, asset.created_at, asset.id),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'assetId', asset.id,
          'url', asset.public_url,
          'role', asset.asset_role,
          'position', asset.position,
          'sha256', asset.output_sha256,
          'transformationVersion', asset.transformation_version,
          'automaticQa', asset.qa_result ->> 'automaticStatus',
          'humanApprovedAt', asset.approved_at
        )
        order by asset.position, asset.created_at, asset.id
      ),
      '[]'::jsonb
    )
  into v_image_urls, v_image_manifest
  from (
    select image_asset.*
    from public.ebay_listing_image_assets image_asset
    where image_asset.listing_package_id = p_package_id
      and image_asset.created_by = p_actor
      and image_asset.status = 'approved'
      and image_asset.published_storage_path is not null
      and image_asset.public_url ~ '^https://'
      and image_asset.rights_evidence_confirmed = true
      and image_asset.qa_result ->> 'automaticStatus' = 'PASSED'
      and image_asset.approved_at is not null
      and image_asset.approved_by is not null
    order by image_asset.position, image_asset.created_at, image_asset.id
    limit 24
  ) asset;

  update public.ebay_listing_packages package_row
  set package_data = jsonb_set(
        jsonb_set(
          coalesce(package_row.package_data, '{}'::jsonb),
          '{imageUrls}',
          v_image_urls,
          true
        ),
        '{imageAssetManifest}',
        v_image_manifest,
        true
      ),
      status = 'draft',
      readiness = 0,
      updated_at = now()
  where package_row.id = p_package_id
    and package_row.created_by = p_actor;

  return jsonb_build_object(
    'imageUrls', v_image_urls,
    'imageAssetManifest', v_image_manifest,
    'packageStatus', 'draft',
    'readiness', 0
  );
end;
$$;

-- All package saves and evidence refreshes serialize on the package row and
-- rebuild the protected image fields from reviewed assets. A stale browser
-- snapshot can therefore never restore a rejected image or erase a newly
-- approved manifest. Refreshes patch only server-derived evidence/defaults;
-- seller-authored fields are read from the locked, current row.
create or replace function public.ebay_save_listing_package_guarded(
  p_package_id uuid,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_operation text,
  p_package_patch jsonb,
  p_status text,
  p_readiness numeric,
  p_source_observed_at timestamptz,
  p_expected_updated_at timestamptz
)
returns setof public.ebay_listing_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_next_data jsonb;
  v_approved_urls jsonb := '[]'::jsonb;
  v_image_manifest jsonb := '[]'::jsonb;
  v_requested_urls jsonb := '[]'::jsonb;
  v_selected_urls jsonb := '[]'::jsonb;
  v_requested_count integer := 0;
  v_draft jsonb := '{}'::jsonb;
  v_patch_draft jsonb := '{}'::jsonb;
  v_policies jsonb := '{}'::jsonb;
  v_patch_policies jsonb := '{}'::jsonb;
  v_package_size jsonb := '{}'::jsonb;
  v_patch_package_size jsonb := '{}'::jsonb;
  v_dimensions jsonb := '{}'::jsonb;
  v_patch_dimensions jsonb := '{}'::jsonb;
  v_weight jsonb := '{}'::jsonb;
  v_patch_weight jsonb := '{}'::jsonb;
begin
  if p_package_id is null
    or p_actor is null
    or p_opportunity_id is null
    or p_candidate_key is null
    or p_operation is null
    or p_operation not in ('save', 'refresh')
    or jsonb_typeof(coalesce(p_package_patch, '{}'::jsonb)) <> 'object'
    or p_status is null
    or p_status not in ('draft', 'ready_for_review')
    or p_readiness is null
    or p_expected_updated_at is null
    or p_readiness < 0
    or p_readiness > 100 then
    raise exception 'EBAY_LISTING_PACKAGE_GUARDED_WRITE_INVALID';
  end if;

  select package_row.*
  into v_package
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.opportunity_id = p_opportunity_id
    and package_row.candidate_key = p_candidate_key
    and package_row.status <> 'archived'
  for update;
  if not found then
    raise exception 'EBAY_LISTING_PACKAGE_GUARDED_WRITE_NOT_FOUND';
  end if;
  if v_package.updated_at is distinct from p_expected_updated_at then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;

  select
    coalesce(
      jsonb_agg(asset.public_url order by asset.position, asset.created_at, asset.id),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'assetId', asset.id,
          'url', asset.public_url,
          'role', asset.asset_role,
          'position', asset.position,
          'sha256', asset.output_sha256,
          'transformationVersion', asset.transformation_version,
          'automaticQa', asset.qa_result ->> 'automaticStatus',
          'humanApprovedAt', asset.approved_at
        ) order by asset.position, asset.created_at, asset.id
      ),
      '[]'::jsonb
    )
  into v_approved_urls, v_image_manifest
  from (
    select image_asset.*
    from public.ebay_listing_image_assets image_asset
    where image_asset.listing_package_id = p_package_id
      and image_asset.created_by = p_actor
      and image_asset.status = 'approved'
      and image_asset.published_storage_path is not null
      and image_asset.public_url ~ '^https://'
      and image_asset.rights_evidence_confirmed = true
      and image_asset.qa_result ->> 'automaticStatus' = 'PASSED'
      and image_asset.output_sha256 ~ '^[0-9a-f]{64}$'
      and image_asset.approved_at is not null
      and image_asset.approved_by is not null
    order by image_asset.position, image_asset.created_at, image_asset.id
    limit 24
  ) asset;

  if p_operation = 'save' then
    v_next_data := coalesce(p_package_patch, '{}'::jsonb)
      - 'imageUrls' - 'imageAssetManifest';
    v_requested_urls := coalesce(p_package_patch->'imageUrls', '[]'::jsonb);
  else
    v_next_data := coalesce(v_package.package_data, '{}'::jsonb);
    v_requested_urls := coalesce(v_next_data->'imageUrls', '[]'::jsonb);

    if p_package_patch ? 'pricing' then
      v_next_data := jsonb_set(
        v_next_data, '{pricing}', p_package_patch->'pricing', true
      );
    end if;
    if p_package_patch ? 'evidenceSnapshot' then
      v_next_data := jsonb_set(
        v_next_data, '{evidenceSnapshot}',
        p_package_patch->'evidenceSnapshot', true
      );
    end if;
    if p_package_patch ? 'sourceRefresh' then
      v_next_data := jsonb_set(
        v_next_data, '{sourceRefresh}', p_package_patch->'sourceRefresh', true
      );
    end if;
    if p_package_patch ? 'safeDefaults' then
      v_next_data := jsonb_set(
        v_next_data, '{safeDefaults}', p_package_patch->'safeDefaults', true
      );
    end if;

    -- Safe seller defaults fill only blank fields in the locked current row.
    -- They never replace a seller value saved by a concurrent request.
    v_draft := case
      when jsonb_typeof(v_next_data->'draftConfiguration') = 'object'
        then v_next_data->'draftConfiguration'
      else '{}'::jsonb
    end;
    v_patch_draft := case
      when jsonb_typeof(p_package_patch->'draftConfiguration') = 'object'
        then p_package_patch->'draftConfiguration'
      else '{}'::jsonb
    end;
    if nullif(trim(v_draft->>'condition'), '') is null
      and nullif(trim(v_patch_draft->>'condition'), '') is not null then
      v_draft := jsonb_set(
        v_draft, '{condition}', v_patch_draft->'condition', true
      );
    end if;
    if nullif(trim(v_draft->>'merchantLocationKey'), '') is null
      and nullif(trim(v_patch_draft->>'merchantLocationKey'), '') is not null then
      v_draft := jsonb_set(
        v_draft, '{merchantLocationKey}',
        v_patch_draft->'merchantLocationKey', true
      );
    end if;

    v_policies := case
      when jsonb_typeof(v_draft->'businessPolicies') = 'object'
        then v_draft->'businessPolicies'
      else '{}'::jsonb
    end;
    v_patch_policies := case
      when jsonb_typeof(v_patch_draft->'businessPolicies') = 'object'
        then v_patch_draft->'businessPolicies'
      else '{}'::jsonb
    end;
    if nullif(trim(v_policies->>'fulfillmentPolicyId'), '') is null
      and nullif(trim(v_patch_policies->>'fulfillmentPolicyId'), '') is not null then
      v_policies := jsonb_set(
        v_policies, '{fulfillmentPolicyId}',
        v_patch_policies->'fulfillmentPolicyId', true
      );
    end if;
    if nullif(trim(v_policies->>'paymentPolicyId'), '') is null
      and nullif(trim(v_patch_policies->>'paymentPolicyId'), '') is not null then
      v_policies := jsonb_set(
        v_policies, '{paymentPolicyId}',
        v_patch_policies->'paymentPolicyId', true
      );
    end if;
    if nullif(trim(v_policies->>'returnPolicyId'), '') is null
      and nullif(trim(v_patch_policies->>'returnPolicyId'), '') is not null then
      v_policies := jsonb_set(
        v_policies, '{returnPolicyId}',
        v_patch_policies->'returnPolicyId', true
      );
    end if;
    v_draft := jsonb_set(
      v_draft, '{businessPolicies}', v_policies, true
    );

    v_package_size := case
      when jsonb_typeof(v_draft->'packageWeightAndSize') = 'object'
        then v_draft->'packageWeightAndSize'
      else '{}'::jsonb
    end;
    v_patch_package_size := case
      when jsonb_typeof(v_patch_draft->'packageWeightAndSize') = 'object'
        then v_patch_draft->'packageWeightAndSize'
      else '{}'::jsonb
    end;
    v_dimensions := case
      when jsonb_typeof(v_package_size->'dimensions') = 'object'
        then v_package_size->'dimensions'
      else '{}'::jsonb
    end;
    v_patch_dimensions := case
      when jsonb_typeof(v_patch_package_size->'dimensions') = 'object'
        then v_patch_package_size->'dimensions'
      else '{}'::jsonb
    end;
    if nullif(trim(v_dimensions->>'unit'), '') is null
      and nullif(trim(v_patch_dimensions->>'unit'), '') is not null then
      v_dimensions := jsonb_set(
        v_dimensions, '{unit}', v_patch_dimensions->'unit', true
      );
    end if;
    v_weight := case
      when jsonb_typeof(v_package_size->'weight') = 'object'
        then v_package_size->'weight'
      else '{}'::jsonb
    end;
    v_patch_weight := case
      when jsonb_typeof(v_patch_package_size->'weight') = 'object'
        then v_patch_package_size->'weight'
      else '{}'::jsonb
    end;
    if nullif(trim(v_weight->>'unit'), '') is null
      and nullif(trim(v_patch_weight->>'unit'), '') is not null then
      v_weight := jsonb_set(v_weight, '{unit}', v_patch_weight->'unit', true);
    end if;
    v_package_size := jsonb_set(
      jsonb_set(v_package_size, '{dimensions}', v_dimensions, true),
      '{weight}', v_weight, true
    );
    v_draft := jsonb_set(
      v_draft, '{packageWeightAndSize}', v_package_size, true
    );
    v_next_data := jsonb_set(
      v_next_data, '{draftConfiguration}', v_draft, true
    );
  end if;

  if jsonb_typeof(v_requested_urls) <> 'array' then
    v_requested_urls := '[]'::jsonb;
  end if;
  select count(distinct requested.url)
  into v_requested_count
  from jsonb_array_elements_text(v_requested_urls)
    as requested(url)
  where nullif(trim(requested.url), '') is not null;

  select coalesce(
    jsonb_agg(selected.url order by selected.first_position),
    '[]'::jsonb
  )
  into v_selected_urls
  from (
    select requested.url, min(requested.position) as first_position
    from jsonb_array_elements_text(v_requested_urls)
      with ordinality as requested(url, position)
    where exists (
      select 1
      from jsonb_array_elements_text(v_approved_urls) approved(url)
      where approved.url = requested.url
    )
    group by requested.url
    order by first_position
    limit 24
  ) selected;

  if p_operation = 'save'
    and p_status = 'ready_for_review'
    and (
      jsonb_array_length(v_selected_urls) = 0
      or v_requested_count > 24
      or jsonb_array_length(v_selected_urls) <> v_requested_count
    ) then
    raise exception 'EBAY_LISTING_PACKAGE_APPROVED_IMAGES_CHANGED';
  end if;

  v_next_data := jsonb_set(
    jsonb_set(v_next_data, '{imageUrls}', v_selected_urls, true),
    '{imageAssetManifest}', v_image_manifest, true
  );

  update public.ebay_listing_packages package_row
  set package_data = v_next_data,
      status = case
        when p_operation = 'refresh' then 'draft'
        else p_status
      end,
      readiness = case
        when p_operation = 'refresh' then 0
        else p_readiness
      end,
      source_observed_at = case
        when p_operation = 'refresh' then p_source_observed_at
        else package_row.source_observed_at
      end,
      updated_at = now()
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
  returning package_row.* into v_package;

  return next v_package;
end;
$$;

create or replace function public.ebay_review_listing_image_and_attach(
  p_package_id uuid,
  p_asset_id uuid,
  p_actor uuid,
  p_decision text,
  p_public_url text,
  p_published_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_attachment jsonb;
  v_approved_count integer;
  v_next_main_id uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'EBAY_IMAGE_REVIEW_DECISION_INVALID';
  end if;
  if p_decision = 'reject'
    and (p_public_url is not null or p_published_storage_path is not null) then
    raise exception 'EBAY_IMAGE_REJECT_PUBLICATION_INVALID';
  end if;

  select package_row.* into v_package
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.status <> 'archived'
  for update;
  if not found then raise exception 'EBAY_IMAGE_PACKAGE_NOT_FOUND'; end if;

  select image_asset.* into v_asset
  from public.ebay_listing_image_assets image_asset
  where image_asset.id = p_asset_id
    and image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status = 'pending_review'
  for update;
  if not found then raise exception 'EBAY_IMAGE_ASSET_NOT_REVIEWABLE'; end if;

  if p_decision = 'approve' and (
    v_asset.rights_evidence_confirmed is distinct from true
    or v_asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or v_asset.output_width <> 1600
    or v_asset.output_height <> 1600
    or v_asset.output_sha256 !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'EBAY_IMAGE_APPROVAL_EVIDENCE_INVALID';
  end if;

  if p_decision = 'approve' and (
    nullif(trim(p_public_url), '') is null
    or p_public_url !~ '^https://[^[:space:][:cntrl:]]+$'
    or nullif(trim(p_published_storage_path), '') is null
    or p_published_storage_path !~ (
      '^' || p_actor::text || '/[0-9a-f]{24}/' || p_asset_id::text
      || '[.]jpg$'
    )
    or strpos(
      p_public_url,
      '/storage/v1/object/public/ebay-listing-images/' || p_published_storage_path
    ) = 0
  ) then
    raise exception 'EBAY_IMAGE_APPROVAL_PUBLICATION_INVALID';
  end if;

  if p_decision = 'approve' then
    select count(*)
    into v_approved_count
    from public.ebay_listing_image_assets image_asset
    where image_asset.listing_package_id = p_package_id
      and image_asset.created_by = p_actor
      and image_asset.status = 'approved';
    if v_approved_count >= 24 then
      raise exception 'EBAY_IMAGE_APPROVED_CAP_REACHED';
    end if;
  end if;

  update public.ebay_listing_image_assets image_asset
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      approved_at = case when p_decision = 'approve' then now() else null end,
      approved_by = case when p_decision = 'approve' then p_actor else null end,
      rejected_at = case when p_decision = 'reject' then now() else null end,
      published_storage_path = case
        when p_decision = 'approve' then p_published_storage_path
        else null
      end,
      public_url = case
        when p_decision = 'approve' then p_public_url
        else null
      end,
      updated_at = now()
  where image_asset.id = p_asset_id
  returning * into v_asset;

  -- Rejection of the active main image promotes the earliest remaining asset,
  -- preserving exactly one main role without trusting a browser position.
  if p_decision = 'reject' and v_asset.asset_role = 'main' then
    select image_asset.id
    into v_next_main_id
    from public.ebay_listing_image_assets image_asset
    where image_asset.listing_package_id = p_package_id
      and image_asset.created_by = p_actor
      and image_asset.status in ('pending_review', 'approved')
    order by image_asset.position, image_asset.created_at, image_asset.id
    limit 1
    for update;
    if v_next_main_id is not null then
      update public.ebay_listing_image_assets image_asset
      set asset_role = 'main', updated_at = now()
      where image_asset.id = v_next_main_id;
    end if;
  end if;

  v_attachment := public.ebay_attach_approved_listing_images(
    p_package_id,
    p_actor
  );
  return jsonb_build_object(
    'asset', to_jsonb(v_asset),
    'package', v_attachment
  );
end;
$$;

create or replace function public.ebay_reorder_listing_images_and_attach(
  p_package_id uuid,
  p_actor uuid,
  p_ordered_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_approved_count integer;
  v_pending_count integer;
  v_attachment jsonb;
begin
  if coalesce(cardinality(p_ordered_asset_ids), 0) not between 1 and 24
    or (
      select count(distinct requested.asset_id)
      from unnest(p_ordered_asset_ids) as requested(asset_id)
    )
      <> cardinality(p_ordered_asset_ids) then
    raise exception 'EBAY_IMAGE_ORDER_INVALID';
  end if;

  select package_row.* into v_package
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.status <> 'archived'
  for update;
  if not found then raise exception 'EBAY_IMAGE_PACKAGE_NOT_FOUND'; end if;

  perform 1
  from public.ebay_listing_image_assets image_asset
  where image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
  for update;

  select count(*) into v_approved_count
  from public.ebay_listing_image_assets image_asset
  where image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status = 'approved';
  select count(*) into v_pending_count
  from public.ebay_listing_image_assets image_asset
  where image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status = 'pending_review';
  if v_pending_count > 0 then
    raise exception 'EBAY_IMAGE_PENDING_REVIEW_BLOCKS_REORDER';
  end if;
  if v_approved_count <> cardinality(p_ordered_asset_ids)
    or exists (
      select 1
      from unnest(p_ordered_asset_ids) requested(asset_id)
      left join public.ebay_listing_image_assets image_asset
        on image_asset.id = requested.asset_id
        and image_asset.listing_package_id = p_package_id
        and image_asset.created_by = p_actor
        and image_asset.status = 'approved'
      where image_asset.id is null
    ) then
    raise exception 'EBAY_IMAGE_ORDER_OWNERSHIP_MISMATCH';
  end if;

  update public.ebay_listing_image_assets image_asset
  set position = -array_position(p_ordered_asset_ids, image_asset.id),
      asset_role = case when image_asset.asset_role = 'main'
        then 'detail' else image_asset.asset_role end,
      updated_at = now()
  where image_asset.id = any(p_ordered_asset_ids)
    and image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status = 'approved';

  update public.ebay_listing_image_assets image_asset
  set position = array_position(p_ordered_asset_ids, image_asset.id) - 1,
      asset_role = case
        when array_position(p_ordered_asset_ids, image_asset.id) = 1 then 'main'
        else image_asset.asset_role
      end,
      updated_at = now()
  where image_asset.id = any(p_ordered_asset_ids)
    and image_asset.listing_package_id = p_package_id
    and image_asset.created_by = p_actor
    and image_asset.status = 'approved';

  v_attachment := public.ebay_attach_approved_listing_images(
    p_package_id,
    p_actor
  );
  return v_attachment;
end;
$$;

alter table public.ebay_listing_image_assets enable row level security;
revoke all on table public.ebay_listing_image_assets from anon, authenticated;
grant select, insert, update, delete on table public.ebay_listing_image_assets to service_role;

-- Browser sessions may read packages for the admin workspace, but every write
-- must cross a server-side Admin API/RPC boundary. This closes the previous
-- direct PostgREST path that could fabricate protected manifests or economics.
drop policy if exists "admin manage ebay listing packages"
  on public.ebay_listing_packages;
drop policy if exists "admin read ebay listing packages"
  on public.ebay_listing_packages;
create policy "admin read ebay listing packages"
  on public.ebay_listing_packages
  for select
  to authenticated
  using (public.is_admin());
revoke insert, update, delete on table public.ebay_listing_packages
  from anon, authenticated;
grant select on table public.ebay_listing_packages to authenticated;
grant select, insert, update, delete on table public.ebay_listing_packages
  to service_role;

-- This pipeline is the first authoritative source for image review evidence.
-- Invalidate any package manifest that pre-dates it (including values written
-- through the former browser-writable table policy).
update public.ebay_listing_packages
set package_data = coalesce(package_data, '{}'::jsonb) - 'imageAssetManifest',
    status = 'draft',
    readiness = 0,
    updated_at = now()
where coalesce(package_data, '{}'::jsonb) ? 'imageAssetManifest';

revoke all on function public.ebay_attach_approved_listing_images(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ebay_attach_approved_listing_images(uuid, uuid)
  to service_role;
revoke all on function public.ebay_create_pending_listing_image(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ebay_create_pending_listing_image(
  uuid, uuid, uuid, text, jsonb
) to service_role;
revoke all on function public.ebay_save_listing_package_guarded(
  uuid, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.ebay_save_listing_package_guarded(
  uuid, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) to service_role;
revoke all on function public.ebay_review_listing_image_and_attach(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.ebay_review_listing_image_and_attach(
  uuid, uuid, uuid, text, text, text
) to service_role;
revoke all on function public.ebay_reorder_listing_images_and_attach(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.ebay_reorder_listing_images_and_attach(
  uuid, uuid, uuid[]
) to service_role;

-- No authenticated storage.objects policy is added for these buckets. The
-- protected Admin API uses service_role so rights evidence and QA cannot be
-- bypassed by a direct browser upload.

comment on table public.ebay_listing_image_assets is
  'Immutable source hashes and deterministic eBay derivatives. Pending outputs are private; only human-approved public_url values may enter listing packages.';

notify pgrst, 'reload schema';
