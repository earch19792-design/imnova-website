-- Require high-quality OpenAI evidence for the current publish-bound Visual
-- Strategy V2 / scene-board V3 / compositor V5 contract. Historical V1/V2
-- review sets remain readable and deterministic multi-source sets remain
-- supported. No competitor image, eBay write or Production capability is
-- introduced.

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
  v_partial_count integer;
  v_generative_count integer;
  v_safe_v1_count integer;
  v_safe_v2_count integer;
  v_safe_v3_count integer;
  v_invalid_count integer;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SIX_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
    ),
    count(*) filter (
      where asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' = 'USE_CONTEXT'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2'
        and asset.transformation ->> 'compositorContractVersion'
          = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V4_2026_07_21'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.transformation ->> 'competitorImageUsed' = 'false'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
        and asset.transformation ->> 'compositorContractVersion'
          = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
        and asset.transformation ->> 'visualStrategyVersion'
          = 'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21'
        and asset.transformation ->> 'backgroundPlateQuality' = 'high'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.transformation ->> 'competitorImageUsed' = 'false'
        and case
          when jsonb_typeof(
            asset.transformation -> 'selectedSceneBoardPanel'
          ) = 'number' then (
            asset.transformation ->> 'selectedSceneBoardPanel'
          )::numeric between 1 and 6
          else false
        end
        and jsonb_typeof(
          asset.transformation -> 'candidateSceneBoardPanels'
        ) = 'array'
        and case
          when jsonb_typeof(
            asset.transformation -> 'candidateSceneBoardPanels'
          ) = 'array' then jsonb_array_length(
            asset.transformation -> 'candidateSceneBoardPanels'
          ) between 1 and 2
          else false
        end
        and asset.transformation -> 'candidateSceneBoardPanels'
          @> jsonb_build_array(
            asset.transformation -> 'selectedSceneBoardPanel'
          )
        and case
          when jsonb_typeof(
            asset.transformation -> 'backgroundCompatibilityScore'
          ) = 'number' then (
            asset.transformation ->> 'backgroundCompatibilityScore'
          )::numeric between 0 and 100
          else false
        end
        and jsonb_typeof(asset.transformation -> 'sourceVisualProfile')
          = 'object'
        and asset.transformation #>> '{sourceVisualProfile,brightness}'
          in ('DARK', 'MID', 'LIGHT')
        and asset.transformation #>> '{sourceVisualProfile,contrast}'
          in ('LOW', 'MEDIUM', 'HIGH')
        and asset.transformation #>> '{sourceVisualProfile,palette}'
          in ('COOL', 'NEUTRAL', 'WARM', 'MIXED')
        and asset.transformation #>> '{sourceVisualProfile,productToneRisk}'
          in ('LIGHT_NEUTRAL_AMBIGUITY', 'STANDARD')
        and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
        and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.candidate_key is distinct from (
        select candidate.candidate_key
        from public.ebay_same_day_pilot_candidates candidate
        where candidate.id = v_control.candidate_id
      )
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
        'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
      ])
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved' is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly' is distinct from 'true'
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or coalesce(asset.qa_result ->> 'automaticStatus', '')
        not in ('PASSED', 'PARTIAL')
      or (
        asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and not (
          (
            asset.transformation ->> 'slot' = 'USE_CONTEXT'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
            and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
              ~ '^[0-9a-f]{64}$'
            and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
              ~ '^[0-9a-f]{64}$'
          )
          or
          (
            asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2'
            and asset.transformation ->> 'compositorContractVersion'
              = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V4_2026_07_21'
            and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
              ~ '^[0-9a-f]{64}$'
            and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
              ~ '^[0-9a-f]{64}$'
          )
          or
          (
            asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
            and asset.transformation ->> 'generativeAiUsed' = 'true'
            and asset.transformation ->> 'backgroundPlateVersion'
              = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
            and asset.transformation ->> 'compositorContractVersion'
              = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
            and asset.transformation ->> 'visualStrategyVersion'
              = 'EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21'
            and asset.transformation ->> 'backgroundPlateQuality' = 'high'
            and coalesce(
              asset.transformation ->> 'backgroundPlateRequestHash', ''
            ) ~ '^[0-9a-f]{64}$'
            and coalesce(
              asset.transformation ->> 'backgroundPlateOutputSha256', ''
            ) ~ '^[0-9a-f]{64}$'
            and case
              when jsonb_typeof(
                asset.transformation -> 'selectedSceneBoardPanel'
              ) = 'number' then (
                asset.transformation ->> 'selectedSceneBoardPanel'
              )::numeric between 1 and 6
              else false
            end
            and jsonb_typeof(
              asset.transformation -> 'candidateSceneBoardPanels'
            ) = 'array'
            and case
              when jsonb_typeof(
                asset.transformation -> 'candidateSceneBoardPanels'
              ) = 'array' then jsonb_array_length(
                asset.transformation -> 'candidateSceneBoardPanels'
              ) between 1 and 2
              else false
            end
            and asset.transformation -> 'candidateSceneBoardPanels'
              @> jsonb_build_array(
                asset.transformation -> 'selectedSceneBoardPanel'
              )
            and case
              when jsonb_typeof(
                asset.transformation -> 'backgroundCompatibilityScore'
              ) = 'number' then (
                asset.transformation ->> 'backgroundCompatibilityScore'
              )::numeric between 0 and 100
              else false
            end
            and jsonb_typeof(
              asset.transformation -> 'sourceVisualProfile'
            ) = 'object'
            and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
            and asset.qa_result ->> 'deterministicBackgroundSelection' = 'true'
          )
        )
      )
    )
  into v_asset_count, v_slot_count, v_partial_count, v_generative_count,
    v_safe_v1_count, v_safe_v2_count, v_safe_v3_count, v_invalid_count
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID';
  end if;
  if v_control.generation_mode = 'OPENAI_CONTEXT_PLATE' and not (
    (v_partial_count = 1 and v_generative_count = 1 and v_safe_v1_count = 1)
    or
    (v_partial_count = 5 and v_generative_count = 5 and v_safe_v2_count = 5)
    or
    (v_partial_count = 5 and v_generative_count = 5 and v_safe_v3_count = 5)
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_AI_CONTEXT_INVALID';
  end if;
  if v_control.generation_mode = 'DETERMINISTIC_ONLY' and (
    v_partial_count <> 0 or v_generative_count <> 0
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_DETERMINISTIC_INVALID';
  end if;
end;
$$;

revoke all on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) to service_role;

comment on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) is 'Validates legacy context sets and requires high-quality evidence for the publish-bound Visual Strategy V2 scene-board V3/compositor V5 contract; exact authorized main and human review remain mandatory.';

-- The listing workspace uses the same publish-bound scene-board contract. New
-- claims inherit high / 1536x1024 while the prior low-resolution V1/V2 rows
-- remain valid immutable history.
alter table public.ebay_openai_image_context_runs
  alter column requested_quality set default 'high',
  alter column requested_size set default '1536x1024';

alter table public.ebay_openai_image_context_runs
  drop constraint if exists ebay_openai_image_context_version_check;
alter table public.ebay_openai_image_context_runs
  add constraint ebay_openai_image_context_version_check check (
    plate_version in (
      'EBAY_OPENAI_BACKGROUND_PLATE_V1',
      'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2',
      'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
    )
  );

alter table public.ebay_openai_image_context_runs
  drop constraint if exists ebay_openai_image_context_budget_check;
alter table public.ebay_openai_image_context_runs
  add constraint ebay_openai_image_context_budget_check check (
    daily_call_limit between 1 and 20
    and requested_image_count = 1
    and (
      (
        plate_version = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
        and requested_quality = 'low'
        and requested_size = '1024x1024'
      )
      or (
        plate_version = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2'
        and requested_quality = 'low'
        and requested_size in ('1024x1024', '1536x1024')
      )
      or (
        plate_version = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
        and requested_quality = 'high'
        and requested_size = '1536x1024'
      )
    )
  );

comment on column public.ebay_openai_image_context_runs.requested_quality is
  'Legacy research claims may be low; new publish-bound V3 claims default to and require high.';
comment on column public.ebay_openai_image_context_runs.requested_size is
  'Legacy V1 claims remain 1024x1024; publish-bound V3 claims require 1536x1024.';

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
  v_asset_count integer;
  v_slot_count integer;
  v_generative_count integer;
  v_high_quality_count integer;
  v_invalid_count integer;
begin
  if p_listing_package_id is null
    or p_actor is null
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_IMAGE_SCOPE_INVALID';
  end if;

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
  if jsonb_typeof(v_images) <> 'array'
    or jsonb_array_length(v_images) <> 6
    or (
      select count(distinct image.value)
      from jsonb_array_elements_text(v_images) image(value)
    ) <> 6 then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SIX_REQUIRED';
  end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (
      where asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (
      where asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateQuality' = 'high'
    ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from p_listing_package_id
      or asset.account_key is distinct from p_account_key
      or asset.created_by is distinct from p_actor
      or asset.status <> 'approved'
      or asset.approved_by is distinct from p_actor
      or asset.approved_at is null
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.public_url is distinct from image.value
      or asset.public_url !~ '^https://[^[:space:][:cntrl:]]+$'
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
        'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
      ])
      or (
        asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
        and asset.transformation ->> 'generativeAiUsed' is distinct from 'false'
      )
    )
  into v_asset_count, v_slot_count, v_generative_count,
    v_high_quality_count, v_invalid_count
  from jsonb_array_elements_text(v_images) image(value)
  left join public.ebay_listing_image_assets asset
    on asset.public_url = image.value
    and asset.listing_package_id = p_listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_invalid_count <> 0 then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_IMAGES_INVALID';
  end if;
  if v_generative_count not in (0, 5)
    or (v_generative_count = 5 and v_high_quality_count <> 5) then
    raise exception 'EBAY_PUBLICATION_HIGH_QUALITY_IMAGES_REQUIRED';
  end if;
end;
$$;

revoke all on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) to service_role;

comment on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) is 'Blocks an eBay publication claim unless its exact six approved 1600x1600 assets are human-reviewed and every generative background is high quality.';

create or replace function public.claim_ebay_authorized_listing_publication(
  p_publication_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_preview_hash text,
  p_confirm_publish text,
  p_claim_token uuid
)
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
begin
  if p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$'
    or p_preview_hash !~ '^[0-9a-f]{64}$'
    or p_claim_token is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_CONFIRMATION_INVALID';
  end if;
  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.preview_hash is distinct from p_preview_hash then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_NOT_CLAIMABLE';
  end if;
  if v_publication.publication_idempotency_key is not null then
    if v_publication.publication_idempotency_key is distinct from p_idempotency_key then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_publication;
    return;
  end if;

  perform public.assert_ebay_publish_image_set_high_quality(
    v_publication.listing_package_id,
    p_actor_user_id,
    v_publication.marketplace_account_key
  );

  if v_publication.phase <> 'preview_ready'
    or v_publication.publish_attempt_count <> 0
    or v_publication.preview_prepared_at
      < clock_timestamp() - interval '15 minutes' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_NOT_CLAIMABLE';
  end if;
  update public.ebay_authorized_listing_publications
  set phase = 'publish_in_flight',
      publication_idempotency_key = p_idempotency_key,
      publish_attempt_count = 1,
      claim_token = p_claim_token,
      lease_expires_at = clock_timestamp() + interval '2 minutes',
      publish_started_at = clock_timestamp(),
      last_error_code = null,
      updated_at = clock_timestamp()
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$$;

comment on function public.claim_ebay_authorized_listing_publication(
  uuid, uuid, text, text, text, uuid
) is 'Claims an exact one-shot eBay publication only after the six approved images pass the high-quality publication gate.';

notify pgrst, 'reload schema';
