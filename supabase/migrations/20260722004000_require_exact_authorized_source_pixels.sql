-- SELLER_OS_EBAY_VISUAL_STRATEGY_V2
-- Staging-first only: zero eBay writes, zero automatic publication, and no
-- mutation of historical approved image rows.

-- Expand the existing atomic persistence boundary from six to seven without
-- changing its signature or bypassing its account/actor checks.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ebay_create_pending_listing_image_set(uuid,text,uuid,uuid,text,jsonb)'::regprocedure
  ) into v_definition;
  if position('v_count > 7' in v_definition) = 0 then
    if position('v_count > 6' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_PENDING_SET_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, 'v_count > 6', 'v_count > 7');
  end if;
end;
$$;

-- A corrected revision may start from a historical six-image set, but every
-- newly created V2 revision is one main plus six secondary images.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_ebay_same_day_image_revision_asset_set(uuid,text,uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) into v_definition;
  if position('EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22' in v_definition) = 0 then
    if position('EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20' in v_definition) = 0
      or position('jsonb_array_length(p_assets) <> 6' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_REVISION_CREATE_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition,
      'jsonb_array_length(p_assets) <> 6',
      'jsonb_array_length(p_assets) <> 7');
    v_definition := replace(v_definition,
      'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20',
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22');
    v_definition := replace(v_definition,
      '''SIZE_AND_CONTENT'', ''USE_CONTEXT'', ''PACKAGE_CONTENTS''',
      '''SIZE_AND_CONTENT'', ''USE_CONTEXT'', ''PACKAGE_CONTENTS'', ''SECONDARY_6''');
    v_definition := replace(v_definition, ') <> 6 or (', ') <> 7 or (');
    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_definition text;
  v_old_treatment_gate text := $gate$or case asset.transformation ->> 'authorizedSourceTreatment'
      when 'NORMALIZED_LIGHT_NEUTRAL' then
        asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
      when 'PRESERVED_FRAMED_SOURCE' then
        asset.qa_result ->> 'automaticStatus' is distinct from 'PARTIAL'
      else true
    end$gate$;
  v_new_treatment_gate text := $gate$or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or asset.transformation ->> 'sourceVisualPolicy'
      is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
    or asset.transformation ->> 'authorizedSourceViewReused'
      is distinct from 'true'
    or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
    or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
    or asset.qa_result ->> 'technicalQualityPassed' is distinct from 'true'
    or asset.qa_result ->> 'productCoveragePassed' is distinct from 'true'
    or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
    or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
    or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
    or asset.qa_result ->> 'mobileReadabilityPassed' is distinct from 'true'
    or asset.qa_result ->> 'qaEvaluatorVersion'
      is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
    or coalesce(jsonb_array_length(asset.qa_result -> 'failureReasons'), -1) <> 0
    or coalesce(jsonb_array_length(asset.qa_result -> 'blockers'), -1) <> 0$gate$;
begin
  select pg_get_functiondef(
    'public.complete_ebay_same_day_image_revision(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure
  ) into v_definition;
  if position('SELLER_OS_EBAY_VISUAL_QA_V2' in v_definition) = 0 then
    if position('EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20' in v_definition) = 0
      or position(v_old_treatment_gate in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_REVISION_COMPLETE_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, '<> 6', '<> 7');
    v_definition := replace(v_definition,
      'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20',
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22');
    v_definition := replace(v_definition,
      '''SIZE_AND_CONTENT'', ''USE_CONTEXT'', ''PACKAGE_CONTENTS''',
      '''SIZE_AND_CONTENT'', ''USE_CONTEXT'', ''PACKAGE_CONTENTS'', ''SECONDARY_6''');
    v_definition := replace(v_definition,
      'or asset.transformation ->> ''generativeAiUsed'' is distinct from ''false''',
      'or (asset.transformation ->> ''slot'' = ''MAIN_WHITE_BACKGROUND'' and asset.transformation ->> ''generativeAiUsed'' is distinct from ''false'')');
    v_definition := replace(v_definition,
      v_old_treatment_gate, v_new_treatment_gate);
    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.review_ebay_same_day_image_revision(uuid,text,uuid,text,boolean,jsonb)'::regprocedure
  ) into v_definition;
  if position('SAME_DAY_IMAGE_REVISION_EXACT_SEVEN_REQUIRED' in v_definition) = 0 then
    if position('SAME_DAY_IMAGE_REVISION_EXACT_SIX_REQUIRED' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_REVISION_REVIEW_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, '<> 6', '<> 7');
    v_definition := replace(v_definition,
      'SAME_DAY_IMAGE_REVISION_EXACT_SIX_REQUIRED',
      'SAME_DAY_IMAGE_REVISION_EXACT_SEVEN_REQUIRED');
    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.reconfirm_ebay_ready_publication_luna_v1(text,uuid,uuid,uuid,numeric,boolean,integer,timestamptz)'::regprocedure
  ) into v_definition;
  if position('jsonb_array_length(v_handoff_urls) <> 7' in v_definition) = 0 then
    if position('jsonb_array_length(v_handoff_urls) <> 6' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_LUNA_RECONFIRM_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, '<> 6', '<> 7');
    v_definition := replace(v_definition,
      'cardinality(control.asset_ids) = 6',
      'cardinality(control.asset_ids) = 7');
    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.complete_ebay_same_day_pilot_image_package_run(uuid,uuid,uuid,uuid[],integer,text)'::regprocedure
  ) into v_definition;
  if position('cardinality(p_asset_ids), 0) <> 7' in v_definition) = 0 then
    if position('cardinality(p_asset_ids), 0) <> 6' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_COMPLETE_SET_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition,
      'cardinality(p_asset_ids), 0) <> 6',
      'cardinality(p_asset_ids), 0) <> 7');
    v_definition := replace(v_definition, '''imageCount'', 6',
      '''imageCount'', 7');
    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.review_ebay_same_day_pilot_image_package_set(uuid,uuid,text,boolean,jsonb)'::regprocedure
  ) into v_definition;
  if position('jsonb_array_length(p_publication_manifest) <> 7' in v_definition) = 0 then
    if position('jsonb_array_length(p_publication_manifest) <> 6' in v_definition) = 0 then
      raise exception 'SELLER_OS_V2_REVIEW_SET_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, '<> 6', '<> 7');
    v_definition := replace(v_definition, 'v_approved_count + 6 > 24',
      'v_approved_count + 7 > 28');
    v_definition := replace(v_definition,
      'SAME_DAY_IMAGE_PUBLICATION_EXACT_SIX_REQUIRED',
      'SAME_DAY_IMAGE_PUBLICATION_EXACT_SEVEN_REQUIRED');
    v_definition := replace(v_definition, '''imageCount'', 6',
      '''imageCount'', 7');
    execute v_definition;
  end if;
end;
$$;

create or replace function public.assert_same_day_pilot_image_set_safe(
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
  v_secondary_objective_count integer;
  v_qa_not_passed integer;
  v_invalid_count integer;
begin
  if p_control_id is null or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 7
    or (select count(distinct id) from unnest(p_asset_ids) id) <> 7 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SEVEN_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  perform 1 from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for update;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(distinct asset.transformation #>>
      '{visualStrategyPosition,salesObjective}') filter (
        where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      ),
    count(*) filter (where asset.id is null
      or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600 or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation ->> 'compositorContractVersion'
        <> 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22'
      or asset.transformation ->> 'sourceVisualPolicy'
        is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or asset.transformation ->> 'authorizedSourceViewReused'
        is distinct from 'true'
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.qa_result ->> 'sourceViewCapabilityPassed' is distinct from 'true'
      or asset.qa_result ->> 'marketSignalsLimitedToScene' is distinct from 'true'
      or asset.qa_result ->> 'hiddenProductGeometryGenerated' is distinct from 'false'
      or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
      or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
      or asset.qa_result ->> 'technicalQualityPassed' is distinct from 'true'
      or asset.qa_result ->> 'productCoveragePassed' is distinct from 'true'
      or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
      or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
      or asset.qa_result ->> 'mobileReadabilityPassed' is distinct from 'true'
      or asset.qa_result ->> 'qaEvaluatorVersion'
        is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
      or coalesce(jsonb_array_length(asset.qa_result -> 'failureReasons'), -1) <> 0
      or coalesce(jsonb_array_length(asset.qa_result -> 'blockers'), -1) <> 0
      or coalesce((asset.qa_result ->> 'textLineCount')::integer, -1) <> 0
      or coalesce((asset.qa_result ->> 'textMinimumPixelSize')::integer, -1) <> 0
      or case
        when asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND' then
          asset.transformation ->> 'generativeAiUsed' is distinct from 'false'
          or coalesce((asset.qa_result ->> 'outputEdgeWhiteRatio')::numeric, 0) < .90
          or coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .75 and .85
          or asset.transformation ? 'visualStrategyPosition'
        else
          coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .50 and .70
          or asset.transformation #>> '{visualStrategyPosition,feasibilityStatus}'
            is distinct from 'FEASIBLE'
          or coalesce(asset.transformation #>>
            '{visualStrategyPosition,contractHash}', '') !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation #>>
            '{visualStrategyPosition,salesObjective}', '') not in (
              'DETAIL_AND_MATERIAL', 'PACKAGE_CONTENTS', 'SIZE_AND_SCALE',
              'PRIMARY_USE', 'ASPIRATIONAL_LIFESTYLE',
              'TRUST_OR_OBJECTION', 'ALTERNATE_AUTHORIZED_ANGLE',
              'SECONDARY_USE', 'QUALITY_DETAIL',
              'RETURN_RISK_CLARIFICATION'
            )
        end
      or (
        asset.transformation ->> 'generativeAiUsed' = 'true'
        and (
          asset.transformation ->> 'backgroundPlateQuality' <> 'high'
          or asset.transformation ->> 'visualEvidenceMode'
            <> 'MARKET_SIGNAL_PROMPT'
          or coalesce(asset.transformation ->> 'promptHash', '')
            !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation ->> 'marketSignalHash', '')
            !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation ->> 'marketSignalConfidence', '')
            not in ('HIGH', 'MEDIUM')
          or coalesce(asset.transformation ->> 'marketSignalObservedAt', '') = ''
          or coalesce(asset.transformation ->> 'marketSignalFreshUntil', '') = ''
        )
      )
    )
  into v_asset_count, v_slot_count, v_secondary_objective_count,
    v_qa_not_passed, v_invalid_count
  from unnest(p_asset_ids) requested(id)
  left join public.ebay_listing_image_assets asset on asset.id = requested.id;

  if v_qa_not_passed <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
  end if;
  if v_asset_count <> 7 or v_slot_count <> 7
    or v_secondary_objective_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) to service_role;

create or replace function public.block_non_passed_image_approval_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved'
    and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if new.qa_result ->> 'automaticStatus' is distinct from 'PASSED' then
      raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
    end if;
    if new.transformation ->> 'sourceVisualPolicy'
        is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
      or new.transformation ->> 'authorizedSourceViewReused'
        is distinct from 'true'
      or new.qa_result ->> 'sourceViewCapabilityPassed'
        is distinct from 'true'
      or new.qa_result ->> 'marketSignalsLimitedToScene'
        is distinct from 'true'
      or new.qa_result ->> 'hiddenProductGeometryGenerated'
        is distinct from 'false'
      or new.qa_result ->> 'textPolicyPassed' is distinct from 'true'
      or new.qa_result ->> 'qaEvaluatorVersion'
        is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2' then
      raise exception 'SAME_DAY_IMAGE_SOURCE_VISUAL_POLICY_NOT_PASSED';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.assert_ebay_publish_image_set_high_quality(
  p_listing_package_id uuid,
  p_actor uuid,
  p_account_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_images jsonb;
  v_invalid_count integer;
  v_objective_count integer;
begin
  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = p_listing_package_id
    and package.created_by = p_actor
    and package.account_key = p_account_key
    and package.status = 'approved'
  for key share;
  if not found then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_PACKAGE_INVALID';
  end if;
  v_images := v_package.package_data -> 'imageUrls';
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) <> 7
    or (select count(distinct value) from jsonb_array_elements_text(v_images)) <> 7 then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED';
  end if;

  select count(*) filter (where
    asset.id is null or asset.status <> 'approved'
    or asset.approved_by is distinct from p_actor or asset.approved_at is null
    or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or asset.transformation ->> 'compositorContractVersion'
      <> 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22'
    or asset.transformation ->> 'sourceVisualPolicy'
      is distinct from 'EXACT_AUTHORIZED_PIXELS_ONLY'
    or asset.transformation ->> 'authorizedSourceViewReused'
      is distinct from 'true'
    or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
    or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
    or asset.qa_result ->> 'technicalQualityPassed' is distinct from 'true'
    or asset.qa_result ->> 'productCoveragePassed' is distinct from 'true'
    or asset.qa_result ->> 'compositionPassed' is distinct from 'true'
    or asset.qa_result ->> 'textPolicyPassed' is distinct from 'true'
    or asset.qa_result ->> 'contextualPropsPassed' is distinct from 'true'
    or asset.qa_result ->> 'mobileReadabilityPassed' is distinct from 'true'
    or asset.qa_result ->> 'qaEvaluatorVersion'
      is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
    or coalesce(jsonb_array_length(asset.qa_result -> 'failureReasons'), -1) <> 0
    or coalesce(jsonb_array_length(asset.qa_result -> 'blockers'), -1) <> 0
    or asset.public_url is distinct from image.value
  ), count(distinct asset.transformation #>>
    '{visualStrategyPosition,salesObjective}') filter (
      where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
    )
  into v_invalid_count, v_objective_count
  from jsonb_array_elements_text(v_images) image(value)
  left join public.ebay_listing_image_assets asset
    on asset.public_url = image.value
    and asset.listing_package_id = p_listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor;
  if v_invalid_count <> 0 or v_objective_count <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
  end if;
end;
$$;

revoke all on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) to service_role;

comment on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) is 'Atomic V2 gate: one authorized main plus six distinct text-free secondary sales objectives, exact Luna product pixels, all server QA PASSED.';

comment on function public.block_non_passed_image_approval_v1() is
  'New approvals require exact PASSED V2 QA and exact authorized Luna product pixels. Historical approvals remain read-only.';
