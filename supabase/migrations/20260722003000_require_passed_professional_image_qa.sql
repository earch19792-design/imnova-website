-- Fail closed for every new image approval while preserving historical rows.
-- This migration performs no eBay writes and does not mutate old approvals.

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
  v_qa_not_passed integer;
  v_invalid_count integer;
begin
  if p_control_id is null or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (select count(distinct id) from unnest(p_asset_ids) id) <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SIX_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  -- The caller also locks these rows. Keeping the lock here makes direct
  -- invocations safe and closes concurrent review/status changes.
  perform 1 from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for update;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (
      where asset.id is null
        or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    ),
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
        <> 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V7_2026_07_22'
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or coalesce(asset.transformation ->> 'visualEvidenceMode', '')
        not in ('MARKET_SIGNAL_PROMPT', 'PROFESSIONAL_FALLBACK')
      or asset.qa_result ->> 'ocrTextVerified' is distinct from 'true'
      or asset.qa_result ->> 'mobileLegibilityVerified' is distinct from 'true'
      or asset.qa_result ->> 'productCoverageVerified' is distinct from 'true'
      or asset.qa_result ->> 'cropSafe' is distinct from 'true'
      or asset.qa_result ->> 'copyDuplicateFree' is distinct from 'true'
      or asset.qa_result ->> 'commercialUtilityVerified' is distinct from 'true'
      or asset.qa_result ->> 'groundedPresentation' is distinct from 'true'
      or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
      or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
      or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
      or case
        when asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND' then
          asset.transformation ->> 'generativeAiUsed' is distinct from 'false'
          or coalesce((asset.qa_result ->> 'outputEdgeWhiteRatio')::numeric, 0) < .90
          or coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .70 and .85
          or coalesce((asset.qa_result ->> 'textLineCount')::integer, -1) <> 0
        else
          coalesce((asset.qa_result ->> 'productCoverageRatio')::numeric, 0)
            not between .45 and .70
          or coalesce((asset.qa_result ->> 'textMinimumPixelSize')::integer, 0) < 54
          or coalesce((asset.qa_result ->> 'textLineCount')::integer, 0)
            not between 1 and 3
        end
      or (
        asset.transformation ->> 'generativeAiUsed' = 'true'
        and (
          asset.transformation ->> 'backgroundPlateQuality' <> 'high'
          or asset.transformation ->> 'visualEvidenceMode' <> 'MARKET_SIGNAL_PROMPT'
          or coalesce(asset.transformation ->> 'promptHash', '') !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation ->> 'marketSignalHash', '') !~ '^[0-9a-f]{64}$'
          or coalesce(asset.transformation ->> 'marketSignalConfidence', '')
            not in ('HIGH', 'MEDIUM')
          or coalesce(asset.transformation ->> 'marketSignalObservedAt', '') = ''
          or coalesce(asset.transformation ->> 'marketSignalFreshUntil', '') = ''
        )
      )
    )
  into v_asset_count, v_slot_count, v_qa_not_passed, v_invalid_count
  from unnest(p_asset_ids) requested(id)
  left join public.ebay_listing_image_assets asset on asset.id = requested.id;

  if v_qa_not_passed <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
  end if;
  if v_asset_count <> 6 or v_slot_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_PROFESSIONAL_QA_INVALID';
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
    and (tg_op = 'INSERT' or old.status is distinct from 'approved')
    and new.qa_result ->> 'automaticStatus' is distinct from 'PASSED' then
    raise exception 'SAME_DAY_IMAGE_SET_QA_NOT_PASSED';
  end if;
  return new;
end;
$$;

drop trigger if exists ebay_image_asset_require_passed_qa
  on public.ebay_listing_image_assets;
create trigger ebay_image_asset_require_passed_qa
before insert or update of status on public.ebay_listing_image_assets
for each row execute function public.block_non_passed_image_approval_v1();

-- Rejection remains possible for a failed set. Approval performs the strict
-- assertion while holding the control, package and six asset row locks.
do $$
declare
  v_definition text;
  v_old text := 'perform public.assert_same_day_pilot_image_set_safe(
    v_control.id, p_actor, v_control.asset_ids
  );';
  v_new text := 'if p_decision = ''APPROVE'' then
    perform public.assert_same_day_pilot_image_set_safe(
      v_control.id, p_actor, v_control.asset_ids
    );
  end if;';
begin
  select pg_get_functiondef(
    'public.review_ebay_same_day_pilot_image_package_set(uuid,uuid,text,boolean,jsonb)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'SAME_DAY_IMAGE_REVIEW_QA_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
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
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) <> 6
    or (select count(distinct value) from jsonb_array_elements_text(v_images)) <> 6 then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SIX_REQUIRED';
  end if;

  select count(*) filter (where
    asset.id is null or asset.status <> 'approved'
    or asset.approved_by is distinct from p_actor or asset.approved_at is null
    or asset.qa_result ->> 'automaticStatus' is distinct from 'PASSED'
    or asset.qa_result ->> 'ocrTextVerified' is distinct from 'true'
    or asset.qa_result ->> 'mobileLegibilityVerified' is distinct from 'true'
    or asset.qa_result ->> 'productCoverageVerified' is distinct from 'true'
    or asset.qa_result ->> 'cropSafe' is distinct from 'true'
    or asset.qa_result ->> 'copyDuplicateFree' is distinct from 'true'
    or asset.qa_result ->> 'commercialUtilityVerified' is distinct from 'true'
    or asset.qa_result ->> 'groundedPresentation' is distinct from 'true'
    or asset.qa_result ->> 'promptCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'marketSignalCompliancePassed' is distinct from 'true'
    or asset.qa_result ->> 'productFidelityPassed' is distinct from 'true'
    or asset.qa_result ->> 'commercialQualityPassed' is distinct from 'true'
    or asset.public_url is distinct from image.value
  ) into v_invalid_count
  from jsonb_array_elements_text(v_images) image(value)
  left join public.ebay_listing_image_assets asset
    on asset.public_url = image.value
    and asset.listing_package_id = p_listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor;
  if v_invalid_count <> 0 then
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
) is 'Fail-closed approval gate: every stored QA status must be exactly PASSED and every V7 professional visual check must pass.';
