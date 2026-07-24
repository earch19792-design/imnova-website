-- Preserve the exact approved preferred image revision when a same-day
-- workspace refresh rebuilds listing facts from its immutable base control.
-- This changes only the internal listing-package image projection. It grants
-- no provider, eBay, or Production write.

create or replace function
  public.restore_ebay_approved_preferred_image_revision_projection_v1(
    p_listing_package_id uuid,
    p_account_key text,
    p_actor uuid,
    p_expected_updated_at timestamptz
  )
returns setof public.ebay_listing_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_item jsonb;
  v_asset_id uuid;
  v_manifest_ids uuid[] := '{}'::uuid[];
  v_image_urls jsonb := '[]'::jsonb;
  v_image_manifest jsonb := '[]'::jsonb;
  v_draft jsonb;
  v_authorization jsonb;
  v_next_data jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_listing_package_id is null
    or p_actor is null
    or p_expected_updated_at is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_INPUT_INVALID';
  end if;

  perform public.assert_ebay_listing_package_account_scope(
    p_listing_package_id, p_account_key, p_actor
  );
  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = p_listing_package_id
    and package.account_key = p_account_key
    and package.created_by = p_actor
    and package.status in ('draft', 'ready_for_review')
  for update;
  if not found then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_PACKAGE_INVALID';
  end if;
  if v_package.updated_at is distinct from p_expected_updated_at then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;
  if exists (
      select 1 from public.ebay_draft_only_approvals approval
      where approval.listing_package_id = v_package.id
        and approval.status = 'approved'
        and approval.expires_at > v_now
    ) or exists (
      select 1 from public.ebay_draft_only_execution_ledger execution
      where execution.listing_package_id = v_package.id
    ) or exists (
      select 1 from public.ebay_authorized_listing_publications publication
      where publication.listing_package_id = v_package.id
    ) then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_ALREADY_EXECUTED';
  end if;
  if coalesce(v_package.package_data->>'preferredImageRevisionId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(coalesce(
      v_package.package_data->'imageRevisionHistory', '[]'::jsonb
    )) <> 'array' then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_BINDING_INVALID';
  end if;

  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id =
      (v_package.package_data->>'preferredImageRevisionId')::uuid
    and revision.marketplace_account_key = p_account_key
    and revision.created_by = p_actor
    and revision.listing_package_id = v_package.id
    and revision.status = 'APPROVED'
    and revision.reviewed_by = p_actor
    and revision.human_decision = 'APPROVED'
    and cardinality(revision.asset_ids) = 7
    and jsonb_typeof(revision.asset_manifest) = 'array'
    and jsonb_array_length(revision.asset_manifest) = 7
    and revision.image_set_hash ~ '^[0-9a-f]{64}$'
    and revision.ebay_writes = 0
    and not revision.production_changed
  for key share;
  if not found then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_REVISION_INVALID';
  end if;

  for v_item in
    select value from jsonb_array_elements(v_revision.asset_manifest)
  loop
    if coalesce(v_item->>'assetId', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(trim(coalesce(v_item->>'slot', '')), '') is null
      or nullif(trim(coalesce(v_item->>'layoutId', '')), '') is null then
      raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_MANIFEST_INVALID';
    end if;
    v_asset_id := (v_item->>'assetId')::uuid;
    v_manifest_ids := array_append(v_manifest_ids, v_asset_id);
    select asset.* into v_asset
    from public.ebay_listing_image_assets asset
    where asset.id = v_asset_id
      and asset.id = any(v_revision.asset_ids)
      and asset.listing_package_id = v_package.id
      and asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.status = 'approved'
      and asset.approved_by = p_actor
      and asset.approved_at is not null
      and asset.rights_evidence_confirmed
      and asset.qa_result->>'automaticStatus' = 'PASSED'
      and asset.output_sha256 ~ '^[0-9a-f]{64}$'
      and asset.public_url ~ '^https://[^[:space:][:cntrl:]]+$'
      and nullif(trim(coalesce(asset.published_storage_path, '')), '')
        is not null
    for key share;
    if not found then
      raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_ASSET_INVALID';
    end if;
    v_image_urls := v_image_urls || to_jsonb(v_asset.public_url);
    v_image_manifest := v_image_manifest || jsonb_build_array(
      jsonb_build_object(
        'assetId', v_asset.id,
        'url', v_asset.public_url,
        'role', v_asset.asset_role,
        'slot', v_item->>'slot',
        'layoutId', v_item->>'layoutId',
        'sha256', v_asset.output_sha256,
        'transformationVersion', v_asset.transformation_version,
        'automaticQa', v_asset.qa_result->>'automaticStatus',
        'humanApprovedAt', v_asset.approved_at,
        'reusedFromHistory',
          v_asset.id = any(v_revision.reused_asset_ids)
      )
    );
  end loop;

  if cardinality(v_manifest_ids) <> 7
    or (select count(distinct id)
        from unnest(v_manifest_ids) requested(id)) <> 7
    or not (v_manifest_ids @> v_revision.asset_ids)
    or not (v_manifest_ids <@ v_revision.asset_ids)
    or jsonb_array_length(v_image_urls) <> 7
    or (
      select count(distinct value)
      from jsonb_array_elements_text(v_image_urls)
    ) <> 7
    or jsonb_array_length(v_image_manifest) <> 7 then
    raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_SET_INVALID';
  end if;

  v_draft := case
    when jsonb_typeof(v_package.package_data->'draftConfiguration') =
      'object'
      then v_package.package_data->'draftConfiguration'
    else '{}'::jsonb end;
  v_authorization := case
    when jsonb_typeof(v_draft->'imageAuthorization') = 'object'
      then v_draft->'imageAuthorization'
    else '{}'::jsonb end;
  v_authorization := v_authorization || jsonb_build_object(
    'approved', true,
    'approvedAt', v_revision.reviewed_at,
    'approvedBy', p_actor,
    'approvedImageUrls', v_image_urls,
    'rightsBasis', 'supplier_authorized',
    'source', 'luna',
    'protectedManifestVerified', true,
    'protectedManifestAssetCount', 7
  );
  v_draft := v_draft || jsonb_build_object(
    'imageAuthorization', v_authorization
  );
  v_next_data := coalesce(v_package.package_data, '{}'::jsonb)
    || jsonb_build_object(
      'preferredImageRevisionId', v_revision.id,
      'imageUrls', v_image_urls,
      'imageAssetManifest', v_image_manifest,
      'draftConfiguration', v_draft
    );

  update public.ebay_listing_packages package
  set package_data = v_next_data,
      updated_at = v_now
  where package.id = v_package.id
    and package.account_key = p_account_key
    and package.created_by = p_actor
    and package.updated_at = p_expected_updated_at
  returning package.* into v_package;
  if not found then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;
  return next v_package;
end;
$$;

revoke all on function
  public.restore_ebay_approved_preferred_image_revision_projection_v1(
    uuid, text, uuid, timestamptz
  )
from public, anon, authenticated;
grant execute on function
  public.restore_ebay_approved_preferred_image_revision_projection_v1(
    uuid, text, uuid, timestamptz
  )
to service_role;

comment on function
  public.restore_ebay_approved_preferred_image_revision_projection_v1(
    uuid, text, uuid, timestamptz
  )
is 'Atomically restores the exact seven-image projection of an already approved preferred revision onto one unexecuted internal listing package; performs zero provider, eBay, or Production writes.';

do $migration$
declare
  v_signature regprocedure :=
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure;
  v_definition text;
  v_old text := $old$
  if not found then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;
  return next v_package;
end;
$old$;
  v_new text := $new$
  if not found then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;
  if coalesce(
      v_package.package_data->>'preferredImageRevisionId', ''
    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select restored.* into v_package
    from public.restore_ebay_approved_preferred_image_revision_projection_v1(
      v_package.id, p_account_key, p_actor, v_package.updated_at
    ) restored;
    if not found then
      raise exception 'APPROVED_PREFERRED_IMAGE_RESTORE_FAILED';
    end if;
  end if;
  return next v_package;
end;
$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(
      v_definition,
      'restore_ebay_approved_preferred_image_revision_projection_v1'
    ) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'APPROVED_PREFERRED_IMAGE_REFRESH_PATCH_TARGET_MISSING';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  if strpos(
      v_definition,
      'restore_ebay_approved_preferred_image_revision_projection_v1'
    ) = 0 then
    raise exception 'APPROVED_PREFERRED_IMAGE_REFRESH_PATCH_FAILED';
  end if;
  execute v_definition;
end;
$migration$;

comment on function
  public.restore_ebay_same_day_authorized_listing_package_v1(
    uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
  )
is 'Rebuilds one internal Seller OS workspace from verified same-day evidence and then preserves any exact approved preferred seven-image revision; performs zero provider, eBay, or Production writes.';
