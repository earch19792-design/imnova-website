-- Admit the V6 compositor while preserving V5 as immutable/rejectable audit
-- history. New approvals and publication claims require five locally-derived
-- transparent authorized foregrounds with fail-closed matte evidence. This
-- migration introduces no image bytes, provider call, eBay write or
-- Production capability.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_v5_equality text :=
    '= ''EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21''';
  v_v5_or_v6_membership text :=
    'in (''EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'', '
      || '''EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'')';
begin
  select pg_get_functiondef(
    'public.assert_same_day_pilot_image_set_safe(uuid,uuid,uuid[])'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'FOREGROUND_V6_BASE_VALIDATOR_NOT_FOUND';
  end if;
  if strpos(v_definition, v_v5_or_v6_membership) > 0 then
    return;
  end if;
  if strpos(v_definition, v_v5_equality) = 0 then
    raise exception 'FOREGROUND_V6_BASE_VALIDATOR_NOT_FOUND';
  end if;
  v_updated_definition := replace(
    v_definition, v_v5_equality, v_v5_or_v6_membership
  );
  if v_updated_definition = v_definition
    or strpos(
      v_updated_definition,
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
    ) = 0 then
    raise exception 'FOREGROUND_V6_BASE_VALIDATOR_PATCH_FAILED';
  end if;
  execute v_updated_definition;
end;
$migration$;

create or replace function public.assert_same_day_pilot_image_set_current_v6(
  p_control_id uuid,
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
  v_main_count integer;
  v_secondary_count integer;
  v_generative_count integer;
  v_invalid_count integer;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor;
  if not found
    or v_control.status <> 'PENDING_REVIEW'
    or v_control.generation_mode not in (
      'OPENAI_CONTEXT_PLATE', 'DETERMINISTIC_ONLY'
    )
    or cardinality(v_control.asset_ids) <> 6
    or not (p_asset_ids @> v_control.asset_ids)
    or not (p_asset_ids <@ v_control.asset_ids)
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_IMAGE_V6_CONTROL_INVALID';
  end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (where
      asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
      and asset.transformation ->> 'layoutId'
        = 'MAIN_WHITE_BACKGROUND_CANONICAL_V3'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'authorizedSourceTreatment' in (
        'NORMALIZED_LIGHT_NEUTRAL', 'PRESERVED_FRAMED_SOURCE'
      )
      and asset.transformation ->> 'mainEncodingProfile'
        = 'JPEG_Q93_444_MOZJPEG_V3'
      and not (asset.transformation ? 'foregroundMatteVersion')
      and not (asset.transformation ? 'foregroundMatteSha256')
      and not (asset.qa_result ? 'foregroundMatteValidated')
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and (
        (
          asset.transformation ->> 'authorizedSourceTreatment'
            = 'NORMALIZED_LIGHT_NEUTRAL'
          and asset.qa_result ->> 'automaticStatus' = 'PASSED'
          and asset.qa_result ->> 'mainBackground' = 'PURE_WHITE'
        )
        or
        (
          asset.transformation ->> 'authorizedSourceTreatment'
            = 'PRESERVED_FRAMED_SOURCE'
          and asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
          and asset.qa_result ->> 'mainBackground'
            = 'FRAMED_AUTHORIZED_SOURCE'
          and jsonb_typeof(asset.qa_result -> 'manualChecksRequired')
            = 'array'
          and asset.qa_result -> 'manualChecksRequired'
            @> jsonb_build_array(
              'AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL',
              'FRAMED_MAIN_BACKGROUND_HUMAN_ACCEPTANCE'
            )
        )
      )
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'LOCAL_AUTHORIZED_FOREGROUND'
      and asset.transformation ->> 'foregroundMatteVersion'
        = 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
      and asset.transformation ->> 'foregroundMatteMethod' in (
        'NATIVE_ALPHA', 'EDGE_CONNECTED_LIGHT_NEUTRAL_V1'
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
      and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
      and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        @> jsonb_build_array(
          'AUTHORIZED_FOREGROUND_MATTE_HUMAN_ACCEPTANCE'
        )
      and (
        (
          v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
          and asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
          and asset.transformation ->> 'generativeAiUsed' = 'true'
          and asset.transformation ->> 'backgroundPlateVersion'
            = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
          and asset.transformation ->> 'backgroundPlateQuality' = 'high'
          and asset.transformation ->> 'visualStrategyVersion'
            = 'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21'
          and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
        )
        or
        (
          v_control.generation_mode = 'DETERMINISTIC_ONLY'
          and asset.qa_result ->> 'automaticStatus' = 'PASSED'
          and asset.transformation ->> 'generativeAiUsed' = 'false'
          and asset.transformation ->> 'presentationMode'
            = 'AUTHORIZED_MULTI_SOURCE'
          and asset.qa_result ->> 'deterministicBackgroundSelection' = 'false'
        )
      )
    ),
    count(*) filter (where
      asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version
        <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved'
        is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly' is distinct from 'true'
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
        'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
      ])
    )
  into v_asset_count, v_slot_count, v_main_count, v_secondary_count,
    v_generative_count, v_invalid_count
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_main_count <> 1
    or v_secondary_count <> 5 or v_invalid_count <> 0
    or (
      v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
      and v_generative_count <> 5
    )
    or (
      v_control.generation_mode = 'DETERMINISTIC_ONLY'
      and v_generative_count <> 0
    ) then
    raise exception 'SAME_DAY_IMAGE_V6_FOREGROUND_EVIDENCE_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_current_v6(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_current_v6(
  uuid, uuid, uuid[]
) to service_role;

comment on function public.assert_same_day_pilot_image_set_current_v6(
  uuid, uuid, uuid[]
) is 'Requires one exact main plus five V6 locally-matted authorized foregrounds; generated backgrounds must be high quality and every opaque source rectangle is fail-closed.';

-- Keep V5 readable so an operator can reject it, but require V6 for APPROVE.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old text := $old$
  perform public.assert_same_day_pilot_image_set_safe(
    v_control.id, p_actor, v_control.asset_ids
  );

  if p_decision = 'APPROVE' then
$old$;
  v_new text := $new$
  perform public.assert_same_day_pilot_image_set_safe(
    v_control.id, p_actor, v_control.asset_ids
  );

  if p_decision = 'APPROVE' then
    perform public.assert_same_day_pilot_image_set_current_v6(
      v_control.id, p_actor, v_control.asset_ids
    );
$new$;
begin
  select pg_get_functiondef(
    'public.review_ebay_same_day_pilot_image_package_set(uuid,uuid,text,boolean,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'FOREGROUND_V6_REVIEW_BASE_CONTRACT_NOT_FOUND';
  end if;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'FOREGROUND_V6_REVIEW_BASE_CONTRACT_NOT_FOUND';
  end if;
  v_updated_definition := replace(v_definition, v_old, v_new);
  if v_updated_definition = v_definition then
    raise exception 'FOREGROUND_V6_REVIEW_PATCH_FAILED';
  end if;
  execute v_updated_definition;
end;
$migration$;

-- The final eBay publication claim also rejects approved historical V5 sets.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old text := $old$
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
$old$;
  v_new text := $new$
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or asset.transformation ->> 'compositorContractVersion'
        is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
      or (
        asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and not coalesce((
          asset.transformation ->> 'authorizedSourceTreatment'
            = 'LOCAL_AUTHORIZED_FOREGROUND'
          and asset.transformation ->> 'foregroundMatteVersion'
            = 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
          and asset.transformation ->> 'foregroundMatteMethod' in (
            'NATIVE_ALPHA', 'EDGE_CONNECTED_LIGHT_NEUTRAL_V1'
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
          and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
        ), false)
      )
      or (
        asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
        and coalesce(
          asset.transformation ->> 'authorizedSourceTreatment', ''
        ) not in ('NORMALIZED_LIGHT_NEUTRAL', 'PRESERVED_FRAMED_SOURCE')
      )
$new$;
begin
  select pg_get_functiondef(
    'public.assert_ebay_publish_image_set_high_quality(uuid,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'FOREGROUND_V6_PUBLICATION_BASE_CONTRACT_NOT_FOUND';
  end if;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'FOREGROUND_V6_PUBLICATION_BASE_CONTRACT_NOT_FOUND';
  end if;
  v_updated_definition := replace(v_definition, v_old, v_new);
  if v_updated_definition = v_definition then
    raise exception 'FOREGROUND_V6_PUBLICATION_PATCH_FAILED';
  end if;
  execute v_updated_definition;
end;
$migration$;

comment on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) is 'Blocks an eBay publication claim unless the six approved assets use V6 verified transparent authorized foregrounds and every generated background is high quality.';

notify pgrst, 'reload schema';
