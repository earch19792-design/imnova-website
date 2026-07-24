-- The workspace refresh path still selected only historical V6/six-image
-- controls even after the current same-day review gate moved to V9/seven.
-- Keep the V6 path readable, add an exact approved V9 assertion, and dispatch
-- by the immutable approved control size. This migration performs no provider,
-- eBay, or Production write.

create or replace function
  public.assert_ebay_same_day_approved_v9_control_v1(
    p_control_id uuid,
    p_account_key text,
    p_actor uuid,
    p_asset_ids uuid[]
  )
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_asset_count integer;
  v_slot_count integer;
  v_position_count integer;
  v_main_count integer;
  v_secondary_count integer;
  v_generative_count integer;
  v_ai_secondary_count integer;
  v_deterministic_secondary_count integer;
  v_source_count integer;
  v_presentation_count integer;
  v_single_source_manual_count integer;
  v_objective_count integer;
  v_invalid_count integer;
  v_presentation_mode text;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or coalesce(cardinality(p_asset_ids), 0) <> 7
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 7 then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V9_SCOPE_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for key share;
  if not found
    or v_control.status <> 'APPROVED'
    or v_control.reviewed_by is distinct from p_actor
    or v_control.human_decision <> 'APPROVED'
    or v_control.reviewed_at is null
    or v_control.generation_mode not in (
      'OPENAI_CONTEXT_PLATE', 'DETERMINISTIC_ONLY'
    )
    or cardinality(v_control.asset_ids) <> 7
    or not (p_asset_ids @> v_control.asset_ids)
    or not (p_asset_ids <@ v_control.asset_ids)
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V9_CONTROL_INVALID';
  end if;

  perform 1
  from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for key share;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(distinct asset.position),
    count(*) filter (where
      asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      and asset.transformation ->> 'layoutId'
        = 'MAIN_WHITE_BACKGROUND_CANONICAL_V3'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'authorizedSourceTreatment' in (
        'NORMALIZED_LIGHT_NEUTRAL',
        'PRESERVED_FRAMED_SOURCE',
        'LOCAL_AUTHORIZED_FOREGROUND'
      )
      and asset.transformation ->> 'mainEncodingProfile'
        = 'JPEG_Q94_444_MOZJPEG_V4'
      and not (asset.transformation ? 'foregroundMatteVersion')
      and not (asset.transformation ? 'foregroundMatteSha256')
      and not (asset.qa_result ? 'foregroundMatteValidated')
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
      and (asset.qa_result ->> 'textLineCount')::integer = 0
      and jsonb_typeof(asset.qa_result -> 'textMinimumPixelSize') = 'number'
      and (asset.qa_result ->> 'textMinimumPixelSize')::integer = 0
      and asset.qa_result ->> 'textPolicyPassed' = 'true'
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'textSafeAreaVerified')
      and not (asset.qa_result ? 'textGlyphsValidated')
      and asset.qa_result ->> 'automaticStatus' = 'PASSED'
      and asset.qa_result ->> 'mainBackground' = 'PURE_WHITE'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'LOCAL_AUTHORIZED_FOREGROUND'
      and asset.transformation ->> 'foregroundMatteVersion'
        = 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
      and asset.transformation ->> 'foregroundMatteMethod' in (
        'NATIVE_ALPHA',
        'EDGE_CONNECTED_LIGHT_NEUTRAL_V1',
        'PROTECTED_TRIMAP_MATTING_V1',
        'FULL_AUTHORIZED_FRAME'
      )
      and coalesce(
        asset.transformation ->> 'foregroundMatteSha256', ''
      ) ~ '^[0-9a-f]{64}$'
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundBackgroundRemovalRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundBackgroundRemovalRatio'
      )::numeric between 0.02 and 0.98 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundTransparentBorderRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundTransparentBorderRatio'
      )::numeric between 0.99 and 1 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundProtectedPixelRetentionRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundProtectedPixelRetentionRatio'
      )::numeric between 0.9999 and 1 else false end
      and case when jsonb_typeof(
        asset.transformation -> 'foregroundOpaqueCornerRatio'
      ) = 'number' then (
        asset.transformation ->> 'foregroundOpaqueCornerRatio'
      )::numeric between 0 and 0.001 else false end
      and asset.qa_result ->> 'foregroundMatteValidated' = 'true'
      and asset.qa_result ->> 'opaqueSourceFrameRemoved' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
      and asset.qa_result ->> 'textPolicyPassed' = 'true'
      and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        @> jsonb_build_array(
          'AUTHORIZED_FOREGROUND_MATTE_HUMAN_ACCEPTANCE'
        )
      and (
        (
          jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
          and (asset.qa_result ->> 'textLineCount')::integer = 0
          and not (asset.transformation ? 'textRendererVersion')
          and not (asset.qa_result ? 'textSafeAreaVerified')
          and not (asset.qa_result ? 'textGlyphsValidated')
        )
        or
        (
          jsonb_typeof(asset.qa_result -> 'textLineCount') = 'number'
          and (asset.qa_result ->> 'textLineCount')::integer between 1 and 3
          and asset.transformation ->> 'textRendererVersion'
            = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
          and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
          and asset.qa_result ->> 'textGlyphsValidated' = 'true'
        )
      )
    ),
    count(*) filter (where
      asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'true'
      and asset.transformation ->> 'backgroundPlateVersion'
        = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V4'
      and asset.transformation ->> 'backgroundPlateQuality' = 'high'
      and asset.transformation ->> 'visualStrategyVersion'
        = 'SELLER_OS_EBAY_VISUAL_STRATEGY_V2'
      and asset.transformation ->> 'visualEvidenceMode'
        = 'MARKET_SIGNAL_PROMPT'
      and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'visualEvidenceMode'
        = 'PROFESSIONAL_FALLBACK'
      and asset.qa_result ->> 'deterministicBackgroundSelection' = 'false'
    ),
    count(distinct asset.source_sha256),
    count(distinct asset.transformation ->> 'presentationMode'),
    count(*) filter (where
      jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        ? 'SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS'
    ),
    count(distinct asset.transformation #>>
      '{visualStrategyPosition,salesObjective}') filter (
        where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from p_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'approved'
      or asset.approved_by is distinct from p_actor
      or asset.approved_at is null
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.source_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version
        <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V2'
      or asset.public_url is null
      or asset.public_url !~ '^https://[^[:space:][:cntrl:]]+$'
      or asset.published_storage_path is null
      or asset.published_storage_path !~ (
        '^' || p_actor::text || '/[0-9a-f]{24}/'
          || asset.id::text || '[.]jpg$'
      )
      or strpos(
        asset.public_url,
        '/storage/v1/object/public/ebay-listing-images/'
          || asset.published_storage_path
      ) = 0
      or asset.transformation ->> 'competitorImageUsed'
        is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved'
        is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly'
        is distinct from 'true'
      or asset.transformation ->> 'sourceVisualPolicy'
        is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or asset.transformation ->> 'authorizedSourceViewReused'
        is distinct from 'true'
      or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
      or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
      or asset.qa_result ->> 'commercialQualityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'technicalQualityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
      or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
      or asset.qa_result ->> 'mobileReadabilityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'sourceViewCapabilityPassed'
        is distinct from 'true'
      or asset.qa_result ->> 'marketSignalsLimitedToScene'
        is distinct from 'true'
      or asset.qa_result ->> 'hiddenProductGeometryGenerated'
        is distinct from 'false'
      or asset.position not between 0 and 6
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND',
        'PACK_AND_COUNT',
        'KEY_FEATURES',
        'SIZE_AND_CONTENT',
        'USE_CONTEXT',
        'PACKAGE_CONTENTS',
        'SECONDARY_6'
      ])
    ),
    min(asset.transformation ->> 'presentationMode')
  into
    v_asset_count,
    v_slot_count,
    v_position_count,
    v_main_count,
    v_secondary_count,
    v_generative_count,
    v_ai_secondary_count,
    v_deterministic_secondary_count,
    v_source_count,
    v_presentation_count,
    v_single_source_manual_count,
    v_objective_count,
    v_invalid_count,
    v_presentation_mode
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 7
    or v_slot_count <> 7
    or v_position_count <> 7
    or v_main_count <> 1
    or v_secondary_count <> 6
    or v_objective_count <> 6
    or v_invalid_count <> 0
    or v_presentation_count <> 1
    or v_source_count not between 1 and 3
    or (
      v_presentation_mode = 'SINGLE_SOURCE_INFORMATIONAL'
      and (
        v_source_count <> 1
        or v_single_source_manual_count <> 7
      )
    )
    or (
      v_presentation_mode = 'AUTHORIZED_MULTI_SOURCE'
      and v_source_count not between 2 and 3
    )
    or v_presentation_mode not in (
      'SINGLE_SOURCE_INFORMATIONAL', 'AUTHORIZED_MULTI_SOURCE'
    )
    or (
      v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
      and (
        v_generative_count <> 6
        or v_ai_secondary_count <> 6
      )
    )
    or (
      v_control.generation_mode = 'DETERMINISTIC_ONLY'
      and (
        v_generative_count <> 0
        or v_deterministic_secondary_count <> 6
      )
    ) then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V9_EVIDENCE_INVALID';
  end if;
end;
$$;

revoke all on function
  public.assert_ebay_same_day_approved_v9_control_v1(
    uuid, text, uuid, uuid[]
  )
from public, anon, authenticated;
grant execute on function
  public.assert_ebay_same_day_approved_v9_control_v1(
    uuid, text, uuid, uuid[]
  )
to service_role;

comment on function
  public.assert_ebay_same_day_approved_v9_control_v1(
    uuid, text, uuid, uuid[]
  )
is 'Revalidates one immutable human-approved V9 seven-image control before workspace restoration; performs zero provider, eBay, or Production writes.';

do $migration$
declare
  v_signature regprocedure :=
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_old_control_scope text :=
    'and cardinality(control.asset_ids) = 6';
  v_new_control_scope text :=
    'and cardinality(control.asset_ids) in (6, 7)';
  v_old_assertion text := $old$
  perform public.assert_ebay_same_day_approved_v6_control_v1(
    v_control.id, p_account_key, p_actor, v_control.asset_ids
  );$old$;
  v_new_assertion text := $new$
  if cardinality(v_control.asset_ids) = 7 then
    perform public.assert_ebay_same_day_approved_v9_control_v1(
      v_control.id, p_account_key, p_actor, v_control.asset_ids
    );
  else
    perform public.assert_ebay_same_day_approved_v6_control_v1(
      v_control.id, p_account_key, p_actor, v_control.asset_ids
    );
  end if;$new$;
begin
  select pg_get_functiondef(v_signature)
  into strict v_definition;

  if strpos(
    v_definition,
    'assert_ebay_same_day_approved_v9_control_v1'
  ) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old_control_scope) = 0
    or strpos(v_definition, v_old_assertion) = 0
    or strpos(
      v_definition,
      'jsonb_array_length(coalesce(v_image_urls, ''[]''::jsonb)) <> 6'
    ) = 0
    or strpos(
      v_definition,
      'jsonb_array_length(coalesce(v_image_manifest, ''[]''::jsonb)) <> 6'
    ) = 0
    or strpos(
      v_definition,
      '''protectedManifestAssetCount'', 6'
    ) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_V9_REFRESH_PATCH_TARGET_MISSING';
  end if;

  v_updated_definition := replace(
    v_definition, v_old_control_scope, v_new_control_scope
  );
  v_updated_definition := replace(
    v_updated_definition, v_old_assertion, v_new_assertion
  );
  v_updated_definition := replace(
    v_updated_definition,
    'jsonb_array_length(coalesce(v_image_urls, ''[]''::jsonb)) <> 6',
    'jsonb_array_length(coalesce(v_image_urls, ''[]''::jsonb)) '
      || '<> cardinality(v_control.asset_ids)'
  );
  v_updated_definition := replace(
    v_updated_definition,
    'jsonb_array_length(coalesce(v_image_manifest, ''[]''::jsonb)) <> 6',
    'jsonb_array_length(coalesce(v_image_manifest, ''[]''::jsonb)) '
      || '<> cardinality(v_control.asset_ids)'
  );
  v_updated_definition := replace(
    v_updated_definition,
    '''protectedManifestAssetCount'', 6',
    '''protectedManifestAssetCount'', cardinality(v_control.asset_ids)'
  );

  if v_updated_definition = v_definition
    or strpos(v_updated_definition, v_old_control_scope) > 0
    or strpos(v_updated_definition, v_old_assertion) > 0
    or strpos(
      v_updated_definition,
      'assert_ebay_same_day_approved_v9_control_v1'
    ) = 0
    or strpos(
      v_updated_definition,
      'cardinality(control.asset_ids) in (6, 7)'
    ) = 0
    or strpos(
      v_updated_definition,
      '''protectedManifestAssetCount'', cardinality(v_control.asset_ids)'
    ) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_V9_REFRESH_PATCH_FAILED';
  end if;
  execute v_updated_definition;
end;
$migration$;

comment on function
  public.restore_ebay_same_day_authorized_listing_package_v1(
    uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
  )
is 'Rebuilds one internal Seller OS workspace from either its exact historical V6/six-image control or current V9/seven-image control, current handoff and verified account profile; accepts no image URL and performs zero eBay/Production writes.';

do $assertion$
declare
  v_refresh_definition text;
  v_v6_definition text;
begin
  select pg_get_functiondef(
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure
  ) into strict v_refresh_definition;
  select pg_get_functiondef(
    'public.assert_ebay_same_day_approved_v6_control_v1(uuid,text,uuid,uuid[])'::regprocedure
  ) into strict v_v6_definition;

  if strpos(
      v_refresh_definition,
      'assert_ebay_same_day_approved_v9_control_v1'
    ) = 0
    or strpos(
      v_refresh_definition,
      'cardinality(control.asset_ids) in (6, 7)'
    ) = 0
    or strpos(
      v_refresh_definition,
      '<> cardinality(v_control.asset_ids)'
    ) = 0
    or strpos(
      v_refresh_definition,
      '''protectedManifestAssetCount'', cardinality(v_control.asset_ids)'
    ) = 0
    or strpos(
      v_v6_definition,
      'SAME_DAY_WORKSPACE_APPROVED_V6_EVIDENCE_INVALID'
    ) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_V9_REFRESH_ASSERTION_FAILED';
  end if;
end;
$assertion$;
