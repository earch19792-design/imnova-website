-- Future image packages must contain real authorized source diversity. A
-- different background, layout or declared objective does not turn one
-- catalog photograph into six different product views.

create or replace function
  public.enforce_same_day_image_source_diversity_v10()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset_count integer;
  v_secondary_count integer;
  v_secondary_source_count integer;
  v_max_secondary_source_reuse integer;
  v_invalid_evidence_count integer;
  v_invalid_pack_presentation_count integer;
begin
  if new.status not in ('PENDING_REVIEW', 'APPROVED') then
    return new;
  end if;

  if coalesce(cardinality(new.asset_ids), 0) <> 7
    or (select count(distinct id) from unnest(new.asset_ids) id) <> 7 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SEVEN_REQUIRED';
  end if;

  select
    count(*),
    count(*) filter (
      where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
    ),
    count(distinct asset.source_sha256) filter (
      where asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
    ),
    count(*) filter (
      where asset.qa_result ->> 'structuralDiversityVerified'
          is distinct from 'true'
        or asset.qa_result ->> 'copyDuplicateFree'
          is distinct from 'true'
        or asset.transformation ->> 'presentationMode'
          = 'SINGLE_SOURCE_INFORMATIONAL'
    )
  into
    v_asset_count,
    v_secondary_count,
    v_secondary_source_count,
    v_invalid_evidence_count
  from public.ebay_listing_image_assets asset
  where asset.id = any(new.asset_ids);

  select count(*)
  into v_invalid_pack_presentation_count
  from public.ebay_listing_image_assets asset
  where asset.id = any(new.asset_ids)
    and coalesce(
      (asset.transformation ->> 'verifiedOfferPackCount')::integer,
      1
    ) > 1
    and (
      asset.qa_result ->> 'offerPackPresentationPassed'
        is distinct from 'true'
      or (
        (
          asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
          or asset.transformation #>> '{visualStrategyPosition,salesObjective}'
            = 'PACKAGE_CONTENTS'
        )
        and asset.transformation ->>
          'authorizedSourceViewClassification'
            is distinct from 'PACKAGE_CONTENTS'
      )
    );

  select coalesce(max(source_use.reuse_count), 0)
  into v_max_secondary_source_reuse
  from (
    select count(*) reuse_count
    from public.ebay_listing_image_assets asset
    where asset.id = any(new.asset_ids)
      and asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
    group by asset.source_sha256
  ) source_use;

  if v_asset_count <> 7 or v_secondary_count <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_STRUCTURE_INVALID';
  end if;
  if v_secondary_source_count < 2 then
    raise exception 'SAME_DAY_IMAGE_SET_SOURCE_DIVERSITY_REQUIRED';
  end if;
  if v_max_secondary_source_reuse > 3 then
    raise exception 'SAME_DAY_IMAGE_SET_SOURCE_REUSE_LIMIT_EXCEEDED';
  end if;
  if v_invalid_evidence_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_DIVERSITY_EVIDENCE_INVALID';
  end if;
  if v_invalid_pack_presentation_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_OFFER_PACK_PRESENTATION_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists
  enforce_same_day_image_source_diversity_v10
on public.ebay_same_day_pilot_image_package_runs;

create trigger enforce_same_day_image_source_diversity_v10
before insert or update of status, asset_ids, generation_mode
on public.ebay_same_day_pilot_image_package_runs
for each row
execute function public.enforce_same_day_image_source_diversity_v10();

revoke all on function
  public.enforce_same_day_image_source_diversity_v10()
from public, anon, authenticated;
grant execute on function
  public.enforce_same_day_image_source_diversity_v10()
to service_role;

comment on function
  public.enforce_same_day_image_source_diversity_v10()
is
  'Blocks future PENDING_REVIEW or APPROVED seven-image sets that repeat one authorized source across the six commercial secondary positions.';

notify pgrst, 'reload schema';
