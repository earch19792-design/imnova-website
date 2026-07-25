create or replace function public.complete_ebay_same_day_image_revision(
  p_revision_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_asset_ids uuid[],
  p_asset_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_manifest_ids uuid[];
  v_reused_ids uuid[];
  v_source_count integer;
  v_invalid integer;
  v_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if p_revision_id is null or p_actor is null or p_lease_token is null
    or cardinality(p_asset_ids) <> 6
    or (select count(distinct id) from unnest(p_asset_ids) requested(id)) <> 6
    or jsonb_typeof(p_asset_manifest) <> 'array'
    or jsonb_array_length(p_asset_manifest) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id and revision.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_NOT_FOUND'; end if;
  if v_revision.status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED') then
    if v_revision.asset_ids @> p_asset_ids and v_revision.asset_ids <@ p_asset_ids
      and v_revision.asset_manifest = p_asset_manifest then
      return jsonb_build_object(
        'revisionId', v_revision.id, 'status', v_revision.status,
        'assetIds', v_revision.asset_ids,
        'imageSetHash', v_revision.image_set_hash
      );
    end if;
    raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_CONFLICT';
  end if;
  if v_revision.status <> 'CLAIMED' or v_revision.lease_token <> p_lease_token
    or v_revision.lease_expires_at <= v_now then
    raise exception 'SAME_DAY_IMAGE_REVISION_LEASE_INVALID';
  end if;

  select array_agg((item.value ->> 'assetId')::uuid order by item.ordinality),
         count(distinct item.value ->> 'sourceSha256')
  into v_manifest_ids, v_source_count
  from jsonb_array_elements(p_asset_manifest) with ordinality item(value, ordinality)
  where coalesce(item.value ->> 'assetId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(item.value ->> 'sourceSha256', '') ~ '^[0-9a-f]{64}$'
    and coalesce(item.value ->> 'outputSha256', '') ~ '^[0-9a-f]{64}$'
    and nullif(item.value ->> 'layoutId', '') is not null
    and item.value ->> 'compositorContractVersion'
      = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20'
    and coalesce(item.value ->> 'presentationMode', '') in (
      'AUTHORIZED_MULTI_SOURCE', 'SINGLE_SOURCE_INFORMATIONAL'
    )
    and coalesce(item.value ->> 'slot', '') in (
      'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
      'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
    );
  if cardinality(v_manifest_ids) <> 6 or v_source_count not between 1 and 3
    or (select count(distinct item.value ->> 'slot')
        from jsonb_array_elements(p_asset_manifest) item(value)) <> 6
    or (select count(distinct item.value ->> 'layoutId')
        from jsonb_array_elements(p_asset_manifest) item(value)) <> 6
    or (select count(distinct item.value ->> 'outputSha256')
        from jsonb_array_elements(p_asset_manifest) item(value)) <> 6
    or not (v_manifest_ids @> p_asset_ids)
    or not (v_manifest_ids <@ p_asset_ids) then
    raise exception 'SAME_DAY_IMAGE_REVISION_MANIFEST_INVALID';
  end if;

  select count(*) filter (where
    asset.id is null
    or asset.listing_package_id is distinct from v_revision.listing_package_id
    or asset.account_key is distinct from v_revision.marketplace_account_key
    or asset.created_by is distinct from p_actor
    or asset.status not in ('pending_review', 'approved')
    or asset.output_width is distinct from 1600
    or asset.output_height is distinct from 1600
    or asset.rights_evidence_confirmed is distinct from true
    or asset.output_sha256 is distinct from item.value ->> 'outputSha256'
    or asset.source_sha256 is distinct from item.value ->> 'sourceSha256'
    or asset.transformation ->> 'slot' is distinct from item.value ->> 'slot'
    or asset.transformation ->> 'layoutId' is distinct from item.value ->> 'layoutId'
    or asset.transformation ->> 'authorizedSourceIndex'
      is distinct from item.value ->> 'authorizedSourceIndex'
    or asset.transformation ->> 'compositorContractVersion'
      is distinct from 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20'
    or asset.transformation ->> 'compositorContractVersion'
      is distinct from item.value ->> 'compositorContractVersion'
    or asset.transformation ->> 'presentationMode'
      is distinct from item.value ->> 'presentationMode'
    or asset.transformation ->> 'presentationMode' is distinct from
      case when v_source_count = 1 then 'SINGLE_SOURCE_INFORMATIONAL'
           else 'AUTHORIZED_MULTI_SOURCE' end
    or asset.transformation ->> 'generativeAiUsed' is distinct from 'false'
    or asset.transformation ->> 'originalPackagePixelsPreserved' is distinct from 'true'
    or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
    or asset.transformation ->> 'verifiedFactsOnly' is distinct from 'true'
    or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
    or asset.qa_result ->> 'structuralDiversityVerified' is distinct from 'true'
    or case
      when jsonb_typeof(asset.qa_result -> 'foregroundEdgeCoverage') = 'number'
        then (asset.qa_result ->> 'foregroundEdgeCoverage')::numeric
          not between 0.004 and 1
      else true
    end
    or case asset.transformation ->> 'authorizedSourceTreatment'
      when 'NORMALIZED_LIGHT_NEUTRAL' then
        asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
      when 'PRESERVED_FRAMED_SOURCE' then
        asset.qa_result ->> 'automaticStatus' is distinct from 'PARTIAL'
      else true
    end
  ) into v_invalid
  from jsonb_array_elements(p_asset_manifest) item(value)
  left join public.ebay_listing_image_assets asset
    on asset.id = (item.value ->> 'assetId')::uuid;
  if v_invalid <> 0 then
    raise exception 'SAME_DAY_IMAGE_REVISION_SET_UNSAFE';
  end if;

  select coalesce(array_agg(asset.id order by requested.ordinality), '{}'::uuid[])
  into v_reused_ids
  from unnest(p_asset_ids) with ordinality requested(id, ordinality)
  join public.ebay_listing_image_assets asset on asset.id = requested.id
  where asset.transformation ->> 'sameDayImageRevisionId'
    is distinct from p_revision_id::text;
  v_hash := encode(digest(p_asset_manifest::text, 'sha256'), 'hex');
  update public.ebay_same_day_pilot_image_revisions revision
  set status = 'PENDING_REVIEW', asset_ids = p_asset_ids,
      reused_asset_ids = v_reused_ids, asset_manifest = p_asset_manifest,
      image_set_hash = v_hash, authorized_source_count = v_source_count,
      completed_at = v_now, lease_token = null, lease_expires_at = null,
      updated_at = v_now
  where revision.id = p_revision_id and revision.status = 'CLAIMED'
    and revision.lease_token = p_lease_token;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_CONFLICT'; end if;
  return jsonb_build_object(
    'revisionId', p_revision_id, 'status', 'PENDING_REVIEW',
    'assetIds', p_asset_ids, 'imageSetHash', v_hash,
    'reusedAssetIds', v_reused_ids, 'ebayWrites', 0
  );
end;
$$;

comment on function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) is 'Completes an exact six-image V3 revision; framed authorized sources remain PARTIAL until human review.';
