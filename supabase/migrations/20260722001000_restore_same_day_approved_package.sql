-- Rebuild the exact Seller OS workspace after a generic evidence refresh has
-- cleared server-protected fields.  This path is intentionally specific to a
-- READY same-day candidate and its human-approved six-image control.  It never
-- accepts image URLs from the caller and cannot write to eBay or Production.

create or replace function public.assert_ebay_same_day_approved_v6_control_v1(
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
  v_invalid_count integer;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 6 then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_IMAGE_SCOPE_INVALID';
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
    or cardinality(v_control.asset_ids) <> 6
    or not (p_asset_ids @> v_control.asset_ids)
    or not (p_asset_ids <@ v_control.asset_ids)
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_IMAGE_CONTROL_INVALID';
  end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(distinct asset.position),
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
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'foregroundMatteValidated')
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and not (asset.qa_result ? 'textGlyphsValidated')
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
      and coalesce(asset.transformation ->> 'foregroundMatteSha256', '')
        ~ '^[0-9a-f]{64}$'
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
      and asset.transformation ->> 'textRendererVersion'
        = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
      and asset.qa_result ->> 'foregroundMatteValidated' = 'true'
      and asset.qa_result ->> 'opaqueSourceFrameRemoved' = 'true'
      and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
      and asset.qa_result ->> 'textGlyphsValidated' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
      and asset.qa_result ->> 'humanApprovalRequired' = 'true'
      and jsonb_typeof(asset.qa_result -> 'manualChecksRequired') = 'array'
      and asset.qa_result -> 'manualChecksRequired'
        @> jsonb_build_array('AUTHORIZED_FOREGROUND_MATTE_HUMAN_ACCEPTANCE')
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
      or asset.account_key is distinct from p_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'approved'
      or asset.approved_by is distinct from p_actor
      or asset.approved_at is null
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version
        <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
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
  into v_asset_count, v_slot_count, v_position_count, v_main_count,
    v_secondary_count, v_generative_count, v_invalid_count
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_position_count <> 6
    or v_main_count <> 1 or v_secondary_count <> 5
    or v_invalid_count <> 0
    or (v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
      and v_generative_count <> 5)
    or (v_control.generation_mode = 'DETERMINISTIC_ONLY'
      and v_generative_count <> 0) then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V6_EVIDENCE_INVALID';
  end if;
end;
$$;

-- One predicate is shared by package save, image attach/reorder and the
-- dedicated restoration RPC.  PASSED keeps its legacy meaning.  PARTIAL is
-- admitted only when the asset is one of the exact six in a human-approved
-- same-day control whose complete V6/matte/text contract still validates.
create or replace function public.is_ebay_listing_image_guarded_approved_v1(
  p_asset_id uuid,
  p_listing_package_id uuid,
  p_account_key text,
  p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.ebay_listing_image_assets%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
begin
  if p_asset_id is null or p_listing_package_id is null or p_actor is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    return false;
  end if;
  select asset.* into v_asset
  from public.ebay_listing_image_assets asset
  where asset.id = p_asset_id
    and asset.listing_package_id = p_listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor;
  if not found
    or v_asset.status <> 'approved'
    or v_asset.approved_by is distinct from p_actor
    or v_asset.approved_at is null
    or v_asset.rights_evidence_confirmed is distinct from true
    or v_asset.output_sha256 !~ '^[0-9a-f]{64}$'
    or v_asset.public_url is null
    or v_asset.public_url !~ '^https://[^[:space:][:cntrl:]]+$'
    or v_asset.published_storage_path is null
    or v_asset.published_storage_path !~ (
      '^' || p_actor::text || '/[0-9a-f]{24}/'
        || v_asset.id::text || '[.]jpg$'
    )
    or strpos(
      v_asset.public_url,
      '/storage/v1/object/public/ebay-listing-images/'
        || v_asset.published_storage_path
    ) = 0
    or v_asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
    or v_asset.qa_result ->> 'automaticStatus' <> 'PARTIAL' then
    return false;
  end if;

  for v_control in
    select control.*
    from public.ebay_same_day_pilot_image_package_runs control
    where control.listing_package_id = p_listing_package_id
      and control.marketplace_account_key = p_account_key
      and control.created_by = p_actor
      and control.status = 'APPROVED'
      and control.reviewed_by = p_actor
      and control.human_decision = 'APPROVED'
      and cardinality(control.asset_ids) = 6
      and (
        select count(distinct requested.asset_id)
        from unnest(control.asset_ids) requested(asset_id)
      ) = 6
      and p_asset_id = any(control.asset_ids)
      and control.ebay_writes = 0
      and not control.production_changed
  loop
    begin
      perform public.assert_ebay_same_day_approved_v6_control_v1(
        v_control.id, p_account_key, p_actor, v_control.asset_ids
      );
      return true;
    exception when others then
      -- A stale or malformed approved control never widens the legacy filter.
      null;
    end;
  end loop;
  return false;
end;
$$;

revoke all on function public.is_ebay_listing_image_guarded_approved_v1(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- Patch the legacy base overloads once.  Account-scoped overloads already call
-- these base functions, so save, attach and reorder all share the same guard.
do $guard_patch$
declare
  v_signature text;
  v_definition text;
  v_updated_definition text;
  v_old text := $old$
      and image_asset.qa_result ->> 'automaticStatus' = 'PASSED'
$old$;
  v_new text := $new$
      and (
        image_asset.qa_result ->> 'automaticStatus' = 'PASSED'
        or public.is_ebay_listing_image_guarded_approved_v1(
          image_asset.id, p_package_id, image_asset.account_key, p_actor
        )
      )
$new$;
begin
  foreach v_signature in array array[
    'public.ebay_save_listing_package_guarded(uuid,uuid,uuid,text,text,jsonb,text,numeric,timestamptz,timestamptz)',
    'public.ebay_attach_approved_listing_images(uuid,uuid)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if v_definition is null then
      raise exception 'SAME_DAY_WORKSPACE_LEGACY_IMAGE_GUARD_NOT_FOUND';
    end if;
    if strpos(v_definition, v_new) > 0 then
      continue;
    end if;
    if strpos(v_definition, v_old) = 0 then
      raise exception 'SAME_DAY_WORKSPACE_LEGACY_IMAGE_FILTER_NOT_FOUND';
    end if;
    v_updated_definition := replace(v_definition, v_old, v_new);
    if v_updated_definition = v_definition
      or strpos(
        v_updated_definition,
        'is_ebay_listing_image_guarded_approved_v1'
      ) = 0 then
      raise exception 'SAME_DAY_WORKSPACE_LEGACY_IMAGE_GUARD_PATCH_FAILED';
    end if;
    execute v_updated_definition;
  end loop;
end;
$guard_patch$;

create or replace function public.restore_ebay_same_day_authorized_listing_package_v1(
  p_listing_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_package_patch jsonb,
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
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_profile public.ebay_account_policy_profiles%rowtype;
  v_binding jsonb;
  v_handoff_summary jsonb;
  v_handoff jsonb;
  v_image_summary jsonb;
  v_image_urls jsonb;
  v_image_manifest jsonb;
  v_aspects jsonb := '{}'::jsonb;
  v_aspect record;
  v_aspect_name text;
  v_aspect_value text;
  v_draft jsonb;
  v_authorization jsonb;
  v_same_day_authorization jsonb;
  v_evidence jsonb;
  v_next_data jsonb;
  v_shipping_values jsonb;
  v_package_weight_and_size jsonb := '{}'::jsonb;
  v_current_package_weight_and_size jsonb := '{}'::jsonb;
  v_length numeric;
  v_width numeric;
  v_height numeric;
  v_weight numeric;
  v_length_unit text;
  v_width_unit text;
  v_height_unit text;
  v_weight_unit text;
  v_dimension_unit text;
  v_control_id uuid;
  v_control_id_text text;
  v_expected_price numeric;
  v_supplier_cost numeric;
  v_pricing jsonb;
begin
  if p_listing_package_id is null
    or p_actor is null
    or p_opportunity_id is null
    or nullif(trim(coalesce(p_candidate_key, '')), '') is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_source_observed_at is null
    or p_expected_updated_at is null
    or p_source_observed_at < clock_timestamp() - interval '24 hours'
    or p_source_observed_at > clock_timestamp() + interval '5 minutes'
    or jsonb_typeof(coalesce(p_package_patch, 'null'::jsonb)) <> 'object' then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_INPUT_INVALID';
  end if;
  v_pricing := p_package_patch->'pricing';
  if jsonb_typeof(coalesce(v_pricing, 'null'::jsonb)) <> 'object' then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_PRICING_INVALID';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_pricing) pricing_key(key)
    where pricing_key.key not in (
      'currency', 'supplierCost', 'targetPrice', 'estimatedEbayFees',
      'estimatedOutboundShipping', 'returnsReserve',
      'promotedListingsReserve', 'estimatedNetProfit',
      'estimatedNetMarginPercent', 'estimatedRoiPercent',
      'minimumProfitablePrice', 'passesProfitGate', 'costAssumptions',
      'calculationSource'
    )
  )
    or v_pricing->>'currency' is distinct from 'USD'
    or coalesce(v_pricing->>'supplierCost', '')
      !~ '^[0-9]+([.][0-9]{1,6})?$'
    or coalesce(v_pricing->>'targetPrice', '')
      !~ '^[0-9]+([.][0-9]{1,6})?$'
    or (v_pricing->>'targetPrice')::numeric <= 0
    or jsonb_typeof(v_pricing->'costAssumptions') is distinct from 'object'
    or nullif(trim(coalesce(v_pricing->>'calculationSource', '')), '') is null then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_PRICING_INVALID';
  end if;

  perform public.assert_ebay_listing_package_account_scope(
    p_listing_package_id, p_account_key, p_actor
  );
  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = p_listing_package_id
    and package.account_key = p_account_key
    and package.created_by = p_actor
    and package.opportunity_id = p_opportunity_id
    and package.candidate_key = p_candidate_key
    and package.status in ('draft', 'ready_for_review')
  for update;
  if not found then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_PACKAGE_INVALID';
  end if;
  if v_package.updated_at is distinct from p_expected_updated_at then
    raise exception 'EBAY_LISTING_PACKAGE_STALE_VERSION';
  end if;
  if exists (
      select 1 from public.ebay_draft_only_approvals approval
      where approval.listing_package_id = v_package.id
        and approval.status = 'approved'
        and approval.expires_at > clock_timestamp()
    ) or exists (
      select 1 from public.ebay_draft_only_execution_ledger execution
      where execution.listing_package_id = v_package.id
    ) or exists (
      select 1 from public.ebay_authorized_listing_publications publication
      where publication.listing_package_id = v_package.id
    ) then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_ALREADY_EXECUTED';
  end if;

  v_binding := coalesce(v_package.package_data->'sameDayPilot', '{}'::jsonb);
  if coalesce(v_binding->>'runId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'candidateId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_BINDING_INVALID';
  end if;
  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = (v_binding->>'candidateId')::uuid
    and candidate.run_id = (v_binding->>'runId')::uuid
    and candidate.opportunity_id = p_opportunity_id
    and candidate.candidate_key = p_candidate_key
  for key share;
  if not found
    or v_candidate.state <> 'READY_FOR_MANUAL_PUBLICATION'
    or v_candidate.machine_state <> 'READY_FOR_MANUAL_PUBLICATION'
    or cardinality(v_candidate.blockers) <> 0 then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_CANDIDATE_INVALID';
  end if;
  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id
    and run.marketplace_account_key = p_account_key
    and run.created_by = p_actor
  for key share;
  if not found then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_RUN_INVALID';
  end if;

  v_handoff_summary := coalesce(v_candidate.manual_handoff_package, '{}'::jsonb);
  v_handoff := coalesce(v_handoff_summary->'package', '{}'::jsonb);
  v_image_summary := coalesce(v_candidate.image_package_summary, '{}'::jsonb);
  v_control_id_text := coalesce(v_image_summary->>'controlId', '');
  if v_handoff_summary->>'status' is distinct from 'READY_FOR_MANUAL_PUBLICATION'
    or coalesce(v_handoff_summary->>'packageHash', '') !~ '^[0-9a-f]{64}$'
    or v_handoff->>'candidateId' is distinct from v_candidate.id::text
    or v_handoff->>'quantity' is distinct from '1'
    or coalesce(v_handoff->>'title', '') = ''
    or length(v_handoff->>'title') > 80
    or coalesce(v_handoff->>'categoryId', '') !~ '^[0-9]{1,20}$'
    or coalesce(v_handoff->>'conditionId', '') !~ '^[0-9]{1,12}$'
    or nullif(trim(coalesce(v_handoff->>'description', '')), '') is null
    or coalesce(v_handoff->>'price', '')
      !~ '^[0-9]+([.][0-9]{1,6})?$'
    or jsonb_typeof(v_handoff->'itemSpecifics') is distinct from 'object'
    or v_image_summary->>'approved' is distinct from 'true'
    or v_image_summary->>'listingPackageId' is distinct from v_package.id::text
    or v_control_id_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_HANDOFF_INVALID';
  end if;
  v_control_id := v_control_id_text::uuid;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  join public.ebay_same_day_pilot_handoffs handoff
    on handoff.id = control.handoff_id
    and handoff.run_id = control.run_id
    and handoff.candidate_id = control.candidate_id
    and handoff.fact_run_id = control.fact_run_id
    and handoff.package_hash = control.handoff_hash
  where control.id = v_control_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
    and control.run_id = v_run.id
    and control.candidate_id = v_candidate.id
    and control.listing_package_id = v_package.id
    and control.status = 'APPROVED'
    and control.reviewed_by = p_actor
    and control.human_decision = 'APPROVED'
    and cardinality(control.asset_ids) = 6
    and control.ebay_writes = 0
    and not control.production_changed
    and handoff.status in ('AWAITING_IMAGE_APPROVAL', 'READY_FOR_MANUAL_PUBLICATION')
    and handoff.operator_price_approved
    and handoff.ebay_writes = 0
    and not handoff.production_changed
  for key share of control;
  if not found then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_CONTROL_INVALID';
  end if;
  perform public.assert_ebay_same_day_approved_v6_control_v1(
    v_control.id, p_account_key, p_actor, v_control.asset_ids
  );
  if exists (
    select 1
    from unnest(v_control.asset_ids) requested(asset_id)
    join public.ebay_listing_image_assets asset
      on asset.id = requested.asset_id
    where asset.qa_result ->> 'automaticStatus' <> 'PASSED'
      and not public.is_ebay_listing_image_guarded_approved_v1(
        requested.asset_id, v_package.id, p_account_key, p_actor
      )
  ) then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_IMAGE_GUARD_INVALID';
  end if;

  select
    jsonb_agg(asset.public_url order by asset.position, asset.created_at, asset.id),
    jsonb_agg(jsonb_build_object(
      'assetId', asset.id,
      'url', asset.public_url,
      'role', asset.asset_role,
      'slot', asset.transformation ->> 'slot',
      'position', asset.position,
      'sha256', asset.output_sha256,
      'transformationVersion', asset.transformation_version,
      'automaticQa', asset.qa_result ->> 'automaticStatus',
      'generativeAiUsed', asset.transformation ->> 'generativeAiUsed' = 'true',
      'humanApprovedAt', asset.approved_at
    ) order by asset.position, asset.created_at, asset.id)
  into v_image_urls, v_image_manifest
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_control.asset_ids)
    and asset.listing_package_id = v_package.id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.status = 'approved';
  if jsonb_array_length(coalesce(v_image_urls, '[]'::jsonb)) <> 6
    or jsonb_array_length(coalesce(v_image_manifest, '[]'::jsonb)) <> 6
    or v_handoff#>'{images,urls}' is distinct from v_image_urls
    or v_image_summary->'publicUrls' is distinct from v_image_urls then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_IMAGE_BINDING_INVALID';
  end if;

  for v_aspect in select entry.key, entry.value
    from jsonb_each(v_handoff->'itemSpecifics') entry(key, value)
  loop
    v_aspect_name := trim(v_aspect.key);
    if length(v_aspect_name) < 1 or length(v_aspect_name) > 80
      or v_aspect_name ~ '[[:cntrl:]]'
      or jsonb_typeof(v_aspect.value) <> 'array'
      or jsonb_array_length(v_aspect.value) <> 1 then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_ASPECTS_INVALID';
    end if;
    v_aspect_value := trim(v_aspect.value->>0);
    if length(v_aspect_value) < 1 or length(v_aspect_value) > 100
      or v_aspect_value ~ '[[:cntrl:]]' then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_ASPECTS_INVALID';
    end if;
    v_aspects := v_aspects || jsonb_build_object(
      v_aspect_name, v_aspect_value
    );
  end loop;
  if v_aspects = '{}'::jsonb then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_ASPECTS_INVALID';
  end if;

  v_shipping_values := v_handoff#>'{shipping,values}';
  v_current_package_weight_and_size := coalesce(
    v_package.package_data#>'{draftConfiguration,packageWeightAndSize}',
    '{}'::jsonb
  );
  if v_handoff#>>'{shipping,status}' = 'CONFIRMED' then
    if jsonb_typeof(v_shipping_values) is distinct from 'object'
      or coalesce(v_shipping_values#>>'{shippingLength,value}', '')
        !~ '^[0-9]+([.][0-9]{1,6})?$'
      or coalesce(v_shipping_values#>>'{shippingWidth,value}', '')
        !~ '^[0-9]+([.][0-9]{1,6})?$'
      or coalesce(v_shipping_values#>>'{shippingHeight,value}', '')
        !~ '^[0-9]+([.][0-9]{1,6})?$'
      or coalesce(v_shipping_values#>>'{shippingWeight,value}', '')
        !~ '^[0-9]+([.][0-9]{1,6})?$'
      or coalesce(
        v_shipping_values#>>'{shippingLength,verificationStatus}', ''
      ) not in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED')
      or coalesce(
        v_shipping_values#>>'{shippingWidth,verificationStatus}', ''
      ) not in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED')
      or coalesce(
        v_shipping_values#>>'{shippingHeight,verificationStatus}', ''
      ) not in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED')
      or coalesce(
        v_shipping_values#>>'{shippingWeight,verificationStatus}', ''
      ) not in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED') then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
    end if;
    v_length := (v_shipping_values#>>'{shippingLength,value}')::numeric;
    v_width := (v_shipping_values#>>'{shippingWidth,value}')::numeric;
    v_height := (v_shipping_values#>>'{shippingHeight,value}')::numeric;
    v_weight := (v_shipping_values#>>'{shippingWeight,value}')::numeric;
    v_length_unit := upper(coalesce(v_shipping_values#>>'{shippingLength,unit}', ''));
    v_width_unit := upper(coalesce(v_shipping_values#>>'{shippingWidth,unit}', ''));
    v_height_unit := upper(coalesce(v_shipping_values#>>'{shippingHeight,unit}', ''));
    v_weight_unit := upper(coalesce(v_shipping_values#>>'{shippingWeight,unit}', ''));
    v_length_unit := case when v_length_unit in ('IN', 'INCH', 'INCHES')
        then 'INCH'
      when v_length_unit in ('CM', 'CENTIMETER', 'CENTIMETERS')
        then 'CENTIMETER' else '' end;
    v_width_unit := case when v_width_unit in ('IN', 'INCH', 'INCHES')
        then 'INCH'
      when v_width_unit in ('CM', 'CENTIMETER', 'CENTIMETERS')
        then 'CENTIMETER' else '' end;
    v_height_unit := case when v_height_unit in ('IN', 'INCH', 'INCHES')
        then 'INCH'
      when v_height_unit in ('CM', 'CENTIMETER', 'CENTIMETERS')
        then 'CENTIMETER' else '' end;
    v_weight_unit := case when v_weight_unit in ('LB', 'LBS', 'POUND', 'POUNDS')
        then 'POUND'
      when v_weight_unit in ('OZ', 'OUNCE', 'OUNCES') then 'OUNCE'
      when v_weight_unit in ('KG', 'KILOGRAM', 'KILOGRAMS') then 'KILOGRAM'
      when v_weight_unit in ('G', 'GRAM', 'GRAMS') then 'GRAM'
      else '' end;
    v_dimension_unit := v_length_unit;
    if v_length <= 0 or v_width <= 0 or v_height <= 0 or v_weight <= 0
      or v_length > 10000 or v_width > 10000 or v_height > 10000
      or v_weight > 100000 or v_dimension_unit = '' or v_weight_unit = ''
      or v_width_unit <> v_dimension_unit
      or v_height_unit <> v_dimension_unit then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
    end if;
    v_package_weight_and_size := jsonb_build_object(
      'dimensions', jsonb_build_object(
        'length', v_length, 'width', v_width, 'height', v_height,
        'unit', v_dimension_unit
      ),
      'weight', jsonb_build_object('value', v_weight, 'unit', v_weight_unit)
    );
  elsif v_handoff#>>'{shipping,status}' = 'ESTIMATE_ONLY_NOT_FOR_LISTING'
    and v_handoff#>>'{shipping,estimatedValuesExcluded}' = 'true'
    and v_handoff#>>'{shipping,operatorConfirmationRequired}' = 'true'
    and v_shipping_values = '{}'::jsonb then
    -- A flat verified shipping policy can make measurements optional.  The
    -- handoff explicitly excludes estimates, so preserve only an actually
    -- empty current measurement object and never manufacture dimensions.
    if jsonb_typeof(v_current_package_weight_and_size) <> 'object'
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,length}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,width}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,height}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,unit}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{weight,value}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{weight,unit}', ''
      )), '') is not null then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
    end if;
    v_package_weight_and_size := v_current_package_weight_and_size;
  else
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
  end if;

  select profile.* into v_profile
  from public.ebay_account_policy_profiles profile
  where profile.account_key = p_account_key
    and profile.marketplace_id = 'EBAY_US'
    and profile.profile_version = 'EBAY_ACCOUNT_POLICY_PROFILE_V1_2026_07_20'
    and profile.verification_source = 'EBAY_ACCOUNT_API_GET'
    and profile.verified_at <= clock_timestamp()
    and profile.expires_at > clock_timestamp()
    and profile.merchant_location_key is not null
    and profile.selected_by = p_actor
  for key share;
  if not found or v_profile.merchant_location_key is null then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_VERIFIED_POLICIES_REQUIRED';
  end if;

  v_expected_price := (v_handoff->>'price')::numeric;
  v_supplier_cost := (v_pricing->>'supplierCost')::numeric;
  if coalesce(v_candidate.economics_summary->>'confirmedLunaPrice', '')
      !~ '^[0-9]+([.][0-9]{1,6})?$'
    or abs(v_supplier_cost - (
      v_candidate.economics_summary->>'confirmedLunaPrice'
    )::numeric) >= 0.005
    or (
      v_candidate.economics_summary#>>'{controlledRiskOverride,authorized}' = 'true'
      and abs((v_pricing->>'targetPrice')::numeric - v_expected_price) >= 0.005
    ) then
    raise exception 'SAME_DAY_WORKSPACE_REFRESH_PRICING_BINDING_INVALID';
  end if;

  v_draft := case
    when jsonb_typeof(v_package.package_data->'draftConfiguration') = 'object'
      then v_package.package_data->'draftConfiguration'
    else '{}'::jsonb end;
  v_authorization := case
    when jsonb_typeof(v_draft->'imageAuthorization') = 'object'
      then v_draft->'imageAuthorization'
    else '{}'::jsonb end;
  v_authorization := v_authorization || jsonb_build_object(
    'approved', true,
    'approvedAt', v_control.reviewed_at,
    'approvedImageUrls', v_image_urls,
    'rightsBasis', 'supplier_authorized',
    'source', 'luna',
    'protectedManifestVerified', true,
    'protectedManifestAssetCount', 6
  );
  v_draft := v_draft || jsonb_build_object(
    'quantity', 1,
    'condition', 'NEW',
    'businessPolicies', jsonb_build_object(
      'fulfillmentPolicyId', v_profile.fulfillment_policy_id,
      'paymentPolicyId', v_profile.payment_policy_id,
      'returnPolicyId', v_profile.return_policy_id,
      'verifiedSourceAt', v_profile.verified_at
    ),
    'packageWeightAndSize', v_package_weight_and_size,
    'imageAuthorization', v_authorization
  );
  v_draft := jsonb_set(
    v_draft, '{merchantLocationKey}',
    to_jsonb(v_profile.merchant_location_key), true
  );

  v_same_day_authorization := jsonb_build_object(
    'validated', true,
    'version', 'SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20',
    'runId', v_run.id,
    'candidateId', v_candidate.id,
    'listingPackageId', v_package.id,
    'machineState', v_candidate.machine_state,
    'handoffPackageHash', v_handoff_summary->>'packageHash',
    'imageControlId', v_control.id,
    'sourceObservedAt', p_source_observed_at,
    'source', coalesce(
      v_candidate.economics_summary#>>'{lunaConfirmation,source}',
      'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
    ),
    'quantityVisible', coalesce((
      v_candidate.economics_summary#>>'{lunaConfirmation,quantityVisible}'
    )::boolean, false),
    'controlledRisk',
      v_candidate.economics_summary#>>'{controlledRiskOverride,authorized}' = 'true',
    'finalHumanAuthorizationRequired', true,
    'unattendedPublicationAllowed', false
  );
  v_binding := v_binding || jsonb_build_object(
    'authorizationVersion', 'SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20',
    'handoffPackageHash', v_handoff_summary->>'packageHash',
    'sourceObservedAt', p_source_observed_at,
    'finalHumanAuthorizationRequired', true,
    'unattendedPublicationAllowed', false
  );
  v_evidence := case
    when jsonb_typeof(v_package.package_data->'evidenceSnapshot') = 'object'
      then v_package.package_data->'evidenceSnapshot'
    else '{}'::jsonb end;
  v_evidence := v_evidence || jsonb_build_object(
    'sameDayPilotAuthorization', v_same_day_authorization
  );

  v_next_data := coalesce(v_package.package_data, '{}'::jsonb)
    || jsonb_build_object(
      'title', v_handoff->>'title',
      'categoryId', v_handoff->>'categoryId',
      'conditionId', v_handoff->>'conditionId',
      'aspects', v_aspects,
      'description', v_handoff->>'description',
      'imageUrls', v_image_urls,
      'imageAssetManifest', v_image_manifest,
      'pricing', v_pricing,
      'shipping', v_handoff->'shipping',
      'draftConfiguration', v_draft,
      'sameDayPilot', v_binding,
      'controlledRiskPolicy', v_handoff->'controlledRiskPolicy',
      'evidenceSnapshot', v_evidence,
      'sourceRefresh', jsonb_build_object(
        'refreshedAt', clock_timestamp(),
        'strategy', 'SAME_DAY_APPROVED_CONTROL_AND_FRESH_LUNA_SOURCE'
      )
    );

  update public.ebay_listing_packages package
  set package_data = v_next_data,
      status = 'draft',
      readiness = 0,
      source_observed_at = p_source_observed_at,
      updated_at = clock_timestamp()
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

revoke all on function public.assert_ebay_same_day_approved_v6_control_v1(
  uuid, text, uuid, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.restore_ebay_same_day_authorized_listing_package_v1(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.restore_ebay_same_day_authorized_listing_package_v1(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
) to service_role;

comment on function public.restore_ebay_same_day_authorized_listing_package_v1(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
) is 'Rebuilds one internal Seller OS workspace from its exact human-approved V6/text image control, current handoff and verified account profile; accepts no image URL and performs zero eBay/Production writes.';

-- Migration-time fail-closed contract checks.  These calls cannot mutate rows:
-- the first one is rejected before any lookup and the remaining checks inspect
-- the installed function and privileges only.
do $migration_test$
declare
  v_definition text;
  v_guard_definition text;
  v_save_definition text;
  v_attach_definition text;
begin
  begin
    perform 1 from public.restore_ebay_same_day_authorized_listing_package_v1(
      null, null, null, null, null, null, null, null
    );
    raise exception 'SAME_DAY_WORKSPACE_NULL_SCOPE_TEST_DID_NOT_FAIL';
  exception when others then
    if sqlerrm <> 'SAME_DAY_WORKSPACE_REFRESH_INPUT_INVALID' then
      raise;
    end if;
  end;

  select pg_get_functiondef(
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or strpos(v_definition, 'control.status = ''APPROVED''') = 0
    or strpos(v_definition, 'asset.id = any(v_control.asset_ids)') = 0
    or strpos(v_definition, 'is_ebay_listing_image_guarded_approved_v1') = 0
    or strpos(v_definition, '''imageUrls'', v_image_urls') = 0
    or strpos(v_definition, 'p_image_urls') > 0
    or strpos(v_definition, 'p_image_manifest') > 0 then
    raise exception 'SAME_DAY_WORKSPACE_FAIL_CLOSED_DEFINITION_TEST_FAILED';
  end if;
  select pg_get_functiondef(
    'public.assert_ebay_same_day_approved_v6_control_v1(uuid,text,uuid,uuid[])'::regprocedure
  ) into v_guard_definition;
  if v_guard_definition is null
    or strpos(
      v_guard_definition,
      'SAME_DAY_WORKSPACE_APPROVED_V6_EVIDENCE_INVALID'
    ) = 0
    or strpos(
      v_guard_definition,
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
    ) = 0
    or strpos(
      v_guard_definition,
      'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
    ) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_V6_GUARD_DEFINITION_TEST_FAILED';
  end if;
  select pg_get_functiondef(
    'public.ebay_save_listing_package_guarded(uuid,uuid,uuid,text,text,jsonb,text,numeric,timestamptz,timestamptz)'::regprocedure
  ) into v_save_definition;
  select pg_get_functiondef(
    'public.ebay_attach_approved_listing_images(uuid,uuid)'::regprocedure
  ) into v_attach_definition;
  if strpos(
      coalesce(v_save_definition, ''),
      'is_ebay_listing_image_guarded_approved_v1'
    ) = 0
    or strpos(
      coalesce(v_attach_definition, ''),
      'is_ebay_listing_image_guarded_approved_v1'
    ) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_SHARED_IMAGE_GUARD_TEST_FAILED';
  end if;
  if has_function_privilege(
      'anon',
      'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'SAME_DAY_WORKSPACE_PRIVILEGE_TEST_FAILED';
  end if;
end;
$migration_test$;

notify pgrst, 'reload schema';
