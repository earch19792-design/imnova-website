create or replace function public.create_ebay_same_day_image_revision_asset_set(
  p_revision_id uuid,
  p_account_key text,
  p_actor uuid,
  p_lease_token uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_assets jsonb
)
returns setof public.ebay_listing_image_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_asset_json jsonb;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_invalid integer;
begin
  if p_revision_id is null or p_actor is null or p_lease_token is null
    or p_account_key is null or nullif(trim(p_candidate_key), '') is null
    or jsonb_typeof(p_assets) <> 'array'
    or jsonb_array_length(p_assets) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_SET_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id
    and revision.marketplace_account_key = p_account_key
    and revision.created_by = p_actor
    and revision.status = 'CLAIMED'
    and revision.lease_token = p_lease_token
    and revision.lease_expires_at > clock_timestamp()
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_LEASE_INVALID'; end if;

  select count(*) filter (where
    jsonb_typeof(item.value) <> 'object'
    or coalesce(item.value ->> 'id', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item.value ->> 'output_sha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(item.value ->> 'source_sha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(item.value -> 'transformation' ->> 'sameDayImageRevisionId', '')
      <> p_revision_id::text
    or item.value -> 'transformation' ->> 'compositorContractVersion'
      is distinct from 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20'
    or coalesce(item.value -> 'transformation' ->> 'slot', '') not in (
      'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
      'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
    )
    or nullif(item.value -> 'transformation' ->> 'layoutId', '') is null
    or item.value -> 'transformation' ->> 'originalPackagePixelsPreserved'
      is distinct from 'true'
    or item.value -> 'transformation' ->> 'competitorImageUsed'
      is distinct from 'false'
    or item.value -> 'transformation' ->> 'verifiedFactsOnly'
      is distinct from 'true'
    or item.value -> 'qa_result' ->> 'humanApprovalRequired'
      is distinct from 'true'
    or item.value -> 'qa_result' ->> 'structuralDiversityVerified'
      is distinct from 'true'
  ) into v_invalid
  from jsonb_array_elements(p_assets) item(value);
  if v_invalid <> 0 or (
    select count(distinct item.value -> 'transformation' ->> 'slot')
    from jsonb_array_elements(p_assets) item(value)
  ) <> 6 or (
    select count(distinct item.value -> 'transformation' ->> 'layoutId')
    from jsonb_array_elements(p_assets) item(value)
  ) <> 6 or (
    select count(distinct item.value ->> 'output_sha256')
    from jsonb_array_elements(p_assets) item(value)
  ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_EVIDENCE_INVALID';
  end if;

  for v_asset_json in select value from jsonb_array_elements(p_assets)
  loop
    select asset.* into v_asset
    from public.ebay_listing_image_assets asset
    where asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.listing_package_id = v_revision.listing_package_id
      and asset.output_sha256 = v_asset_json ->> 'output_sha256'
    limit 1
    for update;
    if found then
      if v_asset.status = 'rejected'
        or v_asset.candidate_key is distinct from p_candidate_key
        or v_asset.opportunity_id is distinct from p_opportunity_id
        or v_asset.source_sha256 is distinct from v_asset_json ->> 'source_sha256'
        or v_asset.output_width is distinct from 1600
        or v_asset.output_height is distinct from 1600
        or v_asset.rights_evidence_confirmed is distinct from true
        or v_asset.transformation_version
          is distinct from v_asset_json ->> 'transformation_version' then
        raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_REUSE_CONFLICT';
      end if;
      if (v_asset.transformation - 'sameDayImageRevisionId') is distinct from
          ((v_asset_json -> 'transformation') - 'sameDayImageRevisionId')
        or v_asset.qa_result is distinct from v_asset_json -> 'qa_result' then
        raise exception 'SAME_DAY_IMAGE_REVISION_LEGACY_HASH_CONFLICT';
      end if;
      if v_asset.status = 'pending_review'
        and v_asset.transformation ->> 'sameDayImageRevisionId'
          is distinct from p_revision_id::text then
        raise exception 'SAME_DAY_IMAGE_REVISION_PENDING_HASH_CONFLICT';
      end if;
      return next v_asset;
    else
      select created.* into v_asset
      from public.ebay_create_pending_listing_image(
        v_revision.listing_package_id, p_account_key, p_actor,
        p_opportunity_id, p_candidate_key, v_asset_json
      ) created
      limit 1;
      if v_asset.id is null then
        raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_CREATE_FAILED';
      end if;
      return next v_asset;
    end if;
  end loop;
end;
$$;

comment on function public.create_ebay_same_day_image_revision_asset_set(
  uuid, text, uuid, uuid, uuid, text, jsonb
) is 'Creates an exact V3 image set and reuses only assets with identical stable transformation and QA evidence.';
